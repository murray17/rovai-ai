import { useTaskCapability, validTaskCapability } from './TaskCapabilityProvider'
import { useThreadClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { readErrorMessage } from './error-message'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  NativeInteractionNotification,
  NotificationActionView,
  NotificationEpisodeChange,
  NotificationEpisodeChangeBatch,
  NotificationEpisodeInbox,
  NotificationEpisodeView,
  NotificationHeadsUpSignal,
  NotificationPreference,
  NotificationSemantic,
  StoredCommandResult,
  TaskCapabilitySnapshot
} from '@contracts'
import type { VisibleNotificationSources } from './ThreadWorkspace'
import { preferenceFromUnknown } from './NotificationSettings'
import { formatThreadTitle } from './camp-title'
import { UiText, uiAttribute } from './interface-language'
import { useInterruptionAttention } from './thread-interruption-attention'

export const NOTIFICATION_RECOVERY_INTERVAL_MS = 30_000

export type NotificationHeadsUpEntry = {
  episode: NotificationEpisodeView
  signal: NotificationHeadsUpSignal
  changeSequence: number
}

export type NotificationHeadsUpState = {
  entries: NotificationHeadsUpEntry[]
  overflowEntries: NotificationHeadsUpEntry[]
}

export type NotificationNavigationResult =
  | { status: 'navigated' }
  | { status: 'failed'; message: string }

