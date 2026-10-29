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
import { MobileLayoutProvider } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { model, profiles, installations, snippets, documents } from './model'
import { SafeMarkdown } from '../../../apps/desktop/src/renderer/src/SafeMarkdown'
import { MarkdownCodeFrame } from '../../../apps/desktop/src/renderer/src/MarkdownCodeFrame'
import { readMessageQuoteText } from '../../../apps/desktop/src/renderer/src/message-quote-selection'
import { createFileFindDomIndex } from '../../../apps/desktop/src/renderer/src/file-find-dom'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import '../../../apps/desktop/src/renderer/src/styles.css'
import './fixture.css'

document.documentElement.dataset.platform = 'darwin'
document.documentElement.dataset.rovaiPlatform = 'darwin'
document.documentElement.dataset.rovaiSurface = 'desktop'
const params = new URLSearchParams(location.search)
function PreviewControls({ setTheme }: any) {
  const preview = useFilePreview()
  const initialOpen = useRef(false)
  const openDocument = (name = 'normal') => preview.open({ kind: 'message_reference', threadId: model.get().snapshot.thread.id,
    messageId: 'copy-message-2', rawReference: name === 'long' ? 'docs/code-examples.md' : 'docs/quick-start.md' })
  useEffect(() => {
    if (initialOpen.current) return
    initialOpen.current = true
    void openDocument()
  }, [])
  Object.assign(window, { __codeCopy: { setTheme, openDocument, hidePreview: preview.hidePane, showPreview: preview.showPane,
    snippets, documents, getState: model.get,
    quote: () => readMessageQuoteText(document.querySelector('.conversation-bubble.agent .safe-markdown') as HTMLElement),
    find: () => createFileFindDomIndex(document.querySelector('.file-preview-tab-panel:not([hidden]) .file-preview-markdown .safe-markdown') as HTMLElement).text,
    language: (interfaceLanguage: string) => changeInterfaceLanguage(languageTestApi, interfaceLanguage as any)
  } })
  return null
}

function EdgeCases() {
  const [code, setCode] = useState('first\n')
  const [visible, setVisible] = useState(true)
  Object.assign(window, { __edge: { setCode, setVisible } })
  return <main className="edge-cases safe-markdown">
    {visible && <MarkdownCodeFrame code={code}><pre><code>{code}</code></pre></MarkdownCodeFrame>}
    <SafeMarkdown inlineContent={{ TOKEN: <span>@当前用户</span> }}>{'```\nHello TOKEN\n```'}</SafeMarkdown>
    <SafeMarkdown>{'`inline`\n\n    indented\n\n```unknown\n\t中文 & <tag>  \n\nend\n```\n\n```\n```'}</SafeMarkdown>
  </main>
}

function Workbench() {
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
  return <MobileLayoutProvider value={false}><ThreadClientProvider client={model.client as any}>
    <CurrentUserProfileContext.Provider value={{ profile, ready: true, error: null, reload() {}, save: async next => { setProfile(next as any); return next } }}>
    <FilePreviewProvider threadId={state.snapshot.thread.id} resolvedTheme={theme as any} api={model.fileApi as any}>
      <div className="copy-workbench">
        <NavigationShell platform="darwin" className="app-shell-camp" navigation={navigation}>
          <div className="copy-window-lights" aria-hidden="true"><i /><i /><i /></div>
          <ThreadNavigation view="camp" platform="darwin" state="ready" navigation={navSnapshot} activeThreadId={state.snapshot.thread.id} currentProjectKey="copy-project" pendingMemoryCount={0}
            onNewConversation={stub} onMembers={() => setInspector('members')} onMemory={stub} onAutomations={stub} onMissions={stub} onSettings={stub} onOpenProject={stub} onCreateInProject={stub}
            onThread={thread => thread.id === current.id ? setInspector(null) : stub()} onRemoveProject={async () => stub()} onDelete={async () => stub()}
            onRename={async (_, title) => model.rename(title)} onError={e => model.note(String(e))} />
          <AppHeader threadTitle={state.snapshot.thread.title} contextLabel="rovai-ai" thread={state.snapshot} detailEntryHostRef={setDetailHost} onFocusApprovals={() => {}} />
          <main className="content task-content camp-content"><ThreadWorkspace snapshot={state.snapshot} projectName="rovai-ai" agents={profiles as any} installations={installations as any}
            initialComposerDraft={state.draft} busy={false} onSend={model.send} onChangeLead={model.changeLead} onTasksChanged={async () => {}} onResolveApproval={() => {}}
            stopping={false} onCancelAgentRun={async () => {}} executionPlacement={placement} onExecutionPlacementChange={async next => { setPlacement(next); return next }}
            worldMapEnabled={false} inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'members'} detailEntryHost={detailHost}
            onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)} onInspectorTabChange={setInspector} onOpenSingleChat={stub} onConfigureRuntime={stub}
            suppressExecutionAutoOpen onNotify={model.note} onNotifyError={model.note} /></main>
        </NavigationShell>
        <PreviewControls setTheme={setTheme} />
      </div>
      {state.note && <div className="copy-review-toast" role="status">{state.note}</div>}
    </FilePreviewProvider></CurrentUserProfileContext.Provider>
  </ThreadClientProvider></MobileLayoutProvider>
}
createRoot(document.getElementById('root')!).render(params.has('edge') ? <EdgeCases /> : <Workbench />)
