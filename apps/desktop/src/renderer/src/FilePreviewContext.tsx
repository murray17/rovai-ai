import { FileEditContext, FileEditDialogs } from './FileEditContext'
import { uiAttribute } from './interface-language'
import { memo, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { FilePreviewApi, ResolvedTheme } from '@contracts'
import { desktopFilePreviewApi } from './desktop-file-preview-api'
import { FilePreviewLayoutProvider, useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { FileFindProvider } from './FilePreviewFind'
import { FilePreviewResources } from './file-preview-resources'
import { FilePreviewPaneContent } from './FilePreviewPane'
import type { FilePreviewContextValue, FilePreviewSession } from './file-preview-controller'
export * from './file-preview-controller'

const FilePreviewApiContext = createContext<FilePreviewApi | null>(null)
const FilePreviewContext = createContext<FilePreviewContextValue | null>(null)
const PreviewHostContext = createContext<((element: HTMLDivElement | null) => void) | null>(null)
const ExecutionPreviewHostContext = createContext<ReadonlyMap<string, HTMLDivElement>>(new Map())

function sessionValue(session: FilePreviewSession, resolvedTheme: ResolvedTheme): FilePreviewContextValue {
  const state = session.getSnapshot()
  return { ...state, ...session.actions, resolvedTheme, activeTab: state.tabs.find(tab => tab.id === state.activeTabId) ?? null }
}

const RetainedPane = memo(FilePreviewPaneContent)
function RetainedPreview({ session, resolvedTheme, current, bounds, resizing, missionActivity, registerExecutionHost }: {
  session: FilePreviewSession; resolvedTheme: ResolvedTheme; current: boolean; bounds: CSSProperties | null; resizing: boolean; missionActivity?: ReactNode
  registerExecutionHost(threadId: string, element: HTMLDivElement | null): void
}): React.JSX.Element {
  const state = session.getSnapshot()
  const value = useMemo(() => ({ ...sessionValue(session, resolvedTheme), isCurrentThread: current }), [session, state, resolvedTheme, current])
  const visible = current && value.paneVisible && !!bounds
  const executionHostRef = useCallback(
    (element: HTMLDivElement | null) => registerExecutionHost(session.threadId, element),
    [registerExecutionHost, session.threadId]
  )
  return <FilePreviewContext.Provider value={value}>
    <div className={`file-preview-retained-host${resizing ? ' is-resizing' : ''}`} hidden={!visible} inert={!visible}
      style={bounds ?? undefined} data-preview-camp={session.threadId}>
      <RetainedPane
        visible={visible}
        missionActivity={missionActivity}
        executionHostRef={executionHostRef}
      />
    </div>
  </FilePreviewContext.Provider>
}

function PreviewDeck({ resources, anchor, resolvedTheme, missionActivity, registerExecutionHost }: {
  resources: FilePreviewResources; anchor: HTMLDivElement | null; resolvedTheme: ResolvedTheme; missionActivity?: ReactNode
  registerExecutionHost(threadId: string, element: HTMLDivElement | null): void
}): React.JSX.Element {
  const layout = useOptionalFilePreviewLayout()
  const workspace = layout?.workspace
  const [bounds, setBounds] = useState<{ right: number; top: number; height: number; fallbackWidth: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor) return
    const measure = (): void => {
      const bounds = anchor.getBoundingClientRect()
      if (!bounds.width || !bounds.height || !anchor.clientWidth) return
      const scale = bounds.width / anchor.clientWidth
      // The right edge stays fixed while the split moves. Width already belongs
      // to the layout context; measuring it into state would add a second commit
      // and forced layout to every drag frame.
      const rect = { right: bounds.right / scale, top: bounds.top / scale, height: bounds.height / scale,
        fallbackWidth: workspace ? 0 : bounds.width / scale }
      setBounds(previous => previous?.right === rect.right && previous.top === rect.top
        && previous.height === rect.height && previous.fallbackWidth === rect.fallbackWidth ? previous : rect)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(anchor)
    if (workspace) observer.observe(workspace)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [anchor, workspace])
  // The split context updates before a ResizeObserver delivery on a window resize.
  const width = workspace && layout ? ((layout.compact || layout.expanded) ? layout.availableWidth : Math.round(layout.width)) : bounds?.fallbackWidth ?? 0
  const positioned = bounds && {
    top: bounds.top, height: bounds.height, width, left: bounds.right - width
  }
  return <>{[...resources.sessions.values()].map(session => <RetainedPreview key={session.id} session={session}
    resolvedTheme={resolvedTheme} current={resources.isCurrent(session.threadId)} bounds={positioned} resizing={!!layout?.resizing}
    missionActivity={resources.isCurrent(session.threadId) ? missionActivity : null}
    registerExecutionHost={registerExecutionHost} />)}</>

}

export function FilePreviewProvider({ threadId, resolvedTheme, api: providedApi, children, missionActivity }: {
  threadId: string | null; resolvedTheme: ResolvedTheme; api?: FilePreviewApi; children: ReactNode; missionActivity?: ReactNode
}): React.JSX.Element {
  const api = providedApi ?? (typeof window === 'undefined' || window.rovai ? desktopFilePreviewApi : null)
  if (!api) throw new Error(uiAttribute('共享文件页面缺少显式资源适配。'))
  const resources = useMemo(() => new FilePreviewResources(api), [api])
  useSyncExternalStore(resources.subscribe, resources.getSnapshot, resources.getSnapshot)
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const [deckHost, setDeckHost] = useState<HTMLElement>(document.body)
  const [executionHosts, setExecutionHosts] = useState<ReadonlyMap<string, HTMLDivElement>>(new Map())
  const registerAnchor = useCallback((element: HTMLDivElement | null): void => {
    setAnchor(element)
    if (element) setDeckHost(element.closest<HTMLElement>('.app-shell') ?? document.body)
  }, [])
  const registerExecutionHost = useCallback((targetThreadId: string, element: HTMLDivElement | null): void => {
    setExecutionHosts((current) => {
      if (current.get(targetThreadId) === element || (!element && !current.has(targetThreadId))) return current
      const next = new Map(current)
      if (element) next.set(targetThreadId, element)
      else next.delete(targetThreadId)
      return next
    })
  }, [])
  const session = resources.session(threadId ?? '')
  const state = session.getSnapshot()
  const value = useMemo(() => sessionValue(session, resolvedTheme), [session, state, resolvedTheme])
  useLayoutEffect(() => { resources.activate(threadId) }, [resources, threadId])
  useEffect(() => {
    const release = resources.retainOwner()
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (resources.edits.shouldWarnOnUnload()) { event.preventDefault(); event.returnValue = '' }
    }
    const online = (): void => { for (const doc of resources.edits.documents.values()) if (doc.unknown) void resources.edits.reconcile(doc) }
    const unsubscribeConnection = api.onConnectionRestored?.(online)
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('online', online); unsubscribeConnection?.(); release() }
  }, [resources])
  return <FileEditContext.Provider value={resources.edits}><FilePreviewApiContext.Provider value={api}><FilePreviewContext.Provider value={value}>
    <FilePreviewLayoutProvider threadId={threadId} visible={!!threadId && value.paneVisible} activityMode={value.activeTab?.kind === 'mission_activity'}>
      <FileFindProvider activeTabId={value.activeTabId} visible={!!threadId && value.paneVisible}>
        <ExecutionPreviewHostContext.Provider value={executionHosts}>
          <PreviewHostContext.Provider value={registerAnchor}>{children}</PreviewHostContext.Provider>
          {createPortal(<PreviewDeck resources={resources} anchor={anchor} resolvedTheme={resolvedTheme} missionActivity={missionActivity}
            registerExecutionHost={registerExecutionHost} />, deckHost)}
        </ExecutionPreviewHostContext.Provider>
      </FileFindProvider>
    </FilePreviewLayoutProvider>
    <FileEditDialogs />
  </FilePreviewContext.Provider></FilePreviewApiContext.Provider></FileEditContext.Provider>
}

export function useFilePreview(): FilePreviewContextValue {
  const value = useContext(FilePreviewContext)
  if (!value) throw new Error('FilePreviewProvider is unavailable')
  return value
}
export function useOptionalFilePreview(): FilePreviewContextValue | null { return useContext(FilePreviewContext) }
export function useFilePreviewApi(): FilePreviewApi {
  const api = useContext(FilePreviewApiContext)
  if (!api) throw new Error('FilePreviewApi is unavailable')
  return api
}
export function usePreviewHost(): (element: HTMLDivElement | null) => void {
  const value = useContext(PreviewHostContext)
  if (!value) throw new Error('FilePreviewProvider is unavailable')
  return value
}
export function useExecutionPreviewHost(threadId: string): HTMLDivElement | null {
  return useContext(ExecutionPreviewHostContext).get(threadId) ?? null
}
