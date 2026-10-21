import { link, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'

/** Exclusive file ownership; a dead owner is recoverable, an active build is never stolen. */
export async function withBuildLock<T>(path: string, operation: () => Promise<T>, timeoutMs = 600_000): Promise<T> {
  await mkdir(dirname(path), { recursive: true })
  const token = randomUUID()
  const claim = `${path}.${token}.claim`
  const deadline = Date.now() + timeoutMs
  // Publish ownership atomically, so interruption cannot leave an empty lock file.
  await writeFile(claim, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' })
  try {
    for (;;) {
      try {
        await link(claim, path)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        let owner: { pid: number; token: string } | undefined
        try { owner = JSON.parse(await readFile(path, 'utf8')) } catch { /* Another process may still be writing ownership. */ }
        if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          let dead = false
          try { process.kill(owner.pid, 0) } catch (failure) { dead = (failure as NodeJS.ErrnoException).code === 'ESRCH' }
          if (dead) {
            const staleToken = owner.token
            // Serialize stale-owner removal so two reclaimers cannot unlink a new owner's lock.
            await withBuildLock(`${path}.recovery`, async () => {
              try {
                const current = JSON.parse(await readFile(path, 'utf8'))
                if (current.token === staleToken) await unlink(path)
              } catch (failure) {
                if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure
              }
            }, Math.max(0, deadline - Date.now()))
            continue
          }
        }
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for build lock ${path}`)
        await setTimeout(100)
      }
    }
    try { return await operation() } finally {
      const owner = JSON.parse(await readFile(path, 'utf8'))
      if (owner.token === token) await unlink(path)
    }
  } finally {
    await unlink(claim)
  }
}
