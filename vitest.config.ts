import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { readConfigFile, sys } from 'typescript'
import type { Alias } from 'vite'
import { defineConfig } from 'vitest/config'

const upstreamRoot = resolve('upstream/deepseek-harness')
const clientRequire = createRequire(resolve(upstreamRoot, 'packages/client/ui-chat/package.json'))
const baseConfigPath = resolve(upstreamRoot, 'tsconfig.base.json')
const loaded = readConfigFile(baseConfigPath, sys.readFile)
if (loaded.error !== undefined) throw new Error(`Cannot read pinned DSH TypeScript paths: ${baseConfigPath}`)
const paths = loaded.config.compilerOptions?.paths as Record<string, readonly string[]> | undefined
if (paths === undefined) throw new Error(`Pinned DSH TypeScript config has no paths: ${baseConfigPath}`)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const aliases: Alias[] = Object.entries(paths).flatMap(([specifier, targets]) => {
  const target = targets[0]
  if (target === undefined) return []
  const parts = specifier.split('*').map(escapeRegExp)
  const find = new RegExp(`^${parts.join('(.*)')}$`)
  const replacement = resolve(upstreamRoot, target).replace('*', '$1')
  return [{ find, replacement }]
})
const reactAliases: Alias[] = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'].map(specifier => ({
  find: new RegExp(`^${escapeRegExp(specifier)}$`), replacement: clientRequire.resolve(specifier),
}))

/** Deterministic unit and composition tests against the pinned DSH sources. */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: [{ find: 'dsh-embedded-codex/compat/transcript-client', replacement: resolve('src/client/history.ts') }, { find: 'dsh-embedded-codex/compat/transcript', replacement: resolve('src/transcript.ts') }, { find: 'dsh-embedded-codex/compat/runtime-support', replacement: resolve('src/compat/runtime-support.ts') }, ...reactAliases, ...aliases] },
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    sequence: { concurrent: false },
  },
})
