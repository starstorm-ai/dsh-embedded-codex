import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composeEmbeddedClientBundle,
  patchConversationPermissionUi,
  patchPermissionPopupUi,
} from '../scripts/lib/permission-ui-overrides.mts'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  readonly dsh?: {
    readonly client?: {
      readonly immediately?: boolean
      readonly external?: readonly string[]
    }
  }
}
const conversationSource = readFileSync(resolve(
  root,
  'upstream/deepseek-harness/packages/client/ui-conversation/lib/client.js',
), 'utf8')
const permissionSource = readFileSync(resolve(
  root,
  'upstream/deepseek-harness/packages/client/ui-permission-presets/lib/client.js',
), 'utf8')

describe('permission UI compatibility overlays', () => {
  it('prefetches the owner bundle and declares both private UI factory edges', () => {
    expect(manifest.dsh?.client?.immediately).toBe(true)
    expect(manifest.dsh?.client?.external).toEqual(expect.arrayContaining([
      '@deepseek-ai/dsh-client-ui-conversation/client',
      '@deepseek-ai/dsh-client-ui-permission-presets/client',
    ]))
  })

  it('localizes both Codex modes and aliases them to DSH shield glyphs', () => {
    const output = patchConversationPermissionUi(conversationSource)

    expect(output).toContain('"access.preset.askForApproval": "请批准"')
    expect(output).toContain('"access.preset.approveForMe": "帮我批准"')
    expect(output).toContain('"access.preset.askForApproval": "Ask for approval"')
    expect(output).toContain('"access.preset.approveForMe": "Approve for me"')
    expect(output).toContain('value === "ask-for-approval" ? "workspace-write"')
    expect(output).toContain('value === "approve-for-me" ? "read-only"')
    expect(output).toContain('t("access.preset.askForApprovalDescription")')
    expect(output).toContain('t("access.preset.approveForMeDescription")')
    expect(output).not.toContain('sourceMappingURL=')
    expect(output).not.toContain('//#region')
  })

  it('uses the same bilingual labels and descriptions in the command popup', () => {
    const output = patchPermissionPopupUi(permissionSource)

    expect(output).toContain('["ask-for-approval", "preset.askForApproval"]')
    expect(output).toContain('["approve-for-me", "preset.approveForMe"]')
    expect(output).toContain('"preset.askForApproval": "请批准"')
    expect(output).toContain('"preset.approveForMe": "Approve for me"')
    expect(output).toContain('displayPermissionDetail(option.value, option.description, t)')
    expect(output).not.toContain('sourceMappingURL=')
  })

  it('registers both copied UI factories before the embedded client factory', () => {
    const embedded = [
      'window.__ModuleLoader__.load({ id: "dsh-embedded-codex", factory: () => ({}) });',
      '//# sourceMappingURL=client.js.map',
    ].join('\n')
    const output = composeEmbeddedClientBundle(embedded, conversationSource, permissionSource)
    const conversationAt = output.indexOf('id: "@deepseek-ai/dsh-client-ui-conversation"')
    const permissionAt = output.indexOf('id: "@deepseek-ai/dsh-client-ui-permission-presets"')
    const embeddedAt = output.indexOf('id: "dsh-embedded-codex"')

    expect(conversationAt).toBeGreaterThanOrEqual(0)
    expect(permissionAt).toBeGreaterThan(conversationAt)
    expect(embeddedAt).toBeGreaterThan(permissionAt)
    expect(output).toContain('duplicate factory registration for \\"@deepseek-ai/dsh-client-ui-conversation\\"')
    expect(output).toContain('duplicate factory registration for \\"@deepseek-ai/dsh-client-ui-permission-presets\\"')
    expect(output).not.toContain(resolve(root, 'upstream/deepseek-harness'))
    expect(output).not.toContain('sourceMappingURL=')
  })
})
