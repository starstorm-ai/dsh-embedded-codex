/** Runtime checks that keep replacement providers bound to one DSH release. */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

interface PackageManifest {
  readonly name?: string
  readonly version?: string
}

const EXPECTED_DSH_VERSION = '0.1.2-rc.1'
const REQUIRED_HOST_PACKAGES = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-api-session-controller',
] as const

let verified = false

/**
 * Refuse to mount compatibility providers beside an unverified DSH release.
 * @throws {Error} when a required Host package is missing or has another version.
 */
export function assertDshHostCompatibility(): void {
  if (verified) return
  const require = createRequire(import.meta.url)
  for (const packageName of REQUIRED_HOST_PACKAGES) {
    let path: string
    try {
      path = require.resolve(`${packageName}/package.json`)
    } catch (error: unknown) {
      throw new Error(
        `dsh-embedded-codex requires ${packageName}@${EXPECTED_DSH_VERSION}, but the package is not resolvable`,
        { cause: error },
      )
    }
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
    if (manifest.name !== packageName || manifest.version !== EXPECTED_DSH_VERSION) {
      throw new Error(
        `dsh-embedded-codex supports ${packageName}@${EXPECTED_DSH_VERSION}; found ${String(manifest.version)}`,
      )
    }
  }
  verified = true
}

/** Exact DSH package version accepted by the compatibility providers. */
export { EXPECTED_DSH_VERSION }

