import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentUrl = 'about:blank'
let loadUrlCount = 0
let encryptionAvailable = true
let encryptionCheckCount = 0
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
    if (url.startsWith('https://open.feishu.cn/page/cli?')) {
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

const browserSession = {
  clearStorageData: vi.fn(async () => undefined),
  cookies: {
    get: vi.fn(async () => []),
    set: vi.fn(async () => undefined)
  }
}

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
      fromPartition: () => browserSession
    }
  }))
  currentUrl = 'about:blank'
  loadUrlCount = 0
  encryptionAvailable = true
  encryptionCheckCount = 0
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
})

afterEach(() => {
  vi.useRealTimers()
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Feishu developer session login', () => {
  it('opens the official Feishu CLI app-registration confirmation page', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)

    const page = await service.showRegistrationConfirmation({
      url: 'https://open.feishu.cn/page/cli?user_code=public-fixture'
    })

    expect(currentUrl).toBe('https://open.feishu.cn/page/cli?user_code=public-fixture')
    page.close()
    await expect(page.closed).resolves.toBe('closed')
  })

  it('rejects a lookalike app-registration confirmation origin before navigation', async () => {
    const { ElectronFeishuDeveloperSessionService } = await import('./feishu-developer-session')
    const root = mkdtempSync(join(tmpdir(), 'rovai-feishu-session-'))
    temporaryRoots.push(root)
    const service = new ElectronFeishuDeveloperSessionService(root)

    await expect(service.showRegistrationConfirmation({
      url: 'https://open.feishu.cn.evil.example/page/cli?user_code=public-fixture'
    })).rejects.toThrow('feishu_registration_url_rejected')

    expect(loadUrlCount).toBe(0)
  })

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
})
