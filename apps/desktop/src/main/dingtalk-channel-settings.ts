import { createHash, randomUUID } from 'node:crypto'
import type {
  AgentProfile,
  ChannelMemberBotView,
  ChannelProviderView,
  ChannelQrAttemptView,
  ChannelLoginViewBounds,
  CoreEvent,
  MemberBotProvisioningView,
  StoredCommandResult
} from '@contracts'
import type { CoreClient } from './core-client'
import type {
  DingTalkAppCredential,
  DingTalkCredentialStore,
  PublishedChannelCredential
} from './channel-credential-store'
import type {
  DingTalkDeveloperIdentity,
  DingTalkLoginStage,
  DingTalkDeveloperSessionService
} from './dingtalk-developer-session'
import {
  DingTalkApprovalPending,
  DingTalkApproverSelectionRequired,
  DingTalkProvisioningError,
  type DingTalkMemberBotProvisioner,
  type DingTalkPublicationStep,
  type DingTalkProvisioningFacts
} from './dingtalk-member-bot-provisioner'
import type { MemberBotAvatarSourceResolver } from './member-bot-avatar-source'
import {
  decodeDingTalkCardActionId,
  DingTalkOpenApiClient,
  dingtalkCardParams,
  type DingTalkCardButton
} from './dingtalk-open-api'
import { DingTalkStreamRegistry, type DingTalkCardCallback } from './dingtalk-stream-registry'
import type { DingTalkInboundMessage } from './dingtalk-inbound'
import {
  memberBotAppDescription,
  memberBotWelcomeCopy
} from '../shared/channel-member-bot-copy'
import {
  executionRecentOutputItems,
  executionStateTitle,
  executionStatusIsTerminal,
  type ExecutionConsoleSnapshot
} from '../shared/execution-presentation/feishu-card'
import { AdaptiveChannelHostPump } from './channel-host-pump'
import type { ExecutionViewScope } from './execution-view-service'

export const DINGTALK_REQUIRED_SCOPE_VALUES = [
  'Card.Instance.Write',
  'Card.Streaming.Write',
  'qyapi_chat_manage',
  'qyapi_robot_sendmsg'
] as const

export function presentDingTalkAppIds(
  bots: ReadonlyArray<{
    appKey: string
    robotCode: string
    status: 'published' | 'disabled'
  }>,
  remoteRobotCodes: ReadonlySet<string>
): string[] {
  return bots
    .filter((bot) => bot.status === 'published' && remoteRobotCodes.has(bot.robotCode))
    .map((bot) => bot.appKey)
    .sort()
}

export function dingtalkOutTrackId(
  kind: 'bind' | 'run' | 'status' | 'welcome',
  deliveryId: string
): string {
  const digest = createHash('sha256')
    .update('rovai-dingtalk-card')
    .update('\0')
    .update(deliveryId)
    .digest('hex')
    .slice(0, 32)
  return `rv-${kind}-${digest}`
}

export function dingtalkMemberBotWelcomeCardParams(displayName: string): Record<string, string> {
  const copy = memberBotWelcomeCopy(displayName)
  return dingtalkCardParams({
    title: copy.title,
    content: copy.body,
    flowStatus: '3'
  })
}

export function selectSingleDingTalkInboundObservation<T extends {
  message: Pick<DingTalkInboundMessage, 'appId'>
}>(observed: readonly T[]): T | null {
  const byApp = new Map<string, T>()
  for (const candidate of observed) {
    if (!byApp.has(candidate.message.appId)) byApp.set(candidate.message.appId, candidate)
  }
  if (byApp.size !== 1) return null
  return [...byApp.values()][0] ?? null
}

export function hasCanonicalSingleDingTalkBotTarget(
  message: Pick<
    DingTalkInboundMessage,
    'conversationKind' | 'explicitlyAtBot'
  >
): boolean {
  // The callback already arrived through this Bot's credential-bound Stream,
  // and normalization verifies any supplied robotCode against that exact
  // binding. DingTalk documents chatbotUserId as opaque/ignorable; real
  // callbacks can encode it
  // differently from atUsers[].dingtalkId, so equality is not target proof.
  return message.conversationKind === 'p2p'
    || message.explicitlyAtBot
}

type CoreDingTalkSnapshot = {
  schemaVersion: 1
  account: {
    accountId: string
    userIdDigest: string
    corpId: string
    userName: string
    corpName: string
    oauthProfileRef: string
    status: 'connected' | 'disconnected' | 'oauth_expired'
    version: number
    connectedAt: string
    lastVerifiedAt: string
  } | null
  memberBots: Array<{
    agentId: string
    accountId: string
    unifiedAppId: string
    appKey: string
    robotCode: string
    botDisplayName: string
    credentialRef: string
    status: 'published' | 'disabled'
    failureCode: string | null
    version: number
  }>
  publicationIntents: DingTalkPublicationIntent[]
  pendingBindingCount: number
  bindingIssueCount: number
  transportConversations: Array<{
    channelConversationId: string
    bindingId: string | null
    provider: 'dingtalk'
    tenantKey: string
    chatId: string
    topicKey: ''
    conversationKind: 'group'
    campId: string | null
  }>
  pendingAggregates: Array<{
    aggregateId: string
    tenantKey: string
    chatId: string
    topicKey: ''
    conversationKind: 'p2p' | 'group'
    acknowledgementAppId: string
  }>
}

type DingTalkPublicationIntent = {
  publicationIntentId: string
  agentId: string
  accountId: string
  expectedUserIdDigest: string
  expectedCorpId: string
  requestedAppName: string
  provisioningMode: 'direct_open_platform'
  state: DingTalkPublicationState
  remoteUnifiedAppId: string | null
  appKey: string | null
  robotCode: string | null
  credentialRef: string | null
  versionId: string | null
  approvalMode: 'NO_APPROVAL' | 'SELECT_APPROVER' | 'AUTO' | null
  lastCompletedStep: string | null
  failureCode: string | null
  version: number
  createdAt: string
  updatedAt: string
}

type DingTalkPublicationState =
  | 'created' | 'account_verified' | 'app_created' | 'credentials_read'
  | 'avatar_configured' | 'robot_configured' | 'permissions_configured'
  | 'version_created' | 'awaiting_approver_selection' | 'awaiting_approval'
  | 'version_released' | 'stream_verified' | 'card_verified' | 'completed'
  | 'failed_recoverable' | 'failed_unknown_remote_state'

type ClaimedDelivery = {
  deliveryId: string
  provider: 'dingtalk'
  requestId: string | null
  deliveryKind: 'project_selection' | 'queue_ack' | 'execution_console_upsert'
    | 'execution_console_recall' | 'agent_output' | 'agent_attachment' | 'attention'
  targetAppId: string
  credentialRef: string
  chatId: string
  topicKey: string
  conversationKind: 'p2p' | 'group'
  payload: Record<string, unknown>
  attemptCount: number
  updateMessageId: string | null
  recipientOpenId: string | null
}

export type DingTalkExecutionConsoleSource = ExecutionConsoleSnapshot & {
  campId: string
  campTurnId: string
  channelConversationId: string
  agentId: string
  runCreatedAt: string
  targetAppId: string
  externalMessageId: string | null
  state: 'opening' | 'active' | 'terminal_pending' | 'terminal_sealed'
}

export type DingTalkExecutionCardPresentationState = {
  agentRunId: string
  targetAppId: string
  externalMessageId: string | null
  executionViewUrl: string | null
  recentOutputVisible: boolean
  latestSource: DingTalkExecutionConsoleSource
  lastCardDigest: string | null
}

export type DingTalkChannelSettingsState = {
  provider: ChannelProviderView
  pendingBindingCount: number
  bindingIssueCount: number
  activeQrAttempt: ChannelQrAttemptView | null
  activeProvisioning: MemberBotProvisioningView | null
}

