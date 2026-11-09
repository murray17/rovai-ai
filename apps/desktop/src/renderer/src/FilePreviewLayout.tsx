import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_FILE_PREVIEW_RATIO,
  FILE_PREVIEW_RATIO_STORAGE_KEY,
  MIN_CONVERSATION_WIDTH,
  MIN_FILE_PREVIEW_WIDTH,
  DEFAULT_DIRECTORY_WIDTH,
  MIN_DIRECTORY_WIDTH,
  MAX_DIRECTORY_WIDTH,
  MIN_DIRECTORY_READING_WIDTH,
  filePreviewDragWidth,
  filePreviewRatioForWidth,
  filePreviewRatioFromStoredValue,
  filePreviewSplitMinWidth,
  filePreviewWidthForRatio,
  maximumFilePreviewWidth
} from './file-preview-layout'
import { UiText, uiAttribute } from './interface-language'
import { splitterScale, useCollapsibleSplitter, type FoldEdge } from './useCollapsibleSplitter'
import { SplitterFeedback } from './SplitterFeedback'
import { useProjectFiles } from './ProjectFilesContext'
import { ProjectFilesPane } from './ProjectFilesPane'

interface FilePreviewLayoutValue {
  directoryWidth: number
  directoryReservedWidth: number
  directoryMaximum: number
  directoryDrawer: boolean
  threadId: string | null
  visible: boolean
  activityMode: boolean
  expanded: boolean
  foldPreview: FoldEdge | null
  setExpanded(expanded: boolean): void
  setFoldPreview(edge: FoldEdge | null): void
  rememberConversation(): void
  previewCollapse(width: number): void
  compact: boolean
  width: number
  availableWidth: number
  resizing: boolean
  className: string
  style: CSSProperties
  workspace: HTMLDivElement | null
  workspaceRef(element: HTMLDivElement | null): void
  previewWidth(width: number): void
  commitWidth(width: number): void
  cancelResize(): void
  resetRatio(): void
}

const FilePreviewLayoutContext = createContext<FilePreviewLayoutValue | null>(null)
// Initializing a pane must not subscribe the conversation to drag geometry.
const FilePreviewInitialWidthContext = createContext<(() => void) | null>(null)

function readPreferredRatio(): number | null {
  try {
    return filePreviewRatioFromStoredValue(window.localStorage.getItem(FILE_PREVIEW_RATIO_STORAGE_KEY))
  } catch {
    return null
  }
}

