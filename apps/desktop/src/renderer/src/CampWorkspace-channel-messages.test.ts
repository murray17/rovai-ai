import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CampMessageView, CampSnapshot, StructuredCampMessageContent } from '@contracts'
import { CampWorkspace } from './CampWorkspace'
import { createStructuredMessageClipboardData } from './structured-message-clipboard'

const createdAt = '2026-08-30T04:00:00Z'
type ExternalQuote = Extract<StructuredCampMessageContent[number], { kind: 'external_quote' }>

function message(overrides: Partial<CampMessageView> = {}): CampMessageView {
  return {
    id: 'message-owner',
    sequence: 1,
    timelineGlobalSequence: 1,
    authorType: 'user',
    authorId: 'local_user',
    sourceAgentRunId: null,
    body: '请继续检查。',
    content: [{ kind: 'text', text: '请继续检查。' }],
    attachments: [],
    addressMode: 'default',
    addressedAgentIds: [],
    replyToCampMessageId: null,
    campTurnId: null,
    presentation: null,
    createdAt,
    ...overrides
  }
}

function quote(overrides: Partial<ExternalQuote> = {}): ExternalQuote {
  return {
    kind: 'external_quote',
    senderDisplayName: '芝士',
    body: '先检查登录模块。\n再检查退出流程。',
    attachmentSummaries: [],
    contentDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides
  }
}

function renderMessages(messages: CampMessageView[]): string {
  const snapshot: CampSnapshot = {
    schemaVersion: 34,
    throughGlobalSequence: messages.length,
    camp: {
      id: 'camp-channel-presentation',
      title: '渠道会话',
      activationState: 'active',
      projectBindingKind: 'quick_chat',
      projectPath: '/quick-chat',
      defaultLeadAgentId: 'agent-1',
      membershipGeneration: 1,
      version: 1,
      createdAt,
      updatedAt: createdAt
    },
    members: [{
      agentId: 'agent-1', displayName: '芝士', teamRole: '鉴定士',
      avatarRef: null, accent: 'var(--identity-1)', membershipStatus: 'active',
      leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
      isDefaultLead: true, version: 1
    }],
    messages,
    membershipReconciliations: [],
    tasks: [], messageDeliveries: [], turns: [], agentRuns: [],
    executionEvidence: [], agentRunFileChanges: [], contextManifests: [],
    approvals: [], actions: [], timeline: []
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
    onStop: () => undefined
  }))
}

