import { readFile } from 'node:fs/promises'
import rovaiMemberBotIconPath from '../../../../build/icon.png?asset'
import type {
  FeishuDeveloperPortalSession,
  FeishuDeveloperSessionService,
  FeishuOpenPlatformSession
} from './feishu-developer-session'
import {
  FeishuOpenPlatformApiError,
  OpenPlatformApiClient,
  type FeishuMemberBotAppCreationMode,
  type FeishuMemberBotConsoleConfiguration,
  type FeishuMemberBotVerificationRequirements,
  type FeishuPublishedVersionSummary
} from './feishu-open-platform-api'

export type MemberBotProvisioningStep =
  | 'session_verified'
  | 'app_created'
  | 'activation_started'
  | 'activation_published'
  | 'configuration_started'
  | 'configuration_waiting'
  | 'configuration_verified'
  | 'version_published'
  | 'online_verified'

export interface MemberBotAvatarSource {
  pngBytes?: Uint8Array
  width?: number
  height?: number
}

export interface ProvisionedMemberBot {
  appId: string
  appSecret: string
  botOpenId?: string
  botDisplayName: string
  publishedVersionId: string | null
}

export interface ReconcileMemberBotInput {
  publicationIntentId: string
  agentId: string
  remoteAppId: string
  appName: string
  appDescription: string
  avatarSource?: MemberBotAvatarSource
  expectedDeveloperIdentity: {
    userId: string
    tenantId: string
  }
  signal?: AbortSignal
  onProgress?(step: MemberBotProvisioningStep, remoteAppId?: string): void
}

export interface FeishuMemberBotProvisioner {
  create(input: {
    publicationIntentId: string
    agentId: string
    appName: string
    appDescription: string
    avatarSource?: MemberBotAvatarSource
    expectedDeveloperIdentity: {
      userId: string
      tenantId: string
    }
    signal?: AbortSignal
    onProgress?(step: MemberBotProvisioningStep, remoteAppId?: string): void
    onRemoteAppCreated?(input: {
      appId: string
      creationMode: FeishuMemberBotAppCreationMode
    }): Promise<void>
  }): Promise<ProvisionedMemberBot>
  reconcile?(input: ReconcileMemberBotInput): Promise<ProvisionedMemberBot>
}

