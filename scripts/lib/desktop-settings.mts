import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DESKTOP_BUILD_ROOT, REPOSITORY_ROOT } from './paths.mts'

/** Release credentials remain local and outside the disposable source checkout. */
export function prepareDesktopSettings(target: string): void {
  const file = target.startsWith('win-') ? '.env.windows' : '.env.macos'
  const source = resolve(REPOSITORY_ROOT, '.tmp/desktop-settings', file)
  const destination = resolve(DESKTOP_BUILD_ROOT, 'apps/desktop', file)
  if (!existsSync(source)) {
    throw new Error(`Desktop packaging requires ${source}; copy ${destination}.example there and configure it. Use absolute credential file paths.`)
  }
  copyFileSync(source, destination)
}
