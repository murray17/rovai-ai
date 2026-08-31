import { readErrorMessage } from './error-message'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  NotificationActionView,
  NotificationEpisodeChange,
  NotificationEpisodeChangeBatch,
  NotificationEpisodeInbox,
  NotificationEpisodeView,
  NotificationHeadsUpSignal,
  NotificationPreference,
  NotificationSemantic,
  StoredCommandResult
} from '@contracts'
import type { VisibleNotificationSources } from './CampWorkspace'
import { formatCampTitle } from './camp-title'

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
  activeCampId: string | null
  activeCampVisible: boolean
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
  onRefreshVisibleCamp(
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<boolean>
  onError(message: string): void
  visibleSources: VisibleNotificationSources | null
  onHeadsUpVisibleChange?(visible: boolean): void
}

export const emptyNotificationHeadsUpState = (): NotificationHeadsUpState => ({
  entries: [],
  overflowEntries: []
})

export function applyNotificationHeadsUpChanges(
  current: NotificationHeadsUpState,
  incoming: readonly NotificationEpisodeChange[],
  maximumEntries = 3
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
    const existingIndex = nextEntries.findIndex((entry) => entry.episode.id === change.episodeId)
    if (existingIndex >= 0) {
      nextEntries[existingIndex] = next
      continue
    }
    const existingOverflowIndex = overflowEntries.findIndex(
      (entry) => entry.episode.id === change.episodeId
    )
    if (existingOverflowIndex >= 0) {
      overflowEntries[existingOverflowIndex] = next
    } else if (nextEntries.length < maximumEntries) {
      nextEntries.push(next)
    } else {
      overflowEntries.push(next)
    }
  }
  return { entries: nextEntries, overflowEntries }
}

export function promoteNotificationHeadsUpOverflow(
  current: NotificationHeadsUpState,
  maximumEntries = 3
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
    shouldShowHeadsUp(entry.signal.semantic, preference)
  )
  return {
    entries: current.entries.filter(retainsSignal),
    overflowEntries: current.overflowEntries.filter(retainsSignal)
  }
}

export async function readNotificationChangePages(
  startCursor: number,
  requestPage: (afterChangeSequence: number) => Promise<NotificationEpisodeChangeBatch>,
  maximumPages = 10
): Promise<{
  changes: NotificationEpisodeChange[]
  nextChangeSequence: number
  resetRequired: boolean
}> {
  const changes: NotificationEpisodeChange[] = []
  let candidateCursor = startCursor
  for (let page = 0; page < maximumPages; page += 1) {
    const batch = await requestPage(candidateCursor)
    if (batch.schemaVersion !== 6) throw new Error('提醒增量合同不兼容。')
    if (batch.requestedAfterChangeSequence !== candidateCursor) {
      throw new Error('提醒增量游标边界不一致。')
    }
    if (batch.resetRequired) {
      return {
        changes: [],
        nextChangeSequence: batch.nextChangeSequence,
        resetRequired: true
      }
    }
    if (
      batch.nextChangeSequence < candidateCursor
      || batch.nextChangeSequence > batch.throughChangeSequence
      || (batch.hasMore && batch.nextChangeSequence === candidateCursor)
    ) throw new Error('提醒增量游标没有单调推进。')
    changes.push(...batch.changes)
    candidateCursor = batch.nextChangeSequence
    if (!batch.hasMore) break
    await Promise.resolve()
  }
  return { changes, nextChangeSequence: candidateCursor, resetRequired: false }
}

export function shouldPollForNotificationEvent(method: string): boolean {
  return method === 'notification_episode.changed'
}

export function notificationHeadsUpPresentation(
  signal: NotificationHeadsUpSignal
): { label: string; message: string } {
  switch (signal.semantic) {
    case 'approval_pending':
      return { label: '待审批', message: '有操作等待你确认' }
    case 'turn_failed':
      return { label: '执行失败', message: '本轮协作失败，请返回查看' }
    case 'turn_incomplete':
      return { label: '执行未完成', message: '本轮协作未能证明完成，请返回查看' }
    case 'turn_completed':
      return { label: '等待你的下一步', message: '本轮协作已经完成' }
    case 'user_mention':
      return {
        label: '提到你',
        message: signal.mention?.available
          ? signal.mention.summary ?? '有消息明确提到你'
          : '原消息来源不可用'
      }
  }
}

