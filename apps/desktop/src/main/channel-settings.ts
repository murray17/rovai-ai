import { createHash, randomUUID } from 'node:crypto'
import {
  createLarkChannel,
  LarkChannelError,
  registerApp,
  type BotAddedEvent,
  type LarkChannel,
  type NormalizedMessage
} from '@larksuiteoapi/node-sdk'
import QRCode from 'qrcode'
import type {
  AgentProfile,
  ChannelConversationBindingView,
  ChannelMemberBotView,
  ChannelQrAttemptView,
  ChannelSettingsSnapshot,
  ProjectBindingKind,
  ProjectBindingView,
  StoredCommandResult,
  UnboundChannelConversationView
} from '@contracts'
import type { CoreClient } from './core-client'
import type { ChannelCredentialStore, FeishuAppCredential } from './channel-credential-store'

type CoreChannelSnapshot = {
  schemaVersion: 1
  account: {
    accountId: string
    displayName: string
    tenantName: string
    status: 'connected' | 'disconnected'
    version: number
  } | null
  memberBots: Array<{
    agentId: string
    accountId: string
    appId: string
    botDisplayName: string
    credentialRef: string
    status: 'published' | 'disabled'
    failureCode: string | null
    version: number
  }>
  projectBindings: ProjectBindingView[]
  unboundConversations: UnboundChannelConversationView[]
  conversationBindings: ChannelConversationBindingView[]
  transportConversations: Array<{
    channelConversationId: string
    bindingId: string | null
    provider: 'feishu'
    tenantKey: string
    chatId: string
    topicKey: string
    conversationKind: 'group' | 'topic'
    campId: string | null
  }>
  pendingAggregates: Array<{
    aggregateId: string
    tenantKey: string
    chatId: string
    topicKey: string
    conversationKind: 'p2p' | 'group' | 'topic'
    acknowledgementAppId: string
  }>
}

type ClaimedChannelDelivery = {
  deliveryId: string
  requestId: string
  deliveryKind: 'queue_ack' | 'agent_status' | 'agent_output' | 'completion' | 'attention'
  targetAppId: string
  credentialRef: string
  chatId: string
  topicKey: string
  conversationKind: 'p2p' | 'group' | 'topic'
  payload: Record<string, unknown>
  attemptCount: number
  updateMessageId?: string | null
  recipientOpenId?: string | null
}

type RegistrationResult = Awaited<ReturnType<typeof registerApp>>
type RegisterApp = typeof registerApp
type CreateChannel = typeof createLarkChannel

export interface ChannelHostDependencies {
  core: Pick<CoreClient, 'request'>
  credentialStore: ChannelCredentialStore
  registerApp?: RegisterApp
  createChannel?: CreateChannel
  now?: () => number
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}

type ManagedChannel = {
  agentId: string
  appId: string
  credentialRef: string
  channel: LarkChannel
  unsubscribers: Array<() => void>
}

type RawInboundEvent = {
  tenant_key?: string
  sender?: {
    tenant_key?: string
    sender_id?: { union_id?: string; user_id?: string; open_id?: string }
  }
  message?: {
    message_type?: string
    content?: string
    mentions?: Array<{
      key?: string
      name?: string
      id?: { open_id?: string; user_id?: string; union_id?: string }
    }>
  }
}

const CONTROLLER_CREDENTIAL_REF = 'feishu-controller'
const HOST_WORKER_ID = `desktop-${randomUUID()}`
const ROSTER_CACHE_MS = 20_000
const ROSTER_SWEEP_MS = 30_000
const BOT_ADDONS = {
  preset: true,
  scopes: {
    tenant: [
      'im:message',
      'im:message:readonly',
      'im:message:send_as_bot',
      'im:chat:readonly',
      'im:chat.members:read'
    ]
  },
  events: {
    items: {
      tenant: [
        'im.message.receive_v1',
        'im.chat.member.bot.added_v1',
        'im.chat.member.bot.deleted_v1'
      ]
    }
  }
}

export class ChannelSettingsService {
  readonly #dependencies: ChannelHostDependencies | null
  readonly #registerApp: RegisterApp
  readonly #createChannel: CreateChannel
  readonly #now: () => number
  readonly #listeners = new Set<(snapshot: ChannelSettingsSnapshot) => void>()
  readonly #managedChannels = new Map<string, ManagedChannel>()
  readonly #publicationFailures = new Map<string, string>()
  readonly #chatModeCache = new Map<string, 'p2p' | 'group' | 'topic'>()
  readonly #chatNameCache = new Map<string, string>()
  readonly #rosterReconciledAt = new Map<string, number>()
  readonly #rosterReconciliations = new Map<string, Promise<boolean>>()
  #activeQrAttempt: ChannelQrAttemptView | null = null
  #activeQrAbort: AbortController | null = null
  #pumpTimer: ReturnType<typeof globalThis.setInterval> | null = null
  #pumping = false
  #started = false
  #stopped = false
  #nextRosterSweepAt = 0
  #nextAggregateRecoveryAt = 0

  constructor(dependencies?: ChannelHostDependencies) {
    this.#dependencies = dependencies ?? null
    this.#registerApp = dependencies?.registerApp ?? registerApp
    this.#createChannel = dependencies?.createChannel ?? createLarkChannel
    this.#now = dependencies?.now ?? Date.now
  }

