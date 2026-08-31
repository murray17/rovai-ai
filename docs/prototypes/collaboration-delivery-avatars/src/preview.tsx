import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, AgentRunView, CampComposerDraftView, CampSnapshot, ExecutionConsolePlacement, MessageDeliveryView } from '@contracts'
import { AppHeader } from '../../../../apps/desktop/src/renderer/src/App'
import { CampWorkspace } from '../../../../apps/desktop/src/renderer/src/CampWorkspace'
import avatarData from 'virtual:recipient-preview-avatars'
import '../../../../apps/desktop/src/renderer/src/styles.css'
import './preview.css'

const campId = 'rvcamp_01m1bmqmkxevsakm70j6kwjhmb'
const now = '2026-08-31T10:16:00Z'
const sourceRunId = 'preview-alice-01'
const assets = {
  alice: 'rovai://member-avatar/managed/bca81c54-087f-4fa5-937f-bcfd76ab6f49',
  kyoko: 'rovai://member-avatar/managed/3465d69b-78ed-471b-b52b-2e0c825e6ad0',
  megumi: 'rovai://member-avatar/managed/c586920f-f037-432a-8e39-12d452eb4292'
}
const people: Array<[string, string, string | null, string]> = [
  ['agent_6', '爱丽丝', assets.alice, '协调'],
  ['agent_7', '雾切响子', assets.kyoko, '开发'],
  ['agent_8', '药师寺惠', assets.megumi, '测试'],
  ['preview-luoke', '洛可', 'rovai://member-avatar/builtin/luoke/v1', '架构'],
  ['preview-muwa', '沐瓦', 'rovai://member-avatar/builtin/muwa/v1', '开发'],
  ['preview-mianzhi', '绵栀', 'rovai://member-avatar/builtin/mianzhi/v1', '设计'],
  ['preview-qilu', '奇鹿', 'rovai://member-avatar/builtin/qilu/v1', '分析'],
  ['preview-yanchuan', '言川', null, '评审'],
  ['preview-yumo', '予墨', null, '研究'],
  ['preview-zhixia', '知夏', null, '测试'],
  ['preview-shiyu', '时屿', null, '开发'],
  ['preview-xinglan', '星澜', null, '测试'],
  ['preview-anhe', '安禾', null, '评审'],
  ['preview-yunshu', '云舒', null, '文档'],
  ['preview-sen', '森', null, '开发'],
  ['preview-qing', '清和', null, '评审'],
  ['preview-long', '远山 · 负责跨项目回归验收的长名称队员', null, '测试']
]
const agents: AgentProfile[] = people.map(([agentId, displayName, avatarRef, teamRole], index) => ({
  agentId, displayName, avatarRef, teamRole, accent: '', professionalResponsibilities: '', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: 'claude-code-cli', model: { mode: 'default', options: {} },
    permissions: { adapterKind: 'claude-code-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: index, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
}))

function snapshotFor(recipientCount: number): CampSnapshot {
  const profiles = agents.slice(0, Math.max(3, recipientCount + 1))
  const runs: AgentRunView[] = profiles.slice(0, 3).map((agent, index) => ({
    id: index === 0 ? sourceRunId : `preview-run-${agent.agentId}`, campTurnId: 'preview-turn',
    conversationId: `preview-conversation-${agent.agentId}`, agentId: agent.agentId, taskId: null,
    responsibilityKey: `preview:${agent.agentId}`, responsibilityGeneration: 0, purpose: '需求实现与测试协作',
    completionRole: 'required', status: index === 0 ? 'running' : 'waiting', waitReason: index === 0 ? null : 'dependency',
    cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null,
    terminalResolutionSource: null, terminalReasonCode: null, failure: null,
    runtimeModel: { modelId: 'claude-opus-4-6' }, executionEpoch: 1, permissionSemantics: 'runtime_managed_v2',
    invocationKind: index === 0 ? 'direct' : 'a2a', triggerDeliveryGeneration: 0,
    a2aParentAgentRunId: index === 0 ? null : sourceRunId, a2aRootAgentRunId: sourceRunId, a2aDepth: index === 0 ? 0 : 1,
    executionEvidenceCount: 3, hasUnsettledExternalEffects: false, workspace: { path: '/example/workspace' },
    startingGitObservation: null, endingGitObservation: null, version: 1,
    createdAt: index === 0 ? '2026-08-31T10:09:42Z' : '2026-08-31T10:11:46Z',
    startedAt: index === 0 ? '2026-08-31T10:09:42Z' : '2026-08-31T10:11:46Z', endedAt: null, updatedAt: now
  }))
  const recipients = profiles.slice(1, recipientCount + 1)
  // Multiple sends to the same recipient deliberately exercise identity deduplication.
  const deliveries = recipients.flatMap((recipient, index) => [0, 1, 2].map(attempt => ({
    id: `preview-delivery-${index}-${attempt}`, messageId: `preview-message-${index}-${attempt}`,
    campTurnId: 'preview-turn', taskId: null, recipientAgentId: recipient.agentId,
    recipientMembershipVersionAtAdmission: 1, deliveryKind: 'public_a2a', dispatchDisposition: 'dispatch',
    completionRole: 'required', gatherId: null, gatherDispatchDeliveryId: null,
    recipientCanonicalPosition: index, edgeKind: 'forward', targetParentAgentRunId: sourceRunId,
    returnToAgentRunId: null, status: 'pending', dispatchPhase: 'waiting', waitCondition: 'target_busy',
    dispatchAttemptCount: 1, retryGeneration: 0, contextManifestId: null, targetAgentRunId: null,
    manualInterventionRequired: false, failureCode: null, version: 1, createdAt: now, updatedAt: now, endedAt: null,
    prototypeSourceRunId: sourceRunId
  }))) as Array<MessageDeliveryView & { prototypeSourceRunId: string }>
  const message = (id: string, sequence: number, authorId: string, body: string, authorType: 'user' | 'agent') => ({
    id, sequence, timelineGlobalSequence: sequence, authorType, authorId,
    sourceAgentRunId: authorType === 'agent' ? sourceRunId : null, body,
    content: [{ kind: 'text' as const, text: body }], addressMode: 'default' as const, attachments: [],
    addressedAgentIds: [], replyToCampMessageId: null, campTurnId: 'preview-turn', presentation: null, createdAt: now
  })
  return {
    schemaVersion: 34, throughGlobalSequence: 3,
    camp: { id: campId, title: '需求实现与测试协作', activationState: 'active', projectBindingKind: 'directory',
      projectPath: '/example/workspace', defaultLeadAgentId: 'agent_6', membershipGeneration: 1,
      version: 1, createdAt: now, updatedAt: now },
    members: profiles.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName,
      avatarRef: agent.avatarRef, teamRole: agent.teamRole, accent: '', membershipStatus: 'active',
      leaveRequestedAt: null, profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
    membershipReconciliations: [], tasks: [],
    messages: [
      message('preview-user-message', 1, 'local-user', '看一下这个需求，然后让响子编码，惠测试。', 'user'),
      message('preview-alice-message', 2, 'agent_6', '我会先梳理需求与验收范围，再分别交给响子实现、惠测试。\n\n两边的结果汇总后，我会统一检查需求覆盖与待确认项。', 'agent'),
      message('preview-update', 3, 'agent_6', '需求已拆分。实现与测试将围绕同一份验收清单推进。', 'agent')
    ],
    messageDeliveries: deliveries, turns: [], agentRuns: runs,
    executionEvidence: runs.flatMap<CampSnapshot['executionEvidence'][number]>(run => [
      { id: `narration-${run.id}`, agentRunId: run.id, executionEpoch: 1, sequence: 1,
        eventType: 'agent.text.delta', kind: 'narration', phase: 'updated',
        payload: { itemId: `narration-${run.id}`, delta: run.agentId === 'agent_6'
          ? '已整理需求边界和验收条件，正在协调实现与测试。后续结果会在同一会话中汇总。'
          : '已接收协作安排，正在检查对应的工作范围。' },
        contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now },
      ...['git status --short', 'rg -n "acceptance" docs/requirements.md'].map((command, index) => ({
        id: `command-${run.id}-${index}`, agentRunId: run.id, executionEpoch: 1, sequence: index + 2,
        eventType: 'activity.completed', kind: 'command' as const, phase: 'completed',
        payload: { item: { id: `shell-${run.id}-${index}`, type: 'commandExecution', command,
          status: 'completed', aggregatedOutput: index === 0 ? '工作区状态已读取。' : '已定位需求中的验收条件。' } },
        canonical: { operationId: `shell-${run.id}-${index}`, classifierVersion: 'activity-v2',
          activityDomain: 'shell', semanticKind: 'shell.execute', toolName: null, presentationHint: '执行 Shell 命令',
          phase: 'terminal', outcome: 'succeeded', credibility: 'runtime_structured', coverageLevel: 'fine_grained',
          sourceAuthority: 'runtime', sourceEvidenceIds: [`command-${run.id}-${index}`],
          firstEvidenceSequence: index + 2, lastEvidenceSequence: index + 2, revision: 1 },
        contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now
      }))
    ]),
    agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
  }
}

let draft: CampComposerDraftView = { campId, body: '', content: [], revision: 1, attachments: [],
  replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  memberAvatars: { read: async (ref: string) => {
    const data = avatarData[ref]
    return data ? { bytes: Array.from(Uint8Array.from(atob(data), character => character.charCodeAt(0))), mediaType: 'image/png', width: 192, height: 192 } : null
  } },
  request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.composerDraft.get') return draft
    if (method === 'camp.composerDraft.save') { draft = { ...draft, ...params, revision: draft.revision + 1 }; return draft }
    if (method === 'camp.pendingInputs.get') return { campId, revision: 1, items: [], editing: null }
    if (method === 'agentRunEvidence.getContent') {
      const evidence = snapshotFor(16).executionEvidence.find(item => item.id === params?.evidenceId)
      if (evidence) return { payload: evidence.payload }
    }
    throw new Error('设计稿未连接真实服务。')
  }
} })

