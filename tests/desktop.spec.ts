import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hostDesktopTarget,
  desktopDeliveryOutput,
  desktopDeliveryFallbackOutput,
  parseDesktopInvocation,
  runUpstreamDesktopDevelopment,
  upstreamDesktopScript,
} from '../scripts/desktop.mts'
import {
  patchUpstreamDesktopClientBuildSource,
  patchUpstreamDesktopBuilderSource,
  patchUpstreamDesktopPackageSource,
  patchUpstreamDesktopRuntimeSource,
  electronBuilderNodeModulesCollectorPath,
  electronBuilderPnpmCollectorPath,
  patchElectronBuilderNodeModulesCollectorSource,
  patchElectronBuilderPnpmCollectorSource,
} from '../scripts/lib/upstream-desktop-workaround.mts'
import { patchUpstreamCleanSource } from '../scripts/lib/upstream-clean-workaround.mts'

const root = resolve(import.meta.dirname, '..')
const packageManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>
}
const source = readFileSync(resolve(root, 'scripts/desktop.mts'), 'utf8')
const workspaceSource = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')

describe('Desktop orchestration contract', () => {
  it('makes Electron the default and exposes the complete target matrix', () => {
    expect(packageManifest.scripts.dev).toBe('pnpm run dev:desktop')
    expect(packageManifest.scripts).toMatchObject({
      'build:desktop': 'tsx scripts/desktop.mts build',
      'dev:desktop': 'tsx scripts/desktop.mts dev',
      'start:desktop': 'tsx scripts/desktop.mts start',
      'prepare:desktop': 'tsx scripts/desktop.mts prepare',
      'package:desktop': 'tsx scripts/desktop.mts package',
      'package:desktop:dir': 'tsx scripts/desktop.mts package --dir',
      'package:desktop:mac:arm64': 'tsx scripts/desktop.mts package mac-arm64',
      'package:desktop:mac:arm64:dir': 'tsx scripts/desktop.mts package mac-arm64 --dir',
      'package:desktop:mac:x64': 'tsx scripts/desktop.mts package mac-x64',
      'package:desktop:mac:x64:dir': 'tsx scripts/desktop.mts package mac-x64 --dir',
      'package:desktop:win:x64': 'tsx scripts/desktop.mts package win-x64',
      'package:desktop:win:x64:unsigned': 'tsx scripts/desktop.mts package win-x64 --unsigned',
      'package:desktop:win:x64:dir': 'tsx scripts/desktop.mts package win-x64 --dir',
      'pack:plugin': 'tsx scripts/desktop.mts pack-plugin',
      'desktop:install-plugin': 'tsx scripts/desktop.mts install-plugin',
      'desktop:remove-plugin': 'tsx scripts/desktop.mts remove-plugin',
    })
  })

  it('preserves target, directory, signing, and build-version arguments', () => {
    const args = ['package', 'win-x64', '--unsigned', '--build-version', '0.2.0-rc.2.7']
    expect(parseDesktopInvocation(args)).toEqual({
      action: 'package',
      target: 'win-x64',
      directory: false,
      unsigned: true,
      forwarded: args.slice(1),
    })
    expect(parseDesktopInvocation(['package', 'mac-arm64', '--dir'])).toMatchObject({
      target: 'mac-arm64', directory: true, unsigned: false,
    })
    expect(() => parseDesktopInvocation(['package', 'mac-x64', '--unsigned'])).toThrow('--unsigned')
  })

  it('forwards each lifecycle to one matching upstream command and never falls back to Web', () => {
    expect(upstreamDesktopScript('build')).toBe('build:desktop')
    expect(upstreamDesktopScript('dev')).toBe('dev:desktop')
    expect(upstreamDesktopScript('start')).toBe('start:desktop')
    expect(upstreamDesktopScript('prepare')).toBe('prepare:desktop')
    expect(upstreamDesktopScript('package')).toBe('package:desktop')
    expect(source).not.toContain("['web']")
    expect(source).not.toContain('profiles/web')
    expect(source).not.toMatch(/runDsh\(\[['"]web['"]/)
  })

  it('rejects unsupported host targets deterministically', () => {
    expect(hostDesktopTarget('win32', 'x64')).toBe('win-x64')
    expect(hostDesktopTarget('darwin', 'arm64')).toBe('mac-arm64')
    expect(() => hostDesktopTarget('linux', 'x64')).toThrow('unsupported')
  })

  it('keeps unsigned Windows artifacts outside the formal release directory', () => {
    const signed = parseDesktopInvocation(['package', 'win-x64'])
    const unsigned = parseDesktopInvocation(['package', 'win-x64', '--unsigned'])
    expect(desktopDeliveryOutput(signed, 'win-x64')).toMatch(/dist[\\/]desktop[\\/]win-x64$/u)
    expect(desktopDeliveryOutput(unsigned, 'win-x64')).toMatch(
      /dist[\\/]desktop[\\/]unsigned[\\/]win-x64$/u,
    )
    expect(desktopDeliveryFallbackOutput(desktopDeliveryOutput(unsigned, 'win-x64'))).toMatch(
      /dist[\\/]desktop[\\/]unsigned[\\/]win-x64-ready$/u,
    )
    expect(desktopDeliveryFallbackOutput(desktopDeliveryOutput(unsigned, 'win-x64'), 2)).toMatch(
      /dist[\\/]desktop[\\/]unsigned[\\/]win-x64-ready-2$/u,
    )
  })

  it('preserves packaged Desktop artifacts during an upstream core rebuild', () => {
    const upstreamCleaner = readFileSync(resolve(root, 'upstream/deepseek-harness/scripts/clean.ts'), 'utf8')
    const patched = patchUpstreamCleanSource(upstreamCleaner)
    expect(patched).toContain("process.env.DSH_PRESERVE_DESKTOP_BUILD !== '1'")
    expect(patched).not.toBe(upstreamCleaner)
  })

  it('guards the pinned upstream parallel CSS build against virtual-id queries', () => {
    const upstreamConfig = readFileSync(resolve(
      root,
      'upstream/deepseek-harness/packages/client/tsdown.client.ts',
    ), 'utf8')
    const patched = patchUpstreamDesktopClientBuildSource(upstreamConfig)
    expect(patched).toContain('function virtualCssAssetPath(')
    expect(patched).toContain(
      'virtualCssAssetPath(virtualId, INLINE_CSS_VIRTUAL_PREFIX)',
    )
    expect(patched).toContain('virtualCssRequestsText(virtualId)')
    expect(patched).toContain('virtualCssAssetPath(id, prefix)')
    expect(patched).not.toBe(upstreamConfig)
  })

  it('restores the parallel CSS workaround before Desktop dev becomes long-running', async () => {
    const upstreamConfigPath = resolve(
      root,
      'upstream/deepseek-harness/packages/client/tsdown.client.ts',
    )
    const upstreamConfig = readFileSync(upstreamConfigPath, 'utf8')
    const calls: Array<{ readonly script: string; readonly patched: boolean }> = []
    await runUpstreamDesktopDevelopment([], process.env, async (script) => {
      calls.push({
        script,
        patched: readFileSync(upstreamConfigPath, 'utf8').includes('function virtualCssAssetPath('),
      })
    })
    expect(calls).toEqual([
      { script: 'build', patched: true },
      { script: 'build', patched: true },
      { script: 'start:desktop', patched: false },
    ])
    expect(readFileSync(upstreamConfigPath, 'utf8')).toBe(upstreamConfig)
  })

  it('can skip the bounded Desktop development rebuild without forwarding the private flag', async () => {
    const calls: Array<{ readonly script: string; readonly args: readonly string[] }> = []
    await runUpstreamDesktopDevelopment(['--skip-build'], process.env, async (script, args) => {
      calls.push({ script, args })
    })
    expect(calls).toEqual([{ script: 'start:desktop', args: [] }])
  })

  it('uses the integration toolchain without exposing a recursive upstream node_modules root', () => {
    const upstreamPackage = readFileSync(resolve(root, 'upstream/deepseek-harness/package.json'), 'utf8')
    const patched = patchUpstreamDesktopPackageSource(upstreamPackage)
    expect(patched).toContain(
      'node --max-old-space-size=4096 ../../node_modules/typescript/bin/tsc -b tsconfig.host.json',
    )
    expect(patched).not.toContain(
      'node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc',
    )
    expect(patched).toContain(
      'node ../../node_modules/tsdown/dist/run.mjs --env.DSH_BUILD_FACE client',
    )
    expect(patched).not.toContain(
      '&& tsdown --env.DSH_BUILD_FACE client',
    )
    expect(workspaceSource).toContain('electron: 44.0.0')
  })

  it('tolerates only the verified Electron Node Windows shutdown race', () => {
    const upstreamRuntime = readFileSync(resolve(
      root,
      'upstream/deepseek-harness/apps/desktop/scripts/prepare-dsh.ts',
    ), 'utf8')
    const patched = patchUpstreamDesktopRuntimeSource(upstreamRuntime)
    expect(patched).toContain("process.platform === 'win32' && code === 0x80000003")
    expect(patched).toContain('if (code === 0 || windowsNodeShutdownRace)')
    expect(patched).not.toBe(upstreamRuntime)
  })

  it('skips the PowerShell installer wrapper only for verified outer resources', () => {
    const upstreamBuilder = readFileSync(resolve(
      root,
      'upstream/deepseek-harness/apps/desktop/scripts/electron-builder-config.mjs',
    ), 'utf8')
    const patched = patchUpstreamDesktopBuilderSource(upstreamBuilder)
    expect(patched).toContain(
      "if (env.DSH_EMBEDDED_CODEX_WINDOWS_INSTALLER_READY !== '1') await promisify(execFile)",
    )
    expect(patched).not.toBe(upstreamBuilder)
  })

  it('runs the pinned electron-builder pnpm collector without Windows PowerShell', () => {
    const collector = readFileSync(electronBuilderNodeModulesCollectorPath(), 'utf8')
    const patched = patchElectronBuilderNodeModulesCollectorSource(collector)
    expect(patched).toContain('execName.toLowerCase() === "pnpm"')
    expect(patched).toContain('[process.execPath, [pnpmCli, ...args]]')
    expect(patched).toContain('pnpmCli === undefined')
    expect(patched).not.toBe(collector)
  })

  it('resolves pnpm workspace-relative virtual-store paths before packaging', () => {
    const collector = readFileSync(electronBuilderPnpmCollectorPath(), 'utf8')
    const patched = patchElectronBuilderPnpmCollectorSource(collector)
    expect(patched).toContain('!path.isAbsolute(parentPath)')
    expect(patched).toContain('entry.startsWith(`${virtualName}_`)')
    expect(patched).toContain('path.join(".pnpm", entry, "node_modules", packageSuffix)')
    expect(patched).toContain('this.cache.semverSatisfies(packageJson.version, requiredRange)')
    expect(patched).not.toBe(collector)
  })
})
