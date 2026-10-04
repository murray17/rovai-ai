import { readFile, access } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { normalize, type LarkChannel, type RawMessageEvent } from '@larksuiteoapi/node-sdk'
import { describe, it, expect, vi } from 'vitest'
import {
  feishuInboundResources, withFeishuInboundFiles, feishuAttachmentFailureCode,
  type PendingFeishuAttachments
} from './feishu-inbound-attachments'

function fakeChannel(get: ReturnType<typeof vi.fn>): Pick<LarkChannel, 'rawClient'> {
  return { rawClient: { im: { v1: { messageResource: { get } } } } } as unknown as Pick<LarkChannel, 'rawClient'>
}
const pending: PendingFeishuAttachments = {
  requestId: 'request', appId: 'bot', messageId: 'message', attempt: 0, retryAt: null,
  resources: [
    { fileKey: 'img_key', name: '参考图.png', kind: 'image' },
    { fileKey: 'file_key', name: '文档.pdf', kind: 'file' }
  ]
}

describe('Feishu inbound attachments', () => {
  it('preserves file cards in a rich post that the SDK omits from normalized resources', async () => {
    const body = { title: '', content: [[{ tag: 'text', text: '读取校验码' }]],
      files: [{ file_key: 'file_one', file_name: 'read-me.txt', is_folder: false },
        { file_key: 'file_one', file_name: 'read-me.txt', is_folder: false }] }
    for (const content of [body, { zh_cn: body }]) {
      const message = await normalize({ sender: { sender_id: { open_id: 'user' } },
        message: { message_id: 'message', chat_id: 'chat', chat_type: 'p2p', message_type: 'post',
          content: JSON.stringify(content) }
      } as RawMessageEvent, { botIdentity: { openId: 'bot', name: 'Rovai' }, includeRaw: true })
      expect(message.resources).toEqual([])
      expect(feishuInboundResources(message)).toEqual([
        { fileKey: 'file_one', name: 'read-me.txt', kind: 'file' }
      ])
    }
  })

  it('keeps rich-post images in order and downloads each referenced resource once', async () => {
    const message = await normalize({
      sender: { sender_id: { open_id: 'user' } },
      message: { message_id: 'message', chat_id: 'chat', chat_type: 'p2p', message_type: 'post',
        content: JSON.stringify({ zh_cn: { title: '参考图', content: [[
          { tag: 'text', text: '请参考' }, { tag: 'img', image_key: 'img_one' },
          { tag: 'img', image_key: 'img_two' }, { tag: 'img', image_key: 'img_one' }
        ]] } }) }
    } as RawMessageEvent, { botIdentity: { openId: 'bot', name: 'Rovai' } })
    expect(feishuInboundResources(message)).toEqual([
      { fileKey: 'img_one', name: 'image', kind: 'image' },
      { fileKey: 'img_two', name: 'image', kind: 'image' }
    ])
  })

  it('uses message-resource API and keeps complete files alive through Core acknowledgement', async () => {
    const get = vi.fn().mockImplementation(async ({ path }) => ({
      getReadableStream: () => Readable.from([Buffer.from(path.file_key), Buffer.from('\n完整内容')])
    }))
    let saved: string[] = []
    const result = await withFeishuInboundFiles(fakeChannel(get), pending, async files => {
      saved = files
      expect(await readFile(files[0], 'utf8')).toBe('img_key\n完整内容')
      expect(await readFile(files[1], 'utf8')).toBe('file_key\n完整内容')
      return 'committed'
    })
    expect(result).toBe('committed')
    expect(get.mock.calls.map(([payload]) => payload)).toEqual([
      { path: { message_id: 'message', file_key: 'img_key' }, params: { type: 'image' } },
      { path: { message_id: 'message', file_key: 'file_key' }, params: { type: 'file' } }
    ])
    for (const path of saved) await expect(access(path)).rejects.toThrow()
  })

  it('never submits a partial attachment batch and bounds aggregate bytes', async () => {
    const consume = vi.fn()
    const get = vi.fn()
      .mockResolvedValueOnce({ getReadableStream: () => Readable.from([Buffer.from('first')]) })
      .mockRejectedValueOnce(new Error('network failed'))
    await expect(withFeishuInboundFiles(fakeChannel(get), pending, consume)).rejects.toThrow('network failed')
    expect(consume).not.toHaveBeenCalled()
    const block = Buffer.alloc(1024 * 1024)
    const oversized = vi.fn(async () => ({ getReadableStream: () => Readable.from(Array(101).fill(block)) }))
    await expect(withFeishuInboundFiles(fakeChannel(oversized), pending, consume)).rejects.toThrow('channel.attachments.too_large')
    expect(consume).not.toHaveBeenCalled()
  })

  it('cleans downloads after a lost Core reply and reports unsupported resources explicitly', async () => {
    const get = vi.fn(async () => ({ getReadableStream: () => Readable.from(['file']) }))
    let saved: string[] = []
    await expect(withFeishuInboundFiles(fakeChannel(get), pending, async files => {
      saved = files
      throw new Error('core reply lost')
    })).rejects.toThrow('core reply lost')
    for (const path of saved) await expect(access(path)).rejects.toThrow()
    get.mockClear()
    await expect(withFeishuInboundFiles(fakeChannel(get), { ...pending,
      resources: [{ fileKey: 'sticker', name: 'sticker', kind: 'sticker' }] }, vi.fn()))
      .rejects.toThrow('channel.attachments.unsupported')
    expect(get).not.toHaveBeenCalled()
    expect(feishuAttachmentFailureCode({ response: { status: 403 } })).toBe('channel.attachments.permission_denied')
    expect(feishuAttachmentFailureCode(new Error('private server detail'))).toBe('channel.attachments.download_failed')
  })

  it('cancels an unfinished SDK request and closes a late response without dispatching it', async () => {
    let finish!: (value: { getReadableStream: () => Readable }) => void
    const get = vi.fn(() => new Promise<{ getReadableStream: () => Readable }>(resolve => { finish = resolve }))
    const controller = new AbortController()
    const consume = vi.fn()
    const download = withFeishuInboundFiles(fakeChannel(get), pending, consume, controller.signal)
    const rejected = expect(download).rejects.toThrow('channel.attachments.download_failed')
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    const late = Readable.from(['late response'])
    finish({ getReadableStream: () => late })
    await vi.waitFor(() => expect(late.destroyed).toBe(true))
    expect(consume).not.toHaveBeenCalled()
  })
})
