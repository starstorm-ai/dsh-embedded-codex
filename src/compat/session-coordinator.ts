import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { Agent, AgentHandle, AgentOptions, AgentSetup, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { isIncompleteCleanup } from '../runtime/cleanup.ts'

export interface SessionComposition {
  readonly agentPreset?: string
  readonly agentOptions: AgentOptions
  readonly setup: AgentSetup
}

/** The controller owns handles and DSH composition; the coordinator owns ordering and compensation. */
export interface RuntimeSwitchPort {
  handle(agent: Agent): AgentHandle | undefined
  forget(agent: Agent): void
  remember(handle: AgentHandle): void
  preset(agent: Agent): string | undefined
  selection(agent: Agent): ModelSelection
  select(agent: Agent, selection: ModelSelection): void
  compose(preset: string | undefined): Promise<SessionComposition>
  resume(id: SessionId, composition: SessionComposition): Promise<AgentHandle>
}

/** One queue per durable identity, with no lock held for a complete model turn. */
export class SessionOperationCoordinator {
  private readonly tails = new Map<SessionId, Promise<void>>()
  private readonly unsafe = new Map<SessionId, unknown>()

  run<T>(id: SessionId, operation: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(id) ?? Promise.resolve()).then(() => {
      if (this.unsafe.has(id)) throw new Error(`Session ${id} requires restart after incomplete Runtime cleanup`, { cause: this.unsafe.get(id) })
      return operation()
    })
    const tail = result.then(() => undefined, () => undefined)
    this.tails.set(id, tail)
    void tail.then(() => { if (this.tails.get(id) === tail) this.tails.delete(id) })
    return result
  }

  /** Called only inside run(); no recursive queue acquisition. */
  async replace(agent: Agent, target: string, port: RuntimeSwitchPort): Promise<void> {
    const old = port.handle(agent)
    if (old === undefined) throw new Error(`Session ${agent.id} has no owned Agent handle`)
    const previousPreset = port.preset(agent)
    const previousSelection = { ...port.selection(agent) }
    const permissions = agent.session.snapshotEvents().filter(event =>
      event.type === 'permission/preset' || event.type === 'sandbox/mode' || event.type === 'approval/policy')
    const previous = await port.compose(previousPreset)
    const next = await port.compose(target)
    const prepare = (composition: SessionComposition, selection: ModelSelection, restore: boolean): SessionComposition => ({
      ...composition,
      setup: async (ctx, current) => {
        const commit = await composition.setup(ctx, current)
        if (composition.agentPreset !== undefined) current.session.append('agent-preset/selected', { agentPreset: composition.agentPreset })
        if (restore) {
          for (const event of permissions) {
            if (event.type === 'permission/preset') current.session.append(event.type, event.data)
            if (event.type === 'sandbox/mode') current.session.append(event.type, event.data)
            if (event.type === 'approval/policy') current.session.append(event.type, event.data)
          }
        }
        return { commit: () => {
          commit?.commit()
          port.select(current, selection)
        } }
      },
    })
    let replacement: AgentHandle | undefined
    let released = false
    try {
      await old.dispose()
      released = true
      port.forget(agent)
      replacement = await port.resume(agent.id, prepare(next, modelFromOptions(next.agentOptions), false))
      port.remember(replacement)
    } catch (error: unknown) {
      if (!released) {
        // A failed disposer cannot certify release of persistence ownership.
        this.unsafe.set(agent.id, error)
        throw error
      }
      if (isIncompleteCleanup(error)) {
        this.unsafe.set(agent.id, error)
        throw error
      }
      if (replacement !== undefined) {
        try {
          await replacement.dispose()
          port.forget(replacement.agent)
        } catch (cleanup: unknown) {
          const failure = new AggregateError([error, cleanup], 'Rejected Runtime cleanup failed; recovery is unsafe')
          this.unsafe.set(agent.id, failure)
          throw failure
        }
      }
      try {
        const restored = await port.resume(agent.id, prepare({ ...previous, agentOptions: { ...agent.options } }, previousSelection, true))
        port.remember(restored)
      } catch (restore: unknown) {
        const failure = new AggregateError([error, restore], `Runtime switch and recovery failed for ${agent.id}`)
        this.unsafe.set(agent.id, failure)
        throw failure
      }
      throw error
    }
  }
}

export function assertBlankSession(agent: Agent, preset: string, boundary: {
  openTurnStartSeq: number | null
  lastTurn: number
} | undefined): void {
  if (agent.status !== 'idle' || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0
    || (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0))) {
    throw new RemoteError('agent-preset/locked', 'This session has already started', { sessionId: agent.id, agentPreset: preset })
  }
}

export function modelFromOptions(options: AgentOptions): ModelSelection {
  if (options.provider === undefined || options.model === undefined) throw new Error('Runtime requires a default provider and model')
  return {
    provider: options.provider, model: options.model,
    ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
  }
}
