import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { NativeBindingJournal } from '../src/runtime/binding.ts'

function session() {
  const value = Session.create(SessionId('native-journal'))
  value.append('turn/start', { turn: 1 })
  return value
}

describe('native route journal', () => {
  it('recovers a confirmed native identity without any assistant message and deduplicates notices', () => {
    const value = session()
    const journal = new NativeBindingJournal(value, 'codex')
    journal.bindThread('thread')
    journal.submitting('thread', 1)
    journal.bindTurn('thread', 'turn', 1)
    const count = value.seq
    journal.bindTurn('thread', 'turn', 1)
    expect(value.seq).toBe(count)
    expect(value.deriveMessages()).toEqual([])
    const recovered = new NativeBindingJournal(Session.create(value.id, value.snapshotEvents(), value.header), 'codex')
    expect(recovered.restored).toMatchObject({ threadId: 'thread', turnId: 'turn', localTurn: 1 })
    expect(recovered.uncertainSubmission).toBe(false)
  })

  it('distinguishes confirmed thread-only state from an ambiguous input submission', () => {
    const value = session()
    const journal = new NativeBindingJournal(value, 'codex')
    journal.bindThread('thread')
    expect(new NativeBindingJournal(value, 'codex').uncertainSubmission).toBe(false)
    journal.submitting('thread', 1)
    const resumed = new NativeBindingJournal(value, 'codex')
    expect(resumed.uncertainSubmission).toBe(true)
    expect(() => resumed.submitting('thread', 2)).toThrow('unresolved')
  })

  it('uses the exact fork prefix, never a later parent turn', () => {
    const value = session()
    const journal = new NativeBindingJournal(value, 'codex')
    journal.bindThread('thread')
    journal.submitting('thread', 1)
    journal.bindTurn('thread', 'earlier', 1)
    const prefix = value.snapshotEvents()
    journal.submitting('thread', 2)
    journal.bindTurn('thread', 'future', 2)
    const childId = SessionId('child')
    const fork = Session.create(childId, prefix, { ...value.header, id: childId, isSeeded: true, parentSession: value.id },
      SessionLogOffset(prefix.length))
    expect(new NativeBindingJournal(fork, 'codex').restored).toMatchObject({ turnId: 'earlier', inherited: true })
  })

  it('can resume after cancellation before the RPC boundary without replaying input', () => {
    const value = session()
    const journal = new NativeBindingJournal(value, 'codex')
    journal.bindThread('thread')
    journal.submitting('thread', 1)
    journal.notSubmitted('thread', 1)
    const recovered = new NativeBindingJournal(value, 'codex')
    expect(recovered.uncertainSubmission).toBe(false)
    expect(recovered.restored).toMatchObject({ threadId: 'thread' })
    expect(() => recovered.submitting('thread', 2)).not.toThrow()
  })

  it('refuses damaged records and foreign-provider identities', () => {
    const value = session()
    value.append('request/context', {
      provider: 'codex', model: 'default',
      embeddedCodex: { kind: 'thread-bound', version: 2, provider: 'codex', threadId: 'thread' } as never,
    })
    expect(() => new NativeBindingJournal(value, 'codex')).toThrow()
    const other = session()
    new NativeBindingJournal(other, 'foreign').bindThread('thread')
    expect(() => new NativeBindingJournal(other, 'codex')).toThrow('another provider')
  })

  it('refuses to fork an input with an unknown native outcome', () => {
    const value = session()
    const journal = new NativeBindingJournal(value, 'codex')
    journal.bindThread('thread')
    journal.submitting('thread', 1)
    const seed = value.snapshotEvents()
    const id = SessionId('unsafe-fork')
    const fork = Session.create(id, seed, { ...value.header, id, isSeeded: true }, SessionLogOffset(seed.length))
    expect(() => new NativeBindingJournal(fork, 'codex')).toThrow('unresolved native submission')
  })
})
