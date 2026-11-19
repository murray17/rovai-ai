import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArchiveItem, ArchiveList } from '@contracts'
import type { ThreadClient } from './camp-client'
import { readErrorMessage } from './error-message'
import { uiAttribute } from './interface-language'
import { createNavigationRefreshCoordinator } from './navigation-refresh-coordinator'
import { invalidatesArchiveRecords } from './thread-archive'

async function readArchivePages(client: Pick<ThreadClient, 'request'>, isCurrent: () => boolean): Promise<ArchiveItem[] | null> {
  const items: ArchiveItem[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    const page: ArchiveList = await client.request<ArchiveList>('threads.archive.list', { cursor })
    if (!isCurrent()) return null
    items.push(...page.items)
    cursor = page.nextCursor
    if (cursor !== null) {
      if (seen.has(cursor)) throw new Error(uiAttribute('归档列表返回了重复的游标。'))
      seen.add(cursor)
    }
  } while (cursor !== null)
  return items
}

export function useArchiveRecords(client: ThreadClient) {
  const [state, setState] = useState<{ client: ThreadClient; items: ArchiveItem[] | null; error: string | null } | null>(null)
  const refreshRef = useRef<() => void>(() => undefined)
  const refresh = useCallback(() => refreshRef.current(), [])
  useEffect(() => {
    let generation = 0
    let live = true
    const coordinator = createNavigationRefreshCoordinator(async () => {
      const started = generation
      const isCurrent = () => live && generation === started
      try {
        const items = await readArchivePages(client, isCurrent)
        if (items && isCurrent()) setState({ client, items, error: null })
      } catch (error) {
        if (isCurrent()) setState(previous => ({
          client, items: previous?.client === client ? previous.items : null, error: readErrorMessage(error)
        }))
      }
    }, { initiallyVisible: document.visibilityState === 'visible' })
    const request = (explicit = false): void => {
      generation++
      void coordinator.refresh(explicit ? 'explicit' : 'invalidation').catch(() => undefined)
    }
    refreshRef.current = () => request(true)
    const unsubscribe = client.onEvent?.(event => { if (invalidatesArchiveRecords(event)) request() })
    const unsubscribeWeb = client.onInvalidated?.(change => {
      if (!change || change.resync || change.referencesChanged) request()
    })
    const onFocus = () => { if (document.visibilityState === 'visible') request() }
    const onVisibility = () => { coordinator.setVisible(document.visibilityState === 'visible'); onFocus() }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    request(true)
    return () => {
      live = false
      coordinator.dispose()
      unsubscribe?.()
      unsubscribeWeb?.()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [client])
  // No change event is committed for an already-restored or missing record.
  function discardStaleItem(item: ArchiveItem): void {
    setState(current => current?.client === client && current.items?.includes(item)
      ? { ...current, items: current.items.filter(row => row !== item) }
      : current)
  }
  return { items: state?.client === client ? state.items : null, error: state?.client === client ? state.error : null, refresh, discardStaleItem }
}
