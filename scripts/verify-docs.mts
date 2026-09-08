import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { REPOSITORY_ROOT } from './lib/paths.mts'

function markdownFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'upstream' || entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.tmp') return []
    const child = resolve(path, entry.name)
    if (entry.isDirectory()) return markdownFiles(child)
    return entry.isFile() && extname(entry.name) === '.md' ? [child] : []
  })
}

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
process.stdout.write('verified Markdown fences, local links, whitespace, and final newlines\n')