  async start(): Promise<void> {
    if (!this.#dependencies || this.#started) return
    this.#started = true
    this.#stopped = false
    try {
      const snapshot = await this.#coreSnapshot()
      for (const bot of snapshot.memberBots.filter((candidate) => candidate.status === 'published')) {
        try {
          await this.#startPublishedBot(bot)
        } catch (error) {
          this.#publicationFailures.set(bot.agentId, channelFailureCode(error))
        }
      }
      const schedule = this.#dependencies.setInterval ?? globalThis.setInterval
      this.#pumpTimer = schedule(() => void this.#pump(), 750)
      this.#pumpTimer.unref?.()
      await this.#emit()
      void this.#pump()
    } catch (error) {
      await this.stop()
      this.#started = false
      throw error
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#activeQrAbort?.abort()
    this.#activeQrAbort = null
    if (this.#pumpTimer) {
      const clear = this.#dependencies?.clearInterval ?? globalThis.clearInterval
      clear(this.#pumpTimer)
      this.#pumpTimer = null
    }
    const channels = [...this.#managedChannels.values()]
    this.#managedChannels.clear()
    this.#rosterReconciledAt.clear()
    await Promise.allSettled(channels.map((managed) => this.#disconnectManaged(managed)))
  }

  async get(): Promise<ChannelSettingsSnapshot> {
    if (!this.#dependencies) return unavailableSnapshot()
    return this.#publicSnapshot(await this.#coreSnapshot())
  }

  onChanged(listener: (snapshot: ChannelSettingsSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async connect(): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    const result = await this.#register('connect', null, {
      name: 'Rovai 渠道管理',
      desc: 'Rovai AI 飞书渠道管理应用'
    })
    const credential: FeishuAppCredential = {
      appId: result.client_id,
      appSecret: result.client_secret
    }
    const accountId = result.client_id
    const identityDigest = digest(`feishu-owner\0${result.user_info?.open_id ?? accountId}`)
    const previousCredential = await this.#dependencies!.credentialStore.read(
      CONTROLLER_CREDENTIAL_REF
    )
    await this.#dependencies!.credentialStore.write(CONTROLLER_CREDENTIAL_REF, credential)
    try {
      await this.#command('channels.feishu.account.upsert', {
        accountId,
        identityDigest,
        displayName: '飞书主人',
        tenantName: result.user_info?.tenant_brand === 'lark' ? 'Lark 工作区' : '飞书企业'
      })
    } catch (error) {
      try {
        if (previousCredential) {
          await this.#dependencies!.credentialStore.write(
            CONTROLLER_CREDENTIAL_REF,
            previousCredential
          )
        } else {
          await this.#dependencies!.credentialStore.delete(CONTROLLER_CREDENTIAL_REF)
        }
      } catch (rollbackError) {
        console.warn('[rovai] Failed to restore the previous Feishu controller credential.', rollbackError)
      }
      throw error
    }
    this.#finishQr()
    return this.#emit()
  }

  async disconnect(): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    const snapshot = await this.#coreSnapshot()
    if (snapshot.account?.status === 'connected') {
      await this.#command('channels.feishu.account.disconnect', {
        accountId: snapshot.account.accountId,
        expectedVersion: snapshot.account.version
      })
    }
    this.#activeQrAbort?.abort()
    this.#finishQr()
    await this.#dependencies!.credentialStore.delete(CONTROLLER_CREDENTIAL_REF)
    return this.#emit()
  }

  async publishMemberBot(agentId: string): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    const snapshot = await this.#coreSnapshot()
    const account = snapshot.account?.status === 'connected' ? snapshot.account : null
    if (!account) throw new Error('请先连接飞书账号。')
    const agent = await this.#dependencies!.core.request<AgentProfile>('members.get', { agentId })
    if (!agent || agent.presence !== 'present') throw new Error('该队员当前不可发布。')
    const result = await this.#register('publish', agentId, {
      name: agent.displayName,
      desc: `Rovai AI 队员 · ${agent.teamRole || '协作者'}`
    })
    const credentialRef = memberCredentialRef(agentId)
    const credential = { appId: result.client_id, appSecret: result.client_secret }
    await this.#dependencies!.credentialStore.write(credentialRef, credential)
    try {
      await this.#publishCredential(account.accountId, agent, credentialRef, credential)
    } catch (error) {
      this.#publicationFailures.set(agentId, channelFailureCode(error))
      this.#failQr(error)
      throw error
    }
    this.#publicationFailures.delete(agentId)
    this.#finishQr()
    return this.#emit()
  }

  async retryMemberBot(agentId: string): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    const credentialRef = memberCredentialRef(agentId)
    const credential = await this.#dependencies!.credentialStore.read(credentialRef)
    if (!credential) return this.publishMemberBot(agentId)
    const snapshot = await this.#coreSnapshot()
    const account = snapshot.account?.status === 'connected' ? snapshot.account : null
    if (!account) throw new Error('请先重新连接飞书账号。')
    const agent = await this.#dependencies!.core.request<AgentProfile>('members.get', { agentId })
    await this.#publishCredential(account.accountId, agent, credentialRef, credential)
    this.#publicationFailures.delete(agentId)
    return this.#emit()
  }

  async disableMemberBot(agentId: string): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    await this.#command('channels.feishu.memberBot.disable', { agentId })
    const managed = [...this.#managedChannels.values()].find((candidate) => candidate.agentId === agentId)
    if (managed) {
      this.#managedChannels.delete(managed.appId)
      await this.#disconnectManaged(managed)
      await this.#dependencies!.credentialStore.delete(managed.credentialRef)
    } else {
      await this.#dependencies!.credentialStore.delete(memberCredentialRef(agentId))
    }
    this.#publicationFailures.delete(agentId)
    return this.#emit()
  }

  async cancelQrAttempt(attemptId: string): Promise<ChannelSettingsSnapshot> {
    if (this.#activeQrAttempt?.attemptId === attemptId) {
      this.#activeQrAbort?.abort()
      this.#finishQr()
    }
    return this.#emit()
  }

  async createProjectBinding(input: {
    commandId: string
    displayName: string
    bindingKind: ProjectBindingKind
    canonicalPath: string
  }): Promise<ChannelSettingsSnapshot> {
    await this.#commandWithId('projectBindings.create', input.commandId, {
      displayName: input.displayName,
      bindingKind: input.bindingKind,
      canonicalPath: input.canonicalPath
    })
    return this.#emit()
  }

  async updateProjectBinding(input: {
    commandId: string
    projectBindingId: string
    displayName: string
    expectedVersion: number
  }): Promise<ChannelSettingsSnapshot> {
    await this.#commandWithId('projectBindings.update', input.commandId, {
      projectBindingId: input.projectBindingId,
      displayName: input.displayName,
      expectedVersion: input.expectedVersion
    })
    return this.#emit()
  }

  async archiveProjectBinding(input: {
    commandId: string
    projectBindingId: string
    expectedVersion: number
  }): Promise<ChannelSettingsSnapshot> {
    await this.#commandWithId('projectBindings.archive', input.commandId, {
      projectBindingId: input.projectBindingId,
      expectedVersion: input.expectedVersion
    })
    return this.#emit()
  }

  async bindConversation(input: {
    commandId: string
    channelConversationId: string
    projectBindingId: string
    expectedConversationVersion: number
  }): Promise<ChannelSettingsSnapshot> {
    await this.#commandWithId('channels.conversations.bind', input.commandId, {
      channelConversationId: input.channelConversationId,
      projectBindingId: input.projectBindingId,
      expectedConversationVersion: input.expectedConversationVersion
    })
    return this.#emit()
  }

  async #register(
    purpose: 'connect' | 'publish',
    agentId: string | null,
    appPreset: { name: string; desc: string }
  ): Promise<RegistrationResult> {
    if (this.#activeQrAttempt) throw new Error('已有一个飞书二维码流程正在进行。')
    const attemptId = randomUUID()
    const abort = new AbortController()
    this.#activeQrAbort = abort
    this.#activeQrAttempt = {
      attemptId,
      purpose,
      agentId,
      stage: 'preparing',
      qrDataUrl: null,
      expiresAt: null,
      detail: '正在准备飞书二维码…'
    }
    void this.#emit()
    try {
      const result = await this.#registerApp({
        source: 'rovai-ai',
        signal: abort.signal,
        createOnly: true,
        appPreset,
        addons: BOT_ADDONS,
        onQRCodeReady: (info) => {
          void QRCode.toDataURL(info.url, { width: 256, margin: 1 }).then((qrDataUrl) => {
            if (this.#activeQrAttempt?.attemptId !== attemptId) return
            this.#activeQrAttempt = {
              ...this.#activeQrAttempt,
              stage: 'awaiting_scan',
              qrDataUrl,
              expiresAt: new Date(this.#now() + info.expireIn * 1_000).toISOString(),
              detail: purpose === 'connect'
                ? '请用飞书扫码并确认连接。'
                : '请用飞书扫码确认创建这名队员的独立 Bot。'
            }
            void this.#emit()
          })
        },
        onStatusChange: () => {
          if (this.#activeQrAttempt?.attemptId !== attemptId) return
          this.#activeQrAttempt = {
            ...this.#activeQrAttempt,
            stage: 'authorizing',
            detail: '已扫码，等待飞书确认…'
          }
          void this.#emit()
        }
      })
      if (this.#activeQrAttempt?.attemptId !== attemptId) throw new Error('二维码流程已取消。')
      this.#activeQrAttempt = {
        ...this.#activeQrAttempt,
        stage: 'connecting',
        detail: purpose === 'connect' ? '正在验证飞书连接…' : '正在验证 Bot 并建立长连接…'
      }
      void this.#emit()
      return result
    } catch (error) {
      this.#failQr(error)
      throw error
    }
  }

  async #publishCredential(
    accountId: string,
    agent: AgentProfile,
    credentialRef: string,
    credential: FeishuAppCredential
  ): Promise<void> {
    const managed = await this.#connectBot(agent.agentId, credentialRef, credential)
    try {
      await this.#command('channels.feishu.memberBot.upsert', {
        accountId,
        agentId: agent.agentId,
        appId: credential.appId,
        botOpenId: managed.channel.botIdentity?.openId ?? null,
        botDisplayName: managed.channel.botIdentity?.name || agent.displayName,
        credentialRef
      })
    } catch (error) {
      await this.#disconnectManaged(managed)
      throw error
    }
    const previous = [...this.#managedChannels.values()]
      .find((candidate) => candidate.agentId === agent.agentId && candidate.appId !== managed.appId)
    if (previous) {
      this.#managedChannels.delete(previous.appId)
      await this.#disconnectManaged(previous)
    }
    this.#managedChannels.set(managed.appId, managed)
  }

  async #startPublishedBot(bot: CoreChannelSnapshot['memberBots'][number]): Promise<void> {
    const credential = await this.#dependencies!.credentialStore.read(bot.credentialRef)
    if (!credential || credential.appId !== bot.appId) throw new Error('published_bot_credential_missing')
    const managed = await this.#connectBot(bot.agentId, bot.credentialRef, credential)
    this.#managedChannels.set(bot.appId, managed)
  }

  async #connectBot(
    agentId: string,
    credentialRef: string,
    credential: FeishuAppCredential
  ): Promise<ManagedChannel> {
    const channel = this.#createChannel({
      appId: credential.appId,
      appSecret: credential.appSecret,
      transport: 'websocket',
      source: 'rovai-ai',
      includeRawEvent: true,
      handshakeTimeoutMs: 20_000,
      policy: { dmMode: 'open', requireMention: true, respondToMentionAll: false },
      safety: {
        dedup: { ttl: 10 * 60_000, maxEntries: 10_000 },
        chatQueue: { enabled: true },
        staleMessageWindowMs: 10 * 60_000
      },
      outbound: { retry: { maxAttempts: 2, baseDelayMs: 350 } }
    })
    const managed: ManagedChannel = {
      agentId,
      appId: credential.appId,
      credentialRef,
      channel,
      unsubscribers: []
    }
    managed.unsubscribers.push(channel.on('message', (message) => this.#handleMessage(managed, message)))
    managed.unsubscribers.push(channel.on('botAdded', (event) => this.#handleBotAdded(event)))
    managed.unsubscribers.push(channel.on('error', (error) => {
      this.#publicationFailures.set(agentId, error.code)
      void this.#emit()
    }))
    managed.unsubscribers.push(channel.on('reconnected', () => {
      this.#publicationFailures.delete(agentId)
      void this.#emit()
    }))
    try {
      await channel.connect()
      return managed
    } catch (error) {
      await this.#disconnectManaged(managed)
      throw error
    }
  }

  async #disconnectManaged(managed: ManagedChannel): Promise<void> {
    for (const unsubscribe of managed.unsubscribers.splice(0)) unsubscribe()
    await managed.channel.disconnect().catch(() => undefined)
  }

  async #handleMessage(managed: ManagedChannel, message: NormalizedMessage): Promise<void> {
    if (this.#stopped) return
    const raw = (message.raw ?? {}) as RawInboundEvent
    const coreSnapshot = await this.#coreSnapshot()
    const tenantKey = raw.sender?.tenant_key || raw.tenant_key || coreSnapshot.account?.accountId
    if (!tenantKey) return
    const senderExternalUserId = raw.sender?.sender_id?.union_id
      || raw.sender?.sender_id?.user_id
      || raw.sender?.sender_id?.open_id
      || message.senderId
    const conversationKind = await this.#conversationKind(managed.channel, message)
    if (conversationKind !== 'p2p' && !message.mentionedBot) return
    if (conversationKind !== 'p2p'
      && !await this.#reconcileChatRoster(message.chatId, tenantKey, false, coreSnapshot)) return
    const topicKey = conversationKind === 'topic' ? (message.threadId || message.rootId || '') : ''
    if (conversationKind === 'topic' && !topicKey) return
    const knownByOpenId = new Map(
      [...this.#managedChannels.values()]
        .filter((candidate) => candidate.channel.botIdentity?.openId)
        .map((candidate) => [candidate.channel.botIdentity!.openId, candidate])
    )
    const knownByUserId = new Map(
      [...this.#managedChannels.values()]
        .filter((candidate) => candidate.channel.botIdentity?.userId)
        .map((candidate) => [candidate.channel.botIdentity!.userId!, candidate])
    )
    const publishedBots = coreSnapshot.memberBots.filter((candidate) => candidate.status === 'published')
    const mentionedByAppId = new Map<string, { appId: string; agentId: string }>()
    let canonicalMentionsComplete = true
    for (const mention of message.mentions) {
      const stableMatch = (mention.openId ? knownByOpenId.get(mention.openId) : undefined)
        ?? (mention.userId ? knownByUserId.get(mention.userId) : undefined)
        ?? (mention.isBot ? managed : undefined)
      if (stableMatch) {
        mentionedByAppId.set(stableMatch.appId, stableMatch)
        continue
      }
      const nameMatches = publishedBots.filter((bot) => bot.botDisplayName === mention.name)
      if (nameMatches.length === 1) {
        const [match] = nameMatches
        mentionedByAppId.set(match.appId, { appId: match.appId, agentId: match.agentId })
      } else if (nameMatches.length > 1) {
        canonicalMentionsComplete = false
        for (const match of nameMatches) {
          mentionedByAppId.set(match.appId, { appId: match.appId, agentId: match.agentId })
        }
      }
    }
    if (conversationKind === 'p2p' && !mentionedByAppId.has(managed.appId)) {
      mentionedByAppId.set(managed.appId, managed)
    }
    const mentioned = [...mentionedByAppId.values()]
    if (mentioned.length === 0) return
    const acknowledgementAppId = mentioned[0].appId
    const expectedApps = mentioned.map((candidate) => candidate.appId).sort()
    const canonicalAgentIds = [...new Set(mentioned.map((candidate) => candidate.agentId))].sort()
    canonicalMentionsComplete = conversationKind === 'p2p' || canonicalMentionsComplete
    const expectedBotNames = new Set(
      publishedBots
        .filter((bot) => expectedApps.includes(bot.appId))
        .map((bot) => bot.botDisplayName)
    )
    if (managed.channel.botIdentity?.name) expectedBotNames.add(managed.channel.botIdentity.name)
    const quote = message.replyToMessageId
      ? await this.#readExternalQuote(managed.channel, message.replyToMessageId)
      : null
    const conversationDisplayName = await this.#conversationDisplayName(managed.channel, message)
    const observation = await this.#commandWithId('channels.inbound.observe', stableCommandId(
      'observe', managed.appId, tenantKey, message.messageId
    ), {
      provider: 'feishu',
      appId: managed.appId,
      externalMessageId: message.messageId,
      tenantKey,
      chatId: message.chatId,
      topicKey,
      conversationKind,
      conversationDisplayName,
      senderExternalUserId,
      senderOpenId: raw.sender?.sender_id?.open_id ?? null,
      senderUserId: raw.sender?.sender_id?.user_id ?? null,
      senderUnionId: raw.sender?.sender_id?.union_id ?? null,
      senderDisplayName: message.senderName || '飞书成员',
      body: canonicalInboundBody(raw, message, expectedBotNames),
      attachmentSummaries: message.resources.map((resource) => ({
        name: resource.fileName || resource.type,
        mediaType: resource.type
      })),
      quote,
      canonicalAgentIds,
      canonicalMentionsComplete,
      expectedAppIds: expectedApps,
      acknowledgementAppId
    }, false)
    if (observation.status === 'rejected') return
    const aggregateId = stringPayload(observation, 'aggregateId')
    if (observation.payload.readyToFinalize === true) {
      await this.#finalizeAggregate(
        managed,
        tenantKey,
        message.chatId,
        topicKey,
        conversationKind,
        aggregateId
      )
    }
    await this.#emit()
  }

  async #finalizeAggregate(
    managed: ManagedChannel | null,
    tenantKey: string,
    chatId: string,
    topicKey: string,
    conversationKind: 'p2p' | 'group' | 'topic',
    aggregateId: string
  ): Promise<void> {
    let finalized = await this.#commandWithId('channels.inbound.finalize', randomUUID(), {
      aggregateId
    }, false)
    if (['channel.roster_sync_required', 'channel.bot_not_in_roster'].includes(finalized.code)
      && conversationKind !== 'p2p'
      && await this.#reconcileChatRoster(chatId, tenantKey, true)) {
      finalized = await this.#commandWithId('channels.inbound.finalize', randomUUID(), {
        aggregateId
      }, false)
    }
    if (finalized.code === 'channel.membership_sync_required') {
      const campId = stringPayload(finalized, 'campId')
      const bindingId = stringPayload(finalized, 'bindingId')
      const agentIds = arrayPayload(finalized, 'agentIds')
      let membershipGeneration = numberPayload(finalized, 'expectedMembershipGeneration')
      let reconciliationGeneration = numberPayload(finalized, 'nextReconciliationGeneration')
      for (const agentId of agentIds) {
        const added = await this.#commandWithId('channels.membership.add', randomUUID(), {
          campId,
          agentId,
          expectedMembershipGeneration: membershipGeneration,
          capabilityOverrides: {},
          source: { namespace: 'feishu', bindingId, reconciliationGeneration }
        })
        membershipGeneration = numberPayload(added, 'membershipGeneration')
        reconciliationGeneration += 1
      }
      finalized = await this.#commandWithId('channels.inbound.finalize', randomUUID(), {
        aggregateId
      }, false)
    }
    if (finalized.code === 'channel.inbound.unbound' && managed) {
      await managed.channel.send(chatId, {
        text: '这个飞书会话尚未绑定 Rovai 项目，请联系主人在 Rovai 本机完成设置；绑定后请重新发送消息。'
      }, topicKey ? { replyTo: topicKey, replyInThread: true } : undefined)
    }
  }

  async #recoverPendingAggregates(): Promise<void> {
    const snapshot = await this.#coreSnapshot()
    await Promise.allSettled(snapshot.pendingAggregates.map((aggregate) => this.#finalizeAggregate(
      this.#managedChannels.get(aggregate.acknowledgementAppId) ?? null,
      aggregate.tenantKey,
      aggregate.chatId,
      aggregate.topicKey,
      aggregate.conversationKind,
      aggregate.aggregateId
    )))
  }

  async #handleBotAdded(event: BotAddedEvent): Promise<void> {
    if (this.#stopped) return
    const snapshot = await this.#coreSnapshot().catch(() => null)
    if (!snapshot) return
    const tenantKeys = new Set(
      snapshot.transportConversations
        .filter((conversation) => conversation.chatId === event.chatId)
        .map((conversation) => conversation.tenantKey)
    )
    if (tenantKeys.size === 0 && snapshot.account?.accountId) {
      tenantKeys.add(snapshot.account.accountId)
    }
    await Promise.allSettled(
      [...tenantKeys].map((tenantKey) => this.#reconcileChatRoster(
        event.chatId,
        tenantKey,
        true,
        snapshot
      ))
    )
  }

  async #reconcileChatRoster(
    chatId: string,
    tenantKey: string,
    force: boolean,
    suppliedSnapshot?: CoreChannelSnapshot
  ): Promise<boolean> {
    const key = `${tenantKey}\0${chatId}`
    if (!force && this.#now() - (this.#rosterReconciledAt.get(key) ?? 0) < ROSTER_CACHE_MS) {
      return true
    }
    const inflight = this.#rosterReconciliations.get(key)
    if (inflight) return inflight
    const reconciliation = (async (): Promise<boolean> => {
      const snapshot = suppliedSnapshot ?? await this.#coreSnapshot()
      const publishedBots = snapshot.memberBots.filter((bot) => bot.status === 'published')
      const managedBots = publishedBots.map((bot) => this.#managedChannels.get(bot.appId))
      if (managedBots.some((managed) => !managed)) return false
      const observations = await Promise.all(managedBots.map(async (managed) => {
        const response = await managed!.channel.rawClient.im.v1.chatMembers.isInChat({
          path: { chat_id: chatId }
        })
        if (response.code !== 0 || typeof response.data?.is_in_chat !== 'boolean') {
          throw new Error('roster_observation_incomplete')
        }
        return { appId: managed!.appId, present: response.data.is_in_chat }
      })).catch(() => null)
      if (!observations) return false
      const result = await this.#commandWithId('channels.roster.reconcile', randomUUID(), {
        provider: 'feishu',
        tenantKey,
        chatId,
        presentAppIds: observations.filter((item) => item.present).map((item) => item.appId)
      }, false)
      if (result.status === 'rejected') return false
      this.#rosterReconciledAt.set(key, this.#now())
      return true
    })().finally(() => this.#rosterReconciliations.delete(key))
    this.#rosterReconciliations.set(key, reconciliation)
    return reconciliation
  }

  async #reconcileKnownGroupRosters(): Promise<void> {
    const snapshot = await this.#coreSnapshot()
    const unique = new Map<string, { tenantKey: string; chatId: string }>()
    for (const conversation of snapshot.transportConversations) {
      unique.set(`${conversation.tenantKey}\0${conversation.chatId}`, {
        tenantKey: conversation.tenantKey,
        chatId: conversation.chatId
      })
    }
    await Promise.allSettled(
      [...unique.values()].map((conversation) => this.#reconcileChatRoster(
        conversation.chatId,
        conversation.tenantKey,
        true,
        snapshot
      ))
    )
  }

  async #readExternalQuote(channel: LarkChannel, messageId: string): Promise<{
    senderDisplayName: string
    body: string
    attachmentSummaries: Array<{ name: string; mediaType: string | null }>
  }> {
    try {
      const response = await channel.rawClient.im.v1.message.get({
        path: { message_id: messageId },
        params: { with_sender_name: true }
      })
      const item = response.data?.items?.[0]
      if (!item || item.deleted) throw new Error('quoted_message_unavailable')
      return {
        senderDisplayName: item.sender?.sender_name || '飞书成员',
        body: externalMessageBody(item.msg_type, item.body?.content),
        attachmentSummaries: externalAttachmentSummaries(item.msg_type, item.body?.content)
      }
    } catch {
      return {
        senderDisplayName: '飞书消息',
        body: '[引用的飞书消息不可读取]',
        attachmentSummaries: []
      }
    }
  }

  async #conversationKind(
    channel: LarkChannel,
    message: NormalizedMessage
  ): Promise<'p2p' | 'group' | 'topic'> {
    if (message.chatType === 'p2p') return 'p2p'
    const cached = this.#chatModeCache.get(message.chatId)
    if (cached) return cached
    const mode = await channel.getChatMode(message.chatId).catch(() => 'group' as const)
    this.#chatModeCache.set(message.chatId, mode)
    return mode
  }

  async #conversationDisplayName(channel: LarkChannel, message: NormalizedMessage): Promise<string> {
    if (message.chatType === 'p2p') return message.senderName || '飞书私聊'
    let name = this.#chatNameCache.get(message.chatId)
    if (!name) {
      name = (await channel.getChatInfo(message.chatId).catch(() => null))?.name || '飞书群聊'
      this.#chatNameCache.set(message.chatId, name)
    }
    return message.threadId || message.rootId ? `${name} · 话题` : name
  }

  async #pump(): Promise<void> {
    if (!this.#dependencies || this.#pumping || this.#stopped) return
    this.#pumping = true
    try {
      if (this.#now() >= this.#nextAggregateRecoveryAt) {
        this.#nextAggregateRecoveryAt = this.#now() + 2_000
        await this.#recoverPendingAggregates()
      }
      if (this.#now() >= this.#nextRosterSweepAt) {
        this.#nextRosterSweepAt = this.#now() + ROSTER_SWEEP_MS
        await this.#reconcileKnownGroupRosters()
      }
      const tick = await this.#commandWithId('channels.host.tick', randomUUID(), {
        workerId: HOST_WORKER_ID,
        limit: 20
      })
      const deliveries = Array.isArray(tick.payload.deliveries)
        ? tick.payload.deliveries as ClaimedChannelDelivery[]
        : []
      for (const delivery of deliveries) await this.#deliver(delivery)
    } catch (error) {
      console.warn(`[rovai] Feishu outbox pump failed: ${channelFailureCode(error)}`)
    } finally {
      this.#pumping = false
    }
  }

  async #deliver(delivery: ClaimedChannelDelivery): Promise<void> {
    const managed = this.#managedChannels.get(delivery.targetAppId)
    if (!managed || managed.credentialRef !== delivery.credentialRef) {
      await this.#settleDelivery(delivery, null, new Error('target_bot_not_connected'))
      return
    }
    try {
      const card = deliveryCard(delivery)
      let messageId = delivery.updateMessageId ?? null
      if (messageId) {
        await managed.channel.updateCard(messageId, card)
      } else {
        const sent = await managed.channel.send(
          delivery.chatId,
          { card },
          delivery.topicKey ? { replyTo: delivery.topicKey, replyInThread: true } : undefined
        )
        messageId = sent.messageId
      }
      await this.#settleDelivery(delivery, messageId, null)
    } catch (error) {
      await this.#settleDelivery(delivery, null, error)
    }
  }

  async #settleDelivery(
    delivery: ClaimedChannelDelivery,
    messageId: string | null,
    error: unknown
  ): Promise<void> {
    const failureCode = error ? channelFailureCode(error) : null
    const retryable = error instanceof LarkChannelError
      ? ['rate_limited', 'send_timeout', 'not_connected', 'unknown'].includes(error.code)
      : failureCode === 'target_bot_not_connected'
    await this.#commandWithId('channels.deliveries.settle', randomUUID(), {
      deliveryId: delivery.deliveryId,
      workerId: HOST_WORKER_ID,
      outcome: error ? 'failed' : 'sent',
      externalDeliveryMessageId: messageId,
      failureCode,
      retryable
    })
  }

  async #coreSnapshot(): Promise<CoreChannelSnapshot> {
    const snapshot = await this.#dependencies!.core.request<CoreChannelSnapshot>(
      'channels.feishu.snapshot'
    )
    if (snapshot.schemaVersion !== 1) throw new Error('Unsupported Core channel snapshot')
    return snapshot
  }

  #publicSnapshot(snapshot: CoreChannelSnapshot): ChannelSettingsSnapshot {
    const connected = snapshot.account?.status === 'connected'
    const bots = new Map<string, ChannelMemberBotView>()
    for (const bot of snapshot.memberBots) {
      bots.set(bot.agentId, {
        agentId: bot.agentId,
        publicationStatus: bot.status,
        botDisplayName: bot.botDisplayName,
        appId: bot.appId,
        failureCode: this.#publicationFailures.get(bot.agentId) ?? bot.failureCode
      })
    }
    if (this.#activeQrAttempt?.purpose === 'publish' && this.#activeQrAttempt.agentId) {
      const agentId = this.#activeQrAttempt.agentId
      bots.set(agentId, {
        agentId,
        publicationStatus: this.#activeQrAttempt.stage === 'failed' ? 'failed' : 'provisioning',
        botDisplayName: bots.get(agentId)?.botDisplayName ?? null,
        appId: bots.get(agentId)?.appId ?? null,
        failureCode: this.#activeQrAttempt.stage === 'failed' ? 'registration_failed' : null
      })
    }
    for (const [agentId, failureCode] of this.#publicationFailures) {
      const bot = bots.get(agentId)
      bots.set(agentId, {
        agentId,
        publicationStatus: bot?.publicationStatus === 'disabled' ? 'disabled' : 'failed',
        botDisplayName: bot?.botDisplayName ?? null,
        appId: bot?.appId ?? null,
        failureCode
      })
    }
    return {
      schemaVersion: 2,
      channels: [{
        kind: 'feishu',
        displayName: '飞书',
        hostStatus: 'ready',
        connection: {
          status: connected ? 'connected' : 'not_connected',
          account: connected && snapshot.account ? {
            accountId: snapshot.account.accountId,
            displayName: snapshot.account.displayName,
            tenantName: snapshot.account.tenantName
          } : null
        },
        memberBots: [...bots.values()].sort((left, right) => left.agentId.localeCompare(right.agentId))
      }],
      projectBindings: snapshot.projectBindings,
      unboundConversations: snapshot.unboundConversations,
      conversationBindings: snapshot.conversationBindings,
      activeQrAttempt: this.#activeQrAttempt ? structuredClone(this.#activeQrAttempt) : null
    }
  }

  async #command(method: Parameters<CoreClient['request']>[0], command: object): Promise<StoredCommandResult> {
    return this.#commandWithId(method, randomUUID(), command)
  }

  async #commandWithId(
    method: Parameters<CoreClient['request']>[0],
    commandId: string,
    command: object,
    throwOnRejected = true
  ): Promise<StoredCommandResult> {
    const result = await this.#dependencies!.core.request<StoredCommandResult>(method, {
      commandId,
      command
    })
    if (throwOnRejected && result.status === 'rejected') {
      throw new Error(commandFailureMessage(result))
    }
    return result
  }

  async #emit(): Promise<ChannelSettingsSnapshot> {
    const snapshot = await this.get()
    for (const listener of this.#listeners) listener(structuredClone(snapshot))
    return snapshot
  }

  #finishQr(): void {
    this.#activeQrAbort = null
    this.#activeQrAttempt = null
  }

  #failQr(error: unknown): void {
    this.#activeQrAbort = null
    if (!this.#activeQrAttempt) return
    this.#activeQrAttempt = {
      ...this.#activeQrAttempt,
      stage: 'failed',
      qrDataUrl: null,
      expiresAt: null,
      detail: `飞书操作失败：${channelFailureCode(error)}`
    }
    void this.#emit()
  }

  #requireHost(): void {
    if (!this.#dependencies) throw new Error('飞书渠道宿主不可用。')
  }
}

