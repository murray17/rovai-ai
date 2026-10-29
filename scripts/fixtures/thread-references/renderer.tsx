import { languageTestApi } from '../../../apps/desktop/src/renderer/src/interface-language-test-api'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { createDesktopNavigation } from '../../../apps/desktop/src/renderer/src/desktop-navigation'
import { ThreadNavigation } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { ThreadWorkspace } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { MobileLayoutProvider, useMobileViewport } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { model, profiles, installations } from './model'
import { ThreadReferencePreviewProvider } from '../../../apps/desktop/src/renderer/src/ThreadReferencePreview'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { MarkdownCodeFrame } from '../../../apps/desktop/src/renderer/src/MarkdownCodeFrame'
import { readMessageQuoteText, readMessageQuoteSelection } from '../../../apps/desktop/src/renderer/src/message-quote-selection'
import { createFileFindDomIndex } from '../../../apps/desktop/src/renderer/src/file-find-dom'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/web/src/mobile.css'
import './fixture.css'
import './title-scenes'

document.documentElement.dataset.platform = 'darwin'
document.documentElement.dataset.rovaiPlatform = 'darwin'
const params = new URLSearchParams(location.search)
const surface = params.get('surface') === 'web' ? 'web' : 'desktop'
document.documentElement.dataset.rovaiSurface = surface
Object.assign(window, { __referenceChecks: { readMessageQuoteText, readMessageQuoteSelection } })
function Workbench() {
  const mobile = useMobileViewport(surface === 'web')
  const state = useSyncExternalStore(model.subscribe, model.get)
  const [theme, setTheme] = useState(params.get('theme') === 'night' ? 'night' : 'day')
  const [inspector, setInspector] = useState<any>(null)
  const [detailHost, setDetailHost] = useState<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<any>('inspector')
  const [profile, setProfile] = useState({ displayName: '你', avatarDataUrl: null })
  const navigation = useMemo(() => { const nav = createDesktopNavigation(async () => {}); nav.reset({ kind: 'camp', threadId: state.snapshot.thread.id } as any); return nav }, [])
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme === 'day' ? 'light' : 'dark' }, [theme])
  useEffect(() => { if (!state.note) return; const timer = setTimeout(() => model.note(''), 3000); return () => clearTimeout(timer) }, [state.note])
  const stub = () => model.note('此交互稿演示代码复制；其他页面未连接。')
  const current = { id: state.snapshot.thread.id, title: state.snapshot.thread.title, projectPath: '/prototype/rovai-ai', projectBindingKind: 'directory', activationState: 'active',
    defaultLead: { agentId: profiles[0].agentId, displayName: profiles[0].displayName }, marker: 'none', lastActivityAt: new Date().toISOString(), lastActivityGlobalSequence: 2, latestCompletionGlobalSequence: 0, version: 1 }
  const navSnapshot: any = { schemaVersion: 3, throughGlobalSequence: 2,
    quickChat: { totalCount: 2, recentThreads: ['整理本周的想法', '试试新的交互'].map((title, i) => ({ ...current, id: `quick-${i}`, title, projectBindingKind: 'quick_chat', projectPath: '' })) },
    projects: [{ projectKey: 'copy-project', name: 'rovai-ai', projectPath: '/prototype/rovai-ai', lastActivityAt: current.lastActivityAt, lastActivityGlobalSequence: 2, totalCount: 3,
      recentThreads: [current, ...['会话工作区优化', '发布前检查'].map((title, i) => ({ ...current, id: `other-${i}`, title }))] }] }
  return <MobileLayoutProvider value={mobile}><ThreadClientProvider client={model.client as any}>
    <CurrentUserProfileContext.Provider value={{ profile, ready: true, error: null, reload() {}, save: async next => { setProfile(next as any); return next } }}>
    <FilePreviewProvider threadId={state.snapshot.thread.id} resolvedTheme={theme as any} api={model.fileApi as any}>
      <ThreadReferencePreviewProvider threadId={state.snapshot.thread.id} onOpen={async reference => { model.opened.push(reference) }}>
      <div className="copy-workbench">
        <NavigationShell platform="darwin" browser={surface === 'web'} data-mobile-view={mobile ? 'camp' : undefined} className="app-shell-camp" navigation={navigation}>
          {surface === 'desktop' && <div className="copy-window-lights" aria-hidden="true"><i /><i /><i /></div>}
          <ThreadNavigation view="camp" platform="darwin" state="ready" navigation={navSnapshot} activeThreadId={state.snapshot.thread.id} currentProjectKey="copy-project" pendingMemoryCount={0}
            onNewConversation={stub} onMembers={() => setInspector('members')} onMemory={stub} onAutomations={stub} onMissions={stub} onSettings={stub} onOpenProject={stub} onCreateInProject={stub}
            onThread={thread => thread.id === current.id ? setInspector(null) : stub()} onRemoveProject={async () => stub()} onDelete={async () => stub()}
            onRename={async (_, title) => model.rename(title)} onError={e => model.note(String(e))} />
          <AppHeader threadTitle={state.snapshot.thread.title} contextLabel="rovai-ai" thread={state.snapshot} detailEntryHostRef={setDetailHost} onFocusApprovals={() => {}} />
          <main className="content task-content camp-content"><ThreadWorkspace snapshot={state.snapshot} projectName="rovai-ai" agents={profiles as any} installations={installations as any}
            busy={false} onSend={model.send} onChangeLead={model.changeLead} onAddMembers={async ids => ({ addedAgentIds: ids, failures: [] })} onTasksChanged={async () => {}} onResolveApproval={() => {}}
            stopping={false} onCancelAgentRun={async () => {}} executionPlacement={placement} onExecutionPlacementChange={async next => { setPlacement(next); return next }}
            worldMapEnabled={false} inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'members'} detailEntryHost={detailHost}
            onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)} onInspectorTabChange={setInspector} onOpenSingleChat={stub} onConfigureRuntime={stub}
            suppressExecutionAutoOpen onNotify={model.note} onNotifyError={model.note} /></main>
        </NavigationShell>

      </div>
      {state.note && <div className="copy-review-toast" role="status">{state.note}</div>}
    </ThreadReferencePreviewProvider></FilePreviewProvider></CurrentUserProfileContext.Provider>
  </ThreadClientProvider></MobileLayoutProvider>
}
createRoot(document.getElementById('root')!).render(<Workbench />)
