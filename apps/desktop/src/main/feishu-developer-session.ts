import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  BrowserWindow,
  safeStorage,
  session as electronSession,
  type Cookie,
  type Session
} from 'electron'

export type FeishuLoginStage =
  | 'checking_secure_storage'
  | 'preparing'
  | 'awaiting_scan'
  | 'scan_confirmed'
  | 'inspecting_identity'
  | 'securing_session'
  | 'connected'
  | 'expired'
  | 'cancelled'
  | 'failed'

export interface FeishuDeveloperIdentity {
  brand: 'feishu' | 'lark'
  userId: string
  userName: string
  email?: string
  tenantId: string
  tenantName: string
}

export interface FeishuDeveloperSessionService {
  beginLogin(options?: {
    forceFresh?: boolean
    signal?: AbortSignal
    onQrReady?(qr: { payload: string; expiresAt: string }): void
    onStatus?(status: FeishuLoginStage): void
  }): Promise<FeishuDeveloperIdentity>
  inspect(): Promise<FeishuDeveloperIdentity | null>
  requireExpectedIdentity(expected: {
    userId: string
    tenantId: string
  }): Promise<FeishuDeveloperIdentity>
  disconnect(): Promise<void>
}

export interface FeishuOpenPlatformSession {
  brand: 'feishu' | 'lark'
  apiOrigin: string
  csrfToken: string
  fetch(input: string, init?: RequestInit): Promise<Response>
}

export interface FeishuDeveloperPortalSession extends FeishuDeveloperSessionService {
  openPlatformSession(input: {
    expectedIdentity: {
      userId: string
      tenantId: string
    }
    signal?: AbortSignal
  }): Promise<FeishuOpenPlatformSession>
  persist(): Promise<void>
}

type StoredCookie = Pick<
Cookie,
  'name' | 'value' | 'secure' | 'httpOnly' | 'sameSite' | 'session'
> & { domain: string; path: string; expirationDate?: number }

type StoredDeveloperSession = {
  schemaVersion: 1
  identity: FeishuDeveloperIdentity
  cookies: StoredCookie[]
}

type PortalIdentity = Partial<{
  id: string
  name: string
  email: string
  tenantId: string
  tenantName: string
}>

type OpenPlatformBootstrap = Partial<{
  csrfToken: string
  apiOrigin: string
  userId: string
  tenantId: string
}>

const FEISHU_PORTAL_URL = 'https://open.feishu.cn/app?lang=zh-CN'
const SESSION_PARTITION = `rovai-feishu-developer-${randomUUID()}`
const LOGIN_TIMEOUT_MS = 10 * 60_000
const LOGIN_POLL_MS = 500
const IDENTITY_INSPECTION_TIMEOUT_MS = 20_000
const SAFE_STORAGE_OPERATION_TIMEOUT_MS = 15_000

export class ElectronFeishuDeveloperSessionService implements FeishuDeveloperPortalSession {
  #browserSession: Session | null = null
  readonly #store: SafeStorageFeishuDeveloperSessionStore
  readonly #getParentWindow: () => BrowserWindow | null
  #restored = false
  #activeLoginWindow: BrowserWindow | null = null
  #activeOpenPlatformWindows = new Set<BrowserWindow>()

  constructor(userDataPath: string, getParentWindow: () => BrowserWindow | null = () => null) {
    this.#store = new SafeStorageFeishuDeveloperSessionStore(userDataPath)
    this.#getParentWindow = getParentWindow
  }

