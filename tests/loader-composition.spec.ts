import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from './support/loader-smoke.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/loader/', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dsh?: { bundle?: { patch?: string } }
}
const bundlePatch = manifest.dsh?.bundle?.patch
if (bundlePatch === undefined) throw new Error('embedded-codex must declare a Bundle patch')

describe('embedded Codex Loader composition', () => {
  it('adds the preset-selected runtime without replacing standard DSH services', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'embedded-codex Loader composition',
      tempDirPrefix: 'dsh-embedded-codex-loader-',
      binScript: join(fixtureDir, 'driver.ts'),
      binArgs: [
        join(fixtureDir, 'cordis.patch.yml'),
        join(packageDir, bundlePatch),
        join(fixtureDir, 'after.patch.yml'),
      ],
      tsconfigPath: fileURLToPath(new URL('../upstream/deepseek-harness/tsconfig.json', import.meta.url)),
      env: { PATH: '' },
      processTimeoutMs: 60_000,
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      embeddedCodex: true,
      agentLoop: true,
      compaction: true,
      providers: ['deepseek-official', 'codex'],
      defaultModel: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      codexPresetModel: { provider: 'codex', model: 'default' },
      agentPresets: ['standard', 'ptc', 'minimal', 'cordis', 'embedded-codex'],
    })
  }, 75_000)
})
