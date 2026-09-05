import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  AgentRunImageContent,
  AgentRunImageView,
  CampMessageAttachmentView,
  LocalAttachmentOwnerLocator
} from '@contracts'

export type GalleryImage = {
  kind: 'runtime'
  campId: string
  image: AgentRunImageView
} | {
  kind: 'attachment'
  campId: string
  locator: LocalAttachmentOwnerLocator
  image: CampMessageAttachmentView
}

export type MessageAttachmentGroups = {
  images: CampMessageAttachmentView[]
  files: CampMessageAttachmentView[]
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

const imagePayloadCache = new ImagePayloadCache(MAX_IMAGE_PAYLOAD_CACHE_BYTES)
const imageLoadCache = new Map<string, Promise<ImagePayload | null>>()

export function imageCacheKey(source: GalleryImage): string {
  return source.kind === 'runtime'
    ? `runtime:${source.campId}:${source.image.id}`
    : `attachment:${source.campId}:${attachmentOwnerKey(source.locator)}:${source.image.id}`
}

/** Preserve order within each kind while giving images and files independent layout regions. */
export function partitionMessageAttachments(
  attachments: CampMessageAttachmentView[]
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
  onAttachmentAvailability?: (availability: CampMessageAttachmentView['availability']) => void
): Promise<ImagePayload | null> {
  let blob: Blob
  if (source.kind === 'attachment') {
    const result = await window.rovai.composerAttachments.preview(source.locator)
    onAttachmentAvailability?.(result.availability)
    if (!result.preview) return null
    blob = new Blob(
      [Uint8Array.from(result.preview.bytes).buffer],
      { type: result.preview.mediaType }
    )
  } else {
    const content = await window.rovai.request<AgentRunImageContent | null>('agentRunImages.read', {
      campId: source.campId, imageId: source.image.id
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
  onAttachmentAvailability?: (availability: CampMessageAttachmentView['availability']) => void
): Promise<ImagePayload | null> {
  const key = imageCacheKey(source)
  const loading = imageLoadCache.get(key)
  if (loading) return loading
  const promise = readImagePayload(source, onAttachmentAvailability).finally(() => {
    if (imageLoadCache.get(key) === promise) imageLoadCache.delete(key)
  })
  imageLoadCache.set(key, promise)
  return promise
}

/** Uses a completed payload when available; cold callers otherwise share the real source read. */
export function getOrLoadImagePayload(
  source: GalleryImage,
  onAttachmentAvailability?: (availability: CampMessageAttachmentView['availability']) => void
): Promise<ImagePayload | null> {
  const cached = imagePayloadCache.get(imageCacheKey(source))
  return cached ? Promise.resolve(cached) : fetchImagePayload(source, onAttachmentAvailability)
}

export function cacheDecodedImagePayload(source: GalleryImage, payload: ImagePayload): void {
  imagePayloadCache.put(imageCacheKey(source), payload)
}

export function clearImagePayloadState(): void {
  imagePayloadCache.clear()
  imageLoadCache.clear()
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
      aria-label={variant === 'user-attachment' ? '消息图片' : 'Agent 输出图片'}
    >
      <div className={`image-gallery-grid${images.length === 1 ? ' is-single' : ''}`}>
        {images.map((source) => <ImageTile key={`${source.kind}:${source.image.id}`} source={source} />)}
      </div>
    </section>
  )
}

function ImageTile({ source }: { source: GalleryImage }): JSX.Element {
  const cacheKey = imageCacheKey(source)
  const requiresExplicitLoad = source.kind === 'attachment' && source.image.availability === 'unknown'
  const initialAvailability: CampMessageAttachmentView['availability'] = source.kind === 'attachment'
    ? source.image.availability
    : 'available'
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loadRequested, setLoadRequested] = useState(false)
  const [availability, setAvailability] = useState<CampMessageAttachmentView['availability']>(initialAvailability)
  const [open, setOpen] = useState(false)
  const tile = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const hadCachedPayload = useRef(false)
  const committedUrl = useRef<string | null>(null)
  const ownedUrls = useRef(new Set<string>())

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
    setLoadRequested(false)
    setAvailability(initialAvailability)
    const cached = imagePayloadCache.get(cacheKey)
    hadCachedPayload.current = Boolean(cached)
    setUrl(cached ? createOwnedUrl(cached.blob) : null)
  }, [cacheKey, createOwnedUrl, initialAvailability])

  useLayoutEffect(() => {
    const previousUrl = committedUrl.current
    committedUrl.current = url
    if (previousUrl && previousUrl !== url) releaseOwnedUrl(previousUrl)
  }, [releaseOwnedUrl, url])

  useEffect(() => {
    let active = true
    let started = false

    const markUnavailable = (): void => {
      imagePayloadCache.delete(cacheKey)
      setUrl(null)
      setFailed(true)
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
      setUrl(candidateUrl)
      return true
    }

    const load = (refresh: boolean): void => {
      if (started) return
      started = true
      const request = refresh
        ? fetchImagePayload(source, (next) => { if (active) setAvailability(next) })
        : getOrLoadImagePayload(source, (next) => { if (active) setAvailability(next) })
      void request.then((payload) => {
        if (!active) return
        if (!payload) { markUnavailable(); return }
        setAvailability('available')
        return install(payload).then((installed) => {
          if (active && installed && requiresExplicitLoad) setOpen(true)
        })
      }).catch(() => {
        if (active && !hadCachedPayload.current) setFailed(true)
      })
    }

    if (requiresExplicitLoad && !loadRequested) return () => { active = false }

    if (hadCachedPayload.current) {
      if (requiresExplicitLoad) return () => { active = false }
      load(true)
      return () => { active = false }
    }

    if (requiresExplicitLoad) {
      load(false)
      return () => { active = false }
    }

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(false); observer?.disconnect() }
    }, { rootMargin: '320px' })
    if (observer && tile.current) observer.observe(tile.current)
    else load(false)
    return () => { active = false; observer?.disconnect() }
  }, [cacheKey, createOwnedUrl, loadRequested, releaseOwnedUrl, requiresExplicitLoad, source.kind])

  const unavailableLabel = availability === 'missing'
    ? '图片已丢失'
    : availability === 'unreadable'
      ? '图片不可读'
      : availability === 'kind_changed'
        ? '文件类型已变化'
        : '图片已不可用'
  const waitingForAction = requiresExplicitLoad && !loadRequested && !url && !failed
  const loading = !url && !failed && !waitingForAction

  return (
    <figure className="image-tile" ref={tile}>
      <button type="button" ref={trigger} className="image-tile-preview"
        disabled={!url && !waitingForAction}
        aria-label={waitingForAction ? `预览图片 ${source.image.displayName}` : `查看大图 ${source.image.displayName}`}
        aria-busy={loading}
        onClick={() => { if (url) setOpen(true); else setLoadRequested(true) }}>
        {url ? <img src={url} alt={source.image.displayName} />
          : <span className="image-tile-placeholder">
              {failed ? unavailableLabel : waitingForAction ? '点击预览图片' : '正在读取图片…'}
            </span>}
      </button>
      {url && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="attachment-lightbox-overlay" />
            <Dialog.Content className="attachment-lightbox image-gallery-lightbox" aria-describedby={undefined}
              onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus() }}>
              <Dialog.Title className="sr-only">图片预览</Dialog.Title>
              <img src={url} alt={source.image.displayName} />
              <Dialog.Close className="attachment-lightbox-close" aria-label="关闭图片预览">
                <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m5 5 8 8M13 5l-8 8" /></svg>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </figure>
  )
}
