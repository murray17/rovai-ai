import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  AgentRunFileChangesView,
  FileLocationTarget,
  FilePreviewErrorPayload,
  FilePreviewOperationResult,
  FilePreviewPageContent,
  OpenFilePreviewRequest,
  OpenFilePreviewResult,
  ResolvedFilePreview
} from '@contracts'
import { secureFilePreviewHtml } from './file-preview-html-document'
import { FilePreviewLayoutProvider } from './FilePreviewLayout'
import {
  filePreviewPresentationFromFile,
  filePreviewPresentationFromRequest,
  filePreviewSessionStore,
  filePreviewSourceKey,
  restorableFilePreviewRequest,
  type FilePreviewPresentation,
  type FilePreviewPresentationHint,
  type FilePreviewSessionSnapshot,
  type FilePreviewTabSnapshot
} from './file-preview-session'

export type FilePreviewContent =
  | { kind: 'markdown'; text: string; tabToken: string; assetBasePath: string }
  | { kind: 'code' | 'text' | 'patch'; text: string }
  | { kind: 'html'; html: string; tabToken: string; bridgeToken: string }
  | { kind: 'image'; url: string }
  | { kind: 'page'; page: FilePreviewPageContent }

export interface FilePreviewTabModel {
  kind: 'file'
  id: string
  sourceKey: string
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
}

export interface FileChangesPreviewTabModel {
  kind: 'file_change'
  id: string
  campId: string
  changes: AgentRunFileChangesView
  selectedEvidenceFileId: string | null
}

export type PreviewTabModel = FilePreviewTabModel | FileChangesPreviewTabModel

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

export interface FilePreviewContextValue {
  tabs: PreviewTabModel[]
  activeTab: PreviewTabModel | null
  activeTabId: string | null
  openFeedback: FilePreviewOpenFeedback | null
  paneVisible: boolean
  open(
    request: OpenFilePreviewRequest,
    target?: FileLocationTarget,
    presentation?: FilePreviewPresentationHint
  ): Promise<FilePreviewOpenOutcome>
  openFileChanges(campId: string, changes: AgentRunFileChangesView, evidenceFileId?: string): void
  selectChangedFile(tabId: string, evidenceFileId: string): void
  showPane(): void
  hidePane(): void
  activate(tabId: string): void
  move(tabId: string, direction: -1 | 1): void
  close(tabId: string): void
  closeMany(tabIds: string[]): void
  openInSystem(tabId: string): Promise<FilePreviewOperationResult<{ opened: true }>>
  revealInFolder(tabId: string): Promise<FilePreviewOperationResult<{ revealed: true }>>
  copyDisplayPath(tabId: string): Promise<FilePreviewOperationResult<{ copied: true }>>
  reload(tabId: string): Promise<void>
  reopen(tabId: string): Promise<void>
  retry(tabId: string): Promise<void>
  changePage(tabId: string, direction: -1 | 1): Promise<void>
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)

function errorFromUnknown(): FilePreviewErrorPayload {
  return {
    code: 'read_failed',
    message: '暂时无法读取文件',
    retryable: true
  }
}

export function filePreviewErrorMessage(error: Pick<FilePreviewErrorPayload, 'code'>): string {
  switch (error.code) {
    case 'file_not_found': return '找不到这个文件'
    case 'attachment_missing': return '找不到这个附件'
    case 'source_not_authorized':
    case 'authorization_required':
    case 'outside_authorized_root': return '文件访问已失效'
    case 'evidence_identity_unavailable': return '无法定位这个历史记录对应的当前文件'
    case 'read_failed': return '暂时无法读取文件'
    case 'attachment_unreadable': return '暂时无法读取这个附件'
    case 'attachment_kind_changed': return '这个附件的类型已变化'
    case 'decode_failed': return '无法读取这个文件的内容'
    case 'file_too_large': return '这个文件太大，无法预览'
    case 'too_many_open_files': return '打开的文件太多'
    case 'not_regular_file':
    case 'reference_not_clickable': return '无法在这里预览这个文件'
    case 'open_failed': return '暂时无法打开这个文件'
    case 'reveal_failed': return '暂时无法显示这个文件的位置'
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
    message: '文件访问已失效',
    retryable: false
  }
}

