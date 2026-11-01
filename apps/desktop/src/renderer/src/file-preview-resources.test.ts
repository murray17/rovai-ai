import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { history, undoDepth } from '@codemirror/commands'
import type { FilePreviewApi, ResolvedFilePreview, OpenFilePreviewRequest, FilePreviewTextContent } from '@contracts'
import { FilePreviewResources } from './file-preview-resources'
import { filePreviewSessionStore } from './file-preview-session'
import { filePreviewRetentionLimits } from '../../file-preview-retention'
import { canDownloadFile, type FilePreviewSession, type FilePreviewTabModel } from './file-preview-controller'

const resources: FilePreviewResources[] = []
beforeEach(() => { filePreviewSessionStore.clear(); vi.stubGlobal('document', { activeElement: null }) })
afterEach(() => { resources.splice(0).forEach(owner => owner.dispose()); filePreviewSessionStore.clear(); vi.unstubAllGlobals() })

function fixture(limits: Partial<Record<keyof typeof filePreviewRetentionLimits, number>> = {}, kind?: ResolvedFilePreview['kind']) {
  let sequence = 0
  const handles = new Map<string, ResolvedFilePreview>()
  const resolve = (request: OpenFilePreviewRequest): ResolvedFilePreview => {
    const name = 'rawReference' in request ? request.rawReference : 'file.txt'
    const id = `handle-${++sequence}`
    const file: ResolvedFilePreview = {
      handleId: id, reopenToken: id, previewKey: `${'threadId' in request ? request.threadId : ''}:${name}`,
      fileName: name, displayPath: name, pathPresentation: 'project_relative', size: 12, mime: name.endsWith('.html') ? 'text/html' : 'text/plain',
      extension: name.endsWith('.html') ? '.html' : '.txt',
      kind: kind ?? (name.endsWith('.html') ? 'html' : name.endsWith('.png') ? 'image' : name.endsWith('.md') ? 'markdown' : name.endsWith('.ts') ? 'code' : 'text'),
      hasExternalUpdate: false,
      contentGeneration: id, contentVersion: { size: 12, mtimeMs: sequence }, capabilities: ['read']
    }
    handles.set(id, file)
    return file
  }
  const failure = async () => ({ ok: false as const, error: { code: 'read_failed' as const, message: 'failed', retryable: true } })
  let update: Parameters<FilePreviewApi['onExternalUpdate']>[0] = () => undefined
  const api: FilePreviewApi = {
    bindThread: vi.fn(async () => undefined), updateRetention: vi.fn(async () => undefined),
    open: vi.fn(async request => ({ ok: true as const, value: { kind: 'file_preview' as const, file: resolve(request) } })),
    restore: vi.fn(async request => ({ ok: true as const, value: { kind: 'file_preview' as const, file: resolve(request) } })),
    reopen: failure, readText: vi.fn(async ({ handleId }) => ({
      ok: true as const, value: {
        text: 'cached body',
        contentGeneration: handleId, contentVersion: handles.get(handleId)!.contentVersion
      }
    })),
    readPage: vi.fn(failure), resolveLine: vi.fn(failure), readBinary: vi.fn(async ({ handleId }) => ({
      ok: true as const, value: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png',
        contentGeneration: handleId, contentVersion: handles.get(handleId)!.contentVersion }
    })),
    prepareHtmlSite: vi.fn(async ({ handleId }) => ({
      ok: true as const, value: {
        previewId: handleId, generation: handleId,
        origin: `http://${handleId}.localhost`, entryUrl: `http://${handleId}.localhost/entry`, documentUrl: `http://${handleId}.localhost/file.html`,
        contentGeneration: handleId, contentVersion: handles.get(handleId)!.contentVersion
      }
    })),
    prepareHtml: failure, releaseHtmlSite: vi.fn(async () => ({ released: true as const })),
    reload: vi.fn(async ({ handleId }) => ({ ok: true as const, value: resolve({ kind: 'camp_workspace', threadId: 'a', rawReference: handles.get(handleId)!.fileName }) })),
    release: vi.fn(async () => ({ released: true as const })), openInSystem: failure, revealInFolder: failure, copyPath: failure,
    chooseAuthorizedRoot: failure, onExternalUpdate: listener => { update = listener; return () => undefined }
  }
  const owner = new FilePreviewResources(api, { ...filePreviewRetentionLimits, ...limits })
  resources.push(owner)
  return { owner, api, update: (threadId: string, previewKeys: string[]) => update({ threadId, previewKeys }) }
}
function active(session: FilePreviewSession): FilePreviewTabModel {
  return session.getSnapshot().tabs.find(tab => tab.id === session.getSnapshot().activeTabId) as FilePreviewTabModel
}
async function open(owner: FilePreviewResources, threadId: string, name = 'file.txt') {
  owner.activate(threadId)
  const session = owner.session(threadId)
  await session.actions.open({ kind: 'camp_workspace', threadId, rawReference: name })
  await vi.waitFor(() => expect(active(session)?.loadState).toBe('ready'))
  return session
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('window-owned preview resources', () => {
  it('downloads a cold background tab from its source without activating or restoring its preview', async () => {
    const { owner, api } = fixture()
    const result = { ok: true as const, value: { started: true as const } }
    api.downloadSource = vi.fn(async () => result)
    const session = await open(owner, 'downloads', 'cold.txt')
    const cold = active(session)
    await open(owner, 'downloads', 'current.txt')
    const current = active(session)
    session.evict(cold.id)
    const reads = vi.mocked(api.readText).mock.calls.length

    expect(session.getSnapshot().tabs.find(tab => tab.id === cold.id)).toMatchObject({ loadState: 'cold', file: null })
    expect(await session.actions.download(cold.id)).toEqual(result)
    expect(api.downloadSource).toHaveBeenCalledExactlyOnceWith(cold.sourceRequest)
    expect(api.restore).not.toHaveBeenCalled()
    expect(api.readText).toHaveBeenCalledTimes(reads)
    expect(active(session).id).toBe(current.id)
    expect(session.getSnapshot().tabs.find(tab => tab.id === cold.id)).toMatchObject({ loadState: 'cold', downloadState: result })
  })

  it.each(['text handle', 'HTML source bytes'] as const)('allows another download after evicting %s during preparation', async kind => {
    const { owner, api } = fixture()
    const previous = deferred<Awaited<ReturnType<NonNullable<FilePreviewApi['download']>>>>()
    const next = deferred<Awaited<ReturnType<NonNullable<FilePreviewApi['download']>>>>()
    api.download = vi.fn().mockReturnValueOnce(previous.promise).mockReturnValueOnce(next.promise)
    api.downloadSource = vi.fn(() => next.promise)
    const session = await open(owner, 'downloads', kind === 'text handle' ? 'retained.txt' : 'retained.html')
    if (kind === 'HTML source bytes') await session.actions.loadHtmlSource(active(session).id)
    const before = active(session)
    before.file!.capabilities.push('download')
    const pending = session.actions.download(before.id)
    expect(active(session).downloadState).toBe('preparing')

    if (kind === 'text handle') session.evict(before.id, true)
    else session.evictBytes(before.id)
    expect(active(session)).toMatchObject({ loadState: 'ready', requestGeneration: before.requestGeneration + 1 })
    expect(active(session).content).toBe(before.content)
    expect(active(session).downloadState).toBeUndefined()
    if (kind === 'text handle') expect(active(session).file).toBeNull()
    else {
      expect(before.htmlSource).toBeDefined()
      expect(active(session).htmlSource).toBeUndefined()
    }
    const retry = session.actions.download(before.id)
    expect(active(session).downloadState).toBe('preparing')
    // The discarded request must neither leave the button busy nor overwrite its successor.
    previous.resolve({ ok: false, error: { code: 'file_changed', message: 'old preview', retryable: true } })
    await pending
    expect(active(session).downloadState).toBe('preparing')
    const started = { ok: true as const, value: { started: true as const } }
    next.resolve(started)
    expect(await retry).toEqual(started)
    expect(active(session).downloadState).toEqual(started)
    expect(api.restore).not.toHaveBeenCalled()
    expect(vi.mocked(api.download).mock.calls.length + vi.mocked(api.downloadSource).mock.calls.length).toBe(2)
  })

  it('shares source download eligibility without confusing patch files with comparison views', async () => {
    const { owner, api } = fixture()
    api.download = vi.fn(async () => ({ ok: true as const, value: { started: true as const } }))
    api.downloadSource = vi.fn(async () => ({ ok: true as const, value: { started: true as const } }))
    const session = await open(owner, 'downloads', 'changes.patch')
    const patch = active(session)
    patch.file = { ...patch.file!, kind: 'patch', extension: '.patch', capabilities: ['read', 'download'] }
    patch.content = { kind: 'patch', text: '--- a/file\n+++ b/file\n@@ -1 +1 @@\n-before\n+after' }
    expect(canDownloadFile(patch, api)).toBe(true)
    await session.actions.download(patch.id)
    expect(api.download).toHaveBeenCalledWith({ handleId: patch.file.handleId, expectedGeneration: patch.file.contentGeneration })
    expect(canDownloadFile({ ...patch, file: { ...patch.file, capabilities: ['read'] } }, api)).toBe(false)
    const review = { kind: 'file_change' as const, id: 'comparison', threadId: 'downloads', selectedEvidenceFileId: null,
      changes: { schemaVersion: 2 as const, agentRunId: 'run', executionEpoch: 1, fileCount: 0, operationCount: 0, files: [], completedAt: '2026-10-18T00:00:00Z' } }
    expect(canDownloadFile(review, api)).toBe(false)
    const unavailable = { ...patch, file: null, content: null, error: { code: 'file_too_large' as const, message: 'Preview budget', retryable: false } }
    expect(canDownloadFile(unavailable, api)).toBe(true)
    expect(canDownloadFile({ ...unavailable, error: { ...unavailable.error, code: 'source_not_authorized' } }, api)).toBe(false)
    expect(canDownloadFile(unavailable, { ...api, download: undefined, downloadSource: undefined })).toBe(false)
  })

  it('keeps delayed download feedback with its file and never reopens or activates a hidden panel', async () => {
    const { owner, api } = fixture()
    const pending = deferred<{ ok: false; error: { code: 'file_changed'; message: string; retryable: true } }>()
    api.download = vi.fn(() => pending.promise)
    const session = await open(owner, 'downloads', 'a.txt')
    active(session).file!.capabilities.push('download')
    const a = active(session).id
    const downloading = session.actions.download(a)
    await session.actions.download(a)
    expect(api.download).toHaveBeenCalledTimes(1)
    await open(owner, 'downloads', 'b.txt')
    const b = active(session).id
    session.actions.hidePane()
    owner.activate('another-thread')
    pending.resolve({ ok: false, error: { code: 'file_changed', message: 'a changed', retryable: true } })
    await downloading
    expect(owner.isCurrent('another-thread')).toBe(true)
    expect(session.getSnapshot()).toMatchObject({ activeTabId: b, paneVisible: false })
    expect(active(session).downloadState).toBeUndefined()
    const aTab = session.getSnapshot().tabs.find(tab => tab.id === a) as FilePreviewTabModel
    expect(aTab.downloadState).toMatchObject({ ok: false, error: { code: 'file_changed' } })
    session.actions.clearDownloadFeedback(a)
    expect((session.getSnapshot().tabs.find(tab => tab.id === a) as FilePreviewTabModel).downloadState).toBeUndefined()

    const late = deferred<{ ok: true; value: { started: true } }>()
    vi.mocked(api.download).mockReturnValueOnce(late.promise)
    const removed = session.actions.download(a)
    session.actions.close(a)
    late.resolve({ ok: true, value: { started: true } })
    await removed
    expect(session.getSnapshot()).toMatchObject({ activeTabId: b, paneVisible: false })
    expect(session.getSnapshot().tabs.some(tab => tab.id === a)).toBe(false)
  })

  it('keeps mission activity in the shared tab lifecycle without acquiring a file handle', async () => {
    const { owner, api } = fixture()
    owner.activate('mission-camp')
    const session = owner.session('mission-camp')
    session.actions.openMissionActivity('mission-a')
    const activityId = session.getSnapshot().activeTabId!
    session.actions.openMissionActivity('mission-a')
    expect(session.getSnapshot().tabs).toHaveLength(1)
    expect(api.open).not.toHaveBeenCalled()
    expect(api.readText).not.toHaveBeenCalled()
    session.actions.saveReading(activityId, { scrollTop: 230 })
    await open(owner, 'mission-camp', 'delivery.txt')
    const file = active(session)
    session.actions.activate(activityId)
    session.actions.close(activityId)
    expect(session.getSnapshot()).toMatchObject({ activeTabId: file.id, paneVisible: true })
    expect(active(session).content).toBe(file.content)
    session.actions.openMissionActivity('mission-a')
    const reopenedId = session.getSnapshot().activeTabId!
    session.actions.hidePane()
    expect(session.getSnapshot().tabs).toHaveLength(2)
    session.actions.showPane()
    session.actions.close(file.id)
    expect(session.getSnapshot()).toMatchObject({ activeTabId: reopenedId, paneVisible: true })
    session.actions.close(reopenedId)
    expect(session.getSnapshot()).toMatchObject({ tabs: [], activeTabId: null, paneVisible: false })
  })

  it('keeps execution beside Activity and files without acquiring a file handle', async () => {
    const { owner, api } = fixture()
    owner.activate('execution-camp')
    const session = owner.session('execution-camp')
    session.actions.openMissionActivity('mission-a')
    const activityId = session.getSnapshot().activeTabId!
    session.actions.openExecution()
    const executionId = session.getSnapshot().activeTabId!
    session.actions.openExecution()
    expect(session.getSnapshot()).toMatchObject({
      activeTabId: executionId,
      paneVisible: true,
      tabs: [
        { id: executionId, kind: 'execution' },
        { id: activityId, kind: 'mission_activity', missionId: 'mission-a' }
      ]
    })
    expect(api.open).not.toHaveBeenCalled()
    expect(api.readText).not.toHaveBeenCalled()
    session.actions.close(executionId)
    expect(session.getSnapshot()).toMatchObject({ activeTabId: activityId, paneVisible: true })
  })

  it('retains activity selection and reading position per Thread across cooling and restoration', async () => {
    const { owner, api } = fixture()
    owner.activate('mission-a')
    const a = owner.session('mission-a')
    a.actions.openMissionActivity('mission-1')
    const id = a.getSnapshot().activeTabId!
    a.actions.saveReading(id, { scrollTop: 320 })
    await open(owner, 'ordinary')
    a.cool()
    owner.activate('mission-a')
    expect(a.getSnapshot().tabs[0]).toMatchObject({ id, kind: 'mission_activity', missionId: 'mission-1', reading: { scrollTop: 320 } })
    owner.dispose()
    const restored = new FilePreviewResources(api)
    resources.push(restored)
    restored.activate('mission-a')
    expect(restored.session('mission-a').getSnapshot()).toMatchObject({ activeTabId: id, paneVisible: true, tabs: [{ kind: 'mission_activity', reading: { scrollTop: 320 } }] })
  })

  it('switches a hot Thread without opening, reading or replacing its content and reading position', async () => {
    const { owner, api } = fixture()
    const a = await open(owner, 'a')
    const first = active(a)
    a.actions.saveReading(first.id, { scrollTop: 320, codeScrollTop: 640 })
    await open(owner, 'b')
    const count = vi.mocked(api.readText).mock.calls.length
    owner.activate('a')
    expect(active(a).file).toBe(first.file)
    expect(active(a).content).toBe(first.content)
    expect(active(a).reading?.scrollTop).toBe(320)
    await owner.sync()
    expect(api.readText).toHaveBeenCalledTimes(count)
    expect(api.restore).not.toHaveBeenCalled()
    await a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'file.txt' })
    expect(api.open).toHaveBeenCalledTimes(2)
    expect(api.readText).toHaveBeenCalledTimes(count)
  })

  it('finishes an in-flight read in its original session without stealing focus or duplicating reads', async () => {
    const { owner, api } = fixture()
    const delayed = deferred<{ ok: true; value: FilePreviewTextContent }>()
    vi.mocked(api.readText).mockImplementationOnce(() => delayed.promise)
    owner.activate('a')
    const a = owner.session('a')
    await a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'slow.txt' })
    await vi.waitFor(() => expect(api.readText).toHaveBeenCalledTimes(1))
    owner.activate('b'); owner.activate('a'); owner.activate('b')
    const b = await open(owner, 'b')
    const bTab = active(b)
    delayed.resolve({ ok: true as const, value: { text: 'late A', contentGeneration: active(a).file!.contentGeneration, contentVersion: { size: 6, mtimeMs: 1 } } })
    await vi.waitFor(() => expect(active(a).content).toMatchObject({ text: 'late A' }))
    expect(active(b)).toBe(bTab)
    expect(owner.currentThreadId).toBe('b')
    expect(api.readText).toHaveBeenCalledTimes(2)
  })

  it('drops late content after a tab closes and releases its handle', async () => {
    const { owner, api } = fixture()
    const delayed = deferred<{ ok: true; value: FilePreviewTextContent }>()
    vi.mocked(api.readText).mockImplementationOnce(() => delayed.promise)
    owner.activate('a'); const a = owner.session('a')
    await a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'slow.txt' })
    const file = active(a).file!
    a.actions.close(active(a).id)
    delayed.resolve({ ok: true as const, value: { text: 'late', contentGeneration: file.contentGeneration, contentVersion: file.contentVersion } })
    await owner.sync()
    expect(a.getSnapshot().tabs).toEqual([])
    expect(api.release).toHaveBeenCalledWith({ handleId: file.handleId })
  })

  it('cools the least recently used Thread and restores only its selected tab', async () => {
    const { owner, api } = fixture({ hotThreads: 2 })
    const a = await open(owner, 'a', 'one.txt')
    await open(owner, 'a', 'two.txt')
    const selected = active(a).id
    a.actions.saveReading(selected, { scrollTop: 48 })
    await open(owner, 'b'); await open(owner, 'c')
    owner.prune()
    expect(a.getSnapshot().tabs.every(tab => tab.kind === 'file' && !tab.content)).toBe(true)
    expect(a.getSnapshot().activeTabId).toBe(selected)
    owner.activate('a')
    await vi.waitFor(() => expect(active(a).loadState).toBe('ready'))
    expect(api.restore).toHaveBeenCalledTimes(1)
    expect(active(a).reading?.scrollTop).toBe(48)
    expect(a.getSnapshot().tabs.filter(tab => tab.kind === 'file' && tab.content)).toHaveLength(1)
  })

  it('reclaims a nonactive tab in the current Thread when the background byte budget is exceeded', async () => {
    const { owner } = fixture({ backgroundBytes: 10 })
    const a = await open(owner, 'a', 'one.txt'); const first = active(a).id
    await open(owner, 'a', 'two.txt')
    owner.prune()
    expect(a.getSnapshot().tabs.find(tab => tab.id === first)).toMatchObject({ content: null, loadState: 'cold' })
    expect(active(a).content).toMatchObject({ text: 'cached body' })
  })

  it('keeps HTML instances within the window limit and reuses a retained handle after page eviction', async () => {
    const { owner, api } = fixture({ htmlInstances: 2 })
    const a = await open(owner, 'a', 'one.html'); const first = active(a)
    await open(owner, 'b', 'two.html'); await open(owner, 'c', 'three.html')
    expect(active(a).content).toBeNull()
    expect(active(a).file).toBe(first.file)
    expect(api.releaseHtmlSite).toHaveBeenCalledWith({ previewId: first.file!.handleId })
    owner.activate('a')
    await vi.waitFor(() => expect(active(a).content?.kind).toBe('html'))
    expect(api.restore).not.toHaveBeenCalled()
    expect(api.open).toHaveBeenCalledTimes(3)
  })

  it('keeps the old file and content when reading a refresh candidate fails', async () => {
    const { owner, api } = fixture()
    const a = await open(owner, 'a'); const before = active(a)
    vi.mocked(api.readText).mockResolvedValueOnce({ ok: false, error: { code: 'read_failed', message: 'unreadable', retryable: true } })
    await a.actions.reload(before.id)
    expect(active(a).file).toBe(before.file)
    expect(active(a).content).toBe(before.content)
    expect(active(a).refreshError).toBeTruthy()
    expect(api.release).not.toHaveBeenCalledWith({ handleId: before.file!.handleId })
    expect(api.release).toHaveBeenCalledWith({ handleId: 'handle-2' })
  })

  it('commits an HTML candidate only after page readiness and releases the old version after display', async () => {
    const { owner, api } = fixture()
    const a = await open(owner, 'a', 'one.html'); const before = active(a)
    const refreshing = a.actions.reload(before.id)
    await vi.waitFor(() => expect(active(a).candidate).toBeTruthy())
    const candidate = active(a).candidate!
    expect(active(a).file).toBe(before.file)
    expect(api.releaseHtmlSite).not.toHaveBeenCalled()
    a.actions.completeHtmlRefresh(before.id, candidate.file.handleId)
    await refreshing
    expect(active(a).file).toBe(candidate.file)
    expect(api.release).not.toHaveBeenCalledWith({ handleId: before.file!.handleId })
    a.actions.displayed(before.id, candidate.file.handleId)
    expect(api.release).toHaveBeenCalledWith({ handleId: before.file!.handleId })
  })

  it('refuses an HTML refresh with no safe instance slot, retaining the visible old page', async () => {
    const { owner, api } = fixture({ htmlInstances: 1 })
    const a = await open(owner, 'a', 'one.html'); const before = active(a)
    await a.actions.reload(before.id)
    expect(active(a).file).toBe(before.file)
    expect(active(a).content).toBe(before.content)
    expect(active(a).refreshError).toContain('资源不足')
    expect(api.releaseHtmlSite).not.toHaveBeenCalled()
  })
})


