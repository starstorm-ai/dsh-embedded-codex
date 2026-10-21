import { manifest, sourceRoots as COMPAT_SOURCE_ROOTS, packageArtifacts as REQUIRED_PACKAGE_ARTIFACTS, generateRuntimeManifest } from './lib/compatibility.mts'
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import yaml from 'js-yaml'
import { buildIsCurrent, cachedBuild, fileFingerprint, fingerprint, readBuildStamp, timed, treeFiles } from './lib/build-cache.mts'
import { withBuildLock } from './lib/build-lock.mts'
import { GENERATED_ROOT, REPOSITORY_ROOT, UPSTREAM_ROOT } from './lib/paths.mts'
import { pnpm } from './lib/process.mts'
import { ensureUpstreamBuild } from './lib/upstream-build.mts'

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
  const registered = new Set(manifest.patches.map(patch => patch.target.replaceAll('/', '+') + '.patch'))
  if (entries.length !== registered.size || entries.some(entry => !registered.has(entry.name))) {
    throw new Error('compatibility patch set does not match compat/manifest.json')
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

  const packageManifest = JSON.parse(readFileSync(resolve(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
    exports?: Record<string, unknown>
    files?: readonly string[]
  }
  if (Object.keys(packageManifest.exports ?? {}).some(key => key.startsWith('./src'))) {
    throw new Error('published package must not export source files')
  }
  if (packageManifest.files?.some(path => path.startsWith('upstream/') || path.startsWith('compat/generated')) === true) {
    throw new Error('published files include development-only upstream sources')
  }

  const patch = yaml.load(readFileSync(resolve(REPOSITORY_ROOT, 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(patch)) throw new Error('cordis.patch.yml must contain a patch array')
  const expectedDisabled = new Map<string, string>(manifest.providers.map(provider => [provider.id, provider.package]))
  const expectedInserted = new Map<string, string>([
    ...manifest.providers.map(provider => [provider.replacementId, provider.entry] as const),
    ['preset-embedded-codex', '@deepseek-ai/dsh-agent-preset'], ['embedded-codex', 'dsh-embedded-codex'],
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
    /(?:from|import\()\s*['"][^'"]*(?:compat\/generated\/|lib\/types|src\/)[^'"]*['"]/,
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
        if ((path.endsWith('.js') || path.endsWith('.d.ts')) && forbiddenRuntimeImports.some(pattern => pattern.test(text))) {
          throw new Error(`built artifact imports development-only code: ${relative(REPOSITORY_ROOT, path).split(sep).join('/')}`)
        }
      }
    }
  }
}

if (!existsSync(resolve(REPOSITORY_ROOT, 'node_modules'))) {
  throw new Error('dependencies are not installed; run pnpm install --frozen-lockfile first')
}

const { values } = parseArgs({ options: { clean: { type: 'boolean', default: false } } })
// Materialization and compilation share the same generated tree.
await withBuildLock(resolve(REPOSITORY_ROOT, '.tmp/plugin-pipeline.lock'), async () => {
  generateRuntimeManifest()
  const upstreamKey = await ensureUpstreamBuild()
  const compatibilityInputs = [
    ...COMPAT_SOURCE_ROOTS.flatMap(path => treeFiles(resolve(UPSTREAM_ROOT, path))),
    ...treeFiles(resolve(REPOSITORY_ROOT, 'compat/patches')),
    resolve(REPOSITORY_ROOT, 'scripts/build.mts'),
    resolve(REPOSITORY_ROOT, 'compat/manifest.json'),
  ]
  await cachedBuild({
    label: 'compatibility sources', stamp: resolve(REPOSITORY_ROOT, '.tmp/compat-build.json'),
    key: fileFingerprint(compatibilityInputs), required: [], force: values.clean,
    build: async () => {
      materializeCompatibilitySources()
      return treeFiles(GENERATED_ROOT)
    },
  })

  const sourceFiles = [
    ...treeFiles(resolve(REPOSITORY_ROOT, 'src')),
    ...treeFiles(resolve(REPOSITORY_ROOT, 'compat/types')),
    ...treeFiles(GENERATED_ROOT),
  ]
  const configurationFiles = [
    ...globSync('tsconfig*.json', { cwd: REPOSITORY_ROOT }),
    'tsdown.config.ts', 'package.json', 'pnpm-lock.yaml', 'scripts/build.mts', 'scripts/lib/build-cache.mts',
  ].map(path => resolve(REPOSITORY_ROOT, path))
  const key = fingerprint({ upstreamKey, files: fileFingerprint([...sourceFiles, ...configurationFiles]) })
  const layout = fingerprint({ upstreamKey, sources: sourceFiles, config: fileFingerprint(configurationFiles) })
  const stampPath = resolve(REPOSITORY_ROOT, '.tmp/plugin-build.json')
  const previous = readBuildStamp(stampPath)
  const required = REQUIRED_PACKAGE_ARTIFACTS.map(path => resolve(REPOSITORY_ROOT, path))
  await cachedBuild({
    label: 'plugin build', stamp: stampPath, key, layout, required, force: values.clean,
    build: async () => {
      // Preserve incremental state on content edits; clean when file names/configuration change
      // or an output disappears so tsc cannot retain obsolete or missing emitted files.
      if (values.clean || previous?.layout !== layout
        || !buildIsCurrent(previous, previous?.key ?? '', required)) {
        rmSync(resolve(REPOSITORY_ROOT, 'lib'), { recursive: true, force: true })
      }
      await timed('plugin TypeScript', () => pnpm(['exec', 'tsc', '-b',
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
      ], { cwd: REPOSITORY_ROOT }))
      for (const path of treeFiles(resolve(REPOSITORY_ROOT, 'lib')).filter(path => path.endsWith('.d.ts'))) {
        const declaration = readFileSync(path, 'utf8')
        writeFileSync(path, declaration.replace(/((?:from\s*|import\(\s*)['"])(\.[^'"]+)(['"])/g,
          (_match, prefix: string, specifier: string, quote: string) => {
            const normalized = specifier.endsWith('.ts') && !specifier.endsWith('.d.ts')
              ? specifier.slice(0, -3) + '.js'
              : extname(specifier) === '' && existsSync(resolve(dirname(path), specifier + '.d.ts'))
                ? specifier + '.js' : specifier
            return prefix + normalized + quote
          }))
      }
      // Empty type-only imports are erased by tsc. Keep the public Remote augmentation
      // reachable from the browser declaration entry without copying generated namespaces.
      writeFileSync(resolve(REPOSITORY_ROOT, 'lib/types/client.d.ts'),
        "import '@deepseek-ai/dsh-api-session-controller/remote'\n"
        + "export * from './compat/session-controller-client/client/index.js'\n")
      await timed('plugin bundles', () => pnpm(['exec', 'tsdown'], { cwd: REPOSITORY_ROOT }))
      verifyPackage()
      return treeFiles(resolve(REPOSITORY_ROOT, 'lib'))
    },
  })
  verifyPackage()
  process.stdout.write('built DeepSeek Harness prerequisites and dsh-embedded-codex\n')
})
