import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type {
  AgentProfile,
  ChannelKind,
  ChannelsApi,
  ChannelSettingsSnapshot,
  ExecutionWebSettingsSnapshot
} from '@contracts'
import {
  ChannelSettings,
  ChannelSettingsView,
  ExecutionWebSettingsPanel,
  channelErrorMessage,
  executionWebStatus,
  visibleChannelMembers
} from './ChannelSettings'

describe('Channel settings', () => {
  it('keeps the single global LAN execution setting collapsed with an explicit SVG disclosure', () => {
    const panel = renderToStaticMarkup(createElement(ExecutionWebSettingsPanel))
    expect(panel).toContain('<details class="channel-settings-section execution-web-settings">')
    expect(panel).not.toContain('<details class="channel-settings-section execution-web-settings" open=""')
    expect(panel).toContain('局域网执行台')
    expect(panel).toContain('class="execution-web-disclosure"')
    expect(panel).toContain('<svg viewBox="0 0 20 20"')
    expect(panel).toContain('class="execution-web-status-dot"')
    expect(panel).not.toContain('⌄')
    expect(panel).toContain('role="switch"')
    expect(panel).toContain('min="1024" max="65535"')
    expect(panel).toContain('修改端口后，此前发送的执行台链接可能失效。')
  })

  it('explains that an enabled setting waits for a published Bot before opening the port', () => {
    const snapshot: ExecutionWebSettingsSnapshot = {
      schemaVersion: 1,
      enabled: true,
      port: 8765,
      server: {
        state: 'no_published_bot',
        address: null,
        errorCode: 'execution_web_no_published_bot'
      }
    }
    expect(executionWebStatus(snapshot)).toEqual({
      label: '等待 Bot 发布 · 8765',
      tone: 'neutral'
    })
  })

  it('exposes only the provider choice on the typed connection boundary', () => {
    expectTypeOf<ChannelsApi['connect']>().parameters.toEqualTypeOf<[kind?: ChannelKind]>()
  })

  it('keeps cancellation silent and distinguishes expired login from temporary connection failures', () => {
    expect(channelErrorMessage(new Error('dingtalk_operation_cancelled'))).toBeNull()
    expect(channelErrorMessage(new Error('dingtalk_developer_session_expired'))).toBe('登录已失效，请重新连接。')
    for (const code of ['dingtalk_open_platform_unavailable', 'dingtalk_open_platform_timeout', 'dingtalk_web_session_store_unavailable']) {
      expect(channelErrorMessage(new Error(code))).not.toMatch(/失效|重新连接/u)
    }
  })

  it.each(['Error', 'DingTalkConsoleError', 'DingTalkDeveloperApiError'])(
    'unwraps Electron %s failures without alerting on an exact cancellation', (name) => {
      const wrapped = (message: string): Error => new Error(
        `Error invoking remote method 'rovai:channels-connect': ${name}: ${message}`
      )
      expect(channelErrorMessage(wrapped('dingtalk_operation_cancelled'))).toBeNull()
      expect(channelErrorMessage(wrapped('dingtalk_open_platform_unavailable')))
        .toBe('暂时无法连接钉钉开放平台，请检查网络后重试。')
      expect(channelErrorMessage(wrapped('dingtalk_operation_cancelled_extra'))).not.toBeNull()
    }
  )

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

  it('shows the selected provider, real local roster, and owner-only management boundary', () => {
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('removed', 0, 'removed'), agent('agent-b', 2), agent('agent-a', 1)],
      snapshot: unavailableSnapshot()
    }))

    expect(markup).toContain('role="tablist" aria-label="渠道"')
    expect(markup).toContain('<strong>飞书</strong>')
    expect(markup).toContain('<strong>钉钉</strong>')
    expect(markup).toContain('<small>敬请期待</small>')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toMatch(/channel-provider-tab is-disabled[^>]*disabled=""/u)
    expect(markup).not.toContain('Telegram')
    expect(markup).toContain('只有 Rovai Owner 可以从外部渠道触发队员')
    expect(markup).toContain('飞书中的 Owner 消息仍是外部消息身份')
    expect(markup).toContain('项目绝对路径不会发送到外部渠道')
    expect(markup).not.toContain('已授权用户')
    expect(markup).not.toContain('allowlist')
    expect(markup.match(/class="channel-member-bot-grid channel-member-bot-row"/g)).toHaveLength(2)
    expect(markup.indexOf('队员 agent-a')).toBeLessThan(markup.indexOf('队员 agent-b'))
    expect(markup).toContain('0 已发布 · 2 未发布')
    expect(markup).toContain('发布后沿用队员身份')
    expect(markup).toContain('assets/channel-logos/feishu.svg')
    expect(markup).not.toContain('默认沿用队员名称与头像')
    expect(markup).toContain('disabled="" title="飞书渠道宿主尚未接入"')
    expect(markup).toContain('>等待连接</button>')
  })

  it('keeps DingTalk visible as a disabled coming-soon preview without exposing saved management facts', () => {
    const snapshot = unavailableSnapshot()
    snapshot.channels.push({
      kind: 'dingtalk',
      displayName: '钉钉',
      hostStatus: 'ready',
      connection: {
        status: 'connected',
        account: {
          accountId: 'dingtalk-account',
          userName: 'Murray',
          tenantName: '星海科技',
          brand: 'dingtalk',
          connectedAt: '2026-08-29T00:00:00Z',
          lastVerifiedAt: '2026-08-29T00:00:00Z'
        }
      },
      memberBots: [{
        agentId: 'agent-a',
        publicationStatus: 'published',
        botDisplayName: '芝士',
        appId: 'u-app-1',
        managementUrl: 'https://open-dev.dingtalk.com/fe/app#/corp/app?appId=u-app-1',
        failureCode: null
      }]
    })
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('agent-a', 0)],
      snapshot,
      selectedKind: 'dingtalk',
      onConnect: () => undefined
    }))

    expect(markup).toContain('<strong>飞书</strong>')
    expect(markup).toContain('<strong>钉钉</strong>')
    expect(markup).toMatch(/channel-mark-dingtalk[^>]*>\s*<img src=/u)
    expect(markup).toContain('1 个可用渠道')
    expect(markup.match(/role="tab"/gu)).toHaveLength(2)
    expect(markup).toContain('<small>敬请期待</small>')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toMatch(/channel-provider-tab is-disabled[^>]*disabled=""/u)
    expect(markup).toContain('飞书连接')
    expect(markup).not.toContain('钉钉连接')
    expect(markup).not.toContain('星海科技')
    expect(markup).not.toContain('芝士')
    expect(markup).not.toContain('u-app-1')
    expect(snapshot.channels).toHaveLength(2)
    expect(snapshot.channels[1].memberBots[0].appId).toBe('u-app-1')
    expect(markup).not.toMatch(/app secret|client secret|access token/i)
  })

  it.each(['not_connected', 'session_expired', 'connected'] as const)(
    'does not reopen DingTalk management from a legacy %s-only snapshot',
    (status) => {
      const snapshot = unavailableSnapshot()
      snapshot.channels = [{
        kind: 'dingtalk', displayName: '钉钉', hostStatus: 'ready',
        connection: { status, account: status === 'not_connected' ? null : {
          accountId: 'dingtalk-account', userName: 'Murray', tenantName: '星海科技',
          brand: 'dingtalk', connectedAt: '2026-08-30T00:00:00Z',
          lastVerifiedAt: '2026-08-30T00:00:00Z'
        } },
        memberBots: []
      }]
      const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
        agents: [], snapshot, selectedKind: 'dingtalk', onConnect: () => undefined
      }))

      expect(markup).toContain('当前版本没有可用的渠道')
      expect(markup).toContain('role="tab"')
      expect(markup).toContain('<strong>钉钉</strong>')
      expect(markup).toContain('<small>敬请期待</small>')
      expect(markup).toContain('aria-disabled="true"')
      expect(markup).not.toContain('钉钉连接')
      expect(markup).not.toContain('星海科技')
      expect(snapshot.channels[0].connection.status).toBe(status)
    }
  )

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
    expect(markup).not.toContain('会话接入')
    expect(markup).not.toContain('2 个待选择')
    expect(markup).not.toContain('待处理绑定')
    expect(markup).not.toContain('绑定异常')
    expect(markup).not.toContain('绑定完成后不可换绑')
    expect(markup).not.toContain('>管理</button>')
    expect(markup).not.toContain('停用 Bot')
    expect(markup).not.toContain('兼容扫码发布')
    expect(markup).not.toMatch(/app secret|cookie|csrf|token/i)
  })

  it('keeps project paths, binding diagnostics, and manual binding controls off the local settings surface', () => {
    const snapshot = unavailableSnapshot()
    snapshot.pendingBindingCount = 1
    const markup = renderToStaticMarkup(createElement(ChannelSettingsView, {
      agents: [agent('agent-a', 0)],
      snapshot
    }))

    expect(markup).not.toContain('会话接入')
    expect(markup).not.toContain('私聊自动进入 Quick Chat')
    expect(markup).not.toContain('1 个待选择')
    expect(markup).not.toContain('待处理绑定')
    expect(markup).not.toContain('绑定异常')
    expect(markup).not.toContain('项目绑定完成后不可换绑')
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
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-connect': Error: dingtalk_legacy_session_requires_reconnect"
    ))).toBe('钉钉已改用网页登录，请重新连接一次；已有 Bot 和应用绑定会保留。')
    expect(channelErrorMessage(new Error(
      "Error invoking remote method 'rovai:channels-publish-member-bot': Error: dingtalk_approval_mode_invalid"
    ))).toBe('钉钉开放平台操作尚未完成；请查看下方状态，排除问题后重试。')
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
