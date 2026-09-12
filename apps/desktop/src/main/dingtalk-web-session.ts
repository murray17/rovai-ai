import { randomUUID } from 'node:crypto'
import { BrowserWindow, session as electronSession, type Cookie, type Session } from 'electron'
import QRCode from 'qrcode'
import type { ChannelLoginViewBounds } from '@contracts'
import { dingTalkConsoleFetch, type DingTalkConsoleFetch } from './dingtalk-console-transport'
import { DingTalkLoginView } from './dingtalk-login-view'
import { DingTalkLoginProtocol, type DingTalkQrState } from './dingtalk-login-protocol'
import { DingTalkLoginTransport, dingTalkLoginFetch, requireDingTalkNavigation,
  DINGTALK_SSO_PATH, type DingTalkLoginFetch } from './dingtalk-login-transport'
import { DingTalkConsoleError, dingTalkAbortable, dingTalkDeadline, dingTalkDelay,
  requireDingTalkActive } from './dingtalk-session-error'
export { DingTalkConsoleError } from './dingtalk-session-error'

export const DINGTALK_CONSOLE_ORIGIN = 'https://open-dev.dingtalk.com'
const PORTAL_URL = `${DINGTALK_CONSOLE_ORIGIN}/`
const LOGIN_TIMEOUT_MS = 10 * 60_000
const INSPECT_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 2_000_000
type DingTalkLoginTimings = { request: number; scan: number; handoff: number; identity: number; overall: number; interval: number }

