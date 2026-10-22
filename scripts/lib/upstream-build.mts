import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { flattenDiagnosticMessageText, readConfigFile, sys } from 'typescript'
import { cachedBuild, fileFingerprint, fingerprint, treeFiles } from './build-cache.mts'
import { withBuildLock } from './build-lock.mts'
import { upstreamCommit } from './compatibility.mts'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './paths.mts'
import { pnpm, type RunOptions } from './process.mts'

interface Package { name: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string>; devDependencies?: Record<string, string> }
function prerequisitePackages(integration: boolean): string[] {
  const packages = new Map<string, { path: string; manifest: Package }>()
  for (const path of globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/*/package.json'], { cwd: UPSTREAM_ROOT })) {
    const manifest = JSON.parse(readFileSync(resolve(UPSTREAM_ROOT, path), 'utf8')) as Package
    packages.set(manifest.name, { path: dirname(path), manifest })
  }
  const plugin = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8')) as Package
  const pending = [...Object.keys(plugin.devDependencies ?? {}), '@deepseek-ai/dsh-typert-generator', ...(integration ? ['@deepseek-ai/dsh'] : [])]
  const selected = new Set<string>()
  for (const name of pending) {
    const candidate = packages.get(name)
    if (!candidate || selected.has(candidate.path)) continue
    if (candidate.path.replaceAll('\\', '/').startsWith('apps/desktop')) throw new Error('Plugin prerequisites must not include Desktop')
    // CLI declares the browser distribution, but Loader/tgz checks only need Host packages.
    if (candidate.path.replaceAll('\\', '/') === 'apps/web') continue
    selected.add(candidate.path)
    pending.push(...Object.keys(candidate.manifest.dependencies ?? {}), ...Object.keys(candidate.manifest.peerDependencies ?? {}))
  }
  return [...selected].sort()
}

/** A conservative dependency identity, independent of Desktop workarounds and plugin source. */
export function upstreamBuildKey(_env: NodeJS.ProcessEnv = process.env): string {
  return fingerprint({ format: 2, commit: upstreamCommit(), node: process.version, platform: process.platform, arch: process.arch,
    files: fileFingerprint(['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/lib/upstream-build.mts'].map(path => resolve(REPOSITORY_ROOT, path))),
  })
}

/** Compile Host packages and generate Remote types before compiling and bundling Client packages. */
export async function buildPrerequisitePackages(packages: readonly string[], options: RunOptions): Promise<void> {
  const root = options.cwd
  const loaded = readConfigFile(resolve(root, 'tsconfig.host.json'), sys.readFile)
  if (loaded.error !== undefined) throw new Error(flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
  const host = loaded.config as { references: { path: string }[] }
  const selected = new Set(packages.map(path => resolve(root, path)))
  // The upstream Host aggregate names the appropriate leaf of every split package
  // and excludes Client-only projects. Keep its package selection scoped to our prerequisites.
  const hostProjects = host.references.map(({ path }) => resolve(root, path))
    .filter(path => selected.has(path.endsWith('.json') ? dirname(path) : path))
  if (hostProjects.length === 0) throw new Error('No Host projects selected for plugin prerequisites')

  const buildRoot = resolve(root, '.dsh-build')
  mkdirSync(buildRoot, { recursive: true })
  const hostProject = resolve(buildRoot, 'embedded-prerequisites.host.tsconfig.json')
  const allProject = resolve(buildRoot, 'embedded-prerequisites.tsconfig.json')
  writeFileSync(hostProject, JSON.stringify({ files: [], references: hostProjects.map(path => ({ path })) }))
  writeFileSync(allProject, JSON.stringify({ files: [], references: packages
    .filter(path => existsSync(resolve(root, path, 'tsconfig.json')))
    .map(path => ({ path: resolve(root, path) })),
  }))
  const config = resolve(buildRoot, 'embedded-prerequisites.config.mts')
  writeFileSync(config, `import { defineConfig } from 'tsdown'\nimport { typertPlugin } from '../packages/typert/generator/lib/types/tsdown-plugin.js'\nexport default defineConfig(({ env }) => { const client = env?.DSH_BUILD_FACE === 'client'; return {cwd: ${JSON.stringify(root)}, workspace: ${JSON.stringify(packages.map(path => path.replaceAll('\\', '/')))}, entry: client ? '' : ['lib/types/{index,invariant,startup}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, plugins: client ? [] : [typertPlugin({mode:'workspace',faces:['host']})]} })\n`)

  // Force repairs when emitted files are missing but tsc's incremental metadata remains.
  // Reference files also avoid Windows' command-line length limit.
  await pnpm(['exec', 'tsc', '-b', hostProject, '--force', '--pretty', 'false'], options)
  await pnpm(['exec', 'tsdown', '--config', config, '--env.DSH_BUILD_FACE', 'host'], options)
  await pnpm(['exec', 'tsc', '-b', allProject, '--force', '--pretty', 'false'], options)
  await pnpm(['exec', 'tsdown', '--config', config, '--env.DSH_BUILD_FACE', 'client'], options)
}

/** Compile only package prerequisites; never invoke DSH's root or Electron build. */
export async function ensureUpstreamBuild(env: NodeJS.ProcessEnv = process.env, integration = false): Promise<string> {
  return withBuildLock(resolve(REPOSITORY_ROOT, '.tmp/upstream-prerequisites.lock'), async () => {
    const packages = prerequisitePackages(integration)
    const key = fingerprint({ key: upstreamBuildKey(env), packages })
    const required = packages.map(path => {
      const pkg = JSON.parse(readFileSync(resolve(UPSTREAM_ROOT, path, 'package.json'), 'utf8'))
      return resolve(UPSTREAM_ROOT, path, pkg.module ?? pkg.main ?? Object.values(pkg.bin ?? {})[0] ?? 'lib/index.js')
    })
    await cachedBuild({ label: integration ? 'DSH integration prerequisites' : 'DSH plugin prerequisites',
      stamp: resolve(REPOSITORY_ROOT, integration ? '.tmp/integration-prerequisites.json' : '.tmp/plugin-prerequisites.json'), key, required,
      build: async () => {
        const options = { cwd: UPSTREAM_ROOT, env: { ...env, CI: 'true' } }
        await buildPrerequisitePackages(packages, options)
        return packages.flatMap(path => treeFiles(resolve(UPSTREAM_ROOT, path, 'lib')))
      },
    })
    return key
  })
}
