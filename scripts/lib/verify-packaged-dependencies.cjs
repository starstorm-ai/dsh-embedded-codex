/** Verify that every required production dependency is resolvable inside a packaged ASAR. */

const { existsSync, readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')

const rootManifestPath = process.argv[2]
if (!rootManifestPath) throw new Error('expected the packaged application manifest path')

const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'))
const pending = Object.keys(rootManifest.dependencies ?? {}).map(name => ({
  name,
  require: createRequire(rootManifestPath),
}))
const visited = new Set()

while (pending.length !== 0) {
  const current = pending.pop()
  const entry = current.require.resolve(current.name)
  let directory = dirname(entry)
  let manifestPath
  let manifest
  while (true) {
    const candidate = join(directory, 'package.json')
    if (existsSync(candidate)) {
      const value = JSON.parse(readFileSync(candidate, 'utf8'))
      if (value.name === current.name) {
        manifestPath = candidate
        manifest = value
        break
      }
    }
    const parent = dirname(directory)
    if (parent === directory) {
      throw new Error(`cannot locate packaged manifest for ${current.name}`)
    }
    directory = parent
  }
  if (visited.has(manifestPath)) continue
  visited.add(manifestPath)
  const childRequire = createRequire(manifestPath)
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    pending.push({ name, require: childRequire })
  }
}

process.stdout.write(`${JSON.stringify({ packages: visited.size })}\n`)
