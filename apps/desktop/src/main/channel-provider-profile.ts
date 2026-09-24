import { Domain } from '@larksuiteoapi/node-sdk'
import {
  FEISHU_LOGIN_PROFILE,
  LARK_LOGIN_PROFILE,
  type FeishuLoginProfile
} from './feishu-login-protocol'

export type OpenPlatformProviderKind = 'feishu' | 'lark'

// Lark Channel v1 §2: twelve provider-owned requests and eight actor-bound ones.
export type ProviderChannelRequest =
  | 'snapshot'
  | 'account.upsert'
  | 'account.commitConnection'
  | 'account.disconnect'
  | 'account.expire'
  | 'memberBot.upsert'
  | 'owner.verify'
  | 'pendingBinding.resolve'
  | 'publicationIntent.create'
  | 'publicationIntent.advance'
  | 'publicationIntent.storeCredential'
  | 'dm.startNew'
export type HostBoundChannelRequest =
  | 'inbound.observe'
  | 'inbound.finalize'
  | 'roster.reconcile'
  | 'deliveries.settle'
  | 'host.tick'
  | 'executionConsole.page.authorize'
  | 'executionConsole.recentOutput.authorize'
  | 'executionConsole.agentRun.cancel'

// Feishu and Lark share one Host implementation. Every provider difference is
// injected here; nothing downstream infers the provider from a runtime string.
export interface ChannelProviderProfile {
  readonly kind: OpenPlatformProviderKind
  readonly displayName: string
  readonly logLabel: string
  readonly login: Readonly<FeishuLoginProfile>
  readonly sdkDomain: Domain
  /** Provider-owned Core requests: `channels.<kind>.*`. */
  readonly methodPrefix: `channels.${OpenPlatformProviderKind}.`
  /** Actor-bound shared requests; Feishu keeps the unprefixed legacy names. */
  readonly hostMethodPrefix: 'channels.' | 'channels.lark.'
  readonly failureCodePrefix: string
}

export const FEISHU_PROVIDER_PROFILE: ChannelProviderProfile = Object.freeze({
  kind: 'feishu',
  displayName: '飞书',
  logLabel: 'Feishu',
  login: FEISHU_LOGIN_PROFILE,
  sdkDomain: Domain.Feishu,
  methodPrefix: 'channels.feishu.',
  hostMethodPrefix: 'channels.',
  failureCodePrefix: 'feishu_'
})

export const LARK_PROVIDER_PROFILE: ChannelProviderProfile = Object.freeze({
  kind: 'lark',
  displayName: 'Lark',
  logLabel: 'Lark',
  login: LARK_LOGIN_PROFILE,
  sdkDomain: Domain.Lark,
  methodPrefix: 'channels.lark.',
  hostMethodPrefix: 'channels.lark.',
  failureCodePrefix: 'lark_'
})

// The shared implementation raises `feishu_*` codes and Feishu copy. They are
// rewritten once, where they leave the provider instance.
export function presentProviderMessage(profile: ChannelProviderProfile, message: string): string {
  const latin = /^[\x20-\x7e]+$/.test(profile.displayName)
  return message
    .replace(/(?<![A-Za-z0-9_])feishu_(?=[a-z0-9])/g, profile.failureCodePrefix)
    .replace(/飞书/g, (_match, offset: number, whole: string) => {
      if (!latin) return profile.displayName
      const before = /[一-鿿]/.test(whole[offset - 1] ?? '') ? ' ' : ''
      const after = /[一-鿿]/.test(whole[offset + 2] ?? '') ? ' ' : ''
      return `${before}${profile.displayName}${after}`
    })
}

export function presentProviderError(profile: ChannelProviderProfile, error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const message = presentProviderMessage(profile, error.message)
  return message === error.message ? error : new Error(message, { cause: error })
}
