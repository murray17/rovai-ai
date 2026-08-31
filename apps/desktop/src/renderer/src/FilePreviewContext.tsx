import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

export type FilePreviewContent =
  | { kind: 'markdown'; text: string; tabToken: string; assetBasePath: string }
  | { kind: 'code' | 'text' | 'patch'; text: string }
  | { kind: 'html'; html: string; tabToken: string; bridgeToken: string }
  | { kind: 'image'; url: string }
  | { kind: 'page'; page: FilePreviewPageContent }

export interface FilePreviewTabModel {
  kind: 'file'
  id: string
  file: ResolvedFilePreview
  loadState: 'opening' | 'ready' | 'error'
  content: FilePreviewContent | null
  error: FilePreviewErrorPayload | null
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
  | { kind: 'cancelled' }
  | { kind: 'error'; error: FilePreviewErrorPayload }

export interface FilePreviewOpenFeedback {
  tabId: string
  sequence: number
  isNew: boolean
  focusTab?: boolean
}

export interface FilePreviewContextValue {
  tabs: PreviewTabModel[]
  activeTab: PreviewTabModel | null
  activeTabId: string | null
  openFeedback: FilePreviewOpenFeedback | null
  paneVisible: boolean
  open(request: OpenFilePreviewRequest, target?: FileLocationTarget): Promise<FilePreviewOpenOutcome>
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
  retry(tabId: string): Promise<void>
  changePage(tabId: string, direction: -1 | 1): Promise<void>
}

const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)

