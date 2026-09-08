/** Version-locked replacement for the DSH Agent Presets provider. */

import type {} from '../../../compat/types/dsh-agent-runtime/index.d.ts'
import AgentPresets from '../../../lib/types/compat/agent-presets/index.js'
import { assertDshHostCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshHostCompatibility()

export * from '../../../lib/types/compat/agent-presets/index.js'
export default AgentPresets
