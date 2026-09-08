import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AppDialogGlyph, DialogControlIcon } from './AppDialog'

export type CapabilityFilter = 'all' | 'enabled' | 'disabled'
const WIDTH_KEY = 'rovai.capability-list-width.v1'
export const DEFAULT_CAPABILITY_WIDTH = 320
export function defaultCapabilityWidth(viewport: number): number {
  return viewport >= 2300 ? 400 : viewport >= 1600 ? 360 : DEFAULT_CAPABILITY_WIDTH
}
export function capabilityListWidth(preferred: number, available: number): number {
  return Math.round(
    Math.max(
      240,
      Math.min(
        Number.isFinite(preferred) ? preferred : DEFAULT_CAPABILITY_WIDTH,
        560,
        Math.max(240, available - 391)
      )
    )
  )
}
export function matchesCapabilityFilter(enabled: boolean, filter: CapabilityFilter): boolean {
  return filter === 'all' || enabled === (filter === 'enabled')
}

export function CapabilityWorkspace({
  title,
  count,
  search,
  onSearch,
  filter,
  onFilter,
  onAdd,
  addDisabled,
  importAction,
  list,
  children,
  selectionKey,
  header,
  libraryEmpty = false
}: {
  title: 'MCP' | 'Skills'
  count: ReactNode
  search: string
  onSearch(value: string): void
  filter?: CapabilityFilter
  onFilter?(value: CapabilityFilter): void
  onAdd(): void
  addDisabled?: boolean
  importAction?: ReactNode
  list: ReactNode
  children: ReactNode
  selectionKey: string | null
  header?: ReactNode
  libraryEmpty?: boolean
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const divider = useRef<HTMLDivElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  const previousSelection = useRef<string | null>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    width: number
  } | null>(null)
  const preferred = useRef<number | null>(null)
  const available = useRef(0)
  const currentWidth = useRef(DEFAULT_CAPABILITY_WIDTH)
  const [compact, setCompact] = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const id = useId()
  const setWidth = (value: number, save: boolean): void => {
    const width = capabilityListWidth(value, available.current)
    currentWidth.current = width
    root.current?.style.setProperty('--capability-list-width', `${width}px`)
    divider.current?.setAttribute('aria-valuenow', String(width))
    divider.current?.setAttribute(
      'aria-valuemax',
      String(Math.max(240, Math.min(560, Math.floor(available.current - 391))))
    )
    divider.current?.setAttribute('aria-valuetext', `列表宽度 ${width} 像素`)
    if (save) {
      preferred.current = width
      try {
        window.localStorage.setItem(WIDTH_KEY, String(width))
      } catch {
        /* Keep the in-window preference usable. */
      }
    }
  }
  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(WIDTH_KEY))
      if (stored >= 240 && stored <= 560) preferred.current = stored
    } catch {
      /* Local layout is available without storage. */
    }
    const measure = (): void => {
      available.current = root.current?.getBoundingClientRect().width ?? 0
      setCompact(available.current < 620)
      setWidth(preferred.current ?? defaultCapabilityWidth(window.innerWidth), false)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [libraryEmpty])
  useEffect(() => {
    if (selectionKey && previousSelection.current !== selectionKey) {
      setShowDetail(true)
      if (detail.current) detail.current.scrollTop = 0
    }
    previousSelection.current = selectionKey
  }, [selectionKey])
  const finish = (cancel = false): void => {
    const active = drag.current
    if (!active) return
    drag.current = null
    root.current?.removeAttribute('data-resizing')
    setWidth(cancel ? active.width : currentWidth.current, true)
    if (divider.current?.hasPointerCapture(active.pointerId))
      divider.current.releasePointerCapture(active.pointerId)
  }
  useEffect(() => {
    const onBlur = (): void => finish()
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])
  return (
    <div
      ref={root}
      className="capability-workspace"
      data-empty-library={libraryEmpty}
      data-compact={compact}
      data-pane={showDetail ? 'detail' : 'list'}
      style={
        {
          '--capability-list-width': `${DEFAULT_CAPABILITY_WIDTH}px`
        } as CSSProperties
      }
    >
      {!libraryEmpty && <aside className="capability-library" id={`${id}-list`} aria-label={`${title} 列表`}>
        <header className="capability-library-heading">
          <h1>
            {title}
            <span>{count}</span>
          </h1>
          <div className="capability-library-actions">
            <button
              type="button"
              className="quiet-button compact"
              onClick={() => {
                setShowDetail(true)
                onAdd()
              }}
              disabled={addDisabled}
            >
              {title === 'Skills' ? <AppDialogGlyph name="download" /> : <DialogControlIcon name="plus" />}
              {title === 'Skills' ? '导入' : '添加'}
            </button>
            {importAction}
          </div>
        </header>
        <label className="capability-search">
          <span className="sr-only">搜索 {title}</span>
          <input
            type="search"
            aria-label={`搜索 ${title}`}
            placeholder={`搜索 ${title === 'Skills' ? 'Skill' : 'MCP'}`}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
        {filter !== undefined && (
          <div className="capability-filters" role="group" aria-label={`${title} 启用状态`}>
            {(['all', 'enabled', 'disabled'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                aria-controls={`${id}-items`}
                onClick={() => onFilter?.(value)}
              >
                {{ all: '全部', enabled: '已启用', disabled: '已停用' }[value]}
              </button>
            ))}
          </div>
        )}
        <div
          id={`${id}-items`}
          className="capability-items"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[data-capability-item]')) setShowDetail(true)
          }}
        >
          {list}
        </div>
      </aside>}
      {!libraryEmpty && <div className="capability-divider-rail">
        <div
          ref={divider}
          className="capability-divider"
          role="separator"
          tabIndex={0}
          aria-label="调整列表宽度"
          aria-orientation="vertical"
          aria-valuemin={240}
          aria-valuemax={560}
          aria-valuenow={DEFAULT_CAPABILITY_WIDTH}
          aria-controls={`${id}-list ${id}-detail`}
          title="拖动调整宽度，双击复位；方向键也可调整"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              width: currentWidth.current
            }
            root.current?.setAttribute('data-resizing', 'true')
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId === event.pointerId)
              setWidth(drag.current.width + event.clientX - drag.current.startX, false)
          }}
          onPointerUp={() => finish()}
          onPointerCancel={() => finish(true)}
          onLostPointerCapture={() => finish()}
          onDoubleClick={() => {
            preferred.current = null
            try {
              window.localStorage.removeItem(WIDTH_KEY)
            } catch {}
            setWidth(defaultCapabilityWidth(window.innerWidth), false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              finish(true)
              return
            }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
            event.preventDefault()
            if (event.key === 'Enter') {
              preferred.current = null
              try {
                window.localStorage.removeItem(WIDTH_KEY)
              } catch {
                /* In-window reset remains available. */
              }
              setWidth(defaultCapabilityWidth(window.innerWidth), false)
              return
            }
            setWidth(
              event.key === 'Home'
                ? 240
                : event.key === 'End'
                  ? 560
                  : currentWidth.current +
                    (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 24 : 8),
              true
            )
          }}
        />
      </div>}
      <section id={`${id}-detail`} className="capability-detail" aria-label={`${title} 内容与配置`}>
        <button
          type="button"
          className="quiet-button compact capability-back"
          onClick={() => setShowDetail(false)}
        >
          ← 返回列表
        </button>
        {header && <div className="capability-detail-header">{header}</div>}
        <div className="capability-detail-scroll" ref={detail}>
          <div className="capability-detail-inner">{children}</div>
        </div>
      </section>
    </div>
  )
}

