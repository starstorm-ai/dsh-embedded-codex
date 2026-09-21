/** Version-locked replacement for the DSH Permission Presets provider. */

import PermissionPresets from '../../../lib/types/compat/permission-presets/index.js'
import { assertDshHostCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshHostCompatibility()

export * from '../../../lib/types/compat/permission-presets/index.js'
export default PermissionPresets
