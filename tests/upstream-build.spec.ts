import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { buildPrerequisitePackages } from '../scripts/lib/upstream-build.mts'
import * as processTools from '../scripts/lib/process.mts'
import { REPOSITORY_ROOT } from '../scripts/lib/paths.mts'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('builds a fresh split package before its Client consumes generated Remote types, and repairs missing outputs', async () => {
  const parent = resolve(REPOSITORY_ROOT, '.tmp')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(resolve(parent, 'prerequisites-test-'))
  roots.push(root)
  const write = (path: string, text: string) => {
    const target = resolve(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
  }
  const json = (path: string, value: object) => write(path, JSON.stringify(value))
  const options = {
    composite: true, strict: true, target: 'ES2022', module: 'ESNext',
    moduleResolution: 'Bundler', types: [], skipLibCheck: true,
  }
  json('tsconfig.host.json', { references: [
    { path: './packages/api/split/tsconfig.host.json' },
    { path: './apps/desktop' },
  ] })
  json('packages/api/split/tsconfig.json', { files: [], references: [
    { path: './tsconfig.host.json' }, { path: './tsconfig.client.json' },
  ] })
  json('packages/api/split/tsconfig.host.json', {
    compilerOptions: { ...options, rootDir: 'src', outDir: 'lib/types', tsBuildInfoFile: 'lib/host.tsbuildinfo' },
    files: ['src/index.ts'],
  })
  json('packages/api/split/tsconfig.client.json', {
    compilerOptions: { ...options, rootDir: 'src', outDir: 'lib/types', tsBuildInfoFile: 'lib/client.tsbuildinfo' },
    files: ['src/client.ts'],
  })
  write('packages/api/split/src/index.ts', 'export interface Reply { ready: true }\n')
  write('packages/api/split/src/client.ts', 'import type { Reply } from "../lib/remote.js"; export const reply: Reply = { ready: true };\n')
  json('packages/client/consumer/tsconfig.json', {
    compilerOptions: { ...options, rootDir: 'src', outDir: 'lib/types' },
    files: ['src/index.ts'],
    references: [{ path: '../../api/split/tsconfig.client.json' }],
  })
  write('packages/client/consumer/src/index.ts', 'export { reply } from "../../../api/split/src/client.js";\n')
  json('apps/desktop/tsconfig.json', { compilerOptions: options, files: ['index.ts'] })
  write('apps/desktop/index.ts', 'const mustNotCompile: never = "Desktop is outside plugin prerequisites";\n')

  // Exercise the real compiler; the fixture bundler emits a Remote declaration from its Host output.
  vi.spyOn(processTools, 'pnpm').mockImplementation(async (args, commandOptions) => {
    if (args[1] === 'tsc') {
      execFileSync(process.execPath, [resolve(REPOSITORY_ROOT, 'node_modules/typescript/bin/tsc'), ...args.slice(2)], {
        cwd: commandOptions.cwd, encoding: 'utf8', windowsHide: true,
      })
      return
    }
    expect(args[1]).toBe('tsdown')
    if (args.at(-1) === 'host') {
      write('packages/api/split/lib/remote.d.ts', readFileSync(resolve(root, 'packages/api/split/lib/types/index.d.ts'), 'utf8'))
    } else {
      expect(args.at(-1)).toBe('client')
      expect(existsSync(resolve(root, 'packages/api/split/lib/types/client.js'))).toBe(true)
      write('packages/client/consumer/lib/index.js', readFileSync(resolve(root, 'packages/client/consumer/lib/types/index.js'), 'utf8'))
    }
  })
  const packages = ['packages/api/split', 'packages/client/consumer']
  const remote = resolve(root, 'packages/api/split/lib/remote.d.ts')
  const client = resolve(root, 'packages/client/consumer/lib/index.js')
  expect(existsSync(remote)).toBe(false)
  await buildPrerequisitePackages(packages, { cwd: root })
  expect(existsSync(remote)).toBe(true)
  expect(existsSync(client)).toBe(true)

  rmSync(remote)
  rmSync(resolve(root, 'packages/api/split/lib/types/client.js'))
  rmSync(client)
  await buildPrerequisitePackages(packages, { cwd: root })
  expect(existsSync(remote)).toBe(true)
  expect(existsSync(client)).toBe(true)
})