const MEMBER_BOT_MANIFEST_REQUIREMENTS = {
  scopes: {
    tenant: [
      'im:message',
      'im:message.p2p_msg:readonly',
      'im:message.group_at_msg:readonly',
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
} as const

type AvatarPng = {
  pngBytes: Uint8Array
  width: number
  height: number
}

type OpenPlatformClient = Pick<
OpenPlatformApiClient,
  | 'uploadAppIcon'
  | 'createApp'
  | 'readAppSecret'
  | 'enableBot'
  | 'requestEventLongConnection'
  | 'configureScopes'
  | 'configureEvents'
  | 'configureCallbacksAndWebSocket'
  | 'createVersion'
  | 'publishVersion'
  | 'findPublishedVersion'
  | 'findVersion'
  | 'verifyMemberBot'
>

type WebSessionProvisionerOptions = {
  createClient?: (session: FeishuOpenPlatformSession) => OpenPlatformClient
  readDefaultAvatar?: () => Promise<AvatarPng>
}

export class FeishuWebSessionMemberBotProvisioner implements FeishuMemberBotProvisioner {
  readonly #developerSession: FeishuDeveloperPortalSession
  readonly #createClient: (session: FeishuOpenPlatformSession) => OpenPlatformClient
  readonly #readDefaultAvatar: () => Promise<AvatarPng>

  constructor(
    developerSession: FeishuDeveloperPortalSession,
    options: WebSessionProvisionerOptions = {}
  ) {
    this.#developerSession = developerSession
    this.#createClient = options.createClient ?? ((session) => new OpenPlatformApiClient(session))
    this.#readDefaultAvatar = options.readDefaultAvatar ?? readDefaultAvatar
  }

  async create(input: Parameters<FeishuMemberBotProvisioner['create']>[0]): Promise<ProvisionedMemberBot> {
    if (input.signal?.aborted) throw provisioningError('feishu_provisioning_cancelled', 'none')
    const identity = await this.#developerSession.requireExpectedIdentity(
      input.expectedDeveloperIdentity
    )
    input.onProgress?.('session_verified')

    let remoteAppId: string | null = null
    let remoteAppFrozen = false
    let platformSessionOpened = false
    let sessionPersisted = false
    try {
      const platformSession = await this.#developerSession.openPlatformSession({
        expectedIdentity: input.expectedDeveloperIdentity,
        signal: input.signal
      })
      platformSessionOpened = true
      if (platformSession.brand !== identity.brand) {
        throw provisioningError('feishu_developer_identity_changed', 'none')
      }
      const client = this.#createClient(platformSession)
      const avatar = input.avatarSource?.pngBytes
        ? requireAvatarSource(input.avatarSource)
        : await this.#readDefaultAvatar()
      const avatarUrl = await client.uploadAppIcon({ ...avatar, signal: input.signal })
      const appName = consoleAppName(input.appName)
      const created = await client.createApp({
        appName,
        appDescription: input.appDescription,
        avatarUrl,
        correlationId: input.publicationIntentId,
        signal: input.signal
      })
      remoteAppId = created.appId
      try {
        if (!input.onRemoteAppCreated) {
          throw new Error('feishu_publication_app_freeze_unavailable')
        }
        await input.onRemoteAppCreated({
          appId: remoteAppId,
          creationMode: created.creationMode
        })
      } catch (error) {
        throw provisioningError(
          provisioningErrorCode(error, 'feishu_publication_app_freeze_failed'),
          'create_outcome_unknown'
        )
      }
      remoteAppFrozen = true
      input.onProgress?.('app_created', remoteAppId)

      const appSecret = await client.readAppSecret(remoteAppId, input.signal)
      input.onProgress?.('activation_started', remoteAppId)
      await client.enableBot(remoteAppId, input.signal)
      await client.requestEventLongConnection(remoteAppId, input.signal)

      const activationVersionId = await client.createVersion({
        appId: remoteAppId,
        ownerUserId: identity.userId,
        appVersion: '1.0.0',
        remark: '启用飞书队员 Bot',
        changeLog: '启用 Bot 并请求长连接事件模式。',
        reuseExisting: true,
        signal: input.signal
      })
      const activationPublished = await client.publishVersion(
        remoteAppId,
        activationVersionId,
        input.signal
      )
      let publishedVersion: FeishuPublishedVersionSummary = {
        ...activationPublished,
        appVersion: '1.0.0'
      }
      input.onProgress?.('activation_published', remoteAppId)

      const configuration: FeishuMemberBotConsoleConfiguration = {
        appName,
        appDescription: input.appDescription,
        avatarUrl: created.avatarUrl,
        tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
        tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
      }
      input.onProgress?.('configuration_started', remoteAppId)
      const scopes = await client.configureScopes(
        remoteAppId,
        configuration,
        input.signal
      )
      input.onProgress?.('configuration_waiting', remoteAppId)
      const events = await client.configureEvents(
        remoteAppId,
        configuration,
        input.signal
      )
      const callbacks = await client.configureCallbacksAndWebSocket(
        remoteAppId,
        configuration,
        input.signal
      )
      if (scopes.changed || events.changed || callbacks.changed) {
        input.onProgress?.('configuration_verified', remoteAppId)
        const finalAppVersion = incrementPatchVersion(publishedVersion.appVersion)
        const finalVersionId = await client.createVersion({
          appId: remoteAppId,
          ownerUserId: identity.userId,
          appVersion: finalAppVersion,
          remark: '发布飞书 Bot 最终配置',
          changeLog: '发布已生效的消息权限、事件订阅与长连接配置。',
          reuseExisting: true,
          signal: input.signal
        })
        publishedVersion = {
          ...(await client.publishVersion(remoteAppId, finalVersionId, input.signal)),
          appVersion: finalAppVersion
        }
      }
      input.onProgress?.('version_published', remoteAppId)
      await client.verifyMemberBot({
        appId: remoteAppId,
        versionId: publishedVersion.versionId,
        configuration,
        signal: input.signal
      })
      input.onProgress?.('online_verified', remoteAppId)
      await this.#developerSession.persist()
      sessionPersisted = true
      return {
        appId: remoteAppId,
        appSecret,
        botDisplayName: input.appName,
        publishedVersionId: publishedVersion.versionId
      }
    } catch (error) {
      if (isProvisioningError(error)) throw error
      const code = provisioningErrorCode(error, 'feishu_console_provisioning_failed')
      const remoteState: ProvisioningRemoteState = remoteAppFrozen
        ? 'known_frozen'
        : error instanceof FeishuOpenPlatformApiError && error.outcomeUnknown
          ? 'create_outcome_unknown'
          : 'none'
      throw provisioningError(code, remoteState)
    } finally {
      if (platformSessionOpened && !sessionPersisted) {
        await this.#developerSession.persist().catch(() => undefined)
      }
    }
  }

  async reconcile(input: ReconcileMemberBotInput): Promise<ProvisionedMemberBot> {
    if (input.signal?.aborted) {
      throw provisioningError('feishu_provisioning_cancelled', 'known_frozen')
    }
    const identity = await this.#developerSession.requireExpectedIdentity(
      input.expectedDeveloperIdentity
    )
    input.onProgress?.('session_verified', input.remoteAppId)

    let platformSessionOpened = false
    let sessionPersisted = false
    try {
      const platformSession = await this.#developerSession.openPlatformSession({
        expectedIdentity: input.expectedDeveloperIdentity,
        signal: input.signal
      })
      platformSessionOpened = true
      if (platformSession.brand !== identity.brand) {
        throw provisioningError('feishu_developer_identity_changed', 'none')
      }
      const client = this.#createClient(platformSession)
      input.onProgress?.('app_created', input.remoteAppId)
      const appSecret = await client.readAppSecret(input.remoteAppId, input.signal)
      input.onProgress?.('activation_started', input.remoteAppId)
      let publishedVersion: FeishuPublishedVersionSummary
      try {
        publishedVersion = await client.findPublishedVersion(
          input.remoteAppId,
          input.signal
        )
      } catch (error) {
        if (!isPublishedVersionMissingError(error)) throw error
        await client.enableBot(input.remoteAppId, input.signal)
        await client.requestEventLongConnection(input.remoteAppId, input.signal)
        const activationVersionId = await client.createVersion({
          appId: input.remoteAppId,
          ownerUserId: identity.userId,
          appVersion: '1.0.0',
          remark: '启用飞书队员 Bot',
          changeLog: '启用 Bot 并请求长连接事件模式。',
          reuseExisting: true,
          signal: input.signal
        })
        publishedVersion = {
          ...(await client.publishVersion(
            input.remoteAppId,
            activationVersionId,
            input.signal
          )),
          appVersion: '1.0.0'
        }
      }
      input.onProgress?.('activation_published', input.remoteAppId)

      const needsAvatarRepair = Boolean(
        input.avatarSource?.pngBytes && publishedVersion.appVersion === '1.0.0'
      )
      let needsReadinessRepair = false
      const verificationRequirements = {
        tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
        tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
      }
      if (!needsAvatarRepair) {
        try {
          await client.verifyMemberBot({
            appId: input.remoteAppId,
            versionId: publishedVersion.versionId,
            configuration: verificationRequirements,
            signal: input.signal
          })
        } catch (error) {
          if (!isRepairableMemberBotVerificationError(error)) throw error
          needsReadinessRepair = true
        }
      }
      let finalVerification: FeishuMemberBotVerificationRequirements = verificationRequirements
      if (needsAvatarRepair || needsReadinessRepair) {
        const avatar = input.avatarSource?.pngBytes
          ? requireAvatarSource(input.avatarSource)
          : await this.#readDefaultAvatar()
        const avatarUrl = await client.uploadAppIcon({ ...avatar, signal: input.signal })
        const configuration: FeishuMemberBotConsoleConfiguration = {
          appName: consoleAppName(input.appName),
          appDescription: input.appDescription,
          avatarUrl,
          tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
          tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
        }
        await client.enableBot(input.remoteAppId, input.signal)
        input.onProgress?.('configuration_started', input.remoteAppId)
        const scopes = await client.configureScopes(
          input.remoteAppId,
          configuration,
          input.signal
        )
        input.onProgress?.('configuration_waiting', input.remoteAppId)
        const events = await client.configureEvents(
          input.remoteAppId,
          configuration,
          input.signal
        )
        const callbacks = await client.configureCallbacksAndWebSocket(
          input.remoteAppId,
          configuration,
          input.signal
        )
        if (
          needsAvatarRepair
          || scopes.changed
          || events.changed
          || callbacks.changed
        ) {
          input.onProgress?.('configuration_verified', input.remoteAppId)
          const repairVersion = incrementPatchVersion(publishedVersion.appVersion)
          const repairVersionId = await client.createVersion({
            appId: input.remoteAppId,
            ownerUserId: identity.userId,
            appVersion: repairVersion,
            remark: needsReadinessRepair ? '修复飞书 Bot 接收配置' : '同步 Rovai 队员头像',
            changeLog: needsReadinessRepair
              ? '补全消息权限、事件订阅与长连接在线配置。'
              : '使用当前 Rovai 队员头像修正飞书 Bot 身份。',
            reuseExisting: true,
            signal: input.signal
          })
          publishedVersion = {
            ...(await client.publishVersion(input.remoteAppId, repairVersionId, input.signal)),
            appVersion: repairVersion
          }
        }
        finalVerification = configuration
      } else {
        const pendingAppVersion = incrementPatchVersion(publishedVersion.appVersion)
        const pendingVersion = await client.findVersion(
          input.remoteAppId,
          pendingAppVersion,
          input.signal
        )
        if (pendingVersion && pendingVersion.status !== 2) {
          input.onProgress?.('configuration_verified', input.remoteAppId)
          publishedVersion = {
            ...(await client.publishVersion(
              input.remoteAppId,
              pendingVersion.versionId,
              input.signal
            )),
            appVersion: pendingAppVersion
          }
        }
      }
      input.onProgress?.('version_published', input.remoteAppId)
      await client.verifyMemberBot({
        appId: input.remoteAppId,
        versionId: publishedVersion.versionId,
        configuration: finalVerification,
        signal: input.signal
      })
      input.onProgress?.('online_verified', input.remoteAppId)
      await this.#developerSession.persist()
      sessionPersisted = true
      return {
        appId: input.remoteAppId,
        appSecret,
        botDisplayName: input.appName,
        publishedVersionId: publishedVersion.versionId
      }
    } catch (error) {
      if (isProvisioningError(error)) {
        throw provisioningError(error.code, 'known_frozen')
      }
      throw provisioningError(
        provisioningErrorCode(error, 'feishu_console_reconciliation_failed'),
        'known_frozen'
      )
    } finally {
      if (platformSessionOpened && !sessionPersisted) {
        await this.#developerSession.persist().catch(() => undefined)
      }
    }
  }
}

