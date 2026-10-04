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
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import {
  DEFAULT_FILE_PREVIEW_RATIO,
  FILE_PREVIEW_RATIO_STORAGE_KEY,
  MIN_CONVERSATION_WIDTH,
  MIN_FILE_PREVIEW_WIDTH,
  filePreviewCloseThreshold,
  filePreviewDragWidth,
  filePreviewRatioForWidth,
  filePreviewRatioFromStoredValue,
  filePreviewSplitMinWidth,
  filePreviewWidthForRatio,
  maximumFilePreviewWidth
} from './file-preview-layout'
import { UiText, uiAttribute } from './interface-language'

interface FilePreviewLayoutValue {
  visible: boolean
  activityMode: boolean
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
  const ratio = preferredRatio ?? initialRatios.get(threadId ?? '') ?? DEFAULT_FILE_PREVIEW_RATIO
  const width = dragWidth ?? filePreviewWidthForRatio(availableWidth, ratio)
  const value = useMemo<FilePreviewLayoutValue>(() => ({
    visible,
    activityMode,
    compact,
    width,
    availableWidth,
    resizing: dragWidth !== null,
    className: [
      compact ? 'file-preview-compact' : '',
      dragWidth !== null ? 'is-file-preview-resizing' : '',
      dragWidth !== null && width < filePreviewCloseThreshold(activityMode) ? 'is-file-preview-close-armed' : '',
      snapping ? 'is-file-preview-snapping' : ''
    ].filter(Boolean).join(' '),
    style: { '--file-preview-width': `${Math.round(width)}px` } as CSSProperties,
    workspace,
    workspaceRef: setWorkspace,
    previewWidth,
    commitWidth,
    cancelResize,
    resetRatio
  }), [activityMode, availableWidth, cancelResize, commitWidth, compact, dragWidth, previewWidth, resetRatio, snapping, visible, width, workspace])

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
  return <div
    ref={layout?.workspaceRef}
    className={`workspace-grid inspector-collapsed${layout?.visible ? ` file-preview-open ${layout.className}` : ''}`}
    style={layout?.visible ? layout.style : undefined}
    hidden={hidden}
  >{children}</div>
}

interface ResizeGesture {
  scale: number
  pointerId: number
  target: HTMLDivElement
  availableWidth: number
  right: number
  grabOffset: number
  startWidth: number
  width: number
  moved: boolean
}