function unavailableSnapshot(): ChannelSettingsSnapshot {
  return {
    schemaVersion: 2,
    channels: [{
      kind: 'feishu',
      displayName: '飞书',
      hostStatus: 'unavailable',
      connection: { status: 'not_connected', account: null },
      memberBots: []
    }],
    projectBindings: [],
    unboundConversations: [],
    conversationBindings: [],
    activeQrAttempt: null
  }
}

function memberCredentialRef(agentId: string): string {
  return `feishu-member-${createHash('sha256').update(agentId).digest('hex').slice(0, 32)}`
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function stableCommandId(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function channelFailureCode(error: unknown): string {
  if (error instanceof LarkChannelError) return error.code
  if (error instanceof Error && /^[a-z][a-z0-9_.-]{1,80}$/i.test(error.message)) return error.message
  return 'unknown'
}

function canonicalInboundBody(
  raw: RawInboundEvent,
  message: NormalizedMessage,
  expectedBotNames: ReadonlySet<string>
): string {
  const rawMessage = raw.message
  let body = rawMessage?.content
    ? externalMessageBody(rawMessage.message_type ?? message.rawContentType, rawMessage.content)
    : message.content
  for (const mention of rawMessage?.mentions ?? []) {
    if (!mention.key) continue
    const replacement = mention.name && !expectedBotNames.has(mention.name)
      ? `@${mention.name}`
      : ''
    body = body.split(mention.key).join(replacement)
  }
  if (!rawMessage?.mentions) {
    for (const botName of expectedBotNames) body = body.split(`@${botName}`).join('')
  }
  return body.replace(/[ \t]+/gu, ' ').replace(/^\s+|\s+$/gu, '')
}

function commandFailureMessage(result: StoredCommandResult): string {
  const message = result.payload.message
  return typeof message === 'string' ? message : result.code
}

function stringPayload(result: StoredCommandResult, key: string): string {
  const value = result.payload[key]
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Core omitted ${key}`)
  return value
}

function numberPayload(result: StoredCommandResult, key: string): number {
  const value = result.payload[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Core omitted ${key}`)
  return value
}

function arrayPayload(result: StoredCommandResult, key: string): string[] {
  const value = result.payload[key]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Core omitted ${key}`)
  }
  return value
}

function externalMessageBody(messageType: string | undefined, encoded: string | undefined): string {
  if (!encoded) return '[引用消息无可读文本]'
  try {
    const parsed = JSON.parse(encoded) as unknown
    if (messageType === 'text' && isRecord(parsed) && typeof parsed.text === 'string') return parsed.text
    if (messageType === 'post') return collectText(parsed).join('').trim() || '[富文本消息]'
  } catch {
    return encoded.slice(0, 8_000)
  }
  return `[${messageType || '消息'}]`
}

function externalAttachmentSummaries(
  messageType: string | undefined,
  encoded: string | undefined
): Array<{ name: string; mediaType: string | null }> {
  if (!['image', 'file', 'audio', 'media', 'sticker'].includes(messageType ?? '')) return []
  let name = messageType || '附件'
  if (encoded) {
    try {
      const parsed = JSON.parse(encoded) as Record<string, unknown>
      if (typeof parsed.file_name === 'string') name = parsed.file_name
    } catch { /* deterministic fallback */ }
  }
  return [{ name, mediaType: messageType ?? null }]
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectText)
  if (!isRecord(value)) return []
  const direct = typeof value.text === 'string' ? [value.text] : []
  return direct.concat(Object.entries(value)
    .filter(([key]) => key !== 'text')
    .flatMap(([, nested]) => collectText(nested)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function deliveryCard(delivery: ClaimedChannelDelivery): Record<string, unknown> {
  const text = typeof delivery.payload.text === 'string' ? delivery.payload.text : ''
  const body = typeof delivery.payload.body === 'string' ? delivery.payload.body : ''
  const mentionPrincipal = delivery.payload.mentionPrincipal === true
    && delivery.conversationKind !== 'p2p'
    && typeof delivery.recipientOpenId === 'string'
    && /^[A-Za-z0-9_-]{1,256}$/u.test(delivery.recipientOpenId)
      ? `<at id=${delivery.recipientOpenId}></at>\n`
      : ''
  const title = delivery.deliveryKind === 'agent_output'
    ? 'Rovai 队员回复'
    : delivery.deliveryKind === 'attention'
      ? 'Rovai 需要你确认'
    : delivery.deliveryKind === 'completion'
      ? 'Rovai 协作状态'
      : delivery.deliveryKind === 'queue_ack'
        ? 'Rovai 已接收'
        : 'Rovai 正在处理'
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: delivery.deliveryKind === 'completion'
        ? 'green'
        : delivery.deliveryKind === 'attention'
          ? 'orange'
          : 'blue'
    },
    body: {
      elements: [{ tag: 'markdown', content: `${mentionPrincipal}${body || text || '状态已更新'}` }]
    }
  }
}
