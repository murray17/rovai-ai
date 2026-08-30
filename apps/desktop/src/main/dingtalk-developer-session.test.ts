import { describe, expect, it, vi } from 'vitest'
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
    await service.beginLogin({ signal, deviceFlow: true })

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
})

describe('DingTalk OAuth protocol', () => {
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
      deviceFlow: false,
      signal: new AbortController().signal
    })).resolves.toMatchObject({
      accessToken: 'owner-access', refreshToken: 'owner-refresh', corpId: 'corp-1'
    })
    expect(openedUrl).toContain('https://login.dingtalk.com/oauth2/auth')
    expect(openedUrl).not.toContain('oauth-secret')
    const tokenBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(tokenBody).toMatchObject({
      clientId: 'oauth-client',
      clientSecret: 'oauth-secret',
      code: 'authorization-code',
      grantType: 'authorization_code'
    })
  })

  it('uses DingTalk device authorization and terminal polling without a local helper', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/oauth2/device/code.json')) {
        return jsonResponse({
          success: true,
          result: {
            deviceCode: 'device-code',
            userCode: 'ABCD-EFGH',
            verificationUriComplete: 'https://login.dingtalk.com/device?code=ABCD-EFGH',
            flowId: 'flow-1',
            expiresIn: 900,
            interval: 1
          }
        })
      }
      if (url.includes('/cli/oauth/device/poll')) {
        return jsonResponse({ success: true, data: { status: 'APPROVED', authCode: 'device-auth' } })
      }
      if (url.includes('/v1.0/oauth2/userAccessToken')) {
        return jsonResponse({
          accessToken: 'device-access', refreshToken: 'device-refresh', expiresIn: 7200,
          corpId: 'corp-1'
        })
      }
      throw new Error(`unexpected request:${url}`)
    })
    const openExternal = vi.fn(async () => undefined)
    const client = new DingTalkOAuthClient({
      clientId: 'oauth-client',
      clientSecret: 'oauth-secret',
      fetchImpl: fetchMock as unknown as typeof fetch,
      openExternal,
      sleep: async () => undefined
    })

    await expect(client.login({
      deviceFlow: true,
      signal: new AbortController().signal
    })).resolves.toMatchObject({ accessToken: 'device-access' })
    expect(openExternal).toHaveBeenCalledWith(
      'https://login.dingtalk.com/device?code=ABCD-EFGH'
    )
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://login.dingtalk.com/oauth2/device/code.json',
      'https://mcp.dingtalk.com/cli/oauth/device/poll?flowId=flow-1',
      'https://api.dingtalk.com/v1.0/oauth2/userAccessToken'
    ])
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
