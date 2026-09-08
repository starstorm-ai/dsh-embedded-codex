import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import yaml from 'js-yaml'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { verifyUpstream } from './lib/upstream.mts'

const REQUIRED_ARTIFACTS = [
  'lib/index.js',
  'lib/compat/agent-registry.js',
  'lib/compat/agent-presets.js',
  'lib/compat/session-controller.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/compat/agent-registry/index.d.ts',
  'lib/types/compat/agent-presets/index.d.ts',
  'lib/types/compat/session-controller/index.d.ts',
  'lib/types/compat/session-controller-client/client/index.d.ts',
  'lib/presets/standard/preset.yml',
  'lib/presets/ptc/preset.yml',
  'lib/presets/minimal/preset.yml',
  'lib/presets/cordis/preset.yml',
] as const

for (const artifact of REQUIRED_ARTIFACTS) {
  if (!existsSync(resolve(REPOSITORY_ROOT, artifact))) throw new Error(`missing built artifact: ${artifact}`)
}

const manifest = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
  exports?: Record<string, unknown>
  files?: readonly string[]
}
if (Object.keys(manifest.exports ?? {}).some(key => key.startsWith('./src'))) {
  throw new Error('published package must not export source files')
}
if (manifest.files?.some(path => path.startsWith('upstream/') || path.startsWith('compat/generated')) === true) {
  throw new Error('published files include development-only upstream sources')
}

const patch = yaml.load(readFileSync(resolve(REPOSITORY_ROOT, 'cordis.patch.yml'), 'utf8'))
if (!Array.isArray(patch)) throw new Error('cordis.patch.yml must contain a patch array')
const expectedDisabled = new Map([
  ['agent', '@deepseek-ai/dsh-agent'],
  ['agent-presets', '@deepseek-ai/dsh-agent-presets'],
  ['session-controller', '@deepseek-ai/dsh-api-session-controller'],
])
const expectedInserted = new Map([
  ['embedded-codex-agent-registry', 'dsh-embedded-codex/compat/agent-registry'],
  ['embedded-codex-agent-presets', 'dsh-embedded-codex/compat/agent-presets'],
  ['embedded-codex-session-controller', 'dsh-embedded-codex/compat/session-controller'],
  ['embedded-codex', 'dsh-embedded-codex'],
])
for (const entry of patch) {
  if (typeof entry !== 'object' || entry === null) continue
  const row = entry as { id?: unknown; name?: unknown; disabled?: unknown; insert?: unknown }
  if (typeof row.id === 'string' && expectedDisabled.has(row.id)) {
    if (row.name !== expectedDisabled.get(row.id) || row.disabled !== true) {
      throw new Error(`Bundle does not safely disable original provider ${row.id}`)
    }
    expectedDisabled.delete(row.id)
  }
  if (!Array.isArray(row.insert)) continue
  for (const inserted of row.insert) {
    if (typeof inserted !== 'object' || inserted === null) continue
    const candidate = inserted as { id?: unknown; name?: unknown }
    if (typeof candidate.id !== 'string' || !expectedInserted.has(candidate.id)) continue
    if (candidate.name !== expectedInserted.get(candidate.id)) {
      throw new Error(`Bundle replacement ${candidate.id} has an unexpected module`)
    }
    expectedInserted.delete(candidate.id)
  }
}
if (expectedDisabled.size !== 0 || expectedInserted.size !== 0) {
  throw new Error('Bundle does not contain the complete version-checked provider replacement set')
}

const forbidden = [REPOSITORY_ROOT, UPSTREAM_ROOT, 'C:\\Users\\Admin']
const forbiddenRuntimeImports = [/(?:from|import\()\s*['"][^'"]*(?:compat\/generated|lib\/types|src\/)[^'"]*['"]/, /(?:from|import\()\s*['"][^'"]*\.ts['"]/]
const pending = [resolve(REPOSITORY_ROOT, 'lib')]
while (pending.length > 0) {
  const current = pending.pop()
  if (current === undefined) break
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name)
    if (entry.isDirectory()) pending.push(path)
    else if (entry.isFile()) {
      const bytes = readFileSync(path)
      if (bytes.includes(0)) continue
      const text = bytes.toString('utf8')
      if (forbidden.some(value => text.includes(value) || text.includes(value.replaceAll('\\', '/')))) {
        throw new Error(`built artifact contains a local absolute path: ${relative(REPOSITORY_ROOT, path).split(sep).join('/')}`)
      }
      if (path.endsWith('.js') && forbiddenRuntimeImports.some(pattern => pattern.test(text))) {
        throw new Error(`built artifact imports development-only code: ${relative(REPOSITORY_ROOT, path).split(sep).join('/')}`)
      }
    }
  }
}

verifyUpstream()
process.stdout.write('verified package exports, Bundle replacements, portability, and submodule cleanliness\n')
