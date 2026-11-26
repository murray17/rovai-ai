import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { LocalAttachmentOwnerLocator, LocalAttachmentSourceView, ThreadSnapshot } from '@contracts'
import { initial, message } from '../host-web-parity/data'

declare global {
  interface Window {
    userImageFrames: { messageId: string; armed: boolean; captured: boolean }
  }
}

const tile = '.image-gallery-user-attachment .image-tile-preview'
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const find = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)
function check(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason)
}
async function until<T>(read: () => T, reason: string): Promise<NonNullable<T>> {
  const deadline = performance.now() + 8000
  do {
    const value = read()
    if (value) return value
    await frame()
  } while (performance.now() < deadline)
  throw new Error(reason)
}
async function png(color: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 3840
  canvas.height = 2160
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
}
function pixel(image: HTMLImageElement | null): string {
  if (!image?.complete || image.naturalWidth !== 3840) return 'empty'
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0, 1, 1)
  return String(ctx.getImageData(0, 0, 1, 1).data)
}

// Actual composer, send action, timeline, image decoder and viewer. Only the host transport is simulated.
export async function runUserImageRegression(root: Root, app: ReactNode, client: any, environment: any,
  threads: Map<string, ThreadSnapshot>, events: Set<(event: any) => void>) {
  const thread = structuredClone(initial)
  const threadId = thread.thread.id
  thread.thread = { ...thread.thread, projectBindingKind: 'quick_chat', projectPath: '', activationState: 'active' }
  const parent = message(1, 'Screenshot requested', 'user')
  const reply = { ...message(2, 'Reply here with the screenshot', 'agent'), replyToThreadMessageId: parent.id }
  thread.messages = [parent, reply]
  const sentId = 'review-message-3'
  window.userImageFrames = { messageId: sentId, armed: false, captured: false }
  const timelineRow = '[data-message-id="' + sentId + '"]'
  const replyRow = '[data-reply-message-id="' + sentId + '"]'
  const query = new URLSearchParams(location.search)
  const projectionFirst = query.get('order') === 'projection-first'
  threads.set(threadId, thread)
  const otherId = 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7h'
  threads.set(otherId, { ...thread, messages: [], thread: { ...thread.thread, id: otherId, title: 'Other thread' } })
  environment.navigationHistory.initial = { entries: [{ kind: 'camp', threadId }], index: 0 }
  const original = await png('#336699')
  let disk: Blob | null = original
  const previewFormat = query.get('preview')
  const attachment: LocalAttachmentSourceView = { id: 'pasted-image', displayName: 'screenshot.png', kind: 'file',
    mediaType: 'image/png', fileCount: 1, byteSize: original.size, previewKind: 'image', availability: 'available',
    sourcePath: '/fixture/screenshot.png' }
  const reads = { composer: 0, message: 0 }
  client.composerAttachments = {
    prepare: async (owner: string, _revision: number, file: File) => {
      check(owner === threadId && file.name === attachment.displayName && file.size === original.size, 'Wrong pasted file')
      disk = file
      return attachment
    },
    preview: async (locator: LocalAttachmentOwnerLocator) => {
      check(locator.owner === 'composer' || locator.owner === 'message', 'Unexpected preview owner')
      reads[locator.owner]++
      if (!disk) return { availability: 'missing', preview: null }
      const preview = previewFormat === 'bytes'
        ? { bytes: new Uint8Array(await disk.arrayBuffer()), mediaType: disk.type } : { blob: disk }
      return { availability: 'available', preview }
    }
  }
  const request = client.request
  let releaseReceipt!: () => void
  const receipt = new Promise<void>(resolve => { releaseReceipt = resolve })
  let releaseProjection!: () => void
  const projection = new Promise<void>(resolve => { releaseProjection = resolve })
  let sent = false
  let rejected = false
  let timelineProjected = false
  let replyProjected = false
  const notifyProjection = () => {
    releaseProjection()
    for (const notify of events) notify({ method: 'thread.messages.changed',
      params: { threadId, throughGlobalSequence: 2, indexChanged: true } })
  }
  client.request = async (method: string, params: any) => {
    if (method === 'thread.messages.send') {
      if (!rejected) {
        rejected = true
        return { commandResult: { status: 'rejected', code: 'fixture.rejected', payload: {} } }
      }
      check(params.sourceAttachments[0]?.id === attachment.id && params.replyToThreadMessageId === reply.id,
        'Send must use the original attachment and reply to the open chain')
      const result = await request(method, params)
      const published = thread.messages.at(-1)!
      check(result.commandResult.payload.threadMessageId === sentId && published.id === sentId, 'Wrong public message owner')
      published.attachments = [attachment]
      published.replyToThreadMessageId = reply.id
      const deliveryId = 'recipient-waiting'
      thread.messageDeliveries = [{ id: deliveryId, messageId: sentId, threadTurnId: null, taskId: null,
        deliveryKind: 'public_a2a', recipientAgentId: reply.authorId, recipientMembershipVersionAtAdmission: 1,
        dispatchDisposition: 'dispatch', completionRole: 'required', gatherId: null, gatherDispatchDeliveryId: null,
        recipientCanonicalPosition: 0, edgeKind: 'forward', targetParentAgentRunId: null, returnToAgentRunId: null,
        status: 'pending', dispatchPhase: 'attempted_waiting', waitCondition: 'target_busy', dispatchAttemptCount: 1,
        retryGeneration: 0, contextManifestId: null, targetAgentRunId: null, manualInterventionRequired: false,
        failureCode: null, version: 1, createdAt: published.createdAt, updatedAt: published.createdAt, endedAt: null }]
      sent = true
      if (projectionFirst) notifyProjection()
      await receipt
      return { commandResult: { status: 'accepted', code: 'camp_message.deliveries_waiting',
        payload: { threadMessageId: sentId, contentRevision: 1, sequence: published.sequence, deliveryIds: [deliveryId] } } }
    }
    if (params?.threadId === threadId && method === 'thread.messages.replies') {
      if (sent) { await projection; replyProjected = true }
      return { schemaVersion: 1, throughGlobalSequence: sent ? 2 : 1, threadId, messageId: params.messageId,
        rootMessageId: parent.id, sourceAvailable: true, replyCount: thread.messages.length - 1,
        hasEarlier: false, hasLater: false, runAnchorMessageIds: [], messages: structuredClone(thread.messages) }
    }
    if (params?.threadId === threadId && method === 'thread.messages.around') {
      if (sent) await projection
      return { schemaVersion: 1, throughGlobalSequence: sent ? 2 : 1, threadId, anchorMessageId: params.messageId,
        sourceAvailable: thread.messages.some(row => row.id === params.messageId),
        nextMessageSequence: null, messages: structuredClone(thread.messages) }
    }
    if (sent && params?.threadId === threadId && method === 'threads.open') {
      await projection
      timelineProjected = true
    }
    return request(method, params)
  }
  const send = () => find<HTMLButtonElement>('.composer-primary-action.is-send:not(:disabled)')
  const open = (id: string) => find(`[data-thread-id="${id}"] .camp-nav-open`)!.click()
  const restart = async () => {
    root.render(null)
    await until(() => !find('#camp-message'), 'Workspace did not close')
    root.render(app)
  }
  root.render(app)
  const editor = await until(() => find('#camp-message[contenteditable="true"]'), 'No editable composer')
  const replyActions = '[data-message-id="' + reply.id + '"] '
  const openDetails = await until(() => find(replyActions + '.reply-parent-quote'), 'No reply details entry')
  openDetails.click()
  await until(() => find('[data-reply-message-id="' + reply.id + '"]'), 'Reply details did not load')
  find(replyActions + '.message-reply-button')!.click()
  await until(() => find('.composer-reply-line'), 'Reply composer did not open')
  const transfer = new DataTransfer()
  transfer.items.add(new File([original], 'screenshot.png', { type: 'image/png' }))
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  const draft = () => find<HTMLImageElement>('.composer-image-preview img')
  await until(() => pixel(draft()) === '51,102,153,255' && send(), 'Draft screenshot did not load')
  const draftUrl = draft()!.src
  send()!.click()
  await until(() => rejected && send(), 'Rejected send was not retryable')
  check(draft()?.src === draftUrl && !find(tile), 'Rejected send must preserve the displayed draft')
  // Any unexpected second read now gets different pixels from the already displayed screenshot.
  disk = await png('#cc6633')
  await until(() => window.userImageFrames.armed, 'Compositor observer was not armed')
  send()!.click()
  await until(() => sent, 'Send was not recorded')
  if (projectionFirst) {
    await until(() => timelineProjected && replyProjected, 'Both projections must arrive before the receipt')
    await frame()
    check(!find(timelineRow) && !find(replyRow) && reads.message === 0, 'Early projection exposed or reread the outgoing image')
  }
  releaseReceipt()
  const firstTile = await until(() => find(timelineRow + ' ' + tile), 'Published timeline image did not appear')
  if (!projectionFirst) {
    check(!timelineProjected && !replyProjected && !find(replyRow), 'Projection unexpectedly preceded the receipt')
    notifyProjection()
  }
  const detailTile = await until(() => find(replyRow + ' ' + tile), 'Published reply image did not appear')
  await until(() => window.userImageFrames.captured, 'The compositor did not present both public rows')
  check(firstTile.querySelector('img')?.src === draftUrl && detailTile.querySelector('img')?.src === draftUrl,
    'Both views must use the displayed composer preview')
  await until(() => find(timelineRow + ' .user-message-receipt.is-queued')?.textContent?.includes('排队中'),
    'Public image should be visible while its recipient delivery is waiting')
  await until(() => !draft(), 'Accepted draft did not clear')
  window.dispatchEvent(new Event('focus'))
  firstTile.click()
  await until(() => pixel(find('.image-gallery-lightbox img')) === '51,102,153,255', 'Viewer changed the cached image')
  find('.attachment-lightbox-close')!.click()
  await until(() => !find('.image-gallery-lightbox'), 'Viewer did not close')
  open(otherId)
  await until(() => !find(tile), 'Thread did not switch')
  open(threadId)
  await until(() => pixel(find(tile + ' img')) === '51,102,153,255', 'Returning lost the cached screenshot')
  check(reads.composer === 1 && reads.message === 0, 'Warm display reread the source: ' + JSON.stringify(reads))

  const warmPreviewReads = reads.message
  await restart()
  await until(() => pixel(find(tile + ' img')) === '204,102,51,255', 'Cold display did not load the modified source')
  check(Number(reads.message) === 1, 'Cold display must read the source exactly once')
  const coldPreviewReads = reads.message - warmPreviewReads
  disk = null
  await restart()
  await until(() => find(tile)?.textContent?.includes('图片已丢失'), 'Cold missing file did not report its actual state')
  return { ok: true, previewFormat, order: query.get('order'), warmPreviewReads,
    coldPreviewReads, rejectedDraftPreserved: true, deliveryStillWaiting: true }
}
