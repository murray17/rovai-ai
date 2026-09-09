import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { EMPTY_FILE_FIND, type FileFindDocument, type FileFindMatch, type FileFindOptions, type FileFindResult } from './file-find'
import { searchFileDocuments } from './file-find-client'

export interface FileFindAdapter {
  scopeLabel: string
  changes?: boolean
  documents(options: FileFindOptions, signal: AbortSignal): FileFindDocument[] | Promise<FileFindDocument[]>
  show(matches: FileFindMatch[], current: number, scroll: boolean, clearance: number): void
  clear(): void
  focus(): void
  selection?(): string
  subscribe?(invalidate: () => void): () => void
}
interface FindController {
  supported: boolean
  opened: boolean
  open(allChanges?: boolean): void
  close(focus?: boolean): void
  navigate(direction: number): void
}
interface FindRegistry {
  activeTabId: string | null
  visible: boolean
  controller: FindController | null
  register(id: string, controller: FindController): () => void
  request(id: string, allChanges?: boolean): void
}
const Registry = createContext<FindRegistry | null>(null)
const AdapterContext = createContext<((adapter: FileFindAdapter) => () => void) | null>(null)
export function useOptionalFileFind(): FindRegistry | null { return useContext(Registry) }
export function useFileFindAdapter(adapter: FileFindAdapter | null): void {
  const register = useContext(AdapterContext)
  useEffect(() => adapter && register ? register(adapter) : undefined, [adapter, register])
}
export function isFileFindTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.file-preview-pane,.file-preview-tabs,.file-preview-find-trigger,.changed-file-popover'))
}

export function FileFindProvider({ activeTabId, visible, children }: { activeTabId: string | null; visible: boolean; children: ReactNode }): React.JSX.Element {
  const controllers = useRef(new Map<string, FindController>())
  const pending = useRef<{ id: string; allChanges: boolean } | null>(null)
  const [version, setVersion] = useState(0)
  const current = useRef({ activeTabId, visible })
  current.current = { activeTabId, visible }
  const register = useCallback((id: string, controller: FindController) => {
    controllers.current.set(id, controller)
    setVersion(value => value + 1)
    if (pending.current?.id === id && controller.supported) {
      const { allChanges } = pending.current
      pending.current = null
      controller.open(allChanges)
    }
    return () => {
      if (controllers.current.get(id) === controller) controllers.current.delete(id)
      setVersion(value => value + 1)
    }
  }, [])
  const request = useCallback((id: string, allChanges = false) => {
    const controller = controllers.current.get(id)
    if (controller?.supported) controller.open(allChanges)
    else pending.current = { id, allChanges }
  }, [])
  useEffect(() => {
    if (!visible || (pending.current && pending.current.id !== activeTabId)) pending.current = null
  }, [activeTabId, visible])
  useEffect(() => {
    let lastRegion: 'file' | 'conversation' = 'conversation'
    const track = (event: Event): void => {
      if (isFileFindTarget(event.target)) lastRegion = 'file'
      else if (event.target instanceof Element && event.target.closest('.camp-workspace,.topbar-conversation-context')) lastRegion = 'conversation'
    }
    const shortcut = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.altKey || !current.current.visible) return
      // The portaled picker closes itself before handing Cmd/Ctrl+F to this controller.
      if (event.target instanceof Element && event.target.closest('.changed-file-popover')) return
      const inFile = isFileFindTarget(event.target) || (event.target === document.body && lastRegion === 'file')
      if (!inFile) return
      const controller = controllers.current.get(current.current.activeTabId ?? '')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        controller?.open()
      } else if (controller?.opened && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        event.stopPropagation()
        controller.navigate(event.shiftKey ? -1 : 1)
      } else if (controller?.opened && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        controller.close(true)
      }
    }
    document.addEventListener('pointerdown', track, true)
    document.addEventListener('focusin', track)
    window.addEventListener('keydown', shortcut, true)
    return () => {
      document.removeEventListener('pointerdown', track, true)
      document.removeEventListener('focusin', track)
      window.removeEventListener('keydown', shortcut, true)
    }
  }, [])
  const value = useMemo(() => ({ activeTabId, visible, register, request, controller: controllers.current.get(activeTabId ?? '') ?? null }), [activeTabId, visible, version, register, request])
  return <Registry.Provider value={value}>{children}</Registry.Provider>
}

