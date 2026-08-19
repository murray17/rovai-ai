import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent, type JSX, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tabs from '@radix-ui/react-tabs'
import type {
  ActionApprovalView,
  AdapterInstallation,
  AgentProfile,
  AgentRunExecutionEvidencePage,
  AgentRunExecutionEvidenceView,
  AgentRunView,
  BuiltinMemberAvatarRole,
  CampComposerDraftView,
  CampComposerReplyRecipient,
  CampMessageAttachmentView,
  CampMessageAroundSnapshot,
  CampMessageFindSnapshot,
  CampMessageView,
  CampOpenCollectionCoverage,
  CampOpenMessageCoverage,
  CampOpenProjection,
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
  activityStatusForAgentRun,
  agentRunPresentation,
  agentRunWaitDetail,
  buildLiveExecutionProgress,
  executionEvidenceResultText,
  formatByteSize,
  liveRuntimeEventFromExecutionEvidence,
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
import { writeClipboardText } from './clipboard'
import { runtimeReadinessLabel } from './runtime-status'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { SafeMarkdown } from './SafeMarkdown'
import { RuntimeFailureNotice } from './RuntimeFailureNotice'
import { identityColorToken } from './theme'
import { availableComposerSkillsForLead } from './composer-skill-picker'
import { createStructuredMessageClipboardData } from './structured-message-clipboard'
import { CampWorldMap } from './CampWorldMap'
import { projectCampWorldMap } from './camp-world-map-model'
import {
  CAMP_TIMELINE_READING_POSITIONS_STORAGE_KEY,
  campTimelineContentChanged,
  campTimelineFollowingLatestAfterScroll,
  campTimelineIsNearBottom,
  campTimelineReadingPositionFromStoredValue,
  followLatestCampTimeline,
  restoredCampTimelineScrollTop,
  storedCampTimelineReadingPositionsWithUpdate,
  type CampTimelineReadingPosition,
  type CampTimelineViewportGeometry
} from './camp-timeline-position'
import {
  applyConversationFindHighlights,
  centeredConversationFindScrollTop,
  conversationFindCurrentRange,
  nextConversationFindIndex,
  pendingConversationFindStatus
} from './camp-conversation-find'

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
const CAMP_CONVERSATION_VIEW_STORAGE_KEY = 'rovai.camp-conversation-view.v1'
export type CampInspectorTab = 'tasks' | 'members'
export type CampConversationView = 'conversation' | 'world'
export interface FirstRunCampContext {
  memberAgentId: string
  memberRole: BuiltinMemberAvatarRole
}
type ExecutionConsolePlacement = 'bottom' | 'inspector'
type CampInspectorSurfaceTab = CampInspectorTab | 'execution'
type AttachmentKind = 'file' | 'directory'
type AttachmentDragKind = 'files' | 'directory'
type AttachmentPreparationInput = { file: File; kindHint: AttachmentKind }
type ReplyFocusModality = 'pointer' | 'keyboard'
type ConversationFindStatus = 'idle' | 'searching' | 'loading_target' | 'ready' | 'error'

interface ExecutionConsoleReadingPosition {
  outerRatio: number
  results: Map<string, number>
}

function scrollPositionRatio(element: HTMLElement): number | null {
  const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
  return maximum > 0 ? element.scrollTop / maximum : null
}

function captureExecutionConsoleReadingPosition(
  drawer: HTMLElement | null,
  fallback: ExecutionConsoleReadingPosition | null = null
): ExecutionConsoleReadingPosition | null {
  const body = drawer?.querySelector<HTMLElement>('.execution-drawer-body') ?? null
  if (!drawer || !body) return null
  const results = new Map<string, number>()
  for (const result of drawer.querySelectorAll<HTMLElement>('[data-tool-result-key]')) {
    const key = result.dataset.toolResultKey
    if (!key) continue
    results.set(key, scrollPositionRatio(result) ?? fallback?.results.get(key) ?? 0)
  }
  return {
    outerRatio: scrollPositionRatio(body) ?? fallback?.outerRatio ?? 0,
    results
  }
}

function restoreExecutionConsoleReadingPosition(
  drawer: HTMLElement | null,
  position: ExecutionConsoleReadingPosition
): void {
  const body = drawer?.querySelector<HTMLElement>('.execution-drawer-body') ?? null
  if (!drawer || !body) return
  body.scrollTop = Math.round(
    Math.max(0, body.scrollHeight - body.clientHeight) * position.outerRatio
  )
  for (const result of drawer.querySelectorAll<HTMLElement>('[data-tool-result-key]')) {
    const key = result.dataset.toolResultKey
    const ratio = key ? position.results.get(key) : undefined
    if (ratio === undefined) continue
    result.scrollTop = Math.round(
      Math.max(0, result.scrollHeight - result.clientHeight) * ratio
    )
  }
}

export function canStopAgentRun(
  run: Pick<AgentRunView, 'status' | 'waitReason' | 'cancelRequestedAt'>,
  turn: Pick<CampSnapshot['turns'][number], 'cancelRequestedAt'> | null
): boolean {
  return NON_TERMINAL_RUNS.has(run.status)
    && run.cancelRequestedAt === null
    && run.waitReason !== 'recovery_blocked'
    && turn?.cancelRequestedAt === null
}

export type AgentRunStopViewState =
  | 'available'
  | 'stopping'
  | 'confirming'
  | 'stopped'
  | 'hidden'

export function agentRunStopViewState(
  run: Pick<AgentRunView, 'status' | 'waitReason' | 'cancelRequestedAt'>,
  turn: Pick<CampSnapshot['turns'][number], 'cancelRequestedAt'> | null,
  local: { cancelling: boolean; confirming: boolean; turnCancelling: boolean }
): AgentRunStopViewState {
  if (run.status === 'cancelled') return 'stopped'
  if (run.cancelRequestedAt !== null || local.cancelling || local.turnCancelling) return 'stopping'
  if (local.confirming) return 'confirming'
  return canStopAgentRun(run, turn) ? 'available' : 'hidden'
}

interface ConversationFindState {
  open: boolean
  query: string
  status: ConversationFindStatus
  snapshot: CampMessageFindSnapshot | null
  error: string | null
}

interface TimelineMessageAnchor {
  messageId: string
  topOffset: number
}

interface ConversationFindRestorePoint {
  campId: string
  scrollTop: number
  followingLatest: boolean
  anchor: TimelineMessageAnchor | null
  focusedElement: HTMLElement | null
}

function visibleTimelineMessageAnchor(timeline: HTMLElement): TimelineMessageAnchor | null {
  const viewport = timeline.getBoundingClientRect()
  for (const message of timeline.querySelectorAll<HTMLElement>('[data-message-id]')) {
    const bounds = message.getBoundingClientRect()
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
    const messageId = message.dataset.messageId
    if (messageId) return { messageId, topOffset: bounds.top - viewport.top }
  }
  return null
}

export function composerDraftNeedsReplyRepair(draft: CampComposerDraftView | null): boolean {
  const intent = draft?.replyIntent
  if (!intent) return false
  if (intent.targetState === 'message_unavailable' || intent.recipientSelectionRequired) return true
  const author = intent.author
  return author?.authorType === 'agent'
    && author.recipientAvailability === 'unavailable'
    && draft.content.some((segment) =>
      segment.kind === 'member_mention' && segment.agentId === author.authorId
    )
}

export function composerDraftNeedsContinuationRepair(
  draft: CampComposerDraftView | null,
  members: CampSnapshot['members'],
  hasLocalPayload = false
): boolean {
  const intent = draft?.continuationIntent
  if (!intent || draft?.replyIntent || !hasLocalPayload) return false
  const member = members.find(({ agentId }) => agentId === intent.recipient.agentId)
  const available = member?.membershipStatus === 'active' && member.profilePresence === 'present'
  return intent.recipientSelectionRequired || !available
}

export function composerRecipientSummary(
  content: StructuredCampMessageContent,
  members: CampSnapshot['members']
): string | null {
  if (content.some((segment) =>
    segment.kind === 'member_mention' || segment.kind === 'all_members_mention'
  )) return null
  const defaultLead = members.find((member) => member.isDefaultLead)
  return `默认由 Lead · ${defaultLead?.displayName ?? '当前不可用'}接收`
}

export function campConversationViewFromStoredValue(value: string | null): CampConversationView {
  return value === 'conversation' ? 'conversation' : 'world'
}

export function initialCampConversationView(
  storedValue: string | null,
  showingFirstRunWelcome: boolean
): CampConversationView {
  return showingFirstRunWelcome ? 'conversation' : campConversationViewFromStoredValue(storedValue)
}

export function dataTransferContainsFiles(dataTransfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

export function attachmentDragKind(
  dataTransfer: Pick<DataTransfer, 'items' | 'types'>
): AttachmentDragKind | null {
  if (!dataTransferContainsFiles(dataTransfer)) return null
  const fileItems = Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
  if (fileItems.length !== 1) return 'files'
  const entry = fileItems[0].webkitGetAsEntry?.()
  return entry?.isDirectory ? 'directory' : 'files'
}

export function droppedAttachmentInputs(
  dataTransfer: Pick<DataTransfer, 'files' | 'items'>
): AttachmentPreparationInput[] {
  const fromItems = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile()
      if (!file) return []
      return [{
        file,
        kindHint: item.webkitGetAsEntry?.()?.isDirectory ? 'directory' : 'file'
      } satisfies AttachmentPreparationInput]
    })
  if (fromItems.length > 0) return fromItems
  return Array.from(dataTransfer.files).map((file) => ({ file, kindHint: 'file' }))
}

export type AgentExecutionProcess = {
  agentId: string
  runs: AgentRunView[]
}

export function agentRunCountsAsExecuting(run: Pick<AgentRunView, 'status' | 'waitReason'>): boolean {
  return NON_TERMINAL_RUNS.has(run.status) && run.waitReason !== 'recovery_blocked'
}

