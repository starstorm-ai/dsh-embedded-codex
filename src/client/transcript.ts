/** Client-only native history enrichment; durable Session identities remain unchanged. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { nativeAssistantIdentity } from '../transcript.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap { 'embedded-codex': boolean }
}

export const inject = ['uiConversation']

/** Recognize native message-bearing steps without treating tools as a replacement answer. */
export const nativeStepDefinition: ConversationNodeDefinition<{ turn: number; step: number }> = {
  kind: 'embedded-codex',
  match: event => nativeAssistantIdentity(event) !== undefined
    && (event.type === 'assistant/message' || event.type === 'assistant/live-chunk')
    ? { id: `${event.data.turn}:${event.data.step}`, role: 'start' } : null,
  start: (_context, match) => {
    if (match.event.type !== 'assistant/message' && match.event.type !== 'assistant/live-chunk') throw new Error('native step requires assistant material')
    return { turn: match.event.data.turn, step: match.event.data.step }
  },
  update: context => context.state,
  buildLocationData: (context, scope) => scope === 'step' && context.state !== undefined
    ? { kind: 'step', ...context.state, key: 'embedded-codex', value: true } : null,
}

/** Install only the native-step contribution; standard Session matchers remain unchanged. */
export function apply(ctx: Context): void {
  ctx.uiConversation.events.register(nativeStepDefinition)
}

export { enrichNativeHistory } from './history.ts'
