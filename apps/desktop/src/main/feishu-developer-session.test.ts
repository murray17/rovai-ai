import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FeishuDeveloperIdentity,
  PendingFeishuDeveloperConnection,
  StoredFeishuDeveloperSession
} from './feishu-developer-session'

let currentUrl = 'about:blank'
let loadUrlCount = 0
let portalLoadsAuthenticated = false
let portalLoadError: Error | null = null
let portalApiOrigin = 'https://open.feishu.cn'
let portalIdentity: Record<string, string> = {
  id: 'developer-user-1',
  name: 'Murray',
  email: 'murray@example.com',
  tenantId: 'tenant-1',
  tenantName: '星海科技'
}

class FakeWebContents extends EventEmitter {
  isDestroyed(): boolean {
    return false
  }

  getURL(): string {
    return currentUrl
  }

  setWindowOpenHandler(): void {}

  async executeJavaScript(source: string): Promise<unknown> {
    if (source.includes('window.csrfToken')) {
      return {
        csrfToken: 'csrf-fixture',
        apiOrigin: portalApiOrigin,
        userId: portalIdentity.id,
        tenantId: portalIdentity.tenantId
      }
    }
    if (source.includes('window.user')) {
      return portalIdentity
    }
    if (source.includes('querySelector')) {
      return { x: 10, y: 10, width: 240, height: 240 }
    }
    return ''
  }

  async capturePage(): Promise<{ toDataURL(): string }> {
    return { toDataURL: () => 'data:image/png;base64,qr' }
  }
}

class FakeBrowserWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  #destroyed = false

  async loadURL(url: string): Promise<void> {
    loadUrlCount += 1
    if (portalLoadError) {
      currentUrl = url
      throw portalLoadError
    }
    if (
      url.startsWith('https://open.feishu.cn/page/cli?')
      || url.startsWith('https://open.feishu.cn/page/launcher?')
    ) {
      currentUrl = url
      return
    }
    if (portalLoadsAuthenticated && url.startsWith('https://open.feishu.cn/app')) {
      currentUrl = url
      return
    }
    currentUrl = 'https://accounts.feishu.cn/accounts/page/login?app_id=7'
    const error = Object.assign(new Error('ERR_ABORTED (-3) loading login redirect'), {
      code: 'ERR_ABORTED',
      errno: -3
    })
    throw error
  }

  isDestroyed(): boolean {
    return this.#destroyed
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.emit('closed')
  }

  show(): void {}
}

function fakeBrowserSession() {
  return {
    clearStorageData: vi.fn(async () => undefined),
    cookies: {
      get: vi.fn(async () => [{
        name: 'session',
        value: 'private-cookie-fixture',
        domain: '.feishu.cn',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        session: true
      }]),
      set: vi.fn(async () => undefined)
    },
    fetch: vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
  }
}

