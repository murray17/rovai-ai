import { randomUUID } from 'node:crypto'
import { BrowserWindow, session as electronSession, type Cookie, type Session } from 'electron'
import type { ChannelLoginViewBounds } from '@contracts'
import { dingTalkConsoleFetch, type DingTalkConsoleFetch } from './dingtalk-console-transport'
import {
  DingTalkLoginView, DINGTALK_LOGIN_PAGE_OBSERVATION, parseDingTalkLoginPageObservation
} from './dingtalk-login-view'

export const DINGTALK_CONSOLE_ORIGIN = 'https://open-dev.dingtalk.com'
const PORTAL_URL = `${DINGTALK_CONSOLE_ORIGIN}/`
const LOGIN_TIMEOUT_MS = 10 * 60_000
const INSPECT_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 2_000_000

export type DingTalkWebIdentity = {
  corpId: string
  corpName: string
  userId: string
  userName: string
}

export type StoredDingTalkCookie = Required<Pick<Cookie,
  'name' | 'value' | 'domain' | 'path' | 'secure' | 'httpOnly' | 'sameSite' | 'session'
>> & { expirationDate?: number; hostOnly?: boolean }

export type StoredDingTalkWebSession = {
  schemaVersion: 2
  cookies: StoredDingTalkCookie[]
}

export type DingTalkWebLoginStage =
  | 'preparing' | 'awaiting_scan' | 'scan_confirmed' | 'awaiting_interaction'
  | 'expired' | 'inspecting_identity'

export type DingTalkWebLoginOptions = {
  signal: AbortSignal
  onStage?(stage: DingTalkWebLoginStage): void
  onQrReady?(qr: { payload: string; expiresAt: null }): void
}

export type DingTalkConsoleRequest = {
  method?: 'GET' | 'POST'
  query?: Readonly<Record<string, string | number | boolean>>
  body?: Readonly<Record<string, unknown>>
  form?: boolean
  /** Only the reviewed developer-console PNG upload, never an arbitrary file. */
  image?: Uint8Array
  signal?: AbortSignal
  timeoutMs?: number
}

export class DingTalkConsoleError extends Error {
  readonly definitelyRejected: boolean

  constructor(code: string, definitelyRejected = false) {
    super(code)
    this.name = 'DingTalkConsoleError'
    this.definitelyRejected = definitelyRejected
  }
}

/** Owns one isolated Chromium cookie jar. Never borrows a user's browser profile. */
export interface DingTalkWebSession {
  restore(stored: StoredDingTalkWebSession): Promise<void>
  login(options: DingTalkWebLoginOptions): Promise<DingTalkWebIdentity>
  setLoginViewBounds?(bounds: ChannelLoginViewBounds | null): void
  refreshLoginQr?(): void
  inspect(signal?: AbortSignal): Promise<DingTalkWebIdentity>
  snapshot(): Promise<StoredDingTalkWebSession>
  request(path: string, options?: DingTalkConsoleRequest): Promise<unknown>
  close(): Promise<void>
}

export class ElectronDingTalkWebSession implements DingTalkWebSession {
  #session: Session
  #fetch: DingTalkConsoleFetch
  readonly #fetchOverride: DingTalkConsoleFetch | undefined
  readonly #createSession: () => Session
  readonly #parent: () => BrowserWindow | null
  readonly #windows = new Set<BrowserWindow | DingTalkLoginView>()
  #loginView: DingTalkLoginView | null = null
  #refreshLogin: (() => void) | null = null
  readonly #closed = new AbortController()