export function agentRunRuntimeModelPresentation(
  runtimeModel: AgentRunView['runtimeModel']
): { modelId: string; observed: boolean } | null {
  if (!runtimeModel) return null
  return runtimeModel.modelId
    ? { modelId: runtimeModel.modelId, observed: true }
    : { modelId: 'Agent 运行时默认', observed: false }
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

export function taskCreationBlocksSubmittedRunAutoFocus(
  taskCreationActive: boolean,
  inspectorVisible: boolean,
  inspectorSurfaceTab: CampInspectorSurfaceTab
): boolean {
  return taskCreationActive && inspectorVisible && inspectorSurfaceTab === 'tasks'
}

export function executionConsoleIsVisible(
  placement: ExecutionConsolePlacement,
  inspectorVisible: boolean,
  inspectorSurfaceTab: CampInspectorSurfaceTab
): boolean {
  return placement === 'bottom'
    || (inspectorVisible && inspectorSurfaceTab === 'execution')
}

export function attachmentDropIsBlocked(
  executionDrawerPresent: boolean,
  mentionPopoverPresent: boolean,
  executionPlacement: ExecutionConsolePlacement,
  inspectorVisible: boolean,
  inspectorSurfaceTab: CampInspectorSurfaceTab
): boolean {
  return mentionPopoverPresent || (
    executionDrawerPresent
    && executionConsoleIsVisible(executionPlacement, inspectorVisible, inspectorSurfaceTab)
  )
}

export function agentRunTerminalNote(
  run: Pick<AgentRunView, 'terminalReasonCode'>
): string | null {
  return run.terminalReasonCode === 'planned_shutdown_cancelled'
    ? '因 Rovai 计划关闭，执行引擎已确认取消本次执行。'
    : null
}

export function agentRunShowsUnsettledWarning(
  run: Pick<AgentRunView, 'status' | 'hasUnsettledExternalEffects'>
): boolean {
  return run.hasUnsettledExternalEffects
    && (run.status === 'failed' || run.status === 'cancelled')
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

function storedCampTimelineReadingPosition(
  campId: string
): CampTimelineReadingPosition | null {
  if (typeof window === 'undefined') return null
  try {
    return campTimelineReadingPositionFromStoredValue(
      window.localStorage.getItem(CAMP_TIMELINE_READING_POSITIONS_STORAGE_KEY),
      campId
    )
  } catch {
    return null
  }
}

function persistCampTimelineReadingPosition(
  campId: string,
  position: CampTimelineReadingPosition
): void {
  if (typeof window === 'undefined') return
  try {
    const current = window.localStorage.getItem(CAMP_TIMELINE_READING_POSITIONS_STORAGE_KEY)
    window.localStorage.setItem(
      CAMP_TIMELINE_READING_POSITIONS_STORAGE_KEY,
      storedCampTimelineReadingPositionsWithUpdate(current, campId, position)
    )
  } catch {
    // Reading-position persistence is an enhancement; the timeline remains usable without it.
  }
}

function scrollExecutionDrawerToLatest(body: HTMLElement): void {
  body.scrollTop = body.scrollHeight
}
export type NotificationFocusTarget = {
  requestId: number
  kind: 'approval' | 'camp_turn' | 'camp_message'
  campTurnId: string | null
  messageId?: string
  approvalId?: string
  active?: boolean
}
export type VisibleNotificationSources = {
  campId: string
  snapshotSequence: number
  messageIds: string[]
  campTurnIds: string[]
  approvalIds: string[]
}

type VisibilityRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>

export function rectanglesOverlap(left: VisibilityRect, right: VisibilityRect): boolean {
  return left.bottom > right.top
    && left.top < right.bottom
    && left.right > right.left
    && left.left < right.right
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

const FIRST_RUN_ROLE_PROMPTS: Record<BuiltinMemberAvatarRole, string> = {
  luoke: '请帮我读这段材料，先列重点，再指出需要确认的地方。',
  muwa: '请评审这份方案，分别给出结论、依据、风险和修改建议。',
  mianzhi: '请检查这个流程，列出可能中断的地方和恢复办法。',
  qilu: '帮我整理这个页面的信息层级和主操作。'
}

export interface FirstRunCampStarter {
  title: string
  body: string
  prompt: string
}

export function firstRunCampStarters(
  role: BuiltinMemberAvatarRole,
  displayName: string
): FirstRunCampStarter[] {
  return [
    {
      title: '创建一位新队员',
      body: '从身份、职责和工作方式开始。',
      prompt: '我想创建一个新的队员，请用 member-studio 帮我开始。'
    },
    {
      title: `和${displayName}开始一件事`,
      body: '先放入一条符合这位队员特长的任务。',
      prompt: FIRST_RUN_ROLE_PROMPTS[role]
    },
    {
      title: '先认识 Rovai',
      body: '了解三个最常用的工作入口。',
      prompt: '先告诉我快速对话、Camp 和队员名册分别适合做什么。'
    }
  ]
}

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
  const text = content.map((segment) => {
    if (segment.kind === 'text') return segment.text
    if (segment.kind === 'all_members_mention') return '@所有队员'
    if (segment.kind === 'current_user_mention') return '@你'
    if (segment.kind === 'skill_mention') return `/${segment.nameAtSend}`
    return `@${names.get(segment.agentId) ?? '不可用队员'}`
  }).join('')
  return content[0]?.kind === 'current_user_mention' && content.length > 1
    ? `${text.slice(0, 2)} ${text.slice(2)}`
    : text
}

export function projectLeadingCurrentUserMentionMarkdownBody(
  content: StructuredCampMessageContent | null,
  members: ReadonlyArray<Pick<CampSnapshot['members'][number], 'agentId' | 'displayName'>>
): string | null {
  if (!content) return null
  const leadingSegment = content[0]
  if (
    leadingSegment?.kind !== 'current_user_mention'
    || leadingSegment.userId !== 'local_user'
    || content.slice(1).some((segment) => segment.kind === 'current_user_mention')
  ) return null

  const names = new Map(members.map((member) => [member.agentId, member.displayName]))
  return content.slice(1).map((segment) => {
    if (segment.kind === 'text') return segment.text
    if (segment.kind === 'all_members_mention') return escapeMarkdownLiteral('@所有队员')
    if (segment.kind === 'member_mention') {
      return escapeMarkdownLiteral(`@${names.get(segment.agentId) ?? '不可用队员'}`)
    }
    if (segment.kind === 'skill_mention') {
      return escapeMarkdownLiteral(`/${segment.nameAtSend}`)
    }
    return ''
  }).join('')
}

function escapeMarkdownLiteral(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\`*_{}\[\]()<>#+\-.!|])/g, '\\$1')
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

  const readyCount = profiles.filter((profile) => (
    profile?.runtimeReadiness.status === 'ready'
    || profile?.runtimeReadiness.status === 'light_ready'
  )).length
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
          <svg className="quick-chat-mark" data-brand-mark="horizon" data-brand-layout="separated" width="96" height="66" viewBox="0 0 72 56" aria-hidden="true">
            <path d="M36 4 L39.6 16.7 L53.9 20.4 L39.6 24.1 L36 36.8 L32.4 24.1 L18.1 20.4 L32.4 16.7 Z" fill="currentColor" />
            <path d="M8 49.5 Q36 37.5 64 49.5" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
            <circle className="brand-rendezvous-point" data-brand-point="rendezvous" cx="36" cy="43.5" r="2.6" />
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
  openCoverage = null,
  messageHistory = null,
  onLoadEarlierMessages,
  optimisticMessages = [],
  projectName,
  agents,
  installations = [],
  liveRuntimeEvents = [],
  busy,
  onSend,
  onPendingDraftPersisted,
  onPendingCampLeave,
  onChangeLead,
  onTasksChanged,
  onResolveApproval,
  onResolveRecoveryBlocker = async () => undefined,
  cancellingTurnIds = new Set<string>(),
  cancellingRunIds = new Set<string>(),
  confirmingRunIds = new Set<string>(),
  onCancelAgentRun = async () => undefined,
  stopping,
  onStop,
  inspectorVisible = true,
  inspectorTab: controlledInspectorTab,
  onInspectorTabChange,
  onOpenInspector,
  notificationFocus = null,
  onNotificationFocusPresented,
  onVisibleNotificationSources,
  runtimeRecovery = null,
  firstRunCamp = null,
  onConfigureRuntime,
  onDismissRuntimeRecovery
}: {
  snapshot: CampSnapshot
  openCoverage?: CampOpenProjection['coverage'] | null
  messageHistory?: CampOpenMessageCoverage | null
  onLoadEarlierMessages?(): Promise<void>
  optimisticMessages?: CampMessageView[]
  projectName: string | null
  agents: AgentProfile[]
  installations?: AdapterInstallation[]
  liveRuntimeEvents?: LiveRuntimeEvent[]
  busy: boolean
  onSend(draft: CampComposerDraftView): Promise<CampMessageSendReceipt | void>
  onPendingDraftPersisted?(): void
  onPendingCampLeave?(draft: CampComposerDraftView): Promise<void>
  onChangeLead(agentId: string): Promise<void>
  onTasksChanged(): Promise<void>
  onResolveApproval(approval: ActionApprovalView, optionId: string): void
  onResolveRecoveryBlocker?(run: AgentRunView): Promise<void>
  cancellingTurnIds?: ReadonlySet<string>
  cancellingRunIds?: ReadonlySet<string>
  confirmingRunIds?: ReadonlySet<string>
  onCancelAgentRun?(run: AgentRunView): Promise<void>
  stopping: boolean
  onStop(): void
  inspectorVisible?: boolean
  inspectorTab?: CampInspectorTab
  onInspectorTabChange?(tab: CampInspectorTab): void
  onOpenInspector?(tab: CampInspectorTab): void
  notificationFocus?: NotificationFocusTarget | null
  onNotificationFocusPresented?(requestId: number): void
  onVisibleNotificationSources?(sources: VisibleNotificationSources): void
  runtimeRecovery?: CampRuntimeRecovery | null
  firstRunCamp?: FirstRunCampContext | null
  onConfigureRuntime?(agentId: string): void
  onDismissRuntimeRecovery?(): void
}): JSX.Element {
  const [messageContent, setMessageContent] = useState<StructuredCampMessageContent>([])
  const [composerDraft, setComposerDraft] = useState<CampComposerDraftView | null>(null)
  const [preparingAttachments, setPreparingAttachments] = useState<Array<{ id: string; name: string; kind: AttachmentKind }>>([])
  const [failedAttachments, setFailedAttachments] = useState<Array<{ id: string; name: string; kind: AttachmentKind; error: string }>>([])
  const [attachmentDragState, setAttachmentDragState] = useState<AttachmentDragKind | null>(null)
  const [composerSubmitting, setComposerSubmitting] = useState(false)
  const [routingMutating, setRoutingMutating] = useState(false)
  const [replyInteractionError, setReplyInteractionError] = useState<string | null>(null)
  const [suppressPointerFocusRing, setSuppressPointerFocusRing] = useState(false)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [starterNotice, setStarterNotice] = useState<string | null>(null)
  const [mentionPopover, setMentionPopover] = useState<MentionPopoverRequest | null>(null)
  const [composerSkillCatalog, setComposerSkillCatalog] = useState<{
    skills: SkillView[]
    groups: SkillDeliveryGroupView[]
    status: 'loading' | 'ready' | 'error'
  }>({ skills: [], groups: [], status: 'loading' })
  const composerEditorRef = useRef<HTMLDivElement>(null)
  const composerFileInputRef = useRef<HTMLInputElement>(null)
  const draftSaveTimer = useRef<number | null>(null)
  const campLeaveTimer = useRef<{ campId: string; timer: number } | null>(null)
  const draftContent = useRef<StructuredCampMessageContent>([])
  const draftCampId = useRef<string | null>(null)
  const composerDraftRef = useRef<CampComposerDraftView | null>(null)
  const draftMutationQueues = useRef(new Map<string, Promise<CampComposerDraftView>>())
  const dragLeaveTimer = useRef<number | null>(null)
  const dragActivityTimer = useRef<number | null>(null)
  const attachmentPreparationQueue = useRef<Promise<void>>(Promise.resolve())
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const conversationFindSurfaceRef = useRef<HTMLDivElement>(null)
  const conversationFindInputRef = useRef<HTMLInputElement>(null)
  const conversationFindRequestGeneration = useRef(0)
  const conversationFindDebounceTimer = useRef<number | null>(null)
  const conversationFindRestorePoint = useRef<ConversationFindRestorePoint | null>(null)
  const conversationFindOpenRef = useRef(false)
  const timelineVisibleAnchorRef = useRef<TimelineMessageAnchor | null>(null)
  const [conversationFind, setConversationFind] = useState<ConversationFindState>({
    open: false,
    query: '',
    status: 'idle',
    snapshot: null,
    error: null
  })
  conversationFindOpenRef.current = conversationFind.open
  const recipientRepairFirstOptionRef = useRef<HTMLButtonElement>(null)
  const autoSuppressedContinuationSourceRef = useRef<string | null>(null)
  const [anchoredMessages, setAnchoredMessages] = useState<CampMessageView[]>([])
  const [replyAnchorWindows, setReplyAnchorWindows] = useState(
    () => new Map<string, CampMessageView[] | null>()
  )
  const replyAnchorLoads = useRef(new Map<string, Promise<CampMessageView[] | null>>())
  const approvalDockRef = useRef<HTMLElement>(null)
  const lastTimelineItem = useRef<{
    campId: string
    itemId: string | null
    itemCount: number
  } | null>(null)
  const timelineReadingPosition = useRef<{
    campId: string
    position: CampTimelineReadingPosition
  } | null>(null)
  const timelineViewportGeometry = useRef<{
    campId: string
    geometry: CampTimelineViewportGeometry
  } | null>(null)
  const timelinePositionSaveTimer = useRef<number | null>(null)
  const lastVisibleNotificationSources = useRef<string | null>(null)
  const showingFirstRunWelcome = firstRunCamp !== null
    && snapshot.messages.length === 0
    && snapshot.agentRuns.length === 0
  const [conversationView, setConversationView] = useState<CampConversationView>(() => {
    if (typeof window === 'undefined') {
      return initialCampConversationView(null, showingFirstRunWelcome)
    }
    try {
      return initialCampConversationView(
        window.localStorage.getItem(CAMP_CONVERSATION_VIEW_STORAGE_KEY),
        showingFirstRunWelcome
      )
    } catch {
      return initialCampConversationView(null, showingFirstRunWelcome)
    }
  })
  const firstRunConversationShownForCamp = useRef<string | null>(
    showingFirstRunWelcome ? snapshot.camp.id : null
  )
  const [worldMapRoutesVisible, setWorldMapRoutesVisible] = useState(false)
  const [localInspectorTab, setLocalInspectorTab] = useState<CampInspectorTab>('tasks')
  const [executionPlacement, setExecutionPlacement] = useState<ExecutionConsolePlacement>('bottom')
  const [executionInspectorActive, setExecutionInspectorActive] = useState(false)
  const [executionDrawerAgentId, setExecutionDrawerAgentId] = useState<string | null>(null)
  const [executionDrawerFocusedRunId, setExecutionDrawerFocusedRunId] = useState<string | null>(null)
  const [executionDrawerFocusRequest, setExecutionDrawerFocusRequest] = useState<ExecutionDrawerFocusRequest>({
    sequence: 0,
    moveDomFocus: true
  })
  const [resolvingRecoveryBlockerId, setResolvingRecoveryBlockerId] = useState<string | null>(null)
  const [submittedExecutionRequest, setSubmittedExecutionRequest] = useState<CampMessageSendReceipt | null>(null)
  const executionDrawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const executionDrawerReturnAgentIdRef = useRef<string | null>(null)
  const bottomPlacementButtonRef = useRef<HTMLButtonElement>(null)
  const inspectorPlacementButtonRef = useRef<HTMLButtonElement>(null)
  const bottomExecutionDrawerHostRef = useRef<HTMLDivElement>(null)
  const inspectorExecutionDrawerHostRef = useRef<HTMLDivElement>(null)
  const executionReadingPosition = useRef<ExecutionConsoleReadingPosition | null>(null)
  const pendingExecutionReadingPosition = useRef<ExecutionConsoleReadingPosition | null>(null)
  const executionReadingRestoreFrames = useRef<[number, number] | null>(null)
  const [executionDrawerPortal] = useState<HTMLDivElement | null>(() => {
    if (typeof document === 'undefined') return null
    const portal = document.createElement('div')
    portal.className = 'execution-drawer-portal'
    return portal
  })
  const inspectorTab = controlledInspectorTab ?? localInspectorTab
  const inspectorSurfaceTab: CampInspectorSurfaceTab = executionPlacement === 'inspector'
    && executionInspectorActive
    ? 'execution'
    : inspectorTab
  const [taskCreationActive, setTaskCreationActive] = useState(false)
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
  const [taskFocusRequest, setTaskFocusRequest] = useState(0)
  const [earlierMessageStatus, setEarlierMessageStatus] = useState<
    'idle' | 'loading' | 'error'
  >('idle')
  useEffect(() => {
    try {
      window.localStorage.setItem(CAMP_CONVERSATION_VIEW_STORAGE_KEY, conversationView)
    } catch {
      // A denied storage surface must not block the Camp reading plane.
    }
  }, [conversationView])
  useLayoutEffect(() => {
    if (!executionDrawerPortal) return
    const host = executionPlacement === 'inspector'
      ? inspectorExecutionDrawerHostRef.current
      : bottomExecutionDrawerHostRef.current
    if (!host) return
    if (executionDrawerPortal.parentElement !== host) host.appendChild(executionDrawerPortal)

    const readingPosition = pendingExecutionReadingPosition.current
    if (!readingPosition) return
    pendingExecutionReadingPosition.current = null
    if (executionReadingRestoreFrames.current) {
      window.cancelAnimationFrame(executionReadingRestoreFrames.current[0])
      window.cancelAnimationFrame(executionReadingRestoreFrames.current[1])
    }
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        executionReadingRestoreFrames.current = null
        restoreExecutionConsoleReadingPosition(
          executionDrawerPortal.querySelector<HTMLElement>('.execution-drawer'),
          readingPosition
        )
      })
      executionReadingRestoreFrames.current = [firstFrame, secondFrame]
    })
    executionReadingRestoreFrames.current = [firstFrame, firstFrame]
  }, [executionDrawerPortal, executionPlacement, inspectorVisible])
  useEffect(() => () => {
    if (executionReadingRestoreFrames.current) {
      window.cancelAnimationFrame(executionReadingRestoreFrames.current[0])
      window.cancelAnimationFrame(executionReadingRestoreFrames.current[1])
    }
    executionDrawerPortal?.remove()
  }, [executionDrawerPortal])
  useEffect(() => {
    executionReadingPosition.current = null
    pendingExecutionReadingPosition.current = null
  }, [executionDrawerAgentId, snapshot.camp.id])
  useEffect(() => {
    if (!showingFirstRunWelcome
      || firstRunConversationShownForCamp.current === snapshot.camp.id) return
    firstRunConversationShownForCamp.current = snapshot.camp.id
    setConversationView('conversation')
  }, [showingFirstRunWelcome, snapshot.camp.id])
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
  const openMemberProfilePopover = (
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void => {
    const member = memberById.get(agentId)
    if (
      !member
      || member.membershipStatus !== 'active'
      || member.profilePresence === 'removed'
      || !profileById.has(agentId)
    ) return
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
    setExecutionPlacement('bottom')
    setExecutionInspectorActive(false)
    executionDrawerTriggerRef.current = null
    executionDrawerReturnAgentIdRef.current = null
  }, [snapshot.camp.id])
  useLayoutEffect(() => {
    if (executionDrawerAgentId !== null) return
    const trigger = executionDrawerTriggerRef.current
    const returnAgentId = executionDrawerReturnAgentIdRef.current
    executionDrawerTriggerRef.current = null
    executionDrawerReturnAgentIdRef.current = null
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true })
      return
    }
    const currentAgentTrigger = returnAgentId
      ? document.querySelector<HTMLButtonElement>(
        `.run-pulse-${executionPlacement} .run-pulse-chip[data-agent-id="${CSS.escape(returnAgentId)}"]`
      )
      : null
    if (currentAgentTrigger) {
      currentAgentTrigger.focus({ preventScroll: true })
      return
    }
    const fallback = executionPlacement === 'inspector'
      ? inspectorPlacementButtonRef.current
      : bottomPlacementButtonRef.current
    fallback?.focus({ preventScroll: true })
  }, [executionDrawerAgentId, executionPlacement])

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
    const messages = new Map<string, CampMessageView>()
    for (const message of anchoredMessages) messages.set(message.id, message)
    for (const message of snapshot.messages) messages.set(message.id, message)
    for (const message of optimisticMessages) {
      if (!messages.has(message.id)) messages.set(message.id, message)
    }
    return [...messages.values()].sort((left, right) =>
      left.sequence - right.sequence || left.id.localeCompare(right.id)
    )
  }, [anchoredMessages, optimisticMessages, snapshot.messages])
  const visibleMessageById = useMemo(
    () => new Map(visibleCampMessages.map((message) => [message.id, message])),
    [visibleCampMessages]
  )
  const replyParentById = useMemo(() => {
    const messages = new Map(visibleMessageById)
    for (const windowMessages of replyAnchorWindows.values()) {
      for (const message of windowMessages ?? []) messages.set(message.id, message)
    }
    return messages
  }, [replyAnchorWindows, visibleMessageById])
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
  const replyRepairRequired = composerDraftNeedsReplyRepair(composerDraft)
  const hasExplicitRecipient = messageContent.some((segment) =>
    segment.kind === 'member_mention' || segment.kind === 'all_members_mention'
  )
  const continuationIntent = composerDraft?.continuationIntent ?? null
  const continuationReplacementMembers = composerMembers.filter((member) =>
    member.mentionable !== false
      && member.agentId !== continuationIntent?.recipient.agentId
  )
  const continuationRecipient = continuationIntent
    ? memberById.get(continuationIntent.recipient.agentId) ?? null
    : null
  const continuationRecipientAvailable = continuationRecipient?.membershipStatus === 'active'
    && continuationRecipient.profilePresence === 'present'
  const hasLocalDraftPayload = Boolean(
    message.trim()
      || (composerDraft?.attachments.length ?? 0) > 0
      || preparingAttachments.length > 0
  )
  const continuationRepairRequired = composerDraftNeedsContinuationRepair(
    composerDraft,
    snapshot.members,
    hasLocalDraftPayload
  )
  const continuationVisible = Boolean(
    continuationIntent
      && continuationRecipientAvailable
      && !composerDraft?.replyIntent
      && !hasExplicitRecipient
      && !continuationRepairRequired
  )
  const recipientSummary = useMemo(
    () => composerRecipientSummary(messageContent, snapshot.members),
    [messageContent, snapshot.members]
  )
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
  const executionDrawerProfile = executionDrawerProcess
    ? profileById.get(executionDrawerProcess.agentId) ?? null
    : null
  const executionDrawerInstallation = executionDrawerProfile?.runtimeConfiguration
    ? runtimeEditorInstallation(
        installations,
        executionDrawerProfile.runtimeConfiguration.adapterKind
      )
    : null
  const pendingApprovals = snapshot.approvals.filter((approval) => approval.status === 'pending')
  const previousPendingApprovalCount = useRef(pendingApprovals.length)
  const executionEvents = useMemo(() => {
    const events = new Map<string, LiveRuntimeEvent>()
    for (const evidence of snapshot.executionEvidence) {
      events.set(evidence.id, liveRuntimeEventFromExecutionEvidence(evidence))
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
  const worldMapProjection = useMemo(
    () => projectCampWorldMap(snapshot.members, snapshot.agentRuns, executionProgressByRunId),
    [executionProgressByRunId, snapshot.agentRuns, snapshot.members]
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
      content,
      continuationSourceMessageId: draft.continuationIntent?.sourceCampMessageId ?? null
    })
  )

  const loadReplyAnchorWindow = useCallback((messageId: string): Promise<CampMessageView[] | null> => {
    const existing = replyAnchorLoads.current.get(messageId)
    if (existing) return existing
    const campId = snapshot.camp.id
    const request = window.rovai.request<CampMessageAroundSnapshot>('camp.messages.around', {
      campId,
      messageId
    }).then((around) => {
      if (
        around.schemaVersion !== 1
        || around.campId !== campId
        || around.anchorMessageId !== messageId
        || (around.sourceAvailable && !around.messages.some((message) => message.id === messageId))
      ) throw new Error('消息定位合同不兼容。')
      return around.sourceAvailable ? around.messages : null
    }).catch(() => null).then((messages) => {
      if (draftCampId.current === campId) {
        setReplyAnchorWindows((current) => {
          const next = new Map(current)
          next.set(messageId, messages)
          return next
        })
      }
      return messages
    }).finally(() => {
      replyAnchorLoads.current.delete(messageId)
    })
    replyAnchorLoads.current.set(messageId, request)
    return request
  }, [snapshot.camp.id])

  useEffect(() => {
    const missingReplyIds = new Set(visibleCampMessages.flatMap((message) => {
      const replyId = message.replyToCampMessageId
      return replyId && !visibleMessageById.has(replyId) && !replyAnchorWindows.has(replyId)
        ? [replyId]
        : []
    }))
    for (const messageId of missingReplyIds) void loadReplyAnchorWindow(messageId)
  }, [loadReplyAnchorWindow, replyAnchorWindows, visibleCampMessages, visibleMessageById])

  const focusConversationFindInput = useCallback((select = false): void => {
    window.requestAnimationFrame(() => {
      const input = conversationFindInputRef.current
      input?.focus({ preventScroll: true })
      if (select) input?.select()
    })
  }, [])

  const requestConversationFind = useCallback(async (
    query: string,
    selectedMatchIndex: number | undefined,
    anchorMessageId: string | null,
    generation: number
  ): Promise<void> => {
    const campId = snapshot.camp.id
    try {
      const result = await window.rovai.request<CampMessageFindSnapshot>(
        'camp.messages.find',
        {
          campId,
          query,
          ...(selectedMatchIndex === undefined ? {} : { selectedMatchIndex }),
          ...(anchorMessageId ? { anchorMessageId } : {})
        }
      )
      const hasValidSelection = result.totalMatchCount === 0
        ? result.selectedMatchIndex === null && result.match === null
        : result.selectedMatchIndex !== null
          && result.selectedMatchIndex >= 0
          && result.selectedMatchIndex < result.totalMatchCount
          && result.match !== null
      if (
        result.schemaVersion !== 1
        || result.campId !== campId
        || result.query !== query
        || result.totalMatchCount < 0
        || !hasValidSelection
      ) throw new Error('会话查找合同不兼容。')
      if (conversationFindRequestGeneration.current !== generation) return

      setConversationFind((current) => current.open && current.query === query
        ? {
            ...current,
            snapshot: result,
            status: result.match ? 'loading_target' : 'ready',
            error: null
          }
        : current)

      const selectedMatch = result.match
      if (!selectedMatch) return
      let target = timelineScrollRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(selectedMatch.messageId)}"]`
      ) ?? null
      if (!target) {
        const around = await window.rovai.request<CampMessageAroundSnapshot>(
          'camp.messages.around',
          { campId, messageId: selectedMatch.messageId }
        )
        if (
          around.schemaVersion !== 1
          || around.campId !== campId
          || around.anchorMessageId !== selectedMatch.messageId
          || !around.sourceAvailable
          || !around.messages.some((message) => message.id === selectedMatch.messageId)
        ) throw new Error('命中消息当前不可用。')
        if (conversationFindRequestGeneration.current !== generation) return
        setAnchoredMessages((current) => {
          const merged = new Map(current.map((message) => [message.id, message]))
          for (const message of around.messages) merged.set(message.id, message)
          return [...merged.values()]
        })
      }

      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
      })
      if (conversationFindRequestGeneration.current !== generation) return
      target = timelineScrollRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(selectedMatch.messageId)}"]`
      ) ?? null
      if (!target) throw new Error('命中消息暂时无法显示。')
      const timeline = timelineScrollRef.current
      if (timeline) {
        const timelineBounds = timeline.getBoundingClientRect()
        const findSurfaceBounds = conversationFindSurfaceRef.current?.getBoundingClientRect() ?? null
        const currentRange = conversationFindCurrentRange(
          timeline,
          query,
          selectedMatch.messageId,
          selectedMatch.occurrenceIndex
        )
        const rangeBounds = currentRange?.getBoundingClientRect() ?? null
        const targetBounds = rangeBounds && rangeBounds.width + rangeBounds.height > 0
          ? rangeBounds
          : target.getBoundingClientRect()
        timeline.scrollTop = centeredConversationFindScrollTop({
          currentScrollTop: timeline.scrollTop,
          maximumScrollTop: timeline.scrollHeight - timeline.clientHeight,
          viewportTop: timelineBounds.top,
          viewportBottom: timelineBounds.bottom,
          targetTop: targetBounds.top,
          targetBottom: targetBounds.bottom,
          topInset: findSurfaceBounds
            ? Math.max(0, findSurfaceBounds.bottom - timelineBounds.top + 8)
            : 0,
          bottomInset: 12
        })
        timelineVisibleAnchorRef.current = visibleTimelineMessageAnchor(timeline)
        timelineReadingPosition.current = {
          campId,
          position: {
            scrollTop: Math.max(0, timeline.scrollTop),
            followingLatest: false
          }
        }
      }
      focusConversationFindInput()
      setConversationFind((current) => current.open && current.query === query
        ? { ...current, status: 'ready', error: null }
        : current)
    } catch {
      if (conversationFindRequestGeneration.current !== generation) return
      setConversationFind((current) => current.open && current.query === query
        ? {
            ...current,
            status: 'error',
            error: '暂时无法搜索完整会话。'
          }
        : current)
    }
  }, [focusConversationFindInput, snapshot.camp.id])

  const openConversationFind = useCallback((): void => {
    if (!conversationFind.open) {
      const timeline = timelineScrollRef.current
      const storedPosition = timelineReadingPosition.current?.campId === snapshot.camp.id
        ? timelineReadingPosition.current.position
        : null
      const anchor = timeline && !timeline.hidden
        ? visibleTimelineMessageAnchor(timeline)
        : timelineVisibleAnchorRef.current
      timelineVisibleAnchorRef.current = anchor
      conversationFindRestorePoint.current = {
        campId: snapshot.camp.id,
        scrollTop: Math.max(0, timeline?.scrollTop ?? storedPosition?.scrollTop ?? 0),
        followingLatest: storedPosition?.followingLatest
          ?? (timeline ? campTimelineIsNearBottom(
            timeline.scrollTop,
            timeline.scrollHeight,
            timeline.clientHeight
          ) : true),
        anchor,
        focusedElement: document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
      }
      if (timeline) {
        timelineReadingPosition.current = {
          campId: snapshot.camp.id,
          position: { scrollTop: timeline.scrollTop, followingLatest: false }
        }
      }
      setConversationFind((current) => ({
        ...current,
        open: true,
        status: current.query.trim() ? 'searching' : 'idle',
        snapshot: null,
        error: null
      }))
      setConversationView('conversation')
    }
    focusConversationFindInput(true)
  }, [conversationFind.open, focusConversationFindInput, snapshot.camp.id])

  const closeConversationFind = useCallback((restore = true): void => {
    conversationFindRequestGeneration.current += 1
    if (conversationFindDebounceTimer.current !== null) {
      window.clearTimeout(conversationFindDebounceTimer.current)
      conversationFindDebounceTimer.current = null
    }
    setConversationFind((current) => ({
      ...current,
      open: false,
      status: 'idle',
      snapshot: null,
      error: null
    }))
    const restorePoint = conversationFindRestorePoint.current
    conversationFindRestorePoint.current = null
    if (!restore || restorePoint?.campId !== snapshot.camp.id) return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const timeline = timelineScrollRef.current
        if (timeline) {
          let nextScrollTop = restorePoint.scrollTop
          const anchor = restorePoint.anchor
          const anchorNode = anchor
            ? timeline.querySelector<HTMLElement>(
                `[data-message-id="${CSS.escape(anchor.messageId)}"]`
              )
            : null
          if (anchorNode && anchor) {
            const viewport = timeline.getBoundingClientRect()
            nextScrollTop = timeline.scrollTop
              + anchorNode.getBoundingClientRect().top
              - viewport.top
              - anchor.topOffset
          }
          timeline.scrollTop = Math.max(0, nextScrollTop)
          timelineVisibleAnchorRef.current = visibleTimelineMessageAnchor(timeline)
          timelineReadingPosition.current = {
            campId: restorePoint.campId,
            position: {
              scrollTop: Math.max(0, timeline.scrollTop),
              followingLatest: restorePoint.followingLatest
            }
          }
        }
        const previousFocus = restorePoint.focusedElement
        if (previousFocus?.isConnected && previousFocus.getClientRects().length > 0) {
          previousFocus.focus({ preventScroll: true })
        } else {
          timeline?.focus({ preventScroll: true })
        }
      })
    })
  }, [snapshot.camp.id])

  const navigateConversationFind = (direction: 1 | -1): void => {
    const snapshotResult = conversationFind.snapshot
    const nextIndex = nextConversationFindIndex(
      snapshotResult?.selectedMatchIndex ?? null,
      snapshotResult?.totalMatchCount ?? 0,
      direction
    )
    if (nextIndex === null || !conversationFind.query) return
    const generation = conversationFindRequestGeneration.current + 1
    conversationFindRequestGeneration.current = generation
    setConversationFind((current) => ({ ...current, status: 'searching', error: null }))
    void requestConversationFind(conversationFind.query, nextIndex, null, generation)
  }

  const retryConversationFind = (): void => {
    if (!conversationFind.query.trim()) return
    const generation = conversationFindRequestGeneration.current + 1
    conversationFindRequestGeneration.current = generation
    setConversationFind((current) => ({ ...current, status: 'searching', error: null }))
    void requestConversationFind(
      conversationFind.query,
      conversationFind.snapshot?.selectedMatchIndex ?? undefined,
      conversationFindRestorePoint.current?.anchor?.messageId ?? null,
      generation
    )
  }

  useEffect(() => {
    if (conversationFindDebounceTimer.current !== null) {
      window.clearTimeout(conversationFindDebounceTimer.current)
      conversationFindDebounceTimer.current = null
    }
    const generation = conversationFindRequestGeneration.current + 1
    conversationFindRequestGeneration.current = generation
    if (!conversationFind.open) return undefined
    if (!conversationFind.query.trim()) {
      setConversationFind((current) => ({
        ...current,
        status: 'idle',
        snapshot: null,
        error: null
      }))
      return undefined
    }
    if (Array.from(conversationFind.query).length > 512) {
      setConversationFind((current) => ({
        ...current,
        status: 'error',
        snapshot: null,
        error: '搜索内容不能超过 512 个字符。'
      }))
      return undefined
    }
    setConversationFind((current) => ({
      ...current,
      status: 'searching',
      snapshot: null,
      error: null
    }))
    conversationFindDebounceTimer.current = window.setTimeout(() => {
      conversationFindDebounceTimer.current = null
      void requestConversationFind(
        conversationFind.query,
        undefined,
        conversationFindRestorePoint.current?.anchor?.messageId ?? null,
        generation
      )
    }, 180)
    return () => {
      if (conversationFindDebounceTimer.current !== null) {
        window.clearTimeout(conversationFindDebounceTimer.current)
        conversationFindDebounceTimer.current = null
      }
    }
  }, [
    conversationFind.open,
    conversationFind.query,
    requestConversationFind
  ])

  useEffect(() => {
    const handleFindShortcut = (event: globalThis.KeyboardEvent): void => {
      if (
        event.altKey
        || (!event.metaKey && !event.ctrlKey)
        || event.key.toLowerCase() !== 'f'
      ) return
      event.preventDefault()
      openConversationFind()
    }
    window.addEventListener('keydown', handleFindShortcut)
    return () => window.removeEventListener('keydown', handleFindShortcut)
  }, [openConversationFind])

  useLayoutEffect(() => {
    const timeline = timelineScrollRef.current
    if (
      !timeline
      || !conversationFind.open
      || !conversationFind.query
      || conversationView !== 'conversation'
    ) return undefined
    return applyConversationFindHighlights(
      timeline,
      conversationFind.query,
      conversationFind.snapshot?.match?.messageId ?? null,
      conversationFind.snapshot?.match?.occurrenceIndex ?? null
    )
  }, [
    conversationFind.open,
    conversationFind.query,
    conversationFind.snapshot?.match?.messageId,
    conversationFind.snapshot?.match?.occurrenceIndex,
    conversationView,
    visibleCampMessages
  ])

  const syncReplyDraft = (draft: CampComposerDraftView): CampComposerDraftView => {
    applyComposerDraft(draft.campId, draft)
    setMessageContent(draft.content)
    draftContent.current = draft.content
    return draft
  }

  const mutateRoutingDraft = (
    method:
      | 'camp.composerDraft.startReply'
      | 'camp.composerDraft.cancelReply'
      | 'camp.composerDraft.resolveReplyRecipient'
      | 'camp.composerDraft.resolveContinuationRecipient',
    params: Record<string, unknown>
  ): Promise<CampComposerDraftView> => {
    if (draftSaveTimer.current !== null) {
      window.clearTimeout(draftSaveTimer.current)
      draftSaveTimer.current = null
    }
    const campId = snapshot.camp.id
    const localContent = draftContent.current
    return queueDraftMutation(campId, async (draft) => {
      const exactDraft = await window.rovai.request<CampComposerDraftView>(
        'camp.composerDraft.save',
        {
          campId,
          expectedRevision: draft.revision,
          content: localContent,
          continuationSourceMessageId: draft.continuationIntent?.sourceCampMessageId ?? null
        }
      )
      return window.rovai.request<CampComposerDraftView>(method, {
        campId,
        expectedRevision: exactDraft.revision,
        ...params
      })
    }).then(syncReplyDraft)
  }

  const focusComposerAtBoundary = (
    modality: ReplyFocusModality,
    boundary: 'start' | 'end'
  ): void => {
    setSuppressPointerFocusRing(modality === 'pointer')
    window.requestAnimationFrame(() => {
      const editor = composerEditorRef.current
      if (!editor) return
      editor.focus({ preventScroll: true })
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(boundary === 'start')
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }

  const startReply = async (
    message: CampMessageView,
    modality: ReplyFocusModality
  ): Promise<void> => {
    if (message.id.startsWith('optimistic:') || routingMutating) return
    setRoutingMutating(true)
    setReplyInteractionError(null)
    try {
      const draft = await mutateRoutingDraft('camp.composerDraft.startReply', {
        replyToCampMessageId: message.id
      })
      if (composerDraftNeedsReplyRepair(draft)) {
        setSuppressPointerFocusRing(false)
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => recipientRepairFirstOptionRef.current?.focus())
        })
      } else {
        focusComposerAtBoundary(modality, 'end')
      }
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    } finally {
      setRoutingMutating(false)
    }
  }

  const cancelReply = async (focusBoundary: 'start' | 'end' = 'end'): Promise<void> => {
    if (routingMutating) return
    setRoutingMutating(true)
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft('camp.composerDraft.cancelReply', {})
      focusComposerAtBoundary('keyboard', focusBoundary)
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    } finally {
      setRoutingMutating(false)
    }
  }

  const resolveReplyRecipient = async (recipient: CampComposerReplyRecipient): Promise<void> => {
    if (routingMutating) return
    setRoutingMutating(true)
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft('camp.composerDraft.resolveReplyRecipient', { recipient })
      focusComposerAtBoundary('keyboard', 'end')
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    } finally {
      setRoutingMutating(false)
    }
  }

  const dismissContinuation = async (restoreFocus = true): Promise<void> => {
    const intent = composerDraftRef.current?.continuationIntent
    if (!intent || routingMutating) return
    setRoutingMutating(true)
    setReplyInteractionError(null)
    try {
      const campId = snapshot.camp.id
      await queueDraftMutation(
        campId,
        (draft) => window.rovai.request<CampComposerDraftView>(
          'camp.composerDraft.dismissContinuation',
          {
            campId,
            expectedRevision: draft.revision,
            sourceCampMessageId: intent.sourceCampMessageId
          }
        )
      )
      if (restoreFocus) focusComposerAtBoundary('keyboard', 'end')
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    } finally {
      setRoutingMutating(false)
    }
  }

  const resolveContinuationRecipient = async (agentId: string): Promise<void> => {
    if (routingMutating) return
    setRoutingMutating(true)
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft('camp.composerDraft.resolveContinuationRecipient', { agentId })
      focusComposerAtBoundary('keyboard', 'end')
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    } finally {
      setRoutingMutating(false)
    }
  }

  useEffect(() => {
    const sourceMessageId = continuationIntent?.sourceCampMessageId ?? null
    if (
      !sourceMessageId
      || continuationRecipientAvailable
      || composerDraft?.replyIntent
      || hasExplicitRecipient
      || hasLocalDraftPayload
      || routingMutating
    ) {
      if (continuationRecipientAvailable || sourceMessageId === null) {
        autoSuppressedContinuationSourceRef.current = null
      }
      return
    }
    if (autoSuppressedContinuationSourceRef.current === sourceMessageId) return
    autoSuppressedContinuationSourceRef.current = sourceMessageId
    void dismissContinuation(false)
  }, [
    composerDraft?.replyIntent,
    continuationIntent?.sourceCampMessageId,
    continuationRecipientAvailable,
    hasExplicitRecipient,
    hasLocalDraftPayload,
    routingMutating
  ])

  const revealReplyParent = async (messageId: string): Promise<void> => {
    setConversationView('conversation')
    const existing = timelineScrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    )
    if (existing) {
      existing.scrollIntoView({ block: 'center', behavior: 'smooth' })
      existing.focus({ preventScroll: true })
      return
    }
    const messages = replyAnchorWindows.get(messageId) ?? await loadReplyAnchorWindow(messageId)
    if (!messages) {
      setReplyInteractionError('引用的消息当前不可用。')
      return
    }
    setAnchoredMessages((current) => {
      const merged = new Map(current.map((message) => [message.id, message]))
      for (const message of messages) merged.set(message.id, message)
      return [...merged.values()]
    })
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = timelineScrollRef.current?.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(messageId)}"]`
        )
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        target?.focus({ preventScroll: true })
      })
    })
  }

  useEffect(() => {
    const campId = snapshot.camp.id
    let cancelled = false
    conversationFindRequestGeneration.current += 1
    if (conversationFindDebounceTimer.current !== null) {
      window.clearTimeout(conversationFindDebounceTimer.current)
      conversationFindDebounceTimer.current = null
    }
    conversationFindRestorePoint.current = null
    timelineVisibleAnchorRef.current = null
    setConversationFind({
      open: false,
      query: '',
      status: 'idle',
      snapshot: null,
      error: null
    })
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
    setAttachmentDragState(null)
    setAnchoredMessages([])
    setReplyAnchorWindows(new Map())
    replyAnchorLoads.current.clear()
    setReplyInteractionError(null)
    setSuppressPointerFocusRing(false)
    autoSuppressedContinuationSourceRef.current = null
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
            replyIntent: null,
            continuationIntent: null,
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
    if (conversationFind.open) return
    if (pendingApprovals.length >= previousCount) return
    if (pendingApprovals.length === 0) {
      composerEditorRef.current?.focus()
    }
  }, [conversationFind.open, pendingApprovals.length])

  useEffect(() => {
    if (
      conversationFindOpenRef.current
      || busy
      || composerSubmitting
      || replyRepairRequired
      || continuationRepairRequired
    ) return
    if (approvalDockRef.current?.contains(document.activeElement)) return
    composerEditorRef.current?.focus()
  }, [
    busy,
    composerSubmitting,
    continuationRepairRequired,
    replyRepairRequired
  ])

  useEffect(() => {
    if (!notificationFocus?.active || notificationFocus.kind === 'approval') return
    setConversationView('conversation')
  }, [notificationFocus])

  useEffect(() => {
    if (!notificationFocus?.active) return undefined
    let frame: number | null = null
    let preparedTarget: HTMLElement | null = null
    let focusObserved = false
    const presentTarget = (target: HTMLElement): void => {
      if (preparedTarget !== target) {
        preparedTarget = target
        focusObserved = false
        target.classList.add('notification-focus-target')
        target.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth'
        })
        window.setTimeout(() => target.classList.remove('notification-focus-target'), 1_800)
      }
      if (focusObserved && document.activeElement === target) {
        onNotificationFocusPresented?.(notificationFocus.requestId)
        return
      }
      target.focus({ preventScroll: true })
      focusObserved = document.activeElement === target
      frame = window.requestAnimationFrame(present)
    }
    const present = (): void => {
      if (notificationFocus.kind === 'approval') {
        return
      }
      if (notificationFocus.kind === 'camp_message') {
        const messageId = notificationFocus.messageId
        const target = messageId
          ? timelineScrollRef.current?.querySelector<HTMLElement>(
              `[data-message-id="${CSS.escape(messageId)}"]`
            ) ?? null
          : null
        if (target) {
          presentTarget(target)
        } else {
          frame = window.requestAnimationFrame(present)
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
        presentTarget(target)
      } else {
        frame = window.requestAnimationFrame(present)
      }
    }
    frame = window.requestAnimationFrame(present)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [notificationFocus, onNotificationFocusPresented, snapshot.messages, snapshot.agentRuns])

  const flushTimelineReadingPosition = useCallback((campId?: string): void => {
    if (timelinePositionSaveTimer.current !== null) {
      window.clearTimeout(timelinePositionSaveTimer.current)
      timelinePositionSaveTimer.current = null
    }
    const current = timelineReadingPosition.current
    if (!current || (campId && current.campId !== campId)) return
    persistCampTimelineReadingPosition(current.campId, current.position)
  }, [])

  const recordTimelineReadingPosition = useCallback((
    campId: string,
    scroll: HTMLElement
  ): void => {
    timelineVisibleAnchorRef.current = visibleTimelineMessageAnchor(scroll)
    const previousPosition = timelineReadingPosition.current?.campId === campId
      ? timelineReadingPosition.current.position
      : null
    const previousGeometry = timelineViewportGeometry.current?.campId === campId
      ? timelineViewportGeometry.current.geometry
      : null
    const geometry = {
      scrollTop: Math.max(0, scroll.scrollTop),
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight
    }
    timelineReadingPosition.current = {
      campId,
      position: {
        scrollTop: geometry.scrollTop,
        followingLatest: !conversationFind.open && campTimelineFollowingLatestAfterScroll(
          previousPosition,
          previousGeometry,
          geometry
        )
      }
    }
    timelineViewportGeometry.current = { campId, geometry }
    if (timelinePositionSaveTimer.current !== null) {
      window.clearTimeout(timelinePositionSaveTimer.current)
    }
    timelinePositionSaveTimer.current = window.setTimeout(() => {
      timelinePositionSaveTimer.current = null
      const current = timelineReadingPosition.current
      if (current) persistCampTimelineReadingPosition(current.campId, current.position)
    }, 180)
  }, [conversationFind.open])

  const followTimelineAfterUserSend = useCallback((campId: string): void => {
    const scroll = timelineScrollRef.current
    const position = scroll
      ? followLatestCampTimeline(scroll)
      : { scrollTop: 0, followingLatest: true }
    timelineReadingPosition.current = { campId, position }
    if (scroll) {
      timelineViewportGeometry.current = {
        campId,
        geometry: {
          scrollTop: position.scrollTop,
          scrollHeight: scroll.scrollHeight,
          clientHeight: scroll.clientHeight
        }
      }
    }
    if (timelinePositionSaveTimer.current !== null) {
      window.clearTimeout(timelinePositionSaveTimer.current)
      timelinePositionSaveTimer.current = null
    }
    persistCampTimelineReadingPosition(campId, position)
  }, [])

  useLayoutEffect(() => {
    const campId = snapshot.camp.id
    if (conversationView === 'conversation') {
      const scroll = timelineScrollRef.current
      if (scroll) {
        const current = timelineReadingPosition.current?.campId === campId
          ? timelineReadingPosition.current.position
          : storedCampTimelineReadingPosition(campId)
        const scrollTop = restoredCampTimelineScrollTop(
          current,
          scroll.scrollHeight,
          scroll.clientHeight
        )
        scroll.scrollTop = scrollTop
        timelineReadingPosition.current = {
          campId,
          position: {
            scrollTop,
            followingLatest: current?.followingLatest !== false
              || campTimelineIsNearBottom(scrollTop, scroll.scrollHeight, scroll.clientHeight)
          }
        }
        timelineViewportGeometry.current = {
          campId,
          geometry: {
            scrollTop,
            scrollHeight: scroll.scrollHeight,
            clientHeight: scroll.clientHeight
          }
        }
        lastTimelineItem.current = {
          campId,
          itemId: conversationTimeline.at(-1)?.id ?? null,
          itemCount: conversationTimeline.length
        }
      }
    }
    return () => flushTimelineReadingPosition(campId)
  }, [conversationView, flushTimelineReadingPosition, snapshot.camp.id])

  useLayoutEffect(() => {
    if (conversationView !== 'conversation') return
    const scroll = timelineScrollRef.current
    if (!scroll) return
    const campId = snapshot.camp.id
    const nextMarker = {
      itemId: conversationTimeline.at(-1)?.id ?? null,
      itemCount: conversationTimeline.length
    }
    const previous = lastTimelineItem.current
    if (!previous || previous.campId !== campId) {
      lastTimelineItem.current = { campId, ...nextMarker }
      return
    }
    if (!campTimelineContentChanged(previous, nextMarker)) return
    const position = timelineReadingPosition.current?.campId === campId
      ? timelineReadingPosition.current.position
      : null
    if (position?.followingLatest !== false) {
      scroll.scrollTop = scroll.scrollHeight
    }
    timelineReadingPosition.current = {
      campId,
      position: {
        scrollTop: Math.max(0, scroll.scrollTop),
        followingLatest: position?.followingLatest !== false
          && campTimelineIsNearBottom(scroll.scrollTop, scroll.scrollHeight, scroll.clientHeight)
      }
    }
    timelineViewportGeometry.current = {
      campId,
      geometry: {
        scrollTop: Math.max(0, scroll.scrollTop),
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight
      }
    }
    lastTimelineItem.current = { campId, ...nextMarker }
  }, [conversationTimeline, conversationView, snapshot.camp.id])

  useLayoutEffect(() => {
    if (conversationView !== 'conversation' || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const scroll = timelineScrollRef.current
    const track = scroll?.querySelector<HTMLElement>('.timeline-track') ?? null
    if (!scroll || !track) return undefined
    const campId = snapshot.camp.id
    const current = timelineReadingPosition.current
    if (current?.campId !== campId || current.position.followingLatest !== false) {
      const position = followLatestCampTimeline(scroll)
      timelineReadingPosition.current = { campId, position }
    }
    timelineViewportGeometry.current = {
      campId,
      geometry: {
        scrollTop: Math.max(0, scroll.scrollTop),
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight
      }
    }
    let resizeFrame: number | null = null
    let settleFrame: number | null = null
    const observer = new ResizeObserver(() => {
      const latest = timelineReadingPosition.current
      const shouldFollowLatest = latest?.campId !== campId
        || latest.position.followingLatest !== false
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      if (settleFrame !== null) window.cancelAnimationFrame(settleFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        settleFrame = window.requestAnimationFrame(() => {
          settleFrame = null
          if (shouldFollowLatest) {
            const position = followLatestCampTimeline(scroll)
            timelineReadingPosition.current = { campId, position }
          }
          timelineViewportGeometry.current = {
            campId,
            geometry: {
              scrollTop: Math.max(0, scroll.scrollTop),
              scrollHeight: scroll.scrollHeight,
              clientHeight: scroll.clientHeight
            }
          }
        })
      })
    })
    observer.observe(scroll)
    observer.observe(track)
    return () => {
      observer.disconnect()
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      if (settleFrame !== null) window.cancelAnimationFrame(settleFrame)
    }
  }, [conversationView, snapshot.camp.id])

  useEffect(() => {
    if (!onVisibleNotificationSources) return undefined
    let frame: number | null = null
    const publish = (): void => {
      frame = null
      const timeline = timelineScrollRef.current
      const canObserve = conversationView === 'conversation'
        && document.visibilityState === 'visible'
        && document.hasFocus()
        && timeline !== null
        && !timeline.hidden
      const messageIds = new Set<string>()
      const campTurnIds = new Set<string>()
      const approvalIds = new Set<string>()
      if (canObserve && timeline) {
        const viewport = timeline.getBoundingClientRect()
        for (const node of timeline.querySelectorAll<HTMLElement>('[data-message-id]')) {
          if (!rectanglesOverlap(node.getBoundingClientRect(), viewport)) continue
          const messageId = node.dataset.messageId
          const campTurnId = node.dataset.campTurnId
          if (messageId) messageIds.add(messageId)
          if (campTurnId) campTurnIds.add(campTurnId)
        }
        const approvalNode = approvalDockRef.current?.querySelector<HTMLElement>(
          '[data-approval-id]'
        ) ?? null
        if (approvalNode && rectanglesOverlap(approvalNode.getBoundingClientRect(), {
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          left: 0
        })) {
          const approvalId = approvalNode.dataset.approvalId
          if (approvalId) approvalIds.add(approvalId)
        }
      }
      const sources: VisibleNotificationSources = {
        campId: snapshot.camp.id,
        snapshotSequence: snapshot.throughGlobalSequence,
        messageIds: [...messageIds].sort(),
        campTurnIds: [...campTurnIds].sort(),
        approvalIds: [...approvalIds].sort()
      }
      const signature = JSON.stringify(sources)
      if (lastVisibleNotificationSources.current === signature) return
      lastVisibleNotificationSources.current = signature
      onVisibleNotificationSources(sources)
    }
    const schedule = (): void => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(publish)
    }
    const timeline = timelineScrollRef.current
    schedule()
    timeline?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      timeline?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [
    conversationView,
    onVisibleNotificationSources,
    snapshot.approvals,
    snapshot.camp.id,
    snapshot.messages,
    snapshot.throughGlobalSequence
  ])

  const submitMessage = async (): Promise<void> => {
    if (
      executionBlocked
      || !message.trim()
      || hasUnavailableMention
      || replyRepairRequired
      || continuationRepairRequired
      || busy
      || composerSubmitting
      || routingMutating
      || composerDraft === null
      || preparingAttachments.length > 0
      || failedAttachments.length > 0
    ) return
    const campId = snapshot.camp.id
    followTimelineAfterUserSend(campId)
    setComposerSubmitting(true)
    let sendAttempted = false
    let restoreEditorFocus = true
    try {
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current)
        draftSaveTimer.current = null
      }
      await attachmentPreparationQueue.current
      const frozenDraft = await saveStructuredDraft(campId, draftContent.current)
      applyComposerDraft(campId, frozenDraft)
      sendAttempted = true
      const sendReceipt = await onSend(frozenDraft)
      if (sendReceipt?.agentRunIds.length || sendReceipt?.campTurnId) {
        setSubmittedExecutionRequest(sendReceipt)
      }
      const acceptedDraftFallback: CampComposerDraftView = {
        campId,
        body: '',
        content: [],
        revision: 0,
        attachments: [],
        replyIntent: null,
        continuationIntent: null,
        updatedAt: null,
        expiresAt: null
      }
      if (draftCampId.current === campId) syncReplyDraft(acceptedDraftFallback)
      const nextDraft = await window.rovai.request<CampComposerDraftView>(
        'camp.composerDraft.get',
        { campId }
      )
      if (draftCampId.current === campId) syncReplyDraft(nextDraft)
    } catch {
      if (sendAttempted) {
        try {
          const draft = await window.rovai.request<CampComposerDraftView>(
            'camp.composerDraft.get',
            { campId }
          )
          if (draftCampId.current === campId) {
            syncReplyDraft(draft)
            if (
              composerDraftNeedsReplyRepair(draft)
              || composerDraftNeedsContinuationRepair(
                draft,
                snapshot.members,
                Boolean(draft.body.trim() || draft.attachments.length > 0)
              )
            ) {
              restoreEditorFocus = false
              window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => recipientRepairFirstOptionRef.current?.focus())
              })
            }
          }
        } catch {
          // The App-level error remains visible; a later Camp refresh can recover the Draft.
        }
      }
    } finally {
      setComposerSubmitting(false)
      if (restoreEditorFocus) {
        window.requestAnimationFrame(() => composerEditorRef.current?.focus())
      }
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

  const prepareFiles = async (inputs: AttachmentPreparationInput[]): Promise<void> => {
    const campId = snapshot.camp.id
    const pending = inputs.map(({ file, kindHint }, index) => ({
      id: crypto.randomUUID(),
      kind: kindHint,
      file: file.name
        ? file
        : new File([file], `粘贴图片-${Date.now()}-${index + 1}.png`, { type: file.type })
    }))
    setPreparingAttachments((current) => [
      ...current,
      ...pending.map(({ id, file, kind }) => ({ id, name: file.name, kind }))
    ])
    const preparePending = async (): Promise<void> => {
      for (const item of pending) {
        try {
          await queueDraftMutation(
            campId,
            async (draft) => {
              const exactDraft = await window.rovai.request<CampComposerDraftView>(
                'camp.composerDraft.save',
                {
                  campId,
                  expectedRevision: draft.revision,
                  content: draftContent.current,
                  continuationSourceMessageId:
                    draft.continuationIntent?.sourceCampMessageId ?? null
                }
              )
              return window.rovai.composerAttachments.prepare(
                campId,
                exactDraft.revision,
                item.file
              )
            }
          )
        } catch (error) {
          if (draftCampId.current === campId) {
            setFailedAttachments((current) => [
              ...current,
              {
                id: item.id,
                name: item.file.name,
                kind: item.kind,
                error: attachmentErrorMessage(error)
              }
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

  const clearAttachmentDragState = (): void => {
    if (dragLeaveTimer.current !== null) {
      window.clearTimeout(dragLeaveTimer.current)
      dragLeaveTimer.current = null
    }
    if (dragActivityTimer.current !== null) {
      window.clearTimeout(dragActivityTimer.current)
      dragActivityTimer.current = null
    }
    setAttachmentDragState(null)
  }

  const keepAttachmentDragActive = (): void => {
    if (dragActivityTimer.current !== null) window.clearTimeout(dragActivityTimer.current)
    dragActivityTimer.current = window.setTimeout(() => {
      dragActivityTimer.current = null
      clearAttachmentDragState()
    }, 1_200)
  }

  const attachmentDropBlocked = attachmentDropIsBlocked(
    Boolean(executionDrawerProcess),
    Boolean(mentionPopover),
    executionPlacement,
    inspectorVisible,
    inspectorSurfaceTab
  )

  const enterAttachmentDropSurface = (event: ReactDragEvent<HTMLElement>): void => {
    const kind = attachmentDragKind(event.dataTransfer)
    if (!kind || attachmentDropBlocked) {
      if (kind) event.dataTransfer.dropEffect = 'none'
      return
    }
    event.preventDefault()
    if (dragLeaveTimer.current !== null) {
      window.clearTimeout(dragLeaveTimer.current)
      dragLeaveTimer.current = null
    }
    keepAttachmentDragActive()
    setAttachmentDragState(kind)
  }

  const continueAttachmentDrop = (event: ReactDragEvent<HTMLElement>): void => {
    const kind = attachmentDragKind(event.dataTransfer)
    if (!kind) return
    if (attachmentDropBlocked) {
      event.dataTransfer.dropEffect = 'none'
      clearAttachmentDragState()
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (dragLeaveTimer.current !== null) {
      window.clearTimeout(dragLeaveTimer.current)
      dragLeaveTimer.current = null
    }
    keepAttachmentDragActive()
    if (attachmentDragState !== kind) setAttachmentDragState(kind)
  }

  const leaveAttachmentDropSurface = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return
    event.preventDefault()
    if (dragLeaveTimer.current !== null) window.clearTimeout(dragLeaveTimer.current)
    dragLeaveTimer.current = window.setTimeout(() => {
      dragLeaveTimer.current = null
      setAttachmentDragState(null)
    }, 24)
  }

  const dropAttachments = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    if (attachmentDropBlocked) {
      event.dataTransfer.dropEffect = 'none'
      clearAttachmentDragState()
      return
    }
    const inputs = droppedAttachmentInputs(event.dataTransfer)
    clearAttachmentDragState()
    if (inputs.length > 0) void prepareFiles(inputs)
  }

  useEffect(() => {
    if (attachmentDropBlocked) clearAttachmentDragState()
  }, [attachmentDropBlocked])

  useEffect(() => () => {
    if (dragLeaveTimer.current !== null) window.clearTimeout(dragLeaveTimer.current)
    if (dragActivityTimer.current !== null) window.clearTimeout(dragActivityTimer.current)
  }, [])

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

  const copyMessage = (
    id: string,
    body: string,
    content: StructuredCampMessageContent | null
  ): void => {
    const structuredClipboard = createStructuredMessageClipboardData(content, composerMembers)
    void writeClipboardText(
      structuredClipboard?.text ?? body,
      structuredClipboard?.html
    ).then((copied) => {
      if (!copied) return
      setCopiedMessageId(id)
      window.setTimeout(() => {
        setCopiedMessageId((current) => current === id ? null : current)
      }, 1_600)
    })
  }

  const chooseStarterPrompt = (prompt: string, announceDraft = false): void => {
    changeMessage([{ kind: 'text', text: prompt }])
    if (announceDraft) setStarterNotice('已填入输入框，可修改后发送')
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

  const selectInspectorSurfaceTab = (tab: CampInspectorSurfaceTab): void => {
    if (tab === 'execution') {
      setExecutionInspectorActive(true)
      return
    }
    setExecutionInspectorActive(false)
    selectInspectorTab(tab)
  }

  const openInspector = (tab: CampInspectorTab): void => {
    setExecutionInspectorActive(false)
    selectInspectorTab(tab)
    onOpenInspector?.(tab)
  }

  const focusPlacementButton = (placement: ExecutionConsolePlacement): void => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = placement === 'inspector'
          ? inspectorPlacementButtonRef.current
          : bottomPlacementButtonRef.current
        target?.focus({ preventScroll: true })
      })
    })
  }

  const moveExecutionToInspector = (): void => {
    const readingPosition = captureExecutionConsoleReadingPosition(
      executionDrawerPortal?.querySelector<HTMLElement>('.execution-drawer') ?? null,
      executionReadingPosition.current
    )
    executionReadingPosition.current = readingPosition
    pendingExecutionReadingPosition.current = readingPosition
    setExecutionPlacement('inspector')
    setExecutionInspectorActive(true)
    onOpenInspector?.(inspectorTab)
    focusPlacementButton('inspector')
  }

  const moveExecutionToBottom = (): void => {
    const readingPosition = captureExecutionConsoleReadingPosition(
      executionDrawerPortal?.querySelector<HTMLElement>('.execution-drawer') ?? null,
      executionReadingPosition.current
    )
    executionReadingPosition.current = readingPosition
    pendingExecutionReadingPosition.current = readingPosition
    setExecutionPlacement('bottom')
    setExecutionInspectorActive(false)
    focusPlacementButton('bottom')
  }

  const loadEarlierMessages = async (): Promise<void> => {
    if (!onLoadEarlierMessages || earlierMessageStatus === 'loading') return
    const timeline = timelineScrollRef.current
    const previousScrollHeight = timeline?.scrollHeight ?? 0
    const previousScrollTop = timeline?.scrollTop ?? 0
    setEarlierMessageStatus('loading')
    try {
      await onLoadEarlierMessages()
      setEarlierMessageStatus('idle')
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!timeline) return
          timeline.scrollTop = previousScrollTop + timeline.scrollHeight - previousScrollHeight
        })
      })
    } catch {
      setEarlierMessageStatus('error')
    }
  }

  const openExecutionProcess = (
    agentId: string,
    trigger: HTMLButtonElement | null = null,
    options: { runId?: string | null; moveDomFocus?: boolean } = {}
  ): void => {
    const process = executionProcessByAgentId.get(agentId)
    if (!process) return
    if (executionPlacement === 'inspector') {
      setExecutionInspectorActive(true)
      onOpenInspector?.(inspectorTab)
    }
    const requestedRun = options.runId
      ? process.runs.find((run) => run.id === options.runId) ?? null
      : null
    const focusedRunId = requestedRun?.id ?? preferredAgentProcessRun(process.runs)?.id ?? null
    if (trigger) {
      executionDrawerTriggerRef.current = trigger
      executionDrawerReturnAgentIdRef.current = agentId
    } else if (options.moveDomFocus === false) {
      executionDrawerTriggerRef.current = null
      executionDrawerReturnAgentIdRef.current = null
    }
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

  const resolveRecoveryBlocker = async (run: AgentRunView): Promise<void> => {
    if (resolvingRecoveryBlockerId) return
    setResolvingRecoveryBlockerId(run.id)
    try {
      await onResolveRecoveryBlocker(run)
      window.requestAnimationFrame(() => composerEditorRef.current?.focus())
    } catch {
      // The App surface owns the visible error; keep the execution drawer stable.
    } finally {
      setResolvingRecoveryBlockerId(null)
    }
  }

  useEffect(() => {
    if (!submittedExecutionRequest) return
    if (taskCreationBlocksSubmittedRunAutoFocus(
      taskCreationActive,
      inspectorVisible,
      inspectorSurfaceTab
    )) {
      setSubmittedExecutionRequest(null)
      return
    }
    const targetRun = firstSubmittedAgentRun(submittedExecutionRequest, snapshot.agentRuns)
    if (!targetRun) return
    setSubmittedExecutionRequest(null)
    if (executionConsoleIsVisible(
      executionPlacement,
      inspectorVisible,
      inspectorSurfaceTab
    ) && isViewingNonTerminalAgentRun(
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
    executionPlacement,
    inspectorSurfaceTab,
    inspectorVisible,
    snapshot.agentRuns,
    submittedExecutionRequest,
    taskCreationActive
  ])

  const conversationFindTotal = conversationFind.snapshot?.totalMatchCount ?? 0
  const conversationFindSelectedIndex = conversationFind.snapshot?.selectedMatchIndex ?? null
  const conversationFindBusy = conversationFind.status === 'searching'
    || conversationFind.status === 'loading_target'
  const conversationFindCountLabel = conversationFind.snapshot
    && conversationFindSelectedIndex !== null
    ? `${conversationFindSelectedIndex + 1} / ${conversationFindTotal}`
    : conversationFind.status === 'ready' && conversationFind.query.trim()
      ? '无匹配'
      : conversationFind.status === 'error'
        ? '搜索失败'
        : conversationFind.query.trim()
          ? '正在查找'
          : '输入关键词'
  const conversationFindAnnouncement = conversationFind.error
    ?? (conversationFindBusy
      ? '正在查找当前会话'
      : conversationFind.snapshot && conversationFindSelectedIndex !== null
        ? `第 ${conversationFindSelectedIndex + 1} 项，共 ${conversationFindTotal} 项`
        : conversationFind.status === 'ready' && conversationFind.query.trim()
          ? '当前会话中没有匹配项'
          : '')
  const conversationFindNavigationDisabled = conversationFindBusy
    || conversationFindTotal <= 0

  const executionDrawer = executionDrawerProcess ? (
    <ExecutionDrawer
      key={executionDrawerProcess.agentId}
      placement={executionPlacement}
      process={executionDrawerProcess}
      member={memberById.get(executionDrawerProcess.agentId) ?? null}
      profile={executionDrawerProfile}
      installation={executionDrawerInstallation}
      deliveries={snapshot.messageDeliveries}
      turns={snapshot.turns}
      progressByRunId={executionProgressByRunId}
      campId={snapshot.camp.id}
      truncatedEvidenceByRunId={truncatedEvidenceByRunId}
      loadedEvidenceCountByRunId={loadedEvidenceCountByRunId}
      runHistoryComplete={openCoverage?.agentRuns.complete ?? true}
      cancellingTurnIds={cancellingTurnIds}
      cancellingRunIds={cancellingRunIds}
      confirmingRunIds={confirmingRunIds}
      focusedRunId={executionDrawerFocusedRunId}
      focusRequest={executionDrawerFocusRequest}
      onClose={closeExecutionProcess}
      onResolveRecoveryBlocker={resolveRecoveryBlocker}
      onCancelAgentRun={onCancelAgentRun}
      resolvingRecoveryBlockerId={resolvingRecoveryBlockerId}
      memberById={memberById}
    />
  ) : null

  return (
    <section className="workspace-shell camp-workspace" aria-label={`会话：${snapshot.camp.title}`}>
      <div className={`workspace-grid ${inspectorVisible ? '' : 'inspector-collapsed'}`.trim()}>
        <section
          className="timeline-pane"
          onDragEnter={enterAttachmentDropSurface}
          onDragOver={continueAttachmentDrop}
          onDragLeave={leaveAttachmentDropSurface}
          onDrop={dropAttachments}
        >
          <div className={`camp-conversation-stage ${conversationFind.open ? 'conversation-find-open' : ''}`.trim()}>
            <div className={`conversation-floating-tools ${conversationFind.open ? 'find-open' : ''}`.trim()}>
              {conversationFind.open && (
                <div className="conversation-find-surface" ref={conversationFindSurfaceRef}>
                  <form
                    className="conversation-find-form"
                    role="search"
                    aria-label="查找当前会话"
                    onSubmit={(event) => {
                      event.preventDefault()
                      navigateConversationFind(1)
                    }}
                  >
                    <svg className="conversation-find-glyph" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="10.5" cy="10.5" r="5.5" />
                      <path d="m15 15 4 4" />
                    </svg>
                    <input
                      ref={conversationFindInputRef}
                      type="text"
                      value={conversationFind.query}
                      aria-label="搜索当前会话"
                      aria-describedby="conversation-find-status"
                      placeholder="搜索当前会话"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => {
                        const nextQuery = event.target.value
                        setConversationFind((current) => ({
                          ...current,
                          query: nextQuery,
                          status: pendingConversationFindStatus(nextQuery),
                          snapshot: null,
                          error: null
                        }))
                      }}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return
                        if (event.key === 'Escape') {
                          event.preventDefault()
                          closeConversationFind()
                          return
                        }
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          navigateConversationFind(event.shiftKey ? -1 : 1)
                        }
                      }}
                    />
                    <span
                      className={`conversation-find-count ${conversationFindBusy ? 'busy' : ''}`.trim()}
                      aria-hidden="true"
                    >
                      {conversationFindBusy && <i className="conversation-find-spinner" />}
                      {conversationFindCountLabel}
                    </span>
                    <span className="conversation-find-divider" aria-hidden="true" />
                    <button
                      className="conversation-find-icon-button"
                      type="button"
                      aria-label="上一个匹配项"
                      title="上一个匹配项（Shift+Enter）"
                      disabled={conversationFindNavigationDisabled}
                      onClick={() => navigateConversationFind(-1)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5" /></svg>
                    </button>
                    <button
                      className="conversation-find-icon-button"
                      type="button"
                      aria-label="下一个匹配项"
                      title="下一个匹配项（Enter）"
                      disabled={conversationFindNavigationDisabled}
                      onClick={() => navigateConversationFind(1)}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                    </button>
                    <button
                      className="conversation-find-icon-button close"
                      type="button"
                      aria-label="关闭会话查找"
                      title="关闭（Esc）"
                      onClick={() => closeConversationFind()}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="m7 7 10 10M17 7 7 17" />
                      </svg>
                    </button>
                  </form>
                  {conversationFind.error && (
                    <div className="conversation-find-error" role="alert">
                      <span>{conversationFind.error}</span>
                      <button type="button" onClick={retryConversationFind}>重试</button>
                    </div>
                  )}
                  <span id="conversation-find-status" className="sr-only" aria-live="polite">
                    {conversationFindAnnouncement}
                  </span>
                </div>
              )}
              <div className="camp-conversation-view-controls" role="group" aria-label="会话区视图">
                <button
                  type="button"
                  aria-pressed={conversationView === 'conversation'}
                  onClick={() => setConversationView('conversation')}
                >
                  会话
                </button>
                <button
                  type="button"
                  aria-pressed={conversationView === 'world'}
                  onClick={(event) => {
                    const trigger = event.currentTarget
                    const preserveKeyboardFocus = event.detail === 0
                    if (conversationFind.open) closeConversationFind(false)
                    setConversationView('world')
                    if (preserveKeyboardFocus) {
                      window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }))
                    }
                  }}
                >
                  地图
                </button>
                {conversationView === 'world' && (
                  <button
                    className="camp-world-map-route-toggle"
                    type="button"
                    aria-label={worldMapRoutesVisible ? '隐藏地图路线' : '展示地图路线'}
                    aria-pressed={worldMapRoutesVisible}
                    title={worldMapRoutesVisible ? '隐藏路线' : '展示路线'}
                    onClick={() => setWorldMapRoutesVisible((visible) => !visible)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 18c2.2-4 3.2-7.4 7-7.4 3.1 0 3.1-4.6 7-4.6" />
                      <circle cx="5" cy="18" r="1.8" />
                      <circle cx="19" cy="6" r="1.8" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div
              className="timeline-scroll camp-timeline"
              ref={timelineScrollRef}
              tabIndex={-1}
              aria-label="对话时间线"
              hidden={conversationView !== 'conversation'}
              onScroll={(event) => recordTimelineReadingPosition(
                snapshot.camp.id,
                event.currentTarget
              )}
            >
              <div className="timeline-track">
              {!conversationFind.open && messageHistory?.hasEarlier && (
                <div className="camp-history-loader" role="status" aria-live="polite">
                  <button
                    className="quiet-button compact"
                    type="button"
                    disabled={earlierMessageStatus === 'loading'}
                    onClick={() => void loadEarlierMessages()}
                  >
                    {earlierMessageStatus === 'loading' ? '正在加载更早消息…' : '加载更早消息'}
                  </button>
                  <span>
                    已显示 {messageHistory.loadedCount} / {messageHistory.totalCount} 条
                  </span>
                </div>
              )}
              {!conversationFind.open && earlierMessageStatus === 'error' && messageHistory?.hasEarlier && (
                <div className="camp-history-error" role="alert">
                  <span>较早消息暂时没有加载。</span>
                  <button className="quiet-button compact" type="button" onClick={() => void loadEarlierMessages()}>
                    重试
                  </button>
                </div>
              )}
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
                  const authorProfileAvailable = Boolean(
                    campMessage.authorType === 'agent'
                    && member
                    && authorProfile
                    && member.membershipStatus === 'active'
                    && member.profilePresence !== 'removed'
                  )
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
                    delivery.deliveryKind === 'public_a2a'
                    && delivery.messageId === campMessage.id
                  )
                  const replyParentId = campMessage.replyToCampMessageId
                  const replyParent = replyParentId ? replyParentById.get(replyParentId) ?? null : null
                  const replyParentUnavailable = Boolean(
                    replyParentId
                    && replyAnchorWindows.has(replyParentId)
                    && replyAnchorWindows.get(replyParentId) === null
                  )
                  items.push(
                    <article
                      className={`timeline-node conversation-bubble ${campMessage.authorType}${followsSameAuthor ? ' same-author' : ''}${conversationFind.open && conversationFind.snapshot?.match?.messageId === campMessage.id ? ' conversation-find-current-message' : ''}`}
                      key={campMessage.id}
                      data-message-id={campMessage.id}
                      data-camp-turn-id={campMessage.campTurnId ?? sourceRun?.campTurnId}
                      tabIndex={-1}
                      style={member ? { '--agent-accent': identityColorToken(member.agentId) } as React.CSSProperties : undefined}
                    >
                      {campMessage.authorType === 'agent' && (authorProfileAvailable
                        ? (
                            <MessageAuthorProfileTrigger
                              agentId={campMessage.authorId}
                              displayName={author}
                              variant="avatar"
                              onActivate={openMemberProfilePopover}
                            >
                              <MemberAvatar
                                agentId={campMessage.authorId}
                                avatarRef={member?.avatarRef ?? null}
                                displayName={author}
                                size="list"
                                decorative
                              />
                            </MessageAuthorProfileTrigger>
                          )
                        : (
                            <MemberAvatar
                              agentId={campMessage.authorId}
                              avatarRef={member?.avatarRef ?? null}
                              displayName={author}
                              size="list"
                              decorative
                            />
                          ))}
                      {campMessage.authorType === 'user' && (
                        <span className="local-message-avatar" aria-hidden="true">你</span>
                      )}
                      {(campMessage.authorType === 'user' || campMessage.authorType === 'agent')
                        ? (
                            <div className="message-body">
                              <div className="bubble-meta">
                                {campMessage.authorType === 'agent' && authorProfileAvailable
                                  ? (
                                      <MessageAuthorProfileTrigger
                                        agentId={campMessage.authorId}
                                        displayName={author}
                                        variant="name"
                                        onActivate={openMemberProfilePopover}
                                      >
                                        <strong>{author}</strong>
                                      </MessageAuthorProfileTrigger>
                                    )
                                  : <strong>{author}</strong>}
                                {campMessage.authorType === 'agent' && authorProfile?.runtimeConfiguration && (
                                  <span>{runtimeAdapterLabel(authorProfile.runtimeConfiguration.adapterKind)}</span>
                                )}
                                <time title={`#${campMessage.sequence}`}>{messageClockTime(campMessage.createdAt)}</time>
                              </div>
                              <MessageSurface
                                copied={copiedMessageId === campMessage.id}
                                hasDelivery={campMessageDeliveries.length > 0}
                                onReply={campMessage.id.startsWith('optimistic:')
                                  ? undefined
                                  : (modality) => void startReply(campMessage, modality)}
                                onCopy={() => copyMessage(
                                  campMessage.id,
                                  displayBody,
                                  campMessage.content
                                )}
                              >
                                {replyParentId && (
                                  <ReplyParentQuote
                                    parent={replyParent}
                                    authorLabel={replyParent
                                      ? campMessageAuthorLabel(replyParent, snapshot.members)
                                      : null}
                                    unavailable={replyParentUnavailable}
                                    loading={!replyParent && !replyParentUnavailable}
                                    onReveal={() => void revealReplyParent(replyParentId)}
                                  />
                                )}
                                {campMessage.authorType === 'agent'
                                  && !campMessage.content?.some((segment) =>
                                    segment.kind === 'current_user_mention'
                                  )
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
                                                renderLeadingCurrentUserMarkdown={campMessage.authorType === 'agent'}
                                                onActivateMemberMention={openMemberProfilePopover}
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
                                onActivateMemberMention={openMemberProfilePopover}
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
                  firstRunCamp={firstRunCamp}
                  starterNotice={starterNotice}
                  onChoosePrompt={chooseStarterPrompt}
                />
              )}
              </div>
            </div>
            <div className="camp-world-map-panel" hidden={conversationView !== 'world'}>
              <CampWorldMap
                campId={snapshot.camp.id}
                agents={worldMapProjection.agents}
                rendezvous={worldMapProjection.rendezvous}
                routesVisible={worldMapRoutesVisible}
                active={conversationView === 'world'}
                onOpenExecutionProcess={(agentId, trigger) => openExecutionProcess(agentId, trigger)}
              />
            </div>
          </div>
          {executionPlacement === 'bottom' && (
            <RunPulse
              placement="bottom"
              placementButtonRef={bottomPlacementButtonRef}
              processes={executionProcesses}
              memberById={memberById}
              stopping={stopping}
              selectedAgentId={executionDrawerAgentId}
              onOpen={openExecutionProcess}
              onMovePlacement={moveExecutionToInspector}
            />
          )}
          <div
            ref={bottomExecutionDrawerHostRef}
            className="execution-drawer-host execution-drawer-host-bottom"
          >
            {!executionDrawerPortal && executionPlacement === 'bottom' && executionDrawer}
          </div>
        </section>

        {inspectorVisible && <aside
          className="activity-pane"
          aria-label="会话详情"
          onDragEnter={(event) => {
            if (!dataTransferContainsFiles(event.dataTransfer)) return
            event.dataTransfer.dropEffect = 'none'
            clearAttachmentDragState()
          }}
          onDragOver={(event) => {
            if (!dataTransferContainsFiles(event.dataTransfer)) return
            event.dataTransfer.dropEffect = 'none'
          }}
          onDrop={(event) => {
            if (!dataTransferContainsFiles(event.dataTransfer)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'none'
            clearAttachmentDragState()
          }}
        >
          <Tabs.Root
            value={inspectorSurfaceTab}
            onValueChange={(value) => selectInspectorSurfaceTab(value as CampInspectorSurfaceTab)}
            activationMode="manual"
            className="activity-tabs"
          >
            <Tabs.List className="tabs-list sticky-tabs" aria-label="会话详情">
              <Tabs.Trigger value="tasks">任务 <small>{openCoverage?.tasks.totalCount ?? snapshot.tasks.length}</small></Tabs.Trigger>
              <Tabs.Trigger value="members">队员 <small>{campInspectorMembers(snapshot.members).length}</small></Tabs.Trigger>
              {executionPlacement === 'inspector' && (
                <Tabs.Trigger value="execution">执行 <small>{executionProcesses.length}</small></Tabs.Trigger>
              )}
            </Tabs.List>
            <Tabs.Content value="tasks" className="tab-scroll task-panel-scroll">
              <TaskPanel
                snapshot={snapshot}
                coverage={openCoverage?.tasks ?? null}
                busy={busy}
                focusTaskId={focusedTaskId}
                focusRequest={taskFocusRequest}
                onTasksChanged={onTasksChanged}
                onOpenAgent={openExecutionProcess}
                onCreateModeChange={setTaskCreationActive}
              />
            </Tabs.Content>
            <Tabs.Content value="members" className="tab-scroll camp-members-panel">
              <CampMembersPanel
                snapshot={snapshot}
                profileById={profileById}
                installations={installations}
                busy={busy}
                onChangeLead={onChangeLead}
              />
            </Tabs.Content>
            <Tabs.Content value="execution" forceMount className="execution-sidecar-panel">
              {executionPlacement === 'inspector' && (
                <RunPulse
                  placement="inspector"
                  placementButtonRef={inspectorPlacementButtonRef}
                  processes={executionProcesses}
                  memberById={memberById}
                  stopping={stopping}
                  selectedAgentId={executionDrawerAgentId}
                  onOpen={openExecutionProcess}
                  onMovePlacement={moveExecutionToBottom}
                />
              )}
              <div
                ref={inspectorExecutionDrawerHostRef}
                className="execution-sidecar-detail execution-drawer-host execution-drawer-host-inspector"
              >
                {!executionDrawerPortal && executionPlacement === 'inspector' && executionDrawer}
                {executionPlacement === 'inspector' && !executionDrawer && (
                    <div className="execution-sidecar-empty">
                      选择一位队员，查看连续执行历史。
                    </div>
                )}
              </div>
            </Tabs.Content>
          </Tabs.Root>
          <div className="inspector-meta">
            {snapshot.agentRuns.length > 0 && `run ${shortIdentity(snapshot.agentRuns[snapshot.agentRuns.length - 1].id)} · `}seq {snapshot.throughGlobalSequence}
          </div>
        </aside>}
        <div
          className="conversation-controls"
          onDragEnter={enterAttachmentDropSurface}
          onDragOver={continueAttachmentDrop}
          onDragLeave={leaveAttachmentDropSurface}
          onDrop={dropAttachments}
        >
          {pendingApprovals.length > 0 && (
            <ApprovalDock
              approvals={pendingApprovals}
              profileById={profileById}
              busy={busy}
              onResolve={onResolveApproval}
              containerRef={approvalDockRef}
              focusRequest={notificationFocus?.kind === 'approval' && notificationFocus.active
                ? notificationFocus.requestId
                : null}
              focusApprovalId={notificationFocus?.kind === 'approval'
                ? notificationFocus.approvalId ?? null
                : null}
              onFocusPresented={onNotificationFocusPresented}
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
        className={[
          'composer',
          attachmentDragState ? 'is-dragging-attachments' : '',
          suppressPointerFocusRing ? 'suppress-pointer-focus-ring' : ''
        ].filter(Boolean).join(' ')}
        onSubmit={(event) => void submit(event)}
        onPointerDownCapture={() => setSuppressPointerFocusRing(true)}
        onKeyDownCapture={() => setSuppressPointerFocusRing(false)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setSuppressPointerFocusRing(false)
          }
        }}
      >
        {(continuationVisible && continuationIntent) || (
          composerDraft
          && recipientSummary
          && !composerDraft.replyIntent
          && !continuationRepairRequired
        )
          ? (
              <div className="composer-route-rail" aria-label="接收者路由">
                {continuationVisible && continuationIntent
                  ? (
                      <span className="composer-continuation" aria-label={`继续发给 ${continuationIntent.recipient.displayName}`}>
                        <svg aria-hidden="true" viewBox="0 0 16 16">
                          <path d="M3 3.5v3.25c0 1.8 1.45 3.25 3.25 3.25H13" />
                          <path d="m10.5 7.5 2.5 2.5-2.5 2.5" />
                        </svg>
                        <span>继续发给 <strong>@{continuationIntent.recipient.displayName}</strong></span>
                        <button
                          type="button"
                          aria-label={`取消继续发给 ${continuationIntent.recipient.displayName}`}
                          title="取消继续发送"
                          disabled={routingMutating}
                          onClick={() => void dismissContinuation()}
                        >
                          <svg aria-hidden="true" viewBox="0 0 12 12">
                            <path d="m3 3 6 6M9 3 3 9" />
                          </svg>
                        </button>
                      </span>
                    )
                  : recipientSummary && (
                      <span className="mention-target-summary" title={recipientSummary}>
                        <svg aria-hidden="true" viewBox="0 0 16 16">
                          <path d="M3 3.5v3.25c0 1.8 1.45 3.25 3.25 3.25H13" />
                          <path d="m10.5 7.5 2.5 2.5-2.5 2.5" />
                        </svg>
                        <span>{recipientSummary}</span>
                      </span>
                    )}
              </div>
            )
          : null}
        <div className="composer-box">
          {attachmentDragState && (
            <span className="composer-destination">将添加到这条消息</span>
          )}
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
                        kind={attachment.kind}
                        state="preparing"
                      />
                    ))}
                    {failedAttachments.map((attachment) => (
                      <AttachmentPlaceholder
                        key={attachment.id}
                        name={attachment.name}
                        kind={attachment.kind}
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
            {composerDraft?.replyIntent && (
              <div className="composer-reply-region">
                <div
                  className={`composer-reply-line${replyRepairRequired ? ' needs-repair' : ''}`}
                  title={`${composerDraft.replyIntent.author?.displayName ?? '引用消息'} · ${composerDraft.replyIntent.excerpt ?? '引用的消息当前不可用'}`}
                >
                  <ReplyMark />
                  <span className="composer-reply-copy">
                    <strong>回复 {composerDraft.replyIntent.author?.displayName ?? '引用消息'}</strong>
                    <span>{composerDraft.replyIntent.excerpt ?? '引用的消息当前不可用'}</span>
                  </span>
                  <button
                    ref={composerDraft.replyIntent.targetState === 'message_unavailable'
                      ? recipientRepairFirstOptionRef
                      : undefined}
                    className="composer-reply-cancel"
                    type="button"
                    aria-label="取消回复"
                    disabled={routingMutating}
                    onClick={() => void cancelReply()}
                  >
                    取消
                  </button>
                </div>
                {replyRepairRequired && (
                  <div className="reply-recipient-repair" role="alert" aria-live="assertive">
                    {composerDraft.replyIntent.targetState === 'message_unavailable'
                      ? (
                          <div className="reply-recipient-repair-copy">
                            <strong>引用的消息当前不可用</strong>
                            <span>请取消引用后再发送，草稿内容会继续保留。</span>
                          </div>
                        )
                      : (
                          <>
                            <div className="reply-recipient-repair-copy">
                              <strong>原作者当前不可接收，请选择其他成员</strong>
                              <span>引用会保留；只有你显式选择新接收者后才能发送。</span>
                            </div>
                            <div className="reply-recipient-options" aria-label="选择替代接收者">
                              {composerMembers.filter((member) => member.mentionable !== false).map((member, index) => (
                                <button
                                  ref={index === 0 ? recipientRepairFirstOptionRef : undefined}
                                  className="quiet-button compact"
                                  type="button"
                                  key={member.agentId}
                                  disabled={routingMutating}
                                  onClick={() => void resolveReplyRecipient({
                                    kind: 'member',
                                    agentId: member.agentId
                                  })}
                                >
                                  @{member.displayName}
                                </button>
                              ))}
                              <button
                                ref={composerMembers.every((member) => member.mentionable === false)
                                  ? recipientRepairFirstOptionRef
                                  : undefined}
                                className="quiet-button compact"
                                type="button"
                                disabled={routingMutating}
                                onClick={() => void resolveReplyRecipient({ kind: 'all_members' })}
                              >
                                @所有队员
                              </button>
                            </div>
                          </>
                        )}
                  </div>
                )}
                <span className="composer-reply-status" role="status" aria-live="polite">
                  {replyInteractionError ?? ''}
                </span>
              </div>
            )}
            {continuationRepairRequired && continuationIntent && !composerDraft?.replyIntent && (
              <div className="reply-recipient-repair" role="alert" aria-live="assertive">
                <div className="reply-recipient-repair-copy">
                  <strong>原接收者当前不可接收，请选择其他成员</strong>
                  <span>
                    草稿与附件会继续保留；只有你显式选择新接收者后才能发送。
                  </span>
                </div>
                <div className="reply-recipient-options" aria-label="选择替代接收者">
                  {continuationReplacementMembers.length === 0
                    ? <span className="reply-recipient-empty">当前没有其他可接收成员</span>
                    : continuationReplacementMembers.map((member, index) => (
                      <button
                        ref={index === 0 ? recipientRepairFirstOptionRef : undefined}
                        className="quiet-button compact"
                        type="button"
                        key={member.agentId}
                        disabled={routingMutating}
                        onClick={() => void resolveContinuationRecipient(member.agentId)}
                      >
                        @{member.displayName}
                      </button>
                    ))}
                </div>
              </div>
            )}
            <StructuredMentionComposer
              id="camp-message"
              value={messageContent}
              onChange={changeMessage}
              onBackspaceAtStart={composerDraft?.replyIntent
                ? () => cancelReply('start')
                : undefined}
              onPasteFiles={(files) => void prepareFiles(
                files.map((file) => ({ file, kindHint: 'file' }))
              )}
              onSubmit={submitMessage}
              members={composerMembers}
              skills={composerSkills}
              skillCatalogStatus={composerSkillCatalog.status}
              ariaLabel={`给 ${defaultLead?.displayName ?? '默认负责人'} 发消息`}
              placeholder="继续提问、补充约束或交付下一项职责…"
              disabled={busy || composerSubmitting || routingMutating}
              editorRef={composerEditorRef}
              onActivateMemberMention={(member, trigger, focusPanel) =>
                openMemberProfilePopover(member.agentId, trigger, focusPanel)}
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
            {!composerDraft?.replyIntent && replyInteractionError && (
              <span className="composer-reply-status" role="status" aria-live="polite">
                {replyInteractionError}
              </span>
            )}
          </div>
          <div className="composer-action-row">
            <div className="composer-tools">
              <input
                ref={composerFileInputRef}
                className="composer-file-input"
                type="file"
                multiple
                tabIndex={-1}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ''
                  if (files.length > 0) {
                    void prepareFiles(files.map((file) => ({ file, kindHint: 'file' })))
                  }
                }}
              />
              <button
                className="composer-attachment-button"
                type="button"
                aria-label="添加文件"
                title="添加文件"
                disabled={busy || composerSubmitting || routingMutating}
                onClick={() => composerFileInputRef.current?.click()}
              >
                <svg aria-hidden="true" viewBox="0 0 18 18">
                  <path d="m6.2 9.8 4.65-4.65a2.5 2.5 0 0 1 3.54 3.54l-6.1 6.1a4 4 0 0 1-5.66-5.66l6.1-6.1" />
                </svg>
              </button>
            </div>
            <div className="composer-actions">
              {!executionBlocked && (
                <span className="composer-hint">
                  <span className="sr-only">Enter 发送，Shift+Enter 换行</span>
                  <span className="composer-hint-visual" aria-hidden="true">
                    <kbd>↵</kbd>
                    <span>发送</span>
                    <span className="composer-hint-separator">·</span>
                    <kbd>⇧↵</kbd>
                    <span>换行</span>
                  </span>
                </span>
              )}
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
                        || replyRepairRequired
                        || continuationRepairRequired
                        || busy
                        || composerSubmitting
                        || routingMutating
                        || composerDraft === null
                        || preparingAttachments.length > 0
                        || failedAttachments.length > 0
                      }
                    >
                      {busy || composerSubmitting ? '发送中…' : preparingAttachments.length > 0 ? '处理中…' : '发送'}
                    </button>
                  )}
            </div>
          </div>
        </div>
          </form>
        </div>
        {attachmentDragState && (
          <div className="conversation-drop-layer" aria-hidden="true">
            <div className="conversation-drop-callout">
              <span className="conversation-drop-glyph">
                <svg viewBox="0 0 36 36">
                  <path className="paper" d="M21 7.5h6.2l3.3 3.4v12.9c0 1.5-1.2 2.7-2.7 2.7H21c-1.5 0-2.7-1.2-2.7-2.7V10.2c0-1.5 1.2-2.7 2.7-2.7Z" />
                  <path d="M27 7.8v4h3.3M21 7.5h6.2l3.3 3.4v12.9c0 1.5-1.2 2.7-2.7 2.7H21c-1.5 0-2.7-1.2-2.7-2.7V10.2c0-1.5 1.2-2.7 2.7-2.7Z" />
                  <path className="folder-fill" d="M5.5 13.8c0-1.4 1.1-2.5 2.5-2.5h5.1l2.5 2.6h8.1c1.4 0 2.5 1.1 2.5 2.5v9.1c0 1.4-1.1 2.5-2.5 2.5H8c-1.4 0-2.5-1.1-2.5-2.5Z" />
                  <path d="M5.5 15v-1.2c0-1.4 1.1-2.5 2.5-2.5h5.1l2.5 2.6h8.1c1.4 0 2.5 1.1 2.5 2.5v9.1c0 1.4-1.1 2.5-2.5 2.5H8c-1.4 0-2.5-1.1-2.5-2.5V15Z" />
                </svg>
              </span>
              <span className="conversation-drop-copy">
                <strong>松手添加到当前消息</strong>
                <span>
                  {attachmentDragState === 'directory'
                    ? '文件夹将保存为只读快照，原文件不会移动'
                    : '支持文件与文件夹 · 将安全复制到附件队列'}
                </span>
              </span>
            </div>
          </div>
        )}
        <span className="sr-only" aria-live="polite">
          {attachmentDragState
            ? '已进入当前消息附件区域，释放以添加文件或文件夹。'
            : ''}
        </span>
      </div>
      {mentionPopover && (
        <MentionProfilePopover
          request={mentionPopover}
          members={snapshot.members}
          profiles={agents}
          onClose={closeMentionPopover}
        />
      )}
      {executionDrawerPortal && createPortal(executionDrawer, executionDrawerPortal)}
    </section>
  )
}