export function FileFindButton(): React.JSX.Element | null {
  const registry = useOptionalFileFind()
  if (!registry?.visible) return null
  return <button type="button" className="file-preview-find-trigger"
    aria-label="查找文件内容" title="查找文件内容（⌘F / Ctrl+F）"
    aria-controls={registry.activeTabId ? `file-find-${registry.activeTabId}` : undefined}
    aria-expanded={registry.controller?.opened ?? false} disabled={!registry.controller?.supported}
    onClick={() => registry.controller?.open()}>
    <FindIcon kind="search" />
  </button>
}
function FindIcon({ kind }: { kind: 'search' | 'up' | 'down' | 'close' | 'options' }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{kind === 'search'
    ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>
    : <path d={kind === 'up' ? 'm6 15 6-6 6 6' : kind === 'down' ? 'm6 9 6 6 6-6' : kind === 'close' ? 'm6 6 12 12M18 6 6 18' : 'M4 7h16M4 17h16M9 4v6m6 4v6'} />}</svg>
}
const NO_RESULTS: FileFindResult = { matches: [], limited: false }

export function FileFindScope({ id, children }: { id: string; children: ReactNode }): React.JSX.Element {
  const registry = useOptionalFileFind()
  const [adapter, setAdapter] = useState<FileFindAdapter | null>(null)
  const [options, setOptions] = useState<FileFindOptions>(EMPTY_FILE_FIND)
  const [opened, setOpened] = useState(false)
  const [expandedOptions, setExpandedOptions] = useState(false)
  const [result, setResult] = useState<FileFindResult>(NO_RESULTS)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [composing, setComposing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const clearance = useRef(0)
  const scrollNextSearch = useRef(false)
  const active = Boolean(registry?.visible && registry.activeTabId === id)
  const registerAdapter = useCallback((value: FileFindAdapter) => {
    setAdapter(value)
    return () => setAdapter(current => current === value ? null : current)
  }, [])
  const close = useCallback((focus = false) => {
    setOpened(false)
    adapter?.clear()
    if (focus) adapter?.focus()
  }, [adapter])
  const open = useCallback((allChanges?: boolean) => {
    if (!adapter) return
    const selected = adapter.selection?.() ?? ''
    setOptions(current => ({ ...current,
      ...(selected && selected.length <= 512 && !/[\r\n]/u.test(selected) ? { query: selected } : {}),
      ...(allChanges !== undefined ? { allChanges } : {})
    }))
    setOpened(true)
    requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); input.current?.select() })
  }, [adapter])
  const navigate = useCallback((direction: number) => {
    if (busy || !result.matches.length) return
    const next = (index + direction + result.matches.length) % result.matches.length
    setIndex(next)
    adapter?.show(result.matches, next, true, clearance.current)
  }, [adapter, busy, index, result])
  const controller = useMemo(() => ({ supported: Boolean(adapter), opened: active && opened, open, close, navigate }), [adapter, active, opened, open, close, navigate])
  const register = registry?.register
  useEffect(() => register?.(id, controller), [id, controller, register])
  useEffect(() => { if (opened && (!active || !adapter)) close() }, [active, adapter, opened, close])
  useEffect(() => adapter?.subscribe?.(() => setRevision(value => value + 1)), [adapter])

  useEffect(() => {
    if (!active || !opened || !adapter || composing) return undefined
    const abort = new AbortController()
    adapter.clear()
    setResult(NO_RESULTS)
    setBusy(Boolean(options.query))
    if (!options.query) { setIndex(0); return undefined }
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => adapter.documents(options, abort.signal))
        .then(documents => searchFileDocuments(documents, options, abort.signal))
        .then(found => {
          if (abort.signal.aborted) return
          setResult(found)
          setBusy(false)
          setIndex(0)
          adapter.show(found.matches, 0, scrollNextSearch.current, clearance.current)
          scrollNextSearch.current = false
        }).catch(error => {
          if (abort.signal.aborted) return
          setResult({ matches: [], limited: false, error: error instanceof Error ? error.message : '暂时无法查找' })
          setBusy(false)
        })
    }, 160)
    return () => { clearTimeout(timer); abort.abort(); adapter.clear() }
  }, [active, opened, adapter, options, revision, composing])

  useEffect(() => {
    if (!opened) return undefined
    const dismiss = (event: Event): void => {
      if (!(event.target instanceof Element) || surface.current?.contains(event.target) || event.target.closest('.file-preview-find-trigger')) return
      close()
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('focusin', dismiss)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('focusin', dismiss)
    }
  }, [opened, close])
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return undefined
    const measure = (): void => {
      const height = active && opened ? (surface.current?.getBoundingClientRect().height ?? 32) + 20 : 0
      const reader = element.querySelector<HTMLElement>('.file-preview-content,.agent-run-file-review-scroll')
      if (reader) element.style.setProperty('--file-find-top', `${reader.getBoundingClientRect().top - element.getBoundingClientRect().top + 10}px`)
      const previous = clearance.current
      clearance.current = height
      element.style.setProperty('--file-find-clearance', `${height}px`)
      if (reader?.classList.contains('agent-run-file-review-scroll') && reader.scrollTop > 0) reader.scrollTop += height - previous
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (surface.current) observer.observe(surface.current)
    const reader = element.querySelector('.file-preview-content,.agent-run-file-review-scroll')
    if (reader) observer.observe(reader)
    return () => observer.disconnect()
  }, [opened, active])
  const update = (change: Partial<FileFindOptions>): void => {
    scrollNextSearch.current = true
    setOptions(current => ({ ...current, ...change }))
  }
  const count = busy ? '…' : result.matches.length ? `${index + 1} / ${result.matches.length}${result.limited ? '+' : ''}` : '0 / 0'
  return <AdapterContext.Provider value={registerAdapter}>
    <div className={`file-find-scope${active && opened ? ' find-open' : ''}`} ref={root}>
      {children}
      {active && opened && <div className="file-find-surface" id={`file-find-${id}`} ref={surface}>
        <form role="search" aria-label="文件内查找" className="file-find-form" onSubmit={event => { event.preventDefault(); if (!composing) navigate(1) }}>
          <FindIcon kind="search" />
          <input ref={input} type="text" aria-label="查找文件内容" placeholder="在文件中查找" value={options.query} maxLength={512}
            autoComplete="off" spellCheck={false} onChange={event => update({ query: event.target.value })}
            onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!event.nativeEvent.isComposing && !composing) navigate(event.shiftKey ? -1 : 1) } }} />
          <button className="file-find-icon" type="button" aria-label="查找选项" title="查找选项" aria-expanded={expandedOptions} aria-controls={`file-find-options-${id}`} onClick={() => setExpandedOptions(value => !value)}><FindIcon kind="options" /></button>
          <span className="file-find-count" aria-hidden="true">{count}</span>
          <span className="file-find-divider" aria-hidden="true" />
          <button className="file-find-icon" type="button" aria-label="上一个匹配" title="上一个（Shift+Enter）" disabled={busy || !result.matches.length} onClick={() => navigate(-1)}><FindIcon kind="up" /></button>
          <button className="file-find-icon" type="button" aria-label="下一个匹配" title="下一个（Enter）" disabled={busy || !result.matches.length} onClick={() => navigate(1)}><FindIcon kind="down" /></button>
          <button className="file-find-icon" type="button" aria-label="关闭文件查找" title="关闭（Esc）" onClick={() => close(true)}><FindIcon kind="close" /></button>
        </form>
        {expandedOptions && <div className="file-find-options" id={`file-find-options-${id}`}>{([
          ['caseSensitive', 'Aa', '区分大小写'], ['wholeWord', 'ab', '全字匹配'], ['regexp', '.*', '正则']
        ] as const).map(([key, glyph, label]) => <button key={key} type="button" aria-pressed={options[key]} onClick={() => update({ [key]: !options[key] })}><span>{glyph}</span>{label}</button>)}</div>}
        {(adapter?.changes || adapter?.scopeLabel) && <div className="file-find-scope-row">{adapter?.changes ? <>
          <select aria-label="差异查找范围" value={options.allChanges ? 'all' : 'file'} onChange={event => update({ allChanges: event.target.value === 'all' })}><option value="file">当前文件</option><option value="all">本次全部变更</option></select>
          <label><input type="checkbox" checked={options.changesOnly} onChange={event => update({ changesOnly: event.target.checked })} />仅增删行</label>
        </> : <span>{adapter?.scopeLabel}</span>}</div>}
        {result.error && <div className="file-find-error" role="alert">{result.error}</div>}
        <span className="sr-only" role="status" aria-live="polite">{busy ? '正在查找' : result.error ?? (result.limited ? `已显示前 ${result.matches.length} 处匹配，请缩小查找范围` : `当前第 ${result.matches.length ? index + 1 : 0} 处，共 ${result.matches.length} 处匹配`)}</span>
      </div>}
    </div>
  </AdapterContext.Provider>
}