export type DingTalkChannelHostDependencies = {
  core: Pick<CoreClient, 'request'>
  credentialStore: DingTalkCredentialStore
  developerSession: DingTalkDeveloperSessionService
  provisioner: DingTalkMemberBotProvisioner
  avatarSource: MemberBotAvatarSourceResolver
  streamRegistry?: DingTalkStreamRegistry
  createApiClient?: (credential: { appKey: string; appSecret: string }) => DingTalkOpenApiClient
  executionView?: {
    createExecutionViewUrl(scope: ExecutionViewScope): Promise<string | null>
    revokeExecutionViewUrl(url: string | null): void
  }
  requiredScopeValues?: readonly string[]
  requiredEventCodes?: readonly string[]
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

const WORKER_ID = `desktop-dingtalk-${randomUUID()}`
const NON_OWNER_HINT_MS = 24 * 60 * 60_000
const ROSTER_SWEEP_MS = 30_000
const MULTI_BOT_OBSERVATION_WINDOW_MS = 3_000
const STEP_RANK: Readonly<Record<DingTalkPublicationState, number>> = {
  created: 0, account_verified: 1, app_created: 2, credentials_read: 3,
  avatar_configured: 4, robot_configured: 5, permissions_configured: 6,
  version_created: 7, awaiting_approver_selection: 8, awaiting_approval: 9,
  version_released: 10, stream_verified: 11, card_verified: 12, completed: 13,
  failed_recoverable: -1, failed_unknown_remote_state: -2
}

export class DingTalkChannelSettingsService {
  readonly #dependencies: DingTalkChannelHostDependencies
  readonly #stream: DingTalkStreamRegistry
  readonly #listeners = new Set<() => void>()
  readonly #apis = new Map<string, DingTalkOpenApiClient>()
  readonly #failures = new Map<string, string>()
  readonly #dmHints = new Map<string, number>()
  readonly #inboundBatch = new Map<string, Map<string, {
    message: DingTalkInboundMessage
    agentId: string
    observation: Promise<boolean>
  }>>()
  readonly #executionCardStates = new Map<string, DingTalkExecutionCardPresentationState>()
  readonly #executionCardTails = new Map<string, Promise<unknown>>()
  readonly #hostPump: AdaptiveChannelHostPump
  #activeQrAttempt: ChannelQrAttemptView | null = null
  #activeQrAbort: AbortController | null = null
  #activeProvisioning: MemberBotProvisioningView | null = null
  #activeProvisioningAbort: AbortController | null = null
  #stopped = false
  #sessionCheckGeneration = 0
  #sessionNeedsReconnect = false
  #nextRosterSweepAt = 0

  constructor(dependencies: DingTalkChannelHostDependencies) {
    this.#dependencies = dependencies
    this.#hostPump = new AdaptiveChannelHostPump({
      run: () => this.#pumpOnce(),
      onError: (error) => {
        console.warn(`[rovai] DingTalk outbox pump failed: ${failureCode(error)}`)
      },
      setTimeout: dependencies.setTimeout,
      clearTimeout: dependencies.clearTimeout
    })
    this.#stream = dependencies.streamRegistry ?? new DingTalkStreamRegistry({
      onMessage: (message) => this.#queueInbound(message),
      onCard: (callback) => this.#handleCard(callback),
      onFailure: (appKey, error) => {
        console.warn(`[rovai] DingTalk Stream ${digest(appKey)}: ${failureCode(error)}`)
      }
    })
  }

  onChanged(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  handleCoreEvent(event: CoreEvent): void {
    this.#hostPump.handleCoreEvent(event)
  }

  async start(): Promise<void> {
    this.#stopped = false
    const sessionCheckGeneration = ++this.#sessionCheckGeneration
    const publishedCredentials = await this.#dependencies.credentialStore.listPublished()
    const credentialsByRef = new Map(publishedCredentials
      .filter((item): item is PublishedChannelCredential & {
        provider: 'dingtalk'
        credential: DingTalkAppCredential
      } => item.provider === 'dingtalk')
      .map((item) => [item.credentialRef, item.credential] as const))
    const snapshot = await this.#snapshot()
    for (const bot of snapshot.memberBots.filter((candidate) => candidate.status === 'published')) {
      await this.#startBot(bot, credentialsByRef.get(bot.credentialRef) ?? null).catch((error) => {
        this.#failures.set(bot.agentId, failureCode(error))
      })
    }
    this.#hostPump.start()
    this.#notify()
    // Bot credentials are independent of developer-console SSO. Restore Stream
    // before checking a web session that may need a slow portal navigation.
    if (snapshot.account?.status === 'connected') {
      void this.#checkSavedAccount(snapshot.account, sessionCheckGeneration).catch(() => undefined)
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true
    this.#sessionCheckGeneration += 1
    this.#activeQrAbort?.abort()
    this.#activeProvisioningAbort?.abort()
    this.#hostPump.stop()
    this.#stream.stopAll()
    this.#apis.clear()
    this.#inboundBatch.clear()
    for (const state of this.#executionCardStates.values()) {
      this.#dependencies.executionView?.revokeExecutionViewUrl(state.executionViewUrl)
    }
    this.#executionCardStates.clear()
    this.#executionCardTails.clear()
  }

  async get(): Promise<DingTalkChannelSettingsState> {
    const snapshot = await this.#snapshot()
    const intents = new Map(snapshot.publicationIntents.map((intent) => [intent.agentId, intent]))
    return {
      provider: {
        kind: 'dingtalk',
        displayName: '钉钉',
        hostStatus: 'ready',
        connection: {
          status: this.#sessionNeedsReconnect ? 'session_expired'
            : snapshot.account?.status === 'connected'
            ? 'connected'
            : snapshot.account?.status === 'oauth_expired' ? 'session_expired' : 'not_connected',
          account: snapshot.account ? {
            accountId: snapshot.account.accountId,
            userName: snapshot.account.userName,
            tenantName: snapshot.account.corpName,
            brand: 'dingtalk',
            connectedAt: snapshot.account.connectedAt,
            lastVerifiedAt: snapshot.account.lastVerifiedAt
          } : null
        },
        memberBots: snapshot.memberBots.map((bot): ChannelMemberBotView => {
          const intent = intents.get(bot.agentId)
          const failureCode = this.#failures.get(bot.agentId)
            ?? bot.failureCode
            ?? (intent?.state.startsWith('failed_') ? intent.failureCode : null)
          return {
            agentId: bot.agentId,
            publicationStatus: failureCode
              ? 'failed'
              : bot.status === 'published' && this.#stream.has(bot.appKey)
                ? 'published'
                : bot.status,
            botDisplayName: bot.botDisplayName,
            appId: bot.unifiedAppId,
            managementUrl: `https://open-dev.dingtalk.com/fe/app#/corp/app?appId=${encodeURIComponent(bot.unifiedAppId)}`,
            failureCode
          }
        }),
        pendingBindingCount: snapshot.pendingBindingCount,
        bindingIssueCount: snapshot.bindingIssueCount
      },
      pendingBindingCount: snapshot.pendingBindingCount,
      bindingIssueCount: snapshot.bindingIssueCount,
      activeQrAttempt: this.#activeQrAttempt ? structuredClone(this.#activeQrAttempt) : null,
      activeProvisioning: this.#activeProvisioning
        ? structuredClone(this.#activeProvisioning)
        : null
    }
  }

  async connect(): Promise<void> {
    if (this.#activeQrAbort) throw new Error('已有一个钉钉登录流程正在进行。')
    if (this.#activeProvisioning && !['completed', 'failed', 'unknown_remote_state'].includes(
      this.#activeProvisioning.stage
    )) throw new Error('队员发布期间不能切换钉钉账号。')
    this.#sessionCheckGeneration += 1
    const abort = new AbortController()
    const attemptId = randomUUID()
    this.#activeQrAbort = abort
    this.#activeQrAttempt = {
      attemptId,
      purpose: 'account_login',
      agentId: null,
      stage: 'loading_local_session',
      qrDataUrl: null,
      expiresAt: null,
      detail: '正在读取 Rovai 本地渠道数据…'
    }
    this.#notify()
    const onStage = (stage: DingTalkLoginStage): void => {
      if (this.#activeQrAttempt?.attemptId !== attemptId || abort.signal.aborted) return
      const details: Record<DingTalkLoginStage, string> = {
        loading_local_session: '正在读取 Rovai 本地渠道数据…',
        preparing: '正在加载钉钉二维码…',
        awaiting_scan: '请使用钉钉扫码登录开放平台。',
        scan_confirmed: '扫码成功，等待钉钉确认…',
        awaiting_interaction: '请在下方完成钉钉确认或选择企业。',
        expired: '二维码已过期，请刷新后重新扫码。',
        inspecting_identity: '正在读取钉钉账号与企业身份…',
        saving_local_session: '身份读取完成，正在保存开发者会话…',
        connected: '钉钉开发者账号已连接。'
      }
      this.#activeQrAttempt = {
        ...this.#activeQrAttempt, stage, detail: details[stage],
        ...(stage !== 'awaiting_scan' ? { qrDataUrl: null, expiresAt: null } : {})
      }
      this.#notify()
    }
    try {
      const previous = (await this.#snapshot()).account
      if (abort.signal.aborted) throw new Error('dingtalk_operation_cancelled')
      const identity = await this.#dependencies.developerSession.beginLogin({
        signal: abort.signal,
        onStage,
        onQrReady: ({ payload, expiresAt }) => {
          if (this.#activeQrAttempt?.attemptId !== attemptId || abort.signal.aborted) return
          this.#activeQrAttempt = {
            ...this.#activeQrAttempt, stage: 'awaiting_scan', qrDataUrl: payload, expiresAt,
            detail: '请使用钉钉扫码登录开放平台。'
          }
          this.#notify()
        }
      })
      if (abort.signal.aborted) throw new Error('dingtalk_operation_cancelled')
      const pending = pendingDingTalkConnection(this.#dependencies.developerSession)
      onStage('saving_local_session')
      const result = await this.#command('channels.dingtalk.account.commitConnection', {
        expectedPreviousAccountVersion: previous?.status === 'connected' ? previous.version : null,
        account: dingtalkConnectionAccount(identity),
        developerSession: pending
      })
      await activatePendingDingTalkLogin(
        this.#dependencies.developerSession,
        sessionRevisionFrom(result)
      )
      this.#sessionNeedsReconnect = false
      if (this.#activeQrAttempt) {
        this.#activeQrAttempt = {
          ...this.#activeQrAttempt,
          stage: 'connected',
          detail: '钉钉开发者账号已连接。'
        }
      }
    } catch (error) {
      await this.#dependencies.developerSession.discardPendingLogin?.().catch(() => undefined)
      // Closing the login window or cancelling the exact attempt is a no-op,
      // not an IPC failure. The previous account/session remains authoritative.
      if (error instanceof Error && error.message === 'dingtalk_operation_cancelled') return
      throw error
    } finally {
      this.#activeQrAbort = null
      this.#activeQrAttempt = null
      this.#notify()
    }
  }

  async cancelLogin(attemptId: string): Promise<void> {
    if (this.#activeQrAttempt?.attemptId !== attemptId
      || this.#activeQrAttempt.stage === 'saving_local_session') return
    this.#activeQrAbort?.abort()
    this.#dependencies.developerSession.setLoginViewBounds?.(null)
    this.#activeQrAttempt = null
    this.#notify()
  }

  setLoginViewBounds(attemptId: string, bounds: ChannelLoginViewBounds | null): void {
    if (this.#activeQrAttempt?.attemptId !== attemptId || this.#activeQrAbort?.signal.aborted) return
    if (bounds !== null && this.#activeQrAttempt.stage !== 'awaiting_interaction') return
    this.#dependencies.developerSession.setLoginViewBounds?.(bounds)
  }

  refreshLoginQr(attemptId: string): void {
    if (this.#activeQrAttempt?.attemptId !== attemptId || this.#activeQrAbort?.signal.aborted
      || !['expired', 'awaiting_scan'].includes(this.#activeQrAttempt.stage)) return
    this.#dependencies.developerSession.refreshLoginQr?.()
  }

  async disconnect(): Promise<void> {
    if (this.#activeProvisioning && !['completed', 'failed', 'unknown_remote_state'].includes(
      this.#activeProvisioning.stage
    )) throw new Error('队员发布期间不能断开钉钉账号。')
    this.#sessionCheckGeneration += 1
    const snapshot = await this.#snapshot()
    if (!snapshot.account || snapshot.account.status !== 'connected') return
    await this.#command('channels.dingtalk.account.disconnect', {
      accountId: snapshot.account.accountId,
      expectedVersion: snapshot.account.version
    })
    await this.#dependencies.developerSession.disconnect()
    this.#sessionNeedsReconnect = false
    this.#notify()
  }

  async publish(agentId: string, selectedApproverUserId?: string): Promise<void> {
    if (this.#activeQrAttempt) throw new Error('钉钉账号连接完成前不能发布队员。')
    if (this.#activeProvisioning && !['completed', 'failed', 'unknown_remote_state'].includes(
      this.#activeProvisioning.stage
    )) throw new Error('已有一名队员正在发布。')
    const snapshot = await this.#snapshot()
    const account = snapshot.account
    if (!account || account.status !== 'connected') throw new Error('请先连接钉钉开发者账号。')
    const identity = await this.#dependencies.developerSession.inspect()
    if (!identity
      || identity.userIdDigest !== account.userIdDigest
      || identity.corpId !== account.corpId) throw new Error('钉钉账号已变化，请重新连接。')
    const agent = await this.#dependencies.core.request<AgentProfile>('members.get', { agentId })
    const existing = snapshot.publicationIntents.find((intent) => intent.agentId === agentId)
    const existingBot = snapshot.memberBots.find((bot) => bot.agentId === agentId)
    if (existing && (existing.accountId !== account.accountId
      || existing.expectedCorpId !== identity.corpId
      || existing.expectedUserIdDigest !== identity.userIdDigest)) {
      throw new Error('请先连接最初发布该队员应用的钉钉账号。')
    }
    if (existingBot && (!existing
      || existingBot.accountId !== existing.accountId
      || existingBot.unifiedAppId !== existing.remoteUnifiedAppId
      || existingBot.appKey !== existing.appKey
      || existingBot.robotCode !== existing.robotCode
      || existingBot.credentialRef !== existing.credentialRef)) {
      throw new Error('dingtalk_credentials_freeze_invalid')
    }
    if (existing?.state === 'completed' && existingBot) {
      const abort = new AbortController()
      this.#activeProvisioningAbort = abort
      this.#activeProvisioning = {
        ...provisioningView(existing, 'verifying_session', '正在核对原应用连接与 AI 卡片…'),
        remoteAppId: existingBot.unifiedAppId
      }
      this.#notify()
      try {
        let credential = await this.#dependencies.credentialStore.readDingTalk(
          existingBot.credentialRef
        )
        if (!credential) {
          credential = await this.#recoverCompletedBotCredential(
            existing,
            existingBot,
            agent,
            identity,
            abort.signal
          )
          this.#stream.stop(existingBot.appKey)
          this.#apis.delete(existingBot.appKey)
        }
        if (abort.signal.aborted) throw new Error('dingtalk_provisioning_cancelled')
        await this.#startBot(existingBot, credential)
        await this.#verifyCard(credential)
        this.#failures.delete(agentId)
        this.#activeProvisioning = {
          ...provisioningView(existing, 'completed', '原应用连接与 AI 卡片已经恢复。'),
          remoteAppId: existingBot.unifiedAppId
        }
        this.#notify()
        return
      } catch (error) {
        const code = failureCode(error)
        this.#failures.set(agentId, code)
        this.#activeProvisioning = {
          ...provisioningView(existing, 'failed', '原应用连接或 AI 卡片核对未完成。'),
          remoteAppId: existingBot.unifiedAppId,
          failureCode: code
        }
        this.#notify()
        throw error
      } finally {
        if (this.#activeProvisioningAbort === abort) this.#activeProvisioningAbort = null
      }
    }
    if (existing?.state === 'failed_unknown_remote_state' && !existing.remoteUnifiedAppId) {
      throw new Error('dingtalk_app_create_unknown_remote_state')
    }
    if (existing?.state === 'account_verified' && !existing.remoteUnifiedAppId) {
      // account_verified is durable before create dispatch. An interrupted
      // attempt at this boundary cannot prove that no remote app was created.
      const code = 'dingtalk_app_create_unknown_remote_state'
      await this.#markFailed(existing, true, code)
      this.#failures.set(agentId, code)
      this.#notify()
      throw new Error(code)
    }
    let intent = existing
    if (!intent) {
      const intentId = `rvdtpi_${randomUUID().replaceAll('-', '')}`
      await this.#command('channels.dingtalk.publicationIntent.create', {
        publicationIntentId: intentId,
        accountId: account.accountId,
        agentId,
        expectedUserIdDigest: account.userIdDigest,
        expectedCorpId: account.corpId,
        requestedAppName: agent.displayName,
        provisioningMode: 'direct_open_platform'
      })
      intent = (await this.#snapshot()).publicationIntents.find((item) => item.agentId === agentId)
    }
    if (!intent) throw new Error('dingtalk_publication_intent_missing')
    const abort = new AbortController()
    this.#activeProvisioningAbort = abort
    this.#activeProvisioning = provisioningView(intent, 'verifying_session', '正在校验钉钉账号…')
    this.#notify()
    let current = intent
    let credentialRef = current.credentialRef
      ?? (current.remoteUnifiedAppId
        ? credentialRefFor(agentId, current.remoteUnifiedAppId)
        : null)
    try {
      const avatar = await this.#dependencies.avatarSource.resolve(agent.avatarRef)
      if (!avatar?.pngBytes) throw new Error('dingtalk_member_bot_avatar_unavailable')
      const provisioned = await this.#dependencies.provisioner.create({
        appName: current.requestedAppName,
        description: memberBotAppDescription('dingtalk', agent.teamRole),
        expectedCorpId: identity.corpId,
        expectedUserId: identity.userId,
        frozen: {
          unifiedAppId: current.remoteUnifiedAppId ?? undefined,
          appKey: current.appKey ?? undefined,
          robotCode: current.robotCode ?? undefined,
          versionId: current.versionId ?? undefined
        },
        resumeState: current.state.startsWith('failed_')
          ? current.lastCompletedStep ?? undefined
          : current.state,
        frozenApprovalMode: current.approvalMode ?? undefined,
        selectedApproverUserId,
        requiredScopeValues: this.#dependencies.requiredScopeValues ?? [],
        requiredEventCodes: this.#dependencies.requiredEventCodes ?? [],
        signal: abort.signal,
        readAvatarPng: async () => new Uint8Array(avatar.pngBytes!),
        onStep: async (step, facts) => {
          if (facts.unifiedAppId && !credentialRef) {
            credentialRef = credentialRefFor(agentId, facts.unifiedAppId)
          }
          if (step === 'credentials_read') {
            if (!credentialRef || !facts.appKey || !facts.appSecret) {
              throw new Error('dingtalk_credentials_freeze_invalid')
            }
            if (!shouldAdvanceDingTalkPublicationStep(current, step)) return
            this.#activeProvisioning = provisioningForStep(current, step, facts)
            this.#notify()
            await this.#command('channels.dingtalk.publicationIntent.storeCredential', {
              provider: 'dingtalk',
              publicationIntentId: current.publicationIntentId,
              expectedIntentVersion: current.version,
              credentialRef,
              remoteAppId: facts.appKey,
              credential: {
                appSecret: facts.appSecret,
                robotCode: facts.robotCode ?? current.robotCode ?? facts.appKey
              }
            })
            current = (await this.#snapshot()).publicationIntents
              .find((item) => item.publicationIntentId === current.publicationIntentId)!
            return
          }
          if (!shouldAdvanceDingTalkPublicationStep(current, step)) return
          this.#activeProvisioning = provisioningForStep(current, step, facts)
          this.#notify()
          await this.#advance(current, step, facts, credentialRef)
          current = (await this.#snapshot()).publicationIntents
            .find((item) => item.publicationIntentId === current.publicationIntentId)!
        }
      })
      if (!credentialRef) throw new Error('dingtalk_credential_ref_missing')
      if (
        provisioned.appKey !== current.appKey
        || provisioned.robotCode !== current.robotCode
        || current.credentialRef !== credentialRef
      ) throw new Error('dingtalk_credentials_freeze_invalid')
      await this.#command('channels.dingtalk.memberBot.upsert', {
        accountId: account.accountId,
        agentId,
        unifiedAppId: provisioned.unifiedAppId,
        appKey: provisioned.appKey,
        robotCode: provisioned.robotCode,
        ownerUserId: identity.userId,
        botDisplayName: agent.displayName,
        credentialRef
      })
      await this.#startBot({
        agentId,
        accountId: account.accountId,
        unifiedAppId: provisioned.unifiedAppId,
        appKey: provisioned.appKey,
        robotCode: provisioned.robotCode,
        botDisplayName: agent.displayName,
        credentialRef,
        status: 'published',
        failureCode: null,
        version: 1
      })
      await this.#advance(current, 'stream_verified', {
        unifiedAppId: provisioned.unifiedAppId,
        appKey: provisioned.appKey,
        robotCode: provisioned.robotCode,
        versionId: provisioned.versionId
      }, credentialRef)
      current = (await this.#snapshot()).publicationIntents
        .find((item) => item.publicationIntentId === current.publicationIntentId)!
      await this.#verifyCard(provisioned)
      await this.#advance(current, 'card_verified', {
        unifiedAppId: provisioned.unifiedAppId,
        appKey: provisioned.appKey,
        robotCode: provisioned.robotCode,
        versionId: provisioned.versionId
      }, credentialRef)
      current = (await this.#snapshot()).publicationIntents
        .find((item) => item.publicationIntentId === current.publicationIntentId)!
      await this.#advance(current, 'completed', {
        unifiedAppId: provisioned.unifiedAppId,
        appKey: provisioned.appKey,
        robotCode: provisioned.robotCode,
        versionId: provisioned.versionId
      }, credentialRef)
      this.#failures.delete(agentId)
      this.#activeProvisioning = {
        ...this.#activeProvisioning!,
        stage: 'completed',
        detail: '发布完成',
        remoteAppId: provisioned.unifiedAppId,
        failureCode: null
      }
      await this.#sendMemberBotWelcome({
        publicationIntentId: current.publicationIntentId,
        appKey: provisioned.appKey,
        robotCode: provisioned.robotCode,
        ownerUserId: identity.userId,
        displayName: agent.displayName
      }).catch((error) => {
        console.warn(`[rovai] DingTalk member Bot welcome failed: ${failureCode(error)}`)
      })
    } catch (error) {
      if (error instanceof DingTalkApproverSelectionRequired) {
        this.#activeProvisioning = {
          ...this.#activeProvisioning!,
          stage: 'waiting_configuration',
          detail: '请选择钉钉版本审批人。',
          remoteAppId: error.facts.unifiedAppId ?? null,
          failureCode: 'dingtalk_approver_selection_required',
          approvalCandidates: error.candidates
        }
        return
      }
      if (error instanceof DingTalkApprovalPending) {
        this.#activeProvisioning = {
          ...this.#activeProvisioning!,
          stage: 'waiting_configuration',
          detail: '版本已经提交，正在等待钉钉审批。稍后可继续核对状态。',
          remoteAppId: error.facts.unifiedAppId ?? null,
          failureCode: 'dingtalk_version_under_review'
        }
        return
      }
      const code = failureCode(error)
      this.#failures.set(agentId, code)
      const unknown = error instanceof DingTalkProvisioningError && error.unknownRemoteState
      const facts = error instanceof DingTalkProvisioningError ? error.facts : {}
      // A Core checkpoint can apply while its response is lost. Refresh its CAS
      // revision before recording failure, carrying any proven remote identity.
      current = (await this.#snapshot().catch(() => null))?.publicationIntents
        .find((item) => item.publicationIntentId === current.publicationIntentId) ?? current
      await this.#markFailed(current, unknown, code, facts).catch(() => undefined)
      this.#activeProvisioning = {
        ...this.#activeProvisioning!,
        stage: unknown ? 'unknown_remote_state' : 'failed',
        remoteAppId: facts.unifiedAppId ?? current.remoteUnifiedAppId,
        detail: unknown
          ? '无法确认钉钉应用是否已创建；已停止自动重试。'
          : '钉钉发布未完成，可以排除问题后继续。',
        failureCode: code
      }
      throw error
    } finally {
      this.#activeProvisioningAbort = null
      this.#notify()
    }
  }

  async selectApprover(agentId: string, userId: string): Promise<void> {
    const pending = this.#activeProvisioning
    if (
      pending?.agentId !== agentId
      || pending.failureCode !== 'dingtalk_approver_selection_required'
      || !pending.approvalCandidates?.some((candidate) => candidate.userId === userId)
    ) throw new Error('dingtalk_approver_selection_invalid')
    this.#activeProvisioning = null
    await this.publish(agentId, userId)
  }

  async #recoverCompletedBotCredential(
    intent: DingTalkPublicationIntent,
    bot: CoreDingTalkSnapshot['memberBots'][number],
    agent: AgentProfile,
    identity: DingTalkDeveloperIdentity,
    signal: AbortSignal
  ): Promise<DingTalkAppCredential> {
    if (!intent.versionId || !bot.unifiedAppId || !bot.appKey || !bot.robotCode || !bot.credentialRef) {
      throw new Error('dingtalk_credentials_freeze_invalid')
    }
    this.#activeProvisioning = provisioningView(intent, 'verifying_session', '正在恢复原应用的本地凭据…')
    this.#notify()
    const recovered = await this.#dependencies.provisioner.create({
      appName: bot.botDisplayName,
      description: memberBotAppDescription('dingtalk', agent.teamRole),
      expectedCorpId: identity.corpId,
      expectedUserId: identity.userId,
      frozen: {
        unifiedAppId: bot.unifiedAppId, appKey: bot.appKey,
        robotCode: bot.robotCode, versionId: intent.versionId
      },
      resumeState: 'completed',
      frozenApprovalMode: intent.approvalMode ?? undefined,
      requiredScopeValues: this.#dependencies.requiredScopeValues ?? [],
      requiredEventCodes: this.#dependencies.requiredEventCodes ?? [],
      signal,
      readAvatarPng: async () => { throw new Error('dingtalk_completed_recovery_mutation_rejected') },
      // Completed recovery is read-only; do not rewind publication milestones.
      onStep: async () => undefined
    })
    if (!recovered.appSecret || recovered.unifiedAppId !== bot.unifiedAppId
      || recovered.appKey !== bot.appKey || recovered.robotCode !== bot.robotCode
      || recovered.versionId !== intent.versionId) {
      throw new Error('dingtalk_credentials_freeze_invalid')
    }
    if (signal.aborted) throw new Error('dingtalk_provisioning_cancelled')
    const credential = { appKey: bot.appKey, appSecret: recovered.appSecret, robotCode: bot.robotCode }
    await this.#command('channels.dingtalk.publicationIntent.storeCredential', {
      provider: 'dingtalk', publicationIntentId: intent.publicationIntentId,
      expectedIntentVersion: intent.version, credentialRef: bot.credentialRef,
      remoteAppId: bot.appKey,
      credential: { appSecret: credential.appSecret, robotCode: credential.robotCode }
    })
    return credential
  }

  async #checkSavedAccount(
    account: NonNullable<CoreDingTalkSnapshot['account']>,
    generation: number
  ): Promise<void> {
    let identity: DingTalkDeveloperIdentity | null
    try {
      identity = await this.#dependencies.developerSession.inspect()
    } catch (error) {
      if (error instanceof Error && error.message === 'dingtalk_legacy_session_requires_reconnect') {
        if (!this.#stopped && this.#sessionCheckGeneration === generation) {
          this.#sessionNeedsReconnect = true
          this.#notify()
        }
        return
      }
      if (!(error instanceof Error)
        || !['dingtalk_developer_session_expired', 'dingtalk_login_identity_mismatch'].includes(error.message)) return
      identity = null
    }
    const current = (await this.#snapshot()).account
    if (this.#stopped || this.#sessionCheckGeneration !== generation
      || current?.status !== 'connected' || current.accountId !== account.accountId
      || current.version !== account.version) return
    if (!identity || identity.userIdDigest !== account.userIdDigest || identity.corpId !== account.corpId) {
      await this.#command('channels.dingtalk.account.expire', {
        accountId: account.accountId,
        expectedVersion: account.version
      })
      await this.#dependencies.developerSession.disconnect()
    } else {
      await this.#upsertAccount(identity)
    }
    this.#notify()
  }

  async #upsertAccount(identity: DingTalkDeveloperIdentity): Promise<void> {
    await this.#command('channels.dingtalk.account.upsert', dingtalkConnectionAccount(identity))
  }

  async #advance(
    intent: DingTalkPublicationIntent,
    state: DingTalkPublicationState,
    facts: DingTalkProvisioningFacts,
    credentialRef: string | null
  ): Promise<void> {
    await this.#command('channels.dingtalk.publicationIntent.advance', {
      publicationIntentId: intent.publicationIntentId,
      expectedVersion: intent.version,
      state,
      remoteUnifiedAppId: facts.unifiedAppId ?? intent.remoteUnifiedAppId,
      appKey: facts.appKey ?? intent.appKey,
      robotCode: facts.robotCode ?? intent.robotCode,
      credentialRef,
      versionId: facts.versionId ?? intent.versionId,
      approvalMode: facts.approvalMode ?? intent.approvalMode,
      approverUserIdDigest: facts.approverUserId
        ? digestNamespaced('dingtalk-user', facts.approverUserId)
        : null,
      lastCompletedStep: state,
      failureCode: null
    })
  }

  async #markFailed(
    intent: DingTalkPublicationIntent,
    unknown: boolean,
    failureCodeValue: string,
    facts: DingTalkProvisioningFacts = {}
  ): Promise<void> {
    const remoteUnifiedAppId = facts.unifiedAppId ?? intent.remoteUnifiedAppId
    await this.#command('channels.dingtalk.publicationIntent.advance', {
      publicationIntentId: intent.publicationIntentId,
      expectedVersion: intent.version,
      state: unknown && !remoteUnifiedAppId
        ? 'failed_unknown_remote_state'
        : 'failed_recoverable',
      remoteUnifiedAppId,
      appKey: intent.appKey,
      robotCode: intent.robotCode,
      credentialRef: intent.credentialRef,
      versionId: intent.versionId,
      approvalMode: intent.approvalMode,
      approverUserIdDigest: null,
      lastCompletedStep: !intent.remoteUnifiedAppId && facts.unifiedAppId ? 'app_created' : intent.lastCompletedStep,
      failureCode: failureCodeValue
    })
  }

  async #startBot(
    bot: CoreDingTalkSnapshot['memberBots'][number],
    loadedCredential?: DingTalkAppCredential | null
  ): Promise<void> {
    const credential = loadedCredential === undefined
      ? await this.#dependencies.credentialStore.readDingTalk(bot.credentialRef)
      : loadedCredential
    if (!credential
      || credential.appKey !== bot.appKey
      || credential.robotCode !== bot.robotCode) throw new Error('published_bot_credential_missing')
    this.#apis.set(bot.appKey, this.#api(credential))
    await this.#stream.start(credential)
  }

  #api(credential: { appKey: string; appSecret: string }): DingTalkOpenApiClient {
    const existing = this.#apis.get(credential.appKey)
    if (existing) return existing
    const api = this.#dependencies.createApiClient?.(credential)
      ?? new DingTalkOpenApiClient(credential)
    this.#apis.set(credential.appKey, api)
    return api
  }

  async #verifyCard(bot: { appKey: string; appSecret: string }): Promise<void> {
    const api = this.#api(bot)
    const outTrackId = `rv-verify-${randomUUID()}`
    await api.createCardInstance(outTrackId, dingtalkCardParams({
      title: 'Rovai 连接验证',
      content: 'Bot 配置已完成。'
    }))
  }

  async #sendMemberBotWelcome(input: {
    publicationIntentId: string
    appKey: string
    robotCode: string
    ownerUserId: string
    displayName: string
  }): Promise<void> {
    const api = this.#apis.get(input.appKey)
    if (!api) throw new Error('dingtalk_bot_not_connected')
    const outTrackId = dingtalkOutTrackId('welcome', input.publicationIntentId)
    await api.createAndDeliverCard({
      outTrackId,
      openSpaceId: `dtv1.card//IM_ROBOT.${input.ownerUserId}`,
      robotCode: input.robotCode,
      space: 'p2p',
      cardParamMap: dingtalkMemberBotWelcomeCardParams(input.displayName)
    })
  }

  async #queueInbound(message: DingTalkInboundMessage): Promise<void> {
    if (this.#stopped || !hasCanonicalSingleDingTalkBotTarget(message)) return
    this.#hostPump.wake()
    const snapshot = await this.#snapshot()
    const bot = snapshot.memberBots.find((candidate) => candidate.appKey === message.appId)
    if (!bot || bot.status !== 'published') return
    if (message.conversationKind === 'p2p') {
      await this.#processInbound(message, bot.agentId, true)
      this.#hostPump.wake()
      return
    }
    const key = `${message.tenantKey}\0${message.externalMessageId}`
    let pending = this.#inboundBatch.get(key)
    if (!pending) {
      pending = new Map()
      this.#inboundBatch.set(key, pending)
      setTimeout(() => {
        void this.#finalizeInboundBatch(key)
      }, MULTI_BOT_OBSERVATION_WINDOW_MS).unref?.()
    }
    if (pending.has(message.appId)) return
    const observation = this.#processInbound(message, bot.agentId, false).catch((error) => {
      console.warn(`[rovai] DingTalk inbound observation failed: ${failureCode(error)}`)
      return false
    })
    pending.set(message.appId, { message, agentId: bot.agentId, observation })
    await observation
  }

  async #finalizeInboundBatch(key: string): Promise<void> {
    const pending = this.#inboundBatch.get(key)
    this.#inboundBatch.delete(key)
    if (!pending || this.#stopped) return
    const observed = [...pending.values()]
    const eligible = (await Promise.all(observed.map(async (candidate) => ({
      candidate,
      observed: await candidate.observation
    })))).filter((candidate) => candidate.observed)
    // Multi-Bot direct mentions remain behind the real-tenant capability
    // gate. Seeing more than one receiving App for the same message proves
    // this root cannot safely be reduced to a single canonical target, so it
    // must fail closed instead of starting whichever Bot arrived first.
    const selected = selectSingleDingTalkInboundObservation(observed)
    if (!selected || eligible.length !== 1) return
    await this.#processInbound(selected.message, selected.agentId, true).catch((error) => {
        console.warn(`[rovai] DingTalk inbound failed: ${failureCode(error)}`)
    })
    this.#hostPump.wake()
  }

  async #processInbound(
    message: DingTalkInboundMessage,
    agentId: string,
    canonicalMentionsComplete: boolean
  ): Promise<boolean> {
    const owner = await this.#command('channels.dingtalk.owner.verify', {
      provider: 'dingtalk',
      appId: message.appId,
      tenantKey: message.tenantKey,
      senderOpenId: null,
      senderUserId: message.senderUserId,
      senderUnionId: null,
      senderDisplayName: message.senderDisplayName
    }, false)
    if (owner.payload.classification !== 'owner') {
      if (message.conversationKind === 'p2p') await this.#sendNonOwnerHint(message)
      return false
    }
    if (message.conversationKind === 'p2p' && message.body === '/new') {
      await this.#command('channels.dingtalk.dm.startNew', {
        provider: 'dingtalk',
        appId: message.appId,
        tenantKey: message.tenantKey,
        chatId: message.chatId,
        conversationDisplayName: message.conversationDisplayName,
        targetAgentId: agentId
      })
      return true
    }
    if (message.conversationKind === 'group') await this.#reconcileRoster(message)
    const observed = await this.#command('channels.dingtalk.inbound.observe', {
      provider: 'dingtalk',
      appId: message.appId,
      externalMessageId: message.externalMessageId,
      tenantKey: message.tenantKey,
      chatId: message.chatId,
      topicKey: '',
      conversationKind: message.conversationKind,
      conversationDisplayName: message.conversationDisplayName,
      senderExternalUserId: message.senderExternalUserId,
      senderOpenId: null,
      senderUserId: message.senderUserId,
      senderUnionId: null,
      senderDisplayName: message.senderDisplayName,
      body: message.body,
      attachmentSummaries: message.attachmentSummaries,
      quote: message.quote,
      canonicalAgentIds: [agentId],
      canonicalMentionsComplete,
      expectedAppIds: [message.appId],
      acknowledgementAppId: message.appId
    })
    this.#hostPump.wake()
    if (canonicalMentionsComplete && observed.payload.readyToFinalize === true) {
      await this.#finalize(String(observed.payload.aggregateId ?? ''))
      this.#hostPump.wake()
    }
    this.#notify()
    return observed.payload.status === 'collecting'
  }

  async #sendNonOwnerHint(message: DingTalkInboundMessage): Promise<void> {
    const key = `${message.appId}\0${message.senderUserId}`
    const previous = this.#dmHints.get(key) ?? 0
    if (Date.now() - previous < NON_OWNER_HINT_MS) return
    this.#dmHints.set(key, Date.now())
    const bot = (await this.#snapshot()).memberBots.find((candidate) => candidate.appKey === message.appId)
    const api = this.#apis.get(message.appId)
    if (!bot || !api) return
    await api.sendPrivateMarkdown({
      robotCode: bot.robotCode,
      userId: message.senderUserId,
      title: 'Rovai',
      text: '该 Bot 当前仅供 Rovai Owner 使用。'
    })
  }

  async #reconcileRoster(message: DingTalkInboundMessage): Promise<void> {
    const api = this.#apis.get(message.appId)
    if (!api) throw new Error('dingtalk_bot_not_connected')
    const remoteRobotCodes = new Set(await api.groupRobotCodes(message.chatId))
    const presentAppIds = presentDingTalkAppIds(
      (await this.#snapshot()).memberBots,
      remoteRobotCodes
    )
    await this.#command('channels.dingtalk.roster.reconcile', {
      provider: 'dingtalk',
      tenantKey: message.tenantKey,
      chatId: message.chatId,
      presentAppIds
    })
  }

  async #finalize(aggregateId: string): Promise<void> {
    let result = await this.#command('channels.dingtalk.inbound.finalize', { aggregateId }, false)
    if (result.code === 'channel.membership_sync_required') {
      let membership = Number(result.payload.expectedMembershipGeneration)
      let reconciliation = Number(result.payload.nextReconciliationGeneration)
      for (const agentId of stringArray(result.payload.agentIds)) {
        const added = await this.#command('channels.membership.add', {
          campId: String(result.payload.campId),
          agentId,
          expectedMembershipGeneration: membership,
          capabilityOverrides: {},
          source: {
            namespace: 'dingtalk',
            bindingId: String(result.payload.bindingId),
            reconciliationGeneration: reconciliation
          }
        })
        membership = Number(added.payload.membershipGeneration)
        reconciliation += 1
      }
      result = await this.#command('channels.dingtalk.inbound.finalize', { aggregateId }, false)
    }
    void result
  }

  async #handleCard(callback: DingTalkCardCallback): Promise<void> {
    const value = dingtalkCardCallbackValue(callback.payload)
    if (!value) return
    const operatorUserId = recursiveString(callback.payload, 'userId')
      ?? recursiveString(callback.payload, 'staffId')
    const outTrackId = recursiveString(callback.payload, 'outTrackId') ?? callback.messageId
    if (!operatorUserId) return
    if (typeof value.pendingBindingId === 'string') {
      this.#hostPump.wake()
      const result = await this.#command('channels.dingtalk.pendingBinding.resolve', {
        pendingBindingId: value.pendingBindingId,
        appId: callback.appKey,
        externalPickerMessageId: outTrackId,
        expectedVersion: Number(value.expectedVersion),
        nonce: String(value.nonce ?? ''),
        action: String(value.action ?? ''),
        projectId: typeof value.projectId === 'string' ? value.projectId : null,
        operatorOpenId: null,
        operatorUserId,
        operatorUnionId: null
      }, false)
      const api = this.#apis.get(callback.appKey)
      if (api && result.status !== 'rejected' && value.action !== 'refresh') {
        await api.updateCard(outTrackId, dingtalkCardParams({
          title: 'Rovai 项目',
          content: value.action === 'cancel'
            ? '已取消。'
            : value.action === 'quick_chat'
              ? '已开始快速对话，消息已进入处理。'
              : '项目已绑定，消息已进入处理。',
          flowStatus: '3'
        }))
      }
      this.#hostPump.wake()
      return
    }
    const agentRunId = typeof value.agentRunId === 'string' ? value.agentRunId : null
    if (!agentRunId || !['execution_recent_output', 'execution_stop'].includes(String(value.action))) return
    await this.#enqueueExecutionCard(agentRunId, async () => {
      const state = this.#executionCardStates.get(agentRunId)
      if (state && (state.targetAppId !== callback.appKey
        || state.externalMessageId !== outTrackId)) return
      const operator = {
        operatorOpenId: null,
        operatorUserId,
        operatorUnionId: null
      }
      if (value.action === 'execution_stop') {
        this.#hostPump.wake()
        const result = await this.#commandWithId(
          'channels.dingtalk.executionConsole.agentRun.cancel',
          stableCommandId('dingtalk-execution-stop', callback.appKey, callback.messageId),
          {
            callbackEventId: callback.messageId,
            appId: callback.appKey,
            externalMessageId: outTrackId,
            agentRunId,
            ...operator
          },
          false
        )
        if (result.status === 'rejected') return
        this.#hostPump.wake()
        const terminalStatus = executionTerminalStatus(result.payload.status)
        if (!state || !terminalStatus) return
        state.latestSource = {
          ...state.latestSource,
          run: {
            ...state.latestSource.run,
            status: terminalStatus,
            waitReason: null
          },
          state: 'terminal_pending'
        }
        const params = executionCardParams(state.latestSource, state)
        await this.#apis.get(callback.appKey)?.updateCard(outTrackId, params)
        state.lastCardDigest = digest(JSON.stringify(params))
        return
      }
      if (typeof value.visible !== 'boolean') return
      const authorized = await this.#commandWithId(
        'channels.dingtalk.executionConsole.recentOutput.authorize',
        randomUUID(),
        {
          agentRunId,
          appId: callback.appKey,
          externalMessageId: outTrackId,
          ...operator
        },
        false
      )
      if (authorized.status === 'rejected') return
      const sequence = authorized.payload.snapshotSequence
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) return
      const current = await this.#dependencies.core.request<DingTalkExecutionConsoleSource | null>(
        'channels.executionConsole.source',
        { agentRunId, expectedSequence: sequence }
      )
      if (!current || current.targetAppId !== callback.appKey
        || current.externalMessageId !== outTrackId) return
      const nextState = state ?? {
        agentRunId,
        targetAppId: current.targetAppId,
        externalMessageId: current.externalMessageId,
        executionViewUrl: null,
        recentOutputVisible: false,
        latestSource: current,
        lastCardDigest: null
      }
      this.#executionCardStates.set(agentRunId, nextState)
      nextState.latestSource = current
      nextState.recentOutputVisible = value.visible
      const params = executionCardParams(current, nextState)
      await this.#apis.get(callback.appKey)?.updateCard(outTrackId, params)
      nextState.lastCardDigest = digest(JSON.stringify(params))
    })
  }

  async #pumpOnce(): Promise<boolean> {
    if (this.#stopped) return false
    const snapshot = await this.#snapshot()
    if (Date.now() >= this.#nextRosterSweepAt) {
      this.#nextRosterSweepAt = Date.now() + ROSTER_SWEEP_MS
      const conversations = new Map(snapshot.transportConversations.map((conversation) => [
        `${conversation.tenantKey}\0${conversation.chatId}`,
        conversation
      ]))
      await Promise.allSettled([...conversations.values()].map((conversation) => (
        this.#reconcileKnownGroup(conversation.tenantKey, conversation.chatId, snapshot)
      )))
    }
    for (const aggregate of snapshot.pendingAggregates) {
      await this.#finalize(aggregate.aggregateId).catch(() => undefined)
    }
    const tick = await this.#dependencies.core.request<{
      deliveries: ClaimedDelivery[]
      hasOutstandingWork: boolean
    }>('channels.dingtalk.host.tick', {
      workerId: WORKER_ID,
      limit: 20
    })
    const deliveries = Array.isArray(tick.deliveries)
      ? tick.deliveries
      : []
    for (const delivery of deliveries) await this.#deliver(delivery)
    return tick.hasOutstandingWork === true || deliveries.length > 0
  }

  async #deliver(delivery: ClaimedDelivery): Promise<void> {
    if (delivery.deliveryKind === 'execution_console_upsert') {
      const agentRunId = requiredPayloadString(delivery.payload, 'agentRunId')
      return this.#enqueueExecutionCard(agentRunId, () => this.#deliverNow(delivery, agentRunId))
    }
    if (delivery.deliveryKind === 'execution_console_recall') {
      const state = this.#executionCardStateForMessage(
        delivery.targetAppId,
        delivery.updateMessageId
      )
      const queueKey = state?.agentRunId
        ?? `recall:${delivery.targetAppId}:${delivery.updateMessageId ?? delivery.deliveryId}`
      return this.#enqueueExecutionCard(queueKey, () => this.#deliverNow(
        delivery,
        state?.agentRunId ?? null
      ))
    }
    return this.#deliverNow(delivery, null)
  }

  async #deliverNow(
    delivery: ClaimedDelivery,
    executionAgentRunId: string | null
  ): Promise<void> {
    const snapshot = await this.#snapshot()
    const bot = snapshot.memberBots.find((candidate) => candidate.appKey === delivery.targetAppId)
    const api = this.#apis.get(delivery.targetAppId)
    if (!bot || !api || bot.credentialRef !== delivery.credentialRef) {
      await this.#settle(delivery, null, 'dingtalk_target_bot_not_connected')
      return
    }
    let cardFallback: { title: string; text: string } | null = null
    try {
      let externalId = delivery.updateMessageId
      if (delivery.deliveryKind === 'agent_output') {
        const body = requiredPayloadString(delivery.payload, 'body')
        const title = bot.botDisplayName
        externalId = delivery.conversationKind === 'group'
          ? await api.sendGroupMarkdown({
            openConversationId: delivery.chatId,
            robotCode: bot.robotCode,
            title,
            text: body,
            atUserIds: delivery.payload.mentionPrincipal === true && delivery.recipientOpenId
              ? [delivery.recipientOpenId] : []
          })
          : await api.sendPrivateMarkdown({
            robotCode: bot.robotCode,
            userId: delivery.recipientOpenId ?? delivery.chatId,
            title,
            text: body
          })
      } else if (delivery.deliveryKind === 'agent_attachment') {
        throw new Error('dingtalk_attachment_delivery_not_supported')
      } else if (delivery.deliveryKind === 'project_selection') {
        const operation = String(delivery.payload.operation ?? 'send')
        const params = projectCardParams(delivery.payload, operation === 'recall')
        if (externalId) await api.updateCard(externalId, params)
        else {
          externalId = dingtalkOutTrackId('bind', delivery.deliveryId)
          await api.createAndDeliverCard({
            outTrackId: externalId,
            openSpaceId: delivery.conversationKind === 'group'
              ? `dtv1.card//IM_GROUP.${delivery.chatId}`
              : `dtv1.card//IM_ROBOT.${delivery.recipientOpenId ?? delivery.chatId}`,
            robotCode: bot.robotCode,
            space: delivery.conversationKind,
            cardParamMap: params
          })
        }
      } else if (delivery.deliveryKind === 'execution_console_recall') {
        if (executionAgentRunId) {
          const state = this.#executionCardStates.get(executionAgentRunId)
          this.#dependencies.executionView?.revokeExecutionViewUrl(state?.executionViewUrl ?? null)
          this.#executionCardStates.delete(executionAgentRunId)
        }
        if (externalId) {
          await api.updateCard(externalId, dingtalkCardParams({
            title: bot.botDisplayName,
            content: '此执行记录已结束。',
            flowStatus: '3'
          }))
        }
      } else if (delivery.deliveryKind === 'execution_console_upsert') {
        const source = await this.#dependencies.core.request<DingTalkExecutionConsoleSource | null>(
          'channels.executionConsole.source',
          {
            agentRunId: requiredPayloadString(delivery.payload, 'agentRunId'),
            expectedSequence: Number(delivery.payload.expectedSequence)
          }
        )
        if (source && source.targetAppId !== delivery.targetAppId) {
          throw new Error('execution_console_target_app_mismatch')
        }
        if (source) {
          let state = this.#executionCardStates.get(source.agentRunId)
          if (!state) {
            state = {
              agentRunId: source.agentRunId,
              targetAppId: source.targetAppId,
              externalMessageId: externalId,
              executionViewUrl: externalId ? null : await this.#dependencies.executionView
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
          const params = executionCardParams(source, state)
          const cardDigest = digest(JSON.stringify(params))
          if (externalId) {
            if (state.lastCardDigest !== cardDigest) await api.updateCard(externalId, params)
          } else {
            externalId = dingtalkOutTrackId('run', delivery.deliveryId)
            await api.createAndDeliverCard({
              outTrackId: externalId,
              openSpaceId: delivery.conversationKind === 'group'
                ? `dtv1.card//IM_GROUP.${delivery.chatId}`
                : `dtv1.card//IM_ROBOT.${delivery.recipientOpenId ?? delivery.chatId}`,
              robotCode: bot.robotCode,
              space: delivery.conversationKind,
              cardParamMap: params
            })
          }
          state.externalMessageId = externalId
          state.lastCardDigest = cardDigest
        }
      } else {
        const closed = delivery.payload.action === 'recall'
        cardFallback = {
          title: delivery.deliveryKind === 'attention' ? 'Rovai 需要你确认' : 'Rovai',
          text: closed ? '状态已结束。' : String(delivery.payload.text ?? '状态已更新')
        }
        const params = dingtalkCardParams({
          title: delivery.deliveryKind === 'attention' ? 'Rovai 需要你确认' : 'Rovai 已接收',
          content: closed ? '状态已结束。' : String(delivery.payload.text ?? '状态已更新'),
          flowStatus: closed ? '3' : '1'
        })
        if (externalId) await api.updateCard(externalId, params)
        else {
          externalId = dingtalkOutTrackId('status', delivery.deliveryId)
          await api.createAndDeliverCard({
            outTrackId: externalId,
            openSpaceId: delivery.conversationKind === 'group'
              ? `dtv1.card//IM_GROUP.${delivery.chatId}`
              : `dtv1.card//IM_ROBOT.${delivery.recipientOpenId ?? delivery.chatId}`,
            robotCode: bot.robotCode,
            space: delivery.conversationKind,
            cardParamMap: params
          })
        }
      }
      await this.#settle(delivery, externalId ?? null, null)
    } catch (error) {
      if (cardFallback && !delivery.updateMessageId) {
        try {
          const externalId = delivery.conversationKind === 'group'
            ? await api.sendGroupMarkdown({
              openConversationId: delivery.chatId,
              robotCode: bot.robotCode,
              title: cardFallback.title,
              text: cardFallback.text
            })
            : await api.sendPrivateMarkdown({
              robotCode: bot.robotCode,
              userId: delivery.recipientOpenId ?? delivery.chatId,
              title: cardFallback.title,
              text: cardFallback.text
            })
          await this.#settle(delivery, externalId, null)
          return
        } catch { /* settle the original card failure below */ }
      }
      await this.#settle(delivery, null, failureCode(error))
    }
  }

  async #reconcileKnownGroup(
    tenantKey: string,
    chatId: string,
    snapshot: CoreDingTalkSnapshot
  ): Promise<void> {
    let remoteRobotCodes: Set<string> | null = null
    for (const bot of snapshot.memberBots.filter((candidate) => candidate.status === 'published')) {
      const api = this.#apis.get(bot.appKey)
      if (!api) continue
      try {
        remoteRobotCodes = new Set(await api.groupRobotCodes(chatId))
        break
      } catch { /* try another Bot that may still be in the group */ }
    }
    if (!remoteRobotCodes) throw new Error('dingtalk_group_roster_unavailable')
    const presentAppIds = presentDingTalkAppIds(snapshot.memberBots, remoteRobotCodes)
    await this.#command('channels.dingtalk.roster.reconcile', {
      provider: 'dingtalk',
      tenantKey,
      chatId,
      presentAppIds
    })
  }

  async #settle(delivery: ClaimedDelivery, messageId: string | null, error: string | null): Promise<void> {
    const result = await this.#command('channels.dingtalk.deliveries.settle', {
      deliveryId: delivery.deliveryId,
      workerId: WORKER_ID,
      outcome: error ? 'failed' : 'sent',
      externalDeliveryMessageId: messageId,
      failureCode: error,
      retryable: error ? /timeout|rate|connected|network/u.test(error) : false
    }, false)
    this.#hostPump.wake()
    const availableAt = result.payload.availableAt
    if (typeof availableAt === 'string') this.#hostPump.wakeAt(availableAt)
  }

  async #snapshot(): Promise<CoreDingTalkSnapshot> {
    return this.#dependencies.core.request('channels.dingtalk.snapshot', {})
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
  ): DingTalkExecutionCardPresentationState | null {
    if (!externalMessageId) return null
    return [...this.#executionCardStates.values()].find((state) => (
      state.targetAppId === targetAppId && state.externalMessageId === externalMessageId
    )) ?? null
  }

  async #command(
    method: Parameters<CoreClient['request']>[0],
    command: object,
    throwOnRejected = true
  ): Promise<StoredCommandResult> {
    return this.#commandWithId(method, randomUUID(), command, throwOnRejected)
  }

  async #commandWithId(
    method: Parameters<CoreClient['request']>[0],
    commandId: string,
    command: object,
    throwOnRejected = true
  ): Promise<StoredCommandResult> {
    const result = await this.#dependencies.core.request<StoredCommandResult>(method, {
      commandId,
      command
    })
    if (throwOnRejected && result.status === 'rejected') throw new Error(result.code)
    return result
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}

