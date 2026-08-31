import { createHash } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { ChannelLoginViewBounds } from '@contracts'
import type { SqliteChannelDeveloperSessionStore } from './channel-credential-store'
import {
  DingTalkConsoleError,
  ElectronDingTalkWebSession,
  requireDingTalkWebSession,
  type DingTalkWebIdentity,
  type DingTalkWebLoginOptions,
  type DingTalkWebLoginStage,
  type DingTalkWebSession,
  type StoredDingTalkWebSession
} from './dingtalk-web-session'

export type DingTalkDeveloperIdentity = DingTalkWebIdentity & {
  accountId: string
  userIdDigest: string
  // Retained Core wire field, not an OAuth token/profile. Never contains cookies.
  oauthProfileRef: string
  expiresAt: string | null
}

export type DingTalkLoginStage =
  | DingTalkWebLoginStage
  | 'loading_local_session'
  | 'saving_local_session'
  | 'connected'

export type PendingDingTalkDeveloperConnection = {
  identity: DingTalkWebIdentity
  session: StoredDingTalkWebSession
}

export type ExpectedDingTalkIdentity = Pick<DingTalkWebIdentity, 'corpId' | 'userId'>

export interface DingTalkDeveloperSessionService {
  inspect(signal?: AbortSignal): Promise<DingTalkDeveloperIdentity | null>
  beginLogin(options: {
    signal: AbortSignal
    onStage?(stage: DingTalkLoginStage): void
    onQrReady?: DingTalkWebLoginOptions['onQrReady']
  }): Promise<DingTalkDeveloperIdentity>
  setLoginViewBounds?(bounds: ChannelLoginViewBounds | null): void
  refreshLoginQr?(): void
  pendingConnection?(): PendingDingTalkDeveloperConnection
  activatePendingLogin?(sessionRevision: number): Promise<void>
  discardPendingLogin?(): Promise<DingTalkDeveloperIdentity | null>
  withConsoleSession?<T>(
    expected: ExpectedDingTalkIdentity,
    signal: AbortSignal | undefined,
    operation: (session: Pick<DingTalkWebSession, 'request'>) => Promise<T>
  ): Promise<T>
  disconnect(identity?: ExpectedDingTalkIdentity): Promise<void>
}

type LiveSession = PendingDingTalkDeveloperConnection & {
  web: DingTalkWebSession
  revision: number
  dirty: boolean
}

/** SQLite owns persistence; Chromium owns the platform's SSO and cookie rotation. */
export class ElectronDingTalkDeveloperSessionService implements DingTalkDeveloperSessionService {
  readonly #store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>
  readonly #newSession: () => DingTalkWebSession
  #serial: Promise<void> = Promise.resolve()
  #loaded = false
  #legacy = false
  #active: LiveSession | null = null
  #pending: (PendingDingTalkDeveloperConnection & { web: DingTalkWebSession }) | null = null
  #loggingIn: DingTalkWebSession | null = null

  constructor(options: {
    store: Pick<SqliteChannelDeveloperSessionStore, 'read' | 'replace'>
    getParentWindow?: () => BrowserWindow | null
    createSession?: () => DingTalkWebSession
  }) {
    this.#store = options.store
    this.#newSession = options.createSession
      ?? (() => new ElectronDingTalkWebSession({ getParentWindow: options.getParentWindow }))
  }

