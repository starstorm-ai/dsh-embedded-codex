/** Version-locked Config Editor with Loader-consistent duplicate-id resolution. */

import ConfigEditor from '../../../lib/types/compat/config-editor/index.js'
import { assertDshHostCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshHostCompatibility()

export * from '../../../lib/types/compat/config-editor/index.js'
export default ConfigEditor
