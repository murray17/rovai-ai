import { languageTestApi } from './interface-language-test-api'
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
  structuredSkillOptions,
  type StructuredMentionMember
} from './StructuredMentionComposer'
import { composerTypeaheadEnterAction } from './ComposerTypeaheadPlugin'
import { RovaiComposerExtension } from './RovaiComposerExtension'
import type { ComposerSkillOption } from './composer-skill-picker'
import type { AdapterKind, GeneralPreferencesApi, InterfaceLanguage } from '@contracts'
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

const memberIds = (catalog: StructuredMentionMember[], query: string, inviteLayer = false): string[] =>
  structuredMentionOptions(catalog, query, inviteLayer)
    .flatMap(option => option.kind === 'member' ? [option.member.agentId] : [])

describe('member lookup by intelligent agent and relevance', () => {
  it.each<[AdapterKind, string[]]>([
    ['codex-cli', ['codex', 'codexcli']],
    ['claude-code-cli', ['claude', 'claudecode']],
    ['copilot-cli', ['copilot', 'githubcopilot']],
    ['opencode-cli', ['opencode']], ['kiro-cli', ['kiro']],
    ['qoder-cli', ['qoder']], ['codebuddy-cli', ['codebuddy']],
    ['qwen-code', ['qwen', 'qwencode']], ['trae-cn-cli', ['trae', 'traecli']],
    ['kimi-code-cli', ['kimi', 'kimicode']], ['minimax-code-cli', ['minimax', 'minimaxcode']],
    ['hermes-cli', ['hermes', 'hermesagent']], ['grok-build', ['grok', 'grokbuild']],
    ['deepseek-harness', ['deepseek', 'deepseekharness', 'dsh']],
    ['command-code-cli', ['command', 'commandcode']],
    ['zcode-app', ['zcode']], ['antigravity-app', ['antigravity']], ['pi', ['pi']]
  ])('finds %s members by the approved product names and aliases', (runtimeKind, queries) => {
    const catalog = [{ ...members[0], runtimeKind }, members[1]]
    for (const query of queries) expect(memberIds(catalog, query)).toEqual(['agent_1'])
  })

  it('normalizes product names and aliases without searching arbitrary substrings or models', () => {
    const catalog: StructuredMentionMember[] = [
      { ...members[0], runtimeKind: 'command-code-cli' },
      { ...members[1], runtimeKind: 'claude-code-cli' },
      { agentId: 'open', displayName: '队员甲', teamRole: '', runtimeKind: 'opencode-cli',
        runtimeLabel: 'Claude Code', modelLabel: 'Claude Sonnet' }
    ]
    expect(memberIds(catalog, 'com')).toEqual(['agent_1'])
    expect(memberIds(catalog, 'COMMAND-CODE')).toEqual(['agent_1'])
    expect(memberIds(catalog, 'command_code')).toEqual(['agent_1'])
    expect(memberIds(catalog, 'ｃｌａｕｄｅ')).toEqual(['agent_2'])
    expect(memberIds(catalog, 'Claude-Code')).toEqual(['agent_2'])
    expect(memberIds(catalog, 'claude_code')).toEqual(['agent_2'])
    expect(memberIds(catalog, 'cmd')).toEqual([])
    expect(memberIds(catalog, 'code')).toEqual([])
    expect(memberIds(catalog, 'sonnet')).toEqual([])
    expect(memberIds(catalog, '---')).toEqual([])
    expect(memberIds(catalog, 'opencode')).toEqual(['open'])
  })

  it('puts exact and leading pinyin names before PI, then fuzzy names and roles', () => {
    const catalog: StructuredMentionMember[] = [
      { agentId: 'role', displayName: '队员甲', teamRole: 'PI 专家' },
      { agentId: 'fuzzy', displayName: 'Capri', teamRole: '' },
      { agentId: 'runtime-a', displayName: '队员乙', teamRole: '', runtimeKind: 'pi' },
      { agentId: 'runtime-b', displayName: '队员丙', teamRole: '', runtimeKind: 'pi' },
      { agentId: 'pinyin-prefix', displayName: '皮皮', teamRole: '', runtimeKind: 'pi' },
      { agentId: 'name-exact', displayName: 'PI', teamRole: '' }
    ]
    expect(memberIds(catalog, 'pi')).toEqual([
      'name-exact', 'pinyin-prefix', 'runtime-a', 'runtime-b', 'fuzzy', 'role'
    ])
    expect(memberIds(catalog, 'pipi')).toEqual(['pinyin-prefix'])
    expect(memberIds(catalog, 'pp')).toEqual(['pinyin-prefix'])
  })

  it('ranks all Runtime prefixes before fuzzy names while keeping catalog order for ties', () => {
    const catalog: StructuredMentionMember[] = [
      { agentId: 'role', displayName: '队员甲', teamRole: 'co' },
      { agentId: 'fuzzy', displayName: 'Draco', teamRole: '' },
      ...(['codex-cli', 'copilot-cli', 'codebuddy-cli', 'command-code-cli'] as const)
        .map((runtimeKind, index) => ({ ...members[0], agentId: `runtime-${index}`, runtimeKind }))
    ]
    expect(memberIds(catalog, 'co')).toEqual(['runtime-0', 'runtime-1', 'runtime-2', 'runtime-3', 'fuzzy', 'role'])
  })

  it('keeps Thread membership ahead of relevance and filters unavailable members in both layers', () => {
    const catalog: StructuredMentionMember[] = [
      { agentId: 'outside-exact', displayName: 'PI', teamRole: '', inThread: false },
      { agentId: 'outside-prefix', displayName: '皮皮', teamRole: '', inThread: false },
      { agentId: 'hidden', displayName: 'PI', teamRole: '', runtimeKind: 'pi', mentionable: false },
      { agentId: 'inside', displayName: '队员甲', teamRole: '', runtimeKind: 'pi' },
      { agentId: 'outside-runtime', displayName: '队员乙', teamRole: '', runtimeKind: 'pi', inThread: false }
    ]
    expect(memberIds(catalog, 'pi')).toEqual(['inside', 'outside-exact', 'outside-prefix', 'outside-runtime'])
    expect(memberIds(catalog, 'pi', true)).toEqual(['outside-exact', 'outside-prefix', 'outside-runtime'])
    expect(structuredMentionOptions(catalog, 'pi', false, false))
      .toEqual(structuredMentionOptions(catalog, 'pi'))
  })

  it('deduplicates by identity after membership and relevance, retaining distinct same-name members', () => {
    const inside = { ...members[0], displayName: '皮皮', runtimeKind: 'pi' as const }
    const catalog = [
      { ...inside, inThread: false }, inside, inside,
      { ...inside, agentId: 'same-name' }
    ]
    expect(memberIds(catalog, 'pi')).toEqual(['agent_1', 'same-name'])
    expect(structuredMentionOptions(catalog, 'pi')[0]).toEqual({ kind: 'member', member: inside })
  })

  it('sorts before truncation and preserves the invitation quota for Runtime searches', () => {
    const catalog: StructuredMentionMember[] = [
      ...Array.from({ length: 55 }, (_, i) => ({
        agentId: `in-${i}`, displayName: '队员甲', teamRole: '', runtimeKind: 'pi' as const
      })),
      { agentId: 'name', displayName: '皮皮', teamRole: '' },
      ...Array.from({ length: 55 }, (_, i) => ({
        agentId: `out-${i}`, displayName: '队员乙', teamRole: '', runtimeKind: 'pi' as const, inThread: false
      }))
    ]
    const result = memberIds(catalog, 'pi')
    expect(result).toHaveLength(50)
    expect(result.slice(0, 40)).toEqual(['name', ...catalog.slice(0, 39).map(member => member.agentId)])
    expect(result.slice(40)).toEqual(Array.from({ length: 10 }, (_, i) => `out-${i}`))
    expect(memberIds(catalog, 'pi', true)).toHaveLength(49)
  })
})

