import { useAttachmentLocation } from './attachment-location'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { attachmentRevealLabel } from './AttachmentCard'
import { ImageContextMenu, type ImageAction, type ImageMenuPosition } from './ImageContextMenu'
import { writeClipboardImage, writeClipboardText } from './clipboard'
import { useThreadClient, type ThreadClient } from './camp-client'
import type {
  AgentRunImageContent,
  AgentRunImageView,
  ThreadComposerDraftView,
  ThreadMessageView,
  ThreadMessageAttachmentView,
  LocalAttachmentOwnerLocator
} from '@contracts'
import { UiText, uiAttribute } from './interface-language'
import { ImagePreviewUrl } from './image-preview-url'

export type GalleryImage = {
  kind: 'runtime'
  threadId: string
  image: AgentRunImageView
} | {
  kind: 'attachment'
  threadId: string
  locator: LocalAttachmentOwnerLocator
  image: ThreadMessageAttachmentView
}

export type MessageAttachmentGroups = {
  images: ThreadMessageAttachmentView[]
  files: ThreadMessageAttachmentView[]
}

export type ImageGalleryVariant = 'agent-output' | 'user-attachment'

export type ImagePayload = {
  blob: Blob
  byteSize: number
  displayed?: ImagePreviewUrl
}

export const MAX_IMAGE_PAYLOAD_CACHE_BYTES = 128 * 1024 * 1024

function attachmentOwnerKey(locator: LocalAttachmentOwnerLocator): string {
  if (locator.owner === 'message') return `${locator.owner}:${locator.messageId}`
  if (locator.owner === 'pending' || locator.owner === 'pending_edit') {
    return `${locator.owner}:${locator.pendingInputId}`
  }
  if (locator.owner === 'single_chat_message') {
    return `${locator.owner}:${locator.conversationId}:${locator.conversationMessageId}`
  }
  if (locator.owner === 'single_chat_pending' || locator.owner === 'single_chat_pending_edit') {
    return `${locator.owner}:${locator.conversationId}:${locator.pendingInputId}`
  }
  if (locator.owner === 'single_chat_composer') {
    return `${locator.owner}:${locator.conversationId}`
  }
  return locator.owner
}

export class ImagePayloadCache {
  readonly #entries = new Map<string, ImagePayload>()
  readonly #firstDisplay = new Map<string, ImagePreviewUrl>()
  #sendingThread: string | null = null
  #byteSize = 0

  constructor(readonly maximumByteSize: number) {}

