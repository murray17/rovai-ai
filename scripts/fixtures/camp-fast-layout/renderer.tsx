import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, AgentRunView, CampComposerDraftView, CampMemberFastView, CampSnapshot, ExecutionConsolePlacement } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { CampWorkspace, type CampInspectorTab } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

const now = '2026-08-31T00:00:00Z'
const campId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
const agents: AgentProfile[] = Array.from({ length: 16 }, (_, index) => ({
  agentId: `agent-${index}`, displayName: index === 1 ? '负责分析超长项目名称和跨会话审查的队员' : `队员 ${index + 1}`,
  avatarRef: null, accent: null, teamRole: '项目协作', professionalResponsibilities: '', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: index === 2 ? 'opencode-cli' : index === 1 ? 'codex-cli' : 'claude-code-cli',
    model: { mode: 'runtime_default' }, permissions: { adapterKind: index === 2 ? 'opencode-cli' : index === 1 ? 'codex-cli' : 'claude-code-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: index, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
}))
const values = new Map<string, CampMemberFastView>(agents.filter((_, index) => index !== 2 && index !== 3).map(agent => [agent.agentId, {
  runtimeBindingRevision: `binding-${agent.agentId}`, fastOverride: null, runtimeDefaultFast: null
}]))
let updateSnapshot: (snapshot: CampSnapshot | ((current: CampSnapshot) => CampSnapshot)) => void
let updateAgents: (agents: AgentProfile[]) => void
const initial: CampSnapshot = {
  schemaVersion: 34, throughGlobalSequence: 1,
  camp: { id: campId, title: '响应模式与紧凑会话验收', activationState: 'active', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agents[0].agentId, membershipGeneration: 1, version: 1, createdAt: now, updatedAt: now },
  members: agents.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName, avatarRef: null,
    teamRole: agent.teamRole, accent: '', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
    memberOrder: index, isDefaultLead: index === 0, version: 1, fast: index === 1 || index === 4 ? undefined : values.get(agent.agentId) })),
  membershipReconciliations: [], tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
}
let draft: CampComposerDraftView = { campId, body: '验收中保留的消息草稿', content: { version: 2, segments: [{ kind: 'text', text: '验收中保留的消息草稿' }] },
  revision: 1, attachments: [], replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }
