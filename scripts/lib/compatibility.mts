import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import manifest from '../../compat/manifest.json' with { type: 'json' }
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './paths.mts'

export { manifest }
export const sourceRoots = manifest.providers.map(provider => provider.sourceRoot)
export const packageArtifacts = [...manifest.artifacts, ...manifest.providers.flatMap(provider => provider.artifacts)]

/** The parent's staged gitlink is the sole baseline, including a staged upgrade. */
export function upstreamCommit(): string {
  const entry = execFileSync('git', ['ls-files', '--stage', '--', 'upstream/deepseek-harness'], {
    cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true,
  }).trim()
  const match = /^160000 ([0-9a-f]{40}) 0\tupstream\/deepseek-harness$/.exec(entry)
  if (!match) throw new Error('DSH requires one unconflicted stage-0 submodule gitlink in the parent index')
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: UPSTREAM_ROOT, encoding: 'utf8', windowsHide: true,
  }).trim()
  if (commit !== match[1]) throw new Error(`DSH checkout ${commit} does not match staged gitlink ${match[1]}`)
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
    cwd: UPSTREAM_ROOT, encoding: 'utf8', windowsHide: true,
  }).trim()
  if (changes) throw new Error('DSH reference checkout has tracked changes; compatibility requires the unchanged staged baseline')
  for (const provider of manifest.providers) {
    const pkg = JSON.parse(readFileSync(resolve(UPSTREAM_ROOT, provider.sourceRoot, '../package.json'), 'utf8'))
    if (pkg.name !== provider.package || pkg.version !== manifest.dshVersion) {
      throw new Error(`compatibility manifest disagrees with ${provider.package} at ${commit}`)
    }
  }
  return commit
}

export function generateRuntimeManifest(): void {
  upstreamCommit()
  const content = `// Generated from compat/manifest.json by scripts/lib/compatibility.mts.\n`
    + `export const compatibilityManifest = ${JSON.stringify(manifest, null, 2)} as const\n`
  const target = resolve(REPOSITORY_ROOT, 'src/compat/generated-manifest.ts')
  let existing: string | undefined
  try { existing = readFileSync(target, 'utf8') } catch { /* First build. */ }
  if (existing !== content) writeFileSync(target, content)
}
