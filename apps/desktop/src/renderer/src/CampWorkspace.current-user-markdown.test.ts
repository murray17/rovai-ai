import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  CampMessageView,
  CampSnapshot,
  StructuredCampMessageContent
} from '@contracts'
import {
  CampWorkspace,
  projectLeadingCurrentUserMentionMarkdownBody
} from './CampWorkspace'

const members: CampSnapshot['members'] = [{
  agentId: 'agent_author',
  displayName: '洛可',
  teamRole: 'Lead',
  avatarRef: null,
  accent: '#526f88',
  membershipStatus: 'active',
  leaveRequestedAt: null,
  profilePresence: 'present',
  memberOrder: 0,
  isDefaultLead: true,
  version: 1
}, {
  agentId: 'agent_reviewer',
  displayName: '沐瓦',
  teamRole: '评审',
  avatarRef: null,
  accent: '#7897ae',
  membershipStatus: 'active',
  leaveRequestedAt: null,
  profilePresence: 'present',
  memberOrder: 1,
  isDefaultLead: false,
  version: 1
}]

function renderAgentMessage(
  content: StructuredCampMessageContent,
  body = 'NON_AUTHORITATIVE_BODY_CACHE'
): string {
  const message: CampMessageView = {
    id: 'message-current-user-markdown',
    sequence: 1,
    timelineGlobalSequence: 1,
    authorType: 'agent',
    authorId: 'agent_author',
    sourceAgentRunId: null,
    body,
    content,
    attachments: [],
    addressMode: 'default',
    addressedAgentIds: [],
    replyToCampMessageId: null,
    campTurnId: null,
    presentation: null,
    createdAt: '2026-08-13T00:00:00Z'
  }
  const snapshot: CampSnapshot = {
    schemaVersion: 34,
    throughGlobalSequence: 1,
    camp: {
      id: 'camp-current-user-markdown',
      title: 'Current User Markdown',
      activationState: 'active',
      projectBindingKind: 'quick_chat',
      projectPath: '/quick-chat',
      defaultLeadAgentId: 'agent_author',
      membershipGeneration: 1,
      version: 1,
      createdAt: '2026-08-13T00:00:00Z',
      updatedAt: '2026-08-13T00:00:00Z'
    },
    members,
    membershipReconciliations: [],
    tasks: [],
    messages: [message],
    messageDeliveries: [],
    turns: [],
    agentRuns: [],
    executionEvidence: [],
    agentRunFileChanges: [],
    contextManifests: [],
    approvals: [],
    actions: [],
    timeline: []
  }

  return renderToStaticMarkup(createElement(CampWorkspace, {
    snapshot,
    projectName: null,
    agents: [],
    busy: false,
    onSend: async () => undefined,
    onChangeLead: async () => undefined,
    onTasksChanged: async () => undefined,
    onResolveApproval: () => undefined,
    stopping: false,
    onStop: () => undefined,
    inspectorVisible: false
  }))
}

describe('Agent Current User Mention Markdown rendering', () => {
  it('projects the authoritative remainder while preserving Member and all-members text', () => {
    expect(projectLeadingCurrentUserMentionMarkdownBody([{
      kind: 'current_user_mention',
      userId: 'local_user'
    }, {
      kind: 'text',
      text: '请 '
    }, {
      kind: 'member_mention',
      agentId: 'agent_reviewer'
    }, {
      kind: 'text',
      text: ' 与 '
    }, {
      kind: 'all_members_mention'
    }], members)).toBe('请 @沐瓦 与 @所有队员')

    expect(projectLeadingCurrentUserMentionMarkdownBody([{
      kind: 'current_user_mention',
      userId: 'local_user'
    }], members)).toBe('')
  })

  it('escapes structured mention labels before Markdown parsing', () => {
    const hostileMembers = [{
      ...members[1],
      displayName: '[评审](https://example.com/phish)\n## 标题'
    }]
    expect(projectLeadingCurrentUserMentionMarkdownBody([{
      kind: 'current_user_mention',
      userId: 'local_user'
    }, {
      kind: 'text',
      text: '请 '
    }, {
      kind: 'member_mention',
      agentId: 'agent_reviewer'
    }], hostileMembers)).toBe(
      '请 @\\[评审\\]\\(https://example\\.com/phish\\) \\#\\# 标题'
    )
  })

  it('renders a non-interactive prefix plus sanitized GFM from Structured Content', () => {
    const content: StructuredCampMessageContent = [{
      kind: 'current_user_mention',
      userId: 'local_user'
    }, {
      kind: 'text',
      text: [
        '## 请确认',
        '',
        '- 方案 A：保留兼容层',
        '- `方案 B`：查看 [迁移说明](https://example.com/migration)',
        '',
        '```sh',
        'pnpm test',
        '```',
        '',
        '| 项目 | 结果 |',
        '| --- | --- |',
        '| Renderer | PASS |',
        '',
        '<script>alert("unsafe")</script>',
        '',
        '请 '
      ].join('\n')
    }, {
      kind: 'member_mention',
      agentId: 'agent_reviewer'
    }, {
      kind: 'text',
      text: ' 与 '
    }, {
      kind: 'all_members_mention'
    }, {
      kind: 'text',
      text: ' 审阅。'
    }]

    const markup = renderAgentMessage(content)
    const token = markup.match(
      /<span class="message-mention-token current-user"[^>]*>@你<\/span>/
    )?.[0]

    expect(token).toBeDefined()
    expect(token).toContain('aria-label="提及当前用户：你"')
    expect(token).not.toContain('role=')
    expect(token).not.toContain('tabindex=')
    expect(token).not.toContain('aria-haspopup=')
    expect(markup.indexOf(token!)).toBeLessThan(markup.indexOf('<h3>请确认</h3>'))
    expect(markup).toContain('current-user-mention-prefix')
    expect(markup).toContain('current-user-markdown-content')
    expect(markup).toContain('<h3>请确认</h3>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<code>方案 B</code>')
    expect(markup).toContain(
      '<a href="https://example.com/migration" target="_blank" rel="noreferrer noopener">迁移说明</a>'
    )
    expect(markup).toContain('<pre><code class="language-sh">pnpm test')
    expect(markup).toContain('<table>')
    expect(markup).toContain('请 @沐瓦 与 @所有队员 审阅。')
    expect(markup).not.toContain('NON_AUTHORITATIVE_BODY_CACHE')
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('alert(&quot;unsafe&quot;)')
    expect(markup).not.toContain('alert("unsafe")')
  })

  it('keeps non-leading or repeated Current User segments on the safe plain-text fallback', () => {
    const nonLeading: StructuredCampMessageContent = [{
      kind: 'text',
      text: '## 不应解析为标题 <script>alert("unsafe")</script> '
    }, {
      kind: 'current_user_mention',
      userId: 'local_user'
    }]
    const repeated: StructuredCampMessageContent = [{
      kind: 'current_user_mention',
      userId: 'local_user'
    }, {
      kind: 'text',
      text: '正文'
    }, {
      kind: 'current_user_mention',
      userId: 'local_user'
    }]

    expect(projectLeadingCurrentUserMentionMarkdownBody(nonLeading, members)).toBeNull()
    expect(projectLeadingCurrentUserMentionMarkdownBody(repeated, members)).toBeNull()

    const markup = renderAgentMessage(nonLeading, '<script>cache()</script>')
    expect(markup).toContain('## 不应解析为标题')
    expect(markup).not.toContain('<h3>不应解析为标题')
    expect(markup).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain('cache()')
  })
})
