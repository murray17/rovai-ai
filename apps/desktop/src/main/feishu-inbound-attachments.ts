import type { LarkChannel, NormalizedMessage, RawMessageEvent } from '@larksuiteoapi/node-sdk'
import { withChannelInboundFiles, type InboundResource, type PendingChannelAttachments } from './channel-inbound-attachments'

export type { InboundResource } from './channel-inbound-attachments'
export type PendingFeishuAttachments = PendingChannelAttachments

export function feishuInboundResources(message: NormalizedMessage): InboundResource[] {
  const resources: InboundResource[] = message.resources.map(resource => ({
    fileKey: resource.fileKey, name: resource.fileName || resource.type, kind: resource.type
  }))
  // SDK 1.73 normalizes post.content but omits the sibling post.files array
  // returned by Feishu for text composed together with file attachments.
  if (message.rawContentType === 'post' && message.raw) {
    let post
    try { post = JSON.parse((message.raw as RawMessageEvent).message.content) } catch { post = null }
    const body = Array.isArray(post?.content) ? post
      : Object.values(post ?? {}).find((value): value is { content: unknown[]; files?: unknown } =>
        typeof value === 'object' && value !== null && 'content' in value && Array.isArray(value.content))
    if (Array.isArray(body?.files)) {
      for (const file of body.files) {
        if (typeof file?.file_key !== 'string' || !file.file_key) continue
        resources.push({ fileKey: file.file_key,
          name: typeof file.file_name === 'string' ? file.file_name : 'file',
          kind: file.is_folder === true ? 'folder' : 'file' })
      }
    }
  }
  const seen = new Set<string>()
  return resources.flatMap(resource => {
    if (seen.has(resource.fileKey)) return []
    seen.add(resource.fileKey)
    return [resource]
  })
}

// This API downloads resources *received in a message*. LarkChannel.downloadResource
// uses the app-upload API, which cannot read arbitrary user-sent attachments.
// https://open.feishu.cn/document/server-docs/im-v1/message-resource/get
export async function withFeishuInboundFiles<T>(
  channel: Pick<LarkChannel, 'rawClient'>,
  pending: PendingFeishuAttachments,
  consume: (files: string[]) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return withChannelInboundFiles(pending, async (resource, downloadSignal) => {
    const download = channel.rawClient.im.v1.messageResource.get({
      path: { message_id: pending.messageId, file_key: resource.fileKey },
      params: { type: resource.kind === 'image' ? 'image' : 'file' }
    })
    // The SDK does not expose AbortSignal. Close late responses without writing.
    const response = await new Promise<Awaited<typeof download>>((resolve, reject) => {
      const abort = (): void => reject(new Error('channel.attachments.download_failed'))
      downloadSignal.addEventListener('abort', abort, { once: true })
      void download.then(result => {
        downloadSignal.removeEventListener('abort', abort)
        if (downloadSignal.aborted) {
          try { result.getReadableStream().destroy() } catch { /* Already closed by SDK. */ }
        } else resolve(result)
      }, error => {
        downloadSignal.removeEventListener('abort', abort)
        reject(error)
      })
    })
    return response.getReadableStream()
  }, consume, signal)
}

export function feishuAttachmentFailureCode(error: unknown): string {
  if (error instanceof Error && ['channel.attachments.too_large', 'channel.attachments.unsupported'].includes(error.message)) {
    return error.message
  }
  // HTTP authorization failures are stable transport facts; don't guess Feishu
  // business codes or expose response bodies/credentials in a public message.
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  return status === 401 || status === 403
    ? 'channel.attachments.permission_denied'
    : 'channel.attachments.download_failed'
}
