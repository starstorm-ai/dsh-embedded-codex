/** Isolated Desktop profile preparation shared by the development launchers. */

import { mkdirSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { desktopSource } from './desktop-source.mts'
import { DEVELOPMENT_DSH_HOME, REPOSITORY_ROOT } from './paths.mts'

const TEMP_DESKTOP_ROOT = resolve(REPOSITORY_ROOT, '.tmp/desktop')

/** Create the reserved profile metadata without touching the user's Desktop home. */
export async function initializeIsolatedDesktopProfile(home: string): Promise<string> {
  const resolvedHome = resolve(home)
  const fromRoot = relative(TEMP_DESKTOP_ROOT, resolvedHome)
  if (resolvedHome !== DEVELOPMENT_DSH_HOME
    && (fromRoot.length === 0 || fromRoot.startsWith('..') || isAbsolute(fromRoot))) {
    throw new Error(`isolated Desktop home must be ${DEVELOPMENT_DSH_HOME} or below ${TEMP_DESKTOP_ROOT}: ${resolvedHome}`)
  }
  const profile = resolve(resolvedHome, 'profiles/desktop')
  mkdirSync(profile, { recursive: true })
  const { createPluginProfile } = await desktopSource()
  createPluginProfile(profile)
  return profile
}
