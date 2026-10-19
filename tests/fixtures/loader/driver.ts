#!/usr/bin/env node
/** Inspect the public embedded-Codex bundle without starting App Server. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '../../../src/index.ts'
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
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
