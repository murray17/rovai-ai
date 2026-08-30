import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { shell } from 'electron'
import type { SqliteChannelDeveloperSessionStore } from './channel-credential-store'
import {
  DingTalkDeveloperApiTransport,
  type DingTalkDeveloperIdentityRecord
} from './dingtalk-developer-gateway'

const AUTHORIZE_URL = 'https://login.dingtalk.com/oauth2/auth'
const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/userAccessToken'
const OAUTH_SCOPE = 'openid corpid'
const OAUTH_TIMEOUT_MS = 10 * 60_000
const MAX_RESPONSE_BYTES = 1_000_000
const REFRESH_SKEW_MS = 60_000
const DEFAULT_REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60_000

export type DingTalkDeveloperIdentity = {
  accountId: string
  userIdDigest: string
  corpId: string
  userId: string
  userName: string
  corpName: string
  oauthProfileRef: string
  expiresAt: string | null
}

export type DingTalkLoginStage =
  | 'preparing'
  | 'awaiting_browser'
  | 'inspecting_identity'
  | 'connected'

export interface DingTalkDeveloperSessionService {
  inspect(signal?: AbortSignal): Promise<DingTalkDeveloperIdentity | null>
  beginLogin(options: {
    signal: AbortSignal
    onStage?(stage: DingTalkLoginStage): void
  }): Promise<DingTalkDeveloperIdentity>
  pendingConnection?(): PendingDingTalkDeveloperConnection
  activatePendingLogin?(sessionRevision: number): Promise<void>
  discardPendingLogin?(): Promise<DingTalkDeveloperIdentity | null>
  accessToken(signal?: AbortSignal): Promise<string>
  activate?(identity: Pick<DingTalkDeveloperIdentity, 'corpId' | 'userId'>): Promise<void>
  disconnect(identity?: Pick<DingTalkDeveloperIdentity, 'corpId' | 'userId'>): Promise<void>
}

export type DingTalkOAuthTokenSet = {
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string
  refreshTokenExpiresAt: string
  corpId: string
}

export type StoredOAuthProfile = DingTalkOAuthTokenSet & DingTalkDeveloperIdentityRecord & {
  clientId: string
}

export type StoredDingTalkDeveloperSessions = {
  schemaVersion: 1
  currentProfileKey: string | null
  profiles: StoredOAuthProfile[]
}

export type PendingDingTalkDeveloperConnection = {
  identity: DingTalkDeveloperIdentityRecord
  session: StoredDingTalkDeveloperSessions
}

export interface DingTalkOAuthBackend {
  login(options: { signal: AbortSignal }): Promise<DingTalkOAuthTokenSet>
  refresh(refreshToken: string, signal?: AbortSignal): Promise<DingTalkOAuthTokenSet>
  resolveIdentity(
    accessToken: string,
    expectedCorpId: string,
    signal?: AbortSignal
  ): Promise<DingTalkDeveloperIdentityRecord>
}

type FetchLike = typeof globalThis.fetch

export class DingTalkOAuthClient implements DingTalkOAuthBackend {
  readonly #clientId: string
  readonly #clientSecret: string
  readonly #fetch: FetchLike
  readonly #transport: DingTalkDeveloperApiTransport
  readonly #openExternal: (url: string) => Promise<unknown>

