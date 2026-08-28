import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentUrl = 'about:blank'
let loadUrlCount = 0
let encryptionAvailable = true
let encryptionCheckCount = 0
let portalLoadsAuthenticated = false
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

const temporaryRoots: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.doMock('electron', () => ({
    BrowserWindow: FakeBrowserWindow,
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      isAsyncEncryptionAvailable: async () => {
        encryptionCheckCount += 1
        return encryptionAvailable
      },
      encryptString: (value: string) => Buffer.from(value, 'utf8'),
      encryptStringAsync: async (value: string) => Buffer.from(value, 'utf8'),
      decryptString: (value: Buffer) => value.toString('utf8'),
      decryptStringAsync: async (value: Buffer) => ({
        result: value.toString('utf8'),
        shouldReEncrypt: false
      })
    },
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
  encryptionAvailable = true
  encryptionCheckCount = 0
  portalLoadsAuthenticated = false
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
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Feishu developer session login', () => {
  it('fails before opening the login page when secure storage is unavailable', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    encryptionAvailable = false
    const service = new ElectronFeishuDeveloperSessionService(root)

    const login = service.beginLogin({ forceFresh: true })
    const outcome = login.then(
      () => 'resolved',
      (error: unknown) => error instanceof Error ? error.message : String(error)
    )
    await vi.waitFor(() => {
      expect(encryptionCheckCount + loadUrlCount).toBeGreaterThan(0)
    })

    expect(await outcome).toBe('system_credential_encryption_unavailable')
    expect(loadUrlCount).toBe(0)
    await login.catch(() => undefined)
  })

  it('continues polling when the portal entry navigation is aborted by its login redirect', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const onQrReady = vi.fn()
    const service = new ElectronFeishuDeveloperSessionService(root)

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
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)
    await connectDeveloperSession(service)
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
      userId: 'developer-user-1',
      tenantId: 'tenant-1'
    })
  })

  it('replaces the current developer session only after a fresh login succeeds', async () => {
    isolateSessionPartitions = true
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)
    await connectDeveloperSession(service)
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

    await service.confirmLogin()
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

  it('can roll a successful fresh login back before the account switch is committed', async () => {
    isolateSessionPartitions = true
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)
    await connectDeveloperSession(service)
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

    const restored = await service.rollbackLogin()

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
      userId: 'developer-user-1',
      tenantId: 'tenant-1'
    })
  })

  it('does not leave the UI loading when the portal never exposes a complete identity', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    portalIdentity = {
      id: 'developer-user-1',
      name: 'Murray',
      email: '',
      tenantId: '',
      tenantName: ''
    }
    const abort = new AbortController()
    const service = new ElectronFeishuDeveloperSessionService(root)
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
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)
    await connectDeveloperSession(service)
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
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)
    await connectDeveloperSession(service)
    portalLoadsAuthenticated = true
    portalApiOrigin = 'https://open.feishu.cn.evil.example'

    await expect(service.openPlatformSession({
      expectedIdentity: { userId: 'developer-user-1', tenantId: 'tenant-1' }
    })).rejects.toThrow('feishu_open_platform_origin_rejected')

    expect(browserSession.fetch).not.toHaveBeenCalled()
  })
})

async function connectDeveloperSession(
  service: { beginLogin(): Promise<unknown> }
): Promise<void> {
  const login = service.beginLogin()
  await vi.waitFor(() => expect(currentUrl).toContain('accounts.feishu.cn'))
  currentUrl = 'https://open.feishu.cn/app?lang=zh-CN'
  await vi.advanceTimersByTimeAsync(501)
  await login
}
