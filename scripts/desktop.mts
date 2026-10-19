/** Build, launch, package, and pair the pinned DSH Desktop with this external plugin. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve } from 'node:path'
import { installDevelopmentTarball } from './lib/dev-profile.mts'
import {
  smokePackagedExternalPlugin,
  type DesktopDeliverySmokeRecord,
} from './lib/desktop-delivery-smoke.mts'
import { initializeIsolatedDesktopProfile } from './lib/desktop-profile.mts'
import { packTarball } from './lib/package.mts'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { pnpm, run } from './lib/process.mts'
import {
  withUpstreamDesktopClientBuildWorkaround,
  withUpstreamDesktopPackagingWorkaround,
} from './lib/upstream-desktop-workaround.mts'
import { prepareWindowsInstallerResources } from './lib/windows-installer-resources.mts'

const DSH_TAG = 'dsh-v0.2.0-rc.2'
const DSH_COMMIT = '639ed015397290b3745d163aafe02ffee4aa3f84'
const UPSTREAM_DESKTOP_ROOT = resolve(UPSTREAM_ROOT, 'apps/desktop')
const DESKTOP_TEMP_ROOT = resolve(REPOSITORY_ROOT, '.tmp/desktop')
const DESKTOP_DSH_HOME = resolve(DESKTOP_TEMP_ROOT, 'dsh-home')
const DESKTOP_USER_DATA = resolve(DESKTOP_TEMP_ROOT, 'electron-user-data')
const DELIVERY_ROOT = resolve(REPOSITORY_ROOT, 'dist/desktop')
const MANAGED_CLI = resolve(REPOSITORY_ROOT, 'scripts/lib/desktop-cli.mts')
const TARGETS = ['mac-arm64', 'mac-x64', 'win-x64'] as const

export type DesktopTarget = typeof TARGETS[number]
export type DesktopAction =
  | 'build'
  | 'dev'
  | 'start'
  | 'prepare'
  | 'package'
  | 'pack-plugin'
  | 'install-plugin'
  | 'remove-plugin'

export interface DesktopInvocation {
  readonly action: DesktopAction
  readonly target?: DesktopTarget
  readonly directory: boolean
  readonly unsigned: boolean
  readonly forwarded: readonly string[]
}

interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly optionalDependencies?: Readonly<Record<string, string>>
}

function isTarget(value: string): value is DesktopTarget {
  return (TARGETS as readonly string[]).includes(value)
}

export function hostDesktopTarget(platform = process.platform, arch = process.arch): DesktopTarget {
  const candidate = `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`
  if (!isTarget(candidate)) throw new Error(`Desktop packaging is unsupported on ${platform}-${arch}`)
  return candidate
}

/** Parse the stable outer command without consuming flags owned by upstream. */
export function parseDesktopInvocation(argv: readonly string[]): DesktopInvocation {
  const [rawAction, ...forwarded] = argv
  const actions: readonly DesktopAction[] = [
    'build', 'dev', 'start', 'prepare', 'package', 'pack-plugin', 'install-plugin', 'remove-plugin',
  ]
  if (rawAction === undefined || !actions.includes(rawAction as DesktopAction)) {
    throw new Error(`usage: desktop.mts <${actions.join('|')}> [target] [upstream options]`)
  }
  const action = rawAction as DesktopAction
  let target: DesktopTarget | undefined
  let expectValue = false
  for (const argument of forwarded) {
    if (expectValue) {
      expectValue = false
      continue
    }
    if (argument === '--build-version') {
      expectValue = true
      continue
    }
    if (argument.startsWith('-') || argument === '--') continue
    if (!isTarget(argument)) throw new Error(`unsupported Desktop target ${JSON.stringify(argument)}`)
    if (target !== undefined) throw new Error('select at most one Desktop target')
    target = argument
  }
  if (expectValue) throw new Error('--build-version requires a value')
  if (action !== 'package' && action !== 'prepare' && target !== undefined) {
    throw new Error(`${action} does not accept a Desktop target`)
  }
  const directory = forwarded.includes('--dir')
  const unsigned = forwarded.includes('--unsigned')
  if (unsigned && target !== 'win-x64') throw new Error('--unsigned requires explicit target win-x64')
  return { action, ...(target === undefined ? {} : { target }), directory, unsigned, forwarded }
}

/** The one upstream script selected for an outer action. */
export function upstreamDesktopScript(action: DesktopAction): string | undefined {
  switch (action) {
    case 'build': return 'build:desktop'
    case 'dev': return 'dev:desktop'
    case 'start': return 'start:desktop'
    case 'prepare': return 'prepare:desktop'
    case 'package': return 'package:desktop'
    case 'pack-plugin':
    case 'install-plugin':
    case 'remove-plugin': return undefined
  }
}

