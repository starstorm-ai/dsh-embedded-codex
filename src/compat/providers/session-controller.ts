/** Version-locked replacement for the DSH Web Session Controller provider. */

import type {} from '../../../compat/types/dsh-agent-runtime/index.d.ts'
import type {} from '../../../compat/types/dsh-agent-presets-runtime/index.d.ts'
import ApiSession from '../../../lib/types/compat/session-controller/index.js'
import { assertDshHostCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshHostCompatibility()

export * from '../../../lib/types/compat/session-controller/index.js'
export default ApiSession
