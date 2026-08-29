import { createHash } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import type { DingTalkGatewayBackend } from './dingtalk-developer-gateway'

export type DingTalkDeveloperIdentity = {
  accountId: string
  userIdDigest: string
  corpId: string
  userId: string
  userName: string
  corpName: string
  oauthProfileRef: string
  expiresAt: string | null
}

export type DingTalkLoginStage =
  | 'preparing'
  | 'awaiting_browser'
  | 'inspecting_identity'
  | 'connected'

export interface DingTalkDeveloperSessionService {
  inspect(signal?: AbortSignal): Promise<DingTalkDeveloperIdentity | null>
  beginLogin(options: {
    signal: AbortSignal
    deviceFlow?: boolean
    onStage?(stage: DingTalkLoginStage): void
  }): Promise<DingTalkDeveloperIdentity>
  activate(identity: Pick<DingTalkDeveloperIdentity, 'corpId' | 'userId'>): Promise<void>
  disconnect(identity: Pick<DingTalkDeveloperIdentity, 'corpId' | 'userId'>): Promise<void>
}

export class DwsDingTalkDeveloperSessionService implements DingTalkDeveloperSessionService {
  readonly #gateway: DingTalkGatewayBackend
  readonly #configDir: string

  constructor(input: { gateway: DingTalkGatewayBackend; configDir: string }) {
    this.#gateway = input.gateway
    this.#configDir = input.configDir
  }

  async inspect(signal?: AbortSignal): Promise<DingTalkDeveloperIdentity | null> {
    const raw = asObject(await this.#gateway.execute({
      operation: 'auth.status',
      signal,
      timeoutMs: 45_000
    }))
    if (raw.success !== true || raw.authenticated !== true || raw.token_valid !== true) return null
    const corpId = requiredString(raw, 'corp_id')
    const userId = requiredString(raw, 'user_id')
    return {
      accountId: stableId('rvdta', corpId, userId),
      userIdDigest: digest('dingtalk-user', userId),
      corpId,
      userId,
      userName: requiredString(raw, 'user_name'),
      corpName: requiredString(raw, 'corp_name'),
      oauthProfileRef: `dws-profile:${digest('dingtalk-profile', corpId).slice(7, 39)}`,
      expiresAt: optionalString(raw, 'expires_at')
    }
  }

  async beginLogin(options: {
    signal: AbortSignal
    deviceFlow?: boolean
    onStage?(stage: DingTalkLoginStage): void
  }): Promise<DingTalkDeveloperIdentity> {
    options.onStage?.('preparing')
    await mkdir(this.#configDir, { recursive: true, mode: 0o700 })
    await chmod(this.#configDir, 0o700)
    options.onStage?.('awaiting_browser')
    await this.#gateway.execute({
      operation: 'auth.login',
      values: options.deviceFlow ? { device: true } : undefined,
      signal: options.signal,
      timeoutMs: 10 * 60_000
    })
    options.onStage?.('inspecting_identity')
    const identity = await this.inspect(options.signal)
    if (!identity) throw new Error('dingtalk_login_identity_unavailable')
    options.onStage?.('connected')
    return identity
  }

  async disconnect(identity: Pick<DingTalkDeveloperIdentity, 'corpId' | 'userId'>): Promise<void> {
    await this.#gateway.execute({
      operation: 'auth.logout',
      values: { profile: `${identity.corpId}:${identity.userId}` },
      timeoutMs: 45_000
    })
  }

  async activate(identity: Pick<DingTalkDeveloperIdentity, 'corpId' | 'userId'>): Promise<void> {
    await this.#gateway.execute({
      operation: 'profile.switch',
      values: { profileSelector: `${identity.corpId}:${identity.userId}` },
      timeoutMs: 45_000
    })
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('dingtalk_dws_response_invalid')
  }
  return value as Record<string, unknown>
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = optionalString(value, key)
  if (!result) throw new Error(`dingtalk_dws_response_missing:${key}`)
  return result
}

function optionalString(value: Record<string, unknown>, key: string): string | null {
  const result = value[key]
  return typeof result === 'string' && result.trim() ? result.trim() : null
}

function digest(namespace: string, value: string): string {
  return `sha256:${createHash('sha256').update(namespace).update('\0').update(value).digest('hex')}`
}

function stableId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32)}`
}
