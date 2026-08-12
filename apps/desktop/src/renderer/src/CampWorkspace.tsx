import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type JSX, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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
  MessageDeliveryView,
  TaskStatus,
  TaskView,
  NavigationCampItem,
  SkillDeliveryGroupView,
  SkillView,
  StoredCommandResult,
  StructuredCampMessageContent
} from '@contracts'
import { EmptyInline } from './ui-elements'
import { StructuredMentionComposer } from './StructuredMentionComposer'
import {
  agentRunPresentation,
  agentRunWaitDetail,
  buildLiveExecutionProgress,
  executionEvidenceCopyText,
  formatByteSize,
  type LiveExecutionProgress,
  type LiveRuntimeEvent,
  localDayKey,
  messageClockTime,
  relativeTimeLabel,
  selectCompleteExecutionEvidence,
  toolDetailPreview,
  timelineDayLabel
} from './ui-model'
import { MemberAvatar } from './MemberAvatar'
import { MemberPortrait } from './MemberPortrait'
import { localizeExecutionEngineTerms } from './product-copy'
import { writeClipboardText } from './clipboard'
import { runtimeReadinessLabel } from './runtime-status'
import { SafeMarkdown } from './SafeMarkdown'
import { identityColorToken } from './theme'
import { availableComposerSkillsForLead } from './composer-skill-picker'

const NON_TERMINAL_RUNS = new Set(['queued', 'running', 'waiting'])
const EXECUTION_EVIDENCE_PAGE_LIMIT = 1_000
const EXECUTION_DRAWER_HEIGHT_STORAGE_KEY = 'rovai.execution-drawer-height.v1'
const EXECUTION_DRAWER_HARD_MIN_HEIGHT = 48
const EXECUTION_DRAWER_PREFERRED_MIN_HEIGHT = 160
const EXECUTION_DRAWER_MAX_HEIGHT = 520
const EXECUTION_DRAWER_MAX_VIEWPORT_RATIO = 0.6
const EXECUTION_DRAWER_MIN_TIMELINE_HEIGHT = 112
const EXECUTION_DRAWER_KEYBOARD_STEP = 24
const EXECUTION_DRAWER_KEYBOARD_PAGE_STEP = 80
export type CampInspectorTab = 'tasks' | 'members'

export type AgentExecutionProcess = {
  agentId: string
  runs: AgentRunView[]
}

export type CampMessageSendReceipt = {
  campTurnId: string | null
  agentRunIds: string[]
  addressedAgentIds: string[]
}

type ExecutionDrawerFocusRequest = {
  sequence: number
  moveDomFocus: boolean
}

export function preferredAgentProcessRun(runs: AgentRunView[]): AgentRunView | null {
  const newestFirst = runs.slice().sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  )
  return newestFirst.find((run) => run.status === 'running')
    ?? newestFirst.find((run) => NON_TERMINAL_RUNS.has(run.status))
    ?? newestFirst[0]
    ?? null
}

export function agentExecutionProcesses(runs: AgentRunView[]): AgentExecutionProcess[] {
  const grouped = new Map<string, AgentRunView[]>()
  for (const run of runs) {
    grouped.set(run.agentId, [...(grouped.get(run.agentId) ?? []), run])
  }
  return [...grouped.entries()]
    .map(([agentId, agentRuns]) => ({
      agentId,
      runs: agentRuns.slice().sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
    }))
    .sort((left, right) => {
      const leftLatest = left.runs.at(-1)
      const rightLatest = right.runs.at(-1)
      return (rightLatest?.createdAt ?? '').localeCompare(leftLatest?.createdAt ?? '')
        || left.agentId.localeCompare(right.agentId)
    })
}

export function executionDisclosureOpenAfterActivity(
  currentOpen: boolean,
  active: boolean
): boolean {
  return currentOpen || active
}

export function executionDisclosureIsLiveOpen(
  status: AgentRunView['status'],
  focused: boolean,
  cancelling: boolean
): boolean {
  return NON_TERMINAL_RUNS.has(status) && focused && !cancelling
}

export function firstSubmittedAgentRun(
  receipt: CampMessageSendReceipt,
  runs: readonly AgentRunView[]
): AgentRunView | null {
  const runById = new Map(runs.map((run) => [run.id, run]))
  for (const runId of receipt.agentRunIds) {
    const run = runById.get(runId)
    if (run && (!receipt.campTurnId || run.campTurnId === receipt.campTurnId)) return run
  }
  if (!receipt.campTurnId) return null
  const turnRuns = runs
    .filter((run) => run.campTurnId === receipt.campTurnId)
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
  for (const agentId of receipt.addressedAgentIds) {
    const run = turnRuns.find((candidate) => candidate.agentId === agentId)
    if (run) return run
  }
  return turnRuns[0] ?? null
}

export function isViewingNonTerminalAgentRun(
  selectedAgentId: string | null,
  focusedRunId: string | null,
  runs: readonly AgentRunView[]
): boolean {
  if (!selectedAgentId || !focusedRunId) return false
  const focusedRun = runs.find((run) =>
    run.id === focusedRunId && run.agentId === selectedAgentId
  )
  return Boolean(focusedRun && NON_TERMINAL_RUNS.has(focusedRun.status))
}

export function executionDrawerIsNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 32
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

export type ExecutionDrawerHeightBounds = {
  min: number
  max: number
}

export function executionDrawerHeightBounds(
  timelinePaneHeight: number,
  runPulseHeight: number,
  viewportHeight: number
): ExecutionDrawerHeightBounds {
  const safePaneHeight = Math.max(0, timelinePaneHeight)
  const safePulseHeight = Math.max(0, runPulseHeight)
  const reservedTimelineHeight = Math.min(
    EXECUTION_DRAWER_MIN_TIMELINE_HEIGHT,
    Math.max(EXECUTION_DRAWER_HARD_MIN_HEIGHT, Math.floor(safePaneHeight * 0.25))
  )
  const availableHeight = Math.max(
    EXECUTION_DRAWER_HARD_MIN_HEIGHT,
    Math.floor(safePaneHeight - safePulseHeight - reservedTimelineHeight)
  )
  const viewportLimit = Math.max(
    EXECUTION_DRAWER_HARD_MIN_HEIGHT,
    Math.floor(Math.max(0, viewportHeight) * EXECUTION_DRAWER_MAX_VIEWPORT_RATIO)
  )
  const max = Math.max(
    EXECUTION_DRAWER_HARD_MIN_HEIGHT,
    Math.min(EXECUTION_DRAWER_MAX_HEIGHT, availableHeight, viewportLimit)
  )
  return {
    min: Math.min(EXECUTION_DRAWER_PREFERRED_MIN_HEIGHT, max),
    max
  }
}

export function clampExecutionDrawerHeight(
  height: number,
  bounds: ExecutionDrawerHeightBounds
): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(height)))
}

export function defaultExecutionDrawerMaxHeight(
  viewportWidth: number,
  viewportHeight: number,
  bounds: ExecutionDrawerHeightBounds
): number {
  const responsiveLimit = viewportWidth <= 1_040 && viewportHeight <= 760
    ? 210
    : viewportWidth <= 1_040
      ? 270
      : 320
  return Math.max(
    EXECUTION_DRAWER_HARD_MIN_HEIGHT,
    Math.min(bounds.max, responsiveLimit, Math.floor(Math.max(0, viewportHeight) * 0.38))
  )
}

export function executionDrawerHeightFromStoredValue(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const rounded = Math.round(parsed)
  return rounded >= EXECUTION_DRAWER_HARD_MIN_HEIGHT && rounded <= EXECUTION_DRAWER_MAX_HEIGHT
    ? rounded
    : null
}

