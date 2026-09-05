import { describe, expect, it } from 'vitest'
import {
  FilePreviewSessionStore,
  filePreviewPresentationFromRequest,
  filePreviewSourceKey,
  restorableFilePreviewRequest,
  type FilePreviewSessionSnapshot
} from './file-preview-session'

function snapshot(fileName: string): FilePreviewSessionSnapshot {
  return {
    tabs: [{
      kind: 'file',
      id: `tab-${fileName}`,
      sourceRequest: { kind: 'camp_workspace', campId: 'camp', rawReference: fileName },
      presentation: { fileName, displayPath: fileName, pathPresentation: 'file_name_only' }
    }],
    activeTabId: `tab-${fileName}`,
    paneVisible: true
  }
}

describe('file preview session identity', () => {
  it('deduplicates source locations without collapsing same-name files in different directories', () => {
    expect(filePreviewSourceKey({
      kind: 'message_reference',
      campId: 'camp-1',
      messageId: 'message-1',
      rawReference: 'src/index.ts:20-24'
    })).toBe(filePreviewSourceKey({
      kind: 'message_reference',
      campId: 'camp-1',
      messageId: 'message-1',
      rawReference: 'src/index.ts#L4'
    }))
    expect(filePreviewSourceKey({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: 'src/index.ts'
    })).not.toBe(filePreviewSourceKey({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: 'tests/index.ts'
    }))
    expect(filePreviewSourceKey({
      kind: 'attachment',
      campId: 'camp-1',
      locator: {
        owner: 'single_chat_message',
        campId: 'camp-1',
        conversationId: 'conversation-1',
        conversationMessageId: 'conversation-message-1',
        attachmentRefId: '8b85752a-76a5-4b9d-92d8-a70b6285a0d0'
      }
    })).toBe(
      'attachment:single-chat-message:camp-1:conversation-1:conversation-message-1:8b85752a-76a5-4b9d-92d8-a70b6285a0d0'
    )
  })

  it('keeps only business sources that can be revalidated after a Camp switch', () => {
    expect(restorableFilePreviewRequest({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: 'README.md'
    })).not.toBeNull()
    expect(restorableFilePreviewRequest({
      kind: 'child_of_handle',
      parentHandleId: 'handle-1',
      rawReference: './child.md'
    })).toBeNull()
    expect(restorableFilePreviewRequest({
      kind: 'authorized_root',
      campId: 'camp-1',
      rootGrantId: 'grant-1',
      rawReference: 'child.md'
    })).toBeNull()
  })

  it('never turns an unverified absolute reference into a displayed physical path', () => {
    expect(filePreviewPresentationFromRequest({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: '/Users/example/private/report.md'
    })).toEqual({
      fileName: 'report.md',
      displayPath: 'report.md',
      pathPresentation: 'file_name_only'
    })
    expect(filePreviewPresentationFromRequest({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: 'docs/report.md:42'
    })).toEqual({
      fileName: 'report.md',
      displayPath: 'docs/report.md',
      pathPresentation: 'project_relative'
    })
  })
})

describe('FilePreviewSessionStore', () => {
  it('restores independent Camp snapshots and returns defensive copies', () => {
    const store = new FilePreviewSessionStore(3)
    store.set('camp-a', snapshot('a.md'))
    store.set('camp-b', snapshot('b.md'))

    const first = store.get('camp-a')
    expect(first?.tabs[0]).toMatchObject({ id: 'tab-a.md' })
    first?.tabs.splice(0)
    expect(store.get('camp-a')?.tabs).toHaveLength(1)
    expect(store.get('camp-b')?.tabs[0]).toMatchObject({ id: 'tab-b.md' })
  })

  it('bounds long-window metadata and skips the active deleted Camp cleanup save once', () => {
    const store = new FilePreviewSessionStore(2)
    store.set('camp-a', snapshot('a.md'))
    store.set('camp-b', snapshot('b.md'))
    store.set('camp-c', snapshot('c.md'))
    expect(store.get('camp-a')).toBeNull()

    store.discard('camp-b', true)
    store.set('camp-b', snapshot('resurrected.md'))
    expect(store.get('camp-b')).toBeNull()
    store.set('camp-b', snapshot('new-session.md'))
    expect(store.get('camp-b')?.activeTabId).toBe('tab-new-session.md')
    expect(store.get('camp-c')?.activeTabId).toBe('tab-c.md')
  })

  it('clears an inactive deleted Camp without retaining a save blocker', () => {
    const store = new FilePreviewSessionStore(2)
    store.set('camp-a', snapshot('a.md'))
    store.discard('camp-a')
    expect(store.get('camp-a')).toBeNull()
    store.set('camp-a', snapshot('new-a.md'))
    expect(store.get('camp-a')?.activeTabId).toBe('tab-new-a.md')
  })

  it('bounds deletion cleanup markers with the session limit', () => {
    const store = new FilePreviewSessionStore(2)
    store.discard('camp-a', true)
    store.discard('camp-b', true)
    store.discard('camp-c', true)

    store.set('camp-a', snapshot('new-a.md'))
    store.set('camp-b', snapshot('new-b.md'))
    store.set('camp-c', snapshot('new-c.md'))

    expect(store.get('camp-a')?.activeTabId).toBe('tab-new-a.md')
    expect(store.get('camp-b')).toBeNull()
    expect(store.get('camp-c')).toBeNull()
  })
})
