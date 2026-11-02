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
    for (const [field, length] of [['teamRole', 121], ['workingPrinciples', 301], ['growthTopic', 301]] as const) {
      expect(identityDraftIssue({ ...draft, [field]: '中'.repeat(length) }, null, [])?.field).toBe(field)
    }
  })
})
