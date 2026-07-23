import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type RefObject
} from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AgentProfile,
  CampCreationPreflight,
  CampSnapshot,
  SelectedProjectBinding
} from '@contracts'
import { EmptyInline } from './ui-elements'
import {
  agentRunPresentation,
  agentRunWaitDetail,
  formatByteSize,
  inboxMessagePresentation
} from './ui-model'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])

export interface AgentMentionCandidate {
  agentProfileId: string
  handle: string
  displayName: string
}

interface MentionQuery {
  start: number
  end: number
  query: string
}

type MentionOption =
  | { kind: 'all'; candidates: AgentMentionCandidate[] }
  | { kind: 'agent'; candidate: AgentMentionCandidate }

export function resolveMentionedAgentIds(
  text: string,
  candidates: AgentMentionCandidate[]
): string[] {
  const candidateByHandle = new Map(
    candidates.map((candidate) => [candidate.handle.toLocaleLowerCase(), candidate.agentProfileId])
  )
  const resolved: string[] = []
  const seen = new Set<string>()
  const pattern = /(^|[^A-Za-z0-9_-])@([A-Za-z0-9][A-Za-z0-9_-]*)/g
  for (const match of text.matchAll(pattern)) {
    const agentProfileId = candidateByHandle.get(match[2].toLocaleLowerCase())
    if (agentProfileId && !seen.has(agentProfileId)) {
      seen.add(agentProfileId)
      resolved.push(agentProfileId)
    }
  }
  return resolved
}

export function mentionQueryAtCaret(text: string, caret: number): MentionQuery | null {
  const prefix = text.slice(0, caret)
  const start = prefix.lastIndexOf('@')
  if (start < 0) return null
  if (start > 0 && /[A-Za-z0-9_-]/.test(prefix[start - 1])) return null
  const query = prefix.slice(start + 1)
  if (/\s|@/.test(query)) return null
  return { start, end: caret, query }
}