  constructor(options: {
    clientId?: string
    clientSecret?: string
    fetchImpl?: FetchLike
    transport?: DingTalkDeveloperApiTransport
    openExternal?: (url: string) => Promise<unknown>
  }) {
    this.#clientId = options.clientId?.trim() ?? ''
    this.#clientSecret = options.clientSecret?.trim() ?? ''
    this.#fetch = options.fetchImpl ?? globalThis.fetch
    this.#transport = options.transport ?? new DingTalkDeveloperApiTransport({
      fetchImpl: this.#fetch
    })
    this.#openExternal = options.openExternal ?? ((url) => shell.openExternal(url))
  }

  async login(options: { signal: AbortSignal }): Promise<DingTalkOAuthTokenSet> {
    this.#requireClient()
    const authorizationCode = await this.#browserAuthorizationCode(options.signal)
    return this.#exchangeCode(authorizationCode, options.signal)
  }

  async refresh(refreshToken: string, signal?: AbortSignal): Promise<DingTalkOAuthTokenSet> {
    this.#requireClient()
    const normalized = requiredSecret(refreshToken, 'refreshToken')
    return this.#requestToken({
      clientId: this.#clientId,
      clientSecret: this.#clientSecret,
      refreshToken: normalized,
      grantType: 'refresh_token'
    }, signal)
  }

  async resolveIdentity(
    accessToken: string,
    expectedCorpId: string,
    signal?: AbortSignal
  ): Promise<DingTalkDeveloperIdentityRecord> {
    return this.#transport.resolveCurrentUser({ accessToken, expectedCorpId, signal })
  }

  async #exchangeCode(code: string, signal?: AbortSignal): Promise<DingTalkOAuthTokenSet> {
    return this.#requestToken({
      clientId: this.#clientId,
      clientSecret: this.#clientSecret,
      code: requiredCanonical(code, 'authorizationCode'),
      grantType: 'authorization_code'
    }, signal)
  }

  async #requestToken(
    body: Record<string, string>,
    signal?: AbortSignal
  ): Promise<DingTalkOAuthTokenSet> {
    const response = await this.#requestTokenJson(body, signal)
    const root = asRecord(response)
    const payload = asRecord(root?.result) ?? asRecord(root?.data) ?? root
    const accessToken = firstString(payload, 'accessToken', 'access_token')
    const refreshToken = firstString(payload, 'refreshToken', 'refresh_token')
    const corpId = firstString(payload, 'corpId', 'corp_id') ?? ''
    const expiresIn = positiveNumber(payload, 'expiresIn', 'expireIn') ?? 7_200
    const refreshExpiresIn = positiveNumber(
      payload,
      'refreshTokenExpiresIn',
      'refreshExpiresIn'
    )
    if (!accessToken || !refreshToken) throw oauthError('dingtalk_oauth_response_invalid')
    const now = Date.now()
    return {
      accessToken,
      refreshToken,
      corpId,
      accessTokenExpiresAt: new Date(now + expiresIn * 1_000).toISOString(),
      refreshTokenExpiresAt: new Date(
        now + (refreshExpiresIn ? refreshExpiresIn * 1_000 : DEFAULT_REFRESH_LIFETIME_MS)
      ).toISOString()
    }
  }

  async #browserAuthorizationCode(signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw oauthError('dingtalk_operation_cancelled')
    const state = randomBytes(32).toString('base64url')
    const callback = deferred<string>()
    // The callback may arrive before openExternal resolves.
    void callback.promise.catch(() => undefined)
    const server = createServer((request, response) => {
      let url: URL
      try {
        url = new URL(request.url ?? '/', 'http://127.0.0.1')
      } catch {
        response.writeHead(400).end('Invalid callback')
        return
      }
      if (url.pathname !== '/callback') {
        response.writeHead(404).end('Not found')
        return
      }
      const returnedState = url.searchParams.get('state') ?? ''
      if (!safeEqual(state, returnedState)) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('Rovai 无法验证本次钉钉登录，请返回应用重试。')
        callback.reject(oauthError('dingtalk_oauth_state_mismatch'))
        return
      }
      const remoteError = url.searchParams.get('error')
      if (remoteError) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('钉钉登录未完成，可以返回 Rovai 重试。')
        callback.reject(oauthError(remoteError === 'access_denied'
          ? 'dingtalk_operation_cancelled' : 'dingtalk_oauth_failed'))
        return
      }
      const code = url.searchParams.get('authCode') ?? url.searchParams.get('code') ?? ''
      if (!code.trim()) {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('钉钉没有返回授权码，可以返回 Rovai 重试。')
        callback.reject(oauthError('dingtalk_oauth_response_invalid'))
        return
      }
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      }).end('<!doctype html><meta charset="utf-8"><title>Rovai</title><p>钉钉授权已完成，可以关闭此页并返回 Rovai。</p>')
      callback.resolve(code.trim())
    })

    try {
      const port = await listenLoopback(server)
      requireActiveOperation(signal)
      const redirectUri = `http://127.0.0.1:${port}/callback`
      const authorizationUrl = new URL(AUTHORIZE_URL)
      authorizationUrl.searchParams.set('redirect_uri', redirectUri)
      authorizationUrl.searchParams.set('response_type', 'code')
      authorizationUrl.searchParams.set('client_id', this.#clientId)
      authorizationUrl.searchParams.set('scope', OAUTH_SCOPE)
      authorizationUrl.searchParams.set('state', state)
      authorizationUrl.searchParams.set('prompt', 'consent')
      void this.#openExternal(authorizationUrl.toString()).catch(() => {
        callback.reject(oauthError('dingtalk_oauth_unavailable'))
      })
      return await waitForDeferred(callback, signal, OAUTH_TIMEOUT_MS)
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        throw oauthError('dingtalk_operation_cancelled')
      }
      if (error instanceof Error && error.message.startsWith('dingtalk_')) throw error
      throw oauthError('dingtalk_oauth_unavailable')
    } finally {
      await closeServer(server)
    }
  }

  async #requestTokenJson(body: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const bounded = boundedSignal(signal, 45_000)
    try {
      const response = await this.#fetch(TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: bounded.signal
      })
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => undefined)
        throw oauthError('dingtalk_oauth_unavailable')
      }
      const payload = await readBoundedJson(response)
      if (!response.ok) {
        const errorCode = firstString(asRecord(payload), 'error', 'code')
        if (errorCode === 'invalid_grant' && body.grantType === 'refresh_token') {
          throw oauthError('dingtalk_oauth_expired')
        }
        if (errorCode === 'invalid_client' || errorCode === 'unauthorized_client') {
          throw oauthError('dingtalk_oauth_client_rejected')
        }
        throw oauthError('dingtalk_oauth_failed')
      }
      return payload
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('dingtalk_')) throw error
      if (bounded.timedOut()) throw oauthError('dingtalk_oauth_timeout')
      if (isAbortError(error) || signal?.aborted) {
        throw oauthError('dingtalk_operation_cancelled')
      }
      throw oauthError('dingtalk_oauth_unavailable')
    } finally {
      bounded.dispose()
    }
  }

  #requireClient(): void {
    if (!this.#clientId || !this.#clientSecret) {
      throw oauthError('dingtalk_oauth_client_unconfigured')
    }
    requiredCanonical(this.#clientId, 'clientId')
    requiredSecret(this.#clientSecret, 'clientSecret')
  }
}

