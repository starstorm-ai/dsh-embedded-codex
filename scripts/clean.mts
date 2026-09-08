import { rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { REPOSITORY_ROOT } from './lib/paths.mts'

for (const name of ['lib', 'coverage', 'compat/generated']) {
  const path = resolve(REPOSITORY_ROOT, name)
  const local = relative(REPOSITORY_ROOT, path)
  if (local.startsWith('..') || local === '') throw new Error(`refusing to remove unsafe path: ${path}`)
  rmSync(path, { recursive: true, force: true })
}

