import type { AgentProfile, CampComposerDraftView, CampMessageView, CampPendingInputsView, CampSnapshot, RovaiApi } from '@contracts'
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CampWorkspace } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec0'
const timestamp = '2026-08-31T00:00:00Z'
const errors: string[] = []
window.addEventListener('error', event => errors.push(String(event.error?.stack ?? event.message)))
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)))
const calls: string[] = []
const drafts = new Map<string, CampComposerDraftView>()
let root: Root | null = null
let snapshot: CampSnapshot
let queue: CampPendingInputsView
let nextRead: { promise: Promise<CampComposerDraftView>; resolve(value: CampComposerDraftView): void } | null = null
const agents: AgentProfile[] = ['叮叮', '芝士'].map((displayName, index) => ({
  agentId: `agent_${index + 1}`, displayName, avatarRef: null, accent: '#39777a', teamRole: '开发者',
  professionalResponsibilities: '实现和验证', personalityTraits: ['严谨'], workingPrinciples: '遵循项目规范',
  growthTopic: '', defaultCapabilities: [], presence: 'present', memberOrder: index, version: 1,
  runtimeConfiguration: { adapterKind: 'codex-cli', model: { mode: 'runtime_default' },
    permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, createdAt: timestamp, updatedAt: timestamp, removedAt: null
}))

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
const frames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
async function flush() { await frames(); check(errors.length === 0, errors.join('\n')) }
async function until(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await flush()
    if (condition()) return
  }
  throw new Error(message)
}
const continuation = () => document.querySelector('.composer-continuation')?.getAttribute('aria-label') ?? null
const editor = () => document.getElementById('camp-message')!
const draftReads = () => calls.filter(call => call === 'camp.composerDraft.get').length
const emptyDraft = (id = campId): CampComposerDraftView => ({
  campId: id, body: '', content: [], revision: 0, attachments: [], replyIntent: null,
  continuationIntent: null, updatedAt: null, expiresAt: null
})
const continuedDraft = (messageId: string): CampComposerDraftView => ({
  ...emptyDraft(), continuationIntent: { sourceCampMessageId: messageId,
    recipient: { agentId: 'agent_2', displayName: '芝士', recipientAvailability: 'available' },
    recipientSelectionRequired: false }
})

// Core's projection is supplied explicitly per scenario. This fixture tests the
// production Renderer lifecycle, not a second implementation of route calculation.
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => undefined,
  async request(method: string, params: Record<string, unknown> = {}) {
    calls.push(method)
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.pendingInputs.get') return structuredClone({ ...queue, campId: params.campId })
    if (method === 'camp.composerDraft.get') {
      if (nextRead) { const held = nextRead; nextRead = null; return held.promise }
      return structuredClone(drafts.get(String(params.campId)))
    }
    if (method === 'camp.composerDraft.save') {
      const current = drafts.get(String(params.campId))!
      const content = params.content as CampComposerDraftView['content']
      const saved = { ...current, content, body: content.map(segment => segment.kind === 'text' ? segment.text : '').join(''),
        revision: current.revision + 1 }
      drafts.set(saved.campId, saved)
      return structuredClone(saved)
    }
    errors.push(`Unexpected RPC: ${method}`)
    throw new Error(`Unexpected RPC: ${method}`)
  }
} as unknown as RovaiApi })

function message(sequence: number, agentId: string): CampMessageView {
  return { id: `message-${sequence}`, sequence, timelineGlobalSequence: sequence,
    authorType: 'user', authorId: 'local_user', sourceAgentRunId: null,
    body: `消息 ${sequence}`, content: [{ kind: 'member_mention', agentId }, { kind: 'text', text: `消息 ${sequence}` }],
    addressMode: 'explicit', attachments: [], addressedAgentIds: [agentId], replyToCampMessageId: null,
    campTurnId: `turn-${sequence}`, presentation: null, createdAt: timestamp }
}