const requests: Array<{ method: string; params: unknown }> = []
const checkFailures = new Set(['agent-4'])
const heldChecks = new Map<string, Promise<void>>()
const checksInFlight = new Map<string, number>()
let releaseCheck: (() => void) | null = null
heldChecks.set('agent-1', new Promise<void>(resolve => { releaseCheck = resolve }))
let maxChecksPerMember = 0
let currentAgents = agents
let bindingSequence = 0
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
    if (method === 'camp.pendingInputs.get') return {campId, executionActive: false, items: [], editSession: null}
    if (method === 'camp.composerDraft.get') return draft
    if (method === 'camp.composerDraft.save') { draft = { ...draft, ...params, revision: draft.revision + 1 }; return draft }
    if (method === 'camps.members.fast.check') {
      const agentId = params!.agentId as string
      const count = (checksInFlight.get(agentId) ?? 0) + 1
      checksInFlight.set(agentId, count)
      maxChecksPerMember = Math.max(maxChecksPerMember, count)
      const value = values.get(agentId) ?? null
      const held = heldChecks.get(agentId)
      heldChecks.delete(agentId)
      try {
        await held
        if (checkFailures.delete(agentId)) throw new Error('fixture metadata unavailable')
        return value
      } finally { checksInFlight.set(agentId, count - 1) }
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
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>('inspector')
  const [tab, setTab] = useState<CampInspectorTab>('members')
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
        executionPlacement={placement} onExecutionPlacementChange={async value => { setPlacement(value); return value }}
        onCancelAgentRun={async run => {
          await new Promise<void>(resolve => { releaseStop = resolve })
          setSnapshot(current => ({ ...current, agentRuns: current.agentRuns.map(item => item.id === run.id
            ? {...item, status: 'cancelled', cancelRequestedAt: now, cancelAcknowledgedAt: now, endedAt: now} : item) }))
        }}
        onStop={() => {}} worldMapEnabled={false} inspectorVisible={open} inspectorTab={tab} detailEntryHost={entryHost}
        onOpenInspector={next => { setTab(next); setOpen(true) }} onCloseInspector={() => setOpen(false)} onNotify={setNotice} />
      <span className="sr-only" data-fixture-notice>{notice}</span>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
const element = (selector: string): HTMLElement => document.querySelector(selector)!
let bookmarkedButton: HTMLElement | null = null
let releaseStop: (() => void) | null = null
Object.assign(window, { fastTest: {
  settle: async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) },
  bookmark: () => { bookmarkedButton = element('.camp-fast-toggle') },
  legacyObservation: (state: 'fast' | 'standard' | 'cooldown') => {
    // Even an old cached projection carrying retired fields cannot influence the preference control.
    const value = { ...values.get('agent-0')!, observedFastState: state, unavailableReason: 'Fast 暂时不可用，本次按标准速度执行' }
    values.set('agent-0', value)
    updateSnapshot({ ...initial, members: initial.members.map(member => ({ ...member, fast: values.get(member.agentId) })) })
  },
  releaseStop: () => { releaseStop?.(); releaseStop = null },
  refresh: () => updateSnapshot(current => ({ ...current, throughGlobalSequence: current.throughGlobalSequence + 1,
    members: current.members.map(member => ({ ...member, fast: member.fast ? {...member.fast} : undefined })) })),
  showExecution: () => {
    currentAgents = currentAgents.map(agent => agent.agentId === 'agent-0' ? { ...agent,
      runtimeConfiguration: { ...agent.runtimeConfiguration!,
        model: { mode: 'explicit', modelId: 'claude-sonnet-4-6', options: { effort: 'high' } } }
    } : agent)
    updateAgents(currentAgents)
    const runs: AgentRunView[] = agents.slice(0, 3).map(agent => ({
      id: `run-${agent.agentId}`, campTurnId: `turn-${agent.agentId}`, conversationId: `conversation-${agent.agentId}`,
      agentId: agent.agentId, taskId: null, responsibilityKey: `direct:${agent.agentId}`, responsibilityGeneration: 0,
      purpose: '执行台 Fast 与停止布局验收', completionRole: 'required', status: 'running', waitReason: null,
      cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, terminalResolutionSource: null,
      terminalReasonCode: null, failure: null, runtimeModel: {modelId: 'fixture-model'}, executionEpoch: 1,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 1,
      hasUnsettledExternalEffects: false, workspace: {path: '/fixture/workspace'}, startingGitObservation: null,
      endingGitObservation: null, version: 1, createdAt: now, startedAt: now, endedAt: null, updatedAt: now
    }))
    runs.unshift({ ...runs[0], id: 'previous-agent-0', campTurnId: 'previous-turn-agent-0', status: 'succeeded',
      createdAt: '2026-08-30T23:55:00Z', startedAt: '2026-08-30T23:55:00Z', endedAt: '2026-08-30T23:59:00Z' })
    updateSnapshot(current => ({...current, agentRuns: runs, turns: runs.map(run => ({
      id: run.campTurnId, triggerType: 'camp_message', triggerId: 'fixture-message', status: run.status === 'succeeded' ? 'completed' : 'running',
      cancelRequestedAt: null, aggregateReasonCode: null, version: 1, createdAt: now, updatedAt: now, endedAt: null,
      executionBudget: {schemaVersion: 1, acceptedAt: now, deadlineAt: '2026-08-31T01:00:00Z', elapsedSeconds: 0,
        maxAgentRunResponsibilities: 20, maxAcceptedA2a: 100, allocatedAgentRunResponsibilities: 1, acceptedA2a: 0,
        exhaustedAt: null, exhaustionReason: null, exhaustionCommandId: null}
    })), executionEvidence: runs.map(run => ({
      id: `evidence-${run.id}`, agentRunId: run.id, executionEpoch: 1, sequence: 1, eventType: 'agent.text.delta',
      kind: 'narration', phase: 'updated', payload: {itemId: `message-${run.id}`, delta: '检查执行台 Fast、停止与收起按钮。'},
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now
    }))}))
  },
  failNext: () => { failNext = true },
  holdCheck: (agentId: string) => {
    const wait = new Promise<void>(resolve => { releaseCheck = resolve })
    heldChecks.set(agentId, wait)
  },
  releaseCheck: () => { releaseCheck?.(); releaseCheck = null },
  holdNext: () => { holdNext = true },
  release: () => { releaseResponse?.(); releaseResponse = null },
  rebind: (kind: 'claude-code-cli' | 'codex-cli' | 'opencode-cli', supported = false, keepProjection = false) => {
    if (supported) values.set('agent-0', { runtimeBindingRevision: `binding-rebound-${++bindingSequence}`,
      fastOverride: null, runtimeDefaultFast: null })
    else values.delete('agent-0')
    currentAgents = currentAgents.map(agent => agent.agentId === 'agent-0' ? { ...agent, version: agent.version + 1,
      runtimeConfiguration: { adapterKind: kind, model: { mode: 'runtime_default' },
        permissions: { adapterKind: kind, schemaVersion: 1, values: {} } } } : agent)
    updateAgents(currentAgents)
    if (!keepProjection) updateSnapshot({ ...initial, members: initial.members.map(member => ({ ...member,
      fast: member.agentId === 'agent-0' ? undefined : values.get(member.agentId) })) })
  },
  snapshot: () => {
    const panel = element('.camp-detail-popover')
    const button = element('.camp-fast-toggle')
    const composer = element('.conversation-controls .composer-box')
    const send = element('.conversation-controls .composer-primary-action')
    const scroll = element('.camp-members-panel')
    const rect = (node: HTMLElement) => node?.getBoundingClientRect().toJSON()
    const sendRect = send?.getBoundingClientRect()
    return { panel: rect(panel), composer: rect(composer), send: rect(send), button: rect(button),
      panelBackground: panel ? getComputedStyle(panel).backgroundColor : null,
      pressed: button?.getAttribute('aria-pressed'), label: button?.getAttribute('aria-label'),
      sameNode: button === bookmarkedButton, focused: document.activeElement === button,
      scrollable: scroll?.scrollHeight > scroll?.clientHeight,
      sendHit: Boolean(sendRect && document.elementFromPoint(sendRect.x + sendRect.width / 2, sendRect.y + sendRect.height / 2)?.closest('.composer-primary-action')),
      toggles: document.querySelectorAll('.camp-fast-toggle').length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
      pillHeight: element('.camp-fast-pill')?.getBoundingClientRect().height,
      fontSize: button ? getComputedStyle(element('.camp-fast-pill')).fontSize : null,
      notice: element('[data-fixture-notice]')?.textContent,
      requests: requests.filter(request => request.method.startsWith('camps.members.fast.')),
      checks: requests.filter(request => request.method === 'camps.members.fast.check').map(request => request.params),
      saves: requests.filter(request => request.method === 'camps.members.fast.set'),
      maxChecksPerMember,
      memberStates: Array.from(document.querySelectorAll('.camp-inspector-member-row')).map((row, index) => {
        const button = row.querySelector('.camp-fast-toggle'); return {agentId: agents[index].agentId,
          pending: button?.getAttribute('aria-busy'), pressed: button?.getAttribute('aria-pressed'), opacity: button ? getComputedStyle(button).opacity : null}
      }),
      memberFast: Object.fromEntries(Array.from(document.querySelectorAll('.camp-inspector-member-row')).map((row, index) => [agents[index].agentId, Boolean(row.querySelector('.camp-fast-toggle'))])),
      checkingText: /检测响应模式|正在检测响应模式|响应模式检测完成|恢复默认响应模式/.test(document.body.textContent ?? ''),
      saved: values.get('agent-0') }
  }
} })
