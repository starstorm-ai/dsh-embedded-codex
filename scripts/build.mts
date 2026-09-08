import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import { pnpm } from './lib/process.mts'
import { verifyUpstream } from './lib/upstream.mts'

verifyUpstream()
rmSync(resolve(REPOSITORY_ROOT, 'lib'), { recursive: true, force: true })
await pnpm(['run', 'materialize:compat'], { cwd: REPOSITORY_ROOT })
await pnpm(['exec', 'tsc', '-b',
  'tsconfig.protocol.json',
  'tsconfig.runtime.json',
  'tsconfig.compat-agent.json',
  'tsconfig.compat-presets.json',
  'tsconfig.compat-session-host.json',
  'tsconfig.compat-session-client.json',
  '--pretty',
], { cwd: REPOSITORY_ROOT })
await pnpm(['exec', 'tsdown'], { cwd: REPOSITORY_ROOT })
await pnpm(['run', 'verify:package'], { cwd: REPOSITORY_ROOT })
verifyUpstream()

