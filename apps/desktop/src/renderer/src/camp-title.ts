import type { ThreadChannelSource } from '@contracts'
import { getInterfaceLanguage, uiAttribute } from './interface-language'

export const FIRST_RUN_CAMP_TITLE = '初次集结'

const CHANNEL_LABELS = {
  feishu: { p2p: '飞书私聊', group: '飞书群聊', topic: '飞书话题' },
  lark: { p2p: 'Lark私聊', group: 'Lark群聊', topic: 'Lark话题' },
  dingtalk: { p2p: '钉钉私聊', group: '钉钉群聊' }
} as const

/** Display only: edits and commands must continue to use the undecorated camp.title. */
export function formatThreadTitle(thread: {
  id?: string
  title: string
  channelSource?: ThreadChannelSource | null
}, firstRunThreadId: string | null = null): string {
  const source = thread.channelSource
  if (!source) {
    // The Desktop onboarding checkpoint identifies the App-owned default.
    // A matching title alone must never translate a user's conversation name.
    return firstRunThreadId !== null && thread.id === firstRunThreadId && thread.title === FIRST_RUN_CAMP_TITLE
      ? uiAttribute(FIRST_RUN_CAMP_TITLE)
      : thread.title
  }
  const label = threadChannelLabel(source)
  if (!label) return thread.title
  return getInterfaceLanguage() === 'en'
    ? `[${label}] ${thread.title}`
    : `【${label}】${thread.title}`
}

function threadChannelLabel(source: ThreadChannelSource): string {
  const labels: Partial<Record<string, string>> = CHANNEL_LABELS[source.provider]
  const label = labels?.[source.conversationKind]
  return label ? uiAttribute(label) : ''
}

export function threadChannelNameMatches(query: string, matches: (label: string, query: string) => boolean): string[] {
  return Object.entries(CHANNEL_LABELS).flatMap(([provider, labels]) =>
    Object.entries(labels).flatMap(([kind, label]) => matches(uiAttribute(label), query) ? [`${provider}:${kind}`] : [])
  )
}
