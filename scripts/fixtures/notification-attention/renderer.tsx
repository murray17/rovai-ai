import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { NotificationEpisodeChange, NotificationEpisodeView, NotificationSemantic, NotificationActionView } from '@contracts'
import { NotificationSettings } from '../../../apps/desktop/src/renderer/src/NotificationSettings'
import { NotificationAttentionController } from '../../../apps/desktop/src/renderer/src/NotificationAttentionController'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { desktopThreadClient } from '../../../apps/desktop/src/renderer/src/desktop-camp-client'
import { TaskCapabilityProvider, useTaskCapability } from '../../../apps/desktop/src/renderer/src/TaskCapabilityProvider'
import type { VisibleNotificationSources } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

let attentive = true
let tasksEnabled = true
let headsUpAfterSequence = 0
Object.defineProperty(document, 'hasFocus', { value: () => attentive })
const listeners = new Set<(event: { method: string }) => void>()
const journal: NotificationEpisodeChange[] = []
const acknowledgements: unknown[] = []
const navigations: NotificationActionView[] = []
let preference = { headsUpEnabled: true, approvalHeadsUpEnabled: true, userMentionHeadsUpEnabled: true,
  turnCompletedHeadsUpEnabled: true, turnIncompleteHeadsUpEnabled: true, singleChatHeadsUpEnabled: true, missionNeedsYouHeadsUpEnabled: true, missionStatusHeadsUpEnabled: true, taskStatusHeadsUpEnabled: false, missionStatuses: ['completed'], taskStatuses: ['completed','blocked','cancelled'], version: 1, updatedAt: '2026-09-07' }
let refreshNotifications: () => void
let showSettings: (visible: boolean) => void
let failPreferenceSave = false
let failedInboxReads = 0
let holdInbox = false
const pendingInbox: Array<() => void> = []
let holdTaskReads = false
let failedTaskReads = 0
const pendingTaskReads: Array<(fail: boolean) => void> = []
let holdChanges = false
const pendingChanges: Array<() => void> = []
let changeReads = 0
let setSources: (source: VisibleNotificationSources | null) => void
let native: import('@contracts').NativeInteractionNotification[] = []
let sequence = 0
const taskSnapshot = () => ({ enabled: tasksEnabled, headsUpAfterSequence, observedThroughChangeSequence: sequence })
const read = () => ({ threadId: 'camp-other', surfaceVisible: true, snapshotSequence: 0,
  messageIds: [], campTurnIds: [], agentRunIds: [], approvalIds: [] })