  get byteSize(): number { return this.#byteSize }
  get size(): number { return this.#entries.size }

  get(key: string): ImagePayload | undefined {
    return this.#entries.get(key)
  }

  publish(threadId: string, messageId: string, images: ReadonlyMap<string, ImagePreviewUrl>, visible: boolean): void {
    if (visible) {
      this.releaseUnshown()
      this.#sendingThread = threadId
    }
    for (const [attachmentRefId, displayed] of images) {
      const key = attachmentImageCacheKey({ owner: 'message', threadId, messageId, attachmentRefId })
      const payload = { blob: displayed.blob, byteSize: displayed.blob.size, displayed }
      this.put(key, payload)
      // A batch can outgrow the cache before React mounts even its first tile.
      if (visible) this.#firstDisplay.set(key, displayed.retain())
    }
  }

  forDisplay(key: string): ImagePayload | undefined {
    const handoff = this.#firstDisplay.get(key)
    if (!handoff) return this.get(key)
    // All layout effects in this commit (including another viewer) can acquire the same ready URL.
    queueMicrotask(() => {
      if (this.#firstDisplay.get(key) !== handoff) return
      this.#firstDisplay.delete(key)
      handoff.release()
    })
    return { blob: handoff.blob, byteSize: handoff.blob.size, displayed: handoff }
  }

  releaseUnshown(threadId?: string): void {
    if (threadId !== undefined && threadId !== this.#sendingThread) return
    for (const image of this.#firstDisplay.values()) image.release()
    this.#firstDisplay.clear()
    this.#sendingThread = null
  }

  put(key: string, payload: ImagePayload): void {
    if (payload.blob.size > this.maximumByteSize) {
      this.delete(key)
      return
    }
    const cached = { blob: payload.blob, byteSize: payload.blob.size, displayed: payload.displayed?.retain() }
    this.delete(key)
    this.#entries.set(key, cached)
    this.#byteSize += cached.byteSize
    while (this.#byteSize > this.maximumByteSize) {
      const oldestKey = this.#entries.keys().next().value as string | undefined
      if (!oldestKey) break
      this.delete(oldestKey)
    }
  }

  delete(key: string): boolean {
    const cached = this.#entries.get(key)
    if (!cached) return false
    this.#entries.delete(key)
    this.#byteSize -= cached.byteSize
    cached.displayed?.release()
    return true
  }

  clear(): void {
    this.releaseUnshown()
    for (const key of this.#entries.keys()) this.delete(key)
  }
}

type UserImageRead = { payload: ImagePayload | null; availability: ThreadMessageAttachmentView['availability'] }
type ClientImageState = {
  payloads: ImagePayloadCache
  loading: Map<string, Promise<ImagePayload | null>>
  userPreviews: Map<string, Promise<UserImageRead>>
}
const clientImageStates = new WeakMap<ThreadClient, ClientImageState>()
function clientImages(client: ThreadClient): ClientImageState {
  let state = clientImageStates.get(client)
  if (!state) {
    state = { payloads: new ImagePayloadCache(MAX_IMAGE_PAYLOAD_CACHE_BYTES), loading: new Map(), userPreviews: new Map() }
    clientImageStates.set(client, state)
  }
  return state
}

export function imageCacheKey(source: GalleryImage): string {
  return source.kind === 'runtime'
    ? `runtime:${source.threadId}:${source.image.id}`
    : attachmentImageCacheKey(source.locator)
}

function attachmentImageCacheKey(locator: LocalAttachmentOwnerLocator): string {
  return `attachment:${locator.threadId}:${attachmentOwnerKey(locator)}:${locator.attachmentRefId}`
}

/** Preserve order within each kind while giving images and files independent layout regions. */
export function partitionMessageAttachments(
  attachments: ThreadMessageAttachmentView[]
): MessageAttachmentGroups {
  const groups: MessageAttachmentGroups = { images: [], files: [] }
  for (const attachment of attachments) {
    if (attachment.kind === 'file' && attachment.previewKind === 'image') {
      groups.images.push(attachment)
    } else groups.files.push(attachment)
  }
  return groups
}

async function decodeObjectUrl(url: string): Promise<void> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('image_unavailable')
}

/** Use Chromium's real decoder (including AVIF/SVG), not MIME or extension as proof of an image. */
export async function decodeImageUrl(bytes: Uint8Array, mediaType: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: mediaType }))
  try {
    await decodeObjectUrl(url)
    return url
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('image_unavailable')
  }
}

async function readImagePayload(
  source: GalleryImage,
  client: ThreadClient,
  onAttachmentAvailability?: (availability: ThreadMessageAttachmentView['availability']) => void
): Promise<ImagePayload | null> {
  let blob: Blob
  if (source.kind === 'attachment') {
    const result = await client.composerAttachments.preview(source.locator)
    onAttachmentAvailability?.(result.availability)
    if (!result.preview) return null
    blob = 'blob' in result.preview ? result.preview.blob : new Blob(
      [Uint8Array.from(result.preview.bytes).buffer],
      { type: result.preview.mediaType }
    )
  } else {
    const content = await client.request<AgentRunImageContent | null>('agentRunImages.read', {
      threadId: source.threadId, imageId: source.image.id
    })
    if (!content) return null
    try {
      const bytes = Uint8Array.from(atob(content.data), (character) => character.charCodeAt(0))
      blob = new Blob([bytes.buffer], { type: content.mediaType })
    } catch {
      return null
    }
  }
  return blob.size > 0 ? { blob, byteSize: blob.size } : null
}

/** Always reaches the real source, while sharing an already-running read for the same image. */
export function fetchImagePayload(
  source: GalleryImage,
  client: ThreadClient,
  onAttachmentAvailability?: (availability: ThreadMessageAttachmentView['availability']) => void
): Promise<ImagePayload | null> {
  return shareImageLoad(clientImages(client).loading, imageCacheKey(source),
    () => readImagePayload(source, client, onAttachmentAvailability))
}

function shareImageLoad<T>(loads: Map<string, Promise<T>>, key: string, read: () => Promise<T>): Promise<T> {
  const loading = loads.get(key)
  if (loading) return loading
  const promise = read().finally(() => {
    if (loads.get(key) === promise) loads.delete(key)
  })
  loads.set(key, promise)
  return promise
}

/** Uses a completed payload when available; cold callers otherwise share the real source read. */
export function getOrLoadImagePayload(
  source: GalleryImage,
  client: ThreadClient,
  onAttachmentAvailability?: (availability: ThreadMessageAttachmentView['availability']) => void
): Promise<ImagePayload | null> {
  const cached = clientImages(client).payloads.get(imageCacheKey(source))
  return cached ? Promise.resolve(cached) : fetchImagePayload(source, client, onAttachmentAvailability)
}

export function cacheDecodedImagePayload(source: GalleryImage, payload: ImagePayload, client: ThreadClient): void {
  clientImages(client).payloads.put(imageCacheKey(source), payload)
}

/** Keep a cold user read shared until decode and cache insertion, including across a tile remount. */
export function loadUserImagePreview(source: GalleryImage, client: ThreadClient,
  onAvailability?: (availability: ThreadMessageAttachmentView['availability']) => void): Promise<ImagePayload | null> {
  const state = clientImages(client)
  const key = imageCacheKey(source)
  const cached = state.payloads.get(key)
  if (cached) return Promise.resolve(cached)
  return shareImageLoad(state.userPreviews, key, async (): Promise<UserImageRead> => {
    let availability: UserImageRead['availability'] = 'unknown'
    const payload = await fetchImagePayload(source, client, value => { availability = value })
    if (!payload) return { payload: null, availability }
    const displayed = new ImagePreviewUrl(payload.blob)
    try {
      await decodeObjectUrl(displayed.url)
      if (clientImageStates.get(client) !== state) return { payload: null, availability }
      state.payloads.put(key, { ...payload, displayed })
      return { payload: state.payloads.get(key) ?? payload, availability: 'available' }
    } catch {
      return { payload: null, availability }
    } finally {
      displayed.release()
    }
  }).then(result => {
    onAvailability?.(result.availability)
    return result.payload
  })
}

export interface ImagePublication {
  awaitingReceipt(threadId: string, message: Pick<ThreadMessageView, 'authorType' | 'sequence' | 'attachments'>): boolean
  publish(messageId: string, visible: boolean): void
  release(): void
}

export function prepareImagePublication(
  client: ThreadClient, { threadId, attachments }: Pick<ThreadComposerDraftView, 'threadId' | 'attachments'>,
  firstSequence: number, displayedImages?: ReadonlyMap<string, ImagePreviewUrl>
): ImagePublication | undefined {
  if (!displayedImages?.size) return
  const images = new Map<string, ImagePreviewUrl>()
  for (const { id } of attachments) {
    const displayed = displayedImages.get(id)
    if (displayed && !images.has(id)) images.set(id, displayed.retain())
  }
  if (!images.size) return
  const state = clientImages(client)
  return {
    // A projection can precede the receipt. Only the receipt binds these bytes to an exact public owner.
    awaitingReceipt: (thread, message) => images.size > 0 && thread === threadId && message.authorType === 'user'
      && message.sequence >= firstSequence && message.attachments.length === attachments.length
      && message.attachments.every(({ id }, index) => id === attachments[index].id),
    publish(messageId, visible) {
      if (clientImageStates.get(client) !== state) return
      state.payloads.publish(threadId, messageId, images, visible)
    },
    release() {
      for (const displayed of images.values()) displayed.release()
      images.clear()
    }
  }
}

export function releaseUnshownUserImages(client: ThreadClient, threadId: string): void {
  clientImageStates.get(client)?.payloads.releaseUnshown(threadId)
}

export function releaseClientImageCache(client: ThreadClient): void {
  clientImageStates.get(client)?.payloads.clear()
  clientImageStates.delete(client)
}

export function ImageGallery({
  images,
  variant = 'agent-output'
}: {
  images: GalleryImage[]
  variant?: ImageGalleryVariant
}): JSX.Element | null {
  if (images.length === 0) return null
  return (
    <section
      className={`image-gallery image-gallery-${variant}`}
      aria-label={variant === 'user-attachment' ? uiAttribute("消息图片") : uiAttribute("Agent 输出图片")}
    >
      <div className={`image-gallery-grid${images.length === 1 ? ' is-single' : ''}`}>
        {images.map((source) => <ImageTile key={imageCacheKey(source)} source={source}
          reuseUserPreview={variant === 'user-attachment' && source.kind === 'attachment' && source.locator.owner === 'message'} />)}
      </div>
    </section>
  )
}

function ImageTile({ source, reuseUserPreview }: { source: GalleryImage; reuseUserPreview: boolean }): JSX.Element {
  const client = useThreadClient()
  const imagePayloadCache = clientImages(client).payloads
  const cacheKey = imageCacheKey(source)
  const initialAvailability: ThreadMessageAttachmentView['availability'] = source.kind === 'attachment'
    ? source.image.availability
    : 'available'
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [availability, setAvailability] = useState<ThreadMessageAttachmentView['availability']>(initialAvailability)
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState<ImageMenuPosition | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionNotice, setActionNotice] = useState<{ text: string; silent?: boolean; failed?: boolean } | null>(null)
  const [action, setAction] = useState<ImageAction | null>(null)
  const actionPending = useRef(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const fileLocation = useAttachmentLocation(source.kind === 'attachment' ? source.locator : undefined)
  const tile = useRef<HTMLElement>(null)
  const hadCachedPayload = useRef(false)
  const committedUrl = useRef<string | null>(null)
  const ownedUrls = useRef(new Map<string, ImagePreviewUrl>())
  const canDownload = source.kind === 'attachment' && client.attachments.kind === 'download'
  const downloadAvailable = canDownload && ['available', 'unknown'].includes(availability)

  const downloadFile = async (): Promise<void> => {
    if (source.kind !== 'attachment' || client.attachments.kind !== 'download' || actionPending.current) return
    actionPending.current = true
    setAction('save'); setActionNotice(null)
    try {
      const result = await client.attachments.download(source.locator)
      setAvailability(result.availability)
      if (result.error) throw new Error(uiAttribute('下载附件失败'))
      setActionNotice({ text: uiAttribute('已交给浏览器下载。'), silent: true })
    } catch (error) {
      setActionNotice({ text: error instanceof Error ? error.message : uiAttribute('下载附件失败'), failed: true })
    } finally { actionPending.current = false; setAction(null) }
  }

  useEffect(() => {
    if (!actionNotice || actionNotice.failed || action) return
    const timer = window.setTimeout(() => setActionNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [actionNotice, action])

  const runImageAction = async (nextAction: ImageAction): Promise<void> => {
    if (actionPending.current) return
    actionPending.current = true
    setAction(nextAction)
    setActionNotice(nextAction === 'copy' ? { text: uiAttribute('正在复制图片…') } : null)
    try {
      if (nextAction === 'copy') {
        const image = tile.current?.querySelector('img')
        if (!image) throw new Error('image_unavailable')
        await writeClipboardImage(image)
        setActionNotice({ text: uiAttribute('已复制图片') })
      } else if (nextAction === 'save') {
        if (!url) throw new Error('image_unavailable')
        const link = document.createElement('a')
        link.href = url
        const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
          'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp' } as Record<string, string>)[source.image.mediaType ?? '']
        const name = source.image.displayName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'image'
        link.download = extension && !/\.[a-z0-9]+$/i.test(name) ? `${name}.${extension}` : name
        document.body.appendChild(link)
        link.click()
        link.remove()
      } else if (nextAction === 'path') {
        if (!fileLocation.location?.path || !await writeClipboardText(fileLocation.location.path)) throw new Error('copy_failed')
        setActionNotice({ text: uiAttribute('已复制完整路径') })
      } else if (source.kind === 'attachment' && client.attachments.kind === 'native') {
        const result = await client.attachments.reveal(source.locator)
        setAvailability(result.availability)
        if (result.error) throw new Error('reveal_failed')
      }
    } catch {
      setActionNotice({ text: nextAction === 'copy' ? uiAttribute('未能复制图片，请重试或保存图片。')
        : nextAction === 'save' ? uiAttribute('未能保存图片，请重试。')
          : nextAction === 'path' ? uiAttribute('未能复制路径，请重试。')
            : uiAttribute('无法显示此附件所在位置。') })
    } finally {
      actionPending.current = false
      setAction(null)
    }
  }

  const showMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void => {
    const keyboard = event.type === 'keydown'
    if (keyboard && !('key' in event && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')))) return
    event.preventDefault()
    event.stopPropagation()
    fileLocation.inspect()
    const origin = event.currentTarget === tile.current ? tile.current.querySelector('button')! : event.currentTarget
    const bounds = origin.getBoundingClientRect()
    const pointer = 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0)
    setMenu({ x: pointer ? event.clientX : bounds.left, y: pointer ? event.clientY : bounds.bottom, origin })
  }

  const showPreview = (): void => {
    setMenu(null)
    setOpen(true)
    if (source.kind === 'attachment' && (!reuseUserPreview || !url)) setRefreshRevision(value => value + 1)
  }

  const contextMenu = <ImageContextMenu position={menu} onClose={() => setMenu(null)}
    displayName={source.image.displayName} ready={Boolean(url)} busy={action}
    hasPath={Boolean(fileLocation.location?.path)}
    revealLabel={menu && source.kind === 'attachment' && client.attachments.kind === 'native' ? attachmentRevealLabel(client.platform) : undefined}
    saveLabel={canDownload ? uiAttribute('下载原图') : undefined} canSave={canDownload ? downloadAvailable : Boolean(url)}
    onAction={value => { void (value === 'save' && canDownload ? downloadFile() : runImageAction(value)) }} />

  const createOwnedUrl = useCallback((payload: ImagePayload): string => {
    if (payload.displayed && ownedUrls.current.has(payload.displayed.url)) return payload.displayed.url
    const image = payload.displayed?.retain() ?? new ImagePreviewUrl(payload.blob)
    ownedUrls.current.set(image.url, image)
    return image.url
  }, [])

  const releaseOwnedUrl = useCallback((ownedUrl: string): void => {
    ownedUrls.current.get(ownedUrl)?.release()
    ownedUrls.current.delete(ownedUrl)
  }, [])

  useLayoutEffect(() => () => {
    for (const image of ownedUrls.current.values()) image.release()
    ownedUrls.current.clear()
    committedUrl.current = null
  }, [])

  useLayoutEffect(() => {
    setAvailability(initialAvailability)
  }, [cacheKey, initialAvailability])

  useLayoutEffect(() => {
    setFailed(false)
    const cached = reuseUserPreview ? imagePayloadCache.forDisplay(cacheKey) : imagePayloadCache.get(cacheKey)
    hadCachedPayload.current = Boolean(cached)
    setUrl(cached ? createOwnedUrl(cached) : null)
  }, [cacheKey, createOwnedUrl, imagePayloadCache, reuseUserPreview])

  useLayoutEffect(() => {
    const previousUrl = committedUrl.current
    committedUrl.current = url
    if (previousUrl && previousUrl !== url) releaseOwnedUrl(previousUrl)
  }, [releaseOwnedUrl, url])

  useEffect(() => {
    if (reuseUserPreview && hadCachedPayload.current) return
    let active = true
    let started = false

    const markUnavailable = (): void => {
      if (!committedUrl.current) {
        imagePayloadCache.delete(cacheKey)
        setUrl(null)
        setFailed(true)
      } else setNotice(uiAttribute('源文件暂不可用，保留已加载的图片。'))
    }

    const install = async (payload: ImagePayload): Promise<boolean> => {
      const candidateUrl = createOwnedUrl(payload)
      try {
        await decodeObjectUrl(candidateUrl)
      } catch {
        releaseOwnedUrl(candidateUrl)
        if (active) markUnavailable()
        return false
      }
      if (!active) {
        releaseOwnedUrl(candidateUrl)
        return false
      }
      imagePayloadCache.put(cacheKey, payload)
      setFailed(false)
      setNotice(null)
      setUrl(candidateUrl)
      return true
    }

    const load = (refresh: boolean): void => {
      if (started) return
      started = true
      const read = reuseUserPreview ? loadUserImagePreview
        : refresh || refreshRevision > 0 ? fetchImagePayload : getOrLoadImagePayload
      const request = read(source, client, next => { if (active) setAvailability(next) })
      void request.then((payload) => {
        if (!active) return
        if (!payload) { markUnavailable(); return }
        setAvailability('available')
        if (reuseUserPreview && payload.displayed) {
          setUrl(createOwnedUrl(payload))
          setFailed(false)
          return
        }
        return install(payload)
      }).catch(() => {
        if (active) {
          if (!committedUrl.current) setFailed(true)
          else setNotice(uiAttribute('刷新失败，保留已加载的图片。'))
        }
      })
    }

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(hadCachedPayload.current); observer?.disconnect() }
    }, { rootMargin: '320px' })
    if (observer && tile.current) observer.observe(tile.current)
    else load(hadCachedPayload.current)
    return () => { active = false; observer?.disconnect() }
  }, [cacheKey, createOwnedUrl, releaseOwnedUrl, source.kind, client, imagePayloadCache, refreshRevision, reuseUserPreview])

