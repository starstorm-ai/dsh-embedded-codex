import { isBuiltin } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-embedded-codex'

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !isAbsolute(specifier)
}

function nodeBundle(name: string, entry: string, outDir = 'lib'): UserConfig {
  return {
    name,
    entry: { [name]: entry },
    outDir,
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: specifier => isBuiltin(specifier) || isBareSpecifier(specifier),
      alwaysBundle: specifier => !isBuiltin(specifier) && !isBareSpecifier(specifier),
    },
  }
}

const clientExternals = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-api-gateway/client',
])

const clientInlineAliases = {
  '@deepseek-ai/dsh-brand': resolve('upstream/deepseek-harness/packages/util/brand/src/index.ts'),
  '@deepseek-ai/dsh-session/types': resolve('upstream/deepseek-harness/packages/core/session/src/types.ts'),
  '@deepseek-ai/dsh-typert-protocol': resolve('upstream/deepseek-harness/packages/typert/protocol/src/index.ts'),
  '@deepseek-ai/dsh-util-crypto': resolve('upstream/deepseek-harness/packages/util/crypto/src/index.ts'),
  '@deepseek-ai/dsh-util-workspace-path': resolve('upstream/deepseek-harness/packages/util/workspace-path/src/index.ts'),
}

const clientBundle: UserConfig = {
  name: `${PACKAGE_ID}/client`,
  entry: {
    client: 'lib/types/compat/session-controller-client/client/index.js',
  },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  alias: clientInlineAliases,
  deps: {
    neverBundle: specifier => clientExternals.has(specifier),
    alwaysBundle: specifier => !clientExternals.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/** Build the Runtime, three replacement providers, and the Web client fix. */
export default defineConfig([
  nodeBundle('index', 'lib/types/index.js'),
  nodeBundle('agent-registry', 'src/compat/providers/agent-registry.ts', 'lib/compat'),
  nodeBundle('agent-presets', 'src/compat/providers/agent-presets.ts', 'lib/compat'),
  nodeBundle('session-controller', 'src/compat/providers/session-controller.ts', 'lib/compat'),
  clientBundle,
])
