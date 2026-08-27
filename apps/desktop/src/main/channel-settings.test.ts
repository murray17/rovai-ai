import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  ChannelSettingsService,
  type ChannelHostDependencies
} from './channel-settings'
import type {
  ChannelCredentialStore,
  FeishuAppCredential
} from './channel-credential-store'
import type { FeishuDeveloperIdentity } from './feishu-developer-session'
import type { FeishuMemberBotProvisioner } from './feishu-member-bot-provisioner'

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
    publicationIntents: [],
    projectBindings: [],
    unboundConversations: [],
    conversationBindings: [],
    transportConversations: [],
    pendingAggregates: [],
    ...overrides
  }
}

function identity(overrides: Partial<FeishuDeveloperIdentity> = {}): FeishuDeveloperIdentity {
  return {
    brand: 'feishu',
    userId: 'owner-user-id',
    userName: 'Murray',
    email: 'murray@example.com',
    tenantId: 'tenant-1',
    tenantName: '星海科技',
    ...overrides
  }
}

function connectedAccount(value = identity()): Record<string, unknown> {
  const digest = (input: string): string => `sha256:${createHash('sha256').update(input).digest('hex')}`
  return {
    accountId: digest(`${value.brand}\0${value.tenantId}\0${value.userId}`),
    userIdDigest: digest(`feishu-user\0${value.userId}`),
    tenantId: value.tenantId,
    userName: value.userName,
    email: value.email ?? null,
    tenantName: value.tenantName,
    brand: value.brand,
    status: 'connected',
    version: 1,
    connectedAt: '2026-08-27T00:00:00Z',
    lastVerifiedAt: '2026-08-27T00:00:00Z'
  }
}

function developerSession(value = identity()): NonNullable<ChannelHostDependencies['developerSession']> & {
  inspect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
} {
  return {
    beginLogin: vi.fn(async () => value),
    inspect: vi.fn(async () => value),
    requireExpectedIdentity: vi.fn(async () => value),
    disconnect: vi.fn(async () => undefined)
  }
}

function presentAgent(agentId = 'agent-a'): Record<string, unknown> {
  return {
    agentId,
    displayName: '审阅员',
    avatarRef: null,
    accent: null,
    teamRole: '代码审阅',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence: 'present',
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'ready', blockers: [] },
    memberOrder: 0,
    version: 1,
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:00:00Z',
    removedAt: null
  }
}

function fakeCreateChannel(): NonNullable<ChannelHostDependencies['createChannel']> {
  return vi.fn(() => ({
    botIdentity: { openId: 'bot-open-id', name: '审阅员' },
    on: vi.fn(() => () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined)
  })) as unknown as NonNullable<ChannelHostDependencies['createChannel']>
}

