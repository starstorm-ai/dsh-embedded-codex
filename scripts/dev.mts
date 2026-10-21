import { existsSync, mkdirSync } from 'node:fs'
import { installDevelopmentTarball } from './lib/dev-profile.mts'
import { packTarball } from './lib/package.mts'
import { DEVELOPMENT_DSH_HOME, REPOSITORY_ROOT } from './lib/paths.mts'
import { pnpm, run } from './lib/process.mts'
import { ensureDesktopBuild } from './lib/desktop-build.mts'
import { desktopCliPath } from './lib/desktop-source.mts'

const action = process.argv[2] ?? 'start'
if (action !== 'start' && action !== 'install' && action !== 'web' && action !== 'remove') {
  throw new Error('usage: tsx scripts/dev.mts <start|install|web|remove>')
}

const dshBin = desktopCliPath()
const env = { ...process.env, DSH_HOME: DEVELOPMENT_DSH_HOME }
mkdirSync(DEVELOPMENT_DSH_HOME, { recursive: true })
const runDsh = (args: readonly string[], environment: NodeJS.ProcessEnv) =>
  run(process.execPath, [dshBin, ...args], { cwd: REPOSITORY_ROOT, env: environment })

if (action !== 'remove') {
  await pnpm(['run', 'build'], { cwd: REPOSITORY_ROOT })
  // Web regression uses the same validated browser artifacts and dependency world as Desktop.
  await ensureDesktopBuild()
  const tarball = await packTarball()
  await installDevelopmentTarball(DEVELOPMENT_DSH_HOME, tarball, env, 'web', runDsh)
  process.stdout.write(`installed packed plugin ${tarball} into ${DEVELOPMENT_DSH_HOME}\n`)
  if (action !== 'install') await runDsh(['web'], env)
} else {
  if (!existsSync(dshBin)) throw new Error('The isolated DSH carrier is not built; run pnpm build:desktop first')
  await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex', '--config.offline=true'], env)
}
