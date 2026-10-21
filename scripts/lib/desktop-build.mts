import { execFileSync } from 'node:child_process'
import { existsSync, globSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { relative, resolve, isAbsolute } from 'node:path'
import { cachedBuild, fileFingerprint, fingerprint, treeFiles } from './build-cache.mts'
import { withBuildLock } from './build-lock.mts'
import { upstreamCommit } from './compatibility.mts'
import { DESKTOP_BUILD_ROOT, REPOSITORY_ROOT, UPSTREAM_ROOT } from './paths.mts'
import { pnpm } from './process.mts'
import { applyDesktopBuildPatches } from './upstream-desktop-workaround.mts'

export const desktopLock = resolve(REPOSITORY_ROOT, '.tmp/desktop-source.lock')

export function desktopBuildKey(env: NodeJS.ProcessEnv): string {
  return fingerprint({
    commit: upstreamCommit(), node: process.version, platform: process.platform, arch: process.arch,
    patches: fileFingerprint(['compat/desktop-build.json', 'scripts/lib/desktop-build.mts',
      'scripts/lib/upstream-desktop-workaround.mts'].map(path => resolve(REPOSITORY_ROOT, path))),
    environment: Object.entries(env).filter(([name]) => name.startsWith('DSH_CLIENT_')
      || name === 'DSH_BUILD_CLIENT_PROFILE' || name === 'NODE_ENV').sort(([a], [b]) => a.localeCompare(b)),
  })
}

function assertPrivateCheckout(): void {
  const child = relative(resolve(REPOSITORY_ROOT, '.tmp'), DESKTOP_BUILD_ROOT)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Unsafe Desktop build checkout')
}

/** Build from the staged baseline with a fixed upstream lockfile and private writable dependencies. */
export async function ensureDesktopBuild(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return withBuildLock(desktopLock, async () => {
    const key = desktopBuildKey(env)
    const commit = upstreamCommit()
    const options = { cwd: DESKTOP_BUILD_ROOT, env: { ...env, CI: 'true' } }
    const sourceKey = fingerprint({ commit, patches: fileFingerprint([
      resolve(REPOSITORY_ROOT, 'compat/desktop-build.json'),
      resolve(REPOSITORY_ROOT, 'scripts/lib/upstream-desktop-workaround.mts'),
    ]) })
    await cachedBuild({ label: 'Desktop private checkout', stamp: resolve(REPOSITORY_ROOT, '.tmp/desktop-source.json'),
      key: sourceKey, required: [resolve(DESKTOP_BUILD_ROOT, 'node_modules/.modules.yaml')],
      build: async () => {
        assertPrivateCheckout()
        rmSync(DESKTOP_BUILD_ROOT, { recursive: true, force: true })
        mkdirSync(resolve(REPOSITORY_ROOT, '.tmp'), { recursive: true })
        execFileSync('git', ['clone', '--no-hardlinks', '--no-checkout', UPSTREAM_ROOT, DESKTOP_BUILD_ROOT], {
          cwd: REPOSITORY_ROOT, stdio: 'inherit', windowsHide: true,
        })
        execFileSync('git', ['-c', `core.hooksPath=${resolve(DESKTOP_BUILD_ROOT, '.git/no-hooks')}`, 'checkout', '--detach', commit], {
          cwd: DESKTOP_BUILD_ROOT, stdio: 'inherit', windowsHide: true,
        })
        const lock = readFileSync(resolve(DESKTOP_BUILD_ROOT, 'pnpm-lock.yaml'))
        await pnpm(['install', '--frozen-lockfile', '--prefer-offline',
          '--config.package-import-method=copy', '--config.enable-global-virtual-store=false'], options)
        if (!lock.equals(readFileSync(resolve(DESKTOP_BUILD_ROOT, 'pnpm-lock.yaml')))) throw new Error('Desktop install changed its fixed lockfile')
        applyDesktopBuildPatches(DESKTOP_BUILD_ROOT)
        return [resolve(DESKTOP_BUILD_ROOT, 'node_modules/.modules.yaml'), resolve(DESKTOP_BUILD_ROOT, 'pnpm-lock.yaml')]
      },
    })
    const required = ['apps/desktop/lib/main.js', 'apps/desktop/lib/welcome/welcome.js',
      'apps/desktop-host/lib/index.js', 'apps/cli/lib/bin.js', 'apps/web/dist/index.html',
      '.dsh-build/client-build-environment.json'].map(path => resolve(DESKTOP_BUILD_ROOT, path))
    await cachedBuild({ label: 'Desktop build', stamp: resolve(REPOSITORY_ROOT, '.tmp/desktop-build.json'), key, required,
      build: async () => {
        await pnpm(['run', 'build'], options)
        await pnpm(['exec', 'tsc', '-b'], { ...options, cwd: resolve(DESKTOP_BUILD_ROOT, 'apps/desktop') })
        return [...required, ...globSync(['apps/*/lib', 'apps/*/dist', 'packages/*/*/lib', 'vendor/*/lib'], { cwd: DESKTOP_BUILD_ROOT }).flatMap(path => treeFiles(resolve(DESKTOP_BUILD_ROOT, path)))]
      },
    })
    if (!existsSync(required[0]!)) throw new Error('Desktop main bundle is missing')
    return key
  })
}
