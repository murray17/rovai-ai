import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import {
  StructuredMentionComposer,
  StructuredMentionOptionAvatar,
  renderSkillMenu,
  shouldHandleStructuredComposerBackspaceAtStart,
  shouldSubmitStructuredComposerOnEnter,
  structuredMentionMemberDescription,
  structuredMentionOptions,
  structuredSkillOptions
} from './StructuredMentionComposer'
import { composerTypeaheadEnterAction } from './ComposerTypeaheadPlugin'
import { RovaiComposerExtension } from './RovaiComposerExtension'
import type { ComposerSkillOption } from './composer-skill-picker'
import type { GeneralPreferencesApi, InterfaceLanguage } from '@contracts'
import { changeInterfaceLanguage } from './interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'

const members = [{
  agentId: 'agent_1',
  displayName: '新洛可',
  teamRole: '默认队长',
  avatarRef: 'rovai://member-avatar/builtin/luoke/v1',
  mentionable: true
}, {
  agentId: 'agent_2',
  displayName: '沐瓦',
  teamRole: '',
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
  const preferences = {
    setInterfaceLanguage: async (interfaceLanguage: InterfaceLanguage) => ({
      ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage
    })
  } as GeneralPreferencesApi

  afterEach(async () => { await changeInterfaceLanguage(preferences, 'zh-CN') })

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
    expect(markup).toContain('spellCheck="false"')
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

  it('keeps Thread choices first and makes available outsiders searchable and invitational', () => {
    const outsider = {
      agentId: 'agent_3', displayName: '爱丽丝', teamRole: '五号街卖花女',
      mentionable: true, inThread: false
    }
    const catalog = [...members, outsider]
    expect(structuredMentionOptions(catalog, '').map((option) => option.kind)).toEqual([
      'all_members', 'member', 'member', 'invite_other'
    ])
    expect(structuredMentionOptions(catalog, '卖花女')).toEqual([
      { kind: 'member', member: outsider }
    ])
    expect(structuredMentionOptions(catalog, '', true)).toEqual([
      { kind: 'back_to_camp' }, { kind: 'member', member: outsider }
    ])
    const fullThread = Array.from({ length: 60 }, (_, index) => ({
      ...members[0], agentId: `camp-${index}`
    }))
    expect(structuredMentionOptions([...fullThread, outsider], '').at(-1)).toEqual({ kind: 'invite_other' })
    expect(structuredMentionOptions([...fullThread, outsider], '')).toHaveLength(50)
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
    expect(allMembersMarkup).toContain('data-navigation-icon="users"')
    expect(allMembersMarkup).toContain('<circle cx="9" cy="7" r="4"')
    expect(allMembersMarkup).not.toContain('>@</span>')
  })

  it('uses the catalog-backed team role as the member candidate description', () => {
    expect(structuredMentionMemberDescription(members[0])).toBe('默认队长')
    expect(structuredMentionMemberDescription(members[1])).toBe('团队角色未设置')
  })

  it('filters Skills by name and description and keeps all options for an empty query', () => {
    expect(structuredSkillOptions(skills, 'agent')).toEqual([skills[0]])
    expect(structuredSkillOptions(skills, '并行')).toEqual([skills[1]])
    expect(structuredSkillOptions(skills, '')).toEqual(skills)
  })

  it('uses a stable refresh failure state and English Skill menu labels', async () => {
    await changeInterfaceLanguage(preferences, 'en')
    const options = [{ ...skills[0], memberIds: ['agent_1'], sourceScope: 'project' as const }]
    const render = (refreshFailed: boolean) => renderToStaticMarkup(renderSkillMenu(
      'skill-menu', 'ready', options, members, ['provider unavailable'], refreshFailed,
      false, undefined, 0, () => undefined, () => undefined
    ))
    const failed = render(true)
    expect(failed).toContain('role="alert">Refresh failed. Current display shows previous candidates. Please retry.')
    expect(failed).not.toContain('Some sources are temporarily unavailable')
    expect(failed).toContain('aria-label="/analyze-agent-codebase, Project Skill, linked teammate: 新洛可"')
    expect(failed).not.toContain('，')
    const partial = render(false)
    expect(partial).toContain('Some sources are temporarily unavailable')
    expect(partial).not.toContain('Refresh failed.')
  })

  it('orders keyboard selection to match the Toolbox and Skills groups', () => {
    const native = { ...skills[0], source: 'native' as const }
    const toolbox = { ...skills[1], source: 'toolbox' as const }
    expect(structuredSkillOptions([native, toolbox], '')).toEqual([toolbox, native])
  })

  it('keeps the generic Enter handler limited to composition and line-break rules', () => {
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: false, isComposing: true
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: true, isComposing: false
    })).toBe(false)
    expect(shouldSubmitStructuredComposerOnEnter({
      key: 'Enter', shiftKey: false, isComposing: false
    })).toBe(true)
  })

  it('resolves Typeahead Enter synchronously from the current trigger catalog state', () => {
    expect(composerTypeaheadEnterAction({
      catalogStatus: 'ready', optionCount: 2
    })).toBe('select')
    expect(composerTypeaheadEnterAction({
      catalogStatus: 'loading', optionCount: 0
    })).toBe('consume')
    expect(composerTypeaheadEnterAction({
      catalogStatus: 'ready', optionCount: 0
    })).toBe('pass')
    expect(composerTypeaheadEnterAction({
      catalogStatus: 'error', optionCount: 0
    })).toBe('pass')
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