it('preserves independent cached content after handle eviction and can refresh it without mixing versions', async () => {
  const { owner, api } = fixture()
  const a = await open(owner, 'a'); const first = active(a)
  a.evict(first.id, true, true)
  expect(active(a).content).toBe(first.content)
  expect(active(a).file).toBeNull()
  vi.mocked(api.readText).mockResolvedValueOnce({ ok: false, error: { code: 'read_failed', message: 'failed', retryable: true } })
  await a.actions.reload(first.id)
  expect(active(a).content).toBe(first.content)
  expect(active(a).file).toBeNull()
  await a.actions.reload(first.id)
  expect(active(a).file?.handleId).toBe('handle-3')
  expect(active(a).content).toMatchObject({ text: 'cached body' })
  a.actions.displayed(first.id, 'handle-3')
})

it('coalesces concurrent committed opens of the same source', async () => {
  const { owner, api } = fixture()
  owner.activate('a'); const a = owner.session('a')
  const source = { kind: 'camp_workspace' as const, threadId: 'a', rawReference: 'same.txt' }
  const results = await Promise.all([a.actions.open(source, undefined, undefined, { commitOnSuccess: true }),
  a.actions.open(source, undefined, undefined, { commitOnSuccess: true })])
  expect(results[0]).toEqual(results[1])
  expect(api.open).toHaveBeenCalledTimes(1)
  expect(api.readText).toHaveBeenCalledTimes(1)
  expect(a.getSnapshot().tabs).toHaveLength(1)
})