function storedExecutionDrawerHeight(): number | null {
  if (typeof window === 'undefined') return null
  try {
    return executionDrawerHeightFromStoredValue(
      window.sessionStorage.getItem(EXECUTION_DRAWER_HEIGHT_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

function persistExecutionDrawerHeight(height: number | null): void {
  if (typeof window === 'undefined') return
  try {
    if (height === null) {
      window.sessionStorage.removeItem(EXECUTION_DRAWER_HEIGHT_STORAGE_KEY)
    } else {
      window.sessionStorage.setItem(EXECUTION_DRAWER_HEIGHT_STORAGE_KEY, String(height))
    }
  } catch {
    // Session persistence is an enhancement; resizing remains usable if storage is unavailable.
  }
}

function scrollExecutionDrawerToLatest(body: HTMLElement): void {
  body.scrollTop = body.scrollHeight
}
export type NotificationFocusTarget = {
  requestId: number
  kind: 'approval' | 'camp_turn'
  campTurnId: string | null
}
export interface CampRuntimeRecoveryTarget {
  agentId: string
  blockerCode: string
}
export interface CampRuntimeRecovery {
  campId: string
  targets: CampRuntimeRecoveryTarget[]
}

type MentionPopoverRequest = {
  target:
    | { kind: 'member'; agentId: string }
    | { kind: 'all_members'; context: 'composer' | 'history'; agentIds: string[] }
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
    case 'runtime_configuration_adapter_mismatch':
      return '运行配置已变更，请重新选择'
    case 'conversation_runtime_override_unsupported':
      return '当前对话的运行配置不受支持'
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
      task: TaskView
    }
  | {
      kind: 'camp_message'
      id: string
      createdAt: string
      timelineGlobalSequence: number | null
      message: CampMessageView
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
    id: `task:${task.taskId}`,
    createdAt: task.createdAt,
    timelineGlobalSequence: taskCreatedSequenceById.get(task.taskId) ?? null,
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

  return [...taskCards, ...publicMessages, ...stopEvents].sort((left, right) => {
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

export function campInspectorMembers(
  members: ReadonlyArray<CampSnapshot['members'][number]>
): CampSnapshot['members'] {
  return members
    .filter((member) => member.membershipStatus === 'active' && member.profilePresence !== 'removed')
    .slice()
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
}

export function campMemberIsLeadEligible(
  member: CampSnapshot['members'][number]
): boolean {
  return member.membershipStatus === 'active'
    && member.profilePresence === 'present'
    && member.leaveRequestedAt === null
}

export function structuredCampContentPlainText(
  content: StructuredCampMessageContent,
  members: ReadonlyArray<Pick<CampSnapshot['members'][number], 'agentId' | 'displayName'>>
): string {
  const names = new Map(members.map((member) => [member.agentId, member.displayName]))
  return content.map((segment) => {
    if (segment.kind === 'text') return segment.text
    if (segment.kind === 'all_members_mention') return '@所有队员'
    return `@${names.get(segment.agentId) ?? '不可用队员'}`
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

  const profileById = new Map(agents.map((agent) => [agent.agentId, agent]))
  const profiles = activeMembers.map((member) => profileById.get(member.agentId))
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
          <p className="eyebrow quick-chat-eyebrow">Quick Chat</p>
          <h2>开始下一段协作</h2>
          <p className="quick-chat-subline">创建一个对话，选好队员与工作区，再写下这次协作的目标。</p>
          {recentCamps.length > 0 && (
            <div className="quick-chat-continue" aria-label="继续未完成的事">
              <div className="quick-chat-continue-title">继续未完成的事</div>
              {recentCamps.map((camp) => (
                <button className="quick-chat-continue-row" type="button" key={camp.id} onClick={() => onOpenCamp(camp)}>
                  <span className="camp-marker-slot" aria-hidden="true">
                    {camp.marker === 'unread_completed' && <i className="task-dot camp-marker-unread_completed" />}
                  </span>
                  <span className="truncate">{camp.title}</span>
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
  agents,
  liveRuntimeEvents = [],
  busy,
  onSend,
  onPendingDraftPersisted,
  onPendingCampLeave,
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
  agents: AgentProfile[]
  liveRuntimeEvents?: LiveRuntimeEvent[]
  busy: boolean
  onSend(draft: CampComposerDraftView): Promise<CampMessageSendReceipt | void>
  onPendingDraftPersisted?(): void
  onPendingCampLeave?(draft: CampComposerDraftView): Promise<void>
  onChangeLead(agentId: string): Promise<void>
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
  onConfigureRuntime?(agentId: string): void
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
  const [composerSkillCatalog, setComposerSkillCatalog] = useState<{
    skills: SkillView[]
    groups: SkillDeliveryGroupView[]
    status: 'loading' | 'ready' | 'error'
  }>({ skills: [], groups: [], status: 'loading' })
  const composerEditorRef = useRef<HTMLDivElement>(null)
  const draftSaveTimer = useRef<number | null>(null)
  const campLeaveTimer = useRef<{ campId: string; timer: number } | null>(null)
  const draftContent = useRef<StructuredCampMessageContent>([])
  const draftCampId = useRef<string | null>(null)
  const composerDraftRef = useRef<CampComposerDraftView | null>(null)
  const draftMutationQueues = useRef(new Map<string, Promise<CampComposerDraftView>>())
  const dragDepth = useRef(0)
  const attachmentPreparationQueue = useRef<Promise<void>>(Promise.resolve())
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const approvalDockRef = useRef<HTMLElement>(null)
  const lastTimelineItemId = useRef<string | null>(null)
  const [localInspectorTab, setLocalInspectorTab] = useState<CampInspectorTab>('tasks')
  const [executionDrawerAgentId, setExecutionDrawerAgentId] = useState<string | null>(null)
  const [executionDrawerFocusedRunId, setExecutionDrawerFocusedRunId] = useState<string | null>(null)
  const [executionDrawerFocusRequest, setExecutionDrawerFocusRequest] = useState<ExecutionDrawerFocusRequest>({
    sequence: 0,
    moveDomFocus: true
  })
  const [submittedExecutionRequest, setSubmittedExecutionRequest] = useState<CampMessageSendReceipt | null>(null)
  const executionDrawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const inspectorTab = controlledInspectorTab ?? localInspectorTab
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [taskFocusRequest, setTaskFocusRequest] = useState(0)
  const memberById = useMemo(
    () => new Map(snapshot.members.map((member) => [member.agentId, member])),
    [snapshot.members]
  )
  const profileById = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent])),
    [agents]
  )
  const composerMembers = useMemo(
    () => snapshot.members.map((member) => ({
      agentId: member.agentId,
      displayName: member.displayName,
      avatarRef: member.avatarRef,
      mentionable: member.membershipStatus === 'active' && member.profilePresence === 'present'
    })),
    [snapshot.members]
  )
  useEffect(() => {
    let cancelled = false
    const loadSkillCatalog = async (): Promise<void> => {
      try {
        const [skills, groups] = await Promise.all([
          window.rovai.request<SkillView[]>('skills.list'),
          window.rovai.request<SkillDeliveryGroupView[]>('skills.deliveryGroups.list')
        ])
        if (!cancelled) setComposerSkillCatalog({ skills, groups, status: 'ready' })
      } catch {
        if (!cancelled) {
          setComposerSkillCatalog((current) => current.status === 'ready'
            ? current
            : { ...current, status: 'error' })
        }
      }
    }
    void loadSkillCatalog()
    const unsubscribe = window.rovai.onEvent((event) => {
      if (event.method !== 'runtime.state') return
      const params = event.params !== null && typeof event.params === 'object'
        ? event.params as Record<string, unknown>
        : {}
      if (params.status === 'ready') void loadSkillCatalog()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  const closeMentionPopover = useCallback((returnFocus: boolean): void => {
    const trigger = mentionPopover?.trigger
    setMentionPopover(null)
    if (returnFocus && trigger) {
      window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }))
    }
  }, [mentionPopover?.trigger])
  const openMemberMentionPopover = (
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void => {
    if (!memberById.has(agentId) || !profileById.has(agentId)) return
    if (mentionPopover?.trigger === trigger) {
      closeMentionPopover(true)
      return
    }
    setMentionPopover({
      target: { kind: 'member', agentId },
      trigger,
      focusPanel
    })
  }
  const openAllMembersMentionPopover = (
    context: 'composer' | 'history',
    agentIds: string[],
    trigger: HTMLElement,
    focusPanel: boolean
  ): void => {
    if (mentionPopover?.trigger === trigger) {
      closeMentionPopover(true)
      return
    }
    setMentionPopover({
      target: { kind: 'all_members', context, agentIds },
      trigger,
      focusPanel
    })
  }

  useEffect(() => setMentionPopover(null), [snapshot.camp.id])
  useEffect(() => {
    setExecutionDrawerAgentId(null)
    setExecutionDrawerFocusedRunId(null)
    setSubmittedExecutionRequest(null)
    executionDrawerTriggerRef.current = null
  }, [snapshot.camp.id])
  useLayoutEffect(() => {
    if (executionDrawerAgentId !== null) return
    const trigger = executionDrawerTriggerRef.current
    executionDrawerTriggerRef.current = null
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
  }, [executionDrawerAgentId])

  const message = useMemo(
    () => structuredCampContentPlainText(messageContent, snapshot.members),
    [messageContent, snapshot.members]
  )
  const hasUnavailableMention = useMemo(
    () => messageContent.some((segment) => {
      if (segment.kind !== 'member_mention') return false
      const member = memberById.get(segment.agentId)
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
  const executionProcesses = useMemo(
    () => agentExecutionProcesses(snapshot.agentRuns),
    [snapshot.agentRuns]
  )
  const executionProcessByAgentId = useMemo(
    () => new Map(executionProcesses.map((process) => [process.agentId, process])),
    [executionProcesses]
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
      snapshot.turns,
      snapshot.timeline,
      snapshot.agentRuns,
      snapshot.tasks
    ),
    [
      snapshot.agentRuns,
      snapshot.tasks,
      snapshot.timeline,
      snapshot.turns,
      visibleCampMessages
    ]
  )
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
  const composerSkills = useMemo(
    () => availableComposerSkillsForLead(
      composerSkillCatalog.skills,
      composerSkillCatalog.groups,
      defaultLead?.agentId ?? null
    ),
    [composerSkillCatalog.groups, composerSkillCatalog.skills, defaultLead?.agentId]
  )
  const activeRuns = snapshot.agentRuns.filter((run) => NON_TERMINAL_RUNS.has(run.status))
  const executionBlocked = activeRuns.length > 0 || stopping
  const executionDrawerProcess = executionDrawerAgentId
    ? executionProcessByAgentId.get(executionDrawerAgentId) ?? null
    : null
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
      if (snapshot.camp.activationState === 'pending') onPendingDraftPersisted?.()
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
    if (campLeaveTimer.current?.campId === campId) {
      window.clearTimeout(campLeaveTimer.current.timer)
      campLeaveTimer.current = null
    }
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
        const content = draftContent.current
        const timer = window.setTimeout(() => {
          if (campLeaveTimer.current?.timer === timer) campLeaveTimer.current = null
          const persistedDraft = saveStructuredDraft(campId, content)
          if (snapshot.camp.activationState === 'pending' && onPendingCampLeave) {
            void persistedDraft.then(onPendingCampLeave).catch(() => undefined)
          } else {
            void persistedDraft.catch(() => undefined)
          }
        }, 0)
        campLeaveTimer.current = { campId, timer }
      }
    }
  }, [snapshot.camp.id])

  useEffect(() => {
    const previousCount = previousPendingApprovalCount.current
    previousPendingApprovalCount.current = pendingApprovals.length
    if (pendingApprovals.length >= previousCount) return
    if (pendingApprovals.length === 0) {
      composerEditorRef.current?.focus()
    }
  }, [pendingApprovals.length])

  useEffect(() => {
    if (busy || composerSubmitting) return
    if (approvalDockRef.current?.contains(document.activeElement)) return
    composerEditorRef.current?.focus()
  }, [busy, composerSubmitting])

  useEffect(() => {
    if (!notificationFocus) return undefined
    const frame = window.requestAnimationFrame(() => {
      const scrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth'
      if (notificationFocus.kind === 'approval') {
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
      const sendReceipt = await onSend(frozenDraft)
      if (sendReceipt?.agentRunIds.length || sendReceipt?.campTurnId) {
        setSubmittedExecutionRequest(sendReceipt)
      }
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

  const openExecutionProcess = (
    agentId: string,
    trigger: HTMLButtonElement | null = null,
    options: { runId?: string | null; moveDomFocus?: boolean } = {}
  ): void => {
    const process = executionProcessByAgentId.get(agentId)
    if (!process) return
    const requestedRun = options.runId
      ? process.runs.find((run) => run.id === options.runId) ?? null
      : null
    const focusedRunId = requestedRun?.id ?? preferredAgentProcessRun(process.runs)?.id ?? null
    if (trigger) executionDrawerTriggerRef.current = trigger
    else if (options.moveDomFocus === false) executionDrawerTriggerRef.current = null
    setExecutionDrawerAgentId(agentId)
    setExecutionDrawerFocusedRunId(focusedRunId)
    setExecutionDrawerFocusRequest((request) => ({
      sequence: request.sequence + 1,
      moveDomFocus: options.moveDomFocus ?? true
    }))
  }

  const closeExecutionProcess = (): void => {
    setExecutionDrawerAgentId(null)
    setExecutionDrawerFocusedRunId(null)
  }

  useEffect(() => {
    if (!submittedExecutionRequest) return
    const targetRun = firstSubmittedAgentRun(submittedExecutionRequest, snapshot.agentRuns)
    if (!targetRun) return
    setSubmittedExecutionRequest(null)
    if (isViewingNonTerminalAgentRun(
      executionDrawerAgentId,
      executionDrawerFocusedRunId,
      snapshot.agentRuns
    )) return
    openExecutionProcess(targetRun.agentId, null, {
      runId: targetRun.id,
      moveDomFocus: false
    })
  }, [
    executionDrawerAgentId,
    executionDrawerFocusedRunId,
    snapshot.agentRuns,
    submittedExecutionRequest
  ])

  return (
    <section className="workspace-shell camp-workspace" aria-label={`Camp：${snapshot.camp.title}`}>
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
                let previousMessageAuthorKey: string | null = null
                for (const timelineItem of conversationTimeline) {
                  const dayKey = localDayKey(timelineItem.createdAt)
                  if (dayKey && dayKey !== lastDayKey) {
                    lastDayKey = dayKey
                    previousMessageAuthorKey = null
                    items.push(
                      <div className="timeline-node timeline-day" key={`day-${dayKey}`}>
                        {timelineDayLabel(timelineItem.createdAt, snapshot.camp.createdAt)}
                      </div>
                    )
                  }
                  if (timelineItem.kind === 'task_card') {
                    previousMessageAuthorKey = null
                    items.push(
                      <TaskTimelineCard
                        key={timelineItem.id}
                        task={timelineItem.task}
                        assigneeName={taskAssigneeName(timelineItem.task, snapshot)}
                        onOpen={() => {
                          setFocusedTaskId(timelineItem.task.taskId)
                          setTaskFocusRequest((request) => request + 1)
                          openInspector('tasks')
                        }}
                      />
                    )
                    continue
                  }
                  if (timelineItem.kind === 'stop_event') {
                    previousMessageAuthorKey = null
                    const turnRun = snapshot.agentRuns
                      .filter((candidate) => candidate.campTurnId === timelineItem.campTurnId)
                      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
                    items.push(
                      <StopOutcomeEvent
                        key={timelineItem.id}
                        item={timelineItem}
                        onOpenDrawer={turnRun
                          ? (trigger) => openExecutionProcess(turnRun.agentId, trigger)
                          : undefined}
                      />
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
                  const displayBody = campMessage.body
                  const messageAuthorKey = campMessage.authorType === 'user' || campMessage.authorType === 'agent'
                    ? `${campMessage.authorType}:${campMessage.authorId}`
                    : null
                  const followsSameAuthor = messageAuthorKey !== null
                    && previousMessageAuthorKey === messageAuthorKey
                  const campMessageDeliveries = snapshot.messageDeliveries.filter((delivery) =>
                    delivery.messageId === campMessage.id
                  )
                  items.push(
                    <article
                      className={`timeline-node conversation-bubble ${campMessage.authorType}${followsSameAuthor ? ' same-author' : ''}`}
                      key={campMessage.id}
                      data-camp-turn-id={sourceRun?.campTurnId}
                      tabIndex={sourceRun ? -1 : undefined}
                      style={member ? { '--agent-accent': identityColorToken(member.agentId) } as React.CSSProperties : undefined}
                    >
                      {campMessage.authorType === 'agent' && (
                        <MemberAvatar
                          agentId={campMessage.authorId}
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
                                {campMessage.authorType === 'agent' && authorProfile?.runtimeConfiguration && (
                                  <span>{runtimeAdapterLabel(authorProfile.runtimeConfiguration.adapterKind)}</span>
                                )}
                                <time title={`#${campMessage.sequence}`}>{messageClockTime(campMessage.createdAt)}</time>
                              </div>
                              <MessageSurface
                                copied={copiedMessageId === campMessage.id}
                                hasDelivery={campMessageDeliveries.length > 0}
                                onCopy={() => copyMessage(campMessage.id, displayBody)}
                              >
                                {campMessage.authorType === 'agent'
                                      ? (
                                          <div className="final-copy">
                                            <SafeMarkdown>{displayBody}</SafeMarkdown>
                                          </div>
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
                                                    campMessage.addressedAgentIds,
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
                              <CampMessageDeliveryFooter
                                deliveries={campMessageDeliveries}
                                memberById={memberById}
                                onActivateMemberMention={openMemberMentionPopover}
                              />
                            </div>
                          )
                        : <p>{displayBody}</p>}
                    </article>
                  )
                  previousMessageAuthorKey = messageAuthorKey
                }
                return items
              })()}
              {conversationTimeline.length === 0 && snapshot.agentRuns.length === 0 && (
                <EmptyCampWelcome
                  snapshot={snapshot}
                  projectName={projectName}
                  agents={agents}
                  onChoosePrompt={chooseStarterPrompt}
                />
              )}
            </div>
          </div>
          <RunPulse
            processes={executionProcesses}
            memberById={memberById}
            stopping={stopping}
            selectedAgentId={executionDrawerAgentId}
            onOpen={openExecutionProcess}
          />
          {executionDrawerProcess && (
            <ExecutionDrawer
              key={executionDrawerProcess.agentId}
              process={executionDrawerProcess}
              member={memberById.get(executionDrawerProcess.agentId) ?? null}
              profile={profileById.get(executionDrawerProcess.agentId) ?? null}
              deliveries={snapshot.messageDeliveries}
              progressByRunId={executionProgressByRunId}
              campId={snapshot.camp.id}
              truncatedEvidenceByRunId={truncatedEvidenceByRunId}
              loadedEvidenceCountByRunId={loadedEvidenceCountByRunId}
              cancellingTurnIds={cancellingTurnIds}
              focusedRunId={executionDrawerFocusedRunId}
              focusRequest={executionDrawerFocusRequest}
              onClose={closeExecutionProcess}
              memberById={memberById}
            />
          )}
        </section>

        {inspectorVisible && <aside className="activity-pane" aria-label="Camp 检查器">
          <Tabs.Root
            value={inspectorTab}
            onValueChange={(value) => selectInspectorTab(value as CampInspectorTab)}
            activationMode="manual"
            className="activity-tabs"
          >
            <Tabs.List className="tabs-list sticky-tabs" aria-label="Camp 详情">
              <Tabs.Trigger value="tasks">任务 <small>{snapshot.tasks.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="members">队员 <small>{campInspectorMembers(snapshot.members).length}</small></Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="tasks" className="tab-scroll task-panel-scroll">
              <TaskPanel
                snapshot={snapshot}
                busy={busy}
                focusTaskId={focusedTaskId}
                focusRequest={taskFocusRequest}
                onTasksChanged={onTasksChanged}
                onOpenAgent={openExecutionProcess}
              />
            </Tabs.Content>
            <Tabs.Content value="members" className="tab-scroll camp-members-panel">
              <CampMembersPanel
                snapshot={snapshot}
                profileById={profileById}
                busy={busy}
                onChangeLead={onChangeLead}
              />
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
              focusRequest={notificationFocus?.kind === 'approval' ? notificationFocus.requestId : null}
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
              skills={composerSkills}
              skillCatalogStatus={composerSkillCatalog.status}
              ariaLabel={`给 ${defaultLead?.displayName ?? 'Default Lead'} 发消息`}
              placeholder="继续提问、补充约束或交付下一项职责…"
              disabled={busy || composerSubmitting}
              editorRef={composerEditorRef}
              onActivateMemberMention={(member, trigger, focusPanel) =>
                openMemberMentionPopover(member.agentId, trigger, focusPanel)}
              onActivateAllMembersMention={(trigger, focusPanel) =>
                openAllMembersMentionPopover(
                  'composer',
                  composerMembers
                    .filter((member) => member.mentionable !== false)
                    .map((member) => member.agentId),
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

function RunPulse({
  processes,
  memberById,
  stopping,
  selectedAgentId,
  onOpen
}: {
  processes: AgentExecutionProcess[]
  memberById: Map<string, CampSnapshot['members'][number]>
  stopping: boolean
  selectedAgentId: string | null
  onOpen(agentId: string, trigger: HTMLButtonElement): void
}): JSX.Element {
  const visibleProcesses = processes.slice().sort((left, right) => {
    const leftPosition = memberById.get(left.agentId)?.memberOrder ?? Number.MAX_SAFE_INTEGER
    const rightPosition = memberById.get(right.agentId)?.memberOrder ?? Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition || left.agentId.localeCompare(right.agentId)
  })
  const activeProcessCount = visibleProcesses.filter((process) =>
    process.runs.some((run) => NON_TERMINAL_RUNS.has(run.status))
  ).length
  if (visibleProcesses.length === 0) return <></>
  return (
    <div className="run-pulse" aria-label="Agent 执行台">
      <div className="run-pulse-heading">
        <span className="run-pulse-mark" aria-hidden="true"><i /></span>
        <strong>执行台</strong>
        <span className="run-pulse-count" aria-live="polite">
          {stopping ? '正在停止当前 CampTurn · ' : activeProcessCount > 0 ? `${activeProcessCount} 位执行中 · ` : ''}
          {visibleProcesses.length} 位队员
        </span>
      </div>
      <ul className="run-pulse-list" aria-label="队员执行过程入口">
        {visibleProcesses.map((process) => {
          const run = preferredAgentProcessRun(process.runs)
          if (!run) return null
          const member = memberById.get(process.agentId)
          const memberName = member?.displayName ?? process.agentId
          const presentation = agentRunPresentation(
            run,
            stopping && NON_TERMINAL_RUNS.has(run.status)
          )
          return (
            <li key={process.agentId}>
              <button
                type="button"
                className={`run-pulse-chip${selectedAgentId === process.agentId ? ' is-selected' : ''}`}
                aria-label={`打开${memberName}的执行过程，${presentation.label}`}
                aria-pressed={selectedAgentId === process.agentId}
                aria-expanded={selectedAgentId === process.agentId}
                aria-controls="agent-execution-drawer"
                data-agent-id={process.agentId}
                onClick={(event) => onOpen(process.agentId, event.currentTarget)}
              >
                <MemberAvatar
                  agentId={process.agentId}
                  avatarRef={member?.avatarRef ?? null}
                  displayName={memberName}
                  size="list"
                  decorative
                />
                <span className="run-pulse-chip-copy"><strong>{memberName}</strong><small>执行过程</small></span>
                <span className={`run-pulse-chip-state tone-${presentation.tone}`}>{presentation.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ExecutionDrawer({
  process,
  member,
  profile,
  deliveries,
  progressByRunId,
  campId,
  truncatedEvidenceByRunId,
  loadedEvidenceCountByRunId,
  cancellingTurnIds,
  focusedRunId,
  focusRequest,
  onClose,
  memberById
}: {
  process: AgentExecutionProcess
  member: CampSnapshot['members'][number] | null
  profile: AgentProfile | null
  deliveries: MessageDeliveryView[]
  progressByRunId: Map<string, LiveExecutionProgress>
  campId: string
  truncatedEvidenceByRunId: Map<string, AgentRunExecutionEvidenceView[]>
  loadedEvidenceCountByRunId: Map<string, number>
  cancellingTurnIds: ReadonlySet<string>
  focusedRunId: string | null
  focusRequest: ExecutionDrawerFocusRequest
  onClose(): void
  memberById: Map<string, CampSnapshot['members'][number]>
}): JSX.Element {
  const drawerRef = useRef<HTMLElement>(null)
  const drawerBodyRef = useRef<HTMLDivElement>(null)
  const resizeGestureRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    moved: boolean
  } | null>(null)
  const [heightBounds, setHeightBounds] = useState<ExecutionDrawerHeightBounds | null>(null)
  const [preferredHeight, setPreferredHeight] = useState<number | null>(storedExecutionDrawerHeight)
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const processRef = useRef(process)
  processRef.current = process
  const resolvedFocusedRun = process.runs.find((run) => run.id === focusedRunId)
    ?? preferredAgentProcessRun(process.runs)
  const resolvedFocusedRunId = resolvedFocusedRun?.id ?? null
  const focusedProgress = resolvedFocusedRunId
    ? progressByRunId.get(resolvedFocusedRunId)
    : undefined
  const progressFollowKey = JSON.stringify([
    resolvedFocusedRun?.status ?? null,
    resolvedFocusedRun?.waitReason ?? null,
    focusedProgress?.items ?? []
  ])
  const followingLatestRef = useRef(false)
  const [followingLatest, setFollowingLatestState] = useState(false)
  const setFollowingLatest = (following: boolean): void => {
    followingLatestRef.current = following
    setFollowingLatestState((current) => current === following ? current : following)
  }
  const appliedHeight = preferredHeight !== null && heightBounds
    ? clampExecutionDrawerHeight(preferredHeight, heightBounds)
    : null

  const applyPreferredHeight = useCallback((height: number): void => {
    const bounds = heightBounds ?? {
      min: EXECUTION_DRAWER_HARD_MIN_HEIGHT,
      max: EXECUTION_DRAWER_MAX_HEIGHT
    }
    const nextHeight = clampExecutionDrawerHeight(height, bounds)
    setPreferredHeight(nextHeight)
    persistExecutionDrawerHeight(nextHeight)
  }, [heightBounds])

  const resetPreferredHeight = useCallback((): void => {
    setPreferredHeight(null)
    persistExecutionDrawerHeight(null)
  }, [])

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const drawer = drawerRef.current
    if (!drawer) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeGestureRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: drawer.getBoundingClientRect().height,
      moved: false
    }
    setResizing(true)
  }

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    const delta = gesture.startY - event.clientY
    if (!gesture.moved && Math.abs(delta) < 2) return
    gesture.moved = true
    event.preventDefault()
    applyPreferredHeight(gesture.startHeight + delta)
  }

  const finishResizeGesture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const gesture = resizeGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resizeGestureRef.current = null
    setResizing(false)
  }

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const bounds = heightBounds
    if (!bounds) return
    const currentHeight = preferredHeight
      ?? measuredHeight
      ?? drawerRef.current?.getBoundingClientRect().height
      ?? bounds.min
    let nextHeight: number | null = null
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        nextHeight = currentHeight + EXECUTION_DRAWER_KEYBOARD_STEP
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        nextHeight = currentHeight - EXECUTION_DRAWER_KEYBOARD_STEP
        break
      case 'PageUp':
        nextHeight = currentHeight + EXECUTION_DRAWER_KEYBOARD_PAGE_STEP
        break
      case 'PageDown':
        nextHeight = currentHeight - EXECUTION_DRAWER_KEYBOARD_PAGE_STEP
        break
      case 'Home':
        nextHeight = bounds.min
        break
      case 'End':
        nextHeight = bounds.max
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        resetPreferredHeight()
        return
      default:
        return
    }
    event.preventDefault()
    applyPreferredHeight(nextHeight)
  }

  useLayoutEffect(() => {
    const drawer = drawerRef.current
    const timelinePane = drawer?.parentElement
    if (!drawer || !timelinePane) return undefined
    const runPulse = timelinePane.querySelector<HTMLElement>('.run-pulse')
    const measure = (): void => {
      const nextBounds = executionDrawerHeightBounds(
        timelinePane.clientHeight,
        runPulse?.getBoundingClientRect().height ?? 0,
        window.innerHeight
      )
      setHeightBounds((current) => current
        && current.min === nextBounds.min
        && current.max === nextBounds.max
        ? current
        : nextBounds)
      const nextMeasuredHeight = Math.round(drawer.getBoundingClientRect().height)
      setMeasuredHeight((current) => current === nextMeasuredHeight ? current : nextMeasuredHeight)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(timelinePane)
    observer?.observe(drawer)
    if (runPulse) observer?.observe(runPulse)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const drawer = drawerRef.current
      if (drawer) setMeasuredHeight(Math.round(drawer.getBoundingClientRect().height))
      if (followingLatestRef.current && drawerBodyRef.current) {
        scrollExecutionDrawerToLatest(drawerBodyRef.current)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [appliedHeight])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && drawerRef.current?.contains(document.activeElement)) {
        event.preventDefault()
        onClose()
      }
    }
    drawerRef.current?.addEventListener('keydown', handleKeyDown)
    return () => {
      drawerRef.current?.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const requestedRunId = focusedRunId
      && processRef.current.runs.some((run) => run.id === focusedRunId)
      ? focusedRunId
      : preferredAgentProcessRun(processRef.current.runs)?.id ?? null
    const runId = requestedRunId
    if (!runId) return undefined
    const run = processRef.current.runs.find((candidate) => candidate.id === runId) ?? null
    const followLatest = Boolean(run && NON_TERMINAL_RUNS.has(run.status))
    setFollowingLatest(followLatest)
    const frame = window.requestAnimationFrame(() => {
      const target = drawerRef.current?.querySelector<HTMLElement>(
        `[data-agent-run-id="${CSS.escape(runId)}"]`
      )
      if (followLatest && drawerBodyRef.current) {
        scrollExecutionDrawerToLatest(drawerBodyRef.current)
      } else {
        target?.scrollIntoView({ block: 'nearest' })
      }
      if (focusRequest.moveDomFocus) target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest.sequence, process.agentId])

  useLayoutEffect(() => {
    if (!followingLatestRef.current || !resolvedFocusedRun) return undefined
    const terminal = !NON_TERMINAL_RUNS.has(resolvedFocusedRun.status)
    const frame = window.requestAnimationFrame(() => {
      const body = drawerBodyRef.current
      if (body) scrollExecutionDrawerToLatest(body)
      if (terminal) setFollowingLatest(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [progressFollowKey, resolvedFocusedRunId])

  const displayName = member?.displayName ?? profile?.displayName ?? process.agentId
  const accessibleHeight = Math.round(
    appliedHeight ?? measuredHeight ?? heightBounds?.min ?? EXECUTION_DRAWER_HARD_MIN_HEIGHT
  )
  const accessibleBounds = heightBounds ?? {
    min: EXECUTION_DRAWER_HARD_MIN_HEIGHT,
    max: EXECUTION_DRAWER_MAX_HEIGHT
  }
  const defaultMaxHeight = heightBounds && typeof window !== 'undefined'
    ? defaultExecutionDrawerMaxHeight(window.innerWidth, window.innerHeight, heightBounds)
    : null
  const drawerStyle: CSSProperties | undefined = appliedHeight === null
    ? defaultMaxHeight === null ? undefined : { maxHeight: defaultMaxHeight }
    : { height: appliedHeight, minHeight: appliedHeight, maxHeight: appliedHeight }

  return (
    <section
      id="agent-execution-drawer"
      ref={drawerRef}
      className={`execution-drawer${preferredHeight !== null ? ' is-user-sized' : ''}${resizing ? ' is-resizing' : ''}`}
      role="region"
      aria-labelledby="execution-drawer-title"
      tabIndex={-1}
      data-user-sized={preferredHeight !== null ? 'true' : 'false'}
      style={drawerStyle}
    >
        <div
          className="execution-drawer-resize-handle"
          role="separator"
          aria-label="调整执行详情高度"
          aria-orientation="horizontal"
          aria-valuemin={accessibleBounds.min}
          aria-valuemax={accessibleBounds.max}
          aria-valuenow={accessibleHeight}
          aria-valuetext={`${accessibleHeight} 像素；上下方向键调整，Enter 恢复默认高度`}
          tabIndex={0}
          title="上下拖拽调整；按 Enter 恢复默认高度"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResizeGesture}
          onPointerCancel={finishResizeGesture}
          onLostPointerCapture={() => {
            resizeGestureRef.current = null
            setResizing(false)
          }}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={resetPreferredHeight}
        />
        <header className="execution-drawer-header">
          <div className="execution-drawer-agent">
            <MemberAvatar
              agentId={process.agentId}
              avatarRef={member?.avatarRef ?? profile?.avatarRef ?? null}
              displayName={displayName}
              size="list"
              decorative
            />
            <div>
              <h2 id="execution-drawer-title">{displayName} · 执行过程</h2>
              <p>
                共 {process.runs.length} 次执行
                {process.runs.some((run) => NON_TERMINAL_RUNS.has(run.status)) && ' · 当前有进行中 AgentRun'}
              </p>
            </div>
          </div>
          <button type="button" className="quiet-button" onClick={onClose} aria-label="收起执行详情">收起</button>
        </header>
        <div
          ref={drawerBodyRef}
          className="execution-drawer-body"
          aria-label={`${displayName}的连续执行历史`}
          data-following-latest={followingLatest ? 'true' : 'false'}
          onScroll={(event) => {
            const body = event.currentTarget
            const eligible = Boolean(
              resolvedFocusedRun && NON_TERMINAL_RUNS.has(resolvedFocusedRun.status)
            )
            setFollowingLatest(eligible && executionDrawerIsNearBottom(
              body.scrollTop,
              body.scrollHeight,
              body.clientHeight
            ))
          }}
        >
          <ol className="execution-process-timeline">
            {process.runs.map((run) => {
              const cancelling = cancellingTurnIds.has(run.campTurnId)
                && NON_TERMINAL_RUNS.has(run.status)
              const focused = run.id === resolvedFocusedRunId
              const state = agentRunPresentation(run, cancelling)
              const runDeliveries = deliveries.filter((delivery) =>
                delivery.targetAgentRunId === run.id
                || (delivery.targetAgentRunId === null && delivery.campTurnId === run.campTurnId)
              )
              return (
                <li
                  className={`execution-process-stage status-${run.status}${focused ? ' is-focused' : ''}`}
                  data-agent-run-id={run.id}
                  key={run.id}
                  tabIndex={-1}
                  aria-current={focused ? 'step' : undefined}
                  aria-label={`${runIntervalLabel(run)}，${state.label}`}
                >
                  <span className="execution-process-node" aria-hidden="true" />
                  <article className="execution-process-card">
                    <header className="execution-run-boundary">
                      <div className="execution-run-boundary-main">
                        <div className="execution-run-time-row">
                          <time>{runIntervalLabel(run)}</time>
                          <span className={`execution-run-boundary-state tone-${state.tone}`}>{state.label}</span>
                          {focused && NON_TERMINAL_RUNS.has(run.status) && (
                            <span className="current-run-badge">当前 AgentRun</span>
                          )}
                        </div>
                        <div className="execution-run-meta">
                          <span>AgentRun <code>{shortIdentity(run.id)}</code></span>
                          <span>{run.invocationKind === 'a2a' ? 'A2A' : '直接执行'}</span>
                          {run.invocationKind === 'a2a' && <span>深度 {run.a2aDepth}</span>}
                          <span>CampTurn <code>{shortIdentity(run.campTurnId)}</code></span>
                        </div>
                      </div>
                    </header>
                    <AgentRunDeliveryRecipients deliveries={runDeliveries} memberById={memberById} />
                    <RunExecutionDisclosure
                      run={run}
                      progress={progressByRunId.get(run.id)}
                      campId={campId}
                      truncatedEvidence={truncatedEvidenceByRunId.get(run.id)}
                      loadedEvidenceCount={loadedEvidenceCountByRunId.get(run.id) ?? 0}
                      cancelling={cancelling}
                      focused={focused}
                    />
                  </article>
                </li>
              )
            })}
          </ol>
        </div>
    </section>
  )
}

function AgentRunDeliveryRecipients({
  deliveries,
  memberById
}: {
  deliveries: MessageDeliveryView[]
  memberById: Map<string, CampSnapshot['members'][number]>
}): JSX.Element | null {
  if (deliveries.length === 0) return null
  const ordered = deliveries.slice().sort((left, right) =>
    left.recipientCanonicalPosition - right.recipientCanonicalPosition
  )
  return (
    <div className="execution-run-recipients" aria-label="协作投递对象">
      <small>协作投递</small>
      {ordered.map((delivery) => {
        const recipient = memberById.get(delivery.recipientAgentId)
        const displayName = recipient?.displayName ?? delivery.recipientAgentId
        return (
          <span className="execution-run-recipient" key={delivery.id}>
            <MemberAvatar
              agentId={delivery.recipientAgentId}
              avatarRef={recipient?.avatarRef ?? null}
              displayName={displayName}
              size="list"
              decorative
            />
            <span>{displayName}</span>
          </span>
        )
      })}
    </div>
  )
}

function CampMessageDeliveryFooter({
  deliveries,
  memberById,
  onActivateMemberMention
}: {
  deliveries: MessageDeliveryView[]
  memberById: Map<string, CampSnapshot['members'][number]>
  onActivateMemberMention(
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
}): JSX.Element | null {
  if (deliveries.length === 0) return null
  const ordered = deliveries.slice().sort((left, right) =>
    left.recipientCanonicalPosition - right.recipientCanonicalPosition
  )
  const deliveryAccent = ordered.length === 1
    ? identityColorToken(ordered[0].recipientAgentId)
    : 'var(--brand)'
  return (
    <footer
      className="message-delivery-footer"
      aria-label="消息发送对象"
      style={{ '--delivery-accent': deliveryAccent } as CSSProperties}
    >
      <span className="message-delivery-handoff-rail" aria-hidden="true" />
      <span className="message-delivery-label">发送给</span>
      <span className="message-delivery-recipients">
        {ordered.map((delivery, index) => {
          const recipient = memberById.get(delivery.recipientAgentId)
          const available = Boolean(
            recipient
            && recipient.membershipStatus === 'active'
            && recipient.profilePresence !== 'removed'
          )
          const displayName = recipient?.displayName ?? delivery.recipientAgentId
          const showMemberProfile = (
            trigger: HTMLElement,
            respectTextSelection: boolean,
            focusPanel: boolean
          ): void => {
            if (!available) return
            if (respectTextSelection && window.getSelection()?.toString()) return
            onActivateMemberMention(delivery.recipientAgentId, trigger, focusPanel)
          }
          return (
            <span className="message-delivery-recipient-group" key={delivery.id}>
              {index > 0 && <span className="message-delivery-recipient-separator" aria-hidden="true">、</span>}
              <span
                className={`message-delivery-recipient-name message-mention-token${available ? ' is-interactive' : ' is-unavailable'}`}
                data-agent-id={delivery.recipientAgentId}
                role={available ? 'button' : undefined}
                tabIndex={available ? 0 : undefined}
                aria-label={available ? `查看${displayName}的基础信息` : undefined}
                aria-haspopup={available ? 'dialog' : undefined}
                aria-expanded={available ? false : undefined}
                title={available ? `查看${displayName}的基础信息` : '该队员已不可用'}
                onClick={(event) => showMemberProfile(event.currentTarget, true, false)}
                onKeyDown={(event) => {
                  if ((event.key !== 'Enter' && event.key !== ' ') || !available) return
                  event.preventDefault()
                  showMemberProfile(event.currentTarget, false, true)
                }}
              >
                @{displayName}
              </span>
            </span>
          )
        })}
      </span>
    </footer>
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
    () => new Map(members.map((member) => [member.agentId, member])),
    [members]
  )
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.agentId, profile])),
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
    ? profileById.get(request.target.agentId) ?? null
    : null
  const member = request.target.kind === 'member'
    ? memberById.get(request.target.agentId) ?? null
    : null
  const style = {
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    '--mention-popover-arrow-x': `${position?.arrowX ?? 28}px`,
    '--mention-popover-accent': member?.accent ?? 'var(--brand)'
  } as CSSProperties
  const ariaLabel = profile
    ? `${profile.displayName}的基础信息`
    : '所有队员范围'

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
                    agentId={profile.agentId}
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
  const rows = request.agentIds.map((agentId) => ({
    agentId,
    member: memberById.get(agentId) ?? null,
    profile: profileById.get(agentId) ?? null
  }))
  const historical = request.context === 'history'
  return (
    <div className="mention-group-popover">
      <header className="mention-group-header">
        <span aria-hidden="true">@</span>
        <div>
          <h2>所有队员</h2>
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
          {rows.map(({ agentId, member, profile }) => {
            const displayName = profile?.displayName ?? member?.displayName ?? '不可用队员'
            return (
              <div className="mention-group-member" key={agentId}>
                <MemberAvatar
                  agentId={agentId}
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
  return profile.runtimeConfiguration
    ? `${runtimeAdapterLabel(profile.runtimeConfiguration.adapterKind)} · ${readiness}`
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
  onConfigure?(agentId: string): void
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
          const displayName = memberById.get(target.agentId)?.displayName
            ?? profileById.get(target.agentId)?.displayName
            ?? '目标队员'
          return (
            <div className="runtime-recovery-target" key={target.agentId}>
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
                  onClick={() => onConfigure(target.agentId)}
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

function CampMembersPanel({
  snapshot,
  profileById,
  busy,
  onChangeLead
}: {
  snapshot: CampSnapshot
  profileById: Map<string, AgentProfile>
  busy: boolean
  onChangeLead(agentId: string): Promise<void>
}): JSX.Element {
  const members = campInspectorMembers(snapshot.members)
  const defaultLead = members.find((member) => member.isDefaultLead) ?? null
  const presentCount = members.filter(campMemberIsLeadEligible).length
  const awayCount = members.length - presentCount

  return (
    <section aria-label="当前 Camp 队员">
      <div className="camp-members-summary">
        <div className="camp-members-summary-line">
          <div>
            <strong>协作队员</strong>
            <small>{presentCount} 位在队 · {awayCount} 位暂离</small>
          </div>
          <span className="camp-members-scope">当前 Camp</span>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="camp-lead-picker"
              type="button"
              disabled={busy || presentCount === 0}
              aria-label={defaultLead
                ? `Default Lead，${defaultLead.displayName}；更换 Default Lead`
                : '选择 Default Lead'}
            >
              {defaultLead
                ? <MemberAvatar agentId={defaultLead.agentId} avatarRef={defaultLead.avatarRef} displayName={defaultLead.displayName} size="mention" decorative />
                : <span className="camp-lead-picker-empty" aria-hidden="true">—</span>}
              <span className="camp-lead-picker-copy">
                <strong>Default Lead · {defaultLead?.displayName ?? '未设置'}</strong>
                <small>{defaultLead?.teamRole || '从在队队员中选择'}</small>
              </span>
              <svg className="camp-lead-picker-chevron" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" viewBox="0 0 16 16">
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="camp-lead-menu"
              align="end"
              sideOffset={5}
              collisionPadding={10}
              aria-label="更换 Default Lead"
            >
              <DropdownMenu.Label className="camp-lead-menu-label">选择 Default Lead</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={defaultLead?.agentId ?? ''}
                onValueChange={(agentId) => {
                  if (!agentId || agentId === defaultLead?.agentId) return
                  void onChangeLead(agentId).catch(() => undefined)
                }}
              >
                {members.map((member) => {
                  const eligible = campMemberIsLeadEligible(member)
                  return (
                    <DropdownMenu.RadioItem
                      className="camp-lead-menu-item"
                      value={member.agentId}
                      key={member.agentId}
                      disabled={busy || !eligible}
                      aria-label={`${member.displayName}，${member.teamRole || '团队角色未设置'}${eligible ? '' : '，暂不可选'}`}
                    >
                      <MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="mention" decorative />
                      <span className="camp-lead-menu-copy">
                        <strong>{member.displayName}</strong>
                        <small>{member.teamRole || '团队角色未设置'} · {eligible ? '在队' : '暂离'}</small>
                      </span>
                      <DropdownMenu.ItemIndicator className="camp-lead-menu-check">✓</DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  )
                })}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="camp-inspector-member-list" role="list" aria-label="Camp 队员列表">
        {members.map((member) => {
          const profile = profileById.get(member.agentId) ?? null
          const present = campMemberIsLeadEligible(member)
          const presenceLabel = member.leaveRequestedAt
            ? '正在暂离'
            : member.profilePresence === 'away'
              ? '暂离'
              : '在队'
          const runtimeLabel = profile ? mentionRuntimeLabel(profile) : 'Agent 运行时未载入'
          const runtimeTone = profile?.runtimeReadiness.status === 'ready'
            ? 'ready'
            : profile?.runtimeReadiness.status === 'needs_attention'
              ? 'attention'
              : 'neutral'
          return (
            <article className={`camp-inspector-member-row ${present ? '' : 'is-away'}`} role="listitem" key={member.agentId}>
              <span className="camp-inspector-member-avatar">
                <MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="list" decorative />
                <i className={present ? '' : 'is-away'} aria-hidden="true" />
              </span>
              <span className="camp-inspector-member-copy">
                <span className="camp-inspector-member-name">
                  <strong>{member.displayName}</strong>
                  {member.isDefaultLead && <small>Lead</small>}
                </span>
                <small>{member.teamRole || '团队角色未设置'}</small>
              </span>
              <span className={`camp-inspector-member-state ${present ? '' : 'is-away'}`}>
                <strong>{presenceLabel}</strong>
                <small className={`runtime-${runtimeTone}`}>{runtimeLabel}</small>
              </span>
            </article>
          )
        })}
        {members.length === 0 && <EmptyInline text="当前 Camp 没有可显示的队员。" />}
      </div>
    </section>
  )
}

function ApprovalDock({
  approvals,
  profileById,
  busy,
  onResolve,
  containerRef,
  focusRequest
}: {
  approvals: ActionApprovalView[]
  profileById: Map<string, AgentProfile>
  busy: boolean
  onResolve(approval: ActionApprovalView, optionId: string): void
  containerRef: RefObject<HTMLElement | null>
  focusRequest: number | null
}): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const previousApprovalCount = useRef(approvals.length)
  const currentIndex = Math.min(activeIndex, approvals.length - 1)
  const approval = approvals[currentIndex]
  const memberNames = [...new Set(approvals.map((item) =>
    profileById.get(item.agentId)?.displayName ?? item.agentId
  ))]

  useEffect(() => {
    if (activeIndex >= approvals.length) setActiveIndex(Math.max(approvals.length - 1, 0))
  }, [activeIndex, approvals.length])

  useEffect(() => {
    const previousCount = previousApprovalCount.current
    previousApprovalCount.current = approvals.length
    if (approvals.length > previousCount) setCollapsed(false)
    if (approvals.length >= previousCount || approvals.length === 0) return undefined
    setCollapsed(false)
    const frame = window.requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLButtonElement>('.runtime-option:not(:disabled)')
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [approvals.length, containerRef])

  useEffect(() => {
    if (focusRequest !== null) setCollapsed(false)
  }, [focusRequest])

  useEffect(() => {
    if (focusRequest === null || collapsed) return undefined
    const frame = window.requestAnimationFrame(() => {
      const target = containerRef.current
        ?.querySelector<HTMLButtonElement>('.runtime-option:not(:disabled)')
        ?? containerRef.current?.querySelector<HTMLButtonElement>('.approval-dock-collapse')
      if (!target) return
      target.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
      })
      target.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [collapsed, containerRef, focusRequest])

  return (
    <section className={collapsed ? 'approval-dock is-collapsed' : 'approval-dock'} aria-label={`${approvals.length} 项待审批`} ref={containerRef}>
      <header>
        <div>
          <strong>{approvals.length > 1 ? `${approvals.length} 项待审批` : '待审批'}</strong>
          <span>{memberNames.join('、')}</span>
        </div>
        <nav aria-label="审批请求控制">
          {approvals.length > 1 && (
            <>
            <button type="button" aria-label="上一项审批" disabled={currentIndex === 0} onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}>‹</button>
            <span>{currentIndex + 1} / {approvals.length}</span>
            <button type="button" aria-label="下一项审批" disabled={currentIndex === approvals.length - 1} onClick={() => setActiveIndex((index) => Math.min(approvals.length - 1, index + 1))}>›</button>
            </>
          )}
          <button
            className="approval-dock-collapse"
            type="button"
            aria-label={collapsed ? '展开审批详情' : '收起审批详情'}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? '⌄' : '⌃'}
          </button>
        </nav>
      </header>
      {!collapsed && <div className="approval-dock-scroll" id={contentId}>
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
      </div>}
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
      <p className="empty-camp-eyebrow">{snapshot.camp.activationState === 'pending' ? '新对话草稿' : '新对话'}</p>
      <h2 id="empty-camp-title">{snapshot.camp.activationState === 'pending' ? '开始一段新对话' : '开始这段协作'}</h2>
      <p className="empty-camp-description">
        {snapshot.camp.activationState === 'pending'
          ? '当前只是一份草稿。输入内容后会自动保留；发送第一条消息时才会正式创建对话。'
          : '这里已经保留当前工作区、队员和 Default Lead。发送第一条消息后，公共讨论、执行过程和最终结论会依次展开。'}
      </p>

      <div className="empty-camp-context" aria-label="当前协作配置">
        <span><i aria-hidden="true">⌂</i><strong>{projectLabel}</strong></span>
        <span className="empty-camp-lead">
          {lead && (
            <MemberAvatar
              agentId={lead.agentId}
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
  onOpenDrawer
}: {
  item: Extract<CampConversationTimelineItem, { kind: 'stop_event' }>
  onOpenDrawer?: (trigger: HTMLButtonElement) => void
}): JSX.Element {
  return (
    <div className="timeline-node run-stopped-event" role="status">
      <div>
        <span><i aria-hidden="true" />你已在 {item.elapsedLabel}后停止</span>
        {item.hasUnsettledExternalEffects && onOpenDrawer && (
          <button type="button" onClick={(event) => onOpenDrawer(event.currentTarget)}>
            结果待确认 · 查看执行详情
          </button>
        )}
      </div>
    </div>
  )
}

function MessageSurface({
  copied,
  hasDelivery,
  onCopy,
  children
}: {
  copied: boolean
  hasDelivery: boolean
  onCopy(): void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={`message-surface${hasDelivery ? ' has-delivery' : ''}${copied ? ' copied' : ''}`}>
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
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
}): JSX.Element {
  if (content === null) return <p>{body}</p>
  const memberById = new Map(members.map((member) => [member.agentId, member]))
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
              aria-label={interactive ? '查看所有队员范围' : undefined}
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
              @所有队员
            </span>
          )
        }
        const member = memberById.get(segment.agentId)
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
          onActivateMemberMention(member.agentId, trigger, focusPanel)
        }
        return (
          <span
            className={`message-mention-token${available ? '' : ' is-unavailable'}${interactive ? ' is-interactive' : ''}`}
            data-agent-id={segment.agentId}
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
            key={`member-${index}-${segment.agentId}`}
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
  task: TaskView
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

type ToolOutputCopyState = 'idle' | 'loading' | 'copied' | 'failed'

function ToolCallDetail({
  campId,
  detail,
  completeEvidence
}: {
  campId: string
  detail: string
  completeEvidence?: PresentableExecutionEvidence
}): JSX.Element {
  const preview = toolDetailPreview(detail, Boolean(completeEvidence))
  const [copyState, setCopyState] = useState<ToolOutputCopyState>('idle')
  const resetTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
  }, [])

  const resetCopyStateLater = (): void => {
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => {
      setCopyState('idle')
      resetTimer.current = null
    }, 1_800)
  }

  const copyFullOutput = async (): Promise<void> => {
    if (copyState === 'loading') return
    setCopyState('loading')
    try {
      const fullText = completeEvidence
        ? await window.rovai.request<{ payload: unknown }>('agentRunEvidence.getContent', {
            campId,
            evidenceId: completeEvidence.id
          }).then((result) => executionEvidenceCopyText(completeEvidence.eventType, result.payload))
        : detail
      if (fullText === null || !(await writeClipboardText(fullText))) {
        throw new Error('Complete Tool output is unavailable')
      }
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    } finally {
      resetCopyStateLater()
    }
  }

  const copyLabel = ({
    idle: '复制完整输出',
    loading: '正在读取完整输出',
    copied: '已复制完整输出',
    failed: '复制完整输出失败，重试'
  } as const)[copyState]

  return (
    <div className={`tool-call-detail${preview.truncated ? ' is-truncated' : ''}`}>
      <pre>{preview.text}</pre>
      {preview.truncated && (
        <button
          className={`tool-output-copy-button state-${copyState}`}
          type="button"
          aria-label={copyLabel}
          title={copyLabel}
          disabled={copyState === 'loading'}
          onClick={() => void copyFullOutput()}
        >
          {copyState === 'loading'
            ? <span aria-hidden="true">…</span>
            : copyState === 'copied'
              ? <span aria-hidden="true">✓</span>
              : copyState === 'failed'
                ? <span aria-hidden="true">!</span>
                : (
                    <svg aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                      <rect height="10" rx="2" width="10" x="8" y="8" />
                      <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === 'idle' ? '' : copyLabel}
      </span>
    </div>
  )
}

function RunExecutionDisclosure({
  run,
  progress,
  campId,
  truncatedEvidence = [],
  loadedEvidenceCount = 0,
  finalBody = null,
  cancelling = false,
  focused = false
}: {
  run: AgentRunView
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
  loadedEvidenceCount?: number
  finalBody?: string | null
  cancelling?: boolean
  focused?: boolean
}): JSX.Element | null {
  const nonTerminal = NON_TERMINAL_RUNS.has(run.status)
  const active = executionDisclosureIsLiveOpen(run.status, focused, cancelling)
  const cancellingActive = nonTerminal && cancelling && focused
  const [open, setOpen] = useState(active)
  const [expandedPayloads, setExpandedPayloads] = useState<Record<string, unknown>>({})
  const [loadingEvidenceId, setLoadingEvidenceId] = useState<string | null>(null)
  const [historicalEvidence, setHistoricalEvidence] = useState<AgentRunExecutionEvidenceView[] | null>(null)
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  useEffect(() => {
    setOpen((currentOpen) => executionDisclosureOpenAfterActivity(currentOpen, active || cancellingActive))
  }, [active, cancellingActive])

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
              <span className={`tool-call-result status-${step.status}`}>
                {toolCallStatusLabel(step.status)}
              </span>
              <span className="tool-call-chevron" aria-hidden="true">⌄</span>
            </summary>
            {step.detail && (
              <ToolCallDetail
                campId={campId}
                detail={step.detail}
                completeEvidence={fullEvidence}
              />
            )}
            {!step.detail && fullEvidence && renderCompleteEvidenceControl(fullEvidence)}
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
      {nonTerminal && !cancelling && (
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

  if (cancellingActive) {
    return <div className="execution-disclosure run-live is-cancelling">{content}</div>
  }
  if (active) {
    return <div className="execution-disclosure run-live is-running">{content}</div>
  }
  return (
    <details
      className={`execution-disclosure worked ${nonTerminal ? 'is-live-collapsed' : 'is-terminal'}`}
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

function runIntervalLabel(run: AgentRunView): string {
  const startedAt = run.startedAt ?? run.createdAt
  const endedAt = NON_TERMINAL_RUNS.has(run.status)
    ? null
    : run.endedAt ?? run.updatedAt
  return `${messageClockTime(startedAt)}–${endedAt ? messageClockTime(endedAt) : '现在'}`
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
  onTasksChanged,
  onOpenAgent = () => {}
}: {
  snapshot: CampSnapshot
  busy: boolean
  focusTaskId?: string | null
  focusRequest?: number
  onTasksChanged(): Promise<void>
  onOpenAgent?(agentId: string, trigger?: HTMLButtonElement): void
}): JSX.Element {
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [acceptanceCriteriaText, setAcceptanceCriteriaText] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [blockedReason, setBlockedReason] = useState('')
  const [completionSummary, setCompletionSummary] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [expectedVersion, setExpectedVersion] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const selectedTask = selectedTaskId
    ? snapshot.tasks.find((task) => task.taskId === selectedTaskId) ?? null
    : null
  const activeMembers = snapshot.members.filter((member) =>
    member.membershipStatus === 'active' && member.leaveRequestedAt === null)

  const resetForm = (): void => {
    setMode('list')
    setSelectedTaskId(null)
    setTitle('')
    setDescription('')
    setAcceptanceCriteriaText('')
    setAssigneeAgentId('')
    setStatus('pending')
    setBlockedReason('')
    setCompletionSummary('')
    setCancelReason('')
    setExpectedVersion(0)
    setFormError(null)
  }

  const beginCreate = (): void => {
    resetForm()
    setMode('create')
  }

  const beginEdit = (task: TaskView): void => {
    setSelectedTaskId(task.taskId)
    setTitle(task.title)
    setDescription(task.description)
    setAcceptanceCriteriaText(task.acceptanceCriteria.join('\n'))
    setAssigneeAgentId(task.assigneeAgentId ?? '')
    setStatus(task.status)
    setBlockedReason(task.blockedReason ?? '')
    setCompletionSummary(task.completionSummary ?? '')
    setCancelReason(task.cancelReason ?? '')
    setExpectedVersion(task.version)
    setFormError(null)
    setMode('edit')
  }

  useEffect(() => {
    if (!focusTaskId || focusRequest === 0) return
    const task = snapshot.tasks.find((candidate) => candidate.taskId === focusTaskId)
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
    if (!assigneeAgentId) {
      setFormError('请选择负责人。')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('tasks.create', {
        commandId: crypto.randomUUID(),
        campId: snapshot.camp.id,
        title: title.trim(),
        description: description.trim(),
        acceptanceCriteria: parseAcceptanceCriteria(acceptanceCriteriaText),
        assigneeAgentId
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
    if ((status === 'in_progress' || status === 'blocked') && !assigneeAgentId) {
      setFormError('进行中或已阻塞的 Task 必须有负责人。')
      return
    }
    if (status === 'blocked' && !blockedReason.trim()) {
      setFormError('请填写阻塞原因。')
      return
    }
    if (status === 'completed' && !completionSummary.trim()) {
      setFormError('请填写完成摘要。')
      return
    }
    setSubmitting(true)
    setFormError(null)
    const assignee = assigneeAgentId === (selectedTask.assigneeAgentId ?? '')
      ? { operation: 'unchanged' as const }
      : assigneeAgentId
        ? { operation: 'assign' as const, agentId: assigneeAgentId }
        : { operation: 'clear' as const }
    const criteria = parseAcceptanceCriteria(acceptanceCriteriaText)
    try {
      const result = await window.rovai.request<StoredCommandResult>('tasks.update', {
        commandId: crypto.randomUUID(),
        campId: snapshot.camp.id,
        taskId: selectedTask.taskId,
        expectedVersion,
        title: title.trim(),
        description: description.trim(),
        acceptanceCriteria: criteria.length > 0
          ? { operation: 'replace', items: criteria }
          : { operation: 'clear' },
        status,
        assignee,
        blockedReason: status === 'blocked' ? blockedReason.trim() : undefined,
        completionSummary: status === 'completed' ? completionSummary.trim() : undefined
      })
      if (result.status === 'rejected') {
        if (result.code === 'task.version_conflict') {
          const current = await window.rovai.request<TaskView | null>('tasks.get', {
            campId: snapshot.camp.id,
            taskId: selectedTask.taskId
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

  const submitCancel = async (): Promise<void> => {
    if (!selectedTask || !cancelReason.trim() || submitting || busy) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('tasks.update', {
        commandId: crypto.randomUUID(),
        campId: snapshot.camp.id,
        taskId: selectedTask.taskId,
        expectedVersion,
        status: 'cancelled',
        cancelReason: cancelReason.trim(),
        assignee: { operation: 'unchanged' },
        acceptanceCriteria: { operation: 'unchanged' }
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
            acceptanceCriteriaText={acceptanceCriteriaText}
            assigneeAgentId={assigneeAgentId}
            status="pending"
            members={activeMembers}
            disabled={submitting || busy}
            showStatus={false}
            requireAssignee
            onTitle={setTitle}
            onDescription={setDescription}
            onAcceptanceCriteria={setAcceptanceCriteriaText}
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
            acceptanceCriteriaText={acceptanceCriteriaText}
            assigneeAgentId={assigneeAgentId}
            status={status}
            blockedReason={blockedReason}
            completionSummary={completionSummary}
            cancelReason={cancelReason}
            members={activeMembers}
            disabled={terminal || submitting || busy}
            showStatus
            onTitle={setTitle}
            onDescription={setDescription}
            onAcceptanceCriteria={setAcceptanceCriteriaText}
            onAssignee={setAssigneeAgentId}
            onStatus={setStatus}
            onBlockedReason={setBlockedReason}
            onCompletionSummary={setCompletionSummary}
          />
          <TaskAuditDetail task={selectedTask} snapshot={snapshot} />
          <RelatedTaskExecution task={selectedTask} snapshot={snapshot} onOpenAgent={onOpenAgent} />
          {formError && <p className="task-form-error" role="alert">{formError}</p>}
          {terminal
            ? <p className="task-terminal-note">已结束的 Task 保留为只读记录，不能重新打开或删除。</p>
            : <>
                <button className="primary-button task-submit" type="submit" disabled={!title.trim() || submitting || busy}>{submitting ? '正在保存…' : '保存修改'}</button>
                <div className="task-cancel-zone">
                  <strong>取消 Task</strong>
                  <p>取消 Task 不会取消已经接受或正在运行的 AgentRun。</p>
                  <label className="task-field"><span>取消原因</span><textarea value={cancelReason} rows={2} maxLength={4000} disabled={submitting || busy} onChange={(event) => setCancelReason(event.currentTarget.value)} /></label>
                  <button className="danger-button" type="button" disabled={!cancelReason.trim() || submitting || busy} onClick={() => void submitCancel()}>确认取消 Task</button>
                </div>
              </>}
        </form>
      )}

      {mode === 'list' && (
        <div className="task-list">
          {snapshot.tasks.map((task) => (
            <button className="task-list-row" type="button" key={task.taskId} onClick={() => beginEdit(task)}>
              <span className={`task-state-dot state-${task.status}`} aria-hidden="true" />
              <span className="task-list-copy"><strong>{task.title}</strong><small>{taskListPreview(task) || '没有补充说明'}</small></span>
              <span className="task-list-meta"><b>{taskStatusLabel(task.status)}</b><small>{taskAssigneeName(task, snapshot)} · {task.acceptanceCriteria.length} 个验收条件</small></span>
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
  acceptanceCriteriaText,
  assigneeAgentId,
  status,
  blockedReason = '',
  completionSummary = '',
  cancelReason = '',
  members,
  disabled,
  showStatus,
  requireAssignee = false,
  onTitle,
  onDescription,
  onAcceptanceCriteria,
  onAssignee,
  onStatus,
  onBlockedReason = () => {},
  onCompletionSummary = () => {}
}: {
  title: string
  description: string
  acceptanceCriteriaText: string
  assigneeAgentId: string
  status: TaskStatus
  blockedReason?: string
  completionSummary?: string
  cancelReason?: string
  members: CampSnapshot['members']
  disabled: boolean
  showStatus: boolean
  requireAssignee?: boolean
  onTitle(value: string): void
  onDescription(value: string): void
  onAcceptanceCriteria(value: string): void
  onAssignee(value: string): void
  onStatus(value: TaskStatus): void
  onBlockedReason?(value: string): void
  onCompletionSummary?(value: string): void
}): JSX.Element {
  const unavailableAssignee = assigneeAgentId
    && !members.some((member) => member.agentId === assigneeAgentId)

  return (
    <>
      <label className="task-field"><span>标题</span><input value={title} maxLength={160} required disabled={disabled} onChange={(event) => onTitle(event.currentTarget.value)} /></label>
      <label className="task-field"><span>说明</span><textarea value={description} rows={4} maxLength={8000} disabled={disabled} onChange={(event) => onDescription(event.currentTarget.value)} placeholder="记录需要跨消息持续跟踪的责任与边界…" /></label>
      <label className="task-field"><span>验收条件（每行一项，最多 12 项）</span><textarea value={acceptanceCriteriaText} rows={3} maxLength={6000} disabled={disabled} onChange={(event) => onAcceptanceCriteria(event.currentTarget.value)} /></label>
      <div className="task-field-grid">
        <label className="task-field"><span>负责人</span><select value={assigneeAgentId} required={requireAssignee} disabled={disabled} onChange={(event) => onAssignee(event.currentTarget.value)}><option value="">{requireAssignee ? '请选择负责人' : '未分配'}</option>{unavailableAssignee && <option value={assigneeAgentId}>队员不可用</option>}{members.map((member) => <option value={member.agentId} key={member.agentId}>{member.displayName}{member.profilePresence === 'away' ? '（离开）' : ''}</option>)}</select></label>
        {showStatus && <label className="task-field"><span>状态</span><select value={status} disabled={disabled} onChange={(event) => onStatus(event.currentTarget.value as TaskStatus)}><option value="pending">待处理</option><option value="in_progress">进行中</option><option value="blocked">已阻塞</option><option value="completed">已完成</option>{status === 'cancelled' && <option value="cancelled">已取消</option>}</select></label>}
      </div>
      {showStatus && status === 'blocked' && <label className="task-field"><span>阻塞原因</span><textarea value={blockedReason} rows={3} maxLength={4000} required disabled={disabled} onChange={(event) => onBlockedReason(event.currentTarget.value)} /></label>}
      {showStatus && status === 'completed' && <label className="task-field"><span>完成摘要</span><textarea value={completionSummary} rows={3} maxLength={4000} required disabled={disabled} onChange={(event) => onCompletionSummary(event.currentTarget.value)} /></label>}
      {showStatus && status === 'cancelled' && <label className="task-field"><span>取消原因</span><textarea value={cancelReason} rows={3} disabled readOnly /></label>}
    </>
  )
}

function taskStatusLabel(status: TaskStatus): string {
  if (status === 'in_progress') return '进行中'
  if (status === 'blocked') return '已阻塞'
  if (status === 'completed') return '已完成'
  if (status === 'cancelled') return '已取消'
  return '待处理'
}

function parseAcceptanceCriteria(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

function taskListPreview(task: TaskView): string {
  if (task.status === 'blocked') return task.blockedReason ?? ''
  if (task.status === 'completed') return task.completionSummary ?? ''
  if (task.status === 'cancelled') return task.cancelReason ?? ''
  return task.description
}

function TaskAuditDetail({ task, snapshot }: { task: TaskView; snapshot: CampSnapshot }): JSX.Element {
  const releaseEvent = [...snapshot.timeline].reverse().find((event) =>
    event.entityType === 'task'
      && event.entityId === task.taskId
      && typeof event.payload === 'object'
      && event.payload !== null
      && 'cause' in event.payload
  )
  const cause = releaseEvent && typeof releaseEvent.payload === 'object' && releaseEvent.payload !== null
    ? String((releaseEvent.payload as { cause?: unknown }).cause ?? '')
    : ''
  return (
    <section className="task-detail-section" aria-label="Task 审计信息">
      <strong>责任与审计</strong>
      <dl className="task-detail-grid">
        <div><dt>创建者</dt><dd>{task.createdByType} · {task.createdById}</dd></div>
        <div><dt>来源 AgentRun</dt><dd>{task.sourceAgentRunId ?? '无'}</dd></div>
        <div><dt>创建时间</dt><dd>{formatDateTime(task.createdAt)}</dd></div>
        <div><dt>更新时间</dt><dd>{formatDateTime(task.updatedAt)}</dd></div>
        <div><dt>结束者</dt><dd>{task.closedByType ? `${task.closedByType} · ${task.closedById}` : '未结束'}</dd></div>
        <div><dt>结束时间</dt><dd>{task.closedAt ? formatDateTime(task.closedAt) : '未结束'}</dd></div>
        {cause && <div><dt>审计原因</dt><dd>{cause}</dd></div>}
      </dl>
    </section>
  )
}

function RelatedTaskExecution({
  task,
  snapshot,
  onOpenAgent
}: {
  task: TaskView
  snapshot: CampSnapshot
  onOpenAgent(agentId: string, trigger?: HTMLButtonElement): void
}): JSX.Element {
  const runs = snapshot.agentRuns.filter((run) => run.taskId === task.taskId)
  const processes = agentExecutionProcesses(runs)
  const deliveries = snapshot.messageDeliveries.filter((delivery) => delivery.taskId === task.taskId)
  return (
    <section className="task-detail-section" aria-label="关联执行">
      <strong>关联执行</strong>
      <p>{runs.length} 个 AgentRun · {deliveries.length} 个 MessageDelivery</p>
      <div className="task-related-runs">
        {processes.map((process) => {
          const run = preferredAgentProcessRun(process.runs)
          const memberName = snapshot.members.find((member) => member.agentId === process.agentId)?.displayName
            ?? process.agentId
          return (
            <button
              className="quiet-button compact"
              type="button"
              key={process.agentId}
              onClick={(event) => onOpenAgent(process.agentId, event.currentTarget)}
            >
              {memberName} · {run ? agentRunPresentation(run).label : '执行过程'}
            </button>
          )
        })}
        {runs.length === 0 && <small>尚无关联执行</small>}
      </div>
    </section>
  )
}

function taskAssigneeName(task: TaskView, snapshot: CampSnapshot): string {
  if (!task.assigneeAgentId) return '未分配'
  return snapshot.members.find((member) => member.agentId === task.assigneeAgentId)?.displayName
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

function shortIdentity(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}
