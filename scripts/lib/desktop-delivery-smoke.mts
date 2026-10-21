/** Qualify an external plugin with the exact command and Host runtime carried by a packaged Desktop. */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { desktopHostSource } from './desktop-source.mts'
import type { DesktopHostProcess } from './desktop-source.mts'
import { manifest as compatibility } from './compatibility.mts'
import { installDevelopmentTarball } from './dev-profile.mts'
import { initializeIsolatedDesktopProfile } from './desktop-profile.mts'
import { REPOSITORY_ROOT } from './paths.mts'
import { capture, run } from './process.mts'

const PLUGIN_NAME = 'dsh-embedded-codex'
const EXPECTED_DSH_VERSION = compatibility.dshVersion
const SMOKE_ROOT = resolve(REPOSITORY_ROOT, '.tmp/desktop/delivery-smoke')
const PACKAGED_DEPENDENCY_PROBE = resolve(import.meta.dirname, 'verify-packaged-dependencies.cjs')

export type DesktopDeliverySmokeTarget = 'mac-arm64' | 'mac-x64' | 'win-x64'

export interface DesktopDeliverySmokeRecord {
  readonly carrier: 'packaged-desktop-command'
  readonly profile: 'desktop'
  readonly dshVersion: string
  readonly pluginVersion: string
  readonly mainDependenciesReady: true
  readonly hostReady: true
  readonly frontendReady: true
  readonly presetSwitchingReady: true
  readonly removeVerified: true
}

interface PackagedDesktopLayout {
  readonly executable: string
  readonly resources: string
  readonly runtimeDir: string
  readonly supportDir: string
}

interface ProfileManifest {
  readonly dependencies?: Readonly<Record<string, string>>
}

function assertChild(root: string, path: string, subject: string): void {
  const fromRoot = relative(resolve(root), resolve(path))
  if (fromRoot.length === 0 || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`${subject} must be a child of ${root}: ${path}`)
  }
}

function packagedDesktopLayout(
  artifacts: string,
  target: DesktopDeliverySmokeTarget,
): PackagedDesktopLayout {
  const application = target === 'win-x64'
    ? join(artifacts, 'win-unpacked')
    : join(
        artifacts,
        target === 'mac-arm64' ? 'mac-arm64' : 'mac',
        'DeepSeek Harness.app',
        'Contents',
      )
  const resources = join(application, target === 'win-x64' ? 'resources' : 'Resources')
  const executable = target === 'win-x64'
    ? join(application, 'DeepSeek Harness.exe')
    : join(application, 'MacOS', 'DeepSeek Harness')
  for (const [label, path] of [
    ['Desktop executable', executable],
    ['Desktop application archive', join(resources, 'app.asar')],
    ['Desktop support runtime', join(resources, 'runtime')],
  ] as const) {
    if (!existsSync(path)) throw new Error(`${label} is missing from packaged artifacts: ${path}`)
  }
  return {
    executable,
    resources,
    runtimeDir: join(resources, 'app.asar', 'dsh'),
    supportDir: join(resources, 'runtime'),
  }
}

function packagedCliArguments(layout: PackagedDesktopLayout, args: readonly string[]): string[] {
  return [
    '--expose-internals',
    join(
      layout.runtimeDir,
      'node_modules',
      '@deepseek-ai',
      'dsh-desktop-host',
      'lib',
      'cli.js',
    ),
    ...args,
  ]
}

function packagedNodeEnvironment(
  layout: PackagedDesktopLayout,
  home: string,
  userData: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_USER_DATA_DIR: userData,
    DSH_DESKTOP_NODE_EXECUTABLE: layout.executable,
    ELECTRON_RUN_AS_NODE: '1',
  }
}

function profileManifest(profile: string): ProfileManifest {
  return JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as ProfileManifest
}

function installedPluginVersion(profile: string): string {
  const path = join(profile, 'node_modules', PLUGIN_NAME, 'package.json')
  const value = JSON.parse(readFileSync(path, 'utf8')) as { readonly version?: unknown }
  if (typeof value.version !== 'string' || value.version === '') {
    throw new Error(`packaged Desktop installed plugin has no version: ${path}`)
  }
  return value.version
}