Object.assign(window, { rovai: {
  request: async (method: string, request: any) => {
    if (method === 'preferences.tasks.get') {
      const snapshot = taskSnapshot()
      if (holdTaskReads) await new Promise<void>((resolve, reject) => pendingTaskReads.push(fail => fail ? reject(new Error('Temporary capability failure')) : resolve()))
      if (failedTaskReads > 0) { failedTaskReads--; throw new Error('Temporary capability failure') }
      return snapshot
    }
    if (method === 'nativeInteractions.notifications') return [...native]
    if (method === 'notifications.preference.get') return preference
    if (method === 'notifications.preference.update') {
      if (failPreferenceSave) { failPreferenceSave = false; throw new Error('测试保存失败') }
      if (request.command.expectedVersion !== preference.version) return { status: 'rejected', code: 'conflict', payload: preference }
      const { expectedVersion, ...next } = request.command
      preference = { ...next, version: expectedVersion + 1, updatedAt: new Date().toISOString() }
      return { status: 'applied', code: 'saved', payload: preference }
    }
    if (method === 'notifications.inbox') {
      if (holdInbox) await new Promise<void>(resolve => pendingInbox.push(resolve))
      if (failedInboxReads > 0) { failedInboxReads--; throw new Error('Temporary inbox failure') }
      return { schemaVersion: 11, throughChangeSequence: sequence, unreadCount: journal.length, items: [], nextCursor: null }
    }
    if (method === 'notifications.changesSince') {
      changeReads++
      const batch = { schemaVersion: 11, requestedAfterChangeSequence: request.afterChangeSequence,
      nextChangeSequence: sequence, throughChangeSequence: sequence, retainedFloorChangeSequence: 0,
      taskCapability: taskSnapshot(), hasMore: false, resetRequired: false,
      changes: journal.filter(change => change.changeSequence > request.afterChangeSequence && (tasksEnabled || change.episode?.kind !== 'task')) }
      if (holdChanges) await new Promise<void>(resolve => pendingChanges.push(resolve))
      return batch
    }
    if (method === 'notifications.acknowledge' || method === 'notifications.acknowledgeVisibleSources') {
      acknowledgements.push({ method, request }); return { status: 'applied', code: 'ok', payload: {} }
    }
    throw new Error(method)
  },
  onEvent: (callback: (event: { method: string }) => void) => { listeners.add(callback); return () => listeners.delete(callback) }
}})
function admit(semantic: NotificationSemantic, privateId: string | null = null, episodeId = `episode-${sequence + 1}`, agentDisplayName = '洛克', notify = true) {
  const n = ++sequence
  const action: NotificationActionView = { actionId: `action-${n}`, kind: privateId ? 'open_single_chat' : semantic === 'task_status_changed' ? 'open_task' : semantic === 'approval_pending' ? 'open_approval' : 'open_camp_turn',
    available: true, threadId: 'camp-target', threadTurnId: 'turn-target', agentRunId: null, messageId: null,
    approvalId: semantic === 'approval_pending' ? `approval-${n}` : null,
    acknowledgementId: `occurrence-${n}`, observedEpisodeVersion: n,
    ...(semantic === 'task_status_changed' ? { subject: { kind: 'task' as const, id: 'retained-task', title: '验收任务', status: 'blocked', sourceMessageId: null } } : {}),
    singleChat: privateId ? { conversationId: privateId, agentId: 'agent-1', agentDisplayName, agentRunId: 'private-run' } : null }
  const episode: NotificationEpisodeView = { id: episodeId, kind: semantic === 'task_status_changed' ? 'task' : semantic === 'approval_pending' ? 'approval' : 'collaboration',
    episodeVersion: n, attentionRevision: n, changeSequence: n,
    thread: { id: 'camp-target', title: '通知交互与单聊来源定位方案'.repeat(3) }, threadTurnId: 'turn-target', agentRunId: null,
    primarySemantic: semantic, unread: true, resolved: false, satisfied: false, pendingApprovalCount: 0, mentionCount: 0,
    unacknowledgedMentionCount: 0, mention: null, reasons: [], primaryAction: action, secondaryActions: [], createdAt: '2026-09-07', updatedAt: '2026-09-07' }
  journal.push({ changeSequence: n, episodeId, episodeVersion: n, attentionRevision: n, operation: 'upsert',
    changeCause: 'occurrence_admitted', headsUpSignal: { semantic, admittedAttentionRevision: n, action, mention: null },
    headsUpInvalidation: null, changedAt: '2026-09-07', episode })
  if (notify) listeners.forEach(callback => callback({ method: 'notification_episode.changed' }))
  return `occurrence-${n}`
}
function Fixture() {
  const [generation, setGeneration] = useState(0)
  refreshNotifications = () => setGeneration(value => value + 1)
  notificationCapability = useTaskCapability()
  const [sources, updateSources] = useState<VisibleNotificationSources | null>(read())
  setSources = updateSources
  const [settings, setSettings] = useState(false)
  showSettings = setSettings
  if (settings) return <main className="settings-panel settings-panel-notifications" style={{ padding: 28, height: '100vh', overflow: 'auto' }}><NotificationSettings /></main>
  return <main style={{ padding: 40 }}><h1>通知交互验证</h1><input id="draft" aria-label="消息草稿" defaultValue="继续阅读" />
    <NotificationAttentionController key={generation} enabled activeThreadId={sources?.threadId ?? 'camp-other'} activeThreadVisible navigationActive={false}
      visibleSources={sources?.conversationId ? null : sources} singleChatSources={sources?.conversationId ? sources : null}
      onNavigate={async (_episode, action) => { navigations.push(action); return { status: 'navigated' } }}
      onPresentNavigation={async () => true} onCancelNavigation={() => undefined}
      onRefreshVisibleThread={async () => false} onError={message => { throw new Error(message) }} />
  </main>
}
let notificationCapability: ReturnType<typeof useTaskCapability>
Object.assign(window, { notificationTest: {
  admit,
  refresh: () => refreshNotifications(),
  native: (id: string, privateId: string | null = null, expiresAt: number | null = null) => {
    native.push({ id, thread: { id: 'camp-target', title: '原生问答会话' }, agentRunId: `run-${id}`,
      executionEpoch: 1, agentDisplayName: '爱丽丝', singleChat: privateId ? { conversationId: privateId,
        agentId: 'agent-native', agentDisplayName: '爱丽丝', agentRunId: `run-${id}` } : null,
      createdAt: Date.now(), expiresAt })
    listeners.forEach(callback => callback({ method: 'agent_run.interaction_changed' }))
  },
  resolveNative: (id: string) => { native = native.filter(source => source.id !== id)
    listeners.forEach(callback => callback({ method: 'agent_run.interaction_changed' })) },
  tasks: (enabled: boolean) => {
    if (!tasksEnabled && enabled) headsUpAfterSequence = sequence
    if (tasksEnabled !== enabled) sequence++
    tasksEnabled = enabled
    listeners.forEach(callback => callback({ method: 'preferences.tasks_changed' }))
  },
  settings: (visible: boolean) => showSettings(visible),
  preference: () => preference,
  failPreferenceSave: () => { failPreferenceSave = true },
  failInboxReads: (count: number) => { failedInboxReads = count },
  holdInbox: () => { holdInbox = true },
  releaseInbox: () => { holdInbox = false; pendingInbox.splice(0).forEach(resolve => resolve()) },
  holdTaskReads: () => { holdTaskReads = true },
  releaseTaskRead: () => pendingTaskReads.shift()?.(false),
  releaseTaskReads: (fail = false) => { holdTaskReads = false; pendingTaskReads.splice(0).forEach(resolve => resolve(fail)) },
  failTaskReads: (count: number) => { failedTaskReads = count },
  holdChanges: () => { holdChanges = true },
  releaseChanges: () => { holdChanges = false; pendingChanges.splice(0).forEach(resolve => resolve()) },
  poll: () => listeners.forEach(callback => callback({ method: 'notification_episode.changed' })),
  source: (conversationId: string | null, visible = true, turnVisible = false) => setSources({ ...read(), threadId: 'camp-target',
    conversationId, surfaceVisible: visible, campTurnIds: turnVisible ? ['turn-target'] : [] }),
  away: () => setSources(read()),
  attentive: (value: boolean) => { attentive = value; window.dispatchEvent(new Event(value ? 'focus' : 'blur')) },
  invalidate: (id: string) => { const n = ++sequence; const old = journal.find(change => change.headsUpSignal?.action.acknowledgementId === id)!
    journal.push({ ...old, changeSequence: n, headsUpSignal: null, changeCause: 'resolved',
      headsUpInvalidation: { kind: 'source_state_changed', acknowledgementId: id, throughAttentionRevision: null } })
    listeners.forEach(callback => callback({ method: 'notification_episode.changed' })) },
  state: () => ({ cards: [...document.querySelectorAll<HTMLElement>('.notification-heads-up:not([hidden])')].map(node => ({
    text: node.textContent, source: node.querySelector('strong')?.textContent, message: node.querySelector('.notification-heads-up-message')?.textContent,
    width: node.getBoundingClientRect().width, summary: node.classList.contains('notification-heads-up-summary') })),
    acknowledgements, navigations, pendingInbox: pendingInbox.length, failedInboxReads,
    pendingTaskReads: pendingTaskReads.length, failedTaskReads, pendingChanges: pendingChanges.length, changeReads,
    taskCapability: { enabled: notificationCapability.enabled, ready: notificationCapability.ready, error: notificationCapability.error },
    focused: (document.activeElement as HTMLElement)?.id, overflow: document.documentElement.scrollWidth > innerWidth })
}})
createRoot(document.getElementById('root')!).render(<ThreadClientProvider client={desktopThreadClient}><Fixture /></ThreadClientProvider>)