  constructor(options: {
    getParentWindow?: () => BrowserWindow | null
    session?: Session
    fetch?: DingTalkConsoleFetch
    createSession?: () => Session
  } = {}) {
    this.#parent = options.getParentWindow ?? (() => null)
    // No persist: partition: SQLite is the only durable credential authority.
    this.#createSession = options.createSession ?? (() => electronSession.fromPartition(
      `rovai-dingtalk-developer-${randomUUID()}`, { cache: false }
    ))
    this.#session = options.session ?? this.#createSession()
    this.#session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    this.#fetchOverride = options.fetch
    this.#fetch = options.fetch ?? dingTalkConsoleFetch(this.#session)
  }

  async restore(stored: StoredDingTalkWebSession): Promise<void> {
    requireDingTalkWebSession(stored)
    for (const cookie of stored.cookies) {
      if (!cookie.session && cookie.expirationDate !== undefined
        && cookie.expirationDate <= Date.now() / 1_000) continue
      const host = cookie.domain.replace(/^\./u, '')
      const { hostOnly, session: _sessionCookie, ...details } = cookie
      await this.#session.cookies.set({
        ...details,
        ...(hostOnly ? { domain: undefined } : {}),
        url: `https://${host}${cookie.path}`
      })
    }
  }

  async login(options: DingTalkWebLoginOptions): Promise<DingTalkWebIdentity> {
    return this.#visitPortal(true, options.signal, options.onStage, options.onQrReady)
  }

  setLoginViewBounds(bounds: ChannelLoginViewBounds | null): void { this.#loginView?.setBounds(bounds) }

  refreshLoginQr(): void { this.#refreshLogin?.() }

  async inspect(signal?: AbortSignal): Promise<DingTalkWebIdentity> {
    try {
      return parseDingTalkWebIdentity(await this.request('/baseInfo', { signal }))
    } catch (error) {
      if (!(error instanceof DingTalkConsoleError)
        || error.message !== 'dingtalk_developer_session_expired') throw error
    }
    // Let DingTalk's own SSO redirect flow renew its console cookie. There is no
    // Rovai OAuth refresh token, copied client secret, or replay of a mutation.
    return this.#visitPortal(false, signal)
  }

  async snapshot(): Promise<StoredDingTalkWebSession> {
    const cookies = (await this.#session.cookies.get({}))
      .filter((cookie) => isDingTalkCookieDomain(cookie.domain) && cookie.value.length > 0)
      .map((cookie): StoredDingTalkCookie => ({
        name: cookie.name, value: cookie.value, domain: cookie.domain!, path: cookie.path!,
        secure: cookie.secure === true, httpOnly: cookie.httpOnly === true, sameSite: cookie.sameSite,
        session: cookie.session ?? cookie.expirationDate === undefined, hostOnly: cookie.hostOnly,
        ...(cookie.expirationDate !== undefined ? { expirationDate: cookie.expirationDate } : {})
      }))
    const stored = { schemaVersion: 2, cookies } as const
    requireDingTalkWebSession(stored)
    return stored
  }

  async request(path: string, options: DingTalkConsoleRequest = {}): Promise<unknown> {
    if (options.signal?.aborted || this.#closed.signal.aborted) {
      throw new DingTalkConsoleError('dingtalk_operation_cancelled', true)
    }
    const url = requireDingTalkConsoleUrl(path)
    if (options.image !== undefined && (path !== '/microapp/uploadPic/logo.json'
      || options.method !== 'POST' || options.body !== undefined || options.form
      || !isDingTalkAvatarPng(options.image))) {
      throw new DingTalkConsoleError('dingtalk_console_request_rejected', true)
    }
    const cookies = await this.#session.cookies.get({ url: PORTAL_URL })
    const token = cookies.find((cookie) => cookie.name === 'access_token')?.value
    // The official portal unescapes document.cookie before building its query.
    // Passing an escaped cookie through URLSearchParams directly double-encodes it.
    if (token) url.searchParams.set('access_token', decodeConsoleCookie(token))
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (key === 'access_token') throw new DingTalkConsoleError('dingtalk_console_request_rejected', true)
      url.searchParams.set(key, String(value))
    }
    const headers = new Headers({ Accept: 'application/json', Referer: PORTAL_URL })
    const csrf = cookies.find((cookie) => cookie.name === '_csrf_token_')?.value
    if (csrf) headers.set('_csrf_token_', decodeConsoleCookie(csrf))
    let body: string | ArrayBuffer | undefined
    if (options.image) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(options.image)], { type: 'image/png' }), 'member.png')
      const encoded = new Request(PORTAL_URL, { method: 'POST', body: form })
      headers.set('Content-Type', encoded.headers.get('Content-Type')!)
      body = await encoded.arrayBuffer()
    } else if (options.body) {
      if (options.form) {
        headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
        body = new URLSearchParams(Object.entries(options.body).map(([key, value]) => [
          key, typeof value === 'string' ? value : JSON.stringify(value)
        ])).toString()
      } else {
        headers.set('Content-Type', 'application/json')
        body = JSON.stringify(options.body)
      }
    }
    const timeout = AbortSignal.timeout(Math.min(options.timeoutMs ?? 30_000, 120_000))
    const signal = AbortSignal.any([
      this.#closed.signal, timeout, ...(options.signal ? [options.signal] : [])
    ])
    try {
      const response = await this.#fetch(url.toString(), {
        method: options.method ?? 'GET', headers, body,
        credentials: 'include', redirect: 'manual', signal
      })
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (location && isDingTalkLoginUrl(new URL(location, PORTAL_URL).toString())) {
          throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
        }
        throw new DingTalkConsoleError('dingtalk_console_redirect_rejected', true)
      }
      if (!response.ok) {
        // The console also returns business errors with HTTP 400. Preserve only
        // its bounded numeric code; never expose the remote message or payload.
        const rejection = record(await readBoundedJson(response).catch(() => null))
        if (response.status === 401) throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
        if (response.status === 403) throw new DingTalkConsoleError('dingtalk_open_platform_access_denied', true)
        const definitelyRejected = response.status < 500 && ![408, 409, 429].includes(response.status)
        throw new DingTalkConsoleError(
          (definitelyRejected && consoleErrorCode(rejection?.errorCode)) || `dingtalk_console_http_${response.status}`,
          definitelyRejected
        )
      }
      const result = record(await readBoundedJson(response))
      if (!result) throw new DingTalkConsoleError('dingtalk_open_platform_response_invalid')
      if (Number(result.errorCode) === 302) {
        throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
      }
      if (result.success !== true) {
        throw new DingTalkConsoleError(
          consoleErrorCode(result.errorCode) || 'dingtalk_open_platform_operation_failed', result.success === false
        )
      }
      return result.data
    } catch (error) {
      if (options.signal?.aborted || this.#closed.signal.aborted) {
        // Once dispatched, cancellation does not prove a mutation was rejected.
        throw new DingTalkConsoleError('dingtalk_operation_cancelled')
      }
      if (timeout.aborted) throw new DingTalkConsoleError('dingtalk_open_platform_timeout')
      if (error instanceof DingTalkConsoleError) throw error
      // Never expose Chromium's error (it may contain a credential-bearing URL).
      throw new DingTalkConsoleError('dingtalk_open_platform_unavailable')
    }
  }

  async close(): Promise<void> {
    this.#closed.abort()
    this.#refreshLogin = null
    for (const window of this.#windows) {
      if (window instanceof DingTalkLoginView || !window.isDestroyed()) window.destroy()
    }
    this.#windows.clear()
    await this.#session.clearStorageData()
  }

  async #visitPortal(
    interactive: boolean,
    signal?: AbortSignal,
    onStage?: DingTalkWebLoginOptions['onStage'],
    onQrReady?: DingTalkWebLoginOptions['onQrReady']
  ): Promise<DingTalkWebIdentity> {
    if (signal?.aborted || this.#closed.signal.aborted) {
      throw new DingTalkConsoleError('dingtalk_operation_cancelled', true)
    }
    const portalSession = this.#session
    const parent = this.#parent()
    const loginView = interactive ? new DingTalkLoginView(portalSession, parent) : null
    this.#loginView = loginView
    const window = loginView ?? new BrowserWindow({
      width: 1040, height: 800, show: false,
      title: '连接钉钉开发者账号',
      ...(parent ? { parent } : {}),
      webPreferences: {
        session: portalSession, nodeIntegration: false, contextIsolation: true,
        sandbox: true, devTools: false
      }
    })
    this.#windows.add(window)
    if (window instanceof BrowserWindow) window.setMenuBarVisibility(false)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!isDingTalkPortalNavigation(url)) event.preventDefault()
    })
    window.webContents.on('will-redirect', (event, url) => {
      if (!isDingTalkPortalNavigation(url)) event.preventDefault()
    })
    const abort = (): void => { if (!window.isDestroyed()) window.destroy() }
    signal?.addEventListener('abort', abort, { once: true })
    this.#closed.signal.addEventListener('abort', abort, { once: true })
    let loaded = false
    let loadFailed = false
    let loginSince: number | null = null
    let candidate: ElectronDingTalkWebSession | undefined
    let adopted = false
    let pageGeneration = 0
    let lastQrDataUrl = ''
    let lastStage: DingTalkWebLoginStage = 'preparing'
    let interactionSince: number | null = null
    const emitStage = (stage: DingTalkWebLoginStage): void => {
      if (lastStage === stage) return
      lastStage = stage
      onStage?.(stage)
    }
    const observeLoginPage = async (): Promise<void> => {
      if (!loginView) return
      const generation = pageGeneration
      let observation
      try {
        observation = parseDingTalkLoginPageObservation(
          // WebContents.executeJavaScript waits for the whole page to finish
          // loading. Read the current frame so a slow optional resource cannot
          // hold an already rendered QR behind the Rovai loading state.
          await window.webContents.mainFrame.executeJavaScript(DINGTALK_LOGIN_PAGE_OBSERVATION)
        )
      } catch { return } // A navigation can dispose the old frame between polls.
      if (generation !== pageGeneration || signal?.aborted || window.isDestroyed() || this.#closed.signal.aborted) return
      if (observation.kind !== 'interaction') interactionSince = null
      if (observation.kind === 'qr') {
        loginView.setInteraction(false)
        const changed = lastQrDataUrl !== observation.dataUrl || lastStage !== 'awaiting_scan'
        lastQrDataUrl = observation.dataUrl
        emitStage('awaiting_scan')
        if (changed) onQrReady?.({ payload: observation.dataUrl, expiresAt: null })
      } else if (observation.kind === 'interaction') {
        interactionSince ??= Date.now()
        if (Date.now() - interactionSince < 2_000) return
        loginView.setInteraction(true)
        emitStage('awaiting_interaction')
      } else {
        loginView.setInteraction(false)
        emitStage(observation.kind === 'scanned' ? 'scan_confirmed'
          : observation.kind === 'expired' ? 'expired' : 'preparing')
      }
    }
    this.#refreshLogin = loginView ? () => {
      if (window.isDestroyed() || signal?.aborted || !['expired', 'awaiting_scan'].includes(lastStage)) return
      pageGeneration += 1
      lastQrDataUrl = ''
      interactionSince = null
      loginView.setInteraction(false)
      emitStage('preparing')
      window.webContents.reload()
    } : null
    const deadline = Date.now() + (interactive ? LOGIN_TIMEOUT_MS : INSPECT_TIMEOUT_MS)
    onStage?.('preparing')
    void window.loadURL(PORTAL_URL).then(() => { loaded = true }, () => { loadFailed = true })
    try {
      while (Date.now() < deadline) {
        if (signal?.aborted || window.isDestroyed() || this.#closed.signal.aborted) {
          throw new DingTalkConsoleError('dingtalk_operation_cancelled', true)
        }
        const currentUrl = window.webContents.getURL()
        if (isDingTalkLoginUrl(currentUrl)) {
          loginSince ??= Date.now()
          if (interactive) await observeLoginPage()
          // A navigation to login is not immediately expiry: allow the platform
          // to complete an automatic SSO redirect before requiring the user.
          if (!interactive && Date.now() - loginSince >= 3_000 && !window.webContents.isLoading()) {
            throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
          }
        } else if (isDingTalkConsolePage(currentUrl)) {
          loginSince = null
          try {
            // Canonicalize the browser cookies through the same path as restart
            // restoration. Main requests from the browser's live cookie jar can
            // omit login cookies even though cookies.get() can read them. Keep
            // the API jar browser-free and let Chromium retain response cookies.
            candidate ??= new ElectronDingTalkWebSession({
              session: this.#createSession(), createSession: this.#createSession,
              fetch: this.#fetchOverride
            })
            await candidate.#session.clearStorageData()
            await candidate.restore(await this.snapshot())
            const identity = parseDingTalkWebIdentity(await candidate.request('/baseInfo', {
              signal: AbortSignal.any([this.#closed.signal, ...(signal ? [signal] : [])]),
              timeoutMs: 8_000
            }))
            if (signal?.aborted || window.isDestroyed() || this.#closed.signal.aborted) {
              throw new DingTalkConsoleError('dingtalk_operation_cancelled', true)
            }
            this.#session = candidate.#session
            this.#fetch = candidate.#fetch
            adopted = true
            loginView?.setInteraction(false)
            emitStage('inspecting_identity')
            return identity
          } catch (error) {
            if (!(error instanceof DingTalkConsoleError)
              || !['dingtalk_developer_session_expired', 'dingtalk_login_identity_unavailable',
                'dingtalk_open_platform_unavailable', 'dingtalk_open_platform_timeout'].includes(error.message)) throw error
            if (interactive && error.message === 'dingtalk_login_identity_unavailable') await observeLoginPage()
          }
        } else if (loadFailed && !loaded && !window.webContents.isLoading()) {
          throw new DingTalkConsoleError('dingtalk_open_platform_unavailable')
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 750))
      }
      throw new DingTalkConsoleError(interactive ? 'dingtalk_login_timeout' : 'dingtalk_open_platform_timeout')
    } finally {
      signal?.removeEventListener('abort', abort)
      this.#closed.signal.removeEventListener('abort', abort)
      this.#windows.delete(window)
      if (this.#loginView === loginView) {
        this.#loginView = null
        this.#refreshLogin = null
      }
      if (loginView) loginView.destroy()
      else if (!window.isDestroyed()) window.destroy()
      if (adopted) await portalSession.clearStorageData().catch(() => undefined)
      else await candidate?.close().catch(() => undefined)
    }
  }
}

