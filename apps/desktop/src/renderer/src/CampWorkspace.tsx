import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AgentProfile,
  CampCreationPreflight,
  CampSnapshot,
  CampTaskStatus,
  CampTaskView,
  NavigationCampItem,
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
  agentRunStateTag,
  agentRunWaitDetail,
  formatByteSize,
  inboxMessagePresentation,
  localDayKey,
  messageClockTime,
  relativeTimeLabel,
  timelineDayLabel
} from './ui-model'
import { MemberAvatar } from './MemberAvatar'
import { identityColorToken } from './theme'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])

function skillExposurePresentation(status: string): {
  label: string
  tone: 'success' | 'attention' | 'danger' | 'neutral'
  mark: string
} {
  switch (status) {
    case 'ready':
      return { label: '可发现', tone: 'success', mark: '✓' }
    case 'stale':
      return { label: '沿用旧版本', tone: 'attention', mark: '◐' }
    case 'shadowed':
      return { label: '项目内容优先', tone: 'attention', mark: '↘' }
    case 'unsupported':
      return { label: 'Runtime 不支持', tone: 'neutral', mark: '–' }
    default:
      return { label: '投影错误', tone: 'danger', mark: '!' }
  }
}

function mcpExposurePresentation(status: string): {
  label: string
  tone: 'success' | 'attention' | 'danger' | 'neutral'
  mark: string
} {
  switch (status) {
    case 'ready':
      return { label: '本轮可用', tone: 'success', mark: '✓' }
    case 'disabled':
      return { label: '已停用', tone: 'neutral', mark: '–' }
    case 'unassigned':
      return { label: '未分配给成员', tone: 'neutral', mark: '–' }
    case 'adapter_unsupported':
      return { label: 'Adapter 不支持', tone: 'attention', mark: '◐' }
    case 'missing_environment':
      return { label: '缺少环境变量', tone: 'danger', mark: '!' }
    default:
      return { label: '配置无效', tone: 'danger', mark: '!' }
  }
}

function nativeSkillRootLabel(kind: string): string {
  switch (kind) {
    case 'agents': return '.agents/skills'
    case 'claude': return '.claude/skills'
    case 'antigravity': return '.agent/skills'
    default: return kind
  }
}

export function readyCampMentionCandidates(
  members: CampSnapshot['members'],
  agents: AgentProfile[]
): AgentMentionCandidate[] {
  const profileById = new Map(agents.map((agent) => [agent.id, agent]))
  return members
    .filter((member) => member.membershipStatus === 'active')
    .filter((member) => profileById.get(member.agentProfileId)?.presence === 'present')
    .map((member) => ({
      agentProfileId: member.agentProfileId,
      handle: member.handle,
      displayName: member.displayName,
      avatarRef: profileById.get(member.agentProfileId)?.avatarRef ?? null
    }))
}