// Exercise the actual Provider across Host changes without remounting its children.
let capability: ReturnType<typeof useTaskCapability>
let settleSave: (fail: boolean) => void
const host = (enabled: boolean) => ({ ...desktopThreadClient, onEvent: undefined,
  request: (async (method: string) => {
    if (method === 'preferences.tasks.get') return { enabled, headsUpAfterSequence: 0, observedThroughChangeSequence: 0 }
    return new Promise((resolve, reject) => { settleSave = fail => fail ? reject(new Error('old Host failure')) : resolve({ enabled: true, headsUpAfterSequence: 0, observedThroughChangeSequence: 1 }) })
  }) as typeof desktopThreadClient.request })
let switchHost: (client: typeof desktopThreadClient) => void
let hostA = host(true)
let hostB = host(false)
let retainedDraft: HTMLInputElement | null = null
function CapabilityProbe() {
  capability = useTaskCapability()
  return <input id="host-draft" defaultValue="Host 草稿" />
}
function CapabilityFixture() {
  const [client, setClient] = useState(() => host(false))
  switchHost = setClient
  return <TaskCapabilityProvider client={client}><CapabilityProbe /></TaskCapabilityProvider>
}
const probeRoot = document.createElement('div')
probeRoot.hidden = true
document.body.append(probeRoot)
createRoot(probeRoot).render(<CapabilityFixture />)
Object.assign(window, { taskCapabilityTest: {
  start: () => { hostA = host(true); hostB = host(false); switchHost(hostA); retainedDraft = document.querySelector('#host-draft') },
  save: () => { void capability.setEnabled(false) },
  switchHost: () => switchHost(hostB),
  returnToHost: () => switchHost(hostA),
  settle: (fail: boolean) => settleSave(fail),
  state: () => ({ enabled: capability.enabled, ready: capability.ready, saving: capability.saving, error: capability.error,
    draftRetained: document.querySelector('#host-draft') === retainedDraft && retainedDraft?.value === 'Host 草稿' })
} })
