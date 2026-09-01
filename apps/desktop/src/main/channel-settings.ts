import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  createLarkChannel,
  LarkChannelError,
  normalize,
  type BotAddedEvent,
  type BotIdentity,
  type CardActionEvent,
  type LarkChannel,
  type NormalizedMessage,
  type RawMessageEvent
} from '@larksuiteoapi/node-sdk'
import type {
  AgentProfile,
  ChannelMemberBotView,
  ChannelQrAttemptView,
  ChannelSettingsSnapshot,
  CoreEvent,
  StoredCommandResult
} from '@contracts'
import type { CoreClient } from './core-client'
import type {
  ChannelCredentialStore,
  FeishuAppCredential,
  PublishedChannelCredential
} from './channel-credential-store'
import type {
  FeishuDeveloperIdentity,
  FeishuDeveloperSessionInspection,
  FeishuDeveloperSessionService,
  FeishuLoginStage
} from './feishu-developer-session'
import {
  UnavailableFeishuDeveloperSessionService,
  UnavailableFeishuMemberBotProvisioner,
  isUnknownRemoteProvisioningError,
  type FeishuMemberBotProvisioner,
  type MemberBotAvatarSource,
  type MemberBotProvisioningStep
} from './feishu-member-bot-provisioner'
import type { MemberBotAvatarSourceResolver } from './member-bot-avatar-source'
import { ProvisioningTimingRecorder } from './feishu-provisioning-timing'
import { memberBotAppDescription } from '../shared/channel-member-bot-copy'
import type { FeishuExecutionPreviewHost } from './feishu-execution-preview'
import { sendFeishuAgentOutput } from './feishu-agent-output-card'
import { feishuPageCardResponse, feishuPageFailure, withFeishuPageDeadline, type FeishuCardActionResponse } from './feishu-card-action'
import {
  feishuExecutionStateCard,
  type ExecutionConsoleSnapshot
} from '../shared/execution-presentation/feishu-card'
import type { ExecutionViewScope } from './execution-view-service'
import { AdaptiveChannelHostPump } from './channel-host-pump'