function running(current: CampMessageView): Pick<CampSnapshot, 'turns' | 'agentRuns'> {
  const agentId = current.addressedAgentIds[0]
  return {
    turns: [{ id: current.campTurnId!, triggerType: 'camp_message', triggerId: current.id, status: 'running',
      cancelRequestedAt: null, aggregateReasonCode: null, executionBudget: { schemaVersion: 1,
        acceptedAt: timestamp, deadlineAt: '2026-08-31T01:00:00Z', elapsedSeconds: 3600,
        maxAgentRunResponsibilities: 32, maxAcceptedA2a: 16, allocatedAgentRunResponsibilities: 1,
        acceptedA2a: 0, exhaustedAt: null, exhaustionReason: null, exhaustionCommandId: null },
      version: 1, createdAt: timestamp, updatedAt: timestamp, endedAt: null }],
    agentRuns: [{ id: `run-${current.sequence}`, campTurnId: current.campTurnId!, conversationId: `conversation-${agentId}`,
      agentId, taskId: null, responsibilityKey: `direct:${agentId}`, responsibilityGeneration: 0, purpose: current.body,
      completionRole: 'required', status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: null, terminalReasonCode: null, failure: null,
      runtimeModel: null, permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 0,
      hasUnsettledExternalEffects: false, workspace: { path: '/fixture' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: timestamp, startedAt: timestamp, endedAt: null, updatedAt: timestamp }]
  }
}

async function render() {
  flushSync(() => root!.render(<CampWorkspace snapshot={snapshot} projectName={null} agents={agents}
    busy={false} stopping={false} worldMapEnabled={false}
    onSend={async () => { throw new Error('This fixture must not submit messages') }} onStop={() => undefined}
    onChangeLead={async () => undefined} onTasksChanged={async () => undefined} onResolveApproval={() => undefined} />))
  await flush()
}

async function reset(draft = emptyDraft()) {
  if (root) {
    flushSync(() => root!.unmount())
    await new Promise(resolve => setTimeout(resolve, 0))
    await flush()
  }
  calls.length = 0
  drafts.clear()
  drafts.set(campId, draft)
  nextRead = null
  queue = { campId, executionActive: true, items: [], editSession: null }
  const first = message(1, 'agent_1')
  snapshot = { schemaVersion: 34, throughGlobalSequence: 1,
    camp: { id: campId, title: '续发目标回归', activationState: 'active', projectBindingKind: 'quick_chat',
      projectPath: '/fixture', defaultLeadAgentId: 'agent_1', membershipGeneration: 1, version: 1,
      createdAt: timestamp, updatedAt: timestamp },
    members: agents.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName,
      teamRole: agent.teamRole, avatarRef: null, accent: agent.accent ?? '#39777a', membershipStatus: 'active', leaveRequestedAt: null,
      profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
    membershipReconciliations: [], tasks: [], messages: [first], messageDeliveries: [], ...running(first),
    executionEvidence: [], agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: [] }
  root = createRoot(document.getElementById('root')!)
  await render()
  await flush()
}

async function publish(agentId: string, projected: CampComposerDraftView) {
  drafts.set(snapshot.camp.id, projected)
  const next = message(snapshot.messages.at(-1)!.sequence + 1, agentId)
  snapshot = { ...snapshot, throughGlobalSequence: snapshot.throughGlobalSequence + 1,
    messages: [...snapshot.messages, next], ...running(next) }
  queue = { ...queue, items: queue.items.slice(1) }
  await render()
}

function holdRead() {
  let resolve!: (draft: CampComposerDraftView) => void
  const held = { promise: new Promise<CampComposerDraftView>(accept => { resolve = accept }), resolve: (draft: CampComposerDraftView) => resolve(draft) }
  nextRead = held
  return held
}

Object.assign(window, { continuationTest: { async run() {
  const cases: string[] = []
  await reset()
  const initialReads = draftReads()
  queue.items = [{ id: 'pending-B', campId, enqueueSequence: 1, revision: 1, state: 'queued',
    content: message(2, 'agent_2').content, body: '给芝士的 B', replyIntent: null,
    recipientSelectionRequired: false, lastAttemptErrorCode: null }]
  snapshot = { ...snapshot, throughGlobalSequence: 2 }
  await render()
  check(document.querySelector('.pending-input-list'), 'B must be visible in the private queue')
  check(continuation() === null && draftReads() === initialReads, 'Queue admission or Run progress must not recalculate the route')
  cases.push('private queue admission leaves the published route unchanged')

  await publish('agent_2', continuedDraft('message-2'))
  await until(() => continuation() === '继续发给 芝士', 'Publishing queued B must refresh the visible continuation before B finishes')
  check(snapshot.agentRuns[0].status === 'running' && snapshot.agentRuns[0].endedAt === null, 'B must still be running')
  cases.push('published B changes the target while its Run is still active')

  await publish('agent_1', emptyDraft())
  await until(() => continuation() === null, 'Publishing to Lead must clear the stale non-Lead continuation')
  check(document.querySelector('.composer-route-rail')?.textContent?.includes('叮叮'), 'The route must return to the Lead')
  cases.push('the next published Lead message clears the previous continuation')

  await reset()
  const held = holdRead()
  await publish('agent_2', continuedDraft('message-2'))
  check(nextRead === null, 'Publication must request a fresh Draft projection')
  const activeEditor = editor()
  activeEditor.focus()
  document.execCommand('insertText', false, '不要覆盖的草稿')
  await flush()
  held.resolve(continuedDraft('message-2'))
  await flush()
  check(editor() === activeEditor && editor().textContent?.includes('不要覆盖的草稿'), 'Late reads must preserve the live editor and text')
  check(continuation() === null, 'A late response must not change the target after typing began')
  cases.push('a late publication read cannot replace locally edited text or route')

  const explicit = emptyDraft()
  explicit.content = [{ kind: 'member_mention', agentId: 'agent_1' }, { kind: 'text', text: '已有草稿' }]
  explicit.body = '@叮叮 已有草稿'
  explicit.attachments = [{ id: 'attachment-1', displayName: '验收文件.txt', kind: 'file', fileCount: 1,
    mediaType: 'text/plain', byteSize: 42, previewKind: 'none', state: 'ready', errorMessage: null, createdAt: timestamp }]
  await reset(explicit)
  const retainedEditor = editor()
  await publish('agent_2', explicit)
  check(editor() === retainedEditor && editor().textContent?.includes('已有草稿'), 'Publication must preserve the existing Draft text')
  check(document.querySelector('.composer-attachment-strip')?.textContent?.includes('验收文件.txt'), 'Publication must preserve attachments')
  check(continuation() === null && editor().querySelector('[data-token-kind="member_mention"][data-agent-id="agent_1"]'), 'Explicit recipient must remain authoritative')
  cases.push('publication preserves an existing explicit recipient, text and attachment')

  const frozen = continuedDraft('older-message')
  frozen.body = '继续给芝士的草稿'
  frozen.content = [{ kind: 'text', text: frozen.body }]
  await reset(frozen)
  await publish('agent_1', frozen)
  check(continuation() === '继续发给 芝士' && editor().textContent?.includes(frozen.body), 'A started Draft must retain its frozen continuation')
  cases.push('a started Draft retains its own continuation source')

  await reset()
  const previousCampRead = holdRead()
  await publish('agent_2', continuedDraft('message-2'))
  const otherCampId = 'rvcamp_01h47kvsy5fk1shh6w1g60eec1'
  drafts.set(otherCampId, emptyDraft(otherCampId))
  snapshot = { ...snapshot, camp: { ...snapshot.camp, id: otherCampId } }
  await render()
  await flush()
  previousCampRead.resolve(continuedDraft('message-2'))
  await flush()
  check(continuation() === null, 'A late read from the previous Camp must not change this Camp')
  cases.push('late publication responses are scoped to their Camp')
  return { ok: true, cases }
} } })
