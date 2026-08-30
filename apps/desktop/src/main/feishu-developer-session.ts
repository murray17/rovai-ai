import { createHash, randomUUID } from 'node:crypto'
import {
  BrowserWindow,
  session as electronSession,
  type Cookie,
  type Session
} from 'electron'
import type { SqliteChannelDeveloperSessionStore } from './channel-credential-store'

export type FeishuLoginStage =
  | 'loading_local_session'
  | 'preparing'
  | 'awaiting_scan'
  | 'scan_confirmed'
  | 'inspecting_identity'
  | 'saving_local_session'
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
  pendingConnection?(): PendingFeishuDeveloperConnection
  activatePendingLogin?(sessionRevision: number): Promise<void>
  discardPendingLogin?(): Promise<FeishuDeveloperIdentity | null>
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

export type StoredFeishuCookie = Pick<
Cookie,
  'name' | 'value' | 'secure' | 'httpOnly' | 'sameSite' | 'session'
> & { domain: string; path: string; expirationDate?: number }

export type StoredFeishuDeveloperSession = {
  cookies: StoredFeishuCookie[]
}

export type PendingFeishuDeveloperConnection = {
  identity: FeishuDeveloperIdentity
  session: StoredFeishuDeveloperSession
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

export class ElectronFeishuDeveloperSessionService implements FeishuDeveloperPortalSession {
  #browserSession: Session | null = null
  readonly #store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>
  readonly #getParentWindow: () => BrowserWindow | null
  #restored = false
  #storedIdentity: FeishuDeveloperIdentity | null = null
  #storedRevision: number | null = null
  #activeLoginWindow: BrowserWindow | null = null
  #activeOpenPlatformWindows = new Set<BrowserWindow>()
  #pendingLoginReplacement: {
    previousSession: Session | null
    replacementSession: Session
    identity: FeishuDeveloperIdentity
    session: StoredFeishuDeveloperSession
    onStatus?: (status: FeishuLoginStage) => void
  } | null = null

  constructor(
    store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>,
    getParentWindow: () => BrowserWindow | null = () => null
  ) {
    this.#store = store
    this.#getParentWindow = getParentWindow
  }

  async beginLogin(options: {
    forceFresh?: boolean
    signal?: AbortSignal
    onQrReady?(qr: { payload: string; expiresAt: string }): void
    onStatus?(status: FeishuLoginStage): void
  } = {}): Promise<FeishuDeveloperIdentity> {
    this.#closeActiveLogin()
    options.onStatus?.('loading_local_session')
    await this.#ensureRestored()
    if (this.#pendingLoginReplacement) await this.discardPendingLogin()
    if (options.signal?.aborted) throw sessionError('feishu_login_cancelled')

    const previousSession = this.#browserSession
    const loginSession = electronSession.fromPartition(
      `${SESSION_PARTITION}-login-${randomUUID()}`,
      { cache: false }
    )
    let replacementReady = false
    options.onStatus?.('preparing')
    const window = this.#createWindow(false, null, loginSession)
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
              emitStage('saving_local_session')
              this.#pendingLoginReplacement = {
                previousSession,
                replacementSession: loginSession,
                identity,
                session: await this.#capture(loginSession),
                onStatus: options.onStatus
              }
              replacementReady = true
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
      if (!replacementReady) {
        await loginSession.clearStorageData().catch(() => undefined)
      }
    }
  }

  pendingConnection(): PendingFeishuDeveloperConnection {
    const pending = this.#pendingLoginReplacement
    if (!pending) throw sessionError('feishu_login_pending_session_missing')
    return { identity: pending.identity, session: pending.session }
  }

  async activatePendingLogin(sessionRevision: number): Promise<void> {
    const pending = this.#pendingLoginReplacement
    if (!pending) throw sessionError('feishu_login_pending_session_missing')
    this.#pendingLoginReplacement = null
    this.#browserSession = pending.replacementSession
    this.#storedIdentity = pending.identity
    this.#storedRevision = sessionRevision
    this.#restored = true
    if (pending.previousSession && pending.previousSession !== pending.replacementSession) {
      await pending.previousSession.clearStorageData().catch(() => undefined)
    }
    pending.onStatus?.('connected')
  }

  async discardPendingLogin(): Promise<FeishuDeveloperIdentity | null> {
    const pending = this.#pendingLoginReplacement
    if (!pending) return null
    this.#pendingLoginReplacement = null
    await pending.replacementSession.clearStorageData().catch(() => undefined)
    return this.#storedIdentity
  }

  async inspect(): Promise<FeishuDeveloperIdentity | null> {
    await this.#ensureRestored()
    const restoredIdentity = this.#storedIdentity
    if (!restoredIdentity) return null
    const window = this.#createWindow(false)
    try {
      await window.loadURL(portalUrlForBrand(restoredIdentity.brand))
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
    await this.discardPendingLogin().catch(() => undefined)
    for (const window of this.#activeOpenPlatformWindows) {
      if (!window.isDestroyed()) window.destroy()
    }
    this.#activeOpenPlatformWindows.clear()
    await this.#session.clearStorageData()
    this.#browserSession = null
    this.#storedIdentity = null
    this.#storedRevision = null
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
    const identity = this.#storedIdentity
    if (!identity) throw sessionError('feishu_developer_session_expired')
    const portalUrl = portalUrlForBrand(identity.brand)
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
      const apiOrigin = requireOpenPlatformOrigin(bootstrap.apiOrigin, identity.brand)
      return {
        brand: identity.brand,
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
    if (!this.#storedIdentity) return
    await this.#persist(this.#storedIdentity)
  }

  #createWindow(
    show: boolean,
    parent: BrowserWindow | null = null,
    browserSession: Session = this.#session
  ): BrowserWindow {
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
        session: browserSession,
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
    const stored = await this.#store.read<FeishuDeveloperIdentity, StoredFeishuDeveloperSession>(
      'feishu'
    )
    this.#restored = true
    if (!stored) return
    this.#storedIdentity = stored.identity
    this.#storedRevision = stored.revision
    for (const cookie of stored.session.cookies) {
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

  async #persist(
    identity: FeishuDeveloperIdentity,
    browserSession: Session = this.#session
  ): Promise<void> {
    if (this.#storedRevision === null) return
    const session = await this.#capture(browserSession)
    this.#storedRevision = await this.#store.replace({
      provider: 'feishu',
      accountId: accountIdForStoredIdentity(identity),
      identity,
      session,
      expectedRevision: this.#storedRevision
    })
    this.#storedIdentity = identity
  }

  async #capture(browserSession: Session): Promise<StoredFeishuDeveloperSession> {
    const cookies = await browserSession.cookies.get({})
    return {
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
    }
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

function cookieUrl(cookie: StoredFeishuCookie): string {
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

function accountIdForStoredIdentity(identity: FeishuDeveloperIdentity): `sha256:${string}` {
  const value = `${identity.brand}\0${identity.tenantId}\0${identity.userId}`
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function sessionError(code: string): Error {
  return new Error(code)
}

function normalizeSessionError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : sessionError(fallback)
}
