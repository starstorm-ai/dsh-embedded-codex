import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { UPSTREAM_ROOT } from './paths.mts'

const CLIENT_BUILD_CONFIG = resolve(UPSTREAM_ROOT, 'packages/client/tsdown.client.ts')
const UPSTREAM_PACKAGE_MANIFEST = resolve(UPSTREAM_ROOT, 'package.json')
const UPSTREAM_PREPARE_DSH = resolve(UPSTREAM_ROOT, 'apps/desktop/scripts/prepare-dsh.ts')
const UPSTREAM_BUILDER_CONFIG = resolve(UPSTREAM_ROOT, 'apps/desktop/scripts/electron-builder-config.mjs')
const requireFromDesktop = createRequire(resolve(UPSTREAM_ROOT, 'apps/desktop/package.json'))
const requireFromElectronBuilder = createRequire(requireFromDesktop.resolve('electron-builder/package.json'))
const ELECTRON_BUILDER_COLLECTOR = resolve(
  dirname(requireFromElectronBuilder.resolve('app-builder-lib/package.json')),
  'out/node-module-collector/nodeModulesCollector.js',
)
const ELECTRON_BUILDER_PNPM_COLLECTOR = resolve(
  dirname(requireFromElectronBuilder.resolve('app-builder-lib/package.json')),
  'out/node-module-collector/pnpmNodeModulesCollector.js',
)
const HELPER_ANCHOR = "const INLINE_CSS_QUERY = '?inline'\n"
const HELPER = `${HELPER_ANCHOR}
/** Recover the physical stylesheet when Rolldown preserves a query on a virtual id. */
function virtualCssAssetPath(virtualId: string, prefix: string): string {
  const suffixLength = CSS_VIRTUAL_SUFFIX.length
    + (virtualId.endsWith(INLINE_CSS_QUERY) ? INLINE_CSS_QUERY.length : 0)
  return virtualId.slice(prefix.length, -suffixLength)
}

function virtualCssRequestsText(virtualId: string): boolean {
  return virtualId.endsWith(INLINE_CSS_QUERY)
}
`

const LOAD_REWRITES = [
  [
    'const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)',
    'const fileId = virtualCssAssetPath(virtualId, CSS_VIRTUAL_PREFIX)',
  ],
  [
    'const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)',
    'const fileId = virtualCssAssetPath(virtualId, INLINE_CSS_VIRTUAL_PREFIX)',
  ],
  [
    'const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)',
    'const fileId = virtualCssAssetPath(virtualId, GLOBAL_CSS_VIRTUAL_PREFIX)',
  ],
  [
    'return styleInjectionModule(id, fileId, code.toString(), classMap)',
    `return virtualCssRequestsText(virtualId)
          ? \`export default \${JSON.stringify(code.toString())};\`
          : styleInjectionModule(id, fileId, code.toString(), classMap)`,
  ],
  [
    'return styleInjectionModule(id, fileId, code.toString())',
    `return virtualCssRequestsText(virtualId)
          ? \`export default \${JSON.stringify(code.toString())};\`
          : styleInjectionModule(id, fileId, code.toString())`,
  ],
  [
    'return prefix === undefined ? id : id.slice(prefix.length, -CSS_VIRTUAL_SUFFIX.length)',
    'return prefix === undefined ? id : virtualCssAssetPath(id, prefix)',
  ],
] as const

