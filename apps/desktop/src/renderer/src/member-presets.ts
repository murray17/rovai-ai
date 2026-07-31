import type { BuiltinMemberAvatarRole } from '@contracts'
import luokePreset from './assets/characters/luoke/preset.json'
import mianzhiPreset from './assets/characters/mianzhi/preset.json'
import muwaPreset from './assets/characters/muwa/preset.json'
import qiluPreset from './assets/characters/qilu/preset.json'

export interface BuiltinMemberPreset {
  role: BuiltinMemberAvatarRole
  displayName: string
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  workingPrinciples: string
  growthTopic: string
  avatarRef: string
  accentSample: string
}

type ImportedPreset = Omit<BuiltinMemberPreset, 'role'>

function preset(
  role: BuiltinMemberAvatarRole,
  imported: ImportedPreset
): BuiltinMemberPreset {
  return { role, ...imported }
}

export const BUILTIN_MEMBER_PRESETS: ReadonlyArray<BuiltinMemberPreset> = [
  preset('luoke', luokePreset),
  preset('muwa', muwaPreset),
  preset('mianzhi', mianzhiPreset),
  preset('qilu', qiluPreset)
]
