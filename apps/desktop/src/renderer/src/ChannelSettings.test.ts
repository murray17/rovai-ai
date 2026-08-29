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
    expect(markup).toContain('Owner 本机')
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
    expect(markup).toContain('只有 Rovai Owner 可以从飞书触发队员')
    expect(markup).toContain('飞书中的 Owner 消息仍是外部消息身份')
    expect(markup).toContain('项目绝对路径不会发送到飞书')
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
      schemaVersion: 4,
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
          managementUrl: 'https://open.feishu.cn/app/cli_agent_a/baseinfo',
          failureCode: null
        }, {
          agentId: 'agent-b',
          publicationStatus: 'disabled',
          botDisplayName: '资料员石墨',
          appId: 'cli_agent_b',
          managementUrl: 'https://open.feishu.cn/app/cli_agent_b/baseinfo',
          failureCode: null
        }]
      }],
      pendingBindingCount: 2,
      bindingIssueCount: 1,
      activeQrAttempt: null,
      activeProvisioning: null
    }
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('agent-a', 0), agent('agent-b', 1)],
      snapshot,
      onConnect: () => undefined,
      onDisconnect: () => undefined,
      onPublish: () => undefined
    }))

    expect(markup).toContain('Murray')
    expect(markup).toContain('星海科技')
    expect(markup).toContain('审阅员芝士')
    expect(markup).toContain('已发布')
    expect(markup).toContain('murray@example.com')
    expect(markup).toContain('>切换账号</button>')
    expect(markup).toContain('>断开</button>')
    expect(markup).toContain('href="https://open.feishu.cn/app/cli_agent_a/baseinfo"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noreferrer noopener"')
    expect(markup).toContain('>飞书管理</a>')
    expect(markup).toContain('>重新发布</button>')
    expect(markup).not.toContain('Owner 身份待核验')
    expect(markup).toContain('2 个待选择')
    expect(markup).toContain('绑定完成后不可换绑')
    expect(markup).not.toContain('>管理</button>')
    expect(markup).not.toContain('停用 Bot')
    expect(markup).not.toContain('兼容扫码发布')
    expect(markup).not.toMatch(/app secret|cookie|csrf|token/i)
  })

  it('keeps project paths and manual binding controls off the local settings surface', () => {
    const snapshot = unavailableSnapshot()
    snapshot.pendingBindingCount = 1
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('agent-a', 0)],
      snapshot
    }))

    expect(markup).toContain('私聊自动进入 Quick Chat')
    expect(markup).toContain('1 个待选择')
    expect(markup).not.toContain('/private/quick-chat')
    expect(markup).not.toContain('添加项目')
    expect(markup).not.toContain('绑定会话')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-retry-member-bot': Error: feishu_console_remote_app_unavailable"
    ))).toBe('原飞书应用已删除或当前账号无权访问，无法按原 App ID 重试。')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-retry-member-bot': Error: feishu_connection_error"
    ))).toBe('飞书连接异常，请稍后重试。')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-retry-member-bot': Error: feishu_console_event_verification_failed"
    ))).toBe('飞书事件与长连接配置尚未确认生效；原应用已保留，可以稍后继续核对。')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-publish-member-bot': Error: feishu_console_create_app_from_template_http_500"
    ))).toBe('飞书开放平台操作尚未完成；请查看下方状态，排除问题后重试。')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-connect': Error: feishu_login_cancelled"
    ))).toBeNull()
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
    schemaVersion: 4,
    channels: [{
      kind: 'feishu',
      displayName: '飞书',
      hostStatus: 'unavailable',
      connection: { status: 'not_connected', account: null },
      memberBots: []
    }],
    pendingBindingCount: 0,
    bindingIssueCount: 0,
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
