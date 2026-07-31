import {
  parseControlledMemberAvatarRef,
  type BuiltinMemberAvatarRole
} from '@contracts'
import luokeIcon from './assets/characters/luoke/icon-192.png'
import luokeSource from './assets/characters/luoke/source.png'
import mianzhiIcon from './assets/characters/mianzhi/icon-192.png'
import mianzhiSource from './assets/characters/mianzhi/source.png'
import muwaIcon from './assets/characters/muwa/icon-192.png'
import muwaSource from './assets/characters/muwa/source.png'
import qiluIcon from './assets/characters/qilu/icon-192.png'
import qiluSource from './assets/characters/qilu/source.png'

export interface BuiltinMemberAvatarAssets {
  icon: string
  portrait: string
}

export const BUILTIN_MEMBER_AVATAR_ASSETS: Readonly<
  Record<BuiltinMemberAvatarRole, BuiltinMemberAvatarAssets>
> = {
  luoke: {
    icon: luokeIcon,
    portrait: luokeSource
  },
  muwa: {
    icon: muwaIcon,
    portrait: muwaSource
  },
  mianzhi: {
    icon: mianzhiIcon,
    portrait: mianzhiSource
  },
  qilu: {
    icon: qiluIcon,
    portrait: qiluSource
  }
}

export function builtinMemberAvatarAssets(
  avatarRef: string | null
): BuiltinMemberAvatarAssets | null {
  if (!avatarRef) return null
  const parsed = parseControlledMemberAvatarRef(avatarRef)
  return parsed?.kind === 'builtin'
    ? BUILTIN_MEMBER_AVATAR_ASSETS[parsed.role]
    : null
}
