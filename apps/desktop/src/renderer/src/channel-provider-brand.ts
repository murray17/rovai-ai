import type { ChannelKind } from '@contracts'
import feishuLogo from './assets/channel-logos/feishu.svg'
import larkLogo from './assets/channel-logos/lark.svg'
import dingtalkLogo from './assets/channel-logos/dingtalk.svg'

export interface ChannelProviderBrand {
  name: string
  logo: string
}

// Display order follows the snapshot contract: Feishu, Lark, DingTalk.
export const CHANNEL_KINDS = ['feishu', 'lark', 'dingtalk'] as const satisfies readonly ChannelKind[]

export const CHANNEL_PROVIDER_BRANDS = {
  feishu: { name: '飞书', logo: feishuLogo },
  lark: { name: 'Lark', logo: larkLogo },
  dingtalk: { name: '钉钉', logo: dingtalkLogo }
} satisfies Record<ChannelKind, ChannelProviderBrand>

const HAN = /[一-鿿]/u
const LATIN = /^[\x20-\x7e]+$/u

// Provider copy template: a Latin name such as Lark is separated from adjacent
// Han characters by one space, matching Main's provider message rewrite.
export function channelCopy(strings: TemplateStringsArray, ...values: string[]): string {
  return strings.reduce((copy, text, index) => {
    if (index === 0) return text
    const value = values[index - 1]
    const spaced = LATIN.test(value)
    const before = spaced && HAN.test(copy.at(-1) ?? '') ? ' ' : ''
    const after = spaced && HAN.test(text[0] ?? '') ? ' ' : ''
    return `${copy}${before}${value}${after}${text}`
  }, '')
}
