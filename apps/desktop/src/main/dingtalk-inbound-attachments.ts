import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { withChannelInboundFiles, type PendingChannelAttachments } from './channel-inbound-attachments'
import { DingTalkOpenApiError, type DingTalkOpenApiClient } from './dingtalk-open-api'

export function withDingTalkInboundFiles<T>(
  api: Pick<DingTalkOpenApiClient, 'messageFileDownloadUrl'>,
  robotCode: string,
  pending: PendingChannelAttachments,
  consume: (files: string[]) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return withChannelInboundFiles(pending, async (resource, downloadSignal) => {
    if (!resource.downloadCode) throw new Error('channel.attachments.download_failed')
    const url = new URL(await api.messageFileDownloadUrl({
      robotCode, downloadCode: resource.downloadCode, signal: downloadSignal
    }))
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('channel.attachments.download_failed')
    }
    // The signed URL carries its own grant. Never forward App tokens to storage.
    const response = await fetch(url, { signal: downloadSignal })
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new DingTalkOpenApiError('channel.attachments.download_failed', response.status)
    }
    return Readable.fromWeb(response.body as ReadableStream)
  }, consume, signal)
}

export function dingtalkAttachmentFailureCode(error: unknown): string {
  if (error instanceof Error && ['channel.attachments.too_large', 'channel.attachments.unsupported'].includes(error.message)) {
    return error.message
  }
  return error instanceof DingTalkOpenApiError && [401, 403].includes(error.status)
    ? 'channel.attachments.permission_denied'
    : 'channel.attachments.download_failed'
}