const browserSession = fakeBrowserSession()
const partitionSessions = new Map<string, ReturnType<typeof fakeBrowserSession>>()
let isolateSessionPartitions = false

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.doMock('electron', () => ({
    BrowserWindow: FakeBrowserWindow,
    session: {
      fromPartition: (partition: string) => {
        if (!isolateSessionPartitions) return browserSession
        const existing = partitionSessions.get(partition)
        if (existing) return existing
        const created = fakeBrowserSession()
        partitionSessions.set(partition, created)
        return created
      }
    }
  }))
  currentUrl = 'about:blank'
  loadUrlCount = 0
  portalLoadsAuthenticated = false
  portalLoadError = null
  portalApiOrigin = 'https://open.feishu.cn'
  isolateSessionPartitions = false
  partitionSessions.clear()
  portalIdentity = {
    id: 'developer-user-1',
    name: 'Murray',
    email: 'murray@example.com',
    tenantId: 'tenant-1',
    tenantName: '星海科技'
  }
  browserSession.clearStorageData.mockClear()
  browserSession.cookies.get.mockClear()
  browserSession.cookies.set.mockClear()
  browserSession.fetch.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Feishu developer session login', () => {
  it.each(['navigation', 'identity', 'persistence'] as const)(
    'retains the committed session when inspection is temporarily unavailable: %s',
    async (failure) => {
      const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
      const store = new MemoryStore()
      const service = new ElectronFeishuDeveloperSessionService(store)
      await connectDeveloperSession(service, store)
      const committed = structuredClone(store.record)
      portalLoadsAuthenticated = true
      if (failure === 'navigation') portalLoadError = new Error('ERR_INTERNET_DISCONNECTED')
      if (failure === 'identity') portalIdentity = {}
      if (failure === 'persistence') {
        vi.spyOn(store, 'replace').mockRejectedValueOnce(new Error('sqlite_fixture_unavailable'))
      }

      await expect(service.inspect()).resolves.toMatchObject({ status: 'unavailable' })
      expect(store.record).toEqual(committed)
      expect(browserSession.clearStorageData).not.toHaveBeenCalled()

      portalLoadError = null
      portalIdentity = {
        id: 'developer-user-1', name: 'Murray', tenantId: 'tenant-1', tenantName: '星海科技'
      }
      await expect(service.inspect()).resolves.toMatchObject({
        status: 'valid', identity: { userId: 'developer-user-1', tenantId: 'tenant-1' }
      })
    }
  )

  it.each(['expired', 'identity_changed'] as const)(
    'requires positive invalidation evidence: %s',
    async (reason) => {
      const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
      const store = new MemoryStore()
      const service = new ElectronFeishuDeveloperSessionService(store)
      await connectDeveloperSession(service, store)
      const committed = structuredClone(store.record)
      if (reason === 'identity_changed') {
        portalLoadsAuthenticated = true
        portalIdentity = { ...portalIdentity, id: 'different-user' }
      }

      await expect(service.inspect()).resolves.toEqual({ status: 'invalid', reason })
      expect(store.record).toEqual(committed)
    }
  )

  it.each(['read', 'cookies'] as const)(
    'can retry a failed local session restoration without logging in again: %s',
    async (failure) => {
      const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
      const store = new MemoryStore()
      await connectDeveloperSession(new ElectronFeishuDeveloperSessionService(store), store)
      const committed = structuredClone(store.record)
      const service = new ElectronFeishuDeveloperSessionService(store)
      portalLoadsAuthenticated = true
      if (failure === 'read') vi.spyOn(store, 'read').mockRejectedValueOnce(new Error('sqlite_fixture_unavailable'))
      else browserSession.cookies.set.mockRejectedValueOnce(new Error('cookie_store_fixture_unavailable'))

      await expect(service.inspect()).resolves.toEqual({ status: 'unavailable' })
      expect(store.record).toEqual(committed)
      await expect(service.inspect()).resolves.toMatchObject({ status: 'valid' })
    }
  )

  it('discards an inspection that finishes after a successful account switch', async () => {
    isolateSessionPartitions = true
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)
    await connectDeveloperSession(service, store)
    let finishNavigation!: () => void
    const navigation = new Promise<void>((resolve) => { finishNavigation = resolve })
    const load = vi.spyOn(FakeBrowserWindow.prototype, 'loadURL').mockImplementationOnce(() => navigation)
    const replace = vi.spyOn(store, 'replace')
    const inspecting = service.inspect()
    try {
      await vi.waitFor(() => expect(load).toHaveBeenCalled())
      portalLoadsAuthenticated = true
      portalIdentity = { ...portalIdentity, id: 'replacement-user' }
      await service.beginLogin({ forceFresh: true })
      await service.activatePendingLogin(store.commit(service.pendingConnection()))
      finishNavigation()

      await expect(inspecting).resolves.toEqual({ status: 'unavailable' })
      expect(store.record?.identity.userId).toBe('replacement-user')
      expect(replace).not.toHaveBeenCalled()
    } finally {
      finishNavigation()
      await inspecting
      load.mockRestore()
    }
  })

  it('starts without consulting operating-system credential storage', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)

    const login = service.beginLogin({ forceFresh: true })
    await vi.waitFor(() => expect(currentUrl).toContain('accounts.feishu.cn'))

    expect(loadUrlCount).toBeGreaterThan(0)
    service.disconnect()
    await login.catch(() => undefined)
  })

  it('continues polling when the portal entry navigation is aborted by its login redirect', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const onQrReady = vi.fn()
    const service = new ElectronFeishuDeveloperSessionService(new MemoryStore())

    const login = service.beginLogin({ forceFresh: true, onQrReady })
    const earlyOutcome = login.then(() => 'resolved', () => 'rejected')
    await vi.waitFor(() => expect(currentUrl).toContain('accounts.feishu.cn'))
    await vi.advanceTimersByTimeAsync(501)

    expect(onQrReady).toHaveBeenCalledWith(expect.objectContaining({
      payload: 'data:image/png;base64,qr'
    }))
    expect(await Promise.race([
      earlyOutcome,
      Promise.resolve('pending')
    ])).toBe('pending')

    currentUrl = 'https://open.feishu.cn/app?lang=zh-CN'
    await vi.advanceTimersByTimeAsync(501)

    await expect(login).resolves.toEqual({
      brand: 'feishu',
      userId: 'developer-user-1',
      userName: 'Murray',
      email: 'murray@example.com',
      tenantId: 'tenant-1',
      tenantName: '星海科技'
    })
  })

  it('keeps the current developer session when a fresh account switch is cancelled', async () => {
    isolateSessionPartitions = true
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)
    await connectDeveloperSession(service, store)
    const [currentSession] = [...partitionSessions.values()]
    const abort = new AbortController()

    const switching = service.beginLogin({ forceFresh: true, signal: abort.signal })
    await vi.waitFor(() => expect(partitionSessions.size).toBe(2))
    const replacementSession = [...partitionSessions.values()][1]
    abort.abort()

    await expect(switching).rejects.toThrow('feishu_login_cancelled')
    expect(currentSession?.clearStorageData).not.toHaveBeenCalled()
    expect(replacementSession?.clearStorageData).toHaveBeenCalledTimes(1)

    portalLoadsAuthenticated = true
    await expect(service.inspect()).resolves.toMatchObject({
      status: 'valid',
      identity: { userId: 'developer-user-1', tenantId: 'tenant-1' }
    })
  })

  it('replaces the current developer session only after a fresh login succeeds', async () => {
    isolateSessionPartitions = true
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)
    await connectDeveloperSession(service, store)
    const [currentSession] = [...partitionSessions.values()]

    const switching = service.beginLogin({ forceFresh: true })
    await vi.waitFor(() => expect(partitionSessions.size).toBe(2))
    const replacementSession = [...partitionSessions.values()][1]
    portalIdentity = {
      id: 'developer-user-2',
      name: 'Ada',
      email: 'ada@example.com',
      tenantId: 'tenant-2',
      tenantName: '新企业'
    }
    currentUrl = 'https://open.feishu.cn/app?lang=zh-CN'
    await vi.advanceTimersByTimeAsync(501)

    await expect(switching).resolves.toMatchObject({
      userId: 'developer-user-2',
      tenantId: 'tenant-2'
    })
    expect(currentSession?.clearStorageData).not.toHaveBeenCalled()
    expect(replacementSession?.clearStorageData).not.toHaveBeenCalled()

    await service.activatePendingLogin(store.commit(service.pendingConnection()))
    expect(currentSession?.clearStorageData).toHaveBeenCalledTimes(1)
    expect(replacementSession?.clearStorageData).not.toHaveBeenCalled()

    portalLoadsAuthenticated = true
    const platform = await service.openPlatformSession({
      expectedIdentity: { userId: 'developer-user-2', tenantId: 'tenant-2' }
    })
    await platform.fetch('https://open.feishu.cn/developers/v1/app/create')
    expect(replacementSession?.fetch).toHaveBeenCalledTimes(1)
    expect(currentSession?.fetch).not.toHaveBeenCalled()
  })

  it('can discard a successful fresh login before the account switch is committed', async () => {
    isolateSessionPartitions = true
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)
    await connectDeveloperSession(service, store)
    const [currentSession] = [...partitionSessions.values()]

    const switching = service.beginLogin({ forceFresh: true })
    await vi.waitFor(() => expect(partitionSessions.size).toBe(2))
    const replacementSession = [...partitionSessions.values()][1]
    portalIdentity = {
      id: 'developer-user-2',
      name: 'Ada',
      email: 'ada@example.com',
      tenantId: 'tenant-2',
      tenantName: '新企业'
    }
    currentUrl = 'https://open.feishu.cn/app?lang=zh-CN'
    await vi.advanceTimersByTimeAsync(501)
    await switching

    const restored = await service.discardPendingLogin()

    expect(restored).toMatchObject({ userId: 'developer-user-1', tenantId: 'tenant-1' })
    expect(currentSession?.clearStorageData).not.toHaveBeenCalled()
    expect(replacementSession?.clearStorageData).toHaveBeenCalledTimes(1)
    portalIdentity = {
      id: 'developer-user-1',
      name: 'Murray',
      email: 'murray@example.com',
      tenantId: 'tenant-1',
      tenantName: '星海科技'
    }
    portalLoadsAuthenticated = true
    await expect(service.inspect()).resolves.toMatchObject({
      status: 'valid',
      identity: { userId: 'developer-user-1', tenantId: 'tenant-1' }
    })
  })

  it('does not leave the UI loading when the portal never exposes a complete identity', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    portalIdentity = {
      id: 'developer-user-1',
      name: 'Murray',
      email: '',
      tenantId: '',
      tenantName: ''
    }
    const abort = new AbortController()
    const service = new ElectronFeishuDeveloperSessionService(new MemoryStore())
    const login = service.beginLogin({ forceFresh: true, signal: abort.signal })
    const outcome = login.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error ? error.message : String(error)
    )
    try {
      await vi.waitFor(() => expect(currentUrl).toContain('accounts.feishu.cn'))
      currentUrl = 'https://open.feishu.cn/app?lang=zh-CN'
      await vi.advanceTimersByTimeAsync(20_501)
      expect(await outcome).toBe('feishu_developer_identity_incomplete')
    } finally {
      abort.abort()
      await login.catch(() => undefined)
    }
  })

  it('bootstraps CSRF and console fetch from the authenticated Electron Session without exposing cookies', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)
    await connectDeveloperSession(service, store)
    portalLoadsAuthenticated = true

    const platform = await service.openPlatformSession({
      expectedIdentity: { userId: 'developer-user-1', tenantId: 'tenant-1' }
    })
    await platform.fetch('https://open.feishu.cn/developers/v1/app/create', {
      method: 'POST'
    })

    expect(platform).toMatchObject({
      brand: 'feishu',
      apiOrigin: 'https://open.feishu.cn',
      csrfToken: 'csrf-fixture'
    })
    expect(browserSession.cookies.get).toHaveBeenCalledWith({
      url: 'https://open.feishu.cn/app?lang=zh-CN'
    })
    expect(browserSession.fetch).toHaveBeenCalledWith(
      'https://open.feishu.cn/developers/v1/app/create',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    )
    expect(JSON.stringify(browserSession.fetch.mock.calls)).not.toContain('private-cookie-fixture')
  })

  it('rejects a console api origin that does not match the signed-in brand', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const store = new MemoryStore()
    const service = new ElectronFeishuDeveloperSessionService(store)
    await connectDeveloperSession(service, store)
    portalLoadsAuthenticated = true
    portalApiOrigin = 'https://open.feishu.cn.evil.example'

    await expect(service.openPlatformSession({
      expectedIdentity: { userId: 'developer-user-1', tenantId: 'tenant-1' }
    })).rejects.toThrow('feishu_open_platform_origin_rejected')

    expect(browserSession.fetch).not.toHaveBeenCalled()
  })
})