function manifest(path: string): PackageManifest {
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<PackageManifest>
  if (typeof value.name !== 'string' || typeof value.version !== 'string') {
    throw new Error(`package manifest has no identity: ${path}`)
  }
  return value as PackageManifest
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertChild(root: string, path: string, subject: string): void {
  const fromRoot = relative(resolve(root), resolve(path))
  if (fromRoot.length === 0 || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`${subject} must be a child of ${root}: ${path}`)
  }
}

async function managedDesktopDsh(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  await run(process.execPath, ['--import', 'tsx/esm', MANAGED_CLI, ...args], {
    cwd: REPOSITORY_ROOT,
    env,
  })
}

function isolatedDesktopEnvironment(): NodeJS.ProcessEnv {
  mkdirSync(DESKTOP_DSH_HOME, { recursive: true })
  mkdirSync(DESKTOP_USER_DATA, { recursive: true })
  return {
    ...process.env,
    DSH_HOME: DESKTOP_DSH_HOME,
    DSH_DESKTOP_USER_DATA_DIR: DESKTOP_USER_DATA,
  }
}

async function installIsolatedPlugin(tarball: string): Promise<NodeJS.ProcessEnv> {
  const env = isolatedDesktopEnvironment()
  initializeIsolatedDesktopProfile(DESKTOP_DSH_HOME)
  await installDevelopmentTarball(
    DESKTOP_DSH_HOME,
    tarball,
    env,
    'desktop',
    managedDesktopDsh,
  )
  await managedDesktopDsh(['plugin', '--profile', 'desktop', 'list', '--depth=0'], env)
  return env
}

type UpstreamScriptRunner = (
  script: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => Promise<void>

async function executeUpstreamScript(
  script: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await pnpm(
    ['run', script, ...(args.length === 0 ? [] : ['--', ...args])],
    { cwd, env },
  )
}

/** Build with the temporary rc.2 workaround, restore upstream, then start the long-running shell. */
export async function runUpstreamDesktopDevelopment(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  execute: UpstreamScriptRunner = executeUpstreamScript,
): Promise<void> {
  const skipBuild = args.includes('--skip-build')
  if (!skipBuild) {
    await withUpstreamDesktopClientBuildWorkaround(async () => {
      await execute('build', [], UPSTREAM_ROOT, env)
      await execute('build', [], UPSTREAM_DESKTOP_ROOT, env)
    })
  }
  await execute('start:desktop', args.filter(argument => argument !== '--skip-build'), UPSTREAM_ROOT, env)
}

async function runUpstream(script: string, args: readonly string[], env = process.env): Promise<void> {
  if (script === 'dev:desktop') {
    await runUpstreamDesktopDevelopment(args, env)
    return
  }
  const execute = async (): Promise<void> => await executeUpstreamScript(script, args, UPSTREAM_ROOT, env)
  if (script === 'prepare:desktop' || script === 'package:desktop') {
    await withUpstreamDesktopPackagingWorkaround(execute)
  } else {
    await execute()
  }
}

async function testedPluginTarball(): Promise<string> {
  await pnpm(['run', 'test'], { cwd: REPOSITORY_ROOT })
  return await packTarball()
}

async function builtPluginTarball(): Promise<string> {
  await pnpm(['run', 'build'], { cwd: REPOSITORY_ROOT })
  return await packTarball()
}

function artifactSource(target: DesktopTarget, unsigned: boolean): string {
  return resolve(
    UPSTREAM_ROOT,
    'apps/desktop/.desktop-build/targets',
    target,
    unsigned ? 'unsigned-artifacts' : 'artifacts',
  )
}

function copyPlugin(tarball: string, output: string, plugin: PackageManifest): string {
  const plugins = resolve(output, 'plugins')
  mkdirSync(plugins, { recursive: true })
  const name = `${plugin.name}-${plugin.version}.tgz`
  cpSync(tarball, resolve(plugins, name))
  return `plugins/${name}`
}

function desktopArtifacts(output: string): Array<Record<string, unknown>> {
  return readdirSync(output, { withFileTypes: true })
    .filter(entry => entry.name !== 'plugins' && entry.name !== 'integration-manifest.json' && entry.name !== 'preparation-manifest.json')
    .map((entry) => {
      const path = resolve(output, entry.name)
      return entry.isFile()
        ? { path: entry.name, type: 'file', bytes: statSync(path).size, sha256: sha256(path) }
        : { path: entry.name, type: 'directory' }
    })
}

function codexInventory(target: DesktopTarget): Record<string, unknown> {
  const require = createRequire(import.meta.url)
  const codex = manifest(require.resolve('@openai/codex/package.json'))
  const nativePackages = Object.keys(codex.optionalDependencies ?? {}).sort()
  const platform = target === 'win-x64' ? 'win32' : 'darwin'
  const arch = target === 'mac-arm64' ? 'arm64' : 'x64'
  const selected = nativePackages.find(name => name.endsWith(`-${platform}-${arch}`))
  if (selected === undefined) {
    throw new Error(`@openai/codex ${codex.version} has no optional native package for ${platform}-${arch}`)
  }
  return { version: codex.version, selectedNativePackage: selected, nativePackages }
}

function requestedBuildVersion(args: readonly string[], fallback: string): string {
  const equals = args.find(argument => argument.startsWith('--build-version='))
  if (equals !== undefined) return equals.slice('--build-version='.length)
  const index = args.indexOf('--build-version')
  return index === -1 ? fallback : args[index + 1] ?? fallback
}

function integrationRecord(
  invocation: DesktopInvocation,
  target: DesktopTarget,
  plugin: PackageManifest,
  pluginPath: string,
  output: string,
  deliverySmoke?: DesktopDeliverySmokeRecord,
): Record<string, unknown> {
  const dsh = manifest(resolve(UPSTREAM_ROOT, 'package.json'))
  const desktop = manifest(resolve(UPSTREAM_ROOT, 'apps/desktop/package.json'))
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: UPSTREAM_ROOT, encoding: 'utf8' }).trim()
  if (commit !== DSH_COMMIT || dsh.version !== '0.2.0-rc.2' || desktop.version !== dsh.version) {
    throw new Error('Desktop delivery identity does not match the pinned DSH release')
  }
  return {
    schemaVersion: 1,
    mode: 'external',
    target,
    platform: target === 'win-x64' ? 'win32' : 'darwin',
    arch: target === 'mac-arm64' ? 'arm64' : 'x64',
    directory: invocation.directory,
    signing: invocation.unsigned ? 'unsigned' : 'upstream-validated',
    dsh: { tag: DSH_TAG, commit, version: dsh.version },
    desktop: {
      version: desktop.version,
      buildVersion: requestedBuildVersion(invocation.forwarded, desktop.version),
    },
    plugin: {
      name: plugin.name,
      version: plugin.version,
      file: pluginPath,
      sha256: sha256(resolve(output, pluginPath)),
    },
    codex: codexInventory(target),
    ...(deliverySmoke === undefined ? {} : { deliverySmoke }),
    desktopArtifacts: desktopArtifacts(output),
  }
}

