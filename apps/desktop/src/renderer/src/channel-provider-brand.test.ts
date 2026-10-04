import { expect, it } from 'vitest'
import { CHANNEL_KINDS, CHANNEL_PROVIDER_BRANDS, channelCopy } from './channel-provider-brand'

// Automation notification options and Channel Settings share this order and naming.
it('lists Feishu, Lark, DingTalk with their own names and logos', () => {
  expect(CHANNEL_KINDS).toEqual(['feishu', 'lark', 'dingtalk'])
  expect(CHANNEL_KINDS.map((kind) => CHANNEL_PROVIDER_BRANDS[kind].name)).toEqual(['飞书', 'Lark', '钉钉'])
  expect(CHANNEL_PROVIDER_BRANDS.lark.logo).toMatch(/lark\.svg/u)
  expect(new Set(CHANNEL_KINDS.map((kind) => CHANNEL_PROVIDER_BRANDS[kind].logo)).size).toBe(3)
})

it('spaces a Latin provider name from adjacent Han text and leaves Han names untouched', () => {
  const copy = (name: string): string[] => [
    channelCopy`${name}连接`, channelCopy`重新连接${name}`, channelCopy`独立${name} Bot`,
    channelCopy`管理连接（${name}）`, channelCopy`登录${name}开放平台`
  ]
  expect(copy('Lark')).toEqual(['Lark 连接', '重新连接 Lark', '独立 Lark Bot', '管理连接（Lark）', '登录 Lark 开放平台'])
  expect(copy('飞书')).toEqual(['飞书连接', '重新连接飞书', '独立飞书 Bot', '管理连接（飞书）', '登录飞书开放平台'])
})
