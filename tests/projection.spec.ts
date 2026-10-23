import { enrichNativeHistory, nativeStepDefinition } from '../src/client/transcript.ts'
import { readNativeHistory } from '../src/runtime/history.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  ConversationNodeAssembler,
  inspectRequestPrompt,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { LlmAttemptId } from '@deepseek-ai/dsh-llm/brand'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { ChatNodeSeat } from '../compat/generated/packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx'
import { TurnProcessNodeView } from '../compat/generated/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx'
import { createChatStore } from '../compat/generated/packages/client/ui-chat/src/client/stores.ts'
import { presentationPolicyFor } from '../compat/generated/packages/client/ui-chat/src/client/presentation-policy.ts'
import type { ChatNodeViewProps } from '../compat/generated/packages/client/ui-chat/src/client/contract/slots.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatSnapshot } from '../compat/generated/packages/client/ui-chat/src/client/contract/snapshot.ts'
import { assistantDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { commandDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/command.ts'
import { compactionDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/message.ts'
import { requestPromptDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/request-prompt.ts'
import { retryDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/retry.ts'
import { toolDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/tool.ts'
import { turnErrorDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts'
import { turnMaxTokensDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/turn-max-tokens.ts'
import { turnProcessDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts'
import { turnTailDefinition } from '../compat/generated/packages/client/ui-chat/src/client/conversation-nodes/turn-tail.ts'
import { registerTrajectoryAssistantDefinition } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-compaction-definition.ts'
import type { TrajectorySnapshot } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-contract.ts'
import { registerTrajectoryMessageDefinitions } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-request-header-definition.ts'
import { trajectoryViewDefinition } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from '../compat/generated/packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts'

const CHAT_DEFINITIONS: readonly ConversationNodeDefinition[] = [
  nativeStepDefinition,
  nextStepInboxDefinition,
  messageDefinition,
  requestPromptDefinition(inspectRequestPrompt),
  assistantDefinition,
  turnProcessDefinition,
  toolDefinition,
  commandDefinition,
  compactionDefinition,
  retryDefinition,
  turnErrorDefinition,
  turnMaxTokensDefinition,
  turnTailDefinition,
]

const TRAJECTORY_DEFINITIONS: ConversationNodeDefinition[] = [nativeStepDefinition]
const trajectoryRegistration = {
  uiConversation: {
    events: {
      register: (definition: ConversationNodeDefinition) => {
        TRAJECTORY_DEFINITIONS.push(definition)
        return () => undefined
      },
    },
    inspectRequestPrompt,
  },
} as unknown as Context
registerTrajectoryMessageDefinitions(trajectoryRegistration)
registerTrajectoryRequestHeaderDefinition(trajectoryRegistration)
registerTrajectoryAssistantDefinition(trajectoryRegistration)
registerTrajectoryToolDefinition(trajectoryRegistration)
registerTrajectoryCompactionDefinitions(trajectoryRegistration)

class EventDefinitions {
  constructor(private readonly definitions: readonly ConversationNodeDefinition[]) {}

  entries(): readonly ConversationNodeDefinition[] {
    return this.definitions
  }

  fallbackEntry(): ConversationNodeDefinition | undefined {
    return this.definitions === CHAT_DEFINITIONS ? unknownFallbackDefinition : undefined
  }
}

class ViewDefinitions {
  constructor(private readonly definition: ConversationViewDefinition) {}

  entries(): readonly ConversationViewDefinition[] {
    return [this.definition]
  }
}

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as SessionEvent,
  }
}

function conversationEvents(): SessionLiveEventEntry[] {
  const user = {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'say hello' }],
    source: { kind: 'user' },
  }
  const toolCalls = [1, 2, 3].flatMap((index, offset) => [
    at(5 + offset * 2, 'tool/call', {
      turn: 1,
      step: 1,
      callId: `codex:command-${index}`,
      name: 'codex.command',
      arguments: JSON.stringify({ command: `echo fixture-${index}` }),
    }),
    at(6 + offset * 2, 'tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: `tool-${index}`,
        role: 'user',
        source: { kind: 'tool', callId: `codex:command-${index}` },
        content: [{
          type: 'tool-result',
          toolCallId: `codex:command-${index}`,
          content: [{ type: 'text', text: `fixture-${index}\n` }],
          isError: false,
        }],
      },
    }, { surfaceOp: 'append' }),
  ])
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'user/message', user, { surfaceOp: 'append' }),
    at(4, 'request/header', {
      reason: 'initial',
      header: {
        config: { provider: 'codex', model: 'default' },
        tools: [],
      },
    }),
    ...toolCalls,
    at(11, 'assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: {
        id: 'process-1',
        role: 'assistant',
        source: { kind: 'model', provider: 'codex', model: 'gpt-test' },
        content: [
          { type: 'reasoning', text: 'Checking the fixture.' },
          ...[1, 2, 3].map(index => ({
            type: 'tool-call',
            id: `codex:command-${index}`,
            name: 'codex.command',
            arguments: JSON.stringify({ command: `echo fixture-${index}` }),
          })),
        ],
      },
    }, { surfaceOp: 'append' }),
    at(12, 'step/end', { turn: 1, step: 1 }),
    at(13, 'step/start', { turn: 1, step: 2 }),
    at(14, 'assistant/message', {
      turn: 1,
      step: 2,
      stream: [],
      message: {
        id: 'answer-1',
        role: 'assistant',
        source: { kind: 'model', provider: 'codex', model: 'gpt-test' },
        content: [{ type: 'text', text: 'Hello! 👋' }],
      },
    }, { surfaceOp: 'append' }),
    at(15, 'step/end', { turn: 1, step: 2 }),
    at(16, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

function assembled(
  target: 'chat' | 'trajectory',
  definitions: readonly ConversationNodeDefinition[],
  view: ConversationViewDefinition,
  entries: readonly SessionLiveEventEntry[] = conversationEvents(),
): ConversationNodeAssembler {
  const assembler = new ConversationNodeAssembler(
    new EventDefinitions(definitions),
    new ViewDefinitions(view),
  )
  assembler.replaceWindow(entries, false)
  assembler.activateTarget(target)
  return assembler
}

describe('standard DSH Chat and Trajectory projection', () => {
  it('keeps the user prompt before process tools and the final answer', () => {
    const chatAssembler = assembled('chat', CHAT_DEFINITIONS, chatViewDefinition)
    const chat = chatAssembler.snapshot('chat') as ChatSnapshot
    const chatKinds = chat.order.map(key => chat.nodes.get(key)?.kind)

    expect(chatKinds).toEqual([
      'user',
      'turn-process',
      'tool-call',
      'tool-call',
      'tool-call',
      'assistant-step',
      'assistant-step',
      'turn-tail',
    ])
    const assistants = chat.order.flatMap((key) => {
      const node = chat.nodes.get(key)
      return node?.kind === 'assistant-step' ? [node.data] : []
    })
    expect(assistants[0]).toMatchObject({ status: 'settled', turn: 1, step: 1 })
    expect(assistants[1]).toMatchObject({
      status: 'settled',
      turn: 1,
      step: 2,
      blocks: [{ kind: 'text', text: 'Hello! 👋' }],
    })

    const trajectoryAssembler = assembled('trajectory', TRAJECTORY_DEFINITIONS, trajectoryViewDefinition)
    const trajectory = trajectoryAssembler.get('trajectory') as TrajectorySnapshot
    expect(trajectory.requests[0]).toMatchObject({
      prompt: { system: '' },
      startSeq: 2,
    })
    const significant = trajectory.eventNodes.flatMap(node => {
      if (node.kind === 'user') return ['user']
      if (node.kind === 'tool-result') return ['tool']
      if (node.kind === 'assistant') return ['assistant']
      return []
    })
    expect(significant).toEqual([
      'user', 'tool', 'tool', 'tool', 'assistant', 'assistant',
    ])
  })
})

function nativeEvents(): SessionLiveEventEntry[] {
  const message = (content: unknown[], items: unknown[], attempt: string) => ({
    role: 'assistant', id: attempt, content,
    source: { kind: 'model', provider: 'codex', model: 'gpt-test', replayState: {
      embeddedCodex: { version: 1, threadId: 'native-thread', turnId: 'native-turn' },
      embeddedCodexMessage: { version: 1, attemptId: attempt, items },
    } },
  })
  const call = (id: string) => ({ type: 'tool-call', id: `codex:${id}`, name: 'codex.command', arguments: '{}' })
  return [
    at(0, 'turn/start', { turn: 1 }),
    at(1, 'step/start', { turn: 1, step: 1 }),
    at(2, 'user/message', { id: 'native-user', role: 'user', content: [{ type: 'text', text: 'Investigate' }], source: { kind: 'user' } }, { surfaceOp: 'append' }),
    at(3, 'request/context', { provider: 'codex', model: 'gpt-test', embeddedCodex: {
      kind: 'turn-bound', version: 1, provider: 'codex', threadId: 'native-thread', turnId: 'native-turn', localTurn: 1,
    } }),
    at(4, 'assistant/message', { turn: 1, step: 1, stream: [], message: message([
      { type: 'text', text: 'Checking the logs.' }, call('a'),
    ], [{ id: 'progress', type: 'agentMessage', phase: 'commentary' }, { id: 'a', type: 'tool' }], 'session:codex:1:1:1') }, { surfaceOp: 'append' }),
    at(5, 'tool/call', { turn: 1, step: 1, callId: 'codex:a', name: 'codex.command', arguments: '{}' }),
    at(6, 'assistant/message', { turn: 1, step: 1, stream: [], message: message([call('b')], [{ id: 'b', type: 'tool' }], 'session:codex:1:1:2') }, { surfaceOp: 'append' }),
    at(7, 'tool/call', { turn: 1, step: 1, callId: 'codex:b', name: 'codex.command', arguments: '{}' }),
    ...['b', 'a'].map((id, index) => at(8 + index, 'tool/result', { turn: 1, step: 1, message: {
      id: `result-${id}`, role: 'tool', source: { kind: 'tool', callId: `codex:${id}` }, toolCallId: `codex:${id}`, content: [{ type: 'text', text: id }],
    } }, { surfaceOp: 'append' })),
    at(10, 'step/end', { turn: 1, step: 1 }),
    at(11, 'step/start', { turn: 1, step: 2 }),
    at(12, 'assistant/message', { turn: 1, step: 2, stream: [], message: message([{ type: 'text', text: 'The final answer.' }], [
      { id: 'answer', type: 'agentMessage', phase: 'final_answer' },
    ], 'session:codex:1:2:3') }, { surfaceOp: 'append' }),
    at(13, 'step/end', { turn: 1, step: 2 }),
    at(14, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('native Codex transcript', () => {
  it('preserves same-step progress and adopts native tool order in both conversation views', async () => {
    const entries = nativeEvents()
    const snapshots = await readNativeHistory(entries.map(entry => entry.event), async () => [
      { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checking the logs.' },
      { id: 'b', type: 'commandExecution' },
      { id: 'a', type: 'commandExecution' },
      { id: 'question', type: 'agentMessage', phase: 'final_answer', delivery: 'async', text: 'When was the photo taken?', questions: [{ title: 'When was the photo taken?', options: null }] },
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'The final answer.' },
    ])
    const enriched = enrichNativeHistory(entries, snapshots)
    const chat = new ConversationNodeAssembler(new EventDefinitions(CHAT_DEFINITIONS), new ViewDefinitions(chatViewDefinition))
    chat.replaceWindow(enriched, false)
    chat.activateTarget('chat')
    const view = chat.snapshot('chat') as ChatSnapshot
    const nodes = view.order.flatMap(key => { const node = view.nodes.get(key); return node === undefined ? [] : [node] })
    const messages = nodes.flatMap(node => node.kind === 'assistant-step' ? node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []) : [])
    expect(messages).toEqual(['Checking the logs.', 'When was the photo taken?', 'The final answer.'])
    expect(nodes.flatMap(node => node.kind === 'tool-call' ? [node.data.root.callId] : [])).toEqual(['codex:b', 'codex:a'])
    const tail = nodes.find(node => node.kind === 'turn-tail')
    expect(tail?.kind === 'turn-tail' ? tail.data.closing?.finalNode.seq : undefined).toBe(12)
    expect(nodes.at(-1)?.kind).toBe('turn-tail')
    const answer = nodes.find(node => node.kind === 'assistant-step' && node.data.finalNode?.seq === 12)
    const process = nodes.find(node => node.kind === 'turn-process')
    expect(process?.kind === 'turn-process' ? process.data.answerAnchorSeq : undefined).toBe(answer?.anchorSeq)
    expect(tail?.kind === 'turn-tail' ? tail.data.branchUnavailable : undefined).toBe(false)

    const trajectory = new ConversationNodeAssembler(new EventDefinitions(TRAJECTORY_DEFINITIONS), new ViewDefinitions(trajectoryViewDefinition))
    trajectory.replaceWindow(enriched, false)
    trajectory.activateTarget('trajectory')
    const ledger = trajectory.get('trajectory') as TrajectorySnapshot
    expect(ledger.requests).toEqual([expect.objectContaining({ purpose: 'assistant', startSeq: 11, resultSeq: 12, status: 'complete' })])
    expect(ledger.eventNodes.flatMap(node => node.kind === 'assistant' ? node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []) : []))
      .toEqual(messages)
    expect(ledger.eventNodes.flatMap(node => node.kind === 'tool-result' ? [node.callId] : [])).toEqual(['codex:b', 'codex:a'])

    const partial = enrichNativeHistory(entries.filter(entry => entry.event.seq >= 5), snapshots)
    chat.replaceWindow(partial, true)
    chat.flush()
    const partialView = chat.snapshot('chat') as ChatSnapshot
    const partialNodes = partialView.order.flatMap(key => { const node = partialView.nodes.get(key); return node === undefined ? [] : [node] })
    expect(partialNodes.flatMap(node => node.kind === 'tool-call' ? [node.data.root.callId] : [])).toEqual(['codex:b', 'codex:a'])
    expect(partialNodes.flatMap(node => node.kind === 'assistant-step' ? node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []) : []))
      .toEqual(['When was the photo taken?', 'The final answer.'])

    const refreshed = enrichNativeHistory(enriched, snapshots)
    chat.replaceWindow(refreshed, false)
    chat.flush()
    const replay = chat.snapshot('chat') as ChatSnapshot
    expect(replay.order).toEqual(view.order)
  })

  it('does not fetch a native suffix for a fork prefix without its completed turn boundary', async () => {
    const entries = nativeEvents().filter(entry => entry.event.seq < 12)
    let calls = 0
    expect(await readNativeHistory(entries.map(entry => entry.event), async () => { calls++; return [] })).toEqual([])
    expect(calls).toBe(0)
  })

  it('keeps the final answer key when its live attempt settles', () => {
    const entries = nativeEvents()
    const attemptId = LlmAttemptId('session:codex:1:2:3')
    const chat = assembled('chat', CHAT_DEFINITIONS, chatViewDefinition, entries.filter(entry => entry.event.seq < 12))
    chat.append({ type: 'transient', event: {
      type: 'assistant/live-chunk', seq: 11.5, time: 1_700_000_000_012,
      data: { turn: 1, step: 2, attemptId, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: 'The final answer.' } } },
    } })
    chat.flush()
    const before = chat.snapshot('chat') as ChatSnapshot
    const live = before.order.find(key => {
      const node = before.nodes.get(key)
      return node?.kind === 'assistant-step' && node.data.blocks.some(block => block.kind === 'text' && block.text === 'The final answer.')
    })
    expect(live).toBeDefined()
    const settlement = entries.find(entry => entry.event.seq === 12)
    if (settlement?.type !== 'event' || settlement.event.type !== 'assistant/message') throw new Error('missing final message')
    chat.settleAssistant(attemptId, { type: 'event', event: settlement.event })
    for (const entry of entries.filter(entry => entry.event.seq > 12)) chat.append(entry)
    chat.flush()
    const after = chat.snapshot('chat') as ChatSnapshot
    const answers = after.order.filter(key => {
      const node = after.nodes.get(key)
      return node?.kind === 'assistant-step' && node.data.blocks.some(block => block.kind === 'text' && block.text === 'The final answer.')
    })
    expect(answers).toEqual([live])
    expect(after.nodes.get(live ?? '')).toMatchObject({ data: { status: 'settled', finalNode: { seq: 12 } } })
  })

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'keeps the answer visible through repeated disclosure toggles (same step: %s, partial: %s)', async (sameStep, partial) => {
    const entries = nativeEvents().filter(entry => ![5, 6, 7, 8, 9, ...(sameStep ? [10, 11] : [])].includes(entry.event.seq))
      .map(entry => {
        const event = entry.event
        if (event.type === 'assistant/message') return { ...entry, event: { ...event, data: { ...event.data,
          step: sameStep ? 1 : event.data.step,
          message: { ...event.data.message, content: event.data.message.content.filter(block => block.type !== 'tool-call') },
        } } }
        if (sameStep && event.type === 'step/end') return { ...entry, event: { ...event, data: { ...event.data, step: 1 } } }
        return entry
      })
    const snapshots = await readNativeHistory(entries.map(entry => entry.event), async () => [
      { id: 'progress', type: 'agentMessage', phase: 'commentary', text: 'Checking the logs.' },
      { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'The final answer.' },
    ])
    const chat = assembled('chat', CHAT_DEFINITIONS, chatViewDefinition,
      enrichNativeHistory(partial ? entries.filter(entry => entry.event.seq >= 4) : entries, snapshots))
    const view = chat.snapshot('chat') as ChatSnapshot
    const require = createRequire(new URL('../upstream/deepseek-harness/packages/client/ui-chat/package.json', import.meta.url))
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createElement } = require('react')
    const { render, fireEvent, cleanup } = require('@testing-library/react/pure')
    try {
      const store = createChatStore().create()
      const useStore = bindSnapshotSelector(store)
      const props = {
        nodeStore: view.nodes,
        useChatNode: (key: string) => view.nodes.get(key),
        useChatNodeProcess: (key: string) => view.nodes.processSource(key).getSnapshot(),
        usePresentation: (select: Parameters<ChatNodeViewProps['usePresentation']>[0]) => select(presentationPolicyFor('compact')),
        useStore, actions: store.actions,
        t: (key: string) => key,
        renderSlot: (_name: string, owner: ChatNodeViewProps) => {
          if (owner.node.kind === 'turn-process') return createElement(TurnProcessNodeView, { ...owner, t: (key: string) => key })
          if (owner.node.kind === 'assistant-step') return createElement('p', null,
            owner.node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n'))
          return createElement('span', null, owner.node.kind)
        },
      }
      const rendered = render(createElement('div', null, ...view.order.map(nodeKey => createElement(ChatNodeSeat, { ...props, nodeKey, key: nodeKey }))))
      const control = rendered.container.querySelector('[data-turn-process="1"]')
      const progress = [...rendered.container.querySelectorAll('p')].find(node => node.textContent === 'Checking the logs.')
      const answer = [...rendered.container.querySelectorAll('p')].find(node => node.textContent === 'The final answer.')
      expect(control?.disabled).toBe(false)
      expect(control?.getAttribute('data-turn-process-messages')).toBe('1')
      expect(progress).toBeDefined()
      expect(answer).toBeDefined()
      expect(progress?.closest('[data-chat-flow-key]')?.hasAttribute('hidden')).toBe(true)
      expect(answer?.closest('[data-chat-flow-key]')?.hasAttribute('hidden')).toBe(false)
      for (const expanded of [true, false, true, false]) {
        fireEvent.click(control)
        expect(control?.getAttribute('aria-expanded')).toBe(String(expanded))
        expect(progress?.closest('[data-chat-flow-key]')?.hasAttribute('hidden')).toBe(!expanded)
        expect(answer?.closest('[data-chat-flow-key]')?.hasAttribute('hidden')).toBe(false)
        expect(rendered.container.querySelector('[data-chat-flow-kind="turn-tail"]')?.hasAttribute('hidden')).toBe(false)
      }
    } finally {
      cleanup()
      dom.window.close()
      vi.unstubAllGlobals()
    }
  })
})
