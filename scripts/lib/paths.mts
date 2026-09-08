import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/** Repository root derived without depending on the invoking cwd. */
export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Read-only pinned DeepSeek Harness checkout. */
export const UPSTREAM_ROOT = resolve(REPOSITORY_ROOT, 'upstream/deepseek-harness')
/** Generated compatibility source tree owned by this repository. */
export const GENERATED_ROOT = resolve(REPOSITORY_ROOT, 'compat/generated')
/** Isolated Harness home used by development and packed smokes. */
export const DEVELOPMENT_DSH_HOME = resolve(REPOSITORY_ROOT, '.tmp/dsh-home')
