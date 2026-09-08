/**
 * Managed official Codex app-server process and typed product operations.
 * @module dsh-embedded-codex/app-server
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { InitializeResponse } from '../protocol/InitializeResponse.ts'
import type { GetAccountResponse } from '../protocol/v2/GetAccountResponse.ts'
import type { ModelListResponse } from '../protocol/v2/ModelListResponse.ts'
import type { ThreadForkResponse } from '../protocol/v2/ThreadForkResponse.ts'
import type { ThreadResumeResponse } from '../protocol/v2/ThreadResumeResponse.ts'
import type { ThreadStartResponse } from '../protocol/v2/ThreadStartResponse.ts'
import type { TurnStartResponse } from '../protocol/v2/TurnStartResponse.ts'
import type { UserInput } from '../protocol/v2/UserInput.ts'

type JsonObject = Record<string, unknown>

interface CodexPackageManifest {
  readonly bin: { readonly codex: string }
}

const codexPackageJsonPath = createRequire(import.meta.url).resolve('@openai/codex/package.json')
const codexPackageManifest = JSON.parse(readFileSync(codexPackageJsonPath, 'utf8')) as CodexPackageManifest
const CODEX_PACKAGE_BIN = resolve(dirname(codexPackageJsonPath), codexPackageManifest.bin.codex)

/** App-server fields selected by the deployment profile. */
export interface AppServerConfig {
  readonly env: Record<string, string>
  readonly processCwd: string
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
  readonly requireChatgptLogin: boolean
  readonly approvalPolicy: 'on-request' | 'never'
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
}

/** Validated callback target for one attached Codex thread. */
export interface CodexThreadSink {
  /** Handle one server notification whose `threadId` belongs to this sink. */
  notify(method: string, params: JsonObject): void
  /** Answer one server request whose `threadId` belongs to this sink. */
  request(method: string, params: JsonObject): Promise<unknown>
}

/** Native model entry returned by the official App Server. */
export interface CodexModelCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly inputModalities: readonly ('text' | 'image')[]
  readonly efforts: readonly { readonly id: string; readonly description: string }[]
  readonly defaultEffort: string
  readonly isDefault: boolean
}

/** Result of creating or resuming one App Server thread. */
export interface CodexThreadAttachment {
  readonly thread: CodexRemoteThread
  readonly model: string
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

function asOptionalString(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return asString(value, label)
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`embedded-codex: App Server returned invalid ${label}`)
  }
  return value as string[]
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function outcomeMessage(outcome: SubprocessOutcome): string {
  return `embedded-codex: App Server exited (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`
}

/**
 * Fixed package-local command for the locked official Codex runtime.
 * @returns Node, the package-local Codex wrapper, and App Server arguments.
 */
export function codexAppServerArgv(): readonly string[] {
  return [process.execPath, CODEX_PACKAGE_BIN, 'app-server', '--stdio']
}

function parseModel(value: unknown): CodexModelCatalogEntry {
  const model = asObject(value, 'model/list model')
  const id = asString(model.id, 'model id')
  const supported = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.map((entry) => {
      const effort = asObject(entry, `model ${id} reasoning effort`)
      return {
        id: asString(effort.reasoningEffort, `model ${id} reasoning effort id`),
        description: typeof effort.description === 'string' ? effort.description : '',
      }
    })
    : (() => { throw new Error(`embedded-codex: App Server returned invalid model ${id} reasoning efforts`) })()
  const modalities = asStringArray(model.inputModalities, `model ${id} input modalities`)
    .filter((modality): modality is 'text' | 'image' => modality === 'text' || modality === 'image')
  if (typeof model.isDefault !== 'boolean') {
    throw new Error(`embedded-codex: App Server returned invalid model ${id} default flag`)
  }
  return {
    id,
    displayName: typeof model.displayName === 'string' && model.displayName.length > 0 ? model.displayName : id,
    description: typeof model.description === 'string' ? model.description : '',
    inputModalities: modalities,
    efforts: supported,
    defaultEffort: asString(model.defaultReasoningEffort, `model ${id} default reasoning effort`),
    isDefault: model.isDefault,
  }
}

