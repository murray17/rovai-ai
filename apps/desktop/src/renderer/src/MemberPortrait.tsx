import { useState, type CSSProperties } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import { builtinMemberAvatarAssets } from './member-avatar-registry'
import { firstGrapheme } from './member-identity'
import { identityColorToken } from './theme'
import { useManagedAvatarUrl } from './use-managed-avatar'

export interface MemberPortraitProps {
  agentId: string
  avatarRef: string | null
  displayName: string
  decorative?: boolean
  className?: string
}

export function MemberPortrait({
  agentId,
  avatarRef,
  displayName,
  decorative = false,
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
  const semanticProps = decorative
    ? { 'aria-hidden': true }
    : { role: 'img', 'aria-label': `${displayName}的队员肖像` }

  return (
    <figure
      className={[
        'member-portrait',
        managed.loading ? 'member-portrait--loading' : '',
        className ?? ''
      ].filter(Boolean).join(' ')}
      style={{
        '--member-avatar-accent': identityColorToken(agentId)
      } as CSSProperties}
      aria-busy={managed.loading ? true : undefined}
      {...semanticProps}
    >
      {hasBuiltinImage && (
        <img
          className="member-portrait-image"
          src={builtin.portrait}
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
