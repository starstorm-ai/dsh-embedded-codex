import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import z from '@deepseek-ai/schemastery'
import Settings from '@deepseek-ai/dsh-settings'
import { load } from 'js-yaml'
import { expect, it } from 'vitest'

import ConfigEditor from '../lib/compat/config-editor.js'

interface RegistryConfig {
  readonly default: string
  readonly selectedDefault: { get(): string | undefined }
}

it('persists settings for a last-write-wins replacement that keeps the stock entry id', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'embedded-codex-config-editor-')))
  const dir = join(home, 'profiles', 'test')
  const bundle = join(dir, 'node_modules', 'test-bundle')
  initProfile(dir, ['test-bundle'])
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    {
      id: 'agent-preset-registry', name: 'cordis:stock-registry', disabled: true,
      config: { default: 'standard' },
    },
    {
      id: 'agent-preset-registry', name: 'cordis:compatible-registry',
      config: { default: 'standard' },
    },
  ] }]))
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')

  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  let registryConfig: RegistryConfig | undefined
  const CompatibleRegistry = {
    Config: z.object({
      default: z.string().required(),
      selectedDefault: z.string().volatile(),
    }),
    apply(_ctx: Context, config: RegistryConfig) { registryConfig = config },
  }

  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (root) => {
    root.provide('profileContext', profile)
    root.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
    Object.assign(root.loader.builtins, {
      editor: ConfigEditor,
      settings: Settings,
      'compatible-registry': CompatibleRegistry,
    })
  })

  try {
    expect(ctx.settings.describe().some(row => row.ns === 'agent-preset-registry')).toBe(true)
    await ctx.settings.update('agent-preset-registry', { selectedDefault: 'embedded-codex' })
    expect(registryConfig?.selectedDefault.get()).toBe('embedded-codex')
    expect(ctx.settings.describe().find(row => row.ns === 'agent-preset-registry')?.value)
      .toEqual({ selectedDefault: 'embedded-codex' })

    const document = load(readFileSync(profile.patchPath, 'utf8')) as Array<Record<string, unknown>>
    expect(document).toContainEqual({
      id: 'agent-preset-registry',
      name: 'cordis:compatible-registry',
      config: { default: 'standard', selectedDefault: 'embedded-codex' },
    })
  } finally {
    await ctx.fiber.dispose()
    rmSync(home, { recursive: true, force: true })
  }
})
