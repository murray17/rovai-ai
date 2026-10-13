import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import * as Dialog from '@radix-ui/react-dialog'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { createDesktopNavigation } from '../../../apps/desktop/src/renderer/src/desktop-navigation'
import { ThreadNavigation } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { AppearanceSettings } from '../../../apps/desktop/src/renderer/src/AppearanceSettings'
import { DEFAULT_APPEARANCE } from '../../../apps/desktop/src/shared/appearance'
import type { AppearancePreferences, AppearanceSnapshot } from '@contracts'
import { ThreadWorkspace, campConversationTimeline } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { FilePreviewProvider } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { CurrentUserProfileContext } from '../../../apps/desktop/src/renderer/src/CurrentUserProfile'
import { MobileLayoutProvider } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from '../../../apps/desktop/src/renderer/src/AppDialog'
import { model, profiles, scenarios, installations } from './model'
import { conversationRunPresenceTimeline } from '../../../apps/desktop/src/renderer/src/conversation-run-presence'
import { liveRuntimeEventFromExecutionEvidence } from '../../../apps/desktop/src/renderer/src/ui-model'
const projectedTimeline = (snapshot: any) => conversationRunPresenceTimeline(campConversationTimeline(snapshot.messages,
  snapshot.turns, snapshot.agentRuns, snapshot.tasks, snapshot.agentRunFileChanges, snapshot.agentRunImages, snapshot.memberCreations), snapshot.agentRuns)
const projectedPresence = (snapshot: any) => projectedTimeline(snapshot).flatMap(item => item.kind === 'run_presence' ? [{ ...item.slot, status: item.slot.run.status }] : [])
import '../../../apps/desktop/src/renderer/src/styles.css'
import './fixture.css'

declare const __SOURCE_COMMIT__: string
document.documentElement.dataset.platform = 'darwin'
document.documentElement.dataset.rovaiPlatform = 'darwin'
document.documentElement.dataset.rovaiSurface = 'desktop'
const params = new URLSearchParams(location.search)
const completeCoverage = { loadedCount: 0, totalCount: 0, omittedCount: 0, complete: true }
const openCoverage = { tasks: completeCoverage, messageDeliveries: completeCoverage, turns: completeCoverage,
  agentRuns: completeCoverage, executionEvidence: completeCoverage, approvals: completeCoverage,
  messages: { ...completeCoverage, hasEarlier: false, oldestLoadedSequence: null, newestLoadedSequence: null } }
const unsupported = (label: string) => model.note(`${label}沿用现有入口；这份交互稿只演示会话中的队员占位。`)