export function isDingTalkAvatarPng(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength > 8 && value.byteLength <= 2 * 1024 * 1024
    && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => value[index] === byte)
}

export function isDingTalkCookieDomain(domain: string | undefined): boolean {
  return ['dingtalk.com', 'open-dev.dingtalk.com', 'login.dingtalk.com']
    .includes(domain?.replace(/^\./u, '').toLowerCase() ?? '')
}

export function requireDingTalkWebSession(value: unknown): asserts value is StoredDingTalkWebSession {
  const root = record(value)
  if (!root || root.schemaVersion !== 2 || Object.keys(root).length !== 2
    || !Array.isArray(root.cookies) || root.cookies.length > 512
    || Buffer.byteLength(JSON.stringify(root), 'utf8') > 1_048_576) {
    throw new DingTalkConsoleError('dingtalk_web_session_store_invalid', true)
  }
  const seen = new Set<string>()
  for (const value of root.cookies) {
    const cookie = record(value)
    if (!cookie || !safeString(cookie.name, 512) || !safeString(cookie.value, 16_384)
      || Object.keys(cookie).some((key) => ![
        'name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'sameSite',
        'session', 'hostOnly', 'expirationDate'
      ].includes(key))
      || !safeString(cookie.domain, 512) || !isDingTalkCookieDomain(cookie.domain as string)
      || !safeString(cookie.path, 4096) || !(cookie.path as string).startsWith('/')
      || typeof cookie.secure !== 'boolean' || typeof cookie.httpOnly !== 'boolean'
      || typeof cookie.session !== 'boolean'
      || (cookie.hostOnly !== undefined && typeof cookie.hostOnly !== 'boolean')
      || !['unspecified', 'no_restriction', 'lax', 'strict'].includes(String(cookie.sameSite))
      || (cookie.expirationDate !== undefined
        && (typeof cookie.expirationDate !== 'number' || !Number.isFinite(cookie.expirationDate)
          || cookie.expirationDate < 0 || cookie.expirationDate > 8_640_000_000_000))) {
      throw new DingTalkConsoleError('dingtalk_web_session_store_invalid', true)
    }
    const key = JSON.stringify([cookie.domain, cookie.path, cookie.name])
    if (seen.has(key)) throw new DingTalkConsoleError('dingtalk_web_session_store_invalid', true)
    seen.add(key)
  }
}

