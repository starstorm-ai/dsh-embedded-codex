import { z } from 'zod'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

const threadSchema = z.object({
  version: z.literal(1),
  provider: z.string().min(1),
  threadId: z.string().min(1),
}).strict()
const submissionSchema = threadSchema.extend({
  localTurn: z.number().int().positive(),
})
const turnSchema = submissionSchema.extend({ turnId: z.string().min(1) })

const recordSchema = z.discriminatedUnion('kind', [
  threadSchema.extend({ kind: z.literal('thread-bound') }),
  submissionSchema.extend({ kind: z.literal('turn-submitted') }),
  submissionSchema.extend({ kind: z.literal('turn-not-submitted') }),
  turnSchema.extend({ kind: z.literal('turn-bound') }),
])
type BindingRecord = z.infer<typeof recordSchema>

declare module '@deepseek-ai/dsh-session' {
  interface RequestContext {
    /** Plugin-owned native route journal; invisible to the model transcript. */
    embeddedCodex?: BindingRecord
  }
}

const stateSchema = z.object({
  inheritedCount: z.number().int().nonnegative(),
  binding: threadSchema.extend({
    turnId: z.string().min(1).optional(),
    localTurn: z.number().int().positive().optional(),
    inherited: z.boolean(),
  }).nullable(),
  pending: submissionSchema.nullable(),
})

type BindingState = z.infer<typeof stateSchema>
export type NativeBinding = NonNullable<BindingState['binding']>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    embeddedCodexBinding: BindingState
  }
}

function foldBinding(state: BindingState, event: SessionEvent): BindingState {
  if (event.type !== 'request/context' || event.data.embeddedCodex === undefined) return state
  const { kind, ...data } = recordSchema.parse(event.data.embeddedCodex)
  const inherited = event.seq < state.inheritedCount
  switch (kind) {
    case 'thread-bound':
      return { ...state, binding: { ...threadSchema.parse(data), inherited }, pending: null }
    case 'turn-submitted': {
      const pending = submissionSchema.parse(data)
      if (state.binding?.threadId !== pending.threadId || state.binding.provider !== pending.provider) {
        throw new Error('embedded-codex: turn submission has no matching thread binding')
      }
      return { ...state, pending }
    }
    case 'turn-not-submitted': {
      const cancelled = submissionSchema.parse(data)
      if (state.pending?.threadId !== cancelled.threadId || state.pending.provider !== cancelled.provider
        || state.pending.localTurn !== cancelled.localTurn) {
        throw new Error('embedded-codex: cancelled submission has no matching pending input')
      }
      return { ...state, pending: null }
    }
    case 'turn-bound': {
      const binding = turnSchema.parse(data)
      if (state.binding?.threadId !== binding.threadId || state.binding.provider !== binding.provider) {
        throw new Error('embedded-codex: turn binding names another thread')
      }
      if (state.pending !== null && state.pending.localTurn !== binding.localTurn) {
        throw new Error('embedded-codex: turn binding names another local turn')
      }
      return { ...state, binding: { ...binding, inherited }, pending: null }
    }
    default:
      return state
  }
}

/** Native identity is host-only execution state, independent of assistant output. */
export const nativeBindingProjection = {
  key: 'embeddedCodexBinding',
  stateVersion: 1,
  stateSchema,
  init: (_header, inheritedCount) => ({ inheritedCount, binding: null, pending: null }),
  apply: foldBinding,
} satisfies ProjectionDefinition<'embeddedCodexBinding', BindingState>

function restoredState(session: Session): BindingState {
  return session.snapshotEvents().reduce(foldBinding, {
    inheritedCount: session.inheritedEventCount,
    binding: null,
    pending: null,
  } as BindingState)
}

function legacyBinding(session: Session, provider: string): NativeBinding | undefined {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq as SessionSeq)
    if (event?.type !== 'assistant/message' || event.data.message.source.provider !== provider) continue
    const replay = event.data.message.source.replayState
    if (replay === null || typeof replay !== 'object' || Array.isArray(replay)) continue
    const result = threadSchema.extend({ turnId: z.string().min(1) }).safeParse({
      ...((replay as Record<string, unknown>).embeddedCodex as object | undefined), provider,
    })
    if (result.success) return { ...result.data, localTurn: event.data.turn, inherited: event.seq < session.inheritedEventCount }
  }
  return undefined
}

/** A per-Agent journal; all state is recoverable from that Session's exact fork prefix. */
export class NativeBindingJournal {
  private state: BindingState
  private readonly deferred: BindingRecord[] = []
  readonly restored: NativeBinding | undefined

  constructor(private readonly session: Session, private readonly provider: string) {
    this.state = restoredState(session)
    this.restored = this.state.binding ?? legacyBinding(session, provider)
    if (this.restored !== undefined && this.restored.provider !== provider) {
      throw new Error('embedded-codex: native binding belongs to another provider')
    }
    if (this.state.pending !== null && this.restored?.inherited) {
      throw new Error('embedded-codex: cannot fork an unresolved native submission')
    }
  }

  get uncertainSubmission(): boolean {
    return this.state.pending !== null
  }

  bindThread(threadId: string): void {
    if (this.state.binding?.threadId === threadId && !this.state.binding.inherited) return
    this.record({ kind: 'thread-bound', version: 1, provider: this.provider, threadId })
    if (this.restored?.threadId === threadId && !this.restored.inherited
      && this.restored.turnId !== undefined && this.restored.localTurn !== undefined) {
      this.bindTurn(threadId, this.restored.turnId, this.restored.localTurn)
    }
  }

  submitting(threadId: string, localTurn: number): void {
    if (this.uncertainSubmission) throw new Error('embedded-codex: previous native submission is unresolved')
    this.flushDeferred()
    this.record({ kind: 'turn-submitted',
      version: 1, provider: this.provider, threadId, localTurn,
    })
  }

  bindTurn(threadId: string, turnId: string, localTurn: number): void {
    if (this.state.binding?.threadId === threadId && this.state.binding.turnId === turnId
      && this.state.pending === null) return
    this.record({ kind: 'turn-bound',
      version: 1, provider: this.provider, threadId, turnId, localTurn,
    })
  }

  /** Only before startTurn is called; a transport failure can never use this record. */
  notSubmitted(threadId: string, localTurn: number): void {
    this.record({ kind: 'turn-not-submitted', version: 1, provider: this.provider, threadId, localTurn })
  }

  private record(record: BindingRecord): void {
    const context = this.session.requestContext()
    const data = { ...context, provider: this.provider, model: context?.model ?? 'default', embeddedCodex: record }
    const open = this.session.snapshotEvents().reduce((active, event) => event.type === 'turn/start' ? true : event.type === 'turn/end' ? false : active, false)
    if (!open) {
      // Resume/fork can attach before an open DSH turn. No input is sent until these records flush.
      this.deferred.push(record)
      this.state = foldBinding(this.state, { type: 'request/context', data, seq: SessionSeq(this.session.seq), time: Date.now() })
      return
    }
    this.state = foldBinding(this.state, this.session.append('request/context', data))
  }

  private flushDeferred(): void {
    const records = this.deferred.splice(0)
    for (const record of records) this.record(record)
    if (this.deferred.length > 0) throw new Error('embedded-codex: native submission requires an open DSH turn')
  }
}
