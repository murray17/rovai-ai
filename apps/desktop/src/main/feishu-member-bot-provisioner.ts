import { readFile } from 'node:fs/promises'
import {
  AppType,
  Client,
  Domain,
  LoggerLevel
} from '@larksuiteoapi/node-sdk'
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
  type FeishuMemberBotConfigurationResult,
  type FeishuMemberBotConsoleConfiguration,
  type FeishuMemberBotVerificationRequirements,
  type FeishuPublishedVersionSummary,
  type FeishuVerifiedConfigurationState
} from './feishu-open-platform-api'
import { ProvisioningTimingRecorder } from './feishu-provisioning-timing'

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
  ownerOpenId: string
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
  timing?: ProvisioningTimingRecorder
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
    timing?: ProvisioningTimingRecorder
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
      'application:application:self_manage',
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
  | 'configureMemberBot'
  | 'createVersion'
  | 'publishVersion'
  | 'findPublishedVersion'
  | 'findVersion'
  | 'verifyMemberBot'
>

type WebSessionProvisionerOptions = {
  createClient?: (
    session: FeishuOpenPlatformSession,
    timing: ProvisioningTimingRecorder
  ) => OpenPlatformClient
  createOwnerIdentityClient?: (input: {
    brand: 'feishu' | 'lark'
    appId: string
    appSecret: string
  }) => OwnerIdentityClient
  readDefaultAvatar?: () => Promise<AvatarPng>
  resolveOwnerOpenId?: (input: {
    brand: 'feishu' | 'lark'
    appId: string
    appSecret: string
    signal?: AbortSignal
  }) => Promise<string>
}

type OwnerIdentityClient = {
  application: {
    v6: {
      application: {
        get(input: {
          path: { app_id: string }
          params: { lang: 'zh_cn'; user_id_type: 'open_id' }
        }): Promise<{
          code?: number
          data?: {
            app?: {
              app_id?: string
              creator_id?: string
            }
          }
        }>
      }
    }
  }
}

type OwnerIdentityClientFactory = NonNullable<
WebSessionProvisionerOptions['createOwnerIdentityClient']
>