interface NotificationAttentionControllerProps {
  enabled: boolean
  activeThreadId: string | null
  firstRunThreadId?: string | null
  activeThreadVisible: boolean
  navigationActive: boolean
  onNavigate(
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<NotificationNavigationResult>
  onPresentNavigation(
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean>
  onCancelNavigation(): void
  onRefreshVisibleThread(
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean>
  onError(message: string): void
  visibleSources: VisibleNotificationSources | null
  singleChatSources?: VisibleNotificationSources | null
  onHeadsUpVisibleChange?(visible: boolean): void
}

export const emptyNotificationHeadsUpState = (): NotificationHeadsUpState => ({
  entries: [],
  overflowEntries: []
})

export function applyNotificationHeadsUpChanges(
  current: NotificationHeadsUpState,
  incoming: readonly NotificationEpisodeChange[],
  maximumEntries = 1
): NotificationHeadsUpState {
  let nextEntries = current.entries.map((entry) => ({ ...entry }))
  let overflowEntries = current.overflowEntries.map((entry) => ({ ...entry }))
  for (const change of incoming) {
    const invalidation = change.headsUpInvalidation
    if (invalidation?.kind === 'source_state_changed') {
      const retainsSignal = (entry: NotificationHeadsUpEntry): boolean => (
        entry.signal.action.acknowledgementId !== invalidation.acknowledgementId
      )
      nextEntries = nextEntries.filter(retainsSignal)
      overflowEntries = overflowEntries.filter(retainsSignal)
    } else if (invalidation?.kind === 'attention_cleared') {
      const retainsSignal = (entry: NotificationHeadsUpEntry): boolean => (
        entry.episode.id !== change.episodeId
        || entry.signal.admittedAttentionRevision > invalidation.throughAttentionRevision
      )
      nextEntries = nextEntries.filter(retainsSignal)
      overflowEntries = overflowEntries.filter(retainsSignal)
    } else if (invalidation?.kind === 'episode_removed') {
      nextEntries = nextEntries.filter((entry) => entry.episode.id !== change.episodeId)
      overflowEntries = overflowEntries.filter((entry) => entry.episode.id !== change.episodeId)
    }
    if (
      change.operation !== 'upsert'
      || !change.episode
      || !change.headsUpSignal
    ) continue
    const next = {
      episode: change.episode,
      signal: change.headsUpSignal,
      changeSequence: change.changeSequence
    }
    const dominatedBy = (higher: NotificationHeadsUpEntry, lower: NotificationHeadsUpEntry): boolean => {
      if (higher.episode.thread.id !== lower.episode.thread.id) return false
      if (higher.signal.semantic === 'mission_needs_you' && lower.signal.semantic === 'user_mention') {
        return Boolean(higher.signal.action.subject?.sourceMessageId
          && higher.signal.action.subject.sourceMessageId === lower.signal.action.messageId)
      }
      if (higher.signal.semantic === 'mission_status_changed' && higher.signal.action.subject?.status === 'completed'
        && lower.signal.semantic === 'round_completed') {
        return Boolean(higher.signal.action.subject.sourceAgentRunId
          && lower.signal.action.subject?.relatedRunIds.includes(higher.signal.action.subject.sourceAgentRunId))
      }
      return false
    }
    if ([...nextEntries, ...overflowEntries].some(entry => dominatedBy(entry, next))) continue
    nextEntries = nextEntries.filter(entry => !dominatedBy(next, entry))
    overflowEntries = overflowEntries.filter(entry => !dominatedBy(next, entry))
    const identity = next.signal.action.acknowledgementId ?? next.signal.action.actionId
    const existingIndex = nextEntries.findIndex((entry) => (entry.signal.action.acknowledgementId ?? entry.signal.action.actionId) === identity)
    const existingOverflowIndex = overflowEntries.findIndex((entry) => (entry.signal.action.acknowledgementId ?? entry.signal.action.actionId) === identity)
    if (existingIndex >= 0) nextEntries[existingIndex] = next
    else if (existingOverflowIndex >= 0) overflowEntries[existingOverflowIndex] = next
    else {
      const sameRound = nextEntries.findIndex((entry) => entry.episode.id === next.episode.id
        && entry.signal.action.singleChat?.conversationId === next.signal.action.singleChat?.conversationId)
      if (sameRound >= 0 && headsUpPriority(next.signal.semantic) >= headsUpPriority(nextEntries[sameRound].signal.semantic)) {
        overflowEntries.push(nextEntries[sameRound])
        nextEntries[sameRound] = next
      } else if (nextEntries.length < maximumEntries && overflowEntries.length === 0) nextEntries.push(next)
      else overflowEntries.push(next)
    }
  }
  return { entries: nextEntries, overflowEntries }
}

function headsUpPriority(semantic: NotificationSemantic): number {
  return { native_interaction_pending: 5, approval_pending: 5, mission_needs_you: 5, turn_failed: 4, turn_incomplete: 3, run_stopped: 3, user_mention: 2, turn_completed: 1, round_completed: 1, single_chat_reply: 1, mission_status_changed: 2, task_status_changed: 1 }[semantic]
}

// Project the current Runtime source into the existing presentation queue only.
// These entries never enter the durable Episode journal or acknowledgement commands.
export function reconcileNativeInteractionHeadsUp(
  current: NotificationHeadsUpState,
  previousIds: ReadonlySet<string> | null,
  pending: readonly NativeInteractionNotification[],
  preference: NotificationPreference | null,
  quietThreadId: string | null,
  now = Date.now()
): NotificationHeadsUpState {
  const active = pending.filter(source => source.expiresAt === null || source.expiresAt > now)
  const ids = new Set(active.map(source => source.id))
  const retain = (entry: NotificationHeadsUpEntry): boolean => !entry.signal.nativeInteraction
    || ids.has(entry.signal.nativeInteraction.id)
  const retained = { entries: current.entries.filter(retain), overflowEntries: current.overflowEntries.filter(retain) }
  if (previousIds === null || !preference?.headsUpEnabled || !preference.approvalHeadsUpEnabled) return retained
  const changes = active.filter(source => !previousIds.has(source.id) && source.thread.id !== quietThreadId)
    .map((source): NotificationEpisodeChange => {
      const id = `native-interaction:${source.id}`
      const action: NotificationActionView = { actionId: id, kind: 'open_native_interaction', available: true,
        threadId: source.thread.id, agentRunId: source.agentRunId, interactionId: source.id,
        threadTurnId: null, messageId: null, approvalId: null, acknowledgementId: null,
        observedEpisodeVersion: 0, singleChat: source.singleChat }
      const signal: NotificationHeadsUpSignal = { semantic: 'native_interaction_pending',
        nativeInteraction: source, action, mention: null, admittedAttentionRevision: 0 }
      const time = new Date(source.createdAt).toISOString()
      const episode: NotificationEpisodeView = { id, kind: 'collaboration', episodeVersion: 0,
        attentionRevision: 0, changeSequence: 0, thread: source.thread, threadTurnId: null,
        agentRunId: source.agentRunId, primarySemantic: signal.semantic, unread: false,
        resolved: false, satisfied: false, pendingApprovalCount: 0, mentionCount: 0,
        unacknowledgedMentionCount: 0, mention: null, reasons: [], primaryAction: action,
        secondaryActions: [], createdAt: time, updatedAt: time }
      return { episodeId: id, episodeVersion: 0, attentionRevision: 0, changeSequence: 0,
        operation: 'upsert', changeCause: 'occurrence_admitted', headsUpSignal: signal,
        headsUpInvalidation: null, changedAt: time, episode }
    })
  return applyNotificationHeadsUpChanges(retained, changes)
}

export function filterVisibleNotificationHeadsUp(
  current: NotificationHeadsUpState,
  sources: readonly VisibleNotificationSources[],
  attentive: boolean,
  quietThreadId: string | null = null
): NotificationHeadsUpState {
  if (!attentive) return current
  const retain = (entry: NotificationHeadsUpEntry): boolean => {
    const action = entry.signal.action
    if (!action.available) return false
    if (quietThreadId !== null && entry.episode.thread.id === quietThreadId) return false
    return !sources.some((source) => source.threadId === action.threadId
      && source.surfaceVisible !== false
      && (source.conversationId ?? null) === (action.singleChat?.conversationId ?? null)
      && ((entry.signal.semantic === 'approval_pending' && action.approvalId !== null && source.approvalIds.includes(action.approvalId))
        || (entry.signal.semantic === 'user_mention' && action.messageId !== null && source.messageIds.includes(action.messageId))
        || (['turn_completed', 'round_completed', 'single_chat_reply', 'turn_failed', 'turn_incomplete'].includes(entry.signal.semantic)
          && ((action.agentRunId !== null && source.agentRunIds.includes(action.agentRunId))
            || (action.threadTurnId !== null && source.campTurnIds.includes(action.threadTurnId))))))
  }
  const entries = current.entries.filter(retain)
  const overflowEntries = current.overflowEntries.filter(retain)
  return entries.length === current.entries.length && overflowEntries.length === current.overflowEntries.length
    ? current : { entries, overflowEntries }
}

export function promoteNotificationHeadsUpOverflow(
  current: NotificationHeadsUpState,
  maximumEntries = 1
): NotificationHeadsUpState {
  if (current.entries.length > 0 || current.overflowEntries.length === 0) return current
  return {
    entries: current.overflowEntries.slice(0, maximumEntries),
    overflowEntries: current.overflowEntries.slice(maximumEntries)
  }
}

function removeHeadsUpByAcknowledgementId(
  current: NotificationHeadsUpState,
  acknowledgementId: string
): NotificationHeadsUpState {
  const retainsSignal = (entry: NotificationHeadsUpEntry): boolean => (
    entry.signal.action.acknowledgementId !== acknowledgementId
  )
  return {
    entries: current.entries.filter(retainsSignal),
    overflowEntries: current.overflowEntries.filter(retainsSignal)
  }
}

function filterHeadsUpByPreference(
  current: NotificationHeadsUpState,
  preference: NotificationPreference
): NotificationHeadsUpState {
  const retainsSignal = (entry: NotificationHeadsUpEntry): boolean => (
    shouldShowHeadsUp(entry.signal, preference)
  )
  return {
    entries: current.entries.filter(retainsSignal),
    overflowEntries: current.overflowEntries.filter(retainsSignal)
  }
}

function filterTaskHeadsUp(
  current: NotificationHeadsUpState,
  enabled: boolean,
  afterSequence: number
): NotificationHeadsUpState {
  const retain = (entry: NotificationHeadsUpEntry): boolean => entry.episode.kind !== 'task'
    || (enabled && entry.changeSequence > afterSequence)
  return { entries: current.entries.filter(retain), overflowEntries: current.overflowEntries.filter(retain) }
}

export async function readNotificationChangePages(
  startCursor: number,
  requestPage: (afterChangeSequence: number) => Promise<NotificationEpisodeChangeBatch>,
  maximumPages = 10
): Promise<{
  changes: NotificationEpisodeChange[]
  nextChangeSequence: number
  resetRequired: boolean
  taskCapability: TaskCapabilitySnapshot
}> {
  const changes: NotificationEpisodeChange[] = []
  let taskCapability: TaskCapabilitySnapshot | null = null
  let candidateCursor = startCursor
  for (let page = 0; page < maximumPages; page += 1) {
    const batch = await requestPage(candidateCursor)
    if (batch.schemaVersion !== 11) throw new Error(uiAttribute('提醒增量合同不兼容。'))
    if (!validTaskCapability(batch.taskCapability)
      || batch.taskCapability.observedThroughChangeSequence !== batch.throughChangeSequence) {
      throw new Error(uiAttribute('提醒增量合同不兼容。'))
    }
    taskCapability = batch.taskCapability
    if (batch.requestedAfterChangeSequence !== candidateCursor) {
      throw new Error(uiAttribute('提醒增量游标边界不一致。'))
    }
    if (batch.resetRequired) {
      return {
        changes: [],
        nextChangeSequence: batch.nextChangeSequence,
        resetRequired: true,
        taskCapability
      }
    }
    if (
      batch.nextChangeSequence < candidateCursor
      || batch.nextChangeSequence > batch.throughChangeSequence
      || (batch.hasMore && batch.nextChangeSequence === candidateCursor)
    ) throw new Error(uiAttribute('提醒增量游标没有单调推进。'))
    changes.push(...batch.changes)
    candidateCursor = batch.nextChangeSequence
    if (!batch.hasMore) break
    await Promise.resolve()
  }
  if (!taskCapability) throw new Error(uiAttribute('提醒增量合同不兼容。'))
  return { changes, nextChangeSequence: candidateCursor, resetRequired: false, taskCapability }
}

export function shouldPollForNotificationEvent(method: string): boolean {
  return method === 'notification_episode.changed'
}

export function notificationHeadsUpPresentation(
  signal: NotificationHeadsUpSignal
): { label: string; message: string } {
  switch (signal.semantic) {
    case 'native_interaction_pending':
      return { label: uiAttribute('等待回答'), message: uiAttribute('{0}在等你回答', signal.nativeInteraction?.agentDisplayName ?? uiAttribute('队员')) }
    case 'approval_pending':
      return { label:uiAttribute("待审批"), message:uiAttribute("有操作等待你审批") }
    case 'turn_failed':
      return { label:uiAttribute("执行失败"), message:uiAttribute("本轮执行失败，请查看详情") }
    case 'turn_incomplete':
      return { label:uiAttribute("执行未完成"), message:uiAttribute("本轮未完成，请查看详情") }
    case 'run_stopped':
      return { label:uiAttribute("执行已停止"), message:uiAttribute("本轮执行已停止") }
    case 'turn_completed':
    case 'round_completed':
      return { label:uiAttribute("本轮完成"), message:uiAttribute("本轮已完成") }
    case 'single_chat_reply':
      return { label:uiAttribute("单聊回复"), message: uiAttribute("{0}已回复", String(signal.action.singleChat?.agentDisplayName ?? uiAttribute('队员'))) }
    case 'mission_needs_you': {
      const title = signal.action.subject?.title || uiAttribute('使命')
      const question = signal.mention?.available && signal.action.subject?.sourceMessageId === signal.mention.messageId ? signal.mention.summary : null
      return { label:uiAttribute("使命需要你"), message: uiAttribute("使命「{0}」需要你{1}", String(title), question ? `${uiAttribute('：')}${question}` : '') }
    }
    case 'mission_status_changed':
    case 'task_status_changed': {
      const kind = signal.semantic === 'mission_status_changed' ?uiAttribute("使命") :uiAttribute("任务")
      const subject = signal.action.subject
      const status = { completed: uiAttribute('已完成'), in_progress: uiAttribute('进行中'), not_started: uiAttribute('未开始'), pending: uiAttribute('待开始'), blocked: uiAttribute('受阻'), cancelled: uiAttribute('已取消') }[subject?.status ?? ''] ?? uiAttribute('状态已更新')
      return { label: uiAttribute("{0}状态变更", String(kind)), message: uiAttribute('{0}「{1}」{2}', kind, subject?.title || kind, status) }
    }
    case 'user_mention':
      return {
        label:uiAttribute("提到你"),
        message: signal.mention?.available
          ? signal.mention.summary ?? uiAttribute('有消息明确提到你')
          :uiAttribute("原消息来源不可用")
      }
  }
}

type VisibleAcknowledgementIntent = {
  key: string
  request: { commandId: string; command: {
    threadId: string; observedThroughChangeSequence: number; visibleMessageIds: string[];
    visibleThreadTurnIds: string[]; visibleAgentRunIds: string[]; visibleApprovalIds: string[]
  } }
}

export function visibleAcknowledgementIntent(
  sources: VisibleNotificationSources,
  admittedThrough: number,
  observedThroughChangeSequence: number,
  previous: VisibleAcknowledgementIntent | null,
  newId: () => string = () => newCommandId()
): VisibleAcknowledgementIntent {
  // Both cursors are global fences, not changes to this Thread's visible sources.
  const key = JSON.stringify({ threadId: sources.threadId, admittedThrough,
    messageIds: sources.messageIds, campTurnIds: sources.campTurnIds,
    agentRunIds: sources.agentRunIds, approvalIds: sources.approvalIds })
  if (previous?.key === key) return previous
  return { key, request: { commandId: newId(), command: {
    threadId: sources.threadId, observedThroughChangeSequence,
    visibleMessageIds: [...sources.messageIds], visibleThreadTurnIds: [...sources.campTurnIds],
    visibleAgentRunIds: [...sources.agentRunIds],
    visibleApprovalIds: [...sources.approvalIds]
  } } }
}

export function NotificationAttentionController({
  enabled,
  activeThreadId,
  firstRunThreadId = null,
  activeThreadVisible,
  navigationActive,
  onNavigate,
  onPresentNavigation,
  onCancelNavigation,
  onRefreshVisibleThread,
  onError,
  visibleSources: publicSources,
  singleChatSources = null,
  onHeadsUpVisibleChange
}: NotificationAttentionControllerProps): React.JSX.Element {
  const interruptionAttention = useInterruptionAttention()
  const interruptionChanges = interruptionAttention?.changes
  const resetInterruptions = interruptionAttention?.reset
  const recoverInterruptions = interruptionAttention?.recover
  const capability = useTaskCapability()
  const { enabled: tasksEnabled, headsUpAfterSequence, acceptSnapshot } = capability
  const taskCapability = useRef<TaskCapabilitySnapshot>(capability)
  taskCapability.current = capability
  const client = useThreadClient()
  const readingSources = useMemo(() => activeThreadVisible
    ? [publicSources, singleChatSources].filter((source): source is VisibleNotificationSources => (
      source !== null && source.threadId === activeThreadId && source.surfaceVisible !== false
    )) : [], [activeThreadVisible, activeThreadId, publicSources, singleChatSources])
  const visibleSources = useMemo(() => readingSources.length === 0 ? null : {
    threadId: readingSources[0].threadId,
    snapshotSequence: Math.max(...readingSources.map((source) => source.snapshotSequence)),
    messageIds: [...new Set(readingSources.flatMap((source) => source.messageIds))].sort(),
    campTurnIds: [...new Set(readingSources.flatMap((source) => source.campTurnIds))].sort(),
    agentRunIds: [...new Set(readingSources.flatMap((source) => source.agentRunIds))].sort(),
    approvalIds: [...new Set(readingSources.flatMap((source) => source.approvalIds))].sort()
  }, [readingSources])
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [headsUpState, setHeadsUpState] = useState<NotificationHeadsUpState>(
    emptyNotificationHeadsUpState
  )
  useEffect(() => {
    setHeadsUpState(state => filterTaskHeadsUp(state, tasksEnabled, headsUpAfterSequence))
  }, [tasksEnabled, headsUpAfterSequence])
  const [hasUnreadAttention, setHasUnreadAttention] = useState(false)
  const [observedThroughChangeSequence, setObservedThroughChangeSequence] = useState(0)
  const [baselineRetry, setBaselineRetry] = useState(0)
  const [visibleAcknowledgementRetry, setVisibleAcknowledgementRetry] = useState(0)
  const [busyAcknowledgementId, setBusyAcknowledgementId] = useState<string | null>(null)
  const windowAttentive = useWindowAttentive()
  const [foregroundReady, setForegroundReady] = useState(false)
  const changeCursor = useRef(0)
  const nativeIds = useRef<Set<string> | null>(null)
  const nativeReadSequence = useRef(0)
  const nativeContext = useRef({ enabled, activeThreadId, activeThreadVisible, windowAttentive, preference })
  nativeContext.current = { enabled, activeThreadId, activeThreadVisible, windowAttentive, preference }
  const baselineReady = useRef(false)
  const baselineGeneration = useRef(0)
  const pollRunning = useRef(false)
  // null = no signal; otherwise remember whether the queued read is recovery.
  const pendingPoll = useRef<boolean | null>(null)
  const pollFailureCount = useRef(0)
  const pollRetryAt = useRef(0)
  const navigationGeneration = useRef(0)
  const visibleAcknowledgementKeys = useRef(new Map<string, string>())
  const visibleAcknowledgementRunning = useRef(false)
  const visibleRetryTimer = useRef<number | null>(null)
  const mounted = useRef(false)
  const visibleThreadAdmissions = useRef(new Map<string, number>())
  const visibleCommands = useRef(new Map<string, VisibleAcknowledgementIntent>())

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pendingPoll.current = null
      if (visibleRetryTimer.current !== null) window.clearTimeout(visibleRetryTimer.current)
    }
  }, [])

