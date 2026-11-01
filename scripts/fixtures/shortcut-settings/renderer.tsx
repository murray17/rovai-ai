import { useEffect, useState } from 'react'
import { TaskDraftFixture } from './task-drafts'
import { createRoot } from 'react-dom/client'
import type { AdapterInstallation, ExecutionConsolePlacement, FilePreviewApi, ShortcutPreferencesApi } from '@contracts'
import { ShortcutProvider, useShortcuts } from '../../../apps/desktop/src/renderer/src/ShortcutProvider'
import { ShortcutSettings } from '../../../apps/desktop/src/renderer/src/ShortcutSettings'
import { NavigationShell } from '../../../apps/desktop/src/renderer/src/NavigationShell'
import { SettingsSidebarNavigation, SETTINGS_SIDEBAR_GROUPS } from '../../../apps/desktop/src/renderer/src/ThreadNavigation'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/AppHeader'
import { ThreadWorkspace, type ThreadInspectorTab } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { StructuredMentionComposer } from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'
import { ComposerPrimaryAction } from '../../../apps/desktop/src/renderer/src/ComposerPrimaryAction'
import { composerDocumentFromText } from '../../../apps/desktop/src/renderer/src/composer-document'
import { initializeInterfaceLanguage, useInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import { createReviewModel } from '../host-web-parity/model'
import { agents, initialDraft, installations } from '../host-web-parity/data'
import '../../../apps/desktop/src/renderer/src/styles.css'

const platform: NodeJS.Platform = new URL(location.href).searchParams.get('platform') === 'win32' ? 'win32' : 'darwin'
const api = (window as unknown as { shortcutsApi: ShortcutPreferencesApi }).shortcutsApi
const fileApi = (window as unknown as { filePreviewApi: FilePreviewApi }).filePreviewApi
const model = createReviewModel('desktop', 'running')
let tasksEnabled = true
let taskSequence = 0
const taskListeners = new Set<(event: import('@contracts').CoreEvent) => void>()
const client = { ...model.client, platform,
  request: (async <T,>(method: import('@contracts').CoreMethod, params?: unknown): Promise<T> => {
    if (method === 'preferences.tasks.get') return { enabled: tasksEnabled, headsUpAfterSequence: 0, observedThroughChangeSequence: taskSequence } as T
    if (method === 'preferences.tasks.set') {
      tasksEnabled = (params as { enabled: boolean }).enabled
      taskSequence++
      taskListeners.forEach(listener => listener({ method: 'preferences.tasks_changed', params: { enabled: tasksEnabled } }))
      return { enabled: tasksEnabled, headsUpAfterSequence: 0, observedThroughChangeSequence: taskSequence } as T
    }
    return model.client.request<T>(method, params)
  }) as typeof model.client.request,
  onEvent: (listener: (event: import('@contracts').CoreEvent) => void) => {
    taskListeners.add(listener); const stop=model.client.onEvent?.(listener)
    return () => { taskListeners.delete(listener); stop?.() }
  }
}
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
let setScreen: (screen: string) => void, setPlacement: (placement: ExecutionConsolePlacement) => void
let commands: ReturnType<typeof useFilePreview> | null = null
let setComposerText: (text: string) => void
let sends = 0
const state = { settings: null as ReturnType<typeof useShortcuts> }
function FileControls() { commands = useFilePreview(); return null }
function Fixture() {
  useInterfaceLanguage()
  const shortcuts = useShortcuts(); state.settings = shortcuts
  const [screen, updateScreen] = useState('settings'); setScreen = updateScreen
  const [placement, updatePlacement] = useState<ExecutionConsolePlacement>('inspector'); setPlacement = updatePlacement
  const [inspector, setInspector] = useState<ThreadInspectorTab | null>(null)
  const [single, setSingle] = useState(false)
  const [entry, setEntry] = useState<HTMLElement | null>(null)
  const [document, setDocument] = useState(composerDocumentFromText('测试消息'))
  const [identity, setIdentity] = useState(0)
  setComposerText = text => { setDocument(composerDocumentFromText(text)); setIdentity(value => value + 1) }
  useEffect(() => { window.document.documentElement.dataset.rovaiPlatform = platform; window.document.documentElement.dataset.theme = 'day' }, [])
  return <>
    <NavigationShell platform={platform} settings={screen === 'settings'}>
      <aside className="unified-sidebar settings-navigation-mode"><div className="unified-sidebar-drag" /><div className="unified-brand"><strong>Rovai AI</strong></div><SettingsSidebarNavigation groups={SETTINGS_SIDEBAR_GROUPS} section="shortcuts" updateBadge={null} onSectionChange={() => setScreen('settings')} onBack={() => setScreen('workspace')} /></aside>
      {screen === 'drafts' ? <main className="content"><TaskDraftFixture client={client} /></main> : screen === 'settings' ? <main className="content settings-content"><div className="settings-workbench"><div className="settings-panel settings-panel-general settings-panel-shortcuts"><ShortcutSettings /></div></div></main> : screen === 'composer' ? <main className="content"><form className="composer" onSubmit={event => event.preventDefault()}>
        <StructuredMentionComposer id="send-composer" draftIdentity={`send:${identity}`} document={document} members={[]} ariaLabel="发送测试" placeholder="消息" disabled={false} persistDocument={async () => {}} onDocumentChange={setDocument} onSubmit={() => { sends++ }} />
        <ComposerPrimaryAction action="send" busy={false} disabled={false} type="button" onClick={() => { sends++ }} />
      </form></main> : <>
        <AppHeader threadTitle={model.get().snapshot.thread.title} contextLabel="Fixture" thread={model.get().snapshot} detailEntryHostRef={setEntry} onFocusApprovals={() => {}} />
        <main className="content task-content camp-content"><FilePreviewProvider threadId={model.get().snapshot.thread.id} resolvedTheme="day" api={fileApi}><FileControls />
          <ThreadWorkspace snapshot={model.get().snapshot} projectName="Fixture" agents={agents} installations={installations as AdapterInstallation[]} initialComposerDraft={initialDraft} busy={false} onSend={model.send}
            onChangeLead={async () => {}} onTasksChanged={async () => {}} onResolveApproval={() => {}} stopping={false} onStop={() => {}} onCancelAgentRun={async () => {}}
            executionPlacement={placement} onExecutionPlacementChange={async next => { setPlacement(next); return next }} worldMapEnabled={false}
            inspectorVisible={inspector !== null} inspectorTab={inspector ?? 'tasks'} detailEntryHost={entry} onOpenInspector={setInspector} onCloseInspector={() => setInspector(null)} onInspectorTabChange={setInspector}
            singleChatVisible={single} onOpenSingleChat={() => setSingle(true)} onCloseSingleChat={() => setSingle(false)} onConfigureRuntime={() => {}} onNotify={() => {}} onNotifyError={message => errors.push(message)} />
        </FilePreviewProvider></main>
      </>}
    </NavigationShell>
  </>
}
Object.assign(window, { shortcutTest: {
  tasks: (enabled: boolean) => client.request('preferences.tasks.set', { enabled }),
  settle: () => new Promise(resolve => setTimeout(resolve, 90)), errors,
  screen: (value: string) => setScreen(value), placement: (value: ExecutionConsolePlacement) => setPlacement(value),
  snapshot: () => state.settings?.snapshot, save: (preferences: Parameters<ShortcutPreferencesApi['save']>[0]['preferences']) => state.settings!.save(preferences),
  probeTarget: (run: (target: EventTarget | null) => void) => state.settings!.register('tasks', { priority: 100, run }),
  composer: (text: string) => setComposerText(text), sends: () => sends,
  language: (interfaceLanguage: 'en' | 'zh-CN') => initializeInterfaceLanguage({ interfaceLanguage, interfaceLanguagePreference: interfaceLanguage, systemLanguage: interfaceLanguage, languageRevision: 1, readError: null }),
  theme: (value: string) => { document.documentElement.dataset.theme = value },
  openFile: (rawReference = 'docs/interaction-review.md') => commands!.open({ kind: 'camp_workspace', rawReference, threadId: model.get().snapshot.thread.id })
} })
createRoot(document.getElementById('root')!).render(<ThreadClientProvider client={client}><ShortcutProvider api={api} platform={platform}><Fixture /></ShortcutProvider></ThreadClientProvider>)
