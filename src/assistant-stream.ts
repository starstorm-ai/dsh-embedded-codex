/** Process-local assistant stream publication plus durable compact accumulation. */

import {
  AssistantStreamAccumulator,
  LlmAttemptId,
  type AssistantStreamRecord,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEventMap, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

/** One streamed Codex step, bridged to the DSH v2 transient/durable contract. */
export class AssistantStreamAttempt {
  private readonly accumulator = new AssistantStreamAccumulator()
  private index = 0
  private terminal = false
  readonly attemptId: LlmAttemptId

  get ended(): boolean { return this.terminal }

  constructor(
    sessionId: SessionId,
    attempt: number,
    private readonly nextRevision: () => number,
    readonly turn: number,
    readonly step: number,
    private readonly emit: (frame: AssistantStreamFrame) => void,
  ) {
    this.attemptId = LlmAttemptId(`${sessionId}:codex:${turn}:${step}:${attempt}`)
  }

  start(): void {
    this.emit({
      type: 'start',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      turn: this.turn,
      step: this.step,
    })
  }

  push(chunk: StreamChunk): void {
    const timed = this.accumulator.push({ time: Date.now(), chunk })
    this.emit({
      type: 'chunk',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      index: this.index++,
      time: timed.time,
      chunk: timed.chunk,
    })
  }

  settle(eventType: 'assistant/message' | 'assistant/attempt', append: () => SessionSeq): void {
    let seq: SessionSeq
    try {
      seq = append()
    } catch (error: unknown) {
      this.abandon()
      throw error
    }
    this.terminal = true
    this.emit({
      type: 'end',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      index: this.index,
      outcome: { kind: 'committed', eventType, seq },
    })
  }

  abandon(): void {
    if (this.terminal) return
    this.terminal = true
    this.emit({
      type: 'end',
      attemptId: this.attemptId,
      revision: this.nextRevision(),
      index: this.index,
      outcome: { kind: 'abandoned' },
    })
  }

  get stream(): SessionEventMap['assistant/attempt']['stream'] {
    return [...this.accumulator.snapshot()] as AssistantStreamRecord[]
  }
}
