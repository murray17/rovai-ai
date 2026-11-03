import { describe, expect, it } from 'vitest'
import type { ThreadMessageView } from '@contracts'
import { defaultMessageExportOptions, exportableMessages, exportEntryShowsTime, exportFilename, exportMessageMarkdown, messageExportMarkdown, toggleExportSelection, type MessageExportEntry } from './message-export'
const message = (id: string, sequence: number, extra = {}): ThreadMessageView => ({ id, sequence, authorType: 'agent', withdrawn: false, ...extra } as ThreadMessageView)
describe('message export boundaries', () => {
  it('enables metadata in all formats, with no Markdown avatar', () => {
    for (const format of ['html', 'png', 'markdown'] as const) expect(defaultMessageExportOptions(format)).toEqual({ avatars: format !== 'markdown', authors: true, times: true, recipients: true })
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
    expect(result).toContain(code); expect(result).toContain('\\[thread\\]'); expect(result).not.toContain('secret-id'); expect(result).toContain('\\<img src=x\\>')
  })
  it('excerpt exports never acquire the source message attachments, reply or recipients', () => {
    const entry = { message: message('a', 1, { createdAt: '2026-11-03T01:00:00Z', attachments: [{ displayName: 'secret-file', mediaType: 'text/plain', kind: 'file', byteSize: 32 }] }), author: 'Alice', avatarRef: null, recipients: ['Bob'], markdown: 'full body', reply: 'reply body', excerpt: 'selected <script>' }
    const text = messageExportMarkdown('title', 'thread', [entry], defaultMessageExportOptions('markdown'))
    expect(text).toContain('Alice'); expect(text).toContain('2026\\-11\\-03'); expect(text).toContain('selected \\<script\\>')
    for (const absent of ['secret-file', 'full body', 'reply body', 'Bob']) expect(text).not.toContain(absent)
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
    expect(exportEntryShowsTime({ ...entries[0], excerpt: '选文' }, entries[1])).toBe(true)
  })
})
