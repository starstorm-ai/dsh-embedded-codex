import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  readonly dsh?: {
    readonly client?: {
      readonly immediately?: boolean
      readonly external?: readonly string[]
      readonly inject?: readonly string[]
    }
  }
}
const clientSource = readFileSync(resolve(
  root,
  'compat/generated/packages/client/ui-permission-presets/src/client/index.ts',
), 'utf8')
const selectSource = readFileSync(resolve(
  root,
  'compat/generated/packages/client/ui-permission-presets/src/client/PermissionSelect.tsx',
), 'utf8')
const bundlePatch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')

describe('provider-aware permission UI replacement', () => {
  it('loads immediately beside the stock conversation UI', () => {
    expect(manifest.dsh?.client?.immediately).toBe(true)
    expect(manifest.dsh?.client?.external).toEqual(['@deepseek-ai/dsh-api-gateway/client'])
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-conversation')
    expect(bundlePatch).not.toContain('embedded-codex-ui-conversation')
    expect(bundlePatch).not.toMatch(/id: ui-conversation[\s\S]{0,100}disabled: true/)
  })

  it('prefers session-scoped options and keeps the process catalog as standard fallback', () => {
    expect(clientSource).toContain('selection.options ?? catalog.options')
    expect(selectSource).toContain('selection?.options ?? catalog?.options')
    expect(clientSource).toContain('selection.currentValue')
    expect(selectSource).toContain('? pick : selection.currentValue')
  })

  it('does not retain the old minified string-rewrite pipeline', () => {
    expect(existsSync(resolve(root, 'scripts/lib/permission-ui-overrides.mts'))).toBe(false)
  })
})
