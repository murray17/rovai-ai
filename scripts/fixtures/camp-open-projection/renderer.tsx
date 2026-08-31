import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, CampComposerDraftView, CampOpenProjection } from '@contracts'
import { AppHeader, campOpenProjectionAsSnapshot } from '../../../apps/desktop/src/renderer/src/App'
import { CampWorkspace, type CampInspectorTab } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

const now = '2026-08-31T00:00:00Z'
const campId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
const agent: AgentProfile = {
  agentId: 'agent-1', displayName: '队员', avatarRef: null, accent: null,
  teamRole: '项目协作', professionalResponsibilities: '', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: 'opencode-cli', model: { mode: 'runtime_default' },
    permissions: { adapterKind: 'opencode-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: 0, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
}
const messages: CampOpenProjection['messages'] = Array.from({ length: 61 }, (_, index) => ({
  id: `message-${index + 1}`, sequence: index + 1, timelineGlobalSequence: null,
  authorType: index % 2 === 0 ? 'user' : 'agent', authorId: index % 2 === 0 ? 'local_user' : agent.agentId,
  sourceAgentRunId: null, body: `第 ${index + 1} 条消息：保留较早历史和当前阅读位置。`,
  content: [{ kind: 'text', text: `第 ${index + 1} 条消息：保留较早历史和当前阅读位置。` }],
  attachments: [], addressMode: 'default', addressedAgentIds: [agent.agentId],
  replyToCampMessageId: null, campTurnId: null, presentation: null,
  createdAt: new Date(Date.parse(now) + index * 60_000).toISOString()
}))
const coverage = (count: number) => ({ loadedCount: count, totalCount: count, omittedCount: 0, complete: true })
const projection = (count: number): CampOpenProjection => ({
  schemaVersion: 6, throughGlobalSequence: count,
  camp: { id: campId, title: '仅业务投影的会话刷新', activationState: 'active', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agent.agentId, membershipGeneration: 1, version: 1,
    createdAt: now, updatedAt: now },
  members: [{ agentId: agent.agentId, displayName: agent.displayName, avatarRef: null, teamRole: agent.teamRole,
    accent: '', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
    isDefaultLead: true, version: 1 }],
  membershipReconciliations: [],
  tasks: [{ taskId: 'task-1', campId, title: '检查业务投影', description: '任务仍然直接来自业务数据。',
    acceptanceCriteria: ['不读取审计事件'], status: 'blocked', assigneeAgentId: agent.agentId,
    blockedReason: '业务状态原因', completionSummary: null, cancelReason: null,
    createdByType: 'user', createdById: 'local_user', sourceAgentRunId: null,
    closedByType: null, closedById: null, closedByAgentRunId: null,
    version: 1, createdAt: messages[23].createdAt, updatedAt: messages[23].createdAt, closedAt: null, availableActions: ['update'] }],
  messages: messages.slice(count - 20, count), messageDeliveries: [],
  turns: [{ id: 'stopped-turn', triggerType: 'camp_message', triggerId: 'message-24', status: 'cancelled',
    cancelRequestedAt: messages[23].createdAt, aggregateReasonCode: null, version: 1,
    createdAt: now, updatedAt: messages[23].createdAt, endedAt: messages[23].createdAt,
    executionBudget: { schemaVersion: 1, acceptedAt: now, deadlineAt: messages[60].createdAt,
      elapsedSeconds: 3600, maxAgentRunResponsibilities: 32, maxAcceptedA2a: 16,
      allocatedAgentRunResponsibilities: 1, acceptedA2a: 0, exhaustedAt: null, exhaustionReason: null,
      exhaustionCommandId: null } }],
  agentRuns: [], executionEvidence: [], approvals: [],
  agentRunFileChanges: [{ schemaVersion: 2, agentRunId: 'completed-run', executionEpoch: 1,
    files: [{ evidenceFileId: 'file-1', path: 'src/fixture.ts', changeKind: 'update',
      presentationKind: 'operation_history', operationCount: 1 }],
    fileCount: 1, operationCount: 1, completedAt: messages[23].createdAt }],
  coverage: { tasks: coverage(1), messages: { ...coverage(count), loadedCount: 20, omittedCount: count - 20,
    complete: false, hasEarlier: true, oldestLoadedSequence: count - 19, newestLoadedSequence: count },
    messageDeliveries: coverage(0), turns: coverage(1), agentRuns: coverage(0), executionEvidence: coverage(0), approvals: coverage(0) }
})
// The reader has loaded an earlier page through the existing history API.
const earlier = { ...campOpenProjectionAsSnapshot(projection(60)),
  messages: messages.slice(0, 40).map(message => ({ ...message, timelineGlobalSequence: message.sequence })) }
let current = campOpenProjectionAsSnapshot(projection(60), earlier)
let updateSnapshot: (snapshot: typeof current) => void
let closeTask: () => void
let imageResult = { mediaType: 'image/svg+xml', data: '' }
const draft: CampComposerDraftView = { campId, body: '', content: [], revision: 1, attachments: [],
  replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  request: async (method: string): Promise<unknown> => {
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.composerDraft.get') return draft
    if (method === 'agentRunImages.read') return imageResult
    throw new Error(`Unexpected fixture API: ${method}`)
  },
  composerAttachments: { preview: async () => ({ mediaType: imageResult.mediaType,
    bytes: Uint8Array.from(atob(imageResult.data), character => character.charCodeAt(0)) }) }
} })

