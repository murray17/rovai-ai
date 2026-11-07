import { describe, expect, it } from 'vitest'
import type { ProjectFileReferenceAtom, PublishedProjectFileReference } from '@contracts'
import { composerDocumentFromLegacyContent, composerDocumentStatus, composerDocumentsEqualDirect, normalizeComposerDocument, parseComposerClipboardDocument } from './composer-document'
import { fileReferencePresentation, projectFileLink } from './project-file-reference'
import { threadInputHistory } from './input-history'
import { createStructuredMessageClipboardData, readStructuredMessageComposerDocument } from './structured-message-clipboard'
import { messageReeditDocument } from './message-reedit-store'

const file = (path: string, raw = path): ProjectFileReferenceAtom => ({ type: 'project_file_reference', threadId: 'thread', rawReference: raw, labelFallback: path })
const published = (path: string): PublishedProjectFileReference => ({ kind: 'project_file_reference', threadId: 'thread', rawReference: path, pathAtSend: `/project/${path}`, labelAtSend: path })
describe('file identity across presentation and recovery', () => {
  it('uses the shortest distinguishing suffix without losing test names or rewriting saved identity', () => {
    const refs = ['src/auth/index.ts', 'src/billing/index.ts', 'deep/composer-trigger.test.ts', 'deep/composer-trigger.ts'].map(path => file(path))
    expect(refs.map(ref => fileReferencePresentation(ref, refs).label)).toEqual(['auth/index.ts', 'billing/index.ts', 'composer-trigger.test.ts', 'composer-trigger.ts'])
    expect(fileReferencePresentation(refs[0]!, [refs[0]!, refs[0]!]).label).toBe('index.ts')
    const deeper = [file('a/auth/index.ts'), file('b/auth/index.ts')]
    expect(deeper.map(ref => fileReferencePresentation(ref, deeper).label)).toEqual(['a/auth/index.ts', 'b/auth/index.ts'])
    expect(refs[0]!.labelFallback).toBe('src/auth/index.ts')
    const roots = [file('src/index.ts', 'root-a'), file('src/index.ts', 'root-b')]
    expect(new Set(roots.map(ref => fileReferencePresentation(ref, roots).label)).size).toBe(2)
    expect(roots.every(ref => !fileReferencePresentation(ref, roots).label.includes('thread'))).toBe(true)
  })
  it('validates closed UTF-8 file atoms, required fallback and large opaque locators', () => {
    const document = { version: 2 as const, segments: [{ kind: 'atom' as const, atom: file('目录/'.repeat(600) + 'file.ts', 'x'.repeat(16384)) }] }
    expect(parseComposerClipboardDocument(JSON.stringify(document))).toEqual(document)
    expect(parseComposerClipboardDocument(JSON.stringify({ ...document, segments: [{ kind: 'atom', atom: { ...file('a'), rawReference: '中'.repeat(5462) } }] }))).toBeNull()
    for (const field of ['pathAtSend', 'scopeId', 'entryId', 'availability']) expect(parseComposerClipboardDocument(JSON.stringify({ version: 2, segments: [{ kind: 'atom', atom: { ...file('a'), [field]: 'forged' } }] }))).toBeNull()
    const missing = { ...file('a') } as Partial<ProjectFileReferenceAtom>; delete missing.labelFallback
    expect(parseComposerClipboardDocument(JSON.stringify({ version: 2, segments: [{ kind: 'atom', atom: missing }] }))).toBeNull()
    const differentThread = { ...document, segments: [{ kind: 'atom' as const, atom: { ...document.segments[0]!.atom, threadId: 'other' } }] }
    expect(composerDocumentsEqualDirect(document, differentThread)).toBe(false)
    expect(normalizeComposerDocument(document)).toEqual(document)
  })
  it('restores every occurrence and position from history, while withdrawal reedit keeps path text', () => {
    const content = [{ kind: 'text' as const, text: '前 ' }, published('src/中文 #1.test.ts'), { kind: 'text' as const, text: ' 后 ' }, published('src/中文 #1.test.ts')]
    const expected = composerDocumentFromLegacyContent(content)
    expect(threadInputHistory([{ authorType: 'user', authorId: 'local_user', withdrawn: false, body: 'frozen', content }])).toEqual([expected])
    expect(messageReeditDocument({ body: 'frozen', content })).toEqual({ version: 2, segments: [{ kind: 'text', text: '前 src/中文 #1.test.ts 后 src/中文 #1.test.ts' }] })
    expect(composerDocumentStatus({ version: 2, segments: [{ kind: 'atom', atom: file('file.log') }] }, [], [])).toMatchObject({ hasContent: true, hasExplicitRecipient: false, memberAgentIds: [] })
    expect(composerDocumentStatus({ version: 2, segments: [{ kind: 'atom', atom: { type: 'all_members' } }] }, [], [])).toMatchObject({ hasContent: false, hasExplicitRecipient: true })
  })
  it('projects frozen host paths and labels with the same escaping as Core', () => {
    expect(projectFileLink(published('中文 (a)#\\b.test.ts'))).toBe('[中文 \\(a\\)\\#\\\\b\\.test\\.ts](file:///project/%E4%B8%AD%E6%96%87%20%28a%29%23%5Cb.test.ts)')
    const renamed = published('old/index.ts')
    expect(fileReferencePresentation(renamed, [renamed]).label).toBe('index.ts')
    expect(projectFileLink(renamed)).toContain('/project/old/index.ts)')
    expect(projectFileLink({ ...renamed, pathAtSend: 'C:\\project\\a b#1.ts' })).toContain('file:///C:/project/a%20b%231.ts)')
    expect(projectFileLink({ ...renamed, pathAtSend: '\\\\server\\share\\a b.ts' })).toContain('file://server/share/a%20b.ts)')
    expect(projectFileLink({ ...renamed, pathAtSend: '/project/100%25.ts' })).toContain('file:///project/100%2525.ts)')
    expect(projectFileLink({ ...renamed, pathAtSend: 'C:\\project\\100%25.ts' })).toContain('file:///C:/project/100%2525.ts)')
    expect(projectFileLink({ ...renamed, pathAtSend: '\\\\?\\C:\\project\\100%25.ts' })).toContain('file:///C:/project/100%2525.ts)')
    expect(projectFileLink({ ...renamed, pathAtSend: '\\\\?\\UNC\\server\\share\\a b.ts' })).toContain('file://server/share/a%20b.ts)')
  })
  it('message copy carries the full source identity and readable path', () => {
    // The private HTML parser needs a real DOM; the browser owner exercises its read path.
    const content = [{ kind: 'text' as const, text: '检查 ' }, published('src/index.ts')]
    const clipboard = createStructuredMessageClipboardData(content, [])!
    expect(clipboard.text).toBe('检查 src/index.ts')
    expect(clipboard.html).toContain('data-rovai-structured-camp-message-v1')
    expect(typeof readStructuredMessageComposerDocument).toBe('function')
  })
})
