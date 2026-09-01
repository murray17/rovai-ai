import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AgentRunImageContent, AgentRunImageView, CampMessageAttachmentView } from '@contracts'

export type GalleryImage = {
  kind: 'runtime'
  campId: string
  image: AgentRunImageView
} | {
  kind: 'attachment'
  campId: string
  image: CampMessageAttachmentView
}

export type AttachmentSegment =
  | { kind: 'images'; attachments: CampMessageAttachmentView[] }
  | { kind: 'file'; attachment: CampMessageAttachmentView }

export type ImagePayload = {
  blob: Blob
  byteSize: number
}

export const MAX_IMAGE_PAYLOAD_CACHE_BYTES = 128 * 1024 * 1024

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
    : `attachment:${source.campId}:${source.image.id}`
}

/** Keep the publication order: image/image/file/image is two galleries, not one. */
export function groupMessageAttachments(attachments: CampMessageAttachmentView[]): AttachmentSegment[] {
  const segments: AttachmentSegment[] = []
  for (const attachment of attachments) {
    if (attachment.kind === 'file' && attachment.previewKind === 'image') {
      const previous = segments.at(-1)
      if (previous?.kind === 'images') previous.attachments.push(attachment)
      else segments.push({ kind: 'images', attachments: [attachment] })
    } else segments.push({ kind: 'file', attachment })
  }
  return segments
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

async function readImagePayload(source: GalleryImage): Promise<ImagePayload | null> {
  let blob: Blob
  if (source.kind === 'attachment') {
    const preview = await window.rovai.composerAttachments.preview(source.image.id)
    if (!preview) return null
    blob = new Blob([Uint8Array.from(preview.bytes).buffer], { type: preview.mediaType })
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
export function fetchImagePayload(source: GalleryImage): Promise<ImagePayload | null> {
  const key = imageCacheKey(source)
  const loading = imageLoadCache.get(key)
  if (loading) return loading
  const promise = readImagePayload(source).finally(() => {
    if (imageLoadCache.get(key) === promise) imageLoadCache.delete(key)
  })
  imageLoadCache.set(key, promise)
  return promise
}

/** Uses a completed payload when available; cold callers otherwise share the real source read. */
export function getOrLoadImagePayload(source: GalleryImage): Promise<ImagePayload | null> {
  const cached = imagePayloadCache.get(imageCacheKey(source))
  return cached ? Promise.resolve(cached) : fetchImagePayload(source)
}

export function cacheDecodedImagePayload(source: GalleryImage, payload: ImagePayload): void {
  imagePayloadCache.put(imageCacheKey(source), payload)
}

export function clearImagePayloadState(): void {
  imagePayloadCache.clear()
  imageLoadCache.clear()
}

export function ImageGallery({ images }: { images: GalleryImage[] }): JSX.Element | null {
  if (images.length === 0) return null
  return (
    <section className="image-gallery" aria-label="图片">
      <div className={`image-gallery-grid${images.length === 1 ? ' is-single' : ''}`}>
        {images.map((source) => <ImageTile key={source.image.id} source={source} />)}
      </div>
    </section>
  )
}

function ImageTile({ source }: { source: GalleryImage }): JSX.Element {
  const cacheKey = imageCacheKey(source)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
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
    const cached = imagePayloadCache.get(cacheKey)
    hadCachedPayload.current = Boolean(cached)
    setUrl(cached ? createOwnedUrl(cached.blob) : null)
  }, [cacheKey, createOwnedUrl])

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

    const install = async (payload: ImagePayload): Promise<void> => {
      const candidateUrl = createOwnedUrl(payload.blob)
      try {
        await decodeObjectUrl(candidateUrl)
      } catch {
        releaseOwnedUrl(candidateUrl)
        if (active) markUnavailable()
        return
      }
      if (!active) {
        releaseOwnedUrl(candidateUrl)
        return
      }
      imagePayloadCache.put(cacheKey, payload)
      setFailed(false)
      setUrl(candidateUrl)
    }

    const load = (refresh: boolean): void => {
      if (started) return
      started = true
      const request = refresh
        ? fetchImagePayload(source)
        : getOrLoadImagePayload(source)
      void request.then((payload) => {
        if (!active) return
        if (!payload) { markUnavailable(); return }
        return install(payload)
      }).catch(() => {
        if (active && !hadCachedPayload.current) setFailed(true)
      })
    }

    if (hadCachedPayload.current) {
      if (source.kind === 'runtime') load(true)
      return () => { active = false }
    }

    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(false); observer?.disconnect() }
    }, { rootMargin: '320px' })
    if (observer && tile.current) observer.observe(tile.current)
    else load(false)
    return () => { active = false; observer?.disconnect() }
  }, [cacheKey, createOwnedUrl, releaseOwnedUrl, source.kind])

  return (
    <figure className="image-tile" ref={tile}>
      <button type="button" ref={trigger} className="image-tile-preview" disabled={!url}
        aria-label={`查看大图 ${source.image.displayName}`} aria-busy={!url && !failed}
        onClick={() => setOpen(true)}>
        {url ? <img src={url} alt={source.image.displayName} />
          : <span className="image-tile-placeholder">{failed ? '图片已不可用' : '正在读取图片…'}</span>}
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
