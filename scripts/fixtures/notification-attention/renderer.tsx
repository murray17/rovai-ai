import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { NotificationEpisodeChange, NotificationEpisodeView, NotificationSemantic, NotificationActionView } from '@contracts'
import { NotificationAttentionController } from '../../../apps/desktop/src/renderer/src/NotificationAttentionController'
import type { VisibleNotificationSources } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

let attentive = true
Object.defineProperty(document, 'hasFocus', { value: () => attentive })
const listeners = new Set<(event: { method: string }) => void>()
const journal: NotificationEpisodeChange[] = []
const acknowledgements: unknown[] = []
const navigations: NotificationActionView[] = []
const preference = { headsUpEnabled: true, approvalHeadsUpEnabled: true, userMentionHeadsUpEnabled: true,
  turnCompletedHeadsUpEnabled: true, turnIncompleteHeadsUpEnabled: true, version: 1, updatedAt: '2026-09-07' }
let setSources: (source: VisibleNotificationSources | null) => void
let sequence = 0
const read = () => ({ campId: 'camp-other', surfaceVisible: true, snapshotSequence: 0, messageIds: [], campTurnIds: [], approvalIds: [] })
Object.assign(window, { rovai: {
  request: async (method: string, request: any) => {
    if (method === 'notifications.preference.get') return preference
    if (method === 'notifications.inbox') return { schemaVersion: 7, throughChangeSequence: sequence, unreadCount: journal.length, items: [], nextCursor: null }
    if (method === 'notifications.changesSince') return { schemaVersion: 7, requestedAfterChangeSequence: request.afterChangeSequence,
      nextChangeSequence: sequence, throughChangeSequence: sequence, retainedFloorChangeSequence: 0,
      hasMore: false, resetRequired: false, changes: journal.filter(change => change.changeSequence > request.afterChangeSequence) }
    if (method === 'notifications.acknowledge' || method === 'notifications.acknowledgeVisibleSources') {
      acknowledgements.push({ method, request }); return { status: 'applied', code: 'ok', payload: {} }
    }
    throw new Error(method)
  },
  onEvent: (callback: (event: { method: string }) => void) => { listeners.add(callback); return () => listeners.delete(callback) }
}})
function admit(semantic: NotificationSemantic, privateId: string | null = null, episodeId = `episode-${sequence + 1}`, agentDisplayName = '洛克') {
  const n = ++sequence
  const action: NotificationActionView = { actionId: `action-${n}`, kind: privateId ? 'open_single_chat' : semantic === 'approval_pending' ? 'open_approval' : 'open_camp_turn',
    available: true, campId: 'camp-target', campTurnId: 'turn-target', messageId: null,
    approvalId: semantic === 'approval_pending' ? `approval-${n}` : null,
    acknowledgementId: `occurrence-${n}`, observedEpisodeVersion: n,
    singleChat: privateId ? { conversationId: privateId, agentId: 'agent-1', agentDisplayName, agentRunId: 'private-run' } : null }
  const episode: NotificationEpisodeView = { id: episodeId, kind: semantic === 'approval_pending' ? 'approval' : 'collaboration',
    episodeVersion: n, attentionRevision: n, changeSequence: n,
    camp: { id: 'camp-target', title: '通知交互与单聊来源定位方案'.repeat(3) }, campTurnId: 'turn-target',
    primarySemantic: semantic, unread: true, resolved: false, satisfied: false, pendingApprovalCount: 0, mentionCount: 0,
    unacknowledgedMentionCount: 0, mention: null, reasons: [], primaryAction: action, secondaryActions: [], createdAt: '2026-09-07', updatedAt: '2026-09-07' }
  journal.push({ changeSequence: n, episodeId, episodeVersion: n, attentionRevision: n, operation: 'upsert',
    changeCause: 'occurrence_admitted', headsUpSignal: { semantic, admittedAttentionRevision: n, action, mention: null },
    headsUpInvalidation: null, changedAt: '2026-09-07', episode })
  listeners.forEach(callback => callback({ method: 'notification_episode.changed' }))
}
function Fixture() {
  const [sources, updateSources] = useState<VisibleNotificationSources | null>(read())
  setSources = updateSources
  return <main style={{ padding: 40 }}><h1>通知交互验证</h1><input id="draft" aria-label="消息草稿" defaultValue="继续阅读" />
    <NotificationAttentionController enabled activeCampId={sources?.campId ?? 'camp-other'} activeCampVisible navigationActive={false}
      visibleSources={sources?.conversationId ? null : sources} singleChatSources={sources?.conversationId ? sources : null}
      onNavigate={async (_episode, action) => { navigations.push(action); return { status: 'navigated' } }}
      onPresentNavigation={async () => true} onCancelNavigation={() => undefined}
      onRefreshVisibleCamp={async () => false} onError={message => { throw new Error(message) }} />
  </main>
}
Object.assign(window, { notificationTest: {
  admit,
  source: (conversationId: string | null, visible = true, turnVisible = false) => setSources({ ...read(), campId: 'camp-target',
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
    acknowledgements, navigations, focused: (document.activeElement as HTMLElement)?.id, overflow: document.documentElement.scrollWidth > innerWidth })
}})
createRoot(document.getElementById('root')!).render(<Fixture />)
