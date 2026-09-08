import { REPOSITORY_ROOT } from './lib/paths.mts'
import { pnpm } from './lib/process.mts'

for (const task of [
  ['run', 'bootstrap'],
  ['run', 'build'],
  ['run', 'test'],
  ['run', 'lint'],
  ['run', 'docs:check'],
  ['run', 'pack:dry-run'],
  ['run', 'test:packed'],
] as const) {
  await pnpm(task, { cwd: REPOSITORY_ROOT })
}