export class ElectronDingTalkDeveloperSessionService implements DingTalkDeveloperSessionService {
  readonly #clientId: string
  readonly #oauth: DingTalkOAuthBackend
  readonly #store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>
  #serial: Promise<void> = Promise.resolve()
  #loaded = false
  #revision: number | null = null
  #state: StoredDingTalkDeveloperSessions = emptyStoredSessions()
  #pendingRefresh: {
    state: StoredDingTalkDeveloperSessions
    profile: StoredOAuthProfile
  } | null = null
  #pendingLogin: {
    profile: StoredOAuthProfile
    replacement: StoredDingTalkDeveloperSessions
  } | null = null

  constructor(options: {
    oauthClientId?: string
    oauthClientSecret?: string
    oauth?: DingTalkOAuthBackend
    store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>
    transport?: DingTalkDeveloperApiTransport
    fetchImpl?: FetchLike
    openExternal?: (url: string) => Promise<unknown>
  }) {
    this.#clientId = options.oauthClientId?.trim() ?? ''
    this.#oauth = options.oauth ?? new DingTalkOAuthClient({
      clientId: options.oauthClientId,
      clientSecret: options.oauthClientSecret,
      transport: options.transport,
      fetchImpl: options.fetchImpl,
      openExternal: options.openExternal
    })
    this.#store = options.store
  }

  inspect(signal?: AbortSignal): Promise<DingTalkDeveloperIdentity | null> {
    return this.#exclusive(async () => {
      const active = await this.#activeProfile(signal)
      return active ? projectIdentity(active) : null
    })
  }

  beginLogin(options: {
    signal: AbortSignal
    onStage?(stage: DingTalkLoginStage): void
  }): Promise<DingTalkDeveloperIdentity> {
    return this.#exclusive(async () => {
      requireActiveOperation(options.signal)
      options.onStage?.('preparing')
      this.#pendingLogin = null
      options.onStage?.('awaiting_browser')
      const token = await this.#oauth.login({
        signal: options.signal
      })
      requireActiveOperation(options.signal)
      options.onStage?.('inspecting_identity')
      const identity = await this.#oauth.resolveIdentity(
        token.accessToken,
        token.corpId,
        options.signal
      )
      if (token.corpId && token.corpId !== identity.corpId) {
        throw oauthError('dingtalk_login_identity_mismatch')
      }
      const profile: StoredOAuthProfile = {
        ...token,
        corpId: identity.corpId,
        corpName: identity.corpName,
        userId: identity.userId,
        userName: identity.userName,
        clientId: this.#clientId
      }
      const stored = await this.#readState()
      requireActiveOperation(options.signal)
      const key = profileKey(profile)
      const profiles = stored.profiles.filter((candidate) => profileKey(candidate) !== key)
      profiles.push(profile)
      this.#pendingLogin = {
        profile,
        replacement: {
          schemaVersion: 1,
          currentProfileKey: key,
          profiles
        }
      }
      return projectIdentity(profile)
    })
  }

  pendingConnection(): PendingDingTalkDeveloperConnection {
    const pending = this.#pendingLogin
    if (!pending) throw oauthError('dingtalk_login_pending_session_missing')
    return {
      identity: identityRecord(pending.profile),
      session: pending.replacement
    }
  }

  activatePendingLogin(sessionRevision: number): Promise<void> {
    return this.#exclusive(async () => {
      const pending = this.#pendingLogin
      if (!pending) throw oauthError('dingtalk_login_pending_session_missing')
      this.#pendingLogin = null
      this.#pendingRefresh = null
      this.#state = pending.replacement
      this.#revision = sessionRevision
      this.#loaded = true
    })
  }

  discardPendingLogin(): Promise<DingTalkDeveloperIdentity | null> {
    return this.#exclusive(async () => {
      this.#pendingLogin = null
      const stored = await this.#readState()
      const active = stored.profiles.find((profile) => profileKey(profile) === stored.currentProfileKey)
      return active ? projectIdentity(active) : null
    })
  }

  accessToken(signal?: AbortSignal): Promise<string> {
    return this.#exclusive(async () => {
      const active = await this.#activeProfile(signal)
      if (!active) throw oauthError('dingtalk_oauth_expired')
      return active.accessToken
    })
  }

  disconnect(): Promise<void> {
    return this.#exclusive(async () => {
      this.#pendingLogin = null
      this.#pendingRefresh = null
      this.#state = emptyStoredSessions()
      this.#revision = null
      this.#loaded = true
    })
  }

  async #activeProfile(signal?: AbortSignal): Promise<StoredOAuthProfile | null> {
    requireActiveOperation(signal)
    if (this.#pendingRefresh) {
      await this.#savePendingRefresh()
    }
    const stored = await this.#readState()
    if (!stored.currentProfileKey) return null
    const index = stored.profiles.findIndex(
      (profile) => profileKey(profile) === stored.currentProfileKey
    )
    if (index < 0) throw oauthError('dingtalk_oauth_store_invalid')
    const profile = stored.profiles[index]!
    if (Date.parse(profile.accessTokenExpiresAt) > Date.now() + REFRESH_SKEW_MS) return profile
    if (!profile.refreshToken.trim() || Date.parse(profile.refreshTokenExpiresAt) <= Date.now()) {
      throw oauthError('dingtalk_oauth_expired')
    }
    if (this.#clientId && profile.clientId !== this.#clientId) {
      throw oauthError('dingtalk_oauth_client_rejected')
    }
    const refreshed = await this.#oauth.refresh(profile.refreshToken, signal)
    if (refreshed.corpId && refreshed.corpId !== profile.corpId) {
      throw oauthError('dingtalk_login_identity_mismatch')
    }
    const updated: StoredOAuthProfile = {
      ...profile,
      ...refreshed,
      corpId: profile.corpId,
      corpName: profile.corpName,
      userId: profile.userId,
      userName: profile.userName,
      clientId: profile.clientId
    }
    const profiles = [...stored.profiles]
    profiles[index] = updated
    // Refresh tokens can rotate remotely before the local write succeeds. Retain
    // the result in Main so retry saves it instead of exchanging the old token again.
    this.#pendingRefresh = { state: { ...stored, profiles }, profile: updated }
    await this.#persistState(this.#pendingRefresh.state, updated)
    this.#pendingRefresh = null
    return updated
  }

  async #readState(): Promise<StoredDingTalkDeveloperSessions> {
    if (this.#loaded) return this.#state
    const stored = await this.#store.read<DingTalkDeveloperIdentityRecord,
    StoredDingTalkDeveloperSessions>('dingtalk')
    if (!stored) {
      this.#loaded = true
      return this.#state
    }
    if (!isStoredSessions(stored.session)) throw oauthError('dingtalk_oauth_store_invalid')
    this.#state = stored.session
    this.#revision = stored.revision
    this.#loaded = true
    return this.#state
  }

  async #savePendingRefresh(): Promise<void> {
    const pending = this.#pendingRefresh
    if (!pending) return
    const stored = await this.#store.read<DingTalkDeveloperIdentityRecord,
    StoredDingTalkDeveloperSessions>('dingtalk')
    if (stored && !isStoredSessions(stored.session)) throw oauthError('dingtalk_oauth_store_invalid')
    if (!stored || stored.revision !== this.#revision) {
      // A lost commit response or a later connection/disconnect owns the newer
      // revision. Reload it instead of overwriting it with this refresh attempt.
      this.#state = stored?.session ?? emptyStoredSessions()
      this.#revision = stored?.revision ?? null
      this.#loaded = true
    } else {
      await this.#persistState(pending.state, pending.profile)
    }
    this.#pendingRefresh = null
  }

  async #persistState(
    state: StoredDingTalkDeveloperSessions,
    activeProfile: StoredOAuthProfile
  ): Promise<void> {
    if (this.#revision === null) throw oauthError('dingtalk_oauth_store_invalid')
    this.#revision = await this.#store.replace({
      provider: 'dingtalk',
      accountId: projectIdentity(activeProfile).accountId,
      identity: identityRecord(activeProfile),
      session: state,
      expectedRevision: this.#revision
    })
    this.#state = state
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#serial.then(operation, operation)
    this.#serial = result.then(() => undefined, () => undefined)
    return result
  }
}