const RUN_PULSE_MEMBER_NAME_LINE_LENGTH = 6
const RUN_PULSE_MEMBER_NAME_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
})

export function runPulseMemberNameLines(
  displayName: string
): [firstLine: string, secondLine?: string] {
  const graphemes = Array.from(
    RUN_PULSE_MEMBER_NAME_SEGMENTER.segment(displayName),
    (entry) => entry.segment
  )
  if (graphemes.length <= RUN_PULSE_MEMBER_NAME_LINE_LENGTH) return [displayName]

  const firstLine = graphemes.slice(0, RUN_PULSE_MEMBER_NAME_LINE_LENGTH).join('')
  const secondLineEnd = RUN_PULSE_MEMBER_NAME_LINE_LENGTH * 2
  const secondLine = graphemes
    .slice(RUN_PULSE_MEMBER_NAME_LINE_LENGTH, secondLineEnd)
    .join('')

  return [
    firstLine,
    graphemes.length > secondLineEnd ? `${secondLine}…` : secondLine
  ]
}

type RunPulseStateShape = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'recorded'

function runPulseStateShape(run: AgentRunView, stopping: boolean): RunPulseStateShape {
  if (stopping && NON_TERMINAL_RUNS.has(run.status)) return 'stopped'
  if (run.status === 'running') return 'running'
  if (run.status === 'queued' || run.status === 'waiting') return 'waiting'
  if (run.status === 'succeeded') return 'completed'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'cancelled') return 'stopped'
  return 'recorded'
}

