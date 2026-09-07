import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'

const STORAGE_KEY = 'rovai-member-roster-width-v2'
const LEGACY_STORAGE_KEY = 'rovai-member-roster-width-v1'
const DEFAULT_WIDTH = 256
const MIN_WIDTH = 192
const MAX_WIDTH = 360
const COLLAPSED_WIDTH = 76
const COLLAPSE_THRESHOLD = 176
const EXPAND_THRESHOLD = 208
const MIN_EDITOR_WIDTH = 400

interface RosterPreference {
  width: number
  collapsed: boolean
}

interface RosterControls {
  id: string
  width: number
  maxWidth: number
  collapsed: boolean
  sorting: boolean
  setSorting: Dispatch<SetStateAction<boolean>>
  setCollapsed(value: boolean): void
  setWidth(value: number, expand?: boolean): void
}

const RosterContext = createContext<RosterControls | null>(null)

export function useMemberRosterLayout(): RosterControls {
  const value = useContext(RosterContext)
  if (!value) throw new Error('Member roster must be inside MemberRosterLayout')
  return value
}

function initialPreference(): RosterPreference {
  const fallback = { width: DEFAULT_WIDTH, collapsed: false }
  if (typeof window === 'undefined') return fallback
  try {
    fallback.collapsed = window.localStorage.getItem(LEGACY_STORAGE_KEY) === 'collapsed'
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return fallback
    const { width, collapsed } = stored as Partial<RosterPreference>
    return {
      width: typeof width === 'number' && Number.isFinite(width)
        ? Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)))
        : DEFAULT_WIDTH,
      collapsed: typeof collapsed === 'boolean' ? collapsed : fallback.collapsed
    }
  } catch {
    return fallback
  }
}

export function MemberRosterLayout({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setPreference] = useState(initialPreference)
  const [maxWidth, setMaxWidth] = useState(MAX_WIDTH)
  const [sorting, setSorting] = useState(false)
  const [dragging, setDragging] = useState(false)
  const shellRef = useRef<HTMLDivElement>(null)
  const id = `member-roster-${useId()}`
  const width = Math.min(preference.width, maxWidth)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference))
    } catch {
      // Width and collapse are optional local presentation preferences.
    }
  }, [preference])

  useEffect(() => {
    const workspace = shellRef.current?.parentElement
    if (!workspace) return
    const measure = (): void => {
      setMaxWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, workspace.clientWidth - MIN_EDITOR_WIDTH)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])

  const setCollapsed = useCallback((collapsed: boolean): void => {
    setPreference((current) => current.collapsed === collapsed ? current : { ...current, collapsed })
  }, [])
  const setWidth = useCallback((value: number, expand = true): void => {
    const next = Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth, value)))
    setPreference((current) => {
      const collapsed = expand ? false : current.collapsed
      return current.width === next && current.collapsed === collapsed
        ? current
        : { width: next, collapsed }
    })
  }, [maxWidth])

  return (
    <RosterContext.Provider value={{ id, width, maxWidth, collapsed: preference.collapsed, sorting, setSorting, setCollapsed, setWidth }}>
      <div
        ref={shellRef}
        className={`member-editor-roster-shell ${dragging ? 'is-resizing' : ''}`}
        style={{ '--member-roster-width': `${preference.collapsed ? COLLAPSED_WIDTH : width}px` } as CSSProperties}
      >
        {children}
        <MemberRosterSeparator dragging={dragging} setDragging={setDragging} />
      </div>
    </RosterContext.Provider>
  )
}

function MemberRosterSeparator({ dragging, setDragging }: {
  dragging: boolean
  setDragging(value: boolean): void
}): React.JSX.Element {
  const { id, width, maxWidth, collapsed, sorting, setCollapsed, setWidth } = useMemberRosterLayout()
  const drag = useRef<{ x: number; width: number; expandedWidth: number; collapsed: boolean } | null>(null)
  const helpId = `${id}-resize-help`
  const stop = useCallback((): void => {
    drag.current = null
    setDragging(false)
  }, [setDragging])

  useEffect(() => {
    window.addEventListener('blur', stop)
    return () => window.removeEventListener('blur', stop)
  }, [stop])

  return (
    <div
      className={`member-roster-resizer ${dragging ? 'is-dragging' : ''}`}
      role="separator"
      tabIndex={sorting ? -1 : 0}
      aria-label="队员列表宽度"
      aria-disabled={sorting || undefined}
      aria-orientation="vertical"
      aria-valuemin={COLLAPSED_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={collapsed ? COLLAPSED_WIDTH : width}
      aria-valuetext={collapsed ? '已折叠，按右方向键展开' : `${width} 像素`}
      aria-controls={id}
      aria-describedby={helpId}
      title={collapsed ? '向右拖动展开；双击恢复默认' : '拖动调整宽度，继续向左拖动折叠；双击恢复默认'}
      onPointerDown={(event) => {
        if (sorting || event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { x: event.clientX, width: collapsed ? COLLAPSED_WIDTH : width, expandedWidth: width, collapsed }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        const gesture = drag.current
        if (!gesture) return
        const next = gesture.width + event.clientX - gesture.x
        if (gesture.collapsed) {
          if (next < EXPAND_THRESHOLD) return
          gesture.collapsed = false
          setWidth(next)
        } else if (next < COLLAPSE_THRESHOLD) {
          gesture.collapsed = true
          // Expanding with the button restores the width before this collapse gesture.
          setWidth(gesture.expandedWidth, false)
          setCollapsed(true)
        } else {
          setWidth(next)
        }
      }}
      onPointerUp={(event) => {
        stop()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => { if (!sorting) setWidth(DEFAULT_WIDTH) }}
      onKeyDown={(event) => {
        if (sorting) return
        if (event.key === 'Enter' || (event.key === 'ArrowLeft' && (collapsed || width <= MIN_WIDTH))) {
          event.preventDefault()
          setCollapsed(event.key === 'Enter' ? !collapsed : true)
          return
        }
        if (event.key === 'ArrowRight' && collapsed) {
          event.preventDefault()
          setCollapsed(false)
          return
        }
        const next = event.key === 'ArrowLeft' ? width - 16
          : event.key === 'ArrowRight' ? width + 16
          : event.key === 'Home' ? DEFAULT_WIDTH
          : event.key === 'End' ? maxWidth : null
        if (next === null) return
        event.preventDefault()
        setWidth(next)
      }}
    >
      <span className="member-roster-resize-hint" aria-hidden="true">{collapsed ? '已折叠' : `${width} px`}</span>
      <span id={helpId} className="member-roster-sr-only">左右方向键调整；最窄时按左方向键折叠，右方向键展开，回车切换折叠，Home 恢复默认。也可使用名册选项和展开折叠按钮。</span>
    </div>
  )
}
