/** Version-locked Host half for the compatible DSH Permission UI. */

import { assertDshUiCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshUiCompatibility()

/** The pinned upstream Host half is intentionally empty; its behavior is browser-only. */
export function apply(): void {
  // The matching client factory owns every permission UI surface.
}
