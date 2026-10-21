/** Prepare the Windows installer resources without relying on PowerShell startup. */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { DESKTOP_BUILD_ROOT } from './paths.mts'

const DESKTOP_ROOT = resolve(DESKTOP_BUILD_ROOT, 'apps/desktop')
const INSTALLER_ROOT = resolve(DESKTOP_ROOT, 'installer')
const OUTPUT_ROOT = resolve(DESKTOP_ROOT, '.desktop-build/targets/win-x64/installer-ui')
const PREPARED_INSTALLER_ENV = 'DSH_EMBEDDED_CODEX_WINDOWS_INSTALLER_READY'

interface SharpRawResult {
  readonly data: Buffer
  readonly info: { readonly width: number; readonly height: number; readonly channels: number }
}

interface SharpPipeline {
  flatten(options: { readonly background: { readonly r: number; readonly g: number; readonly b: number } }): SharpPipeline
  removeAlpha(): SharpPipeline
  raw(): SharpPipeline
  toBuffer(options: { readonly resolveWithObject: true }): Promise<SharpRawResult>
}

type SharpFactory = (path: string) => SharpPipeline

function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly capture?: boolean } = {},
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const capture = options.capture === true
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    if (capture) {
      child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
    }
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString('utf8').trim())
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      reject(new Error(`${command} exited with ${String(code ?? signal)}${detail.length === 0 ? '' : `: ${detail}`}`))
    })
  })
}

function quoteCmd(path: string): string {
  return `"${path.replaceAll('"', '""')}"`
}

async function compileWindowFrame(output: string): Promise<void> {
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio/Installer/vswhere.exe')
  if (!existsSync(vswhere)) throw new Error('Windows installer preparation requires Visual Studio vswhere.exe')
  const visualStudio = await run(vswhere, [
    '-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath',
  ], { capture: true })
  if (visualStudio.length === 0) throw new Error('Visual Studio C++ Build Tools are missing')
  const vcvars = join(visualStudio.split(/\r?\n/u).at(-1)!, 'VC/Auxiliary/Build/vcvars32.bat')
  if (!existsSync(vcvars)) throw new Error(`Visual Studio x86 environment is missing: ${vcvars}`)
  const source = resolve(INSTALLER_ROOT, 'window-frame.cpp')
  const library = resolve(output, 'window-frame.dll')
  const compileScript = resolve(output, 'compile-frame.cmd')
  writeFileSync(compileScript, [
    '@echo off',
    `call ${quoteCmd(vcvars)} >nul`,
    'if errorlevel 1 exit /b %errorlevel%',
    [
      'cl /nologo /LD /MT /O1 /W4 /WX /EHsc', quoteCmd(source),
      `/Fo${quoteCmd(resolve(output, 'window-frame.obj'))}`,
      '/link', `/OUT:${quoteCmd(library)}`,
      `/IMPLIB:${quoteCmd(resolve(output, 'window-frame.lib'))}`,
      'user32.lib comctl32.lib dwmapi.lib gdiplus.lib ole32.lib shell32.lib uuid.lib advapi32.lib',
    ].join(' '),
  ].join('\r\n'), 'utf8')
  await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', compileScript], { cwd: output })
  if (readFileSync(library).subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`Windows installer helper is not a PE image: ${library}`)
  }
}

function bmp24(data: Buffer, width: number, height: number, channels: number): Buffer {
  if (channels !== 3) throw new Error(`Windows installer bitmap expected RGB data, found ${channels} channels`)
  const rowBytes = width * 3
  const stride = (rowBytes + 3) & ~3
  const pixelBytes = stride * height
  const output = Buffer.alloc(54 + pixelBytes)
  output.write('BM', 0, 'ascii')
  output.writeUInt32LE(output.length, 2)
  output.writeUInt32LE(54, 10)
  output.writeUInt32LE(40, 14)
  output.writeInt32LE(width, 18)
  output.writeInt32LE(height, 22)
  output.writeUInt16LE(1, 26)
  output.writeUInt16LE(24, 28)
  output.writeUInt32LE(pixelBytes, 34)
  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = height - targetY - 1
    for (let x = 0; x < width; x += 1) {
      const source = (sourceY * width + x) * 3
      const target = 54 + targetY * stride + x * 3
      output[target] = data[source + 2]!
      output[target + 1] = data[source + 1]!
      output[target + 2] = data[source]!
    }
  }
  return output
}

async function renderBitmaps(output: string): Promise<void> {
  const require = createRequire(resolve(DESKTOP_ROOT, 'package.json'))
  const sharp = require('sharp') as SharpFactory
  for (const asset of ['brand', 'brand-2x', 'brand-dark', 'brand-dark-2x', 'uninstaller-sidebar']) {
    const background = asset.includes('dark') ? { r: 21, g: 21, b: 23 } : { r: 255, g: 255, b: 255 }
    const { data, info } = await sharp(resolve(INSTALLER_ROOT, `assets/${asset}.png`))
      .flatten({ background })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const path = resolve(output, `${asset}.bmp`)
    writeFileSync(path, bmp24(data, info.width, info.height, info.channels))
    if (readFileSync(path).subarray(0, 2).toString('ascii') !== 'BM') {
      throw new Error(`Windows installer bitmap is invalid: ${path}`)
    }
  }
}

/** Build and verify the exact resources consumed by the upstream installer hook. */
export async function prepareWindowsInstallerResources(): Promise<NodeJS.ProcessEnv> {
  if (process.platform !== 'win32') throw new Error('Windows installer resources require a Windows host')
  mkdirSync(OUTPUT_ROOT, { recursive: true })
  await compileWindowFrame(OUTPUT_ROOT)
  await renderBitmaps(OUTPUT_ROOT)
  return { [PREPARED_INSTALLER_ENV]: '1' }
}

export { PREPARED_INSTALLER_ENV }
