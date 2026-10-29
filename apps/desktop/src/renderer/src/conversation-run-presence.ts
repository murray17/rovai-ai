import type { AgentRunView, ThreadMessageView } from '@contracts'
import { agentRunIsStarting, agentRunPresentation, buildLiveExecutionProgress, type ActivityIconKind, type LiveRuntimeEvent } from './ui-model'
import { uiAttribute } from './interface-language'
import type { ThreadConversationTimelineItem } from './ThreadWorkspace'

export interface ConversationRunPresenceSlot {
  run: AgentRunView
  continuation: boolean
}

export function isUserInterruptedRun(run: AgentRunView): boolean {
  return run.status === 'cancelled' && run.cancelReasonCode === 'user_requested_agent_run_stop'
}

/** Keep public activity, the latest unresolved stop/failure, and input rejections at their source. */
function eligibleConversationRuns(runs: readonly AgentRunView[], continuedRunIds?: ReadonlySet<string>): AgentRunView[] {
  const publicRuns = runs.filter(run => run.invocationKind !== 'single_chat')
  const latestByAgent = new Map<string, AgentRunView>()
  for (const run of publicRuns) {
    const previous = latestByAgent.get(run.agentId)
    if (!previous || run.createdAt > previous.createdAt
      || run.createdAt === previous.createdAt && run.id > previous.id) latestByAgent.set(run.agentId, run)
  }
  return publicRuns.filter(run => run.status === 'running' || agentRunIsStarting(run)
    || run.status === 'waiting' && run.startedAt !== null
    || (run.status === 'failed' && run.invocationKind === 'batch' || isUserInterruptedRun(run))
      && (run.failure?.code === 'context_payload_too_large' || latestByAgent.get(run.agentId)?.id === run.id)
      && !run.hasAcceptedContinuation && !continuedRunIds?.has(run.id))
}

export interface RunPresencePreview {
  kind: 'narration' | 'command' | 'status' | 'error'
  text: string
  iconKind?: ActivityIconKind
}

export type ConversationPresenceTimelineItem = ThreadConversationTimelineItem | {
  kind: 'run_presence'
  id: string
  createdAt: string
  slot: ConversationRunPresenceSlot
}

function outputRunId(item: ThreadConversationTimelineItem | undefined): string | null {
  if (item?.kind === 'camp_message') return !item.message.withdrawn && item.message.authorType === 'agent'
    ? item.message.sourceAgentRunId : null
  if (item?.kind === 'run_artifacts') return item.run.id
  if (item?.kind === 'run_file_changes') return item.changes.agentRunId
  if (item?.kind === 'run_images') return item.images.agentRunId
  if (item?.kind === 'member_joined') return item.receipt.sourceAgentRunId ?? null
  return null
}

/** Insert transient Run rows without sorting or rewriting any public content. */
export function conversationRunPresenceTimeline(
  timeline: readonly ThreadConversationTimelineItem[],
  runs: readonly AgentRunView[],
  snapshotReady = true,
  continuedRunIds?: ReadonlySet<string>
): ConversationPresenceTimelineItem[] {
  const messages = timeline.flatMap(item => item.kind === 'camp_message' ? [item.message] : [])
  const groups = new Map<number, ConversationRunPresenceSlot[]>()
  for (const run of eligibleConversationRuns(runs, continuedRunIds)) {
    if (!snapshotReady && (run.status === 'failed' || run.status === 'cancelled')) continue
    const ownMessage = messages.filter(message => !message.withdrawn && message.authorType === 'agent'
      && message.sourceAgentRunId === run.id && !message.id.startsWith('optimistic:'))
      .reduce<ThreadMessageView | null>((last, message) => !last || message.sequence > last.sequence ? message : last, null)
    const inputAnchor = messages.find(message => message.id === run.anchorMessageId)
    const startSequence = run.publicTailSequenceAtStart
    // The last claimed input may precede another Run's reply. Pin to Core's
    // frozen public tail at claim time, independent of paging or wall clocks.
    // Legacy projections retain their input/time fallback, never today's tail.
    const startAnchor = startSequence != null
      ? messages.filter(message => !message.id.startsWith('optimistic:') && message.sequence <= startSequence)
        .reduce<ThreadMessageView | null>((last, message) => !last || message.sequence > last.sequence ? message : last, null)
      : inputAnchor ?? (run.anchorMessageId ? null : messages.filter(message => !message.id.startsWith('optimistic:')
      && message.createdAt <= (run.startedAt ?? run.createdAt))
      .reduce<ThreadMessageView | null>((last, message) => !last || message.sequence > last.sequence ? message : last, null))
    const anchor = ownMessage ?? startAnchor
    let index = anchor ? timeline.findIndex(item => item.kind === 'camp_message' && item.id === anchor.id) : -1
    // A terminal silent Run may instead have a standalone artifact group.
    if (!ownMessage && (run.status === 'failed' || run.status === 'cancelled')) {
      const artifactIndex = timeline.findLastIndex(item => item.kind !== 'camp_message' && outputRunId(item) === run.id)
      if (artifactIndex >= 0) index = artifactIndex
    }
    // Every message's output group is atomic, including an earlier Run's reply
    // used as the start anchor. Continuation identity is still checked below.
    const anchorRunId = outputRunId(timeline[index])
    if (anchorRunId) {
      while (index + 1 < timeline.length && timeline[index + 1].kind !== 'camp_message'
        && outputRunId(timeline[index + 1]) === anchorRunId) index += 1
    }
    groups.set(index, [...(groups.get(index) ?? []), { run, continuation: false }])
  }
  const result: ConversationPresenceTimelineItem[] = []
  const append = (index: number): void => {
    const precedingRunId = outputRunId(timeline[index])
    const slots = (groups.get(index) ?? []).sort((a, b) =>
      Number(b.run.id === precedingRunId) - Number(a.run.id === precedingRunId)
      || (a.run.startedAt ?? a.run.createdAt).localeCompare(b.run.startedAt ?? b.run.createdAt)
      || a.run.id.localeCompare(b.run.id))
    for (const [position, slot] of slots.entries()) result.push({
      kind: 'run_presence', id: 'run-presence:' + slot.run.id,
      createdAt: slot.run.startedAt ?? slot.run.createdAt,
      slot: { run: slot.run, continuation: position === 0 && slot.run.id === precedingRunId }
    })
  }
  append(-1)
  timeline.forEach((item, index) => { result.push(item); append(index) })
  return result
}

const singleLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** Source newlines advance within one row; a trailing/blank line keeps the last text. */
function currentNarrationLine(text: string): string {
  return text.replace(/\r\n?/g, '\n').split('\n').findLast(line => line.trim())?.trim() ?? ''
}

const fallbackCopy = {
  working: ['{0}正在为你推进…', '{0}正在推进这项任务…', '{0}正与你一起推进…']
} as const

// Keep only recent renderer-local choices; a full reload draws again.
const fallbackChoices = new Map<string, number>()
const maxFallbackChoices = 512

/** Draw independently per Run/phase, then retain the index across ticks and locales. */
function fallbackText(runId: string, phase: keyof typeof fallbackCopy, name: string): string {
  const choices = fallbackCopy[phase]
  const key = `${phase}:${runId}`
  const index = fallbackChoices.get(key) ?? Math.floor(Math.random() * choices.length)
  fallbackChoices.delete(key)
  fallbackChoices.set(key, index)
  if (fallbackChoices.size > maxFallbackChoices) fallbackChoices.delete(fallbackChoices.keys().next().value!)
  return uiAttribute(choices[index], name)
}

/** Only authoritative start/end timestamps contribute; unknown time stays absent. */
export function runPresenceElapsedSeconds(run: Pick<AgentRunView, 'startedAt' | 'endedAt' | 'status'>, now: number): number | null {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN
  const live = run.status === 'running' || run.status === 'waiting'
  const end = run.endedAt ? Date.parse(run.endedAt) : live ? now : NaN
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : null
}

export function formatRunPresenceDuration(seconds: number): string {
  const s = seconds % 60
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  if (h) return uiAttribute('{0}时 {1}分 {2}秒', h, String(m).padStart(2, '0'), String(s).padStart(2, '0'))
  if (seconds >= 60) return uiAttribute('{0}分 {1}秒', m, String(s).padStart(2, '0'))
  return uiAttribute('{0}秒', s)
}

export function runPresencePreview(run: AgentRunView, events: readonly LiveRuntimeEvent[] = [], name = run.agentId): RunPresencePreview {
  if (run.status === 'failed') {
    if (run.failure?.code === 'context_payload_too_large') {
      return { kind: 'error', text: uiAttribute('输入内容过大 · 查看详情') }
    }
    const disconnected = run.failure?.code === 'runtime_network_interrupted'
      || run.failure?.code === 'runtime_disconnected'
    return { kind: 'error', text: disconnected ? uiAttribute('连接中断 · 查看原因') : uiAttribute('执行中断 · 查看原因') }
  }
  if (!['queued', 'running', 'waiting'].includes(run.status)) return { kind: 'status', text: uiAttribute(agentRunPresentation(run).label) }
  if (run.cancelRequestedAt) return { kind: 'status', text: uiAttribute('正在停止…') }
  if (run.status === 'waiting' || run.failure?.code === 'runtime_network_interrupted') return { kind: 'status', text: uiAttribute(agentRunPresentation(run).label) }
  const initializing = agentRunIsStarting(run)
  // ACP can acknowledge the input only at prompt completion. Current-epoch
  // activity already describes what is happening, without changing that ACK.
  // Older or unscoped evidence must not hide a genuine reconnection.
  const progress = buildLiveExecutionProgress(events.filter(event =>
    event.agentRunId === run.id && (!initializing || event.executionEpoch === run.executionEpoch)
  ), run.id, { includePublicResults: false })
  const latest = progress.items.findLast(item => item.kind === 'tool' || item.kind === 'narration' && item.body.trim())
  if (latest?.kind === 'tool') return {
    kind: 'command',
    text: singleLine(latest.step.publicCommand || latest.step.currentInstruction || latest.step.title),
    iconKind: latest.step.publicCommand && latest.step.iconKind === 'unknown' ? 'terminal' : latest.step.iconKind
  }
  if (latest?.kind === 'narration') return { kind: 'narration', text: currentNarrationLine(latest.body) }
  if (initializing) return { kind: 'status', text: uiAttribute('启动中…') }
  return { kind: 'status', text: progress.runtimeThinkingTitle || fallbackText(run.id, 'working', name) }
}
