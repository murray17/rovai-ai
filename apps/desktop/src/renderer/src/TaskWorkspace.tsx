import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type { Approval, GitDiff, Project, Task, TimelineEvent } from '@contracts'
import { EmptyInline, StatusBadge } from './ui-elements'
import {
  activityIcon,
  activityStatusLabel,
  buildActivities,
  buildConversation,
  buildGitStatusEntries,
  diffLineKind,
  eventActor,
  eventResult,
  formatDuration,
  formatTime,
  jsonPreview,
  summarizeApproval,
  taskStateSummary,
  type ActivityItem,
  type ConversationItem
} from './ui-model'

const ACTIVE_STATUSES = new Set(['preparing', 'running', 'waiting_approval', 'recovering'])

export function NewLobbyWorkspace({ busy, onSend }: {
  busy: boolean
  onSend(text: string): Promise<void>
}): JSX.Element {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const value = message.trim()
    if (!value || busy) return
    try {
      await onSend(value)
      setMessage('')
    } catch {
      textareaRef.current?.focus()
    }
  }

  return (
    <section className="workspace-shell new-conversation-workspace" aria-label="默认大厅新对话">
      <div className="workspace-heading">
        <div className="agent-identity"><span className="muwa-avatar">沐</span><div><p className="eyebrow">沐瓦 · LOBBY CONVERSATION</p><strong>默认大厅</strong></div></div>
        <div className="workspace-meta"><span className="workspace-summary neutral">未绑定项目</span></div>
      </div>

      <div className="workspace-state state-draft" role="status" aria-live="polite">
        <span className="draft-status"><i aria-hidden="true" />新对话</span>
        <div className="workspace-state-copy"><strong>{busy ? '正在开始' : '等待第一条消息'}</strong><span>{busy ? '正在创建大厅对话并连接沐瓦…' : '输入后直接发送，不需要标题、项目或二次确认。'}</span></div>
        <dl className="workspace-facts"><div><dt>上下文</dt><dd>默认大厅</dd></div><div><dt>项目访问</dt><dd>无</dd></div></dl>
      </div>

      <div className="workspace-grid">
        <section className="timeline-pane">
          <div className="pane-title"><div><p className="eyebrow">CONVERSATION</p><h2>新对话</h2></div></div>
          <div className="new-conversation-stage">
            <span className="new-conversation-avatar" aria-hidden="true">沐</span>
            <h2>想从哪里开始？</h2>
            <p>直接在下方输入第一条消息。发送时 Lumen 才会保存这段对话并启动 Runtime。</p>
          </div>
        </section>

        <aside className="activity-pane new-conversation-inspector" aria-label="大厅上下文说明">
          <div>
            <p className="eyebrow">DEFAULT LOBBY</p>
            <h2>无项目上下文</h2>
            <ul>
              <li>不会读取或修改任何项目文件</li>
              <li>不会创建 Git 分支或 Worktree</li>
              <li>需要代码时，从项目页显式新建项目任务</li>
            </ul>
          </div>
        </aside>
      </div>

      <form className="composer new-conversation-composer" onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <div className="composer-input"><label htmlFor="new-lobby-message">给沐瓦发送第一条消息</label><textarea ref={textareaRef} id="new-lobby-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="描述你想讨论、规划或解决的事情…" rows={3} disabled={busy} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }} /></div>
        <div className="composer-actions"><span className="composer-hint">Shift + Enter 换行</span><button className="primary-button" type="submit" disabled={!message.trim() || busy}>{busy ? '正在开始…' : '发送'}</button></div>
      </form>
    </section>
  )
}

