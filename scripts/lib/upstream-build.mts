import { existsSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cachedBuild, fileFingerprint, fingerprint, treeFiles } from './build-cache.mts'
import { withBuildLock } from './build-lock.mts'
import { upstreamCommit } from './compatibility.mts'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './paths.mts'
import { pnpm } from './process.mts'

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
        const projects = packages.filter(path => existsSync(resolve(UPSTREAM_ROOT, path, 'tsconfig.json')))
        const projectFile = resolve(UPSTREAM_ROOT, '.dsh-build/embedded-prerequisites.tsconfig.json')
        mkdirSync(dirname(projectFile), { recursive: true })
        writeFileSync(projectFile, JSON.stringify({
          files: [], references: projects.map(path => ({ path: `../${path.replaceAll('\\', '/')}` })),
        }))
        // A missing output must be regenerated even if tsc's incremental metadata survived.
        // A reference file also avoids Windows' command-line length limit for integration prerequisites.
        await pnpm(['exec', 'tsc', '-b', projectFile, '--force', '--pretty', 'false'], options)
        const config = resolve(UPSTREAM_ROOT, '.dsh-build/embedded-prerequisites.config.mts')
        mkdirSync(dirname(config), { recursive: true })
        writeFileSync(config, `import { defineConfig } from 'tsdown'\nimport { typertPlugin } from '../packages/typert/generator/lib/types/tsdown-plugin.js'\nexport default defineConfig({cwd: ${JSON.stringify(UPSTREAM_ROOT)}, workspace: ${JSON.stringify(packages.map(path => path.replaceAll('\\', '/')))}, entry: ['lib/types/{index,invariant,startup}.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, plugins: [typertPlugin({mode:'workspace',faces:['host']})]})\n`)
        await pnpm(['exec', 'tsdown', '--config', config, '--env.DSH_BUILD_FACE', 'host'], options)
        return packages.flatMap(path => treeFiles(resolve(UPSTREAM_ROOT, path, 'lib')))
      },
    })
    return key
  })
}
