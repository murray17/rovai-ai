import {
  parseControlledMemberAvatarRef,
  type BuiltinMemberAvatarRole
} from '@contracts'
import luokeBust from './assets/characters/luoke/bust.png'
import luokeGlyphDay from './assets/characters/luoke/glyph-day.svg'
import luokeGlyphNight from './assets/characters/luoke/glyph-night.svg'
import luokePortraitDay from './assets/characters/luoke/portrait-day.png'
import luokePortraitNight from './assets/characters/luoke/portrait-night.png'
import mianzhiBust from './assets/characters/mianzhi/bust.png'
import mianzhiGlyphDay from './assets/characters/mianzhi/glyph-day.svg'
import mianzhiGlyphNight from './assets/characters/mianzhi/glyph-night.svg'
import mianzhiPortraitDay from './assets/characters/mianzhi/portrait-day.png'
import mianzhiPortraitNight from './assets/characters/mianzhi/portrait-night.png'
import muwaBust from './assets/characters/muwa/bust.png'
import muwaGlyphDay from './assets/characters/muwa/glyph-day.svg'
import muwaGlyphNight from './assets/characters/muwa/glyph-night.svg'
import muwaPortraitDay from './assets/characters/muwa/portrait-day.png'
import muwaPortraitNight from './assets/characters/muwa/portrait-night.png'
import qiluBust from './assets/characters/qilu/bust.png'
import qiluGlyphDay from './assets/characters/qilu/glyph-day.svg'
import qiluGlyphNight from './assets/characters/qilu/glyph-night.svg'
import qiluPortraitDay from './assets/characters/qilu/portrait-day.png'
import qiluPortraitNight from './assets/characters/qilu/portrait-night.png'

export interface BuiltinMemberAvatarAssets {
  glyphDay: string
  glyphNight: string
  bust: string
  portraitDay: string
  portraitNight: string
}

export const BUILTIN_MEMBER_AVATAR_ASSETS: Readonly<
  Record<BuiltinMemberAvatarRole, BuiltinMemberAvatarAssets>
> = {
  luoke: {
    glyphDay: luokeGlyphDay,
    glyphNight: luokeGlyphNight,
    bust: luokeBust,
    portraitDay: luokePortraitDay,
    portraitNight: luokePortraitNight
  },
  muwa: {
    glyphDay: muwaGlyphDay,
    glyphNight: muwaGlyphNight,
    bust: muwaBust,
    portraitDay: muwaPortraitDay,
    portraitNight: muwaPortraitNight
  },
  mianzhi: {
    glyphDay: mianzhiGlyphDay,
    glyphNight: mianzhiGlyphNight,
    bust: mianzhiBust,
    portraitDay: mianzhiPortraitDay,
    portraitNight: mianzhiPortraitNight
  },
  qilu: {
    glyphDay: qiluGlyphDay,
    glyphNight: qiluGlyphNight,
    bust: qiluBust,
    portraitDay: qiluPortraitDay,
    portraitNight: qiluPortraitNight
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
