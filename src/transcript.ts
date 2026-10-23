/** Native message identity shared by the Runtime and its conversation projections. */
import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

const itemSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  phase: z.enum(['commentary', 'partial_answer', 'final_answer']).nullable().optional(),
  delivery: z.literal('async').nullable().optional(),
  text: z.string().optional(),
  messageSeq: z.number().optional(),
  questions: z.array(z.object({ title: z.string(), options: z.array(z.string()).nullable() })).nullable().optional(),
})

export const transcriptSchema = z.object({
  version: z.literal(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  localTurn: z.number().int().positive(),
  startSeq: z.number(),
  endSeq: z.number(),
  items: z.array(itemSchema),
})
export type NativeTranscript = z.infer<typeof transcriptSchema>

const messageSchema = z.object({
  version: z.literal(1),
  attemptId: z.string().min(1),
  terminal: z.boolean().optional(),
  items: z.array(itemSchema),
})
export type NativeMessageMetadata = z.infer<typeof messageSchema>

// Entries belong to one Client Session window; dropping that window releases its cache.
const nativeTurns = new WeakMap<object, NativeTranscript>()

/** Associate an exact loaded turn boundary with a read-only native history snapshot. */
export function rememberNativeTurn(boundary: object, transcript: NativeTranscript): void {
  nativeTurns.set(boundary, transcript)
}

/** Read history attached to this Session's own turn boundary, including fork prefixes. */
export function nativeTurn(boundary: object | undefined): NativeTranscript | undefined {
  return boundary === undefined ? undefined : nativeTurns.get(boundary)
}

/** Map a native item to a presentation anchor without changing its durable Session seq. */
export function nativeAnchor(transcript: NativeTranscript | undefined, messageSeq: number | undefined, callId: string | undefined, fallback: number): number {
  if (transcript === undefined) return fallback
  const index = transcript.items.findIndex(item => callId === undefined
    ? messageSeq !== undefined && item.messageSeq === messageSeq
    : `codex:${item.id}` === callId)
  return index < 0 ? fallback : transcript.startSeq
    + (transcript.endSeq - transcript.startSeq) * (index + 1) / (transcript.items.length + 1)
}

/** Derive a node's native position from its own message or tool lifecycle. */
export function nativeEventAnchor(transcript: NativeTranscript | undefined, events: readonly { type: string; seq: number; data: unknown }[], fallback: number): number {
  for (const event of events) {
    if (event.type === 'assistant/live-chunk') {
      const attempt = z.object({ attemptId: z.string() }).safeParse(event.data)
      if (attempt.success && attempt.data.attemptId.startsWith('codex-recovered:')) return nativeAnchor(transcript, event.seq, undefined, fallback)
    }
    if (event.type === 'assistant/message') return nativeAnchor(transcript, event.seq, undefined, fallback)
    if (event.type === 'tool/call') {
      const call = z.object({ callId: z.string() }).safeParse(event.data)
      if (call.success) return nativeAnchor(transcript, undefined, call.data.callId, fallback)
    }
    if (event.type === 'tool/result') {
      const call = z.object({ message: z.object({ source: z.object({ callId: z.string() }) }) }).safeParse(event.data)
      if (call.success) return nativeAnchor(transcript, undefined, call.data.message.source.callId, fallback)
    }
  }
  return fallback
}

/** Recover commentary semantics from native history for pre-metadata Session messages. */
export function nativeContent(content: readonly ContentBlock[], transcript: NativeTranscript | undefined, seq: number): ContentBlock[] {
  return content.map(block => block.type === 'reasoning'
    && transcript?.items.some(item => item.messageSeq === seq && item.phase === 'commentary' && item.text === block.text)
    ? { type: 'text', text: block.text } : block)
}

/** Read plugin metadata without interpreting another provider's replay state. */
export function nativeMessage(value: unknown): NativeMessageMetadata | undefined {
  const replay = z.object({ embeddedCodexMessage: messageSchema.optional() }).safeParse(value)
  return replay.success ? replay.data.embeddedCodexMessage : undefined
}

/** Correlate live and durable messages while retaining legacy messages individually. */
export function nativeAssistantIdentity(event: {
  type: string
  data: unknown
}): string | undefined {
  if (event.type === 'assistant/live-chunk') {
    const data = z.object({ attemptId: z.string() }).safeParse(event.data)
    return data.success && (data.data.attemptId.includes(':codex:') || data.data.attemptId.startsWith('codex-recovered:')) ? data.data.attemptId : undefined
  }
  if (event.type !== 'assistant/message') return undefined
  const data = z.object({ message: z.object({ id: z.string(), source: z.object({ replayState: z.unknown() }) }) }).safeParse(event.data)
  if (!data.success) return undefined
  const replay = data.data.message.source.replayState
  const metadata = nativeMessage(replay)
  if (metadata !== undefined) return metadata.attemptId
  const legacy = z.object({ embeddedCodex: z.object({ threadId: z.string() }) }).safeParse(replay)
  return legacy.success ? `codex-message:${data.data.message.id}` : undefined
}

/** Native commentary and asynchronous questions are process messages, not final answers. */
export function nativeFinalMessage(replayState: unknown): boolean {
  const message = nativeMessage(replayState)
  return message === undefined || (message.terminal !== false && message.items.some(item => item.type === 'agentMessage'
    && item.delivery !== 'async' && (item.phase === 'final_answer' || item.phase === null || (message.terminal === true && item.phase === 'partial_answer'))))
}
