import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { GENERATED_ROOT, REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { readUpstreamLock, verifyUpstream } from './lib/upstream.mts'

const ALLOWED_PATCH_FILES = new Set([
  'packages/core/agent/src/index.ts',
  'packages/preset/agent-presets/src/index.ts',
  'packages/api/session-controller/src/agent.ts',
  'packages/api/session-controller/src/client/sessions/manager.ts',
  'packages/api/session-controller/src/client/sessions/session.ts',
  'packages/api/session-controller/src/client/transport.ts',
  'packages/api/session-controller/src/commands.ts',
])

function assertGeneratedRoot(): void {
  const expected = resolve(REPOSITORY_ROOT, 'compat/generated')
  if (GENERATED_ROOT !== expected || relative(REPOSITORY_ROOT, GENERATED_ROOT).startsWith('..')) {
    throw new Error(`refusing to replace unsafe generated path: ${GENERATED_ROOT}`)
  }
}

function patchTargets(path: string): string[] {
  return [...readFileSync(path, 'utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1]!)
}

function applyPatches(): void {
  const patchRoot = resolve(REPOSITORY_ROOT, 'compat/patches')
  const patches = readdirSync(patchRoot)
    .filter(name => name.endsWith('.patch'))
    .sort()
  if (patches.length !== 4) throw new Error(`expected four compatibility patches, found ${String(patches.length)}`)
  for (const name of patches) {
    const path = resolve(patchRoot, name)
    const targets = patchTargets(path)
    if (targets.length === 0) throw new Error(`${name} changes no files`)
    for (const target of targets) {
      if (!ALLOWED_PATCH_FILES.has(target)) throw new Error(`${name} changes disallowed path ${target}`)
    }
    execFileSync('git', [
      'apply',
      '--whitespace=error-all',
      `--directory=${relative(REPOSITORY_ROOT, GENERATED_ROOT).split(sep).join('/')}`,
      path,
    ], { cwd: REPOSITORY_ROOT, stdio: 'inherit', windowsHide: true })
  }
}

function assertPortableGeneratedSources(): void {
  const forbidden = [UPSTREAM_ROOT, UPSTREAM_ROOT.replaceAll('\\', '/')]
  const pending = [GENERATED_ROOT]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) {
        const text = readFileSync(path, 'utf8')
        if (forbidden.some(value => text.includes(value))) {
          throw new Error(`generated source contains an absolute submodule path: ${path}`)
        }
      }
    }
  }
}

verifyUpstream()
assertGeneratedRoot()
rmSync(GENERATED_ROOT, { recursive: true, force: true })
mkdirSync(GENERATED_ROOT, { recursive: true })
const lock = readUpstreamLock()
for (const sourceFile of Object.keys(lock.sourceFiles)) {
  const target = resolve(GENERATED_ROOT, sourceFile)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(resolve(UPSTREAM_ROOT, sourceFile), target)
}
const presetRoot = 'packages/preset/agent-presets/presets/'
for (const assetFile of Object.keys(lock.assetFiles)) {
  if (!assetFile.startsWith(presetRoot)) throw new Error(`unsupported compatibility asset: ${assetFile}`)
  const target = resolve(REPOSITORY_ROOT, 'lib/presets', assetFile.slice(presetRoot.length))
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(resolve(UPSTREAM_ROOT, assetFile), target)
}
applyPatches()
assertPortableGeneratedSources()
verifyUpstream()
process.stdout.write('materialized version-locked compatibility providers\n')
