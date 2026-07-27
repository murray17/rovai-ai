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

export async function submitMemberIdentityWithAvatar<
  Draft extends { avatarRef: string | null }
>(
  draft: Draft,
  source: PendingMemberAvatarSource | null,
  persistAvatar: (
    source: PendingMemberAvatarSource
  ) => Promise<PersistedMemberAvatar>,
  commitProfile: (draft: Draft) => Promise<void>,
  onAvatarPersisted: (
    draft: Draft,
    source: PendingMemberAvatarSource
  ) => void
): Promise<{ draft: Draft; source: PendingMemberAvatarSource | null }> {
  let nextDraft = draft
  let nextSource = source
  if (source?.needsSave) {
    const persisted = await persistAvatar(source)
    nextDraft = { ...draft, avatarRef: persisted.avatarRef }
    nextSource = {
      ...source,
      crop: persisted.crop,
      needsSave: false
    }
    onAvatarPersisted(nextDraft, nextSource)
  }
  await commitProfile(nextDraft)
  return { draft: nextDraft, source: nextSource }
}