class AppServerConnection {
  private readonly transport: JsonRpcLineTransport
  private readonly sinks = new Map<string, CodexThreadSink>()
  private closing = false
  private disposal: Promise<void> | undefined
  readonly dead: Promise<never>

  constructor(
    private readonly ctx: Context,
    private readonly child: SubprocessHandle,
    input: Readable,
    output: Writable,
  ) {
    this.transport = new JsonRpcLineTransport(input, output)
    this.transport.onNotification((method, params) => { this.routeNotification(method, params) })
    this.transport.onRequest((method, params) => this.routeRequest(method, params))
    this.transport.start()
    output.on('error', this.onOutputError)
    this.dead = child.done.then<never>(
      (outcome) => {
        this.closing = true
        throw new Error(outcomeMessage(outcome))
      },
      (error: unknown) => {
        this.closing = true
        throw thrown(error)
      },
    )
    void this.dead.catch(() => {})
  }

  get active(): boolean {
    return !this.closing
  }

  private readonly onOutputError = (): void => {
    // Child exit and stdout closure own failure settlement; this prevents a late EPIPE from escaping EventEmitter.
  }

  async initialize(config: AppServerConfig, signal?: AbortSignal): Promise<InitializeResponse> {
    const raw = asObject(await this.transport.request('initialize', {
      clientInfo: {
        name: 'deepseek-harness-embedded-codex',
        title: 'DeepSeek Harness',
        version: '0.1.2',
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }, signal), 'initialize response')
    asString(raw.userAgent, 'initialize userAgent')
    asString(raw.codexHome, 'initialize codexHome')
    asString(raw.platformFamily, 'initialize platformFamily')
    asString(raw.platformOs, 'initialize platformOs')
    this.transport.notify('initialized')
    await this.transport.flush()
    if (config.requireChatgptLogin) await this.assertChatgptAccount(signal)
    return raw as unknown as InitializeResponse
  }

  private async assertChatgptAccount(signal?: AbortSignal): Promise<void> {
    const raw = asObject(await this.transport.request('account/read', { refreshToken: false }, signal), 'account/read response')
    if (typeof raw.requiresOpenaiAuth !== 'boolean') {
      throw new Error('embedded-codex: App Server returned invalid account/read auth requirement')
    }
    if (raw.account === null) {
      throw new Error('embedded-codex: Codex is not signed in; run `codex login` with the ChatGPT account that owns the Codex subscription')
    }
    const account = asObject(raw.account, 'account/read account')
    if (account.type !== 'chatgpt') {
      throw new Error(`embedded-codex: expected a ChatGPT Codex login, received ${JSON.stringify(account.type)}`)
    }
    void (raw as unknown as GetAccountResponse)
  }

  async listModels(signal?: AbortSignal): Promise<readonly CodexModelCatalogEntry[]> {
    const output: CodexModelCatalogEntry[] = []
    let cursor: string | undefined
    do {
      const raw = asObject(await this.transport.request('model/list', {
        includeHidden: false,
        ...cursor === undefined ? {} : { cursor },
      }, signal), 'model/list response')
      if (!Array.isArray(raw.data)) throw new Error('embedded-codex: App Server returned invalid model/list data')
      output.push(...raw.data.map(parseModel))
      cursor = asOptionalString(raw.nextCursor, 'model/list cursor')
      void (raw as unknown as ModelListResponse)
    } while (cursor !== undefined)
    return output
  }

  async startThread(
    sink: CodexThreadSink,
    cwd: string,
    model: string | undefined,
    config: AppServerConfig,
    signal?: AbortSignal,
  ): Promise<CodexThreadAttachment> {
    const raw = asObject(await this.transport.request('thread/start', {
      cwd,
      ephemeral: false,
      approvalPolicy: config.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: config.sandbox,
      ...model === undefined ? {} : { model },
    }, signal), 'thread/start response')
    const thread = asObject(raw.thread, 'thread/start thread')
    const threadId = asString(thread.id, 'thread/start thread id')
    if (thread.ephemeral !== false) throw new Error('embedded-codex: App Server created an ephemeral main thread')
    const selectedModel = asString(raw.model, 'thread/start model')
    this.attach(threadId, sink)
    void (raw as unknown as ThreadStartResponse)
    return { thread: new CodexRemoteThread(this, threadId, sink), model: selectedModel }
  }

  async resumeThread(
    threadId: string,
    sink: CodexThreadSink,
    cwd: string,
    model: string | undefined,
    config: AppServerConfig,
    signal?: AbortSignal,
  ): Promise<CodexThreadAttachment> {
    const raw = asObject(await this.transport.request('thread/resume', {
      threadId,
      cwd,
      approvalPolicy: config.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: config.sandbox,
      ...model === undefined ? {} : { model },
    }, signal), 'thread/resume response')
    const thread = asObject(raw.thread, 'thread/resume thread')
    const returnedId = asString(thread.id, 'thread/resume thread id')
    if (returnedId !== threadId) throw new Error('embedded-codex: thread/resume returned another thread')
    const selectedModel = asString(raw.model, 'thread/resume model')
    this.attach(threadId, sink)
    void (raw as unknown as ThreadResumeResponse)
    return { thread: new CodexRemoteThread(this, threadId, sink), model: selectedModel }
  }

  async forkThread(
    sourceThreadId: string,
    lastTurnId: string,
    sink: CodexThreadSink,
    cwd: string,
    model: string | undefined,
    config: AppServerConfig,
    signal?: AbortSignal,
  ): Promise<CodexThreadAttachment> {
    const raw = asObject(await this.transport.request('thread/fork', {
      threadId: sourceThreadId,
      lastTurnId,
      cwd,
      ephemeral: false,
      approvalPolicy: config.approvalPolicy,
      approvalsReviewer: 'user',
      sandbox: config.sandbox,
      ...model === undefined ? {} : { model },
    }, signal), 'thread/fork response')
    const thread = asObject(raw.thread, 'thread/fork thread')
    const threadId = asString(thread.id, 'thread/fork thread id')
    if (threadId === sourceThreadId) throw new Error('embedded-codex: thread/fork reused its source thread')
    if (thread.ephemeral !== false) throw new Error('embedded-codex: App Server created an ephemeral fork')
    const selectedModel = asString(raw.model, 'thread/fork model')
    this.attach(threadId, sink)
    void (raw as unknown as ThreadForkResponse)
    return { thread: new CodexRemoteThread(this, threadId, sink), model: selectedModel }
  }

  async request(method: string, params: object, signal?: AbortSignal): Promise<unknown> {
    if (this.closing) throw new Error('embedded-codex: App Server connection is closed')
    return await Promise.race([this.transport.request(method, params, signal), this.dead])
  }

  detach(threadId: string, sink: CodexThreadSink): void {
    if (this.sinks.get(threadId) === sink) this.sinks.delete(threadId)
  }

  private attach(threadId: string, sink: CodexThreadSink): void {
    const existing = this.sinks.get(threadId)
    if (existing !== undefined && existing !== sink) {
      throw new Error(`embedded-codex: App Server thread ${JSON.stringify(threadId)} is already attached`)
    }
    this.sinks.set(threadId, sink)
  }

  private routeNotification(method: string, params: JsonObject): void {
    const threadId = typeof params.threadId === 'string' ? params.threadId : undefined
    if (threadId === undefined) return
    try {
      this.sinks.get(threadId)?.notify(method, params)
    } catch (error: unknown) {
      this.ctx.logger.warn(`embedded-codex: notification ${method} failed: ${thrown(error).message}`)
    }
  }

  private routeRequest(method: string, params: JsonObject): Promise<unknown> {
    const threadId = asString(params.threadId, `${method} thread id`)
    const sink = this.sinks.get(threadId)
    if (sink === undefined) {
      return Promise.reject(new Error(`embedded-codex: no live DSH agent owns App Server thread ${JSON.stringify(threadId)}`))
    }
    return sink.request(method, params)
  }

  dispose(): Promise<void> {
    return (this.disposal ??= this.disposeOnce())
  }

  private async disposeOnce(): Promise<void> {
    this.closing = true
    this.sinks.clear()
    this.transport.close()
    try {
      this.child.stdin?.end()
    } catch {
      // A concurrently closed protocol input does not change process-tree ownership.
    }
    this.child.terminate()
    await this.child.waitForExit()
    await this.child.done.catch(() => {})
    this.child.stdin?.off('error', this.onOutputError)
  }
}

/** One DSH agent's attachment to a native Codex thread on one process generation. */
export class CodexRemoteThread {
  private detached = false