function restoredTab(snapshot: FilePreviewTabSnapshot): PreviewTabModel {
  if (snapshot.kind === 'file_change') return { ...snapshot }
  const restorable = snapshot.sourceRequest !== null
  return {
    kind: 'file',
    id: snapshot.id,
    sourceKey: snapshot.sourceRequest
      ? filePreviewSourceKey(snapshot.sourceRequest)
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
    pageOffsets: [],
    pageIndex: 0
  }
}

export function FilePreviewProvider({
  campId,
  children
}: {
  campId: string | null
  children: ReactNode
}): React.JSX.Element {
  const [tabs, setTabsState] = useState<PreviewTabModel[]>([])
  const [activeTabId, setActiveTabIdState] = useState<string | null>(null)
  const [openFeedback, setOpenFeedback] = useState<FilePreviewOpenFeedback | null>(null)
  const [paneVisible, setPaneVisibleState] = useState(false)
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef<string | null>(null)
  const paneVisibleRef = useRef(false)
  const objectUrls = useRef(new Set<string>())
  const campIdRef = useRef<string | null>(null)
  const scopeGenerationRef = useRef(0)
  const bindingPromiseRef = useRef<Promise<void>>(Promise.resolve())
  const setTabs = useCallback((update: (current: PreviewTabModel[]) => PreviewTabModel[]) => {
    const next = update(tabsRef.current)
    tabsRef.current = next
    setTabsState(next)
  }, [])
  const setActiveTabId = useCallback((next: string | null) => {
    activeTabIdRef.current = next
    setActiveTabIdState(next)
  }, [])
  const setPaneVisible = useCallback((next: boolean) => {
    paneVisibleRef.current = next
    setPaneVisibleState(next)
  }, [])

  const revokeContent = useCallback((content: FilePreviewContent | null) => {
    if (content?.kind !== 'image') return
    URL.revokeObjectURL(content.url)
    objectUrls.current.delete(content.url)
  }, [])

  const saveSession = useCallback((targetCampId: string) => {
    const snapshot: FilePreviewSessionSnapshot = {
      tabs: tabsRef.current.map((tab) => tab.kind === 'file_change'
        ? { ...tab }
        : {
            kind: 'file',
            id: tab.id,
            sourceRequest: tab.sourceRequest
              ? restorableFilePreviewRequest(tab.sourceRequest)
              : null,
            presentation: tab.presentation
          }),
      activeTabId: activeTabIdRef.current,
      paneVisible: paneVisibleRef.current
    }
    filePreviewSessionStore.set(targetCampId, snapshot)
  }, [])

  useEffect(() => window.rovai.filePreview.onExternalUpdate((event) => {
    if (event.campId !== campIdRef.current) return
    const changed = new Set(event.previewKeys)
    setTabs((current) => current.map((tab) => tab.kind === 'file' && tab.file
      && changed.has(tab.file.previewKey)
      ? {
          ...tab,
          hasExternalUpdate: true,
          externalUpdateVersion: tab.externalUpdateVersion + 1
        }
      : tab))
  }), [setTabs])

  const loadContent = useCallback(async (file: ResolvedFilePreview): Promise<
    { ok: true; content: FilePreviewContent; pageOffsets: number[]; pageIndex: number }
    | { ok: false; error: FilePreviewErrorPayload }
  > => {
    const request = { handleId: file.handleId, expectedGeneration: file.contentGeneration }
    try {
      if (file.kind === 'image') {
        const result = await window.rovai.filePreview.readBinary(request)
        if (!result.ok) return result
        const bytes = Uint8Array.from(result.value.bytes)
        const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.value.mime }))
        objectUrls.current.add(url)
        return { ok: true, content: { kind: 'image', url }, pageOffsets: [], pageIndex: 0 }
      }
      if (file.kind === 'html') {
        const result = await window.rovai.filePreview.prepareHtml(request)
        return result.ok
          ? {
              ok: true,
              content: {
                kind: 'html',
                html: secureFilePreviewHtml(result.value),
                tabToken: result.value.tabToken,
                bridgeToken: result.value.bridgeToken
              },
              pageOffsets: [],
              pageIndex: 0
            }
          : result
      }
      if (file.kind === 'markdown') {
        const result = await window.rovai.filePreview.prepareHtml(request)
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
        let offset = 0
        if (file.target?.line && file.target.line > 1) {
          const resolved = await window.rovai.filePreview.resolveLine({
            ...request,
            line: file.target.line
          })
          if (!resolved.ok) return resolved
          offset = resolved.value.offset
        }
        const result = await window.rovai.filePreview.readPage({ ...request, offset })
        return result.ok
          ? { ok: true, content: { kind: 'page', page: result.value }, pageOffsets: [offset], pageIndex: 0 }
          : result
      }
      const result = await window.rovai.filePreview.readText(request)
      if (!result.ok) return result
      if (file.kind === 'svg') {
        const url = URL.createObjectURL(new Blob([result.value.text], { type: 'image/svg+xml' }))
        objectUrls.current.add(url)
        return { ok: true, content: { kind: 'image', url }, pageOffsets: [], pageIndex: 0 }
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
  }, [])

  const finishOpening = useCallback(async (
    tabId: string,
    file: ResolvedFilePreview,
    scopeGeneration: number,
    requestGeneration: number
  ): Promise<void> => {
    const loaded = await loadContent(file)
    const current = tabsRef.current.find((tab) => tab.id === tabId)
    if (
      scopeGenerationRef.current !== scopeGeneration
      || current?.kind !== 'file'
      || current.requestGeneration !== requestGeneration
      || current.file?.handleId !== file.handleId
    ) {
      if (loaded.ok) revokeContent(loaded.content)
      void window.rovai.filePreview.release({ handleId: file.handleId })
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
            pageIndex: loaded.pageIndex
          }
        : {
            ...tab,
            loadState: errorLoadState(loaded.error),
            error: safeOpenError(loaded.error)
          }))
  }, [loadContent, revokeContent, setTabs])

  const showOpenedTab = useCallback((tabId: string, isNew: boolean, focusTab = false) => {
    setActiveTabId(tabId)
    setPaneVisible(true)
    setOpenFeedback((previous) => ({ tabId, sequence: (previous?.sequence ?? 0) + 1, isNew, focusTab }))
  }, [])

  const openFileChanges = useCallback((
    targetCampId: string,
    changes: AgentRunFileChangesView,
    evidenceFileId?: string
  ) => {
    if (targetCampId !== campIdRef.current) return
    const id = `file-change:${encodeURIComponent(targetCampId)}:${encodeURIComponent(changes.agentRunId)}:${changes.executionEpoch}`
    const existing = tabsRef.current.find((tab) => tab.id === id)
    const previousSelection = existing?.kind === 'file_change' ? existing.selectedEvidenceFileId : null
    const selectedFile = changes.files.find((file) => file.evidenceFileId === evidenceFileId)
      ?? changes.files.find((file) => file.evidenceFileId === previousSelection)
      ?? changes.files[0]
    const selectedEvidenceFileId = selectedFile?.evidenceFileId ?? null
    const tab: FileChangesPreviewTabModel = { kind: 'file_change', id, campId: targetCampId, changes, selectedEvidenceFileId }
    setTabs((current) => existing ? current.map((entry) => entry.id === id ? tab : entry) : [...current, tab])
    showOpenedTab(id, !existing)
  }, [setTabs, showOpenedTab])

  const selectChangedFile = useCallback((tabId: string, evidenceFileId: string) => {
    setTabs((current) => current.map((tab) => tab.id === tabId && tab.kind === 'file_change'
      && tab.changes.files.some((file) => file.evidenceFileId === evidenceFileId)
      ? { ...tab, selectedEvidenceFileId: evidenceFileId }
      : tab))
  }, [setTabs])

  const failTabRequest = useCallback((
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
    if (current.file) void window.rovai.filePreview.release({ handleId: current.file.handleId })
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
  }, [revokeContent, setTabs])

  const installResolvedFile = useCallback((
    requestedTabId: string,
    request: OpenFilePreviewRequest,
    sourceKey: string,
    file: ResolvedFilePreview,
    scopeGeneration: number,
    requestGeneration: number,
    isNew: boolean,
    focusTab: boolean,
    showFeedback: boolean
  ): FilePreviewOpenOutcome => {
    const requestedTab = tabsRef.current.find((tab) => tab.id === requestedTabId)
    if (
      scopeGenerationRef.current !== scopeGeneration
      || requestedTab?.kind !== 'file'
      || requestedTab.requestGeneration !== requestGeneration
    ) {
      void window.rovai.filePreview.release({ handleId: file.handleId })
      return { kind: 'error', error: unavailableSourceError() }
    }

    const duplicate = tabsRef.current.find((tab) => tab.kind === 'file'
      && tab.id !== requestedTabId
      && tab.previewKey === file.previewKey) as FilePreviewTabModel | undefined
    const targetTabId = duplicate?.id ?? requestedTabId
    const targetRequestGeneration = duplicate
      ? duplicate.requestGeneration + 1
      : requestGeneration
    const replaced = duplicate ?? requestedTab
    const currentRestorableSource = duplicate?.sourceRequest
      ? restorableFilePreviewRequest(duplicate.sourceRequest)
      : null
    const installedRequest = restorableFilePreviewRequest(request)
      ? request
      : currentRestorableSource ?? request
    const installedSourceKey = installedRequest === request
      ? sourceKey
      : duplicate?.sourceKey ?? sourceKey
    if (replaced.file?.handleId !== file.handleId) {
      if (replaced.file) void window.rovai.filePreview.release({ handleId: replaced.file.handleId })
      revokeContent(replaced.content)
    }
    if (duplicate) {
      revokeContent(requestedTab.content)
      if (requestedTab.file) void window.rovai.filePreview.release({ handleId: requestedTab.file.handleId })
    }

    setTabs((entries) => entries
      .filter((tab) => !duplicate || tab.id !== requestedTabId)
      .map((tab) => tab.kind === 'file' && tab.id === targetTabId
        ? {
            ...tab,
            sourceKey: installedSourceKey,
            sourceRequest: installedRequest,
            previewKey: file.previewKey,
            presentation: filePreviewPresentationFromFile(file),
            file,
            loadState: 'opening',
            content: null,
            error: null,
            requestGeneration: targetRequestGeneration,
            hasExternalUpdate: file.hasExternalUpdate,
            externalUpdateVersion: file.hasExternalUpdate ? tab.externalUpdateVersion + 1 : tab.externalUpdateVersion,
            isRefreshing: false,
            refreshError: null,
            pageOffsets: [],
            pageIndex: 0
          }
        : tab))
    if (showFeedback) showOpenedTab(targetTabId, isNew && !duplicate, focusTab)
    else {
      setActiveTabId(targetTabId)
      setPaneVisible(true)
    }
    void finishOpening(targetTabId, file, scopeGeneration, targetRequestGeneration)
    return { kind: 'preview', tabId: targetTabId }
  }, [finishOpening, revokeContent, setTabs, showOpenedTab])

  const beginFileTabRequest = useCallback((
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
  }, [setTabs])

  const removeProvisionalTab = useCallback((
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
  }, [setActiveTabId, setPaneVisible, setTabs])

  const performOpen = useCallback(async (
    tabId: string,
    request: OpenFilePreviewRequest,
    target: FileLocationTarget | undefined,
    mode: 'interactive' | 'restore',
    isNew: boolean,
    focusTab: boolean,
    showFeedback = true,
    rollback?: FilePreviewViewRollback
  ): Promise<FilePreviewOpenOutcome> => {
    const sourceKey = filePreviewSourceKey(request)
    const scopeGeneration = scopeGenerationRef.current
    const requestGeneration = beginFileTabRequest(tabId, request)
    if (requestGeneration === null) return { kind: 'error', error: unavailableSourceError() }
    try {
      await bindingPromiseRef.current
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
        result = await window.rovai.filePreview.restore(restoreRequest)
      } else {
        result = await window.rovai.filePreview.open(request)
      }
      if (!result.ok) {
        return { kind: 'error', error: failTabRequest(tabId, scopeGeneration, requestGeneration, result.error) }
      }
      if (result.value.kind === 'file_preview') {
        const file = target ? { ...result.value.file, target } : result.value.file
        return installResolvedFile(
          tabId,
          request,
          sourceKey,
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
            message: '无法在这里预览这个文件',
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
  }, [beginFileTabRequest, failTabRequest, installResolvedFile, removeProvisionalTab])

  const open = useCallback(async (
    request: OpenFilePreviewRequest,
    target?: FileLocationTarget,
    presentationHint?: FilePreviewPresentationHint
  ): Promise<FilePreviewOpenOutcome> => {
    if (request.kind === 'run_evidence' && request.action === 'review') {
      try {
        await bindingPromiseRef.current
        const result = await window.rovai.filePreview.open(request)
        if (!result.ok) return { kind: 'error', error: safeOpenError(result.error) }
        if (result.value.kind === 'evidence_review') return { kind: 'evidence_review', result: result.value }
        return result.value.kind === 'opened_in_system'
          ? { kind: 'system' }
          : { kind: 'preview', tabId: result.value.file.previewKey }
      } catch {
        return { kind: 'error', error: errorFromUnknown() }
      }
    }
    const sourceKey = filePreviewSourceKey(request)
    const existing = tabsRef.current.find((tab) => tab.kind === 'file' && tab.sourceKey === sourceKey)
    const isNew = !existing
    const tabId = existing?.id ?? `file-preview-${crypto.randomUUID()}`
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
    const focusTab = Boolean(document.activeElement?.closest('.file-preview-pane'))
    showOpenedTab(tabId, isNew, focusTab)
    return performOpen(tabId, request, target, 'interactive', isNew, focusTab, true, rollback)
  }, [performOpen, setTabs, showOpenedTab])

  const restoreTab = useCallback((tabId: string, automatic: boolean): void => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || !tab.sourceRequest) return
    if (automatic && tab.loadState !== 'cold') return
    void performOpen(
      tabId,
      tab.sourceRequest,
      undefined,
      automatic ? 'restore' : 'interactive',
      false,
      Boolean(document.activeElement?.closest('.file-preview-pane')),
      !automatic
    )
  }, [performOpen])

  const reopen = useCallback(async (tabId: string): Promise<void> => {
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
  }, [performOpen, setTabs])

  const activate = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (!tab) return
    setActiveTabId(tabId)
    setPaneVisible(true)
    if (tab.kind === 'file' && tab.loadState === 'cold') restoreTab(tabId, true)
  }, [restoreTab, setActiveTabId, setPaneVisible])

  const showPane = useCallback(() => {
    setPaneVisible(true)
    const tab = tabsRef.current.find((entry) => entry.id === activeTabIdRef.current)
    if (tab?.kind === 'file' && tab.loadState === 'cold') restoreTab(tab.id, true)
  }, [restoreTab, setPaneVisible])

  const hidePane = useCallback(() => setPaneVisible(false), [setPaneVisible])

  useLayoutEffect(() => {
    const previousCampId = campIdRef.current
    const scopeGeneration = ++scopeGenerationRef.current
    if (previousCampId) saveSession(previousCampId)
    for (const tab of tabsRef.current) if (tab.kind === 'file') revokeContent(tab.content)

    campIdRef.current = campId
    const binding = window.rovai.filePreview.bindCamp(campId)
    bindingPromiseRef.current = binding
    const snapshot = campId ? filePreviewSessionStore.get(campId) : null
    const nextTabs = snapshot?.tabs.map(restoredTab) ?? []
    const nextActiveTabId = snapshot?.activeTabId
      && nextTabs.some((tab) => tab.id === snapshot.activeTabId)
      ? snapshot.activeTabId
      : nextTabs[0]?.id ?? null
    tabsRef.current = nextTabs
    setTabsState(nextTabs)
    setActiveTabId(nextActiveTabId)
    setOpenFeedback(null)
    setPaneVisible(snapshot?.paneVisible ?? false)

    void binding.then(() => {
      if (
        scopeGenerationRef.current !== scopeGeneration
        || campIdRef.current !== campId
        || !paneVisibleRef.current
        || !activeTabIdRef.current
      ) return
      restoreTab(activeTabIdRef.current, true)
    }).catch(() => {
      if (scopeGenerationRef.current !== scopeGeneration || campIdRef.current !== campId) return
      const activeId = activeTabIdRef.current
      if (!activeId) return
      setTabs((entries) => entries.map((tab) => tab.kind === 'file' && tab.id === activeId
        && tab.loadState === 'cold'
        ? { ...tab, loadState: 'unavailable', error: unavailableSourceError() }
        : tab))
    })
  }, [campId, restoreTab, revokeContent, saveSession, setActiveTabId, setPaneVisible, setTabs])

  useEffect(() => () => {
    const currentCampId = campIdRef.current
    if (currentCampId) saveSession(currentCampId)
    scopeGenerationRef.current += 1
    for (const tab of tabsRef.current) if (tab.kind === 'file') revokeContent(tab.content)
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current.clear()
    void window.rovai.filePreview.bindCamp(null)
  }, [revokeContent, saveSession])

  const move = useCallback((tabId: string, direction: -1 | 1) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      const [tab] = next.splice(index, 1)
      next.splice(targetIndex, 0, tab)
      return next
    })
  }, [setTabs])

  const closeMany = useCallback((tabIds: string[]) => {
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
    for (const tab of closing) if (tab.kind === 'file') revokeContent(tab.content)
    setTabs(() => remaining)
    setActiveTabId(nextActiveTabId)
    setOpenFeedback((current) => current && ids.has(current.tabId) ? null : current)
    if (remaining.length === 0) {
      setPaneVisible(false)
    }
    for (const tab of closing) {
      if (tab.kind === 'file' && tab.file) {
        void window.rovai.filePreview.release({ handleId: tab.file.handleId })
      }
    }
  }, [revokeContent, setActiveTabId, setPaneVisible, setTabs])

  const close = useCallback((tabId: string) => closeMany([tabId]), [closeMany])

  const fileForAction = useCallback((tabId: string): ResolvedFilePreview | null => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    return tab?.kind === 'file' ? tab.file : null
  }, [])

  const openInSystem = useCallback(async (tabId: string) => {
    const file = fileForAction(tabId)
    return file
      ? window.rovai.filePreview.openInSystem({ handleId: file.handleId })
      : { ok: false as const, error: errorFromUnknown() }
  }, [fileForAction])

  const revealInFolder = useCallback(async (tabId: string) => {
    const file = fileForAction(tabId)
    return file
      ? window.rovai.filePreview.revealInFolder({ handleId: file.handleId })
      : { ok: false as const, error: errorFromUnknown() }
  }, [fileForAction])

  const copyDisplayPath = useCallback(async (tabId: string) => {
    const file = fileForAction(tabId)
    return file
      ? window.rovai.filePreview.copyPath({ handleId: file.handleId, format: 'display' })
      : { ok: false as const, error: errorFromUnknown() }
  }, [fileForAction])

  const retry = reopen

  const reload = useCallback(async (tabId: string): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || !tab.file || tab.isRefreshing) return
    const file = tab.file
    const scopeGeneration = scopeGenerationRef.current
    const requestGeneration = tab.requestGeneration + 1
    const refreshStartVersion = tab.externalUpdateVersion
    setTabs((current) => current.map((entry) => entry.kind === 'file' && entry.id === tabId
      ? { ...entry, requestGeneration, isRefreshing: true, refreshError: null }
      : entry))
    try {
      const result = await window.rovai.filePreview.reload({
        handleId: file.handleId,
        reopenToken: file.reopenToken,
        expectedGeneration: file.contentGeneration
      })
      const current = tabsRef.current.find((entry) => entry.id === tabId)
      if (
        scopeGenerationRef.current !== scopeGeneration
        || current?.kind !== 'file'
        || current.requestGeneration !== requestGeneration
      ) return
      if (!result.ok) {
        setTabs((current) => current.map((entry) => entry.id === tabId
          ? { ...entry, isRefreshing: false, refreshError: filePreviewErrorMessage(result.error) }
          : entry))
        return
      }
      const loaded = await loadContent(result.value)
      const loadedCurrent = tabsRef.current.find((entry) => entry.id === tabId)
      if (
        scopeGenerationRef.current !== scopeGeneration
        || loadedCurrent?.kind !== 'file'
        || loadedCurrent.requestGeneration !== requestGeneration
      ) {
        if (loaded.ok) revokeContent(loaded.content)
        return
      }
      if (!loaded.ok) {
        setTabs((current) => current.map((entry) => entry.id === tabId
          ? {
              ...entry,
              file: result.value,
              isRefreshing: false,
              refreshError: filePreviewErrorMessage(loaded.error)
            }
          : entry))
        return
      }
      setTabs((current) => current.map((entry) => {
        if (entry.kind !== 'file' || entry.id !== tabId) return entry
        revokeContent(entry.content)
        return {
          ...entry,
          file: result.value,
          content: loaded.content,
          loadState: 'ready',
          error: null,
          hasExternalUpdate: result.value.hasExternalUpdate
            || entry.externalUpdateVersion !== refreshStartVersion,
          isRefreshing: false,
          refreshError: null,
          pageOffsets: loaded.pageOffsets,
          pageIndex: loaded.pageIndex
        }
      }))
    } catch {
      setTabs((current) => current.map((entry) => entry.kind === 'file'
        && entry.id === tabId
        && entry.requestGeneration === requestGeneration
        ? { ...entry, isRefreshing: false, refreshError: '重新加载失败' }
        : entry))
    }
  }, [loadContent, revokeContent, setTabs])

  const changePage = useCallback(async (tabId: string, direction: -1 | 1): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || !tab.file || tab.content?.kind !== 'page') return
    const file = tab.file
    const scopeGeneration = scopeGenerationRef.current
    const requestGeneration = tab.requestGeneration
    const nextIndex = tab.pageIndex + direction
    if (nextIndex < 0) return
    const offset = direction === 1
      ? tab.pageOffsets[nextIndex] ?? tab.content.page.endOffset
      : tab.pageOffsets[nextIndex]
    if (offset === undefined || offset < 0 || offset >= file.size) return
    const result = await window.rovai.filePreview.readPage({
      handleId: file.handleId,
      expectedGeneration: file.contentGeneration,
      offset
    })
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
        pageIndex: nextIndex
      }
    }))
  }, [setTabs])

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const value = useMemo<FilePreviewContextValue>(() => ({
    tabs,
    activeTab,
    activeTabId,
    openFeedback,
    paneVisible,
    open,
    openFileChanges,
    selectChangedFile,
    showPane,
    hidePane,
    activate,
    move,
    close,
    closeMany,
    openInSystem,
    revealInFolder,
    copyDisplayPath,
    reload,
    reopen,
    retry,
    changePage
  }), [activate, activeTab, activeTabId, changePage, close, closeMany, copyDisplayPath, hidePane, move, open, openFileChanges, openFeedback, openInSystem, paneVisible, reload, reopen, revealInFolder, retry, selectChangedFile, showPane, tabs])

  return (
    <FilePreviewContext.Provider value={value}>
      <FilePreviewLayoutProvider campId={campId} visible={paneVisible}>
        {children}
      </FilePreviewLayoutProvider>
    </FilePreviewContext.Provider>
  )
}

export function useFilePreview(): FilePreviewContextValue {
  const value = useContext(FilePreviewContext)
  if (!value) throw new Error('FilePreviewProvider is unavailable')
  return value
}

export function useOptionalFilePreview(): FilePreviewContextValue | null {
  return useContext(FilePreviewContext)
}