type CoreChannelSnapshot = {
  schemaVersion: 2
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
    brand: 'feishu' | 'lark'
    appId: string
    botDisplayName: string
    credentialRef: string
    status: 'published' | 'disabled'
    failureCode: string | null
    version: number
    ownerIdentityStatus: 'verified' | 'unverified'
  }>
  publicationIntents: Array<{
    publicationIntentId: string
    agentId: string
    accountId: string
    expectedUserIdDigest: string
    expectedTenantId: string
    requestedAppName: string
    provisioningMode: 'developer_session'
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
  pendingBindingCount: number
  bindingIssueCount: number
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
  requestId: string | null
  deliveryKind:
    | 'project_selection'
    | 'queue_ack'
    | 'execution_console_upsert'
    | 'execution_console_recall'
    | 'agent_output'
    | 'agent_attachment'
    | 'attention'
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

type TopicRosterRefreshRequest = {
  provider: 'feishu'
  tenantKey: string
  chatId: string
  requiredRosterGeneration: number
}

type CreateChannel = typeof createLarkChannel

type DesktopAttachmentTarget = {
  attachmentId: string
  displayName: string
  kind: 'file'
  mediaType: string
  path: string
  openRisk: 'normal' | 'confirm'
}

type ExecutionConsoleSource = ExecutionConsoleSnapshot & {
  campId: string
  campTurnId: string
  channelConversationId: string
  agentId: string
  runCreatedAt: string
  targetAppId: string
  externalMessageId: string | null
  state: 'opening' | 'active' | 'terminal_pending' | 'terminal_sealed'
}

export interface ChannelHostDependencies {
  core: Pick<CoreClient, 'request'>
  credentialStore: ChannelCredentialStore
  developerSession?: FeishuDeveloperSessionService
  memberBotProvisioner?: FeishuMemberBotProvisioner
  memberBotAvatarSource?: MemberBotAvatarSourceResolver
  createChannel?: CreateChannel
  executionPreview?: FeishuExecutionPreviewHost
  executionView?: {
    createExecutionViewUrl(scope: ExecutionViewScope): Promise<string | null>
    revokeExecutionViewUrl(url: string | null): void
  }
  now?: () => number
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
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

type RawCardActionEvent = {
  event_id?: string
  app_id?: string
  operator?: {
    open_id?: string
    user_id?: string
    union_id?: string
  }
}

type ExecutionCardPresentationState = {
  agentRunId: string
  targetAppId: string
  externalMessageId: string | null
  executionViewUrl: string | null
  recentOutputVisible: boolean
  latestSource: ExecutionConsoleSource
  lastCardDigest: string | null
}

const HOST_WORKER_ID = `desktop-${randomUUID()}`
const ROSTER_CACHE_MS = 20_000
const ROSTER_SWEEP_MS = 30_000
const NON_OWNER_DM_HINT_THROTTLE_MS = 24 * 60 * 60_000
const unavailableMemberBotAvatarSource: MemberBotAvatarSourceResolver = {
  async resolve(avatarRef) {
    if (avatarRef === null) return undefined
    throw new Error('feishu_member_bot_avatar_unavailable')
  }
}
export class ChannelSettingsService {
  readonly #dependencies: ChannelHostDependencies | null
  readonly #developerSession: FeishuDeveloperSessionService
  readonly #memberBotProvisioner: FeishuMemberBotProvisioner
  readonly #memberBotAvatarSource: MemberBotAvatarSourceResolver
  readonly #createChannel: CreateChannel
  readonly #now: () => number
  readonly #listeners = new Set<(snapshot: ChannelSettingsSnapshot) => void>()
  readonly #managedChannels = new Map<string, ManagedChannel>()
  readonly #publicationFailures = new Map<string, string>()
  readonly #chatModeCache = new Map<string, 'p2p' | 'group' | 'topic'>()
  readonly #chatNameCache = new Map<string, string>()
  readonly #rosterReconciledAt = new Map<string, number>()
  readonly #rosterReconciliations = new Map<string, Promise<boolean>>()
  readonly #dmHints = new Map<string, number>()
  readonly #executionCardStates = new Map<string, ExecutionCardPresentationState>()
  readonly #executionCardTails = new Map<string, Promise<unknown>>()
  readonly #hostPump: AdaptiveChannelHostPump | null
  #activeQrAttempt: ChannelQrAttemptView | null = null
  #activeQrAbort: AbortController | null = null
  #activeProvisioning: ChannelSettingsSnapshot['activeProvisioning'] = null
  #activeProvisioningAbort: AbortController | null = null
  #started = false
  #stopped = false
  #nextRosterSweepAt = 0
  #nextAggregateRecoveryAt = 0
  #sessionCheckGeneration = 0

  constructor(dependencies?: ChannelHostDependencies) {
    this.#dependencies = dependencies ?? null
    this.#developerSession = dependencies?.developerSession
      ?? new UnavailableFeishuDeveloperSessionService()
    this.#memberBotProvisioner = dependencies?.memberBotProvisioner
      ?? new UnavailableFeishuMemberBotProvisioner()
    this.#memberBotAvatarSource = dependencies?.memberBotAvatarSource
      ?? unavailableMemberBotAvatarSource
    this.#createChannel = dependencies?.createChannel ?? createLarkChannel
    this.#now = dependencies?.now ?? Date.now
    this.#hostPump = dependencies ? new AdaptiveChannelHostPump({
      run: () => this.#pumpOnce(),
      onError: (error) => {
        console.warn(`[rovai] Feishu outbox pump failed: ${channelFailureCode(error)}`)
      },
      now: this.#now,
      setTimeout: dependencies.setTimeout,
      clearTimeout: dependencies.clearTimeout
    }) : null
  }

  async start(): Promise<void> {
    if (!this.#dependencies || this.#started) return
    this.#started = true
    this.#stopped = false
    const sessionCheckGeneration = ++this.#sessionCheckGeneration
    try {
      const publishedCredentials = await this.#dependencies.credentialStore.listPublished()
      const credentialsByRef = new Map(publishedCredentials
        .filter((item): item is PublishedChannelCredential & {
          provider: 'feishu'
          credential: FeishuAppCredential
        } => item.provider === 'feishu')
        .map((item) => [item.credentialRef, item.credential] as const))
      let snapshot = await this.#coreSnapshot()
      await this.#recoverPublicationIntents(snapshot)
      snapshot = await this.#coreSnapshot()
      for (const bot of snapshot.memberBots.filter((candidate) => candidate.status === 'published')) {
        try {
          await this.#startPublishedBot(bot, credentialsByRef.get(bot.credentialRef) ?? null)
        } catch (error) {
          this.#publicationFailures.set(bot.agentId, channelFailureCode(error))
        }
      }
      await this.#emit()
      this.#hostPump?.start()
      if (snapshot.account?.status === 'connected') {
        void this.#checkDeveloperSession(snapshot.account, sessionCheckGeneration)
      }
    } catch (error) {
      await this.stop()
      this.#started = false
      throw error
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#sessionCheckGeneration += 1
    this.#activeQrAbort?.abort()
    this.#activeQrAbort = null
    this.#activeProvisioningAbort?.abort()
    this.#activeProvisioningAbort = null
    this.#hostPump?.stop()
    const channels = [...this.#managedChannels.values()]
    this.#managedChannels.clear()
    this.#rosterReconciledAt.clear()
    for (const state of this.#executionCardStates.values()) {
      this.#dependencies?.executionView?.revokeExecutionViewUrl(state.executionViewUrl)
    }
    this.#executionCardStates.clear()
    this.#executionCardTails.clear()
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

  handleCoreEvent(event: CoreEvent): void {
    this.#hostPump?.handleCoreEvent(event)
  }

  async connect(): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    if (this.#activeQrAttempt) throw new Error('已有一个飞书二维码流程正在进行。')
    this.#sessionCheckGeneration += 1
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
      detail: '正在读取 Rovai 本地渠道数据…'
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
      const pending = pendingFeishuConnection(this.#developerSession)
      const result = await this.#command('channels.feishu.account.commitConnection', {
        expectedPreviousAccountVersion: previous?.status === 'connected' ? previous.version : null,
        account: feishuConnectionAccount(identity),
        developerSession: pending
      })
      await activatePendingFeishuLogin(this.#developerSession, sessionRevisionFrom(result))
    } catch (error) {
      const failureCode = channelFailureCode(error)
      await this.#developerSession.discardPendingLogin?.().catch(() => undefined)
      if (failureCode === 'feishu_login_cancelled') {
        this.#finishQr()
        return this.#emit()
      }
      this.#failQr(error)
      throw error
    }
    this.#finishQr()
    return this.#emit()
  }

  async disconnect(): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    this.#sessionCheckGeneration += 1
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
    return this.#publishNewMemberBot(agentId, 'publish')
  }

  async retryMemberBot(agentId: string): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    const snapshot = await this.#coreSnapshot()
    const bot = snapshot.memberBots.find((candidate) => candidate.agentId === agentId) ?? null
    const intent = latestPublicationIntent(snapshot, agentId)
    const credentialRef = bot?.credentialRef ?? memberCredentialRef(agentId)
    const credential = await this.#dependencies!.credentialStore.read(credentialRef)
    let retryIntentVersion = intent?.version ?? null
    let retryLastCompletedStep = intent?.lastCompletedStep ?? null
    const canResumeInitialConnection = !bot
      && credential !== null
      && intent?.state === 'failed_recoverable'
      && intent.lastCompletedStep === 'version_published'
      && intent.remoteAppId === credential.appId
      && intent.credentialRef === credentialRef
    if (canResumeInitialConnection) {
      return this.#publishNewMemberBot(agentId, 'retry')
    }
    if (
      (!bot && !canResumeInitialConnection)
      || bot?.status === 'disabled'
      || !credential
      || intent?.state === 'failed_unknown_remote_state'
    ) {
      return this.#publishNewMemberBot(agentId, 'retry')
    }
    if (bot && credential.appId !== bot.appId) {
      throw new Error('本机凭据与该队员冻结的飞书应用不一致；为避免换绑，已停止重试。')
    }
    if (bot?.ownerIdentityStatus === 'unverified') {
      return this.#publishNewMemberBot(agentId, 'retry')
    }
    if (
      bot?.status === 'published'
      && intent?.state === 'completed'
      && this.#memberBotProvisioner.reconcile
      && snapshot.account?.status === 'connected'
    ) {
      const inspection = await this.#inspectDeveloperSession()
      if (
        inspection.status === 'valid'
        && accountIdForIdentity(inspection.identity) === snapshot.account.accountId
        && userIdDigest(inspection.identity.userId) === snapshot.account.userIdDigest
        && inspection.identity.tenantId === snapshot.account.tenantId
      ) return this.#publishNewMemberBot(agentId, 'retry')
    }
    const bindingAccountId = bot?.accountId ?? intent?.accountId
    if (!bindingAccountId) throw new Error('该队员缺少可恢复的飞书账号绑定。')
    const agent = await this.#dependencies!.core.request<AgentProfile>('members.get', { agentId })
    const recoveringIntent = intent?.state === 'failed_recoverable' ? intent : null
    const remoteAppId = recoveringIntent?.remoteAppId ?? credential.appId
    const advanceRetryIntent = async (
      state: 'connection_verified' | 'completed',
      lastCompletedStep: 'connection_verified' | 'completed'
    ): Promise<void> => {
      if (!recoveringIntent || retryIntentVersion === null) return
      await this.#advancePublicationIntent(
        recoveringIntent.publicationIntentId,
        retryIntentVersion,
        {
          state,
          remoteAppId,
          credentialRef,
          lastCompletedStep,
          failureCode: null
        }
      )
      retryIntentVersion += 1
      retryLastCompletedStep = lastCompletedStep
    }
    try {
      await this.#connectPublishedCredential(agent, credentialRef, credential)
      await advanceRetryIntent('connection_verified', 'connection_verified')
      await advanceRetryIntent('completed', 'completed')
    } catch (error) {
      if (recoveringIntent && retryIntentVersion !== null) {
        await this.#advancePublicationIntent(
          recoveringIntent.publicationIntentId,
          retryIntentVersion,
          {
            state: 'failed_recoverable',
            remoteAppId,
            credentialRef,
            lastCompletedStep: retryLastCompletedStep,
            failureCode: channelFailureCode(error)
          }
        ).catch(() => undefined)
      }
      throw error
    }
    this.#publicationFailures.delete(agentId)
    if (this.#activeProvisioning?.agentId === agentId) {
      this.#activeProvisioning = {
        ...this.#activeProvisioning,
        stage: 'completed',
        detail: 'Bot 已发布并建立长连接。',
        remoteAppId: credential.appId,
        failureCode: null
      }
    }
    return this.#emit()
  }

  async cancelQrAttempt(attemptId: string): Promise<ChannelSettingsSnapshot> {
    if (this.#activeQrAttempt?.attemptId === attemptId) {
      this.#activeQrAbort?.abort()
      this.#finishQr()
    }
    return this.#emit()
  }

  async #publishNewMemberBot(
    agentId: string,
    operation: 'publish' | 'retry'
  ): Promise<ChannelSettingsSnapshot> {
    this.#requireHost()
    if (this.#activeProvisioning && !['completed', 'failed', 'unknown_remote_state'].includes(
      this.#activeProvisioning.stage
    )) throw new Error('已有一名队员正在发布。')
    if (this.#activeQrAttempt) throw new Error('已有一个飞书二维码流程正在进行。')
    const snapshot = await this.#coreSnapshot()
    const account = snapshot.account?.status === 'connected' ? snapshot.account : null
    if (!account) throw new Error('飞书登录已过期，请先重新连接账号。')
    const existingBot = snapshot.memberBots.find((bot) => bot.agentId === agentId) ?? null
    const previousIntent = latestPublicationIntent(snapshot, agentId)
    if (existingBot?.status === 'published' && operation === 'publish') {
      throw new Error('该队员已经绑定并发布为飞书 Bot，不会创建第二个应用。')
    }
    if (existingBot) {
      if (
        !previousIntent
        || previousIntent.remoteAppId !== existingBot.appId
        || previousIntent.accountId !== existingBot.accountId
        || (previousIntent.credentialRef !== null
          && previousIntent.credentialRef !== existingBot.credentialRef)
      ) {
        throw new Error('该队员的飞书应用状态不一致；为避免换绑，已停止操作。')
      }
      if (account.accountId !== existingBot.accountId) {
        throw new Error('请先连接最初发布该队员应用的飞书账号。')
      }
      if (!['completed', 'failed_recoverable', 'failed_unknown_remote_state'].includes(
        previousIntent.state
      )) {
        throw new Error('该队员已有未完成的同应用发布记录。')
      }
    } else if (previousIntent?.state === 'completed') {
      throw new Error('该队员已有已完成的发布状态，但本地 Bot 绑定缺失；不会创建第二个应用。')
    }
    if (!existingBot && previousIntent?.state === 'failed_unknown_remote_state') {
      if (!previousIntent.remoteAppId) {
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
    const inspection = await this.#inspectDeveloperSession()
    if (inspection.status === 'unavailable') {
      throw new Error('暂时无法检查飞书登录状态，请稍后重试。已有登录会话已保留。')
    }
    if (
      inspection.status === 'invalid'
      || accountIdForIdentity(inspection.identity) !== account.accountId
      || userIdDigest(inspection.identity.userId) !== account.userIdDigest
      || inspection.identity.tenantId !== account.tenantId
    ) {
      await this.#expireAccount(account).catch(() => undefined)
      throw new Error('飞书登录已过期或账号已变化，请先重新连接账号。')
    }
    const { identity } = inspection
    const agent = await this.#dependencies!.core.request<AgentProfile>('members.get', { agentId })
    if (!agent || agent.presence !== 'present') throw new Error('该队员当前不可发布。')
    const appDescription = memberBotAppDescription('feishu', agent.teamRole)
    const avatarSource = await this.#memberBotAvatarSource.resolve(agent.avatarRef)
    if (
      existingBot
      || (previousIntent?.remoteAppId
        && ['failed_recoverable', 'failed_unknown_remote_state'].includes(previousIntent.state))
    ) {
      if (!previousIntent) throw new Error('该队员缺少可恢复的飞书发布状态。')
      return this.#reconcileFrozenMemberBot(
        account,
        identity,
        agent,
        previousIntent,
        appDescription,
        avatarSource
      )
    }

    const publicationIntentId = `rvfpi_${randomUUID().replaceAll('-', '')}`
    const timing = new ProvisioningTimingRecorder({
      publicationIntentId,
      agentId,
      recovering: false
    })
    await this.#command('channels.feishu.publicationIntent.create', {
      publicationIntentId,
      accountId: account.accountId,
      agentId,
      expectedUserIdDigest: account.userIdDigest,
      expectedTenantId: account.tenantId,
      requestedAppName: agent.displayName,
      provisioningMode: 'developer_session'
    })
    let intentVersion = 1
    let lastCompletedStep: string | null = null
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
      lastCompletedStep = payload.lastCompletedStep
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
      detail: '正在确认当前开发者会话、账号和租户与发布目标一致。',
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
      const provisioned = await this.#memberBotProvisioner.create({
        publicationIntentId,
        agentId,
        appName: agent.displayName,
        appDescription,
        avatarSource,
        expectedDeveloperIdentity: {
          userId: identity.userId,
          tenantId: identity.tenantId
        },
        timing,
        signal: abort.signal,
        onRemoteAppCreated: async ({ appId }) => {
          remoteAppId = appId
          await advanceIntent({
            state: 'app_created',
            remoteAppId: appId,
            credentialRef: null,
            lastCompletedStep: 'app_created',
            failureCode: null
          })
        },
        onProgress: (step, appId) => {
          if (appId) remoteAppId = appId
          this.#handleProvisioningProgress(step, appId, false)
        }
      })
      remoteAppId = provisioned.appId
      const botDisplayName = provisioned.botDisplayName
      const credential: FeishuAppCredential = {
        appId: provisioned.appId,
        appSecret: provisioned.appSecret
      }
      await this.#command('channels.feishu.publicationIntent.storeCredential', {
        provider: 'feishu',
        publicationIntentId,
        expectedIntentVersion: intentVersion,
        credentialRef,
        remoteAppId,
        credential: { appSecret: credential.appSecret }
      })
      credentialWritten = true
      intentVersion += 1
      lastCompletedStep = 'credentials_read'
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
        'connecting_bot',
        '在线配置已确认，正在使用该队员的独立凭据建立消息长连接。',
        remoteAppId
      )
      await this.#publishCredential(
        account.accountId,
        { ...agent, displayName: botDisplayName },
        credentialRef,
        credential,
        provisioned.ownerOpenId,
        timing
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
        detail: 'Bot 已发布并建立长连接。',
        remoteAppId,
        failureCode: null
      }
      timing.recordTotal('ok')
      this.#finishQr()
      return this.#emit()
    } catch (error) {
      timing.recordTotal('failed', error)
      const failureCode = channelFailureCode(error)
      const unknownRemoteState = isUnknownRemoteProvisioningError(error)
      let failureStatePersisted = false
      try {
        await this.#advancePublicationIntent(publicationIntentId, intentVersion, {
          state: unknownRemoteState ? 'failed_unknown_remote_state' : 'failed_recoverable',
          remoteAppId,
          credentialRef: credentialWritten ? credentialRef : null,
          lastCompletedStep,
          failureCode
        })
        failureStatePersisted = true
      } catch {
        // Keep the original failure. An in-memory App ID is not a recovery identity.
      }
      if (unknownRemoteState && !failureStatePersisted) remoteAppId = null
      this.#publicationFailures.set(agentId, failureCode)
      this.#activeProvisioning = {
        publicationIntentId,
        agentId,
        stage: unknownRemoteState ? 'unknown_remote_state' : 'failed',
        detail: unknownRemoteState
          ? '无法确认本次创建请求是否已在飞书落地。为避免重复应用，Rovai 不会自动再次创建。'
          : recoverableProvisioningDetail(failureCode, remoteAppId !== null),
        remoteAppId,
        failureCode
      }
      await this.#emit()
      throw error
    } finally {
      if (this.#activeProvisioningAbort === abort) this.#activeProvisioningAbort = null
    }
  }

  async #reconcileFrozenMemberBot(
    account: NonNullable<CoreChannelSnapshot['account']>,
    identity: FeishuDeveloperIdentity,
    agent: AgentProfile,
    intent: CoreChannelSnapshot['publicationIntents'][number],
    appDescription: string,
    avatarSource: MemberBotAvatarSource | undefined
  ): Promise<ChannelSettingsSnapshot> {
    const remoteAppId = intent.remoteAppId
    if (!remoteAppId || !this.#memberBotProvisioner.reconcile) {
      throw new Error('当前版本无法核对已创建的飞书应用；为避免重复创建应用，不会自动重试。')
    }
    const credentialRef = intent.credentialRef ?? memberCredentialRef(agent.agentId)
    const timing = new ProvisioningTimingRecorder({
      publicationIntentId: intent.publicationIntentId,
      agentId: agent.agentId,
      appId: remoteAppId,
      recovering: true
    })
    const abort = new AbortController()
    this.#activeProvisioningAbort = abort
    this.#activeProvisioning = {
      publicationIntentId: intent.publicationIntentId,
      agentId: agent.agentId,
      stage: 'verifying_session',
      detail: '正在确认当前开发者会话仍有权管理已绑定应用。',
      remoteAppId,
      failureCode: null
    }
    await this.#emit()

    let intentVersion = intent.version
    let credentialWritten = false
    let lastCompletedStep = intent.lastCompletedStep
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
      lastCompletedStep = payload.lastCompletedStep
    }

    try {
      const reopeningCompletedBinding = intent.state === 'completed'
      if (reopeningCompletedBinding) {
        await advanceIntent({
          state: 'session_verified',
          remoteAppId,
          credentialRef,
          lastCompletedStep: 'session_verified',
          failureCode: null
        })
      }
      const provisioned = await this.#memberBotProvisioner.reconcile({
        publicationIntentId: intent.publicationIntentId,
        agentId: agent.agentId,
        remoteAppId,
        appName: agent.displayName,
        appDescription,
        avatarSource,
        expectedDeveloperIdentity: {
          userId: identity.userId,
          tenantId: identity.tenantId
        },
        timing,
        signal: abort.signal,
        onProgress: (step, appId) => this.#handleProvisioningProgress(step, appId, true)
      })
      if (provisioned.appId !== remoteAppId || !provisioned.publishedVersionId) {
        throw new Error('feishu_console_reconciliation_identity_mismatch')
      }
      if (reopeningCompletedBinding) {
        await advanceIntent({
          state: 'app_created',
          remoteAppId,
          credentialRef,
          lastCompletedStep: 'app_created',
          failureCode: null
        })
      }
      const credential = {
        appId: remoteAppId,
        appSecret: provisioned.appSecret
      }
      await this.#command('channels.feishu.publicationIntent.storeCredential', {
        provider: 'feishu',
        publicationIntentId: intent.publicationIntentId,
        expectedIntentVersion: intentVersion,
        credentialRef,
        remoteAppId,
        credential: { appSecret: credential.appSecret }
      })
      credentialWritten = true
      intentVersion += 1
      lastCompletedStep = 'credentials_read'
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
        'connecting_bot',
        '在线配置已确认，正在使用该队员的独立凭据建立消息长连接。',
        remoteAppId
      )
      await this.#publishCredential(
        account.accountId,
        { ...agent, displayName: provisioned.botDisplayName },
        credentialRef,
        credential,
        provisioned.ownerOpenId,
        timing
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
        detail: 'Bot 已发布并建立长连接。',
        remoteAppId,
        failureCode: null
      }
      timing.recordTotal('ok')
      return this.#emit()
    } catch (error) {
      timing.recordTotal('failed', error)
      const failureCode = channelFailureCode(error)
      await this.#advancePublicationIntent(intent.publicationIntentId, intentVersion, {
        state: 'failed_recoverable',
        remoteAppId,
        credentialRef: credentialWritten ? credentialRef : intent.credentialRef,
        lastCompletedStep,
        failureCode
      }).catch(() => undefined)
      this.#publicationFailures.set(agent.agentId, failureCode)
      this.#activeProvisioning = {
        publicationIntentId: intent.publicationIntentId,
        agentId: agent.agentId,
        stage: 'failed',
        detail: recoverableProvisioningDetail(failureCode, true),
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
    await this.#command('channels.feishu.account.upsert', feishuConnectionAccount(identity))
  }

  async #inspectDeveloperSession(): Promise<FeishuDeveloperSessionInspection> {
    return this.#developerSession.inspect().catch(() => ({ status: 'unavailable' as const }))
  }

  async #checkDeveloperSession(
    account: NonNullable<CoreChannelSnapshot['account']>,
    generation: number
  ): Promise<void> {
    try {
      const inspection = await this.#inspectDeveloperSession()
      if (inspection.status === 'unavailable') return
      const current = (await this.#coreSnapshot()).account
      if (this.#stopped || generation !== this.#sessionCheckGeneration
        || current?.accountId !== account.accountId || current.version !== account.version
        || current.status !== 'connected') return
      if (inspection.status === 'invalid'
        || accountIdForIdentity(inspection.identity) !== account.accountId) {
        await this.#expireAccount(account)
      } else {
        await this.#upsertAccount(inspection.identity)
      }
      await this.#emit()
    } catch {
      // Background account verification must not tear down independently authenticated Bots.
    }
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

  #handleProvisioningProgress(
    step: MemberBotProvisioningStep,
    remoteAppId: string | undefined,
    recoveringFrozenApp: boolean
  ): void {
    const progress: Record<MemberBotProvisioningStep, {
      stage: NonNullable<ChannelSettingsSnapshot['activeProvisioning']>['stage']
      detail: string
    }> = {
      session_verified: {
        stage: 'creating_app',
        detail: recoveringFrozenApp
          ? '正在读取已冻结 App 的当前远端状态，不会创建第二个应用。'
          : '正在创建并冻结这名队员唯一的飞书应用身份。'
      },
      app_created: {
        stage: 'activating_app',
        detail: recoveringFrozenApp
          ? '正在确认 Bot 与已发布版本处于可继续配置状态。'
          : '正在启用 Bot 并完成首次应用发布。'
      },
      activation_started: {
        stage: 'activating_app',
        detail: recoveringFrozenApp
          ? '正在确认 Bot 与已发布版本处于可继续配置状态。'
          : '正在启用 Bot 并完成首次应用发布。'
      },
      activation_published: {
        stage: 'configuring_permissions',
        detail: '正在读取当前配置并提交所需权限、事件与回调变更。'
      },
      configuration_started: {
        stage: 'configuring_permissions',
        detail: '正在读取当前配置并提交所需权限、事件与回调变更。'
      },
      configuration_waiting: {
        stage: 'waiting_configuration',
        detail: '飞书正在同步权限、事件与长连接设置；这个过程可能需要几十秒。'
      },
      configuration_verified: {
        stage: 'publishing_version',
        detail: '配置已生效，正在发布包含最新 Bot 配置的应用版本。'
      },
      version_published: {
        stage: 'verifying_configuration',
        detail: '正在确认 Bot、发布版本及应用资料均已生效。'
      },
      online_verified: {
        stage: 'connecting_bot',
        detail: '在线配置已确认，正在使用该队员的独立凭据建立消息长连接。'
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
      loading_local_session: '正在读取 Rovai 本地渠道数据…',
      preparing: '正在准备飞书开放平台登录…',
      awaiting_scan: '请使用飞书扫码登录开放平台。',
      scan_confirmed: '已扫码，正在确认登录…',
      inspecting_identity: '正在读取飞书账号与企业身份…',
      saving_local_session: '身份读取完成，正在保存开发者会话…',
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
      const safeToRetry = intent.state === 'created' || Boolean(intent.remoteAppId)
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
    credential: FeishuAppCredential,
    ownerOpenId: string,
    timing?: ProvisioningTimingRecorder
  ): Promise<void> {
    await this.#command('channels.feishu.memberBot.upsert', {
      accountId,
      agentId: agent.agentId,
      appId: credential.appId,
      ownerOpenId,
      botOpenId: null,
      botDisplayName: agent.displayName,
      credentialRef
    })
    const managed = await this.#connectBot(agent.agentId, credentialRef, credential, timing)
    try {
      await this.#command('channels.feishu.memberBot.upsert', {
        accountId,
        agentId: agent.agentId,
        appId: credential.appId,
        ownerOpenId,
        botOpenId: managed.channel.botIdentity?.openId ?? null,
        botDisplayName: managed.channel.botIdentity?.name || agent.displayName,
        credentialRef
      })
    } catch (error) {
      await this.#disconnectManaged(managed)
      throw error
    }
    await this.#activateManagedChannel(managed)
  }

  async #connectPublishedCredential(
    agent: AgentProfile,
    credentialRef: string,
    credential: FeishuAppCredential
  ): Promise<void> {
    const managed = await this.#connectBot(agent.agentId, credentialRef, credential)
    await this.#activateManagedChannel(managed)
  }

  async #activateManagedChannel(managed: ManagedChannel): Promise<void> {
    const previous = this.#managedChannels.get(managed.appId)
    if (previous) await this.#disconnectManaged(previous)
    this.#managedChannels.set(managed.appId, managed)
  }

  async #startPublishedBot(
    bot: CoreChannelSnapshot['memberBots'][number],
    credential: FeishuAppCredential | null
  ): Promise<void> {
    if (!credential || credential.appId !== bot.appId) throw new Error('published_bot_credential_missing')
    const managed = await this.#connectBot(bot.agentId, bot.credentialRef, credential)
    this.#managedChannels.set(bot.appId, managed)
    // Opt-in synthetic previews reuse this exact connection, never a competing WebSocket.
    void this.#dependencies?.executionPreview?.connected(bot.agentId, bot.appId, managed.channel).catch(() => {
      logFeishuBotDiagnostic('execution_preview.failed', { agentId: bot.agentId })
    })
  }

  async #connectBot(
    agentId: string,
    credentialRef: string,
    credential: FeishuAppCredential,
    timing?: ProvisioningTimingRecorder
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
    managed.unsubscribers.push(channel.on('message', (message) => {
      logFeishuBotDiagnostic('message.normalized', messageDiagnostic(managed, message))
      return this.#handleMessage(managed, message)
    }))
    managed.unsubscribers.push(channel.on('cardAction', (event) => (
      this.#handleCardAction(managed, event)
    )))
    managed.unsubscribers.push(channel.on('reject', (event) => {
      logFeishuBotDiagnostic('message.rejected', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        eventType: 'im.message.receive_v1',
        messageIdDigest: digest(event.messageId),
        chatIdDigest: digest(event.chatId),
        reason: `sdk_policy_${event.reason}`
      })
    }))
    managed.unsubscribers.push(channel.on('botAdded', (event) => this.#handleBotRosterChanged(event)))
    managed.unsubscribers.push(channel.on('botRemoved', (event) => this.#handleBotRosterChanged(event)))
    managed.unsubscribers.push(channel.on('error', (error) => {
      logFeishuBotDiagnostic('ws.error', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        reason: error.code
      })
      this.#publicationFailures.set(agentId, error.code)
      void this.#emit()
    }))
    managed.unsubscribers.push(channel.on('reconnecting', () => {
      logFeishuBotDiagnostic('ws.reconnecting', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId
      })
    }))
    managed.unsubscribers.push(channel.on('reconnected', () => {
      logFeishuBotDiagnostic('ws.reconnected', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId
      })
      this.#publicationFailures.delete(agentId)
      this.#hostPump?.wake()
      void this.#emit()
    }))
    try {
      logFeishuBotDiagnostic('ws.connecting', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId
      })
      const connectionTiming = timing ?? new ProvisioningTimingRecorder({
        agentId,
        appId: credential.appId,
        recovering: true
      })
      await connectionTiming.measure('websocket_handshake_ms', () => channel.connect())
      logFeishuBotDiagnostic('ws.connected', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId
      })
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
    const reject = (reason: string, conversationKind?: string): void => {
      logFeishuBotDiagnostic('message.rejected', {
        ...messageDiagnostic(managed, message),
        ...(conversationKind ? { conversationKind } : {}),
        reason
      })
    }
    if (this.#stopped) {
      reject('host_stopped')
      return
    }
    this.#hostPump?.wake()
    const raw = (message.raw ?? {}) as RawInboundEvent
    const coreSnapshot = await this.#coreSnapshot()
    const tenantKey = raw.sender?.tenant_key || raw.tenant_key
    if (!tenantKey) {
      reject('tenant_key_missing')
      return
    }
    const senderOpenId = raw.sender?.sender_id?.open_id ?? null
    const senderUserId = raw.sender?.sender_id?.user_id ?? null
    const senderUnionId = raw.sender?.sender_id?.union_id ?? null
    const senderExternalUserId = raw.sender?.sender_id?.union_id
      || raw.sender?.sender_id?.user_id
      || raw.sender?.sender_id?.open_id
      || message.senderId
    const owner = await this.#commandWithId(
      'channels.feishu.owner.verify',
      stableCommandId('owner', managed.appId, tenantKey, message.messageId),
      {
        provider: 'feishu',
        appId: managed.appId,
        tenantKey,
        senderOpenId,
        senderUserId,
        senderUnionId,
        senderDisplayName: message.senderName || '飞书成员'
      },
      false
    )
    if (owner.payload.classification !== 'owner') {
      reject(
        owner.payload.classification === 'unverified'
          ? 'owner_identity_unverified'
          : 'non_owner'
      )
      if (message.chatType === 'p2p') {
        await this.#sendDmHint(
          managed,
          message,
          senderExternalUserId,
          owner.payload.classification === 'unverified' ? 'connection' : 'non_owner',
          owner.payload.classification === 'unverified'
            ? '飞书连接异常，请稍后重试。'
            : '该 Bot 当前仅供 Rovai Owner 使用。'
        )
      }
      await this.#emit()
      return
    }
    const conversationKind = await this.#conversationKind(managed.channel, message)
    if (conversationKind === 'group' && message.threadId) {
      reject('message_thread_unsupported', conversationKind)
      return
    }
    if (conversationKind !== 'p2p' && !message.mentionedBot) {
      reject('bot_not_mentioned', conversationKind)
      return
    }
    if (conversationKind !== 'p2p'
      && !await this.#reconcileChatRoster(message.chatId, tenantKey, true, coreSnapshot)) {
      reject('roster_reconciliation_failed', conversationKind)
      return
    }
    const topicKey = conversationKind === 'topic'
      ? (message.rootId || (message.replyToMessageId ? '' : message.messageId))
      : ''
    if (conversationKind === 'topic' && !topicKey) {
      reject('topic_key_missing', conversationKind)
      return
    }
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
    if (mentioned.length === 0) {
      reject('canonical_mention_missing', conversationKind)
      return
    }
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
    const body = canonicalInboundBody(message, expectedBotNames)
    const conversationDisplayName = await this.#conversationDisplayName(
      managed.channel,
      message,
      conversationKind
    )
    if (body === '/new') {
      if (conversationKind !== 'p2p') {
        reject('control_command_dm_only', conversationKind)
        return
      }
      const started = await this.#commandWithId(
        'channels.feishu.dm.startNew',
        stableCommandId('dm-new', managed.appId, tenantKey, message.messageId),
        {
          provider: 'feishu',
          appId: managed.appId,
          tenantKey,
          chatId: message.chatId,
          conversationDisplayName,
          targetAgentId: managed.agentId
        },
        false
      )
      await managed.channel.send(message.chatId, {
        text: started.status === 'rejected'
          ? started.code === 'channel.dm.busy'
            ? '当前回复尚未结束，请等待完成后再发送 /new。'
            : '暂时无法开始新的快速对话，请稍后重试。'
          : '已开始新的快速对话。'
      })
      await this.#emit()
      return
    }
    const quoteMessageId = message.replyToMessageId
      && !(conversationKind === 'topic' && message.replyToMessageId === topicKey)
      ? message.replyToMessageId
      : null
    const quote = quoteMessageId
      ? await this.#readExternalQuote(managed.channel, quoteMessageId)
      : null
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
      senderOpenId,
      senderUserId,
      senderUnionId,
      senderDisplayName: message.senderName || '飞书成员',
      body,
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
    if (observation.status === 'rejected') {
      reject(`core_${safeDiagnosticReason(observation.code)}`, conversationKind)
      return
    }
    this.#hostPump?.wake()
    logFeishuBotDiagnostic('message.accepted', {
      ...messageDiagnostic(managed, message),
      conversationKind
    })
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
      this.#hostPump?.wake()
    }
    await this.#emit()
  }

  async #sendDmHint(
    managed: ManagedChannel,
    message: NormalizedMessage,
    senderExternalUserId: string,
    kind: 'connection' | 'non_owner',
    text: string
  ): Promise<void> {
    const key = `${kind}\0${managed.appId}\0${senderExternalUserId}`
    const lastSentAt = this.#dmHints.get(key)
    if (lastSentAt !== undefined && this.#now() - lastSentAt < NON_OWNER_DM_HINT_THROTTLE_MS) return
    this.#dmHints.set(key, this.#now())
    await managed.channel.send(message.chatId, {
      text
    }).catch((error) => {
      logFeishuBotDiagnostic(`${kind}_hint.failed`, {
        ...messageDiagnostic(managed, message),
        reason: channelFailureCode(error)
      })
    })
  }

  async #handleCardAction(
    managed: ManagedChannel,
    event: CardActionEvent
  ): Promise<FeishuCardActionResponse | void> {
    if (this.#stopped) return
    const preview = await this.#dependencies?.executionPreview?.handleCardAction(managed.appId, event)
    if (preview) return preview
    const executionAction = executionConsoleCardAction(event.action.value)
    if (executionAction) {
      return this.#handleExecutionConsoleCardAction(managed, event, executionAction)
    }
    const projectAction = projectCardAction(
      event.action.value,
      event.action.tag === 'select_static' ? event.action.option : undefined
    )
    if (!projectAction) {
      logFeishuBotDiagnostic('card.rejected', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        reason: 'invalid_card_action'
      })
      return
    }
    this.#hostPump?.wake()
    const raw = (event.raw ?? {}) as RawCardActionEvent
    let result: StoredCommandResult
    try {
      if ((projectAction.action === 'bind' || projectAction.action === 'quick_chat')
        && !await this.#reconcileCardActionRoster(event.chatId)) {
        logFeishuBotDiagnostic('card.resolve_failed', {
          appIdDigest: digest(managed.appId),
          agentId: managed.agentId,
          reason: 'roster_reconciliation_failed'
        })
        return { toast: { type: 'error', content: '群内 Bot 状态读取失败，请重试' } }
      }
      result = await this.#commandWithId(
        'channels.feishu.pendingBinding.resolve',
        randomUUID(),
        {
          pendingBindingId: projectAction.pendingBindingId,
          appId: managed.appId,
          externalPickerMessageId: event.messageId,
          expectedVersion: projectAction.expectedVersion,
          nonce: projectAction.nonce,
          action: projectAction.action,
          projectId: projectAction.projectId,
          operatorOpenId: raw.operator?.open_id ?? event.operator.openId ?? null,
          operatorUserId: raw.operator?.user_id ?? event.operator.userId ?? null,
          operatorUnionId: raw.operator?.union_id ?? null
        },
        false
      )
    } catch (error) {
      logFeishuBotDiagnostic('card.resolve_failed', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        reason: channelFailureCode(error)
      })
      return { toast: { type: 'error', content: '创建失败，请重试' } }
    }
    if (result.code === 'channel.binding.owner_required') {
      logFeishuBotDiagnostic('card.rejected', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        reason: 'owner_required'
      })
    }
    if (result.status !== 'rejected' || result.payload.pickerRefreshQueued === true) {
      this.#hostPump?.wake()
    }
    void this.#emit().catch((error) => {
      logFeishuBotDiagnostic('card.snapshot_failed', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        reason: channelFailureCode(error)
      })
    })
    return projectCardActionResponse(result)
  }

  async #handleExecutionConsoleCardAction(
    managed: ManagedChannel,
    event: CardActionEvent,
    action: ExecutionConsoleCardAction
  ): Promise<FeishuCardActionResponse> {
    const raw = (event.raw ?? {}) as RawCardActionEvent
    try {
      return await this.#enqueueExecutionCard(action.agentRunId, () => withFeishuPageDeadline(
        async (checkDeadline) => {
          let state = this.#executionCardStates.get(action.agentRunId)
          if (state && (state.targetAppId !== managed.appId
            || state.externalMessageId !== event.messageId)) {
            return executionConsoleCardActionResponse('stale')
          }
          const operator = {
            operatorOpenId: raw.operator?.open_id ?? event.operator.openId ?? null,
            operatorUserId: raw.operator?.user_id ?? event.operator.userId ?? null,
            operatorUnionId: raw.operator?.union_id ?? null
          }
          if (action.action === 'execution_stop') {
            this.#hostPump?.wake()
            if (!raw.event_id) return executionConsoleCardActionResponse('stale')
            const result = await this.#commandWithId(
              'channels.executionConsole.agentRun.cancel',
              stableCommandId('execution-stop', managed.appId, raw.event_id),
              {
                callbackEventId: raw.event_id,
                appId: managed.appId,
                externalMessageId: event.messageId,
                agentRunId: action.agentRunId,
                ...operator
              },
              false
            )
            checkDeadline()
            if (result.status === 'rejected') return executionConsoleCardActionResponse(result.code)
            this.#hostPump?.wake()
            const terminalStatus = executionTerminalStatus(result.payload.status)
            if (!state || !terminalStatus) {
              return { toast: { type: 'success', content: '停止请求已处理' } }
            }
            const source: ExecutionConsoleSource = {
              ...state.latestSource,
              run: {
                ...state.latestSource.run,
                status: terminalStatus,
                waitReason: null
              },
              state: 'terminal_pending'
            }
            state.latestSource = source
            const card = feishuExecutionStateCard(source, state)
            state.lastCardDigest = digest(JSON.stringify(card))
            return {
              ...feishuPageCardResponse(card),
              toast: {
                type: 'success',
                content: terminalStatus === 'cancelled' ? '已取消执行' : '执行已结束'
              }
            }
          }
          const result = await this.#commandWithId(
            'channels.executionConsole.recentOutput.authorize',
            randomUUID(),
            {
              agentRunId: action.agentRunId,
              appId: managed.appId,
              externalMessageId: event.messageId,
              ...operator
            },
            false
          )
          checkDeadline()
          if (result.status === 'rejected') return executionConsoleCardActionResponse(result.code)
          const sequence = result.payload.snapshotSequence
          if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) {
            return executionConsoleCardActionResponse('stale')
          }
          const current = await this.#dependencies!.core.request<ExecutionConsoleSource | null>(
            'channels.executionConsole.source',
            { agentRunId: action.agentRunId, expectedSequence: sequence }
          )
          checkDeadline()
          if (!current || current.targetAppId !== managed.appId
            || current.externalMessageId !== event.messageId) {
            return executionConsoleCardActionResponse('stale')
          }
          state ??= {
            agentRunId: current.agentRunId,
            targetAppId: current.targetAppId,
            externalMessageId: current.externalMessageId,
            executionViewUrl: null,
            recentOutputVisible: false,
            latestSource: current,
            lastCardDigest: null
          }
          this.#executionCardStates.set(action.agentRunId, state)
          state.latestSource = current
          state.recentOutputVisible = action.visible
          const card = feishuExecutionStateCard(current, state)
          state.lastCardDigest = digest(JSON.stringify(card))
          checkDeadline()
          return feishuPageCardResponse(card)
        }
      ))
    } catch (error) {
      const { response, reason, providerCode } = feishuPageFailure(error)
      logFeishuBotDiagnostic('execution_console.card_response_failed', {
        appIdDigest: digest(managed.appId),
        agentId: managed.agentId,
        messageIdDigest: digest(event.messageId),
        reason,
        ...(providerCode === undefined ? {} : { providerCode: String(providerCode) })
      })
      return response
    }
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
    void managed
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

  async #handleBotRosterChanged(event: BotAddedEvent): Promise<void> {
    if (this.#stopped) return
    this.#hostPump?.wake()
    const snapshot = await this.#coreSnapshot().catch(() => null)
    if (!snapshot) return
    const tenantKeys = new Set(
      snapshot.transportConversations
        .filter((conversation) => conversation.chatId === event.chatId)
        .map((conversation) => conversation.tenantKey)
    )
    if (tenantKeys.size === 0 && snapshot.account?.tenantId) {
      tenantKeys.add(snapshot.account.tenantId)
    }
    await Promise.allSettled(
      [...tenantKeys].map((tenantKey) => this.#reconcileChatRoster(
        event.chatId,
        tenantKey,
        true,
        snapshot
      ))
    )
    this.#hostPump?.wake()
  }

  async #reconcileCardActionRoster(chatId: string): Promise<boolean> {
    const snapshot = await this.#coreSnapshot().catch(() => null)
    if (!snapshot) return false
    const tenantKeys = new Set(
      snapshot.transportConversations
        .filter((conversation) => conversation.chatId === chatId)
        .map((conversation) => conversation.tenantKey)
    )
    if (tenantKeys.size === 0 && snapshot.account?.tenantId) {
      tenantKeys.add(snapshot.account.tenantId)
    }
    if (tenantKeys.size === 0) return false
    const outcomes = await Promise.all(
      [...tenantKeys].map((tenantKey) => this.#reconcileChatRoster(
        chatId,
        tenantKey,
        true,
        snapshot
      ))
    )
    return outcomes.every(Boolean)
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
        body: await externalMessageBody(item.msg_type, item.body?.content, {
          messageId: item.message_id || messageId,
          botIdentity: channel.botIdentity,
          mentions: item.mentions
        }),
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

  async #conversationDisplayName(
    channel: LarkChannel,
    message: NormalizedMessage,
    conversationKind: 'p2p' | 'group' | 'topic'
  ): Promise<string> {
    if (message.chatType === 'p2p') return message.senderName || '飞书私聊'
    let name = this.#chatNameCache.get(message.chatId)
    if (!name) {
      name = (await channel.getChatInfo(message.chatId).catch(() => null))?.name || '飞书群聊'
      this.#chatNameCache.set(message.chatId, name)
    }
    return conversationKind === 'topic' ? `${name} · 话题` : name
  }

  async #pumpOnce(): Promise<boolean> {
    if (!this.#dependencies || this.#stopped) return false
    if (this.#now() >= this.#nextAggregateRecoveryAt) {
      this.#nextAggregateRecoveryAt = this.#now() + 2_000
      await this.#recoverPendingAggregates()
    }
    if (this.#now() >= this.#nextRosterSweepAt) {
      this.#nextRosterSweepAt = this.#now() + ROSTER_SWEEP_MS
      await this.#reconcileKnownGroupRosters()
    }
    const tick = await this.#dependencies.core.request<{
      deliveries: ClaimedChannelDelivery[]
      rosterRefreshes: TopicRosterRefreshRequest[]
      hasOutstandingWork: boolean
    }>('channels.host.tick', {
      workerId: HOST_WORKER_ID,
      limit: 20
    })
    const rosterRefreshes = Array.isArray(tick.rosterRefreshes)
      ? tick.rosterRefreshes
      : []
    const rosterResults = await Promise.allSettled(rosterRefreshes.map((refresh) => {
      if (refresh.provider !== 'feishu'
        || !refresh.tenantKey
        || !refresh.chatId
        || !Number.isSafeInteger(refresh.requiredRosterGeneration)) {
        return Promise.resolve(false)
      }
      return this.#reconcileChatRoster(refresh.chatId, refresh.tenantKey, true)
    }))
    if (rosterResults.some((result) => result.status === 'fulfilled' && result.value)) {
      this.#hostPump?.wake()
    }
    const deliveries = Array.isArray(tick.deliveries)
      ? tick.deliveries
      : []
    for (const delivery of deliveries) await this.#deliver(delivery)
    return tick.hasOutstandingWork === true
      || rosterRefreshes.length > 0
      || deliveries.length > 0
  }

  async #deliver(delivery: ClaimedChannelDelivery): Promise<void> {
    if (delivery.deliveryKind === 'execution_console_upsert') {
      const agentRunId = requiredPayloadString(delivery.payload, 'agentRunId')
      return this.#enqueueExecutionCard(agentRunId, () => this.#deliverNow(delivery, agentRunId))
    }
    if (delivery.deliveryKind === 'execution_console_recall') {
      const state = this.#executionCardStateForMessage(delivery.targetAppId, delivery.updateMessageId)
      const queueKey = state?.agentRunId
        ?? `recall:${delivery.targetAppId}:${delivery.updateMessageId ?? delivery.deliveryId}`
      return this.#enqueueExecutionCard(queueKey, () => this.#deliverNow(
        delivery,
        state?.agentRunId ?? null
      ))
    }
    return this.#deliverNow(delivery, null)
  }

  async #deliverNow(delivery: ClaimedChannelDelivery, executionAgentRunId: string | null): Promise<void> {
    const managed = this.#managedChannels.get(delivery.targetAppId)
    if (!managed || managed.credentialRef !== delivery.credentialRef) {
      await this.#settleDelivery(delivery, null, new Error('target_bot_not_connected'))
      return
    }
    try {
      let messageId: string | null = null
      const replyOptions = delivery.topicKey
        ? { replyTo: delivery.topicKey, replyInThread: true }
        : undefined
      if (delivery.deliveryKind === 'project_selection') {
        const operation = projectSelectionOperation(delivery.payload)
        if (delivery.payload.placement !== 'conversation') {
          throw new Error('legacy_private_project_picker_retired')
        }
        if (operation === 'recall') {
          messageId = delivery.updateMessageId ?? null
          if (!messageId) throw new Error('project_picker_message_missing')
          await managed.channel.recallMessage(messageId)
        } else if (operation === 'update') {
          messageId = delivery.updateMessageId ?? null
          if (messageId) {
            try {
              await managed.channel.updateCard(messageId, deliveryCard(delivery))
            } catch (error) {
              if (!isRecallTargetRevoked(error)) throw error
              const sent = await managed.channel.send(
                delivery.chatId,
                { card: deliveryCard(delivery) },
                replyOptions
              )
              messageId = sent.messageId
            }
          } else {
            const sent = await managed.channel.send(
              delivery.chatId,
              { card: deliveryCard(delivery) },
              replyOptions
            )
            messageId = sent.messageId
          }
        } else {
          const sent = await managed.channel.send(
            delivery.chatId,
            { card: deliveryCard(delivery) },
            replyOptions
          )
          messageId = sent.messageId
        }
      } else if (delivery.deliveryKind === 'queue_ack'
        && delivery.payload.action === 'recall') {
        messageId = delivery.updateMessageId ?? null
        if (messageId) await managed.channel.recallMessage(messageId)
      } else if (delivery.deliveryKind === 'execution_console_recall') {
        messageId = delivery.updateMessageId ?? null
        if (messageId) await managed.channel.recallMessage(messageId)
        if (executionAgentRunId) {
          const state = this.#executionCardStates.get(executionAgentRunId)
          this.#dependencies?.executionView?.revokeExecutionViewUrl(state?.executionViewUrl ?? null)
          this.#executionCardStates.delete(executionAgentRunId)
        }
      } else if (delivery.deliveryKind === 'execution_console_upsert') {
        const source = await this.#dependencies!.core.request<ExecutionConsoleSource | null>(
          'channels.executionConsole.source',
          {
            agentRunId: requiredPayloadString(delivery.payload, 'agentRunId'),
            expectedSequence: requiredPayloadNumber(delivery.payload, 'expectedSequence')
          }
        )
        if (source) {
          if (source.targetAppId !== delivery.targetAppId) {
            throw new Error('execution_console_target_app_mismatch')
          }
          messageId = delivery.updateMessageId ?? null
          let state = this.#executionCardStates.get(source.agentRunId)
          if (!state) {
            state = {
              agentRunId: source.agentRunId,
              targetAppId: source.targetAppId,
              externalMessageId: messageId,
              executionViewUrl: messageId ? null : await this.#dependencies?.executionView
                ?.createExecutionViewUrl({
                  channelConversationId: source.channelConversationId,
                  targetAppId: source.targetAppId,
                  campId: source.campId,
                  agentId: source.agentId,
                  focusRunId: source.agentRunId,
                  maxRunCreatedAt: source.runCreatedAt
                }) ?? null,
              recentOutputVisible: false,
              latestSource: source,
              lastCardDigest: null
            }
            this.#executionCardStates.set(source.agentRunId, state)
          }
          state.latestSource = source
          const card = feishuExecutionStateCard(source, state)
          const cardDigest = digest(JSON.stringify(card))
          if (messageId) {
            if (state.lastCardDigest !== cardDigest) {
              await managed.channel.updateCard(messageId, card)
            }
          } else {
            const sent = await managed.channel.send(delivery.chatId, { card }, replyOptions)
            messageId = sent.messageId
          }
          state.externalMessageId = messageId
          state.lastCardDigest = cardDigest
        } else {
          messageId = delivery.updateMessageId ?? null
        }
      } else if (delivery.deliveryKind === 'agent_output') {
        messageId = await sendFeishuAgentOutput(managed.channel.rawClient.im.v1.message, {
          deliveryId: delivery.deliveryId,
          chatId: delivery.chatId,
          topicKey: delivery.topicKey,
          payload: delivery.payload,
          ownerOpenId: delivery.recipientOpenId
        })
      } else if (delivery.deliveryKind === 'agent_attachment') {
        const campId = requiredPayloadString(delivery.payload, 'campId')
        const attachmentId = requiredPayloadString(delivery.payload, 'attachmentId')
        const target = await this.#dependencies!.core.request<DesktopAttachmentTarget | null>(
          'camp.attachments.desktopOpenTarget',
          { campId, attachmentId }
        )
        if (!target || target.kind !== 'file' || target.attachmentId !== attachmentId) {
          throw new Error('channel_attachment_unavailable')
        }
        const bytes = await readFile(target.path)
        verifyAttachmentBytes(delivery.payload, bytes)
        const sent = delivery.payload.attachmentKind === 'image'
          ? await managed.channel.send(delivery.chatId, { image: { source: bytes } }, replyOptions)
          : await managed.channel.send(delivery.chatId, {
              file: {
                source: bytes,
                fileName: requiredPayloadString(delivery.payload, 'fileName')
              }
            }, replyOptions)
        messageId = sent.messageId
      } else {
        const sent = await managed.channel.send(
          delivery.chatId,
          { card: deliveryCard(delivery) },
          replyOptions
        )
        messageId = sent.messageId
      }
      await this.#settleDelivery(delivery, messageId, null)
    } catch (error) {
      if (
        (delivery.deliveryKind === 'execution_console_recall'
          || (delivery.deliveryKind === 'project_selection'
            && projectSelectionOperation(delivery.payload) === 'recall')
          || (delivery.deliveryKind === 'queue_ack' && delivery.payload.action === 'recall'))
        && isRecallTargetRevoked(error)
      ) {
        if (delivery.deliveryKind === 'execution_console_recall' && executionAgentRunId) {
          const state = this.#executionCardStates.get(executionAgentRunId)
          this.#dependencies?.executionView?.revokeExecutionViewUrl(state?.executionViewUrl ?? null)
          this.#executionCardStates.delete(executionAgentRunId)
        }
        await this.#settleDelivery(delivery, delivery.updateMessageId ?? null, null)
        return
      }
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
      ? ['rate_limited', 'send_timeout', 'not_connected', 'unknown', 'upload_failed'].includes(error.code)
      : ['target_bot_not_connected', 'send_timeout', 'upload_failed'].includes(failureCode ?? '')
    const result = await this.#commandWithId('channels.deliveries.settle', randomUUID(), {
      deliveryId: delivery.deliveryId,
      workerId: HOST_WORKER_ID,
      outcome: error ? 'failed' : 'sent',
      externalDeliveryMessageId: messageId,
      failureCode,
      retryable
    })
    this.#hostPump?.wake()
    const availableAt = result.payload.availableAt
    if (typeof availableAt === 'string') this.#hostPump?.wakeAt(availableAt)
  }

  async #coreSnapshot(): Promise<CoreChannelSnapshot> {
    const snapshot = await this.#dependencies!.core.request<CoreChannelSnapshot>(
      'channels.feishu.snapshot'
    )
    if (snapshot.schemaVersion !== 2) throw new Error('Unsupported Core channel snapshot')
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
        managementUrl: memberBotManagementUrl(bot.brand, bot.appId),
        failureCode: this.#publicationFailures.get(bot.agentId) ?? bot.failureCode
      })
    }
    for (const intent of snapshot.publicationIntents) {
      if (
        bots.has(intent.agentId)
        || !['failed_recoverable', 'failed_unknown_remote_state'].includes(intent.state)
      ) continue
      const brand = snapshot.account?.accountId === intent.accountId
        ? snapshot.account.brand
        : null
      bots.set(intent.agentId, {
        agentId: intent.agentId,
        publicationStatus: 'failed',
        botDisplayName: intent.requestedAppName,
        appId: intent.remoteAppId,
        managementUrl: brand && intent.remoteAppId
          ? memberBotManagementUrl(brand, intent.remoteAppId)
          : null,
        failureCode: this.#publicationFailures.get(intent.agentId) ?? intent.failureCode
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
        managementUrl: existing?.managementUrl ?? null,
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
        managementUrl: bot?.managementUrl ?? null,
        failureCode
      })
    }
    return {
      schemaVersion: 4,
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
        memberBots: [...bots.values()].sort((left, right) => left.agentId.localeCompare(right.agentId)),
        pendingBindingCount: snapshot.pendingBindingCount,
        bindingIssueCount: snapshot.bindingIssueCount
      }],
      pendingBindingCount: snapshot.pendingBindingCount,
      bindingIssueCount: snapshot.bindingIssueCount,
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

  #enqueueExecutionCard<T>(agentRunId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#executionCardTails.get(agentRunId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.#executionCardTails.set(agentRunId, tail)
    void tail.finally(() => {
      if (this.#executionCardTails.get(agentRunId) === tail) {
        this.#executionCardTails.delete(agentRunId)
      }
    })
    return result
  }

  #executionCardStateForMessage(
    targetAppId: string,
    externalMessageId: string | null | undefined
  ): ExecutionCardPresentationState | null {
    if (!externalMessageId) return null
    return [...this.#executionCardStates.values()].find((state) => (
      state.targetAppId === targetAppId && state.externalMessageId === externalMessageId
    )) ?? null
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
    schemaVersion: 4,
    channels: [{
      kind: 'feishu',
      displayName: '飞书',
      hostStatus: 'unavailable',
      connection: { status: 'not_connected', account: null },
      memberBots: [],
      pendingBindingCount: 0,
      bindingIssueCount: 0
    }],
    pendingBindingCount: 0,
    bindingIssueCount: 0,
    activeQrAttempt: null,
    activeProvisioning: null
  }
}

