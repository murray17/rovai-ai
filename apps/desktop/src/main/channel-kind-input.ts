import type { ChannelKind } from '@contracts'

// Exhaustive over ChannelKind: adding a provider fails typecheck until IPC admits it.
const CHANNEL_KINDS = { feishu: true, lark: true, dingtalk: true } satisfies Record<ChannelKind, true>

export function optionalChannelKind(value: unknown): ChannelKind | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && Object.hasOwn(CHANNEL_KINDS, value)) return value as ChannelKind
  throw new Error('Invalid channel kind')
}
