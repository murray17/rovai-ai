import { useEffect, useMemo, useRef, useState, type FormEvent, type JSX, type RefObject } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AgentProfile,
  AgentRunExecutionEvidenceView,
  AgentRunView,
  CampMessageView,
  CampSnapshot,
  CampTaskStatus,
  CampTaskView,
  InboxMessageView,
  NavigationCampItem,
  StoredCommandResult,
  WorkspaceInspection
} from '@contracts'
import { EmptyInline } from './ui-elements'
import {
  AgentMentionTextarea,
  formatMentionDisplayText,
  resolveMentionedAgentIds,
  type AgentMentionCandidate
} from './AgentMentionTextarea'
import {
  agentRunPresentation,
  agentRunStateTag,
  agentRunWaitDetail,
  buildLiveExecutionProgress,
  formatByteSize,
  inboxMessagePresentation,
  type LiveExecutionProgress,
  type LiveRuntimeEvent,
  localDayKey,
  messageClockTime,
  relativeTimeLabel,
  timelineDayLabel
} from './ui-model'
import { MemberAvatar } from './MemberAvatar'
import { localizeExecutionEngineTerms } from './product-copy'
import { SafeMarkdown } from './SafeMarkdown'
import { identityColorToken } from './theme'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])

const EMPTY_CAMP_STARTERS = [
  {
    title: '先了解项目',
    body: '读取项目结构并给出可靠的起步建议。',
    prompt: '先了解当前项目结构，再告诉我最值得优先处理的三件事。'
  },
  {
    title: '整理成任务',
    body: '把目标拆分为负责人、顺序和验收点。',
    prompt: '把这次改动拆成可执行的任务，并标出需要我决策的部分。'
  },
  {
    title: '检查工作区',
    body: '确认目录、Git 能力和当前执行条件。',
    prompt: '检查当前工作区状态，先说明风险，再提出下一步。'
  }
] as const

export type CampConversationTimelineItem =
  | {
      kind: 'camp_message'
      id: string
      createdAt: string
      timelineGlobalSequence: number | null
      message: CampMessageView
    }
  | {
      kind: 'collaboration_message'
      id: string
      createdAt: string
      timelineGlobalSequence: number | null
      message: InboxMessageView
    }

export function campConversationTimeline(
  messages: CampMessageView[],
  inboxMessages: InboxMessageView[]
): CampConversationTimelineItem[] {
  const publicMessages: CampConversationTimelineItem[] = messages
    .filter((message) => (message.presentation as { kind?: string } | null)?.kind !== 'a2a_event')
    .map((message) => ({
      kind: 'camp_message',
      id: message.id,
      createdAt: message.createdAt,
      timelineGlobalSequence: message.timelineGlobalSequence,
      message
    }))
  const collaborationMessages: CampConversationTimelineItem[] = inboxMessages
    .filter((message) => message.deliveredAt !== null && message.failedAt === null)
    .map((message) => ({
      kind: 'collaboration_message',
      id: message.id,
      createdAt: message.createdAt,
      timelineGlobalSequence: message.timelineGlobalSequence,
      message
    }))

  return [...publicMessages, ...collaborationMessages].sort((left, right) => {
    if (left.timelineGlobalSequence !== null && right.timelineGlobalSequence !== null) {
      const sequenceOrder = left.timelineGlobalSequence - right.timelineGlobalSequence
      if (sequenceOrder !== 0) return sequenceOrder
    }
    const timeOrder = left.createdAt.localeCompare(right.createdAt)
    if (timeOrder !== 0) return timeOrder
    const kindOrder = left.kind.localeCompare(right.kind)
    return kindOrder !== 0 ? kindOrder : left.id.localeCompare(right.id)
  })
}

export function runtimeOptionsForDisplay(options: ActionApprovalView['options']): ActionApprovalView['options'] {
  const priority: Record<ActionApprovalView['options'][number]['kind'], number> = {
    cancel: 0,
    deny: 1,
    other: 2,
    allow_once: 3,
    allow_session: 4
  }
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => priority[left.option.kind] - priority[right.option.kind] || left.index - right.index)
    .map(({ option }) => option)
}

function workspaceCapabilityStatus(
  snapshot: CampSnapshot,
  inspection: WorkspaceInspection | 'unavailable' | null
): {
  label: string
  detail: string
  tone: 'clean' | 'neutral' | 'attention'
} {
  if (snapshot.camp.projectBindingKind === 'quick_chat') {
    return { label: '快速对话', detail: 'Rovai-ai 管理的快速对话工作区', tone: 'neutral' }
  }
  if (inspection === 'unavailable') {
    return { label: '工作区不可用', detail: '目录当前无法读取；本次 Agent Run 不会启动。', tone: 'attention' }
  }
  if (!inspection) {
    return { label: '正在检查', detail: '正在探测当前目录能力。', tone: 'neutral' }
  }
  if (inspection.gitObservation.state === 'not_git') {
    return { label: '普通目录', detail: '文件工作可用，Git 相关功能当前不可用。', tone: 'neutral' }
  }
  if (inspection.gitObservation.state === 'git_invalid') {
    return { label: 'Git 状态异常', detail: '普通文件工作可继续，Git 相关功能暂时禁用。', tone: 'attention' }
  }
  return inspection.gitObservation.headCommit
    ? { label: 'Git 仓库', detail: 'Git 相关功能当前可用。', tone: 'clean' }
    : { label: '空 Git 仓库', detail: 'Git 能力可用，尚无首个提交。', tone: 'clean' }
}

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
      return { label: '执行引擎不支持', tone: 'neutral', mark: '–' }
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
      return { label: '执行引擎不支持', tone: 'attention', mark: '◐' }
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