function projectIdentity(profile: StoredOAuthProfile): DingTalkDeveloperIdentity {
  return {
    accountId: stableId('rvdta', profile.corpId, profile.userId),
    userIdDigest: digest('dingtalk-user', profile.userId),
    corpId: profile.corpId,
    userId: profile.userId,
    userName: profile.userName,
    corpName: profile.corpName,
    oauthProfileRef: `dingtalk-oauth:${stableId('profile', profile.corpId, profile.userId)}`,
    expiresAt: profile.accessTokenExpiresAt
  }
}

function identityRecord(profile: StoredOAuthProfile): DingTalkDeveloperIdentityRecord {
  return {
    corpId: profile.corpId,
    corpName: profile.corpName,
    userId: profile.userId,
    userName: profile.userName
  }
}

function emptyStoredSessions(): StoredDingTalkDeveloperSessions {
  return { schemaVersion: 1, currentProfileKey: null, profiles: [] }
}

function profileKey(identity: Pick<StoredOAuthProfile, 'corpId' | 'userId'>): string {
  return stableId('rvdtp', identity.corpId, identity.userId)
}

function isStoredSessions(value: unknown): value is StoredDingTalkDeveloperSessions {
  const root = asRecord(value)
  if (!root || root.schemaVersion !== 1 || !Array.isArray(root.profiles)) return false
  if (root.currentProfileKey !== null && typeof root.currentProfileKey !== 'string') return false
  const keys = new Set<string>()
  for (const candidate of root.profiles) {
    const profile = asRecord(candidate)
    if (!profile || !isStoredProfile(profile)) return false
    const key = profileKey(profile as StoredOAuthProfile)
    if (keys.has(key)) return false
    keys.add(key)
  }
  return root.currentProfileKey === null || keys.has(root.currentProfileKey)
}

