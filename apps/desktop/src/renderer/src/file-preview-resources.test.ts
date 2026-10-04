import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilePreviewApi, ResolvedFilePreview, OpenFilePreviewRequest, FilePreviewTextContent } from '@contracts'
import { FilePreviewResources } from './file-preview-resources'
import { filePreviewSessionStore } from './file-preview-session'
import { filePreviewRetentionLimits } from '../../file-preview-retention'
import type { FilePreviewSession, FilePreviewTabModel } from './file-preview-controller'

const resources: FilePreviewResources[] = []
beforeEach(() => { filePreviewSessionStore.clear(); vi.stubGlobal('document', { activeElement: null }) })
afterEach(() => { resources.splice(0).forEach(owner => owner.dispose()); filePreviewSessionStore.clear(); vi.unstubAllGlobals() })

function fixture(limits: Partial<Record<keyof typeof filePreviewRetentionLimits, number>> = {}) {
  let sequence = 0
  const handles = new Map<string, ResolvedFilePreview>()
  const resolve = (request: OpenFilePreviewRequest): ResolvedFilePreview => {
    const name = 'rawReference' in request ? request.rawReference : 'file.txt'
    const id = `handle-${++sequence}`
    const file: ResolvedFilePreview = {
      handleId: id, reopenToken: id, previewKey: `${'threadId' in request ? request.threadId : ''}:${name}`,
      fileName: name, displayPath: name, pathPresentation: 'project_relative', size: 12, mime: name.endsWith('.html') ? 'text/html' : 'text/plain',
      extension: name.endsWith('.html') ? '.html' : '.txt', kind: name.endsWith('.html') ? 'html' : 'text', hasExternalUpdate: false,
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
    readPage: vi.fn(failure), resolveLine: failure, readBinary: failure,
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
    const { owner, api, update } = fixture()
    const a = await open(owner, 'a')
    const first = active(a)
    a.actions.saveReading(first.id, { scrollTop: 320, codeScrollTop: 640 })
    await open(owner, 'b')
    const usage = a.lastUsed
    update('a', [first.previewKey!])
    expect(a.lastUsed).toBe(usage)
    expect(active(a).hasExternalUpdate).toBe(true)
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
