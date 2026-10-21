import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { withBuildLock } from './build-lock.mts'

/** Disposable build identity and the complete inventory of emitted files. */
export interface BuildStamp {
  readonly format: 2
  readonly key: string
  readonly outputs: readonly string[]
  readonly layout?: string
}

/** List regular files without following directory links into another tree. */
export function treeFiles(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(root, entry.name)
    return entry.isDirectory() ? treeFiles(path) : entry.isFile() ? [path] : []
  }).sort()
}

/** Hash file names and contents; missing optional inputs have a distinct identity. */
export function fileFingerprint(paths: readonly string[]): string {
  const hash = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) {
    hash.update(JSON.stringify(path))
    hash.update(existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : 'missing')
  }
  return hash.digest('hex')
}

/** Hash structured inputs without persisting environment values in a stamp. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Missing, obsolete, or damaged cache metadata requires a fresh build. */
export function readBuildStamp(path: string): BuildStamp | undefined {
  try {
    const stamp = JSON.parse(readFileSync(path, 'utf8')) as Partial<BuildStamp> | null
    if (stamp === null || stamp.format !== 2 || typeof stamp.key !== 'string' || !Array.isArray(stamp.outputs)
      || stamp.outputs.length === 0 || !stamp.outputs.every(path => typeof path === 'string')
      || (stamp.layout !== undefined && typeof stamp.layout !== 'string')) return undefined
    return stamp as BuildStamp
  } catch {
    // Cache metadata is disposable; a missing or unreadable stamp cannot authorize reuse.
    return undefined
  }
}

/** Reuse only matching inputs with every previously emitted file still present. */
export function buildIsCurrent(stamp: BuildStamp | undefined, key: string, required: readonly string[]): boolean {
  return stamp?.key === key && required.every(path => stamp.outputs.includes(path))
    && stamp.outputs.every(path => existsSync(path))
}

/** Time one bounded preparation step, excluding the lifetime of a launched app. */
export async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`[dev] ${label}...\n`)
  const started = performance.now()
  const result = await run()
  process.stdout.write(`[dev] ${label}: ${((performance.now() - started) / 1000).toFixed(2)}s\n`)
  return result
}

/** Record successful builds only; invalidate old success before attempting a rebuild. */
export async function cachedBuild(options: {
  readonly label: string
  readonly stamp: string
  readonly key: string
  readonly required: readonly string[]
  readonly layout?: string
  readonly force?: boolean
  readonly validate?: (stamp: BuildStamp) => boolean
  readonly build: () => Promise<readonly string[]>
}): Promise<boolean> {
  return withBuildLock(`${options.stamp}.lock`, async () => {
    const previous = readBuildStamp(options.stamp)
    if (!options.force && buildIsCurrent(previous, options.key, options.required)
      && previous !== undefined && (options.validate?.(previous) ?? true)) {
      process.stdout.write(`[dev] ${options.label}: reused\n`)
      return false
    }
    rmSync(options.stamp, { force: true })
    await timed(options.label, async () => {
      const outputs = await options.build()
      const stamp: BuildStamp = { format: 2, key: options.key, outputs, ...(options.layout === undefined ? {} : { layout: options.layout }) }
      if (!buildIsCurrent(stamp, options.key, options.required)) {
        const missing = [...new Set([
          ...options.required.filter(path => !outputs.includes(path)),
          ...outputs.filter(path => !existsSync(path)),
        ])]
        throw new Error(`${options.label} did not emit all required artifacts: ${missing.join(', ')}`)
      }
      mkdirSync(dirname(options.stamp), { recursive: true })
      writeBuildStamp(options.stamp, stamp)
    })
    return true
  })
}

/** Publish a complete success marker atomically. */
export function writeBuildStamp(path: string, stamp: BuildStamp): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(stamp) + '\n', 'utf8')
  renameSync(temporary, path)
}
