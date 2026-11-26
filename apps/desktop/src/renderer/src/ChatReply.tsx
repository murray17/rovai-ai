import { useCallback } from 'react'
import type { FilePreviewBinaryContent, FilePreviewOperationResult, ResolvedTheme } from '@contracts'
import { useThreadClient } from './camp-client'
import { useFilePreviewApi, useOptionalFilePreview } from './FilePreviewContext'
import { MessageMarkdown } from './MessageMarkdown'
import { uiAttribute } from './interface-language'

export function ChatReply({
  chatId,
  messageId,
  body,
  theme
}: {
  chatId: string
  messageId: string
  body: string
  theme: ResolvedTheme
}) {
  const client = useThreadClient()
  const preview = useOptionalFilePreview()
  const api = useFilePreviewApi()
  const request = useCallback(
    (rawReference: string) => ({ kind: 'message_reference' as const, threadId: chatId, messageId, rawReference }),
    [chatId, messageId]
  )
  const verify = useCallback(
    (rawReference: string) => client.request<boolean>('chats.canPreviewFile', { chatId, messageId, rawReference }),
    [client, chatId, messageId]
  )
  const image = useCallback(
    async (raw: string): Promise<FilePreviewOperationResult<FilePreviewBinaryContent>> => {
      const result = await api.open(request(raw))
      if (!result.ok) return result
      if (result.value.kind !== 'file_preview')
        return {
          ok: false,
          error: { code: 'source_not_authorized', message: uiAttribute('无法预览图片'), retryable: false }
        }
      const file = result.value.file
      try {
        return await api.readBinary({ handleId: file.handleId, expectedGeneration: file.contentGeneration })
      } finally {
        await api.release({ handleId: file.handleId })
      }
    },
    [api, request]
  )
  return (
    <MessageMarkdown
      theme={theme}
      verifyFileReference={verify}
      onFileReference={(raw, _source, target) => {
        void preview?.open(request(raw), target)
      }}
      localImageContent={image}
    >
      {body}
    </MessageMarkdown>
  )
}