describe('StructuredMentionComposer V2', () => {
  const preferences = languageTestApi

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
    expect(structuredMentionOptions(catalog, '', false, false).map(option => option.kind)).toEqual([
      'member', 'member', 'invite_other'
    ])
    expect(structuredMentionOptions(catalog, '所有', false, false)).toEqual([])
    const fullThread = Array.from({ length: 60 }, (_, index) => ({
      ...members[0], agentId: `camp-${index}`
    }))
    expect(structuredMentionOptions([...fullThread, outsider], '').at(-1)).toEqual({ kind: 'invite_other' })
    expect(structuredMentionOptions([...fullThread, outsider], '')).toHaveLength(50)
  })

  it('matches names and roles separately and retains same-name and same-sound identities', () => {
    const catalog = [
      { agentId: 'a', displayName: '爱丽丝', teamRole: '实现者' },
      { agentId: 'b', displayName: '爱丽丝', teamRole: '核对者' },
      { agentId: 'c', displayName: '艾丽丝', teamRole: 'UI 设计师' }
    ]
    expect(structuredMentionOptions(catalog, 'aili').map(option => option.kind === 'member' && option.member.agentId))
      .toEqual(['a', 'b', 'c'])
    expect(structuredMentionOptions(catalog, 'uisj')).toEqual([{ kind: 'member', member: catalog[2] }])
    expect(structuredMentionOptions([{ agentId: 'd', displayName: '张', teamRole: '设计师' }], 'zhangshe')).toEqual([])
  })

  it('keeps pinyin qualification, priority, invitation limits and mission rules', () => {
    const member = { displayName: '爱丽丝', teamRole: '实现者' }
    const inside = Array.from({ length: 55 }, (_, i) => ({ ...member, agentId: 'in-' + i, inThread: true }))
    const outside = Array.from({ length: 55 }, (_, i) => ({ ...member, agentId: 'out-' + i, inThread: false }))
    const catalog = [{ ...member, agentId: 'hidden', mentionable: false }, ...outside, ...inside]
    const result = structuredMentionOptions(catalog, 'aili')
    expect(result).toEqual([
      ...inside.slice(0, 40).map(member => ({ kind: 'member', member })),
      ...outside.slice(0, 10).map(member => ({ kind: 'member', member }))
    ])
    expect(structuredMentionOptions(catalog, 'aili', true)).toEqual([
      { kind: 'back_to_camp' }, ...outside.slice(0, 49).map(member => ({ kind: 'member', member }))
    ])
    expect(structuredMentionOptions(catalog, 'aili', false, false)).toEqual(result)
    expect(structuredMentionOptions(catalog, '', false, false).some(option => option.kind === 'all_members')).toBe(false)
  })

  it('keeps Skill name and description search literal', () => {
    const skill = { ...skills[0], name: '审查', description: '设计核对' }
    expect(structuredSkillOptions([skill], 'shencha')).toEqual([])
    expect(structuredSkillOptions([skill], 'sheji')).toEqual([])
    expect(structuredSkillOptions([skill], '审查')).toEqual([skill])
    expect(structuredSkillOptions([skill], '设计')).toEqual([skill])
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
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('Refresh failed. Showing previous results.')
    expect(failed).not.toContain('Some sources are temporarily unavailable')
    expect(failed).toContain('aria-label="/analyze-agent-codebase, Project Skill, linked teammate: 新洛可"')
    expect(failed).not.toContain('，')
    const partial = render(false)
    expect(partial).toContain('Source diagnostics')
    expect(partial).toContain('provider unavailable')
    expect(partial).toContain('View details')
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
