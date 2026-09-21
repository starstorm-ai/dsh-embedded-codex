import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId, SessionLogOffset, type Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it, vi } from 'vitest'
import PermissionPresetService from '../src/compat/providers/permission-presets.ts'

const standardPresets = {
  'read-only': { sandbox: 'read-only' as const, approval: 'ask' as const },
  'workspace-write': { sandbox: 'workspace-write' as const, approval: 'ask' as const },
  'danger-full-access': { sandbox: 'danger-full-access' as const, approval: 'never' as const },
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('permission provider tests do not execute shell commands') },
    run() { throw new Error('permission provider tests do not execute shell commands') },
    start() { throw new Error('permission provider tests do not execute shell commands') },
  })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(PermissionPresetService, { presets: standardPresets })
  return ctx
}

function permissionView(ctx: Context, session: Session): {
  readonly currentValue: string
  readonly options: readonly { readonly value: string; readonly name: string }[]
} {
  const value = ctx.sessionProjections.snapshot(session).values.permissions
  if (value === undefined) throw new Error('permission projection is unavailable')
  return value
}

async function agentFor(ctx: Context, session: Session, status: Agent['status']): Promise<Agent> {
  const agent = {
    id: session.id,
    session,
    status,
    inject: vi.fn<Agent['inject']>(),
  } as unknown as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['commands'] }))
  return agent
}

describe('provider-aware permission presets', () => {
  it('keeps the standard table unchanged outside embedded Codex', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('standard-permissions'), {
      meta: { agentPreset: 'standard' },
    })

    expect(permissionView(ctx, session)).toMatchObject({
      currentValue: 'workspace-write',
      options: [
        { value: 'read-only', name: 'read-only' },
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
    })
    expect(() => ctx.permissionPresets.set(session, 'approve-for-me'))
      .toThrow(/unavailable for Agent preset/)
    await ctx.fiber.dispose()
  })

  it('pins Ask by default and preserves the Auto-review choice across shared knob values', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('codex-permissions'), {
      meta: { agentPreset: 'embedded-codex' },
    })

    expect(permissionView(ctx, session)).toMatchObject({
      currentValue: 'ask-for-approval',
      options: [
        { value: 'ask-for-approval', name: 'Ask for approval' },
        { value: 'approve-for-me', name: 'Approve for me' },
        { value: 'danger-full-access', name: 'Full access' },
      ],
    })
    ctx.permissionPresets.set(session, 'approve-for-me')
    expect(ctx.permissionPresets.current(session)).toBe('approve-for-me')
    expect(session.snapshotEvents().filter(event => event.type === 'permission/preset').at(-1)?.data)
      .toEqual({ preset: 'approve-for-me' })
    expect(session.snapshotEvents().filter(event =>
      event.type === 'sandbox/mode' || event.type === 'approval/policy')).toHaveLength(2)
    session.append('agent-preset/selected', { agentPreset: 'standard' })
    expect(permissionView(ctx, session)).toMatchObject({
      currentValue: 'workspace-write',
      options: [
        { value: 'read-only' },
        { value: 'workspace-write' },
        { value: 'danger-full-access' },
      ],
    })
    session.append('agent-preset/selected', { agentPreset: 'embedded-codex' })
    expect(permissionView(ctx, session)).toMatchObject({ currentValue: 'approve-for-me' })
    await ctx.fiber.dispose()
  })

  it('preserves the exact Auto-review selection when a Session is seeded for resume or fork', async () => {
    const ctx = await harness()
    const source = ctx.sessions.create(SessionId('codex-permission-source'), {
      meta: { agentPreset: 'embedded-codex' },
    })
    ctx.permissionPresets.set(source, 'approve-for-me')
    const seed = source.snapshotEvents()

    const resumed = ctx.sessions.create(SessionId('codex-permission-resumed'), {
      seed,
      meta: { agentPreset: 'embedded-codex', isSeeded: true },
      inheritedEventCount: SessionLogOffset(seed.length),
    })

    expect(ctx.permissionPresets.current(resumed)).toBe('approve-for-me')
    expect(permissionView(ctx, resumed)).toMatchObject({ currentValue: 'approve-for-me' })
    await ctx.fiber.dispose()
  })

  it('recomputes options on blank Agent-preset switches without widening read-only', async () => {
    const ctx = await harness()
    const workspace = ctx.sessions.create(SessionId('permission-switch-workspace'), {
      meta: { agentPreset: 'standard' },
    })
    workspace.append('agent-preset/selected', { agentPreset: 'embedded-codex' })
    expect(permissionView(ctx, workspace)).toMatchObject({ currentValue: 'ask-for-approval' })

    const readOnly = ctx.sessions.create(SessionId('permission-switch-read-only'), {
      meta: { agentPreset: 'standard' },
    })
    ctx.permissionPresets.set(readOnly, 'read-only')
    readOnly.append('agent-preset/selected', { agentPreset: 'embedded-codex' })
    expect(permissionView(ctx, readOnly)).toMatchObject({
      currentValue: 'custom',
      options: [
        { value: 'ask-for-approval' },
        { value: 'approve-for-me' },
        { value: 'danger-full-access' },
        { value: 'custom' },
      ],
    })
    await ctx.fiber.dispose()
  })

  it('rejects permission changes during an active turn and applies them once idle', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('permission-running-guard'), {
      meta: { agentPreset: 'embedded-codex' },
    })
    const agent = await agentFor(ctx, session, 'running')
    const rejected = await ctx.commands.execute(
      agent,
      '/permission approve-for-me',
      [],
      new AbortController().signal,
    )
    expect(rejected?.result).toEqual({
      kind: 'error',
      text: 'permission cannot change while the current turn is running',
    })
    expect(ctx.permissionPresets.current(session)).toBe('ask-for-approval')

    const mutableAgent = agent as unknown as { status: Agent['status'] }
    mutableAgent.status = 'idle'
    const accepted = await ctx.commands.execute(
      agent,
      '/permission approve-for-me',
      [],
      new AbortController().signal,
    )
    expect(accepted?.result).toEqual({ kind: 'success', text: 'preset approve-for-me' })
    expect(ctx.permissionPresets.current(session)).toBe('approve-for-me')
    await ctx.fiber.dispose()
  })
})