  const pollCurrent = useRef<(recover?: boolean) => Promise<void>>(async () => {})
  const poll = useCallback((recover = false) => pollCurrent.current(recover), [])

  const loadPreference = useCallback(async (): Promise<NotificationPreference> => {
    const next = await client.request<NotificationPreference>(
      'notifications.preference.get'
    )
    if (!validPreference(next)) throw new Error(uiAttribute('提醒设置合同不兼容。'))
    setPreference(next)
    nativeContext.current.preference = next
    setHeadsUpState((current) => filterHeadsUpByPreference(current, next))
    return next
  }, [])

  const syncNative = useCallback(async (): Promise<void> => {
    if (!mounted.current || !baselineReady.current || !nativeContext.current.enabled) return
    const generation = baselineGeneration.current
    const sequence = ++nativeReadSequence.current
    // Runtime attention failure must not prevent durable Journal convergence.
    const pending = await client.request<NativeInteractionNotification[]>('nativeInteractions.notifications').catch(() => null)
    if (pending === null) return
    const effectivePreference = nativeContext.current.preference ?? await loadPreference().catch(() => null)
    if (!mounted.current || generation !== baselineGeneration.current || sequence !== nativeReadSequence.current) return
    const previousIds = nativeIds.current
    nativeIds.current = new Set(pending.map(source => source.id))
    const context = nativeContext.current
    setHeadsUpState(current => reconcileNativeInteractionHeadsUp(current, previousIds, pending,
      context.preference ?? effectivePreference, context.activeThreadVisible && context.windowAttentive ? context.activeThreadId : null))
  }, [client, loadPreference])

