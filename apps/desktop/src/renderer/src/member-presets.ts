import type { BuiltinMemberAvatarRole } from '@contracts'
import luokePreset from './assets/characters/luoke/preset.json'
import mianzhiPreset from './assets/characters/mianzhi/preset.json'
import muwaPreset from './assets/characters/muwa/preset.json'
import qiluPreset from './assets/characters/qilu/preset.json'

export interface BuiltinMemberPreset {
  role: BuiltinMemberAvatarRole
  displayName: string
  personaLabel: string
  roleTitle: string
  roleDescription: string
  motto: string
  representativeObjects: string[]
  strengths: string[]
  watchout: string
  instructions: string
  avatarRef: string
  accentSample: string
}

type ImportedPreset = Omit<BuiltinMemberPreset, 'role'> & {
  assetPaths: Record<string, string>
}

function preset(
  role: BuiltinMemberAvatarRole,
  imported: ImportedPreset
): BuiltinMemberPreset {
  const { assetPaths: _assetPaths, ...identity } = imported
  return { role, ...identity }
}

export const BUILTIN_MEMBER_PRESETS: ReadonlyArray<BuiltinMemberPreset> = [
  preset('luoke', luokePreset),
  preset('muwa', muwaPreset),
  preset('mianzhi', mianzhiPreset),
  preset('qilu', qiluPreset)
]
