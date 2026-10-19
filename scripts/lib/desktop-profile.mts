/** Isolated Desktop profile preparation shared by the development launchers. */

import { mkdirSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { createPluginProfile } from '../../upstream/deepseek-harness/apps/desktop/src/project-manager.ts'
import { REPOSITORY_ROOT } from './paths.mts'

const TEMP_DESKTOP_ROOT = resolve(REPOSITORY_ROOT, '.tmp/desktop')

/** Create the reserved profile metadata without touching the user's Desktop home. */
export function initializeIsolatedDesktopProfile(home: string): string {
  const resolvedHome = resolve(home)
  const fromRoot = relative(TEMP_DESKTOP_ROOT, resolvedHome)
  if (fromRoot.length === 0 || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`isolated Desktop home must be below ${TEMP_DESKTOP_ROOT}: ${resolvedHome}`)
  }
  const profile = resolve(resolvedHome, 'profiles/desktop')
  mkdirSync(profile, { recursive: true })
  createPluginProfile(profile)
  return profile
}
