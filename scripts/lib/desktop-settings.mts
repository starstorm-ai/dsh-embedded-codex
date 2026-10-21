import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DESKTOP_BUILD_ROOT, REPOSITORY_ROOT, UPSTREAM_ROOT } from './paths.mts'

/** Check local configuration before starting tests, builds, or installer preparation. */
export function requireDesktopSettings(target: string): string {
  const file = target.startsWith('win-') ? '.env.windows' : '.env.macos'
  const source = resolve(REPOSITORY_ROOT, '.tmp/desktop-settings', file)
  if (!existsSync(source)) {
    const template = resolve(UPSTREAM_ROOT, 'apps/desktop', `${file}.example`)
    throw new Error(`Desktop packaging requires ${source}; create its parent directory, copy ${template} there as ${file}, and configure it. Use absolute credential file paths. Unsigned Windows builds also require policy settings; run pnpm package:desktop:win:x64:unsigned for local unsigned packaging. See docs/desktop.md.`)
  }
  return source
}

/** Release credentials remain local and outside the disposable source checkout. */
export function prepareDesktopSettings(target: string): void {
  const source = requireDesktopSettings(target)
  const file = target.startsWith('win-') ? '.env.windows' : '.env.macos'
  const destination = resolve(DESKTOP_BUILD_ROOT, 'apps/desktop', file)
  copyFileSync(source, destination)
}