function provisioningView(
  intent: DingTalkPublicationIntent,
  stage: MemberBotProvisioningView['stage'],
  detail: string
): MemberBotProvisioningView {
  return {
    publicationIntentId: intent.publicationIntentId,
    agentId: intent.agentId,
    stage,
    detail,
    remoteAppId: intent.remoteUnifiedAppId,
    failureCode: intent.failureCode
  }
}

export function shouldAdvanceDingTalkPublicationStep(
  current: Pick<DingTalkPublicationIntent, 'state' | 'lastCompletedStep'>,
  step: DingTalkPublicationStep
): boolean {
  const recovering = current.state.startsWith('failed_')
  const durableState = recovering ? current.lastCompletedStep : current.state
  const durableRank = STEP_RANK[durableState as DingTalkPublicationState] ?? STEP_RANK.created
  const nextRank = STEP_RANK[step]
  // The first replayed step at the durable watermark must clear a recoverable
  // failure back into the normal state machine. Earlier replayed read-backs
  // remain no-ops; an ordinary non-failed intent never rewrites the same step.
  return recovering ? durableRank <= nextRank : durableRank < nextRank
}

function provisioningForStep(
  intent: DingTalkPublicationIntent,
  step: DingTalkPublicationStep,
  facts: DingTalkProvisioningFacts
): MemberBotProvisioningView {
  const [stage, detail]: [MemberBotProvisioningView['stage'], string] = step === 'account_verified'
    ? ['verifying_session', '钉钉账号已确认。']
    : step === 'app_created' ? ['creating_app', '应用已创建，正在冻结应用身份…']
      : step === 'credentials_read' ? ['activating_app', '正在保存应用凭据…']
        : step === 'avatar_configured' ? ['activating_app', '正在配置队员头像…']
          : step === 'robot_configured' ? ['configuring_permissions', '正在配置 Stream Bot…']
            : step === 'permissions_configured' ? ['waiting_configuration', '权限与事件已配置。']
              : step === 'version_created' ? ['publishing_version', '应用版本已创建。']
                : step === 'version_released' ? ['verifying_configuration', '版本已发布。']
                  : ['waiting_configuration', '正在等待钉钉审批…']
  return {
    ...provisioningView(intent, stage, detail),
    remoteAppId: facts.unifiedAppId ?? intent.remoteUnifiedAppId,
    failureCode: null
  }
}

