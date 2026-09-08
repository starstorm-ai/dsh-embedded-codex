import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { run } from './lib/process.mts'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import { readUpstreamLock } from './lib/upstream.mts'

const protocolRoot = resolve(REPOSITORY_ROOT, 'protocol')
const temporaryRoot = resolve(REPOSITORY_ROOT, '.tmp/protocol-generated')
if (relative(REPOSITORY_ROOT, protocolRoot).startsWith('..')
  || relative(REPOSITORY_ROOT, temporaryRoot).startsWith('..')) {
  throw new Error('refusing to replace a protocol directory outside the repository')
}

const require = createRequire(import.meta.url)
const packagePath = require.resolve('@openai/codex/package.json')
const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  readonly version?: string
  readonly bin?: { readonly codex?: string }
}
const lock = readUpstreamLock()
if (manifest.version !== lock.codexVersion || manifest.bin?.codex === undefined) {
  throw new Error(`installed @openai/codex is ${String(manifest.version)}; expected ${lock.codexVersion}`)
}

rmSync(temporaryRoot, { recursive: true, force: true })
await run(process.execPath, [
  resolve(dirname(packagePath), manifest.bin.codex),
  'app-server',
  'generate-ts',
  '--out',
  temporaryRoot,
], { cwd: REPOSITORY_ROOT })
writeFileSync(resolve(temporaryRoot, 'UPSTREAM.json'), `${JSON.stringify({
  schemaVersion: 1,
  package: '@openai/codex',
  version: lock.codexVersion,
  generator: lock.protocol.generator,
  command: lock.protocol.command,
}, null, 2)}\n`)
rmSync(protocolRoot, { recursive: true, force: true })
renameSync(temporaryRoot, protocolRoot)
process.stdout.write(`generated protocol from @openai/codex@${lock.codexVersion}\n`)