function Fixture(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(current)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<CampInspectorTab>('tasks')
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  updateSnapshot = setSnapshot
  closeTask = () => setOpen(false)
  return <div className="app-shell app-shell-camp">
    <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)' }}>Rovai AI</aside>
    <AppHeader campTitle={snapshot.camp.title} contextLabel="隔离验收" camp={snapshot}
      detailEntryHostRef={setEntryHost} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <CampWorkspace snapshot={snapshot} projectName="隔离验收" agents={[agent]} busy={false} stopping={false}
        onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}}
        onResolveApproval={() => {}} onStop={() => {}} worldMapEnabled={false}
        inspectorVisible={open} inspectorTab={tab} detailEntryHost={entryHost}
        onOpenInspector={next => { setTab(next); setOpen(true) }} onCloseInspector={() => setOpen(false)} />
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
const element = (selector: string): HTMLElement => document.querySelector(selector)!
let anchor: HTMLElement | null = null
Object.assign(window, { campOpenTest: {
  settle: async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) },
  openTask: () => element('.task-event-card').click(),
  closeTask: () => closeTask(),
  bookmark: () => {
    anchor = element('[data-message-id="message-25"]')
    anchor.scrollIntoView({ block: 'center' })
    element('.timeline-scroll').dispatchEvent(new Event('scroll'))
  },
  refresh: (append: boolean) => {
    current = campOpenProjectionAsSnapshot({ ...projection(append ? 61 : 60), throughGlobalSequence: append ? 101 : 100 }, current)
    updateSnapshot(current)
  },
  showImages: (result: { displayName: string; mediaType: string; data: string }, count = 1) => {
    imageResult = result
    const images = Array.from({ length: count }, (_, index) => ({ id: `image-${index}`, displayName: result.displayName,
      mediaType: result.mediaType, byteSize: atob(result.data).length }))
    current = { ...current, tasks: [], turns: [], agentRuns: [], agentRunFileChanges: [], messageDeliveries: [],
      // Two distinct Runs deliberately show identical bytes to compare the two presentation paths.
      messages: ['Tool 返回的图片', '通过 send 发送的图片'].map((body, index) => ({
        ...messages[index], id: `image-message-${index}`, authorType: 'agent', authorId: agent.agentId,
        sourceAgentRunId: index === 0 ? 'tool-run' : 'send-run', body, content: [{ kind: 'text', text: body }],
        attachments: index === 0 ? [] : images.map(image => ({ ...image, kind: 'file', fileCount: 1,
          previewKind: 'image', runtimeProjectionState: 'available' }))
      })),
      agentRunImages: [{ agentRunId: 'tool-run', executionEpoch: 1, createdAt: now, images }]
    }
    updateSnapshot(current)
  },
  imageAppearance: (source: 'tool' | 'send') => {
    const container = element(source === 'tool' ? '.runtime-image-supplement' : '.timeline-attachments')
    const previews = Array.from(container.querySelectorAll<HTMLButtonElement>('.image-tile-preview'))
    container.scrollIntoView({ block: 'center' })
    return previews.map(preview => {
      const image = preview.querySelector('img')!
      const bounds = preview.getBoundingClientRect()
      const style = getComputedStyle(preview)
      return { decoded: Boolean(image?.naturalWidth), width: Math.round(bounds.width), height: Math.round(bounds.height),
        left: Math.round(bounds.left), border: style.border, radius: style.borderRadius, background: style.backgroundColor,
        fit: image ? getComputedStyle(image).objectFit : null,
        extraText: container.querySelector('.image-gallery')!.textContent!.trim() }
    })
  },
  state: () => {
    const scroll = element('.timeline-scroll')
    const node = element('[data-message-id="message-25"]')
    return {
      messages: Array.from(document.querySelectorAll('article[data-message-id]')).map(node => node.getAttribute('data-message-id')),
      timelineLength: current.timeline.length, allEventSequencesNull: current.messages.every(message => message.timelineGlobalSequence === null),
      cards: { task: document.querySelectorAll('.task-event-card').length, stop: document.querySelectorAll('.run-stopped-event').length,
        files: document.querySelectorAll('.run-file-changes-card').length },
      auditText: element('.task-detail')?.textContent ?? '', scrollTop: scroll.scrollTop,
      bottomGap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
      anchorTop: node?.getBoundingClientRect().top, sameAnchorNode: node === anchor
    }
  }
} })
