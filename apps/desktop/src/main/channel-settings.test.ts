import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createLarkChannel,
  LarkChannelError,
  LoggerLevel
} from '@larksuiteoapi/node-sdk'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import {
  ChannelSettingsService,
  type ChannelHostDependencies
} from './channel-settings'
import type {
  ChannelCredentialStore,
  FeishuAppCredential
} from './channel-credential-store'
import type {
  FeishuDeveloperIdentity,
  FeishuDeveloperSessionInspection
} from './feishu-developer-session'
import type { FeishuMemberBotProvisioner } from './feishu-member-bot-provisioner'

function channelCore(
  handler: (method: string, params: unknown) => unknown | Promise<unknown>
): ChannelHostDependencies['core'] {
  return {
    request: (method, params) => Promise.resolve(handler(method, params))
  } as ChannelHostDependencies['core']
}

function consoleCommandEvidence(agentRunId: string): AgentRunExecutionEvidenceView[] {
  return [{
    id: `evidence-${agentRunId}`,
    agentRunId,
    executionEpoch: 1,
    sequence: 1,
    eventType: 'activity.completed',
    kind: 'command',
    phase: 'completed',
    payload: { item: {
      type: 'commandExecution', command: 'pnpm test', status: 'completed',
      aggregatedOutput: 'tests passed\nAuthorization: Bearer private-stdout-token'
    } },
    contentBlobId: null,
    contentByteCount: 0,
    isTruncated: false,
    occurredAt: '2026-08-28T00:00:01Z',
    canonical: null
  }]
}

