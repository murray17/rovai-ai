import {
  parseControlledMemberAvatarRef,
  type BuiltinMemberAvatarRole
} from '@contracts'
import luokeBust from './assets/characters/luoke/bust.png'
import luokeGlyphDay from './assets/characters/luoke/glyph-day.svg'
import luokePortraitDay from './assets/characters/luoke/portrait-day.png'
import mianzhiBust from './assets/characters/mianzhi/bust.png'
import mianzhiGlyphDay from './assets/characters/mianzhi/glyph-day.svg'
import mianzhiPortraitDay from './assets/characters/mianzhi/portrait-day.png'
import muwaBust from './assets/characters/muwa/bust.png'
import muwaGlyphDay from './assets/characters/muwa/glyph-day.svg'
import muwaPortraitDay from './assets/characters/muwa/portrait-day.png'
import qiluBust from './assets/characters/qilu/bust.png'
import qiluGlyphDay from './assets/characters/qilu/glyph-day.svg'
import qiluPortraitDay from './assets/characters/qilu/portrait-day.png'

export interface BuiltinMemberAvatarAssets {
  glyphDay: string
  bust: string
  portraitDay: string
}

export const BUILTIN_MEMBER_AVATAR_ASSETS: Readonly<
  Record<BuiltinMemberAvatarRole, BuiltinMemberAvatarAssets>
> = {
  luoke: {
    glyphDay: luokeGlyphDay,
    bust: luokeBust,
    portraitDay: luokePortraitDay
  },
  muwa: {
    glyphDay: muwaGlyphDay,
    bust: muwaBust,
    portraitDay: muwaPortraitDay
  },
  mianzhi: {
    glyphDay: mianzhiGlyphDay,
    bust: mianzhiBust,
    portraitDay: mianzhiPortraitDay
  },
  qilu: {
    glyphDay: qiluGlyphDay,
    bust: qiluBust,
    portraitDay: qiluPortraitDay
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
