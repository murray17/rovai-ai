import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  NotificationActionView,
  NotificationEpisodeChange,
  NotificationEpisodeChangeBatch,
  NotificationEpisodeFilter,
  NotificationEpisodeInbox,
  NotificationEpisodeView,
  NotificationPreference,
  NotificationSemantic,
  StoredCommandResult
} from '@contracts'

type LoadState = 'loading' | 'ready' | 'error'

export type NotificationHeadsUpEntry = {
  episode: NotificationEpisodeView
  reason: NotificationSemantic
  changeSequence: number
}

export function enqueueNotificationHeadsUps(
  current: readonly NotificationHeadsUpEntry[],
  incoming: readonly NotificationEpisodeChange[],
  maximumEntries = 3
): { entries: NotificationHeadsUpEntry[]; overflow: number } {
  const entries = current.map((entry) => ({ ...entry }))
  let overflow = 0
  for (const change of incoming) {
    if (
      change.operation !== 'upsert'
      || !change.episode
      || !change.headsUpReason
      || !episodeHasActiveHeadsUpReason(change.episode, change.headsUpReason)
    ) continue
    const next = {
      episode: change.episode,
      reason: change.headsUpReason,
      changeSequence: change.changeSequence
    }
    const existingIndex = entries.findIndex((entry) => entry.episode.id === change.episodeId)
    if (existingIndex >= 0) {
      entries[existingIndex] = next
    } else if (entries.length < maximumEntries) {
      entries.push(next)
    } else {
      overflow += 1
    }
  }
  return { entries, overflow }
}

export function applyNotificationChanges(
  current: readonly NotificationEpisodeView[],
  changes: readonly NotificationEpisodeChange[]
): NotificationEpisodeView[] {
  const byId = new Map(current.map((episode) => [episode.id, episode]))
  for (const change of changes) {
    if (change.operation === 'remove' || !change.episode) byId.delete(change.episodeId)
    else byId.set(change.episodeId, change.episode)
  }
  return [...byId.values()]
}

export interface NotificationCenterHandle {
  open(trigger?: HTMLButtonElement | null): void
}

export type NotificationNavigationResult =
  | { status: 'navigated' }
  | { status: 'failed'; message: string }

interface NotificationCenterProps {
  enabled: boolean
  activeCampId: string | null
  activeCampVisible: boolean
  refreshSignal: number
  onUnreadCountChange(count: number): void
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
}

