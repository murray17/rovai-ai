import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, AgentRunView, CampComposerDraftView, CampSnapshot, ExecutionConsolePlacement } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { CampWorkspace } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

// The actual production workspace, with closed local fixtures. No Core, Runtime or daily data.
const now = '2026-08-31T04:00:00Z'
const campId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
const fixtureMessage = '本页挂载真实的执行浮层、执行详情和三个生产入口。可检查头像横滑、键盘导航，并从任务的关联执行定位最后一位队员。'
const longPath = `/fixture/workspace/${'execution_popover_width_regression_'.repeat(7)}report.md`
const longCommand = `git show HEAD -- ${longPath}`
const longNarration = `这是隔离验收数据。长正文、路径和行内代码应在浮层内完整换行，命令标题保持单行省略。\n\n检查文件：\`${longPath}\`。\n\n\`\`\`text\n${longPath}\n\`\`\`\n\n正文结束标记：完整可读。`
const names = ['洛可', '沐瓦', '绵栀', '奇鹿', '言川', '予墨', '知夏', '负责跨项目执行审查与回归验收的长名称队员', '时屿', '星澜', '安禾', '云舒']
const agents: AgentProfile[] = Array.from({ length: 20 }, (_, index) => ({
  agentId: `agent-${index + 1}`, displayName: names[index] ?? `队员 ${index + 1}`,
  avatarRef: index < 4 ? `rovai://member-avatar/builtin/${['luoke', 'muwa', 'mianzhi', 'qilu'][index]}/v1` : null,
  accent: null, teamRole: '项目协作', professionalResponsibilities: '', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: 'claude-code-cli', model: { mode: 'explicit', modelId: 'claude-opus-4-6', options: {} },
    permissions: { adapterKind: 'claude-code-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: index, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
}))

function snapshotFor(count: number, revision: number): CampSnapshot {
  const profiles = agents.slice(0, count)
  const runs: AgentRunView[] = profiles.map((agent, index) => {
    const status = (['running', 'waiting', 'running', 'succeeded', 'failed', 'cancelled'] as const)[index < 3 ? index : 3 + (index % 3)]
    return {
      id: `run-${agent.agentId}`, campTurnId: `turn-${agent.agentId}`, conversationId: `conversation-${agent.agentId}`,
      agentId: agent.agentId, taskId: index === count - 1 ? 'task-rail' : null,
      responsibilityKey: `direct:${agent.agentId}`, responsibilityGeneration: 0, purpose: '执行台界面与交互检查',
      completionRole: 'required', status: revision % 2 && index === 0 ? 'succeeded' : status,
      waitReason: status === 'waiting' ? 'dependency' : null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, terminalResolutionSource: null, terminalReasonCode: null, failure: null,
      runtimeModel: { modelId: 'claude-opus-4-6' }, executionEpoch: 1, permissionSemantics: 'runtime_managed_v2',
      invocationKind: 'direct', triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: 2, hasUnsettledExternalEffects: false, workspace: { path: '/fixture/workspace' },
      startingGitObservation: null, endingGitObservation: null, version: revision + 1,
      createdAt: now, startedAt: now, endedAt: index < 3 ? null : now, updatedAt: now
    }
  })
  return {
    schemaVersion: 34, throughGlobalSequence: revision + 1,
    camp: { id: campId, title: '执行台头像轨道', activationState: 'active', projectBindingKind: 'directory',
      projectPath: '/fixture/workspace', defaultLeadAgentId: profiles[0]?.agentId ?? null,
      membershipGeneration: 1, version: 1, createdAt: now, updatedAt: now },
    members: profiles.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName,
      avatarRef: agent.avatarRef, teamRole: agent.teamRole, accent: '', membershipStatus: 'active',
      leaveRequestedAt: null, profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
    membershipReconciliations: [],
    tasks: count ? [{ taskId: 'task-rail', campId, title: '检查最后一位队员的执行', description: '从关联执行定位轨道末尾，随后可重复定位同一队员。',
      acceptanceCriteria: ['目标头像完整可见'], status: 'in_progress', assigneeAgentId: profiles.at(-1)!.agentId,
      blockedReason: null, completionSummary: null, cancelReason: null, createdByType: 'user', createdById: 'local-user',
      sourceAgentRunId: null, closedByType: null, closedById: null, closedByAgentRunId: null,
      version: 1, createdAt: now, updatedAt: now, closedAt: null, availableActions: [] }] : [],
    messages: [{ id: 'message-1', sequence: 1, timelineGlobalSequence: 1, authorType: 'user', authorId: 'local-user',
      sourceAgentRunId: null, body: fixtureMessage,
      content: [{ kind: 'text', text: fixtureMessage }], addressMode: 'default', attachments: [], addressedAgentIds: [], replyToCampMessageId: null,
      campTurnId: null, presentation: null, createdAt: now }],
    messageDeliveries: [], turns: [], agentRuns: runs,
    executionEvidence: runs.flatMap<CampSnapshot['executionEvidence'][number]>(run => [{ id: `evidence-${run.agentId}`, agentRunId: run.id, executionEpoch: 1,
      sequence: 1, eventType: 'agent.text.delta', kind: 'narration', phase: 'updated',
      payload: { itemId: `message-${run.agentId}`, delta: longNarration },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now }, {
      id: `command-${run.agentId}`, agentRunId: run.id, executionEpoch: 1, sequence: 2,
      eventType: 'activity.completed', kind: 'command', phase: 'completed',
      payload: { item: { id: `shell-${run.agentId}`, type: 'commandExecution', command: longCommand,
        status: 'completed', aggregatedOutput: `检查文件 ${longPath}\n${'完整输出仍可纵向滚动。\n'.repeat(24)}输出结束标记。` } },
      canonical: { operationId: `shell-${run.agentId}`, classifierVersion: 'activity-v1',
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: null, presentationHint: '执行 Shell 命令',
        phase: 'terminal', outcome: 'succeeded', credibility: 'runtime_structured', coverageLevel: 'fine_grained',
        sourceAuthority: 'runtime', sourceEvidenceIds: [`command-${run.agentId}`],
        firstEvidenceSequence: 2, lastEvidenceSequence: 2, revision: 1 },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now
    }]),
    agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
  }
}

let draft: CampComposerDraftView = { campId, body: '', content: [], revision: 1, attachments: [],
  replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.composerDraft.get') return draft
    if (method === 'camp.composerDraft.save') { draft = { ...draft, ...params, revision: draft.revision + 1 }; return draft }
    if (method === 'agentRunEvidence.getContent') {
      const evidence = snapshotFor(20, 0).executionEvidence.find(item => item.id === params?.evidenceId)
      if (evidence) return { payload: evidence.payload }
    }
    throw new Error(`Unexpected fixture API: ${method}`)
  }
} })

