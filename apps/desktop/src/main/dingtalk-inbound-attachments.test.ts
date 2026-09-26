import { access, readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withDingTalkInboundFiles, dingtalkAttachmentFailureCode } from './dingtalk-inbound-attachments'
import { DingTalkOpenApiClient } from './dingtalk-open-api'
import type { PendingChannelAttachments } from './channel-inbound-attachments'

const pending: PendingChannelAttachments = {
  requestId: 'request', appId: 'app', messageId: 'message', attempt: 0, retryAt: null,
  resources: [
    { fileKey: 'resource:0', downloadCode: 'grant-image', name: '图片', kind: 'image' },
    { fileKey: 'resource:1', downloadCode: 'grant-file', name: '说明.txt', kind: 'file' }
  ]
}

describe('DingTalk inbound attachment transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('exchanges receiving-Bot grants and streams bytes without forwarding tokens to storage', async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/oauth2/accessToken')) return Response.json({ accessToken: 'private-token', expireIn: 7200 })
      if (url.endsWith('/messageFiles/download')) {
        expect(new Headers(init?.headers).get('x-acs-dingtalk-access-token')).toBe('private-token')
        const body = JSON.parse(String(init?.body))
        expect(body.robotCode).toBe('receiving-robot')
        return Response.json({ downloadUrl: `https://storage.example/${body.downloadCode}?signed=private` })
      }
      expect(new Headers(init?.headers).get('x-acs-dingtalk-access-token')).toBeNull()
      expect(init?.body).toBeUndefined()
      return new Response(url.includes('grant-image') ? 'image bytes' : '完整文件')
    })
    vi.stubGlobal('fetch', fetcher)
    const api = new DingTalkOpenApiClient({ appKey: 'app', appSecret: 'secret' })
    let saved: string[] = []
    await withDingTalkInboundFiles(api, 'receiving-robot', pending, async files => {
      saved = files
      expect(await Promise.all(files.map(path => readFile(path, 'utf8')))).toEqual(['image bytes', '完整文件'])
    })
    for (const path of saved) await expect(access(path)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it.each(['token', 'grant', 'body'])('aborts an unfinished %s request without submitting partial files', async stage => {
    const controller = new AbortController()
    const reached = vi.fn()
    const cancelled = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input)
      const current = url.endsWith('/oauth2/accessToken') ? 'token'
        : url.endsWith('/messageFiles/download') ? 'grant' : 'body'
      if (current === stage) {
        reached()
        if (stage === 'body') return new Response(new ReadableStream({ cancel: cancelled }))
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
      return Response.json(current === 'token'
        ? { accessToken: 'token', expireIn: 7200 } : { downloadUrl: 'https://storage.example/file' })
    }))
    const consume = vi.fn()
    const api = new DingTalkOpenApiClient({ appKey: 'app', appSecret: 'secret' })
    const download = withDingTalkInboundFiles(api, 'robot', pending, consume, controller.signal)
    const rejected = expect(download).rejects.toThrow()
    await vi.waitFor(() => expect(reached).toHaveBeenCalledOnce())
    controller.abort()
    await rejected
    expect(consume).not.toHaveBeenCalled()
    if (stage === 'body') expect(cancelled).toHaveBeenCalledOnce()
  })

  it('rejects unsupported or missing grants and classifies authorization failures without response details', async () => {
    const consume = vi.fn()
    const api = { messageFileDownloadUrl: vi.fn().mockResolvedValue('https://storage.example/file') }
    for (const kind of ['folder', 'sticker']) {
      await expect(withDingTalkInboundFiles(api, 'robot', {
        ...pending, resources: [{ fileKey: 'resource:0', name: kind, kind }]
      }, consume)).rejects.toThrow('channel.attachments.unsupported')
    }
    await expect(withDingTalkInboundFiles(api, 'robot', {
      ...pending, resources: [{ fileKey: 'resource:0', name: 'file', kind: 'file' }]
    }, consume)).rejects.toThrow('channel.attachments.download_failed')
    expect(api.messageFileDownloadUrl).not.toHaveBeenCalled()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private error detail', { status: 403 })))
    const error = await withDingTalkInboundFiles(api, 'robot', pending, consume).catch(error => error)
    expect(dingtalkAttachmentFailureCode(error)).toBe('channel.attachments.permission_denied')
    expect(String(error)).not.toContain('private error detail')
    expect(consume).not.toHaveBeenCalled()
  })
})
