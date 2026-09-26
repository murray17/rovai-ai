import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { LarkChannel, NormalizedMessage, RawMessageEvent } from '@larksuiteoapi/node-sdk'

export type InboundResource = { fileKey: string; name: string; kind: string }
export type PendingFeishuAttachments = {
  requestId: string
  appId: string
  messageId: string
  resources: InboundResource[]
  attempt: number
  retryAt: string | null
}

const MAX_BYTES = 100 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000

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
  if (pending.resources.some(resource => ['sticker', 'folder'].includes(resource.kind))) {
    throw new Error('channel.attachments.unsupported')
  }
  const directory = await mkdtemp(join(tmpdir(), 'rovai-feishu-inbound-'))
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  let total = 0
  try {
    const files: string[] = []
    for (const [ordinal, resource] of pending.resources.entries()) {
      controller.signal.throwIfAborted()
      const download = channel.rawClient.im.v1.messageResource.get({
        path: { message_id: pending.messageId, file_key: resource.fileKey },
        params: { type: resource.kind === 'image' ? 'image' : 'file' }
      })
      // The SDK doesn't expose AbortSignal on this API. A late response is closed
      // without writing, and the local deadline also covers body streaming.
      const response = await new Promise<Awaited<typeof download>>((resolve, reject) => {
        const abort = (): void => reject(new Error('channel.attachments.download_failed'))
        controller.signal.addEventListener('abort', abort, { once: true })
        void download.then(result => {
          controller.signal.removeEventListener('abort', abort)
          if (controller.signal.aborted) {
            try { result.getReadableStream().destroy() } catch { /* SDK may have already closed it. */ }
          } else resolve(result)
        }, error => {
          controller.signal.removeEventListener('abort', abort)
          reject(error)
        })
      })
      const path = join(directory, `${ordinal}.download`)
      await pipeline(response.getReadableStream(), new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          total += chunk.length
          callback(total > MAX_BYTES ? new Error('channel.attachments.too_large') : null, chunk)
        }
      }), createWriteStream(path, { flags: 'wx' }), { signal: controller.signal })
      files.push(path)
    }
    clearTimeout(timer)
    return await consume(files)
  } finally {
    clearTimeout(timer)
    controller.abort()
    signal?.removeEventListener('abort', abort)
    await rm(directory, { recursive: true, force: true })
  }
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