async function connectDeveloperSession(
  service: InstanceType<typeof import('./feishu-developer-session')['ElectronFeishuDeveloperSessionService']>,
  store: MemoryStore
): Promise<void> {
  const login = service.beginLogin()
  await vi.waitFor(() => expect(currentUrl).toContain('accounts.feishu.cn'))
  currentUrl = 'https://open.feishu.cn/app?lang=zh-CN'
  await vi.advanceTimersByTimeAsync(501)
  await login
  await service.activatePendingLogin(store.commit(service.pendingConnection()))
}

class MemoryStore {
  record: {
    provider: 'feishu'
    accountId: string
    identity: FeishuDeveloperIdentity
    session: StoredFeishuDeveloperSession
    revision: number
  } | null = null

  async read<TIdentity, TSession>(): Promise<{
    provider: 'feishu'
    accountId: string
    identity: TIdentity
    session: TSession
    revision: number
  } | null> {
    return this.record ? structuredClone(this.record) as unknown as {
      provider: 'feishu'
      accountId: string
      identity: TIdentity
      session: TSession
      revision: number
    } : null
  }

  async replace(input: {
    accountId: string
    identity: unknown
    session: unknown
  }): Promise<number> {
    const revision = (this.record?.revision ?? 0) + 1
    this.record = {
      provider: 'feishu',
      accountId: input.accountId,
      identity: structuredClone(input.identity) as FeishuDeveloperIdentity,
      session: structuredClone(input.session) as StoredFeishuDeveloperSession,
      revision
    }
    return revision
  }

  commit(pending: PendingFeishuDeveloperConnection): number {
    const revision = (this.record?.revision ?? 0) + 1
    this.record = {
      provider: 'feishu', accountId: 'account-fixture',
      identity: structuredClone(pending.identity),
      session: structuredClone(pending.session), revision
    }
    return revision
  }
}
