/** Read-only history rows use the Client transient sequence space, never durable Session seqs. */
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand'
import { rememberNativeTurn, transcriptSchema } from '../transcript.ts'

/** Portable event feed records, structurally compatible with the Session Controller client outlet. */
export type NativeHistoryEntry =
  | { readonly type: 'event'; readonly event: SessionEvent }
  | { readonly type: 'transient'; readonly event: { readonly type: 'assistant/live-chunk'; readonly seq: number; readonly time: number;
      readonly data: { readonly turn: number; readonly step: number; readonly attemptId: LlmAttemptId; readonly chunk: StreamChunk } } }

/** Add read-only recovered messages within loaded completed-turn ranges; never change persistence cursors. */
export function enrichNativeHistory(entries: readonly NativeHistoryEntry[], value: unknown): readonly NativeHistoryEntry[] {
  const parsed = transcriptSchema.array().safeParse(value)
  if (!parsed.success || parsed.data.length === 0) return entries
  const original = entries.filter(entry => entry.event.type !== 'assistant/live-chunk'
    || !entry.event.data.attemptId.startsWith('codex-recovered:'))
  const recovered: NativeHistoryEntry[] = []
  for (const transcript of parsed.data) {
    const opening = original.find(entry => entry.event.type === 'turn/start' && entry.event.data.turn === transcript.localTurn)
    const ending = original.find(entry => entry.event.type === 'turn/end' && entry.event.data.turn === transcript.localTurn)
    if (ending?.event.type !== 'turn/end') continue
    for (const entry of original) {
      if ('turn' in entry.event.data && entry.event.data.turn === transcript.localTurn) rememberNativeTurn(entry.event, transcript)
    }
    const finalStep = original.findLast(entry => entry.event.type === 'step/start' && entry.event.data.turn === transcript.localTurn)
    const step = finalStep?.event.type === 'step/start' ? finalStep.event.data.step : 1
    const firstSeq = original[0]?.event.seq ?? 0
    const visible = transcript.items.flatMap((item, index) => item.messageSeq !== undefined && item.messageSeq >= firstSeq ? [index] : [])
    const missing = transcript.items.filter((item, index) => item.type === 'agentMessage' && item.text?.trim()
      && item.messageSeq === undefined && (opening !== undefined || (index >= (visible[0] ?? Infinity) && index <= (visible.at(-1) ?? -1))))
    for (const [index, item] of missing.entries()) {
      const seq = ending.event.seq - 1 + (index + 1) / (missing.length + 1)
      item.messageSeq = seq
      const entry: NativeHistoryEntry = { type: 'transient', event: {
        type: 'assistant/live-chunk', seq, time: ending.event.time, data: {
          turn: transcript.localTurn, step,
          attemptId: LlmAttemptId(`codex-recovered:${transcript.turnId}:${item.id}`),
          chunk: { type: 'block-end', index: 0, block: { type: 'text', text: item.text ?? '' } },
        },
      } }
      rememberNativeTurn(entry.event, transcript)
      recovered.push(entry)
    }
  }
  return [...original, ...recovered].sort((left, right) => left.event.seq - right.event.seq)
}
