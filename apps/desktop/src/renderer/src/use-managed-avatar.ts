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
    void managedAvatarImage(avatarRef, rendition, read).then((image) => {
      if (!ignore) setState({ key, read, settled: true, image })
    })
    return () => {
      ignore = true
    }
  }, [avatarRef, key, rendition, read, connected])

  if (!key) return { loading: false, url: null, image: null }
  if (state.key !== key || state.read !== read) return { loading: true, url: null, image: null }
  return { loading: !state.settled, url: state.image?.url ?? null, image: state.image }
}
