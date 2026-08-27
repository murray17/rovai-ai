import { createHash, randomUUID } from 'node:crypto'
import {
  createLarkChannel,
  LarkChannelError,
  type BotAddedEvent,
  type LarkChannel,
  type NormalizedMessage
} from '@larksuiteoapi/node-sdk'
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
import type {
  FeishuDeveloperIdentity,
  FeishuDeveloperSessionService,
  FeishuLoginStage
} from './feishu-developer-session'
import {
  UnavailableFeishuDeveloperSessionService,
  UnavailableFeishuMemberBotProvisioner,
  isUnknownRemoteProvisioningError,
  type FeishuMemberBotProvisioner,
  type MemberBotProvisioningStep
} from './feishu-member-bot-provisioner'

type CoreChannelSnapshot = {
  schemaVersion: 1
  account: {
    accountId: string
    userIdDigest: string
    tenantId: string
    userName: string
    email: string | null
    tenantName: string
    brand: 'feishu' | 'lark'
    status: 'connected' | 'disconnected' | 'session_expired'
    version: number
    connectedAt: string
    lastVerifiedAt: string
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
  publicationIntents: Array<{
    publicationIntentId: string
    agentId: string
    accountId: string
    expectedUserIdDigest: string
    expectedTenantId: string
    requestedAppName: string
    provisioningMode: 'developer_session' | 'compat_registration'
    state:
      | 'created'
      | 'session_verified'
      | 'app_created'
      | 'credentials_read'
      | 'bot_configured'
      | 'version_published'
      | 'connection_verified'
      | 'completed'
      | 'failed_recoverable'
      | 'failed_unknown_remote_state'
    remoteAppId: string | null
    credentialRef: string | null
    lastCompletedStep: string | null
    failureCode: string | null
    version: number
    createdAt: string
    updatedAt: string
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

type CreateChannel = typeof createLarkChannel

export interface ChannelHostDependencies {
  core: Pick<CoreClient, 'request'>
  credentialStore: ChannelCredentialStore
  developerSession?: FeishuDeveloperSessionService
  memberBotProvisioner?: FeishuMemberBotProvisioner
  compatMemberBotProvisioner?: FeishuMemberBotProvisioner
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

const HOST_WORKER_ID = `desktop-${randomUUID()}`
const ROSTER_CACHE_MS = 20_000
const ROSTER_SWEEP_MS = 30_000
export class ChannelSettingsService {
  readonly #dependencies: ChannelHostDependencies | null
  readonly #developerSession: FeishuDeveloperSessionService
  readonly #memberBotProvisioner: FeishuMemberBotProvisioner
  readonly #compatMemberBotProvisioner: FeishuMemberBotProvisioner
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
  #activeProvisioning: ChannelSettingsSnapshot['activeProvisioning'] = null
  #activeProvisioningAbort: AbortController | null = null
  #pumpTimer: ReturnType<typeof globalThis.setInterval> | null = null
  #pumping = false
  #started = false
  #stopped = false
  #nextRosterSweepAt = 0
  #nextAggregateRecoveryAt = 0

  constructor(dependencies?: ChannelHostDependencies) {
    this.#dependencies = dependencies ?? null
    this.#developerSession = dependencies?.developerSession
      ?? new UnavailableFeishuDeveloperSessionService()
    this.#memberBotProvisioner = dependencies?.memberBotProvisioner
      ?? new UnavailableFeishuMemberBotProvisioner()
    this.#compatMemberBotProvisioner = dependencies?.compatMemberBotProvisioner
      ?? new UnavailableFeishuMemberBotProvisioner()
    this.#createChannel = dependencies?.createChannel ?? createLarkChannel
    this.#now = dependencies?.now ?? Date.now
  }

  async start(): Promise<void> {
    if (!this.#dependencies || this.#started) return
    this.#started = true
    this.#stopped = false
    try {
      await this.#dependencies.credentialStore.delete('feishu-controller')
      let snapshot = await this.#coreSnapshot()
      if (snapshot.account?.status === 'connected') {
        const identity = await this.#developerSession.inspect().catch(() => null)
        if (!identity || accountIdForIdentity(identity) !== snapshot.account.accountId) {
          await this.#expireAccount(snapshot.account)
          snapshot = await this.#coreSnapshot()
        } else {
          await this.#upsertAccount(identity)
          snapshot = await this.#coreSnapshot()
        }
      }
      await this.#recoverPublicationIntents(snapshot)
      snapshot = await this.#coreSnapshot()
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
    this.#activeProvisioningAbort?.abort()
    this.#activeProvisioningAbort = null
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
    if (this.#activeQrAttempt) throw new Error('已有一个飞书二维码流程正在进行。')
    this.#activeProvisioningAbort?.abort()
    const previous = (await this.#coreSnapshot()).account
    const attemptId = randomUUID()
    const abort = new AbortController()
    this.#activeQrAbort = abort
    this.#activeQrAttempt = {
      attemptId,
      purpose: 'account_login',
      agentId: null,
      stage: 'preparing',
      qrDataUrl: null,
      expiresAt: null,
      detail: '正在检查系统安全存储…'
    }
    void this.#emit()
    try {
      const identity = await this.#developerSession.beginLogin({
        forceFresh: true,
        signal: abort.signal,
        onQrReady: ({ payload, expiresAt }) => {
          if (this.#activeQrAttempt?.attemptId !== attemptId) return
          this.#activeQrAttempt = {
            ...this.#activeQrAttempt,
            stage: 'awaiting_scan',
            qrDataUrl: payload,
            expiresAt,
            detail: '请使用飞书扫码登录开放平台。'
          }
          void this.#emit()
        },
        onStatus: (stage) => this.#updateLoginAttempt(attemptId, stage)
      })
      if (this.#activeQrAttempt?.attemptId !== attemptId) {
        throw new Error('feishu_login_cancelled')
      }
      await this.#upsertAccount(identity)
    } catch (error) {
      if (previous?.status === 'connected') {
        await this.#expireAccount(previous).catch(() => undefined)
      }
      this.#failQr(error)
      throw error
    }
    this.#finishQr()
    return this.#emit()
  }

  async disconnect(): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    const snapshot = await this.#coreSnapshot()
    this.#activeProvisioningAbort?.abort()
    this.#activeProvisioningAbort = null
    await this.#developerSession.disconnect()
    if (snapshot.account?.status === 'connected') {
      await this.#command('channels.feishu.account.disconnect', {
        accountId: snapshot.account.accountId,
        expectedVersion: snapshot.account.version
      })
    }
    this.#activeQrAbort?.abort()
    this.#finishQr()
    return this.#emit()
  }

  async publishMemberBot(agentId: string): Promise<ChannelSettingsSnapshot> {
    return this.#publishNewMemberBot(agentId, 'developer_session')
  }

  async publishMemberBotCompat(agentId: string): Promise<ChannelSettingsSnapshot> {
    return this.#publishNewMemberBot(agentId, 'compat_registration')
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
    const intent = latestPublicationIntent(snapshot, agentId)
    if (intent?.state === 'failed_recoverable') {
      let version = intent.version
      const remoteAppId = intent.remoteAppId ?? credential.appId
      await this.#advancePublicationIntent(intent.publicationIntentId, version, {
        state: 'connection_verified',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'connection_verified',
        failureCode: null
      })
      version += 1
      await this.#advancePublicationIntent(intent.publicationIntentId, version, {
        state: 'completed',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'completed',
        failureCode: null
      })
    }
    this.#publicationFailures.delete(agentId)
    if (this.#activeProvisioning?.agentId === agentId) {
      this.#activeProvisioning = {
        ...this.#activeProvisioning,
        stage: 'completed',
        detail: '发布完成。',
        remoteAppId: credential.appId,
        failureCode: null
      }
    }
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

  async #publishNewMemberBot(
    agentId: string,
    mode: 'developer_session' | 'compat_registration'
  ): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    if (this.#activeProvisioning && !['completed', 'failed', 'unknown_remote_state'].includes(
      this.#activeProvisioning.stage
    )) throw new Error('已有一名队员正在发布。')
    if (this.#activeQrAttempt) throw new Error('已有一个飞书二维码流程正在进行。')
    const snapshot = await this.#coreSnapshot()
    const account = snapshot.account?.status === 'connected' ? snapshot.account : null
    if (!account) throw new Error('飞书登录已过期，请先重新连接账号。')
    const previousIntent = latestPublicationIntent(snapshot, agentId)
    if (previousIntent?.state === 'failed_unknown_remote_state') {
      if (mode !== 'developer_session' || !previousIntent.remoteAppId) {
        throw new Error('上次创建结果无法确认。为避免重复创建应用，请先在飞书开放平台核对。')
      }
    }
    if (
      previousIntent
      && !['completed', 'failed_recoverable', 'failed_unknown_remote_state'].includes(
        previousIntent.state
      )
    ) {
      throw new Error('该队员已有未完成的发布记录。')
    }
    if (previousIntent?.state === 'failed_recoverable' && previousIntent.remoteAppId) {
      const stored = previousIntent.credentialRef
        ? await this.#dependencies!.credentialStore.read(previousIntent.credentialRef)
        : null
      if (stored) return this.retryMemberBot(agentId)
      throw new Error('上次已创建远端应用但凭据未保存，不能自动创建第二个应用。')
    }
    const identity = await this.#developerSession.inspect()
    if (
      !identity
      || accountIdForIdentity(identity) !== account.accountId
      || userIdDigest(identity.userId) !== account.userIdDigest
      || identity.tenantId !== account.tenantId
    ) {
      await this.#expireAccount(account).catch(() => undefined)
      throw new Error('飞书登录已过期或账号已变化，请先重新连接账号。')
    }
    const agent = await this.#dependencies!.core.request<AgentProfile>('members.get', { agentId })
    if (!agent || agent.presence !== 'present') throw new Error('该队员当前不可发布。')
    if (previousIntent?.state === 'failed_unknown_remote_state') {
      return this.#reconcileUnknownMemberBot(account, identity, agent, previousIntent)
    }

    const publicationIntentId = `rvfpi_${randomUUID().replaceAll('-', '')}`
    await this.#command('channels.feishu.publicationIntent.create', {
      publicationIntentId,
      accountId: account.accountId,
      agentId,
      expectedUserIdDigest: account.userIdDigest,
      expectedTenantId: account.tenantId,
      requestedAppName: agent.displayName,
      provisioningMode: mode
    })
    let intentVersion = 1
    const advanceIntent = async (
      payload: {
        state: CoreChannelSnapshot['publicationIntents'][number]['state']
        remoteAppId: string | null
        credentialRef: string | null
        lastCompletedStep: string | null
        failureCode: string | null
      }
    ): Promise<void> => {
      await this.#advancePublicationIntent(publicationIntentId, intentVersion, payload)
      intentVersion += 1
    }
    let remoteAppId: string | null = null
    let credentialWritten = false
    const credentialRef = memberCredentialRef(agentId)
    const abort = new AbortController()
    this.#activeProvisioningAbort = abort
    this.#activeProvisioning = {
      publicationIntentId,
      agentId,
      stage: 'verifying_session',
      detail: '正在确认当前开发者会话与发布账号一致。',
      remoteAppId: null,
      failureCode: null
    }
    await this.#emit()
    try {
      await advanceIntent({
        state: 'session_verified',
        remoteAppId: null,
        credentialRef: null,
        lastCompletedStep: 'session_verified',
        failureCode: null
      })
      let credential: FeishuAppCredential
      let botDisplayName = agent.displayName
      if (mode === 'developer_session') {
        const provisioned = await this.#memberBotProvisioner.create({
          publicationIntentId,
          agentId,
          appName: agent.displayName,
          appDescription: `Rovai AI 队员 · ${agent.teamRole || '协作者'}`,
          expectedDeveloperIdentity: {
            userId: identity.userId,
            tenantId: identity.tenantId
          },
          signal: abort.signal,
          onProgress: (step, appId) => {
            if (appId) remoteAppId = appId
            this.#handleProvisioningProgress(step, appId)
          }
        })
        remoteAppId = provisioned.appId
        botDisplayName = provisioned.botDisplayName
        credential = { appId: provisioned.appId, appSecret: provisioned.appSecret }
      } else {
        this.#setProvisioningProgress(
          'creating_app',
          '兼容模式正在打开飞书确认流程…'
        )
        const provisioned = await this.#compatMemberBotProvisioner.create({
          publicationIntentId,
          agentId,
          appName: agent.displayName,
          appDescription: `Rovai AI 队员 · ${agent.teamRole || '协作者'}`,
          expectedDeveloperIdentity: {
            userId: identity.userId,
            tenantId: identity.tenantId
          },
          signal: abort.signal,
          onProgress: (step, appId) => {
            if (appId) remoteAppId = appId
            this.#handleProvisioningProgress(step, appId)
          }
        })
        remoteAppId = provisioned.appId
        botDisplayName = provisioned.botDisplayName
        credential = { appId: provisioned.appId, appSecret: provisioned.appSecret }
      }
      await advanceIntent({
        state: 'app_created',
        remoteAppId,
        credentialRef: null,
        lastCompletedStep: 'app_created',
        failureCode: null
      })
      await this.#dependencies!.credentialStore.write(credentialRef, credential)
      credentialWritten = true
      await advanceIntent({
        state: 'credentials_read',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'credentials_read',
        failureCode: null
      })
      await advanceIntent({
        state: 'bot_configured',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'bot_configured',
        failureCode: null
      })
      await advanceIntent({
        state: 'version_published',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'version_published',
        failureCode: null
      })
      this.#setProvisioningProgress(
        'verifying_connection',
        '正在验证 Bot 长连接…',
        remoteAppId
      )
      await this.#publishCredential(
        account.accountId,
        { ...agent, displayName: botDisplayName },
        credentialRef,
        credential
      )
      await advanceIntent({
        state: 'connection_verified',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'connection_verified',
        failureCode: null
      })
      await advanceIntent({
        state: 'completed',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'completed',
        failureCode: null
      })
      this.#publicationFailures.delete(agentId)
      this.#activeProvisioning = {
        publicationIntentId,
        agentId,
        stage: 'completed',
        detail: '发布完成。',
        remoteAppId,
        failureCode: null
      }
      this.#finishQr()
      return this.#emit()
    } catch (error) {
      const failureCode = channelFailureCode(error)
      const unknownRemoteState = isUnknownRemoteProvisioningError(error)
        || (remoteAppId !== null && !credentialWritten)
      await this.#advancePublicationIntent(publicationIntentId, intentVersion, {
        state: unknownRemoteState ? 'failed_unknown_remote_state' : 'failed_recoverable',
        remoteAppId,
        credentialRef: credentialWritten ? credentialRef : null,
        lastCompletedStep: null,
        failureCode
      }).catch(() => undefined)
      this.#publicationFailures.set(agentId, failureCode)
      this.#activeProvisioning = {
        publicationIntentId,
        agentId,
        stage: unknownRemoteState ? 'unknown_remote_state' : 'failed',
        detail: unknownRemoteState
          ? '无法确认远端应用是否已经创建；已停止自动重试。'
          : '发布没有完成，可以在排除问题后重试。',
        remoteAppId,
        failureCode
      }
      await this.#emit()
      throw error
    } finally {
      if (this.#activeProvisioningAbort === abort) this.#activeProvisioningAbort = null
    }
  }

  async #reconcileUnknownMemberBot(
    account: NonNullable<CoreChannelSnapshot['account']>,
    identity: FeishuDeveloperIdentity,
    agent: AgentProfile,
    intent: CoreChannelSnapshot['publicationIntents'][number]
  ): Promise<ChannelSettingsSnapshot> {
    const remoteAppId = intent.remoteAppId
    if (!remoteAppId || !this.#memberBotProvisioner.reconcile) {
      throw new Error('当前版本无法核对已创建的飞书应用；为避免重复创建应用，不会自动重试。')
    }
    const credentialRef = memberCredentialRef(agent.agentId)
    const abort = new AbortController()
    this.#activeProvisioningAbort = abort
    this.#activeProvisioning = {
      publicationIntentId: intent.publicationIntentId,
      agentId: agent.agentId,
      stage: 'verifying_session',
      detail: '正在核对当前开发者会话与已创建应用。',
      remoteAppId,
      failureCode: null
    }
    await this.#emit()

    let intentVersion = intent.version
    let credentialWritten = false
    const advanceIntent = async (
      payload: {
        state: CoreChannelSnapshot['publicationIntents'][number]['state']
        remoteAppId: string
        credentialRef: string | null
        lastCompletedStep: string | null
        failureCode: string | null
      }
    ): Promise<void> => {
      await this.#advancePublicationIntent(intent.publicationIntentId, intentVersion, payload)
      intentVersion += 1
    }

    try {
      const provisioned = await this.#memberBotProvisioner.reconcile({
        publicationIntentId: intent.publicationIntentId,
        agentId: agent.agentId,
        remoteAppId,
        appName: agent.displayName,
        expectedDeveloperIdentity: {
          userId: identity.userId,
          tenantId: identity.tenantId
        },
        signal: abort.signal,
        onProgress: (step, appId) => this.#handleProvisioningProgress(step, appId)
      })
      if (provisioned.appId !== remoteAppId || !provisioned.publishedVersionId) {
        throw new Error('feishu_console_reconciliation_identity_mismatch')
      }
      const credential = {
        appId: remoteAppId,
        appSecret: provisioned.appSecret
      }
      await this.#dependencies!.credentialStore.write(credentialRef, credential)
      credentialWritten = true
      await advanceIntent({
        state: 'credentials_read',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'credentials_read',
        failureCode: null
      })
      await advanceIntent({
        state: 'bot_configured',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'bot_configured',
        failureCode: null
      })
      await advanceIntent({
        state: 'version_published',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'version_published',
        failureCode: null
      })
      this.#setProvisioningProgress(
        'verifying_connection',
        '正在验证 Bot 长连接…',
        remoteAppId
      )
      await this.#publishCredential(
        account.accountId,
        { ...agent, displayName: provisioned.botDisplayName },
        credentialRef,
        credential
      )
      await advanceIntent({
        state: 'connection_verified',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'connection_verified',
        failureCode: null
      })
      await advanceIntent({
        state: 'completed',
        remoteAppId,
        credentialRef,
        lastCompletedStep: 'completed',
        failureCode: null
      })
      this.#publicationFailures.delete(agent.agentId)
      this.#activeProvisioning = {
        publicationIntentId: intent.publicationIntentId,
        agentId: agent.agentId,
        stage: 'completed',
        detail: '发布完成。',
        remoteAppId,
        failureCode: null
      }
      return this.#emit()
    } catch (error) {
      const failureCode = channelFailureCode(error)
      await this.#advancePublicationIntent(intent.publicationIntentId, intentVersion, {
        state: credentialWritten ? 'failed_recoverable' : 'failed_unknown_remote_state',
        remoteAppId,
        credentialRef: credentialWritten ? credentialRef : null,
        lastCompletedStep: null,
        failureCode
      }).catch(() => undefined)
      this.#publicationFailures.set(agent.agentId, failureCode)
      this.#activeProvisioning = {
        publicationIntentId: intent.publicationIntentId,
        agentId: agent.agentId,
        stage: credentialWritten ? 'failed' : 'unknown_remote_state',
        detail: credentialWritten
          ? '已保存应用凭据，但 Bot 连接尚未完成；可以安全重试。'
          : '无法核对已创建应用的凭据或发布状态；不会创建第二个应用。',
        remoteAppId,
        failureCode
      }
      await this.#emit()
      throw error
    } finally {
      if (this.#activeProvisioningAbort === abort) this.#activeProvisioningAbort = null
    }
  }

  async #upsertAccount(identity: FeishuDeveloperIdentity): Promise<void> {
    await this.#command('channels.feishu.account.upsert', {
      accountId: accountIdForIdentity(identity),
      userIdDigest: userIdDigest(identity.userId),
      tenantId: identity.tenantId,
      userName: identity.userName,
      email: identity.email ?? null,
      tenantName: identity.tenantName,
      brand: identity.brand
    })
  }

  async #expireAccount(account: NonNullable<CoreChannelSnapshot['account']>): Promise<void> {
    if (account.status !== 'connected') return
    await this.#command('channels.feishu.account.expire', {
      accountId: account.accountId,
      expectedVersion: account.version
    })
  }

  async #advancePublicationIntent(
    publicationIntentId: string,
    expectedVersion: number,
    input: {
      state: CoreChannelSnapshot['publicationIntents'][number]['state']
      remoteAppId: string | null
      credentialRef: string | null
      lastCompletedStep: string | null
      failureCode: string | null
    }
  ): Promise<void> {
    await this.#command('channels.feishu.publicationIntent.advance', {
      publicationIntentId,
      expectedVersion,
      ...input
    })
  }

  #setProvisioningProgress(
    stage: NonNullable<ChannelSettingsSnapshot['activeProvisioning']>['stage'],
    detail: string,
    remoteAppId: string | null = this.#activeProvisioning?.remoteAppId ?? null
  ): void {
    if (!this.#activeProvisioning) return
    this.#activeProvisioning = {
      ...this.#activeProvisioning,
      stage,
      detail,
      remoteAppId
    }
    void this.#emit()
  }

  #handleProvisioningProgress(step: MemberBotProvisioningStep, remoteAppId?: string): void {
    const progress: Record<MemberBotProvisioningStep, {
      stage: NonNullable<ChannelSettingsSnapshot['activeProvisioning']>['stage']
      detail: string
    }> = {
      session_verified: {
        stage: 'creating_app',
        detail: '账号校验完成，正在创建独立应用。'
      },
      app_created: {
        stage: 'configuring_bot',
        detail: '应用已创建，正在启用 Bot…'
      },
      bot_configured: {
        stage: 'configuring_permissions',
        detail: 'Bot 已启用，正在配置权限、事件与长连接…'
      },
      permissions_events_configured: {
        stage: 'publishing_version',
        detail: '权限与事件已配置，正在发布版本…'
      },
      version_published: {
        stage: 'verifying_connection',
        detail: '版本已发布，正在验证连接…'
      }
    }
    const next = progress[step]
    this.#setProvisioningProgress(
      next.stage,
      next.detail,
      remoteAppId ?? this.#activeProvisioning?.remoteAppId ?? null
    )
  }

  #updateLoginAttempt(attemptId: string, stage: FeishuLoginStage): void {
    if (this.#activeQrAttempt?.attemptId !== attemptId) return
    const details: Partial<Record<FeishuLoginStage, string>> = {
      checking_secure_storage: '正在检查系统安全存储；如出现系统授权提示，请选择允许…',
      preparing: '正在准备飞书开放平台登录…',
      awaiting_scan: '请使用飞书扫码登录开放平台。',
      scan_confirmed: '已扫码，正在确认登录…',
      inspecting_identity: '正在读取飞书账号与企业身份…',
      securing_session: '身份读取完成，正在安全保存开发者会话…',
      connected: '飞书账号已连接。',
      expired: '登录二维码已过期，请关闭后重试。',
      cancelled: '登录已取消。',
      failed: '飞书账号登录失败。'
    }
    this.#activeQrAttempt = {
      ...this.#activeQrAttempt,
      stage,
      detail: details[stage] ?? this.#activeQrAttempt.detail
    }
    void this.#emit()
  }

  async #recoverPublicationIntents(snapshot: CoreChannelSnapshot): Promise<void> {
    const active = snapshot.publicationIntents.filter((intent) => ![
      'completed',
      'failed_recoverable',
      'failed_unknown_remote_state'
    ].includes(intent.state))
    for (const intent of active) {
      const credential = intent.credentialRef
        ? await this.#dependencies!.credentialStore.read(intent.credentialRef)
        : null
      const safeToRetry = intent.state === 'created'
        || (Boolean(intent.remoteAppId) && Boolean(intent.credentialRef) && Boolean(credential))
      await this.#advancePublicationIntent(intent.publicationIntentId, intent.version, {
        state: safeToRetry ? 'failed_recoverable' : 'failed_unknown_remote_state',
        remoteAppId: intent.remoteAppId,
        credentialRef: intent.credentialRef,
        lastCompletedStep: intent.lastCompletedStep,
        failureCode: safeToRetry
          ? 'desktop_restarted'
          : 'desktop_restarted_with_unknown_remote_state'
      })
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
    if (
      this.#activeQrAttempt?.purpose === 'member_bot_compat_registration'
      && this.#activeQrAttempt.agentId
    ) {
      const agentId = this.#activeQrAttempt.agentId
      bots.set(agentId, {
        agentId,
        publicationStatus: this.#activeQrAttempt.stage === 'failed' ? 'failed' : 'provisioning',
        botDisplayName: bots.get(agentId)?.botDisplayName ?? null,
        appId: bots.get(agentId)?.appId ?? null,
        failureCode: this.#activeQrAttempt.stage === 'failed' ? 'registration_failed' : null
      })
    }
    if (this.#activeProvisioning) {
      const { agentId, stage, remoteAppId, failureCode } = this.#activeProvisioning
      const existing = bots.get(agentId)
      bots.set(agentId, {
        agentId,
        publicationStatus: stage === 'failed' || stage === 'unknown_remote_state'
          ? 'failed'
          : stage === 'completed'
            ? 'published'
            : 'provisioning',
        botDisplayName: existing?.botDisplayName ?? null,
        appId: remoteAppId ?? existing?.appId ?? null,
        failureCode
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
      schemaVersion: 3,
      channels: [{
        kind: 'feishu',
        displayName: '飞书',
        hostStatus: 'ready',
        connection: {
          status: connected
            ? 'connected'
            : snapshot.account?.status === 'session_expired'
              ? 'session_expired'
              : 'not_connected',
          account: snapshot.account?.status !== 'disconnected' && snapshot.account ? {
            accountId: snapshot.account.accountId,
            userName: snapshot.account.userName,
            ...(snapshot.account.email ? { email: snapshot.account.email } : {}),
            tenantName: snapshot.account.tenantName,
            brand: snapshot.account.brand,
            connectedAt: snapshot.account.connectedAt,
            lastVerifiedAt: snapshot.account.lastVerifiedAt
          } : null
        },
        memberBots: [...bots.values()].sort((left, right) => left.agentId.localeCompare(right.agentId))
      }],
      projectBindings: snapshot.projectBindings,
      unboundConversations: snapshot.unboundConversations,
      conversationBindings: snapshot.conversationBindings,
      activeQrAttempt: this.#activeQrAttempt ? structuredClone(this.#activeQrAttempt) : null,
      activeProvisioning: this.#activeProvisioning
        ? structuredClone(this.#activeProvisioning)
        : null
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
      detail: channelFailureDetail(error)
    }
    void this.#emit()
  }

  #requireHost(): void {
    if (!this.#dependencies) throw new Error('飞书渠道宿主不可用。')
  }
}

function unavailableSnapshot(): ChannelSettingsSnapshot {
  return {
    schemaVersion: 3,
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
    activeQrAttempt: null,
    activeProvisioning: null
  }
}

function memberCredentialRef(agentId: string): string {
  return `feishu-member-${createHash('sha256').update(agentId).digest('hex').slice(0, 32)}`
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function userIdDigest(userId: string): `sha256:${string}` {
  return digest(`feishu-user\0${userId}`)
}

function accountIdForIdentity(identity: FeishuDeveloperIdentity): `sha256:${string}` {
  return digest(`${identity.brand}\0${identity.tenantId}\0${identity.userId}`)
}

function latestPublicationIntent(
  snapshot: CoreChannelSnapshot,
  agentId: string
): CoreChannelSnapshot['publicationIntents'][number] | null {
  return snapshot.publicationIntents.find((intent) => intent.agentId === agentId) ?? null
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

function channelFailureDetail(error: unknown): string {
  const code = channelFailureCode(error)
  const details: Record<string, string> = {
    system_credential_encryption_unavailable:
      '无法访问系统安全存储。macOS 上请在钥匙串提示中选择“允许”，然后重试。',
    feishu_developer_identity_incomplete:
      '已登录飞书，但未能读取完整的账号与企业信息。请关闭后重试。',
    feishu_login_failed: '无法打开飞书登录页面，请检查网络后重试。',
    feishu_login_expired: '飞书登录已超时，请关闭后重试。',
    feishu_login_cancelled: '飞书登录已取消。',
    feishu_developer_session_expired: '飞书开发者会话已过期，请重新登录。',
    feishu_developer_identity_changed: '飞书账号或企业身份已变化，请重新连接。'
  }
  if (details[code]) return details[code]
  return code === 'unknown'
    ? '飞书操作失败，请关闭后重试。'
    : `飞书操作失败（${code}），请关闭后重试。`
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
