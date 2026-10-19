import { readFileSync } from 'node:fs'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface PatchRow {
  readonly id?: string
  readonly name?: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown>
  readonly insert?: PatchRow[]
}

function loadPatch(): PatchRow[] {
  const document = yaml.load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  if (!Array.isArray(document)) throw new TypeError('cordis.patch.yml must contain a patch row array')
  return document as PatchRow[]
}

describe('agent preset registry composition', () => {
  it('keeps the compatible provider under the settings namespace used by the host UI', () => {
    const rows = loadPatch()
    const original = rows.find(row => row.id === 'agent-preset-registry')

    expect(original).toMatchObject({
      name: '@deepseek-ai/dsh-agent-preset-registry',
      disabled: true,
    })

    const inserted = rows.flatMap(row => row.insert ?? [])
    const replacement = inserted.find(row => row.id === 'agent-preset-registry')
    expect(replacement).toMatchObject({
      name: 'dsh-embedded-codex/compat/agent-preset-registry',
      config: { default: 'standard' },
    })
    expect(replacement?.disabled).not.toBe(true)

    expect(inserted.find(row => row.id === 'embedded-codex-agent-preset-registry')).toBeUndefined()
  })
})
