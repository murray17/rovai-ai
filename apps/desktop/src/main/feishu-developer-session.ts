import { createHash, randomUUID } from 'node:crypto'
import {
  type BrowserWindow,
  session as electronSession,
  type Cookie,
  type Session
} from 'electron'
import type { SqliteChannelDeveloperSessionStore } from './channel-credential-store'
import QRCode from 'qrcode'
import { normalizeFeishuIdentity, readOpenPlatformBootstrap } from './feishu-developer-identity'
import { isFeishuCookieDomain, isFeishuLoginUrl, openPlatformOrigin, portalUrlForBrand } from './feishu-domains'
import { FeishuLoginProtocol, type FeishuLoginProfile } from './feishu-login-protocol'
import { requestInFeishuSession } from './feishu-electron-transport'
import { abortable, FeishuSessionError, FeishuSessionHttp, loginDelay, throwIfAborted, type FeishuRequestDiagnostic } from './feishu-session-http'

import { canAdvanceFeishuLoginStage, type FeishuLoginStage } from '../shared/feishu-login-progress'
export type { FeishuLoginStage } from '../shared/feishu-login-progress'

export interface FeishuDeveloperIdentity {
  brand: 'feishu' | 'lark'
  userId: string
  userName: string
  email?: string
  tenantId: string
  tenantName: string
}

export type FeishuDeveloperSessionInspection =
  | { status: 'valid'; identity: FeishuDeveloperIdentity }
  | { status: 'invalid'; reason: 'missing' | 'expired' | 'identity_changed' }
  | { status: 'unavailable' }

export interface FeishuDeveloperSessionService {
  beginLogin(options?: {
    forceFresh?: boolean
    signal?: AbortSignal
    onQrReady?(qr: { payload: string; expiresAt: string | null; waitUntil?: string }): void
    onStatus?(status: FeishuLoginStage): void
  }): Promise<FeishuDeveloperIdentity>
  pendingConnection?(): PendingFeishuDeveloperConnection
  activatePendingLogin?(sessionRevision: number): Promise<void>
  discardPendingLogin?(): Promise<FeishuDeveloperIdentity | null>
  inspect(): Promise<FeishuDeveloperSessionInspection>
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
> & { domain: string; path: string; expirationDate?: number; hostOnly?: boolean }

export type StoredFeishuDeveloperSession = {
  cookies: StoredFeishuCookie[]
  portalOrigin?: string
}

export type PendingFeishuDeveloperConnection = {
  identity: FeishuDeveloperIdentity
  session: StoredFeishuDeveloperSession
}

type LoginOptions = NonNullable<Parameters<FeishuDeveloperSessionService['beginLogin']>[0]>
type LoginAttempt = {
  attemptId: string
  generation: number
  controller: AbortController
  session: Session
  flowKey: string | null
  token: string | null
  stage: FeishuLoginStage
  deadline: number
  options: LoginOptions
}

type SessionOptions = {
  request?: typeof requestInFeishuSession
  profile?: Partial<FeishuLoginProfile>
  qrDataUrl?: (payload: string) => Promise<string>
  diagnostic?: (event: Partial<FeishuRequestDiagnostic> & {
    attemptId: string
    stage: FeishuLoginStage
    missingFields?: string[]
    httpStatus?: number
    remoteCode?: string
  }) => void
}

export class ElectronFeishuDeveloperSessionService implements FeishuDeveloperPortalSession {
  #browserSession: Session | null = null
  readonly #store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>
  readonly #protocol: FeishuLoginProtocol
  readonly #qrDataUrl: (payload: string) => Promise<string>
  readonly #diagnostic: NonNullable<SessionOptions['diagnostic']>
  readonly #request: typeof requestInFeishuSession
  #restored = false
  #restoring: Promise<void> | null = null
  #sessionGeneration = 0
  #sessionAbort = new AbortController()
  #storedIdentity: FeishuDeveloperIdentity | null = null
  #storedRevision: number | null = null
  #portalOrigin: string | undefined
  #loginGeneration = 0
  #activeAttempt: LoginAttempt | null = null
  #pendingLoginReplacement: {
    replacementSession: Session
    identity: FeishuDeveloperIdentity
    session: StoredFeishuDeveloperSession
    attempt: LoginAttempt
  } | null = null

