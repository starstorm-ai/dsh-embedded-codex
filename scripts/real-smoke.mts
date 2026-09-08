import { DEVELOPMENT_DSH_HOME, REPOSITORY_ROOT } from './lib/paths.mts'
import { runDsh } from './lib/dsh.mts'
import { packTarball } from './lib/package.mts'
import { pnpm } from './lib/process.mts'

if (process.env.DSH_EMBEDDED_CODEX_REAL !== '1') {
  throw new Error('set DSH_EMBEDDED_CODEX_REAL=1 to acknowledge an interactive test using the existing Codex login')
}

await pnpm(['run', 'build'], { cwd: REPOSITORY_ROOT })
const tarball = await packTarball()
const env = { ...process.env, DSH_HOME: DEVELOPMENT_DSH_HOME }
delete env.DEEPSEEK_API_KEY
await runDsh(['plugin', '--profile', 'web', 'add', tarball], env)
process.stdout.write('starting the isolated Web profile; select Codex 妯″紡 and complete the manual conversation smoke\n')
await runDsh(['web'], env)

