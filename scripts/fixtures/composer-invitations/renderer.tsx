import { pastedTextPreview } from '../../../apps/desktop/src/shared/pasted-text-preview'
import { languageTestApi } from '../../../apps/desktop/src/renderer/src/interface-language-test-api'
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, ThreadSnapshot, ThreadComposerDraftView, ThreadMessageView, LocalAttachmentSourceView, MissionDescriptionContent } from '@contracts'
import { MissionDescriptionComposer, type MissionDescriptionComposerHandle } from '../../../apps/desktop/src/renderer/src/MissionDescriptionComposer'
import { fuzzyContains } from '../../../apps/desktop/src/renderer/src/thread-reference'
import { optimisticThreadMessage } from '../../../apps/desktop/src/renderer/src/BusinessApp'
import { ThreadWorkspace, type ThreadLeaveGuard } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { ThreadClientProvider, type ThreadClient } from '../../../apps/desktop/src/renderer/src/camp-client'
import { loadLocalThreadComposerDraft } from '../../../apps/desktop/src/renderer/src/camp-composer-local-store'
import { MobileLayoutProvider } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { changeInterfaceLanguage } from '../../../apps/desktop/src/renderer/src/interface-language'
import '../../../apps/desktop/src/renderer/src/styles.css'
import '../../../apps/desktop/src/renderer/src/member-editor.css'
import '../../../apps/web/src/mobile.css'

// Only the real Renderer and local draft store run here. Core transactions have
// their own SQLite regression owner; this closed transport never starts a Runtime.
const now = '2026-10-08T10:00:00Z'
let threadId = 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7g'
let pasteResetCounter = 0
const agent: AgentProfile = { agentId: 'lead', displayName: '负责人', avatarRef: null, accent: null,
  teamRole: '架构师', professionalResponsibilities: '', personalityTraits: [], workingPrinciples: '',
  growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'explicit', modelId: 'configured-test-model', options: {} },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: 0, version: 1,
  createdAt: now, updatedAt: now, removedAt: null }
const outside: AgentProfile = { ...agent, agentId: 'outside', displayName: '爱丽丝', teamRole: '实现者', memberOrder: 1,
  runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'explicit', modelId: 'configured-test-model', options: {} },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } } }
const profiles: AgentProfile[] = [agent, outside,
  { ...agent, agentId: 'unconfigured', displayName: '未配置队员', memberOrder: 2, runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [] } },
  { ...agent, agentId: 'unavailable', displayName: '不可用队员', memberOrder: 3,
    runtimeReadiness: { status: 'needs_attention', blockers: [] } }]
const member = (profile: AgentProfile) => ({ agentId: profile.agentId, displayName: profile.displayName, avatarRef: null,
  teamRole: profile.teamRole, accent: '', membershipStatus: 'active' as const, leaveRequestedAt: null,
  profilePresence: 'present' as const, memberOrder: profile.memberOrder, isDefaultLead: profile === agent, version: 1 })
const initial: ThreadSnapshot = { schemaVersion: 36, throughGlobalSequence: 1, tasksEnabled: true,
  thread: { id: threadId, title: '草稿邀请', activationState: 'pending', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agent.agentId, membershipGeneration: 1,
    version: 1, createdAt: now, updatedAt: now },
  members: [member(agent)], membershipReconciliations: [], tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], agentRunFileChanges: [], agentRunImages: [], contextManifests: [], approvals: [], actions: [], timeline: [] }
