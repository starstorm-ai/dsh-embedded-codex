/** Regenerate the flat compatibility patch set from materialized edited sources. */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { GENERATED_ROOT, REPOSITORY_ROOT, UPSTREAM_ROOT } from '../lib/paths.mts'

const SOURCE_ROOTS = [
  'packages/boot/config-editor/src',
  'packages/core/agent/src',
  'packages/preset/agent-preset-registry/src',
  'packages/api/session-controller/src',
  'packages/interaction/permission-presets/src',
  'packages/client/ui-permission-presets/src',
] as const

function filesUnder(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    if (!entry.isFile()) throw new Error(`unsupported compatibility source entry: ${path}`)
    return [path]
  })
}

const changed = SOURCE_ROOTS.flatMap((root) => filesUnder(resolve(GENERATED_ROOT, root)))
  .map(path => relative(GENERATED_ROOT, path).split(sep).join('/'))
  .filter(path => existsSync(resolve(UPSTREAM_ROOT, path)))
  .filter((path) => {
    const generated = readFileSync(resolve(GENERATED_ROOT, path))
    const upstream = readFileSync(resolve(UPSTREAM_ROOT, path))
    return !generated.equals(upstream)
  })
  .sort()

if (changed.length === 0) throw new Error('no compatibility source changes were found')
const patchRoot = resolve(REPOSITORY_ROOT, 'compat/patches')
for (const entry of readdirSync(patchRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.patch')) {
    throw new Error(`compat/patches contains an unsupported entry: ${entry.name}`)
  }
  rmSync(resolve(patchRoot, entry.name))
}

for (const target of changed) {
  const upstream = resolve(UPSTREAM_ROOT, target)
  const generated = resolve(GENERATED_ROOT, target)
  const result = spawnSync('git', [
    'diff', '--no-index', '--no-ext-diff', '--unified=3', '--', upstream, generated,
  ], { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true })
  if (result.status !== 1 || result.error !== undefined || result.stdout.length === 0) {
    throw result.error ?? new Error(`cannot generate compatibility patch for ${target}: ${result.stderr}`)
  }
  let oldHeader = false
  let newHeader = false
  const normalized = result.stdout.split('\n').map((line) => {
    if (line.startsWith('diff --git ')) return `diff --git a/${target} b/${target}`
    if (line.startsWith('--- ')) {
      oldHeader = true
      return `--- a/${target}`
    }
    if (line.startsWith('+++ ')) {
      newHeader = true
      return `+++ b/${target}`
    }
    return line
  }).join('\n')
  if (!oldHeader || !newHeader) throw new Error(`git omitted file headers for ${target}`)
  if (!normalized.startsWith(`diff --git a/${target} b/${target}\n`)) {
    throw new Error(`git emitted unexpected patch headers for ${target}`)
  }
  const name = `${target.replaceAll('/', '+')}.patch`
  writeFileSync(resolve(patchRoot, name), normalized, 'utf8')
}

process.stdout.write(`updated ${String(changed.length)} compatibility patches\n`)
