import { gzipSync } from 'node:zlib'
import type {
  FeishuDeveloperPortalSession,
  FeishuDeveloperSessionService
} from './feishu-developer-session'

export type MemberBotProvisioningStep =
  | 'session_verified'
  | 'app_created'
  | 'credentials_read'
  | 'bot_configured'
  | 'version_published'

export interface MemberBotAvatarSource {
  publicUrl: string
}

export interface ProvisionedMemberBot {
  appId: string
  appSecret: string
  botOpenId?: string
  botDisplayName: string
  publishedVersionId: string | null
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
}

export const FEISHU_MEMBER_BOT_ADDONS = {
  preset: false,
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

type RegistrationBeginResponse = {
  device_code?: string
  verification_uri_complete?: string
  expires_in?: number
  interval?: number
  error?: string
  error_description?: string
}

type RegistrationPollResponse = {
  client_id?: string
  client_secret?: string
  error?: string
  error_description?: string
}

const REGISTRATION_PATH = '/oauth/v1/app/registration'

export class FeishuWebSessionMemberBotProvisioner implements FeishuMemberBotProvisioner {
  readonly #developerSession: FeishuDeveloperPortalSession

  constructor(developerSession: FeishuDeveloperPortalSession) {
    this.#developerSession = developerSession
  }

  async create(input: Parameters<FeishuMemberBotProvisioner['create']>[0]): Promise<ProvisionedMemberBot> {
    if (input.signal?.aborted) throw provisioningError('feishu_provisioning_cancelled', 'none')
    const identity = await this.#developerSession.requireExpectedIdentity(
      input.expectedDeveloperIdentity
    )
    input.onProgress?.('session_verified')

    const abort = new AbortController()
    const onAbort = (): void => abort.abort()
    input.signal?.addEventListener('abort', onAbort, { once: true })
    const baseUrl = identity.brand === 'lark'
      ? 'https://accounts.larksuite.com'
      : 'https://accounts.feishu.cn'
    let registrationPage: Awaited<ReturnType<
      FeishuDeveloperPortalSession['showRegistrationConfirmation']
    >> | null = null
    try {
      const begin = await requestRegistration<RegistrationBeginResponse>(baseUrl, {
        action: 'begin',
        archetype: 'PersonalAgent',
        auth_method: 'client_secret',
        request_user_info: 'open_id'
      }, abort.signal)
      if (!begin.device_code || !begin.verification_uri_complete) {
        throw provisioningError(begin.error || 'feishu_registration_begin_failed', 'none')
      }
      const verificationUrl = registrationUrl(begin.verification_uri_complete, input)
      registrationPage = await this.#developerSession.showRegistrationConfirmation({
        url: verificationUrl,
        signal: abort.signal
      })
      const pageClosed = registrationPage.closed.then((reason) => {
        abort.abort()
        if (reason === 'session_expired') {
          throw provisioningError('feishu_developer_session_expired', 'none')
        }
        throw provisioningError('feishu_provisioning_cancelled', 'none')
      })
      const result = await Promise.race([
        pollRegistration(
          baseUrl,
          begin.device_code,
          begin.interval ?? 5,
          begin.expires_in ?? 600,
          abort.signal
        ),
        pageClosed
      ])
      input.onProgress?.('app_created', result.client_id)
      input.onProgress?.('credentials_read', result.client_id)
      input.onProgress?.('bot_configured', result.client_id)
      input.onProgress?.('version_published', result.client_id)
      await this.#developerSession.persist()
      return {
        appId: result.client_id,
        appSecret: result.client_secret,
        botDisplayName: input.appName,
        publishedVersionId: null
      }
    } catch (error) {
      if (isProvisioningError(error)) throw error
      if (abort.signal.aborted || input.signal?.aborted) {
        throw provisioningError('feishu_provisioning_cancelled', 'none')
      }
      const code = registrationErrorCode(error)
      const remoteState = code === 'access_denied' ? 'none' : 'unknown'
      throw provisioningError(code, remoteState)
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
      registrationPage?.close()
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

async function requestRegistration<T>(
  baseUrl: string,
  fields: Record<string, string>,
  signal: AbortSignal
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${baseUrl}${REGISTRATION_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal
    })
  } catch (error) {
    if (signal.aborted) throw provisioningError('feishu_provisioning_cancelled', 'none')
    throw error
  }
  const payload = await response.json() as T
  if (!response.ok && !(payload as RegistrationPollResponse).error) {
    throw provisioningError(`feishu_registration_http_${response.status}`, 'unknown')
  }
  return payload
}

async function pollRegistration(
  baseUrl: string,
  deviceCode: string,
  initialIntervalSeconds: number,
  expiresInSeconds: number,
  signal: AbortSignal
): Promise<{ client_id: string; client_secret: string }> {
  const deadline = Date.now() + expiresInSeconds * 1_000
  let intervalMs = Math.max(1, initialIntervalSeconds) * 1_000
  while (Date.now() < deadline) {
    await abortableDelay(intervalMs, signal)
    const result = await requestRegistration<RegistrationPollResponse>(baseUrl, {
      action: 'poll',
      device_code: deviceCode
    }, signal)
    if (result.client_id && result.client_secret) {
      return { client_id: result.client_id, client_secret: result.client_secret }
    }
    if (result.error === 'authorization_pending' || !result.error) continue
    if (result.error === 'slow_down') {
      intervalMs += 5_000
      continue
    }
    if (result.error === 'access_denied') {
      throw provisioningError('access_denied', 'none')
    }
    throw provisioningError(result.error ?? 'feishu_registration_failed', 'unknown')
  }
  throw provisioningError('expired_token', 'unknown')
}

function registrationUrl(
  rawUrl: string,
  input: Parameters<FeishuMemberBotProvisioner['create']>[0]
): string {
  const url = new URL(rawUrl)
  url.searchParams.set('from', 'sdk')
  url.searchParams.set('source', 'node-sdk/rovai-ai')
  url.searchParams.set('tp', 'sdk')
  url.searchParams.set('createOnly', 'true')
  url.searchParams.set('name', input.appName)
  url.searchParams.set('desc', input.appDescription)
  if (input.avatarSource?.publicUrl) {
    url.searchParams.append('avatar', input.avatarSource.publicUrl)
  }
  url.searchParams.set('addons', encodeAddons(FEISHU_MEMBER_BOT_ADDONS))
  return url.toString()
}

function encodeAddons(value: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(value), 'utf8'))
    .toString('base64url')
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(provisioningError('feishu_provisioning_cancelled', 'none'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    timer.unref?.()
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(provisioningError('feishu_provisioning_cancelled', 'none'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

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

function registrationErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
  }
  return error instanceof Error && error.message ? error.message : 'feishu_registration_failed'
}
