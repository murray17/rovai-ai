import { desktopThreadClient } from './desktop-camp-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ThreadMessageAttachmentView } from '@contracts'
import { ImagePreviewUrl } from './image-preview-url'
import {
  ImageGallery,
  ImagePayloadCache,
  imageCacheKey,
  cacheDecodedImagePayload,
  releaseClientImageCache,
  decodeImageUrl,
  fetchImagePayload,
  getOrLoadImagePayload,
  loadUserImagePreview,
  partitionMessageAttachments,
  prepareImagePublication,
  type GalleryImage
} from './ImageGallery'

const attachment = (id: string, image = true): ThreadMessageAttachmentView => ({
  id, displayName: id, kind: 'file', fileCount: 1, mediaType: image ? 'image/png' : 'application/pdf',
  byteSize: 12, previewKind: image ? 'image' : 'none', availability: 'unknown'
})

const attachmentSource = (id: string): GalleryImage => ({
  kind: 'attachment',
  threadId: 'camp',
  locator: { owner: 'message', threadId: 'camp', messageId: 'message-1', attachmentRefId: id },
  image: attachment(id)
})

afterEach(() => {
  releaseClientImageCache(desktopThreadClient)
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
        kind: 'runtime' as const, threadId: 'camp', image: {
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

  it('lets unknown sent images load thumbnails without storage-model controls', () => {
    const html = renderToStaticMarkup(createElement(ImageGallery, {
      images: [attachmentSource('image.png')]
    }))
    expect(html).not.toContain('figcaption')
    expect(html).not.toContain('image-gallery-label')
    expect(html).not.toContain('附件操作')
    expect(html).not.toContain('系统应用打开')
    expect(html).not.toContain('Finder')
    expect(html).not.toContain('正在准备供队员读取')
    expect(html).toContain('aria-label="查看大图 image.png"')
    expect(html).not.toContain('点击预览图片')
    expect(html).toContain('正在读取图片')
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

  it('keeps an adopted URL alive through draft cleanup and eviction until its last viewer closes', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:decoded', revokeObjectURL })
    const cache = new ImagePayloadCache(3)
    const blob = new Blob(['123'])
    const draft = new ImagePreviewUrl(blob)
    cache.put('sent', { blob, byteSize: blob.size, displayed: draft })
    draft.release()
    const viewer = cache.get('sent')!.displayed!.retain()
    cache.put('different', { blob: new Blob(['x']), byteSize: 1 })
    expect(cache.get('sent')).toBeUndefined()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    viewer.release()
    expect(revokeObjectURL.mock.calls).toEqual([['blob:decoded']])
  })

  it('hands off every displayed image even when one submission exceeds the cache budget', async () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second'), revokeObjectURL })
    const cache = new ImagePayloadCache(1)
    const first = new ImagePreviewUrl(new Blob(['a']))
    const second = new ImagePreviewUrl(new Blob(['b']))
    cache.publish('camp', 'message-1', new Map([['first', first], ['second', second]]), true)
    first.release()
    second.release()
    const firstKey = imageCacheKey(attachmentSource('first'))
    expect(cache.byteSize).toBe(1)
    expect(cache.get(firstKey)).toBeUndefined()
    const tile = cache.forDisplay(firstKey)!.displayed!.retain()
    await Promise.resolve()
    expect(cache.forDisplay(firstKey)).toBeUndefined()
    cache.clear()
    expect(revokeObjectURL.mock.calls).toEqual([['blob:second']])
    tile.release()
    expect(revokeObjectURL.mock.calls).toEqual([['blob:second'], ['blob:first']])
  })

  it('publishes only submitted previews under the confirmed message and client, even for reused attachment IDs', async () => {
    const preview = vi.fn().mockResolvedValue({ preview: null, availability: 'missing' })
    vi.stubGlobal('window', { rovai: { composerAttachments: { preview } } })
    const blob = new Blob(['123'])
    const displayed = new ImagePreviewUrl(blob)
    const draft = { threadId: 'camp', attachments: [{ ...attachment('same'), sourcePath: '/image.png' }] }
    const send = prepareImagePublication(desktopThreadClient, draft, 2, new Map([['same', displayed]]))!
    const message = { authorType: 'user' as const, sequence: 2, attachments: draft.attachments }
    expect(send.awaitingReceipt('camp', message)).toBe(true)
    expect(send.awaitingReceipt('camp', { ...message, sequence: 1 })).toBe(false)
    expect(send.awaitingReceipt('camp', { ...message, attachments: [...message.attachments, attachment('other')] })).toBe(false)
    send.publish('message-1', true)
    send.release()
    displayed.release()

    const confirmed = attachmentSource('same')
    if (confirmed.kind !== 'attachment') throw new Error('expected attachment')
    expect((await getOrLoadImagePayload(confirmed, desktopThreadClient))?.blob).toBe(blob)
    expect(preview).not.toHaveBeenCalled()
    const otherMessage: GalleryImage = { ...confirmed, locator: {
      owner: 'message', threadId: 'camp', messageId: 'other', attachmentRefId: 'same'
    } }
    expect(await getOrLoadImagePayload(otherMessage, desktopThreadClient)).toBeNull()
    expect(await getOrLoadImagePayload(confirmed, { ...desktopThreadClient })).toBeNull()
    expect(preview).toHaveBeenCalledTimes(2)
  })
  it('shares an active Runtime read, uses completed payloads, and forces a later real refresh', async () => {
    let resolveRead!: (value: { mediaType: string; data: string }) => void
    const response = new Promise<{ mediaType: string; data: string }>((resolve) => { resolveRead = resolve })
    const request = vi.fn(() => response)
    vi.stubGlobal('window', { rovai: { request } })
    const source: GalleryImage = {
      kind: 'runtime', threadId: 'camp', image: {
        id: 'runtime-image', displayName: 'runtime-image', mediaType: 'image/png', byteSize: 999
      }
    }

    const first = fetchImagePayload(source, desktopThreadClient)
    const concurrent = fetchImagePayload(source, desktopThreadClient)
    expect(concurrent).toBe(first)
    expect(request).toHaveBeenCalledOnce()
    resolveRead({ mediaType: 'image/png', data: 'AQID' })
    const payload = await first
    expect(payload?.byteSize).toBe(3)
    if (!payload) throw new Error('expected image payload')

    cacheDecodedImagePayload(source, payload, desktopThreadClient)
    const cached = await getOrLoadImagePayload(source, desktopThreadClient)
    expect(cached?.blob).toBe(payload.blob)
    expect(cached?.byteSize).toBe(3)
    expect(request).toHaveBeenCalledOnce()

    expect((await fetchImagePayload(source, desktopThreadClient))?.byteSize).toBe(3)
    expect(request).toHaveBeenCalledTimes(2)

    const otherRequest = vi.fn().mockResolvedValue(null)
    const otherClient = { ...desktopThreadClient, request: otherRequest }
    expect(await getOrLoadImagePayload(source, otherClient)).toBeNull()
    expect(otherRequest).toHaveBeenCalledOnce()
  })

  it('serves a completed attachment payload from cache until the tile performs its refresh', async () => {
    const preview = vi.fn()
    vi.stubGlobal('window', { rovai: { composerAttachments: { preview } } })
    const source: GalleryImage = {
      ...attachmentSource('attachment-image')
    }
    const payload = { blob: new Blob([new Uint8Array([1, 2, 3])]), byteSize: 3 }

    cacheDecodedImagePayload(source, payload, desktopThreadClient)
    const cached = await getOrLoadImagePayload(source, desktopThreadClient)
    expect(cached?.blob).toBe(payload.blob)
    expect(cached?.byteSize).toBe(3)
    expect(preview).not.toHaveBeenCalled()
  })

  it('shares a cold user read with another viewer arriving while decoding, then reuses the decoded result', async () => {
    const preview = vi.fn().mockResolvedValue({ availability: 'available', preview: { blob: new Blob(['pixels']) } })
    vi.stubGlobal('window', { rovai: { composerAttachments: { preview } } })
    let finishDecode!: () => void
    const decode = vi.fn(() => new Promise<void>(resolve => { finishDecode = resolve }))
    vi.stubGlobal('Image', class { naturalWidth = 3840; naturalHeight = 2160; decode = decode })
    const source = attachmentSource('cold')
    const first = loadUserImagePreview(source, desktopThreadClient)
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
    const second = loadUserImagePreview(source, desktopThreadClient)
    finishDecode()
    const result = await first
    expect(result?.displayed).toBeDefined()
    expect(await second).toBe(result)
    expect(await loadUserImagePreview(source, desktopThreadClient)).toBe(result)
    expect(preview).toHaveBeenCalledOnce()
    expect(decode).toHaveBeenCalledOnce()
  })

  it('distinguishes a normal unavailable Runtime result from a thrown Core request', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('core_temporarily_unavailable'))
    vi.stubGlobal('window', { rovai: { request } })
    const source: GalleryImage = {
      kind: 'runtime', threadId: 'camp', image: {
        id: 'runtime-image', displayName: 'runtime-image', mediaType: 'image/png', byteSize: 1
      }
    }

    await expect(fetchImagePayload(source, desktopThreadClient)).resolves.toBeNull()
    await expect(fetchImagePayload(source, desktopThreadClient)).rejects.toThrow('core_temporarily_unavailable')
  })
})
