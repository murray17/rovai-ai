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
  type FeishuMemberBotConsoleConfiguration
} from './feishu-open-platform-api'

export type MemberBotProvisioningStep =
  | 'session_verified'
  | 'app_created'
  | 'bot_configured'
  | 'permissions_events_configured'
  | 'version_published'

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
  | 'configureScopes'
  | 'configureEvents'
  | 'configureCallbacksAndWebSocket'
  | 'createVersion'
  | 'publishVersion'
  | 'findPublishedVersion'
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
        signal: input.signal
      })
      remoteAppId = created.appId
      input.onProgress?.('app_created', remoteAppId)

      const appSecret = await client.readAppSecret(remoteAppId, input.signal)
      await client.enableBot(remoteAppId, input.signal)
      input.onProgress?.('bot_configured', remoteAppId)

      const configuration: FeishuMemberBotConsoleConfiguration = {
        appName,
        appDescription: input.appDescription,
        avatarUrl: created.avatarUrl,
        tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
        tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
      }
      await client.configureScopes(
        remoteAppId,
        configuration,
        input.signal
      )
      await client.configureEvents(
        remoteAppId,
        configuration,
        input.signal
      )
      await client.configureCallbacksAndWebSocket(
        remoteAppId,
        configuration,
        input.signal
      )
      input.onProgress?.('permissions_events_configured', remoteAppId)

      const versionId = await client.createVersion({
        appId: remoteAppId,
        ownerUserId: identity.userId,
        signal: input.signal
      })
      await client.publishVersion(remoteAppId, versionId, input.signal)
      input.onProgress?.('version_published', remoteAppId)
      await client.verifyMemberBot({
        appId: remoteAppId,
        versionId,
        configuration,
        signal: input.signal
      })
      await this.#developerSession.persist()
      sessionPersisted = true
      return {
        appId: remoteAppId,
        appSecret,
        botDisplayName: input.appName,
        publishedVersionId: versionId
      }
    } catch (error) {
      if (isProvisioningError(error)) throw error
      const code = provisioningErrorCode(error, 'feishu_console_provisioning_failed')
      const remoteState = remoteAppId !== null
        || (error instanceof FeishuOpenPlatformApiError && error.outcomeUnknown)
        ? 'unknown'
        : 'none'
      throw provisioningError(code, remoteState)
    } finally {
      if (platformSessionOpened && !sessionPersisted) {
        await this.#developerSession.persist().catch(() => undefined)
      }
    }
  }

  async reconcile(input: ReconcileMemberBotInput): Promise<ProvisionedMemberBot> {
    if (input.signal?.aborted) throw provisioningError('feishu_provisioning_cancelled', 'none')
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
      let publishedVersion = await client.findPublishedVersion(
        input.remoteAppId,
        input.signal
      )
      const needsAvatarRepair = Boolean(
        input.avatarSource?.pngBytes && publishedVersion.appVersion === '1.0.0'
      )
      let needsReadinessRepair = false
      if (!needsAvatarRepair) {
        try {
          await client.verifyMemberBot({
            appId: input.remoteAppId,
            versionId: publishedVersion.versionId,
            configuration: {
              tenantScopes: MEMBER_BOT_MANIFEST_REQUIREMENTS.scopes.tenant,
              tenantEvents: MEMBER_BOT_MANIFEST_REQUIREMENTS.events.items.tenant
            },
            signal: input.signal
          })
        } catch (error) {
          if (!isRepairableMemberBotVerificationError(error)) throw error
          needsReadinessRepair = true
        }
      }
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
        input.onProgress?.('bot_configured', input.remoteAppId)
        await client.configureScopes(input.remoteAppId, configuration, input.signal)
        await client.configureEvents(input.remoteAppId, configuration, input.signal)
        await client.configureCallbacksAndWebSocket(
          input.remoteAppId,
          configuration,
          input.signal
        )
        input.onProgress?.('permissions_events_configured', input.remoteAppId)
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
        await client.verifyMemberBot({
          appId: input.remoteAppId,
          versionId: publishedVersion.versionId,
          configuration,
          signal: input.signal
        })
      } else {
        input.onProgress?.('bot_configured', input.remoteAppId)
        input.onProgress?.('permissions_events_configured', input.remoteAppId)
      }
      input.onProgress?.('version_published', input.remoteAppId)
      await this.#developerSession.persist()
      sessionPersisted = true
      return {
        appId: input.remoteAppId,
        appSecret,
        botDisplayName: input.appName,
        publishedVersionId: publishedVersion.versionId
      }
    } catch (error) {
      if (isProvisioningError(error)) throw error
      throw provisioningError(
        provisioningErrorCode(error, 'feishu_console_reconciliation_failed'),
        'unknown'
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
  return isProvisioningError(error) && error.remoteState === 'unknown'
}

type ProvisioningError = Error & { code: string; remoteState: 'none' | 'unknown' }

function provisioningError(code: string, remoteState: 'none' | 'unknown'): ProvisioningError {
  const error = new Error(code) as ProvisioningError
  error.code = code
  error.remoteState = remoteState
  return error
}

function isProvisioningError(error: unknown): error is ProvisioningError {
  return error instanceof Error
    && typeof (error as Partial<ProvisioningError>).code === 'string'
    && ((error as Partial<ProvisioningError>).remoteState === 'none'
      || (error as Partial<ProvisioningError>).remoteState === 'unknown')
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

function incrementPatchVersion(version: string): string {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(version)
  if (!match) throw provisioningError('feishu_console_app_version_invalid', 'unknown')
  const patch = Number(match[3]) + 1
  if (patch > 9_999) {
    throw provisioningError('feishu_console_app_version_invalid', 'unknown')
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
