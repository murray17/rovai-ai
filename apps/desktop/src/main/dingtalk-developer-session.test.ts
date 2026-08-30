import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DingTalkOAuthClient,
  ElectronDingTalkDeveloperSessionService,
  type PendingDingTalkDeveloperConnection,
  type DingTalkOAuthBackend,
  type DingTalkOAuthTokenSet,
  type StoredDingTalkDeveloperSessions
} from './dingtalk-developer-session'

describe('Electron DingTalk developer session', () => {
  it('stores a direct OAuth login and projects no credential material', async () => {
    const store = new MemoryStore()
    const oauth = oauthBackend([
      [token('access-a', 'refresh-a', 'corp-1'), identity('corp-1', 'owner-1')]
    ])
    const service = session(store, oauth)
    const stages: string[] = []

    const connected = await service.beginLogin({
      signal: new AbortController().signal,
      onStage: (stage) => { stages.push(stage) }
    })

    expect(connected).toMatchObject({
      corpId: 'corp-1', userId: 'owner-1', userName: 'Murray', corpName: '星海科技'
    })
    expect(connected.accountId).toMatch(/^rvdta_[a-f0-9]{32}$/u)
    expect(connected.userIdDigest).toMatch(/^sha256:[a-f0-9]{64}$/u)
    expect(JSON.stringify(connected)).not.toContain('access-a')
    expect(JSON.stringify(connected)).not.toContain('refresh-a')
    expect(store.state).toBeNull()
    await commitPending(service, store, connected.accountId)
    expect(store.state?.profiles[0]).toMatchObject({
      accessToken: 'access-a', refreshToken: 'refresh-a', clientId: 'oauth-client'
    })
    expect(stages).toEqual([
      'preparing', 'awaiting_browser', 'inspecting_identity'
    ])
  })

  it('keeps a replacement staged until Core commits it', async () => {
    const store = new MemoryStore()
    const oauth = oauthBackend([
      [token('access-a', 'refresh-a', 'corp-a'), identity('corp-a', 'owner-a')],
      [token('access-b', 'refresh-b', 'corp-b'), identity('corp-b', 'owner-b')]
    ])
    const service = session(store, oauth)
    const signal = new AbortController().signal
    const first = await service.beginLogin({ signal })
    await commitPending(service, store, first.accountId)
    await service.beginLogin({ signal })

    expect(store.state?.profiles).toHaveLength(1)
    await service.discardPendingLogin()
    await expect(service.inspect()).resolves.toMatchObject({
      corpId: 'corp-a', userId: 'owner-a'
    })

    await service.disconnect()
    await expect(service.inspect()).resolves.toBeNull()
  })

  it('rotates an expired access token through the SQLite-backed session store', async () => {
    const store = new MemoryStore()
    const expired = token('access-old', 'refresh-old', 'corp-1')
    expired.accessTokenExpiresAt = '2020-01-01T00:00:00.000Z'
    const oauth = oauthBackend([
      [expired, identity('corp-1', 'owner-1')]
    ])
    const refresh = vi.mocked(oauth.refresh)
    refresh.mockResolvedValue(token('access-new', 'refresh-new', 'corp-1'))
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)

    await expect(service.accessToken()).resolves.toBe('access-new')
    expect(refresh).toHaveBeenCalledWith('refresh-old', undefined)
    expect(store.state?.profiles[0]).toMatchObject({
      accessToken: 'access-new', refreshToken: 'refresh-new'
    })
  })

  it('restores an existing schema-1 profile after restart without opening another login', async () => {
    const store = new MemoryStore()
    const oauth = oauthBackend([[token('access-a', 'refresh-a', 'corp-a'), identity('corp-a', 'owner-a')]])
    const first = session(store, oauth)
    const connected = await first.beginLogin({ signal: new AbortController().signal })
    await commitPending(first, store, connected.accountId)
    const restarted = session(store, oauth)

    await expect(restarted.inspect()).resolves.toEqual(connected)
    await expect(restarted.accessToken()).resolves.toBe('access-a')
    expect(oauth.login).toHaveBeenCalledTimes(1)
    expect(oauth.refresh).not.toHaveBeenCalled()
  })

  it.each(['dingtalk_oauth_unavailable', 'dingtalk_oauth_timeout'])(
    'preserves the stored profile after %s and silently refreshes on retry',
    async (code) => {
      const store = new MemoryStore()
      const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
      const oauth = oauthBackend([[expired, identity('corp-a', 'owner-a')]])
      const first = session(store, oauth)
      const connected = await first.beginLogin({ signal: new AbortController().signal })
      await commitPending(first, store, connected.accountId)
      const before = structuredClone(store.record)
      vi.mocked(oauth.refresh).mockRejectedValueOnce(new Error(code))
        .mockResolvedValueOnce(token('access-new', 'refresh-new', 'corp-a'))
      const restarted = session(store, oauth)

      await expect(restarted.inspect()).rejects.toThrow(code)
      expect(store.record).toEqual(before)
      await expect(restarted.accessToken()).resolves.toBe('access-new')
      await expect(session(store, oauth).accessToken()).resolves.toBe('access-new')
      expect(oauth.login).toHaveBeenCalledTimes(1)
    }
  )

  it('retains a rotated token in Main until SQLite can save it, without refreshing the old token twice', async () => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([[expired, identity('corp-a', 'owner-a')]])
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)
    vi.mocked(oauth.refresh).mockResolvedValueOnce(token('access-new', 'refresh-new', 'corp-a'))
      .mockRejectedValueOnce(new Error('dingtalk_oauth_expired'))
    vi.spyOn(store, 'replace').mockRejectedValueOnce(new Error('channel_storage_unavailable'))

    await expect(service.accessToken()).rejects.toThrow('channel_storage_unavailable')
    expect(store.state?.profiles[0]?.refreshToken).toBe('refresh-old')
    await expect(service.accessToken()).resolves.toBe('access-new')
    expect(store.state?.profiles[0]?.refreshToken).toBe('refresh-new')
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it('does not reinterpret a failed local session decode as an absent login on the next read', async () => {
    const store = new MemoryStore()
    const oauth = oauthBackend([[token('access-a', 'refresh-a', 'corp-a'), identity('corp-a', 'owner-a')]])
    const first = session(store, oauth)
    const connected = await first.beginLogin({ signal: new AbortController().signal })
    await commitPending(first, store, connected.accountId)
    const valid = structuredClone(store.record!)
    store.record!.session.schemaVersion = 99 as 1
    const restarted = session(store, oauth)

    await expect(restarted.inspect()).rejects.toThrow('dingtalk_oauth_store_invalid')
    store.record = valid
    await expect(restarted.inspect()).resolves.toEqual(connected)
    expect(oauth.login).toHaveBeenCalledTimes(1)
  })

  it.each(['local_expiry', 'revoked'] as const)('allows explicit browser reconnection after %s', async (reason) => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'),
      accessTokenExpiresAt: '2020-01-01T00:00:00Z',
      ...(reason === 'local_expiry' ? { refreshTokenExpiresAt: '2020-01-01T00:00:00Z' } : {}) }
    const oauth = oauthBackend([
      [expired, identity('corp-a', 'owner-a')],
      [token('access-new', 'refresh-new', 'corp-a'), identity('corp-a', 'owner-a')]
    ])
    vi.mocked(oauth.refresh).mockRejectedValueOnce(new Error('dingtalk_oauth_expired'))
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)

    await expect(service.inspect()).rejects.toThrow('dingtalk_oauth_expired')
    expect(oauth.login).toHaveBeenCalledTimes(1)
    expect(oauth.refresh).toHaveBeenCalledTimes(reason === 'local_expiry' ? 0 : 1)
    await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)
    await expect(session(store, oauth).accessToken()).resolves.toBe('access-new')
  })

  it.each(['dingtalk_operation_cancelled', 'dingtalk_oauth_unavailable', 'dingtalk_oauth_timeout'])(
    'keeps the previous profile on a replacement login failure: %s',
    async (code) => {
      const store = new MemoryStore()
      const oauth = oauthBackend([[token('access-a', 'refresh-a', 'corp-a'), identity('corp-a', 'owner-a')]])
      const service = session(store, oauth)
      const connected = await service.beginLogin({ signal: new AbortController().signal })
      await commitPending(service, store, connected.accountId)
      const before = structuredClone(store.record)
      vi.mocked(oauth.login).mockRejectedValueOnce(new Error(code))

      await expect(service.beginLogin({ signal: new AbortController().signal })).rejects.toThrow(code)
      await expect(service.discardPendingLogin()).resolves.toEqual(connected)
      expect(store.record).toEqual(before)
      await expect(session(store, oauth).accessToken()).resolves.toBe('access-a')
    }
  )

  it('discards a late browser identity after cancellation without refreshing the old session', async () => {
    const store = new MemoryStore()
    const expired = { ...token('access-a', 'refresh-a', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([
      [expired, identity('corp-a', 'owner-a')],
      [token('access-b', 'refresh-b', 'corp-b'), identity('corp-b', 'owner-b')]
    ])
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)
    const before = structuredClone(store.record)
    const abort = new AbortController()
    vi.mocked(oauth.resolveIdentity).mockImplementationOnce(async () => {
      abort.abort()
      return identity('corp-b', 'owner-b')
    })

    await expect(service.beginLogin({ signal: abort.signal })).rejects.toThrow('dingtalk_operation_cancelled')
    await expect(service.discardPendingLogin()).resolves.toEqual(connected)
    expect(() => service.pendingConnection()).toThrow('dingtalk_login_pending_session_missing')
    expect(store.record).toEqual(before)
    expect(oauth.refresh).not.toHaveBeenCalled()
  })

  it('serializes concurrent reads into one silent refresh', async () => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([[expired, identity('corp-a', 'owner-a')]])
    vi.mocked(oauth.refresh).mockResolvedValue(token('access-new', 'refresh-new', 'corp-a'))
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)

    const [inspected, firstToken, secondToken] = await Promise.all([
      service.inspect(), service.accessToken(), service.accessToken()
    ])
    expect(inspected?.accountId).toBe(connected.accountId)
    expect([firstToken, secondToken]).toEqual(['access-new', 'access-new'])
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
    expect(store.record?.revision).toBe(2)
  })

  it('requires reconnection when an expired access token has no usable refresh token', async () => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([[expired, identity('corp-a', 'owner-a')]])
    const first = session(store, oauth)
    const connected = await first.beginLogin({ signal: new AbortController().signal })
    await commitPending(first, store, connected.accountId)
    store.record!.session.profiles[0]!.refreshToken = ''

    await expect(session(store, oauth).inspect()).rejects.toThrow('dingtalk_oauth_expired')
    expect(oauth.refresh).not.toHaveBeenCalled()
    expect(oauth.login).toHaveBeenCalledTimes(1)
  })

  it('does not send an existing refresh token through a different configured OAuth Client', async () => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([[expired, identity('corp-a', 'owner-a')]])
    const first = session(store, oauth)
    const connected = await first.beginLogin({ signal: new AbortController().signal })
    await commitPending(first, store, connected.accountId)
    const before = structuredClone(store.record)
    const changed = new ElectronDingTalkDeveloperSessionService({ oauthClientId: 'other-client', oauth, store })

    await expect(changed.inspect()).rejects.toThrow('dingtalk_oauth_client_rejected')
    expect(oauth.refresh).not.toHaveBeenCalled()
    expect(store.record).toEqual(before)
  })

  it('recovers a lost SQLite commit response by reading back the rotated token', async () => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([[expired, identity('corp-a', 'owner-a')]])
    vi.mocked(oauth.refresh).mockResolvedValue(token('access-new', 'refresh-new', 'corp-a'))
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)
    const replace = store.replace.bind(store)
    const save = vi.spyOn(store, 'replace').mockImplementationOnce(async (input) => {
      await replace(input)
      throw new Error('channel_storage_response_lost')
    })

    await expect(service.accessToken()).rejects.toThrow('channel_storage_response_lost')
    await expect(service.accessToken()).resolves.toBe('access-new')
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it.each(['new_login', 'disconnect'] as const)('does not overwrite %s when retrying a pending refresh save', async (change) => {
    const store = new MemoryStore()
    const expired = { ...token('access-old', 'refresh-old', 'corp-a'), accessTokenExpiresAt: '2020-01-01T00:00:00Z' }
    const oauth = oauthBackend([
      [expired, identity('corp-a', 'owner-a')],
      [token('access-b', 'refresh-b', 'corp-b'), identity('corp-b', 'owner-b')]
    ])
    vi.mocked(oauth.refresh).mockResolvedValue(token('access-new', 'refresh-new', 'corp-a'))
    const service = session(store, oauth)
    const connected = await service.beginLogin({ signal: new AbortController().signal })
    await commitPending(service, store, connected.accountId)
    vi.spyOn(store, 'replace').mockRejectedValueOnce(new Error('channel_storage_unavailable'))
    await expect(service.accessToken()).rejects.toThrow('channel_storage_unavailable')

    if (change === 'new_login') {
      const replacement = session(store, oauth)
      const owner = await replacement.beginLogin({ signal: new AbortController().signal })
      await commitPending(replacement, store, owner.accountId)
    } else store.record = null
    const before = structuredClone(store.record)

    if (change === 'new_login') await expect(service.accessToken()).resolves.toBe('access-b')
    else await expect(service.inspect()).resolves.toBeNull()
    expect(store.record).toEqual(before)
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('DingTalk OAuth protocol', () => {
  afterEach(() => vi.useRealTimers())
  it('completes browser OAuth through a state-bound loopback callback', async () => {
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _request?: RequestInit
    ) => jsonResponse({
      accessToken: 'owner-access',
      refreshToken: 'owner-refresh',
      expiresIn: 7200,
      corpId: 'corp-1'
    }))
    let openedUrl = ''
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client',
      clientSecret: 'oauth-secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
      openExternal: async (value) => {
        openedUrl = value
        const authorization = new URL(value)
        const callback = new URL(authorization.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', authorization.searchParams.get('state')!)
        callback.searchParams.set('authCode', 'authorization-code')
        await fetch(callback)
      }
    })

    await expect(client.login({
      signal: new AbortController().signal
    })).resolves.toMatchObject({
      accessToken: 'owner-access', refreshToken: 'owner-refresh', corpId: 'corp-1'
    })
    expect(openedUrl).toContain('https://login.dingtalk.com/oauth2/auth')
    expect(openedUrl).not.toContain('oauth-secret')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.dingtalk.com/v1.0/oauth2/userAccessToken'
    ])
    const tokenBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(tokenBody).toMatchObject({
      clientId: 'oauth-client',
      clientSecret: 'oauth-secret',
      code: 'authorization-code',
      grantType: 'authorization_code'
    })
  })

  it.each(['cancel', 'access_denied', 'state_mismatch', 'open_failed'] as const)(
    'closes the browser callback on %s without calling another authorization endpoint',
    async (failure) => {
      const abort = new AbortController()
      const fetchMock = vi.fn(async () => { throw new Error('unexpected token request') })
      let callbackUrl = ''
      const client = new DingTalkOAuthClient({
        clientId: 'oauth-client', clientSecret: 'oauth-secret', fetchImpl: fetchMock,
        openExternal: async (value) => {
          const authorization = new URL(value)
          const callback = new URL(authorization.searchParams.get('redirect_uri')!)
          callbackUrl = callback.toString()
          if (failure === 'cancel') { abort.abort(); return }
          if (failure === 'open_failed') throw new Error('browser unavailable')
          callback.searchParams.set('state', failure === 'state_mismatch'
            ? 'wrong-state' : authorization.searchParams.get('state')!)
          callback.searchParams.set('error', 'access_denied')
          expect((await fetch(callback)).status).toBe(400)
        }
      })

      await expect(client.login({ signal: abort.signal })).rejects.toThrow(
        failure === 'state_mismatch' ? 'dingtalk_oauth_state_mismatch'
          : failure === 'open_failed' ? 'dingtalk_oauth_unavailable' : 'dingtalk_operation_cancelled'
      )
      expect(fetchMock).not.toHaveBeenCalled()
      await expect(fetch(callbackUrl)).rejects.toThrow()
    }
  )

  it.each([
    [400, { error: 'invalid_grant' }, 'dingtalk_oauth_expired'],
    [401, { error: 'invalid_client' }, 'dingtalk_oauth_client_rejected'],
    [401, { code: 'unknown' }, 'dingtalk_oauth_failed'],
    [403, { code: 'unknown' }, 'dingtalk_oauth_failed'],
    [408, {}, 'dingtalk_oauth_unavailable'],
    [429, {}, 'dingtalk_oauth_unavailable'],
    [503, { error: 'invalid_grant' }, 'dingtalk_oauth_unavailable']
  ] as const)('classifies a token response without treating HTTP %s as session expiry alone', async (status, body, expected) => {
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client', clientSecret: 'oauth-secret',
      fetchImpl: vi.fn(async () => jsonResponse(body, status))
    })

    await expect(client.refresh('fixture-refresh')).rejects.toThrow(expected)
  })

  it('cancels browser login even while the system browser launch is still pending', async () => {
    const abort = new AbortController()
    let callbackUrl = ''
    const opened = vi.fn(async (url: string) => {
      callbackUrl = new URL(url).searchParams.get('redirect_uri')!
      return new Promise<unknown>(() => undefined)
    })
    const fetchMock = vi.fn(async () => { throw new Error('unexpected token request') })
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client', clientSecret: 'oauth-secret',
      fetchImpl: fetchMock, openExternal: opened
    })
    const pending = client.login({ signal: abort.signal })
    const assertion = expect(pending).rejects.toThrow('dingtalk_operation_cancelled')
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
    abort.abort()
    await assertion
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(fetch(callbackUrl)).rejects.toThrow()
  }, 3_000)

  it('keeps a bounded timeout active until the token response body finishes', async () => {
    vi.useFakeTimers()
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client', clientSecret: 'oauth-secret',
      fetchImpl: vi.fn(async (_url, input) => new Response(new ReadableStream({
        start(controller) {
          input!.signal!.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
        }
      }), { status: 200 }))
    })
    const pending = client.refresh('fixture-refresh')
    const assertion = expect(pending).rejects.toThrow('dingtalk_oauth_timeout')
    await vi.advanceTimersByTimeAsync(45_000)
    await assertion
  })

  it('does not expose token response text in errors', async () => {
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client', clientSecret: 'oauth-secret',
      fetchImpl: vi.fn(async () => jsonResponse({
        error: 'invalid_grant', message: 'fixture-private-refresh-token'
      }, 400))
    })

    await expect(client.refresh('fixture-refresh')).rejects.toEqual(new Error('dingtalk_oauth_expired'))
  })

  it('stops reading an undeclared oversized OAuth response', async () => {
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client',
      clientSecret: 'oauth-secret',
      fetchImpl: vi.fn(async () => new Response(new Uint8Array(1_000_001), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })) as unknown as typeof fetch
    })

    await expect(client.refresh('refresh-token')).rejects.toThrow(
      'dingtalk_oauth_response_invalid'
    )
  })
})

