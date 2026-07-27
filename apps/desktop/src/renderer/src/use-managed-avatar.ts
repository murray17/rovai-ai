import { useEffect, useState } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import {
  managedAvatarObjectUrl,
  type ManagedAvatarRenditionKind
} from './managed-avatar-cache'

type ManagedAvatarState = {
  key: string
  settled: boolean
  url: string | null
}

export function useManagedAvatarUrl(
  avatarRef: string | null,
  rendition: ManagedAvatarRenditionKind
): { loading: boolean; url: string | null } {
  const parsed = avatarRef ? parseControlledMemberAvatarRef(avatarRef) : null
  const key = parsed?.kind === 'managed' ? `${avatarRef}\u0000${rendition}` : null
  const [state, setState] = useState<ManagedAvatarState>({
    key: '',
    settled: false,
    url: null
  })

  useEffect(() => {
    if (!key || !avatarRef) return undefined
    let ignore = false
    void managedAvatarObjectUrl(avatarRef, rendition).then((url) => {
      if (!ignore) setState({ key, settled: true, url })
    })
    return () => {
      ignore = true
    }
  }, [avatarRef, key, rendition])

  if (!key) return { loading: false, url: null }
  if (state.key !== key) return { loading: true, url: null }
  return { loading: !state.settled, url: state.url }
}
