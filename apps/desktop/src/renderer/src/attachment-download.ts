import type { LocalAttachmentAvailability, LocalAttachmentOwnerLocator } from '@contracts'
import type { ThreadClient } from './camp-client'

export interface AttachmentDownloadResult {
  availability: LocalAttachmentAvailability
  error: string | null
  notice: 'saved' | 'started' | null
}

// Requests belong to the exact client/owner, not the lifetime of a virtual row.
// Only in-flight work is retained; settled results never become a second cache.
const pending = new WeakMap<ThreadClient, Map<string, Promise<AttachmentDownloadResult>>>()
const key = (locator: LocalAttachmentOwnerLocator): string => JSON.stringify(Object.entries(locator).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))

export function pendingAttachmentDownload(client: ThreadClient, locator: LocalAttachmentOwnerLocator): Promise<AttachmentDownloadResult> | undefined {
  return pending.get(client)?.get(key(locator))
}

export function startAttachmentDownload(client: ThreadClient, locator: LocalAttachmentOwnerLocator): Promise<AttachmentDownloadResult> {
  const identity = key(locator)
  let requests = pending.get(client)
  if (!requests) { requests = new Map(); pending.set(client, requests) }
  const existing = requests.get(identity)
  if (existing) return existing
  const request = (async (): Promise<AttachmentDownloadResult> => {
    if (client.attachments.kind === 'native') {
      if (!client.attachments.save) throw new Error('Attachment saving is unavailable')
      const result = await client.attachments.save(locator)
      return { availability: result.availability, error: result.error, notice: result.saved ? 'saved' : null }
    }
    const result = await client.attachments.download(locator)
    return { availability: result.availability, error: result.error, notice: result.opened ? 'started' : null }
  })()
  requests.set(identity, request)
  const finish = (): void => { if (requests.get(identity) === request) requests.delete(identity) }
  void request.then(finish, finish)
  return request
}
