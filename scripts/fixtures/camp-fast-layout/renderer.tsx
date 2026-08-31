import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, CampComposerDraftView, CampMemberFastView, CampSnapshot } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { CampWorkspace } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

const now = '2026-08-31T00:00:00Z'
const campId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
const agents: AgentProfile[] = Array.from({ length: 16 }, (_, index) => ({
  agentId: `agent-${index}`, displayName: index === 1 ? '负责分析超长项目名称和跨会话审查的队员' : `队员 ${index + 1}`,
  avatarRef: null, accent: null, teamRole: '项目协作', professionalResponsibilities: '', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: index === 2 ? 'opencode-cli' : 'claude-code-cli',
    model: { mode: 'runtime_default' }, permissions: { adapterKind: index === 2 ? 'opencode-cli' : 'claude-code-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: index, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
}))
const values = new Map<string, CampMemberFastView>(agents.filter((_, index) => index !== 2 && index !== 3).map(agent => [agent.agentId, {
  runtimeBindingRevision: `binding-${agent.agentId}`, fastOverride: null, runtimeDefaultFast: null
}]))
let updateSnapshot: (snapshot: CampSnapshot) => void
let updateAgents: (agents: AgentProfile[]) => void
const initial: CampSnapshot = {
  schemaVersion: 34, throughGlobalSequence: 1,
  camp: { id: campId, title: '响应模式与紧凑会话验收', activationState: 'active', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agents[0].agentId, membershipGeneration: 1, version: 1, createdAt: now, updatedAt: now },
  members: agents.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName, avatarRef: null,
    teamRole: agent.teamRole, accent: '', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
    memberOrder: index, isDefaultLead: index === 0, version: 1, fast: values.get(agent.agentId) })),
  membershipReconciliations: [], tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
}
let draft: CampComposerDraftView = { campId, body: '验收中保留的消息草稿', content: [{ kind: 'text', text: '验收中保留的消息草稿' }],
  revision: 1, attachments: [], replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }
const requests: Array<{ method: string; params: unknown }> = []
let failNext = false
let holdNext = false
let releaseResponse: (() => void) | null = null
const delayResponse = async (): Promise<void> => {
  if (!holdNext) return
  holdNext = false
  await new Promise<void>(resolve => { releaseResponse = resolve })
}
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  request: async (method: string, params?: Record<string, any>): Promise<unknown> => {
    requests.push({ method, params })
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.composerDraft.get') return draft
    if (method === 'camp.composerDraft.save') { draft = { ...draft, ...params, revision: draft.revision + 1 }; return draft }
    if (method === 'camps.members.fast.check') {
      const value = values.get(params!.agentId) ?? null
      await delayResponse()
      return value
    }
    if (method === 'camps.members.fast.set') {
      if (failNext) { failNext = false; throw new Error('fixture offline') }
      const command = params!.command
      const prior = values.get(command.agentId)!
      if (command.campId !== campId || command.expectedRuntimeBindingRevision !== prior.runtimeBindingRevision) throw new Error('Fixture scope mismatch')
      const value = { ...prior, fastOverride: command.fastOverride }
      values.set(command.agentId, value)
      await delayResponse()
      return { status: 'applied', code: 'camp.member.fast.updated', payload: { fast: value } }
    }
    throw new Error(`Unexpected fixture API: ${method}`)
  }
} })

function Fixture(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(initial)
  const [profiles, setProfiles] = useState(agents)
  const [open, setOpen] = useState(false)
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  const [notice, setNotice] = useState('')
  updateSnapshot = setSnapshot
  updateAgents = setProfiles
  return <div className="app-shell app-shell-camp">
    <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)' }}>Rovai AI</aside>
    <AppHeader campTitle={snapshot.camp.title} contextLabel="隔离验收" camp={snapshot} detailEntryHostRef={setEntryHost} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <CampWorkspace snapshot={snapshot} projectName="隔离验收" agents={profiles} busy={false} stopping={false}
        onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}} onResolveApproval={() => {}}
        onStop={() => {}} worldMapEnabled={false} inspectorVisible={open} inspectorTab="members" detailEntryHost={entryHost}
        onOpenInspector={() => setOpen(true)} onCloseInspector={() => setOpen(false)} onNotify={setNotice} />
      <span className="sr-only" data-fixture-notice>{notice}</span>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
const element = (selector: string): HTMLElement => document.querySelector(selector)!
let bookmarkedButton: HTMLElement | null = null
Object.assign(window, { fastTest: {
  settle: async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) },
  bookmark: () => { bookmarkedButton = element('.camp-fast-toggle') },
  legacyObservation: (state: 'fast' | 'standard' | 'cooldown') => {
    // Even an old cached projection carrying retired fields cannot influence the preference control.
    const value = { ...values.get('agent-0')!, observedFastState: state, unavailableReason: 'Fast 暂时不可用，本次按标准速度执行' }
    values.set('agent-0', value)
    updateSnapshot({ ...initial, members: initial.members.map(member => ({ ...member, fast: values.get(member.agentId) })) })
  },
  failNext: () => { failNext = true },
  holdNext: () => { holdNext = true },
  release: () => { releaseResponse?.(); releaseResponse = null },
  rebind: (kind: 'codex-cli' | 'opencode-cli') => {
    values.delete('agent-0')
    updateAgents(agents.map(agent => agent.agentId === 'agent-0' ? { ...agent,
      runtimeConfiguration: { adapterKind: kind, model: { mode: 'runtime_default' },
        permissions: { adapterKind: kind, schemaVersion: 1, values: {} } } } : agent))
    updateSnapshot({ ...initial, members: initial.members.map(member => ({ ...member, fast: values.get(member.agentId) })) })
  },
  restore: () => {
    values.set('agent-0', { runtimeBindingRevision: 'binding-restored', fastOverride: null,
      runtimeDefaultFast: null })
    updateAgents(agents)
    updateSnapshot({ ...initial, members: initial.members.map(member => ({ ...member, fast: values.get(member.agentId) })) })
  },
  snapshot: () => {
    const panel = element('.camp-detail-popover')
    const button = element('.camp-fast-toggle')
    const composer = element('.composer')
    const send = element('.composer-send')
    const scroll = element('.camp-members-panel')
    const rect = (node: HTMLElement) => node?.getBoundingClientRect().toJSON()
    const sendRect = send?.getBoundingClientRect()
    return { panel: rect(panel), composer: rect(composer), send: rect(send), button: rect(button),
      panelBackground: panel ? getComputedStyle(panel).backgroundColor : null,
      pressed: button?.getAttribute('aria-pressed'), label: button?.getAttribute('aria-label'),
      sameNode: button === bookmarkedButton, focused: document.activeElement === button,
      scrollable: scroll?.scrollHeight > scroll?.clientHeight, confirmation: Boolean(element('.camp-fast-cost-confirmation')),
      sendHit: Boolean(sendRect && document.elementFromPoint(sendRect.x + sendRect.width / 2, sendRect.y + sendRect.height / 2)?.closest('.composer-send')),
      toggles: document.querySelectorAll('.camp-fast-toggle').length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      pillHeight: element('.camp-fast-pill')?.getBoundingClientRect().height,
      fontSize: button ? getComputedStyle(element('.camp-fast-pill')).fontSize : null,
      notice: element('[data-fixture-notice]')?.textContent,
      requests: requests.filter(request => request.method.startsWith('camps.members.fast.')),
      saved: values.get('agent-0'), costAcknowledged: localStorage.getItem('rovai.camp-fast-cost-ack.v1') }
  }
} })