export function NotificationAttentionController({
  enabled,
  activeCampId,
  activeCampVisible,
  navigationActive,
  onNavigate,
  onPresentNavigation,
  onCancelNavigation,
  onRefreshVisibleCamp,
  onError,
  visibleSources,
  onHeadsUpVisibleChange
}: NotificationAttentionControllerProps): React.JSX.Element {
  const [preference, setPreference] = useState<NotificationPreference | null>(null)
  const [headsUpState, setHeadsUpState] = useState<NotificationHeadsUpState>(
    emptyNotificationHeadsUpState
  )
  const [hasUnreadAttention, setHasUnreadAttention] = useState(false)
  const [observedThroughChangeSequence, setObservedThroughChangeSequence] = useState(0)
  const [baselineRetry, setBaselineRetry] = useState(0)
  const [visibleAcknowledgementRetry, setVisibleAcknowledgementRetry] = useState(0)
  const [busyAcknowledgementId, setBusyAcknowledgementId] = useState<string | null>(null)
  const windowAttentive = useWindowAttentive()
  const changeCursor = useRef(0)
  const baselineReady = useRef(false)
  const baselineGeneration = useRef(0)
  const pollRunning = useRef(false)
  const pollFailureCount = useRef(0)
  const pollRetryAt = useRef(0)
  const navigationGeneration = useRef(0)
  const visibleAcknowledgementKey = useRef<string | null>(null)
  const visibleAcknowledgementRunning = useRef(false)

  const loadPreference = useCallback(async (): Promise<NotificationPreference> => {
    const next = await window.rovai.request<NotificationPreference>(
      'notifications.preference.get'
    )
    if (!validPreference(next)) throw new Error('提醒设置合同不兼容。')
    setPreference(next)
    setHeadsUpState((current) => filterHeadsUpByPreference(current, next))
    return next
  }, [])

  const readUnreadStatus = useCallback(async (): Promise<NotificationEpisodeInbox> => {
    const inbox = await window.rovai.request<NotificationEpisodeInbox>(
      'notifications.inbox',
      { filter: 'unread', limit: 1 }
    )
    if (inbox.schemaVersion !== 6) throw new Error('提醒基线合同不兼容。')
    setHasUnreadAttention(inbox.unreadCount > 0)
    return inbox
  }, [])

  const establishBaseline = useCallback(async (): Promise<void> => {
    const generation = ++baselineGeneration.current
    const inbox = await readUnreadStatus()
    if (generation !== baselineGeneration.current) return
    setHeadsUpState(emptyNotificationHeadsUpState())
    changeCursor.current = inbox.throughChangeSequence
    setObservedThroughChangeSequence(inbox.throughChangeSequence)
    baselineReady.current = true
    pollFailureCount.current = 0
    pollRetryAt.current = 0
  }, [readUnreadStatus])

  useEffect(() => {
    if (!enabled) {
      baselineReady.current = false
      baselineGeneration.current += 1
      setHeadsUpState(emptyNotificationHeadsUpState())
      return undefined
    }
    let cancelled = false
    let retryTimer: number | null = null
    void Promise.all([
      establishBaseline(),
      loadPreference().catch(() => null)
    ]).catch(() => {
      if (cancelled) return
      retryTimer = window.setTimeout(() => {
        setBaselineRetry((value) => value + 1)
      }, 5_000)
    })
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [baselineRetry, enabled, establishBaseline, loadPreference])

  const acknowledgeAction = useCallback(async (
    episode: NotificationEpisodeView,
    action: NotificationActionView
  ): Promise<void> => {
    const acknowledgementId = action.acknowledgementId
    if (!acknowledgementId) return
    const result = await window.rovai.request<StoredCommandResult>(
      'notifications.acknowledge',
      {
        commandId: crypto.randomUUID(),
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

  const pollChanges = useCallback(async (): Promise<void> => {
    if (
      !baselineReady.current
      || pollRunning.current
      || Date.now() < pollRetryAt.current
    ) return
    pollRunning.current = true
    try {
      const collected = await readNotificationChangePages(
        changeCursor.current,
        (afterChangeSequence) => window.rovai.request<NotificationEpisodeChangeBatch>(
          'notifications.changesSince',
          { afterChangeSequence, limit: 100 }
        )
      )
      if (collected.resetRequired) {
        await establishBaseline()
        return
      }
      const changes = collected.changes
      const hasHeadsUpSignal = changes.some((change) => change.headsUpSignal !== null)
      const effectivePreference = hasHeadsUpSignal
        ? preference ?? await loadPreference()
        : preference
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
          && episode.camp.id === activeCampId
          && activeCampVisible
          && windowAttentive
        if (exactSourceMayBeVisible) {
          const rendered = await onRefreshVisibleCamp(episode, exactMentionAction)
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
        headsUpChanges.push(
          effectivePreference && shouldShowHeadsUp(signal.semantic, effectivePreference)
            ? change
            : { ...change, headsUpSignal: null }
        )
      }

      if (headsUpChanges.length > 0) {
        setHeadsUpState((current) => applyNotificationHeadsUpChanges(
          current,
          headsUpChanges
        ))
      }
      if (changes.some((change) => change.episode?.unread === true)) {
        setHasUnreadAttention(true)
      }
      changeCursor.current = collected.nextChangeSequence
      setObservedThroughChangeSequence(collected.nextChangeSequence)
      pollFailureCount.current = 0
      pollRetryAt.current = 0
    } catch (nextError) {
      pollFailureCount.current += 1
      pollRetryAt.current = Date.now() + Math.min(
        30_000,
        2_500 * 2 ** Math.min(pollFailureCount.current, 4)
      )
      throw nextError
    } finally {
      pollRunning.current = false
    }
  }, [
    acknowledgeAction,
    activeCampId,
    activeCampVisible,
    establishBaseline,
    loadPreference,
    onRefreshVisibleCamp,
    preference,
    windowAttentive
  ])

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => {
      void pollChanges().catch(() => undefined)
    }, NOTIFICATION_RECOVERY_INTERVAL_MS)
    let eventTimer: number | null = null
    const schedulePoll = (): void => {
      if (eventTimer !== null) window.clearTimeout(eventTimer)
      eventTimer = window.setTimeout(() => {
        eventTimer = null
        void pollChanges().catch(() => undefined)
      }, 80)
    }
    const unsubscribe = window.rovai.onEvent((event) => {
      if (event.method === 'notification_episode.preference_changed') {
        void loadPreference().catch(() => undefined)
        return
      }
      if (shouldPollForNotificationEvent(event.method)) schedulePoll()
    })
    window.addEventListener('focus', schedulePoll)
    return () => {
      window.clearInterval(timer)
      if (eventTimer !== null) window.clearTimeout(eventTimer)
      window.removeEventListener('focus', schedulePoll)
      unsubscribe()
    }
  }, [enabled, loadPreference, pollChanges])

  useEffect(() => {
    if (
      !enabled
      || !baselineReady.current
      || !hasUnreadAttention
      || navigationActive
      || !activeCampVisible
      || !visibleSources
      || visibleSources.campId !== activeCampId
      || !windowAttentive
    ) return undefined
    const sourceCount = visibleSources.messageIds.length
      + visibleSources.campTurnIds.length
      + visibleSources.approvalIds.length
    if (sourceCount === 0) return undefined
    const key = JSON.stringify({
      observedThroughChangeSequence,
      ...visibleSources
    })
    if (visibleAcknowledgementRunning.current || visibleAcknowledgementKey.current === key) {
      return undefined
    }
    visibleAcknowledgementRunning.current = true
    visibleAcknowledgementKey.current = key
    let cancelled = false
    let retryTimer: number | null = null
    void window.rovai.request<StoredCommandResult>(
      'notifications.acknowledgeVisibleSources',
      {
        commandId: crypto.randomUUID(),
        command: {
          campId: visibleSources.campId,
          observedThroughChangeSequence,
          visibleMessageIds: visibleSources.messageIds,
          visibleCampTurnIds: visibleSources.campTurnIds,
          visibleApprovalIds: visibleSources.approvalIds
        }
      }
    ).then(async (result) => {
      if (result.status !== 'applied') throw new Error(commandFailure(result))
      if (cancelled) return
      await pollChanges()
      await readUnreadStatus()
    }).catch(() => {
      if (cancelled) return
      visibleAcknowledgementKey.current = null
      retryTimer = window.setTimeout(() => {
        setVisibleAcknowledgementRetry((value) => value + 1)
      }, 2_500)
    }).finally(() => {
      visibleAcknowledgementRunning.current = false
    })
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [
    activeCampId,
    activeCampVisible,
    enabled,
    hasUnreadAttention,
    navigationActive,
    observedThroughChangeSequence,
    pollChanges,
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
          ? `${result.message} 这条提醒已标记为已读。`
          : result.message)
        return
      }
      const presented = await onPresentNavigation(episode, action)
      if (generation !== navigationGeneration.current) {
        onCancelNavigation()
        return
      }
      if (!presented) {
        onCancelNavigation()
        onError(acknowledgementPersisted
          ? '已打开会话，但未能定位到目标；这条提醒已标记为已读。'
          : '已打开会话，但暂时无法定位到目标。')
      }
    } catch (nextError) {
      onCancelNavigation()
      if (generation !== navigationGeneration.current) return
      onError(acknowledgementPersisted
        ? `提醒已标记为已读，但打开失败：${errorMessage(nextError)}`
        : `提醒操作未完成：${errorMessage(nextError)}`)
    } finally {
      setBusyAcknowledgementId(null)
    }
  }

  const currentHeadsUp = headsUpState.entries[0] ?? null
  const headsUpOverflow = headsUpState.overflowEntries.length
  const visibleHeadsUp = windowAttentive && (currentHeadsUp !== null || headsUpOverflow > 0)
  useEffect(() => {
    onHeadsUpVisibleChange?.(visibleHeadsUp)
    return () => onHeadsUpVisibleChange?.(false)
  }, [onHeadsUpVisibleChange, visibleHeadsUp])
  if (!windowAttentive) return <></>
  return (
    <>
      {currentHeadsUp && (
        <NotificationHeadsUp
          key={currentHeadsUp.episode.id}
          entry={currentHeadsUp}
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

function NotificationHeadsUp({
  entry,
  busy,
  onOpen,
  onDismiss
}: {
  entry: NotificationHeadsUpEntry
  busy: boolean
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const onDismissRef = useRef(onDismiss)
  const presentation = notificationHeadsUpPresentation(entry.signal)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    if (paused || busy) return undefined
    const timer = window.setTimeout(() => onDismissRef.current(), 8_000)
    return () => window.clearTimeout(timer)
  }, [busy, paused, entry.changeSequence])
  return (
    <aside
      className="notification-heads-up"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}
    >
      <button
        className="notification-heads-up-open"
        type="button"
        disabled={busy || !entry.signal.action.available}
        aria-busy={busy ? 'true' : undefined}
        onClick={onOpen}
      >
        <strong>{presentation.label}</strong>
        <span>{presentation.message}</span>
        <small title={formatCampTitle(entry.episode.camp)}>{formatCampTitle(entry.episode.camp)}</small>
      </button>
      <button
        className="notification-heads-up-close"
        type="button"
        aria-label="关闭本次提醒"
        onClick={onDismiss}
      ><CloseIcon /></button>
    </aside>
  )
}

function NotificationHeadsUpSummary({
  count,
  onOpen,
  onDismiss
}: {
  count: number
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    if (paused) return undefined
    const timer = window.setTimeout(() => onDismissRef.current(), 8_000)
    return () => window.clearTimeout(timer)
  }, [paused])
  return (
    <aside
      className="notification-heads-up notification-heads-up-summary"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}
    >
      <button className="notification-heads-up-open" type="button" onClick={onOpen}>
        <strong>还有 {count} 项新提醒</strong>
        <span>查看下一条</span>
      </button>
      <button
        className="notification-heads-up-close"
        type="button"
        aria-label="关闭这些提醒"
        onClick={onDismiss}
      ><CloseIcon /></button>
    </aside>
  )
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

function shouldShowHeadsUp(
  semantic: NotificationSemantic,
  preference: NotificationPreference
): boolean {
  if (!preference.headsUpEnabled) return false
  if (semantic === 'approval_pending') return preference.approvalHeadsUpEnabled
  if (semantic === 'user_mention') return preference.userMentionHeadsUpEnabled
  if (semantic === 'turn_completed') return preference.turnCompletedHeadsUpEnabled
  return preference.turnIncompleteHeadsUpEnabled
}

function validPreference(value: NotificationPreference): boolean {
  return typeof value.headsUpEnabled === 'boolean'
    && typeof value.approvalHeadsUpEnabled === 'boolean'
    && typeof value.userMentionHeadsUpEnabled === 'boolean'
    && typeof value.turnCompletedHeadsUpEnabled === 'boolean'
    && typeof value.turnIncompleteHeadsUpEnabled === 'boolean'
    && typeof value.version === 'number'
    && typeof value.updatedAt === 'string'
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
