import { describe, expect, it } from 'vitest'
import type { ThreadMessageView } from '@contracts'
import { defaultMessageExportOptions, defaultMessageExportTitle, exportableMessages, exportEntryShowsTime, exportFilename, exportMessageMarkdown, messageExportMarkdown, toggleExportSelection, type MessageExportEntry } from './message-export'
const message = (id: string, sequence: number, extra = {}): ThreadMessageView => ({ id, sequence, authorType: 'agent', withdrawn: false, ...extra } as ThreadMessageView)
describe('message export boundaries', () => {
  it('enables metadata in all formats, with no Markdown avatar', () => {
    for (const format of ['html', 'png', 'markdown'] as const) expect(defaultMessageExportOptions(format)).toEqual({ avatars: format !== 'markdown', authors: true, times: true, recipients: true })
  })
  it('shortens the generated title without splitting emoji or trimming message content', () => {
    const source = 'a'.repeat(39) + '👩‍💻' + '完整正文'
    const title = defaultMessageExportTitle(source)
    expect(title).toBe('a'.repeat(39) + '👩‍💻… · 会话片段')
    expect(defaultMessageExportTitle('短标题')).toBe('短标题 · 会话片段')
    expect(defaultMessageExportTitle(source, 'conversation')).toBe('a'.repeat(39) + '👩‍💻…')
    expect(defaultMessageExportTitle('短标题', 'conversation')).toBe('短标题')
    const entry = { message: message('a', 1, { createdAt: '2026-11-03T01:00:00Z', attachments: [] }), author: 'Alice', avatarRef: null, recipients: [], markdown: source, reply: null }
    const text = messageExportMarkdown(title, [entry], defaultMessageExportOptions('markdown'))
    expect(text).toContain(source)
    expect(exportFilename(title, 'html')).toBe(title + '.html')
  })
  it('exports only published visible messages in conversation order, never withdrawn or system records', () => {
    expect(exportableMessages([message('last', 4), message('optimistic:pending', 9), message('withdrawn', 2, { withdrawn: true }), message('system', 1, { authorType: 'system' }), message('first', 3), message('mission', 5, { missionStart: {} })]).map(m => m.id)).toEqual(['first', 'last'])
  })
  it('extends or removes a range without inventing unloaded message ids', () => {
    const messages = [message('a', 2), message('b', 5), message('c', 8)]
    const chosen = toggleExportSelection(new Set(['a']), messages, 'c', 'a', true)
    expect([...chosen]).toEqual(['a', 'b', 'c'])
    expect([...toggleExportSelection(chosen, messages, 'b', 'c', true)]).toEqual(['a'])
  })
  it('preserves code/link Markdown, projects internal references and treats names as literal text', () => {
    const code = '\n```diff\n-old\n+new\n```\n[site](https://example.com)'
    const result = exportMessageMarkdown('', [{ kind: 'member_mention', agentId: 'a' }, { kind: 'text', text: code }, { kind: 'thread_reference', threadId: 'secret-id', titleAtSend: '[thread]' }], new Map([['a', '<img src=x>']]), '你')
    expect(result).toContain(code); expect(result).toContain('[\\[thread\\]](rovai://thread/secret-id)'); expect(result).toContain('\\<img src=x\\>')
  })
  it('exports published file, directory and mission links through their shared projectors', () => {
    const result = exportMessageMarkdown('', [
      { kind: 'project_file_reference', threadId: 't', rawReference: 'file', pathAtSend: '/workspace/src/中文 (draft)#1.ts', labelAtSend: 'src/中文 (draft)#1.ts' },
      { kind: 'text', text: '\n' },
      { kind: 'project_file_reference', threadId: 't', rawReference: 'directory', pathAtSend: '/workspace/src/auth', labelAtSend: 'src/auth', targetKind: 'directory' },
      { kind: 'text', text: '\n[untrusted](file:///private/other.ts) ' },
      { kind: 'mission_reference', missionId: 'mission-id', titleAtSend: '登录-重构 v1.2' }
    ], new Map(), '你')
    expect(result).toBe('[中文 (draft)#1.ts](file:///workspace/src/%E4%B8%AD%E6%96%87%20%28draft%29%231.ts)\n[auth](file:///workspace/src/auth/)\nuntrusted [登录-重构 v1.2](rovai://mission/mission-id)')
  })
  it('exports file/internal links as labels while leaving literal code and web links intact', () => {
    const code = '`[source](file:///private/source.ts)`\n\n```md\n[thread](rovai://thread/example)\n```'
    const result = exportMessageMarkdown('[source](file:///private/source.ts) [thread][t] [web](https://example.com)\n\n[t]: rovai://thread/private-id\n\n' + code, null, new Map(), '你')
    expect(result).toContain('source thread [web](https://example.com)')
    expect(result).toContain(code)
    expect(result).not.toContain('private-id')
  })
  it('never lets a title create a filesystem path', () => expect(exportFilename('../a/b:<x>', 'markdown')).toBe('.._a_b__x_.md'))
  it('shows the final selected timestamp only when the source timeline really joins the selected neighbours', () => {
    const entries = ['a', 'b', 'c'].map((id, i) => ({ message: message(id, i + 1), nextGroupedMessageId: ['b', 'c', null][i] } as MessageExportEntry))
    expect(entries.map((entry, i) => exportEntryShowsTime(entry, entries[i + 1]))).toEqual([false, false, true])
    expect(exportEntryShowsTime(entries[0], entries[2])).toBe(true)
    expect(exportEntryShowsTime({ ...entries[0], nextGroupedMessageId: null }, entries[1])).toBe(true)
  })
})