function memberBotManagementUrl(brand: 'feishu' | 'lark', appId: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(appId)) return null
  const origin = brand === 'lark'
    ? 'https://open.larksuite.com'
    : 'https://open.feishu.cn'
  return `${origin}/app/${encodeURIComponent(appId)}/baseinfo`
}

function memberCredentialRef(agentId: string): string {
  return `feishu-member-${createHash('sha256').update(agentId).digest('hex').slice(0, 32)}`
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function messageDiagnostic(
  managed: Pick<ManagedChannel, 'agentId' | 'appId'>,
  message: Pick<NormalizedMessage, 'messageId' | 'chatId'>
): Record<string, string> {
  return {
    appIdDigest: digest(managed.appId),
    agentId: managed.agentId,
    eventType: 'im.message.receive_v1',
    messageIdDigest: digest(message.messageId),
    chatIdDigest: digest(message.chatId)
  }
}

function safeDiagnosticReason(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 96) || 'unknown'
}

function logFeishuBotDiagnostic(
  stage: string,
  fields: Readonly<Record<string, string>>
): void {
  console.info(`[feishu.bot.${stage}] ${JSON.stringify(fields)}`)
}

function userIdDigest(userId: string): `sha256:${string}` {
  return digest(`feishu-user\0${userId}`)
}