export class UnavailableFeishuMemberBotProvisioner implements FeishuMemberBotProvisioner {
  async create(): Promise<ProvisionedMemberBot> {
    throw provisioningError('feishu_web_session_provisioning_unavailable', 'none')
  }
}

export class UnavailableFeishuDeveloperSessionService implements FeishuDeveloperSessionService {
  async beginLogin(): Promise<never> {
    throw new Error('feishu_developer_session_unavailable')
  }

  async inspect(): Promise<null> {
    return null
  }

  async requireExpectedIdentity(): Promise<never> {
    throw new Error('feishu_developer_session_unavailable')
  }

  async disconnect(): Promise<void> {}
}

export function isUnknownRemoteProvisioningError(error: unknown): boolean {
  return isProvisioningError(error) && error.remoteState === 'create_outcome_unknown'
}

export type ProvisioningRemoteState =
  | 'none'
  | 'known_frozen'
  | 'create_outcome_unknown'

type ProvisioningError = Error & { code: string; remoteState: ProvisioningRemoteState }

function provisioningError(
  code: string,
  remoteState: ProvisioningRemoteState
): ProvisioningError {
  const error = new Error(code) as ProvisioningError
  error.code = code
  error.remoteState = remoteState
  return error
}

function isProvisioningError(error: unknown): error is ProvisioningError {
  return error instanceof Error
    && typeof (error as Partial<ProvisioningError>).code === 'string'
    && ['none', 'known_frozen', 'create_outcome_unknown'].includes(
      (error as Partial<ProvisioningError>).remoteState ?? ''
    )
}

function provisioningErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return error instanceof Error && error.message ? error.message : fallback
}

function isRepairableMemberBotVerificationError(error: unknown): boolean {
  return error instanceof FeishuOpenPlatformApiError && [
    'feishu_console_avatar_verification_failed',
    'feishu_console_bot_verification_failed',
    'feishu_console_scope_catalog_missing',
    'feishu_console_scope_verification_failed',
    'feishu_console_event_verification_failed',
    'feishu_console_callback_verification_failed'
  ].includes(error.code)
}

function isPublishedVersionMissingError(error: unknown): boolean {
  return error instanceof FeishuOpenPlatformApiError
    && error.code === 'feishu_console_published_version_not_found'
}

function incrementPatchVersion(version: string): string {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(version)
  if (!match) throw provisioningError('feishu_console_app_version_invalid', 'known_frozen')
  const patch = Number(match[3]) + 1
  if (patch > 9_999) {
    throw provisioningError('feishu_console_app_version_invalid', 'known_frozen')
  }
  return `${match[1]}.${match[2]}.${patch}`
}

function consoleAppName(value: string): string {
  const normalized = value.trim()
  if (!normalized) return 'Rovai Bot'
  return [...normalized].length >= 2 ? normalized : `${normalized} Bot`
}

function requireAvatarSource(source: MemberBotAvatarSource): AvatarPng {
  if (
    !source.pngBytes
    || !Number.isInteger(source.width)
    || !Number.isInteger(source.height)
  ) throw provisioningError('feishu_member_bot_avatar_invalid', 'none')
  return {
    pngBytes: source.pngBytes,
    width: source.width as number,
    height: source.height as number
  }
}

async function readDefaultAvatar(): Promise<AvatarPng> {
  const bytes = await readFile(rovaiMemberBotIconPath)
  if (
    bytes.byteLength < 24
    || bytes[0] !== 0x89
    || bytes.toString('ascii', 1, 4) !== 'PNG'
  ) throw provisioningError('feishu_member_bot_default_avatar_invalid', 'none')
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return {
    pngBytes: new Uint8Array(bytes),
    width,
    height
  }
}
