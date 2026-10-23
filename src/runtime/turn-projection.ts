import type { ContentBlock, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { asObject, asNumber, json, type JsonObject } from './protocol-values.ts'

export interface TextRecord {
  readonly itemId: string
  readonly index: number
  readonly kind: 'text' | 'reasoning'
  phase?: 'commentary' | 'partial_answer' | 'final_answer' | null
  delivery?: 'async' | null
  text: string
  open: boolean
}

export interface ToolRecord {
  readonly itemId: string
  readonly index: number
  readonly kind: 'tool-call'
  readonly callId: ToolCallId
  readonly name: string
  readonly arguments: string
  readonly step: number
  completed: boolean
}

export type AssistantRecord = TextRecord | ToolRecord

export function agentMessageKind(item: JsonObject): TextRecord['kind'] {
  if (item.phase === 'commentary' || item.phase === 'partial_answer'
    || item.phase === 'final_answer' || item.phase === null) return 'text'
  throw new Error('embedded-codex: App Server returned invalid agent-message phase')
}

export function assistantContent(records: readonly AssistantRecord[]): ContentBlock[] {
  return records.flatMap((record): ContentBlock[] => {
    if (record.kind === 'tool-call') {
      return [{
        type: 'tool-call',
        id: record.callId,
        name: record.name,
        arguments: record.arguments,
      }]
    }
    return record.text.length === 0 ? [] : [{ type: record.kind, text: record.text }]
  })
}

export function toolDescriptor(item: JsonObject): { name: string; arguments: string } | undefined {
  switch (item.type) {
    case 'commandExecution':
      return { name: 'codex.command', arguments: json({ command: item.command, cwd: item.cwd, source: item.source }) }
    case 'fileChange':
      return { name: 'codex.file_change', arguments: json({ changes: item.changes }) }
    case 'mcpToolCall':
      return { name: 'codex.mcp_tool', arguments: json({ server: item.server, tool: item.tool, arguments: item.arguments }) }
    case 'dynamicToolCall':
      return { name: 'codex.dynamic_tool', arguments: json({ namespace: item.namespace, tool: item.tool, arguments: item.arguments }) }
    case 'collabAgentToolCall':
      return { name: 'codex.collab_agent', arguments: json({ tool: item.tool, prompt: item.prompt, model: item.model }) }
    case 'subAgentActivity':
      return { name: 'codex.subagent_activity', arguments: json({ kind: item.kind, agentThreadId: item.agentThreadId, agentPath: item.agentPath }) }
    case 'webSearch':
      return { name: 'codex.web_search', arguments: json({ query: item.query, action: item.action }) }
    case 'imageView':
      return { name: 'codex.image_view', arguments: json({ path: item.path }) }
    case 'sleep':
      return { name: 'codex.sleep', arguments: json(item) }
    case 'imageGeneration':
      return { name: 'codex.image_generation', arguments: json(item) }
    case 'hookPrompt':
      return { name: 'codex.hook_prompt', arguments: json({ fragments: item.fragments }) }
    case 'enteredReviewMode':
      return { name: 'codex.review_mode_entered', arguments: json({ review: item.review }) }
    case 'exitedReviewMode':
      return { name: 'codex.review_mode_exited', arguments: json({ review: item.review }) }
    case 'contextCompaction':
      return { name: 'codex.context_compaction', arguments: '{}' }
    default:
      return undefined
  }
}

export function toolResult(item: JsonObject): { text: string; isError: boolean } {
  const status = typeof item.status === 'string' ? item.status : undefined
  const isError = status === 'failed' || status === 'declined' || item.success === false
  switch (item.type) {
    case 'commandExecution':
      return {
        text: typeof item.aggregatedOutput === 'string'
          ? item.aggregatedOutput
          : json({ status, exitCode: item.exitCode, durationMs: item.durationMs }),
        isError,
      }
    case 'fileChange':
      return { text: json({ status, changes: item.changes }), isError }
    case 'mcpToolCall':
      return { text: json(item.error ?? item.result ?? { status }), isError }
    case 'dynamicToolCall':
      return { text: json(item.contentItems ?? { status }), isError }
    case 'collabAgentToolCall':
      return { text: json({ status, receiverThreadIds: item.receiverThreadIds, agentsStates: item.agentsStates }), isError }
    case 'webSearch':
      return { text: json({ results: item.results, action: item.action }), isError: false }
    default:
      return { text: json(item), isError }
  }
}

export function tokenUsage(value: unknown): TokenUsage {
  const usage = asObject(value, 'token usage')
  const input = asNumber(usage.inputTokens, 'input token count')
  const cacheRead = asNumber(usage.cachedInputTokens, 'cached input token count')
  const cacheWrite = asNumber(usage.cacheWriteInputTokens, 'cache-write input token count')
  const output = asNumber(usage.outputTokens, 'output token count')
  const total = asNumber(usage.totalTokens, 'total token count')
  const reasoning = asNumber(usage.reasoningOutputTokens, 'reasoning token count')
  if (cacheRead + cacheWrite > input) {
    throw new Error('embedded-codex: App Server returned token cache counts above the input token count')
  }
  return {
    inputTokens: input - cacheRead - cacheWrite,
    outputTokens: output,
    totalTokens: total,
    ...(cacheRead === 0 ? {} : { cacheReadTokens: cacheRead }),
    ...(cacheWrite === 0 ? {} : { cacheWriteTokens: cacheWrite }),
    ...(reasoning === 0 ? {} : { reasoningTokens: reasoning }),
  }
}
