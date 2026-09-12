import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeishuSessionHttp, loginDelay } from './feishu-session-http'
import { brandForPortal, isFeishuCookieDomain, trustedFeishuUrl } from './feishu-domains'

const origin = 'https://open.feishu.cn'
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Feishu Session requests and domain boundaries', () => {
  it('tracks validated final URLs instead of Electron Response.url and removes login headers on navigation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://open.larkoffice.com/app' } }))
      .mockResolvedValueOnce(new Response('portal'))
    const http = new FeishuSessionHttp({ fetch })
    const result = await http.request('https://accounts.feishu.cn/cross?ticket=fixture', { kind: 'navigation' }, {
      method: 'POST', body: 'token', headers: { cookie: 'raw-secret', 'x-flow-key': 'flow-secret', 'x-app-id': 'bot-id', 'x-csrf-token': 'csrf-secret', authorization: 'secret' }
    })
    expect(result.finalUrl).toBe('https://open.larkoffice.com/app')
    expect(await result.response.text()).toBe('portal')
    for (const [, init] of fetch.mock.calls) {
      expect(init).toMatchObject({ method: 'GET', credentials: 'include', redirect: 'manual' })
      expect(init.body).toBeUndefined()
      expect([...new Headers(init.headers).keys()]).toEqual(['accept'])
    }
  })

  it.each(['http://open.feishu.cn/app', 'https://user:pass@open.feishu.cn/app', 'https://open.feishu.cn.evil.example/app', 'https://open.feishu.cn:8443/app', 'https://evil.example/app', 'file:///tmp/cookie', 'https://open.larksuite.com@evil.example/app'])(
    'rejects an unsafe redirect before contacting its target: %s', async (location) => {
      const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location } }))
      await expect(new FeishuSessionHttp({ fetch }).request(`${origin}/app`, { kind: 'navigation' })).rejects.toThrow('feishu_session_url_rejected')
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('limits redirect loops', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/app' } }))
    await expect(new FeishuSessionHttp({ fetch }).request(`${origin}/app`, { kind: 'navigation' })).rejects.toThrow('feishu_session_redirect_limit')
    expect(fetch).toHaveBeenCalledTimes(9)
  })

  it('does not replay API mutations or login protocol requests on a redirect', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 307, headers: { location: 'https://accounts.larksuite.com/login' } }))
    const http = new FeishuSessionHttp({ fetch })
    const result = await http.request(`${origin}/developers/v1/create`, { kind: 'api', origin }, { method: 'POST', body: 'mutation' })
    expect(result.response.status).toBe(307)
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(http.request('https://accounts.feishu.cn/accounts/qrlogin/init', { kind: 'login', origin: 'https://accounts.feishu.cn' }, { method: 'POST' })).rejects.toThrow('feishu_login_protocol_redirect')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it.each(['headers', 'body'] as const)('times out a stalled %s operation even if it ignores cancellation', async (phase) => {
    const cancel = vi.fn()
    const fetch = vi.fn(() => phase === 'headers' ? new Promise<Response>(() => {})
      : Promise.resolve(new Response(new ReadableStream({ cancel }))))
    const outcome = new FeishuSessionHttp({ fetch }, 20).request(`${origin}/app`, { kind: 'navigation' }).catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(25)
    expect(await outcome).toBe('feishu_request_timeout')
    expect(fetch.mock.calls).toHaveLength(1)
    if (phase === 'body') expect(cancel).toHaveBeenCalled()
  })

  it('propagates cancellation through body reading and pending polling waits', async () => {
    const abort = new AbortController()
    const cancel = vi.fn()
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })))
    const request = new FeishuSessionHttp({ fetch }).request(`${origin}/app`, { kind: 'navigation' }, { signal: abort.signal }).catch((error: Error) => error.message)
    const delay = loginDelay(1000, abort.signal).catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    abort.abort(new Error('feishu_login_cancelled'))
    expect(await request).toBe('feishu_login_cancelled')
    expect(await delay).toBe('feishu_login_cancelled')
    expect(cancel).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('redacts unexpected transport messages and keeps an explicit brand map', async () => {
    const fetch = vi.fn(async () => { throw new Error('https://accounts.feishu.cn/cross?secret=never-log') })
    await expect(new FeishuSessionHttp({ fetch }).request(`${origin}/app`, { kind: 'navigation' })).rejects.toThrow(/^feishu_network_error$/)
    expect(brandForPortal('https://open.larkoffice.com/app')).toBe('feishu')
    expect(brandForPortal('https://open.larksuite.com/app')).toBe('lark')
    expect(isFeishuCookieDomain('.larkoffice.com')).toBe(true)
    expect(isFeishuCookieDomain('larkoffice.com.evil.example')).toBe(false)
    expect(() => trustedFeishuUrl('https://open.larkoffice.com.evil.example')).toThrow()
  })
})
