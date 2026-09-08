import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import { pnpm } from './lib/process.mts'
import { verifyUpstream } from './lib/upstream.mts'
import { ensureUpstreamBuilt } from './lib/upstream-build.mts'

if (!existsSync(resolve(REPOSITORY_ROOT, 'node_modules'))) {
  throw new Error('dependencies are not installed; run pnpm install --frozen-lockfile first')
}
verifyUpstream()
await ensureUpstreamBuilt()
await pnpm(['run', 'materialize:compat'], { cwd: REPOSITORY_ROOT })
process.stdout.write('standalone development inputs are ready\n')