function RunPulse({
  placement,
  placementButtonRef,
  processes,
  memberById,
  stopping,
  selectedAgentId,
  onOpen,
  onMovePlacement
}: {
  placement: ExecutionConsolePlacement
  placementButtonRef: RefObject<HTMLButtonElement | null>
  processes: AgentExecutionProcess[]
  memberById: Map<string, CampSnapshot['members'][number]>
  stopping: boolean
  selectedAgentId: string | null
  onOpen(agentId: string, trigger: HTMLButtonElement): void
  onMovePlacement(): void
}): JSX.Element {
  const visibleProcesses = processes.slice().sort((left, right) => {
    const leftPosition = memberById.get(left.agentId)?.memberOrder ?? Number.MAX_SAFE_INTEGER
    const rightPosition = memberById.get(right.agentId)?.memberOrder ?? Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition || left.agentId.localeCompare(right.agentId)
  })
  const activeProcessCount = visibleProcesses.filter((process) =>
    process.runs.some(agentRunCountsAsExecuting)
  ).length
  if (visibleProcesses.length === 0) return <></>
  const placementLabel = placement === 'bottom' ? '移到右侧' : '移回底部'
  const placementAriaLabel = placement === 'bottom'
    ? '将执行台移到右侧检查器'
    : '将执行台移回会话底部'
  return (
    <div className={`run-pulse run-pulse-${placement}`} aria-label="Agent 执行台">
      <div className="run-pulse-heading">
        <span className="run-pulse-title">
          <span className="run-pulse-mark" aria-hidden="true">
            <svg viewBox="0 0 26 18">
              <path d="M1.5 9h4.2l2.1-5.2 3.4 10.4 3.1-7.4 2.2 4.1h3.1l1.4-2.1h3.5" />
            </svg>
          </span>
          <strong>执行台</strong>
        </span>
        <span className="run-pulse-count" aria-live="polite">
          {stopping ? '正在停止本轮协作 · ' : activeProcessCount > 0 ? `${activeProcessCount} 位执行中 · ` : ''}
          {visibleProcesses.length} 位队员
        </span>
      </div>
      <ul className="run-pulse-list" aria-label="队员执行过程入口">
        {visibleProcesses.map((process) => {
          const run = preferredAgentProcessRun(process.runs)
          if (!run) return null
          const member = memberById.get(process.agentId)
          const memberName = member?.displayName ?? process.agentId
          const memberNameLines = runPulseMemberNameLines(memberName)
          const presentation = agentRunPresentation(
            run,
            stopping && NON_TERMINAL_RUNS.has(run.status)
          )
          const stateShape = runPulseStateShape(run, stopping)
          return (
            <li key={process.agentId}>
              <button
                type="button"
                className={`run-pulse-chip${selectedAgentId === process.agentId ? ' is-selected' : ''}`}
                aria-label={`打开${memberName}的执行过程，${presentation.label}`}
                aria-pressed={selectedAgentId === process.agentId}
                aria-expanded={selectedAgentId === process.agentId}
                aria-controls="agent-execution-drawer"
                title={`${memberName} · ${presentation.label}`}
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
                <span className="run-pulse-chip-copy">
                  <strong>
                    <span>{memberNameLines[0]}</span>
                    {memberNameLines[1] && <span>{memberNameLines[1]}</span>}
                  </strong>
                </span>
                <span
                  className={`run-pulse-chip-state tone-${presentation.tone} state-${stateShape}`}
                  role="img"
                  aria-label={presentation.label}
                  title={presentation.label}
                />
              </button>
            </li>
          )
        })}
      </ul>
      <button
        ref={placementButtonRef}
        className="execution-placement-button"
        type="button"
        aria-label={placementAriaLabel}
        title={placementLabel}
        onClick={onMovePlacement}
      >
        <ExecutionPlacementIcon target={placement === 'bottom' ? 'inspector' : 'bottom'} />
        <span>{placementLabel}</span>
      </button>
    </div>
  )
}