// Layout updates have their own context so dragging does not rerender the Thread or file contents.
export function FilePreviewLayoutProvider({
  threadId,
  visible,
  activityMode = false,
  children
}: {
  threadId: string | null
  visible: boolean
  activityMode?: boolean
  children: ReactNode
}): React.JSX.Element {
  const [readingExpanded, updateExpanded] = useState(false)
  const browser = useProjectFiles()
  const [foldPreview, setFoldPreview] = useState<FoldEdge | null>(null)
  const readingPositions = useRef<Array<{ element: HTMLElement; top: number; left: number }>>([])
  const rememberConversation = useCallback(() => {
    readingPositions.current = [...document.querySelectorAll<HTMLElement>('.timeline-pane, .timeline-pane *')]
      .filter(element => element.clientWidth > 0 && element.clientHeight > 0 && (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth))
      .map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }))
  }, [])
  const setExpanded = useCallback((next: boolean) => {
    updateExpanded(next)
    if (!next) requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.file-preview-expand-toggle')?.focus({ preventScroll: true })
    })
  }, [])
  const expanded = readingExpanded || foldPreview === 'maximum'
  const wasExpanded = useRef(false)
  useLayoutEffect(() => {
    const restore = wasExpanded.current && !expanded
    wasExpanded.current = expanded
    if (!restore) return
    const frame = requestAnimationFrame(() => {
      for (const saved of readingPositions.current) if (saved.element.isConnected) {
        saved.element.scrollTop = saved.top
        saved.element.scrollLeft = saved.left
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [expanded])
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const availableWidthRef = useRef(0)
  const [preferredRatio, setPreferredRatio] = useState(readPreferredRatio)
  const [initialRatios, setInitialRatios] = useState<ReadonlyMap<string, number>>(() => new Map())
  const openedThreads = useRef(new Set<string>())
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [snapping, setSnapping] = useState(false)
  const snapTimer = useRef<number | null>(null)

  const cancelResize = useCallback(() => setDragWidth(null), [])

  useLayoutEffect(() => {
    if (threadId && visible) openedThreads.current.add(threadId)
  }, [threadId, visible])

  const initializeMinimumWidth = useCallback((): void => {
    if (!threadId || visible || preferredRatio !== null || openedThreads.current.has(threadId)) return
    const ratio = filePreviewRatioForWidth(availableWidthRef.current, MIN_FILE_PREVIEW_WIDTH)
    if (ratio === null) return
    openedThreads.current.add(threadId)
    setInitialRatios(current => new Map(current).set(threadId, ratio))
  }, [preferredRatio, threadId, visible])

  useLayoutEffect(() => {
    if (!workspace) return
    const measure = (): void => {
      const width = workspace.clientWidth
      if (width <= 0 || width === availableWidthRef.current) return
      availableWidthRef.current = width
      setAvailableWidth(width)
      setDragWidth(null)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(workspace)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [workspace])

  useEffect(cancelResize, [activityMode, threadId, visible, cancelResize])
  useEffect(() => () => {
    if (snapTimer.current !== null) window.clearTimeout(snapTimer.current)
  }, [])

  const saveRatio = useCallback((ratio: number): void => {
    setPreferredRatio(ratio)
    setDragWidth(null)
    setSnapping(true)
    if (snapTimer.current !== null) window.clearTimeout(snapTimer.current)
    snapTimer.current = window.setTimeout(() => setSnapping(false), 180)
    try {
      window.localStorage.setItem(FILE_PREVIEW_RATIO_STORAGE_KEY, String(ratio))
    } catch {
      // A blocked storage area keeps the last stable ratio usable for this window.
    }
  }, [])

  const commitWidth = useCallback((width: number): void => {
    const ratio = filePreviewRatioForWidth(availableWidthRef.current, width)
    if (ratio !== null) saveRatio(ratio)
  }, [saveRatio])

  const resetRatio = useCallback(() => {
    saveRatio(DEFAULT_FILE_PREVIEW_RATIO)
  }, [saveRatio])
  const previewWidth = useCallback((width: number): void => {
    if (!Number.isFinite(width)) return
    setSnapping(false)
    setDragWidth(filePreviewDragWidth(availableWidthRef.current, width))
  }, [])

  const compact = availableWidth < filePreviewSplitMinWidth(activityMode)
  useLayoutEffect(() => {
    updateExpanded(false)
    setFoldPreview(null)
    readingPositions.current = []
  }, [threadId])
  useLayoutEffect(() => {
    if (!visible || compact) { updateExpanded(false); setFoldPreview(null) }
  }, [visible, compact])
  useEffect(() => {
    if (!readingExpanded) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
      const overlay = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"], .file-find-surface, .conversation-search')]
        .some(element => !element.classList.contains('mission-workspace-host') && element.getClientRects().length > 0)
      if (overlay || document.documentElement.classList.contains('file-preview-resizing') || document.querySelector('.navigation-resizing')) return
      event.preventDefault()
      event.stopPropagation()
      setExpanded(false)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [readingExpanded, setExpanded])
  const previewCollapse = useCallback((width: number) => {
    setSnapping(false)
    setDragWidth(Math.max(0, Math.min(availableWidthRef.current, width)))
  }, [])
  const ratio = preferredRatio ?? initialRatios.get(threadId ?? '') ?? DEFAULT_FILE_PREVIEW_RATIO
  const width = dragWidth ?? filePreviewWidthForRatio(availableWidth, ratio)
  // The outer split owns the entire sidecar. Its directory resizes only the inner reading area.
  const sidecarWidth = compact || expanded ? availableWidth : width
  const directorySpace = sidecarWidth - MIN_DIRECTORY_READING_WIDTH
  const directoryDrawer = compact || directorySpace < MIN_DIRECTORY_WIDTH
  const directoryMaximum = Math.max(MIN_DIRECTORY_WIDTH, Math.min(MAX_DIRECTORY_WIDTH,
    directoryDrawer ? sidecarWidth - 24 : directorySpace))
  const directoryWidth = Math.min(directoryMaximum, Math.max(MIN_DIRECTORY_WIDTH, browser?.width ?? DEFAULT_DIRECTORY_WIDTH))
  const directoryReservedWidth = browser?.visible && !directoryDrawer ? directoryWidth : 0
  const value = useMemo<FilePreviewLayoutValue>(() => ({
    directoryWidth, directoryReservedWidth, directoryMaximum, directoryDrawer,
    threadId,
    visible,
    activityMode,
    expanded,
    foldPreview,
    setExpanded,
    setFoldPreview,
    rememberConversation,
    previewCollapse,
    compact,
    width,
    availableWidth,
    resizing: dragWidth !== null,
    className: [
      directoryReservedWidth ? 'project-files-inline' : '',
      compact ? 'file-preview-compact' : '',
      expanded ? 'file-preview-expanded' : '',
      foldPreview === 'minimum' ? 'file-preview-folded' : '',
      dragWidth !== null ? 'is-file-preview-resizing' : '',
      snapping ? 'is-file-preview-snapping' : ''
    ].filter(Boolean).join(' '),
    style: { '--file-preview-width': `${Math.round(width)}px`, '--project-files-width': `${Math.round(directoryReservedWidth)}px` } as CSSProperties,
    workspace,
    workspaceRef: setWorkspace,
    previewWidth,
    commitWidth,
    cancelResize,
    resetRatio
  }), [directoryWidth, directoryReservedWidth, directoryMaximum, directoryDrawer, expanded, foldPreview, setExpanded, rememberConversation, previewCollapse, activityMode, availableWidth, cancelResize, commitWidth, compact, dragWidth, previewWidth, resetRatio, snapping, threadId, visible, width, workspace])

  return <FilePreviewInitialWidthContext.Provider value={initializeMinimumWidth}>
    <FilePreviewLayoutContext.Provider value={value}>{children}</FilePreviewLayoutContext.Provider>
  </FilePreviewInitialWidthContext.Provider>
}

export function useInitializeFilePreviewMinimumWidth(): (() => void) | null {
  return useContext(FilePreviewInitialWidthContext)
}

export function useOptionalFilePreviewLayout(): FilePreviewLayoutValue | null {
  return useContext(FilePreviewLayoutContext)
}

export function FilePreviewWorkspace({ children, hidden }: { children: ReactNode; hidden?: boolean }): React.JSX.Element {
  const layout = useOptionalFilePreviewLayout()
  const browser = useProjectFiles()
  return <div
    ref={layout?.workspaceRef}
    className={`workspace-grid inspector-collapsed ${layout?.className ?? ''}${layout?.visible ? ' file-preview-open' : ''}${browser?.store ? ' project-files-workspace' : ''}`}
    style={layout?.style}
    hidden={hidden}
  >{children}{!layout?.directoryDrawer && <ProjectFilesPane />}</div>
}

export function FilePreviewResizeHandle({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const layout = useOptionalFilePreviewLayout()
  const hintId = useId()
  const maximum = maximumFilePreviewWidth(layout?.availableWidth ?? 0)
  const closePreview = (): void => {
    layout?.cancelResize()
    layout?.setExpanded(false)
    onClose()
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.thread-timeline:not([hidden])')
        ?? document.querySelector<HTMLElement>('.timeline-pane')
      target?.focus({ preventScroll: true })
    })
  }
  const splitter = useCollapsibleSplitter({
    size: layout?.width ?? MIN_FILE_PREVIEW_WIDTH, collapsed: false,
    minimum: MIN_FILE_PREVIEW_WIDTH, maximum, direction: -1,
    disabled: !layout?.visible || layout.compact || (layout.expanded && layout.foldPreview !== 'maximum'),
    scopeKey: layout?.threadId,
    scale: () => splitterScale(layout?.workspace ?? null),
    capture: () => { layout?.rememberConversation() },
    onPreview: width => layout?.previewWidth(width),
    onCommit: width => layout?.commitWidth(width),
    onCollapse: closePreview,
    onCollapseMaximum: () => { layout?.cancelResize(); layout?.setExpanded(true) },
    maximumCollapsedSize: layout?.availableWidth ?? 0,
    onCollapseFrame: width => layout?.previewCollapse(width),
    onCollapseMaximumFrame: width => layout?.previewCollapse(width),
    onFoldPreview: edge => layout?.setFoldPreview(edge),
    onCancel: () => layout?.cancelResize(),
    onActiveChange: active => {
      document.documentElement.classList.toggle('file-preview-resizing', active)
      if (active && layout) layout.previewWidth(layout.width)
    }
  })

  if (!layout?.visible || layout.compact || (layout.expanded && layout.foldPreview !== 'maximum')) return null

  const foldTarget = splitter.edge === 'maximum' ? uiAttribute('会话') : uiAttribute('预览区')
  const hint = splitter.phase === 'detent' ? uiAttribute('继续拖动收起{0}', foldTarget)
    : uiAttribute("会话 {0}px · 文件 {1}px", String(Math.round(layout.availableWidth - layout.width)), String(Math.round(layout.width)))

  // One rail belongs to the shell grid, spanning the shared header and the body without clipping.
  const shell = layout.workspace?.closest('.mission-workspace-host, .app-shell-camp')
  const handle = <div
    className={`file-preview-resize-handle${shell ? ' is-shell-divider' : ''}${layout.resizing ? ' is-resizing' : ''}${layout.foldPreview === 'maximum' ? ' is-conversation-collapsed' : ''}`}
    style={layout.foldPreview === 'maximum' ? { ...layout.style, '--file-preview-width': `${layout.availableWidth}px` } as CSSProperties : layout.style}
    role="separator"
    aria-label={uiAttribute("调整文件预览宽度")}
    aria-orientation="vertical"
    aria-valuemin={splitter.active ? 0 : MIN_FILE_PREVIEW_WIDTH}
    aria-valuemax={Math.round(splitter.active ? layout.availableWidth : maximum)}
    aria-valuenow={Math.round(layout.width)}
    aria-valuetext={hint}
    aria-describedby={hintId}
    tabIndex={0}
    title={uiAttribute("拖动调整 · 双击恢复 44/56 · 方向键调整 · Delete 关闭")}
    {...splitter.handlers}
    onDoubleClick={() => {
      splitter.cancel()
      layout.resetRatio()
    }}
    onKeyDown={(event) => {
      if (splitter.active) return
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault(); layout.rememberConversation(); layout.setExpanded(true); return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        closePreview()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = event.shiftKey ? 80 : 24
        layout.commitWidth(layout.width + (event.key === 'ArrowLeft' ? step : -step))
      } else if (event.key === 'Home') {
        event.preventDefault()
        layout.commitWidth(MIN_FILE_PREVIEW_WIDTH)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        layout.resetRatio()
      }
    }}
  >
    <span className="file-preview-splitter-grip" aria-hidden="true" />
    {splitter.phase !== 'detent' && <span className="file-preview-splitter-tip" aria-hidden="true">{hint}</span>}
    <SplitterFeedback phase={splitter.phase} target={splitter.target} label={uiAttribute('继续拖动收起{0}', foldTarget)} />
    <span className="sr-only" id={hintId}><UiText zh={"左右方向键调整 24px，按住 Shift 调整 80px；Home 最窄；Delete 或 Backspace 关闭；双击或 Enter 恢复默认比例；Escape 取消拖动。两栏各到 420 像素先停住，继续向内推 64 像素直接收起，无需松手或停留。按住反向拉回 24 像素恢复。Alt 加左方向键展开预览，右上角还原分栏或 Escape 恢复会话。"} /></span>
  </div>
  return shell ? createPortal(handle, shell) : handle
}

/** Shared by file, execution and activity tabs; mode belongs to the pane. */
export function FilePreviewExpandButton(): React.JSX.Element | null {
  const layout = useOptionalFilePreviewLayout()
  if (!layout?.visible || layout.compact) return null
  const label = layout.expanded ? uiAttribute('还原分栏') : uiAttribute('展开预览区')
  return <button className="file-preview-expand-toggle" type="button" aria-label={label} title={label}
    aria-pressed={layout.expanded} aria-controls="file-preview-pane" disabled={layout.resizing}
    onClick={() => {
      if (!layout.expanded) layout.rememberConversation()
      layout.cancelResize()
      layout.setExpanded(!layout.expanded)
    }}>
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d={layout.expanded ? 'M11 3v6h6M3 11h6v6' : 'M12 3h5v5M3 12v5h5'} />
    </svg>
  </button>
}
