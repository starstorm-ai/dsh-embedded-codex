import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { readNativeHistory } from './runtime/history.ts'
import type { NativeTranscript } from './transcript.ts'
import { compatibilityManifest } from './compat/generated-manifest.ts'
import { codexPermissionProfile } from './permissions.ts'
/**
 * Codex App Server Agent Runtime and catalog-only LLM adapter for DSH.
 * @module dsh-embedded-codex
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  type Agent,
  type AgentFactory,
  type AgentHandle,
  type AgentOptions,
  type AgentSetup,
  type CreateAgentOptions,
  type ResumeAgentOptions,
  type SessionStartSource,
  type TurnBoundaryProjection,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { interruptedTurnClosers, SessionLogOffset, SessionPreparation, SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import type { SessionHandle } from '@deepseek-ai/dsh-session-persistence'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { CodexAppServerHost, type AppServerConfig } from './app-server.ts'
import { EmbeddedCodexAgent } from './agent.ts'
import { CodexCatalogAdapter } from './catalog.ts'
import { cleanupAll, rollbackFailure } from './runtime/cleanup.ts'
import { nativeBindingProjection } from './runtime/binding.ts'
import {
  resolveCodexPermission,
  resolveLegacyCodexPermission,
  type ResolvedCodexPermission,
} from './permissions.ts'

export { CodexAppServerHost, CodexRemoteThread, codexAppServerArgv } from './app-server.ts'
export type {
  AppServerConfig,
  CodexModelCatalogEntry,
  CodexThreadAttachment,
  CodexThreadSink,
} from './app-server.ts'
export { EmbeddedCodexAgent } from './agent.ts'
export { CodexCatalogAdapter } from './catalog.ts'
export {
  CODEX_PERMISSION_MODES,
  resolveCodexPermission,
  resolveLegacyCodexPermission,
} from './permissions.ts'
export type { CodexPermissionMode, ResolvedCodexPermission } from './permissions.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    embeddedCodex: EmbeddedCodexRuntime
  }
}

/** Deployment-owned runtime, model-directory, authentication, and child-process settings. */
export interface Config {
  /** Provider route exposed to existing DSH model selectors. */
  providerName?: string
  /** Human-readable provider name exposed to existing DSH model selectors. */
  providerDisplayName?: string
  /** Alias that preserves the model selected by Codex account settings. */
  defaultModelAlias?: string
  /** Require managed ChatGPT authentication and reject API-key-backed Codex sessions. */
  requireChatgptLogin?: boolean
  /** Explicit environment entries layered onto the subprocess provider's scrubbed parent environment. */
  env?: Record<string, string>
  /** Working directory of the shared App Server process; each thread still receives its own session cwd. */
  processCwd?: string
  /** @deprecated Fallback used only when no Permission Presets provider is composed. */
  approvalPolicy?: 'on-request' | 'never'
  /** @deprecated Fallback used only when no Permission Presets provider is composed. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  /** Grace in milliseconds for App Server process-tree termination. */
  disposeGraceMs?: number
  /** Maximum retained diagnostic stderr bytes for an exited App Server process. */
  stderrMaxBytes?: number
}

/** Default provider id exposed through `ctx.llm`. */
export const DEFAULT_PROVIDER_NAME = 'codex'
/** Shipped Agent preset that selects the embedded Codex Agent Runtime. */
export const EMBEDDED_CODEX_PRESET = 'embedded-codex'
/** Default model alias preserving the signed-in Codex configuration. */
export const DEFAULT_MODEL_ALIAS = 'default'
/** Default App Server process-tree termination grace. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000
/** Default retained App Server stderr tail. */
export const DEFAULT_STDERR_MAX_BYTES = 64 * 1024

/** Runtime configuration schema with every deployment-varying choice exposed. */
export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  providerDisplayName: z.string().min(1).default('Codex'),
  defaultModelAlias: z.string().min(1).default(DEFAULT_MODEL_ALIAS),
  requireChatgptLogin: z.boolean().default(true),
  env: z.dict(z.string()).default({}),
  processCwd: z.string().default(process.cwd()),
  approvalPolicy: z.union(['on-request', 'never'] as const).default('on-request'),
  sandbox: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('workspace-write'),
  disposeGraceMs: z.number().min(1).default(DEFAULT_DISPOSE_GRACE_MS),
  stderrMaxBytes: z.number().step(1).min(1).default(DEFAULT_STDERR_MAX_BYTES),
})