export function TaskWorkspace({
  project,
  task,
  events,
  approvals,
  diff,
  busy,
  pendingApprovalCount,
  onStartOrResume,
  onSend,
  onInterrupt,
  onApproval
}: {
  project: Project
  task: Task
  events: TimelineEvent[]
  approvals: Approval[]
  diff: GitDiff
  busy: string | null
  pendingApprovalCount: number
  onStartOrResume(): void
  onSend(text: string): Promise<void>
  onInterrupt(): void
  onApproval(approval: Approval, decision: string): Promise<void>
}): JSX.Element {
  const conversation = useMemo(() => buildConversation(events), [events])
  const activities = useMemo(() => buildActivities(events), [events])
  const canResume = ['draft', 'interrupted', 'recovering', 'failed'].includes(task.status)
  const isActive = ACTIVE_STATUSES.has(task.status)
  const isLobby = project.kind === 'lobby'
  const [message, setMessage] = useState('')
  const [inspectorTab, setInspectorTab] = useState(pendingApprovalCount ? 'approvals' : 'activity')
  const latestActivity = activities[activities.length - 1]

  useEffect(() => {
    if (pendingApprovalCount > 0) setInspectorTab('approvals')
  }, [pendingApprovalCount])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const value = message.trim()
    if (!value) return
    await onSend(value)
    setMessage('')
  }

  return (
    <section className="workspace-shell">
      <div className="workspace-heading">
        <div className="agent-identity"><span className="muwa-avatar">伴</span><div><p className="eyebrow">{isLobby ? 'LOBBY CONVERSATION' : 'CAMP AGENT RUNTIME'}</p><strong>{project.name}</strong></div></div>
        <div className="workspace-meta">{isLobby ? <span className="workspace-summary neutral">未绑定项目</span> : <><code className="branch-meta" title={`起始分支：${task.startBranch}`}>{task.startBranch}</code><span className={`workspace-summary ${diff.isClean ? 'clean' : 'changed'}`}>{diff.isClean ? '项目干净' : `已变更 ${diff.changedFileCount} 个文件`}</span><button className="quiet-button" onClick={() => void window.lumen.revealTaskWorkspace(task.id)}>在 Finder 显示</button></>}</div>
      </div>

      <div className={`workspace-state state-${task.status}`} role="status" aria-live="polite">
        <StatusBadge status={task.status} />
        <div className="workspace-state-copy"><strong>当前状态</strong><span>{taskStateSummary(task.status, pendingApprovalCount, latestActivity, project.kind)}</span></div>
        <dl className="workspace-facts"><div><dt>{isLobby ? '上下文' : '起始提交'}</dt><dd>{isLobby ? '默认大厅' : <code>{task.baseRevision.slice(0, 8)}</code>}</dd></div><div><dt>检查器</dt><dd>{pendingApprovalCount ? `${pendingApprovalCount} 个待审批` : `${activities.length} 条活动`}</dd></div></dl>
      </div>

      {task.status === 'recovering' && (
        <div className="recovery-banner"><span className="recovery-icon" aria-hidden="true">↻</span><div><strong>需要确认恢复</strong><span>{isLobby ? '将从结构化 Checkpoint 恢复大厅对话；不会读取任何用户项目。' : '将核对项目 Git 状态并恢复原生 Thread；若原 Thread 不可用，会创建新的 Session Generation。现有文件与审计记录已保留。'}</span></div><button className="attention-button" onClick={onStartOrResume} disabled={busy === 'task-runtime'}>{busy === 'task-runtime' ? '正在恢复…' : '确认并恢复'}</button></div>
      )}

      <div className="workspace-grid">
        <section className="timeline-pane">
          <div className="pane-title"><div><p className="eyebrow">TIMELINE</p><h2>任务对话</h2></div></div>
          <div className="timeline-scroll">
            <div className="goal-card"><span>{isLobby ? '对话目标' : '任务目标'}</span><p>{task.goal}</p></div>
            {conversation.map((item) => <ConversationBubble item={item} key={item.id} />)}
            {conversation.length === 0 && <EmptyInline text={task.status === 'draft' ? '任务已创建，等待启动。' : task.status === 'pending' ? '首个 AgentRun 已进入调度队列。' : 'Agent 正在准备上下文…'} />}
            {isActive && task.status !== 'waiting_approval' && <div className="working-row"><i aria-hidden="true" /><div><strong>Agent 正在工作</strong><span>{latestActivity ? `最近证据：${latestActivity.title} · ${activityStatusLabel(latestActivity.status)}` : '等待第一条 Runtime 活动'}</span></div></div>}
          </div>
        </section>

        <aside className="activity-pane" aria-label="任务检查器">
          <Tabs.Root value={inspectorTab} onValueChange={setInspectorTab} activationMode="manual" className="activity-tabs">
            <Tabs.List className="tabs-list sticky-tabs" aria-label="任务证据">
              <Tabs.Trigger value="activity">活动 <small>{activities.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="changes">{isLobby ? '项目' : '变更'} <small>{isLobby ? '—' : diff.changedFileCount}</small></Tabs.Trigger>
              <Tabs.Trigger value="approvals">审批 {pendingApprovalCount > 0 && <b aria-label={`${pendingApprovalCount} 个待审批`}>{pendingApprovalCount}</b>}</Tabs.Trigger>
              <Tabs.Trigger value="audit">审计 <small>{events.length}</small></Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="activity" className="tab-scroll activity-list">
              {activities.map((activity) => <ActivityRow activity={activity} key={activity.id} />)}
              {activities.length === 0 && <EmptyInline text="命令、文件和 Runtime 活动会出现在这里。" />}
            </Tabs.Content>
            <Tabs.Content value="changes" className="tab-scroll changes-panel">
              <DiffView diff={diff} isLobby={isLobby} />
            </Tabs.Content>
            <Tabs.Content value="approvals" className="tab-scroll approvals-panel">
              {pendingApprovalCount > 0 && <div className="approval-blocking-note" role="status"><strong>任务正在等待你的决定</strong><span>先核对能力、准确范围和后果，再选择最小必要授权。</span></div>}
              {approvals.map((approval) => <ApprovalCard approval={approval} busy={busy === `approval-${approval.id}`} onDecision={(decision) => onApproval(approval, decision)} key={approval.id} />)}
              {approvals.length === 0 && <EmptyInline text="当前没有审批请求。未知请求会默认失败关闭。" />}
            </Tabs.Content>
            <Tabs.Content value="audit" className="tab-scroll audit-list">
              {events.map((event) => <AuditRow event={event} key={event.id} />)}
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>

      <form className="composer" onSubmit={(event) => void submit(event)}>
        {task.status === 'pending' || task.status === 'in_progress' ? (
          <div className="resume-composer"><div><strong>{task.status === 'pending' ? 'AgentRun 已排队' : '执行由 Camp 管理'}</strong><span>{task.status === 'pending' ? 'Scheduler 会在 Runtime 和 Conversation 可用时认领；Task 在真正启动前保持 pending。' : '后续消息与运行控制将通过 CampTurn / AgentRun 协议处理。'}</span></div></div>
        ) : canResume ? (
          <div className="resume-composer"><div><strong>{task.status === 'draft' ? (isLobby ? '对话尚未开始' : '任务尚未启动') : 'Runtime 当前已停止'}</strong><span>{task.status === 'draft' ? (isLobby ? '开始后只使用大厅上下文，不访问用户项目。' : '启动后会在当前项目目录中运行 Codex。') : (isLobby ? '已保存的对话状态仍然保留，可以从结构化 Checkpoint 继续。' : '项目变更仍然保留，可以从结构化 Checkpoint 继续。')}</span></div><button type="button" className="primary-button" onClick={onStartOrResume} disabled={busy === 'task-runtime'}>{busy === 'task-runtime' ? '正在连接…' : task.status === 'draft' ? (isLobby ? '开始对话' : '启动任务') : '继续任务'}</button></div>
        ) : (
          <>
            <div className="composer-input"><label htmlFor="task-message">追加指令</label><textarea id="task-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={task.status === 'waiting_approval' ? '可先处理右侧审批，或告诉沐瓦改用更安全的方案…' : '补充约束、验收标准或下一步…'} rows={2} disabled={busy === 'send-message'} onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }} /></div>
            <div className="composer-actions">
              {isActive && <button type="button" className="danger-button" onClick={onInterrupt} disabled={busy === 'interrupt'}>{busy === 'interrupt' ? '正在停止…' : '停止 Turn'}</button>}
              <button className="primary-button" type="submit" disabled={!message.trim() || busy === 'send-message'}>{busy === 'send-message' ? '发送中…' : '发送'}</button>
            </div>
          </>
        )}
      </form>
    </section>
  )
}

