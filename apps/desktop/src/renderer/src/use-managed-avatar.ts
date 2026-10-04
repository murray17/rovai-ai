import { useThreadClient } from './camp-client'
import { useEffect, useState } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import {
  managedAvatarObjectUrl,
  type ManagedAvatarRenditionKind
} from './managed-avatar-cache'

type ManagedAvatarState = {
  read?: import('./managed-avatar-cache').ManagedAvatarRead
  key: string
  settled: boolean
  url: string | null
}

export function useManagedAvatarUrl(
  avatarRef: string | null,
  rendition: ManagedAvatarRenditionKind
): { loading: boolean; url: string | null } {
  const client = useThreadClient()
  const parsed = avatarRef ? parseControlledMemberAvatarRef(avatarRef) : null
  const read = parsed?.kind === 'managed' ? client.memberAvatars.read : null
  const key = parsed?.kind === 'managed' ? `${avatarRef}\u0000${rendition}` : null
  const [state, setState] = useState<ManagedAvatarState>({
    key: '',
    settled: false,
    url: null
  })

  useEffect(() => {
    if (!key || !avatarRef || !read) return undefined
    let ignore = false
    void managedAvatarObjectUrl(avatarRef, rendition, read).then((url) => {
      if (!ignore) setState({ key, read, settled: true, url })
    })
    return () => {
      ignore = true
    }
  }, [avatarRef, key, rendition, read])

  if (!key) return { loading: false, url: null }
  if (state.key !== key || state.read !== read) return { loading: true, url: null }
  return { loading: !state.settled, url: state.url }
}