async function assertPackagedFrontend(readyUrl: string): Promise<string> {
  const login = await fetch(readyUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const response = await fetch(new URL('/', readyUrl), {
    headers: { cookie },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status !== 200 || !(await response.text()).includes('<html')) {
    throw new Error('packaged Desktop external-plugin smoke could not load the application frontend')
  }
  return cookie
}

/** Exercise the UI's actual Remote endpoints with the production service scopes, without a model turn. */
async function assertPackagedPresetSwitches(readyUrl: string, cookie: string, cwd: string): Promise<void> {
  const invoke = async (method: string, args: object): Promise<unknown> => {
    const rpcId = randomUUID()
    const response = await fetch(new URL(`/api/${method}`, readyUrl), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`packaged Desktop ${method} returned HTTP ${response.status}`)
    const envelope = await response.json() as { rpcId: string; result: {
      ok: boolean; value?: unknown; error?: { message?: string }
    } }
    if (envelope.rpcId !== rpcId || !envelope.result.ok) {
      throw new Error(`packaged Desktop ${method} failed: ${envelope.result.error?.message ?? 'invalid RPC response'}`)
    }
    return envelope.result.value
  }
  const created = await invoke('session/create', { request: { cwd, agentPreset: 'embedded-codex' } }) as {
    sessionId?: string; agentPreset?: string
  }
  if (typeof created.sessionId !== 'string' || created.agentPreset !== 'embedded-codex') {
    throw new Error('packaged Desktop did not create the requested Codex session')
  }
  for (const agentPreset of ['standard', 'embedded-codex', 'minimal', 'embedded-codex']) {
    const selected = await invoke('agentPresets/select', { agentId: created.sessionId, agentPreset })
    if (selected !== agentPreset) throw new Error(`packaged Desktop failed to select ${agentPreset}`)
    const adopted = await invoke('session/create', { request: { cwd, sessionId: created.sessionId, agentPreset } }) as {
      sessionId?: string; agentPreset?: string
    }
    if (adopted.sessionId !== created.sessionId || adopted.agentPreset !== agentPreset) {
      throw new Error(`packaged Desktop did not preserve session identity and preset ${agentPreset}`)
    }
  }
}

/**
 * Install through the packaged Desktop CLI carrier, boot its Host with the installed plugin,
 * load the frontend, switch presets through Remote, shut down cleanly, and verify plugin removal.
 */
export async function smokePackagedExternalPlugin(options: {
  readonly artifacts: string
  readonly target: DesktopDeliverySmokeTarget
  readonly tarball: string
}): Promise<DesktopDeliverySmokeRecord> {
  const layout = packagedDesktopLayout(options.artifacts, options.target)
  const workspace = resolve(SMOKE_ROOT, options.target)
  assertChild(SMOKE_ROOT, workspace, 'Desktop delivery smoke workspace')
  rmSync(workspace, { recursive: true, force: true })
  const home = resolve(workspace, 'dsh-home')
  const userData = resolve(workspace, 'electron-user-data')
  mkdirSync(userData, { recursive: true })
  const profile = await initializeIsolatedDesktopProfile(home)
  const environment = packagedNodeEnvironment(layout, home, userData)
  const invoke = async (args: readonly string[]): Promise<void> => await run(
    layout.executable,
    packagedCliArguments(layout, args),
    { cwd: workspace, env: environment },
  )
  let host: DesktopHostProcess | undefined
  try {
    const version = (await capture(
      layout.executable,
      packagedCliArguments(layout, ['--version']),
      { cwd: workspace, env: environment },
    )).trim()
    if (version !== EXPECTED_DSH_VERSION) {
      throw new Error(`packaged Desktop command reports DSH ${JSON.stringify(version)}, expected ${EXPECTED_DSH_VERSION}`)
    }
    const dependencyProbe = JSON.parse(await capture(
      layout.executable,
      [PACKAGED_DEPENDENCY_PROBE, join(layout.resources, 'app.asar', 'package.json')],
      { cwd: workspace, env: environment },
    )) as { readonly packages?: unknown }
    if (typeof dependencyProbe.packages !== 'number' || dependencyProbe.packages === 0) {
      throw new Error('packaged Desktop dependency probe did not verify any production packages')
    }
    await installDevelopmentTarball(home, options.tarball, environment, 'desktop', invoke)
    await invoke(['plugin', '--profile', 'desktop', 'list', '--depth=0'])
    if (profileManifest(profile).dependencies?.[PLUGIN_NAME] === undefined) {
      throw new Error('packaged Desktop command did not register the external plugin in profiles/desktop')
    }
    const pluginVersion = installedPluginVersion(profile)
    const { DesktopHostProcess } = await desktopHostSource()
    host = new DesktopHostProcess(
      layout.executable,
      layout.runtimeDir,
      profile,
      undefined,
      environment,
      undefined,
      join(layout.supportDir, 'primary-runtime'),
      {
        pnpm: join(layout.supportDir, 'pnpm', 'bin', 'pnpm.mjs'),
        nodeBin: join(layout.supportDir, 'bin'),
      },
    )
    let readinessTimer: ReturnType<typeof setTimeout> | undefined
    const ready = await Promise.race([
      host.start(),
      new Promise<never>((_resolve, reject) => {
        readinessTimer = setTimeout(() => {
          reject(new Error('packaged Desktop external-plugin Host readiness exceeded 120 seconds'))
        }, 120_000)
        readinessTimer.unref()
      }),
    ]).finally(() => {
      if (readinessTimer !== undefined) clearTimeout(readinessTimer)
    })
    const cookie = await assertPackagedFrontend(ready.url)
    await assertPackagedPresetSwitches(ready.url, cookie, workspace)
    await host.stop(true)
    host = undefined
    await invoke([
      'plugin', '--profile', 'desktop', 'remove', PLUGIN_NAME, '--config.offline=true',
    ])
    if (profileManifest(profile).dependencies?.[PLUGIN_NAME] !== undefined
      || existsSync(join(profile, 'node_modules', PLUGIN_NAME))) {
      throw new Error(
        'packaged Desktop command did not remove the external plugin manifest entry and module tree',
      )
    }
    return {
      carrier: 'packaged-desktop-command',
      profile: 'desktop',
      dshVersion: version,
      pluginVersion,
      mainDependenciesReady: true,
      hostReady: true,
      frontendReady: true,
      presetSwitchingReady: true,
      removeVerified: true,
    }
  } finally {
    await host?.stop()
    rmSync(workspace, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  }
}
