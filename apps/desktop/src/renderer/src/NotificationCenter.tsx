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
  InAppNotificationCreatedBatch,
  InAppNotificationFilter,
  InAppNotificationInbox,
  InAppNotificationPreference,
  InAppNotificationView,
  StoredCommandResult
} from '@contracts'

type LoadState = 'loading' | 'ready' | 'error'

export type NotificationHeadsUpEntry = {
  notifications: InAppNotificationView[]
}

export function enqueueNotificationHeadsUps(
  current: readonly NotificationHeadsUpEntry[],
  incoming: readonly InAppNotificationView[],
  maximumEntries = 3
): { entries: NotificationHeadsUpEntry[]; overflow: number } {
  const entries = current.map((entry) => ({ notifications: [...entry.notifications] }))
  const known = new Set(entries.flatMap((entry) => entry.notifications.map((item) => item.id)))
  let overflow = 0
  for (const notification of incoming) {
    if (known.has(notification.id)) continue
    known.add(notification.id)
    const visible = entries[0]
    const visibleAnchor = visible?.notifications[0]
    if (
      visible
      && visibleAnchor?.kind === 'camp_message_user_mention'
      && notification.kind === 'camp_message_user_mention'
      && visibleAnchor.camp.id === notification.camp.id
    ) {
      visible.notifications.push(notification)
      continue
    }
    if (entries.length < maximumEntries) {
      entries.push({ notifications: [notification] })
    } else {
      overflow += 1
    }
  }
  return { entries, overflow }
}

export function notificationInboxWithPendingReads(
  inbox: InAppNotificationInbox,
  pendingReadAtById: ReadonlyMap<string, string>,
  filter: InAppNotificationFilter
): InAppNotificationInbox {
  if (pendingReadAtById.size === 0) return inbox
  let pendingUnreadCount = 0
  const items = inbox.items.map((item) => {
    const pendingReadAt = pendingReadAtById.get(item.id)
    if (!pendingReadAt || item.readAt !== null) return item
    pendingUnreadCount += 1
    return { ...item, readAt: pendingReadAt }
  })
  return {
    ...inbox,
    items: filter === 'unread'
      ? items.filter((item) => item.readAt === null)
      : items,
    unreadCount: Math.max(0, inbox.unreadCount - pendingUnreadCount)
  }
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
  onNavigate(notification: InAppNotificationView): Promise<NotificationNavigationResult>
  onPresentNavigation(notification: InAppNotificationView): Promise<boolean>
  onCancelNavigation(): void
  onRefreshVisibleCamp(notification: InAppNotificationView): Promise<boolean>
}

