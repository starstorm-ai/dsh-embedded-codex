import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applyEntryPatches,
  entryListSchema,
  type PatchOptions,
} from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function patches(path: string): PatchOptions[] {
  const parsed = load(readFileSync(resolve(root, path), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error(`${path} is not a Cordis patch list`)
  return parsed as PatchOptions[]
}

function compose(layers: readonly PatchOptions[][]): {
  readonly entries: EntryOptions[]
  readonly warnings: string[]
} {
  const warnings: string[] = []
  const entries = applyEntryPatches([], structuredClone(layers.flat()), (message, ...args) => {
    let index = 0
    warnings.push(message.replaceAll('%C', () => JSON.stringify(args[index++])))
  })
  return { entries, warnings }
}

function byId(entries: readonly EntryOptions[], id: string): EntryOptions {
  const found = entries.find(entry => entry.id === id)
  if (found === undefined) throw new Error(`composed profile has no ${id} entry`)
  return found
}

const base = patches('upstream/deepseek-harness/packages/bundle/base/cordis.patch.yml')
const web = patches('upstream/deepseek-harness/packages/bundle/web-app/cordis.patch.yml')
const embeddedCodex = patches('cordis.patch.yml')

describe('published Web profile composition', () => {
  it('disables the six built-in owners, inserts replacements, and preserves the normal loop', () => {
    const { entries, warnings } = compose([base, web, embeddedCodex])

    expect(warnings).toEqual([])
    expect(byId(entries, 'agent')).toMatchObject({
      name: '@deepseek-ai/dsh-agent',
      disabled: true,
    })
    expect(byId(entries, 'agent-presets')).toMatchObject({
      name: '@deepseek-ai/dsh-agent-presets',
      disabled: true,
    })
    expect(byId(entries, 'permission')).toMatchObject({
      name: '@deepseek-ai/dsh-permission-presets',
      disabled: true,
    })
    expect(byId(entries, 'session-controller')).toMatchObject({
      name: '@deepseek-ai/dsh-api-session-controller',
      disabled: true,
    })
    expect(byId(entries, 'ui-conversation')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-conversation',
      disabled: true,
    })
    expect(byId(entries, 'ui-permission')).toMatchObject({
      name: '@deepseek-ai/dsh-client-ui-permission-presets',
      disabled: true,
    })
    expect(byId(entries, 'embedded-codex-agent-registry')).toMatchObject({
      name: 'dsh-embedded-codex/compat/agent-registry',
    })
    expect(byId(entries, 'embedded-codex-agent-presets')).toMatchObject({
      name: 'dsh-embedded-codex/compat/agent-presets',
      config: { default: 'standard' },
    })
    expect(byId(entries, 'embedded-codex-permission-presets')).toMatchObject({
      name: 'dsh-embedded-codex/compat/permission-presets',
      config: {
        presets: {
          'read-only': { sandbox: 'read-only', approval: 'ask' },
          'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
          'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
        },
      },
    })
    expect(entries.filter(entry => entry.id === 'embedded-codex-permission-presets')).toHaveLength(1)
    expect(byId(entries, 'embedded-codex-session-controller')).toMatchObject({
      name: 'dsh-embedded-codex/compat/session-controller',
    })
    expect(byId(entries, 'embedded-codex-ui-conversation')).toMatchObject({
      name: 'dsh-embedded-codex/compat/ui-conversation',
    })
    expect(byId(entries, 'embedded-codex-ui-permission-presets')).toMatchObject({
      name: 'dsh-embedded-codex/compat/ui-permission-presets',
    })
    expect(byId(entries, 'embedded-codex')).toMatchObject({ name: 'dsh-embedded-codex' })
    const agentLoop = byId(entries, 'agent-loop')
    expect(agentLoop).toMatchObject({ name: '@deepseek-ai/dsh-agent-loop' })
    expect(agentLoop.disabled).not.toBe(true)
    expect(byId(entries, 'llm-deepseek')).toMatchObject({ name: '@deepseek-ai/dsh-llm-deepseek' })
  })

  it('uses provider names as guards and diagnoses a changed upstream row', () => {
    const changedBase = structuredClone(base)
    const insertion = changedBase.find(layer => layer.insert !== undefined)?.insert
    const agent = insertion?.find(entry => entry.id === 'agent')
    if (agent === undefined) throw new Error('pinned base Bundle has no agent row')
    agent.name = '@fixture/incompatible-agent'

    const { entries, warnings } = compose([changedBase, web, embeddedCodex])

    expect(warnings).toContain(
      'patch: name mismatch for "agent" (expected "@fixture/incompatible-agent", got "@deepseek-ai/dsh-agent"), skipping',
    )
    const incompatibleAgent = byId(entries, 'agent')
    expect(incompatibleAgent).toMatchObject({ name: '@fixture/incompatible-agent' })
    expect(incompatibleAgent).not.toHaveProperty('disabled')
  })

  it('does not disable an unrecognized upstream permission provider', () => {
    const changedBase = structuredClone(base)
    const insertion = changedBase.find(layer => layer.insert !== undefined)?.insert
    const permission = insertion?.find(entry => entry.id === 'permission')
    if (permission === undefined) throw new Error('pinned base Bundle has no permission row')
    permission.name = '@fixture/incompatible-permission'

    const { entries, warnings } = compose([changedBase, web, embeddedCodex])

    expect(warnings).toContain(
      'patch: name mismatch for "permission" (expected "@fixture/incompatible-permission", got "@deepseek-ai/dsh-permission-presets"), skipping',
    )
    const incompatiblePermission = byId(entries, 'permission')
    expect(incompatiblePermission).toMatchObject({ name: '@fixture/incompatible-permission' })
    expect(incompatiblePermission).not.toHaveProperty('disabled')
  })
})
