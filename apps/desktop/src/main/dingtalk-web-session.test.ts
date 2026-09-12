import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import QRCode from 'qrcode'
import type { DingTalkLoginFetch } from './dingtalk-login-transport'
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,aW1hZ2U=') } }))
import {
  DingTalkConsoleError, ElectronDingTalkWebSession, parseDingTalkWebIdentity,
  requireDingTalkWebSession, type StoredDingTalkCookie
} from './dingtalk-web-session'

const navigation = vi.hoisted(() => ({
  destination: 'https://open-dev.dingtalk.com/', loadFailure: false, loading: false,
  windows: [] as Array<{ options: Record<string, unknown>; destroyed: boolean }>,
  views: [] as Array<{ options: Record<string, unknown>; setBounds: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn> }>
}))
vi.mock('electron', () => {
  const page = () => {
    let loaded = false
    let closed = false
    return {
      getURL: () => loaded ? navigation.destination : 'about:blank',
      isLoading: () => navigation.loading, isLoadingMainFrame: () => navigation.loading,
      setWindowOpenHandler: vi.fn(), on: vi.fn(), setZoomFactor: vi.fn(), focus: vi.fn(),
      isDestroyed: () => closed, close: vi.fn(() => { closed = true }), reload: vi.fn(),
      loadURL: async () => {
        if (navigation.loadFailure) throw new Error('net unavailable')
        loaded = true
        if (navigation.loading) await new Promise(() => {})
      }
    }
  }
  class Window {
    readonly entry: { options: Record<string, unknown>; destroyed: boolean }
    readonly webContents = page()
    readonly contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
    constructor(options: Record<string, unknown>) {
      this.entry = { options, destroyed: false }
      navigation.windows.push(this.entry)
    }
    setMenuBarVisibility(): void {}
    loadURL(): Promise<void> { return this.webContents.loadURL() }
    once(): this { return this }
    removeListener(): this { return this }
    isDestroyed(): boolean { return this.entry.destroyed }
    destroy(): void { this.entry.destroyed = true }
  }
  return {
    session: { fromPartition: vi.fn() }, BrowserWindow: Window, BaseWindow: Window,
    WebContentsView: class {
      readonly webContents = page()
      readonly setBounds = vi.fn()
      constructor(options: Record<string, unknown>) {
        navigation.views.push({ options, setBounds: this.setBounds, reload: this.webContents.reload })
      }
    }
  }
})

beforeEach(() => {
  navigation.windows = []
  navigation.destination = 'https://open-dev.dingtalk.com/'
  navigation.loadFailure = false
  navigation.loading = false
  navigation.views = []
})
afterEach(() => vi.useRealTimers())

