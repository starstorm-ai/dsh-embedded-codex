/** Survives separate provider bundles; callers must not assume ownership was released. */
export class IncompleteCleanupError extends AggregateError {
  readonly code = 'embedded-codex/incomplete-cleanup'
}

export function isIncompleteCleanup(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'code' in error
    && error.code === 'embedded-codex/incomplete-cleanup'
}

/** Complete every teardown in order before reporting any failures. */
export async function cleanupAll(
  actions: readonly (() => void | Promise<void>)[],
  message: string,
): Promise<void> {
  const errors: unknown[] = []
  for (const action of actions) {
    try {
      await action()
    } catch (error: unknown) {
      errors.push(error)
    }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, message)
}

/** Preserve the original failure as well as errors encountered while rolling back. */
export async function rollbackFailure(error: unknown, cleanup: () => Promise<void>): Promise<never> {
  try {
    await cleanup()
  } catch (cleanupError: unknown) {
    throw new IncompleteCleanupError([error, cleanupError], 'embedded-codex: operation and rollback both failed')
  }
  throw error
}
