import { createHash } from 'node:crypto'
import { copyFileSync, globSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { cachedBuild, fileFingerprint, fingerprint, readBuildStamp, treeFiles } from './build-cache.mts'
import { withBuildLock } from './build-lock.mts'
import { capture } from './process.mts'
import { REPOSITORY_ROOT } from './paths.mts'

interface PackageManifest {
  readonly name: string
  readonly version: string
  readonly files: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
}

function intactTarball(path: string | undefined, output: string): boolean {
  if (path === undefined || dirname(path) !== output || statSync(path, { throwIfNoEntry: false })?.isFile() !== true) return false
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
  return path.endsWith(`-${digest}.tgz`)
}

/** Reuse identical publication inputs or pack them once under a content-addressed path. */
export async function packTarball(root = REPOSITORY_ROOT): Promise<string> {
  // Build and pack share emitted files; pack disables prepack to avoid recursive acquisition.
  return withBuildLock(resolve(root, '.tmp/plugin-pipeline.lock'), async () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageManifest
    const output = resolve(root, '.tmp/packs')
    if (!output.startsWith(`${root}\\`) && !output.startsWith(`${root}/`)) {
      throw new Error(`unsafe pack output: ${output}`)
    }
    mkdirSync(output, { recursive: true })
    const workspaceManifests = Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.optionalDependencies })
      .filter(([, version]) => version.startsWith('workspace:'))
      .map(([name]) => resolve(root, 'node_modules', name, 'package.json'))
    const publishedFiles = globSync([...manifest.files, 'README*', 'LICENSE*', 'LICENCE*', 'COPYING*'], { cwd: root })
      .flatMap(path => {
        const absolute = resolve(root, path)
        return statSync(absolute).isDirectory() ? treeFiles(absolute) : [absolute]
      })
    const inputs = [...publishedFiles, ...workspaceManifests,
      ...['package.json', '.npmignore', '.npmrc', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'scripts/lib/package.mts']
        .map(path => resolve(root, path))]
    const pnpmCli = process.env.npm_execpath
    if (pnpmCli === undefined || pnpmCli.length === 0) {
      throw new Error('packed smoke requires npm_execpath so pnpm can be launched without a command shell')
    }
    const key = fingerprint({ files: fileFingerprint(inputs), pnpm: fileFingerprint([pnpmCli]), node: process.version })
    const stamp = resolve(output, 'pack-cache.json')
    const previous = readBuildStamp(stamp)
    let packed = previous?.outputs[0]
    await cachedBuild({
      label: 'plugin tarball', stamp, key, required: [],
      validate: current => current.outputs.length === 1 && intactTarball(current.outputs[0], output),
      build: async () => {
        const name = manifest.name.replace(/^@/, '').replace('/', '-')
        const tarball = resolve(output, `${name}-${manifest.version}.tgz`)
        rmSync(tarball, { force: true })
        await capture(process.execPath, [pnpmCli, 'pack', '--config.ignore-scripts=true', '--pack-destination', output], { cwd: root })
        const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex').slice(0, 16)
        packed = resolve(output, `${name}-${manifest.version}-${digest}.tgz`)
        copyFileSync(tarball, packed)
        return [packed]
      },
    })
    packed = readBuildStamp(stamp)?.outputs[0]
    if (packed === undefined) throw new Error('plugin pack did not produce a tarball')
    return packed
  })
}