function ExecutionPlacementIcon({ target }: { target: ExecutionConsolePlacement }): JSX.Element {
  return target === 'inspector' ? (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.5 3.5v13" />
      <path d="m7 6.5 3.5 3.5L7 13.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 15.5h13" />
      <path d="m6.5 7 3.5 3.5L13.5 7" />
    </svg>
  )
}

function ExecutionDrawer({
  placement,
  process,
  member,
  profile,
  installation,
  deliveries,
  turns,
  progressByRunId,
  campId,
  truncatedEvidenceByRunId,
  loadedEvidenceCountByRunId,
  runHistoryComplete,
  cancellingTurnIds,
  cancellingRunIds,
  confirmingRunIds,
  focusedRunId,
  focusRequest,
  onClose,
  onResolveRecoveryBlocker,
  onCancelAgentRun,
  resolvingRecoveryBlockerId,
  memberById
}: {
  placement: ExecutionConsolePlacement
  process: AgentExecutionProcess
  member: CampSnapshot['members'][number] | null
  profile: AgentProfile | null
  installation: AdapterInstallation | null
  deliveries: MessageDeliveryView[]
  turns: CampSnapshot['turns']
  progressByRunId: Map<string, LiveExecutionProgress>
  campId: string
  truncatedEvidenceByRunId: Map<string, AgentRunExecutionEvidenceView[]>
  loadedEvidenceCountByRunId: Map<string, number>
  runHistoryComplete: boolean
  cancellingTurnIds: ReadonlySet<string>
  cancellingRunIds: ReadonlySet<string>
  confirmingRunIds: ReadonlySet<string>
  focusedRunId: string | null
  focusRequest: ExecutionDrawerFocusRequest
  onClose(): void
  onResolveRecoveryBlocker(run: AgentRunView): Promise<void>
  onCancelAgentRun(run: AgentRunView): Promise<void>
  resolvingRecoveryBlockerId: string | null
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
  const [submittingStopRunIds, setSubmittingStopRunIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const processRef = useRef(process)
  processRef.current = process
  const resolvedFocusedRun = process.runs.find((run) => run.id === focusedRunId)
    ?? preferredAgentProcessRun(process.runs)
  const resolvedFocusedRunId = resolvedFocusedRun?.id ?? null
  const owningTurn = resolvedFocusedRun
    ? turns.find((turn) => turn.id === resolvedFocusedRun.campTurnId) ?? null
    : null
  const turnStopping = Boolean(
    resolvedFocusedRun && cancellingTurnIds.has(resolvedFocusedRun.campTurnId)
  )
  const runStopping = Boolean(
    resolvedFocusedRun
    && (
      cancellingRunIds.has(resolvedFocusedRun.id)
      || submittingStopRunIds.has(resolvedFocusedRun.id)
      || resolvedFocusedRun.cancelRequestedAt !== null
    )
  )
  const runStopConfirming = Boolean(
    resolvedFocusedRun && confirmingRunIds.has(resolvedFocusedRun.id)
  )
  const stopViewState = resolvedFocusedRun
    ? agentRunStopViewState(resolvedFocusedRun, owningTurn, {
        cancelling: runStopping,
        confirming: runStopConfirming,
        turnCancelling: turnStopping
      })
    : 'hidden'
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
  const appliedHeight = placement === 'bottom' && preferredHeight !== null && heightBounds
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
    if (placement !== 'bottom') {
      setHeightBounds(null)
      setMeasuredHeight(null)
      return undefined
    }
    if (!drawer) return undefined
    let timelinePane: HTMLElement | null = null
    let runPulse: HTMLElement | null = null
    let observer: ResizeObserver | null = null
    const measure = (): void => {
      if (!timelinePane) return
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
    const frame = window.requestAnimationFrame(() => {
      timelinePane = drawer.closest<HTMLElement>('.timeline-pane')
      if (!timelinePane) return
      runPulse = timelinePane.querySelector<HTMLElement>('.run-pulse')
      measure()
      observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
      observer?.observe(timelinePane)
      observer?.observe(drawer)
      if (runPulse) observer?.observe(runPulse)
      window.addEventListener('resize', measure)
    })
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [placement])

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
      if (
        event.key === 'Escape'
        && event.target instanceof Element
        && event.target.closest('.tool-call-result-scroll')
      ) return
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
  const drawerTitle = executionDrawerTitle(
    displayName,
    profile?.runtimeConfiguration?.adapterKind ?? null
  )
  const runtimeConfiguration = profile?.runtimeConfiguration
    ? memberRuntimeConfigurationPresentation(profile.runtimeConfiguration, installation)
    : null
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
  const drawerStyle: CSSProperties | undefined = placement === 'inspector'
    ? undefined
    : appliedHeight === null
      ? defaultMaxHeight === null ? undefined : { maxHeight: defaultMaxHeight }
      : { height: appliedHeight, minHeight: appliedHeight, maxHeight: appliedHeight }

  return (
    <section
      id="agent-execution-drawer"
      ref={drawerRef}
      className={`execution-drawer execution-drawer-${placement}${preferredHeight !== null && placement === 'bottom' ? ' is-user-sized' : ''}${resizing ? ' is-resizing' : ''}`}
      role="region"
      aria-labelledby="execution-drawer-title"
      tabIndex={-1}
      data-placement={placement}
      data-user-sized={preferredHeight !== null && placement === 'bottom' ? 'true' : 'false'}
      style={drawerStyle}
    >
      {placement === 'bottom' && (
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
      )}
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
              <div className="execution-drawer-title-line">
                <h2 id="execution-drawer-title">{drawerTitle}</h2>
                {runtimeConfiguration && (
                  <span className="execution-model-params">{runtimeConfiguration.summary}</span>
                )}
              </div>
              <p>
                {runHistoryComplete ? '共' : '当前载入'} {process.runs.length} 次执行
                {!runHistoryComplete && ' · 更早执行尚未载入'}
                {process.runs.some(agentRunCountsAsExecuting) && ' · 当前正在执行'}
              </p>
            </div>
          </div>
          <div className="execution-drawer-actions">
            {stopViewState === 'stopped' ? (
              <span className="execution-run-stop-state tone-neutral" role="status">已停止</span>
            ) : stopViewState === 'stopping' ? (
              <span className="execution-run-stop-state tone-attention" role="status">正在停止…</span>
            ) : stopViewState === 'confirming' ? (
              <span className="execution-run-stop-state tone-attention" role="status">正在确认停止状态</span>
            ) : null}
            {stopViewState === 'available' && resolvedFocusedRun && (
              <button
                type="button"
                className="quiet-button compact danger-text execution-run-stop-button"
                aria-label="停止当前运行"
                onClick={() => {
                  const runId = resolvedFocusedRun.id
                  setSubmittingStopRunIds((current) => new Set(current).add(runId))
                  void onCancelAgentRun(resolvedFocusedRun).finally(() => {
                    setSubmittingStopRunIds((current) => {
                      if (!current.has(runId)) return current
                      const next = new Set(current)
                      next.delete(runId)
                      return next
                    })
                  })
                }}
              >
                停止
              </button>
            )}
            <button type="button" className="quiet-button" onClick={onClose} aria-label="收起执行详情">收起</button>
          </div>
        </header>
        <div
          ref={drawerBodyRef}
          className="execution-drawer-body"
          aria-label={`${displayName}的连续执行历史`}
          data-following-latest={followingLatest ? 'true' : 'false'}
          onScroll={(event) => {
            const body = event.currentTarget
            if (body.scrollHeight - body.clientHeight <= 1) return
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
              const runtimeModel = agentRunRuntimeModelPresentation(run.runtimeModel)
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
                            <span className="current-run-badge">当前执行</span>
                          )}
                        </div>
                        <div className="execution-run-meta">
                          <span>执行 <code>{shortIdentity(run.id)}</code></span>
                          <span>
                            {run.invocationKind === 'a2a'
                              ? 'A2A'
                              : run.invocationKind === 'gather_completion'
                                ? '统一综合'
                                : '直接执行'}
                          </span>
                          {run.invocationKind === 'a2a' && <span>深度 {run.a2aDepth}</span>}
                          <span>本轮 <code>{shortIdentity(run.campTurnId)}</code></span>
                          {runtimeModel && (
                            <span
                              className={`execution-run-model${runtimeModel.observed ? ' is-observed' : ' is-waiting'}`}
                              role="status"
                              aria-live="polite"
                              aria-atomic="true"
                              aria-label={runtimeModel.observed
                                ? `${displayName}，${runIntervalLabel(run)}，实际模型 ${runtimeModel.modelId}，默认策略`
                                : `${displayName}，${runIntervalLabel(run)}，实际模型尚未由 Agent 运行时报告，默认策略`}
                            >
                              模型{' '}
                              <code
                                dir="ltr"
                                tabIndex={0}
                                title={runtimeModel.modelId}
                              >
                                {runtimeModel.modelId}
                              </code>
                              {runtimeModel.observed && <small>· 默认</small>}
                            </span>
                          )}
                        </div>
                      </div>
                    </header>
                    {agentRunTerminalNote(run) && (
                      <p className="execution-terminal-note">{agentRunTerminalNote(run)}</p>
                    )}
                    <AgentRunDeliveryRecipients deliveries={runDeliveries} memberById={memberById} />
                    <RunExecutionDisclosure
                      run={run}
                      progress={progressByRunId.get(run.id)}
                      campId={campId}
                      truncatedEvidence={truncatedEvidenceByRunId.get(run.id)}
                      loadedEvidenceCount={loadedEvidenceCountByRunId.get(run.id) ?? 0}
                      cancelling={cancelling}
                      focused={focused}
                      onResolveRecoveryBlocker={onResolveRecoveryBlocker}
                      resolvingRecoveryBlocker={resolvingRecoveryBlockerId === run.id}
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
  const publicDeliveries = deliveries.filter(isPublicA2aDelivery)
  if (publicDeliveries.length === 0) return null
  const ordered = publicDeliveries.slice().sort((left, right) =>
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

function MessageAuthorProfileTrigger({
  agentId,
  displayName,
  variant,
  onActivate,
  children
}: {
  agentId: string
  displayName: string
  variant: 'avatar' | 'name'
  onActivate(agentId: string, trigger: HTMLElement, focusPanel: boolean): void
  children: React.ReactNode
}): JSX.Element {
  const label = `查看${displayName}的基础信息`
  return (
    <button
      className={`message-author-trigger message-author-${variant}-trigger`}
      type="button"
      data-agent-id={agentId}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={false}
      title={label}
      onClick={(event) => onActivate(agentId, event.currentTarget, event.detail === 0)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onActivate(agentId, event.currentTarget, true)
      }}
    >
      {children}
    </button>
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
  const publicDeliveries = deliveries.filter(isPublicA2aDelivery)
  if (publicDeliveries.length === 0) return null
  const ordered = publicDeliveries.slice().sort((left, right) =>
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

function isPublicA2aDelivery(
  delivery: MessageDeliveryView
): delivery is Extract<MessageDeliveryView, { deliveryKind: 'public_a2a' }> {
  return delivery.deliveryKind === 'public_a2a'
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
          <p>群体提及</p>
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
  installations,
  busy,
  onChangeLead
}: {
  snapshot: CampSnapshot
  profileById: Map<string, AgentProfile>
  installations: AdapterInstallation[]
  busy: boolean
  onChangeLead(agentId: string): Promise<void>
}): JSX.Element {
  const members = campInspectorMembers(snapshot.members)
  const defaultLead = members.find((member) => member.isDefaultLead) ?? null
  const presentCount = members.filter(campMemberIsLeadEligible).length
  const awayCount = members.length - presentCount
  const [expandedRuntimeAgentIds, setExpandedRuntimeAgentIds] = useState<Set<string>>(
    () => new Set()
  )

  const toggleRuntimeDetails = (agentId: string): void => {
    setExpandedRuntimeAgentIds((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  return (
    <section aria-label="当前会话队员">
      <div className="camp-members-summary">
        <div className="camp-members-summary-line">
          <div>
            <strong>协作队员</strong>
            <small>{presentCount} 位在队 · {awayCount} 位暂离</small>
          </div>
          <span className="camp-members-scope">当前会话</span>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="camp-lead-picker"
              type="button"
              disabled={busy || presentCount === 0}
              aria-label={defaultLead
                ? `队长，${defaultLead.displayName}；更换队长`
                : '选择队长'}
            >
              {defaultLead
                ? <MemberAvatar agentId={defaultLead.agentId} avatarRef={defaultLead.avatarRef} displayName={defaultLead.displayName} size="mention" decorative />
                : <span className="camp-lead-picker-empty" aria-hidden="true">—</span>}
              <span className="camp-lead-picker-copy">
                <strong>队长 · {defaultLead?.displayName ?? '未设置'}</strong>
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
              aria-label="更换队长"
            >
              <DropdownMenu.Label className="camp-lead-menu-label">选择队长</DropdownMenu.Label>
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

      <div className="camp-inspector-member-list" role="list" aria-label="会话队员列表">
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
          const installation = profile?.runtimeConfiguration
            ? runtimeEditorInstallation(installations, profile.runtimeConfiguration.adapterKind)
            : null
          const runtimeConfiguration = profile?.runtimeConfiguration
            ? memberRuntimeConfigurationPresentation(profile.runtimeConfiguration, installation)
            : null
          const runtimeDetailsOpen = expandedRuntimeAgentIds.has(member.agentId)
          const runtimeDetailsId = `camp-member-runtime-${member.agentId}`
          return (
            <article className={`camp-inspector-member-row ${present ? '' : 'is-away'}`} role="listitem" key={member.agentId}>
              <span className="camp-inspector-member-avatar">
                <MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="list" decorative />
                <i className={present ? '' : 'is-away'} aria-hidden="true" />
              </span>
              <span className="camp-inspector-member-copy">
                <span className="camp-inspector-member-name">
                  <strong>{member.displayName}</strong>
                  {member.isDefaultLead && <small>队长</small>}
                </span>
                <small>{member.teamRole || '团队角色未设置'}</small>
              </span>
              <span className={`camp-inspector-member-state ${present ? '' : 'is-away'}`}>
                <strong>{presenceLabel}</strong>
                {runtimeConfiguration
                  ? (
                      <button
                        className={`camp-inspector-runtime-toggle runtime-${runtimeTone}`}
                        type="button"
                        aria-expanded={runtimeDetailsOpen}
                        aria-controls={runtimeDetailsId}
                        aria-label={`${runtimeLabel}；${runtimeDetailsOpen ? '收起' : '展开'}模型信息`}
                        onClick={() => toggleRuntimeDetails(member.agentId)}
                      >
                        <span>{runtimeLabel}</span>
                        <svg aria-hidden="true" viewBox="0 0 16 16">
                          <path d="m6 3.5 4.5 4.5L6 12.5" />
                        </svg>
                      </button>
                    )
                  : <small className={`runtime-${runtimeTone}`}>{runtimeLabel}</small>}
              </span>
              {runtimeConfiguration && runtimeDetailsOpen && (
                <dl
                  className="camp-inspector-runtime-detail"
                  id={runtimeDetailsId}
                  aria-label={`${member.displayName}的当前模型配置`}
                >
                  <div><dt>模型</dt><dd>{runtimeConfiguration.model}</dd></div>
                  {runtimeConfiguration.effort && (
                    <div>
                      <dt>{runtimeConfiguration.effort.label}</dt>
                      <dd>{runtimeConfiguration.effort.value}</dd>
                    </div>
                  )}
                  <div><dt>模型策略</dt><dd>{runtimeConfiguration.strategy}</dd></div>
                </dl>
              )}
            </article>
          )
        })}
        {members.length === 0 && <EmptyInline text="当前会话没有可显示的队员。" />}
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
  focusRequest,
  focusApprovalId,
  onFocusPresented
}: {
  approvals: ActionApprovalView[]
  profileById: Map<string, AgentProfile>
  busy: boolean
  onResolve(approval: ActionApprovalView, optionId: string): void
  containerRef: RefObject<HTMLElement | null>
  focusRequest: number | null
  focusApprovalId: string | null
  onFocusPresented?(requestId: number): void
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
    if (focusRequest === null) return
    setCollapsed(false)
    if (focusApprovalId) {
      const targetIndex = approvals.findIndex((candidate) => candidate.id === focusApprovalId)
      if (targetIndex >= 0) setActiveIndex(targetIndex)
    }
  }, [approvals, focusApprovalId, focusRequest])

  useEffect(() => {
    if (focusRequest === null || collapsed) return undefined
    if (focusApprovalId && approval.id !== focusApprovalId) return undefined
    let frame: number | null = null
    let scrolled = false
    let focusObserved = false
    const present = (): void => {
      const presentationRoot = focusApprovalId
        ? containerRef.current?.querySelector<HTMLElement>(
            `[data-approval-id="${CSS.escape(focusApprovalId)}"]`
          ) ?? null
        : containerRef.current
      const target = presentationRoot
        ?.querySelector<HTMLButtonElement>('.runtime-option:not(:disabled)')
        ?? (!focusApprovalId
          ? containerRef.current?.querySelector<HTMLButtonElement>('.approval-dock-collapse')
          : null)
      if (!target) {
        frame = window.requestAnimationFrame(present)
        return
      }
      if (!scrolled) {
        scrolled = true
        target.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        })
      }
      if (focusObserved && document.activeElement === target) {
        onFocusPresented?.(focusRequest)
        return
      }
      target.focus({ preventScroll: true })
      focusObserved = document.activeElement === target
      frame = window.requestAnimationFrame(present)
    }
    frame = window.requestAnimationFrame(present)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [activeIndex, approval.id, collapsed, containerRef, focusApprovalId, focusRequest, onFocusPresented])

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
      {!collapsed && <div
        className="approval-dock-scroll"
        id={contentId}
        data-approval-id={approval.id}
      >
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
  firstRunCamp,
  starterNotice,
  onChoosePrompt
}: {
  snapshot: CampSnapshot
  projectName: string | null
  agents: AgentProfile[]
  firstRunCamp: FirstRunCampContext | null
  starterNotice: string | null
  onChoosePrompt(prompt: string, announceDraft?: boolean): void
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

  if (firstRunCamp) {
    const firstMember = activeMembers.find(
      (member) => member.agentId === firstRunCamp.memberAgentId
    ) ?? lead
    const profile = agents.find(
      (agent) => agent.agentId === firstRunCamp.memberAgentId
    ) ?? null
    const displayName = firstMember?.displayName ?? profile?.displayName ?? '队员'
    return (
      <FirstRunCampWelcome
        displayName={displayName}
        agentId={firstRunCamp.memberAgentId}
        avatarRef={firstMember?.avatarRef ?? profile?.avatarRef ?? null}
        role={firstRunCamp.memberRole}
        starterNotice={starterNotice}
        onChoosePrompt={onChoosePrompt}
      />
    )
  }

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
          : '这里已经保留当前工作区、队员和默认负责人。发送第一条消息后，公共讨论、执行过程和最终结论会依次展开。'}
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
          <strong>{lead ? `负责人 · ${lead.displayName}` : '默认负责人未设置'}</strong>
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

function FirstRunCampWelcome({
  displayName,
  agentId,
  avatarRef,
  role,
  starterNotice,
  onChoosePrompt
}: {
  displayName: string
  agentId: string
  avatarRef: string | null
  role: BuiltinMemberAvatarRole
  starterNotice: string | null
  onChoosePrompt(prompt: string, announceDraft?: boolean): void
}): JSX.Element {
  const starters = firstRunCampStarters(role, displayName)
  return (
    <section className="empty-camp-welcome first-run-camp-welcome" aria-labelledby="first-run-camp-title">
      <div className="first-run-camp-intro">
        <MemberPortrait
          agentId={agentId}
          avatarRef={avatarRef}
          displayName={displayName}
          decorative
          className="first-run-camp-portrait"
        />
        <div>
          <span>初次集结 · 快速对话</span>
          <h2 id="first-run-camp-title">你好，我是{displayName}。</h2>
          <p>先从下面选一件事。我会先把内容放进输入框，由你确认后再发送。</p>
        </div>
      </div>

      <div className="first-run-camp-facts" aria-label="当前快速对话配置">
        <span><i aria-hidden="true" />对话已保存</span>
        <span><i aria-hidden="true" />{displayName}是当前队员和负责人</span>
      </div>

      <div className="first-run-starters" aria-label="可选的起步内容">
        {starters.map((starter, index) => (
          <button
            type="button"
            key={starter.title}
            onClick={() => onChoosePrompt(starter.prompt, true)}
          >
            <span className="first-run-starter-key" aria-hidden="true">
              {String.fromCharCode(65 + index)}
            </span>
            <span><strong>{starter.title}</strong><small>{starter.body}</small></span>
            <span className="first-run-starter-action">
              填入输入框
              <svg className="first-run-starter-arrow" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6.25 3.25 4.5 4.75-4.5 4.75M10.5 8h-6" />
              </svg>
            </span>
          </button>
        ))}
      </div>

      <p className="first-run-draft-notice" role="status" aria-live="polite">
        {starterNotice && (
          <><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8.25 3 3 6.5-6.5" /></svg>{starterNotice}</>
        )}
      </p>
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

function campMessageAuthorLabel(
  message: CampMessageView,
  members: CampSnapshot['members']
): string {
  if (message.authorType === 'user') return '你'
  if (message.authorType === 'system') return '系统'
  return members.find((member) => member.agentId === message.authorId)?.displayName
    ?? message.authorId
}

function ReplyParentQuote({
  parent,
  authorLabel,
  unavailable,
  loading,
  onReveal
}: {
  parent: CampMessageView | null
  authorLabel: string | null
  unavailable: boolean
  loading: boolean
  onReveal(): void
}): JSX.Element {
  if (!parent) {
    return (
      <div className={`reply-parent-quote is-static${unavailable ? ' is-unavailable' : ''}`}>
        <ReplyMark />
        <span>{unavailable ? '引用的消息当前不可用' : loading ? '正在载入引用…' : '引用消息'}</span>
      </div>
    )
  }
  const excerpt = parent.body.split(/\s+/u).filter(Boolean).join(' ')
  const label = `${authorLabel ?? '原消息'} · ${excerpt}`
  return (
    <button className="reply-parent-quote" type="button" title={label} onClick={onReveal}>
      <ReplyMark />
      <strong>{authorLabel ?? '原消息'}</strong>
      <span>{excerpt}</span>
    </button>
  )
}

function ReplyMark(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.3 4.1 2.7 7.3l3.6 3.2M3 7.3h5.4c2.7 0 4.2 1.2 4.6 3.6" />
    </svg>
  )
}

function MessageSurface({
  copied,
  hasDelivery,
  onReply,
  onCopy,
  children
}: {
  copied: boolean
  hasDelivery: boolean
  onReply?(modality: ReplyFocusModality): void
  onCopy(): void
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={`message-surface${hasDelivery ? ' has-delivery' : ''}${copied ? ' copied' : ''}`}>
      {children}
      {onReply && (
        <button
          className="message-reply-button"
          type="button"
          aria-label="回复这条消息"
          onClick={(event) => onReply(event.detail === 0 ? 'keyboard' : 'pointer')}
        >
          回复
        </button>
      )}
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
  renderLeadingCurrentUserMarkdown = false,
  onActivateMemberMention,
  onActivateAllMembersMention
}: {
  body: string
  content: StructuredCampMessageContent | null
  members: CampSnapshot['members']
  renderLeadingCurrentUserMarkdown?: boolean
  onActivateMemberMention?(
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
}): JSX.Element {
  if (content === null) return <p>{body}</p>
  const markdownBody = renderLeadingCurrentUserMarkdown
    ? projectLeadingCurrentUserMentionMarkdownBody(content, members)
    : null
  if (markdownBody !== null) {
    return (
      <div className="current-user-markdown-body">
        <span className="current-user-mention-prefix">
          <CurrentUserMentionToken />
          {markdownBody.length > 0 ? ' ' : ''}
        </span>
        {markdownBody.length > 0 && (
          <SafeMarkdown className="current-user-markdown-content">{markdownBody}</SafeMarkdown>
        )}
      </div>
    )
  }
  const memberById = new Map(members.map((member) => [member.agentId, member]))
  return (
    <p className="structured-message-body">
      {content.map((segment, index) => {
        if (segment.kind === 'text') return <span key={`text-${index}`}>{segment.text}</span>
        if (segment.kind === 'current_user_mention') {
          return (
            <span key={`current-user-${index}`}>
              <CurrentUserMentionToken />
              {index === 0 && content.slice(1).some((candidate) => (
                candidate.kind !== 'text' || candidate.text.length > 0
              )) ? ' ' : ''}
            </span>
          )
        }
        if (segment.kind === 'skill_mention') {
          return (
            <span
              className="message-mention-token skill-mention"
              aria-label={`Skill /${segment.nameAtSend}`}
              key={`skill-${index}-${segment.skillId}`}
            >
              /{segment.nameAtSend}
            </span>
          )
        }
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

function CurrentUserMentionToken(): JSX.Element {
  return (
    <span
      className="message-mention-token current-user"
      aria-label="提及当前用户：你"
    >
      @你
    </span>
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
      aria-label={copied ? '已复制这条消息' : '复制这条消息'}
      title="复制这条消息"
      onClick={onCopy}
    >
      复制
    </button>
  )
}

function AttachmentFolderGlyph(): JSX.Element {
  return (
    <svg className="attachment-folder-glyph" viewBox="0 0 24 24">
      <path className="fill" d="M3.8 7.2c0-1.1.9-2 2-2h4l2 2.1h6.5c1.1 0 2 .9 2 2v7.4c0 1.1-.9 2-2 2H5.8c-1.1 0-2-.9-2-2Z" />
      <path d="M3.8 8.2V7.1c0-1 .8-1.8 1.8-1.8h4.1l2.1 2.1h6.4c1.1 0 2 .9 2 2v7.3c0 1.1-.9 2-2 2H5.8c-1.1 0-2-.9-2-2V8.2Z" />
    </svg>
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
        {attachment.kind === 'directory'
          ? <AttachmentFolderGlyph />
          : previewUrl
          ? <img src={previewUrl} alt="" />
          : attachment.previewKind === 'image' && !previewFailed ? <i className="attachment-loading" /> : '文'}
      </span>
      <span className="attachment-copy">
        <strong title={attachment.displayName}>{attachment.displayName}</strong>
        <small>
          {attachment.kind === 'directory'
            ? `${attachment.fileCount} 个文件 · ${formatByteSize(attachment.byteSize)} · 只读快照`
            : `${attachmentTypeLabel(attachment.mediaType)} · ${formatByteSize(attachment.byteSize)}`}
        </small>
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
  kind,
  state,
  detail,
  onRemove
}: {
  name: string
  kind: AttachmentKind
  state: 'preparing' | 'error'
  detail?: string
  onRemove?: () => void
}): JSX.Element {
  return (
    <div className={`attachment-card attachment-${state}`}>
      <span className="attachment-visual" aria-hidden="true">
        {kind === 'directory'
          ? (
              <span className="attachment-folder-state">
                <AttachmentFolderGlyph />
                {state === 'preparing'
                  ? <i className="attachment-loading" />
                  : <b>!</b>}
              </span>
            )
          : state === 'preparing' ? <i className="attachment-loading" /> : '!'}
      </span>
      <span className="attachment-copy">
        <strong title={name}>{name}</strong>
        <small title={detail}>
          {state === 'preparing'
            ? kind === 'directory' ? '正在创建只读快照…' : '正在安全接入…'
            : detail ?? '附件处理失败'}
        </small>
      </span>
      {onRemove && (
        <button className="attachment-remove" type="button" aria-label={`移除失败附件 ${name}`} onClick={onRemove}>×</button>
      )}
    </div>
  )
}

function attachmentTypeLabel(mediaType: string): string {
  if (mediaType === 'inode/directory') return '文件夹'
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
  if (message.includes('total attachment') || message.includes('64 MiB')) return '附件总大小超过 64 MiB'
  if (message.includes('2000-file')) return '文件夹内文件数量超过 2,000 个'
  if (message.includes('4000-entry')) return '文件夹内项目数量超过 4,000 个'
  if (message.includes('32-level')) return '文件夹层级超过 32 层'
  if (message.includes('symbolic link') || message.includes('symlinks')) return '文件夹包含不支持的软链接'
  if (message.includes('unsupported item')) return '文件夹包含不支持的项目'
  if (message.includes('regular files and directories')) return '仅支持普通文件或文件夹'
  return '安全接入失败，可移除后重试'
}

function replyDraftErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('draft_changed')) return '草稿已在其他位置更新，请重试。'
  if (message.includes('mention_target_unavailable')) {
    return '所选成员当前不可接收，请选择其他成员。'
  }
  if (message.includes('camp_message.invalid_reply')) return '引用的消息当前不可用。'
  if (message.includes('continuation_replacement_invalid')) {
    return '原接收者当前不可接收，请选择其他成员。'
  }
  if (message.includes('continuation_source_invalid')) {
    return '延续来源已经变化，草稿已刷新，请重新确认接收者。'
  }
  return '接收者状态未能更新，草稿内容已保留，请重试。'
}

type TaskTimelineCardPresentation = {
  headline: string
  noteLabel: string
  note: string
  unassigned: boolean
}

function taskTimelineCardPresentation(task: TaskView): TaskTimelineCardPresentation {
  if (task.status === 'pending' && !task.assigneeAgentId) {
    return {
      headline: '任务等待重新分配',
      noteLabel: '需要处理',
      note: '等待用户或默认负责人重新分配',
      unassigned: true
    }
  }
  if (task.status === 'pending') {
    return {
      headline: '任务责任已更新',
      noteLabel: '当前',
      note: '等待负责人开始；创建不会自动启动执行',
      unassigned: false
    }
  }
  if (task.status === 'in_progress') {
    return {
      headline: '任务正在推进',
      noteLabel: '当前',
      note: '任务处于进行中；打开详情可查看责任与关联执行',
      unassigned: false
    }
  }
  if (task.status === 'blocked') {
    return {
      headline: '任务暂时受阻',
      noteLabel: '阻塞原因',
      note: task.blockedReason?.trim() || '阻塞原因尚未提供',
      unassigned: false
    }
  }
  if (task.status === 'completed') {
    return {
      headline: '任务已经完成',
      noteLabel: '完成摘要',
      note: task.completionSummary?.trim() || '完成摘要尚未提供',
      unassigned: false
    }
  }
  return {
    headline: '任务已经取消',
    noteLabel: '取消原因',
    note: task.cancelReason?.trim() || '取消原因尚未提供',
    unassigned: false
  }
}

function TaskTimelineStatusIcon({
  status,
  unassigned
}: {
  status: TaskStatus
  unassigned: boolean
}): JSX.Element {
  if (unassigned) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="9" cy="8" r="2.75" />
        <path d="M4.5 18c.65-3 2.2-4.5 4.5-4.5 1.45 0 2.6.58 3.4 1.72" />
        <path d="M17.5 7.5v6M14.5 10.5h6" />
      </svg>
    )
  }
  if (status === 'in_progress') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m10 8.5 5 3.5-5 3.5Z" />
      </svg>
    )
  }
  if (status === 'blocked') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 3.5h8L20.5 8v8L16 20.5H8L3.5 16V8Z" />
        <path d="M12 7.5v5.75M12 16.5h.01" />
      </svg>
    )
  }
  if (status === 'completed') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.25 12.15 2.4 2.4 5.25-5.35" />
      </svg>
    )
  }
  if (status === 'cancelled') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v4.8l3 1.8" />
    </svg>
  )
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
  const descriptionId = useId()
  const presentation = taskTimelineCardPresentation(task)
  const acceptanceCriteriaLabel = `${task.acceptanceCriteria.length} 个验收条件`
  const ownerStyle = task.assigneeAgentId
    ? { '--task-owner-accent': identityColorToken(task.assigneeAgentId) } as CSSProperties
    : undefined
  return (
    <button
      aria-label={`打开任务：${task.title}`}
      aria-describedby={descriptionId}
      className={`timeline-node timeline-event-card task-event-card status-${task.status}${presentation.unassigned ? ' is-unassigned' : ''}`}
      data-task-assignment={presentation.unassigned ? 'unassigned' : 'assigned'}
      data-task-status={task.status}
      style={ownerStyle}
      type="button"
      onClick={onOpen}
    >
      <span className="task-card-glyph" aria-hidden="true">
        <TaskTimelineStatusIcon status={task.status} unassigned={presentation.unassigned} />
      </span>
      <span className="task-card-copy">
        <span className="task-card-state-row">
          <span className="task-card-headline">{presentation.headline}</span>
          <span className="event-card-status">{taskStatusLabel(task.status)}</span>
        </span>
        <strong className="task-card-title">{task.title}</strong>
        <span className="task-card-meta">
          <span className={`task-card-owner${presentation.unassigned ? ' is-unassigned' : ''}`}>
            <i className="task-owner-mark" aria-hidden="true" />
            <span>负责人 · {assigneeName}</span>
          </span>
          <span>{acceptanceCriteriaLabel}</span>
          <time dateTime={task.updatedAt}>更新于 {messageClockTime(task.updatedAt)}</time>
        </span>
        <span className="task-card-note">
          <b>{presentation.noteLabel}</b>
          <span>{presentation.note}</span>
        </span>
      </span>
      <span className="task-card-chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
      </span>
      <span className="sr-only" id={descriptionId}>
        状态：{taskStatusLabel(task.status)}；负责人：{assigneeName}；{acceptanceCriteriaLabel}；
        {presentation.noteLabel}：{presentation.note}
      </span>
    </button>
  )
}

type ToolResultLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

interface ToolResultViewState {
  evidenceId: string | null
  status: ToolResultLoadStatus
  text: string
  error: string | null
}

function toolResultErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : ''
  return detail ? `读取完整结果失败：${detail}` : '读取完整结果失败：未知错误'
}