  const readUnreadStatus = useCallback(async (): Promise<NotificationEpisodeInbox> => {
    const inbox = await client.request<NotificationEpisodeInbox>(
      'notifications.inbox',
      { filter: 'unread', limit: 1 }
    )
    if (inbox.schemaVersion !== 11) throw new Error(uiAttribute('提醒基线合同不兼容。'))
    setHasUnreadAttention(inbox.unreadCount > 0)
    return inbox
  }, [])

  const establishBaseline = useCallback(async (): Promise<void> => {
    const generation = ++baselineGeneration.current
    const [inbox, native] = await Promise.all([
      readUnreadStatus(),
      client.request<NativeInteractionNotification[]>('nativeInteractions.notifications').catch(() => null)
    ])
    if (generation !== baselineGeneration.current) return
    nativeIds.current = native === null ? null : new Set(native.map(source => source.id))
    resetInterruptions?.()
    setHeadsUpState(emptyNotificationHeadsUpState())
    changeCursor.current = inbox.throughChangeSequence
    visibleAcknowledgementKeys.current.clear()
    visibleCommands.current.clear()
    visibleThreadAdmissions.current.clear()
    setObservedThroughChangeSequence(inbox.throughChangeSequence)
    baselineReady.current = true
    pollFailureCount.current = 0
    pollRetryAt.current = 0
  }, [client, readUnreadStatus, resetInterruptions])

