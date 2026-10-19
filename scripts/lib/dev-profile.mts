import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { runDsh } from './dsh.mts'
import { REPOSITORY_ROOT } from './paths.mts'

const PLUGIN_NAME = 'dsh-embedded-codex'
const TEMP_ROOT = resolve(REPOSITORY_ROOT, '.tmp')

export type DevelopmentProfile = 'desktop' | 'web'
export type DevelopmentProfileRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>

interface ProfileManifest {
  readonly dependencies?: Readonly<Record<string, string>>
}

function comparablePath(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function profilePaths(home: string, profile: DevelopmentProfile = 'web'): {
  readonly manifest: string
  readonly modules: string
  readonly plugin: string
  readonly root: string
} {
  const resolvedHome = resolve(home)
  const homeFromTemp = relative(TEMP_ROOT, resolvedHome)
  if (homeFromTemp.length === 0 || homeFromTemp.startsWith('..') || isAbsolute(homeFromTemp)) {
    throw new Error(`development Profile home must be a child of ${TEMP_ROOT}: ${resolvedHome}`)
  }
  const root = resolve(resolvedHome, `profiles/${profile}`)
  const modules = resolve(root, 'node_modules')
  if (relative(root, modules) !== 'node_modules') {
    throw new Error(`refusing to use unsafe development Profile modules path: ${modules}`)
  }
  return {
    manifest: resolve(root, 'package.json'),
    modules,
    plugin: resolve(modules, PLUGIN_NAME),
    root,
  }
}

function linkedPath(specifier: string, profileRoot: string): string | undefined {
  if (!specifier.startsWith('link:')) return undefined
  const target = specifier.slice('link:'.length)
  return target.length === 0 ? undefined : resolve(profileRoot, target)
}

/** Whether the Web Profile already points at this checkout and exposes its package link. */
export function hasDevelopmentLink(home: string, profile: DevelopmentProfile = 'web'): boolean {
  const paths = profilePaths(home, profile)
  if (!existsSync(paths.manifest) || !existsSync(paths.plugin)) return false
  try {
    const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8')) as ProfileManifest
    const specifier = manifest.dependencies?.[PLUGIN_NAME]
    if (specifier === undefined) return false
    const declared = linkedPath(specifier, paths.root)
    if (declared === undefined
      || comparablePath(declared) !== comparablePath(REPOSITORY_ROOT)) return false
    return comparablePath(realpathSync(paths.plugin)) === comparablePath(realpathSync(REPOSITORY_ROOT))
  } catch {
    return false
  }
}

/** Remove only the reproducible dependency tree of one repository-owned temporary Profile. */
export function resetDevelopmentProfileModules(home: string, profile: DevelopmentProfile = 'web'): void {
  const { modules } = profilePaths(home, profile)
  try {
    rmSync(modules, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (error: unknown) {
    throw new Error(
      `cannot rebuild ${modules}; stop the running DSH ${profile} process and retry`,
      { cause: error },
    )
  }
}

/** Register this checkout once; later builds are visible through the stable link without pnpm. */
export async function ensureDevelopmentLink(
  home: string,
  env: NodeJS.ProcessEnv,
  profile: DevelopmentProfile = 'web',
  runner: DevelopmentProfileRunner = runDsh,
): Promise<boolean> {
  if (hasDevelopmentLink(home, profile)) return false
  resetDevelopmentProfileModules(home, profile)
  await runner(['plugin', '--profile', profile, 'add', 'link:.', '--config.prefer-offline=true'], env)
  if (!hasDevelopmentLink(home, profile)) {
    throw new Error('DSH reported success but did not create the expected development plugin link')
  }
  return true
}

/** Perform an explicit publication-faithful install after avoiding pnpm's hoisted reinstall bug. */
export async function installDevelopmentTarball(
  home: string,
  tarball: string,
  env: NodeJS.ProcessEnv,
  profile: DevelopmentProfile = 'web',
  runner: DevelopmentProfileRunner = runDsh,
): Promise<void> {
  resetDevelopmentProfileModules(home, profile)
  await runner(['plugin', '--profile', profile, 'add', tarball, '--config.prefer-offline=true'], env)
}