function handleToolResultKeyDown(
  event: ReactKeyboardEvent<HTMLPreElement>,
  summary: HTMLElement | null
): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    summary?.focus({ preventScroll: true })
    return
  }

  const result = event.currentTarget
  const lineHeight = Number.parseFloat(window.getComputedStyle(result).lineHeight) || 16
  const page = Math.max(lineHeight * 4, result.clientHeight * 0.85)
  let nextScrollTop: number | null = null
  switch (event.key) {
    case 'ArrowDown':
      nextScrollTop = result.scrollTop + lineHeight
      break
    case 'ArrowUp':
      nextScrollTop = result.scrollTop - lineHeight
      break
    case 'PageDown':
      nextScrollTop = result.scrollTop + page
      break
    case 'PageUp':
      nextScrollTop = result.scrollTop - page
      break
    case ' ':
      nextScrollTop = result.scrollTop + (event.shiftKey ? -page : page)
      break
    case 'Home':
      nextScrollTop = 0
      break
    case 'End':
      nextScrollTop = result.scrollHeight
      break
    default:
      return
  }
  event.preventDefault()
  const maximum = Math.max(0, result.scrollHeight - result.clientHeight)
  result.scrollTop = Math.min(maximum, Math.max(0, nextScrollTop))
}

function ToolCallDetail({
  campId,
  detail,
  completeEvidence,
  expanded,
  resultKey,
  title,
  summaryRef
}: {
  campId: string
  detail: string
  completeEvidence?: PresentableExecutionEvidence
  expanded: boolean
  resultKey: string
  title: string
  summaryRef: RefObject<HTMLElement | null>
}): JSX.Element {
  const evidenceId = completeEvidence?.id ?? null
  const [result, setResult] = useState<ToolResultViewState>(() => ({
    evidenceId,
    status: evidenceId ? 'idle' : 'ready',
    text: evidenceId ? '' : detail,
    error: null
  }))
  const requestSequence = useRef(0)
  const previousEvidenceId = useRef(evidenceId)
  const restoreFocusAfterLoad = useRef(false)
  const resultRef = useRef<HTMLPreElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const scrollHelpId = useId()

  useEffect(() => {
    if (previousEvidenceId.current === evidenceId) return
    previousEvidenceId.current = evidenceId
    requestSequence.current += 1
    restoreFocusAfterLoad.current = false
    setResult({
      evidenceId,
      status: evidenceId ? 'idle' : 'ready',
      text: evidenceId ? '' : detail,
      error: null
    })
  }, [detail, evidenceId])

  useEffect(() => {
    if (evidenceId !== null) return
    setResult((current) => current.text === detail && current.status === 'ready'
      ? current
      : { evidenceId: null, status: 'ready', text: detail, error: null })
  }, [detail, evidenceId])

  useEffect(() => () => {
    requestSequence.current += 1
  }, [])

  const loadCompleteResult = useCallback(async (restoreFocus: boolean): Promise<void> => {
    if (!completeEvidence) return
    const sequence = ++requestSequence.current
    restoreFocusAfterLoad.current = restoreFocus
    setResult({
      evidenceId: completeEvidence.id,
      status: 'loading',
      text: '',
      error: null
    })
    try {
      const response = await window.rovai.request<{ payload: unknown }>(
        'agentRunEvidence.getContent',
        { campId, evidenceId: completeEvidence.id }
      )
      const fullText = executionEvidenceResultText(
        completeEvidence.eventType,
        response.payload
      )
      if (fullText === null) {
        throw new Error('证据中没有可展示的公开结果')
      }
      if (requestSequence.current !== sequence) return
      setResult({
        evidenceId: completeEvidence.id,
        status: 'ready',
        text: fullText,
        error: null
      })
    } catch (error) {
      if (requestSequence.current !== sequence) return
      setResult({
        evidenceId: completeEvidence.id,
        status: 'failed',
        text: '',
        error: toolResultErrorMessage(error)
      })
    }
  }, [campId, completeEvidence])

  useEffect(() => {
    if (
      expanded
      && completeEvidence
      && result.evidenceId === completeEvidence.id
      && result.status === 'idle'
    ) {
      void loadCompleteResult(false)
    }
  }, [completeEvidence, expanded, loadCompleteResult, result.evidenceId, result.status])

  useLayoutEffect(() => {
    if (!restoreFocusAfterLoad.current) return undefined
    const target = result.status === 'ready'
      ? resultRef.current
      : result.status === 'failed'
        ? retryRef.current
        : null
    if (!target) return undefined
    restoreFocusAfterLoad.current = false
    const frame = window.requestAnimationFrame(() => target.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [result.status])

  return (
    <div className="tool-call-detail" aria-busy={result.status === 'loading'}>
      {result.status === 'ready' && (
        <>
          <span className="sr-only" id={scrollHelpId}>
            结果区域获得焦点后，可使用方向键、Page Up、Page Down、空格、Home 和 End 滚动；按 Escape 返回对应指令行。
          </span>
          <pre
            ref={resultRef}
            className="tool-call-result-scroll"
            data-tool-result-key={resultKey}
            tabIndex={0}
            role="region"
            aria-label={`${title}的完整结果，可滚动`}
            aria-describedby={scrollHelpId}
            onKeyDown={(event) => handleToolResultKeyDown(event, summaryRef.current)}
          >
            {result.text}
          </pre>
        </>
      )}
      {result.status === 'idle' && (
        <div className="tool-result-state" role="status">
          <span>展开后读取完整结果。</span>
        </div>
      )}
      {result.status === 'loading' && (
        <div className="tool-result-state" role="status" aria-live="polite">
          <span className="tool-result-spinner" aria-hidden="true" />
          <span>正在读取完整结果…</span>
        </div>
      )}
      {result.status === 'failed' && (
        <div className="tool-result-state is-error" role="alert">
          <span className="tool-result-state-copy">
            <strong>未能读取完整结果</strong>
            <span>{result.error}</span>
          </span>
          <button
            ref={retryRef}
            className="quiet-button compact tool-result-retry"
            type="button"
            onClick={() => void loadCompleteResult(true)}
          >
            重试
          </button>
        </div>
      )}
    </div>
  )
}

type ToolCallStep = Extract<LiveExecutionProgress['items'][number], { kind: 'tool' }>['step']

function ToolCallRow({
  campId,
  step,
  runId,
  runStatus,
  completeEvidence
}: {
  campId: string
  step: ToolCallStep
  runId: string
  runStatus: AgentRunView['status']
  completeEvidence?: PresentableExecutionEvidence
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLElement>(null)
  const status = activityStatusForAgentRun(step.status, runStatus)
  const hasDetail = Boolean(step.detail)
  const summary = (
    <>
      <ToolCallIcon activityDomain={step.activityDomain} />
      <span className="tool-call-title">{step.title}</span>
      <ToolCallState status={status} />
      <span
        className={`tool-call-disclosure-slot${hasDetail ? '' : ' is-placeholder'}`}
        aria-hidden="true"
      >
        {hasDetail && (
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
          </svg>
        )}
      </span>
    </>
  )

  if (!hasDetail) {
    return (
      <div
        className={`process-action tool-call-summary tool-call-static status-${status}`}
        data-activity-domain={step.activityDomain}
      >
        {summary}
      </div>
    )
  }

  return (
    <details
      className={`process-action tool-call-disclosure status-${status}`}
      data-activity-domain={step.activityDomain}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary ref={summaryRef} className="tool-call-summary">{summary}</summary>
      <ToolCallDetail
        campId={campId}
        detail={step.detail}
        completeEvidence={completeEvidence}
        expanded={expanded}
        resultKey={`${runId}:${step.id}`}
        title={step.title}
        summaryRef={summaryRef}
      />
    </details>
  )
}

export function RunExecutionDisclosure({
  run,
  progress,
  campId,
  truncatedEvidence = [],
  loadedEvidenceCount = 0,
  finalBody = null,
  cancelling = false,
  focused = false,
  onResolveRecoveryBlocker,
  resolvingRecoveryBlocker = false
}: {
  run: AgentRunView
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
  loadedEvidenceCount?: number
  finalBody?: string | null
  cancelling?: boolean
  focused?: boolean
  onResolveRecoveryBlocker?(run: AgentRunView): Promise<void>
  resolvingRecoveryBlocker?: boolean
}): JSX.Element | null {
  const nonTerminal = NON_TERMINAL_RUNS.has(run.status)
  const active = executionDisclosureIsLiveOpen(run.status, focused, cancelling)
  const cancellingActive = nonTerminal && cancelling && focused
  const publicFailure = run.status === 'failed' ? run.failure : null
  const hasPublicFailure = publicFailure !== null
  const [open, setOpen] = useState(active || hasPublicFailure)
  const [historicalEvidence, setHistoricalEvidence] = useState<AgentRunExecutionEvidenceView[] | null>(null)
  const [historyStatus, setHistoryStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  useEffect(() => {
    setOpen((currentOpen) => executionDisclosureOpenAfterActivity(
      currentOpen,
      active || cancellingActive || hasPublicFailure
    ))
  }, [active, cancellingActive, hasPublicFailure])

  const durableEvidenceCount = Math.max(0, run.executionEvidenceCount)
  const historyNeeded = !nonTerminal && loadedEvidenceCount < durableEvidenceCount
  const historicalProgress = useMemo(() => historicalEvidence
    ? buildLiveExecutionProgress(
        historicalEvidence.map(liveRuntimeEventFromExecutionEvidence),
        run.id
      )
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
  const hasProgress = processItems.length > 0
  const showUnsettledWarning = agentRunShowsUnsettledWarning(run)
  if (!nonTerminal && durableEvidenceCount === 0 && !hasProgress && truncatedEvidence.length === 0 && !showUnsettledWarning && !hasPublicFailure) {
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

  const content = (
    <div className="process-content">
      {publicFailure && <RuntimeFailureNotice failure={publicFailure} />}
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
          <ToolCallRow
            key={item.key}
            campId={campId}
            step={step}
            runId={run.id}
            runStatus={run.status}
            completeEvidence={fullEvidence}
          />
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
      {nonTerminal && !cancelling && run.waitReason === 'recovery_blocked' && (
        <div className="process-recovery-blocker" role="status">
          <div>
            <strong>无法安全自动恢复</strong>
            <p>
              Agent 运行时已接受该任务，但 Rovai AI 重启后无法确认原任务的最终结果。
              为避免重复执行，原请求不会自动重发。请先检查当前工作区，再结束此运行并按需发送新的后续任务。
            </p>
          </div>
          <button
            className="quiet-button compact"
            type="button"
            disabled={resolvingRecoveryBlocker}
            onClick={() => void onResolveRecoveryBlocker?.(run)}
          >
            {resolvingRecoveryBlocker ? '正在结束…' : '结束此运行'}
          </button>
        </div>
      )}
      {nonTerminal && !cancelling && run.waitReason !== 'recovery_blocked' && (
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

const TOOL_ICON_DOMAINS = new Set([
  'shell',
  'file',
  'git',
  'network',
  'permission',
  'runtime',
  'plan',
  'tool'
])

function ToolCallIcon({ activityDomain }: { activityDomain: string }): JSX.Element {
  const domain = TOOL_ICON_DOMAINS.has(activityDomain) ? activityDomain : 'unknown'
  const icon = ({
    shell: (
      <>
        <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2" />
        <path d="M4.25 6 6.1 7.8 4.25 9.6M8 10h3.2" />
      </>
    ),
    file: (
      <>
        <path d="M4 1.75h5.1L12.5 5v9.25H4z" />
        <path d="M9 1.9V5h3.2M6 8h4.4M6 10.5h3.3" />
      </>
    ),
    git: (
      <>
        <circle cx="4" cy="3.25" r="1.35" />
        <circle cx="4" cy="12.75" r="1.35" />
        <circle cx="11.75" cy="7.2" r="1.35" />
        <path d="M4 4.6v6.8M4 6.1h2.2a3.2 3.2 0 0 1 3.2 3.2v.1M9.4 7.2h1" />
      </>
    ),
    network: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M2.5 8h11M8 2.25c1.45 1.55 2.15 3.45 2.15 5.75S9.45 12.2 8 13.75M8 2.25C6.55 3.8 5.85 5.7 5.85 8s.7 4.2 2.15 5.75" />
      </>
    ),
    permission: (
      <>
        <path d="M8 1.75 13 3.7v3.75c0 3.15-1.9 5.25-5 6.8-3.1-1.55-5-3.65-5-6.8V3.7z" />
        <path d="M8 5v3.5M8 11h.01" />
      </>
    ),
    runtime: (
      <>
        <rect x="3.15" y="3.15" width="9.7" height="9.7" rx="1.45" />
        <rect x="5.5" y="5.5" width="5" height="5" rx=".75" />
        <path d="M5.25 1.5v1.65M8 1.5v1.65M10.75 1.5v1.65M5.25 12.85v1.65M8 12.85v1.65M10.75 12.85v1.65M1.5 5.25h1.65M1.5 8h1.65M1.5 10.75h1.65M12.85 5.25h1.65M12.85 8h1.65M12.85 10.75h1.65" />
      </>
    ),
    plan: (
      <>
        <rect x="3" y="1.75" width="10" height="12.5" rx="1.6" />
        <path d="m5.2 5.2.75.75L7.35 4.5M8.6 5.25h2M5.2 9.1l.75.75 1.4-1.45M8.6 9.15h2" />
      </>
    ),
    tool: (
      <>
        <path d="M9.65 2.35a3.15 3.15 0 0 0-3.2 3.85L2.8 9.85a1.85 1.85 0 0 0 2.62 2.62l3.65-3.65a3.15 3.15 0 0 0 3.85-3.2L10.8 7.74l-2.5-.45-.45-2.5z" />
        <path d="M4.2 11.05h.01" />
      </>
    ),
    unknown: (
      <>
        <circle cx="8" cy="8" r="5.75" />
        <path d="M6.45 6.1a1.75 1.75 0 1 1 2.45 1.6c-.6.28-.9.72-.9 1.3M8 11.3h.01" />
      </>
    )
  } as Record<string, JSX.Element>)[domain]
  return (
    <span className="tool-call-icon" data-icon-domain={domain} aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">{icon}</svg>
    </span>
  )
}

function ToolCallState({ status }: { status: string }): JSX.Element {
  const label = toolCallStatusLabel(status)
  return (
    <span
      className={`tool-call-state status-${status}`}
      role="img"
      aria-label={label}
      title={label}
    />
  )
}

function toolCallStatusLabel(status: string): string {
  return ({
    running: '执行中',
    completed: '成功',
    failed: '失败',
    waiting: '等待审批',
    stopped: '已停止',
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
    'trae-cn-cli': 'TRAE CLI（中国企业版）',
    'antigravity-app': 'Antigravity'
  } as Record<string, string>)[kind] ?? kind
}

export type MemberRuntimeConfigurationPresentation = {
  model: string
  effort: { label: '推理强度' | '思考强度'; value: string } | null
  strategy: '固定模型' | '跟随 Agent 运行时默认'
  summary: string
}

export function memberRuntimeConfigurationPresentation(
  configuration: NonNullable<AgentProfile['runtimeConfiguration']>,
  installation: AdapterInstallation | null
): MemberRuntimeConfigurationPresentation {
  const modelSelection = configuration.model
  if (modelSelection.mode === 'runtime_default') {
    return {
      model: 'Agent 运行时默认',
      effort: null,
      strategy: '跟随 Agent 运行时默认',
      summary: 'Agent 运行时默认'
    }
  }

  const modelDescriptor = installation?.snapshot?.models.find(
    (model) => model.id === modelSelection.modelId
  ) ?? null
  const model = modelDescriptor?.displayName.trim() || modelSelection.modelId
  const effortKey = configuration.adapterKind === 'claude-code-cli'
    ? 'effort'
    : 'reasoning_effort'
  const effortDescriptor = modelDescriptor?.options.find((option) => option.key === effortKey) ?? null
  const rawEffort = modelSelection.options[effortKey]
  const effort = effortDescriptor || typeof rawEffort === 'string'
    ? {
        label: configuration.adapterKind === 'claude-code-cli'
          ? '思考强度' as const
          : '推理强度' as const,
        value: typeof rawEffort === 'string' && rawEffort
          ? runtimeEffortValueLabel(rawEffort, effortDescriptor?.values ?? [])
          : '跟随模型默认值'
      }
    : null

  return {
    model,
    effort,
    strategy: '固定模型',
    summary: effort ? `${model} · ${effort.label} ${effort.value}` : model
  }
}

function runtimeEffortValueLabel(
  value: string,
  choices: Array<{ value: string; label: string }>
): string {
  const commonLabels: Record<string, string> = {
    minimal: '最低',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '极高',
    max: '最高'
  }
  return commonLabels[value] ?? choices.find((choice) => choice.value === value)?.label ?? value
}

export function executionDrawerTitle(
  displayName: string,
  runtimeAdapterKind: string | null
): string {
  return runtimeAdapterKind
    ? `${displayName} ${runtimeAdapterLabel(runtimeAdapterKind)}`
    : displayName
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

export function TaskPanel({
  snapshot,
  coverage = null,
  busy,
  focusTaskId = null,
  focusRequest = 0,
  onTasksChanged,
  onOpenAgent = () => {},
  onCreateModeChange
}: {
  snapshot: CampSnapshot
  coverage?: CampOpenCollectionCoverage | null
  busy: boolean
  focusTaskId?: string | null
  focusRequest?: number
  onTasksChanged(): Promise<void>
  onOpenAgent?(agentId: string, trigger?: HTMLButtonElement): void
  onCreateModeChange?(active: boolean): void
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

  useEffect(() => {
    onCreateModeChange?.(mode === 'create')
    return () => onCreateModeChange?.(false)
  }, [mode, onCreateModeChange])

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
      setFormError('这项任务当前不可见，无法打开详情。')
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
      setFormError('进行中或已阻塞的任务必须有负责人。')
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
          setFormError('这项任务已被其他操作更新。当前版本已刷新，你的草稿仍保留；确认后可再次提交。')
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
      <div className="task-action-row">
        <button
          className={mode === 'list' ? 'task-action-button' : 'task-action-button is-back'}
          type="button"
          onClick={mode === 'list' ? beginCreate : resetForm}
          disabled={mode === 'list' ? busy : submitting}
        >
          <span aria-hidden="true">{mode === 'list' ? '＋' : '←'}</span>
          <strong>{mode === 'list' ? '新建任务' : '返回任务列表'}</strong>
        </button>
      </div>

      {mode === 'create' && (
        <form className="task-editor" onSubmit={(event) => void submitCreate(event)}>
          <div className="task-editor-heading"><strong>新建任务</strong><span>初始状态为待处理</span></div>
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
            autoFocusTitle
            onTitle={setTitle}
            onDescription={setDescription}
            onAcceptanceCriteria={setAcceptanceCriteriaText}
            onAssignee={setAssigneeAgentId}
            onStatus={setStatus}
          />
          {formError && <p className="task-form-error" role="alert">{formError}</p>}
          <button className="primary-button task-submit" type="submit" disabled={!title.trim() || submitting || busy}>{submitting ? '正在保存…' : '创建任务'}</button>
        </form>
      )}

      {mode === 'edit' && selectedTask && (
        <form className="task-editor" onSubmit={(event) => void submitUpdate(event)}>
          <div className="task-editor-heading"><strong>{terminal ? '任务详情' : '编辑任务'}</strong><span>版本 {expectedVersion}</span></div>
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
            ? <p className="task-terminal-note">已结束的任务保留为只读记录，不能重新打开或删除。</p>
            : <>
                <button className="primary-button task-submit" type="submit" disabled={!title.trim() || submitting || busy}>{submitting ? '正在保存…' : '保存修改'}</button>
                <div className="task-cancel-zone">
                  <strong>取消任务</strong>
                  <p>取消任务不会取消已经接受或正在运行的执行。</p>
                  <label className="task-field"><span>取消原因</span><textarea value={cancelReason} rows={2} maxLength={4000} disabled={submitting || busy} onChange={(event) => setCancelReason(event.currentTarget.value)} /></label>
                  <button className="danger-button" type="button" disabled={!cancelReason.trim() || submitting || busy} onClick={() => void submitCancel()}>确认取消任务</button>
                </div>
              </>}
        </form>
      )}

      {mode === 'list' && (
        <div className="task-list">
          {coverage && !coverage.complete && (
            <p className="task-history-note" role="status">
              当前显示 {coverage.loadedCount} / {coverage.totalCount} 个任务；更早的已结束任务尚未载入。
            </p>
          )}
          {snapshot.tasks.map((task) => (
            <button className="task-list-row" type="button" key={task.taskId} onClick={() => beginEdit(task)}>
              <span className={`task-state-dot state-${task.status}`} aria-hidden="true" />
              <span className="task-list-copy"><strong>{task.title}</strong><small>{taskListPreview(task) || '没有补充说明'}</small></span>
              <span className="task-list-meta"><b>{taskStatusLabel(task.status)}</b><small>{taskAssigneeName(task, snapshot)} · {task.acceptanceCriteria.length} 个验收条件</small></span>
            </button>
          ))}
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
  autoFocusTitle = false,
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
  autoFocusTitle?: boolean
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
      <label className="task-field"><span>标题</span><input value={title} maxLength={160} required autoFocus={autoFocusTitle} disabled={disabled} onChange={(event) => onTitle(event.currentTarget.value)} /></label>
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
    <section className="task-detail-section" aria-label="任务审计信息">
      <strong>责任与审计</strong>
      <dl className="task-detail-grid">
        <div><dt>创建者</dt><dd>{task.createdByType} · {task.createdById}</dd></div>
        <div><dt>来源执行</dt><dd>{task.sourceAgentRunId ?? '无'}</dd></div>
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
      <p>{runs.length} 个执行 · {deliveries.length} 个消息投递</p>
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
    'task.terminal': '已完成或已取消的任务不能再修改。',
    'task.assignee_unavailable': '所选负责人已不在当前会话，或当前不可用。',
    'task.invalid_status_transition': '当前任务状态不允许这样变更。',
    'task.version_conflict': '任务已被其他操作更新，请刷新后重试。'
  }
  return messages[result.code] ?? `修改未完成：${result.code}`
}

function shortIdentity(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}