  useEffect(() => {
    if (!enabled) {
      baselineReady.current = false
      nativeIds.current = null
      baselineGeneration.current += 1
      pendingPoll.current = null
      setHeadsUpState(emptyNotificationHeadsUpState())
      return undefined
    }
    baselineReady.current = false
    let cancelled = false
    let retryTimer: number | null = null
    void Promise.all([
      establishBaseline(),
      loadPreference().catch(() => null)
    ]).then(() => poll()).catch(() => {
      if (cancelled) return
      retryTimer = window.setTimeout(() => {
        setBaselineRetry((value) => value + 1)
      }, 5_000)
    })
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [baselineRetry, enabled, establishBaseline, loadPreference, poll])

  const acknowledgeAction = useCallback(async (
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<void> => {
    const acknowledgementId = action.acknowledgementId
    if (!acknowledgementId) return
    const result = await client.request<StoredCommandResult>(
      'notifications.acknowledge',
      {
        commandId: newCommandId(),
        command: {
          episodeId: episode.id,
          observedEpisodeVersion: action.observedEpisodeVersion,
          acknowledgementId
        }
      }
    )
    if (result.status !== 'applied') throw new Error(commandFailure(result))
    setHeadsUpState((current) => removeHeadsUpByAcknowledgementId(
      current,
      acknowledgementId
    ))
  }, [])

  const pollChanges = useCallback(async (recover = false): Promise<void> => {
    if (!enabled || !mounted.current || !baselineReady.current) return
    if (pollRunning.current) {
      pendingPoll.current = recover || pendingPoll.current === true
      return
    }
    if (Date.now() < pollRetryAt.current) return
    recover = recover || pendingPoll.current === true
    pendingPoll.current = null
    pollRunning.current = true
    const generation = baselineGeneration.current
    try {
      const collected = await readNotificationChangePages(
        changeCursor.current,
        (afterChangeSequence) => client.request<NotificationEpisodeChangeBatch>(
          'notifications.changesSince',
          { afterChangeSequence, limit: 100 }
        )
      )
      if (generation !== baselineGeneration.current) return
      const batchCapability = acceptSnapshot(collected.taskCapability)
      if (!batchCapability) return
      if (collected.resetRequired) {
        await establishBaseline()
        return
      }
      // Use this batch's atomic snapshot, unless a newer settings/notification
      // snapshot has already confirmed another toggle. Never await settings.
      const includesChange = (change: NotificationEpisodeChange): boolean => {
        const current = taskCapability.current.observedThroughChangeSequence > batchCapability.observedThroughChangeSequence
          ? taskCapability.current : batchCapability
        return (change.episode?.kind !== 'task' && change.headsUpSignal?.semantic !== 'task_status_changed')
          || (current.enabled && change.changeSequence > current.headsUpAfterSequence)
      }
      const changes = collected.changes.filter(includesChange)
      interruptionChanges?.(changes)
      if (recover) recoverInterruptions?.()
      for (const change of changes) {
        if (change.changeCause === 'occurrence_admitted' && change.episode) {
          visibleThreadAdmissions.current.set(change.episode.thread.id, change.changeSequence)
        }
      }
      const hasHeadsUpSignal = changes.some((change) => change.headsUpSignal !== null)
      const effectivePreference = hasHeadsUpSignal
        ? preference ?? await loadPreference()
        : preference
      if (generation !== baselineGeneration.current) return
      const headsUpChanges: NotificationEpisodeChange[] = []

      for (const change of changes) {
        const episode = change.episode
        if (
          change.operation !== 'upsert'
          || !episode
          || !change.headsUpSignal
        ) {
          headsUpChanges.push(change)
          continue
        }
        const signal = change.headsUpSignal
        const exactMentionAction = signal.semantic === 'user_mention'
          ? signal.action
          : null
        const exactSourceMayBeVisible = exactMentionAction
          && exactMentionAction.messageId
          && episode.thread.id === activeThreadId
          && activeThreadVisible
          && windowAttentive
          && readingSources.some((source) => !source.conversationId)
        if (exactSourceMayBeVisible) {
          const rendered = await onRefreshVisibleThread(episode, exactMentionAction)
          if (rendered && document.visibilityState === 'visible' && document.hasFocus()) {
            try {
              await acknowledgeAction(episode, exactMentionAction)
              headsUpChanges.push({ ...change, headsUpSignal: null })
              continue
            } catch {
              // The exact signal remains queued when persistence cannot prove it was read.
            }
          }
        }
        const quietCurrentThread = activeThreadVisible
          && windowAttentive
          && episode.thread.id === activeThreadId
        headsUpChanges.push(
          !quietCurrentThread
            && effectivePreference
            && shouldShowHeadsUp(signal, effectivePreference)
            ? change
            : { ...change, headsUpSignal: null }
        )
      }

      if (generation !== baselineGeneration.current) return
      if (headsUpChanges.length > 0) {
        setHeadsUpState((current) => applyNotificationHeadsUpChanges(
          current,
          headsUpChanges.filter(includesChange)
        ))
      }
      if (changes.some((change) => change.episode?.unread === true)) {
        setHasUnreadAttention(true)
      }
      changeCursor.current = collected.nextChangeSequence
      setObservedThroughChangeSequence(collected.nextChangeSequence)
      pollFailureCount.current = 0
      pollRetryAt.current = 0
      if (document.visibilityState === 'visible' && document.hasFocus()) setForegroundReady(true)
      await syncNative()
    } catch (nextError) {
      pollFailureCount.current += 1
      pollRetryAt.current = Date.now() + Math.min(
        30_000,
        2_500 * 2 ** Math.min(pollFailureCount.current, 4)
      )
      throw nextError
    } finally {
      pollRunning.current = false
      // Coalesce signals received while reading. Failed reads keep their
      // existing backoff; the next admitted poll also carries recovery intent.
      if (pendingPoll.current !== null && mounted.current && baselineReady.current
        && Date.now() >= pollRetryAt.current) {
        void poll(pendingPoll.current).catch(() => undefined)
      }
    }
  }, [
    enabled,
    poll,
    interruptionChanges,
    recoverInterruptions,
    acceptSnapshot,
    acknowledgeAction,
    activeThreadId,
    activeThreadVisible,
    establishBaseline,
    loadPreference,
    onRefreshVisibleThread,
    preference,
    readingSources,
    syncNative,
    windowAttentive
  ])

  pollCurrent.current = pollChanges

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => {
      void poll(true).catch(() => undefined)
    }, NOTIFICATION_RECOVERY_INTERVAL_MS)
    let eventTimer: number | null = null
    let journalPending = false
    const schedulePoll = (nativeOnly = false): void => {
      journalPending ||= !nativeOnly
      if (eventTimer !== null) window.clearTimeout(eventTimer)
      eventTimer = window.setTimeout(() => {
        eventTimer = null
        const read = journalPending ? poll : syncNative
        journalPending = false
        void read().catch(() => undefined)
      }, 80)
    }
    const unsubscribe = client.onEvent?.((event) => {
      if (event.method === 'notification_episode.preference_changed') {
        void loadPreference().catch(() => undefined)
        return
      }
      if (shouldPollForNotificationEvent(event.method)) schedulePoll()
      else if (event.method === 'agent_run.interaction_changed'
        || (nativeIds.current?.size && ['agent_run.terminal', 'agent_run.cancelled', 'single_chat.ended'].includes(event.method))) schedulePoll(true)
    })
    const unlisten = client.onInvalidated?.(change => {
      if (!change || change.resync) {
        void loadPreference().catch(() => undefined)
        void poll(true).catch(() => undefined)
      } else if (change.notificationsChanged) {
        void loadPreference().catch(() => undefined)
        schedulePoll()
      } else if (change.nativeInteractionsChanged) schedulePoll(true)
    })
    return () => {
      window.clearInterval(timer)
      if (eventTimer !== null) window.clearTimeout(eventTimer)
      unsubscribe?.()
      unlisten?.()
    }
  }, [client, enabled, loadPreference, poll, syncNative])

  useEffect(() => {
    if (!windowAttentive || !enabled) {
      setForegroundReady(false)
      return
    }
    void poll(true).catch(() => undefined)
  }, [enabled, poll, windowAttentive])

  useEffect(() => {
    setHeadsUpState((current) => filterVisibleNotificationHeadsUp(
      current,
      readingSources,
      windowAttentive,
      activeThreadVisible ? activeThreadId : null
    ))
  }, [activeThreadId, activeThreadVisible, readingSources, windowAttentive, observedThroughChangeSequence])

  useEffect(() => {
    if (
      !enabled
      || !baselineReady.current
      || !hasUnreadAttention
      || navigationActive
      || !activeThreadVisible
      || !visibleSources
      || visibleSources.threadId !== activeThreadId
      || !windowAttentive
    ) return undefined
    const sourceCount = visibleSources.messageIds.length
      + visibleSources.campTurnIds.length
      + visibleSources.agentRunIds.length
      + visibleSources.approvalIds.length
    if (sourceCount === 0) return undefined
    const intent = visibleAcknowledgementIntent(visibleSources,
      visibleThreadAdmissions.current.get(visibleSources.threadId) ?? 0,
      observedThroughChangeSequence, visibleCommands.current.get(visibleSources.threadId) ?? null)
    const key = intent.key
    if (visibleAcknowledgementRunning.current
      || visibleAcknowledgementKeys.current.get(visibleSources.threadId) === key) {
      return undefined
    }
    visibleAcknowledgementRunning.current = true
    visibleCommands.current.set(visibleSources.threadId, intent)
    const generation = baselineGeneration.current
    let applied = false
    void client.request<StoredCommandResult>(
      'notifications.acknowledgeVisibleSources',
      intent.request
    ).then(async (result) => {
      if (result.status !== 'applied') throw new Error(commandFailure(result))
      applied = true
      if (!mounted.current || generation !== baselineGeneration.current) return
      visibleAcknowledgementKeys.current.set(visibleSources.threadId, key)
      // A failed refresh does not make the already-acknowledged command uncertain.
      await Promise.all([poll(), readUnreadStatus()]).catch(() => undefined)
    }).catch(() => {
      // Keep the original UUID and frozen request for an uncertain-result retry.
    }).finally(() => {
      visibleAcknowledgementRunning.current = false
      if (!mounted.current) return
      visibleRetryTimer.current = window.setTimeout(() => {
        visibleRetryTimer.current = null
        setVisibleAcknowledgementRetry((value) => value + 1)
      }, applied ? 0 : 2_500)
    })
    // Dependency churn must not cancel receipt handling or an uncertain retry.
    return undefined
  }, [
    activeThreadId,
    activeThreadVisible,
    enabled,
    hasUnreadAttention,
    navigationActive,
    observedThroughChangeSequence,
    poll,
    readUnreadStatus,
    visibleAcknowledgementRetry,
    visibleSources,
    windowAttentive
  ])

  const openAction = async (
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<void> => {
    if (busyAcknowledgementId || !action.available) return
    const generation = ++navigationGeneration.current
    setBusyAcknowledgementId(action.acknowledgementId ?? action.actionId)
    onCancelNavigation()
    let acknowledgementPersisted = false
    try {
      if (action.acknowledgementId) {
        await acknowledgeAction(episode, action)
        acknowledgementPersisted = true
        void readUnreadStatus().catch(() => undefined)
      }
      if (action.kind === 'acknowledge_only') return
      const result = await onNavigate(episode, action)
      if (generation !== navigationGeneration.current) {
        onCancelNavigation()
        return
      }
      if (result.status === 'failed') {
        onCancelNavigation()
        onError(acknowledgementPersisted
          ? uiAttribute("{0} 这条提醒已标记为已读。", String(result.message))
          : result.message)
        return
      }
      const presented = await onPresentNavigation(episode, action)
      if (generation !== navigationGeneration.current) {
        onCancelNavigation()
        return
      }
      if (presented && action.kind === 'open_native_interaction') {
        setHeadsUpState(current => ({
          entries: current.entries.filter(entry => entry.signal.action.actionId !== action.actionId),
          overflowEntries: current.overflowEntries.filter(entry => entry.signal.action.actionId !== action.actionId)
        }))
      }
      if (!presented) {
        onCancelNavigation()
        onError(acknowledgementPersisted
          ?uiAttribute("已打开会话，但未能定位到目标；这条提醒已标记为已读。")
          :uiAttribute("已打开会话，但暂时无法定位到目标。"))
      }
    } catch (nextError) {
      onCancelNavigation()
      if (generation !== navigationGeneration.current) return
      onError(acknowledgementPersisted
        ? uiAttribute("提醒已标记为已读，但打开失败：{0}", String(errorMessage(nextError)))
        : uiAttribute("提醒操作未完成：{0}", String(errorMessage(nextError))))
    } finally {
      setBusyAcknowledgementId(null)
    }
  }

  useEffect(() => {
    const deadlines = [...headsUpState.entries, ...headsUpState.overflowEntries]
      .flatMap(entry => entry.signal.nativeInteraction?.expiresAt == null ? [] : [entry.signal.nativeInteraction.expiresAt])
    if (deadlines.length === 0) return
    const timer = window.setTimeout(() => {
      const retain = (entry: NotificationHeadsUpEntry): boolean => entry.signal.nativeInteraction?.expiresAt == null
        || entry.signal.nativeInteraction.expiresAt > Date.now()
      setHeadsUpState(current => ({ entries: current.entries.filter(retain), overflowEntries: current.overflowEntries.filter(retain) }))
    }, Math.min(2_147_483_647, Math.max(0, Math.min(...deadlines) - Date.now())))
    return () => window.clearTimeout(timer)
  }, [headsUpState])

  const presentableState = filterVisibleNotificationHeadsUp(
    filterTaskHeadsUp(headsUpState, tasksEnabled, headsUpAfterSequence),
    readingSources,
    windowAttentive,
    activeThreadVisible ? activeThreadId : null
  )
  const currentHeadsUp = presentableState.entries[0] ?? null
  const headsUpOverflow = presentableState.overflowEntries.length
  const visibleHeadsUp = windowAttentive && foregroundReady && (currentHeadsUp !== null || headsUpOverflow > 0)
  useEffect(() => {
    onHeadsUpVisibleChange?.(visibleHeadsUp)
    return () => onHeadsUpVisibleChange?.(false)
  }, [onHeadsUpVisibleChange, visibleHeadsUp])
  return (
    <>
      {currentHeadsUp && (
        <NotificationHeadsUp
          key={`${currentHeadsUp.episode.id}:${currentHeadsUp.signal.action.singleChat?.conversationId ?? 'public'}`}
          active={windowAttentive && foregroundReady}
          entry={currentHeadsUp}
          firstRunThreadId={firstRunThreadId}
          busy={busyAcknowledgementId !== null}
          onOpen={() => void openAction(
            currentHeadsUp.episode,
            currentHeadsUp.signal.action
          )}
          onDismiss={() => setHeadsUpState((current) => ({
            ...current,
            entries: current.entries.slice(1)
          }))}
        />
      )}
      {!currentHeadsUp && headsUpOverflow > 0 && (
        <NotificationHeadsUpSummary
          active={windowAttentive && foregroundReady}
          count={headsUpOverflow}
          onOpen={() => setHeadsUpState((current) => (
            promoteNotificationHeadsUpOverflow(current)
          ))}
          onDismiss={() => setHeadsUpState((current) => ({
            ...current,
            overflowEntries: []
          }))}
        />
      )}
    </>
  )
}

