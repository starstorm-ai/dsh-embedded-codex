/** Browser compatibility root for the embedded Codex Bundle. */

import type { Context } from '@deepseek-ai/cordis'
import * as UiConversation from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as UiPermissionPresets from '@deepseek-ai/dsh-client-ui-permission-presets/client'
import * as SessionController from '../../lib/types/compat/session-controller-client/client/index.js'

export * from '../../lib/types/compat/session-controller-client/client/index.js'

/** The Session Controller must become available before the two UI children can activate. */
export const inject = SessionController.inject

/**
 * Install the compatible Session Controller, then mount the two DSH UI
 * surfaces whose copied bundles understand the Codex-only permission IDs.
 */
export function apply(ctx: Context): void {
  SessionController.apply(ctx)
  ctx.plugin(UiConversation)
  ctx.plugin(UiPermissionPresets)
}
