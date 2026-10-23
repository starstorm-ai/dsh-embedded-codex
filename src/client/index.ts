import * as NativeTranscript from './transcript.ts'
/** Browser compatibility root for the embedded Codex Bundle. */

import type { Context } from '@deepseek-ai/cordis'
import * as UiChat from '../../compat/generated/packages/client/ui-chat/src/client/index.ts'
import * as UiTrajectory from '../../compat/generated/packages/client/ui-trajectory/src/client/index.ts'
import * as UiPermissionPresets from '../../compat/generated/packages/client/ui-permission-presets/src/client/index.ts'
import * as SessionController from '../../lib/types/compat/session-controller-client/client/index.js'

export * from '../../lib/types/compat/session-controller-client/client/index.js'

/** The Session Controller must become available before the permission UI can activate. */
export const inject = SessionController.inject

/**
 * Install the compatible Session Controller, then mount the minimal provider-
 * aware permission UI and Codex-aware Chat/Trajectory projections.
 */
export function apply(ctx: Context): void {
  SessionController.apply(ctx)
  ctx.plugin(UiPermissionPresets)
  ctx.plugin(NativeTranscript)
  ctx.plugin(UiChat)
  ctx.plugin(UiTrajectory)
}