interface ResolvedConfig {
  readonly providerName: string
  readonly providerDisplayName: string
  readonly defaultModelAlias: string
  readonly requireChatgptLogin: boolean
  readonly env: Record<string, string>
  readonly processCwd: string
  readonly approvalPolicy: 'on-request' | 'never'
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly disposeGraceMs: number
  readonly stderrMaxBytes: number
}

interface StoredSession {
  readonly close: () => Promise<void>
  readonly handle: SessionHandle
  readonly eventCount: number
}

const turnBoundaryProjectionSchema: zod.ZodType<TurnBoundaryProjection> = zod.object({
  openTurnStartSeq: zod.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepStartSeq: zod.number().int().nonnegative().transform(SessionSeq).nullable(),
  lastStepBoundary: zod.object({
    kind: zod.union([zod.literal('start'), zod.literal('end')]),
    seq: zod.number().int().nonnegative().transform(SessionSeq),
  }).nullable(),
  lastTurn: zod.number().int().nonnegative(),
})

const REQUIRED_PROFILE_ENTRIES = [
  ...compatibilityManifest.providers.filter(p => p.id !== p.replacementId).map(p => [p.id, p.package, true] as const),
  ...compatibilityManifest.providers.map(p => [p.replacementId, p.entry, undefined] as const),
  ['preset-embedded-codex', '@deepseek-ai/dsh-agent-preset', undefined],
  ['embedded-codex', 'dsh-embedded-codex', undefined],
] as const

const REQUIRED_STOCK_PROFILE_ENTRIES = [
  ['agent-loop', '@deepseek-ai/dsh-agent-loop'],
  ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation'],
] as const

function assertProfileComposition(ctx: Context): void {
  const loader = ctx.get('loader')
  if (loader === undefined) return
  const entries = [...loader.entries()]
  for (const [id, name, expectedDisabled] of REQUIRED_PROFILE_ENTRIES) {
    const matches = entries.filter(entry => entry.options.id === id)
    if (matches.length !== 1) {
      throw new Error(`dsh-embedded-codex requires exactly one Profile entry ${JSON.stringify(id)}; found ${String(matches.length)}`)
    }
    const [entry] = matches
    if (entry === undefined || entry.options.name !== name || (expectedDisabled !== undefined && entry.disabled !== expectedDisabled)) {
      throw new Error(
        `dsh-embedded-codex found incompatible Profile entry ${JSON.stringify(id)}; expected name=${JSON.stringify(name)}${expectedDisabled === undefined ? '' : ` and disabled=${String(expectedDisabled)}`}; found name=${JSON.stringify(entry?.options.name)} and disabled=${String(entry?.disabled)}`,
      )
    }
  }
  for (const [id, name] of REQUIRED_STOCK_PROFILE_ENTRIES) {
    const matches = entries.filter(entry => entry.options.id === id)
    const [entry] = matches
    if (matches.length !== 1 || entry?.options.name !== name || entry.disabled === true) {
      throw new Error(`dsh-embedded-codex requires the stock Profile entry ${JSON.stringify(id)} to remain enabled`)
    }
  }
}