  inspect(signal?: AbortSignal): Promise<DingTalkDeveloperIdentity | null> {
    return this.#exclusive(async () => {
      const active = await this.#verifiedSession(undefined, signal)
      return active ? projectIdentity(active) : null
    })
  }

  beginLogin(options: {
    signal: AbortSignal
    onStage?(stage: DingTalkLoginStage): void
    onQrReady?: DingTalkWebLoginOptions['onQrReady']
  }): Promise<DingTalkDeveloperIdentity> {
    return this.#exclusive(async () => {
      requireActive(options.signal)
      options.onStage?.('preparing')
      await this.#pending?.web.close().catch(() => undefined)
      this.#pending = null
      const web = this.#newSession()
      this.#loggingIn = web
      try {
        const identity = await web.login(options)
        requireIdentity(identity)
        requireActive(options.signal)
        const session = await web.snapshot()
        requireDingTalkWebSession(session)
        requireActive(options.signal)
        this.#pending = { web, identity, session }
        return projectIdentity(this.#pending)
      } catch (error) {
        await web.close().catch(() => undefined)
        throw safeSessionError(error)
      } finally {
        if (this.#loggingIn === web) this.#loggingIn = null
      }
    })
  }

  // These presentation-only calls must not queue behind the pending login.
  setLoginViewBounds(bounds: ChannelLoginViewBounds | null): void { this.#loggingIn?.setLoginViewBounds?.(bounds) }

  refreshLoginQr(): void { this.#loggingIn?.refreshLoginQr?.() }

  pendingConnection(): PendingDingTalkDeveloperConnection {
    if (!this.#pending) throw sessionError('dingtalk_login_pending_session_missing')
    return structuredClone({ identity: this.#pending.identity, session: this.#pending.session })
  }

  activatePendingLogin(sessionRevision: number): Promise<void> {
    return this.#exclusive(async () => {
      if (!this.#pending || !Number.isSafeInteger(sessionRevision) || sessionRevision < 1) {
        throw sessionError('dingtalk_login_pending_session_missing')
      }
      const previous = this.#active
      // Called only after Core atomically commits account + session. A cancelled
      // or failed replacement never destroys the previously active cookie jar.
      this.#active = { ...this.#pending, revision: sessionRevision, dirty: false }
      this.#pending = null
      this.#loaded = true
      this.#legacy = false
      await previous?.web.close().catch(() => undefined)
    })
  }

  discardPendingLogin(): Promise<DingTalkDeveloperIdentity | null> {
    return this.#exclusive(async () => {
      await this.#pending?.web.close().catch(() => undefined)
      this.#pending = null
      await this.#load()
      return this.#active ? projectIdentity(this.#active) : null
    })
  }

  withConsoleSession<T>(
    expected: ExpectedDingTalkIdentity,
    signal: AbortSignal | undefined,
    operation: (session: Pick<DingTalkWebSession, 'request'>) => Promise<T>
  ): Promise<T> {
    return this.#exclusive(async () => {
      const active = await this.#verifiedSession(expected, signal)
      if (!active) throw sessionError('dingtalk_developer_session_expired')
      requireActive(signal)
      try {
        // Account switching cannot replace the jar halfway through this bounded
        // operation. Every operation revalidates the frozen corp + staff identity.
        return await operation(active.web)
      } finally {
        // Keep rotated cookies in memory on a storage failure. Never turn a
        // confirmed create response into an unknown outcome due to this write:
        // the caller must freeze its app ID before the next operation can fail.
        await this.#save(active).catch(() => { active.dirty = true })
      }
    })
  }

  disconnect(): Promise<void> {
    return this.#exclusive(async () => {
      const sessions = [this.#pending?.web, this.#active?.web]
      this.#pending = null
      this.#active = null
      this.#loaded = true
      this.#legacy = false
      await Promise.all(sessions.map((web) => web?.close().catch(() => undefined)))
    })
  }

  async #verifiedSession(
    expected: ExpectedDingTalkIdentity | undefined,
    signal?: AbortSignal
  ): Promise<LiveSession | null> {
    requireActive(signal)
    await this.#load()
    await this.#flushDirty()
    if (this.#legacy) throw sessionError('dingtalk_legacy_session_requires_reconnect')
    const active = this.#active
    if (!active) return null
    if (expected) requireSameIdentity(expected, active.identity)
    const identity = await active.web.inspect(signal)
    requireIdentity(identity)
    requireSameIdentity(active.identity, identity)
    requireActive(signal)
    active.identity = identity
    await this.#save(active)
    return active
  }

  async #load(): Promise<void> {
    if (this.#loaded) return
    const stored = await this.#store.read<DingTalkWebIdentity, unknown>('dingtalk')
    await this.#adopt(stored)
  }

  async #adopt(stored: {
    accountId: string
    identity: DingTalkWebIdentity
    session: unknown
    revision: number
  } | null): Promise<void> {
    const previous = this.#active
    if (!stored) {
      this.#active = null
      this.#legacy = false
    } else {
      requireIdentity(stored.identity)
      if (stored.accountId !== accountId(stored.identity)) {
        throw sessionError('dingtalk_web_session_store_invalid')
      }
      if (isLegacySession(stored.session)) {
        // OAuth profiles cannot become browser cookies. Retain the old SQLite row
        // until an explicit successful reconnect atomically replaces it.
        this.#active = null
        this.#legacy = true
      } else {
        requireDingTalkWebSession(stored.session)
        const web = this.#newSession()
        try { await web.restore(stored.session) } catch {
          await web.close().catch(() => undefined)
          throw sessionError('dingtalk_web_session_store_invalid')
        }
        this.#active = {
          web, identity: stored.identity, session: stored.session,
          revision: stored.revision, dirty: false
        }
        this.#legacy = false
      }
    }
    this.#loaded = true
    await previous?.web.close().catch(() => undefined)
  }

  async #flushDirty(): Promise<void> {
    const active = this.#active
    if (!active?.dirty) return
    const stored = await this.#store.read<DingTalkWebIdentity, unknown>('dingtalk')
    if (!stored || stored.revision !== active.revision) {
      // A lost commit response or a newer connection owns the new revision. Never
      // replay an old jar over a newer account or a deliberate disconnect.
      await this.#adopt(stored)
    } else {
      await this.#save(active)
    }
  }

  async #save(active: LiveSession): Promise<void> {
    try {
      const session = await active.web.snapshot()
      requireDingTalkWebSession(session)
      if (!active.dirty && JSON.stringify(active.session) === JSON.stringify(session)) return
      active.dirty = true
      const revision = await this.#store.replace({
        provider: 'dingtalk', accountId: accountId(active.identity),
        identity: active.identity, session, expectedRevision: active.revision
      })
      active.session = session
      active.revision = revision
      active.dirty = false
    } catch {
      active.dirty = true
      throw sessionError('dingtalk_web_session_store_unavailable')
    }
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#serial.then(operation, operation)
    this.#serial = result.then(() => undefined, () => undefined)
    return result
  }
}

