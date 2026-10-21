import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedBuild, fileFingerprint, readBuildStamp } from '../scripts/lib/build-cache.mts'
import { withBuildLock } from '../scripts/lib/build-lock.mts'
import { installDevelopmentTarball } from '../scripts/lib/dev-profile.mts'
import { packTarball } from '../scripts/lib/package.mts'
import { REPOSITORY_ROOT, UPSTREAM_ROOT } from '../scripts/lib/paths.mts'

const roots: string[] = []
function fixture(): string {
  const parent = resolve(REPOSITORY_ROOT, '.tmp')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(resolve(parent, 'build-cache-test-'))
  roots.push(root)
  return root
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('incremental preparation', () => {
  it('reuses unchanged inputs and rebuilds changed inputs or a missing secondary output', async () => {
    const root = fixture()
    const input = resolve(root, 'source.ts')
    const output = resolve(root, 'lib/index.js')
    const declaration = resolve(root, 'lib/index.d.ts')
    write(input, 'first')
    let builds = 0
    const run = () => cachedBuild({
      label: 'fixture', stamp: resolve(root, 'stamp.json'), key: fileFingerprint([input]), required: [output],
      build: async () => {
        builds++
        write(output, readFileSync(input, 'utf8'))
        write(declaration, 'declaration')
        return [output, declaration]
      },
    })
    expect(await run()).toBe(true)
    expect(await run()).toBe(false)
    expect(builds).toBe(1)
    write(input, 'second')
    expect(await run()).toBe(true)
    expect(readFileSync(output, 'utf8')).toBe('second')
    rmSync(declaration)
    expect(await run()).toBe(true)
    expect(builds).toBe(3)
  })

  it('invalidates a prior success before a failed rebuild and retries even if inputs revert', async () => {
    const root = fixture()
    const stamp = resolve(root, 'stamp.json')
    const output = resolve(root, 'output.js')
    const options = { label: 'fixture', stamp, required: [output] }
    await cachedBuild({ ...options, key: 'first', build: async () => { write(output, 'first'); return [output] } })
    await expect(cachedBuild({ ...options, key: 'second', build: async () => {
      write(output, 'partial')
      throw new Error('compile failed')
    } })).rejects.toThrow('compile failed')
    expect(readBuildStamp(stamp)).toBeUndefined()
    expect(await cachedBuild({ ...options, key: 'first', build: async () => { write(output, 'first'); return [output] } })).toBe(true)
    expect(readFileSync(output, 'utf8')).toBe('first')
  })

  it('serializes concurrent builders and rechecks the completed stamp after waiting', async () => {
    const root = fixture()
    const output = resolve(root, 'output.js')
    const ready = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let builds = 0
    const run = () => cachedBuild({
      label: 'concurrent', stamp: resolve(root, 'stamp.json'), key: 'same', required: [output],
      build: async () => {
        builds++
        ready.resolve()
        await release.promise
        write(output, 'complete')
        return [output]
      },
    })
    const first = run()
    await ready.promise
    const second = run()
    release.resolve()
    expect(await Promise.all([first, second])).toEqual([true, false])
    expect(builds).toBe(1)
  })

  it('recovers an interrupted process lock without allowing concurrent owners', async () => {
    const root = fixture()
    const lock = resolve(root, 'interrupted.lock')
    execFileSync(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({pid:process.pid,token:"interrupted"}))', lock],
    { windowsHide: true })
    let active = 0
    const enter = () => withBuildLock(lock, async () => {
      expect(++active).toBe(1)
      await new Promise(resolve => setTimeout(resolve, 20))
      active--
    })
    await Promise.all([enter(), enter(), enter()])
    expect(existsSync(lock)).toBe(false)
  })

  it('rejects legacy metadata, missing required artifacts, and honors an explicit clean build', async () => {
    const root = fixture()
    const stamp = resolve(root, 'stamp.json')
    const output = resolve(root, 'output.js')
    write(stamp, JSON.stringify({ commit: 'legacy' }))
    expect(readBuildStamp(stamp)).toBeUndefined()
    await expect(cachedBuild({ label: 'fixture', stamp, key: 'same', required: [output], build: async () => [] }))
      .rejects.toThrow('required artifacts')
    expect(existsSync(stamp)).toBe(false)
    const build = async () => { write(output, 'built'); return [output] }
    await cachedBuild({ label: 'fixture', stamp, key: 'same', required: [output], build })
    expect(await cachedBuild({ label: 'fixture', stamp, key: 'same', required: [output], force: true, build })).toBe(true)
  })

  it('reuses a tarball across invocations, repacks changed publication files, and repairs corruption', async () => {
    // `pnpm exec vitest` does not provide the lifecycle variable set by `pnpm test`.
    vi.stubEnv('npm_execpath', process.env.npm_execpath ?? resolve(UPSTREAM_ROOT, 'node_modules/pnpm/bin/pnpm.cjs'))
    const root = fixture()
    write(resolve(root, 'package.json'), JSON.stringify({ name: 'cache-fixture', version: '1.0.0', files: ['lib'], packageManager: 'pnpm@11.7.0' }))
    write(resolve(root, 'lib/index.js'), 'export const value = 1\n')
    const first = await packTarball(root)
    const modified = statSync(first).mtimeMs
    expect(await packTarball(root)).toBe(first)
    expect(statSync(first).mtimeMs).toBe(modified)
    write(resolve(root, 'lib/index.js'), 'export const value = 2\n')
    const second = await packTarball(root)
    expect(second).not.toBe(first)
    const bytes = readFileSync(second)
    write(second, 'corrupt archive')
    const repaired = await packTarball(root)
    expect(readFileSync(repaired)).toEqual(bytes)
  })

  it('skips identical installs and reinstalls changed tarballs, missing dependencies or edited registration', async () => {
    const home = fixture()
    const tarball = resolve(home, 'plugin.tgz')
    const profile = resolve(home, 'profiles/desktop')
    const plugin = resolve(profile, 'node_modules/dsh-embedded-codex')
    const dependency = resolve(profile, 'node_modules/dependency/index.js')
    write(tarball, 'version one')
    let installs = 0
    const runner = async () => {
      installs++
      write(resolve(profile, 'package.json'), JSON.stringify({
        dependencies: { 'dsh-embedded-codex': `file:${tarball.replaceAll('\\', '/')}` },
        dsh: { profile: { bundles: ['dsh-embedded-codex'] } },
      }))
      write(resolve(profile, 'pnpm-lock.yaml'), 'lock')
      for (const name of ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml']) write(resolve(plugin, name), 'installed')
      write(dependency, 'dependency')
    }
    const install = () => installDevelopmentTarball(home, tarball, {}, 'desktop', runner)
    expect(await install()).toBe(true)
    expect(await install()).toBe(false)
    write(tarball, 'version two')
    expect(await install()).toBe(true)
    rmSync(dependency)
    expect(await install()).toBe(true)
    write(resolve(profile, 'package.json'), JSON.stringify({ dependencies: {} }))
    expect(await install()).toBe(true)
    expect(installs).toBe(4)
  })
})
