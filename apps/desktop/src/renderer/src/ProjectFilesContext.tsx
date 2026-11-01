import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FilePreviewApi, ProjectFilesApi } from '@contracts'
import { ProjectFilesStore } from './project-files-store'
import { useShortcutAction } from './ShortcutProvider'

const visibleKey = 'rovai.project-files.visible'
const widthKey = 'rovai.project-files.width'
function stored(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function remember(key: string, value: string): void { try { localStorage.setItem(key, value) } catch { /* Window-local choice remains usable. */ } }
interface ProjectFilesContextValue {
  store: ProjectFilesStore | null
  visible: boolean
  width: number
  setWidth(width: number, commit?: boolean): void
  toggle(trigger?: HTMLElement): void
  hide(restoreFocus?: boolean): void
}
const Context = createContext<ProjectFilesContextValue | null>(null)
export function ProjectFilesProvider({ api, threadId, onConnectionRestored, children }: { api?: ProjectFilesApi; threadId: string | null; onConnectionRestored?: FilePreviewApi['onConnectionRestored']; children: ReactNode }): React.JSX.Element {
  const stores = useMemo(() => new Map<string, ProjectFilesStore>(), [api])
  const store = useMemo(() => {
    if (!api || !threadId) return null
    let value = stores.get(threadId)
    if (!value) { value = new ProjectFilesStore(threadId, api); stores.set(threadId, value) }
    // Navigation caches contain no editor buffers; evict only inactive Threads.
    if (stores.size > 24) for (const [id, stale] of stores) if (id !== threadId) { stale.deactivate(); stores.delete(id); break }
    return value
  }, [api, stores, threadId])
  const [visible, setVisible] = useState(() => stored(visibleKey) === 'true')
  const [width, updateWidth] = useState(() => Math.max(180, Math.min(520, Number(stored(widthKey)) || 228)))
  const trigger = useRef<HTMLElement | null>(null)
  const restoreFocus = useCallback(() => { requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) }) }, [])
  const hide = useCallback((restore = false) => { setVisible(false); remember(visibleKey, 'false'); if (restore) restoreFocus() }, [restoreFocus])
  const toggle = useCallback((element?: HTMLElement) => {
    if (element) trigger.current = element
    setVisible(current => { remember(visibleKey, String(!current)); if (current) restoreFocus(); return !current })
  }, [restoreFocus])
  const setWidth = useCallback((next: number, commit = false) => {
    updateWidth(Math.max(0, Math.min(520, next)))
    if (commit) remember(widthKey, String(Math.max(180, Math.min(520, next))))
  }, [])
  useEffect(() => {
    if (visible) void store?.activate()
    return () => store?.deactivate()
  }, [store, visible])
  useEffect(() => () => { stores.forEach(value => value.deactivate()) }, [stores])
  useEffect(() => onConnectionRestored?.(() => { if (visible) store?.retry() }), [onConnectionRestored, store, visible])
  useEffect(() => {
    const close = (): void => store?.deactivate()
    const resume = (): void => { if (visible) store?.retry() }
    window.addEventListener('pagehide', close); window.addEventListener('pageshow', resume); window.addEventListener('online', resume)
    return () => { window.removeEventListener('pagehide', close); window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume) }
  }, [store, visible])
  useShortcutAction('project-files', target => { toggle(target instanceof HTMLElement ? target : undefined) }, !!store)
  const value = useMemo(() => ({ store, visible: !!store && visible, width, setWidth, toggle, hide }), [store, visible, width, setWidth, toggle, hide])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useProjectFiles(): ProjectFilesContextValue | null { return useContext(Context) }
