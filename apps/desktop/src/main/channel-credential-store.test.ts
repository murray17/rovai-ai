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

  it('gives Feishu and Lark Hosts their own credential partition over one shared batch load', async () => {
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'channels.credentials.listPublished') return [{
        agentId: 'agent', credentialRef: 'lark-member-a', provider: 'lark',
        remoteAppId: 'cli-lark', payload: { appSecret: 'lark-secret' }, revision: 1
      }]
      if (method === 'channels.credentials.get') return {
        credentialRef: params.credentialRef, provider: 'lark',
        remoteAppId: 'cli-lark', payload: { appSecret: 'lark-secret' }, revision: 1
      }
      return { status: 'applied', code: 'ok' }
    })
    const store = new SqliteChannelCredentialStore({ request } as never)
    const lark = store.forProvider('lark')

    expect(await lark.listPublished()).toEqual([expect.objectContaining({ provider: 'lark', credential: { appId: 'cli-lark', appSecret: 'lark-secret' } })])
    expect(await store.forProvider('feishu').listPublished()).toBe(await lark.listPublished())
    expect(await lark.read('lark-member-a')).toEqual({ appId: 'cli-lark', appSecret: 'lark-secret' })
    await lark.delete('lark-member-a')
    expect(request.mock.calls.filter(([method]) => method === 'channels.credentials.listPublished')).toHaveLength(1)
    expect(request).toHaveBeenCalledWith('channels.credentials.get', { credentialRef: 'lark-member-a', provider: 'lark' })
    expect(request).toHaveBeenCalledWith('channels.credentials.delete', {
      commandId: expect.any(String), command: { provider: 'lark', credentialRef: 'lark-member-a' }
    })
    // A Feishu read never accepts a Lark row returned for the same reference.
    await expect(store.forProvider('feishu').read('lark-member-a')).rejects.toThrow('channel_credential_response_invalid')
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
