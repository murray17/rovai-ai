import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileEditResult, FilePreviewApi, ResolvedFilePreview } from '@contracts'
import { FileEditStore, fileEditDirty } from './file-edit-store'
const stores: FileEditStore[] = []
afterEach(() => stores.splice(0).forEach(store => store.dispose()))
const snapshot = (text: string, version = text, key = 'same-host-file'): FileEditResult => ({ ok: true, value: { key, text, version } })
const file = (id = 'handle'): ResolvedFilePreview => ({ handleId: id, contentGeneration: id, kind: 'code', fileName: 'example.ts' } as ResolvedFilePreview)
async function fixture() {
  const api = { readEditableFile: vi.fn(async () => snapshot('original')), saveTextFile: vi.fn(async () => snapshot('saved')) }
  const store = new FileEditStore(api as unknown as FilePreviewApi); stores.push(store)
  await store.attach('tab', file())
  return { store, api, doc: store.get('tab')! }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('window file editing buffers', () => {
  it('keeps B dirty when A completes; blocks concurrent writes and does not replace drafts on handle refresh', async () => {
    const { store, api, doc } = await fixture()
    const pending = deferred<FileEditResult>(); api.saveTextFile.mockReturnValueOnce(pending.promise)
    store.change(doc, 'A'); const save = store.save(doc)
    store.change(doc, 'B'); expect(await store.save(doc)).toBe(false)
    pending.resolve(snapshot('A', 'new-version')); expect(await save).toBe(true)
    expect(doc.savedText).toBe('A'); expect(doc.draft).toBe('B'); expect(fileEditDirty(doc)).toBe(true)
    api.readEditableFile.mockResolvedValueOnce(snapshot('A', 'new-version'))
    await store.attach('tab', file('refreshed'))
    expect(doc.draft).toBe('B'); expect(api.saveTextFile).toHaveBeenCalledTimes(1)
    await store.attach('other-thread-tab', file('other-thread'))
    expect(store.get('other-thread-tab')).toBe(doc)
    store.release(['tab']); expect(store.get('other-thread-tab')?.draft).toBe('B')
  })

  it('ignores a capability read that arrives after a newer save confirmation', async () => {
    const { store, api, doc } = await fixture()
    const read = deferred<FileEditResult>(); api.readEditableFile.mockReturnValueOnce(read.promise)
    const attach = store.attach('other', file('later-handle'))
    store.change(doc, 'saved'); api.saveTextFile.mockResolvedValueOnce(snapshot('saved', 'v2'))
    await store.save(doc); read.resolve(snapshot('original', 'v1')); await attach
    expect(doc).toMatchObject({ draft: 'saved', savedText: 'saved', version: 'v2' })
    expect(store.get('other')).toBe(doc)
  })

  it('reconciles an unknown result by reading, never resubmits, and retains later input', async () => {
    const { store, api, doc } = await fixture()
    store.change(doc, 'A'); api.saveTextFile.mockRejectedValueOnce(new Error('connection lost'))
    expect(await store.save(doc)).toBe(false); expect(doc.unknown?.text).toBe('A')
    store.change(doc, 'B'); api.readEditableFile.mockResolvedValueOnce(snapshot('A', 'on-disk'))
    expect(await store.save(doc)).toBe(true)
    expect(api.saveTextFile).toHaveBeenCalledTimes(1)
    expect(doc).toMatchObject({ draft: 'B', savedText: 'A', version: 'on-disk', unknown: undefined })
  })

  it('uses the observed conflict version for an explicit overwrite', async () => {
    const { store, api, doc } = await fixture(); store.change(doc, 'draft')
    api.saveTextFile.mockResolvedValueOnce({ ok: false, error: { code: 'edit_conflict', message: 'conflict' }, current: { key: doc.key, text: 'outside', version: 'disk-2' } })
    const save = store.save(doc)
    await vi.waitFor(() => expect(store.dialog?.kind).toBe('conflict'))
    api.saveTextFile.mockResolvedValueOnce(snapshot('draft', 'disk-3'))
    store.dialog!.resolve('save'); expect(await save).toBe(true)
    expect(api.saveTextFile).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'draft', expectedVersion: 'disk-2' }))
    expect(doc.savedText).toBe('draft')
  })

  it('uses a remaining tab handle when closing another tab for the same file', async () => {
    const { store, api, doc } = await fixture()
    await store.attach('other-tab', file('other-handle'))
    expect(store.get('other-tab')).toBe(doc)
    store.release(['other-tab']); store.change(doc, 'saved')
    expect(await store.save(doc)).toBe(true)
    expect(api.saveTextFile).toHaveBeenLastCalledWith(expect.objectContaining({ handleId: 'handle', expectedGeneration: 'handle' }))
  })

  it('does not offer overwrite for a replaced working directory and retains a failed close', async () => {
    const { store, api, doc } = await fixture(); store.change(doc, 'draft')
    api.saveTextFile.mockResolvedValueOnce({ ok: false, error: { code: 'edit_conflict', message: 'conflict' }, current: { key: 'replacement-directory', text: 'outside', version: 'other' } })
    expect(await store.save(doc)).toBe(false); expect(store.dialog).toBeNull(); expect(doc.conflict).toBeUndefined()
    const close = store.confirmClose(['tab']); expect(store.dialog?.kind).toBe('close')
    api.saveTextFile.mockResolvedValueOnce({ ok: false, error: { code: 'write_failed', message: 'failed' } })
    store.dialog!.resolve('save'); expect(await close).toBe(false)
    expect(doc.draft).toBe('draft'); expect(fileEditDirty(doc)).toBe(true)
    expect(store.shouldWarnOnUnload()).toBe(true); store.acceptExit(); expect(store.shouldWarnOnUnload()).toBe(false)
    store.change(doc, 'later'); expect(store.shouldWarnOnUnload()).toBe(true)
  })

  it('discard re-reads the latest disk and cannot clear a draft on a failed reload', async () => {
    const { store, api, doc } = await fixture(); store.change(doc, 'draft')
    doc.conflict = { key: doc.key, text: 'outside', version: 'disk-2' }
    api.readEditableFile.mockRejectedValueOnce(new Error('offline'))
    const first = store.handleConflict(doc); store.dialog!.resolve('discard')
    expect(await first).toBe(false); expect(doc.draft).toBe('draft')
    api.readEditableFile.mockResolvedValueOnce(snapshot('latest', 'disk-3'))
    const second = store.handleConflict(doc); store.dialog!.resolve('discard')
    expect(await second).toBe(true); expect(doc.draft).toBe('latest'); expect(fileEditDirty(doc)).toBe(false)
  })
})