export const NotificationCenter = forwardRef<NotificationCenterHandle, NotificationCenterProps>(
  function NotificationCenter({
    enabled,
    activeCampId,
    activeCampVisible,
    refreshSignal,
    onUnreadCountChange,
    onNavigate,
    onPresentNavigation,
    onCancelNavigation,
    onRefreshVisibleCamp
  }: NotificationCenterProps, ref): React.JSX.Element {
    const [open, setOpen] = useState(false)
    const [filter, setFilter] = useState<NotificationEpisodeFilter>('all')
    const [items, setItems] = useState<NotificationEpisodeView[]>([])
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const [unreadCount, setUnreadCount] = useState(0)
    const [throughChangeSequence, setThroughChangeSequence] = useState(0)
    const [state, setState] = useState<LoadState>('loading')
    const [error, setError] = useState<string | null>(null)
    const [navigationError, setNavigationError] = useState<string | null>(null)
    const [busyEpisodeId, setBusyEpisodeId] = useState<string | null>(null)
    const [globalBusy, setGlobalBusy] = useState(false)
    const [loadingMore, setLoadingMore] = useState(false)
    const [preference, setPreference] = useState<NotificationPreference | null>(null)
    const [headsUpQueue, setHeadsUpQueue] = useState<NotificationHeadsUpEntry[]>([])
    const [headsUpOverflow, setHeadsUpOverflow] = useState(0)
    const changeCursor = useRef(0)
    const baselineReady = useRef(false)
    const pollRunning = useRef(false)
    const pollFailureCount = useRef(0)
    const pollRetryAt = useRef(0)
    const loadGeneration = useRef(0)
    const returnFocusRef = useRef<HTMLButtonElement | null>(null)
    const navigationGeneration = useRef(0)

    useImperativeHandle(ref, () => ({
      open(trigger = null): void {
        navigationGeneration.current += 1
        onCancelNavigation()
        returnFocusRef.current = trigger
        setNavigationError(null)
        setOpen(true)
      }
    }), [onCancelNavigation])

    const acceptInbox = useCallback((inbox: NotificationEpisodeInbox): void => {
      if (inbox.schemaVersion !== 4) throw new Error('通知中心合同不兼容。')
      setItems(inbox.items)
      setNextCursor(inbox.nextCursor)
      setUnreadCount(inbox.unreadCount)
      setThroughChangeSequence(inbox.throughChangeSequence)
      const currentById = new Map(inbox.items.map((episode) => [episode.id, episode]))
      setHeadsUpQueue((current) => current.flatMap((entry) => {
        const episode = currentById.get(entry.episode.id)
        return episode && episodeHasActiveHeadsUpReason(episode, entry.reason)
          ? [{ ...entry, episode }]
          : []
      }))
      onUnreadCountChange(inbox.unreadCount)
    }, [onUnreadCountChange])

    const loadInbox = useCallback(async (
      selectedFilter: NotificationEpisodeFilter,
      showLoading = false
    ): Promise<NotificationEpisodeInbox> => {
      const generation = ++loadGeneration.current
      if (showLoading) setState('loading')
      setError(null)
      try {
        const inbox = await window.rovai.request<NotificationEpisodeInbox>(
          'notifications.inbox',
          { filter: selectedFilter, limit: 50 }
        )
        if (generation === loadGeneration.current) {
          acceptInbox(inbox)
          setState('ready')
        }
        return inbox
      } catch (nextError) {
        if (generation === loadGeneration.current) {
          setState('error')
          setError(errorMessage(nextError))
        }
        throw nextError
      }
    }, [acceptInbox])

    const loadPreference = useCallback(async (): Promise<NotificationPreference> => {
      const next = await window.rovai.request<NotificationPreference>(
        'notifications.preference.get'
      )
      if (!validPreference(next)) throw new Error('通知设置合同不兼容。')
      setPreference(next)
      return next
    }, [])

    useEffect(() => {
      if (!enabled) return undefined
      let cancelled = false
      void Promise.all([
        loadInbox('all', true),
        loadPreference().catch(() => null)
      ]).then(([inbox]) => {
        if (cancelled) return
        changeCursor.current = inbox.throughChangeSequence
        baselineReady.current = true
      }).catch(() => undefined)
      return () => {
        cancelled = true
      }
    }, [enabled, loadInbox, loadPreference])

    useEffect(() => {
      if (!baselineReady.current) return
      void loadInbox(filter).catch(() => undefined)
    }, [filter, loadInbox, refreshSignal])

    useEffect(() => {
      if (!open) return
      setHeadsUpQueue([])
      setHeadsUpOverflow(0)
      void loadInbox(filter).catch(() => undefined)
    }, [filter, loadInbox, open])

    const acknowledgeAction = useCallback(async (
      episode: NotificationEpisodeView,
      action: NotificationActionView
    ): Promise<void> => {
      if (!action.acknowledgementId) return
      const result = await window.rovai.request<StoredCommandResult>(
        'notifications.acknowledge',
        {
          commandId: crypto.randomUUID(),
          command: {
            episodeId: episode.id,
            observedEpisodeVersion: action.observedEpisodeVersion,
            acknowledgementId: action.acknowledgementId
          }
        }
      )
      if (result.status !== 'applied') throw new Error(commandFailure(result))
    }, [])

    const pollChanges = useCallback(async (): Promise<void> => {
      if (
        !baselineReady.current
        || pollRunning.current
        || Date.now() < pollRetryAt.current
      ) return
      pollRunning.current = true
      try {
        const changes: NotificationEpisodeChange[] = []
        let requestCount = 0
        for (;;) {
          const batch = await window.rovai.request<NotificationEpisodeChangeBatch>(
            'notifications.changesSince',
            { afterChangeSequence: changeCursor.current, limit: 100 }
          )
          if (batch.schemaVersion !== 4) throw new Error('通知增量合同不兼容。')
          if (batch.resetRequired) {
            const reset = await loadInbox(filter)
            changeCursor.current = reset.throughChangeSequence
            changes.length = 0
            break
          }
          changes.push(...batch.changes)
          changeCursor.current = batch.nextChangeSequence
          requestCount += 1
          if (!batch.hasMore || requestCount >= 10) break
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }

        const headsUpChanges: NotificationEpisodeChange[] = []
        for (const change of changes) {
          const episode = change.episode
          if (
            change.operation !== 'upsert'
            || !episode
            || !change.headsUpReason
            || !episodeHasActiveHeadsUpReason(episode, change.headsUpReason)
          ) continue
          const exactMentionAction = change.headsUpReason === 'user_mention'
            ? actionForSemantic(episode, 'user_mention')
            : null
          const exactSourceMayBeVisible = exactMentionAction
            && exactMentionAction.messageId
            && episode.camp.id === activeCampId
            && activeCampVisible
            && !open
            && document.visibilityState === 'visible'
            && document.hasFocus()
          if (exactSourceMayBeVisible) {
            const rendered = await onRefreshVisibleCamp(episode, exactMentionAction)
            if (
              rendered
              && document.visibilityState === 'visible'
              && document.hasFocus()
            ) {
              try {
                await acknowledgeAction(episode, exactMentionAction)
                continue
              } catch {
                // Persistence failure keeps the exact occurrence unread and eligible for heads-up.
              }
            }
          }
          if (
            preference
            && shouldShowHeadsUp(change.headsUpReason, preference)
            && !open
            && document.visibilityState === 'visible'
            && document.hasFocus()
          ) headsUpChanges.push(change)
        }
        if (headsUpChanges.length > 0) {
          setHeadsUpQueue((current) => {
            const next = enqueueNotificationHeadsUps(current, headsUpChanges)
            if (next.overflow > 0) {
              setHeadsUpOverflow((count) => count + next.overflow)
            }
            return next.entries
          })
        }
        if (changes.length > 0) {
          setItems((current) => applyNotificationChanges(current, changes))
          await loadInbox(filter).catch(() => undefined)
        }
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
      filter,
      loadInbox,
      onRefreshVisibleCamp,
      open,
      preference
    ])

    useEffect(() => {
      if (!enabled) return undefined
      const timer = window.setInterval(() => {
        void pollChanges().catch(() => undefined)
      }, 2_500)
      let eventTimer: number | null = null
      const unsubscribe = window.rovai.onEvent((event) => {
        if (event.method === 'notification_episode.preference_changed') {
          void loadPreference().catch(() => undefined)
        }
        if (eventTimer !== null) window.clearTimeout(eventTimer)
        eventTimer = window.setTimeout(() => {
          eventTimer = null
          void pollChanges().catch(() => undefined)
        }, 80)
      })
      return () => {
        window.clearInterval(timer)
        if (eventTimer !== null) window.clearTimeout(eventTimer)
        unsubscribe()
      }
    }, [enabled, loadPreference, pollChanges])

    const openAction = async (
      episode: NotificationEpisodeView,
      action: NotificationActionView
    ): Promise<void> => {
      if (busyEpisodeId || !action.available) return
      const generation = ++navigationGeneration.current
      setBusyEpisodeId(episode.id)
      setNavigationError(null)
      onCancelNavigation()
      let acknowledgementPersisted = false
      try {
        if (action.acknowledgementId) {
          await acknowledgeAction(episode, action)
          acknowledgementPersisted = true
          await loadInbox(filter).catch(() => undefined)
        }
        const result = await onNavigate(episode, action)
        if (generation !== navigationGeneration.current) {
          onCancelNavigation()
          return
        }
        if (result.status === 'failed') {
          onCancelNavigation()
          setNavigationError(acknowledgementPersisted
            ? `${result.message} 这条来源已按你的动作标记为已读。`
            : result.message)
          setOpen(true)
          return
        }
        setOpen(false)
        await afterNextPaint()
        const presented = await onPresentNavigation(episode, action)
        if (generation !== navigationGeneration.current) {
          onCancelNavigation()
          return
        }
        if (!presented) {
          onCancelNavigation()
          setNavigationError(acknowledgementPersisted
            ? '已打开 Camp，但目标未能获得焦点；这条来源已按你的动作标记为已读。'
            : '已打开 Camp，但目标未能获得焦点。你可以稍后重试。')
          setOpen(true)
        } else {
          window.setTimeout(() => { returnFocusRef.current = null }, 0)
        }
      } catch (nextError) {
        onCancelNavigation()
        if (generation !== navigationGeneration.current) return
        setNavigationError(acknowledgementPersisted
          ? `来源已标记为已读，但导航失败：${errorMessage(nextError)}`
          : `操作未完成：${errorMessage(nextError)}`)
        setOpen(true)
      } finally {
        setBusyEpisodeId(null)
      }
    }

    const markAllRead = async (): Promise<void> => {
      if (globalBusy || unreadCount === 0) return
      setGlobalBusy(true)
      setError(null)
      try {
        const result = await window.rovai.request<StoredCommandResult>(
          'notifications.markAllRead',
          {
            commandId: crypto.randomUUID(),
            command: { throughChangeSequence }
          }
        )
        if (result.status !== 'applied') throw new Error(commandFailure(result))
      } catch (nextError) {
        setError(`无法完成全部已读：${errorMessage(nextError)}`)
      } finally {
        setGlobalBusy(false)
        void loadInbox(filter).catch(() => undefined)
      }
    }

    const clearEpisode = async (episode: NotificationEpisodeView): Promise<void> => {
      if (busyEpisodeId) return
      setBusyEpisodeId(episode.id)
      setError(null)
      try {
        const result = await window.rovai.request<StoredCommandResult>(
          'notifications.clear',
          {
            commandId: crypto.randomUUID(),
            command: {
              episodeId: episode.id,
              throughAttentionRevision: episode.attentionRevision
            }
          }
        )
        if (result.status !== 'applied') throw new Error(commandFailure(result))
        setItems((current) => current.filter((item) => item.id !== episode.id))
        setHeadsUpQueue((current) => current.filter((entry) => entry.episode.id !== episode.id))
      } catch (nextError) {
        setError(`无法清除这项通知：${errorMessage(nextError)}`)
      } finally {
        setBusyEpisodeId(null)
        void loadInbox(filter).catch(() => undefined)
      }
    }

    const loadMore = async (): Promise<void> => {
      if (!nextCursor || loadingMore) return
      setLoadingMore(true)
      setError(null)
      try {
        const page = await window.rovai.request<NotificationEpisodeInbox>(
          'notifications.inbox',
          { filter, cursor: nextCursor, limit: 50 }
        )
        if (page.schemaVersion !== 4) throw new Error('通知中心合同不兼容。')
        setItems((current) => {
          const ids = new Set(current.map((item) => item.id))
          return [...current, ...page.items.filter((item) => !ids.has(item.id))]
        })
        setNextCursor(page.nextCursor)
        setUnreadCount(page.unreadCount)
        onUnreadCountChange(page.unreadCount)
      } catch (nextError) {
        setError(`无法加载更多通知：${errorMessage(nextError)}`)
      } finally {
        setLoadingMore(false)
      }
    }

    const changeOpen = (nextOpen: boolean): void => {
      setOpen(nextOpen)
      if (!nextOpen) {
        navigationGeneration.current += 1
        onCancelNavigation()
        setNavigationError(null)
        window.setTimeout(() => returnFocusRef.current?.focus(), 0)
      }
    }

    const currentHeadsUp = headsUpQueue[0] ?? null
    return (
      <>
        {currentHeadsUp && (
          <NotificationHeadsUp
            key={currentHeadsUp.episode.id}
            entry={currentHeadsUp}
            onOpen={() => void openAction(
              currentHeadsUp.episode,
              currentHeadsUp.episode.primaryAction
            )}
            onDismiss={() => setHeadsUpQueue((current) => current.slice(1))}
          />
        )}
        {!currentHeadsUp && headsUpOverflow > 0 && (
          <NotificationHeadsUpSummary
            count={headsUpOverflow}
            onOpen={() => {
              setHeadsUpOverflow(0)
              changeOpen(true)
            }}
            onDismiss={() => setHeadsUpOverflow(0)}
          />
        )}

        <Dialog.Root open={open} onOpenChange={changeOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="notification-drawer-overlay" />
            <Dialog.Content className="notification-drawer" aria-describedby={undefined}>
              <header className="notification-drawer-header">
                <div>
                  <Dialog.Title>通知</Dialog.Title>
                  <span>{unreadCount} 项未读</span>
                </div>
                <Dialog.Close asChild>
                  <button className="dialog-close" type="button" aria-label="关闭通知中心">
                    <CloseIcon />
                  </button>
                </Dialog.Close>
              </header>
              <div className="notification-drawer-actions">
                <span className="sr-only">当前变更序号 {throughChangeSequence}</span>
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  disabled={unreadCount === 0 || globalBusy}
                >{globalBusy ? '处理中…' : '全部已读'}</button>
              </div>
              <div className="notification-filter" role="group" aria-label="通知筛选">
                <button
                  type="button"
                  aria-pressed={filter === 'all'}
                  onClick={() => setFilter('all')}
                >全部</button>
                <button
                  type="button"
                  aria-pressed={filter === 'unread'}
                  onClick={() => setFilter('unread')}
                >未读</button>
              </div>
              <div className="notification-list" aria-live="polite">
                {state === 'loading' && items.length === 0 && (
                  <p className="notification-list-state">正在读取通知…</p>
                )}
                {state === 'error' && items.length === 0 && (
                  <div className="notification-list-state" role="alert">
                    <strong>通知暂时无法读取</strong>
                    <span>{error}</span>
                    <button
                      className="quiet-button compact"
                      type="button"
                      onClick={() => void loadInbox(filter, true)}
                    >重试</button>
                  </div>
                )}
                {state === 'ready' && items.length === 0 && (
                  <p className="notification-list-state">
                    {filter === 'unread' ? '没有未读事项' : '还没有需要你关注的事项'}
                  </p>
                )}
                {items.map((episode) => (
                  <NotificationRow
                    key={episode.id}
                    episode={episode}
                    disabled={busyEpisodeId !== null || globalBusy}
                    busy={busyEpisodeId === episode.id}
                    onAction={(action) => void openAction(episode, action)}
                    onClear={() => void clearEpisode(episode)}
                  />
                ))}
                {navigationError && (
                  <p className="notification-page-error" role="alert">{navigationError}</p>
                )}
                {nextCursor && (
                  <button
                    className="notification-load-more"
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >{loadingMore ? '加载中…' : '加载更多'}</button>
                )}
                {error && items.length > 0 && (
                  <p className="notification-page-error" role="alert">{error}</p>
                )}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    )
  }
)

function NotificationRow({
  episode,
  disabled,
  busy,
  onAction,
  onClear
}: {
  episode: NotificationEpisodeView
  disabled: boolean
  busy: boolean
  onAction(action: NotificationActionView): void
  onClear(): void
}): React.JSX.Element {
  const presentation = notificationPresentation(episode)
  const absoluteTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(episode.updatedAt))
  return (
    <article
      className={`notification-row${episode.unread ? ' unread' : ''}`}
      data-notification-id={episode.id}
    >
      <div className="notification-row-main">
        <span className="notification-unread-mark" aria-hidden="true" />
        <div className="notification-row-copy">
          <div className="notification-row-title">
            <strong>{presentation.label}</strong>
            <time dateTime={episode.updatedAt} title={absoluteTime} aria-label={absoluteTime}>
              {relativeTime(episode.updatedAt)}
            </time>
          </div>
          <span>{presentation.message}</span>
          {episode.unacknowledgedMentionCount > 1 && (
            <em>另有 {episode.unacknowledgedMentionCount - 1} 条提到你</em>
          )}
          <small>{episode.camp.title}</small>
          <div className="notification-row-actions">
            <button
              className="notification-primary-action"
              type="button"
              disabled={disabled || !episode.primaryAction.available}
              aria-busy={busy ? 'true' : undefined}
              onClick={() => onAction(episode.primaryAction)}
            >{busy ? '正在打开…' : actionLabel(episode.primaryAction)}</button>
            {episode.secondaryActions.map((action) => (
              <button
                key={action.actionId}
                type="button"
                disabled={disabled || !action.available}
                onClick={() => onAction(action)}
              >{actionLabel(action)}</button>
            ))}
          </div>
          {!episode.primaryAction.available && (
            <span className="notification-source-unavailable">主要来源不可用，可选择其他动作。</span>
          )}
        </div>
      </div>
      <button
        className="notification-row-clear"
        type="button"
        disabled={disabled}
        aria-label={`清除“${presentation.label}”事项`}
        onClick={onClear}
      ><CloseIcon /></button>
      {!episode.unread && <span className="sr-only">已读</span>}
    </article>
  )
}

function NotificationHeadsUp({
  entry,
  onOpen,
  onDismiss
}: {
  entry: NotificationHeadsUpEntry
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const onDismissRef = useRef(onDismiss)
  const presentation = notificationPresentation(entry.episode)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])
  useEffect(() => {
    if (paused || document.visibilityState !== 'visible') return undefined
    const timer = window.setTimeout(() => onDismissRef.current(), 8_000)
    return () => window.clearTimeout(timer)
  }, [paused, entry.changeSequence])
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
        disabled={!entry.episode.primaryAction.available}
        onClick={onOpen}
      >
        <strong>{presentation.label}</strong>
        <span>{presentation.message}</span>
        <small>
          {entry.episode.camp.title}
          {entry.episode.unacknowledgedMentionCount > 1
            ? ` · 另有 ${entry.episode.unacknowledgedMentionCount - 1} 条提到你`
            : ''}
        </small>
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
    if (paused || document.visibilityState !== 'visible') return undefined
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
        <span>打开通知中心查看</span>
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

export function notificationPresentation(notification: Pick<
  NotificationEpisodeView,
  'primarySemantic' | 'resolved' | 'satisfied' | 'mention' | 'pendingApprovalCount'
>): { label: string; message: string } {
  switch (notification.primarySemantic) {
    case 'approval_pending':
      return notification.resolved
        ? { label: '待审批 · 已处理', message: '相关操作已经处理' }
        : {
          label: '待审批',
          message: notification.pendingApprovalCount > 1
            ? `${notification.pendingApprovalCount} 个操作等待你确认`
            : '有操作等待你确认'
        }
    case 'turn_failed':
      return { label: '执行失败', message: '本轮协作失败，请返回查看' }
    case 'turn_incomplete':
      return { label: '执行未完成', message: '本轮协作未能证明完成，请返回查看' }
    case 'turn_completed':
      return notification.satisfied
        ? { label: '本轮完成', message: '你已经开始下一步协作' }
        : { label: '等待你的下一步', message: '本轮协作已经完成' }
    case 'user_mention':
      return {
        label: '提到你',
        message: notification.mention?.available
          ? notification.mention.summary ?? '有消息明确提到你'
          : '原消息来源不可用'
      }
  }
}

export function notificationBadgeLabel(unreadCount: number): string {
  return unreadCount > 99 ? '99+' : String(Math.max(0, unreadCount))
}

export function episodeHasActiveHeadsUpReason(
  episode: NotificationEpisodeView,
  semantic: NotificationSemantic
): boolean {
  const reason = episode.reasons.find((candidate) => candidate.semantic === semantic)
  if (!reason || reason.unacknowledgedCount === 0) return false
  if (semantic === 'approval_pending') return reason.state === 'pending'
  if (semantic === 'turn_completed') return reason.state === 'unsatisfied'
  return reason.state === 'unacknowledged'
}

function actionForSemantic(
  episode: NotificationEpisodeView,
  semantic: NotificationSemantic
): NotificationActionView | null {
  const actions = [episode.primaryAction, ...episode.secondaryActions]
  if (semantic === 'user_mention') {
    return actions.find((action) => action.kind === 'open_camp_message') ?? null
  }
  if (semantic === 'approval_pending') {
    return actions.find((action) => action.kind === 'open_approval') ?? null
  }
  return actions.find((action) => action.kind === 'open_camp_turn') ?? null
}

function actionLabel(action: NotificationActionView): string {
  if (!action.available) return '来源不可用'
  switch (action.kind) {
    case 'open_approval': return '处理审批'
    case 'open_camp_message': return '查看消息'
    case 'open_camp_turn': return '查看本轮'
    case 'open_camp': return '打开 Camp'
  }
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

function relativeTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return '刚刚'
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
