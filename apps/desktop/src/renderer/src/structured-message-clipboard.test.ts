import { describe, expect, it } from 'vitest'
import {
  createStructuredMessageClipboardData,
  readStructuredMessageClipboardContent
} from './structured-message-clipboard'

const members = [{
  agentId: 'agent-alice',
  displayName: '爱丽丝',
  mentionable: true
}, {
  agentId: 'agent-kirigiri',
  displayName: '雾切响子',
  mentionable: true
}]

describe('structured message clipboard', () => {
  it('writes current visible text plus an opaque, versioned private envelope', () => {
    const data = createStructuredMessageClipboardData([
      { kind: 'text', text: '请 ' },
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: ' 和 ' },
      { kind: 'all_members_mention' }
    ], members)

    expect(data?.text).toBe('请 @爱丽丝 和 @所有队员')
    expect(data?.html).toContain('data-rovai-structured-camp-message-v1=')
    expect(data?.html).toContain('请 @爱丽丝 和 @所有队员')
    expect(data?.html).not.toContain('agent-alice')
  })

  it('restores valid member and all-members mentions in the target Camp', () => {
    const data = createStructuredMessageClipboardData([
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: '、' },
      { kind: 'member_mention', agentId: 'agent-kirigiri' },
      { kind: 'all_members_mention' }
    ], members)!

    expect(readStructuredMessageClipboardContent(data.html, data.text, members)).toEqual([
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: '、' },
      { kind: 'member_mention', agentId: 'agent-kirigiri' },
      { kind: 'all_members_mention' }
    ])
  })

  it('downgrades unavailable members to their copied visible text', () => {
    const data = createStructuredMessageClipboardData([
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: ' 和 ' },
      { kind: 'member_mention', agentId: 'agent-kirigiri' },
      { kind: 'all_members_mention' }
    ], members)!

    expect(readStructuredMessageClipboardContent(data.html, data.text, [{
      ...members[0],
      displayName: '改名后的爱丽丝'
    }, {
      ...members[1],
      mentionable: false
    }])).toEqual([
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: ' 和 ' },
      { kind: 'text', text: '@雾切响子' },
      { kind: 'all_members_mention' }
    ])
  })

  it('never upgrades plain or mismatched clipboard text', () => {
    const data = createStructuredMessageClipboardData([
      { kind: 'member_mention', agentId: 'agent-alice' }
    ], members)!

    expect(readStructuredMessageClipboardContent('', '@爱丽丝', members)).toBeNull()
    expect(readStructuredMessageClipboardContent(data.html, '@雾切响子', members)).toBeNull()
    expect(createStructuredMessageClipboardData([{ kind: 'text', text: '@爱丽丝' }], members))
      .toBeNull()
  })

  it('copies current-user identity privately but downgrades it on Composer paste', () => {
    const data = createStructuredMessageClipboardData([
      { kind: 'current_user_mention', userId: 'local_user' },
      { kind: 'text', text: '请确认' }
    ], members)!

    expect(data.text).toBe('@你 请确认')
    expect(readStructuredMessageClipboardContent(data.html, data.text, members)).toEqual([
      { kind: 'text', text: '@你' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: '请确认' }
    ])
  })

  it('always downgrades copied Skill identity to visible slash text', () => {
    const skillOnly = createStructuredMessageClipboardData([{
      kind: 'skill_mention',
      skillId: 'skill-review',
      nameAtSend: 'review-pr'
    }], members)!

    expect(skillOnly.text).toBe('/review-pr')
    expect(readStructuredMessageClipboardContent(skillOnly.html, skillOnly.text, members)).toBeNull()

    const mixed = createStructuredMessageClipboardData([
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: ' ' },
      { kind: 'skill_mention', skillId: 'skill-review', nameAtSend: 'review-pr' }
    ], members)!
    expect(readStructuredMessageClipboardContent(mixed.html, mixed.text, members)).toEqual([
      { kind: 'member_mention', agentId: 'agent-alice' },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: '/review-pr' }
    ])
  })
})
