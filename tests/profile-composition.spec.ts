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
  it('disables the three built-in providers, inserts replacements, and preserves the normal loop', () => {
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
    expect(byId(entries, 'session-controller')).toMatchObject({
      name: '@deepseek-ai/dsh-api-session-controller',
      disabled: true,
    })
    expect(byId(entries, 'embedded-codex-agent-registry')).toMatchObject({
      name: 'dsh-embedded-codex/compat/agent-registry',
    })
    expect(byId(entries, 'embedded-codex-agent-presets')).toMatchObject({
      name: 'dsh-embedded-codex/compat/agent-presets',
      config: { default: 'standard' },
    })
    expect(byId(entries, 'embedded-codex-session-controller')).toMatchObject({
      name: 'dsh-embedded-codex/compat/session-controller',
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
})
