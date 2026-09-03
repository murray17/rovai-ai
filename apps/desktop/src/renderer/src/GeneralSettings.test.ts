import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, GeneralPreferencesSnapshot } from '@contracts'
import {
  DEFAULT_MEMBER_COLLAPSE_THRESHOLD,
  GeneralSettings,
  ONE_CLICK_ENTRY_DESCRIPTIONS,
  ONE_CLICK_PROJECT_HELP,
  newConversationDefaultsDraftError
} from './GeneralSettings'

describe('General settings', () => {
  it('renders the complete General information architecture and native control semantics', () => {
    const markup = renderToStaticMarkup(createElement(GeneralSettings, {}))
    expect(markup).toContain('Settings / General')
    expect(markup).toContain('<h1>通用</h1>')
    expect(markup).not.toContain('登录时启动 Rovai AI')
    expect(markup).not.toContain('登录项服务')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('<legend>启动后打开</legend>')
    expect(markup).toContain('type="radio"')
    expect(markup).toContain('上次使用的位置')
    expect(markup).toContain('快速对话')
    expect(markup).not.toContain('已有会话、草稿、任务、审批和运行记录')
    expect(markup).toContain('<h2 id="general-new-conversation-heading">新对话</h2>')
    expect(markup).toContain('保存默认配置')
    expect(markup).toContain('一键创建新对话')
    expect(markup).toContain('class="general-help-mark"')
    expect(markup).toContain('role="tooltip"')
    expect(markup).not.toContain('general-help-button')
    expect(markup).toContain('使用入口对应的项目')
    expect(markup).toContain('请先保存默认队员与默认队长')
    expect(markup).toContain('<h2 id="general-conversation-heading">会话</h2>')
    expect(markup).not.toMatch(/aria-label="启用世界地图"[^>]*checked=""/)
    expect(markup).not.toContain('默认开启')
    expect(markup.indexOf('general-new-conversation-heading'))
      .toBeLessThan(markup.indexOf('general-conversation-heading'))
    expect(markup.indexOf('general-conversation-heading'))
      .toBeLessThan(markup.indexOf('general-window-heading'))
    expect(markup).toContain('重置窗口大小与位置')
    expect(markup).not.toContain('记住窗口位置')
    expect(markup).not.toContain('隐藏启动')
  })

  it('describes every one-click entry and its project selection rule', () => {
    expect(ONE_CLICK_ENTRY_DESCRIPTIONS).toEqual([
      '左上角“新对话”',
      '已有项目文件夹后的 ＋',
      '快速对话文件夹后的 ＋',
      '“项目”标题后的 ＋，选择工作目录后直接创建'
    ])
    expect(ONE_CLICK_PROJECT_HELP).toContain('左上角“新对话”使用当前选中的项目')
    expect(ONE_CLICK_PROJECT_HELP).toContain('已有项目文件夹后的 ＋ 使用对应项目')
    expect(ONE_CLICK_PROJECT_HELP).toContain('快速对话文件夹后的 ＋ 使用快速对话')
    expect(ONE_CLICK_PROJECT_HELP).toContain('“项目”标题后的 ＋ 使用新选择的工作目录')
  })

  it('shows the active one-click configuration without treating runtime readiness as invalid', () => {
    const agents = [profile('agent-a', '洛可'), profile('agent-b', '沐瓦')]
    agents[1].runtimeReadiness.status = 'needs_attention'
    const preferences: GeneralPreferencesSnapshot = {
      schemaVersion: 4,
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      executionConsolePlacement: 'bottom',
      newConversationDefaults: {
        memberAgentIds: ['agent-a', 'agent-b'],
        defaultLeadAgentId: 'agent-a'
      },
      newConversationDefaultsRequireConfirmation: false,
      oneClickNewConversationEnabled: true,
      worldMapEnabled: true
    }
    const markup = renderToStaticMarkup(createElement(GeneralSettings, {
      agents,
      initialPreferences: preferences,
      currentProjectLabel: 'rovai-ai'
    }))
    expect(markup).toContain('当前生效：rovai-ai · 2 位默认队员 · 队长 洛可')
    expect(markup).toContain('aria-label="一键创建新对话" checked=""')
    expect(markup).toMatch(/aria-label="启用世界地图"[^>]*checked=""/)
    expect(markup).not.toContain('默认队员配置需要重新确认')
  })

  it('requires an explicit valid member and Lead selection before defaults can be saved', () => {
    const agents = [profile('agent-a', '洛可'), profile('agent-b', '沐瓦', 'away')]
    expect(newConversationDefaultsDraftError({
      memberAgentIds: [],
      defaultLeadAgentId: ''
    }, agents)).toContain('至少选择')
    expect(newConversationDefaultsDraftError({
      memberAgentIds: ['agent-a'],
      defaultLeadAgentId: 'agent-b'
    }, agents)).toContain('必须属于')
    expect(newConversationDefaultsDraftError({
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-a'
    }, agents)).toContain('失效队员')
    expect(newConversationDefaultsDraftError({
      memberAgentIds: ['agent-a'],
      defaultLeadAgentId: 'agent-a'
    }, agents)).toBeNull()
  })

  it('shows up to ten members directly and collapses only when the count exceeds ten', () => {
    const directMembers = Array.from({ length: DEFAULT_MEMBER_COLLAPSE_THRESHOLD }, (_, index) => (
      profile(`agent-${index}`, `队员 ${index + 1}`)
    ))
    const collapsedMembers = [
      ...directMembers,
      profile(`agent-${DEFAULT_MEMBER_COLLAPSE_THRESHOLD}`, `队员 ${DEFAULT_MEMBER_COLLAPSE_THRESHOLD + 1}`)
    ]

    const directMarkup = renderToStaticMarkup(createElement(GeneralSettings, { agents: directMembers }))
    const collapsedMarkup = renderToStaticMarkup(createElement(GeneralSettings, { agents: collapsedMembers }))

    expect(directMarkup).not.toContain('class="general-default-member-picker"')
    expect(directMarkup).not.toContain('aria-label="搜索默认队员"')
    expect(collapsedMarkup).toContain('class="general-default-member-picker"')
    expect(collapsedMarkup).toContain('共 11 位队员，展开后可多选')
    expect(collapsedMarkup).toContain('aria-label="搜索默认队员"')
  })
})

function profile(
  agentId: string,
  displayName: string,
  presence: AgentProfile['presence'] = 'present'
): AgentProfile {
  return {
    agentId,
    displayName,
    avatarRef: null,
    accent: null,
    teamRole: '队员',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence,
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: agentId === 'agent-a' ? 0 : 1,
    version: 1,
    createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
    removedAt: presence === 'removed' ? '2026-08-09T00:00:00Z' : null
  }
}
