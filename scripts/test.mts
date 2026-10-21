import { ensureUpstreamBuild } from './lib/upstream-build.mts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { captureDsh, runDsh } from './lib/dsh.mts'
import { ensureDevelopmentLink, hasDevelopmentLink, installDevelopmentTarball } from './lib/dev-profile.mts'
import { packTarball } from './lib/package.mts'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import { pnpm, run } from './lib/process.mts'

function markdownFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (['.git', '.pnpm-store', '.tmp', 'compat', 'dist', 'lib', 'node_modules', 'upstream'].includes(entry.name)) return []
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) return markdownFiles(child)
    return entry.isFile() && extname(entry.name) === '.md' ? [child] : []
  })
}

function verifyMarkdown(): void {
  for (const path of markdownFiles(REPOSITORY_ROOT)) {
    const text = readFileSync(path, 'utf8')
    if (!text.endsWith('\n')) throw new Error(`${relative(REPOSITORY_ROOT, path)} has no final newline`)
    if (/ +$/m.test(text)) throw new Error(`${relative(REPOSITORY_ROOT, path)} has trailing whitespace`)
    const fences = text.match(/^```/gm)?.length ?? 0
    if (fences % 2 !== 0) throw new Error(`${relative(REPOSITORY_ROOT, path)} has an unclosed code fence`)
    for (const match of text.matchAll(/\[[^\]]+\]\((?!https?:|#)(?<target>[^)#]+)(?:#[^)]+)?\)/g)) {
      const target = match.groups?.target
      if (target === undefined || target.startsWith('<')) continue
      const decoded = decodeURIComponent(target)
      if (!existsSync(resolve(dirname(path), decoded))) {
        throw new Error(`${relative(REPOSITORY_ROOT, path)} links to missing ${target}`)
      }
    }
  }
}

async function verifyLinkedDevelopment(): Promise<void> {
  const home = resolve(REPOSITORY_ROOT, '.tmp/linked-smoke-home')
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home }

  try {
    if (!await ensureDevelopmentLink(home, env)) {
      throw new Error('first development-link setup unexpectedly reported an existing link')
    }
    if (!hasDevelopmentLink(home)) throw new Error('development link is not readable after setup')
    if (await ensureDevelopmentLink(home, env)) {
      throw new Error('unchanged development link invoked package installation again')
    }

    const profileRoot = resolve(home, 'profiles/web')
    const lockfile = readFileSync(resolve(profileRoot, 'pnpm-lock.yaml'), 'utf8')
    if (lockfile.includes('@openai/codex')) {
      throw new Error('linked development Profile unexpectedly installed Codex dependencies')
    }
    const composed = await captureDsh(['--profile', 'web', '--dump-config'], env)
    if (!composed.includes('dsh-embedded-codex')) {
      throw new Error('linked development Profile did not compose the plugin')
    }
  } finally {
    const manifestPath = resolve(home, 'profiles/web/package.json')
    if (existsSync(manifestPath)
      && readFileSync(manifestPath, 'utf8').includes('dsh-embedded-codex')) {
      await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex', '--config.offline=true'], env)
    }
    rmSync(home, { recursive: true, force: true })
  }
}

async function verifyPackedPlugin(): Promise<void> {
  const home = resolve(REPOSITORY_ROOT, '.tmp/packed-smoke-home')
  if (relative(REPOSITORY_ROOT, home).startsWith('..')) {
    throw new Error(`unsafe packed-smoke home: ${home}`)
  }
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home }
  const tarball = await packTarball()
  const tarballDigest = createHash('sha256').update(readFileSync(tarball)).digest('hex').slice(0, 16)
  if (!tarball.endsWith(`-${tarballDigest}.tgz`)) {
    throw new Error('packed tarball path is not content-addressed; a local install could reuse stale contents')
  }

  try {
    if (!await installDevelopmentTarball(home, tarball, env)) {
      throw new Error('first packed-plugin setup unexpectedly reused an installation')
    }
    if (await installDevelopmentTarball(home, tarball, env)) {
      throw new Error('unchanged packed plugin invoked package installation again')
    }
    const profileManifestPath = resolve(home, 'profiles/web/package.json')
    if (!existsSync(profileManifestPath)) throw new Error('plugin install did not initialize the isolated Web profile')
    const profile = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: readonly string[] } }
    }
    if (profile.dsh?.profile?.bundles?.includes('dsh-embedded-codex') !== true) {
      throw new Error('installed plugin was not added to the Web profile Bundle list')
    }
    const composed = await captureDsh(['--profile', 'web', '--dump-config'], env)
    for (const specifier of [
      'dsh-embedded-codex/compat/agent-registry',
      'dsh-embedded-codex/compat/agent-preset-registry',
      'dsh-embedded-codex/compat/config-editor',
      'dsh-embedded-codex/compat/permission-presets',
      'dsh-embedded-codex/compat/session-controller',
      'dsh-embedded-codex/compat/ui-permission-presets',
      '@deepseek-ai/dsh-agent-preset',
      '@deepseek-ai/dsh-client-ui-conversation',
      'dsh-embedded-codex',
      '@deepseek-ai/dsh-agent-loop',
    ]) {
      if (!composed.includes(specifier)) throw new Error(`composed Web profile is missing ${specifier}`)
    }
    await verifyPublishedDeclarations(resolve(home, 'profiles/web'))
    await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex', '--config.offline=true'], env)
    const restored = await captureDsh(['--profile', 'web', '--dump-config'], env)
    if (restored.includes('dsh-embedded-codex')) throw new Error('plugin removal left its Bundle in Web profile')
  } finally {
    try {
      const manifestPath = resolve(home, 'profiles/web/package.json')
      if (existsSync(manifestPath)
        && readFileSync(manifestPath, 'utf8').includes('dsh-embedded-codex')) {
        await runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-embedded-codex', '--config.offline=true'], env)
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }
}

/** A package consumer with no repository tsconfig or source aliases. */
async function verifyPublishedDeclarations(profile: string): Promise<void> {
  const published = JSON.parse(readFileSync(resolve(profile, 'node_modules/dsh-embedded-codex/package.json'), 'utf8'))
  const entries = Object.entries(published.exports as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && typeof entry === 'object' && 'types' in entry)
  // DSH's Host and browser Context intentionally have different `sessions` services.
  for (const face of ['host', 'client']) {
    const imports = entries.filter(([key]) => (key === './client') === (face === 'client'))
      .map(([key], index) => `import type * as Entry${index} from ${JSON.stringify('dsh-embedded-codex' + key.slice(1))};\nexport type Public${index} = typeof Entry${index};`)
    writeFileSync(resolve(profile, `consumer-${face}.mts`), imports.join('\n') + '\n')
    const project = resolve(profile, `tsconfig.verify-${face}.json`)
    writeFileSync(project, JSON.stringify({
      compilerOptions: { target: 'ES2024', module: 'NodeNext', strict: true, noEmit: true,
        skipLibCheck: false, jsx: 'react-jsx', lib: ['ES2024', 'DOM', 'DOM.Iterable'], types: ['node'] },
      files: [`consumer-${face}.mts`],
    }))
    await run(process.execPath, [resolve(REPOSITORY_ROOT, 'node_modules/typescript/bin/tsc'), '-p', project, '--pretty', 'false'], {
      cwd: profile,
    })
  }
}

await pnpm(['run', 'build'], { cwd: REPOSITORY_ROOT })
await ensureUpstreamBuild(process.env, true)
await pnpm(['exec', 'vitest', 'run'], { cwd: REPOSITORY_ROOT })
await pnpm(['exec', 'oxlint', '--deny-warnings', 'src', 'scripts', 'tests', 'tsdown.config.ts', 'vitest.config.ts'], {
  cwd: REPOSITORY_ROOT,
})
verifyMarkdown()
await verifyLinkedDevelopment()
await verifyPackedPlugin()
process.stdout.write('passed build, tests, lint, documentation, and packed DSH plugin checks\n')
