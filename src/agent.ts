import { answerInteraction } from './runtime/interaction.ts'
import { messageInputs } from './runtime/input.ts'
import { asObject, asString, json, stringItems, type JsonObject } from './runtime/protocol-values.ts'
import { agentMessageKind, assistantContent, toolDescriptor, toolResult, tokenUsage, type TextRecord, type ToolRecord, type AssistantRecord } from './runtime/turn-projection.ts'
/**
 * Agent implementation that projects native Codex turns onto DSH session events.
 * @module dsh-embedded-codex/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  agentEvents,
  assembleContextFor,
  type Agent,
  type AgentCancelCause,
  type AgentEventDispatch,
  type AgentOptions,
  type AgentStatus,
  type CancelOptions,
  type InboxTarget,
  type PreStepDecision,
} from '@deepseek-ai/dsh-agent'
import {
  createAssistantMessage,
  createToolResultMessage,
  errorChain,
  ToolCallId,
  type LlmCallConfig,
  type StreamChunk,
  type TokenUsage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Session, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-fs'
import {
  CodexAppServerHost,
  type CodexRemoteThread,
  type CodexThreadSink,
} from './app-server.ts'
import type { ResolvedCodexPermission } from './permissions.ts'
import { AssistantStreamAttempt } from './assistant-stream.ts'
import { Inbox } from './inbox.ts'
import { NativeBindingJournal } from './runtime/binding.ts'
import { cleanupAll } from './runtime/cleanup.ts'


interface ActiveTurn {
  readonly localTurn: number
  localStep: number
  readonly completion: PromiseWithResolvers<JsonObject>
  readonly textByItem: Map<string, TextRecord>
  readonly blocks: AssistantRecord[]
  readonly toolCalls: Map<string, ToolRecord>
  remoteTurnId?: string
  actualModel?: string
  tokenUsage?: TokenUsage
  steerTask: Promise<void>
  steerError?: Error
  remoteCompleted: boolean
  nextBlockIndex: number
  stream?: AssistantStreamAttempt
}

type AgentPhase =
  | { kind: 'idle'; lastTurn: number }
  | { kind: 'maintenance'; abort: AbortController; lastTurn: number; wakeRequested: boolean }
  | { kind: 'running'; abort: AbortController; turn: number; wakeRequested: boolean }

const REMOTE_BINDING_VERSION = 1

/** One App Server-backed implementation of the public DSH Agent handle. */
export class EmbeddedCodexAgent implements Agent, CodexThreadSink {
  readonly inbox: Inbox
  /** Per-agent registration scope available to existing DSH plugins. */
  readonly scope: Scope
  readonly ctx: Context
  private readonly dispatch: AgentEventDispatch
  private phase: AgentPhase
  private activityDone: Promise<void> = Promise.resolve()
  private activeTurn: ActiveTurn | undefined
  private remote: CodexRemoteThread | undefined
  private threadId: string | undefined
  private forkTurnId: string | undefined
  private selectedModel: string | undefined
  private assistantAttemptCounter = 0
  private assistantStreamRevision = 0
  private readonly binding: NativeBindingJournal
  private disposal: Promise<void> | undefined