/** Keep unsigned Windows test output outside the signed release delivery path. */
export function desktopDeliveryOutput(invocation: DesktopInvocation, target: DesktopTarget): string {
  return invocation.unsigned
    ? resolve(DELIVERY_ROOT, 'unsigned', target)
    : resolve(DELIVERY_ROOT, target)
}

/** Keep a complete delivery available when Windows has a stale memory-mapped artifact locked. */
export function desktopDeliveryFallbackOutput(output: string, attempt = 1): string {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Desktop fallback attempt must be positive')
  return `${output}-ready${attempt === 1 ? '' : `-${attempt}`}`
}

function windowsPathIsLocked(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY')
}

function prepareDesktopDeliveryOutput(output: string): string {
  try {
    rmSync(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    mkdirSync(output, { recursive: true })
    return output
  } catch (error) {
    if (!windowsPathIsLocked(error)) throw error
    const failures: unknown[] = [error]
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      const fallback = desktopDeliveryFallbackOutput(output, attempt)
      assertChild(DELIVERY_ROOT, fallback, 'Desktop delivery fallback output')
      try {
        rmSync(fallback, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
        mkdirSync(fallback, { recursive: true })
        process.stderr.write(
          `Desktop delivery output is locked by Windows; staging the verified replacement at ${fallback}\n`,
        )
        return fallback
      } catch (fallbackError) {
        if (!windowsPathIsLocked(fallbackError)) throw fallbackError
        failures.push(fallbackError)
      }
    }
    throw new AggregateError(failures, `Windows locked every Desktop delivery fallback for ${output}`)
  }
}

function stagePreparation(invocation: DesktopInvocation, tarball: string): string {
  const target = invocation.target ?? hostDesktopTarget()
  const output = resolve(DELIVERY_ROOT, target)
  assertChild(DELIVERY_ROOT, output, 'Desktop preparation output')
  rmSync(output, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  mkdirSync(output, { recursive: true })
  const plugin = manifest(resolve(REPOSITORY_ROOT, 'package.json'))
  const pluginPath = copyPlugin(tarball, output, plugin)
  const record = integrationRecord(invocation, target, plugin, pluginPath, output)
  writeFileSync(resolve(output, 'preparation-manifest.json'), `${JSON.stringify(record, null, 2)}\n`)
  return output
}

function stageDelivery(
  invocation: DesktopInvocation,
  tarball: string,
  deliverySmoke: DesktopDeliverySmokeRecord,
): string {
  const target = invocation.target ?? hostDesktopTarget()
  const source = artifactSource(target, invocation.unsigned)
  if (!existsSync(source) || readdirSync(source).length === 0) {
    throw new Error(`upstream Desktop packaging emitted no artifacts for ${target}: ${source}`)
  }
  const canonicalOutput = desktopDeliveryOutput(invocation, target)
  assertChild(DELIVERY_ROOT, canonicalOutput, 'Desktop delivery output')
  const output = prepareDesktopDeliveryOutput(canonicalOutput)
  for (const entry of readdirSync(source)) cpSync(resolve(source, entry), resolve(output, entry), { recursive: true })
  const plugin = manifest(resolve(REPOSITORY_ROOT, 'package.json'))
  const pluginPath = copyPlugin(tarball, output, plugin)
  const record = integrationRecord(invocation, target, plugin, pluginPath, output, deliverySmoke)
  if ((record.desktopArtifacts as unknown[]).length === 0) {
    throw new Error(`Desktop delivery for ${target} has no client artifact`)
  }
  writeFileSync(resolve(output, 'integration-manifest.json'), `${JSON.stringify(record, null, 2)}\n`)
  return output
}

/** Qualify already-built artifacts with their packaged Host, then stage the external delivery. */
export async function qualifyPackagedDesktopDelivery(
  invocation: DesktopInvocation,
  tarball: string,
): Promise<string> {
  const target = invocation.target ?? hostDesktopTarget()
  const deliverySmoke = await smokePackagedExternalPlugin({
    artifacts: artifactSource(target, invocation.unsigned),
    target,
    tarball,
  })
  return stageDelivery(invocation, tarball, deliverySmoke)
}

async function runRegisteredDesktopCommand(args: readonly string[]): Promise<void> {
  const command = process.env.DSH_DESKTOP_COMMAND ?? 'dsh'
  await run(command, args, { cwd: REPOSITORY_ROOT, env: process.env })
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const invocation = parseDesktopInvocation(argv)
  switch (invocation.action) {
    case 'pack-plugin': {
      process.stdout.write(`${await builtPluginTarball()}\n`)
      return
    }
    case 'install-plugin': {
      const tarball = await builtPluginTarball()
      await runRegisteredDesktopCommand(['plugin', '--profile', 'desktop', 'add', tarball])
      await runRegisteredDesktopCommand(['plugin', '--profile', 'desktop', 'list', '--depth=0'])
      return
    }
    case 'remove-plugin':
      await runRegisteredDesktopCommand(['plugin', '--profile', 'desktop', 'remove', 'dsh-embedded-codex'])
      return
    case 'build':
      await pnpm(['run', 'build'], { cwd: REPOSITORY_ROOT })
      await runUpstream('build:desktop', invocation.forwarded)
      return
    case 'dev': {
      const tarball = await testedPluginTarball()
      const env = await installIsolatedPlugin(tarball)
      await runUpstream('dev:desktop', invocation.forwarded, env)
      return
    }
    case 'start': {
      if (!existsSync(resolve(REPOSITORY_ROOT, 'lib/index.js'))) {
        throw new Error('start:desktop requires existing plugin build output; run pnpm build:desktop first')
      }
      const env = await installIsolatedPlugin(await packTarball())
      await runUpstream('start:desktop', invocation.forwarded, env)
      return
    }
    case 'prepare': {
      const tarball = await testedPluginTarball()
      const env = await installIsolatedPlugin(tarball)
      await runUpstream('prepare:desktop', invocation.forwarded, env)
      const output = stagePreparation(invocation, tarball)
      process.stdout.write(`prepared external Desktop delivery at ${output}\n`)
      return
    }
    case 'package': {
      const tarball = await testedPluginTarball()
      const target = invocation.target ?? hostDesktopTarget()
      const env = await installIsolatedPlugin(tarball)
      const packageEnv = target === 'win-x64' && process.platform === 'win32'
        ? { ...env, ...await prepareWindowsInstallerResources() }
        : env
      await runUpstream('package:desktop', invocation.forwarded, packageEnv)
      const output = await qualifyPackagedDesktopDelivery(invocation, tarball)
      process.stdout.write(`packaged external Desktop delivery at ${output}\n`)
    }
  }
}

if (import.meta.main) await main()
