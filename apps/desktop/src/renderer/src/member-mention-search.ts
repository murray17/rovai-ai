import type { AdapterKind } from '@contracts'
import { memberSearchMatch, memberSearchMatches } from './member-search'
import { adapterLabel, VISIBLE_PRODUCT_RUNTIMES } from './runtime-products'

const aliases: Partial<Record<AdapterKind, readonly string[]>> = {
  'antigravity-app': ['agy'],
  'codex-cli': ['codex'],
  'claude-code-cli': ['claude'],
  'copilot-cli': ['copilot'],
  'kiro-cli': ['kiro-cli'],
  'qoder-cli': ['qodercli'],
  'qwen-code': ['qwen'],
  'trae-cn-cli': ['trae'],
  'kimi-code-cli': ['kimi'],
  'minimax-code-cli': ['minimax', 'mcode'],
  'hermes-cli': ['hermes'],
  'grok-build': ['grok'],
  'deepseek-harness': ['deepseek', 'dsh'],
  'command-code-cli': ['command', 'cmdc']
}

const normalizeRuntime = (value: string): string =>
  value.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\uFEFF_-]/gu, '')

const runtimeSearchKeys = new Map(VISIBLE_PRODUCT_RUNTIMES.map(kind => [
  kind, [adapterLabel(kind), ...(aliases[kind] ?? [])].map(normalizeRuntime)
]))

/** Match each field separately and keep only the strongest reason for a member. */
export function memberMentionSearchRank(member: {
  displayName: string
  teamRole: string
  runtimeKind?: AdapterKind
}, query: string): number | null {
  const nameMatch = memberSearchMatch(member.displayName, query)
  if (nameMatch === 'exact') return 0
  if (nameMatch === 'prefix') return 1
  const runtimeQuery = normalizeRuntime(query)
  const keys = member.runtimeKind ? runtimeSearchKeys.get(member.runtimeKind) : undefined
  if (runtimeQuery && keys?.some(key => key === runtimeQuery)) return 2
  if (runtimeQuery && keys?.some(key => key.startsWith(runtimeQuery))) return 3
  if (nameMatch === 'fuzzy') return 4
  return memberSearchMatches(member.teamRole, query) ? 5 : null
}
