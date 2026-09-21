import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { AttachmentIdType, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, freezeMessage, LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset, SessionPreparation } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import {
  SubprocessRuntime,
  type SubprocessHandle,
  type SubprocessOutcome,
  type SubprocessSpawnSpec,
  type SubprocessTerminalHandle,
  type SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AgentRegistry from '../src/compat/providers/agent-registry.ts'
import EmbeddedCodexRuntime from '../src/index.ts'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

class FakeAppServer {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly requests: JsonObject[] = []
  readonly done = Promise.withResolvers<SubprocessOutcome>()
  readonly turnStarted = Promise.withResolvers<undefined>()
  readonly turnSteered = Promise.withResolvers<undefined>()
  readonly handle: SubprocessHandle
  holdTurn = false
  malformedCompletion = false
  threadReviewerOverride: string | undefined
  threadSandboxOverride: JsonObject | undefined
  private buffer = ''
  private turn = 0
  private settled = false
  private nextServerRequestId = 1_000
  private readonly serverRequests = new Map<number, PromiseWithResolvers<unknown>>()

  constructor() {
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk: string) => { this.receive(chunk) })
    this.handle = {
      pid: 321,
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: undefined,
      collected: {
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
      done: this.done.promise,
      terminate: () => { this.exit() },
      waitForExit: async () => {
        await this.done.promise
        return true
      },
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) return
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length === 0) continue
      const message: unknown = JSON.parse(line)
      if (!isObject(message)) throw new Error('fake App Server received a non-object message')
      this.requests.push(message)
      if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
        const pending = this.serverRequests.get(message.id)
        if (pending === undefined) throw new Error(`fake App Server received an unknown response id ${String(message.id)}`)
        this.serverRequests.delete(message.id)
        if (isObject(message.error)) pending.reject(new Error(String(message.error.message)))
        else pending.resolve(message.result)
        continue
      }
      if ((typeof message.id === 'number' || typeof message.id === 'string') && typeof message.method === 'string') {
        this.request(message.id, message.method, message.params)
      }
    }
  }

  private request(id: number | string, method: string, params: unknown): void {
    switch (method) {
      case 'initialize':
        this.respond(id, {
          userAgent: 'codex-cli-test',
          codexHome: 'C:\\codex-test',
          platformFamily: 'windows',
          platformOs: 'windows',
        })
        return
      case 'account/read':
        this.respond(id, {
          account: { type: 'chatgpt', email: 'test@example.invalid', planType: 'plus' },
          requiresOpenaiAuth: true,
        })
        return
      case 'model/list':
        this.respond(id, {
          data: [{
            id: 'gpt-test',
            displayName: 'GPT Test',
            description: 'Fixture model',
            inputModalities: ['text', 'image'],
            supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }],
            defaultReasoningEffort: 'medium',
            isDefault: true,
          }],
          nextCursor: null,
        })
        return
      case 'thread/start':
      case 'thread/resume':
        this.respond(id, {
          thread: { id: 'thread-fixture', ephemeral: false },
          model: 'gpt-test',
          ...this.threadPermission(params),
        })
        return
      case 'thread/fork':
        this.respond(id, {
          thread: { id: 'thread-forked', ephemeral: false },
          model: 'gpt-test',
          ...this.threadPermission(params),
        })
        return
      case 'turn/start': {
        this.turn += 1
        const turnId = `turn-${this.turn}`
        this.respond(id, { turn: { id: turnId } })
        queueMicrotask(() => {
          if (this.holdTurn) this.startHeldTurn(turnId, params)
          else this.completeTurn(turnId, params)
        })
        return
      }
      case 'turn/steer':
        this.respond(id, {})
        this.turnSteered.resolve(undefined)
        return
      case 'turn/interrupt':
        this.respond(id, {})
        return
      default:
        this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `unsupported ${method}` } })
    }
  }

  private threadPermission(params: unknown): JsonObject {
    if (!isObject(params) || typeof params.cwd !== 'string') {
      throw new Error('fixture thread request has no cwd')
    }
    const sandbox = params.sandbox === 'danger-full-access'
      ? { type: 'dangerFullAccess' }
      : params.sandbox === 'read-only'
        ? { type: 'readOnly', networkAccess: false }
        : {
            type: 'workspaceWrite',
            writableRoots: [params.cwd],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
          }
    return {
      approvalPolicy: params.approvalPolicy,
      approvalsReviewer: this.threadReviewerOverride ?? params.approvalsReviewer,
      sandbox: this.threadSandboxOverride ?? sandbox,
    }
  }

  private completeTurn(turnId: string, params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== 'string') throw new Error('fixture turn did not use a durable thread')
    const threadId = params.threadId
    this.notify('turn/started', { threadId, turn: { id: turnId } })
    this.turnStarted.resolve(undefined)
    if (this.malformedCompletion) {
      this.notify('turn/completed', {
        threadId,
        turn: { id: 0, status: 'completed', error: null },
      })
      return
    }
    this.notify('item/started', {
      threadId,
      turnId,
      item: { type: 'reasoning', id: 'reasoning-1', summary: [], content: [] },
    })
    this.notify('item/reasoning/summaryTextDelta', {
      threadId,
      turnId,
      itemId: 'reasoning-1',
      delta: 'Checking the fixture.',
    })
    this.notify('item/completed', {
      threadId,
      turnId,
      item: { type: 'reasoning', id: 'reasoning-1', summary: ['Checking the fixture.'], content: [] },
    })
    for (const index of [1, 2, 3]) {
      this.notify('item/started', {
        threadId,
        turnId,
        item: {
          type: 'commandExecution',
          id: `command-${index}`,
          command: `echo fixture-${index}`,
          cwd: 'D:\\fixture',
          source: 'agent',
          status: 'inProgress',
        },
      })
      this.notify('item/completed', {
        threadId,
        turnId,
        item: {
          type: 'commandExecution',
          id: `command-${index}`,
          command: `echo fixture-${index}`,
          cwd: 'D:\\fixture',
          source: 'agent',
          status: 'completed',
          aggregatedOutput: `fixture-${index}\n`,
          exitCode: 0,
          durationMs: 1,
        },
      })
    }
    this.notify('item/started', {
      threadId,
      turnId,
      item: { type: 'agentMessage', id: 'answer-1', text: '', phase: 'final_answer' },
    })
    this.notify('item/agentMessage/delta', {
      threadId,
      turnId,
      itemId: 'answer-1',
      delta: 'Codex answer',
    })
    this.notify('item/completed', {
      threadId,
      turnId,
      item: { type: 'agentMessage', id: 'answer-1', text: 'Codex answer', phase: 'final_answer' },
    })
    this.notify('thread/tokenUsage/updated', {
      threadId,
      turnId,
      tokenUsage: {
        last: {
          totalTokens: 18,
          inputTokens: 12,
          cachedInputTokens: 4,
          cacheWriteInputTokens: 1,
          outputTokens: 6,
          reasoningOutputTokens: 2,
        },
      },
    })
    this.notify('turn/completed', {
      threadId,
      turn: { id: turnId, status: 'completed', error: null },
    })
  }

  private startHeldTurn(turnId: string, params: unknown): void {
    if (!isObject(params) || typeof params.threadId !== 'string') throw new Error('fixture turn did not use a durable thread')
    this.notify('turn/started', { threadId: params.threadId, turn: { id: turnId } })
    this.turnStarted.resolve(undefined)
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result })
  }

  private notify(method: string, params: JsonObject): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  private write(message: JsonObject): void {
    this.stdout.write(`${JSON.stringify(message)}\n`)
  }

  requestAgent(method: string, params: JsonObject): Promise<unknown> {
    const id = this.nextServerRequestId++
    const pending = Promise.withResolvers<unknown>()
    this.serverRequests.set(id, pending)
    this.write({ jsonrpc: '2.0', id, method, params })
    return pending.promise
  }

  exit(): void {
    if (this.settled) return
    this.settled = true
    this.stdout.end()
    this.done.resolve({ exitCode: 0, signal: null })
  }
}