class MemoryStore {
  record: {
    provider: 'dingtalk'
    accountId: string
    identity: Record<string, string>
    session: StoredDingTalkDeveloperSessions
    revision: number
  } | null = null

  get state(): StoredDingTalkDeveloperSessions | null {
    return this.record?.session ?? null
  }

  async read<TIdentity, TSession>(): Promise<{
    provider: 'dingtalk'
    accountId: string
    identity: TIdentity
    session: TSession
    revision: number
  } | null> {
    return this.record ? structuredClone(this.record) as unknown as {
      provider: 'dingtalk'
      accountId: string
      identity: TIdentity
      session: TSession
      revision: number
    } : null
  }

  async replace(input: {
    accountId: string
    identity: unknown
    session: unknown
    expectedRevision: number | null
  }): Promise<number> {
    if (input.expectedRevision !== (this.record?.revision ?? null)) {
      throw new Error('channel_session_revision_conflict')
    }
    const revision = (this.record?.revision ?? 0) + 1
    this.record = {
      provider: 'dingtalk',
      accountId: input.accountId,
      identity: structuredClone(input.identity) as Record<string, string>,
      session: structuredClone(input.session) as StoredDingTalkDeveloperSessions,
      revision
    }
    return revision
  }

  commit(pending: PendingDingTalkDeveloperConnection, accountId: string): number {
    const revision = (this.record?.revision ?? 0) + 1
    this.record = {
      provider: 'dingtalk', accountId,
      identity: structuredClone(pending.identity) as unknown as Record<string, string>,
      session: structuredClone(pending.session), revision
    }
    return revision
  }
}