  constructor(
    private readonly connection: AppServerConnection,
    readonly id: string,
    private readonly sink: CodexThreadSink,
  ) {}

  /** Whether this process generation can still accept requests. */
  get active(): boolean {
    return this.connection.active && !this.detached
  }

  /**
   * Start a native turn and return its validated identity.
   * @param input - Native input items for the turn.
   * @param clientUserMessageId - Optional DSH message identity for native correlation.
   * @param model - Explicit native model, or undefined to retain Codex defaults.
   * @param effort - Explicit native reasoning effort, or undefined to retain Codex defaults.
   * @param signal - Turn-start cancellation signal.
   * @returns The native turn id.
   */
  async startTurn(
    input: readonly UserInput[],
    clientUserMessageId: string | undefined,
    model: string | undefined,
    effort: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const raw = asObject(await this.connection.request('turn/start', {
      threadId: this.id,
      input,
      ...clientUserMessageId === undefined ? {} : { clientUserMessageId },
      ...model === undefined ? {} : { model },
      ...effort === undefined ? {} : { effort },
    }, signal), 'turn/start response')
    const turn = asObject(raw.turn, 'turn/start turn')
    void (raw as unknown as TurnStartResponse)
    return asString(turn.id, 'turn/start turn id')
  }

  /**
   * Send steering input to the exact active native turn.
   * @param turnId - Native turn that must still be active.
   * @param input - Native input items to append.
   * @param signal - Steering cancellation signal.
   */
  async steer(turnId: string, input: readonly UserInput[], signal: AbortSignal): Promise<void> {
    await this.connection.request('turn/steer', {
      threadId: this.id,
      expectedTurnId: turnId,
      input,
    }, signal)
  }

