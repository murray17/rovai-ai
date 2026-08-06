import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type JSX, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AgentProfile,
  AgentRunExecutionEvidencePage,
  AgentRunExecutionEvidenceView,
  AgentRunView,
  CampComposerDraftView,
  CampMessageAttachmentView,
  CampMessageView,
  CampSnapshot,
  CampTaskStatus,
  CampTaskView,
  InboxMessageView,
  NavigationCampItem,
  StoredCommandResult,
  StructuredCampMessageContent,
  WorkspaceInspection
} from '@contracts'
import { EmptyInline } from './ui-elements'
import {
  formatMentionDisplayText,
  type AgentMentionCandidate
} from './AgentMentionTextarea'
import { StructuredMentionComposer } from './StructuredMentionComposer'
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
  selectCompleteExecutionEvidence,
  timelineDayLabel
} from './ui-model'
import { MemberAvatar } from './MemberAvatar'
import { MemberPortrait } from './MemberPortrait'
import { localizeExecutionEngineTerms } from './product-copy'
import { runtimeReadinessLabel } from './runtime-status'
import { SafeMarkdown } from './SafeMarkdown'
import { identityColorToken } from './theme'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])
const EXECUTION_EVIDENCE_PAGE_LIMIT = 1_000
export type CampInspectorTab = 'activity' | 'tasks' | 'context' | 'approvals' | 'audit'
export type NotificationFocusTarget = {
  requestId: number
  kind: 'approval' | 'camp_turn'
  campTurnId: string | null
}
export interface CampRuntimeRecoveryTarget {
  agentProfileId: string
  blockerCode: string
}
export interface CampRuntimeRecovery {
  campId: string
  targets: CampRuntimeRecoveryTarget[]
}

type MentionPopoverRequest = {
  target:
    | { kind: 'member'; agentProfileId: string }
    | { kind: 'all_members'; context: 'composer' | 'history'; agentProfileIds: string[] }
  trigger: HTMLElement
  focusPanel: boolean
}

export function runtimeRecoveryReason(blockerCode: string): string {
  switch (blockerCode) {
    case 'runtime_not_configured':
      return '尚未配置 Agent 运行时'
    case 'runtime_authentication_required':
      return 'Agent 运行时需要登录'
    case 'adapter_installation_missing':
      return '所选 Agent 运行时尚未安装'
    case 'adapter_installation_disabled':
      return '所选 Agent 运行时已停用'
    case 'runtime_probe_required':
      return 'Agent 运行时需要重新检查'
    case 'runtime_selection_resolution_mismatch':
      return '运行配置已变更，请重新选择'
    case 'conversation_runtime_override_unsupported':
      return '当前对话的运行配置不受支持'
    case 'runtime_selection_unresolved':
    case 'runtime_configuration_incomplete':
      return '运行配置尚未完成'
    case 'runtime_model_adapter_mismatch':
    case 'runtime_model_unavailable':
    case 'runtime_permission_adapter_mismatch':
    case 'runtime_permission_schema_mismatch':
      return '当前运行配置已失效'
    case 'member_away':
      return '队员当前已离队'
    case 'member_removed':
    case 'agent_unavailable':
      return '队员当前不可用'
    default:
      return 'Agent 运行时暂不可用'
  }
}

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

export async function loadCompleteAgentRunExecutionEvidence(
  requestPage: (params: {
    campId: string
    agentRunId: string
    afterSequence: number
    limit: number
  }) => Promise<AgentRunExecutionEvidencePage>,
  campId: string,
  agentRunId: string
): Promise<AgentRunExecutionEvidenceView[]> {
  const evidence: AgentRunExecutionEvidenceView[] = []
  let afterSequence = 0
  let throughSequence: number | null = null
  for (;;) {
    const page = await requestPage({
      campId,
      agentRunId,
      afterSequence,
      limit: EXECUTION_EVIDENCE_PAGE_LIMIT
    })
    if (
      page.schemaVersion !== 1
      || page.agentRunId !== agentRunId
      || page.requestedAfterSequence !== afterSequence
      || (throughSequence !== null && page.throughSequence !== throughSequence)
    ) {
      throw new Error('Execution Evidence page is incompatible')
    }
    throughSequence = page.throughSequence
    evidence.push(...page.evidence)
    if (!page.hasMore) break
    if (page.nextAfterSequence <= afterSequence) {
      throw new Error('Execution Evidence page did not advance')
    }
    afterSequence = page.nextAfterSequence
  }
  if (throughSequence !== null && evidence.length !== throughSequence) {
    throw new Error('Execution Evidence history is incomplete')
  }
  return evidence
}

export type CampConversationTimelineItem =
  | {
      kind: 'task_card'
      id: string
      createdAt: string
      timelineGlobalSequence: number | null
      task: CampTaskView
    }
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
  | {
      kind: 'stop_event'
      id: string
      createdAt: string
      timelineGlobalSequence: number | null
      campTurnId: string
      elapsedLabel: string
      hasUnsettledExternalEffects: boolean
    }

