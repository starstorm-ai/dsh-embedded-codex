/**
 * Agent implementation that projects native Codex turns onto DSH session events.
 * @module dsh-embedded-codex/agent
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  agentEvents,
  assembleContextFor,
  Inbox,
  type Agent,
  type AgentCancelCause,
  type AgentEventDispatch,
  type AgentOptions,
  type AgentStatus,
  type CancelOptions,
  type InboxTarget,
} from '@deepseek-ai/dsh-agent'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  createAssistantMessage,
  createToolResultMessage,
  errorChain,
  ToolCallId,
  type ContentBlock,
  type LlmCallConfig,
  type StreamChunk,
  type TokenUsage,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionSeq, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { UserInput } from '../protocol/v2/UserInput.ts'
import {
  CodexAppServerHost,
  type CodexRemoteThread,
  type CodexThreadSink,
} from './app-server.ts'

type JsonObject = Record<string, unknown>

interface TextRecord {
  readonly itemId: string
  readonly index: number
  readonly kind: 'text' | 'reasoning'
  text: string
  open: boolean
}

interface ToolRecord {
  readonly itemId: string
  readonly index: number
  readonly kind: 'tool-call'
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: string
  readonly step: number
}

type AssistantRecord = TextRecord | ToolRecord

interface ActiveTurn {
  readonly localTurn: number
  localStep: number
  readonly completion: PromiseWithResolvers<JsonObject>
  readonly textByItem: Map<string, TextRecord>
  readonly blocks: AssistantRecord[]
  readonly chunkSeqs: SessionSeq[]
  readonly toolCalls: Map<string, ToolRecord>
  remoteTurnId?: string
  actualModel?: string
  tokenUsage?: TokenUsage
  steerTask: Promise<void>
  steerError?: Error
  remoteCompleted: boolean
  nextBlockIndex: number
}

type AgentPhase =
  | { kind: 'idle'; lastTurn: number }
  | { kind: 'maintenance'; abort: AbortController; lastTurn: number; wakeRequested: boolean }
  | { kind: 'running'; abort: AbortController; turn: number; wakeRequested: boolean }

const REMOTE_BINDING_VERSION = 1

interface RemoteBinding {
  readonly threadId: string
  readonly turnId: string
  readonly inherited: boolean
}

function asObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value as JsonObject
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value
}

function json(value: unknown): string {
  const encoded = JSON.stringify(value)
  return typeof encoded === 'string' ? encoded : 'null'
}

function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const output: string[] = []
  for (const item of value as unknown[]) {
    if (typeof item === 'string') output.push(item)
  }
  return output
}

function agentMessageKind(item: JsonObject): TextRecord['kind'] {
  if (item.phase === 'commentary') return 'reasoning'
  if (item.phase === 'final_answer' || item.phase === null) return 'text'
  throw new Error('embedded-codex: App Server returned invalid agent-message phase')
}

function assistantContent(records: readonly AssistantRecord[]): ContentBlock[] {
  return records.flatMap((record): ContentBlock[] => {
    if (record.kind === 'tool-call') {
      return [{
        type: 'tool-call',
        id: record.callId,
        name: record.name,
        arguments: record.arguments,
      }]
    }
    return record.text.length === 0 ? [] : [{ type: record.kind, text: record.text }]
  })
}

function persistedBinding(session: Session, provider: string): RemoteBinding | undefined {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq as SessionSeq)
    if (event?.type !== 'assistant/message') continue
    const source = event.data.message.source
    if (source.provider !== provider) continue
    const replay = source.replayState
    if (replay === null || typeof replay !== 'object' || Array.isArray(replay)) continue
    const embedded = (replay as JsonObject).embeddedCodex
    if (embedded === null || typeof embedded !== 'object' || Array.isArray(embedded)) continue
    const binding = embedded as JsonObject
    if (binding.version === REMOTE_BINDING_VERSION
      && typeof binding.threadId === 'string'
      && binding.threadId.length > 0
      && typeof binding.turnId === 'string'
      && binding.turnId.length > 0) {
      return {
        threadId: binding.threadId,
        turnId: binding.turnId,
        inherited: event.seq < session.inheritedEventCount,
      }
    }
  }
  return undefined
}

function toolDescriptor(item: JsonObject): { name: string; arguments: string } | undefined {
  switch (item.type) {
    case 'commandExecution':
      return { name: 'codex.command', arguments: json({ command: item.command, cwd: item.cwd, source: item.source }) }
    case 'fileChange':
      return { name: 'codex.file_change', arguments: json({ changes: item.changes }) }
    case 'mcpToolCall':
      return { name: 'codex.mcp_tool', arguments: json({ server: item.server, tool: item.tool, arguments: item.arguments }) }
    case 'dynamicToolCall':
      return { name: 'codex.dynamic_tool', arguments: json({ namespace: item.namespace, tool: item.tool, arguments: item.arguments }) }
    case 'collabAgentToolCall':
      return { name: 'codex.collab_agent', arguments: json({ tool: item.tool, prompt: item.prompt, model: item.model }) }
    case 'subAgentActivity':
      return { name: 'codex.subagent_activity', arguments: json({ kind: item.kind, agentThreadId: item.agentThreadId, agentPath: item.agentPath }) }
    case 'webSearch':
      return { name: 'codex.web_search', arguments: json({ query: item.query, action: item.action }) }
    case 'imageView':
      return { name: 'codex.image_view', arguments: json({ path: item.path }) }
    case 'sleep':
      return { name: 'codex.sleep', arguments: json(item) }
    case 'imageGeneration':
      return { name: 'codex.image_generation', arguments: json(item) }
    case 'hookPrompt':
      return { name: 'codex.hook_prompt', arguments: json({ fragments: item.fragments }) }
    case 'enteredReviewMode':
      return { name: 'codex.review_mode_entered', arguments: json({ review: item.review }) }
    case 'exitedReviewMode':
      return { name: 'codex.review_mode_exited', arguments: json({ review: item.review }) }
    case 'contextCompaction':
      return { name: 'codex.context_compaction', arguments: '{}' }
    default:
      return undefined
  }
}

function toolResult(item: JsonObject): { text: string; isError: boolean } {
  const status = typeof item.status === 'string' ? item.status : undefined
  const isError = status === 'failed' || status === 'declined' || item.success === false
  switch (item.type) {
    case 'commandExecution':
      return {
        text: typeof item.aggregatedOutput === 'string'
          ? item.aggregatedOutput
          : json({ status, exitCode: item.exitCode, durationMs: item.durationMs }),
        isError,
      }
    case 'fileChange':
      return { text: json({ status, changes: item.changes }), isError }
    case 'mcpToolCall':
      return { text: json(item.error ?? item.result ?? { status }), isError }
    case 'dynamicToolCall':
      return { text: json(item.contentItems ?? { status }), isError }
    case 'collabAgentToolCall':
      return { text: json({ status, receiverThreadIds: item.receiverThreadIds, agentsStates: item.agentsStates }), isError }
    case 'webSearch':
      return { text: json({ results: item.results, action: item.action }), isError: false }
    default:
      return { text: json(item), isError }
  }
}

function tokenUsage(value: unknown): TokenUsage {
  const usage = asObject(value, 'token usage')
  const input = asNumber(usage.inputTokens, 'input token count')
  const cacheRead = asNumber(usage.cachedInputTokens, 'cached input token count')
  const cacheWrite = asNumber(usage.cacheWriteInputTokens, 'cache-write input token count')
  const output = asNumber(usage.outputTokens, 'output token count')
  const total = asNumber(usage.totalTokens, 'total token count')
  const reasoning = asNumber(usage.reasoningOutputTokens, 'reasoning token count')
  if (cacheRead + cacheWrite > input) {
    throw new Error('embedded-codex: App Server returned token cache counts above the input token count')
  }
  return {
    inputTokens: input - cacheRead - cacheWrite,
    outputTokens: output,
    totalTokens: total,
    ...(cacheRead === 0 ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === 0 ? {} : { cacheWriteTokens: cacheWrite }),
    ...(reasoning === 0 ? {} : { reasoningTokens: reasoning }),
  }
}

function textForContent(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-result':
      return block.content.map(textForContent).join('\n')
    case 'tool-call':
      return `${block.name}(${block.arguments})`
    case 'image':
      return ''
    default:
      return ''
  }
}

async function messageInputs(
  ctx: Context,
  messages: readonly UserMessage[],
  signal: AbortSignal,
): Promise<UserInput[]> {
  const inputs: UserInput[] = []
  for (const message of messages) {
    for (const block of message.content) {
      signal.throwIfAborted()
      if (block.type === 'image') {
        const attachments: AttachmentStore | undefined = ctx.get('attachments')
        if (attachments === undefined) {
          throw new Error('embedded-codex: image input requires an attachment provider')
        }
        const path = attachments.imageHostPath(block.attachment)
        if (path !== undefined) {
          inputs.push({ type: 'localImage', path })
        } else {
          const stored = await attachments.readImage(block.attachment, signal)
          inputs.push({
            type: 'image',
            url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`,
          })
        }
        continue
      }
      const text = textForContent(block)
      if (text.length > 0) inputs.push({ type: 'text', text, text_elements: [] })
    }
  }
  if (inputs.length === 0) throw new Error('embedded-codex: a turn requires text or image input')
  return inputs
}

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

  constructor(
    private readonly runtimeCtx: Context,
    private readonly appServer: CodexAppServerHost,
    readonly providerName: string,
    readonly defaultModelAlias: string,
    public readonly id: Agent['id'],
    public readonly options: AgentOptions,
    public readonly session: Session,
    lastTurn: number,
  ) {
    const binding = persistedBinding(session, providerName)
    if (binding === undefined && session.deriveMessages().length > 0) {
      throw new Error(`embedded-codex: session ${JSON.stringify(this.id)} has conversation history but no Codex thread binding`)
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
    await this.attachRemote(cwd, this.initialNativeModel(), signal)
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
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval': {
        const approval = this.ctx.get('approval')
        if (approval === undefined) return { decision: 'decline' }
        const outcome = await approval.request({
          agent: this,
          toolName: method.includes('commandExecution') ? 'codex.command' : 'codex.file_change',
          callId: ToolCallId(`codex:${asString(params.itemId, `${method} item id`)}`),
          ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
          ...(signal === undefined ? {} : { signal }),
        })
        return { decision: outcome === 'allowed-once' ? 'accept' : outcome === 'cancelled' ? 'cancel' : 'decline' }
      }
      case 'item/permissions/requestApproval': {
        const approval = this.ctx.get('approval')
        if (approval === undefined) return { permissions: {}, scope: 'turn' }
        const outcome = await approval.request({
          agent: this,
          toolName: 'codex.permissions',
          callId: ToolCallId(`codex:${asString(params.itemId, 'permission item id')}`),
          ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
          ...(signal === undefined ? {} : { signal }),
        })
        if (outcome !== 'allowed-once') return { permissions: {}, scope: 'turn' }
        const requested = asObject(params.permissions, 'requested permissions')
        return {
          permissions: {
            ...(requested.network === null || requested.network === undefined ? {} : { network: requested.network }),
            ...(requested.fileSystem === null || requested.fileSystem === undefined ? {} : { fileSystem: requested.fileSystem }),
          },
          scope: 'turn',
        }
      }
      case 'item/tool/requestUserInput': {
        const questions = this.ctx.get('userQuestions')
        if (questions === undefined) return { answers: {} }
        const rawQuestions = params.questions
        if (!Array.isArray(rawQuestions)) throw new Error('embedded-codex: App Server returned invalid user questions')
        const mapped: AskUserQuestionItem[] = rawQuestions.map((value) => {
          const question = asObject(value, 'user question')
          const options = question.options
          return {
            id: asString(question.id, 'user question id'),
            header: asString(question.header, 'user question header'),
            question: asString(question.question, 'user question text'),
            ...(options === null ? {} : {
              options: Array.isArray(options)
                ? options.map((candidate) => {
                  const option = asObject(candidate, 'user question option')
                  return {
                    label: asString(option.label, 'user question option label'),
                    ...(typeof option.description === 'string' ? { description: option.description } : {}),
                  }
                })
                : (() => { throw new Error('embedded-codex: App Server returned invalid user question options') })(),
            }),
          }
        })
        const answer = await questions.ask({ questions: mapped, agent: this, ...(signal === undefined ? {} : { signal }) })
        return {
          answers: Object.fromEntries(answer.answers.map(item => [item.id, {
            answers: [...item.selected, ...item.custom === undefined ? [] : [item.custom]],
          }])),
        }
      }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      default:
        throw new Error(`embedded-codex: unsupported App Server request ${JSON.stringify(method)}`)
    }
  }

  /** Detach native routing and dispose the agent-owned Cordis scope. */
  async disposeRuntime(): Promise<void> {
    this.cancel({ kind: 'disposed' })
    await this.whenIdle()
    this.remote?.dispose()
    this.remote = undefined
    await this.scope.dispose()
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
      const messages = this.inbox.claim('next-turn', turn)
      if (messages.length === 0) return
      this.session.append('step/start', { turn, step })
      const active: ActiveTurn = {
        localTurn: turn,
        localStep: step,
        completion: Promise.withResolvers<JsonObject>(),
        textByItem: new Map(),
        blocks: [],
        chunkSeqs: [],
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
        const remote = await this.ensureRemote(nativeModel, signal)
        active.actualModel = nativeModel ?? this.selectedModel as string
        this.logRequest(config)
        const inputs = await messageInputs(this.ctx, messages, signal)
        const remoteTurnId = await remote.startTurn(
          inputs,
          messages[0]?.id,
          nativeModel,
          config.reasoningEffort,
          signal,
        )
        this.observeRemoteTurn(active, remoteTurnId)
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
        if (active.tokenUsage !== undefined) {
          this.appendChunk(active, { type: 'usage', usage: active.tokenUsage })
        }
        this.appendChunk(active, {
          type: 'finish',
          reason: endReason.kind === 'max-tokens' ? { kind: 'max-tokens' } : { kind: 'stop' },
        })
        const blocks = assistantContent(active.blocks)
        if (blocks.every(block => block.type !== 'text')) {
          throw new Error('embedded-codex: Codex completed without a final answer')
        }
        this.session.append('assistant/message', {
          turn,
          step: active.localStep,
          message: createAssistantMessage({
            content: blocks,
            source: {
              provider: this.providerName,
              model: active.actualModel,
              replayState: {
                embeddedCodex: {
                  version: REMOTE_BINDING_VERSION,
                  threadId: remote.id,
                  turnId: active.remoteTurnId,
                },
              },
            },
          }),
          ...(active.tokenUsage === undefined ? {} : { usage: active.tokenUsage }),
        }, { surfaceOp: 'append', sourceEventSeqs: active.chunkSeqs })
      } catch (error: unknown) {
        this.closeOpenBlocks(active)
        if (signal.aborted) {
          endReason = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
          const blocks = assistantContent(active.blocks)
          if (blocks.length > 0 && this.remote !== undefined && active.actualModel !== undefined) {
            this.session.append('assistant/message', {
              turn,
              step: active.localStep,
              message: createAssistantMessage({
                content: blocks,
                source: {
                  provider: this.providerName,
                  model: active.actualModel,
                  replayState: {
                    embeddedCodex: {
                      version: REMOTE_BINDING_VERSION,
                      threadId: this.remote.id,
                      turnId: active.remoteTurnId,
                    },
                  },
                },
              }),
              interrupted: true,
              ...(active.tokenUsage === undefined ? {} : { usage: active.tokenUsage }),
            }, { surfaceOp: 'append', sourceEventSeqs: active.chunkSeqs })
          }
        } else {
          endReason = { kind: 'error', error: { message: errorChain(error), code: 'CODEX_APP_SERVER' } }
        }
        this.dispatch.emit('agent/error', { turn, step: active.localStep, error })
        throw error
      } finally {
        this.activeTurn = undefined
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
    await this.ctx.systemPrompt.assemble(assembleContextFor(this, signal))
    signal.throwIfAborted()
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

  private async ensureRemote(model: string | undefined, signal: AbortSignal): Promise<CodexRemoteThread> {
    if (this.remote?.active === true) return this.remote
    this.remote?.dispose()
    this.remote = undefined
    const cwd = this.session.header.cwd
    if (cwd === undefined) throw new Error('embedded-codex: a Codex agent requires session cwd metadata')
    const attachment = await this.attachRemote(cwd, model, signal)
    return attachment.thread
  }

  private async attachRemote(
    cwd: string,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ thread: CodexRemoteThread; model: string }> {
    const attachment = this.threadId === undefined
      ? await this.appServer.startThread(this, cwd, model, signal)
      : this.forkTurnId === undefined
        ? await this.appServer.resumeThread(this.threadId, this, cwd, model, signal)
        : await this.appServer.forkThread(this.threadId, this.forkTurnId, this, cwd, model, signal)
    this.remote = attachment.thread
    this.threadId = attachment.thread.id
    this.forkTurnId = undefined
    this.selectedModel = attachment.model
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
    if (active.remoteTurnId !== undefined && active.remoteTurnId !== remoteTurnId) {
      throw new Error('embedded-codex: App Server referenced conflicting active turns')
    }
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
    const callId = ToolCallId(`codex:${itemId}`)
    const record: ToolRecord = {
      itemId,
      index: active.nextBlockIndex++,
      kind: 'tool-call',
      callId,
      name: descriptor.name,
      arguments: descriptor.arguments,
      step: active.localStep,
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
    if (active.blocks.some(block => block.kind === 'tool-call')) this.advanceCompatibilityStep(active)
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
    if (record === undefined) return
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

  private advanceCompatibilityStep(active: ActiveTurn): void {
    this.closeOpenBlocks(active)
    this.appendChunk(active, { type: 'finish', reason: { kind: 'tool-calls' } })
    const model = active.actualModel
    if (model === undefined) throw new Error('embedded-codex: tool step completed before model selection')
    this.session.append('assistant/message', {
      turn: active.localTurn,
      step: active.localStep,
      message: createAssistantMessage({
        content: assistantContent(active.blocks),
        source: { provider: this.providerName, model },
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [...active.chunkSeqs] })
    this.session.append('step/end', { turn: active.localTurn, step: active.localStep })
    active.localStep += 1
    active.blocks.length = 0
    active.chunkSeqs.length = 0
    active.nextBlockIndex = 0
    this.session.append('step/start', { turn: active.localTurn, step: active.localStep })
  }

  private appendChunk(active: ActiveTurn, chunk: StreamChunk): void {
    const event = this.session.append('assistant/chunk', {
      turn: active.localTurn,
      step: active.localStep,
      chunk,
    })
    active.chunkSeqs.push(event.seq)
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
      const messages = this.inbox.claim('next-step', active.localTurn)
      if (messages.length === 0) return
      for (const message of messages) this.session.append('user/message', message, { surfaceOp: 'append' })
      const input = await messageInputs(this.ctx, messages, this.phase.abort.signal)
      await this.remote.steer(active.remoteTurnId, input, this.phase.abort.signal)
      if (this.inbox.nextStep.length > 0) this.scheduleSteering()
    }).catch((error: unknown) => {
      active.steerError = error instanceof Error ? error : new Error(String(error))
      if (active.remoteTurnId !== undefined) this.remote?.interrupt(active.remoteTurnId)
    })
  }

  private async waitForSteering(active: ActiveTurn): Promise<void> {
    let observed: Promise<void>
    do {
      await (observed = active.steerTask)
    } while (observed !== active.steerTask)
  }
}
