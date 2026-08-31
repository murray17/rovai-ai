import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  StructuredMentionComposer,
  StructuredMentionOptionAvatar,
  insertSkillMentionWithTrailingSpace,
  mentionQueryAfterNativeTextInput,
  mentionQueryAfterTypedText,
  shouldHandleStructuredComposerBackspaceAtStart,
  shouldReconcileStructuredComposerComposition,
  shouldSubmitStructuredComposerOnEnter,
  structuredMentionOptions,
  structuredSkillOptions
} from './StructuredMentionComposer'
import type { ComposerSkillOption } from './composer-skill-picker'

const members = [{
  agentId: 'agent_1',
  displayName: '新洛可',
  avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
  mentionable: true
}, {
  agentId: 'agent_2',
  displayName: '沐瓦',
  mentionable: true
}]

const skills: ComposerSkillOption[] = [{
  id: 'skill-analyze',
  name: 'analyze-agent-codebase',
  description: '分析 Agent 代码结构与边界',
  origin: 'official'
}, {
  id: 'skill-worktree',
  name: 'worktree',
  description: '管理并行工作树',
  origin: 'official'
}]

describe('StructuredMentionComposer', () => {
  it('keeps the empty placeholder adjacent to the editor for native IME visibility control', () => {
    const markup = renderToStaticMarkup(createElement(StructuredMentionComposer, {
      id: 'empty-composer',
      value: [],
      members,
      placeholder: '继续提问…',
      ariaLabel: '写消息',
      onChange: () => undefined,
      onSubmit: () => undefined
    }))

    expect(markup).toContain('data-editor-segment="text" data-editor-empty="true"')
    expect(markup).toContain('<br data-editor-empty-break="true"/>')
    expect(markup).toContain('</div><span class="structured-mention-placeholder"')
  })

  it('renders model newlines as native line boxes with a trailing caret host', () => {
    const markup = renderToStaticMarkup(createElement(StructuredMentionComposer, {
      id: 'multiline-composer',
      value: [{ kind: 'text', text: '前\n后\n' }],
      members,
      ariaLabel: '写消息',
      onChange: () => undefined,
      onSubmit: () => undefined
    }))

    expect(markup).toContain(
      '前<br data-editor-line-break="true"/>后<br data-editor-line-break="true"/><span data-editor-caret-host="true">\u200B</span>'
    )
  })

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

  it('renders the controlled member icon in the candidate menu instead of a name initial', () => {
    const memberMarkup = renderToStaticMarkup(createElement(StructuredMentionOptionAvatar, {
      option: { kind: 'member', member: members[0] }
    }))
    const allMembersMarkup = renderToStaticMarkup(createElement(StructuredMentionOptionAvatar, {
      option: { kind: 'all_members', label: '所有队员' }
    }))

    expect(memberMarkup).toContain('class="member-avatar mention-avatar"')
    expect(memberMarkup).toContain('class="member-avatar-image"')
    expect(memberMarkup).not.toContain('member-avatar-fallback')
    expect(allMembersMarkup).toContain('class="mention-avatar"')
    expect(allMembersMarkup).toContain('>@</span>')
    expect(allMembersMarkup).not.toContain('member-avatar')
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

  it('filters Skills by name and description and keeps all options for an empty query', () => {
    expect(structuredSkillOptions(skills, 'agent')).toEqual([skills[0]])
    expect(structuredSkillOptions(skills, '并行')).toEqual([skills[1]])
    expect(structuredSkillOptions(skills, '')).toEqual(skills)
  })

  it('selects a Skill as an atomic identity token with a writable trailing space', () => {
    expect(insertSkillMentionWithTrailingSpace({
      content: [{ kind: 'text', text: '/ana' }],
      selection: { anchor: 0, focus: 4 }
    }, 'skill-analyze', 'analyze-agent-codebase')).toEqual({
      content: [
        {
          kind: 'skill_mention',
          skillId: 'skill-analyze',
          nameAtSend: 'analyze-agent-codebase'
        },
        { kind: 'text', text: ' ' }
      ],
      selection: { anchor: 2, focus: 2 }
    })
  })

  it('renders a stored Skill marker without rewriting its send-time name', () => {
    const markup = renderToStaticMarkup(createElement(StructuredMentionComposer, {
      id: 'skill-token-composer',
      value: [{
        kind: 'skill_mention',
        skillId: 'skill-analyze',
        nameAtSend: 'old-name'
      }],
      members,
      skills,
      ariaLabel: '写消息',
      onChange: () => undefined,
      onSubmit: () => undefined
    }))

    expect(markup).toContain('data-token-kind="skill_mention"')
    expect(markup).toContain('data-skill-id="skill-analyze"')
    expect(markup).toContain('/old-name')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).not.toContain('/analyze-agent-codebase')
  })

  it('does not submit or choose a candidate while IME composition is active', () => {
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      suggestionMenuOpen: false
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      suggestionMenuOpen: true
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      suggestionMenuOpen: false
    })).toBe(true)
  })

  it('reconciles only the composition generation that still owns the same idle editor', () => {
    expect(shouldReconcileStructuredComposerComposition({
      scheduledGeneration: 3,
      currentGeneration: 3,
      isComposing: false,
      sameEditor: true
    })).toBe(true)
    expect(shouldReconcileStructuredComposerComposition({
      scheduledGeneration: 3,
      currentGeneration: 4,
      isComposing: false,
      sameEditor: true
    })).toBe(false)
    expect(shouldReconcileStructuredComposerComposition({
      scheduledGeneration: 3,
      currentGeneration: 3,
      isComposing: true,
      sameEditor: true
    })).toBe(false)
    expect(shouldReconcileStructuredComposerComposition({
      scheduledGeneration: 3,
      currentGeneration: 3,
      isComposing: false,
      sameEditor: false
    })).toBe(false)
  })

  it('allows Enter to submit ordinary @ text when there is no selectable candidate', () => {
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      suggestionMenuOpen: false
    })).toBe(true)
  })

  it('offers Backspace-at-start only for a collapsed caret outside IME composition', () => {
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace',
      isComposing: false,
      selection: { anchor: 0, focus: 0 }
    })).toBe(true)
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace',
      isComposing: false,
      selection: { anchor: 0, focus: 1 }
    })).toBe(false)
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace',
      isComposing: false,
      selection: { anchor: 1, focus: 1 }
    })).toBe(false)
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Delete',
      isComposing: false,
      selection: { anchor: 0, focus: 0 }
    })).toBe(false)
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace',
      isComposing: true,
      selection: { anchor: 0, focus: 0 }
    })).toBe(false)
  })
})