  constructor(
    private readonly runtimeCtx: Context,
    private readonly appServer: CodexAppServerHost,
    readonly providerName: string,
    readonly defaultModelAlias: string,
    public readonly id: Agent['id'],
    public readonly options: AgentOptions,
    public readonly session: Session,
    private readonly resolvePermission: (cwd: string) => ResolvedCodexPermission,
    lastTurn: number,
    private readonly persistBinding: () => Promise<void> = async () => { await runtimeCtx.sessions.flush(session) },
  ) {
    this.binding = new NativeBindingJournal(session, providerName)
    const binding = this.binding.restored
    if (binding === undefined && session.deriveMessages().length > 0) {
      throw new Error(`embedded-codex: session ${JSON.stringify(this.id)} has conversation history but no Codex thread binding`)
    }
    if (binding?.inherited && binding.turnId === undefined) {
      throw new Error('embedded-codex: inherited native thread has no confirmed fork turn')
    }
    this.threadId = binding?.threadId
    this.forkTurnId = binding?.inherited === true ? binding.turnId : undefined
    this.dispatch = agentEvents(runtimeCtx, this)
    this.inbox = new Inbox(session, {
      inserted: (message) => { this.dispatch.emit('agent/inbox/inserted', { message }) },
      discarded: (message) => { this.dispatch.emit('agent/inbox/discarded', { message }) },
      claimed: (message, turn) => { this.dispatch.emit('agent/inbox/claimed', { message, turn }) },
    })
    this.phase = { kind: 'idle', lastTurn }
    this.scope = createScope(runtimeCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
  }

  get status(): AgentStatus {
    return this.phase.kind === 'running' ? 'running' : 'idle'
  }

  /**
   * Validate and attach a persisted native thread before publishing a resumed agent.
   * @param signal - Optional setup cancellation signal.
   */
  async prepareResume(signal?: AbortSignal): Promise<void> {
    if (this.threadId === undefined) return
    const cwd = this.session.header.cwd
    if (cwd === undefined) throw new Error('embedded-codex: a resumed Codex agent requires session cwd metadata')
    const attachment = await this.attachRemote(cwd, this.initialNativeModel(), this.resolvePermission(cwd), signal)
    if (this.binding.uncertainSubmission) {
      const latest = await attachment.thread.latestTurn(signal)
      throw new Error(`embedded-codex: previous native submission has an unknown outcome (latest turn: ${latest?.id ?? 'none'}); refusing to replay input`)
    }
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
    this.inbox.append(resolvedTarget, message)
    if (this.phase.kind === 'running' && resolvedTarget === 'next-step') this.scheduleSteering()
    if (wakeup) this.wake(wakingAfterAbort)
  }

  followup(message: UserMessage): void {
    this.send(message, 'next-turn', true)
  }

  steer(message: UserMessage): void {
    this.send(message, 'next-step', true)
  }

  inject(message: UserMessage): void {
    this.send(message, 'next-step', false)
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) this.inbox.clear()
    if (this.phase.kind === 'idle') return
    this.phase.wakeRequested = false
    this.phase.abort.abort(cause)
    const remoteTurnId = this.activeTurn?.remoteTurnId
    if (remoteTurnId !== undefined) this.remote?.interrupt(remoteTurnId)
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent ${JSON.stringify(this.id)} already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: AgentPhase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await task(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        done.resolve()
        if (maintenance.wakeRequested && this.inbox.hasPending) this.wake()
      }
    })()
  }

  notify(method: string, params: JsonObject): void {
    const active = this.activeTurn
    if (active === undefined) return
    try {
      this.projectNotification(active, method, params)
    } catch (error: unknown) {
      active.remoteCompleted = true
      active.completion.reject(error)
    }
  }

  private projectNotification(active: ActiveTurn, method: string, params: JsonObject): void {
    switch (method) {
      case 'turn/started': {
        const turn = asObject(params.turn, 'turn/started turn')
        this.observeRemoteTurn(active, asString(turn.id, 'turn/started turn id'))
        this.scheduleSteering()
        return
      }
      case 'thread/tokenUsage/updated': {
        const turnId = asString(params.turnId, 'token-usage turn id')
        if (!this.acceptTurn(active, turnId)) return
        const native = asObject(params.tokenUsage, 'thread token usage')
        active.tokenUsage = tokenUsage(native.last)
        return
      }
      case 'model/rerouted': {
        const turnId = asString(params.turnId, 'model-rerouted turn id')
        if (!this.acceptTurn(active, turnId)) return
        active.actualModel = asString(params.toModel, 'model-rerouted destination model')
        return
      }
      case 'item/started':
        if (this.acceptTurn(active, asString(params.turnId, 'item/started turn id'))) {
          this.startItem(active, asObject(params.item, 'started item'))
        }
        return
      case 'item/agentMessage/delta':
        if (this.acceptTurn(active, asString(params.turnId, 'agent-message delta turn id'))) {
          this.appendTextDelta(active, asString(params.itemId, 'agent-message item id'), asString(params.delta, 'agent-message delta'))
        }
        return
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
      case 'item/plan/delta':
        if (this.acceptTurn(active, asString(params.turnId, 'reasoning delta turn id'))) {
          this.appendTextDelta(active, asString(params.itemId, 'reasoning item id'), asString(params.delta, 'reasoning delta'))
        }
        return
      case 'item/completed':
        if (this.acceptTurn(active, asString(params.turnId, 'item/completed turn id'))) {
          this.completeItem(active, asObject(params.item, 'completed item'))
        }
        return
      case 'turn/completed': {
        const turn = asObject(params.turn, 'turn/completed turn')
        const turnId = asString(turn.id, 'turn/completed turn id')
        if (!this.acceptTurn(active, turnId)) return
        active.remoteCompleted = true
        active.completion.resolve(turn)
        return
      }
      default:
        return
    }
  }

  async request(method: string, params: JsonObject): Promise<unknown> {
    const active = this.activeTurn
    if (active === undefined) throw new Error(`embedded-codex: App Server request ${method} arrived outside a turn`)
    const turnId = asString(params.turnId, `${method} turn id`)
    if (!this.acceptTurn(active, turnId)) throw new Error(`embedded-codex: App Server request ${method} named another turn`)
    const signal = this.phase.kind === 'running' ? this.phase.abort.signal : undefined
    return answerInteraction(this, { approval: this.ctx.get('approval'), userQuestions: this.ctx.get('userQuestions') }, method, params, signal)
  }

  /** Detach native routing and dispose the agent-owned Cordis scope. */
  disposeRuntime(): Promise<void> {
    return this.disposal ??= cleanupAll([
      () => { this.cancel({ kind: 'disposed' }) },
      () => this.whenIdle(),
      () => { this.remote?.dispose(); this.remote = undefined },
      () => this.scope.dispose(),
    ], 'embedded-codex: Agent cleanup failed')
  }

  private setPhase(next: AgentPhase): void {
    const previous = this.status
    this.phase = next
    if (this.status !== previous) this.dispatch.emit('agent/status', { status: this.status })
  }

  private wake(wakingAfterAbort = false): void {
    if (this.phase.kind !== 'idle') {
      const reason = this.phase.abort.signal.reason as AgentCancelCause | undefined
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakingAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    const done = Promise.withResolvers<void>()
    this.activityDone = done.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      wakeRequested: false,
    })
    void this.runtimeCtx.agents.withInitiator(this, () => this.drive()).then(done.resolve, done.reject)
  }

  private async drive(): Promise<void> {
    try {
      while (this.inbox.hasPending) await this.runTurn()
    } catch {
      // runTurn reports failures and commits the durable turn boundary.
    } finally {
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        if (wakeRequested && this.inbox.hasPending) this.wake()
      }
    }
  }

  private async runTurn(): Promise<void> {
    if (this.phase.kind !== 'running') throw new Error('embedded-codex: turn started outside the driver')
    const phase = this.phase
    const signal = phase.abort.signal
    signal.throwIfAborted()
    const turn = phase.turn + 1
    const step = 1
    let endReason: TurnEndReason = { kind: 'completed' }
    this.session.append('turn/start', { turn })
    phase.turn = turn
    try {
      const decision = await this.prepareStepInput('next-turn', { turn, step }, signal)
      if (decision.kind === 'reject') {
        endReason = { kind: 'blocked' }
        return
      }
      const messages = decision.messages
      if (messages.length === 0) return
      this.session.append('step/start', { turn, step })
      const active: ActiveTurn = {
        localTurn: turn,
        localStep: step,
        completion: Promise.withResolvers<JsonObject>(),
        textByItem: new Map(),
        blocks: [],
        toolCalls: new Map(),
        steerTask: Promise.resolve(),
        remoteCompleted: false,
        nextBlockIndex: 0,
      }
      this.activeTurn = active
      try {
        for (const message of messages) this.session.append('user/message', message, { surfaceOp: 'append' })
        const config = await this.resolveTurnConfig(turn, step, signal)
        const nativeModel = this.nativeModel(config)
        const cwd = this.session.header.cwd
        if (cwd === undefined) throw new Error('embedded-codex: a Codex agent requires session cwd metadata')
        const permission = this.resolvePermission(cwd)
        const remote = await this.ensureRemote(cwd, nativeModel, permission, signal)
        active.actualModel = nativeModel ?? this.selectedModel as string
        this.logRequest(config)
        const inputs = await messageInputs(this.ctx, messages, signal)
        this.beginStream(active)
        signal.throwIfAborted()
        this.binding.submitting(remote.id, turn)
        try {
          await this.persistBinding()
          signal.throwIfAborted()
        } catch (error: unknown) {
          // Nothing has crossed the RPC boundary yet. Preserve that distinction on recovery.
          this.binding.notSubmitted(remote.id, turn)
          try { await this.persistBinding() } catch (persistence: unknown) {
            throw new AggregateError([error, persistence], 'embedded-codex: input was not sent and journal flush failed')
          }
          throw error
        }
        const remoteTurnId = await remote.startTurn(
          inputs,
          messages[0]?.id,
          nativeModel,
          config.reasoningEffort,
          permission,
          signal,
        )
        this.observeRemoteTurn(active, remoteTurnId)
        await this.persistBinding()
        this.scheduleSteering()
        const terminal = await remote.waitFor(active.completion.promise, signal)
        await this.waitForSteering(active)
        if (active.steerError !== undefined) throw active.steerError
        signal.throwIfAborted()
        const status = asString(terminal.status, 'terminal turn status')
        if (status !== 'completed') {
          const error = terminal.error
          if (status === 'failed' && json(error).includes('contextWindowExceeded')) {
            endReason = { kind: 'max-tokens' }
          } else {
            throw new Error(`embedded-codex: Codex turn ended with status ${status}${error === null ? '' : `: ${json(error)}`}`)
          }
        }
        this.closeOpenBlocks(active)
        const blocks = assistantContent(active.blocks)
        if (blocks.every(block => block.type !== 'text')) {
          throw new Error('embedded-codex: Codex completed without a final answer')
        }
        if (active.tokenUsage !== undefined) {
          this.appendChunk(active, { type: 'usage', usage: active.tokenUsage })
        }
        this.appendChunk(active, {
          type: 'finish',
          reason: endReason.kind === 'max-tokens' ? { kind: 'max-tokens' } : { kind: 'stop' },
        })
        const actualModel = active.actualModel
        if (actualModel === undefined) throw new Error('embedded-codex: Codex completed before model selection')
        const stream = this.streamOf(active)
        stream.settle('assistant/message', () => this.session.append('assistant/message', {
            turn,
            step: active.localStep,
            message: createAssistantMessage({
              content: blocks,
              source: {
                provider: this.providerName,
                model: actualModel,
                replayState: {
                  embeddedCodex: {
                    version: REMOTE_BINDING_VERSION,
                    threadId: remote.id,
                    turnId: active.remoteTurnId,
                  },
                },
              },
            }),
            stream: stream.stream,
            ...(active.tokenUsage === undefined ? {} : { usage: active.tokenUsage }),
          }, { surfaceOp: 'append' }).seq)
      } catch (error: unknown) {
        this.closeOpenBlocks(active)
        if (signal.aborted) {
          endReason = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
          const blocks = assistantContent(active.blocks)
          const stream = active.stream
          if (stream !== undefined && !stream.ended) {
            const remote = this.remote
            const actualModel = active.actualModel
            if (blocks.length > 0 && remote !== undefined && actualModel !== undefined) {
              stream.settle('assistant/message', () => this.session.append('assistant/message', {
                turn,
                step: active.localStep,
                message: createAssistantMessage({
                  content: blocks,
                  source: {
                    provider: this.providerName,
                    model: actualModel,
                    replayState: {
                      embeddedCodex: {
                        version: REMOTE_BINDING_VERSION,
                        threadId: remote.id,
                        turnId: active.remoteTurnId,
                      },
                    },
                  },
                }),
                stream: stream.stream,
                interrupted: true,
                ...(active.tokenUsage === undefined ? {} : { usage: active.tokenUsage }),
              }, { surfaceOp: 'append' }).seq)
            } else {
              stream.settle(
                'assistant/attempt',
                () => this.session.append('assistant/attempt', {
                  turn,
                  step: active.localStep,
                  stream: stream.stream,
                }).seq,
              )
            }
          }
        } else {
          const stream = active.stream
          if (stream !== undefined && !stream.ended) {
            stream.settle(
              'assistant/attempt',
              () => this.session.append('assistant/attempt', {
                turn,
                step: active.localStep,
                stream: stream.stream,
              }).seq,
            )
          }
          endReason = { kind: 'error', error: { message: errorChain(error), code: 'CODEX_APP_SERVER' } }
        }
        this.dispatch.emit('agent/error', { turn, step: active.localStep, error })
        throw error
      } finally {
        this.activeTurn = undefined
        for (const record of active.toolCalls.values()) {
          if (record.completed) continue
          this.session.append('tool/result', {
            turn,
            step: record.step,
            message: createToolResultMessage({
              callId: record.callId,
              content: [{ type: 'text', text: 'Codex tool execution ended without a result; its outcome is unknown.' }],
              isError: true,
            }),
            error: { name: 'CodexToolError', code: 'CODEX_TOOL_OUTCOME_UNKNOWN' },
          }, { surfaceOp: 'append' })
          record.completed = true
        }
        this.session.append('step/end', { turn, step: active.localStep })
      }
      if (endReason.kind === 'completed') {
        await this.dispatch.serial('agent/turn-stopping', { turn, signal })
      }
    } catch (error: unknown) {
      if (signal.aborted) endReason = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
      else if (endReason.kind === 'completed') {
        endReason = { kind: 'error', error: { message: errorChain(error), code: 'CODEX_APP_SERVER' } }
        this.dispatch.emit('agent/error', { turn, step, error })
      }
      throw error
    } finally {
      this.session.append('turn/end', { turn, reason: endReason })
    }
  }

  private async prepareStepInput(
    target: InboxTarget,
    position: { turn: number; step: number },
    signal: AbortSignal,
  ): Promise<PreStepDecision> {
    const messages = this.inbox.claim(target, position.turn)
    // Embedded Codex delegates its effective system prompt to App Server, but
    // assembly remains a DSH step lifecycle boundary for scoped plugins.
    await this.ctx.systemPrompt.assemble(assembleContextFor(this, signal))
    signal.throwIfAborted()
    const decision = await this.dispatch.waterfall(
      'agent/pre-step', { messages, ...position, signal },
      (): Promise<PreStepDecision> => Promise.resolve({ kind: 'enter', messages }),
    )
    signal.throwIfAborted()
    return decision
  }

  private initialNativeModel(): string | undefined {
    return this.options.provider === this.providerName
      ? this.nativeModel(this.options)
      : undefined
  }

  private nativeModel(config: Pick<AgentOptions, 'provider' | 'model'>): string | undefined {
    if (config.provider !== this.providerName) {
      throw new Error(
        `embedded-codex: this Agent Runtime serves only provider ${JSON.stringify(this.providerName)}`,
      )
    }
    const model = config.model
    return model === undefined || model === this.defaultModelAlias ? undefined : model
  }

  private async resolveTurnConfig(turn: number, step: number, signal: AbortSignal): Promise<LlmCallConfig> {
    const proposed = await this.dispatch.waterfall(
      'agent/request', { turn, step, signal },
      () => Promise.resolve({
        provider: this.options.provider ?? '',
        model: this.options.model ?? '',
        ...(this.options.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: this.options.reasoningEffort }),
      }),
    )
    signal.throwIfAborted()
    if (proposed.maxTokens !== undefined) {
      throw new Error('embedded-codex: Codex App Server does not expose a per-turn maxTokens setting')
    }
    this.nativeModel(proposed)
    return proposed
  }

  private async ensureRemote(
    cwd: string,
    model: string | undefined,
    permission: ResolvedCodexPermission,
    signal: AbortSignal,
  ): Promise<CodexRemoteThread> {
    if (this.remote?.active === true) return this.remote
    this.remote?.dispose()
    this.remote = undefined
    const attachment = await this.attachRemote(cwd, model, permission, signal)
    return attachment.thread
  }

  private async attachRemote(
    cwd: string,
    model: string | undefined,
    permission: ResolvedCodexPermission,
    signal?: AbortSignal,
  ): Promise<{ thread: CodexRemoteThread; model: string }> {
    const attachment = this.threadId === undefined
      ? await this.appServer.startThread(this, cwd, model, permission, signal)
      : this.forkTurnId === undefined
        ? await this.appServer.resumeThread(this.threadId, this, cwd, model, permission, signal)
        : await this.appServer.forkThread(this.threadId, this.forkTurnId, this, cwd, model, permission, signal)
    this.remote = attachment.thread
    this.threadId = attachment.thread.id
    this.forkTurnId = undefined
    this.selectedModel = attachment.model
    this.binding.bindThread(attachment.thread.id)
    await this.persistBinding()
    return attachment
  }

  private logRequest(config: LlmCallConfig): void {
    const header = {
      config: {
        provider: this.providerName,
        model: config.model,
        ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
      },
    }
    this.session.append('request/header', {
      header,
      reason: this.session.requestHeader() === undefined ? 'initial' : 'series',
    })
    const previous = this.session.requestContext()
    if (previous?.provider !== this.providerName || previous.model !== config.model) {
      this.session.append('request/context', { provider: this.providerName, model: config.model })
    }
  }

  private observeRemoteTurn(active: ActiveTurn, remoteTurnId: string): void {
    if (this.remote === undefined) throw new Error('embedded-codex: turn notification before thread attachment')
    if (active.remoteTurnId !== undefined && active.remoteTurnId !== remoteTurnId) {
      throw new Error('embedded-codex: App Server referenced conflicting active turns')
    }
    this.binding.bindTurn(this.remote.id, remoteTurnId, active.localTurn)
    active.remoteTurnId = remoteTurnId
  }

  private acceptTurn(active: ActiveTurn, remoteTurnId: string): boolean {
    if (active.remoteTurnId === undefined) {
      this.observeRemoteTurn(active, remoteTurnId)
      return true
    }
    return active.remoteTurnId === remoteTurnId
  }

  private startItem(active: ActiveTurn, item: JsonObject): void {
    const itemId = asString(item.id, 'item id')
    if (item.type === 'agentMessage') {
      this.startText(active, itemId, agentMessageKind(item))
      return
    }
    if (item.type === 'reasoning' || item.type === 'plan') {
      this.startText(active, itemId, 'reasoning')
      return
    }
    const descriptor = toolDescriptor(item)
    if (descriptor === undefined || active.toolCalls.has(itemId)) return
    if (active.stream?.ended === true) this.beginStream(active)
    const callId = ToolCallId(`codex:${itemId}`)
    const record: ToolRecord = {
      itemId,
      index: active.nextBlockIndex++,
      kind: 'tool-call',
      callId,
      name: descriptor.name,
      arguments: descriptor.arguments,
      step: active.localStep,
      completed: false,
    }
    active.toolCalls.set(itemId, record)
    active.blocks.push(record)
    this.appendChunk(active, { type: 'block-start', index: record.index, blockType: 'tool-call' })
    this.appendChunk(active, {
      type: 'tool-call-delta',
      index: record.index,
      id: callId,
      name: record.name,
      argumentsDelta: record.arguments,
    })
    this.appendChunk(active, {
      type: 'block-end',
      index: record.index,
      block: {
        type: 'tool-call',
        id: callId,
        name: record.name,
        arguments: record.arguments,
      },
    })
    // V4 storage requires the Assistant to advertise a call before its live
    // tool/call and tool/result records, including while the tool is running.
    this.commitToolMessage(active)
    this.session.append('tool/call', {
      turn: active.localTurn,
      step: record.step,
      callId,
      name: record.name,
      arguments: record.arguments,
    })
  }

  private startText(active: ActiveTurn, itemId: string, kind: TextRecord['kind']): TextRecord {
    const existing = active.textByItem.get(itemId)
    if (existing !== undefined) return existing
    if (active.stream?.ended === true) {
      if ([...active.toolCalls.values()].every(record => record.completed)) this.advanceCompatibilityStep(active)
      else this.beginStream(active)
    }
    const record: TextRecord = {
      itemId,
      index: active.nextBlockIndex++,
      kind,
      text: '',
      open: true,
    }
    active.textByItem.set(itemId, record)
    active.blocks.push(record)
    this.appendChunk(active, { type: 'block-start', index: record.index, blockType: kind })
    return record
  }

  private appendTextDelta(active: ActiveTurn, itemId: string, delta: string): void {
    const record = active.textByItem.get(itemId)
    if (record === undefined) {
      throw new Error(`embedded-codex: received text delta before item/start for ${JSON.stringify(itemId)}`)
    }
    if (!record.open || delta.length === 0) return
    record.text += delta
    this.appendChunk(active, record.kind === 'text'
      ? { type: 'text-delta', index: record.index, text: delta }
      : { type: 'reasoning-delta', index: record.index, text: delta })
  }

  private completeItem(active: ActiveTurn, item: JsonObject): void {
    const itemId = asString(item.id, 'completed item id')
    if (item.type === 'agentMessage') {
      const record = active.textByItem.get(itemId)
        ?? this.startText(active, itemId, agentMessageKind(item))
      const complete = typeof item.text === 'string' ? item.text : ''
      this.appendCompletedText(active, itemId, record, complete)
      this.endText(active, record)
      return
    }
    if (item.type === 'reasoning') {
      const record = active.textByItem.get(itemId) ?? this.startText(active, itemId, 'reasoning')
      const parts = [
        ...stringItems(item.summary),
        ...stringItems(item.content),
      ]
      const complete = parts.join('\n')
      this.appendCompletedText(active, itemId, record, complete)
      this.endText(active, record)
      return
    }
    if (item.type === 'plan') {
      const record = active.textByItem.get(itemId) ?? this.startText(active, itemId, 'reasoning')
      const complete = typeof item.text === 'string' ? item.text : ''
      this.appendCompletedText(active, itemId, record, complete)
      this.endText(active, record)
      return
    }
    const descriptor = toolDescriptor(item)
    if (descriptor === undefined) return
    if (!active.toolCalls.has(itemId)) this.startItem(active, item)
    const record = active.toolCalls.get(itemId)
    if (record === undefined || record.completed) return
    const result = toolResult(item)
    this.session.append('tool/result', {
      turn: active.localTurn,
      step: record.step,
      message: createToolResultMessage({
        callId: record.callId,
        content: [{ type: 'text', text: result.text }],
        isError: result.isError,
      }),
      ...(result.isError ? { error: { name: 'CodexToolError', code: 'CODEX_TOOL_FAILED' } } : {}),
    }, { surfaceOp: 'append' })
    record.completed = true
  }

  private endText(active: ActiveTurn, record: TextRecord): void {
    if (!record.open) return
    record.open = false
    this.appendChunk(active, {
      type: 'block-end',
      index: record.index,
      block: { type: record.kind, text: record.text },
    })
  }

  private appendCompletedText(active: ActiveTurn, itemId: string, record: TextRecord, complete: string): void {
    if (!complete.startsWith(record.text)) {
      throw new Error(`embedded-codex: completed text for item ${JSON.stringify(itemId)} diverged from streamed text`)
    }
    this.appendTextDelta(active, itemId, complete.slice(record.text.length))
  }

  private closeOpenBlocks(active: ActiveTurn): void {
    for (const record of active.blocks) {
      if (record.kind !== 'tool-call') this.endText(active, record)
    }
  }

  private commitToolMessage(active: ActiveTurn): void {
    this.closeOpenBlocks(active)
    this.appendChunk(active, { type: 'finish', reason: { kind: 'tool-calls' } })
    const model = active.actualModel
    const remote = this.remote
    if (model === undefined || remote === undefined || active.remoteTurnId === undefined) {
      throw new Error('embedded-codex: tool item arrived before native thread attachment')
    }
    const stream = this.streamOf(active)
    stream.settle('assistant/message', () => this.session.append('assistant/message', {
        turn: active.localTurn,
        step: active.localStep,
        message: createAssistantMessage({
          content: assistantContent(active.blocks),
          source: {
            provider: this.providerName,
            model,
            replayState: {
              embeddedCodex: {
                version: REMOTE_BINDING_VERSION,
                threadId: remote.id,
                turnId: active.remoteTurnId,
              },
            },
          },
        }),
        stream: stream.stream,
      }, { surfaceOp: 'append' }).seq)
    active.blocks.length = 0
    active.nextBlockIndex = 0
  }

  private advanceCompatibilityStep(active: ActiveTurn): void {
    this.session.append('step/end', { turn: active.localTurn, step: active.localStep })
    active.localStep += 1
    this.session.append('step/start', { turn: active.localTurn, step: active.localStep })
    this.beginStream(active)
  }

  private appendChunk(active: ActiveTurn, chunk: StreamChunk): void {
    this.streamOf(active).push(chunk)
  }

  private beginStream(active: ActiveTurn): void {
    if (active.stream !== undefined && !active.stream.ended) {
      throw new Error('embedded-codex: assistant stream was already active')
    }
    const stream = new AssistantStreamAttempt(
      this.session.id,
      ++this.assistantAttemptCounter,
      () => ++this.assistantStreamRevision,
      active.localTurn,
      active.localStep,
      frame => { this.dispatch.emit('agent/assistant-stream', { frame }) },
    )
    active.stream = stream
    stream.start()
  }

  private streamOf(active: ActiveTurn): AssistantStreamAttempt {
    if (active.stream === undefined) throw new Error('embedded-codex: assistant stream has not started')
    return active.stream
  }

  private scheduleSteering(): void {
    const active = this.activeTurn
    if (active === undefined
      || active.remoteCompleted
      || active.remoteTurnId === undefined
      || this.remote === undefined
      || this.inbox.nextStep.length === 0) return
    active.steerTask = active.steerTask.then(async () => {
      if (this.phase.kind !== 'running'
        || active.remoteCompleted
        || active.remoteTurnId === undefined
        || this.remote === undefined) return
      const decision = await this.prepareStepInput(
        'next-step',
        { turn: active.localTurn, step: active.localStep },
        this.phase.abort.signal,
      )
      if (decision.kind === 'reject') {
        if (this.inbox.nextStep.length > 0) this.scheduleSteering()
        return
      }
      const messages = decision.messages
      if (messages.length === 0) {
        if (this.inbox.nextStep.length > 0) this.scheduleSteering()
        return
      }
      for (const message of messages) this.session.append('user/message', message, { surfaceOp: 'append' })
      if (decision.startsRequestSeries === true) this.logSteeringSeries()
      const input = await messageInputs(this.ctx, messages, this.phase.abort.signal)
      await this.remote.steer(active.remoteTurnId, input, this.phase.abort.signal)
      if (this.inbox.nextStep.length > 0) this.scheduleSteering()
    }).catch((error: unknown) => {
      active.steerError = error instanceof Error ? error : new Error(String(error))
      if (active.remoteTurnId !== undefined) this.remote?.interrupt(active.remoteTurnId)
    })
  }

  private logSteeringSeries(): void {
    const header = this.session.requestHeader()
    if (header === undefined) {
      throw new Error('embedded-codex: steering requested a message series before the native turn header')
    }
    this.session.append('request/header', { header, reason: 'series' })
  }

  private async waitForSteering(active: ActiveTurn): Promise<void> {
    let observed: Promise<void>
    do {
      await (observed = active.steerTask)
    } while (observed !== active.steerTask)
  }
}
