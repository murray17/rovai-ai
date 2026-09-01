import type { ChannelKind } from '@contracts'

export const FEISHU_MEMBER_BOT_LABEL = 'Rovai AI Teammate'
const MEMBER_BOT_LABELS = {
  feishu: FEISHU_MEMBER_BOT_LABEL,
  dingtalk: FEISHU_MEMBER_BOT_LABEL
} satisfies Record<ChannelKind, string>

export function memberBotAppDescription(kind: ChannelKind, teamRole: string | null | undefined): string {
  return `${MEMBER_BOT_LABELS[kind]} · ${teamRole || '协作者'}`
}

export function memberBotWelcomeCopy(displayName: string): { title: string; body: string } {
  return {
    title: `${displayName} · 已发布`,
    body: '我已经在这里就绪。你可以直接发消息给我；在群聊中使用时，请先把我加入群聊并 @我。'
  }
}
