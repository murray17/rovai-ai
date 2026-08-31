import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'electron'
import {
  DingTalkConsoleError, ElectronDingTalkWebSession, parseDingTalkWebIdentity,
  requireDingTalkWebSession, type StoredDingTalkCookie
} from './dingtalk-web-session'

const navigation = vi.hoisted(() => ({
  destination: 'https://open-dev.dingtalk.com/', loadFailure: false,
  windows: [] as Array<{ options: Record<string, unknown>; destroyed: boolean }>,
  observation: { kind: 'loading' } as unknown,
  beforeObserve: () => {},
  views: [] as Array<{ options: Record<string, unknown>; setBounds: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn> }>
}))
vi.mock('electron', () => {
  const page = () => {
    let loaded = false
    let closed = false
    return {
      getURL: () => loaded ? navigation.destination : 'about:blank', isLoading: () => false,
      setWindowOpenHandler: vi.fn(), on: vi.fn(), setZoomFactor: vi.fn(), focus: vi.fn(),
      isDestroyed: () => closed, close: vi.fn(() => { closed = true }), reload: vi.fn(),
      mainFrame: { executeJavaScript: vi.fn(async () => { navigation.beforeObserve(); return navigation.observation }) },
      loadURL: async () => {
        if (navigation.loadFailure) throw new Error('net unavailable')
        loaded = true
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
  navigation.views = []
  navigation.observation = { kind: 'loading' }
  navigation.beforeObserve = () => {}
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

  it('promotes a browser-free cookie jar on first login as well as on restart', async () => {
    const f = fixture()
    expect(await f.web.login({ signal: new AbortController().signal })).toEqual(identity)
    expect(navigation.windows[0]!.options.show).toBe(false)
    expect(navigation.views[0]!.options).toMatchObject({ webPreferences: {
      sandbox: true, nodeIntegration: false, contextIsolation: true, devTools: false
    } })
    expect(f.apiSession.cookies.set).toHaveBeenCalledWith(expect.objectContaining({
      name: 'access_token', httpOnly: true, sameSite: 'lax', secure: true
    }))
    f.apiSession.cookies.get.mockClear()
    await f.web.inspect()
    expect(f.apiSession.cookies.get).toHaveBeenCalled()
    expect(f.session.clearStorageData).toHaveBeenCalledOnce()
  })

  it('does not promote a late identity response after login was cancelled', async () => {
    const f = fixture()
    const abort = new AbortController()
    f.session.fetch.mockImplementationOnce(async () => {
      abort.abort()
      return json({ success: true, data: baseInfo })
    })
    await expect(f.web.login({ signal: abort.signal })).rejects.toThrow('dingtalk_operation_cancelled')
    expect(f.session.clearStorageData).not.toHaveBeenCalled()
    expect(f.apiSession.clearStorageData).toHaveBeenCalledTimes(2)
    expect(navigation.windows[0]!.destroyed).toBe(true)
    f.session.cookies.get.mockClear()
    await f.web.snapshot()
    expect(f.session.cookies.get).toHaveBeenCalledOnce()
  })

  it('projects the official QR from a hidden page, deduplicates it and refreshes an expired QR in the same login', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const abort = new AbortController()
    const onQrReady = vi.fn()
    const onStage = vi.fn()
    navigation.destination = 'https://login.dingtalk.com/oauth2/challenge.htm'
    navigation.observation = { kind: 'qr', dataUrl: 'data:image/png;base64,aW1hZ2U=' }
    const login = f.web.login({ signal: abort.signal, onQrReady, onStage })
    const cancelled = expect(login).rejects.toThrow('dingtalk_operation_cancelled')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(onQrReady).toHaveBeenCalledExactlyOnceWith({ payload: 'data:image/png;base64,aW1hZ2U=', expiresAt: null })
    expect(navigation.windows.every((entry) => entry.options.show === false)).toBe(true)
    expect(f.session.fetch).not.toHaveBeenCalled()

    navigation.observation = { kind: 'expired' }
    await vi.advanceTimersByTimeAsync(750)
    expect(onStage).toHaveBeenLastCalledWith('expired')
    f.web.refreshLoginQr()
    expect(navigation.views[0]!.reload).toHaveBeenCalledOnce()
    expect(onStage).toHaveBeenLastCalledWith('preparing')
    navigation.observation = { kind: 'qr', dataUrl: 'data:image/png;base64,bmV3' }
    await vi.advanceTimersByTimeAsync(750)
    expect(onQrReady).toHaveBeenLastCalledWith({ payload: 'data:image/png;base64,bmV3', expiresAt: null })
    abort.abort()
    await vi.advanceTimersByTimeAsync(750)
    await cancelled
    expect(navigation.windows.every((entry) => entry.destroyed)).toBe(true)
    f.web.refreshLoginQr()
    expect(navigation.views[0]!.reload).toHaveBeenCalledOnce()
  })

  it('offers in-app official interaction only after a stable non-QR page, without popping up a window', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const abort = new AbortController()
    const onStage = vi.fn()
    navigation.destination = 'https://login.dingtalk.com/oauth2/challenge.htm'
    navigation.observation = { kind: 'interaction' }
    const login = f.web.login({ signal: abort.signal, onStage })
    const cancelled = expect(login).rejects.toThrow('dingtalk_operation_cancelled')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(onStage).not.toHaveBeenCalledWith('awaiting_interaction')
    await vi.advanceTimersByTimeAsync(1_500)
    expect(onStage).toHaveBeenLastCalledWith('awaiting_interaction')
    expect(navigation.windows.every((entry) => entry.options.show === false)).toBe(true)
    navigation.observation = { kind: 'scanned' }
    await vi.advanceTimersByTimeAsync(750)
    expect(onStage).toHaveBeenLastCalledWith('scan_confirmed')
    abort.abort()
    await vi.advanceTimersByTimeAsync(750)
    await cancelled
  })

  it('drops a late QR observation after cancellation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const abort = new AbortController()
    const onQrReady = vi.fn()
    navigation.destination = 'https://login.dingtalk.com/oauth2/challenge.htm'
    navigation.observation = { kind: 'qr', dataUrl: 'data:image/png;base64,aW1hZ2U=' }
    navigation.beforeObserve = () => abort.abort()
    const login = f.web.login({ signal: abort.signal, onQrReady })
    const cancelled = expect(login).rejects.toThrow('dingtalk_operation_cancelled')
    await vi.advanceTimersByTimeAsync(1_500)
    await cancelled
    expect(onQrReady).not.toHaveBeenCalled()
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
  })
})

const identity = { corpId: 'corp-1', corpName: '测试企业', userId: 'staff-1', userName: 'Murray' }
const baseInfo = { corpId: 'corp-1', orgName: '测试企业', staffId: 'staff-1', nick: 'Murray' }
const json = (value: unknown): Response => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
function cookie(change: Partial<StoredDingTalkCookie> = {}): StoredDingTalkCookie {
  return { name: 'access_token', value: 'private-cookie', domain: '.dingtalk.com', path: '/',
    httpOnly: true, secure: true, sameSite: 'lax', session: true, ...change }
}
function fixture() {
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
  return { jar, session, apiSession, web: new ElectronDingTalkWebSession({
    session: session as unknown as Session, fetch: session.fetch,
    createSession: () => apiSession as unknown as Session
  }) }
}