function accountIdForIdentity(identity: FeishuDeveloperIdentity): `sha256:${string}` {
  return digest(`${identity.brand}\0${identity.tenantId}\0${identity.userId}`)
}

function feishuConnectionAccount(identity: FeishuDeveloperIdentity): {
  accountId: `sha256:${string}`
  userIdDigest: `sha256:${string}`
  tenantId: string
  userName: string
  email: string | null
  tenantName: string
  brand: 'feishu' | 'lark'
} {
  return {
    accountId: accountIdForIdentity(identity),
    userIdDigest: userIdDigest(identity.userId),
    tenantId: identity.tenantId,
    userName: identity.userName,
    email: identity.email ?? null,
    tenantName: identity.tenantName,
    brand: identity.brand
  }
}

function sessionRevisionFrom(result: StoredCommandResult): number {
  const payload = result.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('channel_developer_session_response_invalid')
  }
  const revision = (payload as Record<string, unknown>).sessionRevision
  if (!Number.isSafeInteger(revision) || Number(revision) < 1) {
    throw new Error('channel_developer_session_response_invalid')
  }
  return Number(revision)
}

function pendingFeishuConnection(
  service: FeishuDeveloperSessionService
): ReturnType<NonNullable<FeishuDeveloperSessionService['pendingConnection']>> {
  if (!service.pendingConnection) throw new Error('feishu_login_pending_session_missing')
  return service.pendingConnection()
}

