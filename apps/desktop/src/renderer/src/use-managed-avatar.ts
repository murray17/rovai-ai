import { useThreadClient } from './camp-client'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import {
  managedAvatarImage,
  type ManagedAvatarImage,
  type ManagedAvatarRenditionKind
} from './managed-avatar-cache'

type ManagedAvatarState = {
  read?: import('./managed-avatar-cache').ManagedAvatarRead
  key: string
  settled: boolean
  image: ManagedAvatarImage | null
}

const noConnectionSubscription = (): (() => void) => () => undefined
const connectedSnapshot = (): boolean => true

export function useManagedAvatarUrl(
  avatarRef: string | null,
  rendition: ManagedAvatarRenditionKind
): { loading: boolean; url: string | null; image: ManagedAvatarImage | null } {
  const client = useThreadClient()
  const parsed = avatarRef ? parseControlledMemberAvatarRef(avatarRef) : null
  const read = parsed?.kind === 'managed' ? client.memberAvatars.read : null
  const connection = read ? client.connection : undefined
  const connected = useSyncExternalStore(
    connection?.subscribe ?? noConnectionSubscription,
    connection?.getSnapshot ?? connectedSnapshot,
    connectedSnapshot
  )
  const key = parsed?.kind === 'managed' ? `${avatarRef}\u0000${rendition}` : null
  const [state, setState] = useState<ManagedAvatarState>({
    key: '',
    settled: false,
    image: null
  })

  useEffect(() => {
    if (!key || !avatarRef || !read || !connected) return undefined
    let ignore = false
    let retryDelay = 1_000
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const load = (): void => {
      void managedAvatarImage(avatarRef, rendition, read).then((image) => {
        if (!ignore) setState({ key, read, settled: true, image })
      }, (error: unknown) => {
        if (ignore) return
        setState({ key, read, settled: true, image: null })
        // Only transient resource failures opt in. A confirmed missing image
        // or a permanent error stays settled without background requests.
        if (error && typeof error === 'object' && 'retryable' in error && error.retryable === true) {
          retryTimer = setTimeout(load, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
      })
    }
    load()
    return () => {
      ignore = true
      clearTimeout(retryTimer)
    }
  }, [avatarRef, key, rendition, read, connected])

  if (!key) return { loading: false, url: null, image: null }
  if (state.key !== key || state.read !== read) return { loading: true, url: null, image: null }
  return { loading: !state.settled, url: state.image?.url ?? null, image: state.image }
}