function memoryCredentialStore(
  initial: Record<string, FeishuAppCredential> = {}
): ChannelCredentialStore & { values: Map<string, FeishuAppCredential> } {
  const values = new Map(Object.entries(initial))
  const store = {
    values,
    async read(credentialRef: string) {
      return values.get(credentialRef) ?? null
    },
    async write(credentialRef: string, credential: FeishuAppCredential) {
      values.set(credentialRef, structuredClone(credential))
    },
    async delete(credentialRef: string) {
      values.delete(credentialRef)
    },
    async listPublished() {
      return [...values].map(([credentialRef, credential]) => ({
        agentId: credentialRef,
        credentialRef,
        provider: 'feishu' as const,
        remoteAppId: credential.appId,
        credential,
        revision: 1
      }))
    }
  }
  return store
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
    pendingConnection: vi.fn(() => ({ identity: value, session: { cookies: [] } })),
    activatePendingLogin: vi.fn(async () => undefined),
    discardPendingLogin: vi.fn(async () => value),
    inspect: vi.fn(async () => ({ status: 'valid' as const, identity: value })),
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
  handlers: Map<string, (event: unknown) => unknown | Promise<unknown>>
  send: ReturnType<typeof vi.fn>
  updateCard: ReturnType<typeof vi.fn>
  recallMessage: ReturnType<typeof vi.fn>
  createMessage: ReturnType<typeof vi.fn>
  replyMessage: ReturnType<typeof vi.fn>
  getChatMode: ReturnType<typeof vi.fn>
  isInChat: Map<string, ReturnType<typeof vi.fn>>
} {
  const handlers = new Map<string, (event: unknown) => unknown | Promise<unknown>>()
  const send = vi.fn(async () => ({ messageId: 'om_sent' }))
  const updateCard = vi.fn(async () => undefined)
  const recallMessage = vi.fn(async () => undefined)
  const createMessage = vi.fn(async () => ({ code: 0, data: { message_id: 'om_output' } }))
  const replyMessage = vi.fn(async () => ({ code: 0, data: { message_id: 'om_output_reply' } }))
  const getChatMode = vi.fn(async (_chatId: string): Promise<'p2p' | 'group' | 'topic'> => 'group')
  const isInChat = new Map<string, ReturnType<typeof vi.fn>>()
  const createChannel = vi.fn((options: { appId: string }) => {
    const observeMembership = vi.fn(async () => ({ code: 0, data: { is_in_chat: true } }))
    isInChat.set(options.appId, observeMembership)
    return {
      botIdentity: identities[options.appId],
      on: (event: string, handler: (value: unknown) => unknown | Promise<unknown>) => {
        handlers.set(`${options.appId}:${event}`, handler)
        return () => handlers.delete(`${options.appId}:${event}`)
      },
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      send,
      updateCard,
      recallMessage,
      getChatMode,
      getChatInfo: vi.fn(async () => ({ name: '测试群' })),
      rawClient: {
        im: { v1: {
          message: { create: createMessage, reply: replyMessage },
          chatMembers: {
            isInChat: observeMembership
          }
        } }
      }
    }
  }) as unknown as NonNullable<ChannelHostDependencies['createChannel']>
  return { createChannel, handlers, send, updateCard, recallMessage, createMessage, replyMessage, getChatMode, isInChat }
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
  omitSenderUserId?: boolean
  content: string
  mentions?: Array<{ key: string; openId?: string; name?: string; isBot?: boolean }>
  rootId?: string
  threadId?: string
  replyToMessageId?: string
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
    rootId: input.rootId,
    threadId: input.threadId,
    replyToMessageId: input.replyToMessageId,
    createTime: Date.now(),
    raw: {
      tenant_key: 'tenant-1',
      sender: {
        tenant_key: 'tenant-1',
        sender_id: {
          open_id: input.senderOpenId ?? `ou_${input.senderUserId}`,
          ...(input.omitSenderUserId ? {} : { user_id: input.senderUserId }),
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
  it('does not expire a connected account when startup inspection throws a transient error', async () => {
    const session = developerSession()
    session.inspect.mockRejectedValue(new Error('ERR_INTERNET_DISCONNECTED'))
    const commands: string[] = []
    const service = new ChannelSettingsService({
      ...inertInterval(),
      credentialStore: memoryCredentialStore(),
      developerSession: session,
      core: channelCore((method) => {
        commands.push(method)
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account: connectedAccount() })
        return { status: 'applied', payload: { deliveries: [] } }
      })
    })
    try {
      await service.start()
      await vi.waitFor(() => expect(session.inspect).toHaveBeenCalled())
      expect(commands).not.toContain('channels.feishu.account.expire')
      expect(session.disconnect).not.toHaveBeenCalled()
    } finally {
      await service.stop()
    }
  })

  it('starts published Bots before a pending developer session inspection finishes', async () => {
    const session = developerSession()
    let finishInspection!: (value: FeishuDeveloperSessionInspection) => void
    const pending = new Promise<FeishuDeveloperSessionInspection>((resolve) => { finishInspection = resolve })
    session.inspect.mockReturnValue(pending)
    const createChannel = fakeCreateChannel()
    const service = new ChannelSettingsService({
      ...inertInterval(),
      developerSession: session,
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'fixture-secret' }
      }),
      createChannel,
      core: channelCore((method) => {
        if (method === 'channels.feishu.snapshot') return coreSnapshot({
          account: connectedAccount(),
          memberBots: [{
            agentId: 'agent-a', accountId: connectedAccount().accountId,
            brand: 'feishu', appId: 'cli_a', botDisplayName: '审阅员',
            credentialRef: 'feishu-member-a', status: 'published', failureCode: null,
            version: 1, ownerIdentityStatus: 'verified'
          }]
        })
        return { status: 'applied', payload: { deliveries: [] } }
      })
    })
    const starting = service.start()
    try {
      await vi.waitFor(() => expect(createChannel).toHaveBeenCalledTimes(1), { timeout: 200 })
      await starting
    } finally {
      finishInspection({ status: 'valid', identity: identity() })
      await starting
      await service.stop()
    }
  })

  it.each(['expired', 'identity_changed'] as const)(
    'expires the account only after a conclusive background inspection: %s',
    async (reason) => {
      const session = developerSession()
      session.inspect.mockResolvedValue({ status: 'invalid', reason })
      const commands: string[] = []
      const service = new ChannelSettingsService({
        ...inertInterval(), credentialStore: memoryCredentialStore(), developerSession: session,
        core: channelCore((method) => {
          commands.push(method)
          if (method === 'channels.feishu.snapshot') return coreSnapshot({ account: connectedAccount() })
          return { status: 'applied', payload: { deliveries: [] } }
        })
      })
      try {
        await service.start()
        await vi.waitFor(() => expect(commands).toContain('channels.feishu.account.expire'))
      } finally {
        await service.stop()
      }
    }
  )

  it('ignores a stale background invalidation after a new account connection commits', async () => {
    const replacement = identity({ userId: 'replacement-owner' })
    const session = developerSession(replacement)
    let finishInspection!: (value: FeishuDeveloperSessionInspection) => void
    const inspecting = new Promise<FeishuDeveloperSessionInspection>((resolve) => { finishInspection = resolve })
    session.inspect.mockReturnValue(inspecting)
    let account = connectedAccount()
    const commands: string[] = []
    const service = new ChannelSettingsService({
      ...inertInterval(), credentialStore: memoryCredentialStore(), developerSession: session,
      core: channelCore((method) => {
        commands.push(method)
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account })
        if (method === 'channels.feishu.account.commitConnection') {
          account = connectedAccount(replacement)
          return { status: 'applied', payload: { sessionRevision: 2 } }
        }
        return { status: 'applied', payload: { deliveries: [] } }
      })
    })
    try {
      await service.start()
      await service.connect()
      finishInspection({ status: 'invalid', reason: 'expired' })
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(commands).not.toContain('channels.feishu.account.expire')
      expect(commands).not.toContain('channels.feishu.account.upsert')
      expect((await service.get()).channels[0].connection).toMatchObject({
        status: 'connected', account: { accountId: connectedAccount(replacement).accountId }
      })
    } finally {
      finishInspection({ status: 'invalid', reason: 'expired' })
      await service.stop()
    }
  })

  it('preserves the account when publishing cannot inspect the developer session temporarily', async () => {
    const session = developerSession()
    session.inspect.mockResolvedValue({ status: 'unavailable' })
    const commands: string[] = []
    const provision = vi.fn()
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(), developerSession: session,
      memberBotProvisioner: { create: provision },
      core: channelCore((method) => {
        commands.push(method)
        return method === 'channels.feishu.snapshot'
          ? coreSnapshot({ account: connectedAccount() }) : { status: 'applied' }
      })
    })

    await expect(service.publishMemberBot('agent-a')).rejects.toThrow('已有登录会话已保留')
    expect(commands).not.toContain('channels.feishu.account.expire')
    expect(provision).not.toHaveBeenCalled()
  })

  it('propagates card-action acknowledgements through the installed Lark SDK', async () => {
    const channel = createLarkChannel({
      appId: 'cli_card_ack_test',
      appSecret: 'secret-card-ack-test',
      transport: 'websocket',
      includeRawEvent: true,
      loggerLevel: LoggerLevel.error
    })
    const internals = channel as unknown as {
      registerDispatcherHandlers: () => void
      dispatcher: {
        invoke: (event: unknown, options: { needCheck: false }) => Promise<unknown>
      }
    }
    internals.registerDispatcherHandlers()
    channel.on('cardAction', async () => ({
      toast: { type: 'warning', content: '仅 Rovai Owner 可以选择项目' }
    }))

    await expect(internals.dispatcher.invoke({
      schema: '2.0',
      header: { event_type: 'card.action.trigger' },
      event: {
        context: { open_message_id: 'om_card_ack', open_chat_id: 'oc_card_ack' },
        operator: { open_id: 'ou_card_ack' },
        action: { tag: 'button', value: { rovaiAction: 'bind_project' } }
      }
    }, { needCheck: false })).resolves.toEqual({
      toast: { type: 'warning', content: '仅 Rovai Owner 可以选择项目' }
    })
  })

  it('surfaces Feishu Bot removal events through the installed Lark SDK', async () => {
    const channel = createLarkChannel({
      appId: 'cli_bot_removed_test',
      appSecret: 'secret-bot-removed-test',
      transport: 'websocket',
      includeRawEvent: true,
      loggerLevel: LoggerLevel.error
    })
    const internals = channel as unknown as {
      registerDispatcherHandlers: () => void
      dispatcher: {
        invoke: (event: unknown, options: { needCheck: false }) => Promise<unknown>
      }
    }
    internals.registerDispatcherHandlers()
    const removed = vi.fn()
    channel.on('botRemoved', removed)

    await internals.dispatcher.invoke({
      schema: '2.0',
      header: { event_type: 'im.chat.member.bot.deleted_v1' },
      event: {
        chat_id: 'oc_removed',
        operator_id: { open_id: 'ou_owner' },
        name: '审阅员'
      }
    }, { needCheck: false })

    expect(removed).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'oc_removed',
      botName: '审阅员'
    }))
  })

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
        memberBots: [],
        pendingBindingCount: 0,
        bindingIssueCount: 0
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
    const activatePendingLogin = vi.fn(async () => undefined)
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
        pendingConnection: () => ({ identity: identity(), session: { cookies: [] } }),
        activatePendingLogin,
        async discardPendingLogin() { return null },
        async inspect() { return { status: 'invalid', reason: 'missing' } },
        async requireExpectedIdentity() { throw new Error('not_used') },
        async disconnect() {}
      },
      core: channelCore((method, params) => {
        commands.push({ method, params })
        if (method === 'channels.feishu.account.commitConnection') {
          return { status: 'applied', payload: { sessionRevision: 1 } }
        }
        return coreSnapshot()
      })
    })

    await service.connect()

    expect(beginLogin).toHaveBeenCalledWith(expect.objectContaining({ forceFresh: true }))
    expect(activatePendingLogin).toHaveBeenCalledWith(1)
    expect(provision).not.toHaveBeenCalled()
    expect(credentialStore.values.size).toBe(0)
    const commit = commands.find((entry) => (
      entry.method === 'channels.feishu.account.commitConnection'
    ))
    expect(commit).toBeDefined()
    expect(JSON.stringify(commit)).toContain('Murray')
    expect(JSON.stringify(commit)).toContain('murray@example.com')
    expect(JSON.stringify(commit)).toContain('owner-user-id')
    expect(JSON.stringify(commit)).toContain('tenant-1')
    expect(JSON.stringify(commit)).not.toMatch(/appSecret|client_secret|controller/i)
  })

  it('uses only the developer session for publishing', async () => {
    const diagnosticLines: string[] = []
    const info = vi.spyOn(console, 'info').mockImplementation((line) => {
      diagnosticLines.push(String(line))
    })
    const owner = identity()
    const credentialStore = memoryCredentialStore()
    const memberBotUpserts: Record<string, unknown>[] = []
    const storedCredentials: Record<string, unknown>[] = []
    const provision = vi.fn(async () => ({
      appId: 'cli-normal',
      appSecret: 'normal-secret',
      ownerOpenId: 'ou_owner_normal',
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
      core: channelCore((method, rawParams) => {
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ account: connectedAccount(owner) })
        }
        if (method === 'members.get') return presentAgent('agent-a', {
          avatarRef: 'rovai://member-avatar/builtin/luoke/v1'
        })
        if (method === 'channels.feishu.memberBot.upsert') {
          memberBotUpserts.push(
            (rawParams as { command: Record<string, unknown> }).command
          )
        }
        if (method === 'channels.feishu.publicationIntent.storeCredential') {
          storedCredentials.push(
            (rawParams as { command: Record<string, unknown> }).command
          )
        }
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
    expect(storedCredentials).toContainEqual(expect.objectContaining({
      provider: 'feishu', remoteAppId: 'cli-normal',
      credential: { appSecret: 'normal-secret' }
    }))
    expect(memberBotUpserts).toHaveLength(2)
    expect(memberBotUpserts).toEqual([
      expect.objectContaining({
        appId: 'cli-normal',
        ownerOpenId: 'ou_owner_normal',
        botOpenId: null
      }),
      expect.objectContaining({
        appId: 'cli-normal',
        ownerOpenId: 'ou_owner_normal',
        botOpenId: 'bot-open-id'
      })
    ])

    expect(provision).toHaveBeenCalledTimes(1)
    const timingLines = diagnosticLines.filter((line) => (
      line.startsWith('[feishu.provision.timing] ')
    ))
    expect(timingLines.map((line) => JSON.parse(
      line.slice('[feishu.provision.timing] '.length)
    )).map((sample: { phase: string }) => sample.phase)).toEqual([
      'websocket_handshake_ms',
      'total_ms'
    ])
    expect(timingLines.join('\n')).not.toMatch(/cli-normal|normal-secret|ou_owner_normal/)
    info.mockRestore()
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
        ownerOpenId: 'ou_owner_fresh',
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
      ownerOpenId: 'ou_owner_frozen',
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
    const storedCredentials: Record<string, unknown>[] = []
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
        if (method === 'channels.feishu.publicationIntent.storeCredential') {
          storedCredentials.push(params.command ?? {})
          publicationIntent = {
            ...publicationIntent,
            state: 'credentials_read',
            credentialRef: params.command?.credentialRef,
            version: Number(publicationIntent.version) + 1
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
      'bot_configured',
      'version_published',
      'connection_verified',
      'completed'
    ])
    expect(storedCredentials).toHaveLength(1)
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
        async inspect() { return { status: 'invalid', reason: 'missing' } },
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

  it('treats a cancelled account switch as a quiet no-op', async () => {
    const account = connectedAccount()
    const commands: string[] = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: {
        async beginLogin() { throw new Error('feishu_login_cancelled') },
        async inspect() { return { status: 'valid', identity: identity() } },
        async requireExpectedIdentity() { return identity() },
        async disconnect() {}
      },
      core: channelCore((method) => {
        commands.push(method)
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account })
        return { status: 'applied' }
      })
    })

    await expect(service.connect()).resolves.toMatchObject({
      activeQrAttempt: null,
      channels: [{ connection: { status: 'connected' } }]
    })

    expect(commands).not.toContain('channels.feishu.account.expire')
    expect((await service.get()).channels[0].connection.status).toBe('connected')
  })

  it('quietly closes a cancelled first login without creating account state', async () => {
    const commands: string[] = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: {
        async beginLogin() { throw new Error('feishu_login_cancelled') },
        async inspect() { return { status: 'invalid', reason: 'missing' } },
        async requireExpectedIdentity() { throw new Error('not_used') },
        async disconnect() {}
      },
      core: channelCore((method) => {
        commands.push(method)
        return method === 'channels.feishu.snapshot' ? coreSnapshot() : { status: 'applied' }
      })
    })

    await expect(service.connect()).resolves.toMatchObject({
      activeQrAttempt: null,
      channels: [{ connection: { status: 'not_connected', account: null } }]
    })

    expect(commands).not.toContain('channels.feishu.account.upsert')
  })

  it('rolls the staged developer session back when the Core account switch cannot commit', async () => {
    const account = connectedAccount()
    const activatePendingLogin = vi.fn(async () => undefined)
    const discardPendingLogin = vi.fn(async () => identity())
    const commands: string[] = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore(),
      developerSession: {
        async beginLogin() { return identity({ userId: 'replacement-owner' }) },
        pendingConnection: () => ({
          identity: identity({ userId: 'replacement-owner' }),
          session: { cookies: [] }
        }),
        activatePendingLogin,
        discardPendingLogin,
        async inspect() { return { status: 'valid', identity: identity() } },
        async requireExpectedIdentity() { return identity() },
        async disconnect() {}
      },
      core: channelCore((method) => {
        commands.push(method)
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ account })
        if (method === 'channels.feishu.account.commitConnection') {
          throw new Error('core_switch_failed')
        }
        return { status: 'applied' }
      })
    })

    await expect(service.connect()).rejects.toThrow('core_switch_failed')

    expect(discardPendingLogin).toHaveBeenCalledTimes(1)
    expect(activatePendingLogin).not.toHaveBeenCalled()
    expect(commands).not.toContain('channels.feishu.account.expire')
  })

  it('fails before provisioning when the developer session has expired', async () => {
    const owner = identity()
    const provision = vi.fn()
    const expiredSession = developerSession(owner)
    expiredSession.inspect.mockResolvedValue({ status: 'invalid', reason: 'expired' })
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
            ownerOpenId: 'ou_owner_retry',
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
        } else if (
          method === 'channels.feishu.publicationIntent.storeCredential'
          && publicationIntent
        ) {
          const command = params.command ?? {}
          const credential = command.credential as { appSecret?: string } | undefined
          credentialStore.values.set(String(command.credentialRef), {
            appId: String(command.remoteAppId),
            appSecret: String(credential?.appSecret)
          })
          publicationIntent = {
            ...publicationIntent,
            state: 'credentials_read',
            credentialRef: command.credentialRef,
            lastCompletedStep: 'credentials_read',
            version: Number(publicationIntent.version) + 1
          }
        } else if (method === 'channels.feishu.memberBot.upsert') {
          expect(params.command).toMatchObject({ ownerOpenId: 'ou_owner_retry' })
          memberBots = [{
            agentId: 'agent-a',
            accountId: connectedAccount(owner).accountId,
            appId: 'cli-retry',
            botDisplayName: '审阅员',
            credentialRef: params.command?.credentialRef,
            status: 'published',
            failureCode: null,
            version: 1,
            ownerIdentityStatus: 'verified'
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
      ownerOpenId: 'ou_owner_event_timeout',
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
      ownerOpenId: 'ou_owner_published_remotely',
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
        if (method === 'channels.feishu.publicationIntent.storeCredential') {
          const command = params.command ?? {}
          const credential = command.credential as { appSecret?: string } | undefined
          credentialStore.values.set(String(command.credentialRef), {
            appId: String(command.remoteAppId),
            appSecret: String(credential?.appSecret)
          })
          publicationIntent = {
            ...publicationIntent,
            state: 'credentials_read',
            credentialRef: command.credentialRef,
            lastCompletedStep: 'credentials_read',
            version: Number(publicationIntent.version) + 1
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
      appDescription: 'Rovai AI Teammate · 代码审阅',
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
      ownerOpenId: 'ou_owner_frozen',
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

  it('shares the existing Bot connection with an explicit preview without admitting preview callbacks to Core', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    const requests: string[] = []
    const previewResponse = { card: { type: 'raw' as const, data: { schema: '2.0', body: { elements: [] } } } }
    const executionPreview = {
      connected: vi.fn(async () => undefined),
      handleCardAction: vi.fn(async () => previewResponse)
    }
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({ 'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' } }),
      createChannel: harness.createChannel, executionPreview, ...inertInterval(),
      core: channelCore((method) => {
        requests.push(method)
        if (method === 'channels.feishu.snapshot') return coreSnapshot({ memberBots: [{
          agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
          botDisplayName: '审阅员', credentialRef: 'feishu-member-a', status: 'published',
          failureCode: null, version: 1, ownerIdentityStatus: 'verified'
        }] })
        if (method === 'agents.list') return [presentAgent()]
        if (method === 'channels.delivery.claim') return []
        return { status: 'applied', code: 'ok', payload: {} }
      })
    })
    await service.start()
    expect(harness.createChannel).toHaveBeenCalledTimes(1)
    expect(executionPreview.connected).toHaveBeenCalledWith('agent-a', 'cli_a', expect.anything())
    const result = await harness.handlers.get('cli_a:cardAction')!({
      messageId: 'om_preview', chatId: 'oc_preview', operator: { openId: 'ou_owner' },
      action: { tag: 'button', value: { action: 'execution_console_page', agentRunId: 'feishu-preview:fixture', pageIndex: 1, snapshotSequence: 1 } }
    })
    expect(result).toEqual(previewResponse)
    expect(harness.updateCard).not.toHaveBeenCalled()
    expect(requests).not.toContain('channels.executionConsole.page.authorize')
    expect(requests).not.toContain('channels.executionConsole.source')
    await service.stop()
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
            }],
            transportConversations: [{
              channelConversationId: 'rvcc_group',
              bindingId: null,
              provider: 'feishu',
              tenantKey: 'tenant-1',
              chatId: 'oc_group',
              topicKey: '',
              conversationKind: 'group',
              campId: null
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
          if (command.pendingBindingId === 'rvpcb_fail') throw new Error('core_unavailable')
          if (command.operatorUserId !== 'owner-user-id') {
            return {
              status: 'rejected',
              code: 'channel.binding.owner_required',
              payload: {}
            }
          }
          return {
            status: 'accepted',
            code: 'channel.binding.resolved',
            payload: {
              projectDisplayName: command.action === 'quick_chat' ? null : 'Rovai 项目',
              executionScopeKind: command.action === 'quick_chat' ? 'quick_chat' : 'project'
            }
          }
        }
        if (method === 'channels.executionConsole.source') {
          return {
            sequence: 7,
            agentRunId: 'run-console',
            agentDisplayName: '审阅员',
            run: { status: 'succeeded', waitReason: null, terminalReasonCode: null },
            evidence: consoleCommandEvidence('run-console'),
            publicOutput: '执行台输出',
            startedAt: '2026-08-28T00:00:00Z',
            terminalAt: '2026-08-28T00:00:05Z',
            targetAppId: 'cli_a',
            externalMessageId: 'om_console',
            state: 'terminal_sealed'
          }
        }
        if (method === 'channels.executionConsole.recentOutput.authorize') {
          if (command.operatorUserId !== 'owner-user-id') {
            return {
              status: 'rejected',
              code: 'channel.execution_console.owner_required',
              payload: {}
            }
          }
          return {
            status: 'accepted',
            code: 'channel.execution_console.recent_output_authorized',
            payload: { snapshotSequence: 7 }
          }
        }
        if (method === 'channels.host.tick') {
          return { deliveries: [] }
        }
        return { status: 'applied', code: `${method}.applied`, payload: {} }
      })
    })
    await service.start()
    await vi.waitFor(() => expect(harness.isInChat.get('cli_a')).toHaveBeenCalled())
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
      (input as { text?: string }).text === '该 Bot 当前仅供 Rovai Owner 使用。'
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
    const ownerResult = await cardHandler({
      messageId: 'om_card',
      chatId: 'oc_group',
      operator: { openId: 'ou_owner', userId: 'owner-user-id' },
      action: {
        tag: 'select_static',
        option: 'rvproj_1',
        value: {
          rovaiAction: 'bind_project',
          pendingBindingId: 'rvpcb_1',
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
      externalPickerMessageId: 'om_card',
      operatorOpenId: 'ou_owner',
      operatorUserId: 'owner-user-id',
      operatorUnionId: 'on_owner'
    })
    expect(JSON.stringify(callback)).not.toContain('ou_spoofed')
    const firstResolveIndex = commands.findIndex(({ method }) => (
      method === 'channels.feishu.pendingBinding.resolve'
    ))
    expect(commands[firstResolveIndex - 1]?.method).toBe('channels.roster.reconcile')
    expect(ownerResult).toEqual({
      toast: { type: 'success', content: '项目已绑定，正在处理消息' }
    })
    expect(harness.updateCard).not.toHaveBeenCalled()

    const nonOwnerResult = await cardHandler({
      messageId: 'om_card',
      chatId: 'oc_group',
      operator: { openId: 'ou_other', userId: 'other-user-id' },
      action: {
        tag: 'button',
        value: {
          rovaiAction: 'bind_project',
          pendingBindingId: 'rvpcb_1',
          projectId: 'rvproj_1',
          expectedVersion: 1,
          nonce: 'nonce-1'
        }
      },
      raw: {
        operator: {
          open_id: 'ou_other',
          user_id: 'other-user-id',
          union_id: 'on_other'
        }
      }
    })
    expect(nonOwnerResult).toEqual({
      toast: { type: 'warning', content: '仅 Rovai Owner 可以选择项目' }
    })
    expect(commands.filter(({ method }) => (
      method === 'channels.feishu.pendingBinding.resolve'
    ))).toHaveLength(2)
    expect(harness.updateCard).not.toHaveBeenCalled()

    for (const owner of [true, false]) {
      const result = await cardHandler({
        messageId: 'om_card',
        chatId: 'oc_group',
        operator: { openId: owner ? 'ou_owner' : 'ou_other' },
        action: {
          tag: 'button',
          value: {
            rovaiAction: 'start_quick_chat',
            pendingBindingId: 'rvpcb_1',
            expectedVersion: 1,
            nonce: 'nonce-1',
            operatorUserId: 'spoofed-owner'
          }
        },
        raw: { operator: {
          open_id: owner ? 'ou_owner' : 'ou_other',
          user_id: owner ? 'owner-user-id' : 'other-user-id',
          union_id: owner ? 'on_owner' : 'on_other'
        } }
      })
      const resolveIndex = commands.findLastIndex(({ method }) => (
        method === 'channels.feishu.pendingBinding.resolve'
      ))
      expect(commands[resolveIndex - 1]?.method).toBe('channels.roster.reconcile')
      expect(commands[resolveIndex]?.command).toMatchObject({
        action: 'quick_chat',
        projectId: null,
        pendingBindingId: 'rvpcb_1',
        externalPickerMessageId: 'om_card',
        expectedVersion: 1,
        nonce: 'nonce-1',
        appId: 'cli_a',
        operatorUserId: owner ? 'owner-user-id' : 'other-user-id'
      })
      expect(result).toEqual({ toast: owner
        ? { type: 'success', content: '已开始快速对话，正在处理消息' }
        : { type: 'warning', content: '仅 Rovai Owner 可以选择项目' }
      })
    }
    expect(harness.updateCard).not.toHaveBeenCalled()

    const failedResult = await cardHandler({
      messageId: 'om_card_fail',
      chatId: 'oc_group',
      operator: { openId: 'ou_owner', userId: 'owner-user-id' },
      action: {
        tag: 'button',
        value: {
          rovaiAction: 'bind_project',
          pendingBindingId: 'rvpcb_fail',
          projectId: 'rvproj_1',
          expectedVersion: 1,
          nonce: 'nonce-1'
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
    expect(failedResult).toEqual({
      toast: { type: 'error', content: '创建失败，请重试' }
    })

    const tickCountBeforePaging = commands.filter(({ method }) => (
      method === 'channels.host.tick'
    )).length
    const pageResult = await cardHandler({
      messageId: 'om_console',
      chatId: 'oc_group',
      operator: { openId: 'ou_owner', userId: 'owner-user-id' },
      action: {
        tag: 'button',
        value: {
          action: 'execution_recent_output',
          agentRunId: 'run-console',
          visible: true,
          operatorUserId: 'spoofed-user'
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
    const executionCallback = commands.find(({ method }) => (
      method === 'channels.executionConsole.recentOutput.authorize'
    ))?.command
    expect(executionCallback).toMatchObject({
      appId: 'cli_a',
      externalMessageId: 'om_console',
      agentRunId: 'run-console',
      operatorOpenId: 'ou_owner',
      operatorUserId: 'owner-user-id',
      operatorUnionId: 'on_owner'
    })
    expect(JSON.stringify(executionCallback)).not.toContain('spoofed-user')
    expect(executionCallback).not.toHaveProperty('snapshotSequence')
    const authorizationIndex = commands.findIndex(({ method }) => method === 'channels.executionConsole.recentOutput.authorize')
    const sourceIndex = commands.findIndex(({ method }) => method === 'channels.executionConsole.source')
    expect(authorizationIndex).toBeLessThan(sourceIndex)
    expect(harness.updateCard).not.toHaveBeenCalled()
    expect(pageResult).toEqual({
      card: { type: 'raw', data: expect.objectContaining({
        header: expect.objectContaining({
          title: { tag: 'plain_text', content: '审阅员 · 已完成' }
        }),
        body: expect.objectContaining({ elements: expect.arrayContaining([
          expect.objectContaining({ tag: 'markdown', content: '执行台输出' })
        ]) })
      }) }
    })

    const sourceReadsBeforeOutsider = commands.filter(({ method }) => method === 'channels.executionConsole.source').length
    const outsiderExecutionResult = await cardHandler({
      messageId: 'om_console',
      chatId: 'oc_group',
      operator: { openId: 'ou_other', userId: 'other-user-id' },
      action: {
        tag: 'button',
        value: {
          action: 'execution_recent_output',
          agentRunId: 'run-console',
          visible: true
        }
      },
      raw: {
        operator: {
          open_id: 'ou_other',
          user_id: 'other-user-id',
          union_id: 'on_other'
        }
      }
    })
    expect(outsiderExecutionResult).toEqual({
      toast: { type: 'warning', content: '无权限' }
    })
    expect(commands.filter(({ method }) => method === 'channels.executionConsole.source')).toHaveLength(sourceReadsBeforeOutsider)
    expect(harness.updateCard).not.toHaveBeenCalled()

    const repeatedPageResult = await cardHandler({
      messageId: 'om_console',
      chatId: 'oc_group',
      operator: { openId: 'ou_owner', userId: 'owner-user-id' },
      action: {
        tag: 'button',
        value: {
          action: 'execution_recent_output',
          agentRunId: 'run-console',
          visible: false
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
    expect(repeatedPageResult).toEqual({
      card: { type: 'raw', data: expect.objectContaining({
        body: expect.objectContaining({ elements: [expect.objectContaining({ tag: 'column_set' })] })
      }) }
    })
    expect(harness.updateCard).not.toHaveBeenCalled()
    expect(commands.filter(({ method }) => method === 'channels.host.tick')).toHaveLength(
      tickCountBeforePaging
    )
    expect(commands.some(({ method }) => method === 'channels.executionConsole.view.update')).toBe(false)
    expect(harness.send).not.toHaveBeenCalledWith(
      'oc_group',
      expect.objectContaining({ card: expect.anything() }),
      expect.anything()
    )
    await service.stop()
  })

  it.each(['unavailable', 'authorize', 'source', 'source_error'] as const)(
    'returns a safe page error for %s without dispatching late work or pumping the outbox', async (failure) => {
      const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
      let release!: (value: unknown) => void
      const deferred = new Promise<unknown>(resolve => { release = resolve })
      const source = {
        sequence: 7, agentRunId: 'run-console', agentDisplayName: '审阅员',
        run: { status: 'succeeded', waitReason: null, terminalReasonCode: null },
        evidence: consoleCommandEvidence('run-console'), publicOutput: null,
        startedAt: '2026-08-28T00:00:00Z', terminalAt: '2026-08-28T00:00:05Z',
        targetAppId: 'cli_a', externalMessageId: 'om_console', state: 'terminal_sealed'
      }
      const authorized = { status: 'accepted', code: 'channel.execution_console.recent_output_authorized', payload: { snapshotSequence: 7 } }
      const requests: string[] = []
      const service = new ChannelSettingsService({
        credentialStore: memoryCredentialStore({ 'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' } }),
        createChannel: harness.createChannel, ...inertInterval(),
        core: channelCore((method) => {
          requests.push(method)
          if (method === 'channels.feishu.snapshot') return coreSnapshot({ memberBots: [{
            agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
            botDisplayName: '审阅员', credentialRef: 'feishu-member-a', status: 'published',
            failureCode: null, version: 1, ownerIdentityStatus: 'verified'
          }] })
          if (method === 'agents.list') return [presentAgent()]
          if (method === 'channels.delivery.claim') return []
          if (method === 'channels.executionConsole.recentOutput.authorize') {
            if (failure === 'unavailable') throw Object.assign(new Error('private-core-diagnostic'), { code: 'full_core_unavailable' })
            return failure === 'authorize' ? deferred : authorized
          }
          if (method === 'channels.executionConsole.source') {
            if (failure === 'source_error') throw new Error('private-core-diagnostic')
            return failure === 'source' ? deferred : source
          }
          return { status: 'applied', code: 'ok', payload: {} }
        })
      })
      await service.start()
      await vi.waitFor(() => expect(requests).toContain('channels.host.tick'))
      const tickCount = requests.filter(method => method === 'channels.host.tick').length
      vi.useFakeTimers()
      try {
        let response: unknown
        const pending = Promise.resolve(harness.handlers.get('cli_a:cardAction')!({
          messageId: 'om_console', chatId: 'oc_group', operator: { openId: 'ou_owner' },
          action: { tag: 'button', value: { action: 'execution_recent_output', agentRunId: 'run-console', visible: true } }
        })).then(value => { response = value })
        await vi.advanceTimersByTimeAsync(2500)
        expect(response).toEqual({ toast: { type: 'error', content: failure === 'unavailable'
          ? 'Rovai 执行服务暂不可用，请检查本机 Rovai 状态后重试'
          : failure === 'source_error' ? '执行记录暂时无法翻页，请稍后重试'
            : '翻页响应超时，请稍后重试' } })
        release(failure === 'authorize' ? authorized : source)
        await pending
        await vi.advanceTimersByTimeAsync(0)
        expect(harness.updateCard).not.toHaveBeenCalled()
        if (failure === 'authorize' || failure === 'unavailable') expect(requests).not.toContain('channels.executionConsole.source')
        expect(requests.filter(method => method === 'channels.host.tick')).toHaveLength(tickCount)
        expect(JSON.stringify(response)).not.toContain('private-core-diagnostic')
      } finally {
        release(null)
        vi.useRealTimers()
        await service.stop()
      }
    }
  )

  it('accepts topics only from a standalone topic-group chat mode', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    harness.getChatMode.mockImplementation(async (chatId: string) => (
      chatId === 'oc_topic_group' ? 'topic' : 'group'
    ))
    const observations: Record<string, unknown>[] = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ memberBots: [{
            agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
            botDisplayName: '审阅员', credentialRef: 'feishu-member-a', status: 'published',
            failureCode: null, version: 1, ownerIdentityStatus: 'verified'
          }], transportConversations: [{
            channelConversationId: 'rvcc_topic', bindingId: null, provider: 'feishu',
            tenantKey: 'tenant-1', chatId: 'oc_topic_group', topicKey: 'om_topic_root',
            conversationKind: 'topic', campId: null
          }] })
        }
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
            payload: { aggregateId: `rvcia_${observations.length}`, readyToFinalize: false }
          }
        }
        if (method === 'channels.host.tick') {
          return { deliveries: [] }
        }
        return { status: 'applied', code: `${method}.applied`, payload: {} }
      })
    })
    await service.start()
    await vi.waitFor(() => expect(harness.isInChat.get('cli_a')).toHaveBeenCalled())
    const messageHandler = harness.handlers.get('cli_a:message')!
    const initialRosterReads = harness.isInChat.get('cli_a')!.mock.calls.length
    const mention = [{ key: '@_bot', openId: 'ou_bot_a', name: '审阅员', isBot: true }]

    await messageHandler(normalizedMessage({
      messageId: 'om_group_reply',
      chatId: 'oc_regular_group',
      chatType: 'group',
      senderUserId: 'owner-user-id',
      content: '@_bot 普通群消息回复',
      mentions: mention,
      rootId: 'om_regular_root',
      threadId: 'omt_regular_thread'
    }))
    await messageHandler(normalizedMessage({
      messageId: 'om_topic_reply',
      chatId: 'oc_topic_group',
      chatType: 'group',
      senderUserId: 'owner-user-id',
      content: '@_bot 独立话题群消息',
      mentions: mention,
      rootId: 'om_topic_root',
      threadId: 'omt_topic_thread',
      replyToMessageId: 'om_topic_parent'
    }))
    await messageHandler(normalizedMessage({
      messageId: 'om_second_topic_root',
      chatId: 'oc_topic_group',
      chatType: 'group',
      senderUserId: 'owner-user-id',
      content: '@_bot 独立话题群新话题',
      mentions: mention,
      threadId: 'omt_second_topic'
    }))

    expect(observations).toHaveLength(2)
    expect(observations).not.toContainEqual(expect.objectContaining({
      chatId: 'oc_regular_group'
    }))
    expect(observations[0]).toMatchObject({
      chatId: 'oc_topic_group',
      conversationKind: 'topic',
      topicKey: 'om_topic_root',
      conversationDisplayName: '测试群 · 话题'
    })
    expect(observations[1]).toMatchObject({
      chatId: 'oc_topic_group',
      conversationKind: 'topic',
      topicKey: 'om_second_topic_root',
      conversationDisplayName: '测试群 · 话题'
    })
    expect(harness.isInChat.get('cli_a')).toHaveBeenCalledTimes(initialRosterReads + 2)
    await harness.handlers.get('cli_a:botRemoved')!({
      chatId: 'oc_topic_group',
      operator: { openId: 'ou_owner' },
      botName: '审阅员'
    })
    expect(harness.isInChat.get('cli_a')).toHaveBeenCalledTimes(initialRosterReads + 3)
    await service.stop()
  })

  it('refreshes a Topic parent roster requested by Core before delivery materialization', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    const calls: Array<{ method: string; command: Record<string, unknown> }> = []
    let refreshRequested = false
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command
          ?? {})
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            memberBots: [{
              agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
              botDisplayName: '审阅员', credentialRef: 'feishu-member-a', status: 'published',
              failureCode: null, version: 1, ownerIdentityStatus: 'verified'
            }]
          })
        }
        if (method === 'channels.host.tick') {
          calls.push({ method, command })
          expect(rawParams).toEqual({ workerId: expect.any(String), limit: 20 })
          if (refreshRequested) {
            return { deliveries: [], rosterRefreshes: [] }
          }
          refreshRequested = true
          return {
            deliveries: [],
            rosterRefreshes: [{
              provider: 'feishu',
              tenantKey: 'tenant-1',
              chatId: 'oc_topic_group',
              requiredRosterGeneration: 7
            }]
          }
        }
        if (method === 'channels.roster.reconcile') {
          calls.push({ method, command })
          return { status: 'applied', payload: { generation: 7 } }
        }
        return { status: 'applied', payload: {} }
      })
    })

    await service.start()
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === 'channels.roster.reconcile')).toBe(true)
    })

    expect(harness.isInChat.get('cli_a')).toHaveBeenCalledTimes(1)
    expect(calls.map((call) => call.method).slice(0, 2)).toEqual([
      'channels.host.tick',
      'channels.roster.reconcile'
    ])
    expect(calls.find((call) => call.method === 'channels.roster.reconcile')?.command)
      .toMatchObject({
        provider: 'feishu',
        tenantKey: 'tenant-1',
        chatId: 'oc_topic_group',
        presentAppIds: ['cli_a']
      })
    await service.stop()
  })

  it.each([true, false])('delivers group/topic workspace pickers and recalls them durably (projects: %s)', async (hasProjects) => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    const settlements: Array<Record<string, unknown>> = []
    let delivered = false
    const projectPayload = (conversationKind: 'group' | 'topic') => ({
      kind: 'project_selection',
      placement: 'conversation',
      operation: 'send',
      pendingBindingId: `rvpcb_${conversationKind}`,
      conversationKind,
      expectedVersion: 1,
      nonce: `nonce-${conversationKind}`,
      projectOptions: hasProjects ? [{ projectId: 'project-safe', displayName: 'Rovai AI' }] : []
    })
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ memberBots: [{
            agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
            botDisplayName: '审阅员', credentialRef: 'feishu-member-a', status: 'published',
            failureCode: null, version: 1, ownerIdentityStatus: 'verified'
          }] })
        }
        if (method === 'channels.host.tick') {
          if (delivered) return { deliveries: [] }
          delivered = true
          return { deliveries: [{
            deliveryId: 'picker-group', requestId: null, deliveryKind: 'project_selection',
            targetAppId: 'cli_a', credentialRef: 'feishu-member-a', chatId: 'oc_group',
            topicKey: '', conversationKind: 'group', attemptCount: 1,
            updateMessageId: null, recipientOpenId: 'ou_owner', payload: projectPayload('group')
          }, {
            deliveryId: 'picker-topic', requestId: null, deliveryKind: 'project_selection',
            targetAppId: 'cli_a', credentialRef: 'feishu-member-a', chatId: 'oc_topic_group',
            topicKey: 'om_topic_root', conversationKind: 'topic', attemptCount: 1,
            updateMessageId: null, recipientOpenId: 'ou_owner', payload: projectPayload('topic')
          }, {
            deliveryId: 'picker-update', requestId: null, deliveryKind: 'project_selection',
            targetAppId: 'cli_a', credentialRef: 'feishu-member-a', chatId: 'oc_group',
            topicKey: '', conversationKind: 'group', attemptCount: 1,
            updateMessageId: 'om_picker_group', recipientOpenId: 'ou_owner',
            payload: { ...projectPayload('group'), operation: 'update', expectedVersion: 2 }
          }, {
            deliveryId: 'picker-recall', requestId: null, deliveryKind: 'project_selection',
            targetAppId: 'cli_a', credentialRef: 'feishu-member-a', chatId: 'oc_group',
            topicKey: '', conversationKind: 'group', attemptCount: 1,
            updateMessageId: 'om_picker_group', recipientOpenId: 'ou_owner',
            payload: {
              kind: 'project_selection_recall', placement: 'conversation', operation: 'recall',
              pendingBindingId: 'rvpcb_group', expectedVersion: 2,
              externalPickerMessageId: 'om_picker_group'
            }
          }] }
        }
        if (method === 'channels.deliveries.settle') {
          settlements.push(command)
          return { status: 'applied', payload: {} }
        }
        return { status: 'applied', payload: {} }
      })
    })

    await service.start()
    await vi.waitFor(() => expect(settlements).toHaveLength(4))

    expect(harness.send).toHaveBeenCalledWith(
      'oc_group',
      { card: expect.objectContaining({
        header: expect.objectContaining({
          title: { tag: 'plain_text', content: '选择 Rovai 项目' }
        })
      }) },
      undefined
    )
    expect(harness.send).toHaveBeenCalledWith(
      'oc_topic_group',
      { card: expect.any(Object) },
      { replyTo: 'om_topic_root', replyInThread: true }
    )
    const groupPickerInput = harness.send.mock.calls.find(([target]) => target === 'oc_group')?.[1] as {
      card: {
        config: Record<string, unknown>
        body: { elements: Array<Record<string, unknown>> }
      }
    }
    expect(groupPickerInput.card.config).toEqual({ update_multi: true })
    expect(groupPickerInput.card.body.elements.some((element) => element.tag === 'action')).toBe(false)
    if (hasProjects) expect(groupPickerInput.card.body.elements).toContainEqual({
      tag: 'select_static',
      type: 'default',
      width: 'fill',
      placeholder: { tag: 'plain_text', content: '选择项目' },
      options: [{
        text: { tag: 'plain_text', content: 'Rovai AI' },
        value: 'project-safe'
      }],
      behaviors: [{
        type: 'callback',
        value: {
          rovaiAction: 'bind_project',
          pendingBindingId: 'rvpcb_group',
          expectedVersion: 1,
          nonce: 'nonce-group'
        }
      }]
    })
    else expect(groupPickerInput.card.body.elements.some((element) => element.tag === 'select_static')).toBe(false)
    for (const kind of ['group', 'topic'] as const) {
      const target = kind === 'topic' ? 'oc_topic_group' : 'oc_group'
      const picker = harness.send.mock.calls.find(([chat]) => chat === target)?.[1] as typeof groupPickerInput
      expect(picker.card.body.elements.map((element) => element.tag)).toEqual(
        hasProjects ? ['markdown', 'select_static', 'column_set'] : ['markdown', 'column_set']
      )
      const scope = kind === 'topic' ? '话题' : '群聊'
      expect(picker.card.body.elements[0]?.content).toBe([
        '选择一个项目，或直接开始快速对话。',
        `选择项目后，这个${scope}之后都会使用该项目；快速对话不绑定项目。`,
        ...(!hasProjects ? ['当前没有可用项目。可以直接开始快速对话，或在 Rovai 创建或打开一个项目后刷新。'] : [])
      ].join('\n\n'))
      expect(picker.card.body.elements.at(-1)).toEqual({
        tag: 'column_set',
        horizontal_spacing: '8px',
        columns: [
          { text: '开始快速对话', action: 'start_quick_chat', type: 'primary' },
          { text: '刷新项目', action: 'refresh_projects', type: 'default' }
        ].map((button) => ({
          tag: 'column',
          width: 'weighted',
          weight: 1,
          elements: [{
            tag: 'button',
            text: { tag: 'plain_text', content: button.text },
            type: button.type,
            width: 'fill',
            behaviors: [{ type: 'callback', value: {
              rovaiAction: button.action,
              pendingBindingId: `rvpcb_${kind}`,
              expectedVersion: 1,
              nonce: `nonce-${kind}`
            } }]
          }]
        }))
      })
    }
    expect(harness.send.mock.calls.map(([target]) => target)).not.toContain('ou_owner')
    expect(JSON.stringify(harness.send.mock.calls)).not.toContain('选择后会立即处理刚才的消息。')
    expect(JSON.stringify(harness.send.mock.calls)).not.toContain('项目路径只保留在 Rovai 本机，不会发送到飞书。')
    expect(JSON.stringify(harness.send.mock.calls)).not.toContain('canonicalPath')
    expect(harness.updateCard).toHaveBeenCalledWith('om_picker_group', expect.any(Object))
    expect(harness.recallMessage).toHaveBeenCalledWith('om_picker_group')
    await service.stop()
  })

  it('accepts the frozen App-scoped Owner open_id when an event omits user_id', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    const commands: Array<{ method: string; command: Record<string, unknown> }> = []
    const owner = identity()
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        commands.push({ method, command })
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account: connectedAccount(owner),
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
          const isOwner = command.senderOpenId === 'ou_owner_for_cli_a'
          return {
            status: 'applied',
            code: isOwner ? 'channel.owner.verified' : 'channel.owner.non_owner',
            payload: { classification: isOwner ? 'owner' : 'non_owner' }
          }
        }
        if (method === 'channels.inbound.observe') {
          return {
            status: 'accepted',
            code: 'channel.inbound.accepted',
            payload: { aggregateId: 'rvcia_owner', readyToFinalize: false }
          }
        }
        if (method === 'channels.host.tick') {
          return { deliveries: [] }
        }
        return { status: 'applied', code: `${method}.applied`, payload: {} }
      })
    })
    await service.start()

    await harness.handlers.get('cli_a:message')!(normalizedMessage({
      messageId: 'om_owner_without_user_id',
      senderUserId: owner.userId,
      senderOpenId: 'ou_owner_for_cli_a',
      senderUnionId: 'on_owner',
      omitSenderUserId: true,
      content: '你好'
    }))

    expect(commands.find(({ method }) => method === 'channels.feishu.owner.verify')?.command)
      .toMatchObject({
        appId: 'cli_a',
        senderOpenId: 'ou_owner_for_cli_a',
        senderUserId: null,
        senderUnionId: 'on_owner'
      })
    expect(commands.filter(({ method }) => method === 'channels.inbound.observe')).toHaveLength(1)
    expect(harness.send).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      text: '该 Bot 当前仅供 Rovai Owner 使用。'
    }))
    await service.stop()
  })

  it('reports a connection error when Core has no frozen App-scoped Owner identity', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '审阅员' } })
    const commands: Array<{ method: string; command: Record<string, unknown> }> = []
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        commands.push({ method, command })
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            account: connectedAccount(),
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
              ownerIdentityStatus: 'unverified'
            }]
          })
        }
        if (method === 'channels.host.tick') {
          return { deliveries: [] }
        }
        if (method === 'channels.feishu.owner.verify') {
          return {
            status: 'applied',
            code: 'channel.owner.unverified',
            payload: { classification: 'unverified' }
          }
        }
        return { status: 'applied', code: `${method}.applied`, payload: {} }
      })
    })
    await service.start()

    await harness.handlers.get('cli_a:message')!(normalizedMessage({
      messageId: 'om_owner_resolution_unavailable',
      senderUserId: 'owner-user-id',
      senderOpenId: 'ou_owner',
      senderUnionId: 'on_owner',
      omitSenderUserId: true,
      content: '你好'
    }))

    expect(commands.filter(({ method }) => method === 'channels.feishu.owner.verify'))
      .toHaveLength(1)
    expect(commands.filter(({ method }) => method === 'channels.inbound.observe'))
      .toHaveLength(0)
    expect(harness.send).toHaveBeenCalledWith('oc_test', {
      text: '飞书连接异常，请稍后重试。'
    })
    expect(harness.send).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      text: '该 Bot 当前仅供 Rovai Owner 使用。'
    }))
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
          return { deliveries: [] }
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

  it.each([
    { label: 'live send', runStatus: 'running', updateMessageId: null },
    { label: 'live update', runStatus: 'running', updateMessageId: 'om_console' },
    { label: 'sealed send', runStatus: 'succeeded', updateMessageId: null },
    { label: 'sealed update', runStatus: 'succeeded', updateMessageId: 'om_console' }
  ])('keeps $label console disclosure separate from permanent Agent output cards', async ({ runStatus, updateMessageId }) => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '芝士' } })
    const settlements: Array<Record<string, unknown>> = []
    const createExecutionViewUrl = vi.fn(async () => 'http://192.168.1.23:8765/execution/run-1#t=fixed-token')
    const revokeExecutionViewUrl = vi.fn()
    let delivered = false
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      executionView: { createExecutionViewUrl, revokeExecutionViewUrl },
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({
            memberBots: [{
              agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
              botDisplayName: '芝士', credentialRef: 'feishu-member-a', status: 'published',
              failureCode: null, version: 1, ownerIdentityStatus: 'verified'
            }]
          })
        }
        if (method === 'channels.host.tick') {
          if (delivered) return { deliveries: [] }
          delivered = true
          return {
            deliveries: [{
              deliveryId: 'delivery-console', requestId: 'request-1',
              deliveryKind: 'execution_console_upsert', targetAppId: 'cli_a',
              credentialRef: 'feishu-member-a', chatId: 'oc_group', topicKey: '',
              conversationKind: 'group', attemptCount: 1, updateMessageId,
              recipientOpenId: 'ou_owner',
              payload: {
                kind: 'execution_console_upsert', executionConsoleId: 'console-1',
                agentRunId: 'run-1', expectedSequence: 1
              }
            }, {
              deliveryId: 'delivery-output', requestId: 'request-1',
              deliveryKind: 'agent_output', targetAppId: 'cli_a',
              credentialRef: 'feishu-member-a', chatId: 'oc_group', topicKey: '',
              conversationKind: 'group', attemptCount: 1, updateMessageId: null,
              recipientOpenId: 'ou_owner',
              payload: { kind: 'agent_output', presentationVersion: 1, body: '这是永久正文。', mentionPrincipal: true,
                reply: { status: 'available', messageId: 'cm_parent', authorDisplayName: 'Murray', body: '请检查这个问题。' },
                memberRecipients: [{ agentId: 'agent-b', displayName: '响子', openId: 'ou_bot_b' }] }
            }]
          }
        }
        if (method === 'channels.executionConsole.source') {
          return {
            sequence: 1,
            agentRunId: 'run-1',
            campId: 'camp-1',
            campTurnId: 'turn-1',
            channelConversationId: 'channel-1',
            agentId: 'agent-a',
            runCreatedAt: '2026-08-28T00:00:00Z',
            agentDisplayName: '芝士',
            run: { status: runStatus, waitReason: null, terminalReasonCode: null },
            evidence: consoleCommandEvidence('run-1'),
            publicOutput: runStatus === 'succeeded' ? '执行台最终回复。' : null,
            startedAt: '2026-08-28T00:00:00Z',
            terminalAt: runStatus === 'succeeded' ? '2026-08-28T00:00:05Z' : null,
            targetAppId: 'cli_a',
            externalMessageId: updateMessageId,
            state: runStatus === 'succeeded' ? 'terminal_sealed' : 'active'
          }
        }
        if (method === 'channels.deliveries.settle') {
          settlements.push(command)
          return { status: 'applied', payload: {} }
        }
        return { status: 'applied', payload: {} }
      })
    })

    await service.start()
    await vi.waitFor(() => expect(settlements).toHaveLength(2))

    const expectedCard = expect.objectContaining({
      header: expect.objectContaining({ title: {
        tag: 'plain_text', content: runStatus === 'succeeded' ? '芝士 · 已完成' : '芝士 · 执行中'
      } })
    })
    if (updateMessageId) {
      expect(harness.updateCard).toHaveBeenCalledWith(updateMessageId, expectedCard)
      expect(harness.send).not.toHaveBeenCalled()
    } else {
      expect(harness.send).toHaveBeenCalledWith('oc_group', { card: expectedCard }, undefined)
      expect(harness.updateCard).not.toHaveBeenCalled()
    }
    const card = (updateMessageId
      ? harness.updateCard.mock.calls[0][1]
      : (harness.send.mock.calls[0][1] as { card: unknown }).card
    ) as { body: { elements: Array<{ tag: string; content?: string }> } }
    const visibleBody = card.body.elements
      .filter((element) => element.tag === 'markdown')
      .map((element) => element.content).join('\n')
    expect(card.body.elements).toEqual([expect.objectContaining({ tag: 'column_set' })])
    expect(visibleBody).not.toContain('pnpm test')
    expect(visibleBody).not.toContain('执行台最终回复。')
    expect(JSON.stringify(card)).not.toContain('collapsible_panel')
    expect(JSON.stringify(card)).not.toContain('private-stdout-token')
    expect(JSON.stringify(card)).not.toContain('tests passed')
    expect(createExecutionViewUrl).toHaveBeenCalledTimes(updateMessageId ? 0 : 1)
    expect(JSON.stringify(card).includes('fixed-token')).toBe(updateMessageId === null)
    expect(harness.createMessage).toHaveBeenCalledTimes(1)
    const outputRequest = harness.createMessage.mock.calls[0][0] as unknown as { data: { content: string; msg_type: string; receive_id: string } }
    expect(outputRequest.data).toMatchObject({ msg_type: 'interactive', receive_id: 'oc_group' })
    expect(JSON.parse(outputRequest.data.content)).toEqual({
      schema: '2.0', config: { update_multi: true }, body: { elements: [
        { tag: 'markdown', text_size: 'notation', content: '> 回复 Murray\n> 请检查这个问题。' },
        { tag: 'markdown', content: '这是永久正文。' },
        { tag: 'markdown', text_size: 'notation', content: '发送给 <at id="ou_bot_b"></at> <at id="ou_owner"></at>' }
      ] }
    })
    expect(JSON.stringify(harness.send.mock.calls)).not.toContain('Rovai 队员回复')
    expect(settlements.every((command) => command.outcome === 'sent')).toBe(true)
    await service.stop()
  })

  it('returns an 已取消 execution card immediately after the Owner stops the exact Run', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '芝士' } })
    const settlements: Array<Record<string, unknown>> = []
    const commands: Array<{ method: string; command: Record<string, unknown> }> = []
    let delivered = false
    let runStatus: 'running' | 'cancelled' = 'running'
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        commands.push({ method, command })
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ memberBots: [{
            agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
            botDisplayName: '芝士', credentialRef: 'feishu-member-a', status: 'published',
            failureCode: null, version: 1, ownerIdentityStatus: 'verified'
          }] })
        }
        if (method === 'channels.host.tick') {
          if (delivered) return { deliveries: [] }
          delivered = true
          return { deliveries: [{
            deliveryId: 'delivery-console', requestId: 'request-1',
            deliveryKind: 'execution_console_upsert', targetAppId: 'cli_a',
            credentialRef: 'feishu-member-a', chatId: 'oc_group', topicKey: '',
            conversationKind: 'group', attemptCount: 1, updateMessageId: null,
            recipientOpenId: 'ou_owner',
            payload: {
              kind: 'execution_console_upsert', executionConsoleId: 'console-1',
              agentRunId: 'run-1', expectedSequence: 1
            }
          }] }
        }
        if (method === 'channels.executionConsole.source') {
          return {
            sequence: 1,
            agentRunId: 'run-1',
            campId: 'camp-1',
            campTurnId: 'turn-1',
            channelConversationId: 'channel-1',
            agentId: 'agent-a',
            runCreatedAt: '2026-08-28T00:00:00Z',
            agentDisplayName: '芝士',
            run: { status: runStatus, waitReason: null, terminalReasonCode: null },
            evidence: consoleCommandEvidence('run-1'),
            publicOutput: null,
            startedAt: '2026-08-28T00:00:00Z',
            terminalAt: runStatus === 'cancelled' ? '2026-08-28T00:00:05Z' : null,
            targetAppId: 'cli_a',
            externalMessageId: runStatus === 'cancelled' ? 'om_sent' : null,
            state: runStatus === 'cancelled' ? 'terminal_sealed' : 'active'
          }
        }
        if (method === 'channels.executionConsole.agentRun.cancel') {
          runStatus = 'cancelled'
          return {
            status: 'applied',
            code: 'agent_run.cancelled',
            payload: {
              agentRunId: 'run-1',
              campId: 'camp-1',
              campTurnId: 'turn-1',
              campTurnStatus: 'cancelled',
              status: 'cancelled'
            }
          }
        }
        if (method === 'channels.deliveries.settle') {
          settlements.push(command)
          return { status: 'applied', payload: {} }
        }
        return { status: 'applied', payload: {} }
      })
    })

    await service.start()
    await vi.waitFor(() => expect(settlements).toHaveLength(1))

    const response = await harness.handlers.get('cli_a:cardAction')!({
      messageId: 'om_sent',
      chatId: 'oc_group',
      operator: { openId: 'ou_owner', userId: 'owner-user-id' },
      action: {
        tag: 'button',
        value: { action: 'execution_stop', agentRunId: 'run-1' }
      },
      raw: {
        event_id: 'evt-stop-1',
        operator: {
          open_id: 'ou_owner',
          user_id: 'owner-user-id',
          union_id: 'on_owner'
        }
      }
    })

    expect(commands.find(({ method }) => method === 'channels.executionConsole.agentRun.cancel')?.command)
      .toMatchObject({
        callbackEventId: 'evt-stop-1',
        appId: 'cli_a',
        externalMessageId: 'om_sent',
        agentRunId: 'run-1',
        operatorOpenId: 'ou_owner',
        operatorUserId: 'owner-user-id',
        operatorUnionId: 'on_owner'
      })
    expect(response).toEqual({
      card: {
        type: 'raw',
        data: expect.objectContaining({
          header: expect.objectContaining({
            title: { tag: 'plain_text', content: '芝士 · 已取消' }
          }),
          body: expect.objectContaining({
            elements: [expect.objectContaining({ tag: 'column_set' })]
          })
        })
      },
      toast: { type: 'success', content: '已取消执行' }
    })
    expect(JSON.stringify(response)).not.toContain('停止执行')
    await service.stop()
  })

  it('treats an already-revoked execution console as a successful recall', async () => {
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '芝士' } })
    harness.recallMessage.mockRejectedValueOnce({ response: { status: 404, data: { code: 230020 } } })
    const settlements: Array<Record<string, unknown>> = []
    let delivered = false
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ memberBots: [{
            agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
            botDisplayName: '芝士', credentialRef: 'feishu-member-a', status: 'published',
            failureCode: null, version: 1, ownerIdentityStatus: 'verified'
          }] })
        }
        if (method === 'channels.host.tick') {
          if (delivered) return { deliveries: [] }
          delivered = true
          return { deliveries: [{
            deliveryId: 'delivery-recall', requestId: 'request-1',
            deliveryKind: 'execution_console_recall', targetAppId: 'cli_a',
            credentialRef: 'feishu-member-a', chatId: 'oc_group', topicKey: '',
            conversationKind: 'group', attemptCount: 1, updateMessageId: 'om_console',
            recipientOpenId: null,
            payload: { kind: 'execution_console_recall', executionConsoleId: 'console-1' }
          }] }
        }
        if (method === 'channels.deliveries.settle') {
          settlements.push(command)
          return { status: 'applied', payload: {} }
        }
        return { status: 'applied', payload: {} }
      })
    })

    await service.start()
    await vi.waitFor(() => expect(settlements).toHaveLength(1))

    expect(harness.recallMessage).toHaveBeenCalledWith('om_console')
    expect(settlements[0]).toMatchObject({
      outcome: 'sent', externalDeliveryMessageId: 'om_console', failureCode: null
    })
    await service.stop()
  })

  it('settles an attachment upload independently without resending its body', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rovai-channel-attachment-'))
    const path = join(directory, 'result.png')
    const bytes = Buffer.from('verified image bytes')
    await writeFile(path, bytes)
    const contentDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
    const harness = controlledChannels({ cli_a: { openId: 'ou_bot_a', name: '芝士' } })
    harness.send.mockImplementation(async (_to, input) => {
      if ('image' in input) throw new LarkChannelError('upload_failed', 'upload failed')
      return { messageId: 'om_body' }
    })
    const settlements: Array<Record<string, unknown>> = []
    let delivered = false
    const service = new ChannelSettingsService({
      credentialStore: memoryCredentialStore({
        'feishu-member-a': { appId: 'cli_a', appSecret: 'secret-a' }
      }),
      createChannel: harness.createChannel,
      ...inertInterval(),
      core: channelCore((method, rawParams) => {
        const command = ((rawParams as { command?: Record<string, unknown> } | undefined)?.command ?? {})
        if (method === 'channels.feishu.snapshot') {
          return coreSnapshot({ memberBots: [{
            agentId: 'agent-a', accountId: 'account-1', brand: 'feishu', appId: 'cli_a',
            botDisplayName: '芝士', credentialRef: 'feishu-member-a', status: 'published',
            failureCode: null, version: 1, ownerIdentityStatus: 'verified'
          }] })
        }
        if (method === 'channels.host.tick') {
          if (delivered) return { deliveries: [] }
          delivered = true
          return { deliveries: [{
            deliveryId: 'delivery-body', requestId: 'request-1', deliveryKind: 'agent_output',
            targetAppId: 'cli_a', credentialRef: 'feishu-member-a', chatId: 'oc_group',
            topicKey: '', conversationKind: 'group', attemptCount: 1, updateMessageId: null,
            recipientOpenId: null,
            payload: { kind: 'agent_output', presentationVersion: 1, body: '先发送正文。', mentionPrincipal: false, memberRecipients: [] }
          }, {
            deliveryId: 'delivery-image', requestId: 'request-1', deliveryKind: 'agent_attachment',
            targetAppId: 'cli_a', credentialRef: 'feishu-member-a', chatId: 'oc_group',
            topicKey: '', conversationKind: 'group', attemptCount: 1, updateMessageId: null,
            recipientOpenId: null,
            payload: {
              kind: 'agent_attachment', campId: 'camp-1', attachmentId: 'attachment-1',
              attachmentKind: 'image', fileName: 'result.png', size: bytes.byteLength,
              contentDigest, requiresBodyDelivery: true, ordinal: 0
            }
          }] }
        }
        if (method === 'camp.attachments.desktopOpenTarget') {
          return {
            attachmentId: 'attachment-1', displayName: 'result.png', kind: 'file',
            mediaType: 'image/png', path, openRisk: 'normal'
          }
        }
        if (method === 'channels.deliveries.settle') {
          settlements.push(command)
          return { status: 'applied', payload: {} }
        }
        return { status: 'applied', payload: {} }
      })
    })

    try {
      await service.start()
      await vi.waitFor(() => expect(settlements).toHaveLength(2))

      expect(harness.createMessage).toHaveBeenCalledTimes(1)
      expect(harness.send.mock.calls.filter(([, input]) => 'markdown' in input)).toHaveLength(0)
      expect(harness.send.mock.calls.filter(([, input]) => 'image' in input)).toHaveLength(1)
      expect(settlements).toEqual(expect.arrayContaining([
        expect.objectContaining({ deliveryId: 'delivery-body', outcome: 'sent' }),
        expect.objectContaining({
          deliveryId: 'delivery-image', outcome: 'failed',
          failureCode: 'upload_failed', retryable: true
        })
      ]))
    } finally {
      await service.stop()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