/** Turn-boundary projection shared with the default Agent loop. */
export const turnBoundaryProjectionDefinition = {
  key: 'turnBoundary',
  stateVersion: 2,
  stateSchema: turnBoundaryProjectionSchema,
  init: () => ({
    openTurnStartSeq: null,
    lastStepStartSeq: null,
    lastStepBoundary: null,
    lastTurn: 0,
  }),
  apply: (state, event) => {
    switch (event.type) {
      case 'turn/start':
        return { ...state, openTurnStartSeq: event.seq, lastTurn: event.data.turn }
      case 'turn/end':
        return { ...state, openTurnStartSeq: null }
      case 'step/start':
        return { ...state, lastStepStartSeq: event.seq, lastStepBoundary: { kind: 'start', seq: event.seq } }
      case 'step/end':
        return { ...state, lastStepBoundary: { kind: 'end', seq: event.seq } }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'turnBoundary', TurnBoundaryProjection>

function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    providerName: config.providerName ?? DEFAULT_PROVIDER_NAME,
    providerDisplayName: config.providerDisplayName ?? 'Codex',
    defaultModelAlias: config.defaultModelAlias ?? DEFAULT_MODEL_ALIAS,
    requireChatgptLogin: config.requireChatgptLogin ?? true,
    env: config.env ?? {},
    processCwd: config.processCwd ?? process.cwd(),
    approvalPolicy: config.approvalPolicy ?? 'on-request',
    sandbox: config.sandbox ?? 'workspace-write',
    disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS,
    stderrMaxBytes: config.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES,
  }
  if (!isAbsolute(resolved.processCwd)) throw new Error('embedded-codex: processCwd must be absolute')
  if (!Number.isFinite(resolved.disposeGraceMs) || resolved.disposeGraceMs <= 0) {
    throw new Error('embedded-codex: disposeGraceMs must be a positive finite number')
  }
  if (!Number.isSafeInteger(resolved.stderrMaxBytes) || resolved.stderrMaxBytes <= 0) {
    throw new Error('embedded-codex: stderrMaxBytes must be a positive safe integer')
  }
  return resolved
}

function normalizedOptions(config: ResolvedConfig, options: AgentOptions | undefined): AgentOptions {
  const provider = options?.provider ?? config.providerName
  if (provider !== config.providerName) {
    throw new Error(
      `embedded-codex: this Agent Runtime serves only provider ${JSON.stringify(config.providerName)}`,
    )
  }
  if (options?.maxTokens !== undefined) {
    throw new Error('embedded-codex: Codex App Server does not expose a per-turn maxTokens setting')
  }
  return {
    ...options,
    provider,
    model: options?.model ?? config.defaultModelAlias,
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`embedded-codex: setup aborted: ${String(signal.reason)}`)
}

async function raceAbort<T>(value: PromiseLike<T> | T, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal)
  const aborted = Promise.withResolvers<never>()
  const onAbort = (): void => { aborted.reject(abortError(signal)) }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([Promise.resolve(value), aborted.promise])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * `ctx.embeddedCodex`: shared App Server owner, Agent factory, and model catalog.
 */
export class EmbeddedCodexRuntime extends Service implements AgentFactory {
  static inject = [
    'agents',
    'sessions',
    'sessionProjections',
    'subprocess',
    'llm',
    'systemPrompt',
    'tools',
  ]
  static Config = Config

  /** Validated deployment configuration used by every created agent. */
  readonly config: ResolvedConfig
  /** Shared lazy owner of the official App Server process. */
  readonly appServer: CodexAppServerHost
  private readonly lifecycleAbort = new AbortController()
  private readonly live = new Set<() => Promise<void>>()
  private warnedPermissionFallback = false
  private disposing: Promise<void> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'embeddedCodex')
    assertProfileComposition(ctx)
    this.config = resolveConfig(config)
    const serverConfig: AppServerConfig = {
      env: this.config.env,
      processCwd: this.config.processCwd,
      disposeGraceMs: this.config.disposeGraceMs,
      stderrMaxBytes: this.config.stderrMaxBytes,
      requireChatgptLogin: this.config.requireChatgptLogin,
    }
    this.appServer = new CodexAppServerHost({ spawn: spec => ctx.subprocess.spawn(spec), warn: message => ctx.logger.warn(message) }, serverConfig)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    ctx.sessionProjections.register(nativeBindingProjection)
    ctx.llm.registerAdapter([this.config.providerName], new CodexCatalogAdapter(
      this.appServer,
      this.config.providerName,
      this.config.providerDisplayName,
      this.config.defaultModelAlias,
    ))
    ctx.agents.registerRuntime({
      id: 'codex', presetIds: [EMBEDDED_CODEX_PRESET], factory: this,
      defaultAgentOptions: { provider: this.config.providerName, model: this.config.defaultModelAlias },
      modelProviders: [this.config.providerName], permissions: codexPermissionProfile,
    })
    ctx.effect(() => () => this.disposeRuntime(), 'embeddedCodex.lifecycle()')
  }

  /** Reconcile only the completed native turns present in an authorized DSH observation. */
  async transcript(events: readonly SessionEvent[], signal?: AbortSignal): Promise<NativeTranscript[]> {
    return readNativeHistory(events, (threadId, turnId) => this.appServer.readItems(threadId, turnId, signal))
  }

  /**
   * Create and publish one App Server-backed agent.
   * @param ownerCtx - Calling Cordis scope that owns the Agent lifetime.
   * @param options - Fresh DSH Session and Agent setup options.
   * @returns The live Agent handle and disposer.
   */
  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const agentOptions = normalizedOptions(this.config, options.agentOptions)
    using preparation = SessionPreparation.create(this.ctx.sessions.prepare(options.sessionId, {
      ...options.seed === undefined ? {} : { seed: options.seed },
      meta: {
        ...options.meta,
        cwd: options.meta?.cwd ?? this.config.processCwd,
      },
      ...options.inheritedEventCount === undefined ? {} : { inheritedEventCount: options.inheritedEventCount },
    }))
    return await this.withStorageHandle(
      ownerCtx,
      options.signal,
      async signal => this.ctx.get('sessionPersistence')?.create(preparation.session.header, {
        inheritedEventCount: preparation.session.inheritedEventCount,
        signal,
      }),
      (handle, signal, close) => this.setupAndPublish(
        ownerCtx,
        preparation,
        agentOptions,
        options.setup,
        signal,
        options.parentAgent,
        'startup',
        false,
        handle === undefined ? undefined : { handle, close, eventCount: 0 },
      ),
    )
  }

  /**
   * Resume and publish one App Server-backed agent from DSH persistence.
   * @param ownerCtx - Calling Cordis scope that owns the Agent lifetime.
   * @param options - Persisted DSH Session and Agent setup options.
   * @returns The live Agent handle and disposer.
   */
  async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) {
      throw new Error('embedded-codex: cannot resume without a session-persistence provider')
    }
    const agentOptions = normalizedOptions(this.config, options.agentOptions)
    return await this.withStorageHandle(
      ownerCtx,
      options.signal,
      signal => persistence.open(options.resumeSessionId, 'write', { signal }),
      async (handle, signal, close) => {
        const restored = await raceAbort(handle.read(0, undefined, { signal }), signal)
        const closers = interruptedTurnClosers(restored.events)
        if (closers.length > 0) await raceAbort(handle.append(closers, { signal }), signal)
        using preparation = SessionPreparation.create(this.ctx.sessions.prepare(options.resumeSessionId, {
          seed: [...restored.events, ...closers],
          meta: structuredClone(handle.header),
          inheritedEventCount: handle.inheritedEventCount,
          eventState: restored.eventState,
        }))
        return await this.setupAndPublish(
          ownerCtx,
          preparation,
          agentOptions,
          options.setup,
          signal,
          options.parentAgent,
          'resume',
          true,
          { handle, close, eventCount: restored.events.length + closers.length },
        )
      },
    )
  }

  /** Acquire storage before publication; cancellation and failed setup release its write ownership. */
  private async withStorageHandle<T extends SessionHandle | undefined>(
    ownerCtx: Context,
    callerSignal: AbortSignal | undefined,
    acquire: (signal: AbortSignal) => Promise<T>,
    publish: (handle: T, signal: AbortSignal, close: () => Promise<void>) => Promise<AgentHandle>,
  ): Promise<AgentHandle> {
    ownerCtx.fiber.assertActive()
    const ownerAbort = new AbortController()
    let preparing = true
    const unfollowOwner = ownerCtx.effect(() => () => {
      if (preparing) ownerAbort.abort(new Error('embedded-codex: owner disposed during session preparation'))
    }, 'embeddedCodex.storagePreparation()')
    const signal = AbortSignal.any([
      this.lifecycleAbort.signal,
      ownerAbort.signal,
      ...callerSignal === undefined ? [] : [callerSignal],
    ])
    let owned: SessionHandle | undefined
    let closing: Promise<void> | undefined
    const close = (): Promise<void> => closing ??= Promise.resolve().then(() => owned?.close())
    try {
      signal.throwIfAborted()
      const pending = acquire(signal)
      let handle: T
      try {
        handle = await raceAbort(pending, signal)
      } catch (error: unknown) {
        // A backend can finish opening after cancellation has already won.
        if (signal.aborted) void pending.then(abandoned => abandoned?.close()).catch(error => {
          this.ctx.logger.warn('embedded-codex: delayed storage cleanup failed', error)
        })
        throw error
      }
      owned = handle
      return await publish(handle, signal, close)
    } catch (error: unknown) {
      return await rollbackFailure(error, close)
    } finally {
      preparing = false
      await unfollowOwner()
    }
  }

  private async setupAndPublish(
    ownerCtx: Context,
    preparation: SessionPreparation,
    options: AgentOptions,
    setup: AgentSetup | undefined,
    callerSignal: AbortSignal | undefined,
    parentAgent: Agent | undefined,
    source: SessionStartSource,
    resumeRemote: boolean,
    stored?: StoredSession,
  ): Promise<AgentHandle> {
    ownerCtx.fiber.assertActive()
    if (this.lifecycleAbort.signal.aborted) throw new Error('embedded-codex: runtime is not active')
    const ownerAbort = new AbortController()
    const signal = AbortSignal.any([
      this.lifecycleAbort.signal,
      ownerAbort.signal,
      ...callerSignal === undefined ? [] : [callerSignal],
    ])
    const session = preparation.session
    const lastTurn = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0
    let persistedCount = stored?.eventCount ?? 0
    let published = false
    const persistBinding = async (): Promise<void> => {
      if (stored === undefined) return
      if (published) { await agent.ctx.sessions.flush(session); return }
      const suffix = session.snapshotEvents(SessionLogOffset(persistedCount))
      if (suffix.length > 0) await stored.handle.append(suffix, { signal })
      persistedCount += suffix.length
    }
    const agent = new EmbeddedCodexAgent(
      this.ctx,
      this.appServer,
      this.config.providerName,
      this.config.defaultModelAlias,
      session.id,
      options,
      session,
      cwd => this.permissionFor(session, cwd),
      lastTurn,
      persistBinding,
    )
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let ownerEffect: (() => Promise<void> | void) | undefined
    let disposing: Promise<void> | undefined
    const dispose = (ownerTriggered = false): Promise<void> => (disposing ??= (async () => {
      ownerAbort.abort(new Error(`embedded-codex: agent ${JSON.stringify(session.id)} disposed`))
      await cleanupAll([
        () => agent.disposeRuntime(),
        () => stored?.close(),
        () => detachAgent?.(),
        () => detachSession?.(),
        () => { this.live.delete(trackedDispose) },
        async () => { if (!ownerTriggered) await ownerEffect?.() },
      ], `embedded-codex: failed to dispose agent ${session.id}`)
    })())
    const trackedDispose = (): Promise<void> => dispose(false)
    this.live.add(trackedDispose)
    try {
      ownerEffect = ownerCtx.effect(() => () => {
        if (disposing !== undefined) return
        return dispose(true)
      }, `embeddedCodex.agent(${session.id})`)
      const commit = await raceAbort(setup?.(agent.ctx, agent), signal)
      if (resumeRemote) await raceAbort(agent.prepareResume(signal), signal)
      signal.throwIfAborted()
      commit?.commit()
      await raceAbort(persistBinding(), signal)
      signal.throwIfAborted()
      detachSession = agent.ctx.sessions.enter(session)
      published = true
      detachAgent = this.ctx.agents.enter(agent, parentAgent)
      agent.ctx.sessions.announce(session)
      await this.ctx.agents.announce(agent, source, signal)
      signal.throwIfAborted()
      return { agent, dispose: trackedDispose }
    } catch (error: unknown) {
      return await rollbackFailure(error, trackedDispose)
    }
  }

  private permissionFor(session: Session, cwd: string): ResolvedCodexPermission {
    const permissionPresets = this.ctx.get('permissionPresets')
    if (permissionPresets !== undefined) {
      return resolveCodexPermission(permissionPresets.current(session), cwd)
    }
    if (!this.warnedPermissionFallback) {
      this.warnedPermissionFallback = true
      this.ctx.logger.warn(
        'embedded-codex: no Permission Presets provider is composed; deprecated static approvalPolicy and sandbox settings are in use',
      )
    }
    return resolveLegacyCodexPermission({
      approvalPolicy: this.config.approvalPolicy,
      sandbox: this.config.sandbox,
    }, cwd)
  }

  private disposeRuntime(): Promise<void> {
    return (this.disposing ??= (async () => {
      this.lifecycleAbort.abort(new Error('embedded-codex: runtime disposed'))
      await cleanupAll([...this.live, () => this.appServer.dispose()], 'embedded-codex: Runtime cleanup failed')
    })())
  }
}

export default EmbeddedCodexRuntime
