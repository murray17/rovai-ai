import { describe, expect, it } from 'vitest'
import { parseControlledMemberAvatarRef } from '@contracts'
import { BUILTIN_MEMBER_PRESETS } from './member-presets'

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
      expect(preset.professionalResponsibilities.length).toBeGreaterThan(30)
      expect(preset.personalityTraits).toHaveLength(3)
      expect(preset.workingPrinciples).toBe('')
      expect(preset.growthTopic).toBe('')
    }
  })
})
