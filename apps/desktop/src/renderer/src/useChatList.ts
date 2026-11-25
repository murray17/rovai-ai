import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatListCursor, ChatListPage } from '@contracts'
import type { ThreadClient } from './camp-client'

export function useChatList(client: ThreadClient, enabled: boolean) {
  const [cursors, setCursors] = useState<Array<ChatListCursor | null>>([null])
  const after = cursors[cursors.length - 1]
  const [page, setPage] = useState<ChatListPage | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    if (!enabled) return
    const request = ++generation.current
    setLoading(true)
    try {
      const result = await client.request<ChatListPage>('chats.list', { after, limit: 50 })
      if (request !== generation.current) return
      setPage(result)
      setFailed(false)
      if (after && !result.items.length) setCursors([null])
    } catch {
      if (request === generation.current) setFailed(true)
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [client, after, enabled])
  useEffect(() => {
    if (!enabled) return
    const stopEvents = client.onEvent?.(event => { if (event.method === 'chats.listChanged') void refresh() })
    const stopChanges = client.onInvalidated?.(change => { if (!change || change.resync || change.chatsChanged) void refresh() })
    const stopConnection = client.connection?.subscribe(() => { if (client.connection?.getSnapshot()) void refresh() })
    void refresh()
    return () => { ++generation.current; stopEvents?.(); stopChanges?.(); stopConnection?.() }
  }, [client, enabled, refresh])
  return {
    page, loading, failed, refresh, hasPrevious: cursors.length > 1,
    next() { if (!loading && page?.nextCursor) setCursors([...cursors, page.nextCursor]) },
    previous() { if (!loading && cursors.length > 1) setCursors(cursors.slice(0, -1)) }
  }
}
