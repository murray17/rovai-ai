import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type InboundResource = {
  fileKey: string
  name: string
  kind: string
  /** DingTalk grants belong to the receiving Bot, independently of resource order. */
  downloadCode?: string
}

export type PendingChannelAttachments = {
  requestId: string
  appId: string
  messageId: string
  resources: InboundResource[]
  attempt: number
  retryAt: string | null
}

const MAX_BYTES = 100 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000

/** Keep the entire batch alive until Core has imported it or rejected completion. */
export async function withChannelInboundFiles<T>(
  pending: PendingChannelAttachments,
  open: (resource: InboundResource, signal: AbortSignal) => Promise<Readable>,
  consume: (files: string[]) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (pending.resources.some(resource => ['sticker', 'folder'].includes(resource.kind))) {
    throw new Error('channel.attachments.unsupported')
  }
  const directory = await mkdtemp(join(tmpdir(), 'rovai-channel-inbound-'))
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort, DOWNLOAD_TIMEOUT_MS)
  let total = 0
  try {
    const files: string[] = []
    for (const [ordinal, resource] of pending.resources.entries()) {
      controller.signal.throwIfAborted()
      const stream = await open(resource, controller.signal)
      const path = join(directory, `${ordinal}.download`)
      await pipeline(stream, new Transform({
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
