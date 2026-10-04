import { uiAttribute } from './interface-language'
import { parseFileReference } from '../../file-preview-reference'
import { newCommandId } from '../../shared/command-id'
import type { FilePreviewApi, AgentRunFileChangesDetailView, AgentRunFileChangesView, FileLocationTarget, FilePreviewErrorPayload, FilePreviewHtmlSite, FilePreviewOperationResult, FilePreviewPageContent, OpenFilePreviewRequest, OpenFilePreviewResult, ResolvedFilePreview, ResolvedTheme } from '@contracts'
import { prepareHtmlPreviewSite } from './file-preview-html-site'
import { agentRunFileChangeHasReviewableDiff } from './file-changes-presentation'
import { filePreviewPresentationFromFile, filePreviewPresentationFromRequest, filePreviewSessionStore, filePreviewSourceKey, filePreviewTabMatchesResolvedFile, resolvedFilePreviewSource, restorableFilePreviewRequest, stableFilePreviewSourceKey, type FilePreviewPresentation, type FilePreviewPresentationHint, type FilePreviewReadingState, type FilePreviewSessionSnapshot, type FilePreviewTabSnapshot } from './file-preview-session'
export type FilePreviewContent =
  | { kind: 'markdown'; text: string; tabToken: string; assetBasePath: string }
  | { kind: 'code' | 'text' | 'patch'; text: string }
  | { kind: 'html'; preview: FilePreviewHtmlSite }
  | { kind: 'image'; url: string; bytes: number }
  | { kind: 'page'; page: FilePreviewPageContent }

export interface FilePreviewTabModel {
  kind: 'file'
  id: string
  sourceKey: string
  sourceAliases?: string[]
  cachedVersion?: ResolvedFilePreview['contentVersion']
  retainedCapabilities?: ResolvedFilePreview['capabilities']
  sourceRequest: OpenFilePreviewRequest | null
  previewKey: string | null
  presentation: FilePreviewPresentation
  file: ResolvedFilePreview | null
  loadState: 'cold' | 'opening' | 'ready' | 'missing' | 'unavailable' | 'error'
  content: FilePreviewContent | null
  error: FilePreviewErrorPayload | null
  requestGeneration: number
  hasExternalUpdate: boolean
  externalUpdateVersion: number
  isRefreshing: boolean
  refreshError: string | null
  pageOffsets: number[]
  pageIndex: number
  htmlSourceMode?: boolean
  reading?: FilePreviewReadingState
  pages?: Record<number, FilePreviewPageContent>
  htmlSource?: { text: string; page: FilePreviewPageContent | null; offsets: number[]; index: number; pages?: Record<number, { text: string; page: FilePreviewPageContent | null }> }
  candidate?: { file: ResolvedFilePreview; loaded: LoadedFilePreviewContent }

}

export interface FileChangesPreviewTabModel {
  kind: 'file_change'
  id: string
  threadId: string
  changes: AgentRunFileChangesView
  selectedEvidenceFileId: string | null
  reading?: FilePreviewReadingState
  detail?: AgentRunFileChangesDetailView
  detailBytes?: number
  detailStatus?: 'loading' | 'ready' | 'error'
}

export type MissionActivityTabModel = import('./file-preview-session').MissionActivityTabSnapshot
export type ExecutionTabModel = import('./file-preview-session').ExecutionTabSnapshot
export type PreviewTabModel = FilePreviewTabModel | FileChangesPreviewTabModel | MissionActivityTabModel | ExecutionTabModel

export type FilePreviewOpenOutcome =
  | { kind: 'preview'; tabId: string }
  | { kind: 'system' }
  | { kind: 'evidence_review'; result: Extract<OpenFilePreviewResult, { kind: 'evidence_review' }> }
  | { kind: 'error'; error: FilePreviewErrorPayload }

export interface FilePreviewOpenFeedback {
  tabId: string
  sequence: number
  isNew: boolean
  focusTab?: boolean
}

interface FilePreviewViewRollback {
  activeTabId: string | null
  paneVisible: boolean
}

export interface FilePreviewOpenOptions {
  commitOnSuccess?: boolean
  previewOnly?: boolean
}

export interface FilePreviewContextValue {
  isCurrentThread?: boolean
  tabs: PreviewTabModel[]
  activeTab: PreviewTabModel | null
  activeTabId: string | null
  openFeedback: FilePreviewOpenFeedback | null
  paneVisible: boolean
  resolvedTheme: ResolvedTheme
  open(
    request: OpenFilePreviewRequest,
    target?: FileLocationTarget,
    presentation?: FilePreviewPresentationHint,
    options?: FilePreviewOpenOptions
  ): Promise<FilePreviewOpenOutcome>
  openFileChanges(threadId: string, changes: AgentRunFileChangesView, evidenceFileId?: string): string | undefined
  syncFileChanges(threadId: string, changes: readonly AgentRunFileChangesView[]): void
  openMissionActivity(missionId: string): void
  openExecution(): void
  loadChanges(tabId: string, read: () => Promise<AgentRunFileChangesDetailView>, retry?: boolean): Promise<void>
  selectChangedFile(tabId: string, evidenceFileId: string): void
  showPane(): void
  hidePane(): void
  activate(tabId: string): void
  move(tabId: string, direction: -1 | 1): void
  close(tabId: string): void
  closeMany(tabIds: string[]): void
  download(tabId: string): Promise<FilePreviewOperationResult<{ started: true }>>
  openInSystem(tabId: string): Promise<FilePreviewOperationResult<{ opened: true }>>
  revealInFolder(tabId: string): Promise<FilePreviewOperationResult<{ revealed: true }>>
  copyPath(tabId: string): Promise<FilePreviewOperationResult<{ copied: true }>>
  toggleHtmlSource(tabId: string): void
  reload(tabId: string): Promise<void>
  reopen(tabId: string): Promise<void>
  retry(tabId: string): Promise<void>
  changePage(tabId: string, direction: -1 | 1): Promise<void>
  saveReading(tabId: string, state: Partial<FilePreviewReadingState>): void
  loadHtmlSource(tabId: string, index?: number): Promise<void>
  saveHtmlSource(tabId: string, value: FilePreviewTabModel['htmlSource']): void
  completeHtmlRefresh(tabId: string, handleId: string, error?: string): void
  displayed(tabId: string, handleId: string): void
}

function errorFromUnknown(): FilePreviewErrorPayload {
  return {
    code: 'read_failed',
    message: uiAttribute('暂时无法读取文件'),
    retryable: true
  }
}

export function filePreviewErrorMessage(error: Pick<FilePreviewErrorPayload, 'code'>): string {
  switch (error.code) {
    case 'preview_timeout': return uiAttribute('未收到预览服务响应，请重试。')
    case 'file_not_found': return uiAttribute('找不到这个文件')
    case 'attachment_missing': return uiAttribute('找不到这个附件')
    case 'source_not_authorized':
    case 'authorization_required':
    case 'outside_authorized_root': return uiAttribute('文件访问已失效')
    case 'evidence_identity_unavailable': return uiAttribute('无法定位这个历史记录对应的当前文件')
    case 'read_failed': return uiAttribute('暂时无法读取文件')
    case 'attachment_unreadable': return uiAttribute('暂时无法读取这个附件')
    case 'attachment_kind_changed': return uiAttribute('这个附件的类型已变化')
    case 'decode_failed': return uiAttribute('无法读取这个文件的内容')
    case 'file_too_large': return uiAttribute('这个文件太大，无法预览')
    case 'too_many_open_files': return uiAttribute('打开的文件太多')
    case 'not_regular_file':
    case 'reference_not_clickable': return uiAttribute('无法在这里预览这个文件')
    case 'open_failed': return uiAttribute('暂时无法打开这个文件')
    case 'reveal_failed': return uiAttribute('暂时无法显示这个文件的位置')
  }
}

