import { describe, expect, it } from 'vitest'
import type { ThreadMessageView, ThreadOpenProjection } from '@contracts'
import { conversationExportEntries } from './ConversationExport'
import { defaultMessageExportOptions, exportEntryShowsTime, messageExportMarkdown } from './message-export'

const user = { displayName: 'Owner', avatarDataUrl: 'data:image/png;base64,user' }
const message = (sequence: number, extra = {}): ThreadMessageView => ({ id: `m${sequence}`, sequence,
  authorType: 'agent', authorId: 'alice', body: `正文 ${sequence}`, content: null, withdrawn: false,
  attachments: [], addressedAgentIds: [], quotes: [], threadTurnId: 'same-turn', sourceAgentRunId: 'old-run',
  createdAt: new Date(Date.UTC(2026, 10, 4, 1, 0, sequence)).toISOString(), ...extra } as unknown as ThreadMessageView)
const projection = (): ThreadOpenProjection => ({
  members: [{ agentId: 'alice', displayName: 'Alice', avatarRef: 'avatar' }, { agentId: 'bob', displayName: 'Bob' }],
  agentRuns: [], turns: [], tasks: [], agentRunFileChanges: [], memberCreations: [],
  agentRunImages: [{ agentRunId: 'old-run', executionEpoch: 1, createdAt: '2026-11-04T01:00:06.000Z',
    images: [{ id: 'old-image', displayName: 'output.png', mediaType: 'image/png', byteSize: 32 }] }]
} as unknown as ThreadOpenProjection)

describe('complete export source projection', () => {
  it('resolves early replies, structured references, recipients, attachments and run images from the full collection', () => {
    const root = message(1, { authorType: 'user', authorId: 'local_user', body: '旧消息根正文', sourceAgentRunId: null })
    const response = message(2, { replyToThreadMessageId: root.id, addressedAgentIds: ['bob'], content: [
      { kind: 'member_mention', agentId: 'bob' }, { kind: 'text', text: ' [site](https://example.com) ' },
      { kind: 'thread_reference', threadId: 'internal-id', titleAtSend: '关联讨论' }
    ], attachments: [{ id: 'file', displayName: '报告.pdf', kind: 'file', mediaType: 'application/pdf', byteSize: 100, previewKind: 'none' }] })
    const last = message(3)
    const source = [root, response, last]
    const untouched = structuredClone(source)
    const entries = conversationExportEntries(projection(), source, user)
    expect(entries[1].reply).toBe('回复 Owner · 旧消息根正文')
    expect(entries[0].avatarDataUrl).toBe(user.avatarDataUrl)
    expect(entries[1].avatarRef).toBe('avatar')
    expect(entries[1].recipients).toEqual(['Bob'])
    expect(entries[1].runtimeImages).toEqual([])
    expect(entries[2].runtimeImages?.map(image => image.id)).toEqual(['old-image'])
    expect(entries.map((entry, i) => exportEntryShowsTime(entry, entries[i + 1]))).toEqual([true, false, true])
    const markdown = messageExportMarkdown('完整会话', entries, defaultMessageExportOptions('markdown'))
    for (const expected of ['旧消息根正文', '@Bob', '[site](https://example.com)', '关联讨论', '报告\\.pdf', 'output\\.png']) expect(markdown).toContain(expected)
    expect(markdown).not.toContain('internal-id')
    expect(source).toEqual(untouched)
  })
  it('never leaks a withdrawn or deleted reply parent, while preserving captured quote text', () => {
    const parent = message(1, { withdrawn: true, body: '撤回后的旧正文' })
    const reply = message(2, { replyToThreadMessageId: parent.id, quotes: [{ text: '保存的引用', authorAtCapture: { displayName: 'Alice' } }] })
    for (const source of [[parent, reply], [reply]]) {
      const entries = conversationExportEntries(projection(), source, user)
      expect(entries).toHaveLength(1)
      expect(entries[0].reply).toContain('引用的消息当前不可用')
      expect(entries[0].reply).toContain('保存的引用')
      expect(messageExportMarkdown('会话', entries, defaultMessageExportOptions('markdown'))).not.toContain('撤回后的旧正文')
    }
  })
  it('uses source adjacency, including filtered records, rather than joining exported neighbours', () => {
    const entries = conversationExportEntries(projection(), [message(1), message(2, { authorType: 'system' }), message(3), message(4, { withdrawn: true }), message(5)], user)
    expect(entries.map(entry => entry.message.id)).toEqual(['m1', 'm3', 'm5'])
    expect(entries.every((entry, i) => exportEntryShowsTime(entry, entries[i + 1]))).toBe(true)
  })
})
