import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  StructuredMentionComposer,
  mentionQueryAfterNativeTextInput,
  mentionQueryAfterTypedText,
  shouldSubmitStructuredComposerOnEnter,
  structuredMentionOptions
} from './StructuredMentionComposer'

const members = [{
  agentId: 'agent_1',
  displayName: '新洛可',
  mentionable: true
}, {
  agentId: 'agent_2',
  displayName: '沐瓦',
  mentionable: true
}]

describe('StructuredMentionComposer', () => {
  it('renders repeated member occurrences and one all-members occurrence as atomic tokens', () => {
    const markup = renderToStaticMarkup(createElement(StructuredMentionComposer, {
      id: 'structured-composer',
      value: [
        { kind: 'text', text: '请 ' },
        { kind: 'member_mention', agentId: 'agent_1' },
        { kind: 'text', text: ' 和 ' },
        { kind: 'member_mention', agentId: 'agent_1' },
        { kind: 'all_members_mention' }
      ],
      members,
      ariaLabel: '写消息',
      onChange: () => undefined,
      onSubmit: () => undefined,
      onActivateMemberMention: () => undefined,
      onActivateAllMembersMention: () => undefined
    }))

    expect(markup).toContain('contentEditable="true"')
    expect(markup.match(/data-token-kind="member_mention"/g)).toHaveLength(2)
    expect(markup.match(/data-token-kind="all_members_mention"/g)).toHaveLength(1)
    expect(markup.match(/contentEditable="false"/g)).toHaveLength(3)
    expect(markup.match(/@新洛可/g)).toHaveLength(2)
    expect(markup).toContain('@所有队员')
    expect(markup).toContain('structured-mention-token')
    expect(markup.match(/role="button"/g)).toHaveLength(3)
    expect(markup.match(/tabindex="0"/g)).toHaveLength(4)
    expect(markup.match(/aria-haspopup="dialog"/g)).toHaveLength(3)
    expect(markup).toContain('aria-label="查看新洛可的基础信息"')
    expect(markup).toContain('aria-label="查看所有队员范围"')
    expect(markup).toContain('padding:0 1px')
    expect(markup).toContain('border:0')
    expect(markup).toContain('font-weight:600')
  })

  it('projects the current member name without changing the stored identity', () => {
    const markup = renderToStaticMarkup(createElement(StructuredMentionComposer, {
      id: 'renamed-composer',
      value: [{ kind: 'member_mention', agentId: 'agent_1' }],
      members: [{
        agentId: 'agent_1',
        displayName: '改名后的洛可',
        mentionable: true
      }],
      ariaLabel: '写消息',
      onChange: () => undefined,
      onSubmit: () => undefined
    }))

    expect(markup).toContain('@改名后的洛可')
    expect(markup).toContain('data-agent-id="agent_1"')
  })

  it('offers a single all-members option and never removes an already-mentioned member', () => {
    expect(structuredMentionOptions(members, '').map((option) => option.kind)).toEqual([
      'all_members', 'member', 'member'
    ])
    expect(structuredMentionOptions(members, '所有')).toEqual([{
      kind: 'all_members',
      label: '所有队员'
    }])
    expect(structuredMentionOptions(members, '洛')).toEqual([{
      kind: 'member',
      member: members[0]
    }])
  })

  it('opens a query only from the actual typed @ input and advances at the same caret', () => {
    const opened = mentionQueryAfterTypedText(null, { anchor: 2, focus: 2 }, '@')
    expect(opened).toEqual({ start: 2, end: 3, query: '' })
    expect(mentionQueryAfterTypedText(opened, { anchor: 3, focus: 3 }, '洛')).toEqual({
      start: 2,
      end: 4,
      query: '洛'
    })
    expect(mentionQueryAfterTypedText(opened, { anchor: 1, focus: 1 }, '字')).toBeNull()
    expect(mentionQueryAfterTypedText(opened, { anchor: 3, focus: 3 }, ' ')).toBeNull()
  })

  it('opens and advances the query from the native input fallback', () => {
    const opened = mentionQueryAfterNativeTextInput(null, { anchor: 3, focus: 3 }, '@')
    expect(opened).toEqual({ start: 2, end: 3, query: '' })
    expect(mentionQueryAfterNativeTextInput(opened, { anchor: 4, focus: 4 }, '洛')).toEqual({
      start: 2,
      end: 4,
      query: '洛'
    })

    const alreadyAdvanced = { start: 2, end: 4, query: '洛' }
    expect(mentionQueryAfterNativeTextInput(
      alreadyAdvanced,
      { anchor: 4, focus: 4 },
      '洛'
    )).toEqual(alreadyAdvanced)
    expect(mentionQueryAfterNativeTextInput(null, { anchor: 5, focus: 5 }, '普通@')).toBeNull()
  })

  it('does not submit or choose a candidate while IME composition is active', () => {
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      mentionMenuOpen: false
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      mentionMenuOpen: true
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      mentionMenuOpen: false
    })).toBe(true)
  })

  it('allows Enter to submit ordinary @ text when there is no selectable candidate', () => {
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      mentionMenuOpen: false
    })).toBe(true)
  })
})
