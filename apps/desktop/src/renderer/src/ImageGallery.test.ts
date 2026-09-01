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
  groupMessageAttachments,
  type GalleryImage
} from './ImageGallery'

const attachment = (id: string, image = true): CampMessageAttachmentView => ({
  id, displayName: id, kind: 'file', fileCount: 1, mediaType: image ? 'image/png' : 'application/pdf',
  byteSize: 12, previewKind: image ? 'image' : 'none', runtimeProjectionState: 'available'
})

afterEach(() => {
  clearImagePayloadState()
  vi.unstubAllGlobals()
})

describe('shared image presentation', () => {
  it('groups only contiguous images without changing the attachment order', () => {
    const items = [attachment('A'), attachment('B'), attachment('report', false), attachment('C')]
    expect(groupMessageAttachments(items)).toEqual([
      { kind: 'images', attachments: items.slice(0, 2) },
      { kind: 'file', attachment: items[2] },
      { kind: 'images', attachments: [items[3]] }
    ])
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

  it('shows sent images without file labels, projection text or system-open controls', () => {
    const html = renderToStaticMarkup(createElement(ImageGallery, {
      images: [{ kind: 'attachment', campId: 'camp', image: { ...attachment('image.png'), runtimeProjectionState: 'pending' } }]
    }))
    expect(html).not.toContain('figcaption')
    expect(html).not.toContain('image-gallery-label')
    expect(html).not.toContain('附件操作')
    expect(html).not.toContain('系统应用打开')
    expect(html).not.toContain('Finder')
    expect(html).not.toContain('正在准备供队员读取')
    expect(html).toContain('aria-label="查看大图 image.png"')
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

  it('does not read an immutable attachment again when its decoded payload is cached', async () => {
    const preview = vi.fn()
    vi.stubGlobal('window', { rovai: { composerAttachments: { preview } } })
    const source: GalleryImage = {
      kind: 'attachment', campId: 'camp', image: attachment('attachment-image')
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