export function projectCardParams(
  payload: Record<string, unknown>,
  closed: boolean
): Record<string, string> {
  if (closed) return dingtalkCardParams({
    title: '选择 Rovai 项目',
    content: '此项目选择已结束。',
    flowStatus: '3'
  })
  const pendingBindingId = String(payload.pendingBindingId ?? '')
  const expectedVersion = Number(payload.expectedVersion ?? 1)
  const nonce = String(payload.nonce ?? '')
  const projects = Array.isArray(payload.projectOptions) ? payload.projectOptions : []
  const buttons: DingTalkCardButton[] = projects.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const project = item as Record<string, unknown>
    const projectId = String(project.projectId ?? '')
    const title = String(project.displayName ?? '')
    if (!projectId || !title) return []
    return [{
      title,
      value: { pendingBindingId, expectedVersion, nonce, action: 'bind', projectId }
    }]
  })
  buttons.push({
    title: '开始快速对话',
    value: { pendingBindingId, expectedVersion, nonce, action: 'quick_chat' }
  })
  buttons.push({
    title: '刷新项目',
    value: { pendingBindingId, expectedVersion, nonce, action: 'refresh' }
  })
  return dingtalkCardParams({
    title: '选择 Rovai 项目',
    content: projects.length
      ? projects.length > 6
        ? '选择最近使用的项目，或直接开始快速对话。更多项目可在 Rovai 打开后刷新。'
        : '选择一个项目，或直接开始快速对话。'
      : '当前没有可用项目，可以直接开始快速对话。',
    buttons,
    flowStatus: '2'
  })
}