it('reclaims immutable change detail with the hot Thread while preserving its selection and reading snapshot', async () => {
  const { owner } = fixture({ hotThreads: 1 })
  owner.activate('a'); const a = owner.session('a')
  const changes = { agentRunId: 'run', executionEpoch: 1, files: [{ evidenceFileId: 'evidence', presentationKind: 'operation_only', path: 'file.txt' }] } as unknown as import('@contracts').AgentRunFileChangesView
  const id = a.actions.openFileChanges('a', changes)!
  const read = vi.fn(async () => ({ schemaVersion: 2, card: changes, files: [] }) as import('@contracts').AgentRunFileChangesDetailView)
  await a.actions.loadChanges(id, read)
  a.actions.saveReading(id, { scrollTop: 230 })
  owner.activate('b'); await open(owner, 'b')
  const cold = a.getSnapshot().tabs[0]
  expect(cold).toMatchObject({ selectedEvidenceFileId: 'evidence', reading: { scrollTop: 230 }, detail: undefined })
  expect(filePreviewSessionStore.get('a')?.tabs[0]).not.toHaveProperty('detail')
  owner.activate('a'); await a.actions.loadChanges(id, read)
  expect(read).toHaveBeenCalledTimes(2)
})

it('keeps stale file-change detail readable and rejects an older same-version refresh', async () => {
  const { owner } = fixture()
  owner.activate('a')
  const session = owner.session('a')
  const card = (revision: number, sourceChangeSequence: number, isStale: boolean) => ({
    schemaVersion: 3,
    agentRunId: 'run',
    executionEpoch: 1,
    revision,
    sourceChangeSequence,
    isStale,
    files: [{
      evidenceFileId: 'evidence',
      path: 'file.txt',
      changeKind: 'update',
      presentationKind: 'operation_only',
      operationCount: 1
    }],
    fileCount: 1,
    operationCount: 1,
    completedAt: '2026-09-22T00:00:00Z'
  }) as import('@contracts').AgentRunFileChangesView
  const initial = card(1, 1, false)
  const id = session.actions.openFileChanges('a', initial)!
  const originalDetail = {
    schemaVersion: 3,
    card: initial,
    files: []
  } as import('@contracts').AgentRunFileChangesDetailView
  await session.actions.loadChanges(id, async () => originalDetail)

  session.actions.syncFileChanges('a', [card(1, 1, true)])
  expect(active(session)).toMatchObject({
    changes: { revision: 1, sourceChangeSequence: 1, isStale: true },
    detail: originalDetail,
    detailStatus: 'ready'
  })

  await session.actions.loadChanges(id, async () => ({
    schemaVersion: 3,
    card: card(1, 1, false),
    files: []
  }) as import('@contracts').AgentRunFileChangesDetailView, true)
  expect(active(session)).toMatchObject({
    changes: { revision: 1, isStale: true },
    detail: originalDetail,
    detailStatus: 'ready'
  })

  const refreshed = {
    schemaVersion: 3,
    card: card(2, 2, false),
    files: []
  } as import('@contracts').AgentRunFileChangesDetailView
  await session.actions.loadChanges(id, async () => refreshed, true)
  expect(active(session)).toMatchObject({
    changes: { revision: 2, sourceChangeSequence: 2, isStale: false },
    detail: refreshed,
    detailStatus: 'ready'
  })
})

