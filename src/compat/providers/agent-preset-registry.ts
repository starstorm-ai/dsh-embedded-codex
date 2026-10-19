/** Version-locked replacement for the DSH Agent Preset Registry provider. */

import type {} from '../../../compat/types/dsh-agent-runtime/index.d.ts'
import AgentPresetRegistry from '../../../lib/types/compat/agent-preset-registry/index.js'
import { assertDshHostCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshHostCompatibility()

export * from '../../../lib/types/compat/agent-preset-registry/index.js'
export default AgentPresetRegistry