export function executionCardParams(
  source: DingTalkExecutionConsoleSource,
  state: Pick<DingTalkExecutionCardPresentationState,
    'executionViewUrl' | 'recentOutputVisible'>
): Record<string, string> {
  const terminal = executionStatusIsTerminal(source.run.status)
  const buttons: DingTalkCardButton[] = [{
    title: state.recentOutputVisible ? '收起最近输出' : '显示最近输出',
    value: {
      action: 'execution_recent_output',
      agentRunId: source.agentRunId,
      visible: !state.recentOutputVisible
    }
  }]
  if (state.executionViewUrl) {
    buttons.push({ title: '打开执行台', url: state.executionViewUrl })
  }
  if (!terminal) {
    buttons.push({
      title: '停止执行',
      value: { action: 'execution_stop', agentRunId: source.agentRunId }
    })
  }
  const recent = state.recentOutputVisible ? executionRecentOutputItems(source) : []
  return dingtalkCardParams({
    title: `${boundedText(source.agentDisplayName, 80)} · ${executionStateTitle(source.run)}`,
    content: state.recentOutputVisible
      ? recent.join('\n\n') || '暂无公开执行记录。'
      : null,
    buttons,
    flowStatus: source.run.status === 'failed' ? '5'
      : terminal ? '3'
        : source.run.status === 'waiting' || source.run.waitReason ? '2'
          : '1'
  })
}

