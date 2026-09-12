import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeishuDeveloperIdentity, PendingFeishuDeveloperConnection, StoredFeishuDeveloperSession } from './feishu-developer-session'

const electron = vi.hoisted(() => ({
  sessions: [] as ReturnType<typeof fakeSession>[],
  BrowserWindow: vi.fn(() => { throw new Error('Login must not render remote pages') })
}))
vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow, session: {
  fromPartition: () => {
    const session = fakeSession()
    electron.sessions.push(session)
    return session
  }
} }))
import { ElectronFeishuDeveloperSessionService } from './feishu-developer-session'

const user = { id: 'user-1', name: '张三', tenantId: 'tenant-1', tenantName: '示例团队' }
let portalUser: Record<string, unknown>
let origin: string
let portalFailure: 'network' | 'expired' | null
let polling: Record<string, unknown>[]
let initialize: Record<string, unknown>
let flowKey: string | null
let failCookieRestore = false
let intercept: ((url: string, init?: RequestInit) => Promise<Response> | undefined) | undefined

function htmlResponse() {
  return new Response(`<html><script>(()=>{window.user=${JSON.stringify(portalUser)};window.csrfToken='csrf-fixture';window.outDomain={larkOpen:'${origin}'};})()</script></html>`)
}
function json(value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', ...headers } })
}
function fakeSession() {
  return {
    clearStorageData: vi.fn(async () => undefined),
    cookies: {
      get: vi.fn(async () => [{ name: 'session', value: 'cookie-fixture', domain: '.larkoffice.com', path: '/app', secure: true, httpOnly: true, sameSite: 'lax', session: false, expirationDate: 9_999_999_999, hostOnly: false },
        { name: 'host', value: 'host-cookie-fixture', domain: 'open.larkoffice.com', path: '/', secure: true, httpOnly: false, sameSite: 'strict', session: true, hostOnly: true },
        { name: 'other', value: 'ignored', domain: '.example.org', path: '/', session: true }]),
      set: vi.fn(async (_value: unknown) => { if (failCookieRestore) { failCookieRestore = false; throw new Error('cookie restore failed') } })
    },
    fetch: vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
      const intercepted = intercept?.(url, init)
      if (intercepted) return intercepted
      if (url.endsWith('/qrlogin/init')) return json(initialize, flowKey ? { 'x-flow-key': flowKey } : {})
      if (url.endsWith('/qrlogin/polling')) return json({ code: 0, data: polling.shift() ?? { next_step: 'qr_login_polling', step_info: { status: 1 } } })
      if (url.includes('/cross')) return new Response(null, { status: 302, headers: { location: `${origin}/app` } })
      if (url.includes('/developers/')) return json({ code: 0, data: {} })
      if (portalFailure === 'network') throw new Error('untrusted network message')
      if (portalFailure === 'expired') {
        if (url.startsWith('https://accounts.')) return new Response('<html></html>')
        return new Response(null, { status: 302, headers: { location: 'https://accounts.feishu.cn/accounts/page/login' } })
      }
      if (new URL(url).origin !== origin) return new Response(null, { status: 302, headers: { location: `${origin}/app` } })
      return htmlResponse()
    })
  }
}
const complete = () => ({ next_step: 'enter_app', step_info: { cross_login_uri: 'https://accounts.feishu.cn/cross?ticket=fixture' } })
function create(store = new MemoryStore(), profile: Record<string, number> = {}) {
  const qrDataUrl = vi.fn(async (_payload: string) => 'data:image/png;base64,fixture')
  const diagnostic = vi.fn()
  return { store, qrDataUrl, diagnostic, service: new ElectronFeishuDeveloperSessionService(store, undefined,
    { profile: { pollIntervalMs: 10, requestTimeoutMs: 100, loginTimeoutMs: 1000, ...profile }, qrDataUrl, diagnostic,
      request: (session, url, init) => session.fetch(url, init) }) }
}
async function login(service: ElectronFeishuDeveloperSessionService, options = {}) {
  polling.push(complete())
  const promise = service.beginLogin(options)
  await vi.advanceTimersByTimeAsync(11)
  return promise
}
async function connected() {
  const fixture = create()
  await login(fixture.service)
  await fixture.service.activatePendingLogin(fixture.store.commit(fixture.service.pendingConnection()))
  return fixture
}

