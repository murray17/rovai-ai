import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FilePreviewApi, ProjectFilesApi } from '@contracts'
import { ProjectFilesStore } from './project-files-store'
import { DEFAULT_DIRECTORY_WIDTH, MIN_DIRECTORY_WIDTH, MAX_DIRECTORY_WIDTH } from './file-preview-layout'
import { useShortcutAction } from './ShortcutProvider'
import { isDirectoryPreviewTab, type FilePreviewContextValue } from './file-preview-controller'

const visibleKey = 'rovai.project-files.visible'
const widthKey = 'rovai.project-files.width'
function stored(key: string): string | null { try { return localStorage.getItem(key) } catch { return null } }
function remember(key: string, value: string): void { try { localStorage.setItem(key, value) } catch { /* Window-local choice remains usable. */ } }
interface ProjectFilesContextValue {
  store: ProjectFilesStore | null
  visible: boolean
  active: boolean
  width: number
  setWidth(width: number, commit?: boolean): void
  toggle(trigger?: HTMLElement): void
  hide(restoreFocus?: boolean): void
  revealReference(threadId: string, rawReference: string, expectedPathAtSend?: string): Promise<boolean | null>
}
const Context = createContext<ProjectFilesContextValue | null>(null)
export function ProjectFilesProvider({ api, threadId, preview, onConnectionRestored, children }: { api?: ProjectFilesApi; threadId: string | null; preview: FilePreviewContextValue; onConnectionRestored?: FilePreviewApi['onConnectionRestored']; children: ReactNode }): React.JSX.Element {
  const stores = useMemo(() => new Map<string, ProjectFilesStore>(), [api])
  const store = useMemo(() => {
    if (!api || !threadId) return null
    let value = stores.get(threadId)
    if (!value) { value = new ProjectFilesStore(threadId, api); stores.set(threadId, value) }
    // Navigation caches contain no editor buffers; evict only inactive Threads.
    if (stores.size > 24) for (const [id, stale] of stores) if (id !== threadId) { stale.deactivate(); stores.delete(id); break }
    return value
  }, [api, stores, threadId])
  const revealSequence = useRef(0)
  const currentStore = useRef(store); currentStore.current = store
  const [expanded, setVisible] = useState(() => stored(visibleKey) === 'true')
  const active = preview.tabs.some(isDirectoryPreviewTab)
  const visible = !!store && expanded && preview.paneVisible && active
  const [width, updateWidth] = useState(() => Math.max(MIN_DIRECTORY_WIDTH, Math.min(MAX_DIRECTORY_WIDTH, Number(stored(widthKey)) || DEFAULT_DIRECTORY_WIDTH)))
  const trigger = useRef<HTMLElement | null>(null)
  const restoreFocus = useCallback(() => { requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }) }) }, [])
  const hide = useCallback((restore = false) => { setVisible(false); remember(visibleKey, 'false'); if (restore) restoreFocus() }, [restoreFocus])
  const toggle = useCallback((element?: HTMLElement) => {
    if (element) trigger.current = element
    if (visible) { hide(true); return }
    preview.openProjectFiles()
    setVisible(true)
    remember(visibleKey, 'true')
  }, [visible, hide, preview.openProjectFiles])
  const previous = useRef({ threadId, active })
  useEffect(() => {
    if (previous.current.threadId === threadId && previous.current.active && !active) hide()
    previous.current = { threadId, active }
  }, [threadId, active, hide])
  const setWidth = useCallback((next: number, commit = false) => {
    updateWidth(Math.max(0, Math.min(MAX_DIRECTORY_WIDTH, next)))
    if (commit) remember(widthKey, String(Math.max(MIN_DIRECTORY_WIDTH, Math.min(MAX_DIRECTORY_WIDTH, next))))
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
  const revealReference = useCallback(async (thread: string, raw: string, expected?: string) => {
    const ticket = ++revealSequence.current
    const captured = currentStore.current
    if (!captured || captured.threadId !== thread) return false
    let found: boolean | null
    try { found = await captured.revealReference(raw, expected) } catch (error) { if (!visible && currentStore.current === captured && ticket === revealSequence.current) captured.deactivate(); throw error }
    if (currentStore.current !== captured || ticket !== revealSequence.current || found === null) return null
    if (!found) { if (!visible) captured.deactivate(); return false }
    preview.openProjectFiles(); setVisible(true); remember(visibleKey, 'true')
    return true
  }, [preview.openProjectFiles, visible])
  const value = useMemo(() => ({ store, visible, active, width, setWidth, toggle, hide, revealReference }), [store, visible, active, width, setWidth, toggle, hide, revealReference])
  return <Context.Provider value={value}>{children}</Context.Provider>
}
export function useProjectFiles(): ProjectFilesContextValue | null { return useContext(Context) }