function errorFromUnknown(): FilePreviewErrorPayload {
  return {
    code: 'read_failed',
    message: '无法打开文件。',
    retryable: true
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
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [openFeedback, setOpenFeedback] = useState<FilePreviewOpenFeedback | null>(null)
  const [paneVisible, setPaneVisible] = useState(false)
  const tabsRef = useRef(tabs)
  const objectUrls = useRef(new Set<string>())
  const campIdRef = useRef(campId)
  const setTabs = useCallback((update: (current: PreviewTabModel[]) => PreviewTabModel[]) => {
    const next = update(tabsRef.current)
    tabsRef.current = next
    setTabsState(next)
  }, [])

  const revokeContent = useCallback((content: FilePreviewContent | null) => {
    if (content?.kind !== 'image') return
    URL.revokeObjectURL(content.url)
    objectUrls.current.delete(content.url)
  }, [])

  useEffect(() => {
    campIdRef.current = campId
    for (const tab of tabsRef.current) if (tab.kind === 'file') revokeContent(tab.content)
    tabsRef.current = []
    setTabsState([])
    setActiveTabId(null)
    setOpenFeedback(null)
    setPaneVisible(false)
    void window.rovai.filePreview.bindCamp(campId)
    return () => {
      if (campIdRef.current === campId) void window.rovai.filePreview.bindCamp(null)
    }
  }, [campId, revokeContent])

  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url)
    objectUrls.current.clear()
  }, [])

  useEffect(() => window.rovai.filePreview.onExternalUpdate((event) => {
    if (event.campId !== campIdRef.current) return
    const changed = new Set(event.previewKeys)
    setTabs((current) => current.map((tab) => tab.kind === 'file' && changed.has(tab.file.previewKey)
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

  const finishOpening = useCallback(async (file: ResolvedFilePreview): Promise<void> => {
    const loaded = await loadContent(file)
    const current = tabsRef.current.find((tab) => tab.id === file.previewKey)
    if (current?.kind !== 'file' || current.file.handleId !== file.handleId || current.file.target !== file.target) {
      if (loaded.ok) revokeContent(loaded.content)
      return
    }
    setTabs((entries) => entries.map((tab) => tab.kind !== 'file' || tab.id !== file.previewKey
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
        : { ...tab, loadState: 'error', error: loaded.error }))
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

  const installOpenResult = useCallback(async (
    result: OpenFilePreviewResult,
    focusTab = false
  ): Promise<FilePreviewOpenOutcome> => {
    if (result.kind === 'opened_in_system') return { kind: 'system' }
    if (result.kind === 'evidence_review') return { kind: 'evidence_review', result }
    const file = result.file
    const duplicate = tabsRef.current.find((tab) => tab.kind === 'file' && tab.id === file.previewKey)
    if (duplicate?.kind === 'file') {
      await window.rovai.filePreview.release({ handleId: file.handleId })
      const locatedFile = { ...duplicate.file, target: file.target }
      setTabs((current) => current.map((tab) => tab.kind === 'file' && tab.id === duplicate.id
        ? { ...tab, file: locatedFile }
        : tab))
      showOpenedTab(duplicate.id, false, focusTab)
      if (duplicate.loadState === 'opening' || (locatedFile.kind === 'paged_text' && locatedFile.target?.line)) {
        void finishOpening(locatedFile)
      }
      return { kind: 'preview', tabId: duplicate.id }
    }
    const tab: FilePreviewTabModel = {
      kind: 'file',
      id: file.previewKey,
      file,
      loadState: 'opening',
      content: null,
      error: null,
      hasExternalUpdate: file.hasExternalUpdate,
      externalUpdateVersion: file.hasExternalUpdate ? 1 : 0,
      isRefreshing: false,
      refreshError: null,
      pageOffsets: [],
      pageIndex: 0
    }
    setTabs((current) => [...current, tab])
    showOpenedTab(tab.id, true, focusTab)
    void finishOpening(file)
    return { kind: 'preview', tabId: tab.id }
  }, [finishOpening, setTabs, showOpenedTab])

  const open = useCallback(async (request: OpenFilePreviewRequest, target?: FileLocationTarget): Promise<FilePreviewOpenOutcome> => {
    const focusTab = Boolean(document.activeElement?.closest('.file-preview-pane'))
    const install = (result: OpenFilePreviewResult): Promise<FilePreviewOpenOutcome> => installOpenResult(
      target && result.kind === 'file_preview' ? { ...result, file: { ...result.file, target } } : result,
      focusTab
    )
    try {
      const result = await window.rovai.filePreview.open(request)
      if (result.ok) return install(result.value)
      const challenge = result.error.authorizationChallenge
      if (result.error.code !== 'authorization_required' || !challenge) {
        return { kind: 'error', error: result.error }
      }
      const granted = await window.rovai.filePreview.chooseAuthorizedRoot({
        campId: challenge.campId,
        pendingOpenId: challenge.pendingOpenId
      })
      if (!granted.ok) return { kind: 'error', error: granted.error }
      if (!granted.value) return { kind: 'cancelled' }
      return install(granted.value.result)
    } catch {
      return { kind: 'error', error: errorFromUnknown() }
    }
  }, [installOpenResult])

  const activate = useCallback((tabId: string) => {
    if (!tabsRef.current.some((tab) => tab.id === tabId)) return
    setActiveTabId(tabId)
    setPaneVisible(true)
  }, [])

  const showPane = useCallback(() => setPaneVisible(true), [])

  const hidePane = useCallback(() => setPaneVisible(false), [])

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
    const activeIndex = previous.findIndex((tab) => tab.id === activeTabId)
    const nextActiveTabId = remaining.length === 0
      ? null
      : activeTabId && !ids.has(activeTabId)
        ? activeTabId
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
      if (tab.kind === 'file') void window.rovai.filePreview.release({ handleId: tab.file.handleId })
    }
  }, [activeTabId, revokeContent, setTabs])

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

  const retry = useCallback(async (tabId: string): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file') return
    setTabs((current) => current.map((entry) => entry.kind === 'file' && entry.id === tabId
      ? { ...entry, loadState: 'opening', error: null }
      : entry))
    await finishOpening(tab.file)
  }, [finishOpening, setTabs])

  const reload = useCallback(async (tabId: string): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || tab.isRefreshing) return
    const refreshStartVersion = tab.externalUpdateVersion
    setTabs((current) => current.map((entry) => entry.id === tabId
      ? { ...entry, isRefreshing: true, refreshError: null }
      : entry))
    try {
      const result = await window.rovai.filePreview.reload({
        handleId: tab.file.handleId,
        reopenToken: tab.file.reopenToken,
        expectedGeneration: tab.file.contentGeneration
      })
      if (!result.ok) {
        setTabs((current) => current.map((entry) => entry.id === tabId
          ? { ...entry, isRefreshing: false, refreshError: result.error.message }
          : entry))
        return
      }
      const loaded = await loadContent(result.value)
      if (!loaded.ok) {
        setTabs((current) => current.map((entry) => entry.id === tabId
          ? {
              ...entry,
              file: result.value,
              isRefreshing: false,
              refreshError: loaded.error.message
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
      setTabs((current) => current.map((entry) => entry.id === tabId
        ? { ...entry, isRefreshing: false, refreshError: '重新加载失败' }
        : entry))
    }
  }, [loadContent, revokeContent, setTabs])

  const changePage = useCallback(async (tabId: string, direction: -1 | 1): Promise<void> => {
    const tab = tabsRef.current.find((entry) => entry.id === tabId)
    if (tab?.kind !== 'file' || tab.content?.kind !== 'page') return
    const nextIndex = tab.pageIndex + direction
    if (nextIndex < 0) return
    const offset = direction === 1
      ? tab.pageOffsets[nextIndex] ?? tab.content.page.endOffset
      : tab.pageOffsets[nextIndex]
    if (offset === undefined || offset < 0 || offset >= tab.file.size) return
    const result = await window.rovai.filePreview.readPage({
      handleId: tab.file.handleId,
      expectedGeneration: tab.file.contentGeneration,
      offset
    })
    if (!result.ok) return
    setTabs((current) => current.map((entry) => {
      if (entry.kind !== 'file' || entry.id !== tabId) return entry
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
    retry,
    changePage
  }), [activate, activeTab, activeTabId, changePage, close, closeMany, copyDisplayPath, hidePane, move, open, openFileChanges, openFeedback, openInSystem, paneVisible, reload, revealInFolder, retry, selectChangedFile, showPane, tabs])

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