function Glyph({ kind }: { kind: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{
    kind === 'play' ? <path d="m9 5 11 7-11 7Z" /> : kind === 'pause' ? <><path d="M8 5v14M16 5v14" /></> :
    kind === 'reset' ? <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></> :
    kind === 'moon' ? <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" /> :
    kind === 'sun' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1" /></> :
    kind === 'info' ? <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></> :
    kind === 'close' ? <path d="m6 6 12 12M18 6 6 18" /> :
    <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16" /></>
  }</svg>
}

function Workbench() {
  const state = useSyncExternalStore(model.subscribe, model.get)
  const [theme, setTheme] = useState(params.get('theme') === 'night' ? 'night' : 'day')
  const [proposal, setProposal] = useState(params.get('baseline') !== '1')
  const [controls, setControls] = useState(params.get('pure') !== '1')
  const [info, setInfo] = useState(false)
  const [settings, setSettings] = useState(false)
  const [appearance, setAppearance] = useState<AppearanceSnapshot>({ ...DEFAULT_APPEARANCE, resolvedTheme: theme as 'day' | 'night' })
  const [inspector, setInspector] = useState<any>(null)
  const [detailHost, setDetailHost] = useState<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<any>('inspector')
  const [profile, setProfile] = useState({ displayName: '你', avatarDataUrl: null })
  const [otherThread, setOtherThread] = useState<{ id: string; title: string } | null>(null)
  const visibleSnapshot = otherThread ? { ...state.snapshot, thread: { ...state.snapshot.thread, ...otherThread },
    messages: [], agentRuns: [], messageDeliveries: [], executionEvidence: [] } : model.controls.holdEntrySnapshot
      ? { ...state.snapshot, agentRuns: state.snapshot.agentRuns.map((r: any) => ({ ...r, hasAcceptedContinuation: false })) }
      : state.snapshot
  const sequence = scenarios[state.scenario]
  const navigation = useMemo(() => {
    const nav = createDesktopNavigation(async (target, transaction) => {
      if (transaction.commit()) setSettings(target.kind === 'settings')
    })
    nav.reset({ kind: 'camp', threadId: state.snapshot.thread.id } as any)
    return nav
  }, [])
  const openMotionSettings = async () => {
    await navigation.push({ kind: 'settings', section: 'appearance' })
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const control = document.querySelector<HTMLSelectElement>('#appearance-motion')
      control?.scrollIntoView({ block: 'center', behavior: 'instant' })
      control?.focus({ preventScroll: true })
    }))
  }
  const changeAppearance = async (preferences: AppearancePreferences): Promise<AppearanceSnapshot> => {
    const next = { ...preferences, resolvedTheme: theme as 'day' | 'night' }
    setAppearance(next)
    return next
  }
  useEffect(() => { document.documentElement.dataset.motionPreference = appearance.motionPreference }, [appearance.motionPreference])
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { document.documentElement.dataset.presence = proposal ? 'proposal' : 'baseline' }, [proposal])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setControls(x => !x) } }
    addEventListener('keydown', key); return () => removeEventListener('keydown', key)
  }, [])
  useEffect(() => { if (!state.note) return; const id = setTimeout(() => model.note(''), 3500); return () => clearTimeout(id) }, [state.note])
  const current = { id: state.snapshot.thread.id, title: state.snapshot.thread.title, projectPath: '/prototype/rovai-ai',
    projectBindingKind: 'directory', activationState: 'active', defaultLead: { agentId: profiles[0].agentId, displayName: profiles[0].displayName },
    marker: state.snapshot.agentRuns.some((r: any) => r.status === 'running') ? 'loading' : 'none', lastActivityAt: new Date().toISOString(),
    lastActivityGlobalSequence: 10, latestCompletionGlobalSequence: 0, version: 1 }
  const navSnapshot: any = { schemaVersion: 3, throughGlobalSequence: 10,
    quickChat: { totalCount: 2, recentThreads: [
      { ...current, id: 'demo-quick-1', title: '整理本周的想法', marker: 'none', projectBindingKind: 'quick_chat', projectPath: '' },
      { ...current, id: 'demo-quick-2', title: '试试新的交互', marker: 'none', projectBindingKind: 'quick_chat', projectPath: '' }] },
    projects: [{ projectKey: 'presence-project', name: 'rovai-ai', projectPath: '/prototype/rovai-ai', lastActivityAt: current.lastActivityAt,
      lastActivityGlobalSequence: 10, totalCount: 4, recentThreads: [current,
        ...['消息投递与恢复', '会话工作区优化', '发布前检查'].map((title, i) => ({ ...current, id: `demo-thread-${i}`, title, marker: 'none' }))] }] }
  useEffect(() => {
    Object.assign(window, { __presence: { setScenario: model.setScenario, setStage: model.setStage, setTheme, setProposal,
      getState: model.get, showNarration: model.showNarration, showStartupStatus: model.showStartupStatus, controls: model.controls, resync: model.resync, stop: model.stop, retry: model.retry, failRun: model.failRun, verify: () => {
        const s = model.get().snapshot
        const ids = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].map(e => e.dataset.messageId)
        const positions = ids.map(id => s.messages.findIndex((m: any) => m.id === id)).filter(i => i >= 0)
        const slots = projectedPresence(s), rows = [...document.querySelectorAll<HTMLElement>('[data-presence-run]')]
        const messages = [...document.querySelectorAll<HTMLElement>('[data-message-id]')]
        const actualOrder = [...document.querySelectorAll<HTMLElement>('[data-message-id],[data-presence-run]')].map(e => e.dataset.messageId ?? 'run-presence:' + e.dataset.presenceRun)
        const expectedOrder = projectedTimeline(s).filter(item => item.kind === 'camp_message' || item.kind === 'run_presence').map(item => item.id)
        return { allMessagesPresent: s.messages.every((m: any) => ids.includes(m.id)),
          messagesInOrder: positions.every((n, i) => !i || n > positions[i - 1]), uniqueMessages: ids.length === new Set(ids).size,
          slotsAreNotMessages: !document.querySelector('.conversation-run-presence[data-message-id]'),
          noQueuedPlaceholders: slots.every((x: any) => x.status !== 'queued'),
          noCompletedRows: slots.every((x: any) => !['succeeded','cancelled'].includes(x.status)),
          uniqueRuns: rows.length === new Set(rows.map(e => e.dataset.presenceRun)).size,
          anchoredOrder: JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
          independentActivityRows: rows.every(e => !e.closest('.message-actions')),
          compactRows: rows.every((e, i) => e.querySelectorAll('button').length === (slots[i].run.status === 'failed' && slots[i].run.failure?.retryable === false ? 1 : 2) && !e.querySelector('.presence-elapsed')),
          commandIconsMatchContent: rows.every(e => Boolean(e.querySelector('.tool-call-icon')) === (e.querySelector('.run-presence-open')?.getAttribute('data-preview-kind') === 'command')),
          retryOnlyOnFailure: rows.every(e => !e.querySelector('.run-presence-retry') || e.dataset.presenceState === 'failed'),
          identityMatchesRun: rows.every((e, i) => Boolean(e.querySelector('.member-avatar')) === !slots[i].continuation),
          slots: slots.length, messages: s.messages.length, viewport: [innerWidth, innerHeight],
          overflow: document.documentElement.scrollWidth > innerWidth,
          sourceCommit: __SOURCE_COMMIT__, nativeBridge: typeof (window as any).rovai }
      } } })
  }, [])
  return <MobileLayoutProvider value={false}><ThreadClientProvider client={model.client as any}>
    <CurrentUserProfileContext.Provider value={{ profile, ready: true, error: null, reload: () => {}, save: async next => { setProfile(next as any); return next } }}>
    <FilePreviewProvider threadId={state.snapshot.thread.id} resolvedTheme={theme as any} api={model.fileApi}>
    <div className="prototype-workbench">
      <NavigationShell platform="darwin" settings={settings} className={settings ? '' : 'app-shell-camp'} navigation={navigation}>
        <div className="prototype-window-lights" aria-hidden="true"><i /><i /><i /></div>
        <ThreadNavigation view={settings ? 'settings' : 'camp'} settingsSection="appearance" onSettingsBack={() => { void navigation.back() }}
          onSettingsSectionChange={() => {}} platform="darwin" state="ready" navigation={navSnapshot} activeThreadId={visibleSnapshot.thread.id}
          currentProjectKey="presence-project" pendingMemoryCount={0}
          onNewConversation={() => unsupported('新对话')} onMembers={() => setInspector('members')}
          onMemory={() => unsupported('记忆')} onAutomations={() => unsupported('定时任务')} onMissions={() => unsupported('使命板')}
          onSettings={() => { void navigation.push({ kind: 'settings', section: 'appearance' }) }} onOpenProject={() => unsupported('项目')} onCreateInProject={() => unsupported('新对话')}
          onThread={thread => { setInspector(null); setOtherThread(thread.id === current.id ? null : { id: thread.id, title: thread.title }) }}
          onRemoveProject={async () => unsupported('移除项目')} onDelete={async () => unsupported('删除对话')}
          onRename={async (_, title) => model.rename(title)} onError={error => model.note(String(error))} />
        {!settings && <AppHeader threadTitle={visibleSnapshot.thread.title} contextLabel="rovai-ai" thread={visibleSnapshot} detailEntryHostRef={setDetailHost} onFocusApprovals={() => {}} />}
        {settings && <div className="window-drag-strip window-drag-strip-settings" aria-hidden="true" />}
        <main className="content task-content camp-content" style={settings ? { display: 'none' } : undefined} aria-hidden={settings || undefined}>
          <ThreadWorkspace key={`${state.generation}:${visibleSnapshot.thread.id}`} snapshot={params.has('windowed') ? { ...visibleSnapshot, executionEvidence: [] } : visibleSnapshot}
            liveRuntimeEvents={model.controls.liveEvidence ? visibleSnapshot.executionEvidence.map(liveRuntimeEventFromExecutionEvidence) : undefined}
            workspaceEntrySnapshotReady={!model.controls.holdEntrySnapshot}
            openCoverage={params.has('windowed') ? openCoverage : null} projectName="rovai-ai" agents={profiles as any}
            installations={installations as any} initialComposerDraft={state.draft} busy={state.busy}
            onSend={model.send} onChangeLead={model.changeLead} onTasksChanged={async () => {}}
            onResolveApproval={() => {}} stopping={false} onCancelAgentRun={model.cancel}
            executionPlacement={placement} onExecutionPlacementChange={async next => { setPlacement(next); return next }}
            worldMapEnabled={false} inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'members'}
            detailEntryHost={detailHost} onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)} onInspectorTabChange={setInspector}
            onOpenSingleChat={() => unsupported('单聊')} onConfigureRuntime={() => unsupported('运行配置')}
            onOpenMotionSettings={() => { void openMotionSettings() }}
            suppressExecutionAutoOpen onNotify={model.note} onNotifyError={model.note} />
        </main>
        {settings && <main className="content settings-content"><div className="settings-workbench"><div className="settings-panel settings-panel-appearance">
          <AppearanceSettings appearance={appearance} disabled={false} onChange={changeAppearance} />
        </div></div></main>}
      </NavigationShell>
      {controls && <section className="prototype-control-bar" aria-label="交互稿演示控制">
        <div className="prototype-label"><strong>队员占位</strong><span>停止区分隔 · 模拟数据</span></div>
        <label className="sr-only" htmlFor="prototype-scenario">演示场景</label>
        <select id="prototype-scenario" value={state.scenario} onChange={e => { setInspector(null); model.setScenario(e.target.value) }}>
          {Object.entries(scenarios).map(([id, scenario]) => <option key={id} value={id}>{scenario.name}</option>)}
        </select>
        <div className="prototype-steps" aria-label="演示阶段">{sequence.steps.map((step, i) => <button type="button" key={i}
          aria-current={state.stage === i ? 'step' : undefined} data-demo-step={i} title={sequence.descriptions[i]}
          onClick={() => model.setStage(i)}>{step}</button>)}</div>
        <div className="prototype-bar-actions">
          <button className="prototype-icon" aria-label={state.playing ? '暂停演示' : '自动演示'} title={state.playing ? '暂停演示' : '自动演示'} onClick={() => model.play()}><Glyph kind={state.playing ? 'pause' : 'play'} /></button>
          <button className="prototype-icon" aria-label="重置演示" title="重置演示" onClick={() => { setInspector(null); model.reset() }}><Glyph kind="reset" /></button>
          <span className="prototype-divider" />
          <button className="prototype-compare" aria-pressed={!proposal} onClick={() => setProposal(!proposal)} title="相同数据，对照生产界面与占位提案"><Glyph kind="compare" />{proposal ? '对照现有界面' : '返回占位方案'}</button>
          <button className="prototype-icon" aria-label={theme === 'day' ? '切换夜间主题' : '切换日间主题'} title="切换主题" onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}><Glyph kind={theme === 'day' ? 'moon' : 'sun'} /></button>
          <button className="prototype-icon" aria-label="设计说明与源码依据" title="设计说明" onClick={() => setInfo(true)}><Glyph kind="info" /></button>
          <button className="prototype-icon" aria-label="隐藏演示控制" title="隐藏控制 · Alt+D" onClick={() => setControls(false)}><Glyph kind="close" /></button>
        </div>
      </section>}
      {!controls && <button className="prototype-restore" onClick={() => setControls(true)}>演示控制</button>}
      {!proposal && <div className="prototype-baseline-label">现有界面</div>}
    </div>
    <Dialog.Root open={info} onOpenChange={setInfo}><AppDialogContent className="app-dialog prototype-info-dialog">
      <AppDialogHeader title="跟着消息向下，继续处理" description="群聊中的队员占位 · 停止区分隔" />
      <AppDialogBody>
        <p>发送前固定在本次输入锚点；自己的公开消息发送成功后，才接到这条消息下面。其他人的消息和追加输入不移动这个位置。紧接同一 Run 的消息或产物时沿用身份。</p>
        <div className="prototype-info-rule"><strong>RunCard 高亮、单行正文、停止</strong><p>正文按原文已有换行在同一行内逐行推进，未换行的长内容静态省略。运行中复用 RunCard 文字高亮，命令保留原工具图标。右侧短竖线分隔停止区，按钮默认中性色、悬浮变红，点击后确认。点击内容打开现有执行台，查看全文与耗时。</p></div>
        <div className="prototype-info-rule"><strong>中断可重试，结束就收起</strong><p>中断行保留原因入口和重试按钮。重试受理后收起旧提示，切群和刷新也保持收起；新执行开始后恢复占位，再失败时重试新执行。原失败记录与继续执行按钮保留在执行台。排队不占位，结束不保留完成行。复制／回复继续使用现有规则。</p></div>
        <div className="prototype-info-rule"><strong>直接复用当前前端</strong><p>侧栏、顶栏、消息气泡、头像、Composer、队员列表与执行台均由当前仓库的生产 React 组件渲染。日夜主题使用原有 token。</p>
          <code>ThreadWorkspace · ThreadNavigation · NavigationShell<br />AppHeader · MemberAvatar · styles.css · theme.css</code>
          <p className="prototype-source">源码基线：{__SOURCE_COMMIT__.slice(0, 12)}</p></div>
        <p>底部切换场景和阶段，自动演示每 6.5 秒前进一步；重置可重播流式正文。也可以在输入框发送消息。所有内容均为本地模拟，未连接真实队员；头像使用现有组件的首字回退。</p>
      </AppDialogBody>
      <AppDialogFooter><button className="quiet-button" onClick={() => setInfo(false)}>继续体验</button></AppDialogFooter>
    </AppDialogContent></Dialog.Root>
    {state.note && <div className="prototype-toast" role="status">{state.note}</div>}
    <span className="sr-only" role="status" aria-live="polite">{sequence.descriptions[state.stage]}</span>
    </FilePreviewProvider></CurrentUserProfileContext.Provider>
  </ThreadClientProvider></MobileLayoutProvider>
}
createRoot(document.getElementById('root')!).render(<Workbench />)
