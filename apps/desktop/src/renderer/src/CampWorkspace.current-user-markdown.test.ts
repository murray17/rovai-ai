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

function renderMessage(
  content: StructuredCampMessageContent,
  body = 'NON_AUTHORITATIVE_BODY_CACHE',
  authorType: 'agent' | 'user' = 'agent',
  campMembers = members
): string {
  const message: CampMessageView = {
    id: 'message-current-user-markdown',
    sequence: 1,
    timelineGlobalSequence: 1,
    authorType,
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
    members: campMembers,
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

    const markup = renderMessage(content)
    const token = markup.match(
      /<span class="message-mention-token current-user"[^>]*>@你<\/span>/
    )?.[0]

    expect(token).toBeDefined()
    expect(token).toContain('aria-label="提及当前用户：你"')
    expect(token).not.toContain('role=')
    expect(token).not.toContain('tabindex=')
    expect(token).not.toContain('aria-haspopup=')
    expect(markup.indexOf(token!)).toBeLessThan(markup.indexOf('data-markdown-heading="请确认"'))
    expect(markup).toContain('current-user-mention-prefix')
    expect(markup).toContain('current-user-markdown-content')
    expect(markup).toContain('<h3 data-markdown-heading="请确认">请确认</h3>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<code>方案 B</code>')
    expect(markup).toContain('<a class="markdown-web-reference" href="https://example.com/migration"')
    expect(markup).toContain('<span class="resource-reference-label">迁移说明</span>')
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

    const markup = renderMessage(nonLeading, '<script>cache()</script>')
    expect(markup).toContain('## 不应解析为标题')
    expect(markup).not.toContain('<h3>不应解析为标题')
    expect(markup).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain('cache()')
  })

  it('projects file labels in user messages without flattening Member and Skill identities', () => {
    const content: StructuredCampMessageContent = [{
      kind: 'member_mention',
      agentId: 'agent_reviewer'
    }, {
      kind: 'text',
      text: ' 请查看 [v1.30 方案](docs/versions/v1.30/README.md) 和 `src/app.ts:20`，再用 '
    }, {
      kind: 'skill_mention',
      skillId: 'skill-review',
      nameAtSend: 'review'
    }]
    const markup = renderMessage(content, 'NON_AUTHORITATIVE_BODY_CACHE', 'user')
    expect(markup).toContain('data-agent-id="agent_reviewer"')
    expect(markup).toContain('aria-label="查看沐瓦的基础信息"')
    expect(markup).toContain('class="message-mention-token skill-mention"')
    expect(markup).toContain('aria-label="Skill /review"')
    expect(markup).toContain('title="docs/versions/v1.30/README.md"')
    expect(markup).toContain('<span class="file-reference-label">v1.30 方案</span>')
    expect(markup).toContain('<code>src/app.ts:20</code>')
    expect(markup).not.toContain('<span class="file-reference-label is-code">src/app.ts:20</span>')
    expect(markup.replace(/<[^>]*>/gu, '')).not.toContain('docs/versions/v1.30/README.md')
    expect(markup).not.toContain('NON_AUTHORITATIVE_BODY_CACHE')
    expect(content[1]).toEqual({ kind: 'text', text: ' 请查看 [v1.30 方案](docs/versions/v1.30/README.md) 和 `src/app.ts:20`，再用 ' })
  })

  it('uses the same label projection for plain user bodies and leading Current User Markdown', () => {
    const source = '[方案](docs/plan.md)'
    const user = renderMessage([{ kind: 'text', text: source }], source, 'user')
    const currentUser = renderMessage([
      { kind: 'current_user_mention', userId: 'local_user' },
      { kind: 'text', text: source }
    ])
    for (const markup of [user, currentUser]) {
      expect(markup).toContain('title="docs/plan.md"')
      expect(markup).toContain('<span class="file-reference-label">方案</span>')
      expect(markup.replace(/<[^>]*>/gu, '')).not.toContain('docs/plan.md')
    }
    expect(currentUser).toContain('message-mention-token current-user')
  })
})

