import { describe, expect, it } from 'vitest'
import { parseControlledMemberAvatarRef } from '@contracts'
import {
  BUILTIN_MEMBER_PRESETS,
  uniquePresetHandle
} from './member-presets'

describe('builtin member presets', () => {
  it('ship four independent identity presets with canonical builtin avatar refs', () => {
    expect(BUILTIN_MEMBER_PRESETS.map((preset) => preset.role)).toEqual([
      'luoke',
      'muwa',
      'mianzhi',
      'qilu'
    ])
    for (const preset of BUILTIN_MEMBER_PRESETS) {
      expect(parseControlledMemberAvatarRef(preset.avatarRef)).toMatchObject({
        kind: 'builtin',
        role: preset.role
      })
      expect(preset.instructions.length).toBeGreaterThan(80)
      expect(preset.strengths).toHaveLength(3)
    }
  })

  it('suggests a free handle without mutating preset identity from an avatar ref', () => {
    expect(uniquePresetHandle('luoke', [])).toBe('luoke')
    expect(uniquePresetHandle('luoke', ['luoke', 'luoke-2', 'LUOKE-3'])).toBe('luoke-4')
  })
})
