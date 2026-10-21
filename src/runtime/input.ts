import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { fileHandleText, offloadedImageText, type ContentBlock, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import type { UserInput } from '../../protocol/v2/UserInput.ts'

function textForContent(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-call':
      return `${block.name}(${block.arguments})`
    case 'image':
      return ''
    default:
      return ''
  }
}

export async function messageInputs(
  ctx: Context,
  messages: readonly UserMessage[],
  signal: AbortSignal,
): Promise<UserInput[]> {
  const inputs: UserInput[] = []
  for (const message of messages) {
    for (const block of message.content) {
      signal.throwIfAborted()
      if (block.type === 'image') {
        const attachments: AttachmentStore | undefined = ctx.get('attachments')
        if (attachments === undefined) {
          throw new Error('embedded-codex: image input requires an attachment provider')
        }
        if (block.offloaded === true) {
          let access: { readonlyPath: string } | undefined
          try {
            const hostPath = attachments.imageHostPath(block.attachment)
            const readonlyPath = hostPath === undefined ? undefined : ctx.get('fs')?.processPathFromHostPath(hostPath)
            if (readonlyPath !== undefined) access = { readonlyPath }
          } catch {
            // A malformed durable reference degrades to the no-path placeholder.
          }
          inputs.push({ type: 'text', text: offloadedImageText(block.attachment, access), text_elements: [] })
          continue
        }
        const path = attachments.imageHostPath(block.attachment)
        if (path !== undefined) {
          inputs.push({ type: 'localImage', path })
        } else {
          const stored = await attachments.readImage(block.attachment, signal)
          inputs.push({
            type: 'image',
            url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`,
          })
        }
        continue
      }
      if (block.type === 'file') {
        const attachments: AttachmentStore | undefined = ctx.get('attachments')
        if (attachments === undefined) {
          throw new Error('embedded-codex: file input requires an attachment provider')
        }
        let processPath: string | undefined
        try {
          const hostPath = attachments.fileHostPath(block.attachment)
          processPath = hostPath === undefined ? undefined : ctx.get('fs')?.processPathFromHostPath(hostPath)
        } catch {
          // A malformed durable reference degrades to the deterministic no-path handle.
        }
        inputs.push({ type: 'text', text: fileHandleText(block.attachment, processPath), text_elements: [] })
        continue
      }
      const text = textForContent(block)
      if (text.length > 0) inputs.push({ type: 'text', text, text_elements: [] })
    }
  }
  if (inputs.length === 0) throw new Error('embedded-codex: a turn requires text or image input')
  return inputs
}