  constructor(
    store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>,
    _getParentWindow: () => BrowserWindow | null = () => null,
    options: SessionOptions = {}
  ) {
    this.#store = store
    this.#protocol = new FeishuLoginProtocol(options.profile)
    this.#request = options.request ?? requestInFeishuSession
    this.#qrDataUrl = options.qrDataUrl ?? ((payload) => QRCode.toDataURL(payload, {
      type: 'image/png', width: 280, margin: 4, errorCorrectionLevel: 'M'
    }))
    this.#diagnostic = options.diagnostic ?? ((event) => console.info('[feishu-login]', event))
  }

  async beginLogin(options: LoginOptions = {}): Promise<FeishuDeveloperIdentity> {
    this.#activeAttempt?.controller.abort(new FeishuSessionError('feishu_login_cancelled'))
    const attempt: LoginAttempt = {
      attemptId: randomUUID(), generation: ++this.#loginGeneration,
      controller: new AbortController(), session: freshSession('login'),
      flowKey: null, token: null, stage: 'loading_local_session',
      deadline: Date.now() + this.#protocol.profile.loginTimeoutMs, options
    }
    this.#activeAttempt = attempt
    const signal = attempt.controller.signal
    const cancel = (): void => attempt.controller.abort(new FeishuSessionError('feishu_login_cancelled'))
    options.signal?.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) cancel()
    const deadline = setTimeout(() => attempt.controller.abort(
      new FeishuSessionError('feishu_login_timeout')
    ), this.#protocol.profile.loginTimeoutMs)
    let ready = false
    try {
      this.#checkAttempt(attempt)
      options.onStatus?.('loading_local_session')
      await abortable(this.#ensureRestored(), signal)
      this.#checkAttempt(attempt)
      await abortable(this.discardPendingLogin(), signal)
      this.#checkAttempt(attempt)
      this.#stage(attempt, 'preparing')
      const http = this.#http(attempt.session, (event) => this.#diagnostic({
        attemptId: attempt.attemptId, stage: attempt.stage, ...event
      }))
      const initialized = await this.#protocol.initialize(http, signal)
      this.#checkAttempt(attempt)
      attempt.flowKey = initialized.flowKey
      attempt.token = initialized.token
      const payload = await abortable(this.#qrDataUrl(JSON.stringify({
        qrlogin: { token: attempt.token }
      })), signal)
      this.#checkAttempt(attempt)
      options.onQrReady?.({ payload, expiresAt: initialized.expiresAt,
        waitUntil: new Date(attempt.deadline).toISOString() })
      this.#stage(attempt, 'awaiting_scan')
      for (;;) {
        await loginDelay(this.#protocol.profile.pollIntervalMs, signal)
        this.#checkAttempt(attempt)
        const result = await this.#protocol.poll(http, attempt.flowKey, signal)
        this.#checkAttempt(attempt)
        if (result.kind === 'expired') throw new FeishuSessionError('feishu_login_expired')
        if (result.kind === 'scanned') this.#stage(attempt, 'scan_confirmed')
        if (result.kind !== 'complete') continue
        this.#stage(attempt, 'completing_login')
        await this.#protocol.complete(http, result.crossLoginUri, signal)
        this.#checkAttempt(attempt)
        // Navigation establishes the target Session before any identity is accepted.
        const portal = await http.request(this.#protocol.profile.portalUrl, { kind: 'navigation' }, { signal })
        this.#checkAttempt(attempt)
        this.#stage(attempt, 'inspecting_identity')
        if (isFeishuLoginUrl(portal.finalUrl)) {
          throw new FeishuSessionError('feishu_login_interaction_required')
        }
        requirePortalResponse(portal.response)
        const html = await abortable(portal.response.text(), signal)
        this.#checkAttempt(attempt)
        const bootstrap = readOpenPlatformBootstrap(html, portal.finalUrl)
        const stored = await abortable(this.#capture(attempt.session, bootstrap.apiOrigin), signal)
        this.#checkAttempt(attempt)
        this.#pendingLoginReplacement = {
          replacementSession: attempt.session, identity: bootstrap.identity, session: stored, attempt
        }
        ready = true
        return bootstrap.identity
      }
    } catch (error) {
      const failure = error instanceof Error && /^feishu_[a-z_]+$/.test(error.message)
        ? error : new FeishuSessionError('feishu_login_failed')
      // Cancellation may report its terminal state, but a replaced attempt never emits again.
      if (this.#activeAttempt === attempt && attempt.generation === this.#loginGeneration) {
        const stage = failure.message === 'feishu_login_expired' ? 'expired'
          : failure.message === 'feishu_login_cancelled' ? 'cancelled' : 'failed'
        attempt.stage = stage
        options.onStatus?.(stage)
        this.#diagnostic({ attemptId: attempt.attemptId, stage,
          ...(failure instanceof FeishuSessionError ? failure.details : {}) })
      }
      throw failure
    } finally {
      clearTimeout(deadline)
      options.signal?.removeEventListener('abort', cancel)
      attempt.flowKey = null
      attempt.token = null
      if (this.#activeAttempt === attempt) this.#activeAttempt = null
      if (!ready) void attempt.session.clearStorageData().catch(() => undefined)
    }
  }

  pendingConnection(): PendingFeishuDeveloperConnection {
    const pending = this.#pendingLoginReplacement
    if (!pending) throw new FeishuSessionError('feishu_login_pending_session_missing')
    return { identity: pending.identity, session: pending.session }
  }

  async activatePendingLogin(sessionRevision: number): Promise<void> {
    const pending = this.#pendingLoginReplacement
    if (!pending || !Number.isSafeInteger(sessionRevision) || sessionRevision < 1) {
      throw new FeishuSessionError('feishu_login_pending_session_missing')
    }
    const previous = this.#browserSession
    this.#sessionGeneration += 1
    this.#sessionAbort.abort(new FeishuSessionError('feishu_developer_session_replaced'))
    this.#sessionAbort = new AbortController()
    this.#pendingLoginReplacement = null
    this.#browserSession = pending.replacementSession
    this.#storedIdentity = pending.identity
    this.#storedRevision = sessionRevision
    this.#portalOrigin = pending.session.portalOrigin
    this.#restored = true
    if (pending.attempt.generation === this.#loginGeneration) pending.attempt.options.onStatus?.('connected')
    // Cleanup must not turn an already activated connection into a failed/uncertain commit.
    if (previous && previous !== pending.replacementSession) {
      void previous.clearStorageData().catch(() => undefined)
    }
  }

  async discardPendingLogin(): Promise<FeishuDeveloperIdentity | null> {
    const pending = this.#pendingLoginReplacement
    if (!pending) return this.#storedIdentity
    this.#pendingLoginReplacement = null
    void pending.replacementSession.clearStorageData().catch(() => undefined)
    return this.#storedIdentity
  }

  async inspect(): Promise<FeishuDeveloperSessionInspection> {
    try {
      await this.#ensureRestored()
      const identity = this.#storedIdentity
      const browserSession = this.#browserSession
      if (!identity || !browserSession) return { status: 'invalid', reason: 'missing' }
      const generation = this.#sessionGeneration
      const signal = this.#sessionAbort.signal
      const bootstrap = await this.#bootstrap(browserSession, identity.brand, signal)
      if (generation !== this.#sessionGeneration) return { status: 'unavailable' }
      if (accountIdForStoredIdentity(bootstrap.identity) !== accountIdForStoredIdentity(identity)) {
        return { status: 'invalid', reason: 'identity_changed' }
      }
      await this.#persist(bootstrap.identity, browserSession, bootstrap.apiOrigin)
      return { status: 'valid', identity: bootstrap.identity }
    } catch (error) {
      if (error instanceof Error && error.message === 'feishu_developer_session_expired') {
        return { status: 'invalid', reason: 'expired' }
      }
      // Failed observation or refresh storage is not proof that saved credentials expired.
      return { status: 'unavailable' }
    }
  }

  async requireExpectedIdentity(expected: { userId: string; tenantId: string }): Promise<FeishuDeveloperIdentity> {
    const inspection = await this.inspect()
    if (inspection.status === 'unavailable') {
      throw new FeishuSessionError('feishu_developer_session_inspection_unavailable')
    }
    if (inspection.status === 'invalid') throw new FeishuSessionError(inspection.reason === 'identity_changed'
      ? 'feishu_developer_identity_changed' : 'feishu_developer_session_expired')
    if (inspection.identity.userId !== expected.userId || inspection.identity.tenantId !== expected.tenantId) {
      throw new FeishuSessionError('feishu_developer_identity_changed')
    }
    return inspection.identity
  }

  async disconnect(): Promise<void> {
    this.#sessionGeneration += 1
    this.#loginGeneration += 1
    this.#activeAttempt?.controller.abort(new FeishuSessionError('feishu_login_cancelled'))
    this.#activeAttempt = null
    this.#sessionAbort.abort(new FeishuSessionError('feishu_developer_session_replaced'))
    this.#sessionAbort = new AbortController()
    await this.discardPendingLogin()
    const previous = this.#browserSession
    this.#browserSession = null
    this.#storedIdentity = null
    this.#storedRevision = null
    this.#portalOrigin = undefined
    this.#restored = true
    await previous?.clearStorageData()
  }

  async openPlatformSession(input: {
    expectedIdentity: { userId: string; tenantId: string }
    signal?: AbortSignal
  }): Promise<FeishuOpenPlatformSession> {
    await this.#ensureRestored()
    if (input.signal?.aborted) throw new FeishuSessionError('feishu_provisioning_cancelled')
    const identity = this.#storedIdentity
    const browserSession = this.#browserSession
    if (!identity || !browserSession) throw new FeishuSessionError('feishu_developer_session_expired')
    const generation = this.#sessionGeneration
    const lifetime = this.#sessionAbort.signal
    const signal = input.signal ? AbortSignal.any([input.signal, lifetime]) : lifetime
    const bootstrap = await this.#bootstrap(browserSession, identity.brand, signal).catch((error: unknown) => {
      if (input.signal?.aborted) throw new FeishuSessionError('feishu_provisioning_cancelled')
      throw error
    })
    const check = (): void => {
      if (input.signal?.aborted) throw new FeishuSessionError('feishu_provisioning_cancelled')
      if (generation !== this.#sessionGeneration) throw new FeishuSessionError('feishu_developer_session_replaced')
      throwIfAborted(signal)
    }
    check()
    if (accountIdForStoredIdentity(bootstrap.identity) !== accountIdForStoredIdentity(identity)
      || bootstrap.identity.userId !== input.expectedIdentity.userId
      || bootstrap.identity.tenantId !== input.expectedIdentity.tenantId) {
      throw new FeishuSessionError('feishu_developer_identity_changed')
    }
    const http = this.#http(browserSession)
    return {
      brand: bootstrap.identity.brand, apiOrigin: bootstrap.apiOrigin, csrfToken: bootstrap.csrfToken,
      fetch: async (rawUrl, init = {}) => {
        check()
        const requestSignal = init.signal ? AbortSignal.any([signal, init.signal]) : signal
        const headers = new Headers(init.headers)
        headers.set('referer', `${bootstrap.apiOrigin}/app`)
        headers.set('origin', bootstrap.apiOrigin)
        headers.set('x-csrf-token', bootstrap.csrfToken)
        const result = await http.request(rawUrl, { kind: 'api', origin: bootstrap.apiOrigin }, {
          ...init, headers, signal: requestSignal
        })
        check()
        return result.response
      }
    }
  }

  async persist(): Promise<void> {
    if (this.#storedIdentity && this.#browserSession) {
      await this.#persist(this.#storedIdentity, this.#browserSession, this.#portalOrigin)
    }
  }

  #http(session: Session, diagnostic?: (event: FeishuRequestDiagnostic) => void): FeishuSessionHttp {
    return new FeishuSessionHttp({ fetch: (url, init) => this.#request(session, String(url), init ?? {}) },
      this.#protocol.profile.requestTimeoutMs, diagnostic)
  }

  async #bootstrap(session: Session, brand: FeishuDeveloperIdentity['brand'], signal: AbortSignal) {
    const { response, finalUrl } = await this.#http(session).request(
      portalUrlForBrand(brand, this.#portalOrigin), { kind: 'navigation' }, { signal }
    )
    throwIfAborted(signal)
    if (isFeishuLoginUrl(finalUrl)) throw new FeishuSessionError('feishu_developer_session_expired')
    requirePortalResponse(response)
    const html = await abortable(response.text(), signal)
    const bootstrap = readOpenPlatformBootstrap(html, finalUrl)
    return bootstrap
  }

  #checkAttempt(attempt: LoginAttempt): void {
    // A buffered response/microtask can settle before an overdue timer gets CPU time.
    if (!attempt.controller.signal.aborted && Date.now() >= attempt.deadline) {
      attempt.controller.abort(new FeishuSessionError('feishu_login_timeout'))
    }
    throwIfAborted(attempt.controller.signal)
    if (this.#activeAttempt !== attempt || attempt.generation !== this.#loginGeneration) {
      throw new FeishuSessionError('feishu_login_cancelled')
    }
  }

  #stage(attempt: LoginAttempt, stage: FeishuLoginStage): void {
    this.#checkAttempt(attempt)
    if (!canAdvanceFeishuLoginStage(attempt.stage, stage)) return
    attempt.stage = stage
    attempt.options.onStatus?.(stage)
    this.#diagnostic({ attemptId: attempt.attemptId, stage })
  }

  async #ensureRestored(): Promise<void> {
    if (this.#restored) return
    this.#restoring ??= this.#restore().finally(() => { this.#restoring = null })
    await this.#restoring
  }

  async #restore(): Promise<void> {
    const generation = this.#sessionGeneration
    const signal = this.#sessionAbort.signal
    const stored = await abortable(this.#store.read<FeishuDeveloperIdentity, StoredFeishuDeveloperSession>('feishu'), signal)
    if (generation !== this.#sessionGeneration) return
    if (!stored) { this.#restored = true; return }
    const origin = openPlatformOrigin(portalUrlForBrand(stored.identity.brand, stored.session.portalOrigin), stored.identity.brand)
    const identity = normalizeFeishuIdentity(stored.identity, origin)
    const browserSession = freshSession('restored')
    try {
      for (const cookie of stored.session.cookies) {
        throwIfAborted(signal)
        if (!isFeishuCookieDomain(cookie.domain)) continue
        if (!cookie.session && cookie.expirationDate !== undefined && cookie.expirationDate <= Date.now() / 1_000) continue
        await abortable(browserSession.cookies.set({
          url: cookieUrl(cookie), name: cookie.name, value: cookie.value,
          // Omitting domain preserves host-only cookies. Legacy rows used Chromium's leading dot.
          ...(!(cookie.hostOnly ?? !cookie.domain.startsWith('.')) ? { domain: cookie.domain } : {}),
          path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite, expirationDate: cookie.session ? undefined : cookie.expirationDate
        }), signal)
        if (generation !== this.#sessionGeneration) return
      }
      throwIfAborted(signal)
      this.#browserSession = browserSession
      this.#storedIdentity = identity
      this.#storedRevision = stored.revision
      this.#portalOrigin = origin
      this.#restored = true
    } finally {
      if (this.#browserSession !== browserSession) void browserSession.clearStorageData().catch(() => undefined)
    }
  }

  async #persist(identity: FeishuDeveloperIdentity, browserSession: Session, origin?: string): Promise<void> {
    const expectedRevision = this.#storedRevision
    const signal = this.#sessionAbort.signal
    if (expectedRevision === null) return
    const session = await abortable(this.#capture(browserSession, origin), signal)
    const check = (): void => {
      throwIfAborted(signal)
      if (this.#browserSession !== browserSession || this.#storedRevision !== expectedRevision) {
        throw new FeishuSessionError('feishu_developer_session_inspection_unavailable')
      }
    }
    check()
    const revision = await abortable(this.#store.replace({
      provider: 'feishu', accountId: accountIdForStoredIdentity(identity),
      identity, session, expectedRevision
    }), signal)
    check()
    this.#storedRevision = revision
    this.#storedIdentity = identity
    this.#portalOrigin = origin
  }

  async #capture(browserSession: Session, portalOrigin?: string): Promise<StoredFeishuDeveloperSession> {
    const cookies = await browserSession.cookies.get({})
    return { portalOrigin, cookies: cookies
      .filter((cookie): cookie is Cookie & { domain: string } => typeof cookie.domain === 'string'
        && isFeishuCookieDomain(cookie.domain))
      .map((cookie) => ({ name: cookie.name, value: cookie.value, domain: cookie.domain,
        path: cookie.path ?? '/', secure: cookie.secure, httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite, session: cookie.session, expirationDate: cookie.expirationDate,
        hostOnly: cookie.hostOnly })) }
  }
}

function freshSession(purpose: string): Session {
  return electronSession.fromPartition(`rovai-feishu-developer-${purpose}-${randomUUID()}`, { cache: false })
}

function requirePortalResponse(response: Response): void {
  if (response.status === 401) throw new FeishuSessionError('feishu_developer_session_expired')
  if (!response.ok) throw new FeishuSessionError('feishu_open_platform_http_error', { httpStatus: response.status })
}

function cookieUrl(cookie: StoredFeishuCookie): string {
  const host = cookie.domain.replace(/^\./, '')
  const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`
  return `${cookie.secure ? 'https' : 'http'}://${host}${path}`
}

function accountIdForStoredIdentity(identity: FeishuDeveloperIdentity): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(`${identity.brand}\0${identity.tenantId}\0${identity.userId}`).digest('hex')}`
}
