import { useAttachmentLocation } from './attachment-location'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import { attachmentRevealLabel } from './AttachmentCard'
import { ImageContextMenu, type ImageAction, type ImageMenuPosition } from './ImageContextMenu'
import { writeClipboardImage, writeClipboardText } from './clipboard'
import { useThreadClient, type ThreadClient } from './camp-client'
import type {
  AgentRunImageContent,
  AgentRunImageView,
  ThreadMessageAttachmentView,
  LocalAttachmentOwnerLocator
} from '@contracts'
import { UiText, uiAttribute } from './interface-language'

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
  #byteSize = 0

  constructor(readonly maximumByteSize: number) {}

  get byteSize(): number { return this.#byteSize }
  get size(): number { return this.#entries.size }

  get(key: string): ImagePayload | undefined {
    return this.#entries.get(key)
  }

  put(key: string, payload: ImagePayload): void {
    this.delete(key)
    const cached = { blob: payload.blob, byteSize: payload.blob.size }
    if (cached.byteSize > this.maximumByteSize) return
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
    return true
  }

  clear(): void {
    this.#entries.clear()
    this.#byteSize = 0
  }
}

type ClientImageState = { payloads: ImagePayloadCache; loading: Map<string, Promise<ImagePayload | null>> }
let clientImageStates = new WeakMap<ThreadClient, ClientImageState>()
function clientImages(client: ThreadClient): ClientImageState {
  let state = clientImageStates.get(client)
  if (!state) {
    state = { payloads: new ImagePayloadCache(MAX_IMAGE_PAYLOAD_CACHE_BYTES), loading: new Map() }
    clientImageStates.set(client, state)
  }
  return state
}

export function imageCacheKey(source: GalleryImage): string {
  return source.kind === 'runtime'
    ? `runtime:${source.threadId}:${source.image.id}`
    : `attachment:${source.threadId}:${attachmentOwnerKey(source.locator)}:${source.image.id}`
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
  const key = imageCacheKey(source)
  const imageLoadCache = clientImages(client).loading
  const loading = imageLoadCache.get(key)
  if (loading) return loading
  const promise = readImagePayload(source, client, onAttachmentAvailability).finally(() => {
    if (imageLoadCache.get(key) === promise) imageLoadCache.delete(key)
  })
  imageLoadCache.set(key, promise)
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

export function clearImagePayloadState(): void {
  clientImageStates = new WeakMap()
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
        {images.map((source) => <ImageTile key={`${source.kind}:${source.image.id}`} source={source} />)}
      </div>
    </section>
  )
}

function ImageTile({ source }: { source: GalleryImage }): JSX.Element {
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
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const [action, setAction] = useState<ImageAction | null>(null)
  const actionPending = useRef(false)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const fileLocation = useAttachmentLocation(source.kind === 'attachment' ? source.locator : undefined)
  const tile = useRef<HTMLElement>(null)
  const hadCachedPayload = useRef(false)
  const committedUrl = useRef<string | null>(null)
  const ownedUrls = useRef(new Set<string>())

  useEffect(() => {
    if (!actionNotice || action) return
    const timer = window.setTimeout(() => setActionNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [actionNotice, action])

  const runImageAction = async (nextAction: ImageAction): Promise<void> => {
    if (actionPending.current) return
    actionPending.current = true
    setAction(nextAction)
    setActionNotice(nextAction === 'copy' ? uiAttribute('正在复制图片…') : null)
    try {
      if (nextAction === 'copy') {
        const image = tile.current?.querySelector('img')
        if (!image) throw new Error('image_unavailable')
        await writeClipboardImage(image)
        setActionNotice(uiAttribute('已复制图片'))
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
        setActionNotice(uiAttribute('已复制完整路径'))
      } else if (source.kind === 'attachment' && client.attachments.kind === 'native') {
        const result = await client.attachments.reveal(source.locator)
        setAvailability(result.availability)
        if (result.error) throw new Error('reveal_failed')
      }
    } catch {
      setActionNotice(nextAction === 'copy' ? uiAttribute('未能复制图片，请重试或保存图片。')
        : nextAction === 'save' ? uiAttribute('未能保存图片，请重试。')
          : nextAction === 'path' ? uiAttribute('未能复制路径，请重试。')
            : uiAttribute('无法显示此附件所在位置。'))
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
    if (source.kind === 'attachment') setRefreshRevision(value => value + 1)
  }

  const contextMenu = <ImageContextMenu position={menu} onClose={() => setMenu(null)}
    displayName={source.image.displayName} ready={Boolean(url)} busy={action}
    hasPath={Boolean(fileLocation.location?.path)}
    revealLabel={menu && source.kind === 'attachment' && client.attachments.kind === 'native' ? attachmentRevealLabel(client.platform) : undefined}
    onAction={value => { void runImageAction(value) }} />

  const createOwnedUrl = useCallback((blob: Blob): string => {
    const nextUrl = URL.createObjectURL(blob)
    ownedUrls.current.add(nextUrl)
    return nextUrl
  }, [])

  const releaseOwnedUrl = useCallback((ownedUrl: string): void => {
    if (!ownedUrls.current.delete(ownedUrl)) return
    URL.revokeObjectURL(ownedUrl)
  }, [])

  useLayoutEffect(() => () => {
    for (const ownedUrl of ownedUrls.current) URL.revokeObjectURL(ownedUrl)
    ownedUrls.current.clear()
    committedUrl.current = null
  }, [])

  useLayoutEffect(() => {
    setFailed(false)
    setAvailability(initialAvailability)
    const cached = imagePayloadCache.get(cacheKey)
    hadCachedPayload.current = Boolean(cached)
    setUrl(cached ? createOwnedUrl(cached.blob) : null)
  }, [cacheKey, createOwnedUrl, initialAvailability, imagePayloadCache])

  useLayoutEffect(() => {
    const previousUrl = committedUrl.current
    committedUrl.current = url
    if (previousUrl && previousUrl !== url) releaseOwnedUrl(previousUrl)
  }, [releaseOwnedUrl, url])

  useEffect(() => {
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
      const candidateUrl = createOwnedUrl(payload.blob)
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
      const request = refresh || refreshRevision > 0
        ? fetchImagePayload(source, client, (next) => { if (active) setAvailability(next) })
        : getOrLoadImagePayload(source, client, (next) => { if (active) setAvailability(next) })
      void request.then((payload) => {
        if (!active) return
        if (!payload) { markUnavailable(); return }
        setAvailability('available')
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
  }, [cacheKey, createOwnedUrl, releaseOwnedUrl, source.kind, client, imagePayloadCache, refreshRevision])

  useEffect(() => {
    if (source.kind !== 'attachment') return
    const refreshVisible = (): void => {
      const bounds = tile.current?.getBoundingClientRect()
      if (document.visibilityState === 'visible' && bounds && bounds.bottom > 0 && bounds.top < window.innerHeight
        && bounds.right > 0 && bounds.left < window.innerWidth) setRefreshRevision(value => value + 1)
    }
    window.addEventListener('focus', refreshVisible)
    return () => window.removeEventListener('focus', refreshVisible)
  }, [cacheKey, source.kind])

  const unavailableLabel = availability === 'missing'
    ? uiAttribute('图片已丢失')
    : availability === 'unreadable'
      ? uiAttribute('图片不可读')
      : availability === 'kind_changed'
        ? uiAttribute('文件类型已变化')
        : uiAttribute('图片已不可用')
  const loading = !url && !failed

  return (
    <figure className="image-tile" ref={tile} title={fileLocation.label}
      onMouseEnter={fileLocation.inspect} onFocus={fileLocation.inspect}
      onContextMenu={showMenu}>
      <button type="button" className="image-tile-preview"
        aria-disabled={!url}
        aria-label={uiAttribute("查看大图 {0}", String(source.image.displayName))}
        aria-busy={loading}
        onClick={() => { if (url) showPreview() }}
        onKeyDown={showMenu}>
        {url ? <img src={url} alt={source.image.displayName} />
          : <span className="image-tile-placeholder">
              {failed ? unavailableLabel : uiAttribute("正在读取图片…")}
            </span>}
      </button>
      {notice && <figcaption className="image-tile-notice" role="status">{notice}</figcaption>}
      {!open && contextMenu}
      {actionNotice && createPortal(<div className="image-action-notice" role="status" aria-hidden={open || undefined}>{actionNotice}</div>, document.body)}
      {url && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="attachment-lightbox-overlay" />
            <Dialog.Content className="attachment-lightbox image-gallery-lightbox" aria-describedby={undefined}
              onContextMenu={showMenu} onKeyDown={showMenu}
              onCloseAutoFocus={(event) => { event.preventDefault() }}>
              <Dialog.Title className="sr-only"><UiText zh={"图片预览"} /></Dialog.Title>
              <span className="sr-only" role="status">{actionNotice}</span>
              <img src={url} alt={source.image.displayName} />
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
