import { LlmAttemptId, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { ClientAssistantStream } from '../compat/generated/packages/api/session-controller/src/client/sessions/assistant-stream.ts'
import type { SessionAssistantSettlementEntry } from '../compat/generated/packages/api/session-controller/src/client/contract/events.ts'

describe('Codex same-step assistant streams', () => {
  it('settles every message before the next attempt without requiring a step end or rebaseline', () => {
    const stream = new ClientAssistantStream()
    stream.replace([])
    for (const index of [1, 2, 3]) {
      const attemptId = LlmAttemptId(`session:codex:1:1:${index}`)
      expect(stream.acceptFrame({ type: 'start', attemptId, revision: index * 3, startedAfterSeq: SessionSeq(index - 1), turn: 1, step: 1 })).toBeUndefined()
      const chunk = stream.acceptFrame({ type: 'chunk', attemptId, revision: index * 3 + 1, index: 0, time: index,
        chunk: { type: 'text-delta', index: 0, text: `progress ${index}` } })
      expect(chunk?.type).toBe('transient')
      const entry: SessionAssistantSettlementEntry = { type: 'event', event: {
        type: 'assistant/message', seq: SessionSeq(index), time: index, surfaceOp: 'append', data: {
          turn: 1, step: 1, stream: [], message: { id: MessageId(`message-${index}`), role: 'assistant',
            source: { kind: 'model', provider: 'codex', model: 'fixture' }, content: [{ type: 'text', text: `progress ${index}` }] },
        },
      } }
      expect(stream.acceptDurable(entry)).toBeUndefined()
      expect(stream.acceptFrame({ type: 'end', attemptId, revision: index * 3 + 2, index: 1,
        outcome: { kind: 'committed', eventType: 'assistant/message', seq: index } })).toEqual({ type: 'settlement', attemptId, entry })
    }
  })

  it('retains the standard runtime stream until its normal step boundary', () => {
    const stream = new ClientAssistantStream()
    stream.replace([])
    const attemptId = LlmAttemptId('standard:1')
    stream.acceptFrame({ type: 'start', attemptId, revision: 1, startedAfterSeq: SessionSeq(0), turn: 1, step: 1 })
    const entry: SessionAssistantSettlementEntry = { type: 'event', event: {
      type: 'assistant/message', seq: SessionSeq(1), time: 1, surfaceOp: 'append', data: {
        turn: 1, step: 1, stream: [], message: { id: MessageId('standard'), role: 'assistant',
          source: { kind: 'model', provider: 'standard', model: 'fixture' }, content: [{ type: 'text', text: 'answer' }] },
      },
    } }
    stream.acceptDurable(entry)
    expect(stream.acceptFrame({ type: 'end', attemptId, revision: 2, index: 0,
      outcome: { kind: 'committed', eventType: 'assistant/message', seq: 1 } })?.type).toBe('publish')
  })

  it('publishes an async question without settling another attempt in the same step', () => {
    const stream = new ClientAssistantStream()
    stream.replace([])
    const attemptId = LlmAttemptId('session:codex:answer')
    stream.acceptFrame({ type: 'start', attemptId, revision: 1, startedAfterSeq: SessionSeq(0), turn: 1, step: 1 })
    const entry: SessionAssistantSettlementEntry = { type: 'event', event: {
      type: 'assistant/message', seq: SessionSeq(1), time: 1, surfaceOp: 'append', data: {
        turn: 1, step: 1, stream: [], message: { id: MessageId('async'), role: 'assistant',
          source: { kind: 'model', provider: 'codex', model: 'fixture', replayState: {
            embeddedCodexMessage: { version: 1, attemptId: 'session:codex:question', items: [{ id: 'q', type: 'agentMessage', phase: 'final_answer', delivery: 'async' }] },
          } }, content: [{ type: 'text', text: 'When?' }] },
      },
    } }
    expect(stream.acceptDurable(entry)?.type).toBe('publish')
    expect(stream.acceptFrame({ type: 'chunk', attemptId, revision: 2, index: 0, time: 2,
      chunk: { type: 'text-delta', index: 0, text: 'Still answering.' } })?.type).toBe('transient')
  })
})