const calls: string[] = []
const submissions: ThreadComposerDraftView[] = []
const clipboardWrites: Array<{ text: string; html: string | null }> = []
const preparedFiles: Array<{ name: string; text: string; type: string; size: number }> = []
let attachmentMode: 'ready' | 'fail' | 'deferred' = 'ready'
let releaseAttachment: ((fail: boolean) => void) | null = null
let failPresence = false
let failStorage = false
let failCleanup = false
let failAfterSend = false
let draftWrites = 0
const storageSetItem = Storage.prototype.setItem
const storageRemoveItem = Storage.prototype.removeItem
Storage.prototype.setItem = function (key, value) {
  if (failStorage && key.startsWith('rovai.camp-composer-draft.v1:')) throw new Error('Fixture storage full')
  storageSetItem.call(this, key, value)
  if (key.startsWith('rovai.camp-composer-draft.v1:')) draftWrites++
}
Storage.prototype.removeItem = function (key) {
  if (failStorage && key.startsWith('rovai.camp-composer-draft.v1:')) throw new Error('Fixture storage full')
  storageRemoveItem.call(this, key)
  if (key.startsWith('rovai.camp-composer-draft.v1:')) draftWrites++
}
Object.assign(window, { rovai: { clipboard: { write: async (data: { text: string; html: string | null }) => { clipboardWrites.push(data) } } } })
let rejectSend = true
let coreActivated = false
let acceptedSends = 0
let publishedUserMessages: ThreadMessageView[] = []
let clearAcceptedMessages: () => void
let failNextInvite = false
let conflictNextRemoval = false
let removalPreviewMode: 'ready' | 'unavailable' | 'missing' = 'ready'
let prepareLeave: ThreadLeaveGuard | null = null
let visibleSnapshot = initial
let visibleProfiles = profiles
let setProfiles: React.Dispatch<React.SetStateAction<AgentProfile[]>>
let setFixture: React.Dispatch<React.SetStateAction<ThreadSnapshot>>
let setMobile: React.Dispatch<React.SetStateAction<boolean>>
let setVisible: React.Dispatch<React.SetStateAction<boolean>>
let showMission: (visible: boolean) => void
let flushMission: () => Promise<MissionDescriptionContent>
const referenceCatalog = [
  { kind: 'thread', id: 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7j', title: '爱丽丝的会话', projectBindingKind: 'directory', projectPath: '/fixture/workspace' },
  { kind: 'mission', id: 'rvm_019abcde123470008000000000000001', title: '爱丽丝的使命', projectBindingKind: 'directory', projectPath: '/fixture/workspace' }
]
const client = {
  platform: 'darwin', onEvent: () => () => {},
  request: async (method: string, input: { kind?: string; query?: string } = {}) => {
    calls.push(method)
    if (method === 'threadReferences.list') return {
      items: referenceCatalog.filter(item => item.kind === input.kind && fuzzyContains(item.title, input.query ?? '')), nextCursor: null
    }
    if (method === 'skills.candidates') return { skills: [{
      id: 'paste-review', name: 'review-code', description: '设计审查 Clipboard regression fixture',
      source: 'native', entryPath: '/fixture/review-code/SKILL.md', memberIds: ['lead']
    }], errors: [] }
    if (method === 'thread.messages.anchors') {
      const items = publishedUserMessages.map(message => ({
        messageId: message.id, sequence: message.sequence, title: message.body, messageVersion: message.version
      }))
      return { schemaVersion: 1, threadId, throughGlobalSequence: acceptedSends, totalCount: items.length, items }
    }
    if (method === 'threads.pendingDraft.setPresence') {
      if (failPresence) throw new Error('Fixture presence offline')
      if (coreActivated) throw new Error('camp.pending_draft_unavailable')
      return { changed: true }
    }
    throw new Error(`Unexpected invitation fixture request: ${method}`)
  },
  attachments: { kind: 'local' },
  composerAttachments: {
    discard: async (id: string, ids?: string[]) => {
      calls.push('discard:' + (ids ?? []).join(','))
      if (loadLocalThreadComposerDraft(id)?.attachments.some(attachment => ids?.includes(attachment.id))) {
        calls.push('discard-before-save')
      }
    },
    preparePastedText: async (id: string, file: File): Promise<LocalAttachmentSourceView> => ({
      ...await client.composerAttachments.prepare(id, 0, file), generatedBy: 'long_text_paste',
      pastedTextPreview: pastedTextPreview(new Uint8Array(await file.arrayBuffer()))
    }),
    removePastedText: async (owner: string, id: string) => {
      calls.push('cleanup:' + id)
      if (loadLocalThreadComposerDraft(owner)?.attachments.some(attachment => attachment.id === id)) {
        calls.push('cleanup-before-save')
      }
      if (failCleanup) throw new Error('Fixture cleanup failed')
      return 'deleted'
    },
    preview: async () => ({ preview: null, availability: 'available' }),
    restore: async (_id: string, attachments: LocalAttachmentSourceView[]) => attachments,
    prepare: async (_id: string, _revision: number, file: File): Promise<LocalAttachmentSourceView> => {
      preparedFiles.push({ name: file.name, text: await file.text(), type: file.type, size: file.size })
      if (attachmentMode === 'deferred') await new Promise<void>((resolve, reject) => {
        releaseAttachment = fail => { releaseAttachment = null; fail ? reject(new Error('Fixture prepare failed')) : resolve() }
      })
      if (attachmentMode === 'fail') throw new Error('Fixture prepare failed')
      return { id: crypto.randomUUID(), displayName: file.name, kind: 'file', fileCount: 1,
        mediaType: file.type, byteSize: file.size, previewKind: file.type.startsWith('image/') ? 'image' : 'none',
        availability: 'available', sourcePath: '/fixture/' + file.name }
    }
  }
} as unknown as ThreadClient
let showAgentFiles = () => {}
function Fixture() {
  const [missionVisible, setMissionVisible] = useState(false)
  const [missionContent, setMissionContent] = useState<MissionDescriptionContent>([])
  const mission = useRef<MissionDescriptionComposerHandle>(null)
  showMission = visible => { setMissionContent([]); setMissionVisible(visible) }
  flushMission = async () => mission.current?.flush() ?? []
  const [mobile, updateMobile] = useState(false)
  setMobile = updateMobile
  const [snapshot, setSnapshot] = useState(initial)
  const [currentProfiles, updateProfiles] = useState(profiles)
  const [acceptedMessages, setAcceptedMessages] = useState<ThreadMessageView[]>([])
  publishedUserMessages = acceptedMessages
  clearAcceptedMessages = () => { setAcceptedMessages([]) }
  showAgentFiles = () => setSnapshot(current => ({
    ...current,
    messages: acceptedMessages.map(message => ({
      ...message, id: 'agent-' + message.id, sequence: message.sequence + acceptedSends,
      authorType: 'agent', authorId: 'lead', body: '交付文件'
    }))
  }))
  const [visible, show] = useState(true)
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  const [inspectorVisible, setInspectorVisible] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'members' | 'tasks'>('members')
  visibleSnapshot = snapshot; visibleProfiles = currentProfiles; setProfiles = updateProfiles; setFixture = setSnapshot; setVisible = show
  return <MobileLayoutProvider value={mobile}><ThreadClientProvider client={client}><div>
    <header ref={setEntryHost} style={{ height: 40, display: 'flex', justifyContent: 'flex-end' }} />
    <main className="content task-content" style={{ height: 'calc(100vh - 40px)', width: '100vw' }}>
    {missionVisible ? <div style={{ margin: 32 }}><MissionDescriptionComposer ref={mission} identity="member-search-mission"
      content={missionContent} agents={currentProfiles} memberAgentIds={['lead']} disabled={false}
      onChange={setMissionContent} onPasteFiles={() => {}} /></div>
      : visible && <ThreadWorkspace snapshot={snapshot} projectName={null} optimisticMessages={acceptedMessages} agents={currentProfiles} busy={false} stopping={false}
      detailEntryHost={entryHost}
      inspectorVisible={inspectorVisible} inspectorTab={inspectorTab}
      onOpenInspector={tab => { setInspectorTab(tab); setInspectorVisible(true) }}
      onCloseInspector={() => setInspectorVisible(false)} onInspectorTabChange={setInspectorTab}
      onOpenMembers={() => { calls.push('manage-members') }}
      worldMapEnabled={false} onChangeLead={async () => {}} onTasksChanged={async () => {}} onResolveApproval={() => {}}
      onThreadLeaveGuardChange={(_id, guard) => { prepareLeave = guard }}
      onPendingThreadLeave={async () => { calls.push('discard-pending') }}
      onAddMembers={async ids => {
        calls.push('add:' + ids.join(','))
        if (failNextInvite) { failNextInvite = false; return { addedAgentIds: [], unchangedAgentIds: [], failures: ids.map(agentId => ({ agentId, message: '邀请暂时失败' })) } }
        setSnapshot(current => {
          const additions = ids.map(id => ({ ...member(currentProfiles.find(profile => profile.agentId === id)!), isDefaultLead: false }))
          const members = [...current.members, ...additions]
          if (!members.some(item => item.isDefaultLead)) additions[0].isDefaultLead = true
          return { ...current, members, thread: { ...current.thread,
            defaultLeadAgentId: members.find(item => item.isDefaultLead)?.agentId ?? null,
            membershipGeneration: current.thread.membershipGeneration + ids.length } }
        })
        return { addedAgentIds: ids, unchangedAgentIds: [], failures: [] }
      }}
      onPreviewMemberRemoval={async agentId => {
        calls.push('preview:' + agentId)
        if (removalPreviewMode === 'unavailable') throw new Error('Preview unavailable')
        if (removalPreviewMode === 'missing') return null
        const target = snapshot.members.find(item => item.agentId === agentId)!
        return { threadId, agentId, displayName: target.displayName,
          membershipGeneration: snapshot.thread.membershipGeneration, membershipVersion: target.version,
          isDefaultLead: target.isDefaultLead, remainingMemberCount: snapshot.members.length - 1,
          nextDefaultLeadAgentId: snapshot.members.find(item => item.agentId !== agentId)?.agentId ?? null,
          nonTerminalAgentRunCount: 0, openAssignedTaskCount: 0, pendingDeliveryCount: 0,
          runningDeliveryCount: 0, removable: true, blockerCode: null }
      }}
      onRemoveMember={async command => {
        calls.push('remove:' + command.agentId + ':' + command.expectedMembershipGeneration)
        if (command.threadId !== snapshot.thread.id || command.expectedMembershipVersion !== snapshot.members.find(item => item.agentId === command.agentId)?.version
          || command.expectedMembershipGeneration !== snapshot.thread.membershipGeneration) throw new Error('Stale removal command')
        if (conflictNextRemoval) {
          conflictNextRemoval = false
          setSnapshot(current => ({ ...current, thread: { ...current.thread, membershipGeneration: current.thread.membershipGeneration + 1 } }))
          return { status: 'conflict' }
        }
        setSnapshot(current => ({ ...current, members: current.members.filter(item => item.agentId !== command.agentId),
          thread: { ...current.thread, defaultLeadAgentId: command.replacementDefaultLeadAgentId ?? current.members.find(item => item.agentId !== command.agentId)?.agentId ?? null,
            membershipGeneration: current.thread.membershipGeneration + 1 } }))
        return { status: 'removed', message: '已移出' }
      }}
      onSend={async draft => {
        calls.push('send'); submissions.push(structuredClone(draft))
        if (rejectSend) throw new Error('Fixture rejects this send')
        coreActivated = true
        acceptedSends += 1
        if (failAfterSend) failStorage = true
        const message = optimisticThreadMessage(snapshot, `send-${acceptedSends}`, draft, now)
        setAcceptedMessages(current => [...current, { ...message, id: `published-${acceptedSends}`, sequence: acceptedSends }])
        const mentionedIds = draft.content.segments.flatMap(segment => segment.kind === 'atom' && segment.atom.type === 'member' ? [segment.atom.agentId] : [])
        const addressedAgentIds = mentionedIds.length ? mentionedIds : [draft.continuationIntent?.recipient.agentId ?? snapshot.thread.defaultLeadAgentId!]
        return { threadMessageId: 'published-' + acceptedSends, publishedMessageSequence: acceptedSends, deliveryIds: ['delivery'], agentRunIds: [], addressedAgentIds }
      }} />}
    </main></div></ThreadClientProvider></MobileLayoutProvider>
}
const errors: string[] = []
window.addEventListener('error', e => errors.push(String(e.error?.stack ?? e.message)))
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
createRoot(document.getElementById('root')!).render(<Fixture />)
Object.assign(window, { invitationTest: {
  mission: (visible: boolean) => showMission(visible),
  missionContent: () => flushMission(),
  state: () => ({ calls, submissions, errors, clipboardWrites, memberIds: visibleSnapshot.members.map(member => member.agentId), outsidePresence: visibleProfiles.find(profile => profile.agentId === 'outside')?.presence, text: document.getElementById('camp-message')?.textContent,
    atoms: document.querySelectorAll('[data-composer-atom="member"]').length,
    publishedMentions: [...document.querySelectorAll<HTMLElement>('.message-bubble [data-agent-id="outside"]')].map(token => ({ label: token.textContent, unavailable: token.classList.contains('is-unavailable'), interactive: token.classList.contains('is-interactive') })),
    invite: !!document.querySelector('[aria-label="发送时邀请 爱丽丝"]'),
    continuation: !!document.querySelector('[aria-label="继续发给 爱丽丝"]'),
    draft: loadLocalThreadComposerDraft(threadId),
    button: document.querySelector<HTMLButtonElement>('form.composer:has(#camp-message) button[type="submit"]')?.disabled,
    stored: Object.values(localStorage).join(' ') }),
  mobile: (value: boolean) => setMobile(value),
  language: (language: 'zh-CN' | 'en') => changeInterfaceLanguage(languageTestApi, language),
  presentation: () => {
    setProfiles([...profiles.map(profile => profile.agentId === 'outside'
      ? { ...profile, professionalResponsibilities: '负责落实界面设计，保留完整职责。'.repeat(8) } : profile),
      { ...outside, agentId: 'research', displayName: '资料员', teamRole: '研究与核对', professionalResponsibilities: '' }])
    setFixture({ ...initial, thread: { ...initial.thread, activationState: 'active' } })
  },
  presence: (presence: AgentProfile['presence']) => setProfiles(current => current.map(profile => profile.agentId === 'outside' ? { ...profile, presence } : profile)),
  readiness: (status: AgentProfile['runtimeReadiness']['status']) => setProfiles(current => current.map(profile => profile.agentId === 'outside'
    ? { ...profile, runtimeConfiguration: status === 'runtime_not_configured' ? null : outside.runtimeConfiguration, runtimeReadiness: { status, blockers: [] } }
    : profile)),
  accept: () => { rejectSend = false },
  projectActivation: () => setFixture(current => ({ ...current, thread: { ...current.thread, activationState: 'active' }, members: [member(agent), member(outside)] })),
  hide: () => setVisible(false), show: () => setVisible(true),
  leave: async () => { if (!prepareLeave) throw new Error('Leave guard missing'); (await prepareLeave()).complete(true); setVisible(false) },
  active: () => { localStorage.clear(); setFixture({ ...initial, thread: { ...initial.thread, activationState: 'active' } }); rejectSend = false; calls.length = 0 },
  empty: () => { localStorage.clear(); setFixture({ ...initial, members: [], thread: { ...initial.thread, activationState: 'active', defaultLeadAgentId: null } }); rejectSend = false; calls.length = 0 },
  removeAll: () => setFixture(current => ({ ...current, members: [], thread: { ...current.thread, defaultLeadAgentId: null } })),
  away: () => setFixture(current => ({ ...current, members: current.members.map(item => ({ ...item, profilePresence: 'away', isDefaultLead: false })), thread: { ...current.thread, defaultLeadAgentId: null } })),
  failInvite: () => { failNextInvite = true },
  removalPreviewMode: (mode: typeof removalPreviewMode) => { removalPreviewMode = mode },
  conflictRemoval: () => { conflictNextRemoval = true },
  submit: () => document.querySelector<HTMLButtonElement>('form.composer:has(#camp-message) button[type="submit"]')!.click(),
  focus: () => document.querySelector<HTMLElement>('#camp-message[contenteditable="true"]')!.focus(),
  text: () => document.querySelector<HTMLElement>('#camp-message[contenteditable="true"]')!.textContent,
} })

Object.assign(window, { pasteTest: {
  agentFiles: () => showAgentFiles(),
  draftWrites: () => draftWrites,
  otherThread: () => setFixture({ ...initial, thread: { ...initial.thread, id: 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7h', activationState: 'active' } }),
  reset: (pending: boolean) => {
    failPresence = false; failStorage = false; coreActivated = false; rejectSend = true; failAfterSend = false
    attachmentMode = 'ready'; releaseAttachment = null; preparedFiles.length = 0; failCleanup = false
    calls.length = 0; submissions.length = 0; errors.length = 0
    clipboardWrites.length = 0; acceptedSends = 0; clearAcceptedMessages()
    localStorage.clear()
    threadId = `rvcamp_${String(++pasteResetCounter).padStart(26, '0')}`
    initial.thread.id = threadId
    setFixture({ ...initial, thread: { ...initial.thread, activationState: pending ? 'pending' : 'active' } })
  },
  mode: (mode: typeof attachmentMode) => { attachmentMode = mode },
  release: (fail: boolean) => releaseAttachment?.(fail),
  failPresence: (value: boolean) => { failPresence = value },
  failCleanup: (value: boolean) => { failCleanup = value },
  failAfterSend: (value: boolean) => { failAfterSend = value },
  failStorage: (value: boolean) => { failStorage = value },
  paste: (text: string, structured?: string, html?: string, fileName?: string) => {
    const data = new DataTransfer()
    data.setData('text/plain', text)
    if (structured !== undefined) data.setData('application/x-rovai-composer+json', structured)
    if (html !== undefined) data.setData('text/html', html)
    if (fileName) data.items.add(new File(['fixture'], fileName, { type: fileName.endsWith('.png') ? 'image/png' : 'text/plain' }))
    document.querySelector<HTMLElement>('#camp-message')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  },
  selectAll: () => {
    const root = document.getElementById('camp-message')!
    root.focus()
    const range = document.createRange(); range.selectNodeContents(root)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
  },
  state: () => ({
    preparedFiles,
    preparing: document.querySelectorAll('.composer .attachment-preparing').length,
    failed: document.querySelectorAll('.composer .attachment-error').length,
    ready: document.querySelectorAll('.composer .composer-attachment-card').length,
    toast: document.querySelector('.composer-paste-status')?.textContent ?? null,
    persistenceError: document.querySelector('.composer-reply-status')?.textContent ?? null,
    deferred: releaseAttachment !== null
  })
} })