export function FilePreviewResizeHandle({ onClose }: { onClose(): void }): React.JSX.Element | null {
  const layout = useOptionalFilePreviewLayout()
  const gestureRef = useRef<ResizeGesture | null>(null)
  const frameRef = useRef<number | null>(null)
  const hintId = useId()
  const cancelResize = layout?.cancelResize

  const releaseGesture = useCallback((): void => {
    const gesture = gestureRef.current
    gestureRef.current = null
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId)
  }, [])

  const cancelGesture = useCallback((): void => {
    releaseGesture()
    cancelResize?.()
  }, [cancelResize, releaseGesture])

  useEffect(() => {
    if (!layout?.resizing) {
      releaseGesture()
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancelGesture()
    }
    document.documentElement.classList.add('file-preview-resizing')
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', cancelGesture)
    return () => {
      document.documentElement.classList.remove('file-preview-resizing')
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', cancelGesture)
    }
  }, [cancelGesture, layout?.resizing, releaseGesture])

  useEffect(() => () => {
    releaseGesture()
    cancelResize?.()
  }, [cancelResize, releaseGesture])

  if (!layout?.visible || layout.compact) return null

  const maximum = maximumFilePreviewWidth(layout.availableWidth)
  const closeArmed = layout.resizing && layout.width < filePreviewCloseThreshold(layout.activityMode)
  const atConversationMinimum = layout.width >= maximum
  const hint = closeArmed ? uiAttribute('松开关闭文件预览')
    : atConversationMinimum ? uiAttribute("会话区已达最小宽度 {0}px", String(MIN_CONVERSATION_WIDTH))
      : uiAttribute("会话 {0}px · 文件 {1}px", String(Math.round(layout.availableWidth - layout.width)), String(Math.round(layout.width)))

  const closePreview = (): void => {
    cancelGesture()
    onClose()
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.thread-timeline:not([hidden])')
        ?? document.querySelector<HTMLElement>('.timeline-pane')
      target?.focus({ preventScroll: true })
    })
  }

  const widthAtPointer = (gesture: ResizeGesture, clientX: number): number => filePreviewDragWidth(
    gesture.availableWidth,
    gesture.right - clientX / gesture.scale + gesture.grabOffset
  )

  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if (layout.availableWidth !== gesture.availableWidth) {
      cancelGesture()
      return
    }
    gesture.width = widthAtPointer(gesture, event.clientX)
    gesture.moved ||= Math.abs(gesture.width - gesture.startWidth) > .5
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      if (gestureRef.current === gesture) layout.previewWidth(gesture.width)
    })
  }

  // One rail belongs to the shell grid, spanning the shared header and the body without clipping.
  const shell = layout.workspace?.closest('.mission-workspace-host, .app-shell-camp')
  const handle = <div
    className={`file-preview-resize-handle${shell ? ' is-shell-divider' : ''}${layout.resizing ? ' is-resizing' : ''}${closeArmed ? ' is-close-armed' : ''}`}
    style={layout.style}
    role="separator"
    aria-label={uiAttribute("调整文件预览宽度")}
    aria-orientation="vertical"
    aria-valuemin={layout.resizing ? 0 : MIN_FILE_PREVIEW_WIDTH}
    aria-valuemax={Math.round(maximum)}
    aria-valuenow={Math.round(layout.width)}
    aria-valuetext={hint}
    aria-describedby={hintId}
    tabIndex={0}
    title={uiAttribute("拖动调整 · 双击恢复 44/56 · 方向键调整 · Delete 关闭")}
    onPointerDown={(event) => {
      if (event.button !== 0 || gestureRef.current) return
      const workspace = layout.workspace
      if (!workspace) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      const bounds = workspace.getBoundingClientRect()
      const scale = bounds.width / workspace.clientWidth
      gestureRef.current = {
        scale,
        pointerId: event.pointerId,
        target: event.currentTarget,
        availableWidth: workspace.clientWidth,
        right: bounds.right / scale,
        grabOffset: (event.clientX - bounds.right) / scale + layout.width,
        startWidth: layout.width,
        width: layout.width,
        moved: false
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      layout.previewWidth(layout.width)
    }}
    onPointerMove={moveGesture}
    onPointerUp={(event) => {
      const gesture = gestureRef.current
      if (!gesture || event.pointerId !== gesture.pointerId) return
      const width = widthAtPointer(gesture, event.clientX)
      const moved = gesture.moved || Math.abs(width - gesture.startWidth) > .5
      releaseGesture()
      if (layout.availableWidth !== gesture.availableWidth || !moved) {
        layout.cancelResize()
      } else if (width < filePreviewCloseThreshold(layout.activityMode)) {
        closePreview()
      } else {
        layout.commitWidth(width)
      }
    }}
    onPointerCancel={(event) => {
      if (event.pointerId === gestureRef.current?.pointerId) cancelGesture()
    }}
    onLostPointerCapture={(event) => {
      if (event.pointerId === gestureRef.current?.pointerId) cancelGesture()
    }}
    onDoubleClick={() => {
      cancelGesture()
      layout.resetRatio()
    }}
    onKeyDown={(event) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        closePreview()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        cancelGesture()
        const step = event.shiftKey ? 80 : 24
        layout.commitWidth(layout.width + (event.key === 'ArrowLeft' ? step : -step))
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelGesture()
      }
    }}
  >
    <span className="file-preview-splitter-grip" aria-hidden="true" />
    <span className="file-preview-splitter-tip" aria-hidden="true">{hint}</span>
    <span className="sr-only" id={hintId}><UiText zh={"左右方向键调整 24px，按住 Shift 调整 80px；Delete 或 Backspace 关闭；双击恢复默认比例；Escape 取消拖动。"} /></span>
    <span className="sr-only" role="status">{closeArmed ? uiAttribute("松开关闭文件预览") : ''}</span>
  </div>
  return shell ? createPortal(handle, shell) : handle
}