export function NotificationHeadsUp({
  active = true,
  entry,
  firstRunThreadId = null,
  busy,
  onOpen,
  onDismiss
}: {
  active?: boolean
  entry: NotificationHeadsUpEntry
  firstRunThreadId?: string | null
  busy: boolean
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const presentation = notificationHeadsUpPresentation(entry.signal)
  const threadTitle = formatThreadTitle(entry.episode.thread, firstRunThreadId)
  const privateTitle = entry.signal.action.singleChat ? uiAttribute(" · 与{0}单聊", String(entry.signal.action.singleChat.agentDisplayName)) : ''
  useHeadsUpLifetime(!active || hovered || focused || busy, onDismiss, entry.signal.action.acknowledgementId)
  return (
    <aside
      className="notification-heads-up"
      data-semantic={entry.signal.semantic}
      hidden={!active}
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <button
        className="notification-heads-up-open"
        type="button"
        disabled={busy || !entry.signal.action.available}
        aria-busy={busy ? 'true' : undefined}
        onClick={onOpen}
      >
        <strong className="notification-heads-up-source" title={`${threadTitle}${privateTitle}`}><i className="notification-heads-up-dot" aria-hidden="true" /><span>{threadTitle}</span>{privateTitle && <b>{privateTitle}</b>}</strong>
        <span className="notification-heads-up-message">{presentation.message}</span>
      </button>
      <button
        className="notification-heads-up-close"
        type="button"
        aria-label={uiAttribute("关闭本次提醒")}
        onClick={onDismiss}
      ><CloseIcon /></button>
    </aside>
  )
}

function NotificationHeadsUpSummary({
  active,
  count,
  onOpen,
  onDismiss
}: {
  active: boolean
  count: number
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  useHeadsUpLifetime(!active || hovered || focused, onDismiss)
  return (
    <aside
      className="notification-heads-up notification-heads-up-summary"
      hidden={!active}
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <button className="notification-heads-up-open" type="button" onClick={onOpen}>
        <span><UiText zh={"还有 "} />{count}<UiText zh={" 条提醒"} /></span><span><UiText zh={"查看下一条"} /></span>
      </button>
      <button
        className="notification-heads-up-close"
        type="button"
        aria-label={uiAttribute("关闭这些提醒")}
        onClick={onDismiss}
      ><CloseIcon /></button>
    </aside>
  )
}

function useHeadsUpLifetime(paused: boolean, onDismiss: () => void, identity: string | null = null): void {
  const previousIdentity = useRef(identity)
  const remaining = useRef(8_000)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss
  useEffect(() => {
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity
      remaining.current = 8_000
    }
    if (paused) return
    const start = performance.now()
    const timer = window.setTimeout(() => onDismissRef.current(), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (performance.now() - start))
    }
  }, [paused, identity])
}

