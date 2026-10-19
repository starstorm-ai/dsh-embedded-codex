import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import yaml from 'js-yaml'
import { GENERATED_ROOT, REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { pnpm } from './lib/process.mts'
import { withUpstreamDesktopBuildPreserved } from './lib/upstream-clean-workaround.mts'

const EXPECTED_UPSTREAM_COMMIT = '639ed015397290b3745d163aafe02ffee4aa3f84'

const UPSTREAM_ARTIFACTS = [
  'apps/cli/lib/bin.js',
  'apps/web/dist/index.html',
  'packages/llm/llm/lib/typert.host.js',
  'packages/interaction/commands/lib/typert.host.js',
  'packages/goal/goal/lib/typert.host.js',
  'packages/subagent/subagent/lib/typert.host.js',
  'packages/client/ui-permission-presets/lib/client.js',
] as const

const COMPAT_SOURCE_ROOTS = [
  'packages/boot/config-editor/src',
  'packages/core/agent/src',
  'packages/preset/agent-preset-registry/src',
  'packages/api/session-controller/src',
  'packages/interaction/permission-presets/src',
  'packages/client/ui-permission-presets/src',
] as const

const REQUIRED_PACKAGE_ARTIFACTS = [
  'lib/index.js',
  'lib/compat/agent-registry.js',
  'lib/compat/agent-preset-registry.js',
  'lib/compat/config-editor.js',
  'lib/compat/permission-presets.js',
  'lib/compat/session-controller.js',
  'lib/compat/ui-permission-presets.js',
  'lib/client.js',
  'lib/types/index.d.ts',
  'lib/types/compat/agent-registry/index.d.ts',
  'lib/types/compat/agent-preset-registry/index.d.ts',
  'lib/types/compat/config-editor/index.d.ts',
  'lib/types/compat/permission-presets/index.d.ts',
  'lib/types/compat/session-controller/index.d.ts',
  'lib/types/compat/session-controller-client/client/index.d.ts',
  'lib/types/compat/ui/ui-permission-presets.d.ts',
] as const

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  }).trim()
}

function expectedSubmoduleCommit(): string {
  if (!existsSync(resolve(UPSTREAM_ROOT, '.git'))
    || !existsSync(resolve(UPSTREAM_ROOT, 'package.json'))) {
    throw new Error(
      'DeepSeek Harness submodule is not initialized; run git submodule update --init --recursive',
    )
  }
  const actual = git(UPSTREAM_ROOT, ['rev-parse', 'HEAD'])
  if (actual !== EXPECTED_UPSTREAM_COMMIT) {
    throw new Error(
      `DeepSeek Harness is checked out at ${actual}; expected ${EXPECTED_UPSTREAM_COMMIT} (dsh-v0.2.0-rc.2)`,
    )
  }
  return EXPECTED_UPSTREAM_COMMIT
}

async function buildUpstream(commit: string): Promise<void> {
  const stampPath = resolve(REPOSITORY_ROOT, '.tmp/upstream-build.json')
  const hasArtifacts = UPSTREAM_ARTIFACTS.every(path => existsSync(resolve(UPSTREAM_ROOT, path)))
  const isDirty = git(UPSTREAM_ROOT, ['status', '--porcelain', '--untracked-files=no']).length > 0
  let stampedCommit: string | undefined
  if (existsSync(stampPath)) {
    try {
      const stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as { commit?: unknown }
      if (typeof stamp.commit === 'string') stampedCommit = stamp.commit
    } catch {
      // A damaged disposable stamp simply causes a clean upstream rebuild.
    }
  }
  if (hasArtifacts && !isDirty && stampedCommit === commit) return

  // The outer workspace also links DSH packages for this plugin. Restore the
  // submodule's own frozen dependency graph before invoking its root build.
  await pnpm(['install', '--frozen-lockfile'], {
    cwd: UPSTREAM_ROOT,
    env: { ...process.env, CI: 'true' },
  })
  await withUpstreamDesktopBuildPreserved(() => pnpm(['run', 'clean'], {
    cwd: UPSTREAM_ROOT,
    env: { ...process.env, CI: 'true', DSH_PRESERVE_DESKTOP_BUILD: '1' },
  }))
  await pnpm(['run', 'build'], {
    cwd: UPSTREAM_ROOT,
    env: { ...process.env, CI: 'true' },
  })
  const missing = UPSTREAM_ARTIFACTS.filter(path => !existsSync(resolve(UPSTREAM_ROOT, path)))
  if (missing.length > 0) throw new Error(`DeepSeek Harness build did not emit: ${missing.join(', ')}`)
  mkdirSync(dirname(stampPath), { recursive: true })
  writeFileSync(stampPath, `${JSON.stringify({ commit }, null, 2)}\n`, 'utf8')
}

