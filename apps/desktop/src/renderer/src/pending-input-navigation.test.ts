import { describe, expect, it } from 'vitest'
import type { CampPendingInputsView } from '@contracts'
import { createPendingInputNavigationStore, type PendingInputLocalEdit } from './pending-input-navigation'

function fixture(campId = 'camp-a'): { edit: PendingInputLocalEdit; queue: CampPendingInputsView } {
  const content = { version: 2 as const, segments: [{ kind: 'text' as const, text: 'canonical' }] }
  const item = { id: 'pending-1', campId, enqueueSequence: 1, revision: 3, state: 'queued' as const,
    body: 'canonical', content, quotes: [], attachments: [], replyIntent: null, recipientSelectionRequired: false, lastAttemptErrorCode: null }
  const initial = { content, quotes: [], attachments: [], replyToCampMessageId: null, recipientSelectionRequired: false }
  return {
    edit: {
      ...initial, item, token: 'owner-a', initial, replyToCampMessageId: 'reply-1',
      content: { version: 2, segments: [{ kind: 'atom', atom: { type: 'member', agentId: 'agent-1' } }, { kind: 'text', text: 'unsaved' }] } },
    queue: { campId, executionActive: true, items: [item], editSession: { pendingInputId: item.id,
      editToken: 'owner-a', basePendingRevision: 3, recoveryRequired: false, workingQuotes: [], workingAttachments: [] } }
  }
}

describe('Pending navigation snapshots', () => {
  it('resumes the exact unsaved document and Reply once, with current working attachments', () => {
    const store = createPendingInputNavigationStore()
    const { edit, queue } = fixture()
    const attachment = { id: 'working-1', displayName: 'notes.md', kind: 'file' as const, mediaType: null,
      byteSize: 20, fileCount: null, previewKind: 'none' as const, availability: 'unknown' as const }
    store.retain(edit)
    queue.editSession!.workingAttachments = [attachment]
    const resumed = store.resume(queue)!
    expect(resumed.content).toEqual(edit.content)
    expect(resumed.replyToCampMessageId).toBe('reply-1')
    expect(resumed.initial).toEqual(edit.initial)
    expect(resumed.attachments).toEqual([attachment])
    expect(queue.items[0].content).toEqual(edit.initial.content)
    expect(store.resume(queue)).toBeNull()
  })

  it('keeps Camp drafts independent and rolls back only the cancelled navigation', () => {
    const store = createPendingInputNavigationStore()
    const a = fixture(), b = fixture('camp-b')
    const cancelA = store.retain(a.edit)
    store.retain(b.edit)
    cancelA()
    expect(store.resume(a.queue)).toBeNull()
    expect(store.resume(b.queue)?.content).toEqual(b.edit.content)
  })

  it.each(['token', 'revision', 'base', 'recovery', 'deleted', 'closed'] as const)(
    'does not reopen a %s-fenced edit', fence => {
      const store = createPendingInputNavigationStore()
      const { edit, queue } = fixture()
      store.retain(edit)
      if (fence === 'token') queue.editSession!.editToken = 'new-owner'
      if (fence === 'revision') queue.items[0] = { ...queue.items[0], revision: 4 }
      if (fence === 'base') queue.editSession!.basePendingRevision = 4
      if (fence === 'recovery') queue.editSession!.recoveryRequired = true
      if (fence === 'deleted') queue.items = []
      if (fence === 'closed') queue.editSession = null
      expect(store.resume(queue)).toBeNull()
      expect(store.resume(fixture().queue)).toBeNull()
    }
  )

  it('a late cancelled preparation cannot erase a newer snapshot', () => {
    const store = createPendingInputNavigationStore()
    const { edit, queue } = fixture()
    const cancel = store.retain(edit)
    const later = { ...edit, content: { version: 2 as const, segments: [{ kind: 'text' as const, text: 'later' }] } }
    store.retain(later)
    cancel()
    expect(store.resume(queue)?.content).toEqual(later.content)
  })
})