  /**
   * Request best-effort interruption of the exact active native turn.
   * @param turnId - Native turn to interrupt.
   */
  interrupt(turnId: string): void {
    void this.connection.request('turn/interrupt', { threadId: this.id, turnId }).catch(() => {})
  }

  /**
   * Reject a notification waiter when the owning App Server process exits.
   * @param pending - Notification-derived result awaited by the agent.
   * @param signal - Agent turn lifetime that cancels the wait.
   * @returns The result, unless process exit rejects first.
   */
  async waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    const aborted = Promise.withResolvers<never>()
    const onAbort = (): void => { aborted.reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await Promise.race([pending, this.connection.dead, aborted.promise])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** Detach routing without deleting or archiving the durable Codex thread. */
  dispose(): void {
    if (this.detached) return
    this.detached = true
    this.connection.detach(this.id, this.sink)
  }
}

/** Host-wide lazy process supervisor; one child serves every live DSH agent. */
export class CodexAppServerHost {
  private current: AppServerConnection | undefined
  private starting: Promise<AppServerConnection> | undefined
  private disposing = false

  constructor(
    private readonly ctx: Context,
    private readonly config: AppServerConfig,
  ) {}

  /**
   * Query the current account-scoped Codex model catalog.
   * @param signal - Optional request cancellation signal.
   * @returns Visible native model metadata.
   */
  async listModels(signal?: AbortSignal): Promise<readonly CodexModelCatalogEntry[]> {
    return await (await this.connection(signal)).listModels(signal)
  }

