/** Browser compatibility root for the embedded Codex Bundle. */

import type { Context } from '@deepseek-ai/cordis'
import * as UiPermissionPresets from '../../compat/generated/packages/client/ui-permission-presets/src/client/index.ts'
import * as SessionController from '../../lib/types/compat/session-controller-client/client/index.js'

export * from '../../lib/types/compat/session-controller-client/client/index.js'

/** The Session Controller must become available before the permission UI can activate. */
export const inject = SessionController.inject

/**
 * Install the compatible Session Controller, then mount the minimal provider-
 * aware permission UI. The stock DSH conversation UI owns its normal slots.
 */
export function apply(ctx: Context): void {
  SessionController.apply(ctx)
  ctx.plugin(UiPermissionPresets)
}
