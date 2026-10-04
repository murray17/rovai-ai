import { describe, expect, it, vi } from 'vitest'
import { emptyLocalThreadComposerDraft, loadLocalThreadComposerDraft, saveLocalThreadComposerDraft } from './camp-composer-local-store'
import { PendingThreadDraftPersistence } from './pending-thread-draft'

describe('Pending Thread draft recovery', () => {
  it('restores independent drafts, including attachment-only input, and releases visibility when cleared', async () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
    const request = vi.fn(async () => ({ changed: true }))
    const persistence = new PendingThreadDraftPersistence({ request: request as never }, draft => saveLocalThreadComposerDraft(draft, storage))
    const first = { ...emptyLocalThreadComposerDraft('first'), body: 'keep my draft', content: { version: 2 as const, segments: [{ kind: 'text' as const, text: 'keep my draft' }] } }
    const second = { ...emptyLocalThreadComposerDraft('second'), attachments: [{ id: '11111111-1111-4111-8111-111111111111', displayName: 'image.png', kind: 'file' as const, fileCount: 1, mediaType: 'image/png', byteSize: 12, previewKind: 'image' as const, availability: 'available' as const, sourcePath: '/tmp/image.png' }] }
    await persistence.persist(first)
    await persistence.persist(second)
    expect(loadLocalThreadComposerDraft('first', storage)).toEqual(first)
    expect(loadLocalThreadComposerDraft('second', storage)).toEqual(second)
    await persistence.persist(first)
    expect(request).toHaveBeenCalledTimes(2)
    await persistence.persist(emptyLocalThreadComposerDraft('first'))
    expect(request).toHaveBeenLastCalledWith('threads.pendingDraft.setPresence', { threadId: 'first', present: false })
    expect(loadLocalThreadComposerDraft('first', storage)).toBeNull()
    expect(loadLocalThreadComposerDraft('second', storage)).toEqual(second)
  })

  it('keeps local input after a retention failure and retries before acknowledging the save', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ changed: true })
    const save = vi.fn()
    const persistence = new PendingThreadDraftPersistence({ request: request as never }, save)
    const draft = { ...emptyLocalThreadComposerDraft('first'), body: 'unsent work' }
    await expect(persistence.persist(draft)).rejects.toThrow('offline')
    expect(save).toHaveBeenCalledWith(draft)
    await persistence.persist(draft)
    expect(request).toHaveBeenCalledTimes(2)
    save.mockImplementationOnce(() => { throw new Error('quota') })
    await expect(persistence.persist(draft)).rejects.toThrow('quota')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