function safeOpenError(error: FilePreviewErrorPayload): FilePreviewErrorPayload {
  return {
    code: error.code,
    message: filePreviewErrorMessage(error),
    retryable: error.retryable
  }
}

function errorLoadState(
  error: FilePreviewErrorPayload
): FilePreviewTabModel['loadState'] {
  if (error.code === 'file_not_found' || error.code === 'attachment_missing') return 'missing'
  if (['authorization_required', 'outside_authorized_root', 'source_not_authorized'].includes(error.code)) {
    return 'unavailable'
  }
  return 'error'
}

function unavailableSourceError(): FilePreviewErrorPayload {
  return {
    code: 'source_not_authorized',
    message: uiAttribute('文件访问已失效'),
    retryable: false
  }
}

function restoredTab(snapshot: FilePreviewTabSnapshot): PreviewTabModel {
  if (snapshot.kind !== 'file') return { ...snapshot }
  const restorable = snapshot.sourceRequest !== null
  return {
    kind: 'file',
    id: snapshot.id,
    sourceKey: snapshot.sourceRequest
      ? stableFilePreviewSourceKey(snapshot.sourceRequest, snapshot.presentation)
      : `unavailable:${snapshot.id}`,
    sourceRequest: snapshot.sourceRequest,
    previewKey: null,
    presentation: snapshot.presentation,
    file: null,
    loadState: restorable ? 'cold' : 'unavailable',
    content: null,
    error: restorable ? null : unavailableSourceError(),
    requestGeneration: 0,
    hasExternalUpdate: false,
    externalUpdateVersion: 0,
    isRefreshing: false,
    refreshError: null,
    pageOffsets: snapshot.reading?.pageOffsets ?? [],
    pageIndex: snapshot.reading?.pageIndex ?? 0,
    reading: snapshot.reading,
    htmlSourceMode: snapshot.reading?.htmlSourceMode
  }
}

