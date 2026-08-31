import type { CampChannelSource } from '@contracts'

const CHANNEL_LABELS = {
  feishu: { p2p: '飞书私聊', group: '飞书群聊', topic: '飞书话题' },
  dingtalk: { p2p: '钉钉私聊', group: '钉钉群聊' }
} as const

/** Display only: edits and commands must continue to use the undecorated camp.title. */
export function formatCampTitle(camp: {
  title: string
  channelSource?: CampChannelSource | null
}): string {
  const source = camp.channelSource
  if (!source) return camp.title
  const labels: Partial<Record<string, string>> | undefined = CHANNEL_LABELS[source.provider]
  const label = labels?.[source.conversationKind]
  return label ? `【${label}】${camp.title}` : camp.title
}