export const NotificationCenter = forwardRef<NotificationCenterHandle, NotificationCenterProps>(function NotificationCenter({
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
  const [filter, setFilter] = useState<InAppNotificationFilter>('all')
  const [items, setItems] = useState<InAppNotificationView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)
  const [throughSequence, setThroughSequence] = useState(0)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [openingNotificationId, setOpeningNotificationId] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [preference, setPreference] = useState<InAppNotificationPreference | null>(null)
  const [headsUpQueue, setHeadsUpQueue] = useState<NotificationHeadsUpEntry[]>([])
  const [headsUpOverflow, setHeadsUpOverflow] = useState(0)
  const [aggregateFocusIds, setAggregateFocusIds] = useState<Set<string>>(new Set())
  const creationCursor = useRef(0)
  const baselineReady = useRef(false)
  const pollRunning = useRef(false)
  const pollFailureCount = useRef(0)
  const pollRetryAt = useRef(0)
  const loadGeneration = useRef(0)
  const inboxRequest = useRef<{
    filter: InAppNotificationFilter
    promise: Promise<InAppNotificationInbox>
  } | null>(null)
  const pendingReadAtById = useRef(new Map<string, string>())
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const navigationRunning = useRef(false)
  const navigationGeneration = useRef(0)

  useImperativeHandle(ref, () => ({
    open(trigger = null): void {
      navigationGeneration.current += 1
      onCancelNavigation()
      returnFocusRef.current = trigger
      setAggregateFocusIds(new Set())
      setNavigationError(null)
      setOpen(true)
    }
  }), [onCancelNavigation])

  const acceptInbox = useCallback((inbox: InAppNotificationInbox): void => {
    if (inbox.schemaVersion !== 3) throw new Error('通知中心合同不兼容。')
    for (const item of inbox.items) {
      if (item.readAt !== null) pendingReadAtById.current.delete(item.id)
    }
    const acceptedInbox = notificationInboxWithPendingReads(
      inbox,
      pendingReadAtById.current,
      filter
    )
    setItems(acceptedInbox.items)
    setNextCursor(acceptedInbox.nextCursor)
    setUnreadCount(acceptedInbox.unreadCount)
    setThroughSequence(acceptedInbox.throughSequence)
    const currentById = new Map(acceptedInbox.items.map((item) => [item.id, item]))
    setHeadsUpQueue((current) => current.flatMap((entry) => {
      const notifications = entry.notifications.flatMap((item) => {
        const latest = currentById.get(item.id)
        if (
          !latest
          || latest.readAt !== null
          || (
            latest.kind === 'runtime_permission_attention'
            && latest.attentionState === 'resolved'
          )
        ) return []
        return [latest]
      })
      return notifications.length > 0 ? [{ notifications }] : []
    }))
    onUnreadCountChange(acceptedInbox.unreadCount)
  }, [filter, onUnreadCountChange])

  const loadInbox = useCallback((
    selectedFilter: InAppNotificationFilter,
    showLoading = false
  ): Promise<InAppNotificationInbox> => {
    const existing = inboxRequest.current
    if (existing?.filter === selectedFilter) {
      if (showLoading) setState('loading')
      return existing.promise
    }
    const generation = ++loadGeneration.current
    if (showLoading) setState('loading')
    setError(null)
    const promise = window.rovai.request<InAppNotificationInbox>('notifications.inbox', {
      filter: selectedFilter,
      limit: 50
    }).then((inbox) => {
      if (generation === loadGeneration.current) {
        acceptInbox(inbox)
        setState('ready')
      }
      return inbox
    }).catch((nextError: unknown) => {
      if (generation === loadGeneration.current) {
        setState('error')
        setError(errorMessage(nextError))
      }
      throw nextError
    })
    const request = {
      filter: selectedFilter,
      promise
    }
    inboxRequest.current = request
    void promise.finally(() => {
      if (inboxRequest.current === request) inboxRequest.current = null
    }).catch(() => undefined)
    return promise
  }, [acceptInbox])

  const loadPreference = useCallback(async (): Promise<InAppNotificationPreference> => {
    const next = await window.rovai.request<InAppNotificationPreference>(
      'notifications.preference.get'
    )
    if (
      typeof next.headsUpEnabled !== 'boolean'
      || typeof next.approvalHeadsUpEnabled !== 'boolean'
      || typeof next.executionHeadsUpEnabled !== 'boolean'
      || typeof next.userMentionHeadsUpEnabled !== 'boolean'
      || typeof next.version !== 'number'
    ) throw new Error('通知设置合同不兼容。')
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
      creationCursor.current = inbox.throughSequence
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

  useEffect(() => {
    if (!open || aggregateFocusIds.size === 0) return undefined
    const frame = window.requestAnimationFrame(() => {
      const firstId = [...aggregateFocusIds][0]
      const target = document.querySelector<HTMLElement>(
        `[data-notification-id="${CSS.escape(firstId)}"] .notification-row-open`
      )
      target?.focus({ preventScroll: true })
      target?.scrollIntoView({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [aggregateFocusIds, items, open])

  const markRead = useCallback(async (notificationId: string): Promise<void> => {
    const result = await window.rovai.request<StoredCommandResult>('notifications.markRead', {
      commandId: crypto.randomUUID(),
      command: { notificationId }
    })
    if (result.status !== 'applied') throw new Error(result.code)
  }, [])

  const enqueueHeadsUps = useCallback((incoming: InAppNotificationView[]): void => {
    setHeadsUpQueue((current) => {
      const next = enqueueNotificationHeadsUps(current, incoming)
      if (next.overflow > 0) {
        setHeadsUpOverflow((count) => count + next.overflow)
      }
      return next.entries
    })
  }, [])

  const pollCreated = useCallback(async (): Promise<void> => {
    if (
      !baselineReady.current
      || pollRunning.current
      || Date.now() < pollRetryAt.current
    ) return
    pollRunning.current = true
    try {
      const incoming: InAppNotificationView[] = []
      let requestCount = 0
      for (;;) {
        const batch = await window.rovai.request<InAppNotificationCreatedBatch>(
          'notifications.createdSince',
          { afterSequence: creationCursor.current, limit: 100 }
        )
        if (batch.schemaVersion !== 3) throw new Error('通知增量合同不兼容。')
        if (batch.resetRequired) {
          creationCursor.current = batch.throughSequence
          break
        }
        incoming.push(...batch.items)
        creationCursor.current = batch.nextSequence
        requestCount += 1
        if (!batch.hasMore || requestCount >= 10) break
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      }

      const headsUps: InAppNotificationView[] = []
      for (const notification of incoming) {
        if (notification.readAt !== null) continue
        const sourceAlreadyVisible = notification.camp.id === activeCampId
          && activeCampVisible
          && !open
          && document.visibilityState === 'visible'
          && document.hasFocus()
        if (sourceAlreadyVisible) {
          const rendered = await onRefreshVisibleCamp(notification)
          if (
            rendered
            && document.visibilityState === 'visible'
            && document.hasFocus()
          ) {
            try {
              await markRead(notification.id)
              continue
            } catch {
              // Keep the unread notification eligible for a heads-up when persistence fails.
            }
          }
        }
        if (
          preference
          && shouldShowHeadsUp(notification, preference)
          && !open
          && document.visibilityState === 'visible'
          && document.hasFocus()
        ) headsUps.push(notification)
      }
      if (headsUps.length > 0) enqueueHeadsUps(headsUps)
      await loadInbox(filter).catch(() => undefined)
      pollFailureCount.current = 0
      pollRetryAt.current = 0
    } catch (error) {
      pollFailureCount.current += 1
      pollRetryAt.current = Date.now() + Math.min(
        30_000,
        2_500 * 2 ** Math.min(pollFailureCount.current, 4)
      )
      throw error
    } finally {
      pollRunning.current = false
    }
  }, [
    activeCampId,
    activeCampVisible,
    enqueueHeadsUps,
    filter,
    loadInbox,
    markRead,
    onRefreshVisibleCamp,
    open,
    preference
  ])

  useEffect(() => {
    if (!enabled) return undefined
    const timer = window.setInterval(() => {
      void pollCreated().catch(() => undefined)
    }, 2_500)
    let eventTimer: number | null = null
    const unsubscribe = window.rovai.onEvent((event) => {
      if (event.method === 'in_app_notification.preference_changed') {
        void loadPreference().catch(() => undefined)
      }
      if (eventTimer !== null) window.clearTimeout(eventTimer)
      eventTimer = window.setTimeout(() => {
        eventTimer = null
        void pollCreated().catch(() => undefined)
      }, 80)
    })
    return () => {
      window.clearInterval(timer)
      if (eventTimer !== null) window.clearTimeout(eventTimer)
      unsubscribe()
    }
  }, [enabled, loadPreference, pollCreated])

  const invalidateInboxLoad = (): void => {
    loadGeneration.current += 1
    inboxRequest.current = null
  }

  const optimisticRead = (notification: InAppNotificationView): boolean => {
    const latest = items.find((item) => item.id === notification.id) ?? notification
    if (latest.readAt !== null || pendingReadAtById.current.has(notification.id)) return false
    const readAt = new Date().toISOString()
    pendingReadAtById.current.set(notification.id, readAt)
    invalidateInboxLoad()
    setItems((current) => current.map((item) => {
      if (item.id !== notification.id || item.readAt !== null) return item
      return { ...item, readAt }
    }))
    setHeadsUpQueue((current) => current.flatMap((entry) => {
      const notifications = entry.notifications.filter((item) => item.id !== notification.id)
      return notifications.length > 0 ? [{ notifications }] : []
    }))
    setUnreadCount((count) => {
      const next = Math.max(0, count - 1)
      onUnreadCountChange(next)
      return next
    })
    return true
  }

  const persistOptimisticRead = async (notificationId: string): Promise<void> => {
    try {
      await markRead(notificationId)
    } catch (nextError) {
      pendingReadAtById.current.delete(notificationId)
      invalidateInboxLoad()
      await loadInbox(filter).catch(() => undefined)
      setError(errorMessage(nextError))
      return
    }
    pendingReadAtById.current.delete(notificationId)
    invalidateInboxLoad()
    await loadInbox(filter).catch(() => undefined)
  }

  const openNotification = async (notification: InAppNotificationView): Promise<void> => {
    if (navigationRunning.current) return
    const generation = ++navigationGeneration.current
    navigationRunning.current = true
    onCancelNavigation()
    setOpeningNotificationId(notification.id)
    setNavigationError(null)
    try {
      if (optimisticRead(notification)) void persistOptimisticRead(notification.id)
      if (notification.kind === 'camp_message_user_mention' && !notification.sourceAvailable) {
        setNavigationError('原消息已不可用。通知仍保留在“全部”列表中。')
        setOpen(true)
        return
      }
      const result = await onNavigate(notification)
      if (generation !== navigationGeneration.current) {
        onCancelNavigation()
        return
      }
      if (result.status === 'navigated') {
        setOpen(false)
        setAggregateFocusIds(new Set())
        await afterNextPaint()
        const presented = await onPresentNavigation(notification)
        if (generation !== navigationGeneration.current) {
          onCancelNavigation()
          return
        }
        if (!presented) {
          onCancelNavigation()
          setNavigationError('已打开 Camp，但原消息未能获得焦点。通知仍保留，可稍后重试。')
          setOpen(true)
        } else {
          setNavigationError(null)
          window.setTimeout(() => returnFocusRef.current = null, 0)
        }
        return
      }
      onCancelNavigation()
      setNavigationError(result.message)
      setOpen(true)
    } catch (nextError) {
      onCancelNavigation()
      if (generation !== navigationGeneration.current) return
      setNavigationError(`暂时无法打开通知来源：${errorMessage(nextError)}`)
      setOpen(true)
    } finally {
      navigationRunning.current = false
      setOpeningNotificationId(null)
    }
  }

  const markAllRead = async (): Promise<void> => {
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? now })))
    setUnreadCount(0)
    onUnreadCountChange(0)
    try {
      const result = await window.rovai.request<StoredCommandResult>('notifications.markAllRead', {
        commandId: crypto.randomUUID(),
        command: {}
      })
      if (result.status !== 'applied') throw new Error(result.code)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      void loadInbox(filter).catch(() => undefined)
    }
  }

  const clearNotification = async (notificationId: string): Promise<void> => {
    const existing = items.find((item) => item.id === notificationId)
    setItems((current) => current.filter((item) => item.id !== notificationId))
    if (existing?.readAt === null) {
      setUnreadCount((count) => {
        const next = Math.max(0, count - 1)
        onUnreadCountChange(next)
        return next
      })
    }
    try {
      const result = await window.rovai.request<StoredCommandResult>('notifications.clear', {
        commandId: crypto.randomUUID(),
        command: { notificationId }
      })
      if (result.status !== 'applied') throw new Error(result.code)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      void loadInbox(filter).catch(() => undefined)
    }
  }

  const clearRead = async (): Promise<void> => {
    setItems((current) => current.filter((item) => item.readAt === null))
    try {
      const result = await window.rovai.request<StoredCommandResult>('notifications.clearRead', {
        commandId: crypto.randomUUID(),
        command: {}
      })
      if (result.status !== 'applied') throw new Error(result.code)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      void loadInbox(filter).catch(() => undefined)
    }
  }

  const loadMore = async (): Promise<void> => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setError(null)
    try {
      const page = await window.rovai.request<InAppNotificationInbox>('notifications.inbox', {
        filter,
        cursor: nextCursor,
        limit: 50
      })
      if (page.schemaVersion !== 3) throw new Error('通知中心合同不兼容。')
      setItems((current) => {
        const ids = new Set(current.map((item) => item.id))
        return [...current, ...page.items.filter((item) => !ids.has(item.id))]
      })
      setNextCursor(page.nextCursor)
      setUnreadCount(page.unreadCount)
      setThroughSequence(page.throughSequence)
      onUnreadCountChange(page.unreadCount)
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setLoadingMore(false)
    }
  }

  const changeOpen = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) {
      navigationGeneration.current += 1
      onCancelNavigation()
      setAggregateFocusIds(new Set())
      setNavigationError(null)
      window.setTimeout(() => returnFocusRef.current?.focus(), 0)
    }
  }

  const currentHeadsUp = headsUpQueue[0] ?? null
  const currentHeadsUpNotification = currentHeadsUp?.notifications[0] ?? null
  return (
    <>
      {currentHeadsUpNotification && currentHeadsUp.notifications.length === 1 && (
        <NotificationHeadsUp
          key={currentHeadsUpNotification.id}
          notification={currentHeadsUpNotification}
          onOpen={() => void openNotification(currentHeadsUpNotification)}
          onDismiss={() => setHeadsUpQueue((current) => current.slice(1))}
        />
      )}
      {currentHeadsUpNotification && currentHeadsUp.notifications.length > 1 && (
        <NotificationHeadsUpAggregate
          key={currentHeadsUpNotification.id}
          notifications={currentHeadsUp.notifications}
          onOpen={() => {
            setHeadsUpQueue((current) => current.slice(1))
            setAggregateFocusIds(new Set(currentHeadsUp.notifications.map((item) => item.id)))
            setFilter('unread')
            changeOpen(true)
          }}
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
                <span>{unreadCount} 条未读</span>
              </div>
              <Dialog.Close asChild>
                <button className="dialog-close" type="button" aria-label="关闭通知中心">×</button>
              </Dialog.Close>
            </header>
            <div className="notification-drawer-actions">
              <span className="sr-only">当前序号 {throughSequence}</span>
              <button type="button" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
                全部已读
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={() => void clearRead()}>清除已读</button>
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
                  <button className="quiet-button compact" type="button" onClick={() => void loadInbox(filter, true)}>
                    重试
                  </button>
                </div>
              )}
              {state === 'ready' && items.length === 0 && (
                <p className="notification-list-state">
                  {filter === 'unread' ? '没有未读通知' : '还没有通知'}
                </p>
              )}
              {items.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  highlighted={aggregateFocusIds.has(notification.id)}
                  disabled={openingNotificationId !== null}
                  opening={openingNotificationId === notification.id}
                  onOpen={() => void openNotification(notification)}
                  onClear={() => void clearNotification(notification.id)}
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
              {error && items.length > 0 && <p className="notification-page-error" role="alert">{error}</p>}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
})

function NotificationRow({
  notification,
  highlighted,
  disabled,
  opening,
  onOpen,
  onClear
}: {
  notification: InAppNotificationView
  highlighted: boolean
  disabled: boolean
  opening: boolean
  onOpen(): void
  onClear(): void
}): React.JSX.Element {
  const presentation = notificationPresentation(notification)
  const absoluteTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(notification.createdAt))
  return (
    <article
      className={`notification-row ${notification.readAt === null ? 'unread' : ''}${highlighted ? ' highlighted' : ''}`}
      data-notification-id={notification.id}
    >
      <button
        className="notification-row-open"
        type="button"
        disabled={disabled}
        aria-busy={opening ? 'true' : undefined}
        onClick={onOpen}
      >
        <span className="notification-unread-mark" aria-hidden="true" />
        <span className="notification-row-copy">
          <strong>{presentation.label}</strong>
          <span>{presentation.message}</span>
          <small>
            <span>{notification.camp.title}</span>
          </small>
        </span>
        <time dateTime={notification.createdAt} title={absoluteTime} aria-label={absoluteTime}>
          {relativeTime(notification.createdAt)}
        </time>
        {notification.readAt === null && <span className="sr-only">未读</span>}
      </button>
      <button
        className="notification-row-clear"
        type="button"
        disabled={disabled}
        aria-label={`清除“${presentation.label}”通知`}
        onClick={onClear}
      >×</button>
    </article>
  )
}

function NotificationHeadsUpAggregate({
  notifications,
  onOpen,
  onDismiss
}: {
  notifications: readonly InAppNotificationView[]
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const onDismissRef = useRef(onDismiss)
  const first = notifications[0]
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
      className="notification-heads-up notification-heads-up-aggregate"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}
    >
      <button className="notification-heads-up-open" type="button" onClick={onOpen}>
        <strong>消息提及</strong>
        <span>本 Camp 还有 {notifications.length - 1} 条消息提及你</span>
        <small>{first?.camp.title}</small>
      </button>
      <button className="notification-heads-up-close" type="button" aria-label="关闭本次提醒" onClick={onDismiss}>×</button>
    </aside>
  )
}

