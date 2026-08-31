import { describe, expect, it, vi } from 'vitest'
import { ElectronDingTalkDeveloperSessionService } from './dingtalk-developer-session'
import type { StoredChannelDeveloperSession } from './channel-credential-store'
import { DingTalkConsoleError, type DingTalkWebIdentity, type DingTalkWebSession, type StoredDingTalkWebSession } from './dingtalk-web-session'

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), session: { fromPartition: vi.fn() } }))

describe('Main-owned DingTalk Web Session', () => {
  it('stages cookies and projects no credential material until Core commits the connection', async () => {
    const f = fixture()
    const stages: string[] = []
    const connected = await f.service.beginLogin({ signal: signal(), onStage: (stage) => stages.push(stage) })
    expect(connected).toMatchObject(owner)
    expect(connected.accountId).toMatch(/^rvdta_[a-f0-9]{32}$/u)
    expect(connected.oauthProfileRef).toMatch(/^dingtalk-web:/u)
    expect(connected.userIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(JSON.stringify(connected)).not.toContain('cookie-secret')
    expect(f.store.record).toBeNull()
    expect(stages).toEqual(['preparing', 'awaiting_scan', 'inspecting_identity'])
    await commit(f.service, f.store, connected.accountId)
    expect(f.store.record?.session).toEqual(cookieJar())
  })

  it('restores a SQLite cookie jar after restart without opening login again', async () => {
    const f = await connectedFixture()
    const restarted = fixture(f.store)
    expect(await restarted.service.inspect()).toEqual(f.identity)
    expect(restarted.webs[0]!.restore).toHaveBeenCalledWith(cookieJar())
    expect(restarted.webs[0]!.login).not.toHaveBeenCalled()
  })

  it('forwards QR presentation and viewport controls without waiting for the login queue', async () => {
    const web = webFixture(owner)
    const store = new MemoryStore()
    const service = new ElectronDingTalkDeveloperSessionService({ store, createSession: () => web })
    let complete!: (identity: DingTalkWebIdentity) => void
    const pending = new Promise<DingTalkWebIdentity>((resolve) => { complete = resolve })
    web.login.mockImplementationOnce(async (options) => {
      options.onStage?.('awaiting_scan')
      options.onQrReady?.({ payload: 'data:image/png;base64,aW1hZ2U=', expiresAt: null })
      return pending
    })
    const onQrReady = vi.fn()
    const connecting = service.beginLogin({ signal: signal(), onQrReady })
    await vi.waitFor(() => expect(onQrReady).toHaveBeenCalledOnce())
    const bounds = { x: 20, y: 80, width: 600, height: 400 }
    service.setLoginViewBounds(bounds)
    service.refreshLoginQr()
    expect(web.setLoginViewBounds).toHaveBeenCalledExactlyOnceWith(bounds)
    expect(web.refreshLoginQr).toHaveBeenCalledOnce()
    expect(store.record).toBeNull()
    expect(web.request).not.toHaveBeenCalled()

    complete(owner)
    await connecting
    service.setLoginViewBounds(bounds)
    service.refreshLoginQr()
    expect(web.setLoginViewBounds).toHaveBeenCalledOnce()
    expect(web.refreshLoginQr).toHaveBeenCalledOnce()
    await service.discardPendingLogin()
    expect(store.record).toBeNull()
  })

  it.each(['dingtalk_open_platform_unavailable', 'dingtalk_open_platform_timeout', 'dingtalk_developer_session_expired'])(
    'reports %s distinctly without deleting the stored session', async (code) => {
      const f = await connectedFixture()
      const before = structuredClone(f.store.record)
      f.webs[0]!.inspect.mockRejectedValueOnce(new DingTalkConsoleError(code))
      await expect(f.service.inspect()).rejects.toThrow(code)
      expect(f.store.record).toEqual(before)
      await expect(f.service.inspect()).resolves.toMatchObject(owner)
      expect(f.webs[0]!.login).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['dingtalk_operation_cancelled', 'dingtalk_open_platform_unavailable', 'dingtalk_login_timeout'])(
    'keeps the previous jar when a replacement login fails: %s', async (code) => {
      const f = await connectedFixture()
      f.nextLoginError = code
      const before = structuredClone(f.store.record)
      await expect(f.service.beginLogin({ signal: signal() })).rejects.toThrow(code)
      expect(await f.service.discardPendingLogin()).toEqual(f.identity)
      expect(f.store.record).toEqual(before)
      expect(f.webs[0]!.close).not.toHaveBeenCalled()
      expect(f.webs[1]!.close).toHaveBeenCalledOnce()
    }
  )

  it('keeps the old account active until a successful pending connection is activated', async () => {
    const f = await connectedFixture()
    f.nextIdentity = other
    const pending = await f.service.beginLogin({ signal: signal() })
    expect(await f.service.inspect()).toMatchObject(owner)
    expect(f.store.record?.identity).toEqual(owner)
    await commit(f.service, f.store, pending.accountId)
    expect(await f.service.inspect()).toMatchObject(other)
    expect(f.webs[0]!.close).toHaveBeenCalledOnce()
  })

  it('discards a late identity after cancellation without changing the active account', async () => {
    const f = await connectedFixture()
    const abort = new AbortController()
    f.afterLogin = () => abort.abort()
    await expect(f.service.beginLogin({ signal: abort.signal })).rejects.toThrow('dingtalk_operation_cancelled')
    expect(() => f.service.pendingConnection()).toThrow('dingtalk_login_pending_session_missing')
    expect(await f.service.inspect()).toEqual(f.identity)
  })

  it.each(['wrong_expected', 'remote_changed'])(
    'fails closed before a console mutation on identity mismatch: %s', async (change) => {
      const f = await connectedFixture()
      if (change === 'remote_changed') f.webs[0]!.inspect.mockResolvedValueOnce(other)
      const operation = vi.fn(async () => ({}))
      await expect(f.service.withConsoleSession(
        change === 'wrong_expected' ? other : owner, undefined, operation
      )).rejects.toThrow('dingtalk_login_identity_mismatch')
      expect(operation).not.toHaveBeenCalled()
    }
  )

  it('persists server-rotated cookies and reuses the same in-memory rotation after a storage failure', async () => {
    const f = await connectedFixture()
    f.webs[0]!.inspect.mockImplementationOnce(async () => {
      f.webs[0]!.jar = cookieJar('rotated-secret')
      return owner
    })
    f.store.failWrites = 1
    await expect(f.service.inspect()).rejects.toThrow('dingtalk_web_session_store_unavailable')
    expect(f.store.record?.session).toEqual(cookieJar())
    expect(await f.service.inspect()).toMatchObject(owner)
    expect(f.store.record?.session).toEqual(cookieJar('rotated-secret'))
    expect(f.webs[0]!.login).toHaveBeenCalledTimes(1)
    expect(f.store.record?.revision).toBe(2)
  })

  it('adopts a lost commit response instead of replaying an old revision', async () => {
    const f = await connectedFixture()
    f.webs[0]!.jar = cookieJar('rotated-secret')
    f.store.loseResponse = true
    await expect(f.service.inspect()).rejects.toThrow('dingtalk_web_session_store_unavailable')
    expect(f.store.record?.revision).toBe(2)
    await expect(f.service.inspect()).resolves.toMatchObject(owner)
    expect(f.store.record?.revision).toBe(2)
    expect(f.webs[1]!.restore).toHaveBeenCalledWith(cookieJar('rotated-secret'))
  })

  it.each(['disconnect', 'replacement'])(
    'never overwrites a newer %s while retrying a cookie write', async (change) => {
      const f = await connectedFixture()
      f.webs[0]!.jar = cookieJar('stale-rotation')
      f.store.failWrites = 1
      await expect(f.service.inspect()).rejects.toThrow('dingtalk_web_session_store_unavailable')
      if (change === 'disconnect') f.store.record = null
      else {
        const newer = fixture(f.store)
        newer.nextIdentity = other
        const identity = await newer.service.beginLogin({ signal: signal() })
        await commit(newer.service, f.store, identity.accountId)
        f.nextIdentity = other
      }
      const before = structuredClone(f.store.record)
      const restored = await f.service.inspect()
      expect(restored?.corpId ?? null).toBe(change === 'disconnect' ? null : other.corpId)
      expect(f.store.record).toEqual(before)
    }
  )

  it('returns a confirmed app ID even if saving its rotated cookie fails, then blocks subsequent writes', async () => {
    const f = await connectedFixture()
    const created = await f.service.withConsoleSession(owner, undefined, async () => {
      f.webs[0]!.jar = cookieJar('rotated-on-create')
      f.store.failWrites = 2
      return { unifiedAppId: 'app-already-created' }
    })
    expect(created.unifiedAppId).toBe('app-already-created')
    const next = vi.fn(async () => ({}))
    await expect(f.service.withConsoleSession(owner, undefined, next))
      .rejects.toThrow('dingtalk_web_session_store_unavailable')
    expect(next).not.toHaveBeenCalled()
    await expect(f.service.inspect()).resolves.toMatchObject(owner)
    expect(f.store.record?.session).toEqual(cookieJar('rotated-on-create'))
  })

  it('retains legacy OAuth rows without attempting a conversion, and replaces them only on reconnect', async () => {
    const f = await connectedFixture()
    f.store.record!.session = { schemaVersion: 1, currentProfileKey: 'legacy-profile', profiles: [{ accessToken: 'old-secret' }] }
    const old = structuredClone(f.store.record)
    const restarted = fixture(f.store)
    await expect(restarted.service.inspect()).rejects.toThrow('dingtalk_legacy_session_requires_reconnect')
    expect(f.store.record).toEqual(old)
    expect(restarted.webs).toHaveLength(0)
    const replacement = await restarted.service.beginLogin({ signal: signal() })
    await commit(restarted.service, f.store, replacement.accountId)
    expect(f.store.record?.session).toEqual(cookieJar())
    expect(replacement.accountId).toBe(f.identity.accountId)
  })

  it('does not cache a corrupt row as an absent login after a decode failure', async () => {
    const f = await connectedFixture()
    const valid = structuredClone(f.store.record)
    f.store.record!.session = { schemaVersion: 99 }
    const restarted = fixture(f.store)
    await expect(restarted.service.inspect()).rejects.toThrow('dingtalk_web_session_store_invalid')
    f.store.record = valid
    expect(await restarted.service.inspect()).toEqual(f.identity)
  })

  it('serializes console operations with account switching and refresh', async () => {
    const f = await connectedFixture()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const first = f.service.withConsoleSession(owner, undefined, async () => { await barrier; return 1 })
    const second = vi.fn(async () => 2)
    const pending = f.service.withConsoleSession(owner, undefined, second)
    await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
    release()
    expect(await Promise.all([first, pending])).toEqual([1, 2])
  })

  it('closes only local jars on disconnect; Core owns the durable disconnect transaction', async () => {
    const f = await connectedFixture()
    const before = structuredClone(f.store.record)
    await f.service.disconnect()
    expect(await f.service.inspect()).toBeNull()
    expect(f.store.record).toEqual(before)
    expect(f.webs[0]!.close).toHaveBeenCalledOnce()
    expect(f.webs[0]!.request).not.toHaveBeenCalled()
  })
})

const owner: DingTalkWebIdentity = { corpId: 'corp-1', userId: 'staff-1', corpName: '测试企业', userName: 'Murray' }
const other: DingTalkWebIdentity = { corpId: 'corp-2', userId: 'staff-2', corpName: '其他企业', userName: 'Other' }
const signal = (): AbortSignal => new AbortController().signal

function cookieJar(secret = 'cookie-secret'): StoredDingTalkWebSession {
  return { schemaVersion: 2, cookies: [{ name: 'access_token', value: secret,
    domain: '.dingtalk.com', path: '/', secure: true, httpOnly: true,
    sameSite: 'lax', session: false, expirationDate: 4_070_908_800 }] }
}

function fixture(store = new MemoryStore()) {
  const f = {
    store, nextIdentity: owner, nextLoginError: '', afterLogin: () => {},
    webs: [] as ReturnType<typeof webFixture>[],
    service: null as unknown as ElectronDingTalkDeveloperSessionService
  }
  f.service = new ElectronDingTalkDeveloperSessionService({ store, createSession: () => {
    const web = webFixture(f.nextIdentity)
    if (f.nextLoginError) web.login.mockRejectedValueOnce(new DingTalkConsoleError(f.nextLoginError))
    else web.login.mockImplementation(async (options) => {
      options.onStage?.('awaiting_scan')
      options.onStage?.('inspecting_identity')
      f.afterLogin()
      return f.nextIdentity
    })
    f.webs.push(web)
    return web
  } })
  return f
}

function webFixture(identity: DingTalkWebIdentity) {
  let jar = cookieJar()
  const web = {
    get jar(): StoredDingTalkWebSession { return jar },
    set jar(value: StoredDingTalkWebSession) { jar = value },
    login: vi.fn<DingTalkWebSession['login']>(async () => identity),
    setLoginViewBounds: vi.fn<NonNullable<DingTalkWebSession['setLoginViewBounds']>>(),
    refreshLoginQr: vi.fn<NonNullable<DingTalkWebSession['refreshLoginQr']>>(),
    inspect: vi.fn<DingTalkWebSession['inspect']>(async () => identity),
    restore: vi.fn<DingTalkWebSession['restore']>(async (stored) => { jar = structuredClone(stored) }),
    snapshot: vi.fn<DingTalkWebSession['snapshot']>(async () => structuredClone(jar)),
    request: vi.fn<DingTalkWebSession['request']>(async () => ({})),
    close: vi.fn<DingTalkWebSession['close']>(async () => {})
  }
  return web
}

async function connectedFixture() {
  const f = fixture()
  const identity = await f.service.beginLogin({ signal: signal() })
  await commit(f.service, f.store, identity.accountId)
  return Object.assign(f, { identity })
}

async function commit(service: ElectronDingTalkDeveloperSessionService, store: MemoryStore, accountId: string) {
  const pending = service.pendingConnection()
  const revision = (store.record?.revision ?? 0) + 1
  store.record = { ...structuredClone(pending), provider: 'dingtalk', accountId, revision }
  await service.activatePendingLogin(revision)
}

class MemoryStore {
  record: StoredChannelDeveloperSession<DingTalkWebIdentity, unknown> | null = null
  failWrites = 0
  loseResponse = false
  async read<TIdentity, TSession>(): Promise<StoredChannelDeveloperSession<TIdentity, TSession> | null> {
    return structuredClone(this.record) as StoredChannelDeveloperSession<TIdentity, TSession> | null
  }
  async replace<TIdentity, TSession>(input: {
    provider: 'feishu' | 'dingtalk'; accountId: string; identity: TIdentity;
    session: TSession; expectedRevision: number | null
  }): Promise<number> {
    if (this.failWrites > 0) { this.failWrites -= 1; throw new Error('sqlite-unavailable') }
    if (this.record?.revision !== input.expectedRevision) throw new Error('revision-conflict')
    const revision = (this.record?.revision ?? 0) + 1
    this.record = structuredClone({ ...input, revision }) as StoredChannelDeveloperSession<DingTalkWebIdentity, unknown>
    if (this.loseResponse) { this.loseResponse = false; throw new Error('response-lost') }
    return revision
  }
}
