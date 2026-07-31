import type { MemberAvatarCrop } from '@contracts'
import type { NormalizedMemberAvatarSource } from './member-avatar-image'

export interface PendingMemberAvatarSource extends NormalizedMemberAvatarSource {
  crop: MemberAvatarCrop
  needsSave: boolean
}

export interface PersistedMemberAvatar {
  avatarRef: string
  crop: MemberAvatarCrop
}

export async function submitMemberAvatar(
  avatarRef: string | null,
  source: PendingMemberAvatarSource | null,
  persistAvatar: (
    source: PendingMemberAvatarSource
  ) => Promise<PersistedMemberAvatar>,
  commitProfile: (avatarRef: string | null) => Promise<void>,
  onAvatarPersisted: (
    avatarRef: string,
    source: PendingMemberAvatarSource
  ) => void
): Promise<{ avatarRef: string | null; source: PendingMemberAvatarSource | null }> {
  let nextAvatarRef = avatarRef
  let nextSource = source
  if (source?.needsSave) {
    const persisted = await persistAvatar(source)
    nextAvatarRef = persisted.avatarRef
    nextSource = {
      ...source,
      crop: persisted.crop,
      needsSave: false
    }
    onAvatarPersisted(nextAvatarRef, nextSource)
  }
  await commitProfile(nextAvatarRef)
  return { avatarRef: nextAvatarRef, source: nextSource }
}