describe('Agent leading Member Mention Markdown rendering', () => {
  it('renders the structured recipient as an interactive prefix without losing GFM', () => {
    const markup = renderMessage([
      { kind: 'member_mention', agentId: 'agent_reviewer' },
      { kind: 'text', text: [
        ' review 结论：**通过**。',
        '',
        '## 事实复核',
        '',
        '- 保留列表和 `行内代码`',
        '- [验收说明](docs/plan.md)',
        '',
        '```sh',
        'pnpm test',
        '```',
        '',
        '| 项目 | 结果 |',
        '| --- | --- |',
        '| Mention | PASS |',
        '',
        '<script>alert("unsafe")</script>'
      ].join('\n') }
    ])
    const token = markup.match(/<span class="message-mention-token[^\"]*" data-agent-id="agent_reviewer"[^>]*>/)?.[0]
    expect(token).toBeDefined()
    expect(token).toContain('is-interactive')
    expect(token).toContain('role="button"')
    expect(token).toContain('tabindex="0"')
    expect(token).toContain('aria-label="查看沐瓦的基础信息"')
    expect(token).toContain('aria-haspopup="dialog"')
    expect(markup).toContain('member-mention-markdown-body')
    expect(markup).toContain('data-inline-body="true"')
    expect(markup).toContain('<strong>通过</strong>')
    expect(markup).toContain('<h3 data-markdown-heading="事实复核">事实复核</h3>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<code>行内代码</code>')
    expect(markup).toContain('title="docs/plan.md"')
    expect(markup).toContain('<span class="file-reference-label">验收说明</span>')
    expect(markup).toContain('<pre><code class="language-sh">pnpm test')
    expect(markup).toContain('<table>')
    expect(markup).not.toContain('NON_AUTHORITATIVE_BODY_CACHE')
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('alert(&quot;unsafe&quot;)')
  })

  it('preserves multiple leading recipients and does not mutate authoritative content', () => {
    const content: StructuredCampMessageContent = [
      { kind: 'text', text: ' ' },
      { kind: 'member_mention', agentId: 'agent_reviewer' },
      { kind: 'text', text: ' ' },
      { kind: 'member_mention', agentId: 'agent_author' },
      { kind: 'text', text: ' 请一起 **复核**。' }
    ]
    const before = JSON.stringify(content)
    const markup = renderMessage(content)
    expect(markup).toContain('class="message-mention-token is-interactive" data-agent-id="agent_reviewer"')
    expect(markup).toContain('class="message-mention-token is-interactive" data-agent-id="agent_author"')
    expect(markup).toContain('<strong>复核</strong>')
    expect(JSON.stringify(content)).toBe(before)
  })

  it('does not turn a literal at-name in an Agent body into an identity', () => {
    const body = '@沐瓦 review 结论：**通过**。'
    const markup = renderMessage([{ kind: 'text', text: body }], body)
    expect(markup).toContain('@沐瓦 review 结论：<strong>通过</strong>。')
    expect(markup).not.toContain('member-mention-markdown-body')
    expect(markup).not.toContain('class="message-mention-token')
  })

  it.each(['left', 'removed', 'missing'] as const)('keeps an unavailable %s recipient static', (state) => {
    const campMembers = state === 'missing' ? [members[0]] : [members[0], {
      ...members[1],
      ...(state === 'left' ? { membershipStatus: 'left' as const } : { profilePresence: 'removed' as const })
    }]
    const markup = renderMessage([
      { kind: 'member_mention', agentId: 'agent_reviewer' },
      { kind: 'text', text: ' **历史消息**' }
    ], 'NON_AUTHORITATIVE_BODY_CACHE', 'agent', campMembers)
    const token = markup.match(/<span class="message-mention-token[^\"]*" data-agent-id="agent_reviewer"[^>]*>/)?.[0]
    expect(token).toBeDefined()
    expect(token).toContain('is-unavailable')
    expect(token).not.toContain('is-interactive')
    expect(token).not.toContain('role=')
    expect(token).not.toContain('tabindex=')
    expect(markup).toContain(state === 'missing' ? '@不可用队员' : '@沐瓦')
    expect(markup).toContain('<strong>历史消息</strong>')
  })

  it('does not interpret a recipient name as Markdown or HTML', () => {
    const campMembers = [members[0], {
      ...members[1],
      displayName: '[评审](https://example.com/phish)<script>unsafe()</script>'
    }]
    const markup = renderMessage([
      { kind: 'member_mention', agentId: 'agent_reviewer' },
      { kind: 'text', text: ' **通过**' }
    ], 'NON_AUTHORITATIVE_BODY_CACHE', 'agent', campMembers)
    expect(markup).toContain('@[评审](https://example.com/phish)&lt;script&gt;unsafe()&lt;/script&gt;')
    expect(markup).not.toContain('href="https://example.com/phish"')
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('<strong>通过</strong>')
  })

  it('keeps a mention-only message visible and preserves the following paragraph boundary', () => {
    const mention: StructuredCampMessageContent[number] = { kind: 'member_mention', agentId: 'agent_reviewer' }
    const mentionOnly = renderMessage([mention])
    expect(mentionOnly).toContain('@沐瓦</span>')
    expect(mentionOnly).not.toContain('member-mention-markdown-content')
    const separated = renderMessage([mention, { kind: 'text', text: '\n\n另一段 **正文**。' }])
    expect(separated).toContain('data-inline-body="false"')
    expect(separated).toContain('<p>另一段 <strong>正文</strong>。</p>')
  })
})
