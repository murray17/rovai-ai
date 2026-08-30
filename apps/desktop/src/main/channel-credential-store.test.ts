import { describe, expect, it, vi } from 'vitest'
import {
  SqliteChannelCredentialStore,
  SqliteChannelDeveloperSessionStore
} from './channel-credential-store'

describe('SQLite channel stores', () => {
  it('loads every published Bot credential with one cached Core request', async () => {
    const request = vi.fn(async (method: string) => {
      expect(method).toBe('channels.credentials.listPublished')
      return [
        {
          agentId: 'agent-feishu', credentialRef: 'feishu-agent', provider: 'feishu',
          remoteAppId: 'cli-feishu', payload: { appSecret: 'feishu-secret' }, revision: 1
        },
        {
          agentId: 'agent-dingtalk', credentialRef: 'dingtalk-agent', provider: 'dingtalk',
          remoteAppId: 'ding-app',
          payload: { appSecret: 'dingtalk-secret', robotCode: 'ding-robot' }, revision: 2
        }
      ]
    })
    const store = new SqliteChannelCredentialStore({ request } as never)

    const [first, second] = await Promise.all([store.listPublished(), store.listPublished()])

    expect(request).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
    expect(first).toEqual([
      expect.objectContaining({
        agentId: 'agent-feishu', credential: {
          appId: 'cli-feishu', appSecret: 'feishu-secret'
        }
      }),
      expect.objectContaining({
        agentId: 'agent-dingtalk', credential: {
          appKey: 'ding-app', appSecret: 'dingtalk-secret', robotCode: 'ding-robot'
        }
      })
    ])
  })

  it('uses revision compare-and-swap when replacing a developer session', async () => {
    const request = vi.fn(async (method: string, params: unknown) => {
      expect(method).toBe('channels.developerSession.replace')
      expect(params).toMatchObject({
        command: {
          provider: 'feishu', accountId: 'account-1', expectedRevision: 4,
          identity: { userId: 'owner-1' }, session: { cookies: [] }
        }
      })
      return { status: 'applied', code: 'replaced', payload: { revision: 5 } }
    })
    const store = new SqliteChannelDeveloperSessionStore({ request } as never)

    await expect(store.replace({
      provider: 'feishu',
      accountId: 'account-1',
      identity: { userId: 'owner-1' },
      session: { cookies: [] },
      expectedRevision: 4
    })).resolves.toBe(5)
  })
})
