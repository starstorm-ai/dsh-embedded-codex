import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

interface LoaderSmokeOptions {
  readonly label: string
  readonly tempDirPrefix: string
  readonly binScript: string
  readonly binArgs: readonly string[]
  readonly tsconfigPath: string
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly processTimeoutMs?: number
}

/** Execute a source Loader fixture with isolated DSH homes. */
export async function runLoaderSmoke(options: LoaderSmokeOptions): Promise<{
  readonly stdout: string
  readonly stderr: string
}> {
  const cwd = await mkdtemp(join(tmpdir(), options.tempDirPrefix))
  const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', tsxLoader, options.binScript, ...options.binArgs], {
        cwd,
        env: {
          ...process.env,
          DSH_HOME: join(cwd, '.dsh'),
          DSH_AGENTS_HOME: join(cwd, '.agents'),
          TSX_TSCONFIG_PATH: options.tsconfigPath,
          ...options.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => { stdout += chunk })
      child.stderr.on('data', (chunk: string) => { stderr += chunk })
      const timeout = setTimeout(() => child.kill('SIGKILL'), options.processTimeoutMs ?? 60_000)
      child.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', code => {
        clearTimeout(timeout)
        if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(`${options.label} exited ${String(code)}. stdout:\n${stdout}\nstderr:\n${stderr}`))
      })
    })
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