  async beginLogin(options: {
    forceFresh?: boolean
    signal?: AbortSignal
    onQrReady?(qr: { payload: string; expiresAt: string }): void
    onStatus?(status: FeishuLoginStage): void
  } = {}): Promise<FeishuDeveloperIdentity> {
    this.#closeActiveLogin()
    options.onStatus?.('checking_secure_storage')
    await this.#store.requireAvailable()
    await this.#ensureRestored()
    if (options.forceFresh) {
      await this.#session.clearStorageData()
      await this.#store.delete()
    }
    if (options.signal?.aborted) throw sessionError('feishu_login_cancelled')

    options.onStatus?.('preparing')
    const window = this.#createWindow(false)
    this.#activeLoginWindow = window
    let terminal = false
    let lastQrDataUrl = ''
    let lastStage: FeishuLoginStage = 'preparing'

    const emitStage = (stage: FeishuLoginStage): void => {
      if (stage === lastStage) return
      lastStage = stage
      options.onStatus?.(stage)
    }

    try {
      return await new Promise<FeishuDeveloperIdentity>((resolve, reject) => {
        const startedAt = Date.now()
        let identityInspectionStartedAt: number | null = null
        let pollTimer: ReturnType<typeof setInterval> | null = null
        let pollInProgress = false

        const cleanup = (): void => {
          if (pollTimer) clearInterval(pollTimer)
          pollTimer = null
          options.signal?.removeEventListener('abort', onAbort)
        }
        const finish = (result: FeishuDeveloperIdentity | Error): void => {
          if (terminal) return
          terminal = true
          cleanup()
          if (result instanceof Error) reject(result)
          else resolve(result)
        }
        const onAbort = (): void => {
          emitStage('cancelled')
          finish(sessionError('feishu_login_cancelled'))
        }
        options.signal?.addEventListener('abort', onAbort, { once: true })
        window.once('closed', () => {
          if (!terminal) onAbort()
        })

        const poll = async (): Promise<void> => {
          if (
            terminal
            || pollInProgress
            || window.isDestroyed()
            || window.webContents.isDestroyed()
          ) return
          pollInProgress = true
          try {
            if (Date.now() - startedAt >= LOGIN_TIMEOUT_MS) {
              emitStage('expired')
              finish(sessionError('feishu_login_expired'))
              return
            }
            const currentUrl = window.webContents.getURL()
            if (isDeveloperPortalUrl(currentUrl)) {
              emitStage('inspecting_identity')
              identityInspectionStartedAt ??= Date.now()
              const identity = await readDeveloperIdentity(window, currentUrl)
              if (!identity) {
                if (Date.now() - identityInspectionStartedAt >= IDENTITY_INSPECTION_TIMEOUT_MS) {
                  emitStage('failed')
                  finish(sessionError('feishu_developer_identity_incomplete'))
                }
                return
              }
              emitStage('securing_session')
              await this.#persist(identity)
              emitStage('connected')
              finish(identity)
              return
            }
            identityInspectionStartedAt = null
            if (!isFeishuLoginUrl(currentUrl)) return
            const pageText = await window.webContents.executeJavaScript(
              'document.body?.innerText?.slice(0, 4000) ?? ""',
              true
            ) as string
            if (/scanned successfully|扫码成功|扫描成功/i.test(pageText)) {
              emitStage('scan_confirmed')
            }
            const bounds = await qrCanvasBounds(window)
            if (!bounds) return
            const image = await window.webContents.capturePage(bounds)
            const qrDataUrl = image.toDataURL()
            if (!qrDataUrl || qrDataUrl === lastQrDataUrl) return
            lastQrDataUrl = qrDataUrl
            emitStage('awaiting_scan')
            options.onQrReady?.({
              payload: qrDataUrl,
              expiresAt: new Date(startedAt + LOGIN_TIMEOUT_MS).toISOString()
            })
          } catch (error) {
            emitStage('failed')
            finish(normalizeSessionError(error, 'feishu_login_failed'))
          } finally {
            pollInProgress = false
          }
        }

        pollTimer = setInterval(() => void poll(), LOGIN_POLL_MS)
        pollTimer.unref?.()
        void window.loadURL(FEISHU_PORTAL_URL)
          .then(() => poll())
          .catch((error) => {
            if (isExpectedPortalRedirectAbort(error, window)) return
            finish(normalizeSessionError(error, 'feishu_login_failed'))
          })
      })
    } finally {
      if (this.#activeLoginWindow === window) this.#activeLoginWindow = null
      if (!window.isDestroyed()) window.destroy()
    }
  }

  async inspect(): Promise<FeishuDeveloperIdentity | null> {
    await this.#ensureRestored()
    const stored = await this.#store.read()
    if (!stored) return null
    const window = this.#createWindow(false)
    try {
      await window.loadURL(portalUrlForBrand(stored.identity.brand))
      const currentUrl = window.webContents.getURL()
      if (!isDeveloperPortalUrl(currentUrl)) return null
      const identity = await readDeveloperIdentity(window, currentUrl)
      if (!identity) return null
      await this.#persist(identity)
      return identity
    } catch {
      return null
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }

  async requireExpectedIdentity(expected: {
    userId: string
    tenantId: string
  }): Promise<FeishuDeveloperIdentity> {
    const identity = await this.inspect()
    if (!identity) throw sessionError('feishu_developer_session_expired')
    if (identity.userId !== expected.userId || identity.tenantId !== expected.tenantId) {
      throw sessionError('feishu_developer_identity_changed')
    }
    return identity
  }

  async disconnect(): Promise<void> {
    this.#closeActiveLogin()
    for (const window of this.#activeOpenPlatformWindows) {
      if (!window.isDestroyed()) window.destroy()
    }
    this.#activeOpenPlatformWindows.clear()
    await this.#session.clearStorageData()
    await this.#store.delete()
    this.#restored = true
  }

  async openPlatformSession(input: {
    expectedIdentity: {
      userId: string
      tenantId: string
    }
    signal?: AbortSignal
  }): Promise<FeishuOpenPlatformSession> {
    await this.#ensureRestored()
    if (input.signal?.aborted) throw sessionError('feishu_provisioning_cancelled')
    const stored = await this.#store.read()
    if (!stored) throw sessionError('feishu_developer_session_expired')
    const portalUrl = portalUrlForBrand(stored.identity.brand)
    const cookies = await this.#session.cookies.get({ url: portalUrl })
    if (cookies.length === 0) throw sessionError('feishu_developer_session_expired')

    const window = this.#createWindow(false)
    this.#activeOpenPlatformWindows.add(window)
    const onAbort = (): void => {
      if (!window.isDestroyed()) window.destroy()
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await window.loadURL(portalUrl)
      if (input.signal?.aborted) throw sessionError('feishu_provisioning_cancelled')
      const currentUrl = window.webContents.getURL()
      if (!isDeveloperPortalUrl(currentUrl)) {
        throw sessionError('feishu_developer_session_expired')
      }
      const bootstrap = await readOpenPlatformBootstrap(window)
      const csrfToken = normalizedRequired(bootstrap.csrfToken)
      const userId = normalizedRequired(bootstrap.userId)
      const tenantId = normalizedRequired(bootstrap.tenantId)
      if (!csrfToken || !userId || !tenantId) {
        throw sessionError('feishu_open_platform_bootstrap_incomplete')
      }
      if (
        userId !== input.expectedIdentity.userId
        || tenantId !== input.expectedIdentity.tenantId
      ) throw sessionError('feishu_developer_identity_changed')
      const apiOrigin = requireOpenPlatformOrigin(bootstrap.apiOrigin, stored.identity.brand)
      return {
        brand: stored.identity.brand,
        apiOrigin,
        csrfToken,
        fetch: async (rawUrl, init = {}) => {
          const url = requireOpenPlatformApiUrl(rawUrl, apiOrigin)
          return this.#session.fetch(url, {
            ...init,
            credentials: 'include'
          })
        }
      }
    } catch (error) {
      if (input.signal?.aborted) throw sessionError('feishu_provisioning_cancelled')
      if (
        !window.isDestroyed()
        && !window.webContents.isDestroyed()
        && isFeishuLoginUrl(window.webContents.getURL())
      ) throw sessionError('feishu_developer_session_expired')
      throw error
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
      this.#activeOpenPlatformWindows.delete(window)
      if (!window.isDestroyed()) window.destroy()
    }
  }