export function parseDingTalkWebIdentity(value: unknown): DingTalkWebIdentity {
  const data = record(value)
  const corpId = data?.corpId
  const corpName = data?.orgName ?? data?.corpName
  // staffId is the organization-scoped Owner identity. Never substitute nick,
  // phone number, an SSO UID, or a browser-cookie identity for it.
  const userId = data?.staffId
  const userName = data?.nick || data?.name
  if (![corpId, corpName, userId, userName].every((item) => safeString(item, 512))) {
    throw new DingTalkConsoleError('dingtalk_login_identity_unavailable', true)
  }
  return { corpId, corpName, userId, userName } as DingTalkWebIdentity
}

function requireDingTalkConsoleUrl(path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[?#\0]/u.test(path)) {
    throw new DingTalkConsoleError('dingtalk_console_request_rejected', true)
  }
  const url = new URL(path, PORTAL_URL)
  if (url.origin !== DINGTALK_CONSOLE_ORIGIN
    || url.pathname !== path
    || !(path === '/baseInfo' || path.startsWith('/openapp/')
      || path === '/innerApp/getAppAccount' || path.startsWith('/app/inner/')
      || path === '/microapp/uploadPic/logo.json' || path === '/microapp/preset/logo.json')) {
    throw new DingTalkConsoleError('dingtalk_console_request_rejected', true)
  }
  return url
}

