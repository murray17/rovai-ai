import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, ThreadSnapshot, ThreadComposerDraftView } from '@contracts'
import { ThreadWorkspace, type ThreadLeaveGuard } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import { loadLocalThreadComposerDraft } from '../../../apps/desktop/src/renderer/src/camp-composer-local-store'
import '../../../apps/desktop/src/renderer/src/styles.css'

// Only the real Renderer and local draft store run here. Core transactions have
// their own SQLite regression owner; this closed transport never starts a Runtime.
const now = '2026-10-08T10:00:00Z'
const threadId = 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7g'
const agent: AgentProfile = { agentId: 'lead', displayName: '负责人', avatarRef: null, accent: null,
  teamRole: '架构师', professionalResponsibilities: '', personalityTraits: [], workingPrinciples: '',
  growthTopic: '', defaultCapabilities: [], presence: 'present', runtimeConfiguration: null,
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: 0, version: 1,
  createdAt: now, updatedAt: now, removedAt: null }
const outside: AgentProfile = { ...agent, agentId: 'outside', displayName: '爱丽丝', teamRole: '实现者', memberOrder: 1,
  runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'explicit', modelId: 'configured-test-model', options: {} },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } } }
const member = (profile: AgentProfile) => ({ agentId: profile.agentId, displayName: profile.displayName, avatarRef: null,
  teamRole: profile.teamRole, accent: '', membershipStatus: 'active' as const, leaveRequestedAt: null,
  profilePresence: 'present' as const, memberOrder: profile.memberOrder, isDefaultLead: profile === agent, version: 1 })
const initial: ThreadSnapshot = { schemaVersion: 35, throughGlobalSequence: 1,
  thread: { id: threadId, title: '草稿邀请', activationState: 'pending', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agent.agentId, membershipGeneration: 1,
    version: 1, createdAt: now, updatedAt: now },
  members: [member(agent)], membershipReconciliations: [], tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], agentRunFileChanges: [], agentRunImages: [], contextManifests: [], approvals: [], actions: [], timeline: [] }
const calls: string[] = []
const submissions: ThreadComposerDraftView[] = []
let rejectSend = true
let coreActivated = false
let acceptedSends = 0
let prepareLeave: ThreadLeaveGuard | null = null
let setFixture: React.Dispatch<React.SetStateAction<ThreadSnapshot>>
let setVisible: React.Dispatch<React.SetStateAction<boolean>>
const client = {
  platform: 'darwin', onEvent: () => () => {},
  request: async (method: string) => {
    calls.push(method)
    if (method === 'skills.candidates') return { skills: [], errors: [] }
    if (method === 'threads.pendingDraft.setPresence') {
      if (coreActivated) throw new Error('camp.pending_draft_unavailable')
      return { changed: true }
    }
    throw new Error(`Unexpected invitation fixture request: ${method}`)
  },
  composerAttachments: { discard: async () => {} }
} as unknown as ThreadClient
function Fixture() {
  const [snapshot, setSnapshot] = useState(initial)
  const [visible, show] = useState(true)
  setFixture = setSnapshot; setVisible = show
  return <ThreadClientProvider client={client}><main className="content task-content" style={{ height: '100vh', width: '100vw' }}>
    {visible && <ThreadWorkspace snapshot={snapshot} agents={[agent, outside]} busy={false} stopping={false}
      worldMapEnabled={false} onChangeLead={async () => {}} onTasksChanged={async () => {}} onResolveApproval={() => {}}
      onThreadLeaveGuardChange={(_id, guard) => { prepareLeave = guard }}
      onPendingThreadLeave={async () => { calls.push('discard-pending') }}
      onAddMembers={async ids => {
        calls.push('add:' + ids.join(','))
        setSnapshot(current => ({ ...current, members: [...current.members, member(outside)] }))
        return { addedAgentIds: ids, unchangedAgentIds: [], failures: [] }
      }}
      onSend={async draft => {
        calls.push('send'); submissions.push(structuredClone(draft))
        if (rejectSend) throw new Error('Fixture rejects this send')
        coreActivated = true
        acceptedSends += 1
        return { threadMessageId: 'published-' + acceptedSends, publishedMessageSequence: acceptedSends, deliveryIds: ['delivery'], agentRunIds: [], addressedAgentIds: ['outside'] }
      }} />}
    </main></ThreadClientProvider>
}
const errors: string[] = []
window.addEventListener('error', e => errors.push(String(e.error?.stack ?? e.message)))
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
createRoot(document.getElementById('root')!).render(<Fixture />)
Object.assign(window, { invitationTest: {
  state: () => ({ calls, submissions, errors, text: document.getElementById('camp-message')?.textContent,
    atoms: document.querySelectorAll('[data-composer-atom="member"]').length,
    invite: !!document.querySelector('[aria-label="发送时邀请 爱丽丝"]'),
    continuation: !!document.querySelector('[aria-label="继续发给 爱丽丝"]'),
    draft: loadLocalThreadComposerDraft(threadId),
    button: document.querySelector<HTMLButtonElement>('form.composer:has(#camp-message) button[type="submit"]')?.disabled,
    stored: Object.values(localStorage).join(' ') }),
  accept: () => { rejectSend = false },
  projectActivation: () => setFixture(current => ({ ...current, thread: { ...current.thread, activationState: 'active' }, members: [member(agent), member(outside)] })),
  hide: () => setVisible(false), show: () => setVisible(true),
  leave: async () => { if (!prepareLeave) throw new Error('Leave guard missing'); (await prepareLeave()).complete(true); setVisible(false) },
  active: () => { localStorage.clear(); setFixture({ ...initial, thread: { ...initial.thread, activationState: 'active' } }); rejectSend = false; calls.length = 0 },
  submit: () => document.querySelector<HTMLButtonElement>('form.composer:has(#camp-message) button[type="submit"]')!.click(),
  focus: () => document.querySelector<HTMLElement>('#camp-message[contenteditable="true"]')!.focus(),
  text: () => document.querySelector<HTMLElement>('#camp-message[contenteditable="true"]')!.textContent,
} })