function ConversationBubble({ item }: { item: ConversationItem }): JSX.Element {
  const label = item.kind === 'user' ? '你' : item.kind === 'agent' ? '沐瓦' : item.kind === 'error' ? '错误' : '系统边界'
  return (
    <article className={`conversation-bubble ${item.kind}`} aria-label={`${label}消息`}>
      <div className="bubble-meta"><span className="message-author"><i aria-hidden="true">{item.kind === 'user' ? '你' : item.kind === 'agent' ? '沐' : item.kind === 'error' ? '!' : '◇'}</i><strong>{label}</strong></span><time>{formatTime(item.time)}</time></div>
      <p>{item.text}</p>
    </article>
  )
}

function ActivityRow({ activity }: { activity: ActivityItem }): JSX.Element {
  const duration = formatDuration(activity.durationMs)
  return (
    <article className={`activity-row activity-${activity.kind}`}>
      <span className="activity-icon" aria-hidden="true">{activityIcon(activity.kind)}</span>
      <div className="activity-body">
        <div className="activity-row-title"><strong>{activity.title}</strong><span className={`activity-status status-${activity.status}`}>{activityStatusLabel(activity.status)}</span><time>{formatTime(activity.time)}</time></div>
        {activity.command && <code className="activity-command">{activity.command}</code>}
        {(activity.cwd || duration || activity.exitCode !== null) && <dl className="activity-facts">{activity.cwd && <div><dt>cwd</dt><dd><code>{activity.cwd}</code></dd></div>}{duration && <div><dt>耗时</dt><dd>{duration}</dd></div>}{activity.exitCode !== null && <div><dt>退出码</dt><dd className={activity.exitCode === 0 ? 'result-success' : 'result-failed'}>{activity.exitCode}</dd></div>}</dl>}
        {activity.detail && (activity.kind === 'command'
          ? <details className="activity-output" open={activity.status === 'failed'}><summary>命令输出</summary><pre>{activity.detail}</pre></details>
          : <p className="activity-detail">{activity.detail}</p>)}
        {activity.payload !== undefined && <details className="raw-details"><summary>原始参数</summary><pre>{jsonPreview(activity.payload)}</pre></details>}
      </div>
    </article>
  )
}