export class FeishuWebSessionMemberBotProvisioner implements FeishuMemberBotProvisioner {
  readonly #developerSession: FeishuDeveloperPortalSession
  readonly #createClient: (
    session: FeishuOpenPlatformSession,
    timing: ProvisioningTimingRecorder
  ) => OpenPlatformClient
  readonly #readDefaultAvatar: () => Promise<AvatarPng>
  readonly #resolveOwnerOpenId: NonNullable<WebSessionProvisionerOptions['resolveOwnerOpenId']>

  constructor(
    developerSession: FeishuDeveloperPortalSession,
    options: WebSessionProvisionerOptions = {}
  ) {
    this.#developerSession = developerSession
    this.#createClient = options.createClient
      ?? ((session, timing) => new OpenPlatformApiClient(session, { timing }))
    this.#readDefaultAvatar = options.readDefaultAvatar ?? readDefaultAvatar
    this.#resolveOwnerOpenId = options.resolveOwnerOpenId ?? ((input) => resolveOwnerOpenId(
      input,
      options.createOwnerIdentityClient
    ))
  }

  async create(input: Parameters<FeishuMemberBotProvisioner['create']>[0]): Promise<ProvisionedMemberBot> {
    if (input.signal?.aborted) throw provisioningError('feishu_provisioning_cancelled', 'none')
    const timing = input.timing ?? new ProvisioningTimingRecorder({
      publicationIntentId: input.publicationIntentId,
      agentId: input.agentId,
      recovering: false
    })
    const identity = await timing.measure('identity_verify_ms', () => (
      this.#developerSession.requireExpectedIdentity(input.expectedDeveloperIdentity)
    ))
    input.onProgress?.('session_verified')

    let remoteAppId: string | null = null
    let remoteAppFrozen = false
    let platformSessionOpened = false
    let sessionPersisted = false
    try {
      const platformSession = await timing.measure('session_open_ms', () => (
        this.#developerSession.openPlatformSession({
          expectedIdentity: input.expectedDeveloperIdentity,
          signal: input.signal
        })
      ))
      platformSessionOpened = true
      if (platformSession.brand !== identity.brand) {
        throw provisioningError('feishu_developer_identity_changed', 'none')
      }
      const client = this.#createClient(platformSession, timing)
      const avatar = input.avatarSource?.pngBytes
        ? requireAvatarSource(input.avatarSource)
        : await this.#readDefaultAvatar()
      const avatarUrl = await timing.measure('avatar_upload_ms', () => (
        client.uploadAppIcon({ ...avatar, signal: input.signal })
      ))
      const appName = consoleAppName(input.appName)
      const created = await timing.measure('template_create_ms', async () => {
        const result = await client.createApp({
          appName,
          appDescription: input.appDescription,
          avatarUrl,
          correlationId: input.publicationIntentId,
          signal: input.signal
        })
        timing.setCreationMode(result.creationMode)
        return result
      })
      const appId = created.appId
      remoteAppId = appId
      timing.setAppId(appId)
      try {
        if (!input.onRemoteAppCreated) {
          throw new Error('feishu_publication_app_freeze_unavailable')
        }
        await input.onRemoteAppCreated({
          appId,
          creationMode: created.creationMode
        })
      } catch (error) {
        throw provisioningError(
          provisioningErrorCode(error, 'feishu_publication_app_freeze_failed'),
          'create_outcome_unknown'
        )
      }
      remoteAppFrozen = true
      input.onProgress?.('app_created', appId)

      const appSecret = await client.readAppSecret(appId, input.signal)
      input.onProgress?.('activation_started', appId)
      const activationPublished = await timing.measure('activation_publish_ms', async () => {
        await client.enableBot(appId, input.signal)
        await client.requestEventLongConnection(appId, input.signal)
        const activationVersionId = await client.createVersion({
          appId,
          ownerUserId: identity.userId,
          appVersion: '1.0.0',
          remark: '启用飞书队员 Bot',
          changeLog: '启用 Bot 并请求长连接事件模式。',
          reuseExisting: true,
          signal: input.signal
        })
        return client.publishVersion(appId, activationVersionId, input.signal)
      })
      let publishedVersion: FeishuPublishedVersionSummary = {
        ...activationPublished,
        appVersion: '1.0.0'
      }
      input.onProgress?.('activation_published', appId)

      const configuration: FeishuMemberBotConsoleConfiguration = {
        appName,
        appDescription: input.appDescription,
        avatarUrl: created.avatarUrl,
        tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
        tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
      }
      input.onProgress?.('configuration_started', appId)
      const configurationResult = await client.configureMemberBot(
        appId,
        configuration,
        input.signal,
        () => input.onProgress?.('configuration_waiting', appId)
      )
      if (configurationResult.changed) {
        input.onProgress?.('configuration_verified', appId)
        publishedVersion = await timing.measure('final_publish_ms', async () => {
          const finalAppVersion = incrementPatchVersion(publishedVersion.appVersion)
          const finalVersionId = await client.createVersion({
            appId,
            ownerUserId: identity.userId,
            appVersion: finalAppVersion,
            remark: '发布飞书 Bot 最终配置',
            changeLog: '发布已生效的消息权限、事件订阅与长连接配置。',
            reuseExisting: true,
            signal: input.signal
          })
          return {
            ...(await client.publishVersion(appId, finalVersionId, input.signal)),
            appVersion: finalAppVersion
          }
        })
      } else {
        timing.recordSkipped('final_publish_ms')
      }
      input.onProgress?.('version_published', appId)
      await timing.measure('final_verify_ms', () => client.verifyMemberBot({
        appId,
        versionId: publishedVersion.versionId,
        configuration,
        verifiedConfiguration: configurationResult.verified,
        signal: input.signal
      }))
      const ownerOpenId = await timing.measure('owner_identity_ms', () => (
        this.#resolveOwnerOpenId({
          brand: identity.brand,
          appId,
          appSecret,
          signal: input.signal
        })
      ))
      input.onProgress?.('online_verified', appId)
      await this.#developerSession.persist()
      sessionPersisted = true
      return {
        appId,
        appSecret,
        ownerOpenId,
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
    const timing = input.timing ?? new ProvisioningTimingRecorder({
      publicationIntentId: input.publicationIntentId,
      agentId: input.agentId,
      appId: input.remoteAppId,
      recovering: true
    })
    timing.setAppId(input.remoteAppId)
    timing.recordSkipped('template_create_ms')
    const identity = await timing.measure('identity_verify_ms', () => (
      this.#developerSession.requireExpectedIdentity(input.expectedDeveloperIdentity)
    ))
    input.onProgress?.('session_verified', input.remoteAppId)

    let platformSessionOpened = false
    let sessionPersisted = false
    try {
      const platformSession = await timing.measure('session_open_ms', () => (
        this.#developerSession.openPlatformSession({
          expectedIdentity: input.expectedDeveloperIdentity,
          signal: input.signal
        })
      ))
      platformSessionOpened = true
      if (platformSession.brand !== identity.brand) {
        throw provisioningError('feishu_developer_identity_changed', 'none')
      }
      const client = this.#createClient(platformSession, timing)
      input.onProgress?.('app_created', input.remoteAppId)
      const appSecret = await client.readAppSecret(input.remoteAppId, input.signal)
      input.onProgress?.('activation_started', input.remoteAppId)
      let publishedVersion: FeishuPublishedVersionSummary
      try {
        publishedVersion = await client.findPublishedVersion(
          input.remoteAppId,
          input.signal
        )
        timing.recordSkipped('activation_publish_ms')
      } catch (error) {
        if (!isPublishedVersionMissingError(error)) throw error
        publishedVersion = await timing.measure('activation_publish_ms', async () => {
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
          return {
            ...(await client.publishVersion(
              input.remoteAppId,
              activationVersionId,
              input.signal
            )),
            appVersion: '1.0.0'
          }
        })
      }
      input.onProgress?.('activation_published', input.remoteAppId)

      const needsAvatarRepair = Boolean(
        input.avatarSource?.pngBytes && publishedVersion.appVersion === '1.0.0'
      )
      let needsReadinessRepair = false
      let avatarTimingRecorded = false
      let finalPublishTimingRecorded = false
      let alreadyVerifiedVersionId: string | null = null
      let verifiedConfiguration: FeishuVerifiedConfigurationState | undefined
      const verificationRequirements = {
        tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
        tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
      }
      if (!needsAvatarRepair) {
        try {
          await timing.measure('final_verify_ms', () => client.verifyMemberBot({
            appId: input.remoteAppId,
            versionId: publishedVersion.versionId,
            configuration: verificationRequirements,
            signal: input.signal
          }))
          alreadyVerifiedVersionId = publishedVersion.versionId
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
        const avatarUrl = await timing.measure('avatar_upload_ms', () => (
          client.uploadAppIcon({ ...avatar, signal: input.signal })
        ))
        avatarTimingRecorded = true
        const configuration: FeishuMemberBotConsoleConfiguration = {
          appName: consoleAppName(input.appName),
          appDescription: input.appDescription,
          avatarUrl,
          tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
          tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
        }
        await client.enableBot(input.remoteAppId, input.signal)
        input.onProgress?.('configuration_started', input.remoteAppId)
        const configurationResult: FeishuMemberBotConfigurationResult =
          await client.configureMemberBot(
            input.remoteAppId,
            configuration,
            input.signal,
            () => input.onProgress?.('configuration_waiting', input.remoteAppId)
          )
        verifiedConfiguration = configurationResult.verified
        if (needsAvatarRepair || configurationResult.changed) {
          input.onProgress?.('configuration_verified', input.remoteAppId)
          publishedVersion = await timing.measure('final_publish_ms', async () => {
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
            return {
              ...(await client.publishVersion(
                input.remoteAppId,
                repairVersionId,
                input.signal
              )),
              appVersion: repairVersion
            }
          })
          finalPublishTimingRecorded = true
        }
        finalVerification = configuration
      } else {
        timing.recordSkipped('avatar_upload_ms')
        avatarTimingRecorded = true
        timing.recordSkipped('scope_config_ms')
        timing.recordSkipped('event_convergence_ms')
        timing.recordSkipped('callback_convergence_ms')
        timing.recordSkipped('configuration_convergence_ms')
        timing.recordSkipped('manifest_reconcile_ms')
        const pendingAppVersion = incrementPatchVersion(publishedVersion.appVersion)
        const pendingVersion = await client.findVersion(
          input.remoteAppId,
          pendingAppVersion,
          input.signal
        )
        if (pendingVersion && pendingVersion.status !== 2) {
          input.onProgress?.('configuration_verified', input.remoteAppId)
          publishedVersion = await timing.measure('final_publish_ms', async () => ({
            ...(await client.publishVersion(
              input.remoteAppId,
              pendingVersion.versionId,
              input.signal
            )),
            appVersion: pendingAppVersion
          }))
          finalPublishTimingRecorded = true
        }
      }
      if (!avatarTimingRecorded) timing.recordSkipped('avatar_upload_ms')
      if (!finalPublishTimingRecorded) timing.recordSkipped('final_publish_ms')
      input.onProgress?.('version_published', input.remoteAppId)
      if (alreadyVerifiedVersionId !== publishedVersion.versionId) {
        await timing.measure('final_verify_ms', () => client.verifyMemberBot({
          appId: input.remoteAppId,
          versionId: publishedVersion.versionId,
          configuration: finalVerification,
          ...(verifiedConfiguration ? { verifiedConfiguration } : {}),
          signal: input.signal
        }))
      }
      const ownerOpenId = await timing.measure('owner_identity_ms', () => (
        this.#resolveOwnerOpenId({
          brand: identity.brand,
          appId: input.remoteAppId,
          appSecret,
          signal: input.signal
        })
      ))
      input.onProgress?.('online_verified', input.remoteAppId)
      await this.#developerSession.persist()
      sessionPersisted = true
      return {
        appId: input.remoteAppId,
        appSecret,
        ownerOpenId,
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

async function resolveOwnerOpenId(
  input: {
    brand: 'feishu' | 'lark'
    appId: string
    appSecret: string
    signal?: AbortSignal
  },
  createClient: OwnerIdentityClientFactory = createOwnerIdentityClient
): Promise<string> {
  if (input.signal?.aborted) {
    throw new Error('feishu_provisioning_cancelled')
  }
  try {
    const client = createClient({
      brand: input.brand,
      appId: input.appId,
      appSecret: input.appSecret
    })
    const response = await client.application.v6.application.get({
      path: { app_id: input.appId },
      params: { lang: 'zh_cn', user_id_type: 'open_id' }
    })
    if (input.signal?.aborted) {
      throw new Error('feishu_provisioning_cancelled')
    }
    if (response.code !== undefined && response.code !== 0) {
      throw new Error('feishu_connection_error')
    }
    const resolvedAppId = response.data?.app?.app_id?.trim()
    const ownerOpenId = response.data?.app?.creator_id?.trim() ?? ''
    if (
      !ownerOpenId
      || ownerOpenId.length > 512
      || resolvedAppId !== input.appId
    ) {
      throw new Error('feishu_connection_error')
    }
    return ownerOpenId
  } catch (error) {
    if (
      error instanceof Error
      && [
        'feishu_provisioning_cancelled',
        'feishu_connection_error'
      ].includes(error.message)
    ) throw error
    throw new Error('feishu_connection_error')
  }
}

function createOwnerIdentityClient(input: {
  brand: 'feishu' | 'lark'
  appId: string
  appSecret: string
}): OwnerIdentityClient {
  return new Client({
    appId: input.appId,
    appSecret: input.appSecret,
    appType: AppType.SelfBuild,
    domain: input.brand === 'lark' ? Domain.Lark : Domain.Feishu,
    loggerLevel: LoggerLevel.error
  })
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
