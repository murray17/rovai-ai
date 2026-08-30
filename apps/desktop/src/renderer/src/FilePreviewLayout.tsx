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
import {
  DEFAULT_FILE_PREVIEW_RATIO,
  FILE_PREVIEW_CLOSE_THRESHOLD,
  FILE_PREVIEW_RATIO_STORAGE_KEY,
  FILE_PREVIEW_SPLIT_MIN_WIDTH,
  MIN_CONVERSATION_WIDTH,
  MIN_FILE_PREVIEW_WIDTH,
  filePreviewDragWidth,
  filePreviewRatioForWidth,
  filePreviewRatioFromStoredValue,
  filePreviewWidthForRatio,
  maximumFilePreviewWidth
} from './file-preview-layout'

interface FilePreviewLayoutValue {
  visible: boolean
  compact: boolean
  width: number
  availableWidth: number
  resizing: boolean
  className: string
  style: CSSProperties
  workspaceRef(element: HTMLDivElement | null): void
  previewWidth(width: number): void
  commitWidth(width: number): void
  cancelResize(): void
  resetRatio(): void
}

const FilePreviewLayoutContext = createContext<FilePreviewLayoutValue | null>(null)

function readPreferredRatio(): number {
  try {
    return filePreviewRatioFromStoredValue(window.localStorage.getItem(FILE_PREVIEW_RATIO_STORAGE_KEY))
  } catch {
    return DEFAULT_FILE_PREVIEW_RATIO
  }
}

// Layout updates have their own context so dragging does not rerender the Camp or file contents.
export function FilePreviewLayoutProvider({
  campId,
  visible,
  children
}: {
  campId: string | null
  visible: boolean
  children: ReactNode
}): React.JSX.Element {
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const availableWidthRef = useRef(0)
  const [preferredRatio, setPreferredRatio] = useState(readPreferredRatio)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [snapping, setSnapping] = useState(false)
  const snapTimer = useRef<number | null>(null)

  const cancelResize = useCallback(() => setDragWidth(null), [])

  useLayoutEffect(() => {
    if (!workspace) return
    const measure = (): void => {
      const width = workspace.getBoundingClientRect().width
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

  useEffect(cancelResize, [campId, visible, cancelResize])
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

  const resetRatio = useCallback(() => saveRatio(DEFAULT_FILE_PREVIEW_RATIO), [saveRatio])
  const previewWidth = useCallback((width: number): void => {
    if (!Number.isFinite(width)) return
    setSnapping(false)
    setDragWidth(filePreviewDragWidth(availableWidthRef.current, width))
  }, [])

  const compact = availableWidth < FILE_PREVIEW_SPLIT_MIN_WIDTH
  const width = dragWidth ?? filePreviewWidthForRatio(availableWidth, preferredRatio)
  const value = useMemo<FilePreviewLayoutValue>(() => ({
    visible,
    compact,
    width,
    availableWidth,
    resizing: dragWidth !== null,
    className: [
      compact ? 'file-preview-compact' : '',
      dragWidth !== null ? 'is-file-preview-resizing' : '',
      dragWidth !== null && width < FILE_PREVIEW_CLOSE_THRESHOLD ? 'is-file-preview-close-armed' : '',
      snapping ? 'is-file-preview-snapping' : ''
    ].filter(Boolean).join(' '),
    style: { '--file-preview-width': `${width}px` } as CSSProperties,
    workspaceRef: setWorkspace,
    previewWidth,
    commitWidth,
    cancelResize,
    resetRatio
  }), [availableWidth, cancelResize, commitWidth, compact, dragWidth, previewWidth, resetRatio, snapping, visible, width])

  return <FilePreviewLayoutContext.Provider value={value}>{children}</FilePreviewLayoutContext.Provider>
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
  const closeArmed = layout.resizing && layout.width < FILE_PREVIEW_CLOSE_THRESHOLD
  const atConversationMinimum = layout.width >= maximum
  const hint = closeArmed ? '松开关闭文件预览'
    : atConversationMinimum ? `会话区已达最小宽度 ${MIN_CONVERSATION_WIDTH}px`
      : `会话 ${Math.round(layout.availableWidth - layout.width)}px · 文件 ${Math.round(layout.width)}px`

  const closePreview = (): void => {
    cancelGesture()
    onClose()
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('.camp-timeline:not([hidden])')
        ?? document.querySelector<HTMLElement>('.timeline-pane')
      target?.focus({ preventScroll: true })
    })
  }

  const widthAtPointer = (gesture: ResizeGesture, clientX: number): number => filePreviewDragWidth(
    gesture.availableWidth,
    gesture.right - clientX + gesture.grabOffset
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

  return <div
    className={`file-preview-resize-handle${layout.resizing ? ' is-resizing' : ''}${closeArmed ? ' is-close-armed' : ''}`}
    role="separator"
    aria-label="调整文件预览宽度"
    aria-orientation="vertical"
    aria-valuemin={layout.resizing ? 0 : MIN_FILE_PREVIEW_WIDTH}
    aria-valuemax={Math.round(maximum)}
    aria-valuenow={Math.round(layout.width)}
    aria-valuetext={hint}
    aria-describedby={hintId}
    tabIndex={0}
    title="拖动调整 · 双击恢复 44/56 · 方向键调整 · Delete 关闭"
    onPointerDown={(event) => {
      if (event.button !== 0 || gestureRef.current) return
      const workspace = event.currentTarget.parentElement
      if (!workspace) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      const bounds = workspace.getBoundingClientRect()
      gestureRef.current = {
        pointerId: event.pointerId,
        target: event.currentTarget,
        availableWidth: bounds.width,
        right: bounds.right,
        grabOffset: event.clientX - (bounds.right - layout.width),
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
      } else if (width < FILE_PREVIEW_CLOSE_THRESHOLD) {
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
    <span className="sr-only" id={hintId}>左右方向键调整 24px，按住 Shift 调整 80px；Delete 或 Backspace 关闭；双击恢复默认比例；Escape 取消拖动。</span>
    <span className="sr-only" role="status">{closeArmed ? '松开关闭文件预览' : ''}</span>
  </div>
}