function isDingTalkConsolePage(raw: string): boolean {
  try { return new URL(raw).origin === DINGTALK_CONSOLE_ORIGIN } catch { return false }
}

function isDingTalkLoginUrl(raw: string): boolean {
  try { return new URL(raw).origin === 'https://login.dingtalk.com' } catch { return false }
}

function isDingTalkPortalNavigation(raw: string): boolean {
  return isDingTalkConsolePage(raw) || isDingTalkLoginUrl(raw)
}

function safeString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0
    && Buffer.byteLength(value, 'utf8') <= maximum && !value.includes('\0')
}

function decodeConsoleCookie(value: string): string {
  try { return decodeURIComponent(value) }
  catch { throw new DingTalkConsoleError('dingtalk_web_session_store_invalid', true) }
}

function consoleErrorCode(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) < 1_000_000_000
    ? `dingtalk_console_error_${value}` : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new DingTalkConsoleError('dingtalk_open_platform_response_too_large')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new DingTalkConsoleError('dingtalk_open_platform_response_invalid')
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new DingTalkConsoleError('dingtalk_open_platform_response_too_large')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } catch (error) {
    if (error instanceof DingTalkConsoleError) throw error
    throw new DingTalkConsoleError('dingtalk_open_platform_response_invalid')
  } finally {
    reader.releaseLock()
  }
}