describe('channel settings service', () => {
  it('projects only public Feishu setup facts while the host is unavailable', async () => {
    const snapshot = await new ChannelSettingsService().get()

    expect(snapshot).toEqual({
      schemaVersion: 3,
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
      activeQrAttempt: null,
      activeProvisioning: null
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
          userIdDigest: `sha256:${'a'.repeat(64)}`,
          tenantId: 'tenant-1',
          userName: 'Murray',
          email: 'murray@example.com',
          tenantName: '星海科技',
          brand: 'feishu',
          status: 'connected',
          version: 3,
          connectedAt: '2026-08-27T00:00:00Z',
          lastVerifiedAt: '2026-08-27T00:00:00Z'
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

  it('connects a real developer identity without registering an app or storing a controller secret', async () => {
    const credentialStore = memoryCredentialStore()
    const provision = vi.fn()
    const compatProvision = vi.fn()
    const beginLogin = vi.fn(async () => ({
      brand: 'feishu' as const,
      userId: 'owner-user-id',
      userName: 'Murray',
      email: 'murray@example.com',
      tenantId: 'tenant-1',
      tenantName: '星海科技'
    }))
    const commands: Array<{ method: string; params: unknown }> = []
    const service = new ChannelSettingsService({
      credentialStore,
      memberBotProvisioner: { create: provision },
      compatMemberBotProvisioner: { create: compatProvision },
      developerSession: {
        beginLogin,
        async inspect() { return null },
        async requireExpectedIdentity() { throw new Error('not_used') },
        async disconnect() {}
      },
      core: channelCore((method, params) => {
        commands.push({ method, params })
        if (method === 'channels.feishu.account.upsert') return { status: 'applied' }
        return coreSnapshot()
      })
    })

    await service.connect()

    expect(beginLogin).toHaveBeenCalledWith(expect.objectContaining({ forceFresh: true }))
    expect(provision).not.toHaveBeenCalled()
    expect(compatProvision).not.toHaveBeenCalled()
    expect(credentialStore.values.size).toBe(0)
    const upsert = commands.find((entry) => entry.method === 'channels.feishu.account.upsert')
    expect(upsert).toBeDefined()
    expect(JSON.stringify(upsert)).toContain('Murray')
    expect(JSON.stringify(upsert)).toContain('murray@example.com')
    expect(JSON.stringify(upsert)).not.toContain('owner-user-id')
    expect(JSON.stringify(upsert)).toContain('tenant-1')
    expect(JSON.stringify(upsert)).not.toMatch(/appSecret|client_secret|controller/i)
  })

  it('uses the developer session for normal publishing and reserves QR registration for the explicit compatibility path', async () => {
    const owner = identity()
    const credentialStore = memoryCredentialStore()
    const provision = vi.fn(async () => ({
      appId: 'cli-normal',
      appSecret: 'normal-secret',
      botOpenId: 'bot-open-id',
      botDisplayName: '审阅员',
      publishedVersionId: null
    }))
    const compatProvision = vi.fn(async () => ({
      appId: 'cli-compat',
      appSecret: 'compat-secret',
      botDisplayName: '审阅员',
      publishedVersionId: null
    }))
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: { create: provision },
      compatMemberBotProvisioner: { create: compatProvision },
      createChannel: fakeCreateChannel(),
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        if (method === 'members.get') return presentAgent()
        return { status: 'applied' }
      })
    })

    const normal = await service.publishMemberBot('agent-a')

    expect(provision).toHaveBeenCalledTimes(1)
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({
      expectedDeveloperIdentity: { userId: owner.userId, tenantId: owner.tenantId }
    }))
    expect(compatProvision).not.toHaveBeenCalled()
    expect(normal.activeQrAttempt).toBeNull()
    expect(normal.activeProvisioning).toMatchObject({
      agentId: 'agent-a',
      stage: 'completed',
      remoteAppId: 'cli-normal'
    })
    expect([...credentialStore.values.values()]).toContainEqual({
      appId: 'cli-normal',
      appSecret: 'normal-secret'
    })

    await service.publishMemberBotCompat('agent-a')

    expect(compatProvision).toHaveBeenCalledTimes(1)
    expect(provision).toHaveBeenCalledTimes(1)
  })

  it('fails closed on developer identity drift without creating or compat-registering an app', async () => {
    const owner = identity()
    const provision = vi.fn()
    const compatProvision = vi.fn()
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: developerSession(identity({ userId: 'different-owner' })),
      memberBotProvisioner: { create: provision },
      compatMemberBotProvisioner: { create: compatProvision },
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('账号已变化')

    expect(provision).not.toHaveBeenCalled()
    expect(compatProvision).not.toHaveBeenCalled()
  })

  it('does not persist a placeholder account when login cannot produce a complete identity', async () => {
    const commands: string[] = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: {
        async beginLogin() { throw new Error('feishu_developer_identity_incomplete') },
        async inspect() { return null },
        async requireExpectedIdentity() { throw new Error('not_used') },
        async disconnect() {}
      },
      core: channelCore((method) => {
        commands.push(method)
        return method === 'channels.feishu.snapshot' ? coreSnapshot() : { status: 'applied' }
      })
    })

    await expect(service.connect()).rejects.toThrow('feishu_developer_identity_incomplete')

    expect(commands).not.toContain('channels.feishu.account.upsert')
    expect((await service.get()).activeQrAttempt).toMatchObject({
      stage: 'failed',
      detail: '已登录飞书，但未能读取完整的账号与企业信息。请关闭后重试。'
    })
  })

  it('turns secure-storage rejection into an actionable login error', async () => {
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: {
        async beginLogin() { throw new Error('system_credential_encryption_unavailable') },
        async inspect() { return null },
        async requireExpectedIdentity() { throw new Error('not_used') },
        async disconnect() {}
      },
      core: channelCore((method) => (
        method === 'channels.feishu.snapshot' ? coreSnapshot() : { status: 'applied' }
      ))
    })

    await expect(service.connect()).rejects.toThrow('system_credential_encryption_unavailable')

    expect((await service.get()).activeQrAttempt).toMatchObject({
      stage: 'failed',
      detail: '无法访问系统安全存储。macOS 上请在钥匙串提示中选择“允许”，然后重试。'
    })
  })

  it('does not silently use compatibility registration when the developer session has expired', async () => {
    const owner = identity()
    const provision = vi.fn()
    const compatProvision = vi.fn()
    const expiredSession = developerSession(owner)
    expiredSession.inspect.mockResolvedValue(null)
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: expiredSession,
      memberBotProvisioner: { create: provision },
      compatMemberBotProvisioner: { create: compatProvision },
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account: connectedAccount(owner) })
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('登录已过期')

    expect(provision).not.toHaveBeenCalled()
    expect(compatProvision).not.toHaveBeenCalled()
  })

  it('disconnects only the developer session and preserves member Bot credentials', async () => {
    const owner = identity()
    const session = developerSession(owner)
    const credential = { appId: 'cli-member', appSecret: 'member-secret' }
    const credentialStore = memoryCredentialStore({ 'feishu-member-existing': credential })
    let account = connectedAccount(owner)
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: session,
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account })
        if (method === 'channels.feishu.account.disconnect') {
          account = { ...account, status: 'disconnected', version: 2 }
          return { status: 'applied' }
        }
        return { status: 'applied' }
      })
    })

    await service.disconnect()

    expect(session.disconnect).toHaveBeenCalledTimes(1)
    expect(credentialStore.values.get('feishu-member-existing')).toEqual(credential)
  })

  it('clears the in-memory failure projection after retrying a saved Bot credential', async () => {
    const owner = identity()
    const credentialStore = memoryCredentialStore()
    let publicationIntent: Record<string, unknown> | null = null
    let memberBots: Record<string, unknown>[] = []
    let connectCount = 0
    const createChannel = vi.fn(() => ({
      botIdentity: { openId: 'bot-open-id', name: '审阅员' },
      on: vi.fn(() => () => undefined),
      connect: vi.fn(async () => {
        connectCount += 1
        if (connectCount === 1) throw new Error('handshake_failed')
      }),
      disconnect: vi.fn(async () => undefined)
    })) as unknown as NonNullable<ChannelHostDependencies['createChannel']>
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: {
        async create() {
          return {
            appId: 'cli-retry',
            appSecret: 'retry-secret',
            botDisplayName: '审阅员',
            publishedVersionId: null
          }
        }
      },
      createChannel,
      core: channelCore((method, rawParams) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account: connectedAccount(owner),
            memberBots,
            publicationIntents: publicationIntent ? [publicationIntent] : []
          })
        }
        if (method === 'members.get') return presentAgent()
        const params = rawParams as { command?: Record<string, unknown> }
        if (method === 'channels.feishu.publicationIntent.create') {
          publicationIntent = {
            ...params.command,
            state: 'created',
            remoteAppId: null,
            credentialRef: null,
            lastCompletedStep: null,
            failureCode: null,
            version: 1,
            createdAt: '2026-08-27T00:00:00Z',
            updatedAt: '2026-08-27T00:00:00Z'
          }
        } else if (method === 'channels.feishu.publicationIntent.advance' && publicationIntent) {
          publicationIntent = {
            ...publicationIntent,
            ...params.command,
            version: Number(publicationIntent.version) + 1,
            updatedAt: '2026-08-27T00:01:00Z'
          }
        } else if (method === 'channels.feishu.memberBot.upsert') {
          memberBots = [{
            agentId: 'agent-a',
            accountId: connectedAccount(owner).accountId,
            appId: 'cli-retry',
            botDisplayName: '审阅员',
            credentialRef: 'feishu-member-agent-a',
            status: 'published',
            failureCode: null,
            version: 1
          }]
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('handshake_failed')
    const retried = await service.retryMemberBot('agent-a')

    expect(retried.activeProvisioning).toMatchObject({
      agentId: 'agent-a',
      stage: 'completed',
      remoteAppId: 'cli-retry'
    })
    expect(retried.channels[0].memberBots).toContainEqual(expect.objectContaining({
      agentId: 'agent-a',
      publicationStatus: 'published'
    }))
    expect(publicationIntent).toMatchObject({ state: 'completed' })
  })

  it('persists unknown remote state and blocks a second app creation attempt', async () => {
    const owner = identity()
    const unknownError = Object.assign(new Error('registration_transport_lost'), {
      code: 'registration_transport_lost',
      remoteState: 'unknown' as const
    })
    const provision = vi.fn(async (
      input: Parameters<FeishuMemberBotProvisioner['create']>[0]
    ) => {
      input.onProgress?.('app_created', 'cli-unknown')
      throw unknownError
    })
    let publicationIntent: Record<string, unknown> | null = null
    let createCount = 0
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: developerSession(owner),
      memberBotProvisioner: { create: provision },
      core: channelCore((method, rawParams) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account: connectedAccount(owner),
            publicationIntents: publicationIntent ? [publicationIntent] : []
          })
        }
        if (method === 'members.get') return presentAgent()
        const params = rawParams as { command?: Record<string, unknown> }
        if (method === 'channels.feishu.publicationIntent.create') {
          createCount += 1
          publicationIntent = {
            ...params.command,
            state: 'created',
            remoteAppId: null,
            credentialRef: null,
            lastCompletedStep: null,
            failureCode: null,
            version: 1,
            createdAt: '2026-08-27T00:00:00Z',
            updatedAt: '2026-08-27T00:00:00Z'
          }
        } else if (method === 'channels.feishu.publicationIntent.advance' && publicationIntent) {
          publicationIntent = {
            ...publicationIntent,
            ...params.command,
            version: Number(publicationIntent.version) + 1,
            updatedAt: '2026-08-27T00:01:00Z'
          }
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('registration_transport_lost')
    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('避免重复创建应用')

    expect(provision).toHaveBeenCalledTimes(1)
    expect(createCount).toBe(1)
    expect(publicationIntent).toMatchObject({
      state: 'failed_unknown_remote_state',
      remoteAppId: 'cli-unknown'
    })
  })
})