function isStoredProfile(value: Record<string, unknown>): boolean {
  if (typeof value.refreshToken !== 'string' || value.refreshToken.includes('\0')) return false
  for (const key of [
    'accessToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt',
    'corpId', 'corpName', 'userId', 'userName', 'clientId'
  ]) {
    const candidate = value[key]
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.includes('\0')) return false
  }
  return Number.isFinite(Date.parse(value.accessTokenExpiresAt as string))
    && Number.isFinite(Date.parse(value.refreshTokenExpiresAt as string))
}

function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('loopback_address_unavailable'))
        return
      }
      resolve(address.port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function waitForDeferred<T>(
  value: {
    promise: Promise<T>
    resolve(value: T): void
    reject(error: unknown): void
  },
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = (operation: () => void): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      operation()
    }
    const onAbort = (): void => finish(() => reject(oauthError('dingtalk_operation_cancelled')))
    const timer = setTimeout(() => finish(() => reject(oauthError('dingtalk_oauth_timeout'))), timeoutMs)
    timer.unref?.()
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    value.promise.then(
      (result) => finish(() => resolve(result)),
      (error) => finish(() => reject(error))
    )
  })
}

function safeEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requireActiveOperation(signal?: AbortSignal): void {
  if (signal?.aborted) throw oauthError('dingtalk_operation_cancelled')
}
async function readBoundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > MAX_RESPONSE_BYTES) {
    throw oauthError('dingtalk_oauth_response_invalid')
  }
  const bytes = await readBoundedBytes(response, MAX_RESPONSE_BYTES)
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw oauthError('dingtalk_oauth_response_invalid')
  }
}

