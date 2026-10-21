import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from './support/loader-smoke.ts'

const fixtureDir = fileURLToPath(new URL('./fixtures/loader/', import.meta.url))
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const webPresetDir = join(packageDir, 'upstream/deepseek-harness/packages/bundle/web-app/presets')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dsh?: { bundle?: { patch?: string } }
}
const bundlePatch = manifest.dsh?.bundle?.patch
if (bundlePatch === undefined) throw new Error('embedded-codex must declare a Bundle patch')

describe('embedded Codex Loader composition', () => {
  it('switches a persisted Codex session to ordinary presets from a real Cordis injection scope', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'embedded-codex Loader composition',
      tempDirPrefix: 'dsh-embedded-codex-loader-',
      binScript: join(fixtureDir, 'driver.ts'),
      binArgs: [
        join(fixtureDir, 'cordis.patch.yml'),
        join(webPresetDir, 'standard.patch.yml'),
        join(webPresetDir, 'ptc.patch.yml'),
        join(webPresetDir, 'minimal.patch.yml'),
        join(webPresetDir, 'cordis.patch.yml'),
        join(packageDir, bundlePatch),
        join(fixtureDir, 'after.patch.yml'),
      ],
      tsconfigPath: fileURLToPath(new URL('../upstream/deepseek-harness/tsconfig.json', import.meta.url)),
      env: { PATH: '' },
      processTimeoutMs: 60_000,
    })

    expect(stderr).toBe('')
    const composed = JSON.parse(stdout) as {
      readonly providers: readonly string[]
      readonly [key: string]: unknown
    }
    expect(composed).toMatchObject({
      embeddedCodex: true,
      permissionPresets: true,
      agentLoop: true,
      compaction: true,
      defaultModel: { provider: 'deepseek-official', model: 'deepseek-flash' },
      codexPresetModel: { provider: 'codex', model: 'default' },
      agentPresets: ['standard', 'ptc', 'minimal', 'cordis', 'embedded-codex'],
      agentPresetSettingsConfigurable: true,
      runtimeSwitches: ['standard', 'embedded-codex', 'minimal', 'embedded-codex'],
      concurrentAdmission: true,
      preservedReadOnly: true,
    })
    expect([...composed.providers].sort()).toEqual(['codex', 'deepseek-account', 'deepseek-official'])
  }, 75_000)
})