  /**
   * Create a durable native thread for a fresh DSH session.
   * @param sink - Agent that owns native notifications and requests.
   * @param cwd - Workspace directory for the native thread.
   * @param model - Explicit native model, or undefined to retain Codex defaults.
   * @param signal - Optional setup cancellation signal.
   * @returns The attached native thread and selected model.
   */
  async startThread(
    sink: CodexThreadSink,
    cwd: string,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<CodexThreadAttachment> {
    return await (await this.connection(signal)).startThread(sink, cwd, model, this.config, signal)
  }

  /**
   * Reattach a persisted DSH session to its durable native thread.
   * @param threadId - Persisted native thread id.
   * @param sink - Agent that owns native notifications and requests.
   * @param cwd - Workspace directory for the native thread.
   * @param model - Explicit native model, or undefined to retain Codex defaults.
   * @param signal - Optional setup cancellation signal.
   * @returns The attached native thread and selected model.
   */
  async resumeThread(
    threadId: string,
    sink: CodexThreadSink,
    cwd: string,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<CodexThreadAttachment> {
    return await (await this.connection(signal)).resumeThread(threadId, sink, cwd, model, this.config, signal)
  }

  /**
   * Fork a persisted parent thread through the DSH fork boundary's native turn.
   * @param sourceThreadId - Native parent thread id.
   * @param lastTurnId - Native turn at the inherited DSH boundary.
   * @param sink - Agent that owns native notifications and requests.
   * @param cwd - Workspace directory for the native child thread.
   * @param model - Explicit native model, or undefined to retain Codex defaults.
   * @param signal - Optional setup cancellation signal.
   * @returns The attached native child thread and selected model.
   */
  async forkThread(
    sourceThreadId: string,
    lastTurnId: string,
    sink: CodexThreadSink,
    cwd: string,
    model: string | undefined,
    signal?: AbortSignal,
  ): Promise<CodexThreadAttachment> {
    return await (await this.connection(signal)).forkThread(
      sourceThreadId,
      lastTurnId,
      sink,
      cwd,
      model,
      this.config,
      signal,
    )
  }

  private async connection(signal?: AbortSignal): Promise<AppServerConnection> {
    if (this.disposing) throw new Error('embedded-codex: runtime is disposing')
    if (this.current?.active === true) return this.current
    if (this.starting !== undefined) return await this.starting
    const started = this.start(signal)
    this.starting = started
    try {
      return await started
    } finally {
      if (this.starting === started) this.starting = undefined
    }
  }

  private async start(signal?: AbortSignal): Promise<AppServerConnection> {
    signal?.throwIfAborted()
    const child = this.ctx.subprocess.spawn({
      argv: codexAppServerArgv(),
      cwd: this.config.processCwd,
      stdio: {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: { maxBytes: this.config.stderrMaxBytes },
      },
      graceMs: this.config.disposeGraceMs,
      env: this.config.env,
    })
    const connection = new AppServerConnection(
      this.ctx,
      child,
      child.stdout as NonNullable<SubprocessHandle['stdout']>,
      child.stdin as NonNullable<SubprocessHandle['stdin']>,
    )
    try {
      await connection.initialize(this.config, signal)
    } catch (error: unknown) {
      await connection.dispose()
      throw error
    }
    if (this.disposing) {
      await connection.dispose()
      throw new Error('embedded-codex: runtime disposed during App Server startup')
    }
    this.current = connection
    void connection.dead.catch(async (error: unknown) => {
      if (this.current === connection) this.current = undefined
      if (!this.disposing) {
        const stderr = child.collected.stderr?.readFrom(0).text.trim()
        this.ctx.logger.warn(`${thrown(error).message}${stderr ? `; stderr: ${stderr}` : ''}`)
      }
      await connection.dispose()
    })
    return connection
  }

  /** Close the shared protocol and wait for the complete process tree. */
  async dispose(): Promise<void> {
    if (this.disposing) return
    this.disposing = true
    const starting = this.starting
    if (starting !== undefined) await starting.catch(() => {})
    const current = this.current
    this.current = undefined
    await current?.dispose()
  }
}