type LoadedFilePreviewContent = {
  content: FilePreviewContent
  pageOffsets: number[]
  pageIndex: number
}
export interface PreviewSessionOwner {
  admit(session: FilePreviewSession): boolean
  changed(): void
  touch(session: FilePreviewSession, tabId?: string): void
  isCurrent(threadId: string): boolean
  sync(): Promise<void>
  reserveHtml(session: FilePreviewSession, tabId: string): Promise<(() => void) | null>
}
export type FilePreviewSession = ReturnType<typeof createFilePreviewSession>
export function createFilePreviewSession(api: FilePreviewApi, threadId: string, owner: PreviewSessionOwner) {
  const id = newCommandId()
  const initial = filePreviewSessionStore.get(threadId)
  const tabsRef = { current: initial?.tabs.map(restoredTab) ?? [] as PreviewTabModel[] }
  const activeTabIdRef = { current: initial?.activeTabId ?? null as string | null }
  const paneVisibleRef = { current: initial?.paneVisible ?? false }
  const campIdRef = { current: threadId }
  const scopeGenerationRef = { current: 0 }
  const bindingPromiseRef = { current: Promise.resolve() }
  const objectUrls = { current: new Set<string>() }
  let disposed = false
  let openFeedback: FilePreviewOpenFeedback | null = null
  const retired = new Map<string, { file: ResolvedFilePreview | null; content: FilePreviewContent | null }>()
  const refreshDone = new Map<string, () => void>()
  const committedLoads = new Set<symbol>()
  let snapshot: { tabs: PreviewTabModel[]; activeTabId: string | null; paneVisible: boolean; openFeedback: FilePreviewOpenFeedback | null } = { tabs: tabsRef.current, activeTabId: activeTabIdRef.current, paneVisible: paneVisibleRef.current, openFeedback }
  const notify = (): void => {
    if (disposed) return
    snapshot = { tabs: tabsRef.current, activeTabId: activeTabIdRef.current, paneVisible: paneVisibleRef.current, openFeedback }
    saveSession(threadId)
    owner.changed()
  }
  const setTabs = (update: (tabs: PreviewTabModel[]) => PreviewTabModel[]): void => { tabsRef.current = update(tabsRef.current); notify() }
  const setActiveTabId = (value: string | null): void => { activeTabIdRef.current = value; notify() }
  const setPaneVisible = (value: boolean): void => { paneVisibleRef.current = value; notify() }
  const setOpenFeedback = (update: (value: FilePreviewOpenFeedback | null) => FilePreviewOpenFeedback | null): void => { openFeedback = update(openFeedback); notify() }
  const revokeContent = (content: FilePreviewContent | null) => {
    if (content?.kind === 'html') void api.releaseHtmlSite({ previewId: content.preview.previewId }).catch(() => undefined)
    if (content?.kind !== 'image') return
    URL.revokeObjectURL(content.url)
    objectUrls.current.delete(content.url)
  }

  const saveSession = (targetThreadId: string) => {
    const snapshot: FilePreviewSessionSnapshot = {
      tabs: tabsRef.current.map((tab) => tab.kind === 'mission_activity' || tab.kind === 'execution' ? { ...tab } : tab.kind === 'file_change'
        ? { kind: 'file_change', id: tab.id, threadId: tab.threadId, changes: tab.changes, selectedEvidenceFileId: tab.selectedEvidenceFileId, reading: tab.reading }
        : {
          kind: 'file',
          id: tab.id,
          sourceRequest: tab.sourceRequest
            ? restorableFilePreviewRequest(tab.sourceRequest)
            : null,
          presentation: tab.presentation,
          reading: tab.reading || tab.content || tab.pageOffsets.length ? { ...tab.reading, pageOffsets: tab.pageOffsets, pageIndex: tab.pageIndex, htmlSourceMode: tab.htmlSourceMode } : undefined
        }),
      activeTabId: activeTabIdRef.current,
      paneVisible: paneVisibleRef.current
    }
    filePreviewSessionStore.set(targetThreadId, snapshot)
  }

  const loadContent = async (file: ResolvedFilePreview, reading?: FilePreviewReadingState): Promise<
    { ok: true; content: FilePreviewContent; pageOffsets: number[]; pageIndex: number }
    | { ok: false; error: FilePreviewErrorPayload }
  > => {
    const request = { handleId: file.handleId, expectedGeneration: file.contentGeneration }
    try {
      if (file.kind === 'image') {
        const result = await api.readBinary(request)
        if (!result.ok) return result
        const bytes = Uint8Array.from(result.value.bytes)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.mime }))
        objectUrls.current.add(url)
        return { ok: true, content: { kind: 'image', url, bytes: result.value.bytes.byteLength }, pageOffsets: [], pageIndex: 0 }
      }
      if (file.kind === 'html') {
        const result = await prepareHtmlPreviewSite(api, request)
        return result.ok
          ? {
            ok: true,
            content: {
              kind: 'html',
              preview: result.value
            },
            pageOffsets: [],
            pageIndex: 0
          }
          : result
      }
      if (file.kind === 'markdown') {
        if (!file.capabilities.includes('preview_asset')) {
          const result = await api.readText(request)
          return result.ok
            ? { ok: true, content: { kind: 'markdown', text: result.value.text, tabToken: '', assetBasePath: '' }, pageOffsets: [], pageIndex: 0 }
            : result
        }
        const result = await api.prepareHtml(request)
        return result.ok
          ? {
            ok: true,
            content: {
              kind: 'markdown',
              text: result.value.html,
              tabToken: result.value.tabToken,
              assetBasePath: result.value.assetBasePath
            },
            pageOffsets: [],
            pageIndex: 0
          }
          : result
      }
      if (file.kind === 'paged_text') {
        let offset = reading?.pageOffsets?.[reading.pageIndex ?? 0] ?? 0
        if (!reading && file.target?.line && file.target.line > 1) {
          const resolved = await api.resolveLine({
            ...request,
            line: file.target.line
          })
          if (!resolved.ok) return resolved
          offset = resolved.value.offset
        }
        const result = await api.readPage({ ...request, offset })
        return result.ok
          ? { ok: true, content: { kind: 'page', page: result.value }, pageOffsets: reading?.pageOffsets ?? [offset], pageIndex: reading?.pageIndex ?? 0 }
          : result
      }
      const result = await api.readText(request)
      if (!result.ok) return result
      if (file.kind === 'svg') {
        const url = URL.createObjectURL(new Blob([result.value.text], { type: 'image/svg+xml' }))
        objectUrls.current.add(url)
        return { ok: true, content: { kind: 'image', url, bytes: result.value.text.length * 2 }, pageOffsets: [], pageIndex: 0 }
      }
      return {
        ok: true,
        content: { kind: file.kind, text: result.value.text },
        pageOffsets: [],
        pageIndex: 0
      }
    } catch {
      return { ok: false, error: errorFromUnknown() }
    }
  }

  const finishOpening = async (
    tabId: string,
    file: ResolvedFilePreview,
    scopeGeneration: number,
    requestGeneration: number
  ): Promise<void> => {
    const before = tabsRef.current.find(tab => tab.id === tabId)
    const reservation = file.kind === 'html' ? await owner.reserveHtml(session, tabId) : () => undefined
    const loaded = reservation ? await loadContent(file, before?.kind === 'file' ? before.reading : undefined)
      : { ok: false as const, error: { code: 'too_many_open_files' as const, message: uiAttribute('预览资源不足'), retryable: true } }
    reservation?.()
    const current = tabsRef.current.find((tab) => tab.id === tabId)
    if (
      scopeGenerationRef.current !== scopeGeneration
      || current?.kind !== 'file'
      || current.requestGeneration !== requestGeneration
      || current.file?.handleId !== file.handleId
    ) {
      if (loaded.ok) revokeContent(loaded.content)
      void api.release({ handleId: file.handleId })
      return
    }
    setTabs((entries) => entries.map((tab) => tab.kind !== 'file' || tab.id !== tabId
      ? tab
      : loaded.ok
        ? {
          ...tab,
          loadState: 'ready',
          content: loaded.content,
          error: null,
          pageOffsets: loaded.pageOffsets,
          pageIndex: loaded.pageIndex,
          pages: loaded.content.kind === 'page' ? { [loaded.content.page.startOffset]: loaded.content.page } : undefined
        }
        : {
          ...tab,
          loadState: errorLoadState(loaded.error),
          error: safeOpenError(loaded.error)
        }))
  }

  const showOpenedTab = (tabId: string, isNew: boolean, focusTab = false) => {
    if (!owner.isCurrent(threadId)) return
    setActiveTabId(tabId)
    setPaneVisible(true)
    setOpenFeedback((previous) => ({ tabId, sequence: (previous?.sequence ?? 0) + 1, isNew, focusTab }))
  }

  const openFileChanges = (
    targetThreadId: string,
    changes: AgentRunFileChangesView,
    evidenceFileId?: string
  ) => {
    if (targetThreadId !== campIdRef.current) return
    const id = `file-change:${encodeURIComponent(targetThreadId)}:${encodeURIComponent(changes.agentRunId)}:${changes.executionEpoch}`
    const existing = tabsRef.current.find((tab) => tab.id === id)
    if (existing?.kind === 'file_change'
      && ((changes.revision ?? 0) < (existing.changes.revision ?? 0)
        || ((changes.revision ?? 0) === (existing.changes.revision ?? 0)
          && (changes.sourceChangeSequence ?? 0) < (existing.changes.sourceChangeSequence ?? 0)))) {
      showOpenedTab(id, false)
      return id
    }
    const projectionChanged = existing?.kind === 'file_change'
      && ((existing.changes.revision ?? 0) !== (changes.revision ?? 0)
        || (existing.changes.sourceChangeSequence ?? 0) !== (changes.sourceChangeSequence ?? 0))
    const previousSelection = existing?.kind === 'file_change' ? existing.selectedEvidenceFileId : null
    const previousFile = changes.files.find((file) => file.evidenceFileId === previousSelection)
    const selectedFile = changes.files.find((file) => file.evidenceFileId === evidenceFileId)
      ?? (previousFile && agentRunFileChangeHasReviewableDiff(previousFile) ? previousFile : undefined)
      ?? changes.files.find(agentRunFileChangeHasReviewableDiff)
      ?? changes.files[0]
    const selectedEvidenceFileId = selectedFile?.evidenceFileId ?? null
    const tab: FileChangesPreviewTabModel = {
      ...(existing?.kind === 'file_change' ? existing : {}),
      kind: 'file_change', id, threadId: targetThreadId, changes, selectedEvidenceFileId,
      ...(projectionChanged ? { detail: undefined, detailBytes: undefined, detailStatus: undefined } : {})
    }
    setTabs((current) => existing ? current.map((entry) => entry.id === id ? tab : entry) : [...current, tab])
    owner.touch(session, id)
    showOpenedTab(id, !existing)
    return id
  }

  const selectChangedFile = (tabId: string, evidenceFileId: string) => {
    setTabs((current) => current.map((tab) => tab.id === tabId && tab.kind === 'file_change'
      && tab.changes.files.some((file) => file.evidenceFileId === evidenceFileId)
      ? { ...tab, selectedEvidenceFileId: evidenceFileId }
      : tab))
  }

  const syncFileChanges = (targetThreadId: string, changes: readonly AgentRunFileChangesView[]): void => {
    if (targetThreadId !== campIdRef.current) return
    const byRun = new Map(changes.map(item => [`${item.agentRunId}:${item.executionEpoch}`, item]))
    setTabs(current => {
      let changed = false
      const nextTabs = current.map(tab => {
      if (tab.kind !== 'file_change' || tab.threadId !== targetThreadId) return tab
      const next = byRun.get(`${tab.changes.agentRunId}:${tab.changes.executionEpoch}`)
      if (!next
        || (next.revision ?? 0) < (tab.changes.revision ?? 0)
        || ((next.revision ?? 0) === (tab.changes.revision ?? 0)
          && (next.sourceChangeSequence ?? 0) < (tab.changes.sourceChangeSequence ?? 0))) return tab
      const projectionChanged = (next.revision ?? 0) > (tab.changes.revision ?? 0)
        || (next.sourceChangeSequence ?? 0) > (tab.changes.sourceChangeSequence ?? 0)
      if (!projectionChanged && next.isStale === tab.changes.isStale) return tab
      changed = true
      const selectedEvidenceFileId = next.files.some(file => file.evidenceFileId === tab.selectedEvidenceFileId)
        ? tab.selectedEvidenceFileId
        : next.files.find(agentRunFileChangeHasReviewableDiff)?.evidenceFileId
          ?? next.files[0]?.evidenceFileId ?? null
      return {
        ...tab,
        changes: next,
        selectedEvidenceFileId,
        ...(projectionChanged
          ? { detail: undefined, detailBytes: undefined, detailStatus: undefined }
          : {})
      }
      })
      return changed ? nextTabs : current
    })
  }

  const failTabRequest = (
    tabId: string,
    scopeGeneration: number,
    requestGeneration: number,
    rawError: FilePreviewErrorPayload
  ): FilePreviewErrorPayload => {
    const error = safeOpenError(rawError)
    const current = tabsRef.current.find((tab) => tab.id === tabId)
    if (
      scopeGenerationRef.current !== scopeGeneration
      || current?.kind !== 'file'
      || current.requestGeneration !== requestGeneration
    ) return error
    revokeContent(current.content)
    if (current.file) void api.release({ handleId: current.file.handleId })
    setTabs((entries) => entries.map((tab) => tab.kind === 'file' && tab.id === tabId
      ? {
        ...tab,
        file: null,
        loadState: errorLoadState(error),
        content: null,
        error,
        hasExternalUpdate: false,
        isRefreshing: false,
        refreshError: null,
        pageOffsets: [],
        pageIndex: 0
      }
      : tab))
    return error
  }

  const installResolvedFile = (
    requestedTabId: string,
    request: OpenFilePreviewRequest,
    file: ResolvedFilePreview,
    scopeGeneration: number,
    requestGeneration: number,
    isNew: boolean,
    focusTab: boolean,
    showFeedback: boolean,
    preloaded: LoadedFilePreviewContent | null = null
  ): FilePreviewOpenOutcome => {
    const requestedTab = tabsRef.current.find((tab) => tab.id === requestedTabId)
    if (
      scopeGenerationRef.current !== scopeGeneration
      || requestedTab?.kind !== 'file'
      || requestedTab.requestGeneration !== requestGeneration
    ) {
      if (preloaded) revokeContent(preloaded.content)
      void api.release({ handleId: file.handleId })
      return { kind: 'error', error: unavailableSourceError() }
    }

    const resolvedSource = resolvedFilePreviewSource(request, file)
    const duplicate = tabsRef.current.find((tab) => tab.kind === 'file'
      && tab.id !== requestedTabId
      && filePreviewTabMatchesResolvedFile(tab, file, resolvedSource.sourceKey)
    ) as FilePreviewTabModel | undefined
    if (duplicate?.content) {
      if (preloaded) revokeContent(preloaded.content)
      void api.release({ handleId: file.handleId })
      setTabs(tabs => tabs.filter(tab => tab.id !== requestedTabId).map(tab => tab.id === duplicate.id
        ? {
          ...duplicate, sourceAliases: [...new Set([...(duplicate.sourceAliases ?? []), filePreviewSourceKey(request)])],
          ...(file.target ? { file: duplicate.file ? { ...duplicate.file, target: file.target } : null, reading: undefined } : {})
        } : tab))
      if (activeTabIdRef.current === requestedTabId) showOpenedTab(duplicate.id, false, focusTab)
      return { kind: 'preview', tabId: duplicate.id }
    }
    const targetTabId = duplicate?.id ?? requestedTabId
    const targetRequestGeneration = duplicate
      ? duplicate.requestGeneration + 1
      : requestGeneration
    const replaced = duplicate ?? requestedTab
    const installedSource = resolvedFilePreviewSource(
      request,
      file,
      duplicate?.sourceRequest
    )
    if (replaced.file?.handleId !== file.handleId) {
      if (replaced.file) void api.release({ handleId: replaced.file.handleId })
      revokeContent(replaced.content)
    }
    if (duplicate) {
      revokeContent(requestedTab.content)
      if (requestedTab.file) void api.release({ handleId: requestedTab.file.handleId })
    }

    setTabs((entries) => entries
      .filter((tab) => !duplicate || tab.id !== requestedTabId)
      .map((tab) => tab.kind === 'file' && tab.id === targetTabId
        ? {
          ...tab,
          sourceKey: installedSource.sourceKey,
          sourceAliases: [...new Set([...(tab.sourceAliases ?? []), filePreviewSourceKey(request)])],
          sourceRequest: installedSource.sourceRequest,
          previewKey: file.previewKey,
          presentation: filePreviewPresentationFromFile(file),
          file,
          loadState: preloaded ? 'ready' : 'opening',
          content: preloaded?.content ?? null,
          error: null,
          requestGeneration: targetRequestGeneration,
          hasExternalUpdate: file.hasExternalUpdate,
          externalUpdateVersion: file.hasExternalUpdate ? tab.externalUpdateVersion + 1 : tab.externalUpdateVersion,
          isRefreshing: false,
          refreshError: null,
          pageOffsets: preloaded?.pageOffsets ?? [],
          pageIndex: preloaded?.pageIndex ?? 0
        }
        : tab))
    if (showFeedback && activeTabIdRef.current === requestedTabId) showOpenedTab(targetTabId, isNew && !duplicate, focusTab)

    if (!preloaded) {
      void finishOpening(targetTabId, file, scopeGeneration, targetRequestGeneration)
    }
    return { kind: 'preview', tabId: targetTabId }
  }

  const beginFileTabRequest = (
    tabId: string,
    request: OpenFilePreviewRequest
  ): number | null => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file') return null
    const requestGeneration = tab.requestGeneration + 1
    setTabs((entries) => entries.map((entry) => entry.kind === 'file' && entry.id === tabId
      ? {
        ...entry,
        sourceRequest: request,
        loadState: 'opening',
        error: null,
        requestGeneration,
        isRefreshing: false,
        refreshError: null
      }
      : entry))
    return requestGeneration
  }

  const removeProvisionalTab = (
    tabId: string,
    scopeGeneration: number,
    requestGeneration: number,
    rollback?: FilePreviewViewRollback
  ): void => {
    const current = tabsRef.current.find((entry) => entry.id === tabId)
    if (
      scopeGenerationRef.current !== scopeGeneration
      || current?.kind !== 'file'
      || current.requestGeneration !== requestGeneration
    ) return
    const remaining = tabsRef.current.filter((entry) => entry.id !== tabId)
    const wasActive = activeTabIdRef.current === tabId
    const wasVisible = paneVisibleRef.current
    setTabs(() => remaining)
    if (!wasActive) return
    const nextActiveTabId = rollback?.activeTabId
      && remaining.some((entry) => entry.id === rollback.activeTabId)
      ? rollback.activeTabId
      : remaining.at(-1)?.id ?? null
    setActiveTabId(nextActiveTabId)
    if (wasVisible) setPaneVisible(rollback?.paneVisible ?? remaining.length > 0)
  }

  const performOpen = async (
    tabId: string,
    request: OpenFilePreviewRequest,
    target: FileLocationTarget | undefined,
    mode: 'interactive' | 'restore',
    isNew: boolean,
    focusTab: boolean,
    showFeedback = true,
    rollback?: FilePreviewViewRollback
  ): Promise<FilePreviewOpenOutcome> => {
    const scopeGeneration = scopeGenerationRef.current
    const admitted = owner.admit(session)
    const requestGeneration = beginFileTabRequest(tabId, request)
    if (requestGeneration === null) return { kind: 'error', error: unavailableSourceError() }
    try {
      if (!admitted) throw new Error('Preview capacity exhausted')
      await bindingPromiseRef.current
      await owner.sync()
      if (scopeGenerationRef.current !== scopeGeneration) {
        return { kind: 'error', error: unavailableSourceError() }
      }
      let result: FilePreviewOperationResult<OpenFilePreviewResult>
      if (mode === 'restore') {
        const restoreRequest = restorableFilePreviewRequest(request)
        if (!restoreRequest) {
          return {
            kind: 'error',
            error: failTabRequest(tabId, scopeGeneration, requestGeneration, unavailableSourceError())
          }
        }
        result = await api.restore(restoreRequest)
      } else {
        result = await api.open(request)
      }
      if (!result.ok) {
        return { kind: 'error', error: failTabRequest(tabId, scopeGeneration, requestGeneration, result.error) }
      }
      if (result.value.kind === 'file_preview') {
        const file = target ? { ...result.value.file, target } : result.value.file
        return installResolvedFile(
          tabId,
          request,
          file,
          scopeGeneration,
          requestGeneration,
          isNew,
          focusTab,
          showFeedback
        )
      }
      if (result.value.kind === 'opened_in_system') {
        if (isNew) {
          removeProvisionalTab(tabId, scopeGeneration, requestGeneration, rollback)
        } else {
          failTabRequest(tabId, scopeGeneration, requestGeneration, {
            code: 'reference_not_clickable',
            message: uiAttribute('无法在这里预览这个文件'),
            retryable: false
          })
        }
        return { kind: 'system' }
      }
      if (isNew) {
        removeProvisionalTab(tabId, scopeGeneration, requestGeneration, rollback)
      }
      return { kind: 'evidence_review', result: result.value }
    } catch {
      const error = failTabRequest(tabId, scopeGeneration, requestGeneration, errorFromUnknown())
      return { kind: 'error', error }
    }
  }

  const performCommittedOpen = async (
    request: OpenFilePreviewRequest,
    target: FileLocationTarget | undefined,
    presentationHint: FilePreviewPresentationHint | undefined,
    previewOnly: boolean
  ): Promise<FilePreviewOpenOutcome> => {
    const interaction = session.lastUsed
    const scopeGeneration = scopeGenerationRef.current
    if (!owner.admit(session)) return { kind: 'error', error: { code: 'too_many_open_files', message: uiAttribute('预览资源不足'), retryable: true } }
    const load = Symbol()
    committedLoads.add(load)
    owner.changed()
    try {
      if (disposed) throw new Error('Preview capacity exhausted')
      await bindingPromiseRef.current
      await owner.sync()
      if (scopeGenerationRef.current !== scopeGeneration) {
        return { kind: 'error', error: unavailableSourceError() }
      }
      let result: FilePreviewOperationResult<OpenFilePreviewResult>
      if (previewOnly) {
        const restoreRequest = restorableFilePreviewRequest(request)
        if (!restoreRequest) return { kind: 'error', error: unavailableSourceError() }
        result = await api.restore(restoreRequest)
      } else {
        result = await api.open(request)
      }
      if (!result.ok) return { kind: 'error', error: safeOpenError(result.error) }
      if (result.value.kind === 'opened_in_system') return { kind: 'system' }
      if (result.value.kind === 'evidence_review') {
        return { kind: 'evidence_review', result: result.value }
      }

      const file = target ? { ...result.value.file, target } : result.value.file
      const reservation = file.kind === 'html' ? await owner.reserveHtml(session, '') : () => undefined
      if (!reservation) { void api.release({ handleId: file.handleId }); return { kind: 'error', error: { code: 'too_many_open_files', message: uiAttribute('预览资源不足'), retryable: true } } }
      const loaded = await loadContent(file)
      reservation()
      if (!loaded.ok) {
        void api.release({ handleId: file.handleId })
        return { kind: 'error', error: safeOpenError(loaded.error) }
      }
      if (scopeGenerationRef.current !== scopeGeneration) {
        revokeContent(loaded.content)
        void api.release({ handleId: file.handleId })
        return { kind: 'error', error: unavailableSourceError() }
      }

      const tabId = `file-preview-${newCommandId()}`
      const tab: FilePreviewTabModel = {
        kind: 'file',
        id: tabId,
        sourceKey: filePreviewSourceKey(request),
        sourceRequest: request,
        previewKey: null,
        presentation: filePreviewPresentationFromRequest(request, presentationHint),
        file: null,
        loadState: 'cold',
        content: null,
        error: null,
        requestGeneration: 0,
        hasExternalUpdate: false,
        externalUpdateVersion: 0,
        isRefreshing: false,
        refreshError: null,
        pageOffsets: [],
        pageIndex: 0
      }
      setTabs((entries) => [...entries, tab])
      if (owner.isCurrent(threadId) && session.lastUsed === interaction) showOpenedTab(tabId, true)
      return installResolvedFile(
        tabId,
        request,
        file,
        scopeGeneration,
        0,
        true,
        Boolean(document.activeElement?.closest('.file-preview-pane')),
        owner.isCurrent(threadId) && session.lastUsed === interaction,
        loaded
      )
    } catch {
      return { kind: 'error', error: errorFromUnknown() }
    } finally { committedLoads.delete(load); owner.changed() }
  }

  const committedRequests = new Map<string, Promise<FilePreviewOpenOutcome>>()
  const open = async (
    request: OpenFilePreviewRequest,
    target?: FileLocationTarget,
    presentationHint?: FilePreviewPresentationHint,
    options?: FilePreviewOpenOptions
  ): Promise<FilePreviewOpenOutcome> => {
    target ??= 'rawReference' in request ? parseFileReference(request.rawReference)?.target : undefined
    if (!threadId || !owner.isCurrent(threadId)) return { kind: 'error', error: unavailableSourceError() }
    const cached = tabsRef.current.find(tab => tab.kind === 'file' && (tab.sourceKey === filePreviewSourceKey(request) || tab.sourceAliases?.includes(filePreviewSourceKey(request))))
    owner.touch(session, cached?.id)
    if (cached?.kind === 'file' && (cached.content || cached.loadState === 'opening')) {
      if (target && cached.file) setTabs(tabs => tabs.map(tab => tab.id === cached.id
        ? { ...cached, file: { ...cached.file!, target }, reading: undefined } : tab))
      showOpenedTab(cached.id, false)
      return { kind: 'preview', tabId: cached.id }
    }
    if (request.kind === 'run_evidence' && request.action === 'review') {
      try {
        await bindingPromiseRef.current
        await owner.sync()
        const result = await api.open(request)
        if (!result.ok) return { kind: 'error', error: safeOpenError(result.error) }
        if (result.value.kind === 'evidence_review') return { kind: 'evidence_review', result: result.value }
        return result.value.kind === 'opened_in_system'
          ? { kind: 'system' }
          : { kind: 'preview', tabId: result.value.file.previewKey }
      } catch {
        return { kind: 'error', error: errorFromUnknown() }
      }
    }
    if (options?.commitOnSuccess === true) {
      const key = `${filePreviewSourceKey(request)}:${options.previewOnly === true}`
      const pending = committedRequests.get(key)
      if (pending) return pending
      const operation = performCommittedOpen(request, target, presentationHint, options.previewOnly === true)
        .finally(() => committedRequests.delete(key))
      committedRequests.set(key, operation)
      return operation
    }
    const sourceKey = filePreviewSourceKey(request)
    const existing = tabsRef.current.find((tab) => tab.kind === 'file' && tab.sourceKey === sourceKey)
    const isNew = !existing
    const tabId = existing?.id ?? `file-preview-${newCommandId()}`
    const rollback = isNew
      ? { activeTabId: activeTabIdRef.current, paneVisible: paneVisibleRef.current }
      : undefined
    if (!existing) {
      const presentation = filePreviewPresentationFromRequest(request, presentationHint)
      const tab: FilePreviewTabModel = {
        kind: 'file',
        id: tabId,
        sourceKey,
        sourceRequest: request,
        previewKey: null,
        presentation,
        file: null,
        loadState: 'cold',
        content: null,
        error: null,
        requestGeneration: 0,
        hasExternalUpdate: false,
        externalUpdateVersion: 0,
        isRefreshing: false,
        refreshError: null,
        pageOffsets: [],
        pageIndex: 0
      }
      setTabs((entries) => [...entries, tab])
    }
    owner.touch(session, tabId)
    const focusTab = Boolean(document.activeElement?.closest('.file-preview-pane'))
    showOpenedTab(tabId, isNew, focusTab)
    return performOpen(tabId, request, target, 'interactive', isNew, focusTab, true, rollback)
  }

  const restoreTab = (tabId: string, automatic: boolean): void => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || !tab.sourceRequest) return
    if (automatic && (tab.loadState !== 'cold' || tab.content)) return
    if (automatic && tab.file && !tab.content) {
      const generation = beginFileTabRequest(tab.id, tab.sourceRequest)
      if (generation !== null) void finishOpening(tab.id, tab.file, scopeGenerationRef.current, generation)
      return
    }
    void performOpen(
      tabId,
      tab.sourceRequest,
      undefined,
      automatic ? 'restore' : 'interactive',
      false,
      Boolean(document.activeElement?.closest('.file-preview-pane')),
      !automatic
    )
  }

  const reopen = async (tabId: string): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file') return
    if (!tab.sourceRequest) {
      const error = unavailableSourceError()
      setTabs((entries) => entries.map((entry) => entry.kind === 'file' && entry.id === tabId
        ? { ...entry, loadState: 'unavailable', error }
        : entry))
      return
    }
    await performOpen(
      tabId,
      tab.sourceRequest,
      undefined,
      'interactive',
      false,
      Boolean(document.activeElement?.closest('.file-preview-pane'))
    )
  }

  const activate = (tabId: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (!tab) return
    owner.touch(session, tabId)
    setActiveTabId(tabId)
    setPaneVisible(true)
    if (tab.kind === 'file' && tab.loadState === 'cold') restoreTab(tabId, true)
  }

  const showPane = () => {
    owner.touch(session, activeTabIdRef.current ?? undefined)
    setPaneVisible(true)
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
    if (tab?.kind === 'file' && tab.loadState === 'cold') restoreTab(tab.id, true)
  }

  const hidePane = () => setPaneVisible(false)

  const openMissionActivity = (missionId: string): void => {
    if (disposed || !threadId) return
    const existing = tabsRef.current.find(tab => tab.kind === 'mission_activity')
    const tabId = existing?.id ?? newCommandId()
    if (!existing) setTabs(tabs => [{ kind: 'mission_activity', id: tabId, missionId }, ...tabs])
    activate(tabId)
    setOpenFeedback(previous => ({ tabId, sequence: (previous?.sequence ?? 0) + 1, isNew: !existing }))
  }

  const openExecution = (): void => {
    if (disposed || !threadId) return
    const existing = tabsRef.current.find(tab => tab.kind === 'execution')
    const tabId = existing?.id ?? newCommandId()
    if (!existing) setTabs(tabs => [{ kind: 'execution', id: tabId }, ...tabs])
    activate(tabId)
    setOpenFeedback(previous => ({ tabId, sequence: (previous?.sequence ?? 0) + 1, isNew: !existing }))
  }

  const move = (tabId: string, direction: -1 | 1) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [tab] = next.splice(index, 1)
      next.splice(targetIndex, 0, tab)
      return next
    })
  }

  const closeMany = (tabIds: string[]) => {
    const ids = new Set(tabIds)
    if (ids.size === 0) return
    const previous = tabsRef.current
    const closing = previous.filter((tab) => ids.has(tab.id))
    if (closing.length === 0) return
    const remaining = previous.filter((tab) => !ids.has(tab.id))
    const currentActiveTabId = activeTabIdRef.current
    const activeIndex = previous.findIndex((tab) => tab.id === currentActiveTabId)
    const nextActiveTabId = remaining.length === 0
      ? null
      : currentActiveTabId && !ids.has(currentActiveTabId)
        ? currentActiveTabId
        : previous.slice(Math.max(0, activeIndex + 1)).find((tab) => !ids.has(tab.id))?.id
        ?? previous.slice(0, Math.max(0, activeIndex)).reverse().find((tab) => !ids.has(tab.id))?.id
        ?? remaining[0].id
    for (const tab of closing) if (tab.kind === 'file') { discardCandidate(tab); revokeContent(tab.content); if (tab.file) displayed(tab.id, tab.file.handleId) }
    setTabs(() => remaining)
    setActiveTabId(nextActiveTabId)
    setOpenFeedback((current) => current && ids.has(current.tabId) ? null : current)
    if (remaining.length === 0) {
      setPaneVisible(false)
    }
    for (const tab of closing) {
      if (tab.kind === 'file' && tab.file) {
        void api.release({ handleId: tab.file.handleId })
      }
    }
    if (nextActiveTabId && owner.isCurrent(threadId) && paneVisibleRef.current) restoreTab(nextActiveTabId, true)
  }

  const close = (tabId: string) => closeMany([tabId])

  const restoreHandle = async (tab: FilePreviewTabModel): Promise<ResolvedFilePreview | null> => {
    const request = tab.sourceRequest && restorableFilePreviewRequest(tab.sourceRequest)
    if (!request) return null
    await owner.sync()
    const result = await api.restore(request)
    return result.ok && result.value.kind === 'file_preview' ? result.value.file : null
  }
  const withActionFile = async <T>(tabId: string, action: (file: ResolvedFilePreview) => Promise<FilePreviewOperationResult<T>>): Promise<FilePreviewOperationResult<T>> => {
    const tab = tabsRef.current.find(entry => entry.id === tabId)
    if (tab?.kind !== 'file') return { ok: false, error: unavailableSourceError() }
    const file = tab.file ?? await restoreHandle(tab)
    if (!file) return { ok: false, error: unavailableSourceError() }
    try { return await action(file) }
    finally { if (!tab.file) void api.release({ handleId: file.handleId }) }
  }
  const download = (tabId: string) => withActionFile<{ started: true }>(tabId, file => api.download
    ? api.download({ handleId: file.handleId, expectedGeneration: file.contentGeneration })
    : Promise.resolve({ ok: false, error: unavailableSourceError() }))
  const openInSystem = (tabId: string) => withActionFile(tabId, file => api.openInSystem({ handleId: file.handleId }))
  const revealInFolder = (tabId: string) => withActionFile(tabId, file => api.revealInFolder({ handleId: file.handleId }))
  const copyPath = (tabId: string) => withActionFile(tabId, file => api.copyPath({
    handleId: file.handleId,
    format: file.pathPresentation === 'file_name_only' ? 'display' : 'absolute'
  }))

  const toggleHtmlSource = (tabId: string): void => {
    setTabs((current) => current.map((tab) => tab.kind === 'file' && tab.id === tabId && tab.content?.kind === 'html'
      ? { ...tab, htmlSourceMode: !tab.htmlSourceMode }
      : tab))
  }

  const retry = reopen

  const discardCandidate = (tab: FilePreviewTabModel): void => {
    if (tab.candidate) {
      revokeContent(tab.candidate.loaded.content)
      void api.release({ handleId: tab.candidate.file.handleId })
    }
    refreshDone.get(tab.id)?.(); refreshDone.delete(tab.id)
  }
  const commitCandidate = (tab: FilePreviewTabModel): void => {
    if (!tab.candidate) return
    const { file, loaded } = tab.candidate
    retired.set(file.handleId, { file: tab.file, content: tab.content })
    setTabs(tabs => tabs.map(entry => entry.id !== tab.id ? entry : {
      ...tab, ...loaded,
      file, candidate: undefined, loadState: 'ready', isRefreshing: false, refreshError: null,
      hasExternalUpdate: file.hasExternalUpdate || tab.externalUpdateVersion !== refreshVersions.get(tab.id),
      htmlSource: undefined, pages: undefined
    }))
    refreshDone.get(tab.id)?.(); refreshDone.delete(tab.id)
  }
  const refreshVersions = new Map<string, number>()
  const completeHtmlRefresh = (tabId: string, handleId: string, error?: string): void => {
    const tab = tabsRef.current.find(entry => entry.id === tabId)
    if (tab?.kind !== 'file' || tab.candidate?.file.handleId !== handleId) return
    if (!error) { commitCandidate(tab); return }
    discardCandidate(tab)
    setTabs(tabs => tabs.map(entry => entry.id !== tab.id ? entry : { ...tab, candidate: undefined, isRefreshing: false, refreshError: error }))
  }
  const displayed = (_tabId: string, handleId: string): void => {
    const previous = retired.get(handleId)
    if (!previous) return
    retired.delete(handleId)
    revokeContent(previous.content)
    if (previous.file) void api.release({ handleId: previous.file.handleId })
  }
  const reload = async (tabId: string): Promise<void> => {
    const tab = tabsRef.current.find(entry => entry.id === tabId)
    if (tab?.kind !== 'file' || tab.isRefreshing) return
    if (!tab.file && !tab.content) { await reopen(tabId); return }
    const oldFile = tab.file
    const scope = scopeGenerationRef.current
    const requestGeneration = tab.requestGeneration + 1
    refreshVersions.set(tabId, tab.externalUpdateVersion)
    setTabs(tabs => tabs.map(entry => entry.id !== tabId ? entry : { ...tab, requestGeneration, isRefreshing: true, refreshError: null }))
    let candidate: ResolvedFilePreview | null = null
    let loaded: LoadedFilePreviewContent | null = null
    let reservation: (() => void) | null = null
    const current = (): FilePreviewTabModel | undefined => tabsRef.current.find(entry => entry.kind === 'file'
      && entry.id === tabId && entry.requestGeneration === requestGeneration && scopeGenerationRef.current === scope) as FilePreviewTabModel | undefined
    try {
      await owner.sync()
      if (oldFile) {
        const result = await api.reload({ handleId: oldFile.handleId, reopenToken: oldFile.reopenToken, expectedGeneration: oldFile.contentGeneration })
        if (!result.ok) throw new Error(filePreviewErrorMessage(result.error))
        candidate = result.value
      } else candidate = await restoreHandle(tab)
      if (!candidate) throw new Error(uiAttribute('无法重新取得文件，已保留当前预览。'))
      if (!current()) return
      reservation = candidate.kind === 'html' ? await owner.reserveHtml(session, tabId) : () => undefined
      if (!reservation) throw new Error(uiAttribute('预览资源不足，旧预览已保留。'))
      const content = await loadContent(candidate)
      if (!content.ok) throw new Error(filePreviewErrorMessage(content.error))
      loaded = content
      const entry = current()
      if (!entry) return
      const ready = loaded.content.kind === 'html' ? new Promise<void>(resolve => refreshDone.set(tabId, resolve)) : null
      const next = { ...entry, candidate: { file: candidate, loaded } }
      setTabs(tabs => tabs.map(tab => tab.id === tabId ? next : tab))
      candidate = null; loaded = null
      reservation(); reservation = null
      if (ready) await ready
      else commitCandidate(next)
    } catch (error) {
      if (current()) setTabs(tabs => tabs.map(entry => entry.id !== tabId ? entry : {
        ...entry, isRefreshing: false,
        refreshError: error instanceof Error ? error.message : uiAttribute('重新加载失败')
      }))
    } finally {
      reservation?.()
      if (loaded) revokeContent(loaded.content)
      if (candidate) void api.release({ handleId: candidate.handleId })
    }
  }

  const pageRequests = new Set<string>()
  const changePage = async (tabId: string, direction: -1 | 1): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || tab.content?.kind !== 'page' || tab.isRefreshing || pageRequests.has(tabId)) return
    let file = tab.file
    const scopeGeneration = scopeGenerationRef.current
    const requestGeneration = tab.requestGeneration
    const nextIndex = tab.pageIndex + direction
    if (nextIndex < 0) return
    const offset = direction === 1
      ? tab.pageOffsets[nextIndex] ?? tab.content.page.endOffset
      : tab.pageOffsets[nextIndex]
    if (offset === undefined || offset < 0 || offset >= (file?.size ?? tab.content.page.contentVersion.size)) return
    const cached = tab.pages?.[offset]
    pageRequests.add(tabId)
    try {
      if (!cached && !file) {
        file = await restoreHandle(tab)
        if (!file) return
        const version = tab.cachedVersion ?? tab.content.page.contentVersion
        const current = tabsRef.current.find(entry => entry.id === tabId)
        if (scopeGenerationRef.current !== scopeGeneration || current?.kind !== 'file' || current.requestGeneration !== requestGeneration
          || file.contentVersion.size !== version.size || file.contentVersion.mtimeMs !== version.mtimeMs) {
          void api.release({ handleId: file.handleId })
          if (current?.kind === 'file' && current.requestGeneration === requestGeneration) setTabs(tabs => tabs.map(entry => entry.id === tabId
            ? { ...current, hasExternalUpdate: true, refreshError: uiAttribute('文件已变化，请刷新后读取新分页。当前内容已保留。') } : entry))
          return
        }
        const acquired = file
        setTabs(tabs => tabs.map(entry => entry.id === tabId ? { ...entry, file: acquired } : entry))
      }
      const result = cached ? { ok: true as const, value: cached } : await api.readPage({ handleId: file!.handleId, expectedGeneration: file!.contentGeneration, offset })
      if (
        !result.ok
        || scopeGenerationRef.current !== scopeGeneration
      ) return
      setTabs((current) => current.map((entry) => {
        if (entry.kind !== 'file' || entry.id !== tabId || entry.requestGeneration !== requestGeneration) return entry
        const offsets = entry.pageOffsets.slice(0, nextIndex + 1)
        offsets[nextIndex] = offset
        if (result.value.hasNext) offsets[nextIndex + 1] = result.value.endOffset
        return {
          ...entry,
          content: { kind: 'page', page: result.value },
          pageOffsets: offsets,
          pageIndex: nextIndex,
          pages: { ...entry.pages, [offset]: result.value }
        }
      }))
    } finally { pageRequests.delete(tabId) }
  }

  const saveReading = (tabId: string, state: Partial<FilePreviewReadingState>): void => {
    // Scroll samples update the lightweight snapshot without causing a Renderer render or touching LRU.
    const tab = tabsRef.current.find(tab => tab.id === tabId)
    if (tab) { tab.reading = { ...tab.reading, ...state }; saveSession(threadId) }
  }
  const saveHtmlSource = (tabId: string, value: FilePreviewTabModel['htmlSource']): void => {
    setTabs(tabs => tabs.map(tab => tab.kind === 'file' && tab.id === tabId ? { ...tab, htmlSource: value } : tab))
  }
  const sourceRequests = new Map<string, Promise<void>>()
  const loadHtmlSource = (tabId: string, index = 0): Promise<void> => {
    const tab = tabsRef.current.find(tab => tab.id === tabId)
    if (tab?.kind !== 'file' || !tab.file) return Promise.resolve()
    const file = tab.file
    const offsets = tab.htmlSource?.offsets ?? [0]
    const offset = offsets[index]
    if (offset === undefined || index < 0) return Promise.resolve()
    const key = `${file.handleId}:${offset}`
    const pending = sourceRequests.get(key)
    if (pending) return pending
    const cached = tab.htmlSource?.pages?.[offset] ?? (tab.htmlSource?.index === index ? tab.htmlSource : null)
    if (cached) { saveHtmlSource(tabId, { ...tab.htmlSource!, ...cached, index, offsets }); return Promise.resolve() }
    const generation = tab.requestGeneration
    const task = (async () => {
      const request = { handleId: file.handleId, expectedGeneration: file.contentGeneration }
      const result = file.size <= 4 * 1024 * 1024 ? await api.readText(request) : await api.readPage({ ...request, offset })
      const current = tabsRef.current.find(tab => tab.id === tabId)
      if (current?.kind !== 'file' || current.requestGeneration !== generation || current.file?.handleId !== file.handleId) return
      if (!result.ok) { setTabs(tabs => tabs.map(tab => tab.id === tabId ? { ...current, refreshError: filePreviewErrorMessage(result.error) } : tab)); return }
      const page = 'endOffset' in result.value ? result.value as FilePreviewPageContent : null
      const nextOffsets = [...offsets]
      if (page?.hasNext) nextOffsets[index + 1] = page.endOffset
      const value = { text: result.value.text, page }
      saveHtmlSource(tabId, { ...value, offsets: nextOffsets, index, pages: { ...current.htmlSource?.pages, [offset]: value } })
    })().finally(() => sourceRequests.delete(key))
    sourceRequests.set(key, task)
    return task
  }
  const changeRequests = new Map<string, Promise<void>>()
  const loadChanges = (tabId: string, read: () => Promise<AgentRunFileChangesDetailView>, retry = false): Promise<void> => {
    const tab = tabsRef.current.find(entry => entry.id === tabId)
    if (tab?.kind !== 'file_change'
      || (tab.detail && !(retry && tab.changes.isStale))
      || tab.detailStatus === 'error' && !retry) return Promise.resolve()
    const pending = changeRequests.get(tabId)
    if (pending) return pending
    if (!owner.admit(session)) {
      setTabs(tabs => tabs.map(entry => entry.id === tabId ? { ...entry, detailStatus: 'error' } : entry))
      return Promise.resolve()
    }
    const scope = scopeGenerationRef.current
    const operation = Promise.resolve().then(read).then(detail => {
      if (disposed || scope !== scopeGenerationRef.current || changeRequests.get(tabId) !== operation) return
      if (!([2, 3] as const).includes(detail.schemaVersion)
        || detail.card.agentRunId !== tab.changes.agentRunId
        || detail.card.executionEpoch !== tab.changes.executionEpoch) throw new Error('Mismatched evidence')
      const current = tabsRef.current.find(entry => entry.id === tabId)
      if (current?.kind !== 'file_change'
        || (detail.card.revision ?? 0) < (current.changes.revision ?? 0)
        || (detail.card.sourceChangeSequence ?? 0) < (current.changes.sourceChangeSequence ?? 0)
        || (current.changes.isStale && !detail.card.isStale
          && (detail.card.revision ?? 0) === (current.changes.revision ?? 0)
          && (detail.card.sourceChangeSequence ?? 0) === (current.changes.sourceChangeSequence ?? 0))) {
        setTabs(tabs => tabs.map(entry => entry.id === tabId && entry.kind === 'file_change'
          ? { ...entry, detailStatus: entry.detail ? 'ready' : undefined }
          : entry))
        return
      }
      const stringBytes = (value: unknown): number => typeof value === 'string' ? value.length * 2
        : value && typeof value === 'object' ? Object.values(value).reduce<number>((sum, part) => sum + stringBytes(part), 0) : 0
      setTabs(tabs => tabs.map(entry => entry.id === tabId && entry.kind === 'file_change'
        ? {
          ...entry,
          changes: detail.card,
          detail,
          detailBytes: stringBytes(detail),
          detailStatus: 'ready'
        }
        : entry))
    }).catch(() => {
      if (!disposed && scope === scopeGenerationRef.current && changeRequests.get(tabId) === operation)
        setTabs(tabs => tabs.map(entry => entry.id === tabId
          ? { ...entry, detailStatus: entry.kind === 'file_change' && entry.detail ? 'ready' : 'error' }
          : entry))
    }).finally(() => { if (changeRequests.get(tabId) === operation) changeRequests.delete(tabId) })
    changeRequests.set(tabId, operation)
    setTabs(tabs => tabs.map(entry => entry.id === tabId
      ? { ...entry, detailStatus: entry.kind === 'file_change' && entry.detail ? 'ready' : 'loading' }
      : entry))
    return operation
  }
  const session = {
    id, threadId, lastUsed: 0, get pendingOpens() { return committedLoads.size }, tabUsage: new Map<string, number>(),
    getSnapshot: () => snapshot,
    retired,
    cool: () => { scopeGenerationRef.current += 1; committedLoads.clear(); for (const tab of tabsRef.current) session.evict(tab.id); session.id = newCommandId(); bindingPromiseRef.current = owner.sync() },
    setBinding: (binding: Promise<void>) => { bindingPromiseRef.current = binding },
    actions: { open, openFileChanges, syncFileChanges, openMissionActivity, openExecution, loadChanges, selectChangedFile, showPane, hidePane, activate, move, close, closeMany, download, openInSystem, revealInFolder, copyPath, toggleHtmlSource, reload, reopen, retry, changePage, saveReading, loadHtmlSource, saveHtmlSource, completeHtmlRefresh, displayed },
    ensureActive: () => { if (paneVisibleRef.current && activeTabIdRef.current) restoreTab(activeTabIdRef.current, true) },
    externalUpdate: (previewKeys: string[]) => {
      const changed = new Set(previewKeys)
      setTabs(tabs => tabs.map(tab => tab.kind === 'file' && tab.previewKey && changed.has(tab.previewKey)
        ? { ...tab, hasExternalUpdate: true, externalUpdateVersion: tab.externalUpdateVersion + 1 } : tab))
    },
    evictBytes: (tabId: string) => {
      const tab = tabsRef.current.find(tab => tab.id === tabId)
      if (tab?.kind !== 'file') { session.evict(tabId); return }
      const keepPage = tab.content?.kind === 'html'
      if (!keepPage && tab.file) displayed(tab.id, tab.file.handleId)
      if (!keepPage) revokeContent(tab.content)
      setTabs(tabs => tabs.map(entry => entry.id === tabId ? {
        ...tab, content: keepPage ? tab.content : null,
        pages: undefined, htmlSource: undefined, requestGeneration: tab.requestGeneration + 1,
        loadState: keepPage ? 'ready' : 'cold'
      } : entry))
    },
    evict: (tabId: string, handleOnly = false, alreadyReleased = false, htmlOnly = false) => {
      const tab = tabsRef.current.find(tab => tab.id === tabId)
      if (!tab) return
      if (tab.kind === 'mission_activity' || tab.kind === 'execution') return
      if (tab.kind === 'file_change') {
        changeRequests.delete(tabId)
        setTabs(tabs => tabs.map(entry => entry.id === tabId ? { ...tab, detail: undefined, detailBytes: undefined, detailStatus: undefined } : entry))
        return
      }
      discardCandidate(tab)
      if (tab.file) displayed(tab.id, tab.file.handleId)
      const independent = handleOnly && tab.content && tab.content.kind !== 'html' && tab.content.kind !== 'markdown'
      if (!independent) revokeContent(tab.content)
      if (tab.file && !alreadyReleased && !htmlOnly) void api.release({ handleId: tab.file.handleId })
      setTabs(tabs => tabs.map(entry => entry.id !== tabId ? entry : {
        ...tab, file: htmlOnly ? tab.file : null,
        cachedVersion: tab.file?.contentVersion ?? tab.cachedVersion, retainedCapabilities: tab.file?.capabilities ?? tab.retainedCapabilities,
        content: independent ? tab.content : null, requestGeneration: tab.requestGeneration + 1,
        loadState: independent ? 'ready' : tab.sourceRequest ? 'cold' : 'unavailable',
        candidate: undefined, pages: handleOnly ? tab.pages : undefined, htmlSource: handleOnly || htmlOnly ? tab.htmlSource : undefined,
        isRefreshing: false, refreshError: null
      }))
    },
    dispose: () => {
      disposed = true
      committedLoads.clear()
      scopeGenerationRef.current += 1
      for (const tab of tabsRef.current) if (tab.kind === 'file') {
        discardCandidate(tab)
        revokeContent(tab.content)
        if (tab.file) void api.release({ handleId: tab.file.handleId })
      }
      for (const url of objectUrls.current) URL.revokeObjectURL(url)
      objectUrls.current.clear()
      for (const [handleId] of retired) displayed('', handleId)
    }
  }
  return session
}