describe('DingTalk console cookie transport', () => {
  it('uses the console cookie and CSRF on a fixed origin, never an OAuth bearer or MCP gateway', async () => {
    const f = fixture()
    f.jar.push(cookie({ name: '_csrf_token_', value: 'csrf-fixture' }))
    expect(await f.web.inspect()).toEqual(identity)
    const [url, options] = f.session.fetch.mock.calls[0]!
    expect(new URL(String(url)).origin).toBe('https://open-dev.dingtalk.com')
    expect(new URL(String(url)).searchParams.get('access_token')).toBe('private-cookie')
    expect(options).toMatchObject({ credentials: 'include', redirect: 'manual' })
    const headers = options!.headers as Headers
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.get('_csrf_token_')).toBe('csrf-fixture')
    expect(navigation.windows).toHaveLength(0)
  })

  it('restores session-cookie flags and host-only scope, without extending persistent expiry', async () => {
    const f = fixture()
    await f.web.restore({ schemaVersion: 2, cookies: [
      cookie({ domain: 'open-dev.dingtalk.com', hostOnly: true }),
      cookie({ name: 'expired', session: false, expirationDate: 1 }),
      cookie({ name: 'persisted', session: false, expirationDate: 4_070_908_800 })
    ] })
    expect(f.session.cookies.set).toHaveBeenCalledTimes(2)
    expect(f.session.cookies.set.mock.calls[0]![0]).toMatchObject({ url: 'https://open-dev.dingtalk.com/', httpOnly: true })
    expect(f.session.cookies.set.mock.calls[0]![0].domain).toBeUndefined()
    expect(f.session.cookies.set.mock.calls[1]![0].expirationDate).toBe(4_070_908_800)
  })

  it('decodes the portal cookie before encoding it once into the API query', async () => {
    const f = fixture()
    f.jar[0]!.value = 'token%2Bvalue%3D'
    await f.web.inspect()
    expect(new URL(String(f.session.fetch.mock.calls[0]![0])).searchParams.get('access_token'))
      .toBe('token+value=')
  })

  it('uploads only a bounded PNG multipart body with the same Main cookie/CSRF boundary', async () => {
    const f = fixture()
    f.jar.push(cookie({ name: '_csrf_token_', value: 'csrf-fixture' }))
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 42])
    f.session.fetch.mockResolvedValueOnce(json({ success: true, data: { logoImg: 'media-1' } }))
    await f.web.request('/microapp/uploadPic/logo.json', { method: 'POST', image })
    const [url, options] = f.session.fetch.mock.calls[0]!
    const headers = options!.headers as Headers
    expect(new URL(String(url)).pathname).toBe('/microapp/uploadPic/logo.json')
    expect(headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/u)
    expect(headers.get('_csrf_token_')).toBe('csrf-fixture')
    const form = await new Request(String(url), options).formData()
    const file = form.get('file') as File
    expect(file.name).toBe('member.png')
    expect(file.type).toBe('image/png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(image)
    expect([...form.keys()]).toEqual(['file'])
  })

  it.each(['wrong_path', 'wrong_method', 'json_body', 'not_png', 'oversized'])('rejects invalid image upload %s', async (kind) => {
    const f = fixture()
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
    await expect(f.web.request(kind === 'wrong_path' ? '/baseInfo' : '/microapp/uploadPic/logo.json', {
      method: kind === 'wrong_method' ? 'GET' : 'POST',
      ...(kind === 'json_body' ? { body: { extra: 'not allowed' } } : {}),
      image: kind === 'not_png' ? new Uint8Array([1]) : kind === 'oversized' ? new Uint8Array(2_097_153) : image
    })).rejects.toThrow('dingtalk_console_request_rejected')
    expect(f.session.fetch).not.toHaveBeenCalled()
  })

  it('retains a successful void console mutation instead of inventing a business failure', async () => {
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(json({ success: true }))
    expect(await f.web.request('/openapp/unifiedapp/u-app/publishVersion', { method: 'POST', body: {} }))
      .toBeUndefined()
    expect(f.session.fetch).toHaveBeenCalledOnce()
  })

  it('snapshots only reviewed DingTalk cookie domains', async () => {
    const f = fixture()
    f.jar.push(cookie({ domain: '.unrelated.example', value: 'unrelated-secret' }))
    f.jar.push(cookie({ name: 'cleared', value: '' }))
    const stored = await f.web.snapshot()
    expect(stored.cookies).toHaveLength(1)
    expect(JSON.stringify(stored)).not.toContain('unrelated-secret')
  })

  it.each([
    { domain: 'dingtalk.com.evil.example' }, { domain: '..dingtalk.com' },
    { path: 'relative' }, { value: 'secret\0injection' }, { httpOnly: 'true' },
    { sameSite: 'anything' }, { expirationDate: -1 }, { extra: 'private-browser-state' }
  ])('rejects an invalid cookie without including its value: %j', (change) => {
    const stored = { schemaVersion: 2, cookies: [{ ...cookie(), ...change }] }
    expect(() => requireDingTalkWebSession(stored)).toThrow('dingtalk_web_session_store_invalid')
  })

  it('rejects duplicate cookie keys and unknown persisted top-level fields', () => {
    expect(() => requireDingTalkWebSession({ schemaVersion: 2, cookies: [cookie(), cookie()] }))
      .toThrow('dingtalk_web_session_store_invalid')
    expect(() => requireDingTalkWebSession({ schemaVersion: 2, cookies: [], refreshToken: 'secret' }))
      .toThrow('dingtalk_web_session_store_invalid')
  })

  it('lets the platform SSO renew a rejected console session in a hidden isolated window', async () => {
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(new Response(null, { status: 302,
      headers: { location: 'https://login.dingtalk.com/oauth2/auth?platform-state=x' } }))
    expect(await f.web.inspect()).toEqual(identity)
    expect(navigation.windows).toHaveLength(1)
    expect(navigation.windows[0]).toMatchObject({ options: { show: false,
      webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, devTools: false } }, destroyed: true })
    expect(f.session.fetch).toHaveBeenCalledTimes(2)
    expect(f.apiSession.cookies.set).toHaveBeenCalled()
    expect(navigation.windows[0]!.options.webPreferences).toMatchObject({ session: f.session })
    await f.web.snapshot()
    expect(f.apiSession.cookies.get).toHaveBeenCalled()
    expect(f.session.clearStorageData).toHaveBeenCalledOnce()
  })

  it('reports an interactive login requirement only after allowing automatic SSO to finish', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    navigation.destination = 'https://login.dingtalk.com/oauth2/challenge.htm'
    const pending = f.web.inspect()
    const assertion = expect(pending).rejects.toThrow('dingtalk_developer_session_expired')
    await vi.advanceTimersByTimeAsync(3_750)
    await assertion
    expect(navigation.windows[0]!.destroyed).toBe(true)
  })

  it('runs API QR, direct authentication, SSO and identity in the same jar without opening a page', async () => {
    const f = fixture()
    const stages: string[] = []
    const qrReady = vi.fn()
    f.session.fetch.mockImplementationOnce(async () => {
      expect(stages.at(-1)).toBe('inspecting_identity')
      return json({ success: true, data: baseInfo })
    })
    expect(await f.web.login({ signal: new AbortController().signal, onStage: stage => stages.push(stage), onQrReady: qrReady }))
      .toEqual(identity)
    expect(stages).toEqual(['preparing', 'awaiting_scan', 'completing_login', 'inspecting_identity'])
    expect(qrReady).toHaveBeenCalledWith({ payload: 'data:image/png;base64,aW1hZ2U=', expiresAt: null })
    expect(QRCode.toDataURL).toHaveBeenCalledWith(qrPayload, expect.objectContaining({ type: 'image/png' }))
    expect(navigation.windows).toHaveLength(0)
    expect(f.apiSession.cookies.set).not.toHaveBeenCalled()
  })

  it('isolates a refreshed generation and suppresses the old late completion', async () => {
    const f = fixture()
    const stages: string[] = []
    let release!: (response: Response) => void
    f.loginFetch.mockImplementationOnce(async () => portalRedirect())
      .mockImplementationOnce(async () => new Response(bootstrap))
      .mockImplementationOnce(async () => json({ success: true, result: qrPayload }))
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const pending = f.web.login({ signal: new AbortController().signal, onStage: stage => stages.push(stage) })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    f.web.refreshLoginQr()
    expect(await pending).toEqual(identity)
    release(json({ success: true, result: { secondaryValidationResult: '' } }))
    await Promise.resolve()
    expect(stages.filter(stage => stage === 'preparing')).toHaveLength(2)
    expect(stages.filter(stage => stage === 'completing_login')).toHaveLength(1)
    expect(f.session.clearStorageData).toHaveBeenCalledOnce()
  })

  it('stops an expired generation until an explicit refresh, without querying or downgrading stages', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const abort = new AbortController()
    const stages: string[] = []
    let polls = 0
    f.loginFetch.mockImplementation(async (url) => {
      if (new URL(url).pathname === '/oauth2/login_with_qr') {
        polls += 1
        return json({ success: false, errorCode: '11019' })
      }
      return loginResponse(url)
    })
    const pending = f.web.login({ signal: abort.signal, onStage: stage => stages.push(stage) })
    const cancelled = expect(pending).rejects.toThrow('dingtalk_operation_cancelled')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(stages.at(-1)).toBe('expired')
    expect(polls).toBe(1)
    abort.abort()
    await cancelled
  })

  it('uses a bounded identity phase and cancels a blocked Cookie read without adopting anything', async () => {
    vi.useFakeTimers()
    const f = fixture({ identity: 100 })
    f.session.cookies.get.mockImplementation(() => new Promise(() => {}))
    const onStage = vi.fn()
    const pending = expect(f.web.login({ signal: new AbortController().signal, onStage }))
      .rejects.toThrow('dingtalk_login_identity_timeout')
    await vi.advanceTimersByTimeAsync(101)
    await pending
    expect(onStage).toHaveBeenLastCalledWith('inspecting_identity')
    expect(f.session.fetch).not.toHaveBeenCalled()
  })

  it('bounds a stuck native page by the independent overall deadline and destroys it', async () => {
    vi.useFakeTimers()
    const f = fixture({ overall: 100 })
    f.loginFetch.mockImplementation(async url => new URL(url).pathname === '/oauth2/login_with_qr'
      ? json({ success: true, result: { chooseOrganization: true } }) : loginResponse(url))
    navigation.destination = challengeUrl
    const stages: string[] = []
    const pending = expect(f.web.login({ signal: new AbortController().signal, onStage: stage => stages.push(stage) }))
      .rejects.toThrow('dingtalk_login_timeout')
    await vi.advanceTimersByTimeAsync(101)
    await pending
    expect(stages.at(-1)).toBe('awaiting_interaction')
    expect(navigation.windows.every(entry => entry.destroyed)).toBe(true)
  })

  it.each(['loading', 'callback'] as const)('waits for native SSO %s before taking a Cookie snapshot', async phase => {
    vi.useFakeTimers()
    const f = fixture({ request: 400, handoff: 500 })
    f.loginFetch.mockImplementation(async url => new URL(url).pathname === '/oauth2/login_with_qr'
      ? json({ success: true, result: { chooseOrganization: true } }) : loginResponse(url))
    navigation.destination = phase === 'callback' ? callbackUrl : 'https://open-dev.dingtalk.com/fe/app'
    navigation.loading = phase === 'loading'
    const failure = phase === 'loading' ? 'dingtalk_login_request_timeout' : 'dingtalk_login_handoff_timeout'
    const pending = expect(f.web.login({ signal: new AbortController().signal })).rejects.toThrow(failure)
    await vi.advanceTimersByTimeAsync(501)
    await pending
    expect(f.session.cookies.get).not.toHaveBeenCalled()
    expect(f.session.fetch).not.toHaveBeenCalled()
    expect(navigation.windows.every(entry => entry.destroyed)).toBe(true)
  })

  it('discards a late identity response after cancellation', async () => {
    const f = fixture()
    const abort = new AbortController()
    f.session.fetch.mockImplementationOnce(async () => {
      abort.abort()
      return json({ success: true, data: baseInfo })
    })
    await expect(f.web.login({ signal: abort.signal })).rejects.toThrow('dingtalk_operation_cancelled')
    expect(f.apiSession.cookies.set).not.toHaveBeenCalled()
  })

  it('does not turn a network failure into expiry or an interactive login', async () => {
    const f = fixture()
    f.session.fetch.mockRejectedValueOnce(new Error('network failed https://host/?access_token=private-cookie'))
    await expect(f.web.inspect()).rejects.toThrow('dingtalk_open_platform_unavailable')
    expect(navigation.windows).toHaveLength(0)
    expect(f.jar).toEqual([cookie()])
  })

  it('keeps a portal load failure distinct from a confirmed login page', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
    navigation.loadFailure = true
    const assertion = expect(f.web.inspect()).rejects.toThrow('dingtalk_open_platform_unavailable')
    await vi.advanceTimersByTimeAsync(1_500)
    await assertion
  })

  it.each([
    ['/baseInfo?token=evil'], ['//evil.example/openapp/create'],
    ['/openapp/../admin/delete'], ['/openapp/%2e%2e/admin/delete'],
    ['/openapp/x#fragment'], ['/admin'], ['https://evil.example/']
  ])('rejects an unreviewed request target %s', async (path) => {
    const f = fixture()
    await expect(f.web.request(path)).rejects.toThrow('dingtalk_console_request_rejected')
    expect(f.session.fetch).not.toHaveBeenCalled()
  })

  it('rejects an attempt to override the session token', async () => {
    const f = fixture()
    await expect(f.web.request('/baseInfo', { query: { access_token: 'other-user' } }))
      .rejects.toThrow('dingtalk_console_request_rejected')
    expect(f.session.fetch).not.toHaveBeenCalled()
  })

  it.each([[400, true], [403, true], [408, false], [429, false], [500, false]])(
    'separates definite HTTP rejection from unknown mutation outcome: %s', async (status, definite) => {
      const f = fixture()
      f.session.fetch.mockResolvedValueOnce(new Response(null, { status: Number(status) }))
      const error = await f.web.request('/openapp/unifiedapp/create', { method: 'POST', body: {} }).catch((error) => error)
      expect(error).toBeInstanceOf(DingTalkConsoleError)
      if (!(error instanceof DingTalkConsoleError)) throw error
      expect(error.definitelyRejected).toBe(definite)
      expect(f.session.fetch).toHaveBeenCalledOnce()
    }
  )

  it('does not replay a mutation after a business-level login expiry response', async () => {
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(json({ success: false, errorCode: 302, data: {} }))
    await expect(f.web.request('/openapp/unifiedapp/create', { method: 'POST', body: {} }))
      .rejects.toThrow('dingtalk_developer_session_expired')
    expect(f.session.fetch).toHaveBeenCalledOnce()
    expect(navigation.windows).toHaveLength(0)
  })

  it('preserves a bounded numeric console rejection code without exposing its message or clearing the session', async () => {
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      success: false, errorCode: 67010, errorMsg: 'private-cookie https://example.test/?secret=value'
    }), { status: 400 }))
    const error = await f.web.request('/openapp/unifiedapp/create', { method: 'POST' }).catch(error => error)
    expect(error).toBeInstanceOf(DingTalkConsoleError)
    if (!(error instanceof DingTalkConsoleError)) throw error
    expect(error.message).toBe('dingtalk_console_error_67010')
    expect(error.definitelyRejected).toBe(true)
    expect(f.session.fetch).toHaveBeenCalledOnce()
    expect(f.session.clearStorageData).not.toHaveBeenCalled()
  })

  it('treats cancellation after dispatch as unknown but cancellation before dispatch as definitely not sent', async () => {
    const f = fixture()
    const abort = new AbortController()
    f.session.fetch.mockImplementationOnce(async () => { abort.abort(); throw new Error('aborted') })
    const after = await f.web.request('/openapp/unifiedapp/create', { method: 'POST', signal: abort.signal }).catch((error) => error)
    if (!(after instanceof DingTalkConsoleError)) throw after
    expect(after.definitelyRejected).toBe(false)
    const before = await f.web.request('/openapp/unifiedapp/create', { method: 'POST', signal: abort.signal }).catch((error) => error)
    if (!(before instanceof DingTalkConsoleError)) throw before
    expect(before.definitelyRejected).toBe(true)
    expect(f.session.fetch).toHaveBeenCalledOnce()
  })

  it.each(['invalid_json', 'oversized'])('rejects %s responses without leaking payload or repeating writes', async (kind) => {
    const f = fixture()
    f.session.fetch.mockResolvedValueOnce(new Response('private-cookie', { headers: {
      ...(kind === 'oversized' ? { 'content-length': '2000001' } : {})
    } }))
    const error = await f.web.request('/openapp/unifiedapp/create', { method: 'POST' }).catch((error) => error)
    if (!(error instanceof DingTalkConsoleError)) throw error
    expect(error.message).not.toContain('private-cookie')
    expect(error.definitelyRejected).toBe(false)
    expect(f.session.fetch).toHaveBeenCalledOnce()
  })

  it('resolves the Owner only from organization staffId, not an SSO UID or display name', () => {
    expect(parseDingTalkWebIdentity(baseInfo)).toEqual(identity)
    for (const candidate of [{ ...baseInfo, staffId: undefined, userId: 'sso-user' },
      { ...baseInfo, staffId: '' }, { ...baseInfo, corpId: undefined }]) {
      expect(() => parseDingTalkWebIdentity(candidate)).toThrow('dingtalk_login_identity_unavailable')
    }
    expect(parseDingTalkWebIdentity({ ...baseInfo, orgName: '  ', corpName: ' 企业 ', nick: '', name: ' 用户 ' }))
      .toEqual({ ...identity, corpName: '企业', userName: '用户' })
    expect(parseDingTalkWebIdentity({ corpId: 'corp-1', staffId: 'staff-1' }))
      .toEqual({ ...identity, corpName: null, userName: null })
  })
})

