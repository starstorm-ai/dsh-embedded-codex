/** Version-locked replacement for the DSH Agent Registry provider. */

import AgentRegistry from '../../../lib/types/compat/agent-registry/index.js'
import { assertDshHostCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshHostCompatibility()

export * from '../../../lib/types/compat/agent-registry/index.js'
export default AgentRegistry
