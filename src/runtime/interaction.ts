import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { asObject, asString, type JsonObject } from './protocol-values.ts'

interface InteractionServices {
  approval: Context['approval'] | undefined
  userQuestions: Context['userQuestions'] | undefined
}

/** Translate native interactions without owning the Agent's scheduling or mutable turn state. */
export async function answerInteraction(agent: Agent, services: InteractionServices, method: string, params: JsonObject, signal?: AbortSignal): Promise<unknown> {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval': {
        const approval = services.approval
        if (approval === undefined) return { decision: 'decline' }
        const outcome = await approval.request({
          agent,
          toolName: method.includes('commandExecution') ? 'codex.command' : 'codex.file_change',
          callId: ToolCallId(`codex:${asString(params.itemId, `${method} item id`)}`),
          ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
          ...(signal === undefined ? {} : { signal }),
        })
        return { decision: outcome === 'allowed-once' ? 'accept' : outcome === 'cancelled' ? 'cancel' : 'decline' }
      }
      case 'item/permissions/requestApproval': {
        const approval = services.approval
        if (approval === undefined) return { permissions: {}, scope: 'turn' }
        const outcome = await approval.request({
          agent,
          toolName: 'codex.permissions',
          callId: ToolCallId(`codex:${asString(params.itemId, 'permission item id')}`),
          ...(typeof params.reason === 'string' ? { reason: params.reason } : {}),
          ...(signal === undefined ? {} : { signal }),
        })
        if (outcome !== 'allowed-once') return { permissions: {}, scope: 'turn' }
        const requested = asObject(params.permissions, 'requested permissions')
        return {
          permissions: {
            ...(requested.network === null || requested.network === undefined ? {} : { network: requested.network }),
            ...(requested.fileSystem === null || requested.fileSystem === undefined ? {} : { fileSystem: requested.fileSystem }),
          },
          scope: 'turn',
        }
      }
      case 'item/tool/requestUserInput': {
        const questions = services.userQuestions
        if (questions === undefined) return { answers: {} }
        const rawQuestions = params.questions
        if (!Array.isArray(rawQuestions)) throw new Error('embedded-codex: App Server returned invalid user questions')
        const mapped: AskUserQuestionItem[] = rawQuestions.map((value) => {
          const question = asObject(value, 'user question')
          const options = question.options
          return {
            id: asString(question.id, 'user question id'),
            header: asString(question.header, 'user question header'),
            question: asString(question.question, 'user question text'),
            ...(options === null ? {} : {
              options: Array.isArray(options)
                ? options.map((candidate) => {
                  const option = asObject(candidate, 'user question option')
                  return {
                    label: asString(option.label, 'user question option label'),
                    ...(typeof option.description === 'string' ? { description: option.description } : {}),
                  }
                })
                : (() => { throw new Error('embedded-codex: App Server returned invalid user question options') })(),
            }),
          }
        })
        const answer = await questions.ask({ questions: mapped, agent, ...(signal === undefined ? {} : { signal }) })
        return {
          answers: Object.fromEntries(answer.answers.map(item => [item.id, {
            answers: [...item.selected, ...item.custom === undefined ? [] : [item.custom]],
          }])),
        }
      }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null }
      default:
        throw new Error(`embedded-codex: unsupported App Server request ${JSON.stringify(method)}`)
    }
}
