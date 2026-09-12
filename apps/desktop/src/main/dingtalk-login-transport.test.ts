import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { net, type Session } from 'electron'
import { DingTalkLoginTransport, dingTalkLoginFetch, requireDingTalkNavigation, type DingTalkLoginFetch } from './dingtalk-login-transport'

vi.mock('electron', () => ({ net: { request: vi.fn() } }))
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
const challenge = 'https://login.dingtalk.com/oauth2/challenge.htm'

describe('isolated DingTalk login transport', () => {
  it('keeps the native request and body on the supplied Session, with login origin and no console credentials', async () => {
    const request = Object.assign(new EventEmitter(), { end: vi.fn(), abort: vi.fn() })
    vi.mocked(net.request).mockReturnValue(request as unknown as ReturnType<typeof net.request>)
    const session = {} as Session
    const signal = new AbortController()
    const pending = dingTalkLoginFetch(session)(challenge, {
      method: 'POST', headers: new Headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: 'client_id=portal-client', signal: signal.signal
    })
    expect(net.request).toHaveBeenCalledWith(expect.objectContaining({
      session, origin: 'https://login.dingtalk.com', credentials: 'include', redirect: 'manual'
    }))
    request.emit('close') // Chromium may close the outgoing side before it emits response.
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' } })
    request.emit('response', response)
    response.emit('data', Buffer.from('{"success":'))
    signal.abort()
    await expect(pending).rejects.toThrow('dingtalk_operation_cancelled')
    expect(request.abort).toHaveBeenCalledOnce()
    response.emit('data', Buffer.from('true}'))
    response.emit('end')
  })

  it.each(['headers', 'body'])('bounds stalled %s independently and sanitizes the failure', async where => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    let requestSignal: AbortSignal | undefined
    const fetch: DingTalkLoginFetch = async (_url, options) => {
      requestSignal = options.signal
      if (where === 'headers') return new Promise(() => {})
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')) }, cancel }))
    }
    const transport = new DingTalkLoginTransport(fetch, 50)
    const pending = expect(transport.form('/oauth2/generate_qrcode', new URLSearchParams(), challenge, new AbortController().signal))
      .rejects.toThrow('dingtalk_login_request_timeout')
    await vi.advanceTimersByTimeAsync(51)
    await pending
    expect(requestSignal?.aborted).toBe(true)
    if (where === 'body') expect(cancel).toHaveBeenCalledOnce()
  })

  it.each(['http://login.dingtalk.com/oauth2/challenge.htm', 'https://login.dingtalk.com.evil.test/oauth2/challenge.htm',
    'https://login.dingtalk.com:444/oauth2/challenge.htm', 'https://user:private@login.dingtalk.com/oauth2/challenge.htm',
    'https://open-dev.dingtalk.com/admin/delete'])('rejects unsafe navigation %s', raw => {
    expect(() => requireDingTalkNavigation(raw)).toThrow('dingtalk_login_redirect_rejected')
  })

  it('validates each redirect before sending and never forwards form data across domains', async () => {
    const fetch = vi.fn<DingTalkLoginFetch>(async () => new Response(null, { status: 302, headers: {
      location: 'https://evil.test/callback?code=private'
    } }))
    const transport = new DingTalkLoginTransport(fetch)
    await expect(transport.navigate('https://open-dev.dingtalk.com/', new AbortController().signal))
      .rejects.toThrow('dingtalk_login_redirect_rejected')
    expect(fetch).toHaveBeenCalledOnce()
    await expect(transport.form('/oauth2/login_with_qr', new URLSearchParams({ code: 'private' }), challenge, new AbortController().signal))
      .rejects.toThrow('dingtalk_login_protocol_incompatible')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects an oversized body while keeping remote body text out of errors', async () => {
    const transport = new DingTalkLoginTransport(async () => new Response('private', { headers: { 'content-length': '2000001' } }))
    await expect(transport.navigate('https://open-dev.dingtalk.com/', new AbortController().signal))
      .rejects.toThrow('dingtalk_login_response_too_large')
  })
})