export type DingTalkWebIdentity = {
  corpId: string
  corpName: string | null
  userId: string
  userName: string | null
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
  | 'expired' | 'completing_login' | 'inspecting_identity'

export type DingTalkWebLoginOptions = {
  signal: AbortSignal
  attemptId?: string
  onStage?(stage: DingTalkWebLoginStage): void
  onQrReady?(qr: { payload: string; expiresAt: number | null }): void
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

/** Owns one isolated Chromium cookie jar. Never borrows a user's browser profile. */
export interface DingTalkWebSession {
  restore(stored: StoredDingTalkWebSession, signal?: AbortSignal): Promise<void>
  login(options: DingTalkWebLoginOptions): Promise<DingTalkWebIdentity>
  setLoginViewBounds?(bounds: ChannelLoginViewBounds | null): void
  refreshLoginQr?(): void
  inspect(signal?: AbortSignal): Promise<DingTalkWebIdentity>
  snapshot(signal?: AbortSignal): Promise<StoredDingTalkWebSession>
  request(path: string, options?: DingTalkConsoleRequest): Promise<unknown>
  close(): Promise<void>
}

export class ElectronDingTalkWebSession implements DingTalkWebSession {
  #session: Session
  #fetch: DingTalkConsoleFetch
  readonly #fetchOverride: DingTalkConsoleFetch | undefined
  readonly #loginFetchOverride: DingTalkLoginFetch | undefined
  readonly #timings: DingTalkLoginTimings
  readonly #createSession: () => Session
  readonly #parent: () => BrowserWindow | null
  readonly #windows = new Set<BrowserWindow | DingTalkLoginView>()
  #loginView: DingTalkLoginView | null = null
  #refreshLogin: (() => void) | null = null
  readonly #closed = new AbortController()
  #attempt: { id: string; generation: number; abort: AbortController } | null = null

  constructor(options: {
    getParentWindow?: () => BrowserWindow | null
    session?: Session
    fetch?: DingTalkConsoleFetch
    loginFetch?: DingTalkLoginFetch
    timings?: Partial<DingTalkLoginTimings>
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
    this.#loginFetchOverride = options.loginFetch
    this.#timings = { request: 20_000, scan: 5 * 60_000, handoff: 30_000,
      identity: INSPECT_TIMEOUT_MS, overall: LOGIN_TIMEOUT_MS, interval: 1_500, ...options.timings }
    this.#fetch = options.fetch ?? dingTalkConsoleFetch(this.#session)
  }

  async restore(stored: StoredDingTalkWebSession, signal = this.#closed.signal): Promise<void> {
    requireDingTalkWebSession(stored)
    const session = this.#session
    for (const cookie of stored.cookies) {
      requireDingTalkActive(signal)
      if (!cookie.session && cookie.expirationDate !== undefined
        && cookie.expirationDate <= Date.now() / 1_000) continue
      const host = cookie.domain.replace(/^\./u, '')
      const { hostOnly, session: _sessionCookie, ...details } = cookie
      await dingTalkAbortable(session.cookies.set({
        ...details,
        ...(hostOnly ? { domain: undefined } : {}),
        url: `https://${host}${cookie.path}`
      }), signal)
    }
  }

  async login(options: DingTalkWebLoginOptions): Promise<DingTalkWebIdentity> {
    const overall = dingTalkDeadline(AbortSignal.any([options.signal, this.#closed.signal]),
      this.#timings.overall, 'dingtalk_login_timeout')
    const id = options.attemptId ?? randomUUID()
    let generation = 0
    try {
      while (true) {
        requireDingTalkActive(overall.signal)
        const attempt = { id, generation: ++generation, abort: new AbortController() }
        this.#attempt?.abort.abort(new DingTalkConsoleError('dingtalk_operation_cancelled'))
        this.#attempt = attempt
        const signal = AbortSignal.any([overall.signal, attempt.abort.signal])
        let stage: DingTalkWebLoginStage = 'preparing'
        const emit = (next: DingTalkWebLoginStage): void => {
          requireDingTalkActive(signal)
          if (this.#attempt !== attempt) throw new DingTalkConsoleError('dingtalk_operation_cancelled')
          if (next === stage && next !== 'preparing') return
          stage = next
          options.onStage?.(next)
        }
        this.#refreshLogin = () => {
          if (this.#attempt !== attempt || !['expired', 'awaiting_scan'].includes(stage)) return
          attempt.abort.abort(new DingTalkConsoleError('dingtalk_login_refreshed'))
        }
        emit('preparing')
        try {
          return await dingTalkAbortable(this.#loginGeneration(options, signal, emit), signal)
        } catch (error) {
          requireDingTalkActive(overall.signal)
          if (!(error instanceof DingTalkConsoleError) || error.message !== 'dingtalk_login_refreshed') throw error
          // A refresh is a new context. In-flight responses can only touch the discarded jar.
          const previous = this.#session
          this.#session = this.#createSession()
          this.#session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
          this.#fetch = this.#fetchOverride ?? dingTalkConsoleFetch(this.#session)
          void previous.clearStorageData().catch(() => undefined)
        }
      }
    } finally {
      overall.dispose()
      if (this.#attempt?.id === id) {
        this.#attempt.abort.abort(new DingTalkConsoleError('dingtalk_operation_cancelled'))
        this.#attempt = null
        this.#refreshLogin = null
      }
    }
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
    const deadline = dingTalkDeadline(AbortSignal.any([this.#closed.signal, ...(signal ? [signal] : [])]),
      this.#timings.identity, 'dingtalk_open_platform_timeout')
    try { return await this.#visitOfficialPage(PORTAL_URL, false, deadline.signal, () => {}) }
    finally { deadline.dispose() }
  }

  async snapshot(signal = this.#closed.signal): Promise<StoredDingTalkWebSession> {
    const cookies = (await dingTalkAbortable(this.#session.cookies.get({}), signal))
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
    const deadline = dingTalkDeadline(AbortSignal.any([
      this.#closed.signal, ...(options.signal ? [options.signal] : [])
    ]), Math.min(options.timeoutMs ?? 30_000, 120_000), 'dingtalk_open_platform_timeout')
    const signal = deadline.signal
    const fetch = this.#fetch
    const session = this.#session
    try {
      const url = requireDingTalkConsoleUrl(path)
      if (options.image !== undefined && (path !== '/microapp/uploadPic/logo.json'
        || options.method !== 'POST' || options.body !== undefined || options.form
        || !isDingTalkAvatarPng(options.image))) {
        throw new DingTalkConsoleError('dingtalk_console_request_rejected', true)
      }
      const cookies = await dingTalkAbortable(session.cookies.get({ url: PORTAL_URL }), signal)
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
        body = await dingTalkAbortable(encoded.arrayBuffer(), signal)
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
      requireDingTalkActive(signal)
      const response = await dingTalkAbortable(fetch(url.toString(), {
        method: options.method ?? 'GET', headers, body,
        credentials: 'include', redirect: 'manual', signal
      }), signal)
      if (response.status >= 300 && response.status < 400) {
        void response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (location && isDingTalkLoginUrl(new URL(location, PORTAL_URL).toString())) {
          throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
        }
        throw new DingTalkConsoleError('dingtalk_console_redirect_rejected', true)
      }
      if (!response.ok) {
        // The console also returns business errors with HTTP 400. Preserve only
        // its bounded numeric code; never expose the remote message or payload.
        const rejection = record(await readBoundedJson(response, signal).catch(() => null))
        requireDingTalkActive(signal)
        if (response.status === 401) throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
        if (response.status === 403) throw new DingTalkConsoleError('dingtalk_open_platform_access_denied', true)
        const definitelyRejected = response.status < 500 && ![408, 409, 429].includes(response.status)
        throw new DingTalkConsoleError(
          (definitelyRejected && consoleErrorCode(rejection?.errorCode)) || `dingtalk_console_http_${response.status}`,
          definitelyRejected
        )
      }
      const result = record(await readBoundedJson(response, signal))
      requireDingTalkActive(signal)
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
      requireDingTalkActive(signal)
      if (error instanceof DingTalkConsoleError) throw error
      // Never expose Chromium's error (it may contain a credential-bearing URL).
      throw new DingTalkConsoleError('dingtalk_open_platform_unavailable')
    } finally { deadline.dispose() }
  }

  async close(): Promise<void> {
    this.#closed.abort()
    this.#refreshLogin = null
    for (const window of this.#windows) {
      if (window instanceof DingTalkLoginView || !window.isDestroyed()) window.destroy()
    }
    this.#windows.clear()
    const cleanup = dingTalkDeadline(new AbortController().signal, 2_000, 'dingtalk_operation_cancelled')
    try { await dingTalkAbortable(this.#session.clearStorageData(), cleanup.signal).catch(() => undefined) }
    finally { cleanup.dispose() }
  }

  async #loginGeneration(
    options: DingTalkWebLoginOptions,
    signal: AbortSignal,
    emit: (stage: DingTalkWebLoginStage) => void
  ): Promise<DingTalkWebIdentity> {
    const protocol = new DingTalkLoginProtocol(new DingTalkLoginTransport(
      this.#loginFetchOverride ?? dingTalkLoginFetch(this.#session), this.#timings.request
    ))
    const opened = await protocol.open(signal)
    requireDingTalkActive(signal)
    if (opened.kind === 'console') return this.#inspectLoginIdentity(signal, emit)
    const context = opened.context
    let next: DingTalkQrState | null = opened.next
    if (!next) {
      const challenge = await protocol.initialize(context, signal)
      requireDingTalkActive(signal)
      const image = await dingTalkAbortable(QRCode.toDataURL(challenge.qrPayload, {
        type: 'image/png', width: 280, margin: 4, errorCorrectionLevel: 'M'
      }), signal)
      requireDingTalkActive(signal)
      emit('awaiting_scan')
      options.onQrReady?.({ payload: image, expiresAt: challenge.expiresAt })
      const scan = dingTalkDeadline(signal, this.#timings.scan, 'dingtalk_login_scan_timeout')
      let scanned = false
      try {
        while (true) {
          next = await protocol.poll(context, challenge, scan.signal)
          requireDingTalkActive(scan.signal)
          if (next.kind === 'expired') {
            emit('expired')
            break
          }
          if (next.kind === 'scanned' && !scanned) { scanned = true; emit('scan_confirmed') }
          if (next.kind !== 'waiting' && next.kind !== 'scanned') break
          await dingTalkDelay(this.#timings.interval, scan.signal)
        }
      } finally { scan.dispose() }
    }
    requireDingTalkActive(signal)
    if (next?.kind === 'expired') {
      // A terminal generation has no more queries. Only explicit refresh or cancellation can resume.
      return dingTalkAbortable(new Promise<DingTalkWebIdentity>(() => {}), signal)
    }
    if (next?.kind === 'interaction') return this.#visitOfficialPage(next.url, true, signal, emit)
    if (next?.kind !== 'authenticated') throw new DingTalkConsoleError('dingtalk_login_protocol_incompatible')
    emit('completing_login')
    const handoff = dingTalkDeadline(signal, this.#timings.handoff, 'dingtalk_login_handoff_timeout')
    let completed
    try { completed = await protocol.complete(context, next, handoff.signal) }
    finally { handoff.dispose() }
    requireDingTalkActive(signal)
    if (completed.kind === 'interaction') return this.#visitOfficialPage(completed.url, true, signal, emit)
    return this.#inspectLoginIdentity(signal, emit)
  }

  async #inspectLoginIdentity(signal: AbortSignal, emit: (stage: DingTalkWebLoginStage) => void,
    browserSession?: Session
  ): Promise<DingTalkWebIdentity> {
    // This precedes Cookie operations and the first /baseInfo request, including retries.
    emit('inspecting_identity')
    requireDingTalkActive(signal)
    const deadline = dingTalkDeadline(signal, this.#timings.identity, 'dingtalk_login_identity_timeout')
    let candidate: ElectronDingTalkWebSession | undefined
    let adopted = false
    try {
      if (browserSession) {
        candidate = new ElectronDingTalkWebSession({ session: this.#createSession(),
          createSession: this.#createSession, fetch: this.#fetchOverride, timings: this.#timings })
        await candidate.restore(await this.snapshot(deadline.signal), deadline.signal)
      }
      const web = candidate ?? this
      for (let attempt = 0; ; attempt += 1) {
        try {
          const identity = parseDingTalkWebIdentity(await web.request('/baseInfo', {
            signal: deadline.signal, timeoutMs: Math.min(8_000, this.#timings.request)
          }))
          requireDingTalkActive(deadline.signal)
          if (candidate) {
            this.#session = candidate.#session
            this.#fetch = candidate.#fetch
            adopted = true
            void browserSession?.clearStorageData().catch(() => undefined)
          }
          return identity
        } catch (error) {
          requireDingTalkActive(deadline.signal)
          if (attempt >= 2 || !(error instanceof DingTalkConsoleError) || ![
            'dingtalk_developer_session_expired', 'dingtalk_login_identity_unavailable',
            'dingtalk_open_platform_unavailable', 'dingtalk_open_platform_timeout',
            'dingtalk_open_platform_response_invalid', 'dingtalk_console_http_503'
          ].includes(error.message)) throw error
          await dingTalkDelay(500, deadline.signal)
        }
      }
    } finally {
      deadline.dispose()
      if (candidate && !adopted) void candidate.close().catch(() => undefined)
    }
  }

  async #visitOfficialPage(url: string, interactive: boolean, signal: AbortSignal,
    emit: (stage: DingTalkWebLoginStage) => void
  ): Promise<DingTalkWebIdentity> {
    requireDingTalkNavigation(url)
    requireDingTalkActive(signal)
    const portalSession = this.#session
    const parent = this.#parent()
    const loginView = interactive ? new DingTalkLoginView(portalSession, parent) : null
    const window = loginView ?? new BrowserWindow({
      width: 1040, height: 800, show: false,
      ...(parent ? { parent } : {}),
      webPreferences: { session: portalSession, nodeIntegration: false,
        contextIsolation: true, sandbox: true, devTools: false }
    })
    this.#loginView = loginView
    this.#windows.add(window)
    const lifetime = new AbortController()
    const live = AbortSignal.any([signal, lifetime.signal])
    let loadingTimer: ReturnType<typeof setTimeout> | undefined
    let handoffTimer: ReturnType<typeof setTimeout> | undefined
    const stopLoading = (): void => { clearTimeout(loadingTimer); loadingTimer = undefined }
    const startLoading = (): void => {
      stopLoading()
      loadingTimer = setTimeout(() => lifetime.abort(new DingTalkConsoleError('dingtalk_login_request_timeout')),
        this.#timings.request)
    }
    const abort = (): void => { if (!window.isDestroyed()) window.destroy() }
    const navigate = (event: { preventDefault(): void }, target: string): void => {
      try { requireDingTalkNavigation(target) } catch {
        event.preventDefault()
        lifetime.abort(new DingTalkConsoleError('dingtalk_login_redirect_rejected', true))
      }
    }
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.webContents.on('did-start-loading', startLoading)
    window.webContents.on('did-stop-loading', stopLoading)
    window.webContents.on('destroyed', () => lifetime.abort(new DingTalkConsoleError('dingtalk_operation_cancelled')))
    live.addEventListener('abort', abort, { once: true })
    let loadFailed = false
    let loginSince: number | null = null
    try {
      if (loginView) { loginView.setInteraction(true); emit('awaiting_interaction') }
      requireDingTalkActive(live)
      startLoading()
      void window.loadURL(url).catch(() => { loadFailed = true }).finally(stopLoading)
      while (true) {
        requireDingTalkActive(live)
        if (window.isDestroyed()) throw new DingTalkConsoleError('dingtalk_operation_cancelled')
        const current = window.webContents.getURL()
        if (current && current !== 'about:blank') {
          const location = requireDingTalkNavigation(current)
          if (location.searchParams.has('error')) throw new DingTalkConsoleError('dingtalk_login_rejected', true)
          if (location.origin === DINGTALK_CONSOLE_ORIGIN) {
            loginSince = null
            if (!handoffTimer) handoffTimer = setTimeout(() => lifetime.abort(
              new DingTalkConsoleError('dingtalk_login_handoff_timeout')), this.#timings.handoff)
            // Wait for the callback's document/redirect and Cookie updates, not its URL alone.
            if (location.pathname !== DINGTALK_SSO_PATH && !window.webContents.isLoadingMainFrame()) {
              stopLoading()
              clearTimeout(handoffTimer)
              loginView?.setInteraction(false)
              return await this.#inspectLoginIdentity(live, emit, portalSession)
            }
          } else {
            loginSince ??= Date.now()
            if (!interactive && Date.now() - loginSince >= 3_000 && !window.webContents.isLoading()) {
              throw new DingTalkConsoleError('dingtalk_developer_session_expired', true)
            }
          }
        }
        if (loadFailed && !window.webContents.isLoading()) throw new DingTalkConsoleError('dingtalk_open_platform_unavailable')
        await dingTalkDelay(250, live)
      }
    } finally {
      stopLoading()
      clearTimeout(handoffTimer)
      live.removeEventListener('abort', abort)
      this.#windows.delete(window)
      if (this.#loginView === loginView) this.#loginView = null
      if (!window.isDestroyed()) window.destroy()
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
  const corpName = firstDingTalkDisplayName(data?.orgName, data?.corpName)
  // staffId is the organization-scoped Owner identity. Never substitute nick,
  // phone number, an SSO UID, or a browser-cookie identity for it.
  const userId = data?.staffId
  const userName = firstDingTalkDisplayName(data?.nick, data?.name)
  if (![corpId, userId].every((item) => safeString(item, 512))) {
    throw new DingTalkConsoleError('dingtalk_login_identity_unavailable', true)
  }
  return { corpId, corpName, userId, userName } as DingTalkWebIdentity
}

export function firstDingTalkDisplayName(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && safeString(value.trim(), 512)) return value.trim()
  return null
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

function isDingTalkLoginUrl(raw: string): boolean {
  try { return new URL(raw).origin === 'https://login.dingtalk.com' } catch { return false }
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

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined)
    throw new DingTalkConsoleError('dingtalk_open_platform_response_too_large')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new DingTalkConsoleError('dingtalk_open_platform_response_invalid')
  const decoder = new TextDecoder()
  const abort = (): void => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  let size = 0
  let text = ''
  try {
    while (true) {
      const chunk = await dingTalkAbortable(reader.read(), signal)
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined)
        throw new DingTalkConsoleError('dingtalk_open_platform_response_too_large')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } catch (error) {
    if (error instanceof DingTalkConsoleError) throw error
    throw new DingTalkConsoleError('dingtalk_open_platform_response_invalid')
  } finally {
    signal.removeEventListener('abort', abort)
    void reader.cancel().catch(() => undefined)
  }
}
