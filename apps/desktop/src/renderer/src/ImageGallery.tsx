import { useEffect, useRef, useState, type JSX } from 'react'
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

/** Use Chromium's real decoder (including AVIF/SVG), not MIME or extension as proof of an image. */
export async function decodeImageUrl(bytes: Uint8Array, mediaType: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: mediaType }))
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('image_unavailable')
    return url
  } catch {
    URL.revokeObjectURL(url)
    throw new Error('image_unavailable')
  }
}

async function loadImage(source: GalleryImage): Promise<string> {
  if (source.kind === 'attachment') {
    const preview = await window.rovai.composerAttachments.preview(source.image.id)
    if (!preview) throw new Error('image_unavailable')
    return decodeImageUrl(preview.bytes, preview.mediaType)
  }
  const content = await window.rovai.request<AgentRunImageContent | null>('agentRunImages.read', {
    campId: source.campId, imageId: source.image.id
  })
  if (!content) throw new Error('image_unavailable')
  const bytes = Uint8Array.from(atob(content.data), (character) => character.charCodeAt(0))
  return decodeImageUrl(bytes, content.mediaType)
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
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const tile = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source
  useEffect(() => {
    let active = true
    let started = false
    let objectUrl: string | null = null
    setUrl(null)
    setFailed(false)
    const load = (): void => {
      if (started) return
      started = true
      void loadImage(sourceRef.current).then((result) => {
        if (!active) { URL.revokeObjectURL(result); return }
        objectUrl = result
        setUrl(result)
      }).catch(() => { if (active) setFailed(true) })
    }
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { load(); observer?.disconnect() }
    }, { rootMargin: '320px' })
    if (observer && tile.current) observer.observe(tile.current)
    else load()
    return () => { active = false; observer?.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [source.kind, source.campId, source.image.id])

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