function projectIdentity(value: PendingDingTalkDeveloperConnection): DingTalkDeveloperIdentity {
  const expiry = value.session.cookies.find((cookie) => cookie.name === 'access_token')?.expirationDate
  return {
    ...value.identity,
    accountId: accountId(value.identity),
    userIdDigest: `sha256:${createHash('sha256').update('dingtalk-user').update('\0')
      .update(value.identity.userId).digest('hex')}`,
    oauthProfileRef: `dingtalk-web:${stableId('profile', value.identity.corpId, value.identity.userId)}`,
    expiresAt: expiry === undefined ? null : new Date(expiry * 1_000).toISOString()
  }
}

function accountId(identity: ExpectedDingTalkIdentity): string {
  return stableId('rvdta', identity.corpId, identity.userId)
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`
}

function requireIdentity(value: unknown): asserts value is DingTalkWebIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw sessionError('dingtalk_login_identity_unavailable')
  }
  const record = value as Record<string, unknown>
  for (const key of ['corpId', 'corpName', 'userId', 'userName']) {
    const field = record[key]
    if (typeof field !== 'string' || !field.trim() || field.length > 512 || field.includes('\0')) {
      throw sessionError('dingtalk_login_identity_unavailable')
    }
  }
}

function requireSameIdentity(expected: ExpectedDingTalkIdentity, actual: DingTalkWebIdentity): void {
  if (expected.corpId !== actual.corpId || expected.userId !== actual.userId) {
    throw sessionError('dingtalk_login_identity_mismatch')
  }
}

function isLegacySession(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === 1
    && Array.isArray((value as Record<string, unknown>).profiles)
}

function requireActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw sessionError('dingtalk_operation_cancelled')
}

function safeSessionError(error: unknown): Error {
  return error instanceof DingTalkConsoleError ? error : sessionError('dingtalk_open_platform_unavailable')
}

function sessionError(code: string): DingTalkConsoleError {
  return new DingTalkConsoleError(code, true)
}
