import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  StructuredMentionComposer,
  StructuredMentionOptionAvatar,
  shouldHandleStructuredComposerBackspaceAtStart,
  shouldSubmitStructuredComposerOnEnter,
  structuredMentionOptions,
  structuredSkillOptions
} from './StructuredMentionComposer'
import { RovaiComposerExtension } from './RovaiComposerExtension'
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

describe('StructuredMentionComposer V2', () => {
  it('renders one native Lexical editing surface with an adjacent placeholder', () => {
    const markup = renderToStaticMarkup(createElement(StructuredMentionComposer, {
      id: 'empty-composer',
      draftIdentity: 'camp-1:draft-1',
      document: { version: 2, segments: [] },
      members,
      placeholder: '继续提问…',
      ariaLabel: '写消息',
      onSubmit: () => undefined
    }))

    expect(markup).toContain('class="structured-mention-composer"')
    expect(markup).toContain('class="structured-mention-editor"')
    expect(markup).toContain('contentEditable="true"')
    expect(markup).toContain('aria-label="写消息"')
    expect(markup).toContain('structured-mention-placeholder')
    expect(markup).not.toContain('data-editor-segment')
  })

  it('keeps the module-level Extension configuration stable', () => {
    expect(RovaiComposerExtension).toBe(RovaiComposerExtension)
  })

  it('offers one all-members choice and filters only mentionable members', () => {
    expect(structuredMentionOptions(members, '').map((option) => option.kind)).toEqual([
      'all_members', 'member', 'member'
    ])
    expect(structuredMentionOptions(members, '所有')).toEqual([{
      kind: 'all_members',
      label: '所有队员'
    }])
    expect(structuredMentionOptions([
      members[0],
      { ...members[1], mentionable: false }
    ], '沐')).toEqual([])
  })

  it('renders the catalog-backed member avatar in the candidate UI', () => {
    const memberMarkup = renderToStaticMarkup(createElement(StructuredMentionOptionAvatar, {
      option: { kind: 'member', member: members[0] }
    }))
    const allMembersMarkup = renderToStaticMarkup(createElement(StructuredMentionOptionAvatar, {
      option: { kind: 'all_members', label: '所有队员' }
    }))

    expect(memberMarkup).toContain('class="member-avatar mention-avatar"')
    expect(memberMarkup).toContain('class="member-avatar-image"')
    expect(allMembersMarkup).toContain('class="mention-avatar"')
    expect(allMembersMarkup).toContain('>@</span>')
  })

  it('filters Skills by name and description and keeps all options for an empty query', () => {
    expect(structuredSkillOptions(skills, 'agent')).toEqual([skills[0]])
    expect(structuredSkillOptions(skills, '并行')).toEqual([skills[1]])
    expect(structuredSkillOptions(skills, '')).toEqual(skills)
  })

  it('blocks submit while composition or a selectable Typeahead menu owns Enter', () => {
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: false, isComposing: true, suggestionMenuOpen: false
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: false, isComposing: false, suggestionMenuOpen: true
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: true, isComposing: false, suggestionMenuOpen: false
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: false, isComposing: false, suggestionMenuOpen: false
    })).toBe(true)
  })

  it('offers Backspace-at-start only for a collapsed caret outside composition', () => {
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace', isComposing: false, selection: { anchor: 0, focus: 0 }
    })).toBe(true)
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace', isComposing: false, selection: { anchor: 0, focus: 1 }
    })).toBe(false)
    expect(shouldHandleStructuredComposerBackspaceAtStart({
      key: 'Backspace', isComposing: true, selection: { anchor: 0, focus: 0 }
    })).toBe(false)
  })
})