async function readBoundedBytes(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel().catch(() => undefined)
        throw oauthError('dingtalk_oauth_response_invalid')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstString(
  value: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  if (!value) return null
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function positiveNumber(
  value: Record<string, unknown> | null,
  ...keys: string[]
): number | null {
  if (!value) return null
  for (const key of keys) {
    const candidate = Number(value[key])
    if (Number.isFinite(candidate) && candidate > 0) return candidate
  }
  return null
}

function requiredCanonical(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized !== value || normalized.length > 4_096 || normalized.includes('\0')) {
    throw oauthError(`dingtalk_oauth_argument_invalid:${field}`)
  }
  return normalized
}

function requiredSecret(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 16_384 || normalized.includes('\0')) {
    throw oauthError(`dingtalk_oauth_argument_invalid:${field}`)
  }
  return normalized
}

function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal
  timedOut(): boolean
  dispose(): void
} {
  const controller = new AbortController()
  let timeout = false
  const onAbort = (): void => controller.abort(parent?.reason)
  if (parent?.aborted) controller.abort(parent.reason)
  else parent?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timeout = true
    controller.abort()
  }, timeoutMs)
  timer.unref?.()
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onAbort)
    }
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

function digest(namespace: string, value: string): string {
  return `sha256:${createHash('sha256').update(namespace).update('\0').update(value).digest('hex')}`
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`
}

function oauthError(code: string): Error {
  return new Error(code)
}
