import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ThreadMessageView } from '@contracts'
import type { ThreadClient } from './camp-client'
import { ThreadUserAnchorNavigation } from './thread-user-anchor-navigation'

/** Cache belongs to this business surface/Host; it is not global across windows or Owners. */
export function useThreadUserAnchorCache(client: ThreadClient) {
  const cache = useRef(new Map<string, ThreadUserAnchorNavigation>())
  return useCallback((threadId: string) => {
    let value = cache.current.get(threadId)
    if (!value || value.client !== client) value = new ThreadUserAnchorNavigation(threadId, client)
    cache.current.delete(threadId); cache.current.set(threadId, value)
    if (cache.current.size > 8) cache.current.delete(cache.current.keys().next().value!)
    return value
  }, [client])
}

export function useThreadUserAnchors(threadId: string, client: ThreadClient,
  messages: readonly ThreadMessageView[], confirmed: readonly ThreadMessageView[],
  namesKey: string, text: (message: ThreadMessageView) => string,
  supplied?: ThreadUserAnchorNavigation, bodyReady = true) {
  const navigation = useMemo(() => supplied ?? new ThreadUserAnchorNavigation(threadId, client), [supplied, threadId, client])
  const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  useEffect(() => navigation.observe(messages, confirmed, text), [navigation, messages, confirmed, text])
  const names = useRef({ threadId, namesKey })
  useEffect(() => {
    if (names.current.threadId === threadId && names.current.namesKey !== namesKey) navigation.resync()
    names.current = { threadId, namesKey }
  }, [navigation, namesKey, threadId])
  // Observe the committed body/names before starting: cached entry changes must not
  // invalidate a new request that already started with those same materials.
  useEffect(() => { if (bodyReady) return navigation.start() }, [navigation, bodyReady])
  return { navigation, ...state }
}
