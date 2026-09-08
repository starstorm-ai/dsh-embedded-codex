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
  process.stdout.write(`${JSON.stringify({
    embeddedCodex: ctx.get('embeddedCodex') !== undefined,
    agentLoop: ctx.get('agentLoop') !== undefined,
    compaction: ctx.get('compaction') !== undefined,
    providers: ctx.llm.listProviders().map(provider => provider.id),
    defaultModel: ctx.agentDefaultModel.currentSelection(),
    codexPresetModel: ctx.agents.presetFactoryOptions('embedded-codex'),
    agentPresets: (await ctx.agentPresets.list()).map(preset => preset.id),
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
