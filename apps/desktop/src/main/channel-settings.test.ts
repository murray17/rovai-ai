import { describe, expect, it, vi } from 'vitest'
import {
  ChannelSettingsService,
  type ChannelHostDependencies
} from './channel-settings'
import type {
  ChannelCredentialStore,
  FeishuAppCredential
} from './channel-credential-store'

function channelCore(
  handler: (method: string, params: unknown) => unknown | Promise<unknown>
): ChannelHostDependencies['core'] {
  return {
    request: (method, params) => Promise.resolve(handler(method, params))
  } as ChannelHostDependencies['core']
}

function memoryCredentialStore(
  initial: Record<string, FeishuAppCredential> = {}
): ChannelCredentialStore & { values: Map<string, FeishuAppCredential> } {
  const values = new Map(Object.entries(initial))
  return {
    values,
    async read(credentialRef) {
      return values.get(credentialRef) ?? null
    },
    async write(credentialRef, credential) {
      values.set(credentialRef, structuredClone(credential))
    },
    async delete(credentialRef) {
      values.delete(credentialRef)
    }
  }
}

function coreSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    account: null,
    memberBots: [],
    projectBindings: [],
    unboundConversations: [],
    conversationBindings: [],
    transportConversations: [],
    pendingAggregates: [],
    ...overrides
  }
}

describe('channel settings service', () => {
  it('projects only public Feishu setup facts while the host is unavailable', async () => {
    const snapshot = await new ChannelSettingsService().get()

    expect(snapshot).toEqual({
      schemaVersion: 2,
      channels: [{
        kind: 'feishu',
        displayName: '飞书',
        hostStatus: 'unavailable',
        connection: {
          status: 'not_connected',
          account: null
        },
        memberBots: []
      }],
      projectBindings: [],
      unboundConversations: [],
      conversationBindings: [],
      activeQrAttempt: null
    })
    expect(JSON.stringify(snapshot)).not.toMatch(/cookie|csrf|secret|token/i)
  })

  it('returns an isolated snapshot for each Renderer read', async () => {
    const service = new ChannelSettingsService()
    const first = await service.get()
    first.channels.length = 0

    expect((await service.get()).channels).toHaveLength(1)
  })

  it('strips host routing and credential references from Renderer snapshots', async () => {
    const credentialStore = memoryCredentialStore({
      'feishu-member-a': { appId: 'cli_a', appSecret: 'super-secret' }
    })
    const service = new ChannelSettingsService({
      credentialStore,
      core: channelCore(() => coreSnapshot({
        account: {
          accountId: 'controller-app',
          displayName: 'Murray',
          tenantName: '星海科技',
          status: 'connected',
          version: 3
        },
        memberBots: [{
          agentId: 'agent-a',
          accountId: 'controller-app',
          appId: 'cli_a',
          botDisplayName: '审阅员',
          credentialRef: 'feishu-member-a',
          status: 'published',
          failureCode: null,
          version: 1
        }],
        transportConversations: [{ tenantKey: 'tenant-private', chatId: 'chat-private' }],
        pendingAggregates: [{ aggregateId: 'aggregate-private' }]
      }))
    })

    const serialized = JSON.stringify(await service.get())

    expect(serialized).toContain('审阅员')
    expect(serialized).not.toMatch(/credentialRef|super-secret|tenant-private|chat-private|aggregate-private/)
  })

  it('restores the previous encrypted controller credential when Core rejects a switch', async () => {
    const previous = { appId: 'old-app', appSecret: 'old-secret' }
    const credentialStore = memoryCredentialStore({ 'feishu-controller': previous })
    const registerApp = vi.fn(async () => ({
      client_id: 'new-app',
      client_secret: 'new-secret',
      user_info: { open_id: 'owner-open-id', tenant_brand: 'feishu' }
    })) as unknown as NonNullable<ChannelHostDependencies['registerApp']>
    const service = new ChannelSettingsService({
      credentialStore,
      registerApp,
      core: channelCore((method) => {
        if (method === 'channels.feishu.account.upsert') throw new Error('core_rejected')
        return coreSnapshot()
      })
    })

    await expect(service.connect()).rejects.toThrow('core_rejected')

    expect(credentialStore.values.get('feishu-controller')).toEqual(previous)
    expect(JSON.stringify(await service.get())).not.toContain('new-secret')
  })
})
