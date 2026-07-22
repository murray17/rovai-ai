import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AgentProfile,
  CampCreationPreflight,
  CampSnapshot,
  SelectedProjectBinding
} from '@contracts'
import { EmptyInline } from './ui-elements'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])

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
  onSend(text: string): Promise<void>
}): JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const defaultLead = preflight.readyMembers[0] ?? null
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
      await onSend(message)
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
        <div className="workspace-meta">
          <span className={`workspace-summary ${project ? 'clean' : 'neutral'}`}>{project ? 'Git 项目上下文' : '闲聊与测试'}</span>
        </div>
      </div>

      <div className="workspace-state state-draft" role="status" aria-live="polite">
        <span className="draft-status"><i aria-hidden="true" />尚未保存</span>
        <div className="workspace-state-copy">
          <strong>{busy ? '正在开始对话' : '发送第一条消息后保存对话'}</strong>
          <span>{busy ? '正在确认成员与 Runtime 状态…' : '没有发送消息，就不会留下空对话。'}</span>
        </div>
        <dl className="workspace-facts">
          <div><dt>接收成员</dt><dd>{defaultLead?.displayName ?? '暂无可用成员'}</dd></div>
          <div><dt>上下文</dt><dd title={project?.projectPath}>{project ? project.name : '仅大厅'}</dd></div>
        </dl>
      </div>

      <div className="new-conversation-main">
        <div className="new-conversation-stage">
          <span className="new-conversation-avatar" aria-hidden="true">{defaultLead?.displayName.slice(0, 1) ?? '伴'}</span>
          <p className="eyebrow">{project ? 'PROJECT CONTEXT' : 'OPEN CONVERSATION'}</p>
          <h2>{defaultLead ? `和 ${defaultLead.displayName} 开始一段对话` : '先让一位队友就绪'}</h2>
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
              <span><strong>{defaultLead?.displayName} 已就绪</strong><small>将接收你的第一条消息</small></span>
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
            <label htmlFor="new-camp-message">给 {defaultLead?.displayName ?? '队友'} 发消息</label>
            <textarea
              ref={textareaRef}
              id="new-camp-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={project ? `描述你想在 ${project.name} 中完成的事情…` : '聊聊想法、问个问题，或打个招呼…'}
              rows={3}
              disabled={busy || !preflight.admissible}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
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
  onResolveApproval
}: {
  snapshot: CampSnapshot
  projectName: string | null
  agents: AgentProfile[]
  busy: boolean
  onSend(text: string): Promise<void>
  onChangeLead(agentProfileId: string): Promise<void>
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
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
  const defaultLeadProfile = defaultLead ? profileById.get(defaultLead.agentProfileId) ?? null : null
  const defaultLeadReady = defaultLeadProfile?.runtimeReadiness.status === 'ready'
  const activeRuns = snapshot.agentRuns.filter((run) => NON_TERMINAL_RUNS.has(run.status))
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === 'pending')

  useEffect(() => {
    if (pendingApprovals.length > 0) setInspectorTab('approvals')
  }, [pendingApprovals.length])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!message.trim() || busy) return
    await onSend(message)
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

      <div className={`workspace-state ${activeRuns.length ? 'state-running' : 'state-completed'}`} role="status" aria-live="polite">
        <span className={activeRuns.length ? 'runtime-loading-mark' : 'draft-status'}><i aria-hidden="true" />{activeRuns.length ? '执行中' : '已就绪'}</span>
        <div className="workspace-state-copy"><strong>{snapshot.camp.title}</strong><span>{activeRuns.length ? `${activeRuns.length} 个 AgentRun 正在运行或等待。` : '公共上下文已保存，可以继续向 Default Lead 提问。'}</span></div>
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
              <div className="working-row" key={run.id}><i aria-hidden="true" /><div><strong>{memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId} 正在工作</strong><span>{run.purpose}</span></div></div>
            ))}
          </div>
        </section>

        <aside className="activity-pane" aria-label="Camp 检查器">
          <Tabs.Root value={inspectorTab} onValueChange={setInspectorTab} activationMode="manual" className="activity-tabs">
            <Tabs.List className="tabs-list sticky-tabs" aria-label="Camp 详情">
              <Tabs.Trigger value="activity">活动 <small>{snapshot.agentRuns.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="tasks">Task <small>{snapshot.tasks.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="approvals">审批 {pendingApprovals.length > 0 && <b>{pendingApprovals.length}</b>}</Tabs.Trigger>
              <Tabs.Trigger value="audit">审计 <small>{snapshot.timeline.length}</small></Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="activity" className="tab-scroll activity-list">
              {snapshot.agentRuns.slice().reverse().map((run) => (
                <article className="activity-row" key={run.id}>
                  <span className="activity-icon" aria-hidden="true">{NON_TERMINAL_RUNS.has(run.status) ? '●' : '✓'}</span>
                  <div className="activity-body"><div className="activity-row-title"><strong>{memberById.get(run.agentProfileId)?.displayName ?? run.agentProfileId}</strong><span className={`activity-status status-${run.status}`}>{run.waitReason ?? run.status}</span></div><p className="activity-detail">{run.purpose}</p></div>
                </article>
              ))}
              {snapshot.agentRuns.length === 0 && <EmptyInline text="执行请求会在这里形成独立 AgentRun。" />}
            </Tabs.Content>
            <Tabs.Content value="tasks" className="tab-scroll activity-list">
              {snapshot.tasks.map((task) => <article className="activity-row" key={task.id}><span className="activity-icon" aria-hidden="true">◇</span><div className="activity-body"><div className="activity-row-title"><strong>{task.title}</strong><span className={`activity-status status-${task.status}`}>{task.status}</span></div><p className="activity-detail">{task.objective}</p></div></article>)}
              {snapshot.tasks.length === 0 && <EmptyInline text="普通对话不需要 Task；明确的工作承诺才会出现在这里。" />}
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
        <div className="composer-input"><label htmlFor="camp-message">给 {defaultLead?.displayName ?? 'Default Lead'} 发送消息</label><textarea id="camp-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="继续提问、补充约束或交付下一项职责…" rows={2} disabled={busy || !defaultLead} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
          }
        }} /></div>
        <div className="composer-actions"><span className="composer-hint">默认请求当前 Lead 执行</span><button className="primary-button" type="submit" disabled={!message.trim() || busy || !defaultLead}>{busy ? '发送中…' : '发送'}</button></div>
      </form>
    </section>
  )
}
