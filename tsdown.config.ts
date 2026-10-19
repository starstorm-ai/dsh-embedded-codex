import { isBuiltin } from 'node:module'
import { readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'
import { defineConfig } from 'tsdown'

const PACKAGE_ID = 'dsh-embedded-codex'
const CSS_VIRTUAL_PREFIX = '\0dsh-embedded-codex-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function styleInjectionModule(
  fileId: string,
  css: string,
  classMap: Readonly<Record<string, string>>,
): string {
  const tagId = `${PACKAGE_ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {',
    '  const tag = document.createElement("style");',
    `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

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
    client: 'src/client/index.ts',
  },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: false,
  minify: true,
  alias: clientInlineAliases,
  deps: {
    neverBundle: specifier => clientExternals.has(specifier),
    alwaysBundle: specifier => !clientExternals.has(specifier),
  },
  plugins: [{
    name: 'dsh-embedded-codex-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css') || importer === undefined) return null
      return CSS_VIRTUAL_PREFIX + resolve(dirname(importer), source) + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, value] of Object.entries(cssExports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        classMap[local] = value.name
      }
      return styleInjectionModule(fileId, code.toString(), classMap)
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

/** Build the Runtime, six replacement providers, and the combined Web client. */
export default defineConfig([
  nodeBundle('index', 'lib/types/index.js'),
  nodeBundle('agent-registry', 'src/compat/providers/agent-registry.ts', 'lib/compat'),
  nodeBundle('agent-preset-registry', 'src/compat/providers/agent-preset-registry.ts', 'lib/compat'),
  nodeBundle('config-editor', 'src/compat/providers/config-editor.ts', 'lib/compat'),
  nodeBundle('permission-presets', 'src/compat/providers/permission-presets.ts', 'lib/compat'),
  nodeBundle('session-controller', 'src/compat/providers/session-controller.ts', 'lib/compat'),
  nodeBundle('ui-permission-presets', 'src/compat/providers/ui-permission-presets.ts', 'lib/compat'),
  clientBundle,
])