async function activatePendingFeishuLogin(
  service: FeishuDeveloperSessionService,
  revision: number
): Promise<void> {
  if (!service.activatePendingLogin) throw new Error('feishu_login_pending_session_missing')
  await service.activatePendingLogin(revision)
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

function recoverableProvisioningDetail(failureCode: string, hasRemoteApp: boolean): string {
  if (!hasRemoteApp) {
    return failureCode === 'feishu_connection_error'
      ? '飞书连接异常；尚未创建队员应用，可以稍后重试。'
      : '发布尚未完成；排除问题后可以安全重试。'
  }
  if ([
    'feishu_console_event_verification_failed',
    'feishu_console_scope_update_verification_failed',
    'feishu_console_scope_verification_failed',
    'feishu_console_callback_verification_failed'
  ].includes(failureCode)) {
    return '飞书在线配置在本次等待窗口内仍未确认生效；原应用已保留，可以稍后继续核对。'
  }
  if (failureCode === 'feishu_connection_error') {
    return '飞书连接异常；原应用已保留，可以安全重试核对，不会创建第二个应用。'
  }
  return '已保留这名队员的原应用；可以安全重试核对和恢复，不会创建第二个应用。'
}

function channelFailureDetail(error: unknown): string {
  const code = channelFailureCode(error)
  const details: Record<string, string> = {
    feishu_developer_identity_incomplete:
      '已登录飞书，但未能读取完整的账号与企业信息。请关闭后重试。',
    feishu_login_failed: '无法打开飞书登录页面，请检查网络后重试。',
    feishu_login_expired: '飞书登录已超时，请关闭后重试。',
    feishu_developer_session_expired: '飞书开发者会话已过期，请重新登录。',
    feishu_developer_identity_changed: '飞书账号或企业身份已变化，请重新连接。',
    feishu_connection_error: '飞书连接异常，请稍后重试。',
    feishu_console_event_verification_failed:
      '飞书事件与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_scope_update_verification_failed:
      '飞书消息权限尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_scope_verification_failed:
      '飞书消息权限尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_callback_verification_failed:
      '飞书回调与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。',
    feishu_console_version_not_published:
      '飞书应用版本尚未确认发布；原应用已保留，可以稍后继续核对。',
    feishu_console_remote_app_unavailable:
      '原飞书应用已删除或当前账号无权访问，无法按原 App ID 重试。'
  }
  if (details[code]) return details[code]
  return code === 'unknown'
    ? '飞书操作失败，请关闭后重试。'
    : `飞书操作失败（${code}），请关闭后重试。`
}

function canonicalInboundBody(
  message: NormalizedMessage,
  expectedBotNames: ReadonlySet<string>
): string {
  let body = message.content
  for (const mention of message.mentions) {
    if (mention.isBot || !mention.name || !expectedBotNames.has(mention.name)) continue
    const token = `@${mention.name}`
    const index = body.indexOf(token)
    if (index >= 0) body = `${body.slice(0, index)}${body.slice(index + token.length)}`
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

function requiredPayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`channel_delivery_${key}_invalid`)
  }
  return value
}