function Preview(): React.JSX.Element {
  const appRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(2)
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>('bottom')
  const [open, setOpen] = useState(false)
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  const [theme, setTheme] = useState('day')
  const [notice, setNotice] = useState('')
  const snapshot = useMemo(() => snapshotFor(count), [count])
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 2600)
    return () => clearTimeout(timer)
  }, [notice])
  const move = (next: ExecutionConsolePlacement): void => { setPlacement(next); setOpen(next === 'inspector') }
  const requestPlacement = (next: ExecutionConsolePlacement): void => {
    // Use the existing UI transition so its active detail tab and reading position move together.
    if (next !== placement) {
      appRef.current?.querySelector<HTMLButtonElement>(`.run-pulse-${placement} .execution-placement-button`)?.click()
    } else if (next === 'inspector') {
      const trigger = appRef.current?.querySelector<HTMLButtonElement>('button[data-detail="execution"]')
      if (trigger?.getAttribute('aria-expanded') !== 'true') trigger?.click()
    }
  }
  const explain = (): void => setNotice('这是交互设计稿，不会发送消息、停止执行或修改真实数据。')
  return <div className="prototype-page">
    <header className="prototype-toolbar" onPointerDown={event => event.stopPropagation()} onFocus={event => event.stopPropagation()}>
      <div className="prototype-title"><strong>协作投递</strong><span>单行头像设计稿</span></div>
      <div className="prototype-controls">
        <div className="prototype-segment" role="group" aria-label="设计稿承载位置">
          <button type="button" aria-pressed={placement === 'bottom'} onClick={() => requestPlacement('bottom')}>底部执行台</button>
          <button type="button" aria-pressed={placement === 'inspector'} onClick={() => requestPlacement('inspector')}>执行浮层</button>
        </div>
        <label className="prototype-scenario"><span>投递对象</span><select aria-label="投递对象数量" value={count} onChange={event => { setCount(Number(event.target.value)); if (placement === 'inspector') setOpen(true) }}>
          <option value={2}>2 位 · 当前示例</option><option value={16}>16 位 · 溢出验证</option><option value={1}>1 位 · 单一对象</option><option value={0}>0 位 · 无协作投递</option>
        </select></label>
        <button className="prototype-theme" type="button" onClick={() => {
          const next = theme === 'day' ? 'night' : 'day'; document.documentElement.dataset.theme = next; setTheme(next)
        }}>{theme === 'day' ? '切换 Steel Night' : '切换 Porcelain Day'}</button>
      </div>
    </header>
    <div className="prototype-app-frame" ref={appRef}>
      <div className="app-shell app-shell-camp">
        <aside className="prototype-rail" aria-label="示例导航">
          <div className="prototype-rail-brand"><span>Rovai AI</span></div>
          <div className="prototype-rail-entries"><span>快速对话</span><span>队员</span><span>记忆</span></div>
          <div className="prototype-rail-section">工作目录</div>
          <div className="prototype-project"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h4l2 2h6v7H2z" /></svg>示例项目</div>
          <div className="prototype-selected-camp">需求实现与测试协作</div>
          <div className="prototype-rail-note">本地设计预览<br />消息、运行与多人名单为演示数据。</div>
        </aside>
        <AppHeader campTitle={snapshot.camp.title} contextLabel="示例项目" camp={snapshot} detailEntryHostRef={setEntryHost} onFocusApprovals={explain} />
        <main className="content task-content">
          <CampWorkspace snapshot={snapshot} projectName="示例项目" agents={agents.slice(0, snapshot.members.length)}
            busy={false} stopping={false} onSend={async () => explain()} onChangeLead={async () => explain()}
            onTasksChanged={async () => {}} onResolveApproval={explain} onStop={explain} onCancelAgentRun={async () => explain()}
            worldMapEnabled={false} inspectorVisible={open} detailEntryHost={entryHost}
            executionPlacement={placement} onExecutionPlacementChange={async value => { move(value); return value }}
            onOpenInspector={() => setOpen(true)} onCloseInspector={() => setOpen(false)} onNotify={setNotice} />
        </main>
      </div>
    </div>
    <footer className="prototype-footnote">
      <p><strong>仅收件人行改变。</strong> 头像 24px，单行不换行；重复投递合并为一位，超出空间显示 <strong>+N</strong>。</p>
      <p>悬停 / 聚焦查看姓名 · 点击 +N 查看其余队员 · 执行台、浮层、主题与过程内容复用现有组件</p>
    </footer>
    {notice && <div className="prototype-notice" role="status">{notice}</div>}
  </div>
}
createRoot(document.getElementById('root')!).render(<Preview />)
