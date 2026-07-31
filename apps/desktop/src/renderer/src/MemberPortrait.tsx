import { useState, type CSSProperties } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import { builtinMemberAvatarAssets } from './member-avatar-registry'
import { firstGrapheme } from './member-identity'
import { identityColorToken } from './theme'
import { useManagedAvatarUrl } from './use-managed-avatar'

export interface MemberPortraitProps {
  agentProfileId: string
  avatarRef: string | null
  displayName: string
  className?: string
}

export function MemberPortrait({
  agentProfileId,
  avatarRef,
  displayName,
  className
}: MemberPortraitProps): React.JSX.Element {
  const parsed = avatarRef ? parseControlledMemberAvatarRef(avatarRef) : null
  const builtin = builtinMemberAvatarAssets(avatarRef)
  const managed = useManagedAvatarUrl(avatarRef, 'portrait')
  const renditionKey = parsed?.kind === 'builtin'
    ? `${avatarRef}:portrait`
    : parsed?.kind === 'managed'
      ? `${avatarRef}:portrait`
      : 'fallback'
  const [failedRenditionKey, setFailedRenditionKey] = useState<string | null>(null)
  const failed = failedRenditionKey === renditionKey
  const hasBuiltinImage = parsed?.kind === 'builtin' && builtin && !failed
  const hasManagedImage = parsed?.kind === 'managed' && managed.url && !failed

  return (
    <figure
      className={[
        'member-portrait',
        managed.loading ? 'member-portrait--loading' : '',
        className ?? ''
      ].filter(Boolean).join(' ')}
      style={{
        '--member-avatar-accent': identityColorToken(agentProfileId)
      } as CSSProperties}
      role="img"
      aria-label={`${displayName}的队员肖像`}
      aria-busy={managed.loading ? true : undefined}
    >
      {hasBuiltinImage && (
        <img
          className="member-portrait-image"
          src={builtin.portraitDay}
          alt=""
          draggable={false}
          onError={() => setFailedRenditionKey(renditionKey)}
        />
      )}
      {hasManagedImage && (
        <img
          className="member-portrait-image"
          src={managed.url ?? undefined}
          alt=""
          draggable={false}
          onError={() => setFailedRenditionKey(renditionKey)}
        />
      )}
      {!hasBuiltinImage && !hasManagedImage && (
        <span className="member-portrait-fallback" aria-hidden="true">
          {firstGrapheme(displayName)}
        </span>
      )}
    </figure>
  )
}
