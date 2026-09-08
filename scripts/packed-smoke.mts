import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { captureDsh, runDsh } from './lib/dsh.mts'
import { packTarball } from './lib/package.mts'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import { ensureUpstreamBuilt } from './lib/upstream-build.mts'

await ensureUpstreamBuilt()

const home = resolve(REPOSITORY_ROOT, '.tmp/packed-smoke-home')
if (!home.startsWith(`${REPOSITORY_ROOT}\\`) && !home.startsWith(`${REPOSITORY_ROOT}/`)) {
  throw new Error(`unsafe packed-smoke home: ${home}`)
}
rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
const env = { ...process.env, DSH_HOME: home }
const tarball = await packTarball()

try {
  await runDsh(['plugin', '--profile', 'web', 'add', tarball, '--config.offline=true'], env)
  const profileManifestPath = resolve(home, 'profiles/web/package.json')
  if (!existsSync(profileManifestPath)) throw new Error('plugin install did not initialize the isolated Web profile')
  const profile = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: readonly string[] } }
  }
  if (profile.dsh?.profile?.bundles?.includes('dsh-embedded-codex') !== true) {
    throw new Error('installed plugin was not added to the Web profile Bundle list')
  }
  const composed = await captureDsh(['--profile', 'web', '--dump-config'], env)
  for (const specifier of [
    'dsh-embedded-codex/compat/agent-registry',
    'dsh-embedded-codex/compat/agent-presets',
    'dsh-embedded-codex/compat/session-controller',
    'dsh-embedded-codex',
    '@deepseek-ai/dsh-agent-loop',
  ]) {
    if (!composed.includes(specifier)) throw new Error(`composed Web profile is missing ${specifier}`)
  }
  await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex', '--config.offline=true'], env)
  const restored = await captureDsh(['--profile', 'web', '--dump-config'], env)
  if (restored.includes('dsh-embedded-codex')) throw new Error('plugin removal left its Bundle in the Web profile')
  process.stdout.write('verified packed install, Web composition, removal, and profile restoration\n')
} finally {
  try {
    const manifestPath = resolve(home, 'profiles/web/package.json')
    if (existsSync(manifestPath)) {
      const manifest = readFileSync(manifestPath, 'utf8')
      if (manifest.includes('dsh-embedded-codex')) {
        await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex', '--config.offline=true'], env)
      }
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