  async persist(): Promise<void> {
    const stored = await this.#store.read()
    if (!stored) return
    await this.#persist(stored.identity)
  }

  #createWindow(show: boolean, parent: BrowserWindow | null = null): BrowserWindow {
    const window = new BrowserWindow({
      show,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: show && Boolean(parent && !parent.isDestroyed()),
      width: 760,
      height: 780,
      minWidth: 560,
      minHeight: 620,
      title: 'Rovai · 飞书开放平台',
      autoHideMenuBar: true,
      webPreferences: {
        session: this.#session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!isAllowedFeishuTopLevelUrl(url)) event.preventDefault()
    })
    return window
  }

  async #ensureRestored(): Promise<void> {
    if (this.#restored) return
    this.#restored = true
    const stored = await this.#store.read()
    if (!stored) return
    for (const cookie of stored.cookies) {
      try {
        await this.#session.cookies.set({
          url: cookieUrl(cookie),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          expirationDate: cookie.session ? undefined : cookie.expirationDate
        })
      } catch {
        // One expired or rejected cookie must not discard the rest of the jar.
      }
    }
  }

  async #persist(identity: FeishuDeveloperIdentity): Promise<void> {
    const cookies = await this.#session.cookies.get({})
    await this.#store.write({
      schemaVersion: 1,
      identity,
      cookies: cookies
        .filter((cookie): cookie is Cookie & { domain: string } => (
          typeof cookie.domain === 'string' && isFeishuCookieDomain(cookie.domain)
        ))
        .map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path ?? '/',
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
          session: cookie.session,
          expirationDate: cookie.expirationDate
        }))
    })
  }

  #closeActiveLogin(): void {
    const window = this.#activeLoginWindow
    this.#activeLoginWindow = null
    if (window && !window.isDestroyed()) window.destroy()
  }

  get #session(): Session {
    this.#browserSession ??= electronSession.fromPartition(SESSION_PARTITION, { cache: false })
    return this.#browserSession
  }
}

