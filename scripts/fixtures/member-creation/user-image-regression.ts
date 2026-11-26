import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { LocalAttachmentOwnerLocator, LocalAttachmentSourceView, ThreadSnapshot } from '@contracts'
import { initial } from '../host-web-parity/data'

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
  thread.messages = []
  threads.set(threadId, thread)
  const otherId = 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7h'
  threads.set(otherId, { ...thread, messages: [], thread: { ...thread.thread, id: otherId, title: 'Other thread' } })
  environment.navigationHistory.initial = { entries: [{ kind: 'camp', threadId }], index: 0 }
  const original = await png('#336699')
  let disk: Blob | null = original
  const previewFormat = new URLSearchParams(location.search).get('preview')
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
  let projectsBeforeReceipt = 0
  let waiting = false
  let rejected = 0
  let queueNext = false
  client.request = async (method: string, params: any) => {
    if (method === 'thread.messages.send') {
      if (queueNext) {
        queueNext = false
        return { commandResult: { status: 'applied', code: 'ok', payload: { pendingInputId: 'private-input' } } }
      }
      if (!rejected++) return { commandResult: { status: 'rejected', code: 'fixture.rejected', payload: {} } }
      const result = await request(method, params)
      check(params.sourceAttachments[0]?.id === attachment.id, 'Send must use the original attachment reference')
      thread.messages.at(-1)!.attachments = [attachment]
      waiting = true
      for (const notify of events) notify({ method: 'thread.messages.changed', params: { threadId, indexChanged: true } })
      await receipt
      waiting = false
      return result
    }
    const result = await request(method, params)
    if (waiting && method === 'threads.open') projectsBeforeReceipt++
    return result
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
  const transfer = new DataTransfer()
  transfer.items.add(new File([original], 'screenshot.png', { type: 'image/png' }))
  editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  const draft = () => find<HTMLImageElement>('.composer-image-preview img')
  await until(() => pixel(draft()) === '51,102,153,255' && send(), 'Draft screenshot did not load')
  const draftUrl = draft()!.src
  send()!.click()
  await until(() => rejected && send(), 'Rejected send was not retryable')
  check(draft()?.src === draftUrl && !find(tile), 'Rejected send must preserve the displayed draft')
  send()!.click()
  await until(() => projectsBeforeReceipt, 'Missing projection before receipt')
  await frame()
  check(!find(tile) && reads.message === 0, 'Early projection exposed or reread the outgoing image')

  // Mutation observers see the first committed tile (including layout effects) before the browser paints.
  const firstPixels = new Promise<string>(resolve => {
    const observer = new MutationObserver(() => {
      const button = find(tile)
      if (!button) return
      observer.disconnect()
      resolve(pixel(button.querySelector('img')))
    })
    observer.observe(document.body, { childList: true, subtree: true })
  })
  releaseReceipt()
  const firstTile = await until(() => find(tile), 'Published image did not appear')
  check(await firstPixels === '51,102,153,255', 'First committed tile had no screenshot pixels')
  check(pixel(firstTile.querySelector('img')) === '51,102,153,255', 'First animation frame had no screenshot pixels')
  await until(() => !draft(), 'Accepted draft did not clear')
  disk = await png('#cc6633')
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

  await restart()
  await until(() => pixel(find(tile + ' img')) === '204,102,51,255', 'Cold display did not load the modified source')
  check(Number(reads.message) === 1, 'Cold display must read the source exactly once')
  disk = null
  await restart()
  await until(() => find(tile)?.textContent?.includes('图片已丢失'), 'Cold missing file did not report its actual state')
  queueNext = true
  find('#camp-message')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  await until(() => pixel(draft()) === '51,102,153,255' && send(), 'Second draft did not load')
  send()!.click()
  await until(() => !queueNext && !draft(), 'Queue admission did not clear the submitted draft')
  check(document.querySelectorAll(tile).length === 1 && reads.message === 2, 'Private input changed public images')
  return { ok: true, previewFormat, width: 3840, height: 2160, firstFramePixel: [51, 102, 153, 255],
    warmPreviewReads: 0, coldPreviewReads: 1, rejectedDraftPreserved: true, privateInputStayedPrivate: true }
}
