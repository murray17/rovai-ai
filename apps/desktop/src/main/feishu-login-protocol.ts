import { firstString, record } from './feishu-developer-identity'
import { isFeishuLoginUrl, openPlatformOrigin, trustedFeishuUrl } from './feishu-domains'
import { FeishuSessionError, type FeishuSessionHttp } from './feishu-session-http'

export interface FeishuLoginProfile {
  loginOrigin: string
  redirectUri: string
  portalUrl: string
  // Passport's Web application identifier, never a user-created Bot AppID.
  appId: string
  apiVersion: string
  deviceInfo: string
  pollIntervalMs: number
  requestTimeoutMs: number
  loginTimeoutMs: number
}

// Verified against the official Passport Web init/polling responses on 2026-09-12.
export const FEISHU_LOGIN_PROFILE: Readonly<FeishuLoginProfile> = {
  loginOrigin: 'https://accounts.feishu.cn',
  redirectUri: 'https://open.feishu.cn/app?lang=zh-CN',
  portalUrl: 'https://open.feishu.cn/app?lang=zh-CN',
  appId: '7',
  apiVersion: '1.0.0',
  deviceInfo: 'platform=websdk',
  pollIntervalMs: 1_500,
  requestTimeoutMs: 15_000,
  loginTimeoutMs: 180_000
}

export type FeishuQrPoll =
  | { kind: 'waiting' | 'scanned' | 'expired' }
  | { kind: 'complete'; crossLoginUri?: string }

export class FeishuLoginProtocol {
  readonly profile: Readonly<FeishuLoginProfile>

  constructor(profile: Partial<FeishuLoginProfile> = {}) {
    this.profile = { ...FEISHU_LOGIN_PROFILE, ...profile }
    const origin = trustedFeishuUrl(this.profile.loginOrigin)
    if (!isFeishuLoginUrl(origin.href) || origin.origin !== this.profile.loginOrigin
      || !this.profile.appId || !this.profile.apiVersion || !this.profile.deviceInfo
      || ![this.profile.pollIntervalMs, this.profile.requestTimeoutMs, this.profile.loginTimeoutMs]
        .every((value) => Number.isFinite(value) && value > 0)) {
      throw new FeishuSessionError('feishu_login_profile_invalid')
    }
    openPlatformOrigin(this.profile.redirectUri)
    openPlatformOrigin(this.profile.portalUrl)
  }

  async initialize(http: FeishuSessionHttp, signal: AbortSignal): Promise<{
    token: string
    flowKey: string
    expiresAt: string | null
  }> {
    const { data, response } = await this.#post(http, 'init', signal)
    const token = firstString(record(data.step_info).token)
    const flowKey = firstString(response.headers.get('x-flow-key'))
    if (!token || !flowKey) throw new FeishuSessionError('feishu_login_protocol_incomplete', {
      missingFields: [!token ? 'token' : '', !flowKey ? 'flowKey' : ''].filter(Boolean)
    })
    // Current Web protocol does not publish a documented lifetime. Never invent one.
    return { token, flowKey, expiresAt: null }
  }

  async poll(http: FeishuSessionHttp, flowKey: string, signal: AbortSignal): Promise<FeishuQrPoll> {
    const { data } = await this.#post(http, 'polling', signal, flowKey)
    const nextStep = firstString(data.next_step)
    const step = record(data.step_info)
    if (step.status === 5) return { kind: 'expired' }
    if (nextStep === 'enter_app') {
      const raw = firstString(step.cross_login_uri)
      if (step.cross_login_uri != null && !raw) {
        throw new FeishuSessionError('feishu_login_protocol_incomplete', { missingFields: ['cross_login_uri'] })
      }
      return { kind: 'complete', ...(raw ? { crossLoginUri: trustedFeishuUrl(raw).href } : {}) }
    }
    if (nextStep !== 'qr_login_polling') {
      if (nextStep && INTERACTIVE_STEPS.has(nextStep)) {
        throw new FeishuSessionError(INTERACTIVE_STEPS.get(nextStep)!)
      }
      throw new FeishuSessionError('feishu_login_protocol_unsupported')
    }
    if (step.status === 2) return { kind: 'scanned' }
    if (step.status === 1) return { kind: 'waiting' }
    throw new FeishuSessionError('feishu_login_protocol_unsupported')
  }

  async complete(http: FeishuSessionHttp, crossLoginUri: string | undefined, signal: AbortSignal): Promise<void> {
    if (!crossLoginUri) return
    const { response } = await http.request(trustedFeishuUrl(crossLoginUri).href,
      { kind: 'navigation' }, { signal })
    if (!response.ok) throw new FeishuSessionError('feishu_login_handoff_failed', {
      httpStatus: response.status
    })
  }

  async #post(http: FeishuSessionHttp, operation: 'init' | 'polling', signal: AbortSignal, flowKey?: string): Promise<{
    data: Record<string, unknown>
    response: Response
  }> {
    const headers = new Headers({
      'content-type': 'application/json', accept: 'application/json',
      'x-app-id': this.profile.appId, 'x-api-version': this.profile.apiVersion,
      'x-device-info': this.profile.deviceInfo, 'x-terminal-type': '2',
      origin: this.profile.loginOrigin, referer: `${this.profile.loginOrigin}/`
    })
    if (flowKey) headers.set('x-flow-key', flowKey)
    const { response } = await http.request(`${this.profile.loginOrigin}/accounts/qrlogin/${operation}`,
      { kind: 'login', origin: this.profile.loginOrigin }, {
        method: 'POST', headers, signal,
        body: JSON.stringify({ biz_type: null,
          ...(operation === 'init' ? { redirect_uri: this.profile.redirectUri } : {}) })
      })
    if (!response.ok) throw new FeishuSessionError('feishu_login_server_rejected', {
      httpStatus: response.status
    })
    let envelope: Record<string, unknown>
    try { envelope = record(await response.json()) } catch {
      throw new FeishuSessionError('feishu_login_protocol_invalid')
    }
    if (envelope.code !== 0 && envelope.code !== '0') {
      if (typeof envelope.code !== 'number' && typeof envelope.code !== 'string') {
        throw new FeishuSessionError('feishu_login_protocol_invalid')
      }
      // Do not propagate server messages, URLs or arbitrary response fields.
      const remoteCode = /^\d{1,12}$/.test(String(envelope.code)) ? String(envelope.code) : 'unknown'
      throw new FeishuSessionError('feishu_login_server_rejected', { remoteCode })
    }
    return { response, data: record(envelope.data) }
  }
}

const INTERACTIVE_STEPS = new Map([
  ['choose_user', 'feishu_login_identity_selection_required'],
  ['user_list', 'feishu_login_identity_selection_required'],
  ['select_user', 'feishu_login_identity_selection_required'],
  ['switch_identity', 'feishu_login_identity_selection_required'],
  ['user_confirm', 'feishu_login_authorization_required'],
  ['authz', 'feishu_login_authorization_required'],
  ['verify_code', 'feishu_login_verification_required'],
  ['verify_otp', 'feishu_login_verification_required'],
  ['verify_pwd', 'feishu_login_verification_required']
])
