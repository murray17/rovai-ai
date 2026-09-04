import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CampMessageAttachmentView } from '@contracts'
import {
  ImageGallery,
  ImagePayloadCache,
  cacheDecodedImagePayload,
  clearImagePayloadState,
  decodeImageUrl,
  fetchImagePayload,
  getOrLoadImagePayload,
  partitionMessageAttachments,
  type GalleryImage
} from './ImageGallery'

const attachment = (id: string, image = true): CampMessageAttachmentView => ({
  id, displayName: id, kind: 'file', fileCount: 1, mediaType: image ? 'image/png' : 'application/pdf',
  byteSize: 12, previewKind: image ? 'image' : 'none', availability: 'unknown'
})

const attachmentSource = (id: string): GalleryImage => ({
  kind: 'attachment',
  campId: 'camp',
  locator: { owner: 'message', campId: 'camp', messageId: 'message-1', attachmentRefId: id },
  image: attachment(id)
})

afterEach(() => {
  clearImagePayloadState()
  vi.unstubAllGlobals()
})

describe('shared image presentation', () => {
  it('partitions images and files while preserving order inside each display region', () => {
    const items = [attachment('A'), attachment('B'), attachment('report', false), attachment('C')]
    expect(partitionMessageAttachments(items)).toEqual({
      images: [items[0], items[1], items[3]],
      files: [items[2]]
    })
  })

  it('marks user and Agent galleries as independent presentation variants', () => {
    const source = [attachmentSource('image.png')]
    const userHtml = renderToStaticMarkup(createElement(ImageGallery, {
      images: source,
      variant: 'user-attachment'
    }))
    const agentHtml = renderToStaticMarkup(createElement(ImageGallery, { images: source }))
    expect(userHtml).toContain('class="image-gallery image-gallery-user-attachment"')
    expect(agentHtml).toContain('class="image-gallery image-gallery-agent-output"')
  })

  it('keeps all Runtime images visible, with no attachment operations', () => {
    vi.stubGlobal('window', { rovai: { platform: 'darwin' } })
    const html = renderToStaticMarkup(createElement(ImageGallery, {
      images: Array.from({ length: 20 }, (_, index) => ({
        kind: 'runtime' as const, campId: 'camp', image: {
          id: `image-${index}`, displayName: `图片 ${index}`, mediaType: 'image/png', byteSize: 12
        }
      }))
    }))
    expect(html.match(/class="image-tile"/g)).toHaveLength(20)
    expect(html).not.toContain('附件操作')
    expect(html).not.toContain('查看全部')
    expect(html).not.toContain('运行图片')
    expect(html).not.toContain('figcaption')
  })

  it('keeps source-backed sent images action-gated without storage-model controls', () => {
    const html = renderToStaticMarkup(createElement(ImageGallery, {
      images: [attachmentSource('image.png')]
    }))
    expect(html).not.toContain('figcaption')
    expect(html).not.toContain('image-gallery-label')
    expect(html).not.toContain('附件操作')
    expect(html).not.toContain('系统应用打开')
    expect(html).not.toContain('Finder')
    expect(html).not.toContain('正在准备供队员读取')
    expect(html).toContain('aria-label="预览图片 image.png"')
    expect(html).toContain('点击预览图片')
    expect(html).not.toContain('正在读取图片')
  })

  it('decodes real image content instead of trusting MIME and revokes failed URLs', async () => {
    const createObjectURL = vi.fn(() => 'blob:fixture')
    const revokeObjectURL = vi.fn()
    const decode = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.stubGlobal('Image', class { naturalWidth = 12; naturalHeight = 9; decode = decode })
    expect(await decodeImageUrl(new Uint8Array([1]), 'image/png')).toBe('blob:fixture')
    expect(decode).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    decode.mockRejectedValueOnce(new Error('corrupt image'))
    await expect(decodeImageUrl(new Uint8Array([1]), 'image/png')).rejects.toThrow('image_unavailable')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fixture')
  })

  it('budgets cached payloads by actual Blob size without owning or revoking Tile URLs', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })
    const cache = new ImagePayloadCache(3)
    const first = new Blob([new Uint8Array([1, 2])])
    const second = new Blob([new Uint8Array([3, 4])])
    const third = new Blob([new Uint8Array([5])])

    cache.put('first', { blob: first, byteSize: 999 })
    expect(cache.get('first')).toEqual({ blob: first, byteSize: 2 })
    cache.put('second', { blob: second, byteSize: 0 })
    expect(cache.get('first')).toBeUndefined()
    expect(cache.get('second')).toEqual({ blob: second, byteSize: 2 })
    cache.put('third', { blob: third, byteSize: 0 })

    expect(cache.byteSize).toBe(3)
    expect(cache.size).toBe(2)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('shares an active Runtime read, uses completed payloads, and forces a later real refresh', async () => {
    let resolveRead!: (value: { mediaType: string; data: string }) => void
    const response = new Promise<{ mediaType: string; data: string }>((resolve) => { resolveRead = resolve })
    const request = vi.fn(() => response)
    vi.stubGlobal('window', { rovai: { request } })
    const source: GalleryImage = {
      kind: 'runtime', campId: 'camp', image: {
        id: 'runtime-image', displayName: 'runtime-image', mediaType: 'image/png', byteSize: 999
      }
    }

    const first = fetchImagePayload(source)
    const concurrent = fetchImagePayload(source)
    expect(concurrent).toBe(first)
    expect(request).toHaveBeenCalledOnce()
    resolveRead({ mediaType: 'image/png', data: 'AQID' })
    const payload = await first
    expect(payload?.byteSize).toBe(3)
    if (!payload) throw new Error('expected image payload')

    cacheDecodedImagePayload(source, payload)
    const cached = await getOrLoadImagePayload(source)
    expect(cached?.blob).toBe(payload.blob)
    expect(cached?.byteSize).toBe(3)
    expect(request).toHaveBeenCalledOnce()

    expect((await fetchImagePayload(source))?.byteSize).toBe(3)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('serves a completed attachment payload from cache until the tile performs its refresh', async () => {
    const preview = vi.fn()
    vi.stubGlobal('window', { rovai: { composerAttachments: { preview } } })
    const source: GalleryImage = {
      ...attachmentSource('attachment-image')
    }
    const payload = { blob: new Blob([new Uint8Array([1, 2, 3])]), byteSize: 3 }

    cacheDecodedImagePayload(source, payload)
    const cached = await getOrLoadImagePayload(source)
    expect(cached?.blob).toBe(payload.blob)
    expect(cached?.byteSize).toBe(3)
    expect(preview).not.toHaveBeenCalled()
  })

  it('distinguishes a normal unavailable Runtime result from a thrown Core request', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('core_temporarily_unavailable'))
    vi.stubGlobal('window', { rovai: { request } })
    const source: GalleryImage = {
      kind: 'runtime', campId: 'camp', image: {
        id: 'runtime-image', displayName: 'runtime-image', mediaType: 'image/png', byteSize: 1
      }
    }

    await expect(fetchImagePayload(source)).resolves.toBeNull()
    await expect(fetchImagePayload(source)).rejects.toThrow('core_temporarily_unavailable')
  })
})
