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
  const snapshot = {
    schemaVersion: 2,
    account: null,
    memberBots: [],
    publicationIntents: [],
    pendingBindingCount: 0,
    bindingIssueCount: 0,
    transportConversations: [],
    pendingAggregates: [],
    ...overrides
  }
  return {
    ...snapshot,
    memberBots: (snapshot.memberBots as Array<Record<string, unknown>>).map((bot) => ({
      ownerIdentityStatus: 'unverified',
      ...bot
    }))
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

function presentAgent(
  agentId = 'agent-a',
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
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
    removedAt: null,
    ...overrides
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

function controlledChannels(identities: Record<string, { openId: string; name: string }>): {
  createChannel: NonNullable<ChannelHostDependencies['createChannel']>
  handlers: Map<string, (event: unknown) => void | Promise<void>>
  send: ReturnType<typeof vi.fn>
  updateCard: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, (event: unknown) => void | Promise<void>>()
  const send = vi.fn(async () => ({ messageId: 'om_sent' }))
  const updateCard = vi.fn(async () => undefined)
  const createChannel = vi.fn((options: { appId: string }) => ({
    botIdentity: identities[options.appId],
    on: (event: string, handler: (value: unknown) => void | Promise<void>) => {
      handlers.set(`${options.appId}:${event}`, handler)
      return () => handlers.delete(`${options.appId}:${event}`)
    },
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    send,
    updateCard,
    getChatMode: vi.fn(async () => 'group'),
    getChatInfo: vi.fn(async () => ({ name: '测试群' })),
    rawClient: {
      im: { v1: {
        chatMembers: {
          isInChat: vi.fn(async () => ({ code: 0, data: { is_in_chat: true } }))
        },
        message: {
          get: vi.fn(async () => ({ code: 0, data: { items: [] } }))
        }
      } }
    }
  })) as unknown as NonNullable<ChannelHostDependencies['createChannel']>
  return { createChannel, handlers, send, updateCard }
}

function inertInterval(): Pick<ChannelHostDependencies, 'setInterval' | 'clearInterval'> {
  return {
    setInterval: vi.fn(() => ({ unref() {} })) as unknown as typeof globalThis.setInterval,
    clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval
  }
}

function normalizedMessage(input: {
  messageId: string
  chatId?: string
  chatType?: 'p2p' | 'group'
  senderUserId: string
  senderOpenId?: string
  senderUnionId?: string
  content: string
  mentions?: Array<{ key: string; openId?: string; name?: string; isBot?: boolean }>
}): Record<string, unknown> {
  const mentions = input.mentions ?? []
  return {
    messageId: input.messageId,
    chatId: input.chatId ?? 'oc_test',
    chatType: input.chatType ?? 'p2p',
    senderId: input.senderOpenId ?? input.senderUserId,
    senderName: '飞书成员',
    content: input.content,
    rawContentType: 'text',
    resources: [],
    mentions,
    mentionAll: false,
    mentionedBot: (input.chatType ?? 'p2p') === 'p2p' || mentions.some((mention) => mention.isBot),
    createTime: Date.now(),
    raw: {
      tenant_key: 'tenant-1',
      sender: {
        tenant_key: 'tenant-1',
        sender_id: {
          open_id: input.senderOpenId ?? `ou_${input.senderUserId}`,
          user_id: input.senderUserId,
          union_id: input.senderUnionId ?? `on_${input.senderUserId}`
        }
      },
      message: {
        message_type: 'text',
        content: JSON.stringify({ text: input.content }),
        mentions: mentions.map((mention) => ({
          key: mention.key,
          name: mention.name,
          id: { open_id: mention.openId }
        }))
      }
    }
  }
}

describe('channel settings service', () => {
  it('projects only public Feishu setup facts while the host is unavailable', async () => {
    const snapshot = await new ChannelSettingsService().get()

    expect(snapshot).toEqual({
      schemaVersion: 4,
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
      pendingBindingCount: 0,
      bindingIssueCount: 0,
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
          brand: 'feishu',
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

    const snapshot = await service.get()
    const serialized = JSON.stringify(snapshot)

    expect(serialized).toContain('审阅员')
    expect(snapshot.channels[0].memberBots[0]?.managementUrl)
      .toBe('https://open.feishu.cn/app/cli_a/baseinfo')
    expect(serialized).not.toMatch(/credentialRef|ownerIdentityStatus|super-secret|tenant-private|chat-private|aggregate-private/)
  })

  it('projects the bound account brand into the exact Lark app management page', async () => {
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      core: channelCore(() => coreSnapshot({
        memberBots: [{
          agentId: 'agent-a',
          accountId: 'account-lark',
          brand: 'lark',
          appId: 'cli_lark_agent',
          botDisplayName: 'Reviewer',
          credentialRef: 'feishu-member-a',
          status: 'published',
          failureCode: null,
          version: 1
        }, {
          agentId: 'agent-z',
          accountId: 'account-lark',
          brand: 'lark',
          appId: 'https://example.invalid/app',
          botDisplayName: 'Unsafe',
          credentialRef: 'feishu-member-z',
          status: 'published',
          failureCode: null,
          version: 1
        }]
      }))
    })

    expect((await service.get()).channels[0].memberBots[0]?.managementUrl)
      .toBe('https://open.larksuite.com/app/cli_lark_agent/baseinfo')
    expect((await service.get()).channels[0].memberBots[1]?.managementUrl).toBeNull()
  })

  it('connects a real developer identity without registering an app or storing a controller secret', async () => {
    const credentialStore = memoryCredentialStore()
    const provision = vi.fn()
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
    expect(credentialStore.values.size).toBe(0)
    const upsert = commands.find((entry) => entry.method === 'channels.feishu.account.upsert')
    expect(upsert).toBeDefined()
    expect(JSON.stringify(upsert)).toContain('Murray')
    expect(JSON.stringify(upsert)).toContain('murray@example.com')
    expect(JSON.stringify(upsert)).not.toContain('owner-user-id')
    expect(JSON.stringify(upsert)).toContain('tenant-1')
    expect(JSON.stringify(upsert)).not.toMatch(/appSecret|client_secret|controller/i)
  })

  it('uses only the developer session for publishing', async () => {
    const owner = identity()
    const credentialStore = memoryCredentialStore()
    const provision = vi.fn(async () => ({
      appId: 'cli-normal',
      appSecret: 'normal-secret',
      botOpenId: 'bot-open-id',
      botDisplayName: '审阅员',
      publishedVersionId: null
    }))
    const avatarSource = {
      pngBytes: new Uint8Array([1, 2, 3]),
      width: 192,
      height: 192
    }
    const resolveAvatar = vi.fn(async () => avatarSource)
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: { create: provision },
      memberBotAvatarSource: { resolve: resolveAvatar },
      createChannel: fakeCreateChannel(),
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        if (method === 'members.get') return presentAgent('agent-a', {
          avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
        })
        return { status: 'applied' }
      })
    })

    const normal = await service.publishMemberBot('agent-a')

    expect(provision).toHaveBeenCalledTimes(1)
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({
      expectedDeveloperIdentity: { userId: owner.userId, tenantId: owner.tenantId },
      avatarSource
    }))
    expect(resolveAvatar).toHaveBeenCalledWith('rovai://member-avatar/builtin/luoke/v1')
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

    expect(provision).toHaveBeenCalledTimes(1)
  })

  it('keeps fresh activation copy distinct after the new App ID is frozen', async () => {
    const owner = identity()
    let activationDetail: string | null = null
    let service!: ChannelSettingsService
    const create = vi.fn(async (
      input: Parameters<FeishuMemberBotProvisioner['create']>[0]
    ) => {
      await input.onRemoteAppCreated?.({
        appId: 'cli-fresh-activation',
        creationMode: 'template'
      })
      input.onProgress?.('app_created', 'cli-fresh-activation')
      activationDetail = (await service.get()).activeProvisioning?.detail ?? null
      return {
        appId: 'cli-fresh-activation',
        appSecret: 'fresh-secret',
        botDisplayName: '审阅员',
        publishedVersionId: 'version_2'
      }
    })
    service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: developerSession(owner),
      memberBotProvisioner: { create },
      createChannel: fakeCreateChannel(),
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        if (method === 'members.get') return presentAgent()
        return { status: 'applied' }
      })
    })

    await service.publishMemberBot('agent-a')

    expect(activationDetail).toBe('正在启用 Bot 并完成首次应用发布。')
  })

  it('keeps one frozen app binding and reactivates a disabled Bot without creating another app', async () => {
    const owner = identity()
    const account = connectedAccount(owner)
    const credentialStore = memoryCredentialStore()
    const create = vi.fn()
    const reconcile = vi.fn(async () => ({
      appId: 'cli-frozen',
      appSecret: 'recovered-secret',
      botDisplayName: '审阅员',
      publishedVersionId: 'version-existing'
    }))
    let publicationIntent: Record<string, unknown> = {
      publicationIntentId: 'intent-frozen',
      agentId: 'agent-a',
      accountId: account.accountId,
      expectedUserIdDigest: account.userIdDigest,
      expectedTenantId: owner.tenantId,
      requestedAppName: '审阅员',
      provisioningMode: 'developer_session',
      state: 'completed',
      remoteAppId: 'cli-frozen',
      credentialRef: 'credential-frozen',
      lastCompletedStep: 'completed',
      failureCode: null,
      version: 8,
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-27T00:01:00Z'
    }
    let memberBot: Record<string, unknown> = {
      agentId: 'agent-a',
      accountId: account.accountId,
      appId: 'cli-frozen',
      botDisplayName: '审阅员',
      credentialRef: 'credential-frozen',
      status: 'published',
      failureCode: null,
      version: 1
    }
    const advancedStates: string[] = []
    let intentCreates = 0
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: { create, reconcile },
      createChannel: fakeCreateChannel(),
      core: channelCore((method, rawParams) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account,
            memberBots: [memberBot],
            publicationIntents: [publicationIntent]
          })
        }
        if (method === 'members.get') return presentAgent()
        const params = rawParams as { command?: Record<string, unknown> }
        if (method === 'channels.feishu.publicationIntent.create') intentCreates += 1
        if (method === 'channels.feishu.publicationIntent.advance') {
          const state = String(params.command?.state)
          advancedStates.push(state)
          publicationIntent = {
            ...publicationIntent,
            ...params.command,
            version: Number(publicationIntent.version) + 1,
            updatedAt: '2026-08-27T00:02:00Z'
          }
        }
        if (method === 'channels.feishu.memberBot.upsert') {
          expect(params.command).toMatchObject({
            agentId: 'agent-a',
            accountId: account.accountId,
            appId: 'cli-frozen',
            credentialRef: 'credential-frozen'
          })
          memberBot = { ...memberBot, status: 'published', version: 2 }
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a'))
      .rejects.toThrow('不会创建第二个应用')

    memberBot = { ...memberBot, status: 'disabled', version: 2 }
    const reactivated = await service.publishMemberBot('agent-a')

    expect(create).not.toHaveBeenCalled()
    expect(intentCreates).toBe(0)
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      publicationIntentId: 'intent-frozen',
      remoteAppId: 'cli-frozen'
    }))
    expect(advancedStates).toEqual([
      'session_verified',
      'app_created',
      'credentials_read',
      'bot_configured',
      'version_published',
      'connection_verified',
      'completed'
    ])
    expect(reactivated.channels[0].memberBots).toContainEqual(expect.objectContaining({
      agentId: 'agent-a',
      appId: 'cli-frozen',
      publicationStatus: 'published'
    }))
  })

  it('fails before creating an intent when an assigned avatar has no safe Main resolver', async () => {
    const owner = identity()
    const provision = vi.fn()
    const commands: string[] = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: developerSession(owner),
      memberBotProvisioner: { create: provision },
      core: channelCore((method) => {
        commands.push(method)
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        if (method === 'members.get') return presentAgent('agent-a', {
          avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
        })
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a'))
      .rejects.toThrow('feishu_member_bot_avatar_unavailable')

    expect(provision).not.toHaveBeenCalled()
    expect(commands).not.toContain('channels.feishu.publicationIntent.create')
  })

  it('fails closed on developer identity drift without creating an app', async () => {
    const owner = identity()
    const provision = vi.fn()
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: developerSession(identity({ userId: 'different-owner' })),
      memberBotProvisioner: { create: provision },
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('账号已变化')

    expect(provision).not.toHaveBeenCalled()
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

  it('fails before provisioning when the developer session has expired', async () => {
    const owner = identity()
    const provision = vi.fn()
    const expiredSession = developerSession(owner)
    expiredSession.inspect.mockResolvedValue(null)
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: expiredSession,
      memberBotProvisioner: { create: provision },
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account: connectedAccount(owner) })
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('登录已过期')

    expect(provision).not.toHaveBeenCalled()
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

  it('keeps a failed connection retry recoverable before completing the same Bot binding', async () => {
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
        if (connectCount <= 2) throw new Error('handshake_failed')
      }),
      disconnect: vi.fn(async () => undefined)
    })) as unknown as NonNullable<ChannelHostDependencies['createChannel']>
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: {
        async create(input) {
          await input.onRemoteAppCreated?.({
            appId: 'cli-retry',
            creationMode: 'template'
          })
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
            credentialRef: params.command?.credentialRef,
            status: 'published',
            failureCode: null,
            version: 1
          }]
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('handshake_failed')
    expect(await service.get()).toMatchObject({
      channels: [{ memberBots: [expect.objectContaining({
        agentId: 'agent-a',
        appId: 'cli-retry',
        publicationStatus: 'failed'
      })] }]
    })
    expect([...credentialStore.values.values()]).toContainEqual({
      appId: 'cli-retry',
      appSecret: 'retry-secret'
    })
    await expect(service.retryMemberBot('agent-a')).rejects.toThrow('handshake_failed')
    expect(publicationIntent).toMatchObject({
      state: 'failed_recoverable',
      remoteAppId: 'cli-retry',
      lastCompletedStep: 'version_published'
    })
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
    const unknownError = Object.assign(new Error('provisioning_transport_lost'), {
      code: 'provisioning_transport_lost',
      remoteState: 'create_outcome_unknown' as const
    })
    const provision = vi.fn(async (
      _input: Parameters<FeishuMemberBotProvisioner['create']>[0]
    ) => {
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

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('provisioning_transport_lost')
    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('避免重复创建应用')

    expect(provision).toHaveBeenCalledTimes(1)
    expect(createCount).toBe(1)
    expect(publicationIntent).toMatchObject({
      state: 'failed_unknown_remote_state',
      remoteAppId: null
    })
  })

  it('does not expose an in-memory App ID when the durable freeze also fails', async () => {
    const owner = identity()
    let publicationIntent: Record<string, unknown> | null = null
    let advanceCalls = 0
    const create = vi.fn(async (
      input: Parameters<FeishuMemberBotProvisioner['create']>[0]
    ) => {
      try {
        await input.onRemoteAppCreated?.({
          appId: 'cli-not-frozen',
          creationMode: 'template'
        })
      } catch {
        throw Object.assign(new Error('core_freeze_failed'), {
          code: 'core_freeze_failed',
          remoteState: 'create_outcome_unknown' as const
        })
      }
      throw new Error('expected durable freeze to fail')
    })
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: developerSession(owner),
      memberBotProvisioner: { create },
      createChannel: fakeCreateChannel(),
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
          return { status: 'applied' }
        }
        if (method === 'channels.feishu.publicationIntent.advance') {
          advanceCalls += 1
          if (advanceCalls === 1 && publicationIntent) {
            publicationIntent = {
              ...publicationIntent,
              ...params.command,
              version: 2,
              updatedAt: '2026-08-27T00:01:00Z'
            }
            return { status: 'applied' }
          }
          throw new Error('core_publication_write_unavailable')
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('core_freeze_failed')

    expect((await service.get()).activeProvisioning).toMatchObject({
      stage: 'unknown_remote_state',
      remoteAppId: null
    })
    expect(publicationIntent).toMatchObject({
      state: 'session_verified',
      remoteAppId: null
    })
  })

  it('keeps an Event timeout recoverable after App-ID freeze and reconciles the same app', async () => {
    const owner = identity()
    const credentialStore = memoryCredentialStore()
    let publicationIntent: Record<string, unknown> | null = null
    let memberBots: Record<string, unknown>[] = []
    let intentCreates = 0
    const eventError = Object.assign(new Error('feishu_console_event_verification_failed'), {
      code: 'feishu_console_event_verification_failed',
      remoteState: 'known_frozen' as const
    })
    const create = vi.fn(async (
      input: Parameters<FeishuMemberBotProvisioner['create']>[0]
    ) => {
      await input.onRemoteAppCreated?.({
        appId: 'cli-event-timeout',
        creationMode: 'template'
      })
      input.onProgress?.('configuration_waiting', 'cli-event-timeout')
      throw eventError
    })
    const reconcile = vi.fn(async () => ({
      appId: 'cli-event-timeout',
      appSecret: 'event-timeout-secret',
      botDisplayName: '审阅员',
      publishedVersionId: 'version_2'
    }))
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: { create, reconcile },
      createChannel: fakeCreateChannel(),
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
          intentCreates += 1
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
            appId: params.command?.appId,
            botDisplayName: params.command?.botDisplayName,
            credentialRef: params.command?.credentialRef,
            status: 'published',
            failureCode: null,
            version: 1
          }]
        }
        return { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a'))
      .rejects.toThrow('feishu_console_event_verification_failed')
    expect(publicationIntent).toMatchObject({
      state: 'failed_recoverable',
      remoteAppId: 'cli-event-timeout',
      lastCompletedStep: 'app_created'
    })
    expect((await service.get()).activeProvisioning).toMatchObject({
      stage: 'failed',
      remoteAppId: 'cli-event-timeout',
      detail: expect.stringContaining('原应用已保留')
    })

    await expect(service.retryMemberBot('agent-a')).resolves.toMatchObject({
      activeProvisioning: { stage: 'completed', remoteAppId: 'cli-event-timeout' }
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      remoteAppId: 'cli-event-timeout'
    }))
    expect(intentCreates).toBe(1)
    expect(publicationIntent).toMatchObject({
      state: 'completed',
      remoteAppId: 'cli-event-timeout'
    })
  })

  it('projects a frozen failed publication intent after a Desktop restart', async () => {
    const account = connectedAccount()
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account,
            publicationIntents: [{
              publicationIntentId: 'intent-unknown',
              agentId: 'agent-a',
              accountId: account.accountId,
              expectedUserIdDigest: account.userIdDigest,
              expectedTenantId: account.tenantId,
              requestedAppName: '审阅员',
              provisioningMode: 'developer_session',
              state: 'failed_unknown_remote_state',
              remoteAppId: 'cli-frozen',
              credentialRef: null,
              lastCompletedStep: 'session_verified',
              failureCode: 'feishu_console_event_verification_failed',
              version: 3,
              createdAt: '2026-08-27T00:00:00Z',
              updatedAt: '2026-08-27T00:01:00Z'
            }]
          })
        }
        throw new Error(`unexpected method: ${method}`)
      })
    })

    const snapshot = await service.get()

    expect(snapshot.channels[0].memberBots).toContainEqual({
      agentId: 'agent-a',
      publicationStatus: 'failed',
      botDisplayName: '审阅员',
      appId: 'cli-frozen',
      managementUrl: 'https://open.feishu.cn/app/cli-frozen/baseinfo',
      failureCode: 'feishu_console_event_verification_failed'
    })
  })

  it('reconciles the frozen remote app on an explicit retry without creating another app', async () => {
    const owner = identity()
    const credentialStore = memoryCredentialStore()
    const create = vi.fn()
    const reconcile = vi.fn(async () => ({
      appId: 'cli-published-remotely',
      appSecret: 'recovered-secret',
      botDisplayName: '审阅员',
      publishedVersionId: 'version_1'
    }))
    let publicationIntent: Record<string, unknown> = {
      publicationIntentId: 'intent-unknown',
      agentId: 'agent-a',
      accountId: connectedAccount(owner).accountId,
      expectedUserIdDigest: connectedAccount(owner).userIdDigest,
      expectedTenantId: owner.tenantId,
      requestedAppName: '审阅员',
      provisioningMode: 'developer_session',
      state: 'failed_unknown_remote_state',
      remoteAppId: 'cli-published-remotely',
      credentialRef: null,
      lastCompletedStep: null,
      failureCode: 'feishu_console_release_version_http_400',
      version: 4,
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-27T00:01:00Z'
    }
    let memberBots: Record<string, unknown>[] = []
    let intentCreates = 0
    const memberBotProvisioner = { create, reconcile } as FeishuMemberBotProvisioner
    const avatarSource = {
      pngBytes: new Uint8Array([4, 5, 6]),
      width: 192,
      height: 192
    }
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner,
      memberBotAvatarSource: { resolve: vi.fn(async () => avatarSource) },
      createChannel: fakeCreateChannel(),
      core: channelCore((method, rawParams) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account: connectedAccount(owner),
            memberBots,
            publicationIntents: [publicationIntent]
          })
        }
        if (method === 'members.get') return presentAgent('agent-a', {
          avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
        })
        const params = rawParams as { command?: Record<string, unknown> }
        if (method === 'channels.feishu.publicationIntent.create') intentCreates += 1
        if (method === 'channels.feishu.publicationIntent.advance') {
          publicationIntent = {
            ...publicationIntent,
            ...params.command,
            version: Number(publicationIntent.version) + 1,
            updatedAt: '2026-08-27T00:02:00Z'
          }
        }
        if (method === 'channels.feishu.memberBot.upsert') {
          memberBots = [{
            agentId: 'agent-a',
            accountId: connectedAccount(owner).accountId,
            appId: 'cli-published-remotely',
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

    const recovered = await service.publishMemberBot('agent-a')

    expect(create).not.toHaveBeenCalled()
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      publicationIntentId: 'intent-unknown',
      remoteAppId: 'cli-published-remotely',
      expectedDeveloperIdentity: { userId: owner.userId, tenantId: owner.tenantId },
      appDescription: 'Rovai AI 队员 · 代码审阅',
      avatarSource
    }))
    expect(intentCreates).toBe(0)
    const storedCredential = [...credentialStore.values.entries()][0]
    expect(storedCredential?.[1]).toEqual({
      appId: 'cli-published-remotely',
      appSecret: 'recovered-secret'
    })
    expect(publicationIntent).toMatchObject({
      state: 'completed',
      remoteAppId: 'cli-published-remotely',
      credentialRef: storedCredential?.[0]
    })
    expect(recovered.activeProvisioning).toMatchObject({
      stage: 'completed',
      remoteAppId: 'cli-published-remotely'
    })
  })

  it('rechecks online readiness on retry for a completed Bot without changing its app id', async () => {
    const owner = identity()
    const credentialRef = 'credential-agent-a'
    const credentialStore = memoryCredentialStore({
      [credentialRef]: { appId: 'cli-frozen', appSecret: 'existing-secret' }
    })
    const create = vi.fn()
    const reconcile = vi.fn(async () => ({
      appId: 'cli-frozen',
      appSecret: 'existing-secret',
      botDisplayName: '审阅员',
      publishedVersionId: 'version_2'
    }))
    let publicationIntent: Record<string, unknown> = {
      publicationIntentId: 'intent-completed',
      agentId: 'agent-a',
      accountId: connectedAccount(owner).accountId,
      expectedUserIdDigest: connectedAccount(owner).userIdDigest,
      expectedTenantId: owner.tenantId,
      requestedAppName: '审阅员',
      provisioningMode: 'developer_session',
      state: 'completed',
      remoteAppId: 'cli-frozen',
      credentialRef,
      lastCompletedStep: 'completed',
      failureCode: null,
      version: 7,
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-27T00:01:00Z'
    }
    const memberBot = {
      agentId: 'agent-a',
      accountId: connectedAccount(owner).accountId,
      brand: 'feishu',
      appId: 'cli-frozen',
      botDisplayName: '审阅员',
      credentialRef,
      status: 'published',
      failureCode: null,
      version: 3
    }
    const service = new ChannelSettingsService({
      credentialStore,
      developerSession: developerSession(owner),
      memberBotProvisioner: { create, reconcile },
      memberBotAvatarSource: {
        resolve: vi.fn(async () => ({
          pngBytes: new Uint8Array([4, 5, 6]),
          width: 192,
          height: 192
        }))
      },
      createChannel: fakeCreateChannel(),
      core: channelCore((method, rawParams) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account: connectedAccount(owner),
            memberBots: [memberBot],
            publicationIntents: [publicationIntent]
          })
        }
        if (method === 'members.get') return presentAgent()
        const params = rawParams as { command?: Record<string, unknown> }
        if (method === 'channels.feishu.publicationIntent.advance') {
          publicationIntent = {
            ...publicationIntent,
            ...params.command,
            version: Number(publicationIntent.version) + 1,
            updatedAt: '2026-08-27T00:02:00Z'
          }
        }
        return { status: 'applied' }
      })
    })

    await expect(service.retryMemberBot('agent-a')).resolves.toMatchObject({
      activeProvisioning: { stage: 'completed', remoteAppId: 'cli-frozen' }
    })
    expect(create).not.toHaveBeenCalled()
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      remoteAppId: 'cli-frozen',
      publicationIntentId: 'intent-completed'
    }))
    expect(publicationIntent).toMatchObject({
      state: 'completed',
      remoteAppId: 'cli-frozen',
      credentialRef
    })
  })

  it('gates non-owner input, keeps /new private-only, and trusts callback operator envelopes', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    const commands: Array<{ method: string; command: Record<string, unknown> }> = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      now: () => 200_000_000,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        commands.push({ method, command })
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            memberBots: [{
              agentId: 'agent-a',
              accountId: 'account-1',
              brand: 'feishu',
              appId: 'cli_a',
              botDisplayName: '审阅员',
              credentialRef: 'feishu-member-a',
              status: 'published',
              failureCode: null,
              version: 1,
              ownerIdentityStatus: 'verified'
            }]
          })
        }
        if (method === 'channels.feishu.owner.verify') {
          const owner = command.senderUserId === 'owner-user-id'
          return {
            status: 'applied',
            code: owner ? 'channel.owner.verified' : 'channel.owner.non_owner',
            payload: { classification: owner ? 'owner' : 'non_owner' }
          }
        }
        if (method === 'channels.feishu.dm.startNew') {
          return { status: 'applied', code: 'channel.dm.started_new', payload: {} }
        }
        if (method === 'channels.feishu.pendingBinding.resolve') {
          return {
            status: 'accepted',
            code: 'channel.binding.resolved',
            payload: { projectDisplayName: 'Rovai 项目' }
          }
        }
        if (method === 'channels.host.tick') {
          return { status: 'applied', code: 'channels.host.ticked', payload: { deliveries: [] } }
        }
        return { status: 'applied', code: `${method}.applied`, payload: {} }
      })
    })
    await service.start()
    const messageHandler = harness.handlers.get('cli_a:message')!

    const outsider = normalizedMessage({
      messageId: 'om_outsider',
      senderUserId: 'other-user',
      content: '你好'
    })
    await messageHandler(outsider)
    await messageHandler({ ...outsider, messageId: 'om_outsider_again' })
    expect(commands.filter(({ method }) => method === 'channels.inbound.observe')).toHaveLength(0)
    expect(harness.send.mock.calls.filter(([, input]) => (
      (input as { text?: string }).text === '该 Bot 当前仅供 Rovai 主人使用。'
    ))).toHaveLength(1)

    await messageHandler(normalizedMessage({
      messageId: 'om_new_private',
      senderUserId: 'owner-user-id',
      content: '/new'
    }))
    expect(commands.filter(({ method }) => method === 'channels.feishu.dm.startNew')).toHaveLength(1)
    expect(commands.filter(({ method }) => method === 'channels.inbound.observe')).toHaveLength(0)

    await messageHandler(normalizedMessage({
      messageId: 'om_new_group',
      chatId: 'oc_group',
      chatType: 'group',
      senderUserId: 'owner-user-id',
      content: '@_bot /new',
      mentions: [{ key: '@_bot', openId: 'ou_bot_a', name: '审阅员', isBot: true }]
    }))
    expect(commands.filter(({ method }) => method === 'channels.feishu.dm.startNew')).toHaveLength(1)

    const cardHandler = harness.handlers.get('cli_a:cardAction')!
    await cardHandler({
      messageId: 'om_card',
      chatId: 'oc_owner_dm',
      operator: { openId: 'ou_owner', userId: 'owner-user-id' },
      action: {
        tag: 'button',
        value: {
          rovaiAction: 'bind_project',
          pendingBindingId: 'rvpcb_1',
          projectId: 'rvproj_1',
          expectedVersion: 1,
          nonce: 'nonce-1',
          operatorOpenId: 'ou_spoofed'
        }
      },
      raw: {
        operator: {
          open_id: 'ou_owner',
          user_id: 'owner-user-id',
          union_id: 'on_owner'
        }
      }
    })
    const callback = commands.find(({ method }) => (
      method === 'channels.feishu.pendingBinding.resolve'
    ))?.command
    expect(callback).toMatchObject({
      appId: 'cli_a',
      operatorOpenId: 'ou_owner',
      operatorUserId: 'owner-user-id',
      operatorUnionId: 'on_owner'
    })
    expect(JSON.stringify(callback)).not.toContain('ou_spoofed')
    expect(harness.updateCard).toHaveBeenCalledTimes(1)
    await service.stop()
  })

  it('freezes the first canonical mentioned managed Bot as the multi-Bot acknowledgement sender', async () => {
    const harness = controlledChannels({
      cli_a: { openId: 'ou_bot_a', name: '审阅员' },
      cli_b: { openId: 'ou_bot_b', name: '资料员' }
    })
    const observations: Record<string, unknown>[] = []
    const bots = [{
      agentId: 'agent-a',
      accountId: 'account-1',
      brand: 'feishu',
      appId: 'cli_a',
      botDisplayName: '审阅员',
      credentialRef: 'feishu-member-a',
      status: 'published',
      failureCode: null,
      version: 1,
      ownerIdentityStatus: 'verified'
    }, {
      agentId: 'agent-b',
      accountId: 'account-1',
      brand: 'feishu',
      appId: 'cli_b',
      botDisplayName: '资料员',
      credentialRef: 'feishu-member-b',
      status: 'published',
      failureCode: null,
      version: 1,
      ownerIdentityStatus: 'verified'
    }]
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' },
        'feishu-member-b': { appId: 'cli_b', appSecret: 'secret-b' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ memberBots: bots })
        if (method === 'channels.feishu.owner.verify') {
          return {
            status: 'applied',
            code: 'channel.owner.verified',
            payload: { classification: 'owner' }
          }
        }
        if (method === 'channels.inbound.observe') {
          observations.push(command)
          return {
            status: 'accepted',
            code: 'channel.inbound.collecting',
            payload: { aggregateId: 'rvcia_1', readyToFinalize: false }
          }
        }
        if (method === 'channels.host.tick') {
          return { status: 'applied', code: 'channels.host.ticked', payload: { deliveries: [] } }
        }
        return { status: 'applied', code: `${method}.applied`, payload: {} }
      })
    })
    await service.start()
    const messageHandler = harness.handlers.get('cli_a:message')!
    await messageHandler(normalizedMessage({
      messageId: 'om_multi',
      chatId: 'oc_multi',
      chatType: 'group',
      senderUserId: 'owner-user-id',
      content: '@_bot_b @_bot_a 一起检查',
      mentions: [
        { key: '@_bot_b', openId: 'ou_bot_b', name: '资料员', isBot: true },
        { key: '@_bot_a', openId: 'ou_bot_a', name: '审阅员', isBot: true }
      ]
    }))
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      acknowledgementAppId: 'cli_b',
      expectedAppIds: ['cli_a', 'cli_b'],
      canonicalAgentIds: ['agent-a', 'agent-b'],
      canonicalMentionsComplete: true
    })
    await service.stop()
  })
})