function session(
  store: MemoryStore,
  oauth: DingTalkOAuthBackend
): ElectronDingTalkDeveloperSessionService {
  return new ElectronDingTalkDeveloperSessionService({
    oauthClientId: 'oauth-client',
    oauth,
    store
  })
}

async function commitPending(
  service: ElectronDingTalkDeveloperSessionService,
  store: MemoryStore,
  accountId: string
): Promise<void> {
  const revision = store.commit(service.pendingConnection(), accountId)
  await service.activatePendingLogin(revision)
}

function oauthBackend(
  logins: Array<[DingTalkOAuthTokenSet, ReturnType<typeof identity>]>
): DingTalkOAuthBackend {
  const queue = [...logins]
  let pendingIdentity: ReturnType<typeof identity> | undefined
  return {
    login: vi.fn(async () => {
      const next = queue.shift()
      if (!next) throw new Error('missing login')
      pendingIdentity = next[1]
      return next[0]
    }),
    refresh: vi.fn(async () => { throw new Error('unexpected refresh') }),
    resolveIdentity: vi.fn(async () => {
      if (!pendingIdentity) throw new Error('missing identity')
      return pendingIdentity
    })
  }
}

function token(accessToken: string, refreshToken: string, corpId: string): DingTalkOAuthTokenSet {
  return {
    accessToken,
    refreshToken,
    corpId,
    accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2099-02-01T00:00:00.000Z'
  }
}

function identity(corpId: string, userId: string) {
  return { corpId, userId, corpName: '星海科技', userName: 'Murray' }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
