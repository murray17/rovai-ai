import { EventEmitter } from 'node:events'
import { net, type Session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dingTalkConsoleFetch } from './dingtalk-console-transport'

vi.mock('electron', () => ({ net: { request: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

describe('DingTalk Electron request boundary', () => {
  it('captures a manual login redirect without following it or misclassifying it as a network failure', async () => {
    const f = fixture()
    const pending = f.send()
    f.request.emit('redirect', 302, 'GET', 'https://login.dingtalk.com/oauth2/auth?state=private-fixture')
    const response = await pending
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('https://login.dingtalk.com/')
    expect(f.request.abort).toHaveBeenCalledOnce()
    expect(net.request).toHaveBeenCalledWith(expect.objectContaining({
      session: f.session, credentials: 'include', redirect: 'manual', origin: 'https://open-dev.dingtalk.com'
    }))
    expect(net.request).toHaveBeenCalledOnce()
  })

  it('returns bounded response bytes and headers from the same isolated session', async () => {
    const f = fixture()
    const pending = f.send()
    // Electron 43 emits request close before the IncomingMessage response.
    // It is not evidence that the response has been truncated or failed.
    f.request.emit('close')
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200, headers: { 'content-type': ['application/json'] }
    })
    f.request.emit('response', response)
    response.emit('data', Buffer.from('{"success":'))
    response.emit('data', Buffer.from('true}'))
    response.emit('end')
    expect(await (await pending).json()).toEqual({ success: true })
  })

  it('aborts an oversized response before buffering it and lets the public boundary report its size failure', async () => {
    const f = fixture()
    const pending = f.send()
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} })
    f.request.emit('response', response)
    response.emit('data', Buffer.alloc(2_000_001))
    expect((await pending).headers.get('content-length')).toBe('2000001')
    expect(f.request.abort).toHaveBeenCalledOnce()
  })

  it('never exposes Chromium error URLs and does not dispatch an already cancelled request', async () => {
    const f = fixture()
    const pending = f.send()
    f.request.emit('error', new Error('failed https://open-dev.dingtalk.com/?access_token=private-fixture'))
    await expect(pending).rejects.toThrow('dingtalk_console_network_failed')
    f.signal.abort()
    await expect(f.send()).rejects.toThrow()
    expect(net.request).toHaveBeenCalledOnce()
  })

  it('cancels once and removes its abort listener after completion', async () => {
    const f = fixture()
    const pending = f.send()
    f.signal.abort()
    await expect(pending).rejects.toThrow('dingtalk_console_request_aborted')
    expect(f.request.abort).toHaveBeenCalledOnce()
    f.request.emit('error', new Error('late request error'))
    f.request.emit('close')
  })
})

function fixture() {
  const request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn() })
  vi.mocked(net.request).mockReturnValue(request as unknown as ReturnType<typeof net.request>)
  const session = {} as Session
  const signal = new AbortController()
  const fetch = dingTalkConsoleFetch(session)
  return { request, session, signal, send: () => fetch('https://open-dev.dingtalk.com/baseInfo', {
    method: 'GET', headers: new Headers({ Accept: 'application/json' }),
    credentials: 'include', redirect: 'manual', signal: signal.signal
  }) }
}