const identity = { corpId: 'corp-1', corpName: '测试企业', userId: 'staff-1', userName: 'Murray' }
const baseInfo = { corpId: 'corp-1', orgName: '测试企业', staffId: 'staff-1', nick: 'Murray' }
const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function cookie(change: Partial<StoredDingTalkCookie> = {}): StoredDingTalkCookie {
  return { name: 'access_token', value: 'private-cookie', domain: '.dingtalk.com', path: '/',
    httpOnly: true, secure: true, sameSite: 'lax', session: true, ...change }
}
function fixture(timings: Partial<{ identity: number; overall: number; request: number; handoff: number }> = {}) {
  const jar = [cookie()]
  const session = {
    cookies: { get: vi.fn(async () => jar), set: vi.fn(async (_cookie: Record<string, unknown>) => {}) },
    setPermissionRequestHandler: vi.fn(), clearStorageData: vi.fn(async () => {}),
    fetch: vi.fn<typeof fetch>(async () => json({ success: true, data: baseInfo }))
  }
  const apiSession = {
    ...session,
    cookies: { get: vi.fn(async () => jar), set: vi.fn(async (_cookie: Record<string, unknown>) => {}) },
    clearStorageData: vi.fn(async () => {})
  }
  const loginFetch = vi.fn<DingTalkLoginFetch>(async url => loginResponse(url))
  return { jar, session, apiSession, loginFetch, web: new ElectronDingTalkWebSession({
    session: session as unknown as Session, fetch: session.fetch, loginFetch, timings,
    createSession: () => apiSession as unknown as Session
  }) }
}