function MentionTextarea({
  id,
  value,
  candidates,
  defaultRecipientName,
  placeholder,
  rows,
  disabled,
  textareaRef,
  onChange
}: {
  id: string
  value: string
  candidates: AgentMentionCandidate[]
  defaultRecipientName: string
  placeholder: string
  rows: number
  disabled: boolean
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  onChange(value: string): void
}): JSX.Element {
  const fallbackRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = textareaRef ?? fallbackRef
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [activeOption, setActiveOption] = useState(0)
  const mentionedIds = useMemo(
    () => resolveMentionedAgentIds(value, candidates),
    [candidates, value]
  )
  const mentionedIdSet = useMemo(() => new Set(mentionedIds), [mentionedIds])
  const mentionedNames = mentionedIds.map((id) =>
    candidates.find((candidate) => candidate.agentProfileId === id)?.displayName ?? id
  )
  const options = useMemo<MentionOption[]>(() => {
    if (!mentionQuery) return []
    const normalizedQuery = mentionQuery.query.toLocaleLowerCase()
    const available = candidates.filter((candidate) =>
      !mentionedIdSet.has(candidate.agentProfileId)
      && (
        candidate.handle.toLocaleLowerCase().includes(normalizedQuery)
        || candidate.displayName.toLocaleLowerCase().includes(normalizedQuery)
      )
    )
    return mentionQuery.query.length === 0 && available.length > 1
      ? [{ kind: 'all', candidates: available }, ...available.map((candidate) => ({ kind: 'agent' as const, candidate }))]
      : available.map((candidate) => ({ kind: 'agent' as const, candidate }))
  }, [candidates, mentionQuery, mentionedIdSet])
  const menuOpen = mentionQuery !== null && options.length > 0

  useEffect(() => {
    setActiveOption((current) => Math.min(current, Math.max(0, options.length - 1)))
  }, [options.length])

  const refreshMentionQuery = (target: HTMLTextAreaElement): void => {
    const caret = target.selectionStart ?? target.value.length
    setMentionQuery(mentionQueryAtCaret(target.value, caret))
    setActiveOption(0)
  }

  const changeValue = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange(event.target.value)
    refreshMentionQuery(event.target)
  }

  const selectOption = (option: MentionOption): void => {
    if (!mentionQuery) return
    const mentionText = option.kind === 'all'
      ? option.candidates.map((candidate) => `@${candidate.handle}`).join(' ')
      : `@${option.candidate.handle}`
    const suffix = value.slice(mentionQuery.end)
    const separator = suffix.startsWith(' ') ? '' : ' '
    const nextValue = `${value.slice(0, mentionQuery.start)}${mentionText}${separator}${suffix}`
    const nextCaret = mentionQuery.start + mentionText.length + separator.length
    onChange(nextValue)
    setMentionQuery(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return
    if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveOption((current) => (current + direction + options.length) % options.length)
      return
    }
    if (menuOpen && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      const option = options[activeOption]
      if (option) selectOption(option)
      return
    }
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault()
      setMentionQuery(null)
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <>
      <label htmlFor={id}>给 {mentionedNames.length > 0 ? mentionedNames.join('、') : defaultRecipientName} 发消息</label>
      <div className="mention-input-shell">
        <textarea
          ref={inputRef}
          id={id}
          value={value}
          onChange={changeValue}
          onKeyDown={handleKeyDown}
          onClick={(event) => refreshMentionQuery(event.currentTarget)}
          onSelect={(event) => refreshMentionQuery(event.currentTarget)}
          onBlur={() => setMentionQuery(null)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={`${id}-mentions`}
          aria-activedescendant={menuOpen ? `${id}-mention-${activeOption}` : undefined}
        />
        {menuOpen && (
          <div className="mention-menu" id={`${id}-mentions`} role="listbox" aria-label="选择就绪成员">
            <div className="mention-menu-heading"><strong>@ 提及成员</strong><span>选择后会创建独立 AgentRun</span></div>
            {options.map((option, index) => {
              const key = option.kind === 'all' ? 'all-ready' : option.candidate.agentProfileId
              const title = option.kind === 'all' ? '全部就绪成员' : option.candidate.displayName
              const detail = option.kind === 'all'
                ? option.candidates.map((candidate) => `@${candidate.handle}`).join(' · ')
                : `@${option.candidate.handle}`
              return (
                <button
                  id={`${id}-mention-${index}`}
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  className={index === activeOption ? 'active' : ''}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveOption(index)}
                >
                  <span className="mention-avatar" aria-hidden="true">{option.kind === 'all' ? '@' : title.slice(0, 1)}</span>
                  <span><strong>{title}</strong><small>{detail}</small></span>
                  <i aria-hidden="true" />
                </button>
              )
            })}
          </div>
        )}
      </div>
      <span className="mention-target-summary">
        {mentionedNames.length > 0
          ? `将同时唤醒 ${mentionedNames.length} 位成员`
          : `未提及时发送给 Lead · 输入 @ 选择其他就绪成员`}
      </span>
    </>
  )
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
  const mentionCandidates = preflight.readyMembers.map((member) => ({
    agentProfileId: member.agentProfileId,
    handle: member.handle,
    displayName: member.displayName
  }))
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
      await onSend(message, resolveMentionedAgentIds(message, mentionCandidates))
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
            <MentionTextarea
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
  onResolveApproval
}: {
  snapshot: CampSnapshot
  projectName: string | null
  agents: AgentProfile[]
  busy: boolean
  onSend(text: string, agentProfileIds: string[]): Promise<void>
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
  const mentionCandidates = useMemo(
    () => snapshot.members
      .filter((member) => member.membershipStatus === 'active')
      .filter((member) => profileById.get(member.agentProfileId)?.runtimeReadiness.status === 'ready')
      .map((member) => ({
        agentProfileId: member.agentProfileId,
        handle: member.handle,
        displayName: member.displayName
      })),
    [profileById, snapshot.members]
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
            <Tabs.Content value="tasks" className="tab-scroll activity-list">
              {snapshot.tasks.map((task) => <article className="activity-row" key={task.id}><span className="activity-icon" aria-hidden="true">◇</span><div className="activity-body"><div className="activity-row-title"><strong>{task.title}</strong><span className={`activity-status status-${task.status}`}>{task.status}</span></div><p className="activity-detail">{task.objective}</p></div></article>)}
              {snapshot.tasks.length === 0 && <EmptyInline text="普通对话不需要 Task；明确的工作承诺才会出现在这里。" />}
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
          <MentionTextarea
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
