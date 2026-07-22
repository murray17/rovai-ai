import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
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
  onChooseProject,
  onUseLobby,
  onSend
}: {
  project: SelectedProjectBinding | null
  preflight: CampCreationPreflight
  busy: boolean
  onChooseProject(): Promise<void>
  onUseLobby(): void
  onSend(text: string): Promise<void>
}): JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const defaultLead = preflight.readyMembers[0] ?? null

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

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
    <section className="workspace-shell new-conversation-workspace" aria-label="新对话草稿">
      <div className="workspace-heading">
        <div className="agent-identity">
          <span className="muwa-avatar">{defaultLead?.displayName.slice(0, 1) ?? '伴'}</span>
          <div><p className="eyebrow">NEW CAMP · TRANSIENT DRAFT</p><strong>{project?.name ?? '大厅'}</strong></div>
        </div>
        <div className="workspace-meta">
          <span className={`workspace-summary ${project ? 'clean' : 'neutral'}`}>{project ? '已绑定 Git 项目' : '未绑定项目'}</span>
          {project && <button className="quiet-button" type="button" onClick={onUseLobby} disabled={busy}>改为大厅</button>}
          <button className="quiet-button" type="button" onClick={() => void onChooseProject()} disabled={busy}>选择项目</button>
        </div>
      </div>

      <div className="workspace-state state-draft" role="status" aria-live="polite">
        <span className="draft-status"><i aria-hidden="true" />尚未保存</span>
        <div className="workspace-state-copy">
          <strong>{busy ? '正在创建 Camp' : '发送第一条消息后才创建 Camp'}</strong>
          <span>{busy ? 'Core 正在重新核验成员、Runtime 与项目身份…' : '离开或取消这个页面不会写入数据库。'}</span>
        </div>
        <dl className="workspace-facts">
          <div><dt>Default Lead</dt><dd>{defaultLead?.displayName ?? '无可用成员'}</dd></div>
          <div><dt>执行目录</dt><dd title={project?.projectPath}>{project?.projectPath ?? '大厅'}</dd></div>
        </dl>
      </div>

      <div className="workspace-grid">
        <section className="timeline-pane">
          <div className="pane-title"><div><p className="eyebrow">CONVERSATION</p><h2>想从哪里开始？</h2></div></div>
          <div className="new-conversation-stage">
            <span className="new-conversation-avatar" aria-hidden="true">{defaultLead?.displayName.slice(0, 1) ?? '伴'}</span>
            <h2>{defaultLead ? `由 ${defaultLead.displayName} 接收第一条消息` : '暂时无法开始'}</h2>
            <p>{project ? `本次对话将绑定 ${project.name}；你仍可在发送前切换。` : '大厅不会读取任何用户项目；需要代码上下文时再选择本地 Git 项目。'}</p>
          </div>
        </section>

        <aside className="activity-pane new-conversation-inspector" aria-label="新对话上下文">
          <div>
            <p className="eyebrow">INTAKE BOUNDARY</p>
            <h2>{project ? '项目对话' : '大厅对话'}</h2>
            <ul>
              <li>创建时加入所有活跃成员</li>
              <li>按成员顺序选择首个 Runtime Ready 成员为 Lead</li>
              <li>首条消息、CampTurn 与 AgentRun 在同一事务中受理</li>
              {project ? <li>发送时重新验证 Git Repository 身份</li> : <li>不授予任何用户项目文件访问</li>}
            </ul>
          </div>
        </aside>
      </div>

      <form className="composer new-conversation-composer" onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <div className="composer-input">
          <label htmlFor="new-camp-message">第一条消息</label>
          <textarea
            ref={textareaRef}
            id="new-camp-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="描述你想讨论、规划或完成的事情…"
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
          <span className="composer-hint">Shift + Enter 换行</span>
          <button className="primary-button" type="submit" disabled={!message.trim() || busy || !preflight.admissible}>{busy ? '正在开始…' : '发送并创建 Camp'}</button>
        </div>
      </form>
    </section>
  )
}

export function CampWorkspace({
  snapshot,
  projectName,
  busy,
  onSend,
  onResolveApproval
}: {
  snapshot: CampSnapshot
  projectName: string | null
  busy: boolean
  onSend(text: string): Promise<void>
  onResolveApproval(approval: ActionApprovalView, decision: 'approve' | 'deny'): void
}): JSX.Element {
  const [message, setMessage] = useState('')
  const [inspectorTab, setInspectorTab] = useState('activity')
  const memberById = useMemo(
    () => new Map(snapshot.members.map((member) => [member.agentProfileId, member])),
    [snapshot.members]
  )
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
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
          <span className="workspace-summary neutral">Lead · {defaultLead?.displayName ?? '未设置'}</span>
        </div>
      </div>

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
