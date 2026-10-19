import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { UPSTREAM_ROOT } from './paths.mts'

const UPSTREAM_CLEAN_SCRIPT = resolve(UPSTREAM_ROOT, 'scripts/clean.ts')
const PINNED_DESKTOP_CLEAN =
  "    await this.addIfPresent(targets, join(this.root, 'apps/desktop/.desktop-build'), canonicalRoot)"
const PRESERVED_DESKTOP_CLEAN = `    if (process.env.DSH_PRESERVE_DESKTOP_BUILD !== '1') {
      await this.addIfPresent(targets, join(this.root, 'apps/desktop/.desktop-build'), canonicalRoot)
    }`

function replaceOnce(source: string, expected: string, replacement: string): string {
  const first = source.indexOf(expected)
  if (first < 0 || source.indexOf(expected, first + expected.length) >= 0) {
    throw new Error('pinned upstream cleaner no longer has the expected Desktop build target')
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + expected.length)}`
}

/** Guard the pinned cleaner so a core rebuild does not delete packaged Desktop artifacts. */
export function patchUpstreamCleanSource(source: string): string {
  return replaceOnce(source, PINNED_DESKTOP_CLEAN, PRESERVED_DESKTOP_CLEAN)
}

/** Apply the cleaner guard for one command and restore the pristine upstream source afterward. */
export async function withUpstreamDesktopBuildPreserved<T>(run: () => Promise<T>): Promise<T> {
  const original = readFileSync(UPSTREAM_CLEAN_SCRIPT, 'utf8')
  const patched = patchUpstreamCleanSource(original)
  writeFileSync(UPSTREAM_CLEAN_SCRIPT, patched, 'utf8')
  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }
  try {
    outcome = { ok: true, value: await run() }
  } catch (error) {
    outcome = { ok: false, error }
  }
  let restorationError: Error | undefined
  try {
    if (readFileSync(UPSTREAM_CLEAN_SCRIPT, 'utf8') !== patched) {
      throw new Error(`DSH cleaner changed while building; refusing to overwrite ${UPSTREAM_CLEAN_SCRIPT}`)
    }
    writeFileSync(UPSTREAM_CLEAN_SCRIPT, original, 'utf8')
  } catch (error) {
    restorationError = new Error(`failed to restore DSH cleaner ${UPSTREAM_CLEAN_SCRIPT}`, {
      cause: error,
    })
  }
  if (restorationError !== undefined) {
    if (!outcome.ok) throw new AggregateError([outcome.error, restorationError])
    throw restorationError
  }
  if (!outcome.ok) throw outcome.error
  return outcome.value
}
