import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { SessionOperationCoordinator, type RuntimeSwitchPort } from '../src/compat/session-coordinator.ts'
import { cleanupAll, IncompleteCleanupError, rollbackFailure } from '../src/runtime/cleanup.ts'

function deferred() { return Promise.withResolvers<void>() }

function fixture() {
  const id = SessionId('switch-fixture')
  const session = Session.create(id)
  const old = { id, session, options: { provider: 'standard', model: 'default' } } as Agent
  const selection: ModelSelection = { provider: 'standard', model: 'explicit-user-selection' }
  let writer: Agent | undefined = old
  const handles = new Map<Agent, AgentHandle>()
  const dispose = vi.fn(async () => { writer = undefined })
  handles.set(old, { agent: old, dispose })
  const restored: Agent[] = []
  const port: RuntimeSwitchPort = {
    handle: agent => handles.get(agent),
    forget: agent => { handles.delete(agent) },
    remember: handle => { handles.set(handle.agent, handle) },
    preset: agent => agent === old ? 'standard' : agent.session.snapshotEvents()
      .filter(event => event.type === 'agent-preset/selected').at(-1)?.data.agentPreset,
    selection: () => selection,
    select: vi.fn(),
    compose: async preset => ({
      agentPreset: preset!, agentOptions: { provider: preset, model: 'default' },
      setup: () => {},
    }),
    resume: vi.fn(async (_id, composition) => {
      if (writer !== undefined) throw new Error('two writers')
      const agent = { id, options: composition.agentOptions,
        session: Session.create(id, session.snapshotEvents(), session.header),
      } as Agent
      const commit = await composition.setup(new Context(), agent)
      commit?.commit()
      writer = agent
      restored.push(agent)
      return { agent, dispose: async () => { writer = undefined } }
    }),
  }
  return { coordinator: new SessionOperationCoordinator(), old, port, dispose, restored, selection }
}

describe('Session operation ownership', () => {
  it('resolves current identity after queue admission and does not block another session', async () => {
    const coordinator = new SessionOperationCoordinator()
    const gate = deferred()
    let agent = 'old'
    const switcher = coordinator.run(SessionId('one'), async () => { await gate.promise; agent = 'replacement' })
    const prompt = coordinator.run(SessionId('one'), async () => agent)
    await expect(coordinator.run(SessionId('two'), async () => 'independent')).resolves.toBe('independent')
    gate.resolve()
    await switcher
    await expect(prompt).resolves.toBe('replacement')
  })

  it('deduplicates admitted prompt ids after waiting and recovers the queue after a rejection', async () => {
    const coordinator = new SessionOperationCoordinator()
    const id = SessionId('dedup')
    const requests = new Set<string>()
    let deliveries = 0
    const prompt = () => coordinator.run(id, async () => {
      if (requests.has('request')) return
      await Promise.resolve()
      requests.add('request')
      deliveries++
    })
    await Promise.all([prompt(), prompt()])
    expect(deliveries).toBe(1)
    await expect(coordinator.run(id, async () => { throw new Error('admission failed') })).rejects.toThrow('admission failed')
    await expect(coordinator.run(id, async () => 1)).resolves.toBe(1)
  })

  it('does not resume another writer after old-handle cleanup fails', async () => {
    const { coordinator, old, port, dispose } = fixture()
    dispose.mockRejectedValueOnce(new Error('writer close failed'))
    await expect(coordinator.run(old.id, () => coordinator.replace(old, 'codex', port))).rejects.toThrow('writer close failed')
    expect(port.resume).not.toHaveBeenCalled()
    await expect(coordinator.run(old.id, async () => 'unsafe')).rejects.toThrow('requires restart')
    await expect(coordinator.run(SessionId('other'), async () => 'safe')).resolves.toBe('safe')
  })

  it('restores the precise selected model when target setup fails', async () => {
    const { coordinator, old, port, selection, restored } = fixture()
    vi.mocked(port.resume).mockRejectedValueOnce(new Error('target setup failed'))
    await expect(coordinator.run(old.id, () => coordinator.replace(old, 'codex', port))).rejects.toThrow('target setup failed')
    expect(restored).toHaveLength(1)
    expect(port.select).toHaveBeenLastCalledWith(restored[0], selection)
    await expect(coordinator.run(old.id, async () => 'recovered')).resolves.toBe('recovered')
  })

  it('never creates a recovery writer when failed target setup also failed to release ownership', async () => {
    const { coordinator, old, port } = fixture()
    const error = new IncompleteCleanupError([new Error('setup'), new Error('close')], 'setup rollback failed')
    vi.mocked(port.resume).mockRejectedValueOnce(error)
    await expect(coordinator.run(old.id, () => coordinator.replace(old, 'codex', port))).rejects.toBe(error)
    expect(port.resume).toHaveBeenCalledTimes(1)
    await expect(coordinator.run(old.id, async () => {})).rejects.toThrow('requires restart')
  })

  it('reports both switch and recovery failures and blocks further admissions', async () => {
    const { coordinator, old, port } = fixture()
    vi.mocked(port.resume).mockRejectedValueOnce(new Error('target failed')).mockRejectedValueOnce(new Error('recovery failed'))
    const error = await coordinator.run(old.id, () => coordinator.replace(old, 'codex', port)).catch(error => error)
    expect(error).toBeInstanceOf(AggregateError)
    expect(error.errors.map((error: Error) => error.message)).toEqual(['target failed', 'recovery failed'])
    await expect(coordinator.run(old.id, async () => {})).rejects.toThrow('requires restart')
  })

  it('attempts every resource cleanup and preserves setup plus rollback errors', async () => {
    const calls: number[] = []
    const cleanup = () => cleanupAll([1, 2, 3].map(value => async () => {
      calls.push(value)
      if (value !== 2) throw new Error(`cleanup ${value}`)
    }), 'cleanup failed')
    const failure = await rollbackFailure(new Error('setup'), cleanup).catch(error => error)
    expect(calls).toEqual([1, 2, 3])
    expect(failure.errors[0].message).toBe('setup')
    expect(failure.errors[1].errors.map((error: Error) => error.message)).toEqual(['cleanup 1', 'cleanup 3'])
  })
})
