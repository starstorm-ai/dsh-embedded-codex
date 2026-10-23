/** Built artifact smoke: copied UI dependencies must be bundled or provided by DSH. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { ComponentType, ReactNode } from 'react'
import { expect, it } from 'vitest'

function loadClient(captureStyles = false) {
  let factory: ((require: (id: string) => unknown) => unknown) | undefined
  const styles: { textContent: string }[] = []
  runInNewContext(readFileSync(resolve('lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: (entry: { factory: typeof factory }) => { factory = entry.factory } } },
    ...captureStyles ? { document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: (style: { textContent: string }) => { styles.push(style) } },
    } } : {},
  })
  expect(factory).toBeTypeOf('function')
  const require = createRequire(resolve('upstream/deepseek-harness/packages/client/ui-chat/package.json'))
  function component({ children }: { children?: ReactNode } = {}) { return children ?? null }
  const placeholder = new Proxy({}, { get: (_target, key) => key === 'then' ? undefined : component })
  const provided = new Set([
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-api-gateway/client',
  ])
  const required: string[] = []
  const result = factory?.((id) => {
    required.push(id)
    if (provided.has(id)) return placeholder
    if (['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store'].includes(id)) return require(id)
    throw new Error(`Client dependency is unavailable in the DSH module loader: ${id}`)
  })
  expect(result).toHaveProperty('apply')
  expect(required).toContain('react')
  return { client: result as { apply: (ctx: unknown) => void }, require, styles }
}

it('loads the installed client factory using only DSH browser modules', () => {
  loadClient()
})

it('includes the original animated whale image in the injected running-status CSS', () => {
  const { styles } = loadClient(true)
  const css = styles.find(style => style.textContent.includes('_runningWhaleAnimated'))?.textContent
  expect(css).toBeDefined()
  const image = css?.match(/url\(["']?data:image\/png;base64,([\w+/=]+)["']?\)/)?.[1]
  expect(image).toBeDefined()
  const original = readFileSync(resolve('upstream/deepseek-harness/packages/client/ui-chat/src/client/chat/running-whale@2x.png'))
  expect(Buffer.compare(Buffer.from(image ?? '', 'base64'), original)).toBe(0)
  expect(css).not.toContain('running-whale@2x.png')
  expect(css).toContain('prefers-reduced-motion:no-preference')
  expect(css).toContain('forced-colors:none')
})

it('renders the built trajectory view without Node globals', () => {
  const { client, require } = loadClient()
  const noop = () => () => undefined
  const plugins: { inject?: readonly string[]; apply: (ctx: unknown) => void }[] = []
  const connection = { generation: { getSnapshot: () => undefined } }
  client.apply({
    get: () => connection,
    effect: noop,
    reflect: { provide: noop },
    remote: { $on: noop, $stream: noop },
    typert: { contexts: { registerClient: noop } },
    plugin: (plugin: typeof plugins[number]) => { plugins.push(plugin) },
  })
  const trajectory = plugins.find(plugin => plugin.inject?.includes('uiSession')
    && !plugin.inject.includes('configForms'))
  expect(trajectory).toBeDefined()
  let view: ComponentType<Record<string, unknown>> | undefined
  trajectory?.apply({
    effect: noop,
    locale: { bind: () => (key: string) => key },
    uiConversation: { events: { register: noop }, views: { register: noop } },
    uiSession: { provide: noop },
    slots: {
      inject: (_name: string, register: () => void) => { register() },
      register: (entry: { name: string }, component: typeof view) => {
        if (entry.name === 'conversation.view') view = component
        return noop
      },
    },
  })
  expect(view).toBeTypeOf('function')
  const { createElement } = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const session = { openState: 'open', loadingOlder: false, hasMore: false }
  const snapshot = {
    eventNodes: [], eventLocations: new Map(), requests: [], callSchemas: new Map(),
    partial: null, runningCalls: [],
  }
  const html = renderToStaticMarkup(createElement(view, {
    useSession: (select: (value: typeof session) => unknown) => select(session),
    useTrajectory: (select: (value: typeof snapshot) => unknown) => select(snapshot),
    useDuration: (select: (value: boolean) => unknown) => select(false),
    t: (key: string) => key,
  }))
  expect(html).toContain('<table')
})
