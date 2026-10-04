import type { BuiltinMemberAvatarRole, InterfaceLanguage } from '@contracts'
import luokePreset from './assets/characters/luoke/preset.json'
import luokeEnglish from './assets/characters/luoke/preset.en.json'
import mianzhiPreset from './assets/characters/mianzhi/preset.json'
import mianzhiEnglish from './assets/characters/mianzhi/preset.en.json'
import muwaPreset from './assets/characters/muwa/preset.json'
import muwaEnglish from './assets/characters/muwa/preset.en.json'
import qiluPreset from './assets/characters/qilu/preset.json'
import qiluEnglish from './assets/characters/qilu/preset.en.json'

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

const ENGLISH_MEMBER_PRESETS: ReadonlyArray<BuiltinMemberPreset> = [
  preset('luoke', { ...luokePreset, ...luokeEnglish }),
  preset('muwa', { ...muwaPreset, ...muwaEnglish }),
  preset('mianzhi', { ...mianzhiPreset, ...mianzhiEnglish }),
  preset('qilu', { ...qiluPreset, ...qiluEnglish })
]

/** Language selects initial data only. Saved member profiles are never translated. */
export function builtinMemberPresetsForLanguage(language: InterfaceLanguage): ReadonlyArray<BuiltinMemberPreset> {
  return language === 'en' ? ENGLISH_MEMBER_PRESETS : BUILTIN_MEMBER_PRESETS
}
