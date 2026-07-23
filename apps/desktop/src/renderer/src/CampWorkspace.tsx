import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AgentProfile,
  CampCreationPreflight,
  CampSnapshot,
  CampTaskStatus,
  CampTaskView,
  SelectedProjectBinding,
  StoredCommandResult
} from '@contracts'
import { EmptyInline } from './ui-elements'
import {
  AgentMentionTextarea,
  resolveMentionedAgentIds,
  type AgentMentionCandidate
} from './AgentMentionTextarea'
import {
  agentRunPresentation,
  agentRunWaitDetail,
  formatByteSize,
  inboxMessagePresentation
} from './ui-model'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])

export function readyCampMentionCandidates(
  members: CampSnapshot['members'],
  agents: AgentProfile[]
): AgentMentionCandidate[] {
  const profileById = new Map(agents.map((agent) => [agent.id, agent]))
  return members
    .filter((member) => member.membershipStatus === 'active')
    .filter((member) => profileById.get(member.agentProfileId)?.runtimeReadiness.status === 'ready')
    .map((member) => ({
      agentProfileId: member.agentProfileId,
      handle: member.handle,
      displayName: member.displayName
    }))
}

export function NewConversationWorkspace({
  project,
  preflight,
  busy,
  onOpenMembers,
  onSend
}: {
  project: SelectedProjectBinding | null
  preflight: CampCreationPreflight
  busy: boolean
  onOpenMembers(): void
  onSend(text: string, agentProfileIds: string[]): Promise<void>
}): JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const defaultLead = preflight.readyMembers[0] ?? null
  const mentionCandidates = useMemo(
    () => preflight.readyMembers.map((member) => ({
      agentProfileId: member.agentProfileId,
      handle: member.handle,
      displayName: member.displayName
    })),
    [preflight.readyMembers]
  )
  const mentionedAgentIds = useMemo(
    () => resolveMentionedAgentIds(message, mentionCandidates),
    [mentionCandidates, message]
  )
  const addressedNames = mentionedAgentIds.map((id) =>
    mentionCandidates.find((candidate) => candidate.agentProfileId === id)?.displayName ?? id
  )
  const starterPrompts = project
    ? [
        '先了解这个项目，再告诉我建议从哪里开始。',
        '帮我定位一个问题，并给出清晰的处理方案。',
        '检查当前代码，指出最值得优先处理的风险。'
      ]
    : [
        '介绍一下你自己，以及你能怎样帮助我。',
        '帮我把一个还很模糊的想法梳理清楚。',
        '我们随便聊聊，测试一下现在的对话体验。'
      ]

  useEffect(() => {
    if (!busy && preflight.admissible) textareaRef.current?.focus()
  }, [busy, preflight.admissible])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!message.trim() || busy || !preflight.admissible) return
    try {
      await onSend(message, mentionedAgentIds)
      setMessage('')
    } catch {
      textareaRef.current?.focus()
    }
  }

  return (
    <section className={`workspace-shell new-conversation-workspace ${project ? 'project-draft' : 'lobby-draft'}`} aria-label="新对话草稿">
      <div className="workspace-heading new-conversation-heading">
        <div className="agent-identity">
          <span className="muwa-avatar">{defaultLead?.displayName.slice(0, 1) ?? '伴'}</span>
          <div><p className="eyebrow">{project ? 'PROJECT · NEW CONVERSATION' : 'LOBBY · CASUAL CHAT'}</p><strong>{project?.name ?? '大厅'}</strong></div>
        </div>
        {project && <div className="workspace-meta"><span className="workspace-summary clean">Git 项目上下文</span></div>}
      </div>

      <div className="workspace-state state-draft" role="status" aria-live="polite">
        <span className="draft-status"><i aria-hidden="true" />尚未保存</span>
        <div className="workspace-state-copy">
          <strong>{busy ? '正在开始对话' : '发送第一条消息后保存对话'}</strong>
          <span>{busy ? '正在确认成员与 Runtime 状态…' : '没有发送消息，就不会留下空对话。'}</span>
        </div>
        <dl className="workspace-facts">
          <div><dt>接收成员</dt><dd>{addressedNames.length > 0 ? addressedNames.join('、') : defaultLead?.displayName ?? '暂无可用成员'}</dd></div>
          <div><dt>上下文</dt><dd title={project?.projectPath}>{project ? project.name : '仅大厅'}</dd></div>
        </dl>
      </div>

      <div className="new-conversation-main">
        <div className="new-conversation-stage">
          <span className="new-conversation-avatar" aria-hidden="true">{defaultLead?.displayName.slice(0, 1) ?? '伴'}</span>
          <p className="eyebrow">{project ? 'PROJECT CONTEXT' : 'OPEN CONVERSATION'}</p>
          <h2>{addressedNames.length > 0
            ? `让 ${addressedNames.join('、')} 一起参与`
            : defaultLead
              ? `和 ${defaultLead.displayName} 开始一段对话`
              : '先让一位队友就绪'}</h2>
          <p>{project
            ? `这段对话会使用 ${project.name} 的项目上下文。`
            : '聊聊想法、问个问题，或测试队友的回答。大厅不会读取任何项目文件。'}</p>

          {!preflight.admissible ? (
            <div className="new-conversation-blocked" role="alert">
              <div><strong>还没有可用的队友</strong><span>{preflight.blockers[0]?.detail ?? '请先为至少一位活跃成员配置可用 Runtime。'}</span></div>
              <button className="quiet-button" type="button" onClick={onOpenMembers}>配置成员</button>
            </div>
          ) : (
            <div className="new-conversation-ready" aria-label="当前接收成员">
              <i aria-hidden="true" />
              <span><strong>{addressedNames.length > 0 ? `${addressedNames.join('、')} 已选择` : `${defaultLead?.displayName} 已就绪`}</strong><small>{addressedNames.length > 0 ? '将分别创建独立 AgentRun' : '将接收你的第一条消息'}</small></span>
            </div>
          )}

          {preflight.admissible && (
            <div className="new-conversation-suggestions" aria-label="消息建议">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setMessage(prompt)
                    requestAnimationFrame(() => textareaRef.current?.focus())
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <form className="composer new-conversation-composer" onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <div className="new-conversation-composer-inner">
          <div className="composer-input">
            <AgentMentionTextarea
              id="new-camp-message"
              value={message}
              onChange={setMessage}
              candidates={mentionCandidates}
              defaultRecipientName={defaultLead?.displayName ?? '队友'}
              placeholder={project ? `描述你想在 ${project.name} 中完成的事情…` : '聊聊想法、问个问题，或打个招呼…'}
              rows={3}
              disabled={busy || !preflight.admissible}
              textareaRef={textareaRef}
            />
          </div>
          <div className="composer-actions">
            <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
            <button className="primary-button" type="submit" disabled={!message.trim() || busy || !preflight.admissible}>{busy ? '正在开始…' : '发送'}</button>
          </div>
        </div>
      </form>
    </section>
  )
}

export function CampWorkspace({
  snapshot,
  projectName,
  agents,
  busy,
  onSend,
  onChangeLead,
  onTasksChanged,
  onResolveApproval
}: {
  snapshot: CampSnapshot
  projectName: string | null
  agents: AgentProfile[]
  busy: boolean
  onSend(text: string, agentProfileIds: string[]): Promise<void>
  onChangeLead(agentProfileId: string): Promise<void>
  onTasksChanged(): Promise<void>
  onResolveApproval(approval: ActionApprovalView, decision: 'approve' | 'deny'): void
}): JSX.Element {
  const [message, setMessage] = useState('')
  const [inspectorTab, setInspectorTab] = useState('activity')
  const memberById = useMemo(
    () => new Map(snapshot.members.map((member) => [member.agentProfileId, member])),
    [snapshot.members]
  )
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  )
  const mentionCandidates = useMemo(
    () => readyCampMentionCandidates(snapshot.members, agents),
    [agents, snapshot.members]
  )
  const runById = useMemo(
    () => new Map(snapshot.agentRuns.map((run) => [run.id, run])),
    [snapshot.agentRuns]
  )
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
  const defaultLeadProfile = defaultLead ? profileById.get(defaultLead.agentProfileId) ?? null : null
  const defaultLeadReady = defaultLeadProfile?.runtimeReadiness.status === 'ready'
  const activeRuns = snapshot.agentRuns.filter((run) => NON_TERMINAL_RUNS.has(run.status))
  const contextWaitingRuns = activeRuns.filter((run) =>
    ['context_compaction', 'context_overloaded', 'delivery_unknown', 'runtime_recovery'].includes(run.waitReason ?? '')
  )
  const primaryContextWait = contextWaitingRuns[0] ?? null
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === 'pending')

  useEffect(() => {
    if (pendingApprovals.length > 0) setInspectorTab('approvals')
  }, [pendingApprovals.length])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!message.trim() || busy) return
    await onSend(message, resolveMentionedAgentIds(message, mentionCandidates))
    setMessage('')
  }

  return (
    <section className="workspace-shell camp-workspace" aria-label={`Camp：${snapshot.camp.title}`}>
      <div className="workspace-heading">
        <div className="agent-identity">
          <span className="muwa-avatar">{defaultLead?.displayName.slice(0, 1) ?? '伴'}</span>
          <div><p className="eyebrow">CAMP · SHARED CONTEXT</p><strong>{projectName ?? '大厅'}</strong></div>
        </div>
        <div className="workspace-meta">
          <span className={`workspace-summary ${snapshot.camp.repositoryScopeId ? 'clean' : 'neutral'}`}>{snapshot.camp.repositoryScopeId ? 'Git 项目' : '大厅'}</span>
          <details className="lead-picker">
            <summary className={`workspace-summary ${defaultLeadReady ? 'neutral' : 'attention'}`} aria-label="调整 Default Lead">Lead · {defaultLead?.displayName ?? '未设置'} <span aria-hidden="true">⌄</span></summary>
            <div className="lead-picker-popup" role="menu" aria-label="选择 Default Lead">
              {snapshot.members.filter((member) => member.membershipStatus === 'active').map((member) => {
                const profile = profileById.get(member.agentProfileId)
                const ready = profile?.runtimeReadiness.status === 'ready'
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={member.isDefaultLead}
                    key={member.agentProfileId}
                    disabled={busy || member.isDefaultLead}
                    onClick={(event) => {
                      event.currentTarget.closest('details')?.removeAttribute('open')
                      void onChangeLead(member.agentProfileId).catch(() => undefined)
                    }}
                  >
                    <span><strong>{member.displayName}</strong><small>{ready ? 'Runtime Ready' : 'Runtime 未就绪'}</small></span>{member.isDefaultLead && <b>✓</b>}
                  </button>
                )
              })}
            </div>
          </details>
        </div>
      </div>

      {defaultLead && !defaultLeadReady && <div className="lead-readiness-warning" role="status"><strong>{defaultLead.displayName} 当前 Runtime 未就绪</strong><span>Lead 身份已保存，但默认执行会被 Core 阻止；可在成员页完成配置，或在这里更换 Lead。</span></div>}

      <div className={`workspace-state ${primaryContextWait ? 'state-attention' : activeRuns.length ? 'state-running' : 'state-completed'}`} role="status" aria-live="polite">
        <span className={primaryContextWait ? 'context-wait-mark' : activeRuns.length ? 'runtime-loading-mark' : 'draft-status'}><i aria-hidden="true" />{primaryContextWait ? agentRunPresentation(primaryContextWait).label : activeRuns.length ? '执行中' : '已就绪'}</span>
        <div className="workspace-state-copy"><strong>{snapshot.camp.title}</strong><span>{primaryContextWait ? agentRunWaitDetail(primaryContextWait.waitReason) : activeRuns.length ? `${activeRuns.length} 个 AgentRun 正在运行或等待。` : '公共上下文已保存，可以继续向 Default Lead 提问。'}</span></div>
        <dl className="workspace-facts"><div><dt>成员</dt><dd>{snapshot.members.filter((member) => member.membershipStatus === 'active').length}</dd></div><div><dt>消息</dt><dd>{snapshot.messages.length}</dd></div></dl>
      </div>

      <div className="workspace-grid">
        <section className="timeline-pane">
          <div className="pane-title"><div><p className="eyebrow">PUBLIC CONTEXT</p><h2>公共讨论</h2></div></div>
          <div className="timeline-scroll camp-timeline">
            {snapshot.messages.map((campMessage) => {
              const member = memberById.get(campMessage.authorId)
              const author = campMessage.authorType === 'user' ? '你' : member?.displayName ?? (campMessage.authorType === 'system' ? '系统' : campMessage.authorId)
              return (
                <article className={`conversation-bubble ${campMessage.authorType}`} key={campMessage.id}>
                  <div className="bubble-meta"><span className="message-author"><i aria-hidden="true">{author.slice(0, 1)}</i><strong>{author}</strong></span><time>#{campMessage.sequence}</time></div>
                  <p>{campMessage.body}</p>
                </article>
              )
            })}
            {snapshot.messages.length === 0 && <EmptyInline text="这段 Camp 还没有公共消息。" />}
            {activeRuns.map((run) => (
              <div className={`working-row ${run.status === 'waiting' ? 'waiting' : ''}`} key={run.id}><i aria-hidden="true" /><div><strong>{memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId} · {agentRunPresentation(run).label}</strong><span>{agentRunWaitDetail(run.waitReason) ?? run.purpose}</span></div></div>
            ))}
          </div>
        </section>

        <aside className="activity-pane" aria-label="Camp 检查器">
          <Tabs.Root value={inspectorTab} onValueChange={setInspectorTab} activationMode="manual" className="activity-tabs">
            <Tabs.List className="tabs-list sticky-tabs" aria-label="Camp 详情">
              <Tabs.Trigger value="activity">活动 <small>{snapshot.agentRuns.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="tasks">Task <small>{snapshot.tasks.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="context">上下文 <small>{snapshot.contextManifests.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="approvals">审批 {pendingApprovals.length > 0 && <b>{pendingApprovals.length}</b>}</Tabs.Trigger>
              <Tabs.Trigger value="audit">审计 <small>{snapshot.timeline.length}</small></Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="activity" className="tab-scroll activity-list">
              {snapshot.inboxMessages.length > 0 && <div className="inspector-section-label"><span>Agent 协作</span><small>{snapshot.inboxMessages.length} 条定向请求</small></div>}
              {snapshot.inboxMessages.slice().reverse().map((inboxMessage) => {
                const targetRun = inboxMessage.targetAgentRunId ? runById.get(inboxMessage.targetAgentRunId) ?? null : null
                const status = inboxMessagePresentation(inboxMessage, targetRun?.status ?? null)
                const sender = memberById.get(inboxMessage.senderAgentId)?.displayName ?? inboxMessage.senderAgentId
                const recipient = memberById.get(inboxMessage.recipientAgentId)?.displayName ?? inboxMessage.recipientAgentId
                return (
                  <article className="activity-row a2a-row" key={inboxMessage.id}>
                    <span className="activity-icon" aria-hidden="true">A2A</span>
                    <div className="activity-body">
                      <div className="activity-row-title"><strong>{sender} → {recipient}</strong><span className={`activity-status tone-${status.tone}`}>{status.label}</span></div>
                      <p className="activity-detail">{inboxMessage.body}</p>
                      <dl className="activity-facts">
                        <div><dt>Correlation</dt><dd><code title={inboxMessage.correlationId}>{shortIdentity(inboxMessage.correlationId)}</code></dd></div>
                        {targetRun && <div><dt>深度</dt><dd>{targetRun.a2aDepth}</dd></div>}
                        {inboxMessage.inReplyToMessageId && <div><dt>回复</dt><dd><code title={inboxMessage.inReplyToMessageId}>{shortIdentity(inboxMessage.inReplyToMessageId)}</code></dd></div>}
                      </dl>
                      {inboxMessage.lastError && <p className="inline-status-error">{inboxMessage.lastError}</p>}
                    </div>
                  </article>
                )
              })}
              {snapshot.inboxMessages.length > 0 && <div className="inspector-section-label"><span>执行记录</span><small>{snapshot.agentRuns.length} 个 AgentRun</small></div>}
              {snapshot.agentRuns.slice().reverse().map((run) => (
                <article className="activity-row" key={run.id}>
                  <span className="activity-icon" aria-hidden="true">{run.invocationKind === 'a2a' ? '↗' : NON_TERMINAL_RUNS.has(run.status) ? '●' : '✓'}</span>
                  <div className="activity-body"><div className="activity-row-title"><strong>{memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId}</strong><span className={`activity-status tone-${agentRunPresentation(run).tone}`}>{agentRunPresentation(run).label}</span></div><p className="activity-detail">{agentRunWaitDetail(run.waitReason) ?? run.purpose}</p>{run.invocationKind === 'a2a' && <dl className="activity-facts"><div><dt>A2A 深度</dt><dd>{run.a2aDepth}</dd></div>{run.sourceInboxMessageId && <div><dt>请求</dt><dd><code title={run.sourceInboxMessageId}>{shortIdentity(run.sourceInboxMessageId)}</code></dd></div>}</dl>}</div>
                </article>
              ))}
              {snapshot.agentRuns.length === 0 && <EmptyInline text="执行请求会在这里形成独立 AgentRun。" />}
            </Tabs.Content>
            <Tabs.Content value="tasks" className="tab-scroll task-panel-scroll">
              <TaskPanel
                snapshot={snapshot}
                busy={busy}
                onTasksChanged={onTasksChanged}
              />
            </Tabs.Content>
            <Tabs.Content value="context" className="tab-scroll context-panel">
              {snapshot.contextManifests.map((manifest) => {
                const run = runById.get(manifest.agentRunId) ?? null
                const deliveryStatus = manifest.delivery?.status === 'accepted'
                  ? { label: '已接收', tone: 'success' as const }
                  : manifest.delivery?.status === 'delivery_unknown'
                    ? { label: '待确认', tone: 'danger' as const }
                    : manifest.delivery
                      ? { label: '准备中', tone: 'attention' as const }
                      : { label: '未投递', tone: 'neutral' as const }
                return (
                  <article className="context-card" key={manifest.id}>
                    <div className="context-card-heading">
                      <div><strong>{run ? memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId : 'AgentRun'}</strong><code title={manifest.agentRunId}>{shortIdentity(manifest.agentRunId)}</code></div>
                      <span className={`activity-status tone-${deliveryStatus.tone}`}>{deliveryStatus.label}</span>
                    </div>
                    <dl className="context-facts">
                      <div><dt>组装路径</dt><dd>{manifest.contextMode === 'bootstrap' ? 'Session 重建 / Bootstrap' : '未读公共增量'}</dd></div>
                      <div><dt>公共边界</dt><dd>seq {manifest.campMessageBoundarySequence}</dd></div>
                      <div><dt>原文消息</dt><dd>{manifest.rawMessageCount} 条</dd></div>
                      <div><dt>Binding</dt><dd>Generation {manifest.nativeBindingGeneration}</dd></div>
                      <div><dt>Formatter</dt><dd>v{manifest.formatterVersion}</dd></div>
                    </dl>

                    {manifest.summaries.length > 0 && (
                      <div className="context-subsection">
                        <strong>条件摘要</strong>
                        {manifest.summaries.map((summary) => <div className="context-summary-row" key={summary.id}><span>{summary.summaryKind === 'bootstrap' ? '冷启动' : '较早未读'}</span><code>seq {summary.fromCampMessageSequence}–{summary.throughCampMessageSequence}</code><small>{summary.generatorAdapterKind} · {modelName(summary.generatorModel)}</small></div>)}
                      </div>
                    )}

                    {manifest.attachments.length > 0 && (
                      <div className="context-subsection">
                        <div className="context-subsection-title"><strong>附件</strong><small>仅注入元数据</small></div>
                        {manifest.attachments.map((attachment) => <div className="context-attachment" key={attachment.attachmentId}><div><strong>{attachment.name}</strong><small>{attachment.mediaType} · {formatByteSize(attachment.byteSize)}</small></div><code title={attachment.locationRef}>{attachment.locationRef}</code></div>)}
                      </div>
                    )}

                    <details className="context-digests">
                      <summary>完整性与版本</summary>
                      <dl><div><dt>Payload</dt><dd><code>{manifest.renderedPayloadDigest}</code></dd></div><div><dt>Charter</dt><dd><code>{manifest.charterDigest}</code></dd></div><div><dt>成员状态</dt><dd><code>{manifest.memberStateDigest}</code></dd></div><div><dt>Work Brief</dt><dd><code>{manifest.workBriefDigest}</code></dd></div></dl>
                    </details>
                    {manifest.delivery?.lastError && <p className="context-alert">{manifest.delivery.lastError}</p>}
                  </article>
                )
              })}

              {snapshot.contextCompactions.length > 0 && (
                <section className="compaction-history" aria-label="条件压缩记录">
                  <div className="inspector-section-label"><span>条件压缩记录</span><small>仅超出预算时产生</small></div>
                  {snapshot.contextCompactions.map((attempt) => <div className="compaction-row" key={attempt.id}><span className={`activity-status tone-${attempt.status === 'succeeded' ? 'success' : attempt.status === 'failed' ? 'danger' : 'attention'}`}>{attempt.status === 'succeeded' ? '已完成' : attempt.status === 'failed' ? '失败' : '处理中'}</span><div><strong>{attempt.summaryKind === 'bootstrap' ? '冷启动摘要' : '较早未读摘要'}</strong><code>seq {attempt.fromCampMessageSequence}–{attempt.throughCampMessageSequence}</code>{attempt.errorCode && <small>{attempt.errorCode}</small>}</div></div>)}
                </section>
              )}
              {snapshot.contextManifests.length === 0 && snapshot.contextCompactions.length === 0 && <EmptyInline text="AgentRun 首次调度后，冻结的上下文清单会出现在这里。" />}
            </Tabs.Content>
            <Tabs.Content value="approvals" className="tab-scroll approvals-panel">
              {pendingApprovals.map((approval) => (
                <article className="approval-card pending" key={approval.id}>
                  <div className="approval-heading"><span className="approval-status status-pending">等待决定</span></div>
                  <h3>{approval.actionSummary}</h3>
                  <pre>{JSON.stringify(approval.canonicalInput, null, 2)}</pre>
                  <div className="approval-actions"><button className="safe-button" type="button" onClick={() => onResolveApproval(approval, 'deny')} disabled={busy}>拒绝</button><button className="approve-button" type="button" onClick={() => onResolveApproval(approval, 'approve')} disabled={busy}>批准这一次</button></div>
                </article>
              ))}
              {pendingApprovals.length === 0 && <EmptyInline text="当前没有待处理审批。" />}
            </Tabs.Content>
            <Tabs.Content value="audit" className="tab-scroll audit-list">
              {snapshot.timeline.slice().reverse().map((event) => <article className="audit-row" key={event.globalSequence}><div><strong>{event.eventType}</strong><time>#{event.globalSequence}</time></div></article>)}
              {snapshot.timeline.length === 0 && <EmptyInline text="领域事件会出现在这里。" />}
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>

      <form className="composer" onSubmit={(event) => void submit(event)}>
        <div className="composer-input">
          <AgentMentionTextarea
            id="camp-message"
            value={message}
            onChange={setMessage}
            candidates={mentionCandidates}
            defaultRecipientName={defaultLead?.displayName ?? 'Default Lead'}
            placeholder="继续提问、补充约束或交付下一项职责…"
            rows={2}
            disabled={busy || !defaultLead}
          />
        </div>
        <div className="composer-actions"><span className="composer-hint">Enter 发送 · Shift + Enter 换行</span><button className="primary-button" type="submit" disabled={!message.trim() || busy || !defaultLead}>{busy ? '发送中…' : '发送'}</button></div>
      </form>
    </section>
  )
}

export function TaskPanel({
  snapshot,
  busy,
  onTasksChanged
}: {
  snapshot: CampSnapshot
  busy: boolean
  onTasksChanged(): Promise<void>
}): JSX.Element {
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [status, setStatus] = useState<CampTaskStatus>('pending')
  const [expectedVersion, setExpectedVersion] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const selectedTask = selectedTaskId
    ? snapshot.tasks.find((task) => task.id === selectedTaskId) ?? null
    : null
  const activeMembers = snapshot.members.filter((member) =>
    member.membershipStatus === 'active' && member.profileStatus === 'active'
  )

  const resetForm = (): void => {
    setMode('list')
    setSelectedTaskId(null)
    setTitle('')
    setDescription('')
    setAssigneeAgentId('')
    setStatus('pending')
    setExpectedVersion(0)
    setFormError(null)
  }

  const beginCreate = (): void => {
    resetForm()
    setMode('create')
  }

  const beginEdit = (task: CampTaskView): void => {
    setSelectedTaskId(task.id)
    setTitle(task.title)
    setDescription(task.description)
    setAssigneeAgentId(task.assigneeAgentId ?? '')
    setStatus(task.status)
    setExpectedVersion(task.version)
    setFormError(null)
    setMode('edit')
  }

  const submitCreate = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim() || submitting || busy) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await window.lumen.request<StoredCommandResult>('tasks.create', {
        commandId: crypto.randomUUID(),
        campId: snapshot.camp.id,
        title: title.trim(),
        description: description.trim(),
        assigneeAgentId: assigneeAgentId || null
      })
      if (result.status === 'rejected') {
        setFormError(taskCommandMessage(result))
        return
      }
      resetForm()
      await onTasksChanged()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const submitUpdate = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!selectedTask || !title.trim() || submitting || busy) return
    setSubmitting(true)
    setFormError(null)
    const assignee = assigneeAgentId === (selectedTask.assigneeAgentId ?? '')
      ? { operation: 'unchanged' as const }
      : assigneeAgentId
        ? { operation: 'assign' as const, agentProfileId: assigneeAgentId }
        : { operation: 'clear' as const }
    try {
      const result = await window.lumen.request<StoredCommandResult>('tasks.update', {
        commandId: crypto.randomUUID(),
        campId: snapshot.camp.id,
        taskId: selectedTask.id,
        expectedVersion,
        title: title.trim(),
        description: description.trim(),
        status,
        assignee
      })
      if (result.status === 'rejected') {
        if (result.code === 'task.version_conflict') {
          const current = await window.lumen.request<CampTaskView | null>('tasks.get', {
            campId: snapshot.camp.id,
            taskId: selectedTask.id
          })
          if (current) setExpectedVersion(current.version)
          await onTasksChanged()
          setFormError('这项 Task 已被其他操作更新。当前版本已刷新，你的草稿仍保留；确认后可再次提交。')
        } else {
          setFormError(taskCommandMessage(result))
        }
        return
      }
      resetForm()
      await onTasksChanged()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  const terminal = selectedTask
    ? selectedTask.status === 'completed' || selectedTask.status === 'cancelled'
    : false

  return (
    <div className="task-panel">
      <div className="task-panel-toolbar">
        <div><strong>长期事项</strong><small>创建或指派不会唤醒成员</small></div>
        {mode === 'list'
          ? <button className="quiet-button compact" type="button" onClick={beginCreate} disabled={busy}>＋ 新建</button>
          : <button className="quiet-button compact" type="button" onClick={resetForm} disabled={submitting}>返回列表</button>}
      </div>

      {mode === 'create' && (
        <form className="task-editor" onSubmit={(event) => void submitCreate(event)}>
          <div className="task-editor-heading"><strong>新建 Task</strong><span>初始状态为待处理</span></div>
          <TaskFields
            title={title}
            description={description}
            assigneeAgentId={assigneeAgentId}
            status="pending"
            members={activeMembers}
            disabled={submitting || busy}
            showStatus={false}
            onTitle={setTitle}
            onDescription={setDescription}
            onAssignee={setAssigneeAgentId}
            onStatus={setStatus}
          />
          {formError && <p className="task-form-error" role="alert">{formError}</p>}
          <button className="primary-button task-submit" type="submit" disabled={!title.trim() || submitting || busy}>{submitting ? '正在保存…' : '创建 Task'}</button>
        </form>
      )}

      {mode === 'edit' && selectedTask && (
        <form className="task-editor" onSubmit={(event) => void submitUpdate(event)}>
          <div className="task-editor-heading"><strong>{terminal ? 'Task 详情' : '编辑 Task'}</strong><span>版本 {expectedVersion}</span></div>
          <TaskFields
            title={title}
            description={description}
            assigneeAgentId={assigneeAgentId}
            status={status}
            members={activeMembers}
            disabled={terminal || submitting || busy}
            showStatus
            onTitle={setTitle}
            onDescription={setDescription}
            onAssignee={setAssigneeAgentId}
            onStatus={setStatus}
          />
          {formError && <p className="task-form-error" role="alert">{formError}</p>}
          {terminal
            ? <p className="task-terminal-note">已结束的 Task 保留为只读记录，不能重新打开或删除。</p>
            : <button className="primary-button task-submit" type="submit" disabled={!title.trim() || submitting || busy}>{submitting ? '正在保存…' : '保存修改'}</button>}
        </form>
      )}

      {mode === 'list' && (
        <div className="task-list">
          {snapshot.tasks.map((task) => (
            <button className="task-list-row" type="button" key={task.id} onClick={() => beginEdit(task)}>
              <span className={`task-state-dot state-${task.status}`} aria-hidden="true" />
              <span className="task-list-copy"><strong>{task.title}</strong><small>{task.description || '没有补充说明'}</small></span>
              <span className="task-list-meta"><b>{taskStatusLabel(task.status)}</b><small>{taskAssigneeName(task, snapshot)}</small></span>
            </button>
          ))}
          {snapshot.tasks.length === 0 && <EmptyInline text="普通对话不需要 Task；需要跨消息持续跟踪时再创建。" />}
        </div>
      )}
    </div>
  )
}

function TaskFields({
  title,
  description,
  assigneeAgentId,
  status,
  members,
  disabled,
  showStatus,
  onTitle,
  onDescription,
  onAssignee,
  onStatus
}: {
  title: string
  description: string
  assigneeAgentId: string
  status: CampTaskStatus
  members: CampSnapshot['members']
  disabled: boolean
  showStatus: boolean
  onTitle(value: string): void
  onDescription(value: string): void
  onAssignee(value: string): void
  onStatus(value: CampTaskStatus): void
}): JSX.Element {
  const unavailableAssignee = assigneeAgentId
    && !members.some((member) => member.agentProfileId === assigneeAgentId)

  return (
    <>
      <label className="task-field"><span>标题</span><input value={title} maxLength={160} required disabled={disabled} onChange={(event) => onTitle(event.currentTarget.value)} /></label>
      <label className="task-field"><span>说明</span><textarea value={description} rows={4} maxLength={20000} disabled={disabled} onChange={(event) => onDescription(event.currentTarget.value)} placeholder="记录需要跨消息持续跟踪的责任与边界…" /></label>
      <div className="task-field-grid">
        <label className="task-field"><span>负责人</span><select value={assigneeAgentId} disabled={disabled} onChange={(event) => onAssignee(event.currentTarget.value)}><option value="">未分配</option>{unavailableAssignee && <option value={assigneeAgentId}>成员不可用</option>}{members.map((member) => <option value={member.agentProfileId} key={member.agentProfileId}>{member.displayName}</option>)}</select></label>
        {showStatus && <label className="task-field"><span>状态</span><select value={status} disabled={disabled} onChange={(event) => onStatus(event.currentTarget.value as CampTaskStatus)}><option value="pending">待处理</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>}
      </div>
    </>
  )
}

function taskStatusLabel(status: CampTaskStatus): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '待处理'
}

function taskAssigneeName(task: CampTaskView, snapshot: CampSnapshot): string {
  if (!task.assigneeAgentId) return '未分配'
  return snapshot.members.find((member) => member.agentProfileId === task.assigneeAgentId)?.displayName
    ?? '成员不可用'
}

function taskCommandMessage(result: StoredCommandResult): string {
  const messages: Record<string, string> = {
    'task.terminal': '已完成或已取消的 Task 不能再修改。',
    'task.assignee_unavailable': '所选负责人已不在当前 Camp，或当前不可用。',
    'task.invalid_status_transition': '当前 Task 状态不允许这样变更。',
    'task.version_conflict': 'Task 已被其他操作更新，请刷新后重试。'
  }
  return messages[result.code] ?? `Core 拒绝了这次修改：${result.code}`
}

function shortIdentity(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}

function modelName(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '模型未记录'
  const record = value as Record<string, unknown>
  const candidate = record.modelId ?? record.model_id ?? record.id
  return typeof candidate === 'string' ? candidate : '模型已冻结'
}