class FakeSubprocessRuntime extends SubprocessRuntime {
  readonly server = new FakeAppServer()

  async resolveExecutable(command: string): Promise<string> {
    return command
  }

  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
    return this.server.handle
  }

  async spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    throw new Error('terminal spawning is outside this fixture')
  }
}

const contexts: Context[] = []
const permissionModes = new WeakMap<Context, { current: string }>()

function setPermissionMode(ctx: Context, current: string): void {
  const state = permissionModes.get(ctx)
  if (state === undefined) throw new Error('runtime fixture has no permission state')
  state.current = current
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(FakeSubprocessRuntime)
  ctx.provide('agentPresets', { registerRoot: () => () => undefined } as never)
  const permission = { current: 'ask-for-approval' }
  permissionModes.set(ctx, permission)
  ctx.provide('permissionPresets', { current: () => permission.current } as never)
  await ctx.plugin(EmbeddedCodexRuntime, { processCwd: process.cwd() })
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('embedded Codex runtime', () => {
  it('keeps ctx.llm as a native model directory without exposing generation', async () => {
    const ctx = await harness()

    await expect(ctx.llm.listModels('codex')).resolves.toMatchObject([
      { provider: 'codex', id: 'default', name: 'Codex default' },
      { provider: 'codex', id: 'gpt-test', name: 'GPT Test' },
    ])
    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'codex',
      model: 'default',
      messages: [],
    })) chunks.push(chunk)
    expect(chunks).toMatchObject([{
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'CODEX_RUNTIME_ONLY' } },
    }])
  })

  it('rejects a foreign provider before publishing an Agent', async () => {
    const ctx = await harness()

    await expect(ctx.agents.create({
      sessionId: SessionId('embedded-codex-foreign-provider'),
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })).rejects.toThrow('serves only provider "codex"')
    expect(ctx.agents.get(SessionId('embedded-codex-foreign-provider'))).toBeUndefined()
  })

  it('sends the current Session permission on thread attach and every new turn', async () => {
    const ctx = await harness()
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-permissions'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    const send = async (text: string): Promise<void> => {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
    }

    await send('Ask first')
    setPermissionMode(ctx, 'approve-for-me')
    await send('Review the second turn')
    setPermissionMode(ctx, 'danger-full-access')
    await send('Run the third turn')

    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    const thread = server.requests.find(request => request.method === 'thread/start')
    expect(thread?.params).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    })
    const turns = server.requests.filter(request => request.method === 'turn/start')
    expect(turns.map(request => request.params)).toMatchObject([
      {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [process.cwd()], networkAccess: false },
      },
      {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [process.cwd()], networkAccess: false },
      },
      {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    ])
    await handle.dispose()
  })

  it('fails closed before native attachment for a non-Codex permission selection', async () => {
    const ctx = await harness()
    setPermissionMode(ctx, 'custom')
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-custom-permission'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Do not run' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    expect(server.requests.some(request => request.method === 'thread/start')).toBe(false)
    expect(server.requests.some(request => request.method === 'turn/start')).toBe(false)
    expect(handle.agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'CODEX_APP_SERVER' } } },
    })
    await handle.dispose()
  })

  it('rejects a thread response that changes the selected reviewer', async () => {
    const ctx = await harness()
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.threadReviewerOverride = 'auto_review'
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-rewritten-permission'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Do not widen' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    expect(server.requests.some(request => request.method === 'turn/start')).toBe(false)
    expect(handle.agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { message: expect.stringContaining('approval reviewer') } } },
    })
    await handle.dispose()
  })

  it('rejects a thread response that widens the writable roots', async () => {
    const ctx = await harness()
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.threadSandboxOverride = {
      type: 'workspaceWrite',
      writableRoots: [process.cwd(), resolve(process.cwd(), '..')],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    }
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-widened-roots'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Stay here' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    expect(server.requests.some(request => request.method === 'turn/start')).toBe(false)
    expect(handle.agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { message: expect.stringContaining('writable roots') } } },
    })
    await handle.dispose()
  })

  it('runs pre-step rewrites before persisting and sending text and image input', async () => {
    const ctx = await harness()
    const image: ImageAttachmentRef = {
      attachmentId: 'pre-step-image' as AttachmentIdType,
      mediaType: 'image/png',
      bytes: 3,
      width: 2,
      height: 1,
      name: 'clipboard.png',
    }
    const readImage = vi.fn(async () => ({ ref: image, data: Uint8Array.of(1, 2, 3) }))
    ctx.provide('attachments', {
      imageHostPath: () => undefined,
      readImage,
    } as never)
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const direct = decision.messages.map(message => freezeMessage({
        ...message,
        content: message.content.map(block => block.type === 'text'
          ? { type: 'text' as const, text: block.text.replace('dsh-context:v1:fixture', '@当前选区 · package.json') }
          : block),
      }))
      const context = createUserMessage({
        content: [
          { type: 'text', text: 'package.json, line 11, columns 1-71\nselected text' },
          { type: 'image', attachment: image },
        ],
        source: {
          kind: 'context-picker',
          form: 'recall',
          version: 1,
          references: [],
        } as never,
      })
      return { ...decision, messages: [...direct, context] }
    }, { prepend: true })
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-pre-step'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'inspect dsh-context:v1:fixture' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    const request = server.requests.find(candidate => candidate.method === 'turn/start')
    expect(request?.params).toMatchObject({
      input: [
        { type: 'text', text: 'inspect @当前选区 · package.json' },
        { type: 'text', text: 'package.json, line 11, columns 1-71\nselected text' },
        { type: 'image', url: 'data:image/png;base64,AQID' },
      ],
    })
    expect(readImage).toHaveBeenCalledOnce()
    const messages = handle.agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(messages).toHaveLength(2)
    expect(messages[0]?.data.content).toEqual([{ type: 'text', text: 'inspect @当前选区 · package.json' }])
    expect(messages[1]?.data).toMatchObject({
      source: { kind: 'context-picker' },
      content: [
        { type: 'text', text: 'package.json, line 11, columns 1-71\nselected text' },
        { type: 'image', attachment: image },
      ],
    })
    expect(JSON.stringify(messages)).not.toContain('dsh-context:v1:fixture')
    await handle.dispose()
  })

  it('keeps direct pasted images on the existing local-image path', async () => {
    const ctx = await harness()
    const image: ImageAttachmentRef = {
      attachmentId: 'direct-image' as AttachmentIdType,
      mediaType: 'image/png',
      bytes: 3,
      width: 2,
      height: 1,
      name: 'pasted.png',
    }
    const imageHostPath = vi.fn(() => 'D:\\attachments\\direct-image.png')
    const readImage = vi.fn()
    ctx.provide('attachments', { imageHostPath, readImage } as never)
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-direct-image'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })

    handle.agent.followup(createUserMessage({
      content: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'image', attachment: image },
      ],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    const request = server.requests.find(candidate => candidate.method === 'turn/start')
    expect(request?.params).toMatchObject({
      input: [
        { type: 'text', text: 'What is in this image?' },
        { type: 'localImage', path: 'D:\\attachments\\direct-image.png' },
      ],
    })
    expect(imageHostPath).toHaveBeenCalledWith(image)
    expect(readImage).not.toHaveBeenCalled()
    await handle.dispose()
  })

  it('closes rejected and empty initial pre-step decisions without starting Codex', async () => {
    for (const [suffix, decision, reason] of [
      ['rejected', { kind: 'reject' as const }, { kind: 'blocked' as const }],
      ['empty', { kind: 'enter' as const, messages: [] }, { kind: 'completed' as const }],
    ] as const) {
      const ctx = await harness()
      ctx.on('agent/pre-step', async () => decision)
      const handle = await ctx.agents.create({
        sessionId: SessionId(`embedded-codex-${suffix}`),
        agentOptions: { provider: 'codex', model: 'default' },
        meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
      })

      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'Do not dispatch' }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()

      const server = (ctx.subprocess as FakeSubprocessRuntime).server
      expect(server.requests.some(request => request.method === 'turn/start')).toBe(false)
      const events = handle.agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/start' || event.type === 'turn/end')).toMatchObject([
        { type: 'turn/start' },
        { type: 'turn/end', data: { reason } },
      ])
      expect(events.some(event => event.type === 'step/start' || event.type === 'user/message')).toBe(false)
      await handle.dispose()
    }
  })

  it('runs pre-step for live steering and sends only the admitted rewrite', async () => {
    const ctx = await harness()
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || !messages.some(message => message.content.some(block =>
        block.type === 'text' && block.text === 'raw steering'))) return decision
      return {
        ...decision,
        startsRequestSeries: true,
        messages: [
          freezeMessage({ ...messages[0]!, content: [{ type: 'text', text: 'rewritten steering' }] }),
          createUserMessage({
            content: [{ type: 'text', text: 'steering context' }],
            source: { kind: 'plugin', plugin: 'pre-step-fixture' },
          }),
        ],
      }
    })
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.holdTurn = true
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-steering-pre-step'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Keep working' }],
      source: { kind: 'user' },
    }))
    await server.turnStarted.promise

    handle.agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'raw steering' }],
      source: { kind: 'user' },
    }))
    await server.turnSteered.promise

    const steering = server.requests.find(request => request.method === 'turn/steer')
    expect(steering?.params).toMatchObject({
      expectedTurnId: 'turn-1',
      input: [
        { type: 'text', text: 'rewritten steering' },
        { type: 'text', text: 'steering context' },
      ],
    })
    const messages = handle.agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(messages.map(event => event.data.content)).toEqual([
      [{ type: 'text', text: 'Keep working' }],
      [{ type: 'text', text: 'rewritten steering' }],
      [{ type: 'text', text: 'steering context' }],
    ])
    expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'request/header')
      .map(event => event.data.reason)).toEqual(['initial', 'series'])

    handle.agent.cancel({ kind: 'user' })
    await handle.agent.whenIdle()
    await handle.dispose()
  })

  it('suppresses rejected live steering without recording or sending it', async () => {
    const ctx = await harness()
    const rejected = Promise.withResolvers<undefined>()
    ctx.on('agent/pre-step', async ({ messages }, next) => {
      if (!messages.some(message => message.content.some(block =>
        block.type === 'text' && block.text === 'blocked steering'))) return next()
      rejected.resolve(undefined)
      return { kind: 'reject' }
    })
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.holdTurn = true
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-rejected-steering'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Keep working' }],
      source: { kind: 'user' },
    }))
    await server.turnStarted.promise
    handle.agent.steer(createUserMessage({
      content: [{ type: 'text', text: 'blocked steering' }],
      source: { kind: 'user' },
    }))
    await rejected.promise

    handle.agent.cancel({ kind: 'user' })
    await handle.agent.whenIdle()
    expect(server.requests.some(request => request.method === 'turn/steer')).toBe(false)
    const entered = handle.agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(JSON.stringify(entered)).not.toContain('blocked steering')
    await handle.dispose()
  })

  it('projects a native turn, tool items, and disjoint token usage into standard DSH events', async () => {
    const ctx = await harness()
    const execute = vi.spyOn(ctx.tools, 'execute')
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-fixture'),
      agentOptions: { provider: 'codex', model: 'default', reasoningEffort: ReasoningEffortId('medium') },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })

    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Run the fixture' }],
      source: { kind: 'user' },
    }))
    await handle.agent.whenIdle()

    const events = handle.agent.session.snapshotEvents()
    const calls = events.filter(event => event.type === 'tool/call')
    expect(calls).toHaveLength(3)
    expect(calls[0]?.data).toMatchObject({
      turn: 1,
      step: 1,
      name: 'codex.command',
    })
    expect(calls[0]?.data.arguments).toContain('echo fixture-1')
    const results = events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(3)
    expect(results[0]?.data).toMatchObject({
      turn: 1,
      step: 1,
      message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'fixture-1\n' }], isError: false }] },
    })
    const orderedTypes = new Set([
      'turn/start', 'step/start', 'user/message', 'request/header', 'tool/call',
      'tool/result', 'assistant/message', 'step/end', 'turn/end',
    ])
    expect(events.flatMap(event => orderedTypes.has(event.type) ? [event.type] : [])).toEqual([
      'turn/start', 'step/start', 'user/message', 'request/header', 'tool/call',
      'tool/result', 'tool/call', 'tool/result', 'tool/call', 'tool/result',
      'assistant/message', 'step/end', 'step/start',
      'assistant/message', 'step/end', 'turn/end',
    ])
    const messages = events.filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(2)
    expect(messages[0]?.data).toMatchObject({
      turn: 1,
      step: 1,
      message: {
        content: [
          { type: 'reasoning', text: 'Checking the fixture.' },
          { type: 'tool-call', id: 'codex:command-1', name: 'codex.command' },
          { type: 'tool-call', id: 'codex:command-2', name: 'codex.command' },
          { type: 'tool-call', id: 'codex:command-3', name: 'codex.command' },
        ],
        source: { provider: 'codex', model: 'gpt-test' },
      },
    })
    const processToolIds = messages[0]?.data.message.content.flatMap(block =>
      block.type === 'tool-call' ? [block.id] : []) ?? []
    expect(processToolIds).toEqual(calls.map(call => call.data.callId))
    expect(results.map(result => result.data.message.source.callId)).toEqual(processToolIds)
    const firstToolBlock = messages[0]?.data.message.content[1]
    expect(firstToolBlock?.type).toBe('tool-call')
    if (firstToolBlock?.type !== 'tool-call') throw new Error('fixture did not project its first tool call')
    expect(firstToolBlock.arguments).toContain('echo fixture-1')
    expect(messages[1]?.data).toMatchObject({
      turn: 1,
      step: 2,
      usage: {
        inputTokens: 7,
        cacheReadTokens: 4,
        cacheWriteTokens: 1,
        outputTokens: 6,
        reasoningTokens: 2,
        totalTokens: 18,
      },
      message: {
        content: [{ type: 'text', text: 'Codex answer' }],
        source: {
          provider: 'codex',
          model: 'gpt-test',
          replayState: { embeddedCodex: { version: 1, threadId: 'thread-fixture', turnId: 'turn-1' } },
        },
      },
    })
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(execute).not.toHaveBeenCalled()

    await handle.dispose()
    expect(ctx.agents.get(SessionId('embedded-codex-fixture'))).toBeUndefined()
  })

  it('forks the native thread through the inherited DSH boundary', async () => {
    const ctx = await harness()
    setPermissionMode(ctx, 'approve-for-me')
    const parent = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-parent'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    parent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Parent' }], source: { kind: 'user' } }))
    await parent.agent.whenIdle()
    const seed = parent.agent.session.snapshotEvents()

    const child = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-child'),
      seed,
      inheritedEventCount: SessionLogOffset(seed.length),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: {
        cwd: process.cwd(),
        parentSession: parent.agent.session.id,
        isSeeded: true,
        agentPreset: 'embedded-codex',
      },
    })
    child.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Child' }], source: { kind: 'user' } }))
    await child.agent.whenIdle()

    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    const fork = server.requests.find(request => request.method === 'thread/fork')
    expect(fork?.params).toMatchObject({
      threadId: 'thread-fixture',
      lastTurnId: 'turn-1',
      ephemeral: false,
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    })
    const childAnswer = child.agent.session.snapshotEvents().findLast(event => event.type === 'assistant/message')
    expect(childAnswer?.type === 'assistant/message' ? childAnswer.data.message.source.replayState : undefined)
      .toEqual({ embeddedCodex: { version: 1, threadId: 'thread-forked', turnId: 'turn-2' } })

    await child.dispose()
    await parent.dispose()
  })

  it('restores the exact permission mode while resuming a native thread', async () => {
    const ctx = await harness()
    setPermissionMode(ctx, 'approve-for-me')
    const sessionId = SessionId('embedded-codex-resume')
    const original = await ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    original.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Persist this thread' }],
      source: { kind: 'user' },
    }))
    await original.agent.whenIdle()
    const seed = original.agent.session.snapshotEvents()
    const header = original.agent.session.header
    const inheritedEventCount = original.agent.session.inheritedEventCount
    await original.dispose()

    ctx.provide('sessionPersistence', {
      prepare: (requestedId: typeof sessionId) => {
        expect(requestedId).toBe(sessionId)
        return SessionPreparation.create(ctx.sessions.prepare(requestedId, {
          seedSource: 'persistence',
          seed,
          meta: header,
          inheritedEventCount,
        }))
      },
    } as never)
    const resumed = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentPreset: 'embedded-codex',
      agentOptions: { provider: 'codex', model: 'default' },
    })

    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    const resume = server.requests.find(request => request.method === 'thread/resume')
    expect(resume?.params).toMatchObject({
      threadId: 'thread-fixture',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: 'workspace-write',
    })
    await resumed.dispose()
  })

  it('ends the DSH turn when a native notification is malformed', async () => {
    const ctx = await harness()
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.malformedCompletion = true
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-invalid-event'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Malformed' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()

    expect(handle.agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'CODEX_APP_SERVER' } } },
    })
    const seed = handle.agent.session.snapshotEvents()
    await handle.dispose()

    await expect(ctx.agents.create({
      sessionId: SessionId('embedded-codex-invalid-seed'),
      seed,
      inheritedEventCount: SessionLogOffset(seed.length),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), isSeeded: true, agentPreset: 'embedded-codex' },
    })).rejects.toThrow('conversation history but no Codex thread binding')
  })

  it('settles cancellation without waiting for a native completion event', async () => {
    const ctx = await harness()
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.holdTurn = true
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-cancel'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })

    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Wait' }], source: { kind: 'user' } }))
    await server.turnStarted.promise
    handle.agent.cancel({ kind: 'user' })
    await handle.agent.whenIdle()

    expect(handle.agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
    expect(server.requests.some(request => request.method === 'turn/interrupt')).toBe(true)
    await handle.dispose()
  })

  it('fails closed when native approval requests arrive without a DSH approval service', async () => {
    const ctx = await harness()
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.holdTurn = true
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-no-approval-service'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Do not approve anything' }],
      source: { kind: 'user' },
    }))
    await server.turnStarted.promise

    await expect(server.requestAgent('item/commandExecution/requestApproval', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      itemId: 'approval-without-provider',
    })).resolves.toEqual({ decision: 'decline' })
    await expect(server.requestAgent('item/permissions/requestApproval', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      itemId: 'permissions-without-provider',
      permissions: { network: { enabled: true } },
    })).resolves.toEqual({ permissions: {}, scope: 'turn' })

    handle.agent.cancel({ kind: 'user' })
    await handle.agent.whenIdle()
    await handle.dispose()
  })

  it('bridges native approval and user-input requests through DSH interaction services', async () => {
    const ctx = await harness()
    const approval = { request: vi.fn((): Promise<string> => Promise.resolve('allowed-once')) }
    const questions = {
      ask: vi.fn(() => Promise.resolve({
        answers: [{ id: 'choice', selected: ['One'], custom: 'typed detail' }],
      })),
    }
    ctx.provide('approval', approval as never)
    ctx.provide('userQuestions', questions as never)
    const server = (ctx.subprocess as FakeSubprocessRuntime).server
    server.holdTurn = true
    const handle = await ctx.agents.create({
      sessionId: SessionId('embedded-codex-interactions'),
      agentOptions: { provider: 'codex', model: 'default' },
      meta: { cwd: process.cwd(), agentPreset: 'embedded-codex' },
    })
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Ask before acting' }],
      source: { kind: 'user' },
    }))
    await server.turnStarted.promise

    await expect(server.requestAgent('item/commandExecution/requestApproval', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      itemId: 'approval-1',
      reason: 'Needs permission',
    })).resolves.toEqual({ decision: 'accept' })
    const approvalRequest = approval.request.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(approvalRequest?.agent).toBe(handle.agent)
    expect(approvalRequest).toMatchObject({
      toolName: 'codex.command',
      callId: 'codex:approval-1',
      reason: 'Needs permission',
    })

    await expect(server.requestAgent('item/permissions/requestApproval', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      itemId: 'permission-1',
      reason: 'Needs network and files',
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['D:\\outside'] },
        unsupported: { ignored: true },
      },
    })).resolves.toEqual({
      permissions: {
        network: { enabled: true },
        fileSystem: { read: ['D:\\outside'] },
      },
      scope: 'turn',
    })

    approval.request.mockResolvedValueOnce('rejected')
    await expect(server.requestAgent('item/fileChange/requestApproval', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      itemId: 'approval-rejected',
    })).resolves.toEqual({ decision: 'decline' })
    approval.request.mockResolvedValueOnce('cancelled')
    await expect(server.requestAgent('item/commandExecution/requestApproval', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      itemId: 'approval-cancelled',
    })).resolves.toEqual({ decision: 'cancel' })

    await expect(server.requestAgent('item/tool/requestUserInput', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
      questions: [{
        id: 'choice',
        header: 'Choice',
        question: 'Pick one',
        options: [{ label: 'One', description: 'First option' }],
      }],
    })).resolves.toEqual({
      answers: { choice: { answers: ['One', 'typed detail'] } },
    })
    const questionRequest = questions.ask.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(questionRequest?.agent).toBe(handle.agent)
    expect(questionRequest).toMatchObject({
      questions: [{
        id: 'choice',
        header: 'Choice',
        question: 'Pick one',
        options: [{ label: 'One', description: 'First option' }],
      }],
    })

    await expect(server.requestAgent('mcpServer/elicitation/request', {
      threadId: 'thread-fixture',
      turnId: 'turn-1',
    })).resolves.toEqual({ action: 'decline', content: null, _meta: null })

    handle.agent.cancel({ kind: 'user' })
    await handle.agent.whenIdle()
    await handle.dispose()
  })
})
