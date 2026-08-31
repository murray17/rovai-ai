import type { ChannelKind } from '@contracts'

export const FEISHU_MEMBER_BOT_LABEL = 'Rovai AI Teammate'

export function memberBotAppDescription(kind: ChannelKind, teamRole: string | null | undefined): string {
  const label = kind === 'feishu' ? FEISHU_MEMBER_BOT_LABEL : 'Rovai AI 队员'
  return `${label} · ${teamRole || '协作者'}`
}