function ApprovalCard({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision(decision: string): Promise<void> }): JSX.Element {
  const summary = summarizeApproval(approval)
  const status = approval.status === 'pending' ? '等待决定' : approval.status === 'approved' ? '已允许' : '已拒绝'
  return (
    <article className={`approval-card ${approval.status}`}>
      <div className="approval-heading"><span className={`approval-status status-${approval.status}`}>{status}</span><time>{formatTime(approval.requestedAt)}</time></div>
      <h3>{summary.title}</h3>
      <dl className="approval-facts"><div><dt>请求能力</dt><dd>{summary.capability}</dd></div><div><dt>准确范围</dt><dd><pre>{summary.scope}</pre></dd></div><div><dt>请求原因</dt><dd>{summary.reason}</dd></div><div><dt>阻塞影响</dt><dd>{summary.blockingImpact}</dd></div></dl>
      {approval.status === 'pending' && <div className="decision-effects"><strong>选择后果</strong><span><b>拒绝：</b>{summary.declineEffect}</span><span><b>允许一次：</b>{summary.allowOnceEffect}</span><span><b>本次任务允许：</b>{summary.allowSessionEffect}</span></div>}
      <details className="raw-details"><summary>查看完整请求参数</summary><pre>{jsonPreview(approval.request)}</pre></details>
      {approval.status === 'pending' && <div className="approval-actions"><button className="safe-button" disabled={busy} onClick={() => void onDecision('decline')}>{busy ? '处理中…' : '拒绝'}</button><button className="danger-button" disabled={busy} title={summary.cancelEffect} onClick={() => void onDecision('cancel')}>拒绝并停止 Turn</button><button className="approve-button" disabled={busy} onClick={() => void onDecision('accept')}>允许一次</button><button className="session-approve-button" disabled={busy} onClick={() => void onDecision('acceptForSession')}>本次任务允许</button></div>}
    </article>
  )
}

function DiffView({ diff, isLobby }: { diff: GitDiff; isLobby: boolean }): JSX.Element {
  if (isLobby) return <EmptyInline text="默认大厅没有绑定项目，因此不会读取或展示任何项目 Diff。" />
  const entries = buildGitStatusEntries(diff.status, diff.patch)
  if (!entries.length && !diff.patch.trim()) return <EmptyInline text="项目相对任务起始提交没有文件变化。" />
  return (
    <div className="diff-view">
      <div className="changed-files" aria-label="文件变化">{entries.map((entry, index) => <div className="changed-file" key={`${entry.path}-${index}`}><span className={`change-kind kind-${entry.kind}`}>{entry.label}</span><code title={entry.path}>{entry.path}</code><kbd>{entry.code}</kbd></div>)}</div>
      {diff.stat && <details className="diff-summary"><summary>变更统计</summary><pre className="diff-stat">{diff.stat}</pre></details>}
      {diff.patch && <div className="diff-patch" role="region" aria-label="Unified diff">{diff.patch.split('\n').map((line, index) => <code className={`diff-line line-${diffLineKind(line)}`} key={`${index}-${line}`}><span aria-hidden="true">{index + 1}</span>{line || ' '}</code>)}</div>}
    </div>
  )
}

function AuditRow({ event }: { event: TimelineEvent }): JSX.Element {
  return <details className="audit-row"><summary><span><b>#{event.sequence}</b><strong>{event.eventType}</strong></span><span className="audit-result">{eventResult(event)}</span><time>{formatTime(event.createdAt)}</time></summary><dl className="audit-facts"><div><dt>Actor</dt><dd>{eventActor(event)}</dd></div><div><dt>动作</dt><dd>{event.eventType}</dd></div><div><dt>目标</dt><dd><code>{event.nativeMethod ?? 'lumen'}</code></dd></div></dl><pre>{jsonPreview(event.payload)}</pre></details>
}
