import { describe, expect, it } from 'vitest'
import { EMPTY_IDENTITY, identityCommand, identityDraftFor, identityDraftIssue } from './member-identity-draft'

describe('professional responsibilities draft', () => {
  it.each(['中'.repeat(30_000), '😀'.repeat(30_000), 'e\u0301'.repeat(15_000), '"\n\0中😀'.repeat(6_000)])(
    'accepts 30,000 scalars after trimming and preserves the overlong draft',
    (text) => {
      const draft = { ...EMPTY_IDENTITY, displayName: '队员', professionalResponsibilities: ` \uFEFF${text}\n ` }
      expect(identityDraftIssue(draft, null, [])).toBeNull()
      expect(identityCommand(draft, null).professionalResponsibilities).toBe(text)
      draft.professionalResponsibilities = `${text}界`
      const original = { ...draft }
      expect(identityDraftIssue(draft, null, [])?.field).toBe('professionalResponsibilities')
      expect(draft).toEqual(original)
    }
  )

  it('preserves internal formatting, counts combining marks, and keeps the other limits', () => {
    const draft = { ...identityDraftFor(null), displayName: '队员' }
    draft.professionalResponsibilities = '\u0085a\n  b\u0085'
    expect(identityCommand(draft, null).professionalResponsibilities).toBe(draft.professionalResponsibilities)
    draft.professionalResponsibilities = ' \uFEFF\n'
    expect(identityCommand(draft, null).professionalResponsibilities).toBe('')
    for (const [field, length] of [['teamRole', 121], ['workingPrinciples', 3_001], ['growthTopic', 3_001]] as const) {
      expect(identityDraftIssue({ ...draft, [field]: '中'.repeat(length) }, null, [])?.field).toBe(field)
    }
    for (const [field, label] of [['workingPrinciples', '工作准则'], ['growthTopic', '成长课题']] as const) {
      for (const text of ['中'.repeat(3_000), '😀'.repeat(3_000), 'e\u0301'.repeat(1_500), '"\\\n\0中😀'.repeat(500)]) {
        const valid = { ...draft, [field]: ` \uFEFF${text}\n ` }
        expect(identityDraftIssue(valid, null, [])).toBeNull()
        expect(identityCommand(valid, null)[field]).toBe(text)
        const overlong = { ...valid, [field]: `${text}界` }
        expect(identityDraftIssue(overlong, null, [])).toEqual({ field, message: `${label}最多 3,000 个字符。` })
        expect(overlong[field]).toBe(`${text}界`)
      }
      expect(identityCommand({ ...draft, [field]: ' \uFEFF\n' }, null)[field]).toBe('')
      expect(identityCommand({ ...draft, [field]: '\u0085a\n  b\u0085' }, null)[field]).toBe('\u0085a\n  b\u0085')
    }
  })
})