it('bounds cold snapshots without letting snapshot writes promote their Thread', async () => {
  const { owner } = fixture({ hotThreads: 1, snapshots: 3 })
  const a = await open(owner, 'a')
  await open(owner, 'b'); await open(owner, 'c')
  a.actions.saveReading(active(a).id, { scrollTop: 777 })
  await open(owner, 'd'); owner.prune()
  expect(owner.sessions.size).toBe(3)
  expect(owner.sessions.has('a')).toBe(false)
  expect(owner.sessions.has('d')).toBe(true)
})

it('preserves the cached page after handle eviction and refuses to append a newly acquired different version', async () => {
  const { owner, api } = fixture()
  vi.mocked(api.readPage).mockResolvedValue({
    ok: true, value: {
      text: 'first', startOffset: 0, endOffset: 6, startLine: 1,
      hasNext: true, hasPrevious: false, contentGeneration: 'handle-1', contentVersion: { size: 12, mtimeMs: 1 }
    }
  })
  vi.mocked(api.open).mockImplementation(async request => {
    const result = await api.restore(request as import('@contracts').RestoreFilePreviewRequest)
    if (result.ok && result.value.kind === 'file_preview') result.value.file.kind = 'paged_text'
    return result
  })
  const a = await open(owner, 'a', 'pages.log'); const first = active(a)
  a.evict(first.id, true, true)
  await a.actions.changePage(first.id, 1)
  expect(active(a).file).toBeNull()
  expect(active(a).content).toMatchObject({ kind: 'page', page: { text: 'first' } })
  expect(active(a).hasExternalUpdate).toBe(true)
  expect(active(a).refreshError).toContain('文件已变化')
  expect(api.readPage).toHaveBeenCalledTimes(1)
  expect(api.release).toHaveBeenCalledWith({ handleId: 'handle-2' })
})