function executionTerminalStatus(
  value: unknown
): 'succeeded' | 'failed' | 'cancelled' | null {
  return value === 'succeeded' || value === 'failed' || value === 'cancelled'
    ? value
    : null
}

function boundedText(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim())
  return characters.length <= maxCharacters
    ? characters.join('')
    : `${characters.slice(0, maxCharacters - 1).join('')}…`
}

export function dingtalkCardCallbackValue(
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  return findDingTalkCardCallbackValue(payload, new Set())
}

function findDingTalkCardCallbackValue(
  candidate: unknown,
  seen: Set<unknown>
): Record<string, unknown> | null {
  if (typeof candidate === 'string') {
    const decoded = decodeDingTalkCardActionId(candidate)
    if (decoded && isDingTalkCardCallbackValue(decoded)) return decoded
    if (candidate.length > 32_768 || !/^[\s]*[\[{]/u.test(candidate)) return null
    try {
      return findDingTalkCardCallbackValue(JSON.parse(candidate), seen)
    } catch {
      return null
    }
  }
  if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) return null
  seen.add(candidate)
  if (!Array.isArray(candidate)) {
    const value = candidate as Record<string, unknown>
    if (isDingTalkCardCallbackValue(value)) return value
  }
  const children = Array.isArray(candidate) ? candidate : Object.values(candidate)
  for (const child of children) {
    const found = findDingTalkCardCallbackValue(child, seen)
    if (found) return found
  }
  return null
}

function isDingTalkCardCallbackValue(value: Record<string, unknown>): boolean {
  return 'pendingBindingId' in value || 'agentRunId' in value
}

function recursiveString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null
  if (!Array.isArray(value)) {
    const direct = (value as Record<string, unknown>)[key]
    if (typeof direct === 'string' && direct.trim()) return direct.trim()
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = recursiveString(child, key)
    if (found) return found
  }
  return null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function requiredPayloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`dingtalk_delivery_${key}_missing`)
  return value
}