const callbackUrl = 'https://open-dev.dingtalk.com/dingtalk_sso_call_back?continue=original'
const challengeUrl = `https://login.dingtalk.com/oauth2/challenge.htm?${new URLSearchParams({
  redirect_uri: callbackUrl, client_id: 'portal-client', response_type: 'code', scope: 'openid corpid'
})}`
const bootstrap = '<script>window.__LOGIN_PAGE_VARS = { needLogin: true, exclusiveCorpId: "" };</script>'
const qrPayload = 'https://login.dingtalk.com/oauth2/qr_confirm.htm?code=private-ticket'
const portalRedirect = () => new Response(null, { status: 302, headers: { location: challengeUrl } })
function loginResponse(raw: string): Response {
  const url = new URL(raw)
  if (url.origin === 'https://open-dev.dingtalk.com') return url.pathname === '/' ? portalRedirect() : new Response('console')
  switch (url.pathname) {
    case '/oauth2/challenge.htm': return new Response(bootstrap)
    case '/oauth2/generate_qrcode': return json({ success: true, result: qrPayload })
    case '/oauth2/login_with_qr': return json({ success: true, result: { secondaryValidationResult: '' } })
    case '/oauth2/confirm_auth': return json({ success: true, result: { url: callbackUrl + '&code=private-authorization' } })
    default: throw new Error('Unexpected request')
  }
}
