import type { Context } from '@deepseek-ai/cordis'
import type {
  SessionEventLikeEntry,
  SessionLiveEventEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChunkRowEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import {
  ConversationNodeAssembler,
  inspectRequestPrompt,
  type ConversationNodeDefinition,
  type ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isChunkRow, packChunkRuns, type ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import type { ChatSnapshot } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/contract/snapshot.ts'
import { assistantDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { commandDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/command.ts'
import { compactionDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/compaction.ts'
import { unknownFallbackDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/message.ts'
import { requestPromptDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/request-prompt.ts'
import { retryDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/retry.ts'
import { toolDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/tool.ts'
import { turnErrorDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-error.ts'
import { turnMaxTokensDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-max-tokens.ts'
import { turnProcessDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-process.ts'
import { turnTailDefinition } from '../upstream/deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/turn-tail.ts'
import { registerTrajectoryAssistantDefinition } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-compaction-definition.ts'
import type { TrajectorySnapshot } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-contract.ts'
import { registerTrajectoryMessageDefinitions } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-request-header-definition.ts'
import { trajectoryViewDefinition } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from '../upstream/deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts'

const CHAT_DEFINITIONS: readonly ConversationNodeDefinition[] = [
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

const TRAJECTORY_DEFINITIONS: ConversationNodeDefinition[] = []
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

function chunkEntry(row: ChunkRow): SessionEventLikeEntry {
  return {
    type: 'chunks',
    event: {
      type: `chunkrow/${row.type}`,
      seq: row.seq0,
      time: row.time0,
      data: row.data,
    } as ChunkRowEvent,
  }
}

function packed(entries: readonly SessionLiveEventEntry[]): SessionEventLikeEntry[] {
  return packChunkRuns(entries.map(entry => entry.event)).map(record =>
    isChunkRow(record) ? chunkEntry(record) : { type: 'event', event: record })
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
        system: 'Initial System Prompt',
        tools: [],
      },
    }),
    ...toolCalls,
    at(11, 'assistant/message', {
      turn: 1,
      step: 1,
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
      message: {
        id: 'answer-1',
        role: 'assistant',
        source: { kind: 'model', provider: 'codex', model: 'gpt-test' },
        content: [{ type: 'text', text: 'Hello! 馃憢' }],
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
): ConversationNodeAssembler {
  const assembler = new ConversationNodeAssembler(
    new EventDefinitions(definitions),
    new ViewDefinitions(view),
  )
  assembler.replaceWindow(packed(conversationEvents()), false)
  assembler.activateTarget(target)
  return assembler
}

describe('standard DSH Chat and Trajectory projection', () => {
  it('keeps the opening prompt before process tools and the final answer', () => {
    const chatAssembler = assembled('chat', CHAT_DEFINITIONS, chatViewDefinition)
    const chat = chatAssembler.snapshot('chat') as ChatSnapshot
    const chatKinds = chat.order.map(key => chat.nodes.get(key)?.kind)

    expect(chatKinds).toEqual([
      'system-prompt',
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
      blocks: [{ kind: 'text', text: 'Hello! 馃憢' }],
    })

    const trajectoryAssembler = assembled('trajectory', TRAJECTORY_DEFINITIONS, trajectoryViewDefinition)
    const trajectory = trajectoryAssembler.get('trajectory') as TrajectorySnapshot
    expect(trajectory.requests[0]).toMatchObject({
      prompt: { system: 'Initial System Prompt' },
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