beforeEach(() => {
  vi.useFakeTimers()
  electron.sessions.length = 0
  electron.BrowserWindow.mockClear()
  portalUser = { ...user }
  origin = 'https://open.feishu.cn'
  portalFailure = null
  polling = []
  initialize = { code: 0, data: { next_step: 'qr_login_polling', step_info: { token: 'qr-token-fixture', status: 1 } } }
  flowKey = 'flow-fixture'
  intercept = undefined
  failCookieRestore = false
})
afterEach(() => { vi.useRealTimers() })

describe('HTTP Feishu developer login and saved sessions', () => {
  it('handles enter_app without observing a scan, using one Cookie Session and a local QR', async () => {
    const { service, store, qrDataUrl } = create()
    const onStatus = vi.fn()
    const onQrReady = vi.fn()
    await login(service, { onStatus, onQrReady })
    expect(onStatus.mock.calls.flat()).toEqual(['loading_local_session', 'preparing', 'awaiting_scan', 'completing_login', 'inspecting_identity'])
    expect(qrDataUrl).toHaveBeenCalledWith(JSON.stringify({ qrlogin: { token: 'qr-token-fixture' } }))
    expect(onQrReady).toHaveBeenCalledWith({ payload: 'data:image/png;base64,fixture', expiresAt: null, waitUntil: expect.any(String) })
    expect(electron.BrowserWindow).not.toHaveBeenCalled()
    expect(electron.sessions).toHaveLength(1)
    const calls = electron.sessions[0].fetch.mock.calls
    expect(calls.map(([url]) => new URL(url).pathname)).toEqual(['/accounts/qrlogin/init', '/accounts/qrlogin/polling', '/cross', '/app', '/app'])
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ biz_type: null, redirect_uri: 'https://open.feishu.cn/app?lang=zh-CN' })
    expect(new Headers(calls[1][1]?.headers).get('x-flow-key')).toBe('flow-fixture')
    expect(calls.every(([, init]) => init?.credentials === 'include')).toBe(true)
    expect(new Headers(calls[2][1]?.headers).has('x-flow-key')).toBe(false)
    expect(store.record).toBeNull()
    expect(service.pendingConnection().identity).toMatchObject({ userId: 'user-1', tenantId: 'tenant-1' })
    await service.activatePendingLogin(store.commit(service.pendingConnection()))
    expect(onStatus).toHaveBeenLastCalledWith('connected')
  })

  it('never regresses after scan confirmation and never overlaps polls', async () => {
    const { service } = create()
    const onStatus = vi.fn()
    let release!: (response: Response) => void
    let first = true
    intercept = (url) => {
      if (first && url.endsWith('/polling')) {
        first = false
        return new Promise((resolve) => { release = resolve })
      }
    }
    polling.push({ next_step: 'qr_login_polling', step_info: { status: 1 } }, complete())
    const promise = service.beginLogin({ onStatus })
    await vi.advanceTimersByTimeAsync(50)
    expect(electron.sessions[0].fetch.mock.calls.filter(([url]) => url.endsWith('/polling'))).toHaveLength(1)
    release(json({ code: 0, data: { next_step: 'qr_login_polling', step_info: { status: 2 } } }))
    await vi.advanceTimersByTimeAsync(25)
    await promise
    expect(onStatus.mock.calls.flat()).toEqual(['loading_local_session', 'preparing', 'awaiting_scan', 'scan_confirmed', 'completing_login', 'inspecting_identity'])
  })

  it.each(['token', 'flowKey', 'business', 'unknownStep', 'interaction', 'identity', 'handoff'])(
    'ends an incomplete or unsupported login explicitly: %s', async (failure) => {
      const { service } = create()
      if (failure === 'token') initialize = { code: 0, data: { step_info: {} } }
      if (failure === 'flowKey') flowKey = null
      if (failure === 'business') initialize = { code: 123, message: 'must not surface remote text' }
      if (failure === 'unknownStep') polling.push({ next_step: 'new_step', step_info: {} })
      if (failure === 'interaction') polling.push({ next_step: 'choose_user', step_info: {} })
      if (failure === 'identity') { portalUser = { id: 'user-1' }; polling.push(complete()) }
      if (failure === 'handoff') polling.push({ next_step: 'enter_app', step_info: { cross_login_uri: {} } })
      const outcome = service.beginLogin().catch((error: Error) => error.message)
      await vi.advanceTimersByTimeAsync(20)
      expect(await outcome).toBe({ token: 'feishu_login_protocol_incomplete', flowKey: 'feishu_login_protocol_incomplete', business: 'feishu_login_server_rejected', unknownStep: 'feishu_login_protocol_unsupported', interaction: 'feishu_login_identity_selection_required', identity: 'feishu_developer_identity_incomplete', handoff: 'feishu_login_protocol_incomplete' }[failure])
      expect(() => service.pendingConnection()).toThrow('feishu_login_pending_session_missing')
      expect(electron.sessions[0].clearStorageData).toHaveBeenCalledTimes(1)
      if (['token', 'flowKey', 'business'].includes(failure)) expect(electron.sessions[0].fetch).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['expired', 'request', 'total'] as const)('distinguishes %s from other termination reasons', async (kind) => {
    const { service } = create(undefined, kind === 'total' ? { requestTimeoutMs: 5000, loginTimeoutMs: 50 } : {})
    if (kind === 'expired') polling.push({ next_step: 'qr_login_polling', step_info: { status: 5 } })
    else intercept = () => new Promise(() => {})
    const outcome = service.beginLogin().catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(1100)
    expect(await outcome).toBe({ expired: 'feishu_login_expired', request: 'feishu_request_timeout', total: 'feishu_login_timeout' }[kind])
    expect(() => service.pendingConnection()).toThrow()
  })

  it('isolates a late init response from a replacement attempt', async () => {
    const { service } = create()
    let release!: (response: Response) => void
    intercept = () => new Promise((resolve) => { release = resolve })
    const oldQr = vi.fn()
    const oldStatus = vi.fn()
    const old = service.beginLogin({ onQrReady: oldQr, onStatus: oldStatus }).catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    intercept = undefined
    await login(service)
    const count = oldStatus.mock.calls.length
    release(json(initialize, { 'x-flow-key': 'obsolete-flow' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(await old).toBe('feishu_login_cancelled')
    expect(oldQr).not.toHaveBeenCalled()
    expect(oldStatus).toHaveBeenCalledTimes(count)
    expect(service.pendingConnection().identity.userId).toBe('user-1')
    expect(electron.sessions[0].clearStorageData).toHaveBeenCalledTimes(1)
    expect(electron.sessions[1].clearStorageData).not.toHaveBeenCalled()
  })

  it('checks the absolute deadline before emitting a QR even when the timer has not run', async () => {
    const { service, qrDataUrl } = create()
    const onQrReady = vi.fn()
    qrDataUrl.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 1001)
      return 'data:image/png;base64,too-late'
    })
    await expect(service.beginLogin({ onQrReady })).rejects.toThrow('feishu_login_timeout')
    expect(onQrReady).not.toHaveBeenCalled()
    expect(() => service.pendingConnection()).toThrow('feishu_login_pending_session_missing')
  })

  it('does not stage a session when cancellation races with cookie capture', async () => {
    const { service } = create()
    const abort = new AbortController()
    let release!: (cookies: never[]) => void
    const promise = service.beginLogin({ signal: abort.signal }).catch((error: Error) => error.message)
    electron.sessions[0].cookies.get.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    polling.push(complete())
    await vi.advanceTimersByTimeAsync(20)
    abort.abort()
    expect(await promise).toBe('feishu_login_cancelled')
    release([])
    await vi.advanceTimersByTimeAsync(0)
    expect(() => service.pendingConnection()).toThrow()
  })

  it.each(['cancel', 'discard', 'activate'] as const)('preserves the old account until activation: %s', async (action) => {
    const { service, store } = await connected()
    const old = electron.sessions[0]
    const abort = new AbortController()
    portalUser = { ...user, id: 'replacement' }
    const promise = service.beginLogin({ signal: abort.signal }).catch((error: Error) => error.message)
    if (action === 'cancel') { abort.abort(); await promise }
    else {
      polling.push(complete())
      await vi.advanceTimersByTimeAsync(20)
      await promise
      expect(old.clearStorageData).not.toHaveBeenCalled()
      if (action === 'discard') await service.discardPendingLogin()
      else await service.activatePendingLogin(store.commit(service.pendingConnection()))
    }
    expect(store.record?.identity.userId).toBe(action === 'activate' ? 'replacement' : 'user-1')
    expect(old.clearStorageData).toHaveBeenCalledTimes(action === 'activate' ? 1 : 0)
    expect(electron.sessions[1].clearStorageData).toHaveBeenCalledTimes(action === 'activate' ? 0 : 1)
  })

  it.each(['navigation', 'identity', 'persistence'] as const)('preserves committed credentials when inspection is unavailable: %s', async (failure) => {
    const { service, store } = await connected()
    const saved = structuredClone(store.record)
    if (failure === 'navigation') portalFailure = 'network'
    if (failure === 'identity') portalUser = {}
    if (failure === 'persistence') vi.spyOn(store, 'replace').mockRejectedValueOnce(new Error('sqlite unavailable'))
    expect(await service.inspect()).toEqual({ status: 'unavailable' })
    expect(store.record).toEqual(saved)
    expect(electron.sessions[0].clearStorageData).not.toHaveBeenCalled()
    portalFailure = null
    portalUser = { user_id: 'user-1', displayName: { value: '重命名' }, tenant_id: 'tenant-1', tenantDisplayName: { value: '团队新名称' } }
    expect(await service.inspect()).toMatchObject({ status: 'valid', identity: { userName: '重命名', tenantName: '团队新名称' } })
  })

  it.each(['expired', 'identity_changed'] as const)('requires positive invalidation evidence: %s', async (reason) => {
    const { service, store } = await connected()
    const saved = structuredClone(store.record)
    if (reason === 'expired') portalFailure = 'expired'
    else portalUser = { ...user, tenantId: 'other' }
    expect(await service.inspect()).toEqual({ status: 'invalid', reason })
    expect(store.record).toEqual(saved)
  })

  it.each(['read', 'cookies'] as const)('can retry local restoration after a %s failure', async (failure) => {
    const { store } = await connected()
    const { service } = create(store)
    if (failure === 'read') vi.spyOn(store, 'read').mockRejectedValueOnce(new Error('storage failure'))
    else failCookieRestore = true
    expect(await service.inspect()).toEqual({ status: 'unavailable' })
    expect(await service.inspect()).toMatchObject({ status: 'valid' })
  })

  it.each(['open.feishu.cn', 'open.larkoffice.com', 'open.larksuite.com'])(
    'uses the final trusted origin for login, restoration and management: %s', async (host) => {
      origin = `https://${host}`
      const { service, store } = await connected()
      expect(store.record?.identity.brand).toBe(host === 'open.larksuite.com' ? 'lark' : 'feishu')
      expect(store.record?.session.portalOrigin).toBe(origin)
      expect(store.record?.session.cookies).toHaveLength(2)
      const restored = create(store).service
      expect(await restored.inspect()).toMatchObject({ status: 'valid' })
      const platform = await restored.openPlatformSession({ expectedIdentity: { userId: 'user-1', tenantId: 'tenant-1' } })
      expect(platform.apiOrigin).toBe(origin)
      await platform.fetch(`${origin}/developers/v1/app/create`, { method: 'POST' })
      const restoredJar = electron.sessions.at(-1)!
      const [, init] = restoredJar.fetch.mock.calls.at(-1)!
      expect(new Headers(init?.headers).get('referer')).toBe(`${origin}/app`)
      expect(new Headers(init?.headers).get('x-csrf-token')).toBe('csrf-fixture')
      expect(restoredJar.cookies.set.mock.calls[0][0]).toMatchObject({ domain: '.larkoffice.com', path: '/app', expirationDate: 9_999_999_999, secure: true, httpOnly: true, sameSite: 'lax' })
      expect(restoredJar.cookies.set.mock.calls[1][0]).not.toHaveProperty('domain')
      await expect(platform.fetch('https://open.feishu.cn.evil.example/developers/v1/app/create')).rejects.toThrow('feishu_session_url_rejected')
      await service.disconnect()
    }
  )

  it('rejects identity drift before management and closes old management clients on account switch', async () => {
    const { service, store } = await connected()
    await expect(service.openPlatformSession({ expectedIdentity: { userId: 'other', tenantId: 'tenant-1' } })).rejects.toThrow('feishu_developer_identity_changed')
    const platform = await service.openPlatformSession({ expectedIdentity: { userId: 'user-1', tenantId: 'tenant-1' } })
    portalUser = { ...user, id: 'replacement' }
    await login(service)
    await service.activatePendingLogin(store.commit(service.pendingConnection()))
    const callCount = electron.sessions[0].fetch.mock.calls.length
    await expect(platform.fetch(`${origin}/developers/v1/app/create`)).rejects.toThrow('feishu_developer_session_replaced')
    expect(electron.sessions[0].fetch).toHaveBeenCalledTimes(callCount)
  })

  it('cancels management bootstrap promptly without losing the connected session', async () => {
    const { service, store } = await connected()
    const saved = structuredClone(store.record)
    intercept = () => new Promise(() => {})
    const abort = new AbortController()
    const outcome = service.openPlatformSession({
      expectedIdentity: { userId: 'user-1', tenantId: 'tenant-1' }, signal: abort.signal
    }).catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    abort.abort()
    expect(await outcome).toBe('feishu_provisioning_cancelled')
    expect(store.record).toEqual(saved)
    expect(electron.sessions[0].clearStorageData).not.toHaveBeenCalled()
  })

  it('discards an inspection that returns after account switching', async () => {
    const { service, store } = await connected()
    let release!: (value: Response) => void
    intercept = () => new Promise((resolve) => { release = resolve })
    const inspecting = service.inspect()
    await vi.advanceTimersByTimeAsync(0)
    intercept = undefined
    portalUser = { ...user, id: 'new-account' }
    await login(service)
    await service.activatePendingLogin(store.commit(service.pendingConnection()))
    release(htmlResponse())
    expect(await inspecting).toEqual({ status: 'unavailable' })
    expect(store.record?.identity.userId).toBe('new-account')
  })
})

class MemoryStore {
  record: { provider: 'feishu'; accountId: string; identity: FeishuDeveloperIdentity; session: StoredFeishuDeveloperSession; revision: number } | null = null
  async read<TIdentity, TSession>() {
    return structuredClone(this.record) as null | { provider: 'feishu'; accountId: string; identity: TIdentity; session: TSession; revision: number }
  }
  async replace(input: { accountId: string; identity: unknown; session: unknown }): Promise<number> {
    const revision = (this.record?.revision ?? 0) + 1
    this.record = { provider: 'feishu', accountId: input.accountId, identity: structuredClone(input.identity) as FeishuDeveloperIdentity, session: structuredClone(input.session) as StoredFeishuDeveloperSession, revision }
    return revision
  }
  commit(pending: PendingFeishuDeveloperConnection): number {
    const revision = (this.record?.revision ?? 0) + 1
    this.record = { provider: 'feishu', accountId: 'account-fixture', identity: structuredClone(pending.identity), session: structuredClone(pending.session), revision }
    return revision
  }
}
