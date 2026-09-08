/**
 * Codex App Server Agent Runtime and catalog-only LLM adapter for DSH.
 * @module dsh-embedded-codex
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import {
  emitAgentEvent,
  type AgentFactory,
  type AgentHandle,
  type AgentOptions,
  type AgentSetup,
  type CreateAgentOptions,
  type ResumeAgentOptions,
  type SessionStartSource,
  type TurnBoundaryProjection,
} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { SessionPreparation, SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { CodexAppServerHost, type AppServerConfig } from './app-server.ts'
import { EmbeddedCodexAgent } from './agent.ts'
import { CodexCatalogAdapter } from './catalog.ts'

export { CodexAppServerHost, CodexRemoteThread, codexAppServerArgv } from './app-server.ts'
export type {
  AppServerConfig,
  CodexModelCatalogEntry,
  CodexThreadAttachment,
  CodexThreadSink,
} from './app-server.ts'
export { EmbeddedCodexAgent } from './agent.ts'
export { CodexCatalogAdapter } from './catalog.ts'

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
  /** App Server approval policy; `on-request` bridges requests through DSH interaction services. */
  approvalPolicy?: 'on-request' | 'never'
  /** Native Codex sandbox selected for every attached thread. */
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
/** Package-owned preset root contributed while this runtime is mounted. */
export const EMBEDDED_CODEX_PRESET_ROOT = fileURLToPath(new URL('../presets/', import.meta.url))
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
  ['agent', '@deepseek-ai/dsh-agent', true],
  ['agent-presets', '@deepseek-ai/dsh-agent-presets', true],
  ['session-controller', '@deepseek-ai/dsh-api-session-controller', true],
  ['embedded-codex-agent-registry', 'dsh-embedded-codex/compat/agent-registry', undefined],
  ['embedded-codex-agent-presets', 'dsh-embedded-codex/compat/agent-presets', undefined],
  ['embedded-codex-session-controller', 'dsh-embedded-codex/compat/session-controller', undefined],
  ['embedded-codex', 'dsh-embedded-codex', undefined],
] as const