function Fixture(): React.JSX.Element {
  const [count, setCount] = useState(12)
  const [revision, setRevision] = useState(0)
  const [open, setOpen] = useState(true)
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>('inspector')
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  const [theme, setTheme] = useState('day')
  const snapshot = snapshotFor(count, revision)
  return <div className="app-shell app-shell-camp">
    <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)', color: 'var(--rail-ink)' }}>
      <strong>Rovai AI · 隔离验收</strong>
      <p style={{ fontSize: 12, lineHeight: 1.7 }}>真实生产组件，模拟队员数据。<br />不调用模型，不访问日常 Camp。</p>
      <div style={{ display: 'grid', gap: 8 }}>
        {[0, 1, 8, 12, 20].map(value => <button key={value} className="quiet-button" data-count={value} onClick={() => setCount(value)}>{value} 位队员</button>)}
        <button className="quiet-button" data-refresh onClick={() => setRevision(value => value + 1)}>模拟状态刷新</button>
        <button className="quiet-button" data-theme-toggle onClick={() => {
          const next = theme === 'day' ? 'night' : 'day'
          document.documentElement.dataset.theme = next
          setTheme(next)
        }}>{theme === 'day' ? '切换夜间主题' : '切换日间主题'}</button>
      </div>
    </aside>
    <AppHeader campTitle={snapshot.camp.title} contextLabel="隔离验收" camp={snapshot} detailEntryHostRef={setEntryHost} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <CampWorkspace snapshot={snapshot} projectName="隔离验收" agents={agents.slice(0, count)} busy={false} stopping={false}
        onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}} onResolveApproval={() => {}}
        onStop={() => {}} worldMapEnabled={false} inspectorVisible={open} detailEntryHost={entryHost}
        executionPlacement={placement} onExecutionPlacementChange={async value => { setPlacement(value); return value }}
        onOpenInspector={() => setOpen(true)} onCloseInspector={() => setOpen(false)} />
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