function credentialRefFor(agentId: string, unifiedAppId: string): string {
  return `dingtalk-${createHash('sha256').update(`${agentId}\0${unifiedAppId}`).digest('hex').slice(0, 40)}`
}

function dingtalkConnectionAccount(identity: DingTalkDeveloperIdentity): {
  accountId: string
  userIdDigest: string
  corpId: string
  userName: string
  corpName: string
  oauthProfileRef: string
} {
  return {
    accountId: identity.accountId,
    userIdDigest: identity.userIdDigest,
    corpId: identity.corpId,
    userName: identity.userName,
    corpName: identity.corpName,
    oauthProfileRef: identity.oauthProfileRef
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

function pendingDingTalkConnection(
  service: DingTalkDeveloperSessionService
): ReturnType<NonNullable<DingTalkDeveloperSessionService['pendingConnection']>> {
  if (!service.pendingConnection) throw new Error('dingtalk_login_pending_session_missing')
  return service.pendingConnection()
}

async function activatePendingDingTalkLogin(
  service: DingTalkDeveloperSessionService,
  revision: number
): Promise<void> {
  if (!service.activatePendingLogin) throw new Error('dingtalk_login_pending_session_missing')
  await service.activatePendingLogin(revision)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function stableCommandId(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function digestNamespaced(namespace: string, value: string): string {
  return `sha256:${createHash('sha256').update(namespace).update('\0').update(value).digest('hex')}`
}

function failureCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message.split(':')[0] : 'dingtalk_unknown'
}