describe('channel message presentation', () => {
  it.each([
    ['feishu', '飞书成员'],
    ['feishu', 'Murray'],
    ['dingtalk', '钉钉成员'],
    ['dingtalk', null]
  ] as const)('presents the admitted %s Owner as the local user (%s)', (provider, displayName) => {
    const externalMessage = message({
      authorType: 'external_principal',
      authorId: `principal-${provider}`,
      authorDisplayName: displayName
    })
    const original = structuredClone(externalMessage)
    const localMarkup = renderMessages([message()])
    const markup = renderMessages([externalMessage])
    const userAvatar = '<span class="local-message-avatar" aria-hidden="true">你</span>'

    expect(localMarkup).toContain(userAvatar)
    expect(markup).toContain(userAvatar)
    expect(markup).toContain('<div class="bubble-meta"><strong>你</strong>')
    expect(markup).not.toContain('external-message-avatar')
    if (displayName) expect(markup).not.toContain(displayName)
    expect(markup).toContain('conversation-bubble external_principal')
    expect(externalMessage).toEqual(original)
  })

  it('uses the native parent quote preview without a jump control for external quotes', () => {
    const externalQuote = quote()
    const parent = message({
      id: 'message-parent',
      authorType: 'agent',
      authorId: 'agent-1',
      body: externalQuote.body,
      content: [{ kind: 'text', text: externalQuote.body }]
    })
    const localMarkup = renderMessages([parent, message({
      sequence: 2,
      timelineGlobalSequence: 2,
      replyToCampMessageId: parent.id
    })])
    const externalMarkup = renderMessages([message({
      authorType: 'external_principal',
      authorId: 'principal-feishu',
      content: [externalQuote, { kind: 'text', text: '\n\n请继续检查。' }]
    })])
    const localPreview = localMarkup.match(/<button class="reply-parent-quote"[^>]*>([\s\S]*?)<\/button>/)
    const externalPreview = externalMarkup.match(/<span class="reply-parent-quote is-static"[^>]*>([\s\S]*?<\/span>)<\/span>/)

    expect(localPreview).not.toBeNull()
    expect(externalPreview).not.toBeNull()
    expect(externalPreview?.[1]).toBe(localPreview?.[1])
    expect(externalPreview?.[0]).toContain('<strong>芝士</strong>')
    expect(externalPreview?.[0]).not.toMatch(/<(?:button|a)\b|tabindex=|role="(?:button|link)"/)
    expect(externalMarkup).not.toContain('external-quote-segment')
    expect(externalMarkup).toContain('</span></span><span>请继续检查。</span>')
  })

  it('hides only the Core quote separator while keeping the Owner’s own newlines', () => {
    const content: StructuredCampMessageContent = [
      quote(),
      { kind: 'text', text: '\n\n' },
      { kind: 'member_mention', agentId: 'agent-1' },
      { kind: 'text', text: ' 第一行\n\n第二行' }
    ]
    const markup = renderMessages([message({
      authorType: 'external_principal',
      authorId: 'principal-feishu',
      content
    })])

    expect(markup).not.toContain('<span>\n\n</span>')
    expect(markup).toContain('<span> 第一行\n\n第二行</span>')
    expect(createStructuredMessageClipboardData(content, [{
      agentId: 'agent-1', displayName: '芝士'
    }])?.text).toContain('\n\n@芝士 第一行\n\n第二行')
  })

  it('also calls the channel Owner “你” when a local reply points to their message', () => {
    const parent = message({
      id: 'message-external-parent',
      authorType: 'external_principal',
      authorId: 'principal-dingtalk',
      authorDisplayName: '钉钉成员'
    })
    const markup = renderMessages([parent, message({
      sequence: 2,
      timelineGlobalSequence: 2,
      replyToCampMessageId: parent.id
    })])

    expect(markup).toContain('<button class="reply-parent-quote" type="button" title="你 · 请继续检查。">')
    expect(markup).not.toContain('钉钉成员')
  })

  it.each([
    [quote({ body: '', attachmentSummaries: [{ name: '需求.pdf', mediaType: 'application/pdf' }] }), '[附件] 需求.pdf'],
    [quote({ body: '' }), '（无文本）'],
    [quote({ senderDisplayName: '飞书消息', body: '[引用的飞书消息不可读取]' }), '[引用的飞书消息不可读取]']
  ] as const)('keeps empty, attachment-only and unavailable external quotes readable', (externalQuote, excerpt) => {
    const markup = renderMessages([message({
      authorType: 'external_principal',
      authorId: 'principal-feishu',
      content: [externalQuote, { kind: 'text', text: '请继续检查。' }]
    })])

    expect(markup).toContain('class="reply-parent-quote is-static"')
    expect(markup).toContain(`<span>${excerpt}</span>`)
    if (externalQuote.attachmentSummaries.length > 0) expect(markup).not.toContain('（无文本）')
  })

  it('does not mutate or truncate quote content, provenance or clipboard text to create the preview', () => {
    const externalQuote = quote({
      senderDisplayName: '<外部作者>',
      body: `保留第一行\n${'长引用内容'.repeat(200)}\n<script>不要执行</script>`,
      attachmentSummaries: [{ name: '设计.txt', mediaType: 'text/plain' }]
    })
    const original = structuredClone(externalQuote)
    const content: StructuredCampMessageContent = [externalQuote, { kind: 'text', text: '\n请继续检查。' }]
    const markup = renderMessages([message({
      authorType: 'external_principal',
      authorId: 'principal-feishu',
      content
    })])
    const copied = createStructuredMessageClipboardData(content, [])

    expect(externalQuote).toEqual(original)
    expect(markup).toContain('&lt;外部作者&gt;')
    expect(markup).not.toContain('<script>')
    expect(markup).not.toContain(externalQuote.contentDigest)
    expect(copied?.text).toContain(externalQuote.body)
    expect(copied?.text).toContain('[附件] 设计.txt (text/plain)')
  })
})