function replaceOnce(source: string, before: string, after: string): string {
  const first = source.indexOf(before)
  if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`pinned DSH Desktop build workaround expected exactly one ${JSON.stringify(before)}`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

/**
 * Patch the rc.2 workspace-only CSS virtual-id collision exposed by its
 * official parallel client build. Package-level builds do not hit this path.
 */
export function patchUpstreamDesktopClientBuildSource(source: string): string {
  let patched = replaceOnce(source, HELPER_ANCHOR, HELPER)
  for (const [before, after] of LOAD_REWRITES) patched = replaceOnce(patched, before, after)
  return patched
}

const PINNED_HOST_BUILD =
  '"build:lib:host": "node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host && pnpm --filter @deepseek-ai/dsh-desktop run bundle"'
const COMPATIBLE_HOST_BUILD =
  '"build:lib:host": "node --max-old-space-size=4096 ../../node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host && pnpm --filter @deepseek-ai/dsh-desktop run bundle"'
const PINNED_CLIENT_BUILD =
  '"build:lib:client": "tsc -b tsconfig.client.json && tsdown --env.DSH_BUILD_FACE client"'
const COMPATIBLE_CLIENT_BUILD =
  '"build:lib:client": "tsc -b tsconfig.client.json && node ../../node_modules/tsdown/dist/run.mjs --env.DSH_BUILD_FACE client"'

/** Use this integration's installed TypeScript and compatible Rolldown for the rc.2 workspace pass. */
export function patchUpstreamDesktopPackageSource(source: string): string {
  return replaceOnce(
    replaceOnce(source, PINNED_HOST_BUILD, COMPATIBLE_HOST_BUILD),
    PINNED_CLIENT_BUILD,
    COMPATIBLE_CLIENT_BUILD,
  )
}

const PINNED_PNPM_EXIT_CHECK = 'if (code === 0) resolvePromise()'
const COMPATIBLE_PNPM_EXIT_CHECK = `const windowsNodeShutdownRace = process.platform === 'win32' && code === 0x80000003
      if (code === 0 || windowsNodeShutdownRace) resolvePromise()`

/**
 * Electron 44's Node 24 runtime can finish pnpm successfully and then abort
 * during Windows libuv teardown with STATUS_BREAKPOINT. The runtime tree is
 * still verified immediately after both pnpm calls, so accepting this one
 * post-exit status cannot turn an incomplete install into a packaged build.
 */
export function patchUpstreamDesktopRuntimeSource(source: string): string {
  return replaceOnce(source, PINNED_PNPM_EXIT_CHECK, COMPATIBLE_PNPM_EXIT_CHECK)
}

const PINNED_INSTALLER_PREPARE = "      await promisify(execFile)('powershell.exe',"
const COMPATIBLE_INSTALLER_PREPARE =
  "      if (env.DSH_EMBEDDED_CODEX_WINDOWS_INSTALLER_READY !== '1') await promisify(execFile)('powershell.exe',"

/** Skip only the PowerShell wrapper after equivalent native resources were verified. */
export function patchUpstreamDesktopBuilderSource(source: string): string {
  return replaceOnce(source, PINNED_INSTALLER_PREPARE, COMPATIBLE_INSTALLER_PREPARE)
}

const PINNED_WINDOWS_COLLECTOR =
  'const [spawnCommand, spawnArgs] = process.platform === "win32" ? ["powershell.exe", buildPowerShellEncodedArgs(command, args)] : [command, args];'
const COMPATIBLE_WINDOWS_COLLECTOR = `const pnpmCli = process.platform === "win32" && execName.toLowerCase() === "pnpm" && process.env.npm_execpath
            ? process.env.npm_execpath
            : undefined;
        const [spawnCommand, spawnArgs] = pnpmCli === undefined
            ? (process.platform === "win32" ? ["powershell.exe", buildPowerShellEncodedArgs(command, args)] : [command, args])
            : [process.execPath, [pnpmCli, ...args]];`

/**
 * Electron-builder 26.15.3 routes every Windows dependency query through
 * Windows PowerShell. Reuse pnpm's current JavaScript entry instead, keeping
 * its exact argv and avoiding a shell without changing other collectors.
 */
export function patchElectronBuilderNodeModulesCollectorSource(source: string): string {
  return replaceOnce(source, PINNED_WINDOWS_COLLECTOR, COMPATIBLE_WINDOWS_COLLECTOR)
}

export function electronBuilderNodeModulesCollectorPath(): string {
  return ELECTRON_BUILDER_COLLECTOR
}

const PINNED_PNPM_COLLECTOR_IMPORT = 'const packageManager_1 = require("./packageManager");\n'
const COMPATIBLE_PNPM_COLLECTOR_IMPORT = `${PINNED_PNPM_COLLECTOR_IMPORT}const fs = require("fs-extra");\nconst path = require("path");\n`
const PINNED_PNPM_LOCATE = `    async locateFromDepOrRoot(pkgName, parentPath, requiredRange) {
        // pnpm's virtual store is content-addressed: every \`name@version\` lookup is deterministic,`
const COMPATIBLE_PNPM_LOCATE = `    async locateFromDepOrRoot(pkgName, parentPath, requiredRange) {
        // pnpm may report a virtual-store path relative to a workspace root above the app.
        // Resolve that exact package before app-builder-lib's ancestor lookup loses the path.
        if (parentPath && !path.isAbsolute(parentPath)) {
            const normalized = path.normalize(parentPath);
            const pnpmPrefix = \`.pnpm\${path.sep}\`;
            const nodeModulesMarker = \`\${path.sep}node_modules\${path.sep}\`;
            let ancestor = this.rootDir;
            while (true) {
                const nodeModules = path.join(ancestor, "node_modules");
                const candidates = [normalized];
                const marker = normalized.indexOf(nodeModulesMarker, pnpmPrefix.length);
                if (normalized.startsWith(pnpmPrefix) && marker !== -1) {
                    const virtualName = normalized.slice(pnpmPrefix.length, marker);
                    const packageSuffix = normalized.slice(marker + nodeModulesMarker.length);
                    try {
                        const entries = await fs.readdir(path.join(nodeModules, ".pnpm"));
                        for (const entry of entries) {
                            if (entry === virtualName || entry.startsWith(\`\${virtualName}_\`)) {
                                candidates.push(path.join(".pnpm", entry, "node_modules", packageSuffix));
                            }
                        }
                    }
                    catch {}
                }
                for (const candidate of candidates) {
                    const packageDir = path.join(nodeModules, candidate);
                    const manifestPath = path.join(packageDir, "package.json");
                    if (await this.cache.exists[manifestPath]) {
                        const packageJson = await this.cache.json[manifestPath];
                        if (packageJson && packageJson.name === pkgName
                            && this.cache.semverSatisfies(packageJson.version, requiredRange)) {
                            return { packageDir, packageJson };
                        }
                    }
                }
                const next = path.dirname(ancestor);
                if (next === ancestor) break;
                ancestor = next;
            }
        }
        // pnpm's virtual store is content-addressed: every \`name@version\` lookup is deterministic,`

/**
 * app-builder-lib 26.15.3 treats pnpm's workspace-relative virtual-store paths
 * as process-relative paths. Resolve them against each workspace ancestor so
 * transitive runtime dependencies are included in the packaged ASAR.
 */
export function patchElectronBuilderPnpmCollectorSource(source: string): string {
  return replaceOnce(
    replaceOnce(source, PINNED_PNPM_COLLECTOR_IMPORT, COMPATIBLE_PNPM_COLLECTOR_IMPORT),
    PINNED_PNPM_LOCATE,
    COMPATIBLE_PNPM_LOCATE,
  )
}

export function electronBuilderPnpmCollectorPath(): string {
  return ELECTRON_BUILDER_PNPM_COLLECTOR
}

interface TemporarySourcePatch {
  readonly path: string
  readonly original: string
  readonly patched: string
}

function sourcePatch(path: string, transform: (source: string) => string): TemporarySourcePatch {
  const original = readFileSync(path, 'utf8')
  return { path, original, patched: transform(original) }
}

/** Apply exact temporary source rewrites and always restore the pinned upstream files. */
async function withTemporarySourcePatches<T>(
  patches: readonly TemporarySourcePatch[],
  run: () => Promise<T>,
): Promise<T> {
  const applied: TemporarySourcePatch[] = []
  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }
  try {
    for (const patch of patches) {
      if (readFileSync(patch.path, 'utf8') !== patch.original) {
        throw new Error(`DSH Desktop build source changed before packaging: ${patch.path}`)
      }
      writeFileSync(patch.path, patch.patched, 'utf8')
      applied.push(patch)
    }
    outcome = { ok: true, value: await run() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  const restorationErrors: Error[] = []
  for (const patch of applied.toReversed()) {
    const current = readFileSync(patch.path, 'utf8')
    if (current !== patch.patched) {
      restorationErrors.push(new Error(
        `DSH Desktop build source changed while packaging; refusing to overwrite ${patch.path}`,
      ))
      continue
    }
    try {
      writeFileSync(patch.path, patch.original, 'utf8')
    } catch (error) {
      restorationErrors.push(new Error(`failed to restore DSH Desktop build source ${patch.path}`, {
        cause: error,
      }))
    }
  }
  if (restorationErrors.length !== 0) {
    if (!outcome.ok) throw new AggregateError([outcome.error, ...restorationErrors])
    throw new AggregateError(restorationErrors)
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}

/** Apply only the rc.2 parallel-client CSS workaround used by Desktop dev. */
export async function withUpstreamDesktopClientBuildWorkaround<T>(run: () => Promise<T>): Promise<T> {
  return await withTemporarySourcePatches([
    sourcePatch(CLIENT_BUILD_CONFIG, patchUpstreamDesktopClientBuildSource),
  ], run)
}

/** Apply every pinned build-only workaround for one upstream packaging process. */
export async function withUpstreamDesktopPackagingWorkaround<T>(run: () => Promise<T>): Promise<T> {
  return await withTemporarySourcePatches([
    sourcePatch(CLIENT_BUILD_CONFIG, patchUpstreamDesktopClientBuildSource),
    sourcePatch(UPSTREAM_PACKAGE_MANIFEST, patchUpstreamDesktopPackageSource),
    sourcePatch(UPSTREAM_PREPARE_DSH, patchUpstreamDesktopRuntimeSource),
    sourcePatch(UPSTREAM_BUILDER_CONFIG, patchUpstreamDesktopBuilderSource),
    sourcePatch(ELECTRON_BUILDER_COLLECTOR, patchElectronBuilderNodeModulesCollectorSource),
    sourcePatch(ELECTRON_BUILDER_PNPM_COLLECTOR, patchElectronBuilderPnpmCollectorSource),
  ], run)
}