function useWindowAttentive(): boolean {
  const read = (): boolean => (
    typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && document.hasFocus()
  )
  const [attentive, setAttentive] = useState(read)
  useEffect(() => {
    const update = (): void => setAttentive(read())
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    update()
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return attentive
}

export function shouldShowHeadsUp(
  signal: NotificationHeadsUpSignal,
  preference: NotificationPreference
): boolean {
  if (!preference.headsUpEnabled) return false
  switch (signal.semantic) {
    case 'run_stopped': return false
    case 'native_interaction_pending':
    case 'approval_pending': return preference.approvalHeadsUpEnabled
    case 'user_mention': return preference.userMentionHeadsUpEnabled
    case 'turn_completed':
    case 'round_completed': return preference.turnCompletedHeadsUpEnabled
    case 'single_chat_reply': return preference.singleChatHeadsUpEnabled
    case 'mission_needs_you': return preference.missionNeedsYouHeadsUpEnabled
    case 'mission_status_changed': return preference.missionStatusHeadsUpEnabled
      && (preference.missionStatuses as string[]).includes(signal.action.subject?.status ?? '')
    case 'task_status_changed': return preference.taskStatusHeadsUpEnabled
      && (preference.taskStatuses as string[]).includes(signal.action.subject?.status ?? '')
    default: return preference.turnIncompleteHeadsUpEnabled
  }
}

function validPreference(value: NotificationPreference): boolean {
  return preferenceFromUnknown(value) !== null
}

function commandFailure(result: StoredCommandResult): string {
  const message = result.payload && typeof result.payload === 'object'
    ? (result.payload as { message?: unknown }).message
    : null
  return typeof message === 'string' ? message : result.code
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

function errorMessage(error: unknown): string {
  return readErrorMessage(error)
}
