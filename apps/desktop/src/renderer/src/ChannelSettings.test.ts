import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, ChannelSettingsSnapshot } from '@contracts'
import {
  ChannelSettings,
  ChannelSettingsView,
  channelErrorMessage,
  visibleChannelMembers
} from './ChannelSettings'

describe('Channel settings', () => {
  it('renders the Rovai Settings header and an honest loading state before Main responds', () => {
    const markup = renderToStaticMarkup(createElement(ChannelSettings, {
      agents: [agent('agent-a', 0)]
    }))

    expect(markup).toContain('class="settings-page-heading"')
    expect(markup).toContain('<h1>渠道</h1>')
    expect(markup).toContain('正在读取渠道状态')
    expect(markup).toContain('主人本机')
    expect(markup).not.toContain('原型工具')
  })

  it('shows only Feishu, the real local roster, and the owner-only management boundary', () => {
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('removed', 0, 'removed'), agent('agent-b', 2), agent('agent-a', 1)],
      snapshot: unavailableSnapshot()
    }))

    expect(markup).toContain('role="tablist" aria-label="渠道"')
    expect(markup).toContain('<strong>飞书</strong>')
    expect(markup).not.toContain('钉钉')
    expect(markup).not.toContain('Telegram')
    expect(markup).toContain('项目路径、绑定、切换和 Bot 发布只能由主人在 Rovai 本机完成')
    expect(markup).toContain('飞书消息作者仅作为上下文来源和回复目标')
    expect(markup).not.toContain('已授权用户')
    expect(markup).not.toContain('allowlist')
    expect(markup.match(/class="channel-member-bot-grid channel-member-bot-row"/g)).toHaveLength(2)
    expect(markup.indexOf('队员 agent-a')).toBeLessThan(markup.indexOf('队员 agent-b'))
    expect(markup).toContain('0 已发布 · 2 未发布')
    expect(markup).toContain('名称沿用队员；应用图标由 Rovai 配置')
    expect(markup).not.toContain('默认沿用队员名称与头像')
    expect(markup).toContain('disabled="" title="飞书渠道宿主尚未接入"')
    expect(markup).toContain('>等待连接</button>')
  })

  it('renders connected account and published Bot facts without exposing credentials', () => {
    const snapshot: ChannelSettingsSnapshot = {
      schemaVersion: 3,
      channels: [{
        kind: 'feishu',
        displayName: '飞书',
        hostStatus: 'ready',
        connection: {
          status: 'connected',
          account: {
            accountId: 'account-1',
            userName: 'Murray',
            email: 'murray@example.com',
            tenantName: '星海科技',
            brand: 'feishu',
            connectedAt: '2026-08-27T00:00:00Z',
            lastVerifiedAt: '2026-08-27T00:00:00Z'
          }
        },
        memberBots: [{
          agentId: 'agent-a',
          publicationStatus: 'published',
          botDisplayName: '审阅员芝士',
          appId: 'cli_agent_a',
          failureCode: null
        }, {
          agentId: 'agent-b',
          publicationStatus: 'disabled',
          botDisplayName: '资料员石墨',
          appId: 'cli_agent_b',
          failureCode: null
        }]
      }],
      projectBindings: [],
      unboundConversations: [],
      conversationBindings: [],
      activeQrAttempt: null,
      activeProvisioning: null
    }
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('agent-a', 0), agent('agent-b', 1)],
      snapshot,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onPublish: () => undefined,
      onManage: () => undefined
    }))

    expect(markup).toContain('Murray')
    expect(markup).toContain('星海科技')
    expect(markup).toContain('审阅员芝士')
    expect(markup).toContain('已发布')
    expect(markup).toContain('murray@example.com')
    expect(markup).toContain('>切换账号</button>')
    expect(markup).toContain('>断开</button>')
    expect(markup).toContain('>管理</button>')
    expect(markup).toContain('>重新发布</button>')
    expect(markup).not.toMatch(/app secret|cookie|csrf|token/i)
  })

  it('prevents a duplicate Quick Chat binding and keeps the Core conflict user-facing', () => {
    const snapshot = unavailableSnapshot()
    snapshot.projectBindings = [{
      projectBindingId: 'binding-quick-chat',
      displayName: 'Quick Chat',
      bindingKind: 'quick_chat',
      canonicalPath: '/private/quick-chat',
      status: 'active',
      version: 1
    }]
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('agent-a', 0)],
      snapshot,
      onCreateBinding: () => undefined
    }))

    expect(markup).toContain('disabled="" title="Quick Chat 已登记"')
    expect(markup).toContain('>Quick Chat 已添加</button>')
    expect(markup).not.toContain('>添加 Quick Chat</button>')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-create-project-binding': Error: This canonical path already has a Project Binding"
    ))).toBe('这个项目已经登记，无需重复添加。')
  })

  it('keeps only present members in deterministic roster order', () => {
    expect(visibleChannelMembers([
      agent('later', 8),
      agent('removed', 0, 'removed'),
      agent('first', 1),
      agent('same-z', 4),
      agent('same-a', 4)
    ]).map((member) => member.agentId)).toEqual(['first', 'same-a', 'same-z', 'later'])
  })
})

function unavailableSnapshot(): ChannelSettingsSnapshot {
  return {
    schemaVersion: 3,
    channels: [{
      kind: 'feishu',
      displayName: '飞书',
      hostStatus: 'unavailable',
      connection: { status: 'not_connected', account: null },
      memberBots: []
    }],
    projectBindings: [],
    unboundConversations: [],
    conversationBindings: [],
    activeQrAttempt: null,
    activeProvisioning: null
  }
}

function agent(
  agentId: string,
  memberOrder: number,
  presence: AgentProfile['presence'] = 'present'
): AgentProfile {
  return {
    agentId,
    displayName: `队员 ${agentId}`,
    avatarRef: null,
    accent: null,
    teamRole: '协作者',
    professionalResponsibilities: '',
    personalityTraits: [],
    workingPrinciples: '',
    growthTopic: '',
    defaultCapabilities: [],
    presence,
    runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder,
    version: 1,
    createdAt: '2026-08-27T00:00:00Z',
    updatedAt: '2026-08-27T00:00:00Z',
    removedAt: presence === 'removed' ? '2026-08-27T01:00:00Z' : null
  }
}