export function CapabilityListItem({
  name,
  mark,
  source,
  enabled,
  summary,
  selected,
  onSelect
}: {
  name: string
  mark: ReactNode
  source?: string
  enabled?: boolean
  summary: string
  selected: boolean
  onSelect(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-capability-item
      className="capability-item"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      title={name}
    >
      {mark}
      <span className="capability-item-copy">
        <span className="capability-item-heading">
          <span className="capability-item-name">{name}</span>
          {source && <span className="capability-source">{source}</span>}
          {enabled !== undefined && (
            <span
              className="capability-item-state"
              data-enabled={enabled}
              aria-label={enabled ? '已启用' : '已停用'}
            />
          )}
        </span>
        <span className="capability-item-summary">{summary}</span>
      </span>
    </button>
  )
}
export function CapabilityToggle({
  name,
  enabled,
  disabled,
  onToggle
}: {
  name: string
  enabled: boolean
  disabled: boolean
  onToggle(): void
}): React.JSX.Element {
  return (
    <div className="capability-toggle">
      <button
        type="button"
        className="skill-toggle"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? '停用' : '启用'} ${name}`}
        disabled={disabled}
        onClick={onToggle}
      >
        <span aria-hidden="true" />
      </button>
      <span>{enabled ? '已启用' : '已停用'}</span>
    </div>
  )
}
export function CapabilityError({
  error,
  onRetry
}: {
  error: string | null
  onRetry?(): void
}): React.JSX.Element | null {
  return error ? (
    <div className="capability-error" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button type="button" className="quiet-button compact" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  ) : null
}