it('loads the newly visible cold tab when its active neighbor is closed', async () => {
  const { owner, api } = fixture({ backgroundBytes: 1 })
  const a = await open(owner, 'a', 'one.txt'); const first = active(a).id
  await open(owner, 'a', 'two.txt'); const second = active(a).id
  owner.prune()
  const before = vi.mocked(api.readText).mock.calls.length
  a.actions.close(second)
  await vi.waitFor(() => expect(active(a).loadState).toBe('ready'))
  expect(active(a).id).toBe(first)
  expect(api.readText).toHaveBeenCalledTimes(before + 1)
})

describe('automatic file refresh', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const advance = (ms = 300) => vi.advanceTimersByTimeAsync(ms)
  const textResult = (text: string): { ok: true; value: FilePreviewTextContent } => ({
    ok: true, value: { text, contentGeneration: 'new', contentVersion: { size: text.length, mtimeMs: 2 } }
  })

  describe('visible content follows changes', () => {
    it.each([false, true])('restores an unscrolled non-first page from its snapshot (preloaded: %s)', async preloaded => {
      const { owner, api } = fixture({}, 'paged_text')
      vi.mocked(api.resolveLine).mockImplementation(async ({ line, expectedGeneration }) => ({
        ok: true, value: { line, offset: line * 10, contentGeneration: expectedGeneration }
      }))
      vi.mocked(api.readPage).mockImplementation(async ({ offset, expectedGeneration }) => ({ ok: true, value: {
        text: 'page body', startOffset: offset, endOffset: offset + 9, startLine: offset ? offset / 10 : 1,
        hasNext: true, hasPrevious: offset > 0, contentGeneration: expectedGeneration, contentVersion: { size: 10000, mtimeMs: 1 }
      } }))
      owner.activate('a'); const a = owner.session('a')
      await a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'large.log#L850' },
        undefined, undefined, { commitOnSuccess: preloaded })
      await advance(0)
      expect(active(a).content).toMatchObject({ kind: 'page', page: { startLine: 850 } })
      expect(active(a).reading).toBeUndefined()
      expect(active(a).file?.target).toMatchObject({ line: 850 })
      const saved = filePreviewSessionStore.get('a')
      owner.dispose()
      const restored = new FilePreviewResources(api)
      resources.push(restored)
      restored.activate('a'); await advance(0)
      expect(active(restored.session('a')).content).toMatchObject({ kind: 'page', page: { startLine: 850 } })
      expect(saved?.tabs[0].reading?.visibleLine).toBe(850)
    })

    it.each(['file.txt', 'note.md', 'code.ts'])('refreshes %s after 300ms without an explicit reload', async name => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', name)
      const first = active(a), usage = a.lastUsed
      vi.mocked(api.readText).mockResolvedValueOnce(textResult('latest body'))
      update('a', [first.previewKey!])
      await advance(299)
      expect(api.reload).not.toHaveBeenCalled()
      await advance(1)
      expect(active(a).content).toMatchObject({ text: 'latest body' })
      expect(active(a).hasExternalUpdate).toBe(false)
      expect(a.lastUsed).toBe(usage)
    })

    it('replaces image bytes and releases the old URL only after display', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', 'picture.png'), first = active(a)
      const revoke = vi.spyOn(URL, 'revokeObjectURL')
      try {
        vi.mocked(api.readBinary).mockResolvedValueOnce({ ok: true, value: {
          bytes: new Uint8Array([4, 5, 6, 7]), mime: 'image/png',
          contentGeneration: 'new', contentVersion: { size: 4, mtimeMs: 2 }
        } })
        update('a', [first.previewKey!]); await advance()
        expect(active(a).content).toMatchObject({ kind: 'image', bytes: 4 })
        expect(active(a).content).not.toEqual(first.content)
        expect(revoke).not.toHaveBeenCalled()
        a.actions.displayed(first.id, active(a).file!.handleId)
        expect(revoke).toHaveBeenCalledWith(first.content?.kind === 'image' ? first.content.url : '')
      } finally { revoke.mockRestore() }
    })

    it('resolves the reading line in new bytes and clamps a shortened file to its final line', async () => {
      const { owner, api, update } = fixture()
      vi.mocked(api.open).mockImplementation(async request => {
        const result = await api.restore(request as import('@contracts').RestoreFilePreviewRequest)
        if (result.ok && result.value.kind === 'file_preview') result.value.file.kind = 'paged_text'
        return result
      })
      vi.mocked(api.reload).mockImplementation(async () => {
        const result = await api.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'large.txt' })
        if (!result.ok || result.value.kind !== 'file_preview') throw new Error('Expected a file')
        return { ok: true, value: result.value.file }
      })
      vi.mocked(api.readPage).mockImplementation(async ({ offset, handleId }) => ({ ok: true, value: {
        text: 'new page', startOffset: offset, endOffset: offset + 8, startLine: offset === 77 ? 850 : offset === 9 ? 3 : 1,
        hasNext: true, hasPrevious: offset > 0, contentGeneration: handleId, contentVersion: { size: 1000, mtimeMs: 2 }
      } }))
      const a = await open(owner, 'a', 'large.txt'), first = active(a)
      a.actions.saveReading(first.id, { visibleLine: 850, pageOffsets: [0, 999], pageIndex: 1, codeScrollTop: 400 })
      vi.mocked(api.resolveLine).mockResolvedValueOnce({ ok: true, value: { offset: 77, line: 850, contentGeneration: 'new' } })
      update('a', [first.previewKey!]); await advance()
      expect(api.resolveLine).toHaveBeenLastCalledWith(expect.objectContaining({ line: 850 }))
      expect(api.readPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 77 }))
      expect(active(a)).toMatchObject({ pageOffsets: [77], pageIndex: 0, reading: { visibleLine: 850, codeScrollTop: 0 } })
      vi.mocked(api.resolveLine).mockResolvedValueOnce({ ok: true, value: { offset: 60, line: 849, contentGeneration: 'new' } })
      await a.actions.changePage(first.id, -1)
      expect(api.readPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 60, maxBytes: 17 }))
      expect(active(a).pageIndex).toBe(0)
      a.actions.saveReading(first.id, { visibleLine: 850 })
      vi.mocked(api.resolveLine)
        .mockResolvedValueOnce({ ok: true, value: { offset: 17, line: 3, contentGeneration: 'short' } })
        .mockResolvedValueOnce({ ok: true, value: { offset: 9, line: 3, contentGeneration: 'short' } })
      update('a', [first.previewKey!]); await advance()
      expect(api.resolveLine).toHaveBeenLastCalledWith(expect.objectContaining({ line: 3 }))
      expect(api.readPage).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 9 }))
      expect(active(a)).toMatchObject({ pageOffsets: [9], pageIndex: 0, reading: { visibleLine: 3 } })
    })
  })

  describe('hidden files refresh when shown', () => {
    it('refreshes the previous tab when a provisional file opens in the system', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', 'one.txt'), first = active(a)
      const systemOpen = deferred<Awaited<ReturnType<FilePreviewApi['open']>>>()
      vi.mocked(api.open).mockReturnValueOnce(systemOpen.promise)
      vi.mocked(api.readText).mockResolvedValueOnce(textResult('updated after rollback'))
      update('a', [first.previewKey!]); await advance(100)
      const opening = a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'external.bin' })
      await advance(0)
      expect(active(a).id).not.toBe(first.id)
      systemOpen.resolve({ ok: true, value: { kind: 'opened_in_system', fileName: 'external.bin' } })
      await opening; await advance(1000)
      expect(active(a).id).toBe(first.id)
      expect(api.reload).toHaveBeenCalledTimes(1)
      expect(active(a).content).toMatchObject({ text: 'updated after rollback' })
    })

    it.each(['tab', 'thread', 'pane', 'open', 'close'] as const)('checks updates on the %s entry', async entry => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', 'one.txt'), first = active(a)
      if (entry === 'thread') await open(owner, 'b')
      else if (entry === 'pane') a.actions.hidePane()
      else await open(owner, 'a', 'two.txt')
      const other = active(a).id
      update('a', [first.previewKey!]); await advance(1000)
      expect(api.reload).not.toHaveBeenCalled()
      if (entry === 'thread') owner.activate('a')
      else if (entry === 'pane') a.actions.showPane()
      else if (entry === 'open') await a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'one.txt' })
      else if (entry === 'close') a.actions.close(other)
      else a.actions.activate(first.id)
      await advance(0)
      expect(api.reload).toHaveBeenCalledTimes(1)
      expect(active(a).id).toBe(first.id)
      expect(active(a).hasExternalUpdate).toBe(false)
    })

    it('recovers a cached file without a handle even without an update notification', async () => {
      const { owner, api } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      a.actions.hidePane(); a.evict(first.id, true, true)
      expect(active(a)).toMatchObject({ file: null, content: first.content, hasExternalUpdate: false })
      await advance(1000)
      expect(api.restore).not.toHaveBeenCalled()
      a.actions.showPane(); await advance(0)
      expect(api.restore).toHaveBeenCalledTimes(1)
      expect(active(a).file).not.toBeNull()
    })

    it.each(['tab', 'thread', 'pane'] as const)('does not read after %s changes during debounce', async entry => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      update('a', [first.previewKey!])
      if (entry === 'tab') a.actions.openExecution()
      else if (entry === 'thread') owner.activate('b')
      else a.actions.hidePane()
      await advance(1000)
      expect(api.reload).not.toHaveBeenCalled()
      expect(a.getSnapshot().tabs.find(tab => tab.id === first.id)).toMatchObject({ hasExternalUpdate: true })
    })

    it.each(['refresh', 'cold'] as const)('rechecks visibility before %s after waiting for resource admission', async mode => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      if (mode === 'cold') a.evict(first.id)
      await owner.sync()
      const admission = deferred<void>()
      vi.mocked(api.updateRetention!).mockImplementation(() => admission.promise)
      update('a', [first.previewKey!])
      if (mode === 'cold') a.actions.showPane()
      await advance()
      if (mode === 'refresh') expect(active(a).isRefreshing).toBe(true)
      else expect(active(a).loadState).toBe('opening')
      a.actions.hidePane()
      vi.mocked(api.updateRetention!).mockResolvedValue(undefined)
      admission.resolve(); await advance(0)
      expect(api.reload).not.toHaveBeenCalled()
      expect(api.restore).not.toHaveBeenCalled()
      expect(active(a)).toMatchObject({ isRefreshing: false, hasExternalUpdate: true, refreshError: null })
      if (mode === 'cold') expect(active(a).loadState).toBe('cold')
      a.actions.showPane(); await advance(0)
      expect(mode === 'refresh' ? api.reload : api.restore).toHaveBeenCalledTimes(1)
    })
  })

  describe('bursts and in-flight changes converge', () => {
    it('waits for the next page before automatically refreshing its new reading position', async () => {
      const { owner, api, update } = fixture({}, 'paged_text')
      const page = (startLine: number) => ({ ok: true as const, value: {
        text: 'page at line ' + startLine, startOffset: startLine === 1 ? 0 : 6, endOffset: startLine === 1 ? 6 : 12,
        startLine, hasNext: startLine === 1, hasPrevious: startLine > 1,
        contentGeneration: 'page', contentVersion: { size: 12, mtimeMs: 1 }
      } })
      vi.mocked(api.readPage).mockResolvedValueOnce(page(1))
      vi.mocked(api.resolveLine).mockResolvedValue({ ok: true, value: { offset: 6, line: 101, contentGeneration: 'new' } })
      const a = await open(owner, 'a', 'large.log'), first = active(a)
      const nextPage = deferred<Awaited<ReturnType<FilePreviewApi['readPage']>>>()
      vi.mocked(api.readPage).mockReturnValueOnce(nextPage.promise).mockResolvedValue(page(101))
      update('a', [first.previewKey!]); await advance(100)
      const paging = a.actions.changePage(first.id, 1)
      await advance(1000)
      expect(api.reload).not.toHaveBeenCalled()
      expect(active(a).requestGeneration).toBe(first.requestGeneration)
      nextPage.resolve(page(101)); await paging
      expect(active(a).content).toMatchObject({ kind: 'page', page: { startLine: 101 } })
      await advance()
      expect(api.reload).toHaveBeenCalledTimes(1)
      expect(api.resolveLine).toHaveBeenLastCalledWith(expect.objectContaining({ line: 101 }))
      expect(active(a)).toMatchObject({ hasExternalUpdate: false, reading: { visibleLine: 101 }, content: { kind: 'page', page: { startLine: 101 } } })
    })

    it('debounces saves and serializes manual and automatic refreshes', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      const read = deferred<Awaited<ReturnType<FilePreviewApi['readText']>>>()
      vi.mocked(api.readText).mockReturnValueOnce(read.promise).mockResolvedValueOnce(textResult('last save'))
      update('a', [first.previewKey!]); await advance(200)
      update('a', [first.previewKey!]); await advance(299)
      expect(api.reload).not.toHaveBeenCalled()
      await advance(1)
      update('a', [first.previewKey!]); update('a', [first.previewKey!])
      await a.actions.reload(first.id); await advance(1000)
      expect(api.reload).toHaveBeenCalledTimes(1)
      expect(active(a).content).toBe(first.content)
      read.resolve(textResult('earlier save')); await advance(0)
      expect(active(a).hasExternalUpdate).toBe(true)
      await advance()
      expect(api.reload).toHaveBeenCalledTimes(2)
      expect(active(a).content).toMatchObject({ text: 'last save' })
      expect(active(a).hasExternalUpdate).toBe(false)
      await advance(1000)
      expect(api.reload).toHaveBeenCalledTimes(2)
    })

    it('checks changes after the first read completes without starting a concurrent read', async () => {
      const { owner, api, update } = fixture()
      owner.activate('a'); const a = owner.session('a')
      const read = deferred<Awaited<ReturnType<FilePreviewApi['readText']>>>()
      vi.mocked(api.readText).mockReturnValueOnce(read.promise).mockResolvedValueOnce(textResult('latest'))
      await a.actions.open({ kind: 'camp_workspace', threadId: 'a', rawReference: 'file.txt' })
      update('a', [active(a).previewKey!]); await advance(1000)
      await a.actions.reload(active(a).id)
      expect(api.reload).not.toHaveBeenCalled()
      read.resolve(textResult('initial')); await advance()
      expect(api.reload).toHaveBeenCalledTimes(1)
      expect(active(a).content).toMatchObject({ text: 'latest' })
    })

    it.each(['Desktop', 'Web'] as const)('skips unchanged %s HTML without discarding an in-flight source read', async platform => {
      const { owner, api, update } = fixture({ htmlInstances: 1 })
      const a = await open(owner, 'a', 'same.html'), first = active(a)
      const source = deferred<Awaited<ReturnType<FilePreviewApi['readText']>>>()
      vi.mocked(api.readText).mockReturnValueOnce(source.promise)
      const reading = a.actions.loadHtmlSource(first.id)
      if (platform === 'Desktop') first.file!.contentVersion.fileId = 'device:file'
      const original = vi.mocked(api.reload).getMockImplementation()!
      let duplicate!: ResolvedFilePreview
      vi.mocked(api.reload).mockImplementation(async request => {
        const result = await original(request)
        if (result.ok) {
          duplicate = result.value
          duplicate.contentVersion = first.file!.contentVersion
          if (platform === 'Web') duplicate.contentGeneration = first.file!.contentGeneration
        }
        return result
      })
      const reserve = vi.spyOn(owner, 'reserveHtml')
      update('a', [first.previewKey!]); await advance(1000)
      expect(active(a)).toMatchObject({ file: first.file, content: first.content, isRefreshing: false, hasExternalUpdate: false, refreshError: null })
      expect(active(a).candidate).toBeUndefined()
      expect(api.prepareHtmlSite).toHaveBeenCalledTimes(1)
      expect(reserve).not.toHaveBeenCalled()
      expect(api.release).toHaveBeenCalledWith({ handleId: duplicate.handleId })
      expect(api.release).not.toHaveBeenCalledWith({ handleId: first.file!.handleId })
      source.resolve(textResult('<p>original source</p>')); await reading
      expect(active(a).htmlSource?.text).toBe('<p>original source</p>')
      expect(api.readText).toHaveBeenCalledTimes(1)
      expect(active(a).requestGeneration).toBe(first.requestGeneration)
    })

    it.each(['digest', 'file identity', 'preview key'] as const)('loads again when the %s differs despite equal size and mtime', async change => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      if (change === 'file identity') first.file!.contentVersion.fileId = 'old-file'
      const original = vi.mocked(api.reload).getMockImplementation()!
      vi.mocked(api.reload).mockImplementation(async request => {
        const result = await original(request)
        if (result.ok) {
          result.value.contentVersion = { ...first.file!.contentVersion }
          if (change === 'file identity') result.value.contentVersion.fileId = 'replacement-file'
          if (change === 'preview key') {
            result.value.contentGeneration = first.file!.contentGeneration
            result.value.previewKey = 'another-file'
          }
        }
        return result
      })
      vi.mocked(api.readText).mockResolvedValueOnce(textResult('changed body'))
      update('a', [first.previewKey!]); await advance()
      expect(api.readText).toHaveBeenCalledTimes(2)
      expect(active(a).content).toMatchObject({ text: 'changed body' })
    })

    it.each(['manual', 'error', 'released handle'] as const)('fully loads the same version for %s recovery', async entry => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      const original = vi.mocked(api.reload).getMockImplementation()!
      const sameVersion = (file: ResolvedFilePreview) => {
        file.contentVersion = first.file!.contentVersion
        file.contentGeneration = first.file!.contentGeneration
        return file
      }
      vi.mocked(api.reload).mockImplementation(async request => {
        const result = await original(request)
        if (result.ok) sameVersion(result.value)
        return result
      })
      if (entry === 'error') {
        vi.mocked(api.reload).mockResolvedValueOnce({ ok: false, error: { code: 'read_failed', message: 'failed', retryable: true } })
        update('a', [first.previewKey!]); await advance()
        expect(active(a).refreshError).toBeTruthy()
      } else if (entry === 'released handle') {
        a.evict(first.id, true, true)
        expect(active(a).file).toBeNull()
        expect(active(a).content).toBe(first.content)
        const restore = vi.mocked(api.restore).getMockImplementation()!
        vi.mocked(api.restore).mockImplementation(async request => {
          const result = await restore(request)
          if (result.ok && result.value.kind === 'file_preview') sameVersion(result.value.file)
          return result
        })
      }
      vi.mocked(api.readText).mockResolvedValueOnce(textResult('reloaded body'))
      if (entry === 'manual') await a.actions.reload(first.id)
      else { a.actions.hidePane(); a.actions.showPane() }
      await advance()
      expect(api.readText).toHaveBeenCalledTimes(2)
      expect(active(a)).toMatchObject({ content: { text: 'reloaded body' }, isRefreshing: false, refreshError: null })
    })

    it('keeps a new notification arriving during an unchanged candidate check', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      const original = vi.mocked(api.reload).getMockImplementation()!
      const result = await original({ handleId: first.file!.handleId, reopenToken: first.file!.reopenToken, expectedGeneration: first.file!.contentGeneration })
      if (!result.ok) throw new Error('candidate expected')
      result.value.contentVersion = first.file!.contentVersion
      result.value.contentGeneration = first.file!.contentGeneration
      const pending = deferred<typeof result>()
      vi.mocked(api.reload).mockReturnValueOnce(pending.promise)
      update('a', [first.previewKey!]); await advance()
      update('a', [first.previewKey!])
      pending.resolve(result); await advance(0)
      expect(active(a).hasExternalUpdate).toBe(true)
      expect(api.readText).toHaveBeenCalledTimes(1)
      vi.mocked(api.readText).mockResolvedValueOnce(textResult('actual later change'))
      await advance()
      expect(api.reload).toHaveBeenCalledTimes(2)
      expect(active(a)).toMatchObject({ content: { text: 'actual later change' }, hasExternalUpdate: false })
    })

    it('prepares a slow HTML version once despite repeated notifications', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', 'page.html'), first = active(a)
      const original = vi.mocked(api.reload).getMockImplementation()!
      let fresh: ResolvedFilePreview | undefined
      vi.mocked(api.reload).mockImplementation(async request => {
        const result = await original(request)
        if (result.ok) {
          fresh ??= result.value
          result.value.contentVersion = fresh.contentVersion
          result.value.contentGeneration = fresh.contentGeneration
        }
        return result
      })
      update('a', [first.previewKey!]); await advance()
      const candidate = active(a).candidate!
      update('a', [first.previewKey!]); await advance(2300)
      expect(api.reload).toHaveBeenCalledTimes(1)
      a.actions.completeHtmlRefresh(first.id, candidate.file.handleId)
      a.actions.displayed(first.id, candidate.file.handleId)
      await advance(1000)
      expect(api.reload).toHaveBeenCalledTimes(2)
      expect(api.prepareHtmlSite).toHaveBeenCalledTimes(2) // Initial page + one new version.
      expect(active(a)).toMatchObject({ file: candidate.file, isRefreshing: false, hasExternalUpdate: false })
      expect(active(a).candidate).toBeUndefined()
      expect(api.release).toHaveBeenCalledWith({ handleId: 'handle-3' })
    })

    it('refreshes saved HTML B after delayed preview A while preserving unsaved editor C', async () => {
      const { owner, api, update } = fixture()
      let disk = '<p>original</p>', version = 0
      const snapshot = () => ({ key: 'editable-page', text: disk, version: String(version) })
      api.readEditableFile = vi.fn(async () => ({ ok: true as const, value: snapshot() }))
      api.saveTextFile = vi.fn(async request => {
        expect(request.expectedVersion).toBe(String(version))
        disk = request.text; version++
        return { ok: true as const, value: snapshot() }
      })
      const prepare = vi.mocked(api.prepareHtmlSite).getMockImplementation()!
      vi.mocked(api.prepareHtmlSite).mockImplementation(async request => {
        const text = disk, result = await prepare(request)
        if (result.ok) result.value.sandboxedDocument = text
        return result
      })
      const a = await open(owner, 'a', 'page.html'), first = active(a)
      await owner.edits.attach(first.id, first.file!)
      const doc = owner.edits.get(first.id)!
      doc.editorState = EditorState.create({ doc: disk, extensions: [history()] })
      const edit = (text: string) => {
        doc.editorState = doc.editorState!.update({ changes: { from: 0, to: doc.editorState!.doc.length, insert: text }, selection: { anchor: 4 } }).state
        owner.edits.change(doc, text)
      }
      edit('<p>A</p>'); expect(await owner.edits.save(doc)).toBe(true); await advance(0)
      const candidateA = active(a).candidate!
      expect(candidateA.loaded.content).toMatchObject({ kind: 'html', preview: { sandboxedDocument: '<p>A</p>' } })
      edit('<p>B</p>'); expect(await owner.edits.save(doc)).toBe(true)
      edit('<p>C</p>'); doc.scrollTop = 80
      const editorC = doc.editorState!, undoCount = undoDepth(editorC)
      expect(undoCount).toBeGreaterThan(0)
      update('a', [first.previewKey!]); await advance()
      expect(api.reload).toHaveBeenCalledTimes(1)
      a.actions.completeHtmlRefresh(first.id, candidateA.file.handleId)
      a.actions.displayed(first.id, candidateA.file.handleId)
      await advance(0)
      expect(api.reload).toHaveBeenCalledTimes(2)
      const candidateB = active(a).candidate!
      expect(candidateB.loaded.content).toMatchObject({ kind: 'html', preview: { sandboxedDocument: '<p>B</p>' } })
      a.actions.completeHtmlRefresh(first.id, candidateB.file.handleId)
      a.actions.displayed(first.id, candidateB.file.handleId)
      await owner.edits.attach(first.id, candidateB.file)
      await advance(1000)
      expect(active(a)).toMatchObject({ content: { kind: 'html', preview: { sandboxedDocument: '<p>B</p>' } }, isRefreshing: false, candidate: undefined })
      expect(disk).toBe('<p>B</p>')
      expect(doc).toMatchObject({ savedText: '<p>B</p>', draft: '<p>C</p>', version: '2', scrollTop: 80 })
      expect(doc.editorState).toBe(editorC)
      expect(doc.editorState!.selection.main.anchor).toBe(4)
      expect(undoDepth(doc.editorState!)).toBe(undoCount)
      expect(api.saveTextFile).toHaveBeenCalledTimes(2)
      expect(api.reload).toHaveBeenCalledTimes(2)
    })

    it('waits for HTML readiness and merges changes while the candidate is loading', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', 'page.html'), first = active(a)
      const source = deferred<Awaited<ReturnType<FilePreviewApi['readText']>>>()
      vi.mocked(api.readText).mockReturnValueOnce(source.promise)
      const reading = a.actions.loadHtmlSource(first.id)
      update('a', [first.previewKey!]); await advance()
      const candidate = active(a).candidate!
      expect(active(a).content).toBe(first.content)
      source.resolve(textResult('<p>old source</p>')); await reading
      expect(active(a).htmlSource).toBeUndefined()
      expect(active(a).requestGeneration).toBe(first.requestGeneration + 1)
      update('a', [first.previewKey!]); await advance(1000)
      expect(api.reload).toHaveBeenCalledTimes(1)
      a.actions.completeHtmlRefresh(first.id, candidate.file.handleId); await advance(0)
      expect(active(a).file).toBe(candidate.file)
      expect(api.release).not.toHaveBeenCalledWith({ handleId: first.file!.handleId })
      a.actions.displayed(first.id, candidate.file.handleId)
      expect(api.release).toHaveBeenCalledWith({ handleId: first.file!.handleId })
      await advance()
      expect(api.reload).toHaveBeenCalledTimes(2)
      a.actions.completeHtmlRefresh(first.id, active(a).candidate!.file.handleId)
      await advance(1000)
      expect(active(a).hasExternalUpdate).toBe(false)
      expect(api.reload).toHaveBeenCalledTimes(2)
    })
  })

  describe('failures and disposal settle', () => {
    it.each(['retry', 'show'] as const)('keeps old content and waits for explicit %s after failure', async entry => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      vi.mocked(api.readText).mockResolvedValueOnce({ ok: false, error: { code: 'file_not_found', message: 'missing', retryable: true } })
      update('a', [first.previewKey!]); await advance()
      expect(active(a).content).toBe(first.content)
      expect(active(a).refreshError).toBeTruthy()
      for (let n = 0; n < 3; n++) { update('a', [first.previewKey!]); await advance(2000) }
      expect(api.reload).toHaveBeenCalledTimes(1)
      if (entry === 'retry') await a.actions.reload(first.id)
      else { a.actions.hidePane(); a.actions.showPane() }
      await advance(0)
      expect(api.reload).toHaveBeenCalledTimes(2)
      expect(active(a).refreshError).toBeNull()
    })

    it('blocks repeated notifications after HTML readiness fails', async () => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a', 'page.html'), first = active(a)
      update('a', [first.previewKey!]); await advance()
      a.actions.completeHtmlRefresh(first.id, active(a).candidate!.file.handleId, 'failed')
      await advance(0)
      update('a', [first.previewKey!]); await advance(5000)
      expect(api.reload).toHaveBeenCalledTimes(1)
      expect(active(a)).toMatchObject({ content: first.content, isRefreshing: false, refreshError: 'failed' })
    })

    it.each(['close', 'evict', 'cool', 'dispose'] as const)('clears the timer on %s', async action => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      update('a', [first.previewKey!])
      if (action === 'close') a.actions.close(first.id)
      else if (action === 'evict') a.evict(first.id)
      else if (action === 'cool') a.cool()
      else owner.dispose()
      await advance(1000)
      expect(api.reload).not.toHaveBeenCalled()
    })

    it.each(['close', 'evict', 'cool', 'dispose'] as const)('releases a late candidate after %s', async action => {
      const { owner, api, update } = fixture()
      const a = await open(owner, 'a'), first = active(a)
      const candidate = deferred<Awaited<ReturnType<FilePreviewApi['reload']>>>()
      vi.mocked(api.reload).mockReturnValueOnce(candidate.promise)
      update('a', [first.previewKey!]); await advance()
      await a.actions.reload(first.id, false, true) // A saved refresh pending behind this read must also be discarded.
      if (action === 'close') a.actions.close(first.id)
      else if (action === 'evict') a.evict(first.id)
      else if (action === 'cool') a.cool()
      else owner.dispose()
      candidate.resolve({ ok: true, value: { ...first.file!, handleId: 'late' } })
      await advance(1000)
      expect(api.release).toHaveBeenCalledWith({ handleId: 'late' })
      expect(api.readText).toHaveBeenCalledTimes(1)
      expect(api.reload).toHaveBeenCalledTimes(1)
    })
  })
})