export function emptyCampRuntimeSummary(
  members: CampSnapshot['members'],
  agents: AgentProfile[]
): string {
  const activeMembers = members.filter((member) =>
    member.membershipStatus === 'active' && member.profilePresence === 'present'
  )
  if (activeMembers.length === 0) return '暂无在队成员'

  const profileById = new Map(agents.map((agent) => [agent.id, agent]))
  const profiles = activeMembers.map((member) => profileById.get(member.agentProfileId))
  if (profiles.some((profile) => !profile)) return '正在检查执行引擎…'

  const readyCount = profiles.filter((profile) => profile?.runtimeReadiness.status === 'ready').length
  if (readyCount === activeMembers.length) return '执行引擎已就绪'
  if (readyCount === 0) return '执行引擎未就绪'
  return `${readyCount}/${activeMembers.length} 个执行引擎就绪`
}

export function QuickChatWorkspace({
  agents,
  recentCamps,
  onOpenCamp,
  onNewConversation
}: {
  agents: AgentProfile[]
  recentCamps: NavigationCampItem[]
  onOpenCamp(camp: NavigationCampItem): void
  onNewConversation(): void
}): JSX.Element {
  return (
    <section className="workspace-shell new-conversation-workspace quick-chat-workspace" aria-label="快速对话">
      <div className="new-conversation-main">
        <div className="new-conversation-stage">
          <svg className="quick-chat-mark" width="96" height="66" viewBox="0 0 72 56" aria-hidden="true">
            <path d="M36 4 L38.8 15.2 L50 18 L38.8 20.8 L36 32 L33.2 20.8 L22 18 L33.2 15.2 Z" fill="var(--brand)" />
            <path d="M8 52 Q36 35 64 52" stroke="var(--brand)" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="36" cy="46.5" r="3" fill="var(--ember)" />
          </svg>
          <p className="eyebrow quick-chat-eyebrow">Arctic Dawn · Quick Chat</p>
          <h2>在晨光里，开始下一段协作</h2>
          <p className="quick-chat-subline">创建一个对话，选好伙伴与工作区，再写下这次协作的目标。</p>
          {recentCamps.length > 0 && (
            <div className="quick-chat-continue" aria-label="继续未完成的事">
              <div className="quick-chat-continue-title">继续未完成的事</div>
              {recentCamps.map((camp) => (
                <button className="quick-chat-continue-row" type="button" key={camp.id} onClick={() => onOpenCamp(camp)}>
                  <i className={`task-dot camp-marker-${camp.marker}`} aria-hidden="true" />
                  <span className="truncate">{formatMentionDisplayText(camp.title, agents)}</span>
                  <small>{relativeTimeLabel(camp.lastActivityAt)}</small>
                </button>
              ))}
            </div>
          )}
          {recentCamps.length === 0 && (
            <div className="quick-chat-empty">
              <p>这里还没有可继续的对话。</p>
              <button className="primary-button" type="button" onClick={onNewConversation}>新对话</button>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export function CampWorkspace({
  snapshot,
  optimisticMessages = [],
  projectName,
  workspaceInspection = null,
  agents,
  liveRuntimeEvents = [],
  busy,
  onSend,
  onChangeLead,
  onSetMemoryWrite,
  onTasksChanged,
  onResolveApproval,
  stopping,
  onStop
}: {
  snapshot: CampSnapshot
  optimisticMessages?: CampMessageView[]
  projectName: string | null
  workspaceInspection?: WorkspaceInspection | 'unavailable' | null
  agents: AgentProfile[]
  liveRuntimeEvents?: LiveRuntimeEvent[]
  busy: boolean
  onSend(text: string, agentProfileIds: string[]): Promise<void>
  onChangeLead(agentProfileId: string): Promise<void>
  onSetMemoryWrite(agentProfileId: string, expectedVersion: number, enabled: boolean): Promise<void>
  onTasksChanged(): Promise<void>
  onResolveApproval(approval: ActionApprovalView, optionId: string): void
  stopping: boolean
  onStop(): void
}): JSX.Element {
  const [message, setMessage] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const approvalDockRef = useRef<HTMLElement>(null)
  const lastTimelineItemId = useRef<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState('activity')
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [taskFocusRequest, setTaskFocusRequest] = useState(0)
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
  const visibleCampMessages = useMemo(() => {
    const persistedIds = new Set(snapshot.messages.map((message) => message.id))
    return [
      ...snapshot.messages,
      ...optimisticMessages.filter((message) => !persistedIds.has(message.id))
    ]
  }, [optimisticMessages, snapshot.messages])
  const conversationTimeline = useMemo(
    () => campConversationTimeline(visibleCampMessages, snapshot.inboxMessages),
    [snapshot.inboxMessages, visibleCampMessages]
  )
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
  const workspaceStatus = workspaceCapabilityStatus(snapshot, workspaceInspection)
  const defaultLeadProfile = defaultLead ? profileById.get(defaultLead.agentProfileId) ?? null : null
  const defaultLeadReady = defaultLeadProfile?.runtimeReadiness.status === 'ready'
  const activeRuns = snapshot.agentRuns.filter((run) => NON_TERMINAL_RUNS.has(run.status))
  const messageRunIds = new Set(snapshot.messages.flatMap((campMessage) =>
    campMessage.sourceAgentRunId ? [campMessage.sourceAgentRunId] : []
  ))
  const runsWithoutMessage = snapshot.agentRuns
    .filter((run) => !messageRunIds.has(run.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === 'pending')
  const previousPendingApprovalCount = useRef(pendingApprovals.length)
  const executionEvents = useMemo(() => {
    const events = new Map<string, LiveRuntimeEvent>()
    for (const evidence of snapshot.executionEvidence) {
      events.set(evidence.id, {
        id: evidence.id,
        agentRunId: evidence.agentRunId,
        eventType: evidence.eventType,
        payload: evidence.payload,
        createdAt: evidence.occurredAt
      })
    }
    for (const event of liveRuntimeEvents) {
      if (!events.has(event.id)) events.set(event.id, event)
    }
    return [...events.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }, [liveRuntimeEvents, snapshot.executionEvidence])
  const executionProgressByRunId = useMemo(
    () => new Map(snapshot.agentRuns.map((run) => [
      run.id,
      buildLiveExecutionProgress(executionEvents, run.id)
    ])),
    [executionEvents, snapshot.agentRuns]
  )
  const truncatedEvidenceByRunId = useMemo(() => {
    const grouped = new Map<string, AgentRunExecutionEvidenceView[]>()
    for (const evidence of snapshot.executionEvidence) {
      if (!evidence.isTruncated) continue
      grouped.set(evidence.agentRunId, [...(grouped.get(evidence.agentRunId) ?? []), evidence])
    }
    return grouped
  }, [snapshot.executionEvidence])

  useEffect(() => {
    const previousCount = previousPendingApprovalCount.current
    previousPendingApprovalCount.current = pendingApprovals.length
    if (pendingApprovals.length >= previousCount) return
    if (pendingApprovals.length === 0) {
      textareaRef.current?.focus()
      return
    }
    approvalDockRef.current
      ?.querySelector<HTMLButtonElement>('.runtime-option:not(:disabled)')
      ?.focus()
  }, [pendingApprovals.length])

  useEffect(() => {
    if (!busy) textareaRef.current?.focus()
  }, [busy])

  useEffect(() => {
    const nextLastId = conversationTimeline.at(-1)?.id ?? null
    if (!nextLastId || nextLastId === lastTimelineItemId.current) return
    lastTimelineItemId.current = nextLastId
    const scroll = timelineScrollRef.current
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }, [conversationTimeline])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (activeRuns.length > 0 || !message.trim() || busy) return
    try {
      await onSend(message, resolveMentionedAgentIds(message, mentionCandidates))
      setMessage('')
    } catch {
      // Parent owns the failure Toast; keep the draft in place.
      textareaRef.current?.focus()
    }
  }

  const copyMessage = (id: string, body: string): void => {
    void writeClipboardText(body).then((copied) => {
      if (!copied) return
      setCopiedMessageId(id)
      window.setTimeout(() => {
        setCopiedMessageId((current) => current === id ? null : current)
      }, 1_600)
    })
  }

  const chooseStarterPrompt = (prompt: string): void => {
    setMessage(prompt)
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(prompt.length, prompt.length)
    })
  }

  return (
    <section className="workspace-shell camp-workspace" aria-label={`Camp：${formatMentionDisplayText(snapshot.camp.title, snapshot.members)}`}>
      <div className="workspace-grid">
        <section className="timeline-pane">
          <div className="timeline-scroll camp-timeline" ref={timelineScrollRef}>
            <div className="timeline-track">
              {(() => {
                const items: JSX.Element[] = []
                let lastDayKey = ''
                for (const timelineItem of conversationTimeline) {
                  const dayKey = localDayKey(timelineItem.createdAt)
                  if (dayKey && dayKey !== lastDayKey) {
                    lastDayKey = dayKey
                    items.push(
                      <div className="timeline-node timeline-day" key={`day-${dayKey}`}>
                        {timelineDayLabel(timelineItem.createdAt, snapshot.camp.createdAt)}
                      </div>
                    )
                  }
                  if (timelineItem.kind === 'collaboration_message') {
                    const inboxMessage = timelineItem.message
                    const sender = memberById.get(inboxMessage.senderAgentId)
                    const recipient = memberById.get(inboxMessage.recipientAgentId)
                    const senderName = sender?.displayName ?? inboxMessage.senderAgentId
                    const recipientName = recipient?.displayName ?? inboxMessage.recipientAgentId
                    const displayBody = formatMentionDisplayText(inboxMessage.body, snapshot.members)
                    items.push(
                      <article
                        className="timeline-node conversation-bubble agent collaboration-message"
                        key={inboxMessage.id}
                        style={sender ? { '--agent-accent': identityColorToken(sender.agentProfileId) } as React.CSSProperties : undefined}
                      >
                        <MemberAvatar
                          agentProfileId={inboxMessage.senderAgentId}
                          avatarRef={sender?.avatarRef ?? null}
                          displayName={senderName}
                          size="list"
                          decorative
                        />
                        <div className="message-body">
                          <div className="bubble-meta">
                            <strong>{senderName}</strong>
                            <span className="collaboration-recipient">→ @{recipientName}</span>
                            <time title={inboxMessage.id}>{messageClockTime(inboxMessage.createdAt)}</time>
                            <MessageCopyButton
                              copied={copiedMessageId === inboxMessage.id}
                              onCopy={() => copyMessage(inboxMessage.id, displayBody)}
                            />
                          </div>
                          <div className="final-copy collaboration-card">
                            <SafeMarkdown>{displayBody}</SafeMarkdown>
                          </div>
                        </div>
                      </article>
                    )
                    continue
                  }
                  const campMessage = timelineItem.message
                  const member = memberById.get(campMessage.authorId)
                  const author = campMessage.authorType === 'user'
                    ? '你'
                    : member?.displayName ?? (campMessage.authorType === 'system' ? '系统' : campMessage.authorId)
                  const authorProfile = profileById.get(campMessage.authorId) ?? null
                  const sourceRun = campMessage.sourceAgentRunId
                    ? runById.get(campMessage.sourceAgentRunId) ?? null
                    : null
                  const displayBody = formatMentionDisplayText(campMessage.body, snapshot.members)
                  items.push(
                    <article
                      className={`timeline-node conversation-bubble ${campMessage.authorType}`}
                      key={campMessage.id}
                      style={member ? { '--agent-accent': identityColorToken(member.agentProfileId) } as React.CSSProperties : undefined}
                    >
                      {campMessage.authorType === 'agent' && (
                        <MemberAvatar
                          agentProfileId={campMessage.authorId}
                          avatarRef={member?.avatarRef ?? null}
                          displayName={author}
                          size="list"
                          decorative
                        />
                      )}
                      {campMessage.authorType === 'user' && (
                        <span className="local-message-avatar" aria-hidden="true">你</span>
                      )}
                      {(campMessage.authorType === 'user' || campMessage.authorType === 'agent')
                        ? (
                            <div className="message-body">
                              <div className="bubble-meta">
                                <strong>{author}</strong>
                                {campMessage.authorType === 'agent' && authorProfile?.runtimeSelection && (
                                  <span>{runtimeAdapterLabel(authorProfile.runtimeSelection.adapterKind)}</span>
                                )}
                                <time title={`#${campMessage.sequence}`}>{messageClockTime(campMessage.createdAt)}</time>
                                <MessageCopyButton
                                  copied={copiedMessageId === campMessage.id}
                                  onCopy={() => copyMessage(campMessage.id, displayBody)}
                                />
                              </div>
                              {campMessage.presentation?.kind === 'task_event'
                                ? (
                                    <TaskBoundaryEvent
                                      message={campMessage}
                                      onOpen={() => {
                                        const presentation = campMessage.presentation
                                        if (presentation?.kind !== 'task_event') return
                                        setFocusedTaskId(presentation.taskId)
                                        setTaskFocusRequest((request) => request + 1)
                                        setInspectorTab('tasks')
                                      }}
                                    />
                                  )
                                : campMessage.authorType === 'agent'
                                    ? (
                                        <>
                                          {sourceRun && (
                                            <RunExecutionDisclosure
                                              run={sourceRun}
                                              progress={executionProgressByRunId.get(sourceRun.id)}
                                              campId={snapshot.camp.id}
                                              truncatedEvidence={truncatedEvidenceByRunId.get(sourceRun.id)}
                                              finalBody={displayBody}
                                            />
                                          )}
                                          <div className="final-copy">
                                            <SafeMarkdown>{displayBody}</SafeMarkdown>
                                          </div>
                                        </>
                                      )
                                    : <div className="message-bubble"><p>{displayBody}</p></div>}
                            </div>
                          )
                        : campMessage.presentation?.kind === 'task_event'
                          ? (
                              <TaskBoundaryEvent
                                message={campMessage}
                                onOpen={() => {
                                  const presentation = campMessage.presentation
                                  if (presentation?.kind !== 'task_event') return
                                  setFocusedTaskId(presentation.taskId)
                                  setTaskFocusRequest((request) => request + 1)
                                  setInspectorTab('tasks')
                                }}
                              />
                            )
                          : <p>{displayBody}</p>}
                    </article>
                  )
                }
                return items
              })()}
              {conversationTimeline.length === 0 && runsWithoutMessage.length === 0 && (
                <EmptyCampWelcome
                  snapshot={snapshot}
                  projectName={projectName}
                  agents={agents}
                  onChoosePrompt={chooseStarterPrompt}
                />
              )}
              {runsWithoutMessage.map((run) => (
                <AgentRunConversationMessage
                  key={run.id}
                  run={run}
                  member={memberById.get(run.agentProfileId) ?? null}
                  profile={profileById.get(run.agentProfileId) ?? null}
                  progress={executionProgressByRunId.get(run.id)}
                  campId={snapshot.camp.id}
                  truncatedEvidence={truncatedEvidenceByRunId.get(run.id)}
                />
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
                      <p className="activity-detail">{formatMentionDisplayText(inboxMessage.body, snapshot.members)}</p>
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
                focusTaskId={focusedTaskId}
                focusRequest={taskFocusRequest}
                onTasksChanged={onTasksChanged}
              />
            </Tabs.Content>
            <Tabs.Content value="context" className="tab-scroll context-panel">
              <section className="camp-context-controls" aria-label="Camp 协作设置">
                <div className="context-control-heading">
                  <div>
                    <strong>{projectName ?? '快速对话'}</strong>
                    <span className={`workspace-summary ${workspaceStatus.tone}`} title={workspaceStatus.detail}>{workspaceStatus.label}</span>
                  </div>
                  {!defaultLeadReady && <small>{defaultLead?.displayName ?? 'Default Lead'} 的执行引擎未就绪</small>}
                </div>
                <label>
                  <span>Default Lead</span>
                  <select
                    value={defaultLead?.agentProfileId ?? ''}
                    disabled={busy}
                    onChange={(event) => void onChangeLead(event.currentTarget.value).catch(() => undefined)}
                  >
                    {snapshot.members.filter((member) =>
                      member.membershipStatus === 'active' && member.profilePresence === 'present'
                    ).map((member) => (
                      <option value={member.agentProfileId} key={member.agentProfileId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="context-memory-controls">
                  <strong>长期记忆写入</strong>
                  {snapshot.members.filter((member) => member.membershipStatus === 'active').map((member) => (
                    <label key={member.agentProfileId}>
                      <input
                        type="checkbox"
                        checked={member.memoryWriteEnabled}
                        disabled={busy}
                        onChange={(event) => void onSetMemoryWrite(
                          member.agentProfileId,
                          member.version,
                          event.currentTarget.checked
                        ).catch(() => undefined)}
                      />
                      <span>{member.displayName}</span>
                    </label>
                  ))}
                </div>
              </section>
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
                      <div><dt>Bootstrap</dt><dd>{manifest.bootstrap.deliveryMode === 'native_append' ? 'Native append' : 'First payload'}</dd></div>
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

                    {manifest.runNoticeRefs.length > 0 && (
                      <div className="context-subsection">
                        <div className="context-subsection-title"><strong>Run Notices</strong><small>冻结时已知的异常行动事实</small></div>
                        {manifest.runNoticeRefs.map((notice) => <code key={notice}>{notice}</code>)}
                      </div>
                    )}

                    {manifest.attachmentProjections.length > 0 && (
                      <div className="context-subsection">
                        <div className="context-subsection-title"><strong>Run Attachment Projection</strong><small>只读且已冻结内容摘要</small></div>
                        {manifest.attachmentProjections.map((attachment) => <div className="context-attachment" key={attachment.projectionId}><div><strong>{shortIdentity(attachment.attachmentId)}</strong><small>{attachment.contentDigest}</small></div><code title={attachment.projectedPath}>{attachment.projectedPath}</code></div>)}
                      </div>
                    )}

                    <div className="context-subsection">
                      <div className="context-subsection-title">
                        <strong>Skill 暴露</strong>
                        <small>记录投影，不代表执行引擎已加载正文</small>
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
                        <p className="context-alert">本轮 MCP 配置无效，未向执行引擎暴露外部 MCP。</p>
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
                      <dl><div><dt>Payload</dt><dd><code>{manifest.renderedPayloadDigest}</code></dd></div><div><dt>Session Charter</dt><dd><code>{manifest.bootstrap.sessionCharterDigest}</code></dd></div><div><dt>Memory Entrypoint</dt><dd><code>{manifest.bootstrap.memoryEntrypointDigest}</code></dd></div><div><dt>Collaboration</dt><dd><code>{manifest.collaborationStateDigest}</code></dd></div><div><dt>Run Notices</dt><dd><code>{manifest.runNoticeDigest}</code></dd></div><div><dt>Attachments</dt><dd><code>{manifest.attachmentProjectionDigest}</code></dd></div><div><dt>Skill</dt><dd><code>{manifest.skillExposureDigest}</code></dd></div><div><dt>MCP</dt><dd><code>{manifest.mcpExposureDigest}</code></dd></div></dl>
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
                  <h3>{localizeExecutionEngineTerms(approval.actionSummary)}</h3>
                  <p className="approval-runtime">{profileById.get(approval.agentProfileId)?.displayName ?? approval.agentProfileId} · {approval.adapterKind}</p>
                  <p className="approval-reason">{localizeExecutionEngineTerms(approval.reason ?? '执行引擎请求你选择一个原生权限选项。')}</p>
                  <pre>{JSON.stringify(approval.canonicalInput, null, 2)}</pre>
                  <div className="approval-actions">
                    {runtimeOptionsForDisplay(approval.options).map((option) => (
                      <button
                        className={`runtime-option option-${option.kind}`}
                        type="button"
                        key={option.optionId}
                        onClick={() => onResolveApproval(approval, option.optionId)}
                        disabled={busy}
                      >
                        <strong>{localizeExecutionEngineTerms(option.label)}</strong>
                        <small>{localizeExecutionEngineTerms(option.consequence)}</small>
                      </button>
                    ))}
                    {approval.options.length === 0 && <p className="approval-option-error">当前执行引擎未提供可无损回传的原生选项，请求无法提交。</p>}
                  </div>
                </article>
              ))}
              {pendingApprovals.length === 0 && (
                <EmptyInline text="当前没有待处理审批；请求会固定显示在输入框正上方，并可在这里查看详情。" />
              )}
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

      {pendingApprovals.length > 0 && (
        <ApprovalDock
          approvals={pendingApprovals}
          profileById={profileById}
          busy={busy}
          onResolve={onResolveApproval}
          containerRef={approvalDockRef}
        />
      )}

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
            {activeRuns.length === 0 && <span className="composer-hint">Enter</span>}
            {activeRuns.length > 0
              ? (
                  <button
                    className="danger-button composer-stop"
                    type="button"
                    aria-label="停止当前执行"
                    onClick={onStop}
                    disabled={stopping}
                  >
                    {stopping ? '正在停止…' : '停止'}
                  </button>
                )
              : <button className="primary-button composer-send" type="submit" disabled={!message.trim() || busy}>{busy ? '发送中…' : '发送'}</button>}
          </div>
        </div>
      </form>
    </section>
  )
}

function ApprovalDock({
  approvals,
  profileById,
  busy,
  onResolve,
  containerRef
}: {
  approvals: ActionApprovalView[]
  profileById: Map<string, AgentProfile>
  busy: boolean
  onResolve(approval: ActionApprovalView, optionId: string): void
  containerRef: RefObject<HTMLElement | null>
}): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  const currentIndex = Math.min(activeIndex, approvals.length - 1)
  const approval = approvals[currentIndex]
  const memberNames = [...new Set(approvals.map((item) =>
    profileById.get(item.agentProfileId)?.displayName ?? item.agentProfileId
  ))]

  useEffect(() => {
    if (activeIndex >= approvals.length) setActiveIndex(Math.max(approvals.length - 1, 0))
  }, [activeIndex, approvals.length])

  return (
    <section className="approval-dock" aria-label={`${approvals.length} 项待审批`} ref={containerRef}>
      <header>
        <div>
          <strong>{approvals.length > 1 ? `${approvals.length} 项待审批` : '待审批'}</strong>
          <span>{memberNames.join('、')}</span>
        </div>
        {approvals.length > 1 && (
          <nav aria-label="切换审批请求">
            <button type="button" aria-label="上一项审批" disabled={currentIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}>‹</button>
            <span>{currentIndex + 1} / {approvals.length}</span>
            <button type="button" aria-label="下一项审批" disabled={currentIndex === approvals.length - 1} onClick={() => setActiveIndex((index) => Math.min(approvals.length - 1, index + 1))}>›</button>
          </nav>
        )}
      </header>
      <div className="approval-dock-scroll">
        <div className="approval-dock-title">
          <strong>{localizeExecutionEngineTerms(approval.actionSummary)}</strong>
          <code>{approval.adapterKind} · {approval.actionKind}</code>
        </div>
        <p>{localizeExecutionEngineTerms(approval.reason ?? '执行引擎请求你选择一个原生权限选项。')}</p>
        <pre>{JSON.stringify(approval.canonicalInput, null, 2)}</pre>
        <div className="approval-dock-actions">
          {runtimeOptionsForDisplay(approval.options).map((option) => (
            <button
              className={`runtime-option option-${option.kind}`}
              type="button"
              key={option.optionId}
              onClick={() => onResolve(approval, option.optionId)}
              disabled={busy}
            >
              <strong>{localizeExecutionEngineTerms(option.label)}</strong>
              <small>{localizeExecutionEngineTerms(option.consequence)}</small>
            </button>
          ))}
          {approval.options.length === 0 && (
            <p className="approval-option-error">当前执行引擎未提供可无损回传的原生选项，请求无法提交。</p>
          )}
        </div>
      </div>
    </section>
  )
}

function EmptyCampWelcome({
  snapshot,
  projectName,
  agents,
  onChoosePrompt
}: {
  snapshot: CampSnapshot
  projectName: string | null
  agents: AgentProfile[]
  onChoosePrompt(prompt: string): void
}): JSX.Element {
  const activeMembers = snapshot.members.filter((member) =>
    member.membershipStatus === 'active' && member.profilePresence === 'present'
  )
  const lead = activeMembers.find((member) => member.isDefaultLead)
    ?? snapshot.members.find((member) => member.isDefaultLead)
    ?? null
  const projectLabel = snapshot.camp.projectBindingKind === 'quick_chat'
    ? '快速对话'
    : projectName ?? '当前项目'

  return (
    <section className="empty-camp-welcome" aria-labelledby="empty-camp-title">
      <svg className="empty-camp-mark" viewBox="0 0 88 66" aria-hidden="true">
        <defs>
          <linearGradient id="empty-camp-horizon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--aurora)" />
            <stop offset=".52" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--violet)" />
          </linearGradient>
        </defs>
        <path d="M44 5l2.1 9.4 9.4 2.1-9.4 2.1L44 28l-2.1-9.4-9.4-2.1 9.4-2.1L44 5z" fill="var(--brand)" />
        <path d="M10 48c9-11 19-16 30-15 9 .8 14 7 22 7 6 0 11-2 16-6" fill="none" stroke="url(#empty-camp-horizon)" strokeLinecap="round" strokeWidth="3" />
        <path d="M14 54h60" fill="none" stroke="var(--line-strong)" strokeLinecap="round" />
        <circle cx="69" cy="25" r="3" fill="var(--ember)" />
      </svg>
      <p className="empty-camp-eyebrow">Arctic Dawn · New Camp</p>
      <h2 id="empty-camp-title">开始这段协作</h2>
      <p className="empty-camp-description">
        这里已经保留当前工作区、成员和 Default Lead。发送第一条消息后，公共讨论、执行过程和最终结论会依次展开。
      </p>

      <div className="empty-camp-context" aria-label="当前 Camp 上下文">
        <span><i aria-hidden="true">⌂</i><strong>{projectLabel}</strong></span>
        <span className="empty-camp-lead">
          {lead && (
            <MemberAvatar
              agentProfileId={lead.agentProfileId}
              avatarRef={lead.avatarRef}
              displayName={lead.displayName}
              size="mention"
              decorative
              className="empty-camp-avatar"
            />
          )}
          <strong>{lead ? `Lead · ${lead.displayName}` : 'Default Lead 未设置'}</strong>
        </span>
        <span><i aria-hidden="true">◎</i><strong>{activeMembers.length} 位成员已在队</strong></span>
        <span><i className="empty-camp-readiness" aria-hidden="true" /><strong>{emptyCampRuntimeSummary(snapshot.members, agents)}</strong></span>
      </div>

      <div className="starter-prompts" aria-label="起步建议">
        {EMPTY_CAMP_STARTERS.map((starter) => (
          <button type="button" key={starter.title} onClick={() => onChoosePrompt(starter.prompt)}>
            <strong>{starter.title}</strong>
            <span>{starter.body}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function MessageCopyButton({
  copied,
  onCopy
}: {
  copied: boolean
  onCopy(): void
}): JSX.Element {
  return (
    <button
      className="message-copy-button"
      type="button"
      aria-label="复制这条消息"
      title="复制这条消息"
      onClick={onCopy}
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function TaskBoundaryEvent({
  message,
  onOpen
}: {
  message: CampMessageView
  onOpen(): void
}): JSX.Element | null {
  const presentation = message.presentation
  if (presentation?.kind !== 'task_event') return null
  return (
    <button className="timeline-event-card task-event-card" type="button" onClick={onOpen}>
      <span className={`event-card-status status-${presentation.toStatus}`}>
        {taskStatusLabel(presentation.toStatus)}
      </span>
      <strong>{presentation.titleAtEvent}</strong>
      <small>
        {presentation.fromStatus ? `${taskStatusLabel(presentation.fromStatus)} → ` : ''}
        {taskStatusLabel(presentation.toStatus)}
        {presentation.assigneeNameAtEvent ? ` · ${presentation.assigneeNameAtEvent}` : ''}
      </small>
    </button>
  )
}

function AgentRunConversationMessage({
  run,
  member,
  profile,
  progress,
  campId,
  truncatedEvidence = []
}: {
  run: AgentRunView
  member: CampSnapshot['members'][number] | null
  profile: AgentProfile | null
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
}): JSX.Element {
  const memberName = member?.displayName ?? profile?.displayName ?? run.agentProfileId
  const presentation = agentRunPresentation(run)
  return (
    <article
      className="timeline-node conversation-bubble agent agent-run-message"
      style={{ '--agent-accent': identityColorToken(run.agentProfileId) } as React.CSSProperties}
      aria-label={`${memberName}的执行过程`}
    >
      <MemberAvatar
        agentProfileId={run.agentProfileId}
        avatarRef={member?.avatarRef ?? profile?.avatarRef ?? null}
        displayName={memberName}
        size="list"
        decorative
      />
      <div className="message-body">
        <div className="bubble-meta">
          <strong>{memberName}</strong>
          {profile?.runtimeSelection && <span>{runtimeAdapterLabel(profile.runtimeSelection.adapterKind)}</span>}
          <time title={run.id}>{messageClockTime(run.startedAt ?? run.createdAt)}</time>
          <span className={`run-message-state tone-${presentation.tone}`}>{presentation.label}</span>
        </div>
        <RunExecutionDisclosure
          run={run}
          progress={progress}
          campId={campId}
          truncatedEvidence={truncatedEvidence}
        />
      </div>
    </article>
  )
}

function RunExecutionDisclosure({
  run,
  progress,
  campId,
  truncatedEvidence = [],
  finalBody = null
}: {
  run: AgentRunView
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
  finalBody?: string | null
}): JSX.Element | null {
  const active = NON_TERMINAL_RUNS.has(run.status)
  const [open, setOpen] = useState(active)
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, unknown>>({})
  const [loadingEvidenceId, setLoadingEvidenceId] = useState<string | null>(null)
  useEffect(() => setOpen(active), [active])

  const finalKey = finalBody ? comparableMessageText(finalBody) : null
  const processItems = (progress?.items ?? []).filter((item) =>
    item.kind !== 'narration' || !finalKey || comparableMessageText(item.body) !== finalKey
  )
  const hasProgress = processItems.length > 0
  if (!active && !hasProgress && truncatedEvidence.length === 0 && !run.hasUnsettledExternalEffects) {
    return null
  }

  const content = (
    <div className="process-content">
      {run.hasUnsettledExternalEffects && (
        <p className="execution-uncertain" role="status">
          {run.status === 'cancelled' ? '已停止 · 结果待确认' : '仍有外部效果待确认'}
        </p>
      )}
      {processItems.map((item) => {
        if (item.kind === 'reasoning' || item.kind === 'narration') {
          return (
            <div className={`process-copy stream-${item.kind}`} key={item.key}>
              <SafeMarkdown>{item.body}</SafeMarkdown>
            </div>
          )
        }
        if (item.kind === 'plan') {
          return (
            <div className="process-plan live-progress-plan" key={item.key}>
              {item.explanation && <SafeMarkdown>{item.explanation}</SafeMarkdown>}
              {item.plan.length > 0 && (
                <ol>
                  {item.plan.map((step, index) => (
                    <li className={`plan-${step.status}`} key={`${index}:${step.step}`}>
                      <span aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '●' : '○'}</span>
                      <span>{step.step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        }
        if (item.kind !== 'tool') return null
        const step = item.step
        return (
          <details className={`process-action tool-call-disclosure status-${step.status}`} key={item.key}>
            <summary>
              <ToolCallIcon title={step.title} status={step.status} />
              <span className="tool-call-title">{step.title}</span>
              <span className={`tool-call-result status-${step.status}`}>
                {toolCallStatusLabel(step.status)}
              </span>
              <span className="tool-call-chevron" aria-hidden="true">⌄</span>
            </summary>
            {step.detail && <pre>{step.detail}</pre>}
          </details>
        )
      })}
      {truncatedEvidence.length > 0 && (
        <section className="truncated-evidence">
          <strong>完整证据</strong>
          {truncatedEvidence.map((evidence) => (
            <div key={evidence.id}>
              <button
                className="quiet-button compact"
                type="button"
                disabled={loadingEvidenceId === evidence.id}
                onClick={() => {
                  setLoadingEvidenceId(evidence.id)
                  void window.rovai.request<{ payload: unknown }>('agentRunEvidence.getContent', {
                    campId,
                    evidenceId: evidence.id
                  }).then((result) => {
                    setExpandedPayloads((current) => ({
                      ...current,
                      [evidence.id]: result.payload
                    }))
                  }).catch(() => undefined)
                    .finally(() => setLoadingEvidenceId(null))
                }}
              >
                {loadingEvidenceId === evidence.id ? '正在读取…' : `查看完整${evidenceKindLabel(evidence.kind)}`}
              </button>
              {Object.prototype.hasOwnProperty.call(expandedPayloads, evidence.id) && (
                <pre>{JSON.stringify(expandedPayloads[evidence.id], null, 2)}</pre>
              )}
            </div>
          ))}
        </section>
      )}
      {active && (
        <div className="process-action current" role="status">
          <span className="process-spinner" aria-hidden="true" />
          <span>{run.status === 'waiting'
            ? agentRunWaitDetail(run.waitReason) ?? '等待继续'
            : run.status === 'queued'
              ? '等待开始'
              : progress?.reasoningStreaming
                ? '正在整理思路'
                : '正在处理'}</span>
        </div>
      )}
    </div>
  )

  if (active) {
    return <div className="execution-disclosure run-live is-running">{content}</div>
  }
  return (
    <details
      className="execution-disclosure worked is-terminal"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{runDurationLabel(run)}</span>
        <span className="process-chevron" aria-hidden="true">⌄</span>
      </summary>
      {content}
    </details>
  )
}

function ToolCallIcon({
  title,
  status
}: {
  title: string
  status: string
}): JSX.Element {
  const command = title.includes('命令')
  return (
    <span className={`tool-call-icon status-${status}`} aria-hidden="true">
      {command ? '>_' : '▱'}
    </span>
  )
}

function toolCallStatusLabel(status: string): string {
  return ({
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    waiting: '等待审批'
  } as Record<string, string>)[status] ?? status
}

function comparableMessageText(value: string): string {
  return value.replace(/[\s*_`#>-]+/g, '').toLocaleLowerCase()
}

function runtimeAdapterLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex CLI',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'antigravity-app': 'Antigravity'
  } as Record<string, string>)[kind] ?? kind
}

function runDurationLabel(run: AgentRunView): string {
  const started = new Date(run.startedAt ?? run.createdAt).getTime()
  const ended = new Date(run.endedAt ?? run.updatedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return '处理过程'
  const seconds = Math.max(1, Math.round((ended - started) / 1_000))
  if (seconds < 60) return `处理过程 · ${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `处理过程 · ${minutes}分${remainder ? `${remainder}秒` : ''}`
}

function evidenceKindLabel(kind: AgentRunExecutionEvidenceView['kind']): string {
  return ({
    reasoning_summary: '思考摘要',
    narration: '进展说明',
    plan: '计划',
    step: '步骤',
    tool_call: '工具调用',
    tool_result: '工具调用',
    command: '工具调用',
    file_change: '文件变更'
  })[kind]
}

export function TaskPanel({
  snapshot,
  busy,
  focusTaskId = null,
  focusRequest = 0,
  onTasksChanged
}: {
  snapshot: CampSnapshot
  busy: boolean
  focusTaskId?: string | null
  focusRequest?: number
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

  useEffect(() => {
    if (!focusTaskId || focusRequest === 0) return
    const task = snapshot.tasks.find((candidate) => candidate.id === focusTaskId)
    if (task) {
      beginEdit(task)
    } else {
      resetForm()
      setFormError('这项 Task 当前不可见，无法打开详情。')
    }
  }, [focusRequest, focusTaskId])

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
      setFormError(localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error)))
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
      setFormError(localizeExecutionEngineTerms(error instanceof Error ? error.message : String(error)))
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

async function writeClipboardText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }
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
