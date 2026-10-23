/** Read-only reconciliation limited to native turns confirmed in the observed DSH prefix. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import { nativeMessage, transcriptSchema, type NativeTranscript } from '../transcript.ts'

const bindingSchema = z.object({ kind: z.literal('turn-bound'), threadId: z.string(), turnId: z.string(), localTurn: z.number().int().positive() })
const legacySchema = z.object({ embeddedCodex: z.object({ threadId: z.string(), turnId: z.string() }) })

/** Fetch only completed native turns whose complete DSH boundary is present. */
export async function readNativeHistory(
  events: readonly SessionEvent[],
  read: (threadId: string, turnId: string) => Promise<NativeTranscript['items']>,
): Promise<NativeTranscript[]> {
  const bindings = new Map<number, { threadId: string; turnId: string }>()
  for (const event of events) {
    if (event.type === 'request/context') {
      const record = bindingSchema.safeParse(event.data.embeddedCodex)
      if (record.success) bindings.set(record.data.localTurn, record.data)
    } else if (event.type === 'assistant/message' && !bindings.has(event.data.turn)) {
      const record = legacySchema.safeParse(event.data.message.source.replayState)
      if (record.success) bindings.set(event.data.turn, record.data.embeddedCodex)
    }
  }
  const snapshots: NativeTranscript[] = []
  for (const [localTurn, binding] of bindings) {
    const end = events.find(event => event.type === 'turn/end' && event.data.turn === localTurn && event.data.reason.kind === 'completed')
    const start = events.find(event => event.type === 'turn/start' && event.data.turn === localTurn)
    if (end === undefined || start === undefined) continue
    const messages = events.filter(event => event.type === 'assistant/message' && event.data.turn === localTurn)
    const items = (await read(binding.threadId, binding.turnId)).map(item => ({ ...item }))
    const assigned = new Set<string>()
    for (const event of messages) {
      if (event.type !== 'assistant/message') continue
      const metadata = nativeMessage(event.data.message.source.replayState)
      for (const item of items) {
        if (metadata?.items.some(candidate => candidate.id === item.id)) {
          item.messageSeq = event.seq
          assigned.add(item.id)
        }
      }
      if (metadata !== undefined) continue
      for (const block of event.data.message.content) {
        if (block.type !== 'text' && block.type !== 'reasoning') continue
        const item = items.find(candidate => !assigned.has(candidate.id) && candidate.text === block.text)
        if (item !== undefined) { item.messageSeq = event.seq; assigned.add(item.id) }
      }
    }
    for (const event of events) {
      if (event.type !== 'tool/call' || event.data.turn !== localTurn) continue
      const item = items.find(candidate => `codex:${candidate.id}` === event.data.callId)
      if (item !== undefined) item.messageSeq = event.seq
    }
    snapshots.push(transcriptSchema.parse({
      version: 1, ...binding, localTurn, items,
      startSeq: (messages[0]?.seq ?? start.seq + 1) - 0.5,
      endSeq: (messages.at(-1)?.seq ?? end.seq - 1) + 0.5,
    }))
  }
  return snapshots
}