export function campConversationTimeline(
  messages: CampMessageView[],
  inboxMessages: InboxMessageView[],
  turns: CampSnapshot['turns'] = [],
  timeline: CampSnapshot['timeline'] = [],
  agentRuns: CampSnapshot['agentRuns'] = [],
  tasks: CampSnapshot['tasks'] = []
): CampConversationTimelineItem[] {
  const taskCreatedSequenceById = new Map(
    timeline
      .filter((event) =>
        event.eventType === 'task.created'
        && event.entityType === 'task'
        && event.entityId !== null
      )
      .map((event) => [event.entityId as string, event.globalSequence])
  )
  const taskCards: CampConversationTimelineItem[] = tasks.map((task) => ({
    kind: 'task_card',
    id: `task:${task.id}`,
    createdAt: task.createdAt,
    timelineGlobalSequence: taskCreatedSequenceById.get(task.id) ?? null,
    task
  }))
  const publicMessages: CampConversationTimelineItem[] = messages
    .filter((message) => {
      const kind = (message.presentation as { kind?: string } | null)?.kind
      return kind !== 'a2a_event' && kind !== 'task_event'
    })
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
  const cancelSequenceByTurnId = new Map(
    timeline
      .filter((event) =>
        event.eventType === 'camp_turn.cancel_requested'
        && event.entityType === 'camp_turn'
        && event.entityId !== null
      )
      .map((event) => [event.entityId as string, event.globalSequence])
  )
  const unsettledTurnIds = new Set(
    agentRuns
      .filter((run) => run.hasUnsettledExternalEffects)
      .map((run) => run.campTurnId)
  )
  const stopEvents: CampConversationTimelineItem[] = turns
    .filter((turn) => turn.status === 'cancelled' && turn.cancelRequestedAt !== null)
    .map((turn) => ({
      kind: 'stop_event',
      id: `stop:${turn.id}`,
      createdAt: turn.cancelRequestedAt as string,
      timelineGlobalSequence: cancelSequenceByTurnId.get(turn.id) ?? null,
      campTurnId: turn.id,
      elapsedLabel: formatStopElapsed(turn.createdAt, turn.cancelRequestedAt as string),
      hasUnsettledExternalEffects: unsettledTurnIds.has(turn.id)
    }))

  return [...taskCards, ...publicMessages, ...collaborationMessages, ...stopEvents].sort((left, right) => {
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

export function formatStopElapsed(createdAt: string, cancelRequestedAt: string): string {
  const started = new Date(createdAt).getTime()
  const stopped = new Date(cancelRequestedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(stopped)) return '0 秒'
  const seconds = Math.max(0, Math.round((stopped - started) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}分${remainder ? `${remainder}秒` : ''}`
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

function conversationInputPresentation(
  status: CampSnapshot['conversationInputs'][number]['status']
): { label: string; tone: 'neutral' | 'active' | 'success' | 'danger' } {
  switch (status) {
    case 'pending': return { label: '等待执行', tone: 'active' }
    case 'materialized': return { label: '已物化', tone: 'success' }
    case 'failed': return { label: '物化失败', tone: 'danger' }
    case 'cancelled': return { label: '已取消', tone: 'neutral' }
  }
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
      return { label: 'Agent 运行时不支持', tone: 'neutral', mark: '–' }
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
    case 'skipped_native_name_conflict':
      return { label: '同名原生配置优先', tone: 'attention', mark: '↘' }
    case 'disabled':
      return { label: '已停用', tone: 'neutral', mark: '–' }
    case 'unassigned':
      return { label: '未分配给队员', tone: 'neutral', mark: '–' }
    case 'adapter_unsupported':
      return { label: '本轮未投影', tone: 'neutral', mark: '–' }
    case 'missing_environment':
      return { label: '缺少环境变量', tone: 'danger', mark: '!' }
    default:
      return { label: '配置无效', tone: 'danger', mark: '!' }
  }
}

function skillDeliveryGroupLabel(kind: string): string {
  switch (kind) {
    case 'codex': return 'Codex · .codex/skills'
    case 'opencode': return 'OpenCode · .opencode/skills'
    case 'copilot': return 'Copilot · .github/skills'
    case 'claude_compatible': return 'Claude 兼容 · .claude/skills'
    case 'antigravity': return 'Antigravity · .agent/skills'
    case 'kiro': return 'Kiro · .kiro/skills'
    case 'qoder': return 'Qoder · .qoder/skills'
    case 'codebuddy': return 'CodeBuddy · .codebuddy/skills'
    case 'qwen': return 'Qwen · .qwen/skills'
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

export function structuredCampContentPlainText(
  content: StructuredCampMessageContent,
  members: ReadonlyArray<Pick<CampSnapshot['members'][number], 'agentProfileId' | 'displayName'>>
): string {
  const names = new Map(members.map((member) => [member.agentProfileId, member.displayName]))
  return content.map((segment) => {
    if (segment.kind === 'text') return segment.text
    if (segment.kind === 'all_members_mention') return '@所有成员'
    return `@${names.get(segment.agentProfileId) ?? '不可用队员'}`
  }).join('')
}

export function emptyCampRuntimeSummary(
  members: CampSnapshot['members'],
  agents: AgentProfile[]
): string {
  const activeMembers = members.filter((member) =>
    member.membershipStatus === 'active' && member.profilePresence === 'present'
  )
  if (activeMembers.length === 0) return '暂无在队的队员'

  const profileById = new Map(agents.map((agent) => [agent.id, agent]))
  const profiles = activeMembers.map((member) => profileById.get(member.agentProfileId))
  if (profiles.some((profile) => !profile)) return '正在检查 Agent 运行时…'

  const readyCount = profiles.filter((profile) => profile?.runtimeReadiness.status === 'ready').length
  if (readyCount === activeMembers.length) return 'Agent 运行时可用'
  if (readyCount === 0) return 'Agent 运行时不可用'
  return `${readyCount}/${activeMembers.length} 个 Agent 运行时可用`
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
                  <span className="camp-marker-slot" aria-hidden="true">
                    {camp.marker === 'unread_completed' && <i className="task-dot camp-marker-unread_completed" />}
                  </span>
                  <span className="truncate">{formatMentionDisplayText(camp.title, agents)}</span>
                  {camp.marker === 'loading' && <span className="camp-loading-spinner camp-marker-loading" role="img" aria-label="正在运行" />}
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
  onTasksChanged,
  onResolveApproval,
  cancellingTurnIds = new Set<string>(),
  stopping,
  onStop,
  inspectorVisible = true,
  inspectorTab: controlledInspectorTab,
  onInspectorTabChange,
  onOpenInspector,
  notificationFocus = null,
  runtimeRecovery = null,
  onConfigureRuntime,
  onDismissRuntimeRecovery
}: {
  snapshot: CampSnapshot
  optimisticMessages?: CampMessageView[]
  projectName: string | null
  workspaceInspection?: WorkspaceInspection | 'unavailable' | null
  agents: AgentProfile[]
  liveRuntimeEvents?: LiveRuntimeEvent[]
  busy: boolean
  onSend(draft: CampComposerDraftView): Promise<void>
  onChangeLead(agentProfileId: string): Promise<void>
  onTasksChanged(): Promise<void>
  onResolveApproval(approval: ActionApprovalView, optionId: string): void
  cancellingTurnIds?: ReadonlySet<string>
  stopping: boolean
  onStop(): void
  inspectorVisible?: boolean
  inspectorTab?: CampInspectorTab
  onInspectorTabChange?(tab: CampInspectorTab): void
  onOpenInspector?(tab: CampInspectorTab): void
  notificationFocus?: NotificationFocusTarget | null
  runtimeRecovery?: CampRuntimeRecovery | null
  onConfigureRuntime?(agentProfileId: string): void
  onDismissRuntimeRecovery?(): void
}): JSX.Element {
  const [messageContent, setMessageContent] = useState<StructuredCampMessageContent>([])
  const [composerDraft, setComposerDraft] = useState<CampComposerDraftView | null>(null)
  const [preparingAttachments, setPreparingAttachments] = useState<Array<{ id: string; name: string }>>([])
  const [failedAttachments, setFailedAttachments] = useState<Array<{ id: string; name: string; error: string }>>([])
  const [draggingAttachments, setDraggingAttachments] = useState(false)
  const [composerSubmitting, setComposerSubmitting] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [mentionPopover, setMentionPopover] = useState<MentionPopoverRequest | null>(null)
  const composerEditorRef = useRef<HTMLDivElement>(null)
  const draftSaveTimer = useRef<number | null>(null)
  const draftContent = useRef<StructuredCampMessageContent>([])
  const draftCampId = useRef<string | null>(null)
  const composerDraftRef = useRef<CampComposerDraftView | null>(null)
  const draftMutationQueues = useRef(new Map<string, Promise<CampComposerDraftView>>())
  const dragDepth = useRef(0)
  const attachmentPreparationQueue = useRef<Promise<void>>(Promise.resolve())
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const approvalDockRef = useRef<HTMLElement>(null)
  const lastTimelineItemId = useRef<string | null>(null)
  const [localInspectorTab, setLocalInspectorTab] = useState<CampInspectorTab>('activity')
  const inspectorTab = controlledInspectorTab ?? localInspectorTab
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
  const composerMembers = useMemo(
    () => snapshot.members.map((member) => ({
      agentProfileId: member.agentProfileId,
      displayName: member.displayName,
      avatarRef: member.avatarRef,
      mentionable: member.membershipStatus === 'active' && member.profilePresence === 'present'
    })),
    [snapshot.members]
  )
  const closeMentionPopover = (returnFocus: boolean): void => {
    const trigger = mentionPopover?.trigger
    setMentionPopover(null)
    if (returnFocus && trigger) {
      window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }))
    }
  }
  const openMemberMentionPopover = (
    agentProfileId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void => {
    if (!memberById.has(agentProfileId) || !profileById.has(agentProfileId)) return
    if (mentionPopover?.trigger === trigger) {
      closeMentionPopover(true)
      return
    }
    setMentionPopover({
      target: { kind: 'member', agentProfileId },
      trigger,
      focusPanel
    })
  }
  const openAllMembersMentionPopover = (
    context: 'composer' | 'history',
    agentProfileIds: string[],
    trigger: HTMLElement,
    focusPanel: boolean
  ): void => {
    if (mentionPopover?.trigger === trigger) {
      closeMentionPopover(true)
      return
    }
    setMentionPopover({
      target: { kind: 'all_members', context, agentProfileIds },
      trigger,
      focusPanel
    })
  }

  useEffect(() => setMentionPopover(null), [snapshot.camp.id])

  const message = useMemo(
    () => structuredCampContentPlainText(messageContent, snapshot.members),
    [messageContent, snapshot.members]
  )
  const hasUnavailableMention = useMemo(
    () => messageContent.some((segment) => {
      if (segment.kind !== 'member_mention') return false
      const member = memberById.get(segment.agentProfileId)
      return !member
        || member.membershipStatus !== 'active'
        || member.profilePresence !== 'present'
    }),
    [memberById, messageContent]
  )
  const runById = useMemo(
    () => new Map(snapshot.agentRuns.map((run) => [run.id, run])),
    [snapshot.agentRuns]
  )
  const inputByInboxMessageId = useMemo(
    () => new Map(snapshot.conversationInputs.flatMap((input) => (
      input.sourceInboxMessageId ? [[input.sourceInboxMessageId, input] as const] : []
    ))),
    [snapshot.conversationInputs]
  )
  const visibleCampMessages = useMemo(() => {
    const persistedIds = new Set(snapshot.messages.map((message) => message.id))
    return [
      ...snapshot.messages,
      ...optimisticMessages.filter((message) => !persistedIds.has(message.id))
    ]
  }, [optimisticMessages, snapshot.messages])
  const conversationTimeline = useMemo(
    () => campConversationTimeline(
      visibleCampMessages,
      snapshot.inboxMessages,
      snapshot.turns,
      snapshot.timeline,
      snapshot.agentRuns,
      snapshot.tasks
    ),
    [
      snapshot.agentRuns,
      snapshot.inboxMessages,
      snapshot.tasks,
      snapshot.timeline,
      snapshot.turns,
      visibleCampMessages
    ]
  )
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
  const workspaceStatus = workspaceCapabilityStatus(snapshot, workspaceInspection)
  const defaultLeadProfile = defaultLead ? profileById.get(defaultLead.agentProfileId) ?? null : null
  const defaultLeadReady = defaultLeadProfile?.runtimeReadiness.status === 'ready'
  const activeRuns = snapshot.agentRuns.filter((run) => NON_TERMINAL_RUNS.has(run.status))
  const executionBlocked = activeRuns.length > 0 || stopping
  const messageRunIds = new Set(snapshot.messages.flatMap((campMessage) =>
    campMessage.sourceAgentRunId ? [campMessage.sourceAgentRunId] : []
  ))
  const runsWithoutMessage = snapshot.agentRuns
    .filter((run) => !messageRunIds.has(run.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const stopOutcomeTurnIds = new Set(
    conversationTimeline
      .filter((item) => item.kind === 'stop_event')
      .map((item) => item.campTurnId)
  )
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
        canonical: evidence.canonical,
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
  const loadedEvidenceCountByRunId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const evidence of snapshot.executionEvidence) {
      counts.set(evidence.agentRunId, (counts.get(evidence.agentRunId) ?? 0) + 1)
    }
    return counts
  }, [snapshot.executionEvidence])

  const applyComposerDraft = (campId: string, draft: CampComposerDraftView): void => {
    if (draftCampId.current !== campId) return
    composerDraftRef.current = draft
    setComposerDraft(draft)
  }

  const queueDraftMutation = (
    campId: string,
    mutate: (draft: CampComposerDraftView) => Promise<CampComposerDraftView>
  ): Promise<CampComposerDraftView> => {
    const current = composerDraftRef.current
    const initial = current?.campId === campId
      ? Promise.resolve(current)
      : window.rovai.request<CampComposerDraftView>('camp.composerDraft.get', { campId })
    const previous = draftMutationQueues.current.get(campId) ?? initial
    const mutation = previous
      .catch(() => window.rovai.request<CampComposerDraftView>('camp.composerDraft.get', { campId }))
      .then(mutate)
    const next = mutation.catch(async (error: unknown) => {
      const refreshed = await window.rovai.request<CampComposerDraftView>(
        'camp.composerDraft.get',
        { campId }
      )
      applyComposerDraft(campId, refreshed)
      throw error
    })
    draftMutationQueues.current.set(campId, next)
    void next.then((draft) => {
      if (draftMutationQueues.current.get(campId) === next) {
        draftMutationQueues.current.delete(campId)
      }
      applyComposerDraft(campId, draft)
    }, () => {
      if (draftMutationQueues.current.get(campId) === next) {
        draftMutationQueues.current.delete(campId)
      }
    })
    return next
  }

  const saveStructuredDraft = (
    campId: string,
    content: StructuredCampMessageContent
  ): Promise<CampComposerDraftView> => queueDraftMutation(
    campId,
    (draft) => window.rovai.request<CampComposerDraftView>('camp.composerDraft.save', {
      campId,
      expectedRevision: draft.revision,
      content
    })
  )

  useEffect(() => {
    const campId = snapshot.camp.id
    let cancelled = false
    if (draftSaveTimer.current !== null) {
      window.clearTimeout(draftSaveTimer.current)
      draftSaveTimer.current = null
    }
    setComposerDraft(null)
    composerDraftRef.current = null
    setPreparingAttachments([])
    setFailedAttachments([])
    setMessageContent([])
    draftContent.current = []
    draftCampId.current = campId
    const pendingDraft = draftMutationQueues.current.get(campId)
    void (pendingDraft ?? window.rovai.request<CampComposerDraftView>(
      'camp.composerDraft.get',
      { campId }
    ))
      .then((draft) => {
        if (cancelled || draftCampId.current !== campId) return
        applyComposerDraft(campId, draft)
        setMessageContent(draft.content)
        draftContent.current = draft.content
      })
      .catch(() => {
        if (!cancelled && draftCampId.current === campId) {
          const emptyDraft: CampComposerDraftView = {
            campId,
            body: '',
            content: [],
            revision: 0,
            attachments: [],
            updatedAt: null,
            expiresAt: null
          }
          composerDraftRef.current = emptyDraft
          setComposerDraft(emptyDraft)
        }
      })
    return () => {
      cancelled = true
      if (draftSaveTimer.current !== null) window.clearTimeout(draftSaveTimer.current)
      if (draftCampId.current === campId) {
        void saveStructuredDraft(campId, draftContent.current).catch(() => undefined)
      }
    }
  }, [snapshot.camp.id])

  useEffect(() => {
    const previousCount = previousPendingApprovalCount.current
    previousPendingApprovalCount.current = pendingApprovals.length
    if (pendingApprovals.length >= previousCount) return
    if (pendingApprovals.length === 0) {
      composerEditorRef.current?.focus()
      return
    }
    approvalDockRef.current
      ?.querySelector<HTMLButtonElement>('.runtime-option:not(:disabled)')
      ?.focus()
  }, [pendingApprovals.length])

  useEffect(() => {
    if (!busy && !composerSubmitting) composerEditorRef.current?.focus()
  }, [busy, composerSubmitting])

  useEffect(() => {
    if (!notificationFocus) return undefined
    const frame = window.requestAnimationFrame(() => {
      const scrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
      if (notificationFocus.kind === 'approval') {
        const option = approvalDockRef.current
          ?.querySelector<HTMLButtonElement>('.runtime-option:not(:disabled)')
        if (option) {
          option.scrollIntoView({ block: 'center', behavior: scrollBehavior })
          option.focus({ preventScroll: true })
        }
        return
      }
      const turnId = notificationFocus.campTurnId
      const targets = turnId
        ? timelineScrollRef.current?.querySelectorAll<HTMLElement>(
            `[data-camp-turn-id="${CSS.escape(turnId)}"]`
          )
        : null
      const target = targets && targets.length > 0 ? targets[targets.length - 1] : null
      if (target) {
        target.classList.add('notification-focus-target')
        target.scrollIntoView({ block: 'center', behavior: scrollBehavior })
        target.focus({ preventScroll: true })
        window.setTimeout(() => target.classList.remove('notification-focus-target'), 1_800)
      } else {
        const scroll = timelineScrollRef.current
        if (scroll) {
          scroll.scrollTop = scroll.scrollHeight
          scroll.focus({ preventScroll: true })
        }
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [notificationFocus, snapshot.messages, snapshot.agentRuns])

  useEffect(() => {
    const nextLastId = conversationTimeline.at(-1)?.id ?? null
    if (!nextLastId || nextLastId === lastTimelineItemId.current) return
    lastTimelineItemId.current = nextLastId
    const scroll = timelineScrollRef.current
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }, [conversationTimeline])

  const submitMessage = async (): Promise<void> => {
    if (
      executionBlocked
      || !message.trim()
      || hasUnavailableMention
      || busy
      || composerSubmitting
      || composerDraft === null
      || preparingAttachments.length > 0
      || failedAttachments.length > 0
    ) return
    setComposerSubmitting(true)
    let sendAttempted = false
    try {
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current)
        draftSaveTimer.current = null
      }
      await attachmentPreparationQueue.current
      const campId = snapshot.camp.id
      const frozenDraft = await saveStructuredDraft(campId, draftContent.current)
      applyComposerDraft(campId, frozenDraft)
      sendAttempted = true
      await onSend(frozenDraft)
      const emptyDraft: CampComposerDraftView = {
        campId: snapshot.camp.id,
        body: '',
        content: [],
        revision: 0,
        attachments: [],
        updatedAt: null,
        expiresAt: null
      }
      setMessageContent([])
      draftContent.current = []
      composerDraftRef.current = emptyDraft
      setComposerDraft(emptyDraft)
    } catch {
      if (sendAttempted) {
        const campId = snapshot.camp.id
        void window.rovai.request<CampComposerDraftView>('camp.composerDraft.get', { campId })
          .then((draft) => {
            if (draftCampId.current !== campId) return
            applyComposerDraft(campId, draft)
            setMessageContent(draft.content)
            draftContent.current = draft.content
          })
          .catch(() => undefined)
      }
      composerEditorRef.current?.focus()
    } finally {
      setComposerSubmitting(false)
      window.requestAnimationFrame(() => composerEditorRef.current?.focus())
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void submitMessage()
  }

  const changeMessage = (nextContent: StructuredCampMessageContent): void => {
    setMessageContent(nextContent)
    draftContent.current = nextContent
    if (draftSaveTimer.current !== null) window.clearTimeout(draftSaveTimer.current)
    const campId = snapshot.camp.id
    draftSaveTimer.current = window.setTimeout(() => {
      draftSaveTimer.current = null
      void saveStructuredDraft(campId, draftContent.current).catch(() => undefined)
    }, 300)
  }

  const prepareFiles = async (files: File[]): Promise<void> => {
    const campId = snapshot.camp.id
    const pending = files.map((file, index) => ({
      id: crypto.randomUUID(),
      file: file.name
        ? file
        : new File([file], `粘贴图片-${Date.now()}-${index + 1}.png`, { type: file.type })
    }))
    setPreparingAttachments((current) => [
      ...current,
      ...pending.map(({ id, file }) => ({ id, name: file.name }))
    ])
    const preparePending = async (): Promise<void> => {
      for (const item of pending) {
        try {
          await queueDraftMutation(
            campId,
            (draft) => window.rovai.composerAttachments.prepare(
              campId,
              draft.revision,
              item.file
            )
          )
        } catch (error) {
          if (draftCampId.current === campId) {
            setFailedAttachments((current) => [
              ...current,
              { id: item.id, name: item.file.name, error: attachmentErrorMessage(error) }
            ])
          }
        } finally {
          setPreparingAttachments((current) => current.filter(({ id }) => id !== item.id))
        }
      }
    }
    attachmentPreparationQueue.current = attachmentPreparationQueue.current.then(
      preparePending,
      preparePending
    )
    await attachmentPreparationQueue.current
  }

  const removePreparedAttachment = async (attachmentId: string): Promise<void> => {
    const campId = snapshot.camp.id
    await queueDraftMutation(
      campId,
      (draft) => window.rovai.request<CampComposerDraftView>(
        'camp.composerDraft.removeAttachment',
        { campId, expectedRevision: draft.revision, attachmentId }
      )
    )
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
    changeMessage([{ kind: 'text', text: prompt }])
    window.requestAnimationFrame(() => {
      const editor = composerEditorRef.current
      if (!editor) return
      editor.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const selectInspectorTab = (tab: CampInspectorTab): void => {
    if (controlledInspectorTab === undefined) setLocalInspectorTab(tab)
    onInspectorTabChange?.(tab)
  }

  const openInspector = (tab: CampInspectorTab): void => {
    selectInspectorTab(tab)
    onOpenInspector?.(tab)
  }

  return (
    <section className="workspace-shell camp-workspace" aria-label={`Camp：${formatMentionDisplayText(snapshot.camp.title, snapshot.members)}`}>
      <div className={`workspace-grid ${inspectorVisible ? '' : 'inspector-collapsed'}`.trim()}>
        <section className="timeline-pane">
          <div
            className="timeline-scroll camp-timeline"
            ref={timelineScrollRef}
            tabIndex={-1}
            aria-label="对话时间线"
          >
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
                  if (timelineItem.kind === 'task_card') {
                    items.push(
                      <TaskTimelineCard
                        key={timelineItem.id}
                        task={timelineItem.task}
                        assigneeName={taskAssigneeName(timelineItem.task, snapshot)}
                        onOpen={() => {
                          setFocusedTaskId(timelineItem.task.id)
                          setTaskFocusRequest((request) => request + 1)
                          openInspector('tasks')
                        }}
                      />
                    )
                    continue
                  }
                  if (timelineItem.kind === 'stop_event') {
                    for (const run of runsWithoutMessage.filter((candidate) =>
                      candidate.campTurnId === timelineItem.campTurnId
                    )) {
                      items.push(
                        <AgentRunConversationMessage
                          key={run.id}
                          run={run}
                          member={memberById.get(run.agentProfileId) ?? null}
                          profile={profileById.get(run.agentProfileId) ?? null}
                          progress={executionProgressByRunId.get(run.id)}
                          campId={snapshot.camp.id}
                          truncatedEvidence={truncatedEvidenceByRunId.get(run.id)}
                          loadedEvidenceCount={loadedEvidenceCountByRunId.get(run.id) ?? 0}
                          cancelling={false}
                        />
                      )
                    }
                    items.push(
                      <StopOutcomeEvent
                        key={timelineItem.id}
                        item={timelineItem}
                        onOpenActivity={() => openInspector('activity')}
                      />
                    )
                    continue
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
                          </div>
                          <MessageSurface
                            copied={copiedMessageId === inboxMessage.id}
                            onCopy={() => copyMessage(inboxMessage.id, displayBody)}
                          >
                            <div className="final-copy collaboration-card">
                              <SafeMarkdown>{displayBody}</SafeMarkdown>
                            </div>
                          </MessageSurface>
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
                      data-camp-turn-id={sourceRun?.campTurnId}
                      tabIndex={sourceRun ? -1 : undefined}
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
                              </div>
                              <MessageSurface
                                copied={copiedMessageId === campMessage.id}
                                onCopy={() => copyMessage(campMessage.id, displayBody)}
                              >
                                {campMessage.authorType === 'agent'
                                      ? (
                                          <>
                                            {sourceRun && (
                                              <RunExecutionDisclosure
                                                run={sourceRun}
                                                progress={executionProgressByRunId.get(sourceRun.id)}
                                                campId={snapshot.camp.id}
                                                truncatedEvidence={truncatedEvidenceByRunId.get(sourceRun.id)}
                                                loadedEvidenceCount={loadedEvidenceCountByRunId.get(sourceRun.id) ?? 0}
                                                finalBody={displayBody}
                                                cancelling={cancellingTurnIds.has(sourceRun.campTurnId) && NON_TERMINAL_RUNS.has(sourceRun.status)}
                                              />
                                            )}
                                            <div className="final-copy">
                                              <SafeMarkdown>{displayBody}</SafeMarkdown>
                                            </div>
                                          </>
                                        )
                                      : (
                                          <>
                                            <div className="message-bubble">
                                              <StructuredMessageBody
                                                body={displayBody}
                                                content={campMessage.content}
                                                members={snapshot.members}
                                                onActivateMemberMention={openMemberMentionPopover}
                                                onActivateAllMembersMention={(trigger, focusPanel) =>
                                                  openAllMembersMentionPopover(
                                                    'history',
                                                    campMessage.addressedAgentProfileIds,
                                                    trigger,
                                                    focusPanel
                                                  )}
                                              />
                                            </div>
                                            {campMessage.attachments.length > 0 && (
                                              <div className="timeline-attachments" aria-label="消息附件">
                                                {campMessage.attachments.map((attachment) => (
                                                  <AttachmentCard
                                                    attachment={attachment}
                                                    key={attachment.id}
                                                    timeline
                                                  />
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        )}
                              </MessageSurface>
                            </div>
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
              {runsWithoutMessage.filter((run) => !stopOutcomeTurnIds.has(run.campTurnId)).map((run) => (
                <AgentRunConversationMessage
                  key={run.id}
                  run={run}
                  member={memberById.get(run.agentProfileId) ?? null}
                  profile={profileById.get(run.agentProfileId) ?? null}
                  progress={executionProgressByRunId.get(run.id)}
                  campId={snapshot.camp.id}
                  truncatedEvidence={truncatedEvidenceByRunId.get(run.id)}
                  loadedEvidenceCount={loadedEvidenceCountByRunId.get(run.id) ?? 0}
                  cancelling={cancellingTurnIds.has(run.campTurnId) && NON_TERMINAL_RUNS.has(run.status)}
                />
              ))}
            </div>
          </div>
        </section>

        {inspectorVisible && <aside className="activity-pane" aria-label="Camp 检查器">
          <Tabs.Root
            value={inspectorTab}
            onValueChange={(value) => selectInspectorTab(value as CampInspectorTab)}
            activationMode="manual"
            className="activity-tabs"
          >
            <Tabs.List className="tabs-list sticky-tabs" aria-label="Camp 详情">
              <Tabs.Trigger value="activity">活动 <small>{snapshot.agentRuns.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="tasks">任务 <small>{snapshot.tasks.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="context">上下文 <small>{snapshot.contextManifests.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="approvals">审批 {pendingApprovals.length > 0 && <b>{pendingApprovals.length}</b>}</Tabs.Trigger>
              <Tabs.Trigger value="audit">审计 <small>{snapshot.timeline.length}</small></Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="activity" className="tab-scroll activity-list">
              {snapshot.conversationInputs.length > 0 && <div className="inspector-section-label"><span>Agent 协作</span><small>{snapshot.conversationInputs.length} 条持久化输入</small></div>}
              {snapshot.inboxMessages.slice().reverse().map((inboxMessage) => {
                const conversationInput = inputByInboxMessageId.get(inboxMessage.id) ?? null
                const targetRun = inboxMessage.targetAgentRunId ? runById.get(inboxMessage.targetAgentRunId) ?? null : null
                const status = conversationInput
                  ? conversationInputPresentation(conversationInput.status)
                  : inboxMessagePresentation(inboxMessage, targetRun?.status ?? null)
                const sender = memberById.get(inboxMessage.senderAgentId)?.displayName ?? inboxMessage.senderAgentId
                const recipient = memberById.get(inboxMessage.recipientAgentId)?.displayName ?? inboxMessage.recipientAgentId
                return (
                  <article className="activity-row a2a-row" key={inboxMessage.id}>
                    <time className="activity-time">{messageClockTime(inboxMessage.createdAt)}</time>
                    <div className="activity-body">
                      <div className="activity-row-title"><strong>{sender} → {recipient}</strong><span className={`activity-state tone-${status.tone}`}>{status.label}</span></div>
                      <p className="activity-detail">{formatMentionDisplayText(inboxMessage.body, snapshot.members)}</p>
                      <dl className="activity-facts">
                        {conversationInput && <div><dt>输入</dt><dd>#{conversationInput.sequence} · Member Call</dd></div>}
                        {targetRun && <div><dt>深度</dt><dd>{targetRun.a2aDepth}</dd></div>}
                      </dl>
                      {inboxMessage.lastError && <p className="inline-status-error">{inboxMessage.lastError}</p>}
                    </div>
                  </article>
                )
              })}
              {snapshot.inboxMessages.length > 0 && <div className="inspector-section-label"><span>执行记录</span><small>{snapshot.agentRuns.length} 个 AgentRun</small></div>}
              {snapshot.agentRuns.slice().reverse().map((run) => {
                const cancelling = cancellingTurnIds.has(run.campTurnId)
                  && NON_TERMINAL_RUNS.has(run.status)
                const state = agentRunStateTag(run, cancelling)
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
                      <span className={`activity-state tone-${state.tone}`} title={agentRunPresentation(run, cancelling).label}>{state.tag}</span>
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
                  {!defaultLeadReady && <small>{defaultLead?.displayName ?? 'Default Lead'} 的 Agent 运行时不可用</small>}
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

                    {manifest.attachmentRefs.length > 0 && (
                      <div className="context-subsection">
                        <div className="context-subsection-title"><strong>Camp Attachment Paths</strong><small>公共稳定路径 · 发现范围随消息边界冻结</small></div>
                        {manifest.attachmentRefs.map((attachment) => <div className="context-attachment" key={attachment.attachmentId}><div><strong>{shortIdentity(attachment.attachmentId)}</strong><small>{attachment.contentDigest}</small></div><span>冻结范围内可读</span></div>)}
                      </div>
                    )}

                    <div className="context-subsection">
                      <div className="context-subsection-title">
                        <strong>Skill 投递</strong>
                        <small>冻结本次 Run 的配置组、Revision 与实际投递路径</small>
                      </div>
                      {manifest.skillExposure.skills.map((skill) => {
                        const presentation = skillExposurePresentation(skill.status)
                        return (
                          <div className="skill-exposure-row" key={`${skill.groupKey}:${skill.skillId}`}>
                            <span className={`skill-exposure-mark tone-${presentation.tone}`} aria-hidden="true">{presentation.mark}</span>
                            <div>
                              <strong>{skill.name}</strong>
                              <small>
                                {skillDeliveryGroupLabel(skill.groupKey)} · {presentation.label}
                                {skill.deliveredViaGroupKey && skill.deliveredViaGroupKey !== skill.groupKey
                                  ? ` · 经 ${skillDeliveryGroupLabel(skill.deliveredViaGroupKey)} 投递`
                                  : ''}
                                {skill.conflictStatuses.includes('duplicate_visible') ? ' · Duplicate visible' : ''}
                              </small>
                              {skill.reasonCode && <code title={skill.reasonCode}>{skill.reasonCode}</code>}
                            </div>
                            <code title={skill.revisionId}>{shortIdentity(skill.revisionId)}</code>
                          </div>
                        )
                      })}
                      {manifest.skillExposure.skills.length === 0 && (
                        <p className="context-empty-note">本次 AgentRun 没有 Rovai Skill 投递记录。</p>
                      )}
                    </div>

                    <div className="context-subsection">
                      <div className="context-subsection-title">
                        <strong>MCP 暴露</strong>
                        <small>冻结配置摘要，不展示凭据</small>
                      </div>
                      {manifest.mcpExposure.configStatus === 'invalid' && (
                        <p className="context-alert">本轮 MCP 配置无效，未向 Agent 运行时暴露外部 MCP。</p>
                      )}
                      {manifest.mcpExposure.servers.map((server) => {
                        const presentation = mcpExposurePresentation(server.status)
                        return (
                          <div className="skill-exposure-row" key={server.name}>
                            <span className={`skill-exposure-mark tone-${presentation.tone}`} aria-hidden="true">{presentation.mark}</span>
                            <div>
                              <strong>{server.name}</strong>
                              <small>{server.transport === 'stdio' ? 'STDIO' : 'Streamable HTTP'} · {presentation.label}</small>
                              {server.reason && server.status !== 'adapter_unsupported' && <code title={server.reason}>{server.reason}</code>}
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
                      <dl><div><dt>Dynamic Payload</dt><dd><code>{manifest.renderedPayloadDigest}</code></dd></div><div><dt>Session Charter</dt><dd><code>{manifest.bootstrap.sessionCharterDigest}</code></dd></div><div><dt>Memory Entrypoint</dt><dd><code>{manifest.bootstrap.memoryEntrypointDigest}</code></dd></div><div><dt>Collaboration</dt><dd><code>{manifest.collaborationStateDigest}</code></dd></div><div><dt>Run Notices</dt><dd><code>{manifest.runNoticeDigest}</code></dd></div><div><dt>Attachments</dt><dd><code>{manifest.attachmentDigest}</code></dd></div><div><dt>Skill</dt><dd><code>{manifest.skillExposureDigest}</code></dd></div><div><dt>MCP</dt><dd><code>{manifest.mcpExposureDigest}</code></dd></div></dl>
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
                  <p className="approval-reason">{localizeExecutionEngineTerms(approval.reason ?? 'Agent 运行时请求你选择一个原生权限选项。')}</p>
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
                    {approval.options.length === 0 && <p className="approval-option-error">当前 Agent 运行时未提供可无损回传的原生选项，请求无法提交。</p>}
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
        </aside>}
        <div className="conversation-controls">
          {pendingApprovals.length > 0 && (
            <ApprovalDock
              approvals={pendingApprovals}
              profileById={profileById}
              busy={busy}
              onResolve={onResolveApproval}
              containerRef={approvalDockRef}
            />
          )}

          {runtimeRecovery && runtimeRecovery.targets.length > 0 && (
            <RuntimeRecoveryDock
              recovery={runtimeRecovery}
              memberById={memberById}
              profileById={profileById}
              onConfigure={onConfigureRuntime}
              onDismiss={onDismissRuntimeRecovery}
            />
          )}

          <form
        className={draggingAttachments ? 'composer is-dragging-attachments' : 'composer'}
        onSubmit={(event) => void submit(event)}
        onDragEnter={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          dragDepth.current += 1
          setDraggingAttachments(true)
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDraggingAttachments(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepth.current = 0
          setDraggingAttachments(false)
          const files = [...event.dataTransfer.files]
          if (files.length > 0) void prepareFiles(files)
        }}
      >
        <div className="composer-box">
          <div className="composer-input">
            {(composerDraft?.attachments.length ?? 0) > 0
              || preparingAttachments.length > 0
              || failedAttachments.length > 0
              ? (
                  <div className="composer-attachment-strip" aria-label="待发送附件">
                    {composerDraft?.attachments.map((attachment) => (
                      <AttachmentCard
                        attachment={attachment}
                        key={attachment.id}
                        onRemove={() => void removePreparedAttachment(attachment.id)}
                      />
                    ))}
                    {preparingAttachments.map((attachment) => (
                      <AttachmentPlaceholder
                        key={attachment.id}
                        name={attachment.name}
                        state="preparing"
                      />
                    ))}
                    {failedAttachments.map((attachment) => (
                      <AttachmentPlaceholder
                        key={attachment.id}
                        name={attachment.name}
                        state="error"
                        detail={attachment.error}
                        onRemove={() => setFailedAttachments((current) =>
                          current.filter(({ id }) => id !== attachment.id)
                        )}
                      />
                    ))}
                  </div>
                )
              : null}
            <StructuredMentionComposer
              id="camp-message"
              value={messageContent}
              onChange={changeMessage}
              onPasteFiles={(files) => void prepareFiles(files)}
              onSubmit={submitMessage}
              members={composerMembers}
              ariaLabel={`给 ${defaultLead?.displayName ?? 'Default Lead'} 发消息`}
              placeholder="继续提问、补充约束或交付下一项职责…"
              disabled={busy || composerSubmitting}
              editorRef={composerEditorRef}
              onActivateMemberMention={(member, trigger, focusPanel) =>
                openMemberMentionPopover(member.agentProfileId, trigger, focusPanel)}
              onActivateAllMembersMention={(trigger, focusPanel) =>
                openAllMembersMentionPopover(
                  'composer',
                  composerMembers
                    .filter((member) => member.mentionable !== false)
                    .map((member) => member.agentProfileId),
                  trigger,
                  focusPanel
                )}
            />
            <span className="mention-target-summary">
              未提及时发送给 Lead
            </span>
          </div>
          <div className="composer-actions">
            {!executionBlocked && <span className="composer-hint">Enter</span>}
            {executionBlocked
              ? (
                  <button
                    className="danger-button composer-stop"
                    type="button"
                    aria-label={stopping ? '正在停止当前执行' : '停止当前执行'}
                    onClick={onStop}
                    disabled={stopping || activeRuns.length === 0}
                  >
                    {stopping ? '正在停止…' : '停止'}
                  </button>
                )
              : (
                  <button
                    className="primary-button composer-send"
                    type="submit"
                    disabled={
                      !message.trim()
                      || hasUnavailableMention
                      || busy
                      || composerSubmitting
                      || composerDraft === null
                      || preparingAttachments.length > 0
                      || failedAttachments.length > 0
                    }
                  >
                    {busy || composerSubmitting ? '发送中…' : preparingAttachments.length > 0 ? '处理中…' : '发送'}
                  </button>
                )}
          </div>
          {draggingAttachments && <div className="composer-drop-overlay">释放以添加到这条消息</div>}
        </div>
          </form>
        </div>
      </div>
      {mentionPopover && (
        <MentionProfilePopover
          request={mentionPopover}
          members={snapshot.members}
          profiles={agents}
          onClose={closeMentionPopover}
        />
      )}
    </section>
  )
}

function MentionProfilePopover({
  request,
  members,
  profiles,
  onClose
}: {
  request: MentionPopoverRequest
  members: CampSnapshot['members']
  profiles: AgentProfile[]
  onClose(returnFocus: boolean): void
}): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const focusedPanelRef = useRef(false)
  const [position, setPosition] = useState<{
    top: number
    left: number
    arrowX: number
    placement: 'top' | 'bottom'
  } | null>(null)
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.agentProfileId, member])),
    [members]
  )
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  )

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    let frame = 0
    const update = (): void => {
      if (!document.body.contains(request.trigger)) {
        onClose(false)
        return
      }
      const anchor = request.trigger.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const gap = 9
      const margin = 12
      const availableBelow = window.innerHeight - anchor.bottom
      const placement = availableBelow >= panelRect.height + gap || anchor.top < panelRect.height + gap
        ? 'bottom'
        : 'top'
      const unclampedTop = placement === 'bottom'
        ? anchor.bottom + gap
        : anchor.top - panelRect.height - gap
      const unclampedLeft = anchor.left + (anchor.width / 2) - (panelRect.width / 2)
      const left = Math.max(margin, Math.min(
        unclampedLeft,
        window.innerWidth - panelRect.width - margin
      ))
      const top = Math.max(margin, Math.min(
        unclampedTop,
        window.innerHeight - panelRect.height - margin
      ))
      setPosition({
        top: Math.round(top),
        left: Math.round(left),
        arrowX: Math.round(anchor.left + (anchor.width / 2) - left),
        placement
      })
    }
    frame = window.requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer.disconnect()
    }
  }, [onClose, request.trigger])

  useEffect(() => {
    focusedPanelRef.current = false
  }, [request.trigger])

  useEffect(() => {
    const trigger = request.trigger
    trigger.setAttribute('aria-expanded', 'true')
    trigger.dataset.mentionOpen = 'true'
    return () => {
      trigger.setAttribute('aria-expanded', 'false')
      delete trigger.dataset.mentionOpen
    }
  }, [request.trigger])

  useEffect(() => {
    if (!request.focusPanel || !position || focusedPanelRef.current) return
    focusedPanelRef.current = true
    panelRef.current?.focus({ preventScroll: true })
  }, [position, request.focusPanel])

  useEffect(() => {
    const handlePointerDown = (event: globalThis.PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || request.trigger.contains(target)) return
      onClose(false)
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose(true)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose, request.trigger])

  const profile = request.target.kind === 'member'
    ? profileById.get(request.target.agentProfileId) ?? null
    : null
  const member = request.target.kind === 'member'
    ? memberById.get(request.target.agentProfileId) ?? null
    : null
  const style = {
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    '--mention-popover-arrow-x': `${position?.arrowX ?? 28}px`,
    '--mention-popover-accent': member?.accent ?? 'var(--brand)'
  } as CSSProperties
  const ariaLabel = profile
    ? `${profile.displayName}的基础信息`
    : '所有成员范围'

  return createPortal(
    <div
      ref={panelRef}
      className={`mention-profile-popover${position ? ' is-positioned' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
      data-content-kind={profile ? 'member' : 'group'}
      data-placement={position?.placement ?? 'bottom'}
      tabIndex={-1}
      style={style}
    >
      <div className="mention-profile-popover-arrow" aria-hidden="true" />
      <div className="mention-profile-popover-inner">
        {profile && member
          ? (
              <div className="mention-profile-side-shell">
                <div className="mention-profile-media">
                  <MemberPortrait
                    agentProfileId={profile.id}
                    avatarRef={profile.avatarRef}
                    displayName={profile.displayName}
                    decorative
                    className="mention-profile-portrait"
                  />
                  <span className="mention-profile-portrait-label">PORTRAIT</span>
                </div>
                <div className="mention-profile-copy">
                  <header className="mention-profile-header">
                    <h2>{profile.displayName}</h2>
                    <p>{profile.teamRole.trim() || '未设置角色'}</p>
                  </header>
                  <div className="mention-profile-status" aria-label="队员状态">
                    <span className={`presence-${profile.presence}`}>
                      <i aria-hidden="true" />
                      {mentionPresenceLabel(profile.presence)}
                    </span>
                    <span className={`runtime-${profile.runtimeReadiness.status}`}>
                      <i aria-hidden="true" />
                      {mentionRuntimeLabel(profile)}
                    </span>
                  </div>
                  <dl className="mention-profile-fields">
                    <div>
                      <dt>专业职责</dt>
                      <dd>{profile.professionalResponsibilities.trim() || '未设置'}</dd>
                    </div>
                    <div>
                      <dt>工作准则</dt>
                      <dd>{profile.workingPrinciples.trim() || '未设置'}</dd>
                    </div>
                    <div>
                      <dt>性格底色</dt>
                      <dd>
                        {profile.personalityTraits.length > 0
                          ? (
                              <span className="mention-profile-traits">
                                {profile.personalityTraits.map((trait) => <span key={trait}>{trait}</span>)}
                              </span>
                            )
                          : '未设置'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            )
          : request.target.kind === 'all_members'
            ? (
                <MentionAllMembersPopover
                  request={request.target}
                  memberById={memberById}
                  profileById={profileById}
                />
              )
            : null}
      </div>
    </div>,
    document.body
  )
}

function MentionAllMembersPopover({
  request,
  memberById,
  profileById
}: {
  request: Extract<MentionPopoverRequest['target'], { kind: 'all_members' }>
  memberById: Map<string, CampSnapshot['members'][number]>
  profileById: Map<string, AgentProfile>
}): JSX.Element {
  const rows = request.agentProfileIds.map((agentProfileId) => ({
    agentProfileId,
    member: memberById.get(agentProfileId) ?? null,
    profile: profileById.get(agentProfileId) ?? null
  }))
  const historical = request.context === 'history'
  return (
    <div className="mention-group-popover">
      <header className="mention-group-header">
        <span aria-hidden="true">@</span>
        <div>
          <h2>所有成员</h2>
          <p>广播 Mention</p>
        </div>
      </header>
      <div className="mention-profile-status">
        <span><i aria-hidden="true" />{historical ? `发送时已冻结 ${rows.length} 位收件人` : `当前 ${rows.length} 位在队队员`}</span>
      </div>
      <div className="mention-group-body">
        <p>{historical
          ? '历史消息展示发送接受时冻结的收件人范围，之后的加入或离队不会改写它。'
          : '发送接受时会冻结当前实际寻址的队员集合。'}</p>
        <div className="mention-group-members">
          {rows.map(({ agentProfileId, member, profile }) => {
            const displayName = profile?.displayName ?? member?.displayName ?? '不可用队员'
            return (
              <div className="mention-group-member" key={agentProfileId}>
                <MemberAvatar
                  agentProfileId={agentProfileId}
                  avatarRef={profile?.avatarRef ?? member?.avatarRef ?? null}
                  displayName={displayName}
                  size="mention"
                  decorative
                />
                <strong>{displayName}</strong>
                <span>{mentionPresenceLabel(profile?.presence ?? member?.profilePresence ?? 'removed')}</span>
              </div>
            )
          })}
          {rows.length === 0 && <p className="mention-group-empty">没有可显示的收件人。</p>}
        </div>
      </div>
    </div>
  )
}

function mentionPresenceLabel(presence: AgentProfile['presence']): string {
  return ({ present: '在队', away: '暂离', removed: '已移除' })[presence]
}

function mentionRuntimeLabel(profile: AgentProfile): string {
  const readiness = runtimeReadinessLabel(profile.runtimeReadiness.status)
  return profile.runtimeSelection
    ? `${runtimeAdapterLabel(profile.runtimeSelection.adapterKind)} · ${readiness}`
    : readiness
}

function RuntimeRecoveryDock({
  recovery,
  memberById,
  profileById,
  onConfigure,
  onDismiss
}: {
  recovery: CampRuntimeRecovery
  memberById: Map<string, CampSnapshot['members'][number]>
  profileById: Map<string, AgentProfile>
  onConfigure?(agentProfileId: string): void
  onDismiss?(): void
}): JSX.Element {
  const targetCount = recovery.targets.length
  return (
    <section
      className="runtime-recovery-dock"
      role="alert"
      aria-label="消息未发送，目标队员的 Agent 运行时不可用"
    >
      <header>
        <div className="runtime-recovery-heading">
          <span className="runtime-recovery-symbol" aria-hidden="true">!</span>
          <div>
            <strong>消息未发送</strong>
            <span>{targetCount} 位目标队员暂时不可执行 · 草稿已保留</span>
          </div>
        </div>
        {onDismiss && (
          <button className="icon-button" type="button" aria-label="关闭运行配置提示" onClick={onDismiss}>×</button>
        )}
      </header>
      <div className="runtime-recovery-targets">
        {recovery.targets.map((target) => {
          const displayName = memberById.get(target.agentProfileId)?.displayName
            ?? profileById.get(target.agentProfileId)?.displayName
            ?? '目标队员'
          return (
            <div className="runtime-recovery-target" key={target.agentProfileId}>
              <span className="runtime-recovery-target-mark" aria-hidden="true" />
              <div>
                <strong>{displayName}</strong>
                <small>{runtimeRecoveryReason(target.blockerCode)}</small>
              </div>
              {onConfigure && (
                <button
                  className="quiet-button compact"
                  type="button"
                  aria-label={`配置${displayName}的 Agent 运行时`}
                  onClick={() => onConfigure(target.agentProfileId)}
                >
                  去配置
                </button>
              )}
            </div>
          )
        })}
      </div>
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
        <p>{localizeExecutionEngineTerms(approval.reason ?? 'Agent 运行时请求你选择一个原生权限选项。')}</p>
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
            <p className="approval-option-error">当前 Agent 运行时未提供可无损回传的原生选项，请求无法提交。</p>
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
        这里已经保留当前工作区、队员和 Default Lead。发送第一条消息后，公共讨论、执行过程和最终结论会依次展开。
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
        <span><i aria-hidden="true">◎</i><strong>{activeMembers.length} 位队员已在队</strong></span>
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

function StopOutcomeEvent({
  item,
  onOpenActivity
}: {
  item: Extract<CampConversationTimelineItem, { kind: 'stop_event' }>
  onOpenActivity(): void
}): JSX.Element {
  return (
    <div className="timeline-node run-stopped-event" role="status">
      <div>
        <span><i aria-hidden="true" />你已在 {item.elapsedLabel}后停止</span>
        {item.hasUnsettledExternalEffects && (
          <button type="button" onClick={onOpenActivity}>
            结果待确认 · 查看活动
          </button>
        )}
      </div>
    </div>
  )
}

function MessageSurface({
  copied,
  onCopy,
  children
}: {
  copied: boolean
  onCopy(): void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={`message-surface ${copied ? 'copied' : ''}`.trim()}>
      {children}
      <MessageCopyButton copied={copied} onCopy={onCopy} />
      <span className="copy-feedback" role="status" aria-live="polite">
        {copied ? '已复制' : ''}
      </span>
    </div>
  )
}

function StructuredMessageBody({
  body,
  content,
  members,
  onActivateMemberMention,
  onActivateAllMembersMention
}: {
  body: string
  content: StructuredCampMessageContent | null
  members: CampSnapshot['members']
  onActivateMemberMention?(
    agentProfileId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
}): JSX.Element {
  if (content === null) return <p>{body}</p>
  const memberById = new Map(members.map((member) => [member.agentProfileId, member]))
  return (
    <p className="structured-message-body">
      {content.map((segment, index) => {
        if (segment.kind === 'text') return <span key={`text-${index}`}>{segment.text}</span>
        if (segment.kind === 'all_members_mention') {
          const interactive = Boolean(onActivateAllMembersMention)
          return (
            <span
              className={`message-mention-token all-members${interactive ? ' is-interactive' : ''}`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? '查看所有成员范围' : undefined}
              aria-haspopup={interactive ? 'dialog' : undefined}
              aria-expanded={interactive ? false : undefined}
              key={`all-${index}`}
              onClick={(event) => {
                if (!onActivateAllMembersMention || window.getSelection()?.toString()) return
                onActivateAllMembersMention(event.currentTarget, false)
              }}
              onKeyDown={(event) => {
                if (!onActivateAllMembersMention || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                onActivateAllMembersMention(event.currentTarget, true)
              }}
            >
              @所有成员
            </span>
          )
        }
        const member = memberById.get(segment.agentProfileId)
        const available = Boolean(
          member
          && member.membershipStatus === 'active'
          && member.profilePresence !== 'removed'
        )
        const interactive = Boolean(available && onActivateMemberMention)
        const showMemberProfile = (
          trigger: HTMLElement,
          respectTextSelection: boolean,
          focusPanel: boolean
        ): void => {
          if (!interactive || !member || !onActivateMemberMention) return
          if (respectTextSelection && window.getSelection()?.toString()) return
          onActivateMemberMention(member.agentProfileId, trigger, focusPanel)
        }
        return (
          <span
            className={`message-mention-token${available ? '' : ' is-unavailable'}${interactive ? ' is-interactive' : ''}`}
            data-agent-profile-id={segment.agentProfileId}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive && member ? `查看${member.displayName}的基础信息` : undefined}
            aria-haspopup={interactive ? 'dialog' : undefined}
            aria-expanded={interactive ? false : undefined}
            title={available && member ? `查看${member.displayName}的基础信息` : '该队员已不可用'}
            onClick={(event) => showMemberProfile(event.currentTarget, true, false)}
            onKeyDown={(event) => {
              if ((event.key !== 'Enter' && event.key !== ' ') || !interactive) return
              event.preventDefault()
              showMemberProfile(event.currentTarget, false, true)
            }}
            key={`member-${index}-${segment.agentProfileId}`}
          >
            @{member?.displayName ?? '不可用队员'}
          </span>
        )
      })}
    </p>
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
      <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
        <rect height="10" rx="2" width="10" x="8" y="8" />
        <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </svg>
      <span className="sr-only">{copied ? '已复制' : '复制'}</span>
    </button>
  )
}

function AttachmentCard({
  attachment,
  onRemove,
  timeline = false
}: {
  attachment: CampMessageAttachmentView
  onRemove?: () => void
  timeline?: boolean
}): JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  useEffect(() => {
    if (attachment.previewKind !== 'image') return
    let active = true
    let objectUrl: string | null = null
    void window.rovai.composerAttachments.preview(attachment.id)
      .then((preview) => {
        if (!active || !preview) {
          if (active) setPreviewFailed(true)
          return
        }
        objectUrl = URL.createObjectURL(new Blob(
          [Uint8Array.from(preview.bytes).buffer],
          { type: preview.mediaType }
        ))
        setPreviewUrl(objectUrl)
      })
      .catch(() => {
        if (active) setPreviewFailed(true)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, attachment.previewKind])

  const content = (
    <>
      <span className="attachment-visual" aria-hidden="true">
        {previewUrl
          ? <img src={previewUrl} alt="" />
          : attachment.previewKind === 'image' && !previewFailed ? <i className="attachment-loading" /> : '文'}
      </span>
      <span className="attachment-copy">
        <strong title={attachment.displayName}>{attachment.displayName}</strong>
        <small>{attachmentTypeLabel(attachment.mediaType)} · {formatByteSize(attachment.byteSize)}</small>
      </span>
    </>
  )

  return (
    <div className={`attachment-card ${timeline ? 'timeline-attachment-card' : ''}`}>
      {previewUrl
        ? (
            <Dialog.Root>
              <Dialog.Trigger asChild>
                <button className="attachment-open" type="button" aria-label={`预览附件 ${attachment.displayName}`}>
                  {content}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="attachment-lightbox-overlay" />
                <Dialog.Content className="attachment-lightbox" aria-describedby={undefined}>
                  <Dialog.Title>{attachment.displayName}</Dialog.Title>
                  <img src={previewUrl} alt={attachment.displayName} />
                  <Dialog.Close className="attachment-lightbox-close" aria-label="关闭附件预览">×</Dialog.Close>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          )
        : <div className="attachment-open">{content}</div>}
      {onRemove && (
        <button
          className="attachment-remove"
          type="button"
          aria-label={`移除附件 ${attachment.displayName}`}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  )
}

function AttachmentPlaceholder({
  name,
  state,
  detail,
  onRemove
}: {
  name: string
  state: 'preparing' | 'error'
  detail?: string
  onRemove?: () => void
}): JSX.Element {
  return (
    <div className={`attachment-card attachment-${state}`}>
      <span className="attachment-visual" aria-hidden="true">
        {state === 'preparing' ? <i className="attachment-loading" /> : '!'}
      </span>
      <span className="attachment-copy">
        <strong title={name}>{name}</strong>
        <small title={detail}>{state === 'preparing' ? '正在安全接入…' : detail ?? '附件处理失败'}</small>
      </span>
      {onRemove && (
        <button className="attachment-remove" type="button" aria-label={`移除失败附件 ${name}`} onClick={onRemove}>×</button>
      )}
    </div>
  )
}

function attachmentTypeLabel(mediaType: string): string {
  if (mediaType.startsWith('image/')) return '图片'
  if (mediaType === 'application/pdf') return 'PDF'
  if (mediaType.includes('zip')) return '压缩文件'
  if (mediaType.startsWith('text/')) return '文本'
  return '文件'
}

function attachmentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('25 MiB')) return '文件超过 25 MiB'
  if (message.includes('count limit')) return '一条消息最多 10 个附件'
  if (message.includes('total attachment')) return '附件总大小超过 64 MiB'
  if (message.includes('regular files')) return '仅支持普通文件'
  return '安全接入失败，可移除后重试'
}

function TaskTimelineCard({
  task,
  assigneeName,
  onOpen
}: {
  task: CampTaskView
  assigneeName: string
  onOpen(): void
}): JSX.Element {
  return (
    <button
      aria-label={`打开任务：${task.title}`}
      className="timeline-node timeline-event-card task-event-card"
      type="button"
      onClick={onOpen}
    >
      <span className={`event-card-status status-${task.status}`}>
        {taskStatusLabel(task.status)}
      </span>
      <strong>{task.title}</strong>
      <small>负责人 · {assigneeName}</small>
    </button>
  )
}

function AgentRunConversationMessage({
  run,
  member,
  profile,
  progress,
  campId,
  truncatedEvidence = [],
  loadedEvidenceCount = 0,
  cancelling = false
}: {
  run: AgentRunView
  member: CampSnapshot['members'][number] | null
  profile: AgentProfile | null
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
  loadedEvidenceCount?: number
  cancelling?: boolean
}): JSX.Element {
  const memberName = member?.displayName ?? profile?.displayName ?? run.agentProfileId
  const presentation = agentRunPresentation(run, cancelling)
  return (
    <article
      className={`timeline-node conversation-bubble agent agent-run-message ${cancelling ? 'is-cancelling' : ''}`}
      data-camp-turn-id={run.campTurnId}
      tabIndex={-1}
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
          {(cancelling || run.status !== 'cancelled') && (
            <span className={`run-message-state tone-${presentation.tone}`}>{presentation.label}</span>
          )}
        </div>
        <RunExecutionDisclosure
          run={run}
          progress={progress}
          campId={campId}
          truncatedEvidence={truncatedEvidence}
          loadedEvidenceCount={loadedEvidenceCount}
          cancelling={cancelling}
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
  loadedEvidenceCount = 0,
  finalBody = null,
  cancelling = false
}: {
  run: AgentRunView
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
  loadedEvidenceCount?: number
  finalBody?: string | null
  cancelling?: boolean
}): JSX.Element | null {
  const nonTerminal = NON_TERMINAL_RUNS.has(run.status)
  const active = nonTerminal && !cancelling
  const [open, setOpen] = useState(active)
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, unknown>>({})
  const [loadingEvidenceId, setLoadingEvidenceId] = useState<string | null>(null)
  const [historicalEvidence, setHistoricalEvidence] = useState<AgentRunExecutionEvidenceView[] | null>(null)
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  useEffect(() => setOpen(active), [active])

  const durableEvidenceCount = Math.max(0, run.executionEvidenceCount)
  const historyNeeded = !nonTerminal && loadedEvidenceCount < durableEvidenceCount
  const historicalProgress = useMemo(() => historicalEvidence
    ? buildLiveExecutionProgress(historicalEvidence.map((evidence) => ({
        id: evidence.id,
        agentRunId: evidence.agentRunId,
        eventType: evidence.eventType,
        payload: evidence.payload,
        createdAt: evidence.occurredAt
      })), run.id)
    : null, [historicalEvidence, run.id])
  const effectiveTruncatedEvidence = (historicalEvidence ?? truncatedEvidence)
    .filter((evidence) => evidence.isTruncated)
    .filter(isPresentableExecutionEvidence)
  const effectiveProgress = historicalProgress ?? progress
  const finalKey = finalBody ? comparableMessageText(finalBody) : null
  const processItems = (effectiveProgress?.items ?? []).filter((item) =>
    item.kind !== 'narration' || !finalKey || comparableMessageText(item.body) !== finalKey
  )
  const completeEvidence = selectCompleteExecutionEvidence(effectiveTruncatedEvidence)
  const visibleToolIds = new Set(processItems.flatMap((item) =>
    item.kind === 'tool' ? [item.step.id] : []
  ))
  const standaloneCompleteEvidence = [
    ...completeEvidence.unassigned,
    ...[...completeEvidence.byToolId.entries()].flatMap(([toolId, evidence]) =>
      visibleToolIds.has(toolId) ? [] : [evidence]
    )
  ]
  const hasProgress = processItems.length > 0
  const showUnsettledWarning = run.hasUnsettledExternalEffects && run.status !== 'cancelled'
  if (!nonTerminal && durableEvidenceCount === 0 && !hasProgress && truncatedEvidence.length === 0 && !showUnsettledWarning) {
    return null
  }

  const loadHistoricalEvidence = async (): Promise<void> => {
    if (!historyNeeded || historyStatus === 'loading' || historyStatus === 'ready') return
    setHistoryStatus('loading')
    try {
      const evidence = await loadCompleteAgentRunExecutionEvidence(
        (params) => window.rovai.request<AgentRunExecutionEvidencePage>(
          'agentRunEvidence.list',
          params
        ),
        campId,
        run.id
      )
      setHistoricalEvidence(evidence)
      setHistoryStatus('ready')
    } catch {
      setHistoryStatus('failed')
    }
  }

  const renderCompleteEvidenceControl = (evidence: PresentableExecutionEvidence): JSX.Element => (
    <div className="complete-evidence-control">
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
  )

  const content = (
    <div className="process-content">
      {showUnsettledWarning && (
        <p className="execution-uncertain" role="status">
          仍有外部效果待确认
        </p>
      )}
      {processItems.map((item) => {
        if (item.kind === 'narration') {
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
        const fullEvidence = completeEvidence.byToolId.get(step.id)
        return (
          <details className={`process-action tool-call-disclosure status-${step.status}`} key={item.key}>
            <summary>
              <ToolCallIcon activityDomain={step.activityDomain} status={step.status} />
              <span className="tool-call-title">{step.title}</span>
              <span className="tool-call-source">
                {step.credibility === 'core_verified' ? 'Core 已验证' : 'Runtime 报告'}
              </span>
              <span className={`tool-call-result status-${step.status}`}>
                {toolCallStatusLabel(step.status)}
              </span>
              <span className="tool-call-chevron" aria-hidden="true">⌄</span>
            </summary>
            {step.detail && <pre>{step.detail}</pre>}
            {fullEvidence && renderCompleteEvidenceControl(fullEvidence)}
          </details>
        )
      })}
      {historyStatus === 'loading' && (
        <div className="process-action current" role="status">
          <span className="process-spinner" aria-hidden="true" />
          <span>正在读取完整过程</span>
        </div>
      )}
      {historyStatus === 'failed' && (
        <div className="process-action history-load-error" role="status">
          <span>完整执行过程读取失败。</span>
          <button className="quiet-button compact" type="button" onClick={() => void loadHistoricalEvidence()}>
            重试
          </button>
        </div>
      )}
      {standaloneCompleteEvidence.map((evidence) => (
        <div className="process-action complete-evidence-standalone" key={evidence.id}>
          {renderCompleteEvidenceControl(evidence)}
        </div>
      ))}
      {active && (
        <div className="process-action current" role="status">
          <span className="process-spinner" aria-hidden="true" />
          <span>{run.status === 'waiting'
            ? agentRunWaitDetail(run.waitReason) ?? '等待继续'
            : run.status === 'queued'
              ? '等待开始'
              : '正在处理'}</span>
        </div>
      )}
      {cancelling && nonTerminal && (
        <div className="process-action cancelling" role="status">
          停止请求已发送，正在等待 Agent 运行时退出。
        </div>
      )}
    </div>
  )

  if (cancelling && nonTerminal) {
    return <div className="execution-disclosure run-live is-cancelling">{content}</div>
  }
  if (active) {
    return <div className="execution-disclosure run-live is-running">{content}</div>
  }
  return (
    <details
      className="execution-disclosure worked is-terminal"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        setOpen(nextOpen)
        if (nextOpen) void loadHistoricalEvidence()
      }}
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
  activityDomain,
  status
}: {
  activityDomain: string
  status: string
}): JSX.Element {
  const icon = ({
    shell: '>_',
    file: '±',
    git: '⑂',
    network: '↗',
    permission: '!',
    runtime: '◌',
    plan: '☷',
    tool: '▱',
    unknown: '·'
  } as Record<string, string>)[activityDomain] ?? '·'
  return (
    <span className={`tool-call-icon status-${status}`} aria-hidden="true">
      {icon}
    </span>
  )
}

function toolCallStatusLabel(status: string): string {
  return ({
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    waiting: '等待审批',
    recorded: '已记录'
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

type PresentableExecutionEvidence = AgentRunExecutionEvidenceView & {
  kind: Exclude<AgentRunExecutionEvidenceView['kind'], 'reasoning_summary'>
}

function isPresentableExecutionEvidence(
  evidence: AgentRunExecutionEvidenceView
): evidence is PresentableExecutionEvidence {
  return evidence.kind !== 'reasoning_summary'
}

function evidenceKindLabel(kind: PresentableExecutionEvidence['kind']): string {
  return ({
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
        <div><strong>长期事项</strong><small>创建或指派不会唤醒队员</small></div>
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
        <label className="task-field"><span>负责人</span><select value={assigneeAgentId} disabled={disabled} onChange={(event) => onAssignee(event.currentTarget.value)}><option value="">未分配</option>{unavailableAssignee && <option value={assigneeAgentId}>队员不可用</option>}{members.map((member) => <option value={member.agentProfileId} key={member.agentProfileId}>{member.displayName}</option>)}</select></label>
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
    ?? '队员不可用'
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
