import { mkdirSync } from 'node:fs'
import { DEVELOPMENT_DSH_HOME, REPOSITORY_ROOT } from './lib/paths.mts'
import { runDsh } from './lib/dsh.mts'
import { packTarball } from './lib/package.mts'
import { pnpm } from './lib/process.mts'
import { ensureUpstreamBuilt } from './lib/upstream-build.mts'

const action = process.argv[2]
if (action !== 'install' && action !== 'web' && action !== 'remove') {
  throw new Error('usage: tsx scripts/dev-profile.mts <install|web|remove>')
}

mkdirSync(DEVELOPMENT_DSH_HOME, { recursive: true })
const env = { ...process.env, DSH_HOME: DEVELOPMENT_DSH_HOME }
await ensureUpstreamBuilt()

switch (action) {
  case 'install': {
    await pnpm(['run', 'build'], { cwd: REPOSITORY_ROOT })
    const tarball = await packTarball()
    await runDsh(['plugin', '--profile', 'web', 'add', tarball], env)
    process.stdout.write(`installed ${tarball} into ${DEVELOPMENT_DSH_HOME}\n`)
    break
  }
  case 'web':
    await runDsh(['web'], env)
    break
  case 'remove':
    await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex'], env)
    break
  default:
    action satisfies never
}
