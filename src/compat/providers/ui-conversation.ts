/** Version-locked Host half for the compatible DSH Conversation UI. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { assertDshUiCompatibility } from '../../../lib/types/compat/host-version.js'

assertDshUiCompatibility()

/** Settings namespace owned by the DSH Conversation UI. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Values accepted by the busy-Enter setting. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** One busy-Enter behavior. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Durable settings consumed by the copied Conversation client bundle. */
export interface ConversationSettings {
  readonly busyEnter: BusyEnterBehavior
}

/** Schema kept byte-for-byte equivalent in behavior to the pinned DSH Host plugin. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  busyEnter: z.union([...BUSY_ENTER_BEHAVIORS]).default('queue'),
})

/** Register the Host settings section while leaving all UI behavior in the browser bundle. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(CONVERSATION_SETTINGS_NAMESPACE, ConversationSettingsSchema)
  })
}