class SafeStorageFeishuDeveloperSessionStore {
  readonly #path: string

  constructor(userDataPath: string) {
    this.#path = join(userDataPath, 'channel-credentials', 'feishu-developer-session.bin')
  }

  async requireAvailable(): Promise<void> {
    try {
      const available = await boundedSafeStorageOperation(
        safeStorage.isAsyncEncryptionAvailable()
      )
      if (!available) throw sessionError('system_credential_encryption_unavailable')
    } catch {
      throw sessionError('system_credential_encryption_unavailable')
    }
  }

  async read(): Promise<StoredDeveloperSession | null> {
    let encoded: string
    try {
      encoded = await readFile(this.#path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    await this.requireAvailable()
    let plaintext: string
    try {
      const decrypted = await boundedSafeStorageOperation(
        safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64'))
      )
      plaintext = decrypted.result
    } catch {
      throw sessionError('system_credential_encryption_unavailable')
    }
    const parsed = JSON.parse(plaintext) as StoredDeveloperSession
    if (!isStoredDeveloperSession(parsed)) throw sessionError('feishu_session_store_invalid')
    return parsed
  }

  async write(value: StoredDeveloperSession): Promise<void> {
    await this.requireAvailable()
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 })
    let encrypted: string
    try {
      encrypted = (await boundedSafeStorageOperation(
        safeStorage.encryptStringAsync(JSON.stringify(value))
      )).toString('base64')
    } catch {
      throw sessionError('system_credential_encryption_unavailable')
    }
    const temporaryPath = `${this.#path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600 })
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, this.#path)
  }

  async delete(): Promise<void> {
    try {
      await unlink(this.#path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

async function readDeveloperIdentity(
  window: BrowserWindow,
  currentUrl: string
): Promise<FeishuDeveloperIdentity | null> {
  const raw = await window.webContents.executeJavaScript(
    `(() => {
      const user = window.user ?? {}
      return {
        id: typeof user.id === 'string' ? user.id : '',
        name: typeof user.name === 'string' ? user.name : '',
        email: typeof user.email === 'string' ? user.email : '',
        tenantId: typeof user.tenantId === 'string' ? user.tenantId : '',
        tenantName: typeof user.tenantName === 'string' ? user.tenantName : ''
      }
    })()`,
    true
  ) as PortalIdentity
  const userId = normalizedRequired(raw.id)
  const userName = normalizedRequired(raw.name)
  const tenantId = normalizedRequired(raw.tenantId)
  const tenantName = normalizedRequired(raw.tenantName)
  if (!userId || !userName || !tenantId || !tenantName) return null
  const email = normalizedOptional(raw.email)
  return {
    brand: brandFromUrl(currentUrl),
    userId,
    userName,
    ...(email ? { email } : {}),
    tenantId,
    tenantName
  }
}

async function readOpenPlatformBootstrap(
  window: BrowserWindow
): Promise<OpenPlatformBootstrap> {
  return await window.webContents.executeJavaScript(
    `(() => {
      const user = window.user ?? {}
      const apiOrigin = window.outDomain?.larkOpen ?? window.location?.origin ?? ''
      return {
        csrfToken: typeof window.csrfToken === 'string' ? window.csrfToken : '',
        apiOrigin: typeof apiOrigin === 'string' ? apiOrigin : '',
        userId: typeof user.id === 'string' ? user.id : '',
        tenantId: typeof user.tenantId === 'string' ? user.tenantId : ''
      }
    })()`,
    true
  ) as OpenPlatformBootstrap
}

async function qrCanvasBounds(window: BrowserWindow): Promise<{
  x: number
  y: number
  width: number
  height: number
} | null> {
  const value = await window.webContents.executeJavaScript(
    `(() => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 120 || rect.height < 120) return null
      return {
        x: Math.max(0, Math.floor(rect.x)),
        y: Math.max(0, Math.floor(rect.y)),
        width: Math.ceil(rect.width),
        height: Math.ceil(rect.height)
      }
    })()`,
    true
  ) as { x: number; y: number; width: number; height: number } | null
  return value
}

function isStoredDeveloperSession(value: unknown): value is StoredDeveloperSession {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredDeveloperSession>
  return candidate.schemaVersion === 1
    && Boolean(candidate.identity)
    && Array.isArray(candidate.cookies)
    && isDeveloperIdentity(candidate.identity)
}

function isDeveloperIdentity(value: unknown): value is FeishuDeveloperIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<FeishuDeveloperIdentity>
  return (candidate.brand === 'feishu' || candidate.brand === 'lark')
    && Boolean(normalizedRequired(candidate.userId))
    && Boolean(normalizedRequired(candidate.userName))
    && Boolean(normalizedRequired(candidate.tenantId))
    && Boolean(normalizedRequired(candidate.tenantName))
}

function cookieUrl(cookie: StoredCookie): string {
  const host = cookie.domain.replace(/^\./, '')
  const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`
  return `${cookie.secure ? 'https' : 'http'}://${host}${path}`
}

function isFeishuCookieDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase()
  return normalized === 'feishu.cn'
    || normalized.endsWith('.feishu.cn')
    || normalized === 'larksuite.com'
    || normalized.endsWith('.larksuite.com')
}

function isAllowedFeishuTopLevelUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && isFeishuCookieDomain(url.hostname)
  } catch {
    return false
  }
}

function isDeveloperPortalUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'open.feishu.cn' || host === 'open.larksuite.com'
  } catch {
    return false
  }
}

function isFeishuLoginUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    return host === 'accounts.feishu.cn' || host === 'accounts.larksuite.com'
  } catch {
    return false
  }
}

function isExpectedPortalRedirectAbort(error: unknown, window: BrowserWindow): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; errno?: unknown }
  if (candidate.code !== 'ERR_ABORTED' && candidate.errno !== -3) return false
  if (window.isDestroyed() || window.webContents.isDestroyed()) return false
  const currentUrl = window.webContents.getURL()
  return isFeishuLoginUrl(currentUrl) || isDeveloperPortalUrl(currentUrl)
}

function brandFromUrl(value: string): 'feishu' | 'lark' {
  return new URL(value).hostname.toLowerCase().endsWith('larksuite.com') ? 'lark' : 'feishu'
}

function portalUrlForBrand(brand: 'feishu' | 'lark'): string {
  return brand === 'lark'
    ? 'https://open.larksuite.com/app'
    : FEISHU_PORTAL_URL
}

function requireOpenPlatformOrigin(
  value: unknown,
  brand: 'feishu' | 'lark'
): string {
  const expected = brand === 'lark'
    ? 'https://open.larksuite.com'
    : 'https://open.feishu.cn'
  let url: URL
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw sessionError('feishu_open_platform_origin_rejected')
  }
  if (
    url.origin !== expected
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || url.username !== ''
    || url.password !== ''
  ) throw sessionError('feishu_open_platform_origin_rejected')
  return expected
}

function requireOpenPlatformApiUrl(value: string, apiOrigin: string): string {
  let url: URL
  try {
    url = new URL(value, apiOrigin)
  } catch {
    throw sessionError('feishu_open_platform_api_url_rejected')
  }
  if (
    url.origin !== apiOrigin
    || !url.pathname.startsWith('/developers/')
    || url.username !== ''
    || url.password !== ''
  ) throw sessionError('feishu_open_platform_api_url_rejected')
  return url.toString()
}

function normalizedRequired(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function normalizedOptional(value: unknown): string | undefined {
  return normalizedRequired(value) ?? undefined
}

function boundedSafeStorageOperation<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(sessionError('system_credential_encryption_unavailable'))
    }, SAFE_STORAGE_OPERATION_TIMEOUT_MS)
    timer.unref?.()
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function sessionError(code: string): Error {
  return new Error(code)
}

function normalizeSessionError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : sessionError(fallback)
}
