import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { REPOSITORY_ROOT } from './lib/paths.mts'
import {
  computeSourceDigests,
  computeAssetDigests,
  readUpstreamLock,
  verifyUpstreamStructure,
} from './lib/upstream.mts'

const lock = readUpstreamLock()
verifyUpstreamStructure(lock)
const updated = {
  ...lock,
  sourceFiles: computeSourceDigests(lock),
  assetFiles: computeAssetDigests(lock),
}
writeFileSync(
  resolve(REPOSITORY_ROOT, 'compat/upstream-lock.json'),
  `${JSON.stringify(updated, null, 2)}\n`,
  'utf8',
)
process.stdout.write(
  `recorded ${String(Object.keys(updated.sourceFiles).length)} source and ${String(Object.keys(updated.assetFiles).length)} asset digests\n`,
)