function assertProfileComposition(ctx: Context): void {
  const loader = ctx.get('loader')
  if (loader === undefined) return
  const entries = [...loader.entries()]
  for (const [id, name, expectedDisabled] of REQUIRED_PROFILE_ENTRIES) {
    const matches = entries.filter(entry => entry.options.id === id)
    if (matches.length !== 1) {
      throw new Error(`dsh-embedded-codex requires exactly one Web Profile entry ${JSON.stringify(id)}; found ${String(matches.length)}`)
    }
    const [entry] = matches
    if (entry === undefined || entry.options.name !== name || (expectedDisabled !== undefined && entry.disabled !== expectedDisabled)) {
      throw new Error(
        `dsh-embedded-codex found incompatible Web Profile entry ${JSON.stringify(id)}; expected name=${JSON.stringify(name)}${expectedDisabled === undefined ? '' : ` and disabled=${String(expectedDisabled)}`}; found name=${JSON.stringify(entry?.options.name)} and disabled=${String(entry?.disabled)}`,
      )
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
    'agentPresets',
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
      approvalPolicy: this.config.approvalPolicy,
      sandbox: this.config.sandbox,
    }
    this.appServer = new CodexAppServerHost(ctx, serverConfig)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    ctx.llm.registerAdapter([this.config.providerName], new CodexCatalogAdapter(
      this.appServer,
      this.config.providerName,
      this.config.providerDisplayName,
      this.config.defaultModelAlias,
    ))
    ctx.effect(() => ctx.agents.setPresetFactory(
      EMBEDDED_CODEX_PRESET,
      this,
      { provider: this.config.providerName, model: this.config.defaultModelAlias },
    ), 'embeddedCodex.setPresetFactory()')
    ctx.effect(() => ctx.agentPresets.registerRoot({
      path: EMBEDDED_CODEX_PRESET_ROOT,
      trust: 'system',
    }), 'embeddedCodex.agentPresetRoot()')
    ctx.effect(() => () => this.disposeRuntime(), 'embeddedCodex.lifecycle()')
  }

  /**
   * Create and publish one App Server-backed agent.
   * @param ownerCtx - Calling Cordis scope that owns the Agent lifetime.
   * @param options - Fresh DSH Session and Agent setup options.
   * @returns The live Agent handle and disposer.
   */
  async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
    const preparation = SessionPreparation.create(this.ctx.sessions.prepare(options.sessionId, {
      ...options.seed === undefined ? {} : { seed: options.seed },
      meta: {
        ...options.meta,
        cwd: options.meta?.cwd ?? this.config.processCwd,
      },
      ...options.inheritedEventCount === undefined ? {} : { inheritedEventCount: options.inheritedEventCount },
    }))
    return await this.setupAndPublish(
      ownerCtx,
      preparation,
      normalizedOptions(this.config, options.agentOptions),
      options.setup,
      options.signal,
      'startup',
      false,
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
    const preparation = await persistence.prepare(options.resumeSessionId, options.signal)
    return await this.setupAndPublish(
      ownerCtx,
      preparation,
      normalizedOptions(this.config, options.agentOptions),
      options.setup,
      options.signal,
      'resume',
      true,
    )
  }

  private async setupAndPublish(
    ownerCtx: Context,
    preparation: SessionPreparation,
    options: AgentOptions,
    setup: AgentSetup | undefined,
    callerSignal: AbortSignal | undefined,
    source: SessionStartSource,
    resumeRemote: boolean,
  ): Promise<AgentHandle> {
    using ownedPreparation = preparation
    ownerCtx.fiber.assertActive()
    if (this.lifecycleAbort.signal.aborted) throw new Error('embedded-codex: runtime is not active')
    const ownerAbort = new AbortController()
    const signal = AbortSignal.any([
      this.lifecycleAbort.signal,
      ownerAbort.signal,
      ...callerSignal === undefined ? [] : [callerSignal],
    ])
    const session = ownedPreparation.session
    const lastTurn = this.ctx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0
    const agent = new EmbeddedCodexAgent(
      this.ctx,
      this.appServer,
      this.config.providerName,
      this.config.defaultModelAlias,
      session.id,
      options,
      session,
      lastTurn,
    )
    let detachSession: (() => void) | undefined
    let detachAgent: (() => void) | undefined
    let ownerEffect: (() => Promise<void> | void) | undefined
    let disposing: Promise<void> | undefined
    const dispose = (ownerTriggered = false): Promise<void> => (disposing ??= (async () => {
      ownerAbort.abort(new Error(`embedded-codex: agent ${JSON.stringify(session.id)} disposed`))
      try {
        await agent.disposeRuntime()
      } finally {
        detachAgent?.()
        detachSession?.()
        this.live.delete(trackedDispose)
        if (!ownerTriggered && ownerEffect !== undefined) await ownerEffect()
      }
    })())
    const trackedDispose = (): Promise<void> => dispose(false)
    this.live.add(trackedDispose)
    try {
      ownerEffect = ownerCtx.effect(() => () => {
        if (disposing !== undefined) return
        return dispose(true)
      }, `embeddedCodex.agent(${session.id})`)
      const commit = await raceAbort(setup?.(agent.ctx), signal)
      if (resumeRemote) await raceAbort(agent.prepareResume(signal), signal)
      signal.throwIfAborted()
      commit?.commit()
      detachSession = agent.ctx.sessions.enter(session)
      detachAgent = this.ctx.agents.enter(agent, ownerCtx.agent)
      agent.ctx.sessions.announce(session)
      this.ctx.agents.announce(agent)
      emitAgentEvent(this.ctx, agent, 'agent/session-start', { source })
      signal.throwIfAborted()
      return { agent, dispose: trackedDispose }
    } catch (error: unknown) {
      await trackedDispose()
      throw error
    }
  }

  private disposeRuntime(): Promise<void> {
    return (this.disposing ??= (async () => {
      this.lifecycleAbort.abort(new Error('embedded-codex: runtime disposed'))
      await Promise.all([...this.live].map(dispose => dispose()))
      await this.appServer.dispose()
    })())
  }
}

export default EmbeddedCodexRuntime
