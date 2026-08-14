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
    expect(BUILTIN_MEMBER_PRESETS.map((preset) => preset.displayName)).toEqual([
      '叮叮',
      '芝士',
      '咕咕',
      '小兔'
    ])
    expect(BUILTIN_MEMBER_PRESETS[1]).toMatchObject({
      teamRole: '鉴定士',
      professionalResponsibilities:
        '负责文档、方案与代码评审，核查事实准确性、结构完整性、边界条件、潜在风险，以及方案与实现是否一致，并给出明确、可执行的评审结论与修改建议。',
      personalityTraits: ['严谨', '沉稳', '公正']
    })
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
