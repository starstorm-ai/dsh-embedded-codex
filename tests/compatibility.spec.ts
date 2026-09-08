import { Context } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentFactory,
  CreateAgentOptions,
  ResumeAgentOptions,
} from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import AgentRegistry from '../src/compat/providers/agent-registry.ts'
import { Session as ClientSession } from '../compat/generated/packages/api/session-controller/src/client/sessions/session.ts'
import { EXPECTED_DSH_VERSION } from '../src/compat/host-version.ts'

function factory(label: string) {
  const calls: Array<{ readonly label: string; readonly kind: 'create' | 'resume' }> = []
  const makeAgent = (id: string): Agent => ({ id: SessionId(id), options: {} }) as Agent
  const target: AgentFactory = {
    createAgent(_owner: Context, options: CreateAgentOptions) {
      calls.push({ label, kind: 'create' })
      return Promise.resolve({ agent: makeAgent(options.sessionId), dispose: () => Promise.resolve() })
    },
    resume(_owner: Context, options: ResumeAgentOptions) {
      calls.push({ label, kind: 'resume' })
      return Promise.resolve({ agent: makeAgent(options.resumeSessionId), dispose: () => Promise.resolve() })
    },
  }
  return { calls, target }
}

describe('version-locked compatibility providers', () => {
  it('routes only the named preset to Codex and reserves its model provider', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    const standard = factory('standard')
    const codex = factory('codex')
    ctx.agents.setFactory(standard.target)
    ctx.agents.setPresetFactory(
      'embedded-codex',
      codex.target,
      { provider: 'codex', model: 'default' },
    )

    const standardHandle = await ctx.agents.create({ sessionId: SessionId('standard') })
    const codexHandle = await ctx.agents.create({
      sessionId: SessionId('codex'),
      meta: { agentPreset: 'embedded-codex' },
    })
    await ctx.agents.resume({
      resumeSessionId: SessionId('codex-resumed'),
      agentPreset: 'embedded-codex',
    })

    expect(standard.calls).toEqual([{ label: 'standard', kind: 'create' }])
    expect(codex.calls).toEqual([
      { label: 'codex', kind: 'create' },
      { label: 'codex', kind: 'resume' },
    ])
    expect(ctx.agents.presetFactoryOptions('embedded-codex')).toEqual({
      provider: 'codex', model: 'default',
    })
    expect(ctx.agents.acceptsModelProvider(standardHandle.agent, 'codex')).toBe(false)
    expect(ctx.agents.acceptsModelProvider(standardHandle.agent, 'deepseek-official')).toBe(true)
    expect(ctx.agents.acceptsModelProvider(codexHandle.agent, 'codex')).toBe(true)
    expect(ctx.agents.acceptsModelProvider(codexHandle.agent, 'deepseek-official')).toBe(false)
    expect(ctx.agents.requiresFactorySwitch(standardHandle.agent, 'embedded-codex')).toBe(true)
    expect(ctx.agents.requiresFactorySwitch(codexHandle.agent, 'embedded-codex')).toBe(false)

    await ctx.fiber.dispose()
  })

  it('revives a resident Web Session when the same Host id is republished', () => {
    const session = new ClientSession('client-session' as never, {} as never)

    session.handleRemoved()
    expect(session.getSnapshot().removed).toBe(true)
    session.handleAdded()
    expect(session.getSnapshot().removed).toBe(false)
    const revived = session.getSnapshot()
    session.handleAdded()
    expect(session.getSnapshot()).toBe(revived)
  })

  it('pins all replacement providers to the submodule release', () => {
    expect(EXPECTED_DSH_VERSION).toBe('0.1.2-rc.1')
  })
})