function requiredPayloadNumber(payload: Record<string, unknown>, key: string): number {
  const value = payload[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`channel_delivery_${key}_invalid`)
  }
  return value
}

function validOpenId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/u.test(value)
}

function verifyAttachmentBytes(payload: Record<string, unknown>, bytes: Buffer): void {
  const expectedSize = requiredPayloadNumber(payload, 'size')
  const expectedDigest = requiredPayloadString(payload, 'contentDigest')
  const actualDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (bytes.byteLength !== expectedSize || actualDigest !== expectedDigest) {
    throw new Error('channel_attachment_integrity_mismatch')
  }
}

function isRecallTargetRevoked(error: unknown): boolean {
  if (error instanceof LarkChannelError) return error.code === 'target_revoked'
  if (!isRecord(error)) return false
  const response = isRecord(error.response) ? error.response : null
  const responseData = response && isRecord(response.data) ? response.data : null
  const directData = isRecord(error.data) ? error.data : null
  const status = response?.status ?? error.status
  const code = responseData?.code ?? directData?.code ?? error.code
  return status === 404 || code === 230020 || code === 230017
}

function arrayPayload(result: StoredCommandResult, key: string): string[] {
  const value = result.payload[key]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Core omitted ${key}`)
  }
  return value
}

type ExternalMessageNormalization = {
  messageId: string
  botIdentity?: BotIdentity
  mentions?: Array<{
    key?: string
    id?: string | { open_id?: string; user_id?: string; union_id?: string }
    id_type?: string
    name?: string
    tenant_key?: string
  }>
}

async function externalMessageBody(
  messageType: string | undefined,
  encoded: string | undefined,
  normalization: ExternalMessageNormalization
): Promise<string> {
  if (!encoded) return '[引用消息无可读文本]'
  if (messageType === 'text' || messageType === 'post') {
    const mentions = (normalization.mentions ?? []).flatMap((mention) => {
      if (!mention.key || !mention.id) return []
      const id = typeof mention.id === 'string'
        ? mention.id_type === 'user_id'
          ? { user_id: mention.id }
          : mention.id_type === 'union_id'
            ? { union_id: mention.id }
            : { open_id: mention.id }
        : mention.id
      return [{
        key: mention.key,
        id,
        name: mention.name,
        tenant_key: mention.tenant_key
      }]
    })
    const event: RawMessageEvent = {
      sender: { sender_id: {} },
      message: {
        message_id: normalization.messageId,
        chat_id: 'external_quote',
        chat_type: 'p2p',
        message_type: messageType,
        content: encoded,
        mentions
      }
    }
    const normalized = await normalize(event, {
      botIdentity: normalization.botIdentity ?? {
        openId: 'external_quote',
        name: 'Rovai'
      },
      stripBotMentions: false
    })
    return normalized.content || (messageType === 'post' ? '[富文本消息]' : '[引用消息无可读文本]')
  }
  try {
    JSON.parse(encoded)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ProjectCardAction = {
  pendingBindingId: string
  expectedVersion: number
  nonce: string
  action: 'bind' | 'quick_chat' | 'cancel' | 'refresh'
  projectId: string | null
}

type ExecutionConsoleCardActionName = 'execution_recent_output' | 'execution_stop'

type ExecutionConsoleCardAction =
  | { action: 'execution_recent_output'; agentRunId: string; visible: boolean }
  | { action: 'execution_stop'; agentRunId: string }

type ProjectCardOption = {
  projectId: string
  displayName: string
}

type ProjectSelectionOperation = 'send' | 'update' | 'recall'

function projectCardActionResponse(result: StoredCommandResult): FeishuCardActionResponse {
  if (result.code === 'channel.binding.owner_required') {
    return { toast: { type: 'warning', content: '仅 Rovai Owner 可以选择项目' } }
  }
  if (result.code === 'channel.project_unavailable') {
    return { toast: { type: 'warning', content: '该项目已不可用，请重新选择' } }
  }
  if (result.code === 'channel.binding.refreshed') {
    return { toast: { type: 'info', content: '项目列表已更新' } }
  }
  if (result.code === 'channel.binding.cancelled') {
    return { toast: { type: 'info', content: '已取消项目选择' } }
  }
  if (result.code === 'channel.binding.resolved') {
    return { toast: {
      type: 'success',
      content: result.payload.executionScopeKind === 'quick_chat'
        ? '已开始快速对话，正在处理消息'
        : '项目已绑定，正在处理消息'
    } }
  }
  if (result.code === 'channel.binding.expired'
    || result.code === 'channel.binding.not_found'
    || result.code === 'channel.binding.stale_card'
    || result.code === 'channel.binding.invalid_nonce'
    || result.code === 'channel.binding.callback_app_mismatch'
    || result.code === 'channel.binding.already_resolved') {
    return { toast: { type: 'info', content: '该项目选择已完成或卡片已过期' } }
  }
  return { toast: { type: 'error', content: '创建失败，请重试' } }
}

function executionConsoleCardActionResponse(
  result: string | ExecutionConsoleCardActionName
): FeishuCardActionResponse {
  if (result === 'channel.execution_console.owner_required') {
    return { toast: { type: 'warning', content: '无权限' } }
  }
  if (result === 'stale'
    || result === 'channel.execution_console.not_found'
    || result === 'channel.execution_console.stale_card'
    || result === 'channel.execution_console.callback_app_mismatch') {
    return { toast: { type: 'info', content: '执行记录状态已更新，请重新操作' } }
  }
  return { toast: { type: 'error', content: '执行记录更新失败，请重试' } }
}

function executionTerminalStatus(
  value: unknown
): 'succeeded' | 'failed' | 'cancelled' | null {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled'
    ? value
    : null
}

function projectSelectionOperation(payload: Record<string, unknown>): ProjectSelectionOperation {
  return payload.operation === 'update'
    ? 'update'
    : payload.operation === 'recall'
      ? 'recall'
      : 'send'
}

function projectCardAction(value: unknown, selectedOption?: string): ProjectCardAction | null {
  if (!isRecord(value)) return null
  const action = value.rovaiAction === 'bind_project'
    ? 'bind'
    : value.rovaiAction === 'start_quick_chat'
      ? 'quick_chat'
      : value.rovaiAction === 'cancel_binding'
        ? 'cancel'
        : value.rovaiAction === 'refresh_projects'
          ? 'refresh'
          : null
  if (!action
    || typeof value.pendingBindingId !== 'string'
    || typeof value.nonce !== 'string'
    || typeof value.expectedVersion !== 'number'
    || !Number.isSafeInteger(value.expectedVersion)
    || value.expectedVersion < 1) return null
  const projectId = typeof selectedOption === 'string' && selectedOption.trim().length > 0
    ? selectedOption
    : typeof value.projectId === 'string'
      ? value.projectId
      : null
  if (action === 'bind' && !projectId) return null
  if (action === 'quick_chat' && projectId !== null) return null
  return {
    pendingBindingId: value.pendingBindingId,
    expectedVersion: value.expectedVersion,
    nonce: value.nonce,
    action,
    projectId
  }
}

function executionConsoleCardAction(value: unknown): ExecutionConsoleCardAction | null {
  if (!isRecord(value)) return null
  if (typeof value.agentRunId !== 'string' || value.agentRunId.trim().length === 0) return null
  if (value.action === 'execution_recent_output' && typeof value.visible === 'boolean') {
    return { action: value.action, agentRunId: value.agentRunId, visible: value.visible }
  }
  if (value.action === 'execution_stop') {
    return { action: value.action, agentRunId: value.agentRunId }
  }
  return null
}

function projectCardOptions(value: unknown): ProjectCardOption[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item)
      || typeof item.projectId !== 'string'
      || typeof item.displayName !== 'string') return []
    return [{ projectId: item.projectId, displayName: item.displayName }]
  })
}

function projectSelectionCard(input: {
  pendingBindingId: string
  conversationKind: 'group' | 'topic'
  expectedVersion: number
  nonce: string
  projectOptions: ProjectCardOption[]
  notice?: 'project_unavailable' | 'moved_to_conversation'
}): Record<string, unknown> {
  const actionValue = (rovaiAction: string, projectId?: string): Record<string, unknown> => ({
    rovaiAction,
    pendingBindingId: input.pendingBindingId,
    expectedVersion: input.expectedVersion,
    nonce: input.nonce,
    ...(projectId ? { projectId } : {})
  })
  const projectSelector = input.projectOptions.length > 0
    ? {
        tag: 'select_static',
        type: 'default',
        width: 'fill',
        placeholder: { tag: 'plain_text', content: '选择项目' },
        options: input.projectOptions.map((project) => ({
          text: {
            tag: 'plain_text',
            content: boundedPlainText(project.displayName, 48)
          },
          value: project.projectId
        })),
        behaviors: [{
          type: 'callback',
          value: actionValue('bind_project')
        }]
      }
    : null
  const scope = input.conversationKind === 'topic' ? '话题' : '群聊'
  const scopeCopy = [
    '选择一个项目，或直接开始快速对话。',
    `选择项目后，这个${scope}之后都会使用该项目；快速对话不绑定项目。`
  ]
  const notice = input.notice === 'project_unavailable'
    ? '刚才选择的项目已不可用，项目列表已经更新。'
    : input.notice === 'moved_to_conversation'
      ? '项目选择已移至当前会话，请在这里继续。'
      : null
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '选择 Rovai 项目' },
      template: input.notice ? 'orange' : 'blue'
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: [
            notice,
            ...scopeCopy,
            input.projectOptions.length === 0
              ? '当前没有可用项目。可以直接开始快速对话，或在 Rovai 创建或打开一个项目后刷新。'
              : null
          ].filter(Boolean).join('\n\n')
        },
        ...(projectSelector ? [projectSelector] : []),
        {
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
              behaviors: [{ type: 'callback', value: actionValue(button.action) }]
            }]
          }))
        }
      ]
    }
  }
}

function boundedPlainText(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim())
  return characters.length <= maxCharacters
    ? characters.join('')
    : `${characters.slice(0, maxCharacters - 1).join('')}…`
}

function deliveryCard(delivery: ClaimedChannelDelivery): Record<string, unknown> {
  if (delivery.deliveryKind === 'project_selection') {
    const conversationKind = delivery.payload.conversationKind === 'topic' ? 'topic' : 'group'
    const notice = delivery.payload.notice === 'project_unavailable'
      || delivery.payload.notice === 'moved_to_conversation'
        ? delivery.payload.notice
        : undefined
    return projectSelectionCard({
      pendingBindingId: String(delivery.payload.pendingBindingId ?? ''),
      conversationKind,
      expectedVersion: Number(delivery.payload.expectedVersion ?? 1),
      nonce: String(delivery.payload.nonce ?? ''),
      projectOptions: projectCardOptions(delivery.payload.projectOptions),
      ...(notice ? { notice } : {})
    })
  }
  const text = typeof delivery.payload.text === 'string' ? delivery.payload.text : ''
  if (!['queue_ack', 'attention'].includes(delivery.deliveryKind)) {
    throw new Error('channel_delivery_card_kind_invalid')
  }
  const title = delivery.deliveryKind === 'attention'
    ? 'Rovai 需要你确认'
    : 'Rovai 已接收'
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template: delivery.deliveryKind === 'attention'
          ? 'orange'
          : 'blue'
    },
    body: {
      elements: [{ tag: 'markdown', content: text || '状态已更新' }]
    }
  }
}
