/** The only adapter allowed to load Desktop private sources, after its isolated build. */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { DESKTOP_BUILD_ROOT } from './paths.mts'

export async function desktopSource(): Promise<typeof import('../../upstream/deepseek-harness/apps/desktop/src/project-manager.ts')> {
  return import(pathToFileURL(resolve(DESKTOP_BUILD_ROOT, 'apps/desktop/src/project-manager.ts')).href)
}

export async function desktopHostSource(): Promise<typeof import('../../upstream/deepseek-harness/apps/desktop/src/host-process.ts')> {
  return import(pathToFileURL(resolve(DESKTOP_BUILD_ROOT, 'apps/desktop/src/host-process.ts')).href)
}

export async function desktopCli(): Promise<typeof import('../../upstream/deepseek-harness/apps/cli/lib/bin.js')> {
  return import(pathToFileURL(desktopCliPath()).href)
}

export function desktopCliPath(): string {
  return resolve(DESKTOP_BUILD_ROOT, 'apps/cli/lib/bin.js')
}

export type { DesktopHostProcess } from '../../upstream/deepseek-harness/apps/desktop/src/host-process.ts'