function NotificationHeadsUp({
  notification,
  onOpen,
  onDismiss
}: {
  notification: InAppNotificationView
  onOpen(): void
  onDismiss(): void
}): React.JSX.Element {
  const [paused, setPaused] = useState(false)
  const onDismissRef = useRef(onDismiss)
  const presentation = notificationPresentation(notification)
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
      className="notification-heads-up"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
      }}
    >
      <button className="notification-heads-up-open" type="button" onClick={onOpen}>
        <strong>{presentation.label}</strong>
        <span>{presentation.message}</span>
        <small>{notification.camp.title}</small>
      </button>
      <button className="notification-heads-up-close" type="button" aria-label="关闭本次提醒" onClick={onDismiss}>×</button>
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
        <strong>还有 {count} 条新通知</strong>
        <span>打开通知中心查看</span>
      </button>
      <button className="notification-heads-up-close" type="button" aria-label="关闭本次提醒" onClick={onDismiss}>×</button>
    </aside>
  )
}

export function notificationPresentation(notification: Pick<
  InAppNotificationView,
  'kind' | 'attentionState' | 'sourceAvailable' | 'messageSummary'
>): { label: string; message: string } {
  if (notification.kind === 'runtime_permission_attention') {
    return notification.attentionState === 'resolved'
      ? { label: '待审批 · 已处理', message: '相关操作已处理' }
      : { label: '待审批', message: '有操作等待你确认' }
  }
  if (notification.kind === 'camp_turn_completed') {
    return { label: '执行完成', message: '一次协作已经完成' }
  }
  if (notification.kind === 'camp_message_user_mention') {
    return {
      label: '消息提及',
      message: notification.sourceAvailable
        ? notification.messageSummary ?? '有消息提及你'
        : '来源不可用'
    }
  }
  return { label: '执行未完成', message: '一次协作未完成，请返回查看' }
}

export function notificationBadgeLabel(unreadCount: number): string {
  return unreadCount > 99 ? '99+' : String(Math.max(0, unreadCount))
}

function shouldShowHeadsUp(
  notification: InAppNotificationView,
  preference: InAppNotificationPreference
): boolean {
  if (!preference.headsUpEnabled || notification.readAt !== null) return false
  if (notification.kind === 'runtime_permission_attention') {
    return preference.approvalHeadsUpEnabled && notification.attentionState === 'pending'
  }
  if (notification.kind === 'camp_message_user_mention') {
    return preference.userMentionHeadsUpEnabled
  }
  return preference.executionHeadsUpEnabled
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
  const days = Math.floor(hours / 24)
  return `${days} 天前`
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
