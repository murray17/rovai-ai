import { useProjectFileComposer } from './ProjectFileComposerContext'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import type { ProjectFileEntry } from '@contracts'
import { ProjectFileIcon, ProjectFolderIcon } from './ProjectFileIcon'
import { useProjectFiles } from './ProjectFilesContext'
import { ProjectFilesStore } from './project-files-store'
import { useOptionalFilePreview } from './FilePreviewContext'
import { useInitializeFilePreviewMinimumWidth, useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { DEFAULT_DIRECTORY_WIDTH, MIN_DIRECTORY_WIDTH, MAX_DIRECTORY_WIDTH } from './file-preview-layout'
import { useCollapsibleSplitter, splitterScale } from './useCollapsibleSplitter'
import { uiAttribute } from './interface-language'
import { useShortcutLabel } from './ShortcutProvider'
import './project-files.css'

export function ProjectFilesButton(): React.JSX.Element | null {
  const browser = useProjectFiles(), shortcut = useShortcutLabel('project-files')
  if (!browser?.store) return null
  const label = `${uiAttribute(browser.visible ? '隐藏文件目录' : '显示文件目录')} (${shortcut})`
  return <button type="button" className="project-files-toggle" data-active={browser.active} aria-label={label} title={label} aria-controls="project-files-pane" aria-expanded={browser.visible} onClick={event => browser.toggle(event.currentTarget)}><ProjectFolderIcon /></button>
}

interface Row { entry: ProjectFileEntry; depth: number; parent: string }
function FileTree({ store, onOpen }: { store: ProjectFilesStore; onOpen(entry: ProjectFileEntry): Promise<void> }): React.JSX.Element {
  const composer = useProjectFileComposer()
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const search = !!state.query.trim()
  const scroll = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState<string | null>(state.selected)
  const [referenceError, setReferenceError] = useState(false)
  useEffect(() => setReferenceError(false), [store, state.query])
  const rows: Row[] = []
  function visit(parent: string, depth: number): void {
    const page = state.pages.get(parent)
    for (const entry of page?.entries.slice(0, page.visibleCount) ?? []) {
      rows.push({ entry, depth, parent })
      if (entry.directory && state.expanded.has(entry.id)) visit(entry.id, depth + 1)
    }
  }
  if (!state.loading) {
    if (search) for (const entry of state.results?.entries ?? []) rows.push({ entry, depth: 0, parent: 'root' })
    else visit('root', 0)
  }
  const focusId = rows.some(row => row.entry.id === focused) ? focused : rows[0]?.entry.id
  const visiblePages = [...state.pages.entries()].filter(([id]) => id === 'root' || rows.some(row => row.entry.id === id && row.entry.directory && state.expanded.has(id)))
  useEffect(() => { if (!state.query.trim()) return; const timer = setTimeout(() => { void store.search() }, 150); return () => clearTimeout(timer) }, [store, state.query])
  useLayoutEffect(() => { if (scroll.current && !state.loading) scroll.current.scrollTop = store.scrollTop }, [store, state.loading])
  const focusRow = (id: string): void => {
    setFocused(id)
    requestAnimationFrame(() => { const row = scroll.current?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`); row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' }) })
  }
  const activate = (entry: ProjectFileEntry): void => { setFocused(entry.id); if (entry.directory) void store.toggle(entry); else void onOpen(entry) }
  const key = (event: KeyboardEvent, row: Row): void => {
    if (event.target !== event.currentTarget) return
    const index = rows.findIndex(value => value.entry.id === row.entry.id)
    let target: Row | undefined
    if (event.key === 'ArrowDown') target = rows[Math.min(rows.length - 1, index + 1)]
    else if (event.key === 'ArrowUp') target = rows[Math.max(0, index - 1)]
    else if (event.key === 'Home') target = rows[0]
    else if (event.key === 'End') target = rows.at(-1)
    else if (event.key === 'ArrowRight' && row.entry.directory) {
      if (!state.expanded.has(row.entry.id)) void store.toggle(row.entry)
      else target = rows[index + 1]?.parent === row.entry.id ? rows[index + 1] : undefined
    } else if (event.key === 'ArrowLeft') {
      if (row.entry.directory && state.expanded.has(row.entry.id)) void store.toggle(row.entry)
      else target = rows.find(value => value.entry.id === row.parent)
    } else if (event.key === 'Enter' || event.key === ' ') activate(row.entry)
    else return
    event.preventDefault(); if (target) focusRow(target.entry.id)
  }
  const problem = state.error || state.pages.get('root')?.error
  return <>
    <div className="project-files-search">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 4 4"/></svg>
      <input ref={input} value={state.query} aria-label={uiAttribute('搜索文件')} placeholder={uiAttribute('搜索文件')} spellCheck={false} onChange={event => store.setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Escape' && state.query) { event.stopPropagation(); event.preventDefault(); store.setQuery('') }
        if (event.key === 'ArrowDown' && rows[0]) { event.preventDefault(); focusRow(rows[0].entry.id) }
        if (event.key === 'Enter' && rows[0]) { event.preventDefault(); activate(rows[0].entry) }
      }}/>
      {state.query && <button type="button" aria-label={uiAttribute('清除搜索')} title={uiAttribute('清除搜索')} onClick={() => { store.setQuery(''); input.current?.focus() }}>×</button>}
    </div>
    {referenceError && <p className="ref-source-note" role="status">{uiAttribute('暂时无法引用此文件，请重试')}</p>}
    {problem && <div className="project-files-feedback" role="status"><span>{uiAttribute(problem === 'root_unavailable' || problem === 'scope_expired' ? '工作目录不可用' : '无法读取目录')}</span><button onClick={store.retry}>{uiAttribute('重试')}</button></div>}
    {!problem && state.watchFailed && <div className="project-files-feedback" role="status"><span>{uiAttribute('自动刷新不可用')}</span><button onClick={store.retry}>{uiAttribute('刷新')}</button></div>}
    <div ref={scroll} className="project-files-rows" role="tree" aria-label={state.name || uiAttribute('文件目录')} aria-busy={state.loading || state.searching} onScroll={event => { if (!state.loading) store.scrollTop = event.currentTarget.scrollTop }}>
      {rows.map(row => <div key={row.entry.id}>
        <div role="treeitem" data-entry-id={row.entry.id} tabIndex={row.entry.id === focusId ? 0 : -1}
          aria-level={row.depth + 1} aria-selected={state.selected === row.entry.id} aria-expanded={row.entry.directory ? state.expanded.has(row.entry.id) : undefined} aria-disabled={row.entry.unavailable || undefined}
          className={`project-files-row${search ? ' is-search-result' : ''}`} style={{ paddingLeft: 10 + row.depth * 16 }} title={row.entry.relativePath}
          onFocus={() => setFocused(row.entry.id)} onKeyDown={event => key(event, row)} onClick={() => activate(row.entry)}>
          <span className="project-files-chevron">{row.entry.directory && <svg viewBox="0 0 16 16" className={state.expanded.has(row.entry.id) ? 'is-expanded' : ''} aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>}</span>
          {row.entry.directory ? <ProjectFolderIcon /> : <ProjectFileIcon fileName={row.entry.name}/>}
          <span className="project-files-name">{row.entry.name}{search && <small>{row.entry.relativePath}</small>}</span>
          {!row.entry.directory && !row.entry.unavailable && composer?.target?.enabled && composer.target.threadId === store.threadId && <button type="button" className="project-files-reference" aria-label={uiAttribute('引用 {0} 到输入框', row.entry.relativePath)} title={uiAttribute('引用到输入框')} onClick={event => {
            event.stopPropagation()
            setReferenceError(false)
            void store.open(row.entry).then(source => { if (source?.kind === 'project_file') return composer.reference(source); throw new Error('source_unavailable') }).catch(() => setReferenceError(true))
          }}>@</button>}
        </div>
        {row.entry.directory && state.expanded.has(row.entry.id) && state.pages.get(row.entry.id)?.error && <div className="project-files-feedback"><span>{uiAttribute('无法读取目录')}</span><button onClick={() => { void store.load(row.entry.id) }}>{uiAttribute('重试')}</button></div>}
        {row.entry.directory && state.expanded.has(row.entry.id) && state.pages.get(row.entry.id)?.loading && <div className="project-files-status">{uiAttribute('正在载入…')}</div>}
      </div>)}
      {(state.loading || state.searching || state.pages.get('root')?.loading) && <div className="project-files-status" role="status">{uiAttribute('正在载入…')}</div>}
      {!problem && !state.loading && !state.searching && !rows.length && !(search ? state.results?.partial : state.pages.get('root')?.partial) && <div className="project-files-status">{uiAttribute(search ? '没有匹配的文件' : '空目录')}</div>}
      {(search ? state.results?.partial : visiblePages.some(([, page]) => page.partial)) && <div className="project-files-status">{uiAttribute(search ? '结果未全部显示，请缩小搜索范围' : '部分目录内容未显示')}</div>}
      {!search && visiblePages.filter(([, page]) => page.visibleCount < page.entries.length).map(([id, page]) => <button className="project-files-more" key={id} disabled={page.loading} onClick={() => store.showMore(id)}>{uiAttribute('加载更多')}{id === 'root' ? '' : ` · ${rows.find(row => row.entry.id === id)?.entry.name ?? ''}`}</button>)}
    </div>
  </>
}

export function ProjectFilesPane(): React.JSX.Element | null {
  const browser = useProjectFiles(), layout = useOptionalFilePreviewLayout(), preview = useOptionalFilePreview()
  const initialize = useInitializeFilePreviewMinimumWidth()
  const pane = useRef<HTMLElement>(null)
  const width = layout?.directoryWidth ?? DEFAULT_DIRECTORY_WIDTH, maximum = layout?.directoryMaximum ?? MAX_DIRECTORY_WIDTH
  const splitter = useCollapsibleSplitter({
    size: width, minimum: MIN_DIRECTORY_WIDTH, maximum, direction: -1, collapsed: false, disabled: !browser?.visible,
    scopeKey: browser?.store?.threadId, scale: () => splitterScale(layout?.workspace ?? null), capture: () => width,
    onPreview: next => browser?.setWidth(next), onCommit: next => browser?.setWidth(next, true),
    onCollapse: () => browser?.hide(true), onCancel: before => browser?.setWidth(before),
    onActiveChange: active => document.documentElement.classList.toggle('project-files-resizing', active)
  })
  useEffect(() => {
    if (browser?.visible && layout?.directoryDrawer) pane.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [browser?.visible, layout?.directoryDrawer])
  if (!browser?.store) return null
  const open = async (entry: ProjectFileEntry): Promise<void> => {
    const source = await browser.store!.open(entry)
    if (!source || !preview) return
    initialize?.()
    void preview.open(source, undefined, { fileName: entry.name })
    if (layout?.directoryDrawer) browser.hide()
  }
  return <>
    {browser.visible && <>
      {layout?.directoryDrawer && <button className="project-files-scrim" tabIndex={-1} aria-label={uiAttribute('隐藏文件目录')} onClick={() => browser.hide(true)}/>}
      <aside id="project-files-pane" ref={pane} className={`project-files-pane${layout?.directoryDrawer ? ' is-drawer' : ''}`} style={{ width }} aria-label={uiAttribute('文件目录')}
        onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); browser.hide(true) } }}>
        <div className="project-files-resize" role="separator" aria-label={uiAttribute('调整文件目录宽度')} aria-orientation="vertical" aria-valuemin={MIN_DIRECTORY_WIDTH} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(width)} tabIndex={0} {...splitter.handlers}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const next = width + (event.key === 'ArrowLeft' ? 24 : -24); if (next < MIN_DIRECTORY_WIDTH) browser.hide(true); else browser.setWidth(Math.min(maximum, next), true) }
            else if (event.key === 'Home') { event.preventDefault(); browser.setWidth(DEFAULT_DIRECTORY_WIDTH, true) }
          }}/>
        <FileTree store={browser.store} onOpen={open}/>
      </aside>
    </>}
  </>
}
