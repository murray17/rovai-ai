import { useState, type CSSProperties } from 'react'
import { parseControlledMemberAvatarRef } from '@contracts'
import { builtinMemberAvatarAssets } from './member-avatar-registry'
import { firstGrapheme } from './member-identity'
import { identityColorToken } from './theme'
import { useManagedAvatarUrl } from './use-managed-avatar'

export type MemberAvatarSize = 'mention' | 'list' | 'workspace' | 'picker' | 'profile' | 'bust'

const MEMBER_AVATAR_PIXEL_SIZE: Readonly<
  Record<Exclude<MemberAvatarSize, 'bust'>, number>
> = {
  mention: 28,
  list: 32,
  workspace: 34,
  picker: 44,
  profile: 50
}

export interface MemberAvatarProps {
  agentId: string
  avatarRef: string | null
  displayName: string
  size?: MemberAvatarSize
  decorative?: boolean
  className?: string
}

export function MemberAvatar({
  agentId,
  avatarRef,
  displayName,
  size = 'list',
  decorative = false,
  className
}: MemberAvatarProps): React.JSX.Element {
  const parsed = avatarRef ? parseControlledMemberAvatarRef(avatarRef) : null
  const builtin = builtinMemberAvatarAssets(avatarRef)
  const managed = useManagedAvatarUrl(avatarRef, 'icon')
  const renditionKey = parsed?.kind === 'builtin'
    ? `${avatarRef}:${size === 'bust' ? 'bust' : 'glyph'}`
    : parsed?.kind === 'managed'
      ? `${avatarRef}:icon`
      : 'fallback'
  const [failedRenditionKey, setFailedRenditionKey] = useState<string | null>(null)
  const failed = failedRenditionKey === renditionKey
  const hasManagedImage = parsed?.kind === 'managed' && managed.url && !failed
  const hasBuiltinImage = parsed?.kind === 'builtin' && builtin && !failed
  const style = {
    '--member-avatar-accent': identityColorToken(agentId),
    ...(size === 'bust'
      ? {}
      : { '--member-avatar-size': `${MEMBER_AVATAR_PIXEL_SIZE[size]}px` })
  } as CSSProperties
  const semanticProps = decorative
    ? { 'aria-hidden': true }
    : { role: 'img', 'aria-label': `${displayName}的头像` }

  return (
    <span
      className={[
        'member-avatar',
        size === 'bust' ? 'member-avatar--bust' : '',
        managed.loading ? 'member-avatar--loading' : '',
        className ?? ''
      ].filter(Boolean).join(' ')}
      style={style}
      aria-busy={!decorative && managed.loading ? true : undefined}
      {...semanticProps}
    >
      {hasBuiltinImage && size === 'bust' && (
        <img
          className="member-avatar-image member-avatar-image--bust"
          src={builtin.portrait}
          alt=""
          draggable={false}
          onError={() => setFailedRenditionKey(renditionKey)}
        />
      )}
      {hasBuiltinImage && size !== 'bust' && (
        <img
          className="member-avatar-image"
          src={builtin.icon}
          alt=""
          draggable={false}
          onError={() => setFailedRenditionKey(renditionKey)}
        />
      )}
      {hasManagedImage && (
        <img
          className="member-avatar-image"
          src={managed.url ?? undefined}
          alt=""
          draggable={false}
          onError={() => setFailedRenditionKey(renditionKey)}
        />
      )}
      {!hasBuiltinImage && !hasManagedImage && (
        <span className="member-avatar-fallback" aria-hidden="true">
          {firstGrapheme(displayName)}
        </span>
      )}
    </span>
  )
}