function copyTree(source: string, target: string, accepts: (name: string) => boolean): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, entry.name)
    const targetPath = resolve(target, entry.name)
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath, accepts)
    } else if (entry.isFile()) {
      if (!accepts(entry.name)) continue
      mkdirSync(dirname(targetPath), { recursive: true })
      copyFileSync(sourcePath, targetPath)
    } else {
      throw new Error(`unsupported compatibility source entry: ${sourcePath}`)
    }
  }
}

function patchTargetFromName(name: string): string {
  const suffix = '.patch'
  if (!name.endsWith(suffix)) throw new Error(`compatibility patch must end in ${suffix}: ${name}`)
  const encodedPath = name.slice(0, -suffix.length)
  const segments = encodedPath.split('+')
  if (segments.length < 2
    || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`compatibility patch name must encode a DSH-relative path with "+": ${name}`)
  }
  const target = segments.join('/')
  if (!(target.endsWith('.ts') || target.endsWith('.tsx'))
    || !COMPAT_SOURCE_ROOTS.some(root => target.startsWith(`${root}/`))) {
    throw new Error(`compatibility patch targets uncopied DSH source: ${name} -> ${target}`)
  }
  return target
}

function verifyPatch(path: string, name: string): void {
  const expected = patchTargetFromName(name)
  const text = readFileSync(path, 'utf8')
  const diffHeaders = [...text.matchAll(/^diff --git a\/([^\r\n]+) b\/([^\r\n]+)\r?$/gm)]
  const oldHeaders = [...text.matchAll(/^--- a\/([^\r\n]+)\r?$/gm)]
  const newHeaders = [...text.matchAll(/^\+\+\+ b\/([^\r\n]+)\r?$/gm)]
  if (diffHeaders.length !== 1 || oldHeaders.length !== 1 || newHeaders.length !== 1) {
    throw new Error(`${name} must contain exactly one modified DSH file`)
  }
  const paths = [
    diffHeaders[0]![1],
    diffHeaders[0]![2],
    oldHeaders[0]![1],
    newHeaders[0]![1],
  ]
  if (paths.some(target => target !== expected)) {
    throw new Error(`${name} must only modify the DSH path encoded by its name: ${expected}`)
  }
}

function materializeCompatibilitySources(): void {
  const expectedGeneratedRoot = resolve(REPOSITORY_ROOT, 'compat/generated')
  if (GENERATED_ROOT !== expectedGeneratedRoot
    || relative(REPOSITORY_ROOT, GENERATED_ROOT).startsWith('..')) {
    throw new Error(`refusing to replace unsafe generated path: ${GENERATED_ROOT}`)
  }
  rmSync(GENERATED_ROOT, { recursive: true, force: true })
  mkdirSync(GENERATED_ROOT, { recursive: true })
  for (const root of COMPAT_SOURCE_ROOTS) {
    copyTree(
      resolve(UPSTREAM_ROOT, root),
      resolve(GENERATED_ROOT, root),
      name => name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.css'),
    )
  }

  const patchRoot = resolve(REPOSITORY_ROOT, 'compat/patches')
  const entries = readdirSync(patchRoot, { withFileTypes: true })
  if (entries.length === 0) throw new Error('compat/patches must contain at least one compatibility patch')
  if (entries.some(entry => !entry.isFile() || !entry.name.endsWith('.patch'))) {
    throw new Error('compat/patches must contain only flat *.patch files')
  }
  const patches = entries.map(entry => entry.name).sort()
  for (const name of patches) {
    const path = resolve(patchRoot, name)
    verifyPatch(path, name)
    execFileSync('git', [
      'apply',
      '--whitespace=error-all',
      `--directory=${relative(REPOSITORY_ROOT, GENERATED_ROOT).split(sep).join('/')}`,
      path,
    ], { cwd: REPOSITORY_ROOT, stdio: 'inherit', windowsHide: true })
  }

  const forbiddenRoots = [UPSTREAM_ROOT, UPSTREAM_ROOT.replaceAll('\\', '/')]
  const pending = [GENERATED_ROOT]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) {
        const text = readFileSync(path, 'utf8')
        if (forbiddenRoots.some(value => text.includes(value))) {
          throw new Error(`generated source contains an absolute submodule path: ${path}`)
        }
      }
    }
  }
}