  useEffect(() => {
    if (source.kind !== 'attachment') return
    const refreshVisible = (): void => {
      if (reuseUserPreview && !failed) return
      const bounds = tile.current?.getBoundingClientRect()
      if (document.visibilityState === 'visible' && bounds && bounds.bottom > 0 && bounds.top < window.innerHeight
        && bounds.right > 0 && bounds.left < window.innerWidth) setRefreshRevision(value => value + 1)
    }
    window.addEventListener('focus', refreshVisible)
    return () => window.removeEventListener('focus', refreshVisible)
  }, [cacheKey, source.kind, reuseUserPreview, failed])

  const unavailableLabel = availability === 'missing'
    ? uiAttribute('图片已丢失')
    : availability === 'unreadable'
      ? uiAttribute('图片不可读')
      : availability === 'kind_changed'
        ? uiAttribute('文件类型已变化')
        : canDownload && availability === 'available' ? uiAttribute('暂不支持预览') : uiAttribute('图片已不可用')
  const loading = !url && !failed
  const canOpen = Boolean(url) || (canDownload && failed)

  return (
    <figure className="image-tile" ref={tile} title={fileLocation.label}
      onMouseEnter={fileLocation.inspect} onFocus={fileLocation.inspect}
      onContextMenu={event => event.preventDefault()}>
      <button type="button" className="image-tile-preview"
        aria-disabled={!canOpen}
        aria-label={uiAttribute("查看大图 {0}", String(source.image.displayName))}
        aria-busy={loading}
        onClick={() => { if (canOpen) showPreview() }}>
        {url ? <img src={url} alt={source.image.displayName} />
          : <span className="image-tile-placeholder">
              {failed ? unavailableLabel : uiAttribute("正在读取图片…")}
            </span>}
      </button>

      {notice && <figcaption className="image-tile-notice" role="status">{notice}</figcaption>}
      {canOpen && (
        <Dialog.Root open={open} onOpenChange={value => { setOpen(value); if (!value) setMenu(null) }}>
          <Dialog.Portal>
            <Dialog.Overlay className="attachment-lightbox-overlay" />
            <Dialog.Content className="attachment-lightbox image-gallery-lightbox" aria-describedby={undefined}
              onContextMenu={showMenu} onKeyDown={showMenu}
              onCloseAutoFocus={event => { event.preventDefault(); tile.current?.querySelector<HTMLButtonElement>('.image-tile-preview')?.focus({ preventScroll: true }) }}>
              <Dialog.Title className="sr-only"><UiText zh={"图片预览"} /></Dialog.Title>
              {url ? <img src={url} alt={source.image.displayName} /> : <div className="image-lightbox-unavailable">
                <p>{availability === 'available' ? uiAttribute('此图片暂不支持在线预览，可下载到本机查看。') : unavailableLabel}</p>
              </div>}
              <div className="image-lightbox-actions">
                <button type="button" className="file-action-button" title={uiAttribute('复制图片')} aria-label={uiAttribute('复制图片')}
                  disabled={action !== null || !url} onClick={() => void runImageAction('copy')}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M12 7V3H3v9h4"/></svg>
                </button>
                {(canDownload ? downloadAvailable : Boolean(url)) && <button type="button" className="file-action-button"
                  title={action === 'save' ? uiAttribute('准备下载…') : canDownload ? uiAttribute('下载原图') : uiAttribute('保存图片')}
                  aria-label={canDownload ? uiAttribute('下载原图') : uiAttribute('保存图片')} aria-busy={action === 'save'} disabled={action !== null}
                  onClick={() => void (canDownload ? downloadFile() : runImageAction('save'))}>
                  <svg viewBox="0 0 20 20" aria-hidden="true" className={action === 'save' ? 'file-action-spinner' : undefined}>
                    <path d={action === 'save' ? 'M17 10a7 7 0 1 1-7-7' : 'M10 3v9m-3-3 3 3 3-3M4 13v4h12v-4'} />
                  </svg>
                </button>}
              </div>
              {actionNotice && <div className={actionNotice.silent ? 'sr-only' : 'image-lightbox-feedback'} role={actionNotice.failed ? 'alert' : 'status'}>{actionNotice.text}</div>}
              <Dialog.Close className="attachment-lightbox-close" aria-label={uiAttribute("关闭图片预览")}>
                <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 5 8 8M13 5l-8 8" /></svg>
              </Dialog.Close>
              {open && contextMenu}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </figure>
  )
}
