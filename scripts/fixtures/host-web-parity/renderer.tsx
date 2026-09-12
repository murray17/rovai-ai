import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import * as Dialog from '@radix-ui/react-dialog'
import type { AdapterInstallation, CampCreationPreflight, ExecutionConsolePlacement, WorkspaceSelection } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { CampNavigation } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import { CampWorkspace, type CampInspectorTab } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { CampClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { NewConversationDialog } from '../../../apps/desktop/src/renderer/src/NewConversationDialog'
import { MembersView } from '../../../apps/desktop/src/renderer/src/MemberManagement'
import { AppDialogContent, AppDialogHeader, AppDialogBody, AppDialogFooter } from '../../../apps/desktop/src/renderer/src/AppDialog'
import { createReviewModel, type Scenario, type Surface } from './model'
import { agents, availability, campId, installations, navigation, workspacePath } from './data'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'

const params = new URL(location.href).searchParams
const surface = (document.documentElement.dataset.reviewSurface ?? params.get('surface') ?? 'web') as Surface
const scenario = (document.documentElement.dataset.reviewScenario ?? params.get('scenario') ?? 'camp') as Scenario
const theme = document.documentElement.dataset.reviewTheme ?? params.get('theme') ?? 'day'
document.documentElement.dataset.theme = theme
document.documentElement.dataset.platform = 'darwin'
const model = createReviewModel(surface, scenario)
const selectedWorkspace: WorkspaceSelection = { projectPath: workspacePath, name: 'rovai-workspace' }

function FileScenario() {
  const preview = useFilePreview()
  useEffect(() => {
    if (scenario === 'file') void preview.open({ kind: 'camp_workspace', campId, rawReference: 'docs/interaction-review.md' })
  }, [])
  return null
}

function Review() {
  const state = useSyncExternalStore(model.subscribe, model.get)
  const [view, setView] = useState<'camp' | 'members'>(scenario === 'member' ? 'members' : 'camp')
  const [creating, setCreating] = useState(scenario === 'new')
  const [workspaceResolver, setWorkspaceResolver] = useState<((workspace: WorkspaceSelection | null) => void) | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSelection | null>(null)
  const [inspector, setInspector] = useState<CampInspectorTab | null>(null)
  const [detailHost, setDetailHost] = useState<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>('inspector')
  const [selectedAgent, setSelectedAgent] = useState(agents[0].agentId)
  const [memberTab, setMemberTab] = useState<'identity' | 'runtime'>('runtime')
  const [profile, setProfile] = useState({ displayName: '维护者', avatarDataUrl: null as string | null })
  const preflight: CampCreationPreflight = useMemo(() => ({ admissible: true, initialLeadAgentId: agents[0].agentId, blockers: [],
    presentMembers: state.agents.map((agent, i) => ({ agentId: agent.agentId, displayName: agent.displayName,
      memberOrder: i, runtimeConfigured: true, runtimeReadiness: 'ready' })) }), [state.agents])
  const nav = navigation(state.snapshot)
  const outsideScope = (path: string) => model.note(`${path} 未纳入本次可点击稿，请对照差异表；没有伪造成功。`)

  useEffect(() => {
    parent.postMessage({ type: 'rovai-parity-status', surface, note: state.note, offline: state.offline }, '*')
  }, [state.note, state.offline])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.data?.type !== 'rovai-parity-offline') return
      model.setOffline(event.data.offline === true)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

  return <CampClientProvider client={model.client}>
    <CurrentUserProfileContext.Provider value={{ profile, ready: true, error: null, reload: () => model.note('固定个人资料已载入。'),
      save: async next => { setProfile(next); model.note('模拟：个人资料保存在本页。'); return next } }}>
    <FilePreviewProvider campId={state.snapshot.camp.id} resolvedTheme={theme === 'night' ? 'night' : 'day'} api={model.fileApi}>
    <FileScenario />
    <div className={view === 'camp' ? 'app-shell app-shell-camp' : 'app-shell'} data-parity-surface={surface}>
      <CampNavigation view={view} platform="darwin" state="ready" navigation={nav} activeCampId={state.snapshot.camp.id}
        currentProjectKey="review-project" pendingMemoryCount={0}
        onNewConversation={() => setCreating(true)} onMembers={() => setView('members')}
        onMemory={() => outsideScope('Memory')} onAutomations={() => outsideScope('Automation')}
        onSettings={() => outsideScope('设置')} onOpenProject={() => setCreating(true)} onCreateInProject={() => setCreating(true)}
        onCamp={() => setView('camp')} onRemoveProject={async () => outsideScope('移除项目')}
        onDelete={async () => outsideScope('删除 Camp')} onRename={async (_, title) => model.rename(title)}
        onError={error => model.note(String(error))} />
      {view === 'camp' && <AppHeader campTitle={state.snapshot.camp.title} contextLabel="rovai-workspace"
        camp={state.snapshot} detailEntryHostRef={setDetailHost}
        onFocusApprovals={() => document.querySelector<HTMLElement>('.approval-dock')?.scrollIntoView({ block: 'nearest' })} />}
      <main className={`content ${view === 'camp' ? 'task-content camp-content' : 'members-content'}`}>
        {view === 'camp' ? <CampWorkspace key={state.snapshot.camp.id} snapshot={state.snapshot} projectName="rovai-workspace"
          agents={state.agents} installations={installations as AdapterInstallation[]} initialComposerDraft={state.draft}
          busy={state.busy} onSend={model.send} onChangeLead={async () => outsideScope('更换默认负责人')}
          onTasksChanged={async () => model.note('模拟：任务面板已重读固定快照。')}
          onResolveApproval={(item, option) => void model.resolve(item, option).catch(error => model.note(String(error)))}
          stopping={false} onStop={() => model.stop()} onCancelAgentRun={async () => model.stop()}
          executionPlacement={placement} onExecutionPlacementChange={async next => { setPlacement(next); return next }}
          worldMapEnabled={false} inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'members'}
          detailEntryHost={detailHost} onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)}
          onInspectorTabChange={setInspector} onOpenSingleChat={() => outsideScope('私聊')}
          onConfigureRuntime={id => { setSelectedAgent(id); setMemberTab('runtime'); setView('members') }}
          onNotify={model.note} onNotifyError={model.note} />
          : <div className="members-workspace"><MembersView agents={state.agents} installations={installations as AdapterInstallation[]}
            runtimeAvailability={availability} runtimeDiscoveryPending={false} selectedAgentId={selectedAgent}
            activeTab={memberTab} runtimeFocusRequest={1} onSelectedAgentChange={(id, tab) => { setSelectedAgent(id); setMemberTab(tab) }}
            onTabChange={setMemberTab} onReload={async () => model.note('模拟：重新读取本页队员配置。')}
            onOpenRuntimeSettings={() => outsideScope('Runtime 安装检测')} /></div>}
      </main>
      <NewConversationDialog open={creating} initialWorkspace={workspace} projects={nav.projects}
        preflight={preflight} agents={state.agents} busy={state.busy} projectAccessReady
        onOpenChange={setCreating} onChooseWorkspaceDirectory={() => new Promise(resolve => setWorkspaceResolver(() => resolve))}
        onWorkspaceSelected={async next => setWorkspace(next)}
        onCreate={async draft => { model.create(draft); setCreating(false); setView('camp') }} />
      <Dialog.Root open={workspaceResolver !== null} onOpenChange={open => { if (!open) { workspaceResolver?.(null); setWorkspaceResolver(null) } }}>
        <AppDialogContent className="app-dialog">
          <AppDialogHeader description="固定示例目录，不访问本机文件系统。" title={surface === 'web' ? '选择允许的工作区' : '本机目录选择 · 模拟'} />
          <AppDialogBody><p>{surface === 'web' ? '此处模拟 Host 已授权的目录清单，不接受浏览器提交任意本机路径。' : '本稿用固定选项替代操作系统目录选择窗口。'}</p>
            <button className="quiet-button" onClick={() => { workspaceResolver?.(selectedWorkspace); setWorkspace(selectedWorkspace); setWorkspaceResolver(null) }}>rovai-workspace · {workspacePath}</button>
          </AppDialogBody>
          <AppDialogFooter><button className="quiet-button" onClick={() => { workspaceResolver?.(null); setWorkspaceResolver(null) }}>取消</button></AppDialogFooter>
        </AppDialogContent>
      </Dialog.Root>
    </div>
    </FilePreviewProvider>
    </CurrentUserProfileContext.Provider>
  </CampClientProvider>
}

createRoot(document.getElementById('root')!).render(<Review />)
