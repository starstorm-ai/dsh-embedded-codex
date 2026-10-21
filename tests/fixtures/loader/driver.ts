#!/usr/bin/env node
/** Inspect the public embedded-Codex bundle without starting App Server. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '../../../src/index.ts'
import { ApiSessionAgentController } from '../../../lib/types/compat/session-controller/agent.js'
import { installModelSelectionProjection } from '../../../lib/types/compat/session-controller/model-selection-projection.js'
import { bootProductionProfile } from '../../../upstream/deepseek-harness/packages/test-support/loader-smoke/tests/fixtures/production-profile.ts'

const overlayPaths = process.argv.slice(2)
if (overlayPaths.length === 0) {
  throw new Error('embedded-codex Loader driver requires overlay paths')
}

const ctx = await bootProductionProfile({
  binName: 'embedded-codex-loader-composition',
  profile: 'headless',
  overlayPaths: overlayPaths.map(path => resolveConfigPath(path, undefined)),
})

try {
  const agentPresets = await ctx.agentPresets.list()
  // SettingsForms only describes active entries with a volatile form. This is
  // the same lookup that the stock UI's update call previously failed.
  const agentPresetSettingsConfigurable = ctx.settings.describe()
    .some(descriptor => descriptor.ns === 'agent-preset-registry')
  // A root Context bypasses Cordis injection checks. Mount the controller in
  // a plugin scope, as SessionController does in production. agentPresets is
  // optional there and must only be accessed through its nested injection.
  let controller: ApiSessionAgentController | undefined
  await ctx.plugin({
    name: 'scoped-session-controller-fixture',
    inject: ['agentDefaultModel', 'agents', 'llm', 'sessions', 'sessionProjections', 'sessionQuery', 'typert'],
    apply(controllerCtx) {
      installModelSelectionProjection(controllerCtx)
      controller = new ApiSessionAgentController(controllerCtx)
    },
  })
  if (controller === undefined) throw new Error('Session controller fixture did not activate')
  const scopedController = controller
  const sessionId = SessionId('embedded-codex-preset-switch')
  let agent = await controller.ensureSession(sessionId, process.cwd(), false, 'embedded-codex')
  const runtimeSwitches: string[] = []
  for (const preset of ['standard', 'embedded-codex', 'minimal', 'embedded-codex']) {
    await ctx.agentPresets.select(agent, preset)
    const replacement = ctx.agents.get(sessionId)
    if (replacement === undefined || replacement === agent) throw new Error('preset switch did not replace the Agent')
    agent = replacement
    runtimeSwitches.push(controller.presetForSession(agent.session) ?? '')
  }
  // All callers deliberately retain the old Agent. Admission must resolve by Session ID.
  const concurrentSelections = ['standard', 'embedded-codex'].map(preset => ctx.agentPresets.select(agent, preset))
  const admittedPreset = controller.serializeAdmission(sessionId, async current => {
    if (current === agent) throw new Error('queued admission used a stale Agent')
    return scopedController.presetForSession(current.session)
  })
  await Promise.all(concurrentSelections)
  if (await admittedPreset !== 'embedded-codex') throw new Error('admission did not wait for preset switches')
  agent = ctx.agents.get(sessionId)!

  const readOnlyId = SessionId('embedded-codex-readonly-switch')
  const readOnly = await controller.ensureSession(readOnlyId, process.cwd(), false, 'standard')
  ctx.permissionPresets.set(readOnly.session, 'read-only')
  await ctx.agentPresets.select(readOnly, 'embedded-codex')
  const readOnlyReplacement = ctx.agents.get(readOnlyId)!
  const preservedReadOnly = ctx.permissionPresets.current(readOnlyReplacement.session) === 'custom'
  if (!preservedReadOnly) throw new Error('Runtime switch silently widened read-only permissions')
  await ctx.sessions.flush(agent.session)
  await using stored = await ctx.sessionPersistence.open(sessionId, 'read')
  const persistedPreset = (await stored.read()).events.findLast(event => event.type === 'agent-preset/selected')
  if (persistedPreset?.type !== 'agent-preset/selected' || persistedPreset.data.agentPreset !== 'embedded-codex') {
    throw new Error('preset switch was not persisted')
  }
  process.stdout.write(`${JSON.stringify({
    embeddedCodex: ctx.get('embeddedCodex') !== undefined,
    permissionPresets: ctx.get('permissionPresets') !== undefined,
    agentLoop: ctx.get('agentLoop') !== undefined,
    compaction: ctx.get('compaction') !== undefined,
    providers: ctx.llm.listProviders().map(provider => provider.id),
    defaultModel: ctx.agentDefaultModel.currentSelection(),
    codexPresetModel: ctx.agents.presetFactoryOptions('embedded-codex'),
    agentPresets: agentPresets.map(preset => preset.id),
    agentPresetSettingsConfigurable,
    runtimeSwitches,
    concurrentAdmission: true,
    preservedReadOnly,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
