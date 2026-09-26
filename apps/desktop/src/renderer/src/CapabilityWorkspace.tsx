import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AppDialogGlyph, DialogControlIcon } from './AppDialog'
import { useMobileLayout } from './MobileLayout'
import { useCapabilitySplitter } from './useCapabilitySplitter'
export { DEFAULT_CAPABILITY_WIDTH, defaultCapabilityWidth, capabilityListWidth } from './useCapabilitySplitter'

export type CapabilityFilter = 'all' | 'enabled' | 'disabled'
const WIDTH_KEY = 'rovai.capability-list-width.v1'
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
  const mobile = useMobileLayout()
  const detail = useRef<HTMLDivElement>(null)
  const previousSelection = useRef<string | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const id = useId()
  const { root, compact, separator } = useCapabilitySplitter(WIDTH_KEY, `${id}-list ${id}-detail`, !libraryEmpty)
  useEffect(() => {
    if (selectionKey && previousSelection.current !== selectionKey && (!mobile || previousSelection.current !== null)) {
      setShowDetail(true)
      if (detail.current) detail.current.scrollTop = 0
    }
    previousSelection.current = selectionKey
  }, [selectionKey, mobile])
  return (
    <div
      ref={root}
      className="capability-workspace"
      data-empty-library={libraryEmpty}
      data-compact={compact}
      data-pane={showDetail ? 'detail' : 'list'}
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
      {!libraryEmpty && separator}
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
