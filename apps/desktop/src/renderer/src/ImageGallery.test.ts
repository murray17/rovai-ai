import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CampMessageAttachmentView } from '@contracts'
import { ImageGallery, decodeImageUrl, groupMessageAttachments } from './ImageGallery'

const attachment = (id: string, image = true): CampMessageAttachmentView => ({
  id, displayName: id, kind: 'file', fileCount: 1, mediaType: image ? 'image/png' : 'application/pdf',
  byteSize: 12, previewKind: image ? 'image' : 'none', runtimeProjectionState: 'available'
})

afterEach(() => vi.unstubAllGlobals())

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
})
