import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchiveList, ArchiveListQuery } from '@contracts'
import type { ThreadClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { uiAttribute } from './interface-language'
import { createNavigationRefreshCoordinator } from './navigation-refresh-coordinator'
import { invalidatesArchiveRecords } from './thread-archive'

interface ReadState {
  client: ThreadClient
  key: string
  result: ArchiveList | null
  error: string | null
  loading: boolean
}

export function useArchiveRecords(client: ThreadClient, query: ArchiveListQuery, beforeCommit: () => void) {
  const filterKey = JSON.stringify([query.kind, query.query, query.projectKeys])
  const [state, setState] = useState<ReadState | null>(null)
  const current = state?.client === client && state.key === filterKey ? state : null
  const queryRef = useRef(query)
  queryRef.current = query
  const beforeCommitRef = useRef(beforeCommit)
  beforeCommitRef.current = beforeCommit
  const refreshRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    let live = true
    let generation = 0
    const coordinator = createNavigationRefreshCoordinator(async () => {
      const started = generation
      try {
        const result = await client.request<ArchiveList>('threads.archive.list', queryRef.current)
        if (!live || started !== generation) return
        if (result.schemaVersion !== 1) throw new Error(uiAttribute('归档列表数据版本不兼容。'))
        beforeCommitRef.current()
        setState({ client, key: filterKey, result, error: null, loading: false })
      } catch (error) {
        if (!live || started !== generation) return
        setState(previous => ({
          client, key: filterKey, error: readErrorMessage(error), loading: false,
          result: previous?.client === client && previous.key === filterKey ? previous.result : null
        }))
        throw error
      }
    }, { initiallyVisible: document.visibilityState === 'visible' })
    const refresh = (explicit = false): void => {
      generation += 1
      if (explicit) {
        setState(previous => ({
          client, key: filterKey, error: null, loading: true,
          result: previous?.client === client && previous.key === filterKey ? previous.result : null
        }))
      }
      void coordinator.refresh(explicit ? 'explicit' : 'invalidation').catch(() => undefined)
    }
    refreshRef.current = () => refresh(true)
    const onEvent = client.onEvent?.(event => { if (invalidatesArchiveRecords(event)) refresh() })
    const onInvalidated = client.onInvalidated?.(change => {
      if (!change || change.resync || change.referencesChanged
        || change.messages?.some(message => message.unavailableMessageIds?.length)) refresh()
    })
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible'
      coordinator.setVisible(visible)
      if (visible) refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    refresh(true)
    return () => {
      live = false
      coordinator.dispose()
      onEvent?.()
      onInvalidated?.()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [client, filterKey, query.limit])

  const refresh = useCallback(() => refreshRef.current(), [])
  return { result: current?.result ?? null, error: current?.error ?? null, loading: current?.loading ?? true, refresh }
}