export function NewConversationWorkspace({
  project,
  preflight,
  agents,
  busy,
  recentCamps = [],
  onOpenCamp,
  onOpenMembers,
  onSend
}: {
  project: SelectedProjectBinding | null
  preflight: CampCreationPreflight
  agents: AgentProfile[]
  busy: boolean
  recentCamps?: NavigationCampItem[]
  onOpenCamp?(camp: NavigationCampItem): void
  onOpenMembers(): void
  onSend(text: string, agentProfileIds: string[]): Promise<void>
}): JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const defaultLead = preflight.presentMembers.find(
    (member) => member.agentProfileId === preflight.initialLeadAgentProfileId
  ) ?? null
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents]
  )
  const defaultLeadProfile = defaultLead
    ? profileById.get(defaultLead.agentProfileId) ?? null
    : null
  const mentionCandidates = useMemo(
    () => preflight.presentMembers.map((member) => ({
      agentProfileId: member.agentProfileId,
      handle: member.handle,
      displayName: member.displayName,
      avatarRef: profileById.get(member.agentProfileId)?.avatarRef ?? null
    })),
    [preflight.presentMembers, profileById]
  )
  const mentionedAgentIds = useMemo(
    () => resolveMentionedAgentIds(message, mentionCandidates),
    [mentionCandidates, message]
  )

  useEffect(() => {
    if (!busy) textareaRef.current?.focus()
  }, [busy])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!message.trim() || busy) return
    try {
      await onSend(message, mentionedAgentIds)
      setMessage('')
    } catch {
      textareaRef.current?.focus()
    }
  }

  const appendMention = (): void => {
    setMessage((current) => current.length === 0 || current.endsWith(' ') ? `${current}@` : `${current} @`)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

  return (
    <section className={`workspace-shell new-conversation-workspace ${project ? 'project-draft' : 'lobby-draft'}`} aria-label="新对话草稿">
      <div className="new-conversation-main">
        <div className="new-conversation-stage">
          <svg className="lobby-mark" width="96" height="66" viewBox="0 0 72 56" aria-hidden="true">
            <path d="M36 4 L38.8 15.2 L50 18 L38.8 20.8 L36 32 L33.2 20.8 L22 18 L33.2 15.2 Z" fill="var(--brand)" />
            <path d="M8 52 Q36 35 64 52" stroke="var(--brand)" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="36" cy="46.5" r="3" fill="var(--ember)" />
          </svg>
          <h2>新对话</h2>
          <p className="lobby-subline">
            {defaultLead
              ? <>发送第一条消息后保存对话 · 默认由 <strong>{defaultLead.displayName}</strong>（Default Lead）接收</>
              : '发送第一条消息后保存对话'}
          </p>
          <p className="lobby-context-note">{project
            ? `这段对话会使用 ${project.name} 的项目上下文。`
            : '大厅不会读取任何项目文件。'}</p>

          {!preflight.admissible && (
            <div className="new-conversation-blocked" role="alert">
              <div><strong>还没有可用的队友</strong><span>{preflight.blockers[0]?.detail ?? '请先为至少一位在队成员配置 Runtime。'}</span></div>
              <button className="quiet-button" type="button" onClick={onOpenMembers}>配置成员</button>
            </div>
          )}

          <form className="lobby-composer-card" onSubmit={(event) => void submit(event)} aria-busy={busy}>
            <div className="composer-input">
              <AgentMentionTextarea
                id="new-camp-message"
                value={message}
                onChange={setMessage}
                candidates={mentionCandidates}
                defaultRecipientName={defaultLead?.displayName ?? '队友'}
                placeholder={project ? `描述你想在 ${project.name} 中完成的事情…` : '聊聊想法、问个问题，或打个招呼…'}
                rows={3}
                disabled={busy}
                textareaRef={textareaRef}
              />
            </div>
            <div className="lobby-composer-tools">
              {defaultLead && (
                <span
                  className="member-ready-chip"
                  style={{ '--agent-accent': identityColorToken(defaultLead.agentProfileId) } as React.CSSProperties}
                >
                  <MemberAvatar
                    agentProfileId={defaultLead.agentProfileId}
                    avatarRef={defaultLeadProfile?.avatarRef ?? null}
                    displayName={defaultLead.displayName}
                    size="mention"
                    decorative
                  />
                  {defaultLead.displayName} · <small>{defaultLead.runtimeReadiness === 'ready' ? 'Runtime 可启动' : 'Runtime 需处理'}</small>
                </span>
              )}
              <button
                className="add-member-chip"
                type="button"
                disabled={busy}
                onClick={appendMention}
              >@ 添加成员</button>
              <span className="lobby-tools-spacer" aria-hidden="true" />
              <span className="composer-hint">⌘⏎ 发送</span>
              <button className="primary-button composer-send" type="submit" disabled={!message.trim() || busy}>{busy ? '正在开始…' : '发送'}</button>
            </div>
          </form>

          {recentCamps.length > 0 && onOpenCamp && (
            <div className="lobby-continue" aria-label="继续未完成的事">
              <div className="lobby-continue-title">继续未完成的事</div>
              {recentCamps.map((camp) => (
                <button className="lobby-continue-row" type="button" key={camp.id} onClick={() => onOpenCamp(camp)}>
                  <i className={`task-dot camp-marker-${camp.marker}`} aria-hidden="true" />
                  <span className="truncate">{camp.title}</span>
                  <small>{relativeTimeLabel(camp.lastActivityAt)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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
  onSetMemoryProposal,
  onTasksChanged,
  onResolveApproval
}: {
  snapshot: CampSnapshot
  projectName: string | null
  agents: AgentProfile[]
  busy: boolean
  onSend(text: string, agentProfileIds: string[]): Promise<void>
  onChangeLead(agentProfileId: string): Promise<void>
  onSetMemoryProposal(agentProfileId: string, expectedVersion: number, enabled: boolean): Promise<void>
  onTasksChanged(): Promise<void>
  onResolveApproval(approval: ActionApprovalView, decision: 'approve' | 'deny'): void
}): JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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

  useEffect(() => {
    if (!busy) textareaRef.current?.focus()
  }, [busy])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!message.trim() || busy) return
    try {
      await onSend(message, resolveMentionedAgentIds(message, mentionCandidates))
      setMessage('')
    } catch {
      // Parent owns the failure Toast; keep the draft in place.
      textareaRef.current?.focus()
    }
  }

  return (
    <section className="workspace-shell camp-workspace" aria-label={`Camp：${snapshot.camp.title}`}>
      <div className="workspace-heading">
        <div className="agent-identity">
          <MemberAvatar
            agentProfileId={defaultLead?.agentProfileId ?? 'missing-default-lead'}
            avatarRef={defaultLeadProfile?.avatarRef ?? defaultLead?.avatarRef ?? null}
            displayName={defaultLead?.displayName ?? '伙伴'}
            size="workspace"
            decorative
            className="agent-avatar"
          />
          <div><strong>{projectName ?? '大厅'}</strong></div>
        </div>
        <div className="workspace-meta">
          <span className={`workspace-summary ${snapshot.camp.repositoryScopeId ? 'clean' : 'neutral'}`}>{snapshot.camp.repositoryScopeId ? 'Git 项目' : '大厅'}</span>
          <details className="lead-picker">
            <summary className={`workspace-summary ${defaultLeadReady ? 'neutral' : 'attention'}`} aria-label="调整 Default Lead">Lead · {defaultLead?.displayName ?? '未设置'} <span aria-hidden="true">⌄</span></summary>
            <div className="lead-picker-popup" role="menu" aria-label="选择 Default Lead">
              {snapshot.members.filter((member) =>
                member.membershipStatus === 'active' && member.profilePresence === 'present'
              ).map((member) => {
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
                    <MemberAvatar
                      agentProfileId={member.agentProfileId}
                      avatarRef={profile?.avatarRef ?? member.avatarRef}
                      displayName={member.displayName}
                      size="mention"
                      decorative
                    />
                    <span><strong>{member.displayName}</strong><small>{ready ? 'Runtime Ready' : 'Runtime 未就绪'}</small></span>{member.isDefaultLead && <b>✓</b>}
                  </button>
                )
              })}
            </div>
          </details>
          <details className="lead-picker memory-capability-picker">
            <summary className="workspace-summary neutral" aria-label="调整成员共同记忆提案权限">记忆提案 <span aria-hidden="true">⌄</span></summary>
            <div className="lead-picker-popup memory-capability-popup" aria-label="成员共同记忆提案权限">
              {snapshot.members.filter((member) => member.membershipStatus === 'active').map((member) => (
                <label key={member.agentProfileId}>
                  <input
                    type="checkbox"
                    checked={member.memoryProposalEnabled}
                    disabled={busy}
                    onChange={(event) => void onSetMemoryProposal(
                      member.agentProfileId,
                      member.version,
                      event.target.checked
                    ).catch(() => undefined)}
                  />
                  <span><strong>{member.displayName}</strong><small>只影响未来 AgentRun</small></span>
                </label>
              ))}
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
          <div className="pane-title"><div><h2>公共讨论</h2></div></div>
          <div className="timeline-scroll camp-timeline">
            <div className="timeline-track">
              {(() => {
                const items: JSX.Element[] = []
                let lastDayKey = ''
                let lastAuthorKey = ''
                for (const campMessage of snapshot.messages) {
                  const dayKey = localDayKey(campMessage.createdAt)
                  if (dayKey && dayKey !== lastDayKey) {
                    lastDayKey = dayKey
                    lastAuthorKey = ''
                    items.push(
                      <div className="timeline-node timeline-day" key={`day-${dayKey}`}>
                        <span className="node-mark mark-day" aria-hidden="true" />
                        {timelineDayLabel(campMessage.createdAt, snapshot.camp.createdAt)}
                      </div>
                    )
                  }
                  const member = memberById.get(campMessage.authorId)
                  const author = campMessage.authorType === 'user'
                    ? '你'
                    : member?.displayName ?? (campMessage.authorType === 'system' ? '系统' : campMessage.authorId)
                  const authorKey = `${campMessage.authorType}:${campMessage.authorId}`
                  const showMeta = authorKey !== lastAuthorKey || campMessage.authorType === 'system'
                  lastAuthorKey = authorKey
                  const markKind = campMessage.authorType === 'user'
                    ? 'user'
                    : campMessage.authorType === 'agent' ? 'agent' : 'system'
                  items.push(
                    <article
                      className={`timeline-node conversation-bubble ${campMessage.authorType}`}
                      key={campMessage.id}
                      style={member ? { '--agent-accent': identityColorToken(member.agentProfileId) } as React.CSSProperties : undefined}
                    >
                      <span className={`node-mark mark-${markKind}`} aria-hidden="true" />
                      {showMeta && (
                        <div className="bubble-meta">
                          <strong>{author}</strong>
                          <time title={`#${campMessage.sequence}`}>{messageClockTime(campMessage.createdAt)}</time>
                        </div>
                      )}
                      {campMessage.authorType === 'agent'
                        ? <div className="agent-card"><p>{campMessage.body}</p></div>
                        : <p>{campMessage.body}</p>}
                    </article>
                  )
                }
                return items
              })()}
              {snapshot.messages.length === 0 && <EmptyInline text="这段 Camp 还没有公共消息。" />}
              {pendingApprovals.map((approval) => (
                <article className="timeline-node approval-node" key={`approval-${approval.id}`}>
                  <span className="node-mark mark-approval" aria-hidden="true" />
                  <div className="approval-flow">
                    <div className="approval-flow-head">
                      <strong>◆ 等待你的审批 — {approval.actionSummary}</strong>
                      <code>{messageClockTime(approval.requestedAt)} · {approval.actionKind}</code>
                    </div>
                    <pre className="approval-flow-input">{JSON.stringify(approval.canonicalInput, null, 2)}</pre>
                    <div className="approval-flow-actions">
                      <button className="quiet-button compact" type="button" onClick={() => onResolveApproval(approval, 'deny')} disabled={busy}>拒绝</button>
                      <button className="primary-button composer-send" type="button" onClick={() => onResolveApproval(approval, 'approve')} disabled={busy}>允许一次</button>
                    </div>
                  </div>
                </article>
              ))}
              {activeRuns.map((run) => (
                <div
                  className={`timeline-node working-row ${run.status === 'waiting' ? 'waiting' : ''}`}
                  key={run.id}
                  style={{ '--agent-accent': identityColorToken(run.agentProfileId) } as React.CSSProperties}
                >
                  <span className="node-mark mark-working" aria-hidden="true" />
                  <strong>{memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId}</strong>
                  <span className="truncate">{agentRunWaitDetail(run.waitReason) ?? run.purpose}</span>
                  <b className="run-chip">{run.status === 'waiting' ? 'WAITING' : agentRunPresentation(run).label === '已排队' ? 'QUEUED' : 'RUNNING'}</b>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="activity-pane" aria-label="Camp 检查器">
          <Tabs.Root value={inspectorTab} onValueChange={setInspectorTab} activationMode="manual" className="activity-tabs">
            <Tabs.List className="tabs-list sticky-tabs" aria-label="Camp 详情">
              <Tabs.Trigger value="activity">活动 <small>{snapshot.agentRuns.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="tasks">任务 <small>{snapshot.tasks.length}</small></Tabs.Trigger>
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
                    <time className="activity-time">{messageClockTime(inboxMessage.createdAt)}</time>
                    <div className="activity-body">
                      <div className="activity-row-title"><strong>{sender} → {recipient}</strong><span className={`activity-state tone-${status.tone}`}>{status.label}</span></div>
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
              {snapshot.agentRuns.slice().reverse().map((run) => {
                const state = agentRunStateTag(run)
                return (
                  <article
                    className="activity-row"
                    key={run.id}
                    style={{ '--agent-accent': identityColorToken(run.agentProfileId) } as React.CSSProperties}
                  >
                    <time className="activity-time">{messageClockTime(run.createdAt)}</time>
                    <div className="activity-body">
                      <div className="activity-row-title"><strong><span className="activity-member">{memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId}</span>{run.invocationKind === 'a2a' ? ' · A2A' : ''}</strong></div>
                      <p className="activity-detail">{agentRunWaitDetail(run.waitReason) ?? run.purpose}</p>
                      <span className={`activity-state tone-${state.tone}`} title={agentRunPresentation(run).label}>{state.tag}</span>
                      {run.invocationKind === 'a2a' && <dl className="activity-facts"><div><dt>A2A 深度</dt><dd>{run.a2aDepth}</dd></div>{run.sourceInboxMessageId && <div><dt>请求</dt><dd><code title={run.sourceInboxMessageId}>{shortIdentity(run.sourceInboxMessageId)}</code></dd></div>}</dl>}
                    </div>
                  </article>
                )
              })}
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
                      <div><dt>覆盖基线</dt><dd>{manifest.coverageBaselineSequence ? `seq ≤ ${manifest.coverageBaselineSequence}` : '未使用'}</dd></div>
                      <div><dt>Binding</dt><dd>Generation {manifest.nativeBindingGeneration}</dd></div>
                      <div><dt>Formatter</dt><dd>v{manifest.formatterVersion}</dd></div>
                    </dl>

                    {manifest.summaries.length > 0 && (
                      <div className="context-subsection">
                        <strong>Camp 共享摘要</strong>
                        {manifest.summaries.map((summary) => <div className="context-summary-row" key={summary.id}><span>{summary.level === 'epoch' ? 'Epoch' : 'Segment'}{summary.inputTruncated ? ' · 输入截断' : ''}</span><code>seq {summary.fromSequence}–{summary.throughSequence}</code><small>{summary.generatorAdapterKind} · {modelName(summary.generatorModel)}</small></div>)}
                      </div>
                    )}

                    {manifest.attachments.length > 0 && (
                      <div className="context-subsection">
                        <div className="context-subsection-title"><strong>附件</strong><small>仅注入元数据</small></div>
                        {manifest.attachments.map((attachment) => <div className="context-attachment" key={attachment.attachmentId}><div><strong>{attachment.name}</strong><small>{attachment.mediaType} · {formatByteSize(attachment.byteSize)}</small></div><code title={attachment.locationRef}>{attachment.locationRef}</code></div>)}
                      </div>
                    )}

                    <div className="context-subsection">
                      <div className="context-subsection-title">
                        <strong>Skill 暴露</strong>
                        <small>记录投影，不代表 Runtime 已加载正文</small>
                      </div>
                      {manifest.skillExposure.skills.map((skill) => {
                        const presentation = skillExposurePresentation(skill.status)
                        return (
                          <div className="skill-exposure-row" key={`${skill.nativeRootKind}:${skill.skillId}`}>
                            <span className={`skill-exposure-mark tone-${presentation.tone}`} aria-hidden="true">{presentation.mark}</span>
                            <div>
                              <strong>{skill.name}</strong>
                              <small>{nativeSkillRootLabel(skill.nativeRootKind)} · {presentation.label}</small>
                              {skill.reasonCode && <code title={skill.reasonCode}>{skill.reasonCode}</code>}
                            </div>
                            <code title={skill.revisionId}>{shortIdentity(skill.revisionId)}</code>
                          </div>
                        )
                      })}
                      {manifest.skillExposure.skills.length === 0 && (
                        <p className="context-empty-note">本次 AgentRun 没有受管 Skill 暴露记录。</p>
                      )}
                    </div>

                    <div className="context-subsection">
                      <div className="context-subsection-title">
                        <strong>MCP 暴露</strong>
                        <small>冻结配置摘要，不展示凭据</small>
                      </div>
                      {manifest.mcpExposure.configStatus === 'invalid' && (
                        <p className="context-alert">本轮 MCP 配置无效，未向 Runtime 暴露外部 MCP。</p>
                      )}
                      {manifest.mcpExposure.servers.map((server) => {
                        const presentation = mcpExposurePresentation(server.status)
                        return (
                          <div className="skill-exposure-row" key={server.name}>
                            <span className={`skill-exposure-mark tone-${presentation.tone}`} aria-hidden="true">{presentation.mark}</span>
                            <div>
                              <strong>{server.name}</strong>
                              <small>{server.transport === 'stdio' ? 'STDIO' : 'Streamable HTTP'} · {presentation.label}</small>
                              {server.reason && <code title={server.reason}>{server.reason}</code>}
                            </div>
                            <code title={server.configDigest}>{shortIdentity(server.configDigest)}</code>
                          </div>
                        )
                      })}
                      {manifest.mcpExposure.servers.length === 0 && (
                        <p className="context-empty-note">本次 AgentRun 没有外部 MCP 暴露记录。</p>
                      )}
                      {manifest.mcpExposure.warnings.map((warning) => (
                        <p className="context-alert" key={warning}>{warning}</p>
                      ))}
                    </div>

                    <details className="context-digests">
                      <summary>完整性与版本</summary>
                      <dl><div><dt>Payload</dt><dd><code>{manifest.renderedPayloadDigest}</code></dd></div><div><dt>Charter</dt><dd><code>{manifest.charterDigest}</code></dd></div><div><dt>成员状态</dt><dd><code>{manifest.memberStateDigest}</code></dd></div><div><dt>Work Brief</dt><dd><code>{manifest.workBriefDigest}</code></dd></div><div><dt>Task Context</dt><dd><code>{manifest.taskContextDigest}</code></dd></div><div><dt>Skill</dt><dd><code>{manifest.skillExposureDigest}</code></dd></div><div><dt>MCP</dt><dd><code>{manifest.mcpExposureDigest}</code></dd></div></dl>
                    </details>
                    {manifest.delivery?.lastError && <p className="context-alert">{manifest.delivery.lastError}</p>}
                  </article>
                )
              })}

              {snapshot.contextCompactions.length > 0 && (
                <section className="compaction-history" aria-label="条件压缩记录">
                  <div className="inspector-section-label"><span>条件压缩记录</span><small>仅超出预算时产生</small></div>
                  {snapshot.contextCompactions.map((attempt) => <div className="compaction-row" key={attempt.id}><span className={`activity-status tone-${attempt.status === 'succeeded' ? 'success' : attempt.status === 'failed' ? 'danger' : 'attention'}`}>{attempt.status === 'succeeded' ? '已完成' : attempt.status === 'failed' ? '失败' : '处理中'}</span><div><strong>{attempt.level === 'epoch' ? 'Epoch 摘要' : 'Segment 摘要'}</strong><code>seq {attempt.fromSequence}–{attempt.throughSequence}</code><small>重试 {attempt.retryCount} · 等待 {attempt.waiterCount}</small>{attempt.errorCode && <small>{attempt.errorCode}</small>}</div></div>)}
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
          <div className="inspector-meta">
            {snapshot.agentRuns.length > 0 && `run ${shortIdentity(snapshot.agentRuns[snapshot.agentRuns.length - 1].id)} · `}seq {snapshot.throughGlobalSequence}
          </div>
        </aside>
      </div>

      <form className="composer" onSubmit={(event) => void submit(event)}>
        <div className="composer-box">
          <div className="composer-input">
            <AgentMentionTextarea
              id="camp-message"
              value={message}
              onChange={setMessage}
              candidates={mentionCandidates}
              defaultRecipientName={defaultLead?.displayName ?? 'Default Lead'}
              placeholder="继续提问、补充约束或交付下一项职责…"
              rows={2}
              disabled={busy}
              textareaRef={textareaRef}
            />
          </div>
          <div className="composer-actions">
            <span className="composer-hint">⌘⏎</span>
            <button className="primary-button composer-send" type="submit" disabled={!message.trim() || busy}>{busy ? '发送中…' : '发送'}</button>
          </div>
        </div>
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
    member.membershipStatus === 'active' && member.profilePresence === 'present'
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
      const result = await window.rovai.request<StoredCommandResult>('tasks.create', {
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
      const result = await window.rovai.request<StoredCommandResult>('tasks.update', {
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
          const current = await window.rovai.request<CampTaskView | null>('tasks.get', {
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