function verifyPackage(): void {
  for (const artifact of REQUIRED_PACKAGE_ARTIFACTS) {
    if (!existsSync(resolve(REPOSITORY_ROOT, artifact))) throw new Error(`missing built artifact: ${artifact}`)
  }

  const manifest = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
    files?: readonly string[]
  }
  if (Object.keys(manifest.exports ?? {}).some(key => key.startsWith('./src'))) {
    throw new Error('published package must not export source files')
  }
  if (manifest.files?.some(path => path.startsWith('upstream/') || path.startsWith('compat/generated')) === true) {
    throw new Error('published files include development-only upstream sources')
  }

  const patch = yaml.load(readFileSync(resolve(REPOSITORY_ROOT, 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(patch)) throw new Error('cordis.patch.yml must contain a patch array')
  const expectedDisabled = new Map([
    ['agent', '@deepseek-ai/dsh-agent'],
    ['agent-preset-registry', '@deepseek-ai/dsh-agent-preset-registry'],
    ['config-editor', '@deepseek-ai/dsh-config-editor'],
    ['permission', '@deepseek-ai/dsh-permission-presets'],
    ['session-controller', '@deepseek-ai/dsh-api-session-controller'],
    ['ui-permission', '@deepseek-ai/dsh-client-ui-permission-presets'],
  ])
  const expectedInserted = new Map([
    ['embedded-codex-agent-registry', 'dsh-embedded-codex/compat/agent-registry'],
    ['agent-preset-registry', 'dsh-embedded-codex/compat/agent-preset-registry'],
    ['embedded-codex-config-editor', 'dsh-embedded-codex/compat/config-editor'],
    ['embedded-codex-permission-presets', 'dsh-embedded-codex/compat/permission-presets'],
    ['embedded-codex-session-controller', 'dsh-embedded-codex/compat/session-controller'],
    ['embedded-codex-ui-permission-presets', 'dsh-embedded-codex/compat/ui-permission-presets'],
    ['preset-embedded-codex', '@deepseek-ai/dsh-agent-preset'],
    ['embedded-codex', 'dsh-embedded-codex'],
  ])
  for (const entry of patch) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as { id?: unknown; name?: unknown; disabled?: unknown; insert?: unknown }
    if (row.id === 'ui-conversation') {
      throw new Error('Bundle must leave the stock ui-conversation provider enabled')
    }
    if (typeof row.id === 'string' && expectedDisabled.has(row.id)) {
      if (row.name !== expectedDisabled.get(row.id) || row.disabled !== true) {
        throw new Error(`Bundle does not safely disable original provider ${row.id}`)
      }
      expectedDisabled.delete(row.id)
    }
    if (!Array.isArray(row.insert)) continue
    for (const inserted of row.insert) {
      if (typeof inserted !== 'object' || inserted === null) continue
      const candidate = inserted as { id?: unknown; name?: unknown }
      if (candidate.id === 'embedded-codex-ui-conversation') {
        throw new Error('Bundle must not replace the stock ui-conversation provider')
      }
      if (typeof candidate.id !== 'string' || !expectedInserted.has(candidate.id)) continue
      if (candidate.name !== expectedInserted.get(candidate.id)) {
        throw new Error(`Bundle replacement ${candidate.id} has an unexpected module`)
      }
      expectedInserted.delete(candidate.id)
    }
  }
  if (expectedDisabled.size !== 0 || expectedInserted.size !== 0) {
    throw new Error('Bundle does not contain the complete compatibility provider replacement set')
  }

  const forbidden = [REPOSITORY_ROOT, UPSTREAM_ROOT, 'C:\\Users\\Admin']
  const forbiddenRuntimeImports = [
    /(?:from|import\()\s*['"][^'"]*(?:compat\/generated|lib\/types|src\/)[^'"]*['"]/,
    /(?:from|import\()\s*['"][^'"]*\.ts['"]/,
  ]
  const pending = [resolve(REPOSITORY_ROOT, 'lib')]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) {
        const bytes = readFileSync(path)
        if (bytes.includes(0)) continue
        const text = bytes.toString('utf8')
        if (forbidden.some(value => text.includes(value) || text.includes(value.replaceAll('\\', '/')))) {
          throw new Error(`built artifact contains a local absolute path: ${relative(REPOSITORY_ROOT, path).split(sep).join('/')}`)
        }
        if (path.endsWith('.js') && forbiddenRuntimeImports.some(pattern => pattern.test(text))) {
          throw new Error(`built artifact imports development-only code: ${relative(REPOSITORY_ROOT, path).split(sep).join('/')}`)
        }
      }
    }
  }
}

if (!existsSync(resolve(REPOSITORY_ROOT, 'node_modules'))) {
  throw new Error('dependencies are not installed; run pnpm install --frozen-lockfile first')
}

const upstreamCommit = expectedSubmoduleCommit()
await buildUpstream(upstreamCommit)
rmSync(resolve(REPOSITORY_ROOT, 'lib'), { recursive: true, force: true })
materializeCompatibilitySources()
await pnpm(['exec', 'tsc', '-b',
  'tsconfig.protocol.json',
  'tsconfig.runtime.json',
  'tsconfig.compat-agent.json',
  'tsconfig.compat-preset-registry.json',
  'tsconfig.compat-config-editor.json',
  'tsconfig.compat-permissions.json',
  'tsconfig.compat-session-host.json',
  'tsconfig.compat-session-client.json',
  'tsconfig.compat-ui.json',
  '--pretty',
], { cwd: REPOSITORY_ROOT })
await pnpm(['exec', 'tsdown'], { cwd: REPOSITORY_ROOT })
verifyPackage()
process.stdout.write('built DeepSeek Harness prerequisites and dsh-embedded-codex\n')
