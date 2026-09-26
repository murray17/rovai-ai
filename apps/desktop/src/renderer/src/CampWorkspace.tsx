import { CopyIcon } from './CopyIcon'
import { newCommandId } from '../../shared/command-id'
import { useMobileLayout } from './MobileLayout'
import { useCampClient, useEditingRecovery, type CampClient } from './camp-client'
import { useExecutionDisclosureAnchor } from './useExecutionDisclosureAnchor'
import { RunningText } from './RunningText'
import { ExecutionContentContext, ExecutionVirtualList } from './ExecutionVirtualList'
import { ExecutionNarration } from './ExecutionNarration'
import type { MessageQuoteSnapshot } from '@contracts'
import { revealMessageQuote } from './message-quote-reveal'
import { MessageQuotes, MessageQuoteSelectionToolbar } from './MessageQuotes'
import { dismissMessageQuoteSelection } from './message-quote-selection'
import { currentUserDisplayName } from '@contracts'
import { CurrentUserAvatar, useCurrentUserProfile } from './CurrentUserProfile'
import { markdownInlineContentPrefix } from './safe-markdown-model'
import { ExecutionLatestContext, ExecutionReadingContext, useExecutionWindow } from './useExecutionWindow'
import { ReturnToLatest } from './ReturnToLatest'
import { prefersReducedMotion } from './reduced-motion'
import { isFileFindTarget, useOptionalFileFind } from './FilePreviewFind'
import { readErrorMessage } from './error-message'
import { collapsedMessageProjection } from './conversation-message-collapse'
import { samePublicMessageSegment } from './public-message-grouping'
import { usePublicMessageLayout } from './usePublicMessageLayout'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type FormEvent, type JSX, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import { CampDetailPopover } from './CampDetailPopover'
import { SingleChatPanel } from './SingleChatPanel'
import {
  CompactionEventRow, ExecutionToolGroupStateContext, FileOperationRow, ModifiedFileRow, RuntimeRetryNotice,
  ToolActivityGroup, ToolCallRow, selectCompletePresentableExecutionEvidence, type ToolCallStep
} from './ExecutionToolGroup'
import { executionInitialFeedback, executionRunSummary } from './execution-run-summary'
import { ComposerPrimaryAction } from './ComposerPrimaryAction'
import { CampMemberFastToggle } from './CampMemberFastToggle'
import { useCampMemberFast, type CampMemberFastControls } from './useCampMemberFast'
import type {
  ActionApprovalView,
  AdapterInstallation,
  AgentProfile,
  AgentRunFileChangesView,
  AgentRunImagesView,
  AgentRunExecutionEvidencePage,
  AgentRunExecutionEvidenceView,
  AgentRunView,
  BuiltinMemberAvatarRole,
  CampComposerDraftView,
  ComposerDocument,
  CampComposerReplyRecipient,
  CampMessageAttachmentView,
  CampMessageAroundSnapshot,
  CampMessageFindSnapshot,
  CampMessageView,
  CampMemberRemovalPreview,
  CampOpenCollectionCoverage,
  CampOpenMessageCoverage,
  CampOpenProjection,
  CampSnapshot,
  ExecutionConsolePlacement,
  MessageDeliveryView,
  TaskStatus,
  TaskView,
  NavigationCampItem,
  ComposerSkillCandidates,
  StoredCommandResult,
  StructuredCampMessageContent
} from '@contracts'
import { EmptyInline } from './ui-elements'
import { NavigationIcon } from './NavigationIcon'
import { isNewConversationMemberAvailable } from './new-conversation-availability'
import {
  StructuredMentionComposer,
  type StructuredMentionComposerHandle
} from './StructuredMentionComposer'
import {
  composerDocumentsEqualDirect,
  composerDocumentFromText,
  emptyComposerDocument,
  type ComposerLocalStatus
} from './composer-document'
import {
  composerBodyForContent,
  emptyLocalCampComposerDraft,
  loadLocalCampComposerDraft,
  materializeLocalContinuation,
  nextLocalCampComposerDraftAfterSend,
  saveLocalCampComposerDraft
} from './camp-composer-local-store'
import {
  DraftMutationCoordinator,
  draftCoordinatorChangeRefreshesProjection,
  type DraftMutation
} from './draft-mutation-coordinator'
import { AttachmentCard, AttachmentPlaceholder, ComposerAttachmentStrip } from './AttachmentCard'
export { attachmentRevealLabel } from './AttachmentCard'
import {
  attachmentDragKind,
  dataTransferContainsFiles,
  droppedAttachmentInputs,
  type AttachmentDragKind,
  type AttachmentKind,
  type AttachmentPreparationInput
} from './attachment-drop'
export {
  attachmentDragKind,
  dataTransferContainsFiles,
  droppedAttachmentInputs
} from './attachment-drop'
import {
  agentRunPresentation,
  agentRunWaitDetail,
  buildLiveExecutionProgress,
  executionEvidenceResultText,
  liveRuntimeEventFromExecutionEvidence,
  type LiveExecutionProgress,
  type LiveRuntimeEvent,
  type RuntimeDiagnostic,
  localDayKey,
  messageClockTime,
  relativeTimeLabel,
  timelineDayLabel,
} from './ui-model'
import { MemberAvatar } from './MemberAvatar'
import { ImageGallery, partitionMessageAttachments, type GalleryImage } from './ImageGallery'
import { ExecutionAvatarRail } from './ExecutionAvatarRail'
import { ExecutionIcon, ExecutionOverviewMark } from './ExecutionIcons'
import { ExecutionStatusGlyph, type ExecutionStatusShape } from './ExecutionStatusGlyph'
import { AgentRunDeliveryRecipients } from './AgentRunDeliveryRecipients'
import { MemberPortrait } from './MemberPortrait'
import { localizeExecutionEngineTerms } from './product-copy'
import { formatCampTitle } from './camp-title'
import { writeClipboardText } from './clipboard'
import { runtimeReadinessLabel } from './runtime-status'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { SafeMarkdown } from './SafeMarkdown'
import { FilePreviewPane } from './FilePreviewPane'
import { FilePreviewResizeHandle, FilePreviewWorkspace, useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { useExecutionPreviewHost, useOptionalFilePreview } from './FilePreviewContext'
import {
  agentRunFileChangeHasReviewableDiff,
  agentRunFileChangesPreviewTarget,
  agentRunFileChangesSummaryLabel
} from './file-changes-presentation'
import { RunFileChangePath } from './RunFileChangePath'
import { openAgentRunCurrentFilePreview } from './agent-run-file-preview'
import { FileReferenceText, type FileReferenceActivation } from './FileReferenceLink'
import {
  captureTimelineReadingAnchor,
  restoreTimelineReadingAnchor,
  visibleTimelineMessageAnchor,
  type TimelineMessageAnchor,
  type TimelineReadingAnchor
} from './timeline-reading-anchor'
import { RuntimeFailureNotice } from './RuntimeFailureNotice'
import { identityColorToken } from './theme'
import { composerSkillsFromCandidates } from './composer-skill-picker'
import { createStructuredMessageClipboardData } from './structured-message-clipboard'
import { CampWorldMap } from './CampWorldMap'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogImpact,
  AppDialogImpactList
} from './AppDialog'
import { projectCampWorldMap } from './camp-world-map-model'
import {
  campTimelineContentChanged,
  campTimelineFollowingLatestAfterScroll,
  campTimelineIsNearBottom,
  followLatestCampTimeline,
  restoredCampTimelineScrollTop,
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
import {
  executionHasActiveCompaction,
  groupConsecutiveToolItems,
  toolActivityGroupHasActiveTool,
  type ToolProgressItem
} from './execution-tool-grouping'

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
const CAMP_HISTORY_AUTOLOAD_THRESHOLD_PX = 120
const CAMP_TIMELINE_READING_POSITION_LIMIT = 50
const campTimelineReadingPositions = new Map<string, CampTimelineReadingPosition>()

if (typeof window !== 'undefined') {
  try {
    window.localStorage.removeItem('rovai.camp-timeline-reading-positions.v2')
  } catch {
    // Legacy cleanup is best effort; reading positions now live only in Renderer memory.
  }
}

export function rememberedCampTimelineReadingPosition(
  campId: string
): CampTimelineReadingPosition | null {
  const position = campTimelineReadingPositions.get(campId)
  return position ? { ...position } : null
}

export function rememberCampTimelineReadingPosition(
  campId: string,
  position: CampTimelineReadingPosition
): void {
  campTimelineReadingPositions.delete(campId)
  campTimelineReadingPositions.set(campId, {
    scrollTop: Math.max(0, Number.isFinite(position.scrollTop) ? position.scrollTop : 0),
    followingLatest: position.followingLatest
  })

  while (campTimelineReadingPositions.size > CAMP_TIMELINE_READING_POSITION_LIMIT) {
    const oldestCampId = campTimelineReadingPositions.keys().next().value
    if (!oldestCampId) break
    campTimelineReadingPositions.delete(oldestCampId)
  }
}

export function campHistoryKeyboardInputMovesEarlier(
  key: string,
  shiftKey: boolean
): boolean {
  return key === 'ArrowUp'
    || key === 'PageUp'
    || key === 'Home'
    || (key === ' ' && shiftKey)
}

export function composerHasSendablePayload(
  message: string,
  hasReadyAttachment: boolean
): boolean {
  return message.trim().length > 0 || hasReadyAttachment
}

export function composerSendIsDisabled(input: {
  hasSendablePayload: boolean
  hasUnavailableMention: boolean
  replyRepairRequired: boolean
  continuationRepairRequired: boolean
  busy: boolean
  composerSubmitting: boolean
  routingMutating: boolean
  composerDraftAvailable: boolean
  preparingAttachmentCount: number
  failedAttachmentCount: number
}): boolean {
  return !input.hasSendablePayload
    || input.hasUnavailableMention
    || input.replyRepairRequired
    || input.continuationRepairRequired
    || input.busy
    || input.composerSubmitting
    || input.routingMutating
    || !input.composerDraftAvailable
    || input.preparingAttachmentCount > 0
    || input.failedAttachmentCount > 0
}

export type CampInspectorTab = 'tasks' | 'members'
export type CampConversationView = 'conversation' | 'world'
export interface FirstRunCampContext {
  memberAgentId: string
  memberRole: BuiltinMemberAvatarRole
}
export interface CampMemberAddOutcome {
  addedAgentIds: string[]
  unchangedAgentIds: string[]
  failures: Array<{ agentId: string; message: string }>
}
export interface CampMemberRemoveOutcome {
  status: 'removed' | 'conflict' | 'failed'
  message?: string
  reconciliationStatus?: 'reconciling' | 'settled'
}
type CampInspectorSurfaceTab = CampInspectorTab | 'execution'
export interface CampLeavePreparation {
  complete(didLeave: boolean): void
}
export type CampLeaveGuard = () => Promise<CampLeavePreparation>
type DraftLoadState =
  | { state: 'loading' }
  | { state: 'ready' }
  | { state: 'error'; error: Error }

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
  run: Pick<AgentRunView, 'status' | 'waitReason' | 'cancelRequestedAt' | 'campTurnId'>,
  turn: Pick<CampSnapshot['turns'][number], 'cancelRequestedAt'> | null
): boolean {
  return NON_TERMINAL_RUNS.has(run.status)
    && run.cancelRequestedAt === null
    && run.waitReason !== 'recovery_blocked'
    && (run.campTurnId === null || turn?.cancelRequestedAt === null)
}

export type AgentRunStopViewState =
  | 'available'
  | 'stopping'
  | 'confirming'
  | 'stopped'
  | 'hidden'

export function agentRunStopViewState(
  run: Pick<AgentRunView, 'status' | 'waitReason' | 'cancelRequestedAt' | 'campTurnId'>,
  turn: Pick<CampSnapshot['turns'][number], 'cancelRequestedAt'> | null,
  local: { cancelling: boolean; confirming: boolean; turnCancelling: boolean }
): AgentRunStopViewState {
  if (run.status === 'cancelled') return 'stopped'
  if (!NON_TERMINAL_RUNS.has(run.status)) return 'hidden'
  if (local.cancelling || local.turnCancelling) return 'stopping'
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

interface ConversationFindRestorePoint {
  campId: string
  scrollTop: number
  followingLatest: boolean
  anchor: TimelineMessageAnchor | null
}

function timelineViewportWidth(timeline: HTMLElement): number {
  // Preserve fractional transition widths while accounting for a non-overlay scrollbar.
  return timeline.getBoundingClientRect().width - (timeline.offsetWidth - timeline.clientWidth)
}

export function composerDraftNeedsReplyRepair(draft: CampComposerDraftView | null): boolean {
  const intent = draft?.replyIntent
  if (!intent) return false
  if (intent.targetState === 'message_unavailable' || intent.recipientSelectionRequired) return true
  const author = intent.author
  return author?.authorType === 'agent'
    && author.recipientAvailability === 'unavailable'
    && draft.content.segments.some((segment) =>
      segment.kind === 'atom'
        && segment.atom.type === 'member'
        && segment.atom.agentId === author.authorId
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

async function mutateComposerDraft(
  client: CampClient,
  draft: CampComposerDraftView,
  mutation: DraftMutation,
  snapshot: CampSnapshot
): Promise<CampComposerDraftView> {
  const update = (changes: Partial<CampComposerDraftView>): CampComposerDraftView => {
    const content = changes.content ?? draft.content
    return {
      ...draft,
      ...changes,
      body: changes.body ?? composerBodyForContent(content, snapshot.members),
      revision: draft.revision + 1,
      updatedAt: new Date().toISOString()
    }
  }
  const prependRecipient = (
    content: ComposerDocument,
    recipient: CampComposerReplyRecipient
  ): ComposerDocument => {
    const atom = recipient.kind === 'all_members'
      ? { type: 'all_members' as const }
      : { type: 'member' as const, agentId: recipient.agentId }
    const segments = [...content.segments]
    const first = segments[0]
    const alreadyFirst = first?.kind === 'atom'
      && first.atom.type === atom.type
      && (atom.type !== 'member' || (first.atom.type === 'member' && first.atom.agentId === atom.agentId))
    if (!alreadyFirst) segments.unshift({ kind: 'atom', atom }, { kind: 'text', text: ' ' })
    return { version: 2, segments }
  }
  switch (mutation.kind) {
    case 'return_pending_input':
      throw new Error('旧版待发送输入已停用。')
    case 'quote': {
      if (mutation.action.type === 'add') {
        const quote = await client.request<MessageQuoteSnapshot>('messageQuotes.capture', {
          campId: draft.campId,
          selection: mutation.action.selection
        })
        return update({ quotes: [...draft.quotes, quote] })
      }
      if (mutation.action.type === 'remove') {
        const quoteId = mutation.action.quoteId
        return update({ quotes: draft.quotes.filter((quote) => quote.quoteId !== quoteId) })
      }
      throw new Error('引用撤销仅在当前编辑操作中可用。')
    }
    case 'save_content':
      return update({ content: mutation.content })
    case 'add_source_attachment': {
      const attachment = await client.composerAttachments.prepare(
        draft.campId,
        draft.revision,
        mutation.file
      )
      return update({ attachments: [...draft.attachments, attachment] })
    }
    case 'remove_source_attachment':
      await client.composerAttachments.discard?.(draft.campId, [mutation.attachmentId])
        .catch(() => undefined)
      return update({ attachments: draft.attachments.filter(({ id }) => id !== mutation.attachmentId) })
    case 'start_reply': {
      const message = mutation.message
      if (message.withdrawn || message.id.startsWith('optimistic:')) {
        throw new Error('camp_message.invalid_reply')
      }
      const authorMember = message.authorType === 'agent'
        ? snapshot.members.find(({ agentId }) => agentId === message.authorId) ?? null
        : null
      const recipientAvailable = Boolean(authorMember
        && authorMember.membershipStatus === 'active'
        && authorMember.profilePresence === 'present')
      const content = recipientAvailable
        ? prependRecipient(draft.content, { kind: 'member', agentId: message.authorId })
        : draft.content
      return update({
        content,
        replyIntent: {
          replyToCampMessageId: message.id,
          targetState: 'available',
          author: {
            authorType: message.authorType === 'agent' ? 'agent' : message.authorType === 'user' ? 'user' : 'system',
            authorId: message.authorId,
            displayName: authorMember?.displayName ?? message.authorDisplayName ?? (message.authorType === 'user' ? '用户' : '系统'),
            recipientAvailability: message.authorType === 'agent'
              ? recipientAvailable ? 'available' : 'unavailable'
              : 'not_applicable'
          },
          excerpt: message.body.replace(/\s+/gu, ' ').slice(0, 160),
          recipientSelectionRequired: message.authorType === 'agent' && !recipientAvailable
        }
      })
    }
    case 'cancel_reply':
      return update({ replyIntent: null })
    case 'resolve_reply_recipient': {
      if (!draft.replyIntent) throw new Error('camp_message.invalid_reply')
      return update({
        content: prependRecipient(draft.content, mutation.recipient),
        replyIntent: { ...draft.replyIntent, recipientSelectionRequired: false }
      })
    }
    case 'dismiss_continuation':
      return update({ continuationIntent: null })
    case 'resolve_continuation_recipient':
      return update({
        content: prependRecipient(draft.content, { kind: 'member', agentId: mutation.agentId }),
        continuationIntent: null
      })
  }
}

function emptyLocalComposerDraft(campId: string): CampComposerDraftView {
  return emptyLocalCampComposerDraft(campId)
}

export function composerRecipientSummary(
  content: ComposerDocument,
  members: CampSnapshot['members']
): string | null {
  if (content.segments.some((segment) =>
    segment.kind === 'atom'
      && (segment.atom.type === 'member' || segment.atom.type === 'all_members')
  )) return null
  const defaultLead = members.find((member) => member.isDefaultLead)
  return defaultLead ? `默认由队长 @${defaultLead.displayName} 接收` : '默认队长当前不可用'
}

export function campConversationViewFromStoredValue(value: string | null): CampConversationView {
  return value === 'conversation' ? 'conversation' : 'world'
}

export function initialCampConversationView(
  storedValue: string | null,
  showingFirstRunWelcome: boolean,
  worldMapEnabled = true
): CampConversationView {
  return showingFirstRunWelcome || !worldMapEnabled
    ? 'conversation'
    : campConversationViewFromStoredValue(storedValue)
}

export type AgentExecutionProcess = {
  agentId: string
  runs: AgentRunView[]
  waitingDeliveries: MessageDeliveryView[]
}

const EXECUTION_OVERVIEW_SCOPE = '__execution_overview__'

export function agentRunCountsAsExecuting(run: Pick<AgentRunView, 'status' | 'waitReason'>): boolean {
  return NON_TERMINAL_RUNS.has(run.status)
    && run.waitReason !== 'recovery_blocked'
    && run.waitReason !== 'network_recovery_blocked'
}

export type CampMessageSendReceipt = {
  campMessageId?: string
  publishedMessageSequence?: number
  deliveryIds: string[]
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

export function runningAgentRunForWorkspaceEntry(
  runs: readonly AgentRunView[]
): AgentRunView | null {
  return runs
    .filter((run) => run.status === 'running')
    .sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )[0] ?? null
}

export function executionWorkspaceEntrySelection(
  runs: readonly AgentRunView[]
): { selectedAgentId: string; focusedRun: AgentRunView } | null {
  const focusedRun = runningAgentRunForWorkspaceEntry(runs)
  return focusedRun
    ? { selectedAgentId: EXECUTION_OVERVIEW_SCOPE, focusedRun }
    : null
}

export function messageDeliveryWaitsInExecutionQueue(delivery: MessageDeliveryView): boolean {
  if (delivery.deliveryKind !== 'public_a2a'
    || delivery.dispatchDisposition !== 'dispatch'
    || delivery.targetAgentRunId !== null) return false
  if (delivery.status === 'waiting') return true
  return delivery.status === 'pending'
    && (delivery.dispatchPhase === 'never_attempted' || delivery.dispatchPhase === 'attempted_waiting')
}

export function agentExecutionProcesses(
  runs: AgentRunView[],
  deliveries: readonly MessageDeliveryView[] = []
): AgentExecutionProcess[] {
  const grouped = new Map<string, AgentExecutionProcess>()
  for (const run of runs) {
    const process = grouped.get(run.agentId) ?? {
      agentId: run.agentId,
      runs: [],
      waitingDeliveries: []
    }
    process.runs.push(run)
    grouped.set(run.agentId, process)
  }
  for (const delivery of deliveries) {
    if (!messageDeliveryWaitsInExecutionQueue(delivery)) continue
    const process = grouped.get(delivery.recipientAgentId) ?? {
      agentId: delivery.recipientAgentId,
      runs: [],
      waitingDeliveries: []
    }
    process.waitingDeliveries.push(delivery)
    grouped.set(delivery.recipientAgentId, process)
  }
  return [...grouped.values()]
    .map((process) => ({
      ...process,
      runs: process.runs.slice().sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      ),
      waitingDeliveries: process.waitingDeliveries.slice().sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      )
    }))
    .sort((left, right) => {
      const leftLatest = [left.runs.at(-1)?.createdAt, left.waitingDeliveries.at(-1)?.createdAt]
        .filter((value): value is string => Boolean(value)).sort().at(-1) ?? ''
      const rightLatest = [right.runs.at(-1)?.createdAt, right.waitingDeliveries.at(-1)?.createdAt]
        .filter((value): value is string => Boolean(value)).sort().at(-1) ?? ''
      return rightLatest.localeCompare(leftLatest)
        || left.agentId.localeCompare(right.agentId)
    })
}

export function runningCampMembers(
  runs: readonly Pick<AgentRunView, 'agentId' | 'status' | 'cancelRequestedAt'>[],
  members: readonly CampSnapshot['members'][number][]
): CampSnapshot['members'] {
  const runningIds = new Set(runs.filter(run => run.status === 'running' && !run.cancelRequestedAt).map(run => run.agentId))
  return members.filter(member => runningIds.has(member.agentId))
    .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId))
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

export function groupExecutionEventsByRunId(
  runs: readonly Pick<AgentRunView, 'id'>[],
  executionEvidence: readonly AgentRunExecutionEvidenceView[],
  liveRuntimeEvents: readonly LiveRuntimeEvent[]
): Map<string, LiveRuntimeEvent[]> {
  const currentRunIds = new Set(runs.map((run) => run.id))
  const grouped = new Map<string, Map<string, LiveRuntimeEvent>>()
  const blockState = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

  const append = (event: LiveRuntimeEvent, authoritative: boolean): void => {
    if (!currentRunIds.has(event.agentRunId)) return

    let eventsById = grouped.get(event.agentRunId)
    if (!eventsById) {
      eventsById = new Map<string, LiveRuntimeEvent>()
      grouped.set(event.agentRunId, eventsById)
    }

    const previous = eventsById.get(event.id)
    const previousRevision = previous?.revision ?? 0
    const incomingRevision = event.revision ?? 0
    const previousChange = previous?.changeSequence ?? 0
    const incomingChange = event.changeSequence ?? 0
    const newer = Boolean(previous) && (incomingRevision > previousRevision
      || (incomingRevision === previousRevision && incomingChange > previousChange))
    const older = Boolean(previous) && (incomingRevision < previousRevision
      || (incomingRevision === previousRevision && incomingChange < previousChange))
    const blockUpdate = event.eventType === 'agent.text.block' && previous
      && (blockState(previous.payload).status === 'streaming')
      && (blockState(event.payload).status !== 'streaming'
        || Number(blockState(event.payload).textLength) >= Number(blockState(previous.payload).textLength))
    if (!previous || newer || blockUpdate || (authoritative && !older)) {
      eventsById.set(event.id, event)
    }
  }

  for (const evidence of executionEvidence) {
    append(liveRuntimeEventFromExecutionEvidence(evidence), true)
  }
  for (const event of liveRuntimeEvents) {
    append(event, false)
  }

  return new Map([...grouped.entries()].map(([runId, eventsById]) => {
    const events = [...eventsById.values()]
    events.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    return [runId, events]
  }))
}

export function firstSubmittedAgentRun(
  receipt: CampMessageSendReceipt,
  runs: readonly AgentRunView[]
): AgentRunView | null {
  const runById = new Map(runs.map((run) => [run.id, run]))
  for (const runId of receipt.agentRunIds) {
    const run = runById.get(runId)
    if (run) return run
  }
  if (receipt.campMessageId) {
    const batchRun = runs.find((run) => run.inputMessageIds?.includes(receipt.campMessageId!))
    if (batchRun) return batchRun
  }
  return null
}

export function isViewingNonTerminalAgentRun(
  selectedAgentId: string | null,
  focusedRunId: string | null,
  runs: readonly AgentRunView[]
): boolean {
  if (selectedAgentId === EXECUTION_OVERVIEW_SCOPE) {
    return runs.some((run) => NON_TERMINAL_RUNS.has(run.status))
  }
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
  inspectorSurfaceTab: CampInspectorSurfaceTab,
  rightVisible = false
): boolean {
  if (placement === 'bottom') return true
  if (placement === 'right') return rightVisible
  return inspectorVisible && inspectorSurfaceTab === 'execution'
}

export function executionPlacementChangeShouldStart(
  current: ExecutionConsolePlacement,
  target: ExecutionConsolePlacement,
  pending: boolean
): boolean {
  return !pending && current !== target
}

export function executionPlacementSaveFailureMessage(
  current: ExecutionConsolePlacement
): string {
  if (current === 'bottom') return '未能保存，仍在底部。'
  if (current === 'right') return '未能保存，仍在右侧。'
  return '未能保存，仍在详情浮层。'
}

export function attachmentDropIsBlocked({
  mentionPopoverPresent
}: {
  executionDrawerPresent: boolean
  mentionPopoverPresent: boolean
}): boolean {
  return mentionPopoverPresent
}

export function agentRunTerminalNote(
  run: Pick<AgentRunView, 'terminalReasonCode'>
): string | null {
  if (run.terminalReasonCode === 'planned_shutdown_cancelled') {
    return '因 Rovai 计划关闭，执行引擎已确认取消本次执行。'
  }
  if (run.terminalReasonCode === 'runtime_interrupted') {
    return '执行连续性已中断，最终结果无法确认；本次执行未被记为已取消。'
  }
  return null
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

function scrollExecutionDrawerToLatest(body: HTMLElement): void {
  body.scrollTop = body.scrollHeight
}
export type NotificationFocusTarget = {
  requestId: number
  conversationId?: string
  agentRunId?: string
  kind: 'approval' | 'camp_turn' | 'agent_run' | 'camp_message' | 'single_chat' | 'mission' | 'task'
  subjectId?: string
  campTurnId: string | null
  messageId?: string
  approvalId?: string
  active?: boolean
}
export type VisibleNotificationSources = {
  campId: string
  conversationId?: string | null
  surfaceVisible?: boolean
  snapshotSequence: number
  messageIds: string[]
  campTurnIds: string[]
  agentRunIds: string[]
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
    | { kind: 'current_user' }
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

export interface FirstRunCampStarter {
  title: string
  body: string
  prompt: string
}

export function firstRunCampStarters(): FirstRunCampStarter[] {
  return [
    {
      title: '创建一位新队员',
      body: '从身份、职责和工作方式开始。',
      prompt: '我想创建一个新的队员，请用 member-studio 帮我开始。'
    },
    {
      title: '创建一个定时任务',
      body: '日报、巡检，让队员按时完成。',
      prompt: '我想创建一个定时任务，让你定期帮我处理一件事。请先问我想做什么、多久执行一次、在什么时间执行，再根据我的回答帮我创建。'
    },
    {
      title: '做一个实用小工具',
      body: '番茄钟、倒计时，或你自己的点子。',
      prompt: '帮我做一个能直接预览的小工具网页，比如番茄钟或倒计时。先问我想做哪一种、需要什么功能，再用一个独立 HTML 文件做出第一版。'
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
    let previousSequence = afterSequence
    for (const item of page.evidence) {
      if (item.agentRunId !== agentRunId || item.sequence <= previousSequence
        || item.sequence > throughSequence) {
        throw new Error('Execution Evidence page order is incompatible')
      }
      previousSequence = item.sequence
    }
    if (page.nextAfterSequence !== (page.evidence.at(-1)?.sequence ?? throughSequence)) {
      throw new Error('Execution Evidence page cursor is incompatible')
    }
    evidence.push(...page.evidence)
    if (!page.hasMore) break
    if (page.nextAfterSequence <= afterSequence) {
      throw new Error('Execution Evidence page did not advance')
    }
    afterSequence = page.nextAfterSequence
  }
  // Sequence is a stable timeline position, not a row count (offline aggregation leaves gaps).
  if (throughSequence !== null && (evidence.at(-1)?.sequence ?? 0) !== throughSequence) {
    throw new Error('Execution Evidence history is incomplete')
  }
  return evidence
}

export async function loadExecutionNarrationBodies(
  evidence: AgentRunExecutionEvidenceView[],
  requestContent: (evidenceId: string) => Promise<{ payload: unknown }>
): Promise<Map<string, string>> {
  const bodies = new Map<string, string>()
  // Only hydrate displayed narration. Tool results keep their existing expand-to-load path;
  // hidden reasoning is neither requested nor exposed by this adapter.
  for (const item of evidence) {
    if (item.eventType !== 'agent.text.block' || !item.isTruncated || !item.contentBlobId) continue
    const response = await requestContent(item.id)
    const text = executionEvidenceResultText(item.eventType, response.payload)
    if (text === null) throw new Error('Execution narration content is unavailable')
    bodies.set(`narration:${item.id}`, text)
  }
  return bodies
}

export type CampConversationTimelineItem =
  | {
      kind: 'task_card'
      id: string
      createdAt: string
      task: TaskView
    }
  | {
      kind: 'camp_message'
      id: string
      createdAt: string
      message: CampMessageView
      runtimeImageGroups: AgentRunImagesView[]
    }
  | {
      kind: 'run_file_changes'
      id: string
      createdAt: string
      changes: AgentRunFileChangesView
    }
  | {
      kind: 'run_images'
      id: string
      createdAt: string
      images: AgentRunImagesView
    }
  | {
      kind: 'run_artifacts'
      id: string
      createdAt: string
      run: AgentRunView
      imageGroups: AgentRunImagesView[]
      fileChanges: AgentRunFileChangesView[]
    }
  | {
      kind: 'stop_event'
      id: string
      createdAt: string
      campTurnId: string
      elapsedLabel: string
      hasUnsettledExternalEffects: boolean
    }

const TIMELINE_KIND_RANK: Record<CampConversationTimelineItem['kind'], number> = {
  camp_message: 0,
  task_card: 1,
  stop_event: 2,
  run_images: 3,
  run_artifacts: 3,
  run_file_changes: 4
}

function compareTimelinePresentationOrder(
  left: CampConversationTimelineItem,
  right: CampConversationTimelineItem
): number {
  return left.createdAt.localeCompare(right.createdAt)
    || TIMELINE_KIND_RANK[left.kind] - TIMELINE_KIND_RANK[right.kind]
    || left.id.localeCompare(right.id)
}

export function campConversationTimeline(
  messages: CampMessageView[],
  turns: CampSnapshot['turns'] = [],
  agentRuns: CampSnapshot['agentRuns'] = [],
  tasks: CampSnapshot['tasks'] = [],
  agentRunFileChanges: CampSnapshot['agentRunFileChanges'] = [],
  agentRunImages: AgentRunImagesView[] = []
): CampConversationTimelineItem[] {
  const taskCards: CampConversationTimelineItem[] = tasks.map((task) => ({
    kind: 'task_card',
    id: `task:${task.taskId}`,
    createdAt: task.createdAt,
    task
  }))
  const runFileChangeCards: CampConversationTimelineItem[] = agentRunFileChanges.map((changes) => ({
    kind: 'run_file_changes',
    id: `run-file-changes:${changes.agentRunId}:${changes.executionEpoch}`,
    createdAt: changes.completedAt,
    changes
  }))
  const publicMessages = messages
    .filter((message) => {
      const kind = (message.presentation as { kind?: string } | null)?.kind
      const isLegacyApprovalResolution = message.authorType === 'system'
        && message.authorId === 'approval'
      return kind !== 'a2a_event' && kind !== 'task_event' && !isLegacyApprovalResolution
    })
    .map((message): Extract<CampConversationTimelineItem, { kind: 'camp_message' }> => ({
      kind: 'camp_message',
      id: message.id,
      createdAt: message.createdAt,
      message,
      runtimeImageGroups: []
    }))
  const publicAgentMessageRunIds = new Set(
    publicMessages.flatMap((item) => item.message.authorType === 'agent'
      ? item.message.sourceAgentRunId ?? []
      : [])
  )
  const runStatusById = new Map(agentRuns.map((run) => [run.id, run.status]))
  const runImageCards: CampConversationTimelineItem[] = agentRunImages
    .filter((images) => {
      if (images.images.length === 0) return false
      if (publicAgentMessageRunIds.has(images.agentRunId)) return true
      const status = runStatusById.get(images.agentRunId)
      return status !== undefined && !NON_TERMINAL_RUNS.has(status)
    })
    .map((images) => ({
      kind: 'run_images',
      id: `run-images:${images.agentRunId}:${images.executionEpoch}`,
      createdAt: images.createdAt,
      images
    }))
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
      campTurnId: turn.id,
      elapsedLabel: formatStopElapsed(turn.createdAt, turn.cancelRequestedAt as string),
      hasUnsettledExternalEffects: unsettledTurnIds.has(turn.id)
    }))

  const sortedMessages = publicMessages.sort((left, right) => {
    return left.message.sequence - right.message.sequence
      || compareTimelinePresentationOrder(left, right)
  })
  const sortedCards = [...taskCards, ...stopEvents, ...runImageCards, ...runFileChangeCards]
    .sort(compareTimelinePresentationOrder)
  const sortedItems: CampConversationTimelineItem[] = []
  let messageIndex = 0
  let cardIndex = 0
  // Sequence is authoritative for messages even when the wall clock moves back.
  // Merge separately ordered streams instead of using a non-transitive comparator.
  while (messageIndex < sortedMessages.length && cardIndex < sortedCards.length) {
    if (compareTimelinePresentationOrder(sortedMessages[messageIndex], sortedCards[cardIndex]) <= 0) {
      sortedItems.push(sortedMessages[messageIndex++])
    } else {
      sortedItems.push(sortedCards[cardIndex++])
    }
  }
  sortedItems.push(...sortedMessages.slice(messageIndex), ...sortedCards.slice(cardIndex))
  const lastPublicMessageByRunId = new Map<string, CampConversationTimelineItem>()
  for (const item of sortedMessages) {
    if (item.kind === 'camp_message'
      && item.message.authorType === 'agent'
      && item.message.sourceAgentRunId) {
      lastPublicMessageByRunId.set(item.message.sourceAgentRunId, item)
    }
  }
  const anchoredCardIds = new Set<string>()
  const cardsByAnchorMessageId = new Map<string, CampConversationTimelineItem[]>()
  for (const card of [...runImageCards, ...runFileChangeCards]) {
    if (card.kind !== 'run_file_changes' && card.kind !== 'run_images') continue
    const runId = card.kind === 'run_images' ? card.images.agentRunId : card.changes.agentRunId
    // With no public message, place the images immediately before that Run's Files Changed.
    const fileCard = card.kind === 'run_images'
      ? runFileChangeCards.find((candidate) => candidate.kind === 'run_file_changes'
        && candidate.changes.agentRunId === runId && candidate.changes.executionEpoch === card.images.executionEpoch)
      : undefined
    const anchor = lastPublicMessageByRunId.get(runId) ?? fileCard
    if (!anchor) continue
    anchoredCardIds.add(card.id)
    if (card.kind === 'run_images' && anchor.kind === 'camp_message') {
      anchor.runtimeImageGroups.push(card.images)
      anchor.runtimeImageGroups.sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.executionEpoch - right.executionEpoch)
      continue
    }
    cardsByAnchorMessageId.set(
      anchor.id,
      [...(cardsByAnchorMessageId.get(anchor.id) ?? []), card].sort((left, right) =>
        TIMELINE_KIND_RANK[left.kind] - TIMELINE_KIND_RANK[right.kind]
          || compareTimelinePresentationOrder(left, right)
      )
    )
  }

  const anchoredItems = sortedItems.flatMap((item) => {
    if (anchoredCardIds.has(item.id)) return []
    const cards = cardsByAnchorMessageId.get(item.id) ?? []
    return item.kind === 'run_file_changes' ? [...cards, item] : [item, ...cards]
  })
  const runById = new Map(agentRuns.map((run) => [run.id, run]))
  const outputsByRunId = new Map<string, Extract<CampConversationTimelineItem, { kind: 'run_artifacts' }>>()
  // Terminal artifacts without a public message still belong to the executing member.
  // Keep their first timeline position and group every epoch under that exact Run once.
  return anchoredItems.flatMap((item): CampConversationTimelineItem[] => {
    if (item.kind !== 'run_images' && item.kind !== 'run_file_changes') return [item]
    const runId = item.kind === 'run_images' ? item.images.agentRunId : item.changes.agentRunId
    const run = runById.get(runId)
    if (!run || NON_TERMINAL_RUNS.has(run.status) || publicAgentMessageRunIds.has(runId)) return [item]
    const existing = outputsByRunId.get(runId)
    const output = existing ?? {
      kind: 'run_artifacts', id: `run-artifacts:${runId}`, createdAt: item.createdAt,
      run, imageGroups: [], fileChanges: []
    } satisfies Extract<CampConversationTimelineItem, { kind: 'run_artifacts' }>
    if (item.kind === 'run_images') output.imageGroups.push(item.images)
    else output.fileChanges.push(item.changes)
    outputsByRunId.set(runId, output)
    return existing ? [] : [output]
  })
}

export function campConversationHasVisibleHistory(
  timeline: readonly CampConversationTimelineItem[]
): boolean {
  return timeline.some((item) =>
    item.kind !== 'camp_message' || item.message.authorType !== 'system'
  )
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
  members: ReadonlyArray<Pick<CampSnapshot['members'][number], 'agentId' | 'displayName'>>,
  currentUserName = '你'
): string {
  const names = new Map(members.map((member) => [member.agentId, member.displayName]))
  const parts = content.map((segment) => {
    if (segment.kind === 'text') return segment.text
    if (segment.kind === 'all_members_mention') return '@所有队员'
    if (segment.kind === 'current_user_mention') return `@${currentUserName}`
    if (segment.kind === 'skill_mention') return `/${segment.nameAtSend}`
    if (segment.kind === 'external_quote') {
      const attachments = segment.attachmentSummaries
        .map((attachment) => `\n> [附件] ${attachment.name}${attachment.mediaType ? ` (${attachment.mediaType})` : ''}`)
        .join('')
      const body = segment.body.length > 0
        ? segment.body.replaceAll('\n', '\n> ')
        : '（无文本）'
      return `引用 ${segment.senderDisplayName}：\n> ${body}${attachments}`
    }
    return `@${names.get(segment.agentId) ?? '不可用队员'}`
  })
  return content[0]?.kind === 'current_user_mention' && parts.slice(1).some(Boolean)
    ? `${parts[0]} ${parts.slice(1).join('')}`
    : parts.join('')
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

  return structuredCampContentMarkdownText(content.slice(1), members)
}

function structuredCampContentMarkdownText(
  content: StructuredCampMessageContent,
  members: ReadonlyArray<Pick<CampSnapshot['members'][number], 'agentId' | 'displayName'>>
): string {
  const names = new Map(members.map((member) => [member.agentId, member.displayName]))
  return content.map((segment) => {
    if (segment.kind === 'text') return segment.text
    if (segment.kind === 'all_members_mention') return escapeMarkdownLiteral('@所有队员')
    if (segment.kind === 'member_mention') {
      return escapeMarkdownLiteral(`@${names.get(segment.agentId) ?? '不可用队员'}`)
    }
    if (segment.kind === 'skill_mention') {
      return escapeMarkdownLiteral(`/${segment.nameAtSend}`)
    }
    if (segment.kind === 'external_quote') {
      return escapeMarkdownLiteral(`引用 ${segment.senderDisplayName}：${segment.body}`)
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
  onNewConversation,
  onOpenMembers,
  onOpenRuntimeSettings
}: {
  agents: AgentProfile[]
  recentCamps: NavigationCampItem[]
  onOpenCamp(camp: NavigationCampItem): void
  onNewConversation(): void
  onOpenMembers(): void
  onOpenRuntimeSettings(): void
}): JSX.Element {
  const hasAvailableMember = agents.some((agent) => agent.presence === 'present' && isNewConversationMemberAvailable({
    runtimeConfigured: agent.runtimeConfiguration !== null,
    runtimeReadiness: agent.runtimeReadiness.status
  }))
  return (
    <section className="workspace-shell new-conversation-workspace quick-chat-workspace" aria-label="快速对话">
      <div className="new-conversation-main">
        <div className="new-conversation-stage">
          {recentCamps.length === 0 && <>
          <svg className="quick-chat-mark" data-brand-mark="horizon" data-brand-layout="separated" width="96" height="66" viewBox="0 0 72 56" aria-hidden="true">
            <path d="M36 4 L39.6 16.7 L53.9 20.4 L39.6 24.1 L36 36.8 L32.4 24.1 L18.1 20.4 L32.4 16.7 Z" fill="currentColor" />
            <path d="M8 49.5 Q36 37.5 64 49.5" stroke="currentColor" strokeWidth="5" fill="none" strokeLinecap="round" />
            <circle className="brand-rendezvous-point" data-brand-point="rendezvous" cx="36" cy="43.5" r="2.6" />
          </svg>
          <h2>{hasAvailableMember ? '开始一段协作' : '还没有可用的队员'}</h2>
          <p className="quick-chat-subline">{hasAvailableMember ? '选好队员，写下你想完成的事。' : '先添加队员或完成运行配置。'}</p>
          <div className="quick-chat-empty">
            {hasAvailableMember
              ? <button className="quick-chat-create" type="button" onClick={onNewConversation}><span aria-hidden="true">＋</span>新对话</button>
              : <><button className="quick-chat-create" type="button" onClick={onOpenMembers}>前往队员</button><button className="quiet-button" type="button" onClick={onOpenRuntimeSettings}>查看运行时</button></>}
          </div>
          </>}
          {recentCamps.length > 0 && (
            <div className="quick-chat-continue" aria-label="最近对话">
              <header className="quick-chat-continue-title"><h2>最近对话</h2><button className="quiet-button" type="button" onClick={onNewConversation}><span aria-hidden="true">＋</span>新对话</button></header>
              {recentCamps.map((camp) => (
                <button className="quick-chat-continue-row" type="button" key={camp.id} onClick={() => onOpenCamp(camp)}>
                  <span className="camp-marker-slot" aria-hidden="true">
                    {camp.marker === 'unread_completed' && <i className="task-dot camp-marker-unread_completed" />}
                  </span>
                  <span className="truncate" title={formatCampTitle(camp)}>{formatCampTitle(camp)}</span>
                  {camp.marker === 'loading' && <span className="camp-loading-spinner camp-marker-loading" role="img" aria-label="正在运行" />}
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

const EMPTY_CAMP_MESSAGES: CampMessageView[] = []
const EMPTY_LIVE_RUNTIME_EVENTS: LiveRuntimeEvent[] = []

// Subscribe to split geometry in this leaf so resizing does not rerender the timeline.
function RevealNotificationConversation({ active, onHidePreview }: { active: boolean; onHidePreview?(): void }): null {
  const layout = useOptionalFilePreviewLayout()
  useLayoutEffect(() => {
    if (active && layout?.compact && layout.visible) onHidePreview?.()
  }, [active, layout?.compact, layout?.visible, onHidePreview])
  return null
}

export function CampWorkspace({
  snapshot,
  missionBoard = null,
  previewTabsInPane = false,
  suppressExecutionAutoOpen = false,
  initialComposerDraft = null,
  onInitialComposerDraftConsumed,
  openCoverage = null,
  messageHistory = null,
  onLoadEarlierMessages,
  optimisticMessages = EMPTY_CAMP_MESSAGES,
  projectName,
  agents,
  installations = [],
  liveRuntimeEvents = EMPTY_LIVE_RUNTIME_EVENTS,
  busy,
  onSend,
  onWithdrawMessage,
  onPendingDraftPersisted,
  onPendingCampLeave,
  onCampLeaveGuardChange,
  onChangeLead,
  onAddMembers,
  onPreviewMemberRemoval,
  onRemoveMember,
  onTasksChanged,
  onResolveApproval,
  cancellingTurnIds = new Set<string>(),
  cancellingRunIds = new Set<string>(),
  confirmingRunIds = new Set<string>(),
  onCancelAgentRun = async () => undefined,
  stopping,
  executionPlacement = 'inspector',
  onExecutionPlacementChange = async () => undefined,
  worldMapEnabled = true,
  workspaceEntrySnapshotReady = true,
  inspectorVisible = false,
  inspectorTab: controlledInspectorTab,
  detailEntryHost,
  singleChatVisible = false,
  onOpenSingleChat = () => undefined,
  onCloseSingleChat = () => undefined,
  onCloseInspector = () => undefined,
  onInspectorTabChange,
  onOpenInspector,
  notificationFocus = null,
  onNotificationFocusPresented,
  onVisibleNotificationSources,
  onVisibleSingleChatSources,
  singleChatTarget,
  runtimeRecovery = null,
  firstRunCamp = null,
  onConfigureRuntime,
  onDismissRuntimeRecovery,
  onNotify = () => undefined,
  onNotifyError
}: {
  snapshot: CampSnapshot
  missionBoard?: React.ReactNode
  previewTabsInPane?: boolean
  suppressExecutionAutoOpen?: boolean
  initialComposerDraft?: CampComposerDraftView | null
  onInitialComposerDraftConsumed?(draft: CampComposerDraftView): void
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
  onWithdrawMessage?(message: CampMessageView): Promise<void>
  onPendingDraftPersisted?(): void
  onPendingCampLeave?(draft: CampComposerDraftView): Promise<void>
  onCampLeaveGuardChange?(campId: string, guard: CampLeaveGuard | null): void
  onChangeLead(agentId: string): Promise<void>
  onAddMembers?(agentIds: string[]): Promise<CampMemberAddOutcome>
  onPreviewMemberRemoval?(agentId: string): Promise<CampMemberRemovalPreview>
  onRemoveMember?(preview: CampMemberRemovalPreview): Promise<CampMemberRemoveOutcome>
  onTasksChanged(): Promise<void>
  onResolveApproval(approval: ActionApprovalView, optionId: string): void
  cancellingTurnIds?: ReadonlySet<string>
  cancellingRunIds?: ReadonlySet<string>
  confirmingRunIds?: ReadonlySet<string>
  onCancelAgentRun?(run: AgentRunView): Promise<void>
  stopping: boolean
  /** Retained only for source compatibility; the public Composer exposes no Stop action. */
  onStop?(): void
  executionPlacement?: ExecutionConsolePlacement
  onExecutionPlacementChange?(placement: ExecutionConsolePlacement): Promise<ExecutionConsolePlacement | void>
  worldMapEnabled?: boolean
  workspaceEntrySnapshotReady?: boolean
  inspectorVisible?: boolean
  inspectorTab?: CampInspectorTab
  detailEntryHost?: HTMLElement | null
  singleChatVisible?: boolean
  onOpenSingleChat?(): void
  onCloseSingleChat?(): void
  onCloseInspector?(): void
  onInspectorTabChange?(tab: CampInspectorTab): void
  onOpenInspector?(tab: CampInspectorTab): void
  notificationFocus?: NotificationFocusTarget | null
  onNotificationFocusPresented?(requestId: number): void
  onVisibleNotificationSources?(sources: VisibleNotificationSources): void
  onVisibleSingleChatSources?(sources: VisibleNotificationSources): void
  singleChatTarget?: import("@contracts").NotificationSingleChatSource & { requestId: number } | null
  runtimeRecovery?: CampRuntimeRecovery | null
  firstRunCamp?: FirstRunCampContext | null
  onConfigureRuntime?(agentId: string): void
  onDismissRuntimeRecovery?(): void
  onNotify?(message: string): void
  onNotifyError?(message: string): void
}): JSX.Element {
  const client = useCampClient()
  const { profile: currentUserProfile } = useCurrentUserProfile()
  const currentUserName = currentUserDisplayName(currentUserProfile)
  const filePreview = useOptionalFilePreview()
  useEffect(() => {
    filePreview?.syncFileChanges(snapshot.camp.id, snapshot.agentRunFileChanges)
  }, [filePreview?.syncFileChanges, snapshot.agentRunFileChanges, snapshot.camp.id])
  const executionPreviewHost = useExecutionPreviewHost(snapshot.camp.id)
  const notifyError = onNotifyError ?? onNotify
  const openCurrentAgentRunFile = useCallback((
    changes: AgentRunFileChangesView,
    evidenceFileId: string
  ): void => {
    void openAgentRunCurrentFilePreview({
      filePreview,
      campId: snapshot.camp.id,
      changes,
      evidenceFileId,
      onError: notifyError
    })
  }, [filePreview, notifyError, snapshot.camp.id])
  const [, setComposerDraftProjectionVersion] = useState(0)
  const [draftLoadState, setDraftLoadState] = useState<DraftLoadState>({ state: 'loading' })
  const [composerPersistenceError, setComposerPersistenceError] = useState<Error | null>(null)
  const [composerLocalStatus, setComposerLocalStatus] = useState<ComposerLocalStatus>({
    hasContent: false,
    hasExplicitRecipient: false,
    hasUnavailableAtom: false
  })
  const singleChatLeaveGuardRef = useRef<(() => CampLeavePreparation) | null>(null)
  const bindSingleChatLeaveGuard = useCallback((guard: (() => CampLeavePreparation) | null): void => {
    singleChatLeaveGuardRef.current = guard
  }, [])
  const [preparingAttachments, setPreparingAttachments] = useState<Array<{ id: string; name: string; kind: AttachmentKind }>>([])
  const [failedAttachments, setFailedAttachments] = useState<Array<{ id: string; name: string; kind: AttachmentKind; error: string }>>([])
  const [attachmentDragState, setAttachmentDragState] = useState<AttachmentDragKind | null>(null)
  const [composerSubmitting, setComposerSubmitting] = useState(false)
  const [routingMutating, setRoutingMutating] = useState(false)
  const mobile = useMobileLayout()
  const composerSubmittingRef = useRef(false)
  const routingMutatingRef = useRef(false)
  const composerLockAwaitingDisabledCommitRef = useRef(false)
  const [replyInteractionError, setReplyInteractionError] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [withdrawalMessage, setWithdrawalMessage] = useState<CampMessageView | null>(null)
  const [withdrawingMessageId, setWithdrawingMessageId] = useState<string | null>(null)
  const [withdrawalError, setWithdrawalError] = useState<string | null>(null)
  useEffect(() => {
    setWithdrawalMessage(null)
    setWithdrawalError(null)
  }, [snapshot.camp.id])
  const [starterNotice, setStarterNotice] = useState<string | null>(null)
  const [mentionPopover, setMentionPopover] = useState<MentionPopoverRequest | null>(null)
  const [composerSkillCatalog, setComposerSkillCatalog] = useState<{
    candidates: ComposerSkillCandidates
    status: 'loading' | 'ready' | 'error'
  }>({ candidates: { skills: [], errors: [] }, status: 'loading' })
  const [skillCatalogRefreshing, setSkillCatalogRefreshing] = useState(false)
  const refreshSkillCatalogRef = useRef<(() => void) | null>(null)
  const composerEditorRef = useRef<HTMLDivElement>(null)
  const composerHandleRef = useRef<StructuredMentionComposerHandle>(null)
  const composerFileInputRef = useRef<HTMLInputElement>(null)
  const draftCampId = useRef<string | null>(null)
  const initializedComposerRoute = useRef<{
    revision: number
    publishedMessageSequence: number
  } | null>(null)
  const activeCampIdRef = useRef(snapshot.camp.id)
  const activeSnapshotRef = useRef(snapshot)
  const initialComposerDraftRef = useRef(initialComposerDraft)
  const activationStateRef = useRef(snapshot.camp.activationState)
  const pendingCampLeaveRef = useRef(onPendingCampLeave)
  activeCampIdRef.current = snapshot.camp.id
  activeSnapshotRef.current = snapshot
  initialComposerDraftRef.current = initialComposerDraft
  activationStateRef.current = snapshot.camp.activationState
  pendingCampLeaveRef.current = onPendingCampLeave
  const draftCoordinatorRef = useRef<DraftMutationCoordinator | null>(null)
  if (!draftCoordinatorRef.current) {
    draftCoordinatorRef.current = new DraftMutationCoordinator({
      load: async (campId) => {
        const initial = initialComposerDraftRef.current?.campId === campId
          ? initialComposerDraftRef.current
          : null
        let draft = (activationStateRef.current === 'active'
          ? loadLocalCampComposerDraft(campId)
          : null) ?? initial ?? emptyLocalComposerDraft(campId)
        if (draft.attachments.length > 0 && client.composerAttachments.restore) {
          draft = {
            ...draft,
            attachments: await client.composerAttachments.restore(campId, draft.attachments)
          }
        }
        if (draft.replyIntent) {
          const reply = draft.replyIntent
          const sourceAvailable = await client.request<CampMessageAroundSnapshot>(
            'camp.messages.around',
            { campId, messageId: reply.replyToCampMessageId }
          ).then((around) => around.campId === campId
            && around.anchorMessageId === reply.replyToCampMessageId
            && around.sourceAvailable
          ).catch(() => false)
          if (!sourceAvailable) {
            draft = {
              ...draft,
              replyIntent: {
                ...reply,
                targetState: 'message_unavailable',
                recipientSelectionRequired: true
              }
            }
          }
        }
        const continuation = draft.continuationIntent
        if (continuation) {
          const member = activeSnapshotRef.current.members.find(
            ({ agentId }) => agentId === continuation.recipient.agentId
          )
          const available = member?.membershipStatus === 'active'
            && member.profilePresence === 'present'
          draft = {
            ...draft,
            continuationIntent: {
              ...continuation,
              recipient: {
                ...continuation.recipient,
                displayName: member?.displayName ?? continuation.recipient.displayName,
                recipientAvailability: available ? 'available' : 'unavailable'
              },
              recipientSelectionRequired: !available
            }
          }
        }
        return {
          ...draft,
          body: composerBodyForContent(draft.content, activeSnapshotRef.current.members)
        }
      },
      mutate: async (draft, mutation) => {
        return mutateComposerDraft(client, draft, mutation, activeSnapshotRef.current)
      },
      onChange: (draft, _epoch, kind) => {
        if (draft && activationStateRef.current === 'active') {
          try {
            saveLocalCampComposerDraft(draft)
            setComposerPersistenceError(null)
          } catch (error) {
            setComposerPersistenceError(
              error instanceof Error ? error : new Error(readErrorMessage(error))
            )
          }
        }
        if (draftCoordinatorChangeRefreshesProjection(kind)) {
          setComposerDraftProjectionVersion((version) => version + 1)
        }
      }
    })
  }
  const draftCoordinator = draftCoordinatorRef.current
  const coordinatorDraft = draftCoordinator.getCurrentDraft()
  const composerDraft = draftLoadState.state === 'ready'
    && coordinatorDraft?.campId === snapshot.camp.id
    ? coordinatorDraft
    : null
  const dragLeaveTimer = useRef<number | null>(null)
  const dragActivityTimer = useRef<number | null>(null)
  const attachmentPreparationQueue = useRef<Promise<void>>(Promise.resolve())
  const workspaceShellRef = useRef<HTMLElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const earlierMessageLoadInFlightRef = useRef(false)
  const conversationFindSurfaceRef = useRef<HTMLDivElement>(null)
  const conversationFindInputRef = useRef<HTMLInputElement>(null)
  const conversationFindRequestGeneration = useRef(0)
  const conversationFindDebounceTimer = useRef<number | null>(null)
  const conversationFindRestorePoint = useRef<ConversationFindRestorePoint | null>(null)
  const conversationFindOpenRef = useRef(false)
  const timelineVisibleAnchorRef = useRef<TimelineMessageAnchor | null>(null)
  const timelineLayoutAnchorRef = useRef<{
    campId: string
    width: number
    hidden: boolean
    scrollTop: number
    anchor: TimelineReadingAnchor
  } | null>(null)
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
  const [quoteSourceId, setQuoteSourceId] = useState<string | null>(null)
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
  const preparedNotificationAgentRunRequest = useRef<number | null>(null)
  const showingFirstRunWelcome = firstRunCamp !== null
    && snapshot.messages.length === 0
    && snapshot.agentRuns.length === 0
  const [conversationView, setConversationView] = useState<CampConversationView>(() => {
    if (typeof window === 'undefined') {
      return initialCampConversationView(null, showingFirstRunWelcome, worldMapEnabled)
    }
    try {
      return initialCampConversationView(
        window.localStorage.getItem(CAMP_CONVERSATION_VIEW_STORAGE_KEY),
        showingFirstRunWelcome,
        worldMapEnabled
      )
    } catch {
      return initialCampConversationView(null, showingFirstRunWelcome, worldMapEnabled)
    }
  })
  const firstRunConversationShownForCamp = useRef<string | null>(
    showingFirstRunWelcome ? snapshot.camp.id : null
  )
  const [worldMapRoutesVisible, setWorldMapRoutesVisible] = useState(false)
  const [localInspectorTab, setLocalInspectorTab] = useState<CampInspectorTab>('tasks')
  const [workspaceEntrySelection] = useState(() =>
    workspaceEntrySnapshotReady && !suppressExecutionAutoOpen
      ? executionWorkspaceEntrySelection(snapshot.agentRuns)
      : null
  )
  const workspaceEntryRunningRun = workspaceEntrySelection?.focusedRun ?? null
  const [executionPlacementPending, setExecutionPlacementPending] = useState(false)
  const [executionPlacementError, setExecutionPlacementError] = useState<{
    message: string
    detail: string | null
    target: ExecutionConsolePlacement
  } | null>(null)
  const [executionInspectorActive, setExecutionInspectorActive] = useState(
    executionPlacement === 'inspector'
  )
  const [executionDrawerAgentId, setExecutionDrawerAgentId] = useState<string | null>(
    workspaceEntrySelection?.selectedAgentId ?? null
  )
  const [executionDrawerFocusedRunId, setExecutionDrawerFocusedRunId] = useState<string | null>(
    workspaceEntrySelection?.focusedRun.id ?? null
  )
  const [executionDrawerFocusRequest, setExecutionDrawerFocusRequest] = useState<ExecutionDrawerFocusRequest>({
    sequence: workspaceEntryRunningRun ? 1 : 0,
    moveDomFocus: false
  })
  const [submittedExecutionRequests, setSubmittedExecutionRequests] = useState<CampMessageSendReceipt[]>([])
  const publishedMessageSequence = snapshot.messages.reduce((latest, message) => Math.max(latest, message.sequence), 0)
  const executionDrawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const executionDrawerReturnAgentIdRef = useRef<string | null>(null)
  const bottomPlacementButtonRef = useRef<HTMLButtonElement>(null)
  const inspectorPlacementButtonRef = useRef<HTMLButtonElement>(null)
  const rightPlacementButtonRef = useRef<HTMLButtonElement>(null)
  const bottomExecutionDrawerHostRef = useRef<HTMLDivElement>(null)
  const inspectorExecutionDrawerHostRef = useRef<HTMLDivElement>(null)
  const executionReadingPosition = useRef<ExecutionConsoleReadingPosition | null>(null)
  const executionPlacementMenuReadingPosition = useRef<ExecutionConsoleReadingPosition | null>(null)
  const pendingExecutionReadingPosition = useRef<ExecutionConsoleReadingPosition | null>(null)
  const executionReadingRestoreFrames = useRef<[number, number] | null>(null)
  const executionReadingCaptureFrames = useRef<[number, number] | null>(null)
  const executionPlacementRequest = useRef(false)
  const executionPlacementMounted = useRef(true)
  const workspaceEntrySnapshotHandled = useRef(workspaceEntrySnapshotReady)
  const executionEntryInteractionCampId = useRef<string | null>(null)
  const workspaceEntryInspectorHandled = useRef(false)
  const mountedCampId = useRef(snapshot.camp.id)
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
  // Secondary phone panels return to the last primary view, without becoming navigation history.
  const mobilePrimaryView = useRef<'conversation' | 'execution'>('conversation')
  const [mobileExecutionMaximized, setMobileExecutionMaximized] = useState(false)
  useEffect(() => {
    if (!inspectorVisible || inspectorSurfaceTab !== 'execution') setMobileExecutionMaximized(false)
  }, [inspectorVisible, inspectorSurfaceTab])
  useLayoutEffect(() => {
    if (!mobile || singleChatVisible || (inspectorVisible && inspectorSurfaceTab !== 'execution')) return
    mobilePrimaryView.current = inspectorVisible ? 'execution' : 'conversation'
  }, [mobile, singleChatVisible, inspectorVisible, inspectorSurfaceTab])
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
  useEffect(() => {
    if (!worldMapEnabled && conversationView === 'world') {
      setConversationView('conversation')
    }
  }, [conversationView, worldMapEnabled])
  useLayoutEffect(() => {
    if (!executionDrawerPortal) return
    const host = executionPlacement === 'right'
      ? executionPreviewHost
      : executionPlacement === 'inspector'
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
  }, [executionDrawerPortal, executionPlacement, executionPreviewHost, inspectorVisible])
  useEffect(() => {
    executionPlacementMounted.current = true
    return () => {
      executionPlacementMounted.current = false
      if (executionReadingRestoreFrames.current) {
        window.cancelAnimationFrame(executionReadingRestoreFrames.current[0])
        window.cancelAnimationFrame(executionReadingRestoreFrames.current[1])
      }
      if (executionReadingCaptureFrames.current) {
        window.cancelAnimationFrame(executionReadingCaptureFrames.current[0])
        window.cancelAnimationFrame(executionReadingCaptureFrames.current[1])
      }
      executionDrawerPortal?.remove()
    }
  }, [executionDrawerPortal])
  useEffect(() => {
    if (!executionDrawerPortal) return undefined
    const captureAfterInteraction = (): void => {
      if (executionReadingCaptureFrames.current) {
        window.cancelAnimationFrame(executionReadingCaptureFrames.current[0])
        window.cancelAnimationFrame(executionReadingCaptureFrames.current[1])
      }
      const firstFrame = window.requestAnimationFrame(() => {
        const secondFrame = window.requestAnimationFrame(() => {
          executionReadingCaptureFrames.current = null
          const position = captureExecutionConsoleReadingPosition(
            executionDrawerPortal.querySelector<HTMLElement>('.execution-drawer'),
            executionReadingPosition.current
          )
          if (position) executionReadingPosition.current = position
        })
        executionReadingCaptureFrames.current = [firstFrame, secondFrame]
      })
      executionReadingCaptureFrames.current = [firstFrame, firstFrame]
    }
    executionDrawerPortal.addEventListener('wheel', captureAfterInteraction, { capture: true, passive: true })
    executionDrawerPortal.addEventListener('pointerup', captureAfterInteraction, true)
    executionDrawerPortal.addEventListener('keyup', captureAfterInteraction, true)
    return () => {
      executionDrawerPortal.removeEventListener('wheel', captureAfterInteraction, true)
      executionDrawerPortal.removeEventListener('pointerup', captureAfterInteraction, true)
      executionDrawerPortal.removeEventListener('keyup', captureAfterInteraction, true)
      if (executionReadingCaptureFrames.current) {
        window.cancelAnimationFrame(executionReadingCaptureFrames.current[0])
        window.cancelAnimationFrame(executionReadingCaptureFrames.current[1])
        executionReadingCaptureFrames.current = null
      }
    }
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
  const memberFast = useCampMemberFast(snapshot, profileById, installations,
    inspectorVisible && inspectorSurfaceTab === 'members' ? 'members' : executionDrawerAgentId, onNotify)
  const composerMembers = useMemo(
    () => snapshot.members.map((member) => ({
      agentId: member.agentId,
      displayName: member.displayName,
      teamRole: member.teamRole,
      avatarRef: member.avatarRef,
      mentionable: member.membershipStatus === 'active' && member.profilePresence === 'present'
    })),
    [snapshot.members]
  )
  useEffect(() => {
    let cancelled = false
    let requestSequence = 0
    setComposerSkillCatalog({ candidates: { skills: [], errors: [] }, status: 'loading' })
    setSkillCatalogRefreshing(false)
    const loadSkillCatalog = async (refresh = false): Promise<void> => {
      const request = ++requestSequence
      if (refresh) setSkillCatalogRefreshing(true)
      try {
        const candidates = await client.request<ComposerSkillCandidates>('skills.candidates', { campId: snapshot.camp.id, refresh })
        if (!cancelled && request === requestSequence) setComposerSkillCatalog({ candidates, status: 'ready' })
      } catch {
        if (!cancelled && request === requestSequence) {
          setComposerSkillCatalog((current) => current.status === 'ready'
            ? { ...current, candidates: {
                ...current.candidates,
                errors: [...current.candidates.errors.filter((error) => error !== '刷新失败'), '刷新失败']
              } }
            : { ...current, status: 'error' })
        }
      } finally {
        if (!cancelled && request === requestSequence) setSkillCatalogRefreshing(false)
      }
    }
    void loadSkillCatalog()
    refreshSkillCatalogRef.current = () => void loadSkillCatalog(true)
    const unsubscribeInvalidation = client.onInvalidated?.(() => void loadSkillCatalog(true))
    const unsubscribe = client.onEvent?.((event) => {
      if (event.method !== 'runtime.state') return
      const params = event.params !== null && typeof event.params === 'object'
        ? event.params as Record<string, unknown>
        : {}
      if (params.status === 'ready') void loadSkillCatalog(true)
    })
    return () => {
      cancelled = true
      refreshSkillCatalogRef.current = null
      unsubscribe?.()
      unsubscribeInvalidation?.()
    }
  }, [client, snapshot.camp.id, snapshot.camp.projectPath, snapshot.camp.membershipGeneration])
  const closeMentionPopover = useCallback((returnFocus: boolean): void => {
    const trigger = mentionPopover?.trigger
    setMentionPopover(null)
    if (returnFocus && trigger) {
      window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }))
    }
  }, [mentionPopover?.trigger])
  const openCurrentUserProfilePopover = (trigger: HTMLElement, focusPanel: boolean): void => {
    if (mentionPopover?.trigger === trigger) {
      closeMentionPopover(true)
      return
    }
    setMentionPopover({ target: { kind: 'current_user' }, trigger, focusPanel })
  }
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
  useLayoutEffect(() => {
    if (workspaceEntrySnapshotHandled.current || !workspaceEntrySnapshotReady) return
    workspaceEntrySnapshotHandled.current = true
    if (executionEntryInteractionCampId.current === snapshot.camp.id) return
    if (suppressExecutionAutoOpen) return
    const entrySelection = executionWorkspaceEntrySelection(snapshot.agentRuns)
    const runningRun = entrySelection?.focusedRun ?? null
    setExecutionDrawerAgentId(entrySelection?.selectedAgentId ?? null)
    setExecutionDrawerFocusedRunId(entrySelection?.focusedRun.id ?? null)
    setExecutionDrawerFocusRequest((request) => ({
      sequence: request.sequence + 1,
      moveDomFocus: false
    }))
    if (executionPlacement !== 'inspector') {
      setExecutionInspectorActive(false)
    } else if (runningRun) {
      setExecutionInspectorActive(true)
    }
    executionDrawerTriggerRef.current = null
    executionDrawerReturnAgentIdRef.current = null
    if (!mobile && runningRun && executionPlacement === 'inspector') {
      onOpenInspector?.(inspectorTab)
    } else if (runningRun && executionPlacement === 'right') {
      filePreview?.openExecution()
    }
  }, [
    executionPlacement,
    inspectorTab,
    mobile,
    onOpenInspector,
    filePreview,
    snapshot.agentRuns,
    workspaceEntrySnapshotReady,
    suppressExecutionAutoOpen
  ])
  useLayoutEffect(() => {
    if (workspaceEntryInspectorHandled.current) return
    if (!workspaceEntrySnapshotReady) return
    workspaceEntryInspectorHandled.current = true
    if (suppressExecutionAutoOpen) return
    if (!mobile && workspaceEntryRunningRun && executionPlacement === 'inspector') {
      onOpenInspector?.(inspectorTab)
    } else if (workspaceEntryRunningRun && executionPlacement === 'right') {
      filePreview?.openExecution()
    }
  }, [
    executionPlacement,
    inspectorTab,
    mobile,
    onOpenInspector,
    filePreview,
    workspaceEntryRunningRun,
    workspaceEntrySnapshotReady,
    suppressExecutionAutoOpen
  ])
  useLayoutEffect(() => {
    if (mountedCampId.current === snapshot.camp.id) return
    mountedCampId.current = snapshot.camp.id
    executionEntryInteractionCampId.current = null
    workspaceEntrySnapshotHandled.current = workspaceEntrySnapshotReady
    const entrySelection = workspaceEntrySnapshotReady && !suppressExecutionAutoOpen
      ? executionWorkspaceEntrySelection(snapshot.agentRuns)
      : null
    const runningRun = entrySelection?.focusedRun ?? null
    setExecutionDrawerAgentId(entrySelection?.selectedAgentId ?? null)
    setExecutionDrawerFocusedRunId(entrySelection?.focusedRun.id ?? null)
    setExecutionDrawerFocusRequest((request) => ({
      sequence: request.sequence + 1,
      moveDomFocus: false
    }))
    setSubmittedExecutionRequests([])
    setExecutionInspectorActive(executionPlacement === 'inspector')
    executionDrawerTriggerRef.current = null
    executionDrawerReturnAgentIdRef.current = null
    if (!mobile && runningRun && executionPlacement === 'inspector') {
      onOpenInspector?.(inspectorTab)
    } else if (runningRun && executionPlacement === 'right') {
      filePreview?.openExecution()
    }
  }, [executionPlacement, filePreview, inspectorTab, mobile, onOpenInspector, snapshot.agentRuns, snapshot.camp.id, suppressExecutionAutoOpen, workspaceEntrySnapshotReady])
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
    const fallback = executionPlacement === 'right'
      ? rightPlacementButtonRef.current
      : executionPlacement === 'inspector'
        ? inspectorPlacementButtonRef.current
        : bottomPlacementButtonRef.current
    fallback?.focus({ preventScroll: true })
  }, [executionDrawerAgentId, executionPlacement])

  const hasUnavailableMention = composerLocalStatus.hasUnavailableAtom
  const runById = useMemo(
    () => new Map(snapshot.agentRuns.map((run) => [run.id, run])),
    [snapshot.agentRuns]
  )
  const executionProcesses = useMemo(
    () => agentExecutionProcesses(snapshot.agentRuns, snapshot.messageDeliveries),
    [snapshot.agentRuns, snapshot.messageDeliveries]
  )
  const runningMembers = useMemo(
    () => runningCampMembers(snapshot.agentRuns, snapshot.members),
    [snapshot.agentRuns, snapshot.members]
  )
  const executionProcessByAgentId = useMemo(
    () => new Map(executionProcesses.map((process) => [process.agentId, process])),
    [executionProcesses]
  )
  const visibleCampMessages = useMemo(() => {
    const messages = new Map<string, CampMessageView>()
    for (const message of anchoredMessages) {
      if (!message.missionStart) messages.set(message.id, message)
    }
    for (const message of snapshot.messages) {
      if (!message.missionStart) messages.set(message.id, message)
    }
    for (const message of optimisticMessages) {
      if (!message.missionStart && !messages.has(message.id)) messages.set(message.id, message)
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
      snapshot.agentRuns,
      snapshot.tasks,
      snapshot.agentRunFileChanges,
      snapshot.agentRunImages
    ),
    [
      snapshot.agentRuns,
      snapshot.tasks,
      snapshot.turns,
      snapshot.agentRunFileChanges,
      snapshot.agentRunImages,
      visibleCampMessages
    ]
  )
  const latestAgentMessageId = useMemo(() => {
    for (let index = conversationTimeline.length - 1; index >= 0; index -= 1) {
      const item = conversationTimeline[index]
      if (item.kind === 'camp_message' && item.message.authorType === 'agent') {
        return item.message.id
      }
    }
    return null
  }, [conversationTimeline])
  const groupingFollowsLatest = useCallback(() => !conversationFind.open
    && (timelineReadingPosition.current?.campId !== snapshot.camp.id
      || timelineReadingPosition.current.position.followingLatest !== false),
  [conversationFind.open, snapshot.camp.id])
  const shortPublicMessages = usePublicMessageLayout(
    timelineScrollRef, conversationTimeline, snapshot.camp.id,
    conversationView === 'conversation', groupingFollowsLatest
  )
  const isCampEmpty = !campConversationHasVisibleHistory(conversationTimeline)
  const defaultLead = snapshot.members.find((member) => member.isDefaultLead) ?? null
  const replyRepairRequired = composerDraftNeedsReplyRepair(composerDraft)
  const hasExplicitRecipient = composerLocalStatus.hasExplicitRecipient
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
  const hasReadyAttachment = (composerDraft?.attachments.length ?? 0) > 0
  const hasSendablePayload = composerLocalStatus.hasContent || hasReadyAttachment
  const hasLocalDraftPayload = Boolean(
    hasSendablePayload
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
    () => hasExplicitRecipient
      ? null
      : composerRecipientSummary(emptyComposerDocument(), snapshot.members),
    [hasExplicitRecipient, snapshot.members]
  )
  const composerSkills = useMemo(
    () => composerSkillsFromCandidates(composerSkillCatalog.candidates),
    [composerSkillCatalog.candidates]
  )
  const unlistedSkillName = useMemo(() => {
    if (composerSkillCatalog.status !== 'ready' || composerDraft?.campId !== snapshot.camp.id) return null
    const candidateIds = new Set(composerSkills.map((skill) => skill.id))
    const missing = composerDraft.content.segments.find((segment) => segment.kind === 'atom'
      && segment.atom.type === 'skill' && !candidateIds.has(segment.atom.skillId))
    return missing?.kind === 'atom' && missing.atom.type === 'skill' ? missing.atom.nameAtSend : null
  }, [composerDraft, composerSkillCatalog.status, composerSkills, snapshot.camp.id])
  const activeRuns = snapshot.agentRuns.filter((run) => NON_TERMINAL_RUNS.has(run.status))
  const executionBlocked = activeRuns.length > 0 || stopping
  const composerInteractionDisabled = draftLoadState.state !== 'ready'
    || routingMutating
    || composerSubmitting
  const composerSendDisabled = composerSendIsDisabled({
    hasSendablePayload,
    hasUnavailableMention,
    replyRepairRequired,
    continuationRepairRequired,
    busy,
    composerSubmitting,
    routingMutating,
    composerDraftAvailable: composerDraft !== null,
    preparingAttachmentCount: preparingAttachments.length,
    failedAttachmentCount: failedAttachments.length
      + (composerDraft?.attachments.some(({ availability }) => availability !== 'available') ? 1 : 0)
  })
  const executionDrawerOverview = executionDrawerAgentId === EXECUTION_OVERVIEW_SCOPE
  const executionDrawerProcess = executionDrawerOverview
      ? {
        agentId: EXECUTION_OVERVIEW_SCOPE,
        runs: executionProcesses.flatMap((process) => process.runs).sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
        ),
        waitingDeliveries: executionProcesses.flatMap((process) => process.waitingDeliveries).sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
        )
      }
    : executionDrawerAgentId
      ? executionProcessByAgentId.get(executionDrawerAgentId) ?? null
      : null
  const executionDrawerProfile = executionDrawerProcess && !executionDrawerOverview
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
  const executionEventsByRunId = useMemo(
    () => groupExecutionEventsByRunId(
      snapshot.agentRuns,
      snapshot.executionEvidence,
      liveRuntimeEvents
    ),
    [liveRuntimeEvents, snapshot.agentRuns, snapshot.executionEvidence]
  )
  const executionProgressByRunId = useMemo(
    () => new Map(snapshot.agentRuns.map((run) => [
      run.id,
      buildLiveExecutionProgress(openCoverage ? (executionEventsByRunId.get(run.id) ?? []).slice(-48) : executionEventsByRunId.get(run.id) ?? [], run.id, { includePublicResults: false })
    ])),
    [executionEventsByRunId, snapshot.agentRuns, openCoverage]
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

  const saveStructuredDraft = async (
    campId: string,
    content: ComposerDocument
  ): Promise<void> => {
    if (draftCoordinator.getCurrentDraft()?.campId !== campId) {
      throw new Error('Composer Draft context changed before content persistence.')
    }
    await draftCoordinator.saveContent(content)
  }

  const retryComposerDraftLoad = async (): Promise<void> => {
    if (draftLoadState.state === 'loading') return
    const campId = snapshot.camp.id
    const composerHandle = composerHandleRef.current
    composerHandle?.setInteractionLocked(true)
    setDraftLoadState({ state: 'loading' })
    try {
      await draftCoordinator.load()
      if (draftCampId.current !== campId) return
      setComposerPersistenceError(null)
      setDraftLoadState({ state: 'ready' })
    } catch (error) {
      if (draftCampId.current !== campId) return
      setDraftLoadState({
        state: 'error',
        error: error instanceof Error ? error : new Error(readErrorMessage(error))
      })
    } finally {
      composerHandle?.setInteractionLocked(false)
    }
  }

  const prepareForCampLeave = useCallback(async (): Promise<CampLeavePreparation> => {
    if (composerSubmittingRef.current || routingMutatingRef.current) {
      throw new Error('Composer 正在提交变更，请稍后再离开当前会话。')
    }
    const composerHandle = composerHandleRef.current
    composerHandle?.setInteractionLocked(true)
    const pendingLeavePreparations: CampLeavePreparation[] = []
    try {
      const privatePreparation = singleChatLeaveGuardRef.current?.()
      if (privatePreparation) pendingLeavePreparations.push(privatePreparation)
      if (draftLoadState.state !== 'ready') {
        return { complete(didLeave) {
          for (const preparation of pendingLeavePreparations) preparation.complete(didLeave)
          if (!didLeave) composerHandle?.setInteractionLocked(false)
        } }
      }
      await attachmentPreparationQueue.current
      const flushed = await composerHandle?.flush()
      const draft = flushed?.draft ?? await draftCoordinator.waitForIdle()
      const settlePending = activationStateRef.current === 'pending'
        ? pendingCampLeaveRef.current
        : undefined
      let completed = false
      return {
        complete(didLeave) {
          if (completed) return
          completed = true
          for (const preparation of pendingLeavePreparations) preparation.complete(didLeave)
          if (!didLeave) composerHandle?.setInteractionLocked(false)
          if (didLeave && settlePending) {
            void settlePending(draft).catch(() => undefined)
          }
        }
      }
    } catch (error) {
      for (const preparation of pendingLeavePreparations) preparation.complete(false)
      composerHandle?.setInteractionLocked(false)
      const normalized = error instanceof Error ? error : new Error(readErrorMessage(error))
      setComposerPersistenceError(normalized)
      throw normalized
    }
  }, [draftCoordinator, draftLoadState.state])

  useLayoutEffect(() => {
    const campId = snapshot.camp.id
    onCampLeaveGuardChange?.(campId, prepareForCampLeave)
    return () => onCampLeaveGuardChange?.(campId, null)
  }, [onCampLeaveGuardChange, prepareForCampLeave, snapshot.camp.id])

  useLayoutEffect(() => {
    if (
      draftLoadState.state !== 'error'
      || !composerLockAwaitingDisabledCommitRef.current
    ) return
    composerLockAwaitingDisabledCommitRef.current = false
    composerHandleRef.current?.setInteractionLocked(false)
  }, [draftLoadState.state])

  const loadReplyAnchorWindow = useCallback((messageId: string): Promise<CampMessageView[] | null> => {
    const existing = replyAnchorLoads.current.get(messageId)
    if (existing) return existing
    const campId = snapshot.camp.id
    const request = client.request<CampMessageAroundSnapshot>('camp.messages.around', {
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
  }, [client, snapshot.camp.id])

  useEffect(() => {
    if (!composerDraft || hasLocalDraftPayload || composerSubmitting || routingMutating) return
    const initializedRoute = initializedComposerRoute.current
    if (initializedRoute && initializedRoute.revision === composerDraft.revision
      && initializedRoute.publishedMessageSequence >= publishedMessageSequence) return
    const campId = snapshot.camp.id
    let cancelled = false
    // Pending publication bypasses submitMessage. Refresh Core's route projection
    // when a message enters the conversation, without replacing the local editor.
    void (async () => {
      const epoch = draftCoordinator.getEpoch()
      await draftCoordinator.waitForIdle()
      if (cancelled || epoch !== draftCoordinator.getEpoch()) return
      const localVersion = composerHandleRef.current?.getLocalVersion() ?? 0
      const refreshed = await draftCoordinator.load(() => !cancelled
        && composerHandleRef.current?.getLocalVersion() === localVersion
        && !composerHandleRef.current?.isDirty())
      if (cancelled || draftCampId.current !== campId
        || epoch !== draftCoordinator.getEpoch()
        || composerHandleRef.current?.getLocalVersion() !== localVersion
        || composerHandleRef.current?.isDirty()) return
      initializedComposerRoute.current = { revision: refreshed.revision, publishedMessageSequence }
    })().catch(() => { /* Keep the current Draft; the next publication or Draft mutation refreshes it. */ })
    return () => { cancelled = true }
  }, [snapshot.camp.id, publishedMessageSequence, composerDraft !== null, hasLocalDraftPayload, composerSubmitting, routingMutating])

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
      const result = await client.request<CampMessageFindSnapshot>(
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
        const around = await client.request<CampMessageAroundSnapshot>(
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
  }, [client, focusConversationFindInput, snapshot.camp.id])

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
        anchor
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
      if (event.defaultPrevented || event.isComposing || isFileFindTarget(event.target)) return
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

  const mutateRoutingDraft = async (
    mutation: () => Promise<CampComposerDraftView>
  ): Promise<CampComposerDraftView> => {
    const composerHandle = composerHandleRef.current
    if (!composerHandle || draftLoadState.state !== 'ready') {
      throw new Error('Composer Draft 尚未就绪。')
    }
    routingMutatingRef.current = true
    setRoutingMutating(true)
    composerHandle.setInteractionLocked(true)
    let before: Awaited<ReturnType<StructuredMentionComposerHandle['flush']>> | null = null
    try {
      before = await composerHandle.flush()
      const nextDraft = await mutation()
      if (!composerDocumentsEqualDirect(before.document, nextDraft.content)) {
        composerHandle.replaceDocument(nextDraft.content, 'end')
      }
      return nextDraft
    } catch (error) {
      const refreshedDraft = draftCoordinator.getCurrentDraft()
      if (
        before
        && refreshedDraft
        && !composerDocumentsEqualDirect(before.document, refreshedDraft.content)
      ) {
        composerHandle.replaceDocument(refreshedDraft.content, 'end')
      }
      throw error
    } finally {
      composerHandle.setInteractionLocked(false)
      routingMutatingRef.current = false
      setRoutingMutating(false)
    }
  }

  const focusComposerAtBoundary = (
    _modality: ReplyFocusModality,
    boundary: 'start' | 'end'
  ): void => {
    window.requestAnimationFrame(() => {
      composerHandleRef.current?.focus(boundary)
    })
  }

  const startReply = async (
    message: CampMessageView,
    modality: ReplyFocusModality
  ): Promise<void> => {
    if (
      message.id.startsWith('optimistic:')
      || routingMutatingRef.current
      || composerSubmittingRef.current
      || draftLoadState.state !== 'ready'
    ) return
    setReplyInteractionError(null)
    try {
      const draft = await mutateRoutingDraft(() => draftCoordinator.startReply(message))
      if (composerDraftNeedsReplyRepair(draft)) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => recipientRepairFirstOptionRef.current?.focus())
        })
      } else {
        focusComposerAtBoundary(modality, 'end')
      }
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    }
  }

  const cancelReply = async (focusBoundary: 'start' | 'end' = 'end'): Promise<void> => {
    if (
      routingMutatingRef.current
      || composerSubmittingRef.current
      || draftLoadState.state !== 'ready'
    ) return
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft(() => draftCoordinator.cancelReply())
      focusComposerAtBoundary('keyboard', focusBoundary)
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    }
  }

  const resolveReplyRecipient = async (recipient: CampComposerReplyRecipient): Promise<void> => {
    if (
      routingMutatingRef.current
      || composerSubmittingRef.current
      || draftLoadState.state !== 'ready'
    ) return
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft(() => draftCoordinator.resolveReplyRecipient(recipient))
      focusComposerAtBoundary('keyboard', 'end')
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    }
  }

  const dismissContinuation = async (restoreFocus = true): Promise<void> => {
    const intent = draftCoordinator.getCurrentDraft()?.continuationIntent
    if (
      !intent
      || routingMutatingRef.current
      || composerSubmittingRef.current
      || draftLoadState.state !== 'ready'
    ) return
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft(() =>
        draftCoordinator.dismissContinuation(intent.sourceCampMessageId))
      if (restoreFocus) focusComposerAtBoundary('keyboard', 'end')
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
    }
  }

  const resolveContinuationRecipient = async (agentId: string): Promise<void> => {
    if (
      routingMutatingRef.current
      || composerSubmittingRef.current
      || draftLoadState.state !== 'ready'
    ) return
    setReplyInteractionError(null)
    try {
      await mutateRoutingDraft(() => draftCoordinator.resolveContinuationRecipient(agentId))
      focusComposerAtBoundary('keyboard', 'end')
    } catch (error) {
      setReplyInteractionError(replyDraftErrorMessage(error))
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

  const revealQuote = async (quote: MessageQuoteSnapshot): Promise<void> => {
    const campId = snapshot.camp.id
    if (quote.source.scope !== 'camp' || quote.source.campId !== campId) throw new Error('quote.owner_mismatch')
    const messageId = quote.source.messageId
    setConversationView('conversation')
    setQuoteSourceId(messageId)
    let source = visibleMessageById.get(messageId)
    if (!source) {
      const messages = replyAnchorWindows.get(messageId) ?? await loadReplyAnchorWindow(messageId)
      if (activeCampIdRef.current !== campId) return
      source = messages?.find(message => message.id === messageId)
      if (!source || !messages) throw new Error('quote.source_unavailable')
      setAnchoredMessages(current => [...new Map([...current, ...messages].map(message => [message.id, message])).values()])
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (activeCampIdRef.current !== campId) return
    const target = timelineScrollRef.current?.querySelector<HTMLElement>(`[data-message-quote-body="${CSS.escape(messageId)}"][data-quote-owner="camp:${CSS.escape(campId)}"]`)
    if (!target) throw new Error('quote.source_unavailable')
    await revealMessageQuote(quote, target, source.authorType === 'user' ? source.body.replace(/\r\n/gu, '\n') : undefined)
  }

  const revealReplyParent = async (messageId: string): Promise<void> => {
    setConversationView('conversation')
    const existing = timelineScrollRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(messageId)}"]`
    )
    if (existing) {
      existing.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
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
        target?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        target?.focus({ preventScroll: true })
      })
    })
  }

  useLayoutEffect(() => {
    const campId = snapshot.camp.id
    setQuoteSourceId(null)
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
    // Each Camp owns an independent local editor. The persisted record is only
    // a local Composer capability; Core Draft/Pending state is not recreated.
    const epoch = draftCoordinator.beginEpoch(campId)
    let cancelled = false
    setDraftLoadState({ state: 'loading' })
    setComposerPersistenceError(null)
    setComposerLocalStatus({
      hasContent: false,
      hasExplicitRecipient: false,
      hasUnavailableAtom: false
    })
    initializedComposerRoute.current = null
    setPreparingAttachments([])
    setFailedAttachments([])
    setAttachmentDragState(null)
    setAnchoredMessages([])
    setReplyAnchorWindows(new Map())
    replyAnchorLoads.current.clear()
    setReplyInteractionError(null)
    autoSuppressedContinuationSourceRef.current = null
    draftCampId.current = campId
    void draftCoordinator.load().then((entryDraft) => {
      if (cancelled || draftCoordinator.getEpoch() !== epoch || draftCampId.current !== campId) return
      initializedComposerRoute.current = {
        revision: entryDraft.revision,
        publishedMessageSequence
      }
      setDraftLoadState({ state: 'ready' })
      onInitialComposerDraftConsumed?.(entryDraft)
    }).catch((error) => {
      if (cancelled || draftCoordinator.getEpoch() !== epoch || draftCampId.current !== campId) return
      setDraftLoadState({
        state: 'error',
        error: error instanceof Error ? error : new Error(readErrorMessage(error))
      })
    })
    return () => { cancelled = true }
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
    if (!notificationFocus?.active || ['approval', 'single_chat'].includes(notificationFocus.kind)) return
    setConversationView('conversation')
    if (notificationFocus.kind === 'task' && notificationFocus.subjectId) {
      setFocusedTaskId(notificationFocus.subjectId)
      setTaskFocusRequest(notificationFocus.requestId)
      openInspector('tasks')
      return
    }
    if (notificationFocus.kind !== 'agent_run' || !notificationFocus.agentRunId) return
    if (preparedNotificationAgentRunRequest.current === notificationFocus.requestId) return
    const run = snapshot.agentRuns.find((candidate) => candidate.id === notificationFocus.agentRunId)
    if (!run) return
    preparedNotificationAgentRunRequest.current = notificationFocus.requestId
    executionEntryInteractionCampId.current = snapshot.camp.id
    if (executionPlacement === 'inspector') {
      setExecutionInspectorActive(true)
      onOpenInspector?.(inspectorTab)
    } else if (executionPlacement === 'right') {
      filePreview?.openExecution()
    }
    setExecutionDrawerAgentId(run.agentId)
    setExecutionDrawerFocusedRunId(run.id)
    setExecutionDrawerFocusRequest((request) => ({
      sequence: request.sequence + 1,
      moveDomFocus: true
    }))
  }, [executionPlacement, filePreview, inspectorTab, notificationFocus, onOpenInspector, snapshot.agentRuns, snapshot.camp.id])

  useEffect(() => {
    if (!notificationFocus?.active || notificationFocus.kind === 'single_chat') return undefined
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
          behavior: prefersReducedMotion()
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
      if (notificationFocus.kind === 'task' || notificationFocus.kind === 'mission') {
        const id = notificationFocus.subjectId
        const target = id ? document.querySelector<HTMLElement>(notificationFocus.kind === 'task'
          ? `.task-detail[data-task-id="${CSS.escape(id)}"]`
          : `.mission-intro[data-mission-id="${CSS.escape(id)}"]`) : null
        if (target && target.getClientRects().length > 0) presentTarget(target)
        else frame = window.requestAnimationFrame(present)
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
      if (notificationFocus.kind === 'agent_run') {
        const runId = notificationFocus.agentRunId
        const target = runId
          ? executionDrawerPortal?.querySelector<HTMLElement>(
              `[data-agent-run-id="${CSS.escape(runId)}"]`
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
  }, [executionDrawerPortal, notificationFocus, onNotificationFocusPresented, snapshot.messages, snapshot.agentRuns])

  const flushTimelineReadingPosition = useCallback((campId?: string): void => {
    if (timelinePositionSaveTimer.current !== null) {
      window.clearTimeout(timelinePositionSaveTimer.current)
      timelinePositionSaveTimer.current = null
    }
    const current = timelineReadingPosition.current
    if (!current || (campId && current.campId !== campId)) return
    rememberCampTimelineReadingPosition(current.campId, current.position)
  }, [])

  const recordTimelineReadingPosition = useCallback((
    campId: string,
    scroll: HTMLElement
  ): void => {
    const layout = timelineLayoutAnchorRef.current
    const width = timelineViewportWidth(scroll)
    if (layout?.campId === campId && (
      layout.hidden || layout.width !== width || !scroll.clientHeight
      || (Math.abs(layout.scrollTop - scroll.scrollTop) <= 1
        && timelineReadingPosition.current?.position.followingLatest === false)
    )) return
    if (width > 0 && scroll.clientHeight > 0 && (
      !layout || layout.campId !== campId
      || (!layout.hidden && layout.width === width && Math.abs(layout.scrollTop - scroll.scrollTop) > 1)
    )) {
      timelineLayoutAnchorRef.current = {
        campId, width, hidden: false, scrollTop: scroll.scrollTop,
        anchor: captureTimelineReadingAnchor(scroll)
      }
    }
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
      if (current) rememberCampTimelineReadingPosition(current.campId, current.position)
    }, 180)
  }, [conversationFind.open])

  const captureFilePreviewAnchor = useCallback((source?: HTMLElement): void => {
    const scroll = timelineScrollRef.current
    if (!scroll || !scroll.clientWidth) return
    timelineLayoutAnchorRef.current = {
      campId: snapshot.camp.id, width: timelineViewportWidth(scroll), hidden: false, scrollTop: scroll.scrollTop,
      anchor: captureTimelineReadingAnchor(scroll, source)
    }
  }, [snapshot.camp.id])

  const openSkillPreview = useCallback((skillId: string, source: HTMLElement): void => {
    if (!filePreview) return
    captureFilePreviewAnchor(source)
    void filePreview.open({
      kind: 'skill_reference',
      campId: snapshot.camp.id,
      skillId,
      rawReference: 'SKILL.md'
    }).then((outcome) => {
      if (outcome.kind === 'error') notifyError?.(outcome.error.message)
    })
  }, [captureFilePreviewAnchor, filePreview, notifyError, snapshot.camp.id])

  const restoreTimelineLayout = useCallback((): void => {
    const scroll = timelineScrollRef.current
    if (!scroll) return
    const campId = snapshot.camp.id
    const saved = timelineLayoutAnchorRef.current
    const width = timelineViewportWidth(scroll)
    if (!width || !scroll.clientHeight) {
      if (saved?.campId === campId) saved.hidden = true
      return
    }
    const current = timelineReadingPosition.current
    const followingLatest = current?.campId !== campId || current.position.followingLatest !== false
    if (followingLatest) {
      scroll.scrollTop = scroll.scrollHeight
    } else if (saved?.campId === campId && (saved.hidden || saved.width !== width)) {
      restoreTimelineReadingAnchor(scroll, saved.anchor)
    }
    timelineLayoutAnchorRef.current = {
      campId, width, hidden: false, scrollTop: scroll.scrollTop,
      anchor: saved?.campId === campId && !followingLatest ? saved.anchor : captureTimelineReadingAnchor(scroll)
    }
    timelineReadingPosition.current = { campId, position: { scrollTop: scroll.scrollTop, followingLatest } }
    timelineViewportGeometry.current = {
      campId, geometry: { scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight }
    }
    timelineVisibleAnchorRef.current = visibleTimelineMessageAnchor(scroll)
  }, [snapshot.camp.id])

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
    rememberCampTimelineReadingPosition(campId, position)
  }, [])

  useLayoutEffect(() => {
    const campId = snapshot.camp.id
    if (conversationView === 'conversation') {
      const scroll = timelineScrollRef.current
      if (scroll) {
        const current = timelineReadingPosition.current?.campId === campId
          ? timelineReadingPosition.current.position
          : rememberedCampTimelineReadingPosition(campId)
        const scrollTop = restoredCampTimelineScrollTop(
          current,
          scroll.scrollHeight,
          scroll.clientHeight
        )
        scroll.scrollTop = scrollTop
        timelineLayoutAnchorRef.current = {
          campId, width: timelineViewportWidth(scroll), hidden: false, scrollTop,
          anchor: captureTimelineReadingAnchor(scroll)
        }
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

  useLayoutEffect(restoreTimelineLayout, [conversationView, filePreview?.paneVisible, restoreTimelineLayout])

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
      restoreTimelineLayout()
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      if (settleFrame !== null) window.cancelAnimationFrame(settleFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        settleFrame = window.requestAnimationFrame(() => {
          settleFrame = null
          const latest = timelineReadingPosition.current
          if (latest?.campId !== campId || latest.position.followingLatest !== false) {
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
  }, [conversationView, restoreTimelineLayout, snapshot.camp.id])

  useEffect(() => {
    if (!onVisibleNotificationSources) return undefined
    let frame: number | null = null
    const publish = (): void => {
      frame = null
      const timeline = timelineScrollRef.current
      const campForeground = !singleChatVisible
        && document.visibilityState === 'visible'
        && document.hasFocus()
      const canObserveConversation = campForeground
        && conversationView === 'conversation'
        && timeline !== null
        && !timeline.hidden
      const messageIds = new Set<string>()
      const campTurnIds = new Set<string>()
      const agentRunIds = new Set<string>()
      const approvalIds = new Set<string>()
      if (canObserveConversation && timeline) {
        const viewport = timeline.getBoundingClientRect()
        for (const node of timeline.querySelectorAll<HTMLElement>('[data-message-id]')) {
          if (!node.getClientRects().length || !rectanglesOverlap(node.getBoundingClientRect(), viewport)) continue
          const messageId = node.dataset.messageId
          const campTurnId = node.dataset.campTurnId
          if (messageId) messageIds.add(messageId)
          if (campTurnId && !node.classList.contains('user')) campTurnIds.add(campTurnId)
        }
        const approvalNode = approvalDockRef.current?.querySelector<HTMLElement>(
          '[data-approval-id]'
        ) ?? null
        if (approvalNode && approvalNode.getClientRects().length > 0 && rectanglesOverlap(approvalNode.getBoundingClientRect(), {
          top: 0,
          right: window.innerWidth,
          bottom: window.innerHeight,
          left: 0
        })) {
          const approvalId = approvalNode.dataset.approvalId
          if (approvalId) approvalIds.add(approvalId)
        }
      }
      if (campForeground) {
        for (const node of executionDrawerPortal?.querySelectorAll<HTMLElement>(
          '.execution-drawer [data-agent-run-id]'
        ) ?? []) {
          const viewport = node.closest<HTMLElement>('.execution-drawer-body')
          if (!viewport || !node.getClientRects().length || viewport.hidden) continue
          if (!rectanglesOverlap(node.getBoundingClientRect(), viewport.getBoundingClientRect())) continue
          const agentRunId = node.dataset.agentRunId
          if (agentRunId) agentRunIds.add(agentRunId)
        }
      }
      const sources: VisibleNotificationSources = {
        campId: snapshot.camp.id,
        surfaceVisible: canObserveConversation || agentRunIds.size > 0,
        snapshotSequence: snapshot.throughGlobalSequence,
        messageIds: [...messageIds].sort(),
        campTurnIds: [...campTurnIds].sort(),
        agentRunIds: [...agentRunIds].sort(),
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
    const workspace = workspaceShellRef.current
    const resizeObserver = new ResizeObserver(schedule)
    const observeExecutionDrawer = (): void => {
      if (!executionDrawerPortal) return
      resizeObserver.observe(executionDrawerPortal)
      const drawer = executionDrawerPortal.querySelector<HTMLElement>('.execution-drawer')
      if (drawer) resizeObserver.observe(drawer)
    }
    const observer = new MutationObserver(() => {
      observeExecutionDrawer()
      schedule()
    })
    if (timeline) observer.observe(timeline, { subtree: true, childList: true, attributes: true })
    if (approvalDockRef.current) observer.observe(approvalDockRef.current, { subtree: true, childList: true, attributes: true })
    if (bottomExecutionDrawerHostRef.current) observer.observe(bottomExecutionDrawerHostRef.current, { subtree: true, childList: true, attributes: true })
    if (inspectorExecutionDrawerHostRef.current) observer.observe(inspectorExecutionDrawerHostRef.current, { subtree: true, childList: true, attributes: true })
    if (executionDrawerPortal) observer.observe(executionDrawerPortal, { subtree: true, childList: true, attributes: true })
    observeExecutionDrawer()
    schedule()
    timeline?.addEventListener('scroll', schedule, { passive: true })
    workspace?.addEventListener('scroll', schedule, {
      capture: true,
      passive: true
    })
    executionDrawerPortal?.addEventListener('scroll', schedule, {
      capture: true,
      passive: true
    })
    window.addEventListener('resize', schedule)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      observer.disconnect()
      resizeObserver.disconnect()
      timeline?.removeEventListener('scroll', schedule)
      workspace?.removeEventListener('scroll', schedule, true)
      executionDrawerPortal?.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [
    conversationView,
    executionDrawerAgentId,
    executionDrawerFocusedRunId,
    executionDrawerPortal,
    executionPlacement,
    executionPreviewHost,
    filePreview?.activeTab?.id,
    filePreview?.paneVisible,
    inspectorVisible,
    singleChatVisible,
    onVisibleNotificationSources,
    snapshot.approvals,
    snapshot.camp.id,
    snapshot.messages,
    snapshot.throughGlobalSequence
  ])

  const submitMessage = async (): Promise<void> => {
    if (
      composerSendDisabled
      || composerSubmittingRef.current
      || routingMutatingRef.current
    ) return
    const campId = snapshot.camp.id
    const composerHandle = composerHandleRef.current
    if (!composerHandle) return
    followTimelineAfterUserSend(campId)
    composerSubmittingRef.current = true
    setComposerSubmitting(true)
    let restoreEditorFocus = true
    composerHandle.setInteractionLocked(true)
    try {
      await attachmentPreparationQueue.current
      const flushed = await composerHandle.flush()
      const frozenDraft = flushed.draft ?? draftCoordinator.getCurrentDraft()
      if (!frozenDraft) throw new Error('Composer Draft 尚未就绪。')
      const routedDraft = materializeLocalContinuation(frozenDraft, snapshot.members)
      const sendReceipt = await onSend(routedDraft)
      if (!sendReceipt) throw new Error('消息未被当前 Camp 接受。')
      if (mountedCampId.current === campId
        && (sendReceipt.deliveryIds.length || sendReceipt.agentRunIds.length)) {
        setSubmittedExecutionRequests((current) => [...current, sendReceipt])
      }
      try {
        const discardAttachments = client.composerAttachments.discard?.(
          campId,
          frozenDraft.attachments.map(({ id }) => id)
        )
        if (discardAttachments) await discardAttachments.catch(() => undefined)
        const nextDraft = nextLocalCampComposerDraftAfterSend({
          sent: routedDraft,
          campMessageId: sendReceipt.campMessageId,
          addressedAgentIds: sendReceipt.addressedAgentIds,
          members: snapshot.members
        })
        if (draftCampId.current === campId) {
          draftCoordinator.acceptAuthoritativeDraft(nextDraft)
          initializedComposerRoute.current = {
            revision: nextDraft.revision,
            publishedMessageSequence: Math.max(
              publishedMessageSequence,
              sendReceipt.publishedMessageSequence ?? 0
            )
          }
          composerHandle.replaceDocument(nextDraft.content, 'end')
          setComposerPersistenceError(null)
          setDraftLoadState({ state: 'ready' })
        } else {
          saveLocalCampComposerDraft(nextDraft)
        }
      } catch (error) {
        if (draftCampId.current === campId) {
          restoreEditorFocus = false
          composerLockAwaitingDisabledCommitRef.current = true
          setDraftLoadState({
            state: 'error',
            error: error instanceof Error ? error : new Error(readErrorMessage(error))
          })
        }
        throw error
      }
    } catch {
      // onSend owns send failure presentation. A post-send Draft load failure is
      // represented by draftLoadState and recovered only through an explicit reload.
    } finally {
      if (!composerLockAwaitingDisabledCommitRef.current) {
        composerHandle.setInteractionLocked(false)
      }
      composerSubmittingRef.current = false
      setComposerSubmitting(false)
      if (restoreEditorFocus) {
        window.requestAnimationFrame(() => composerHandleRef.current?.focus('end'))
      }
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void submitMessage()
  }

  const prepareFiles = async (inputs: AttachmentPreparationInput[]): Promise<void> => {
    if (
      draftLoadState.state !== 'ready'
      || composerSubmittingRef.current
      || routingMutatingRef.current
    ) return
    const campId = snapshot.camp.id
    const pending = inputs.map(({ file, kindHint }, index) => ({
      id: newCommandId(),
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
      try {
        await composerHandleRef.current?.flush()
      } catch (error) {
        if (draftCampId.current === campId) {
          setFailedAttachments((current) => [
            ...current,
            ...pending.map((item) => ({
              id: item.id,
              name: item.file.name,
              kind: item.kind,
              error: attachmentErrorMessage(error)
            }))
          ])
        }
        setPreparingAttachments((current) => current.filter(
          ({ id }) => !pending.some((item) => item.id === id)
        ))
        return
      }
      for (const item of pending) {
        try {
          await draftCoordinator.addSourceAttachment(item.file)
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

  const attachmentDropBlocked = attachmentDropIsBlocked({
    executionDrawerPresent: Boolean(executionDrawerProcess),
    mentionPopoverPresent: Boolean(mentionPopover)
  }) || composerInteractionDisabled

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
    if (inputs.length === 0) return
    void prepareFiles(inputs)
  }

  useEffect(() => {
    if (attachmentDropBlocked) clearAttachmentDragState()
  }, [attachmentDropBlocked])

  useEffect(() => () => {
    if (dragLeaveTimer.current !== null) window.clearTimeout(dragLeaveTimer.current)
    if (dragActivityTimer.current !== null) window.clearTimeout(dragActivityTimer.current)
  }, [])

  const removePreparedAttachment = async (attachmentId: string): Promise<void> => {
    if (
      composerInteractionDisabled
      || composerSubmittingRef.current
      || routingMutatingRef.current
    ) return
    await composerHandleRef.current?.flush()
    await draftCoordinator.removeSourceAttachment(attachmentId)
  }

  const copyMessage = (
    id: string,
    body: string,
    content: StructuredCampMessageContent | null
  ): void => {
    const structuredClipboard = createStructuredMessageClipboardData(content, composerMembers, currentUserName)
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

  const confirmMessageWithdrawal = async (): Promise<void> => {
    if (!withdrawalMessage || withdrawingMessageId || !onWithdrawMessage) return
    const message = withdrawalMessage
    setWithdrawingMessageId(message.id)
    setWithdrawalError(null)
    try {
      await onWithdrawMessage(message)
      setWithdrawalMessage(null)
      onNotify('消息已撤回')
    } catch (error) {
      setWithdrawalError(readErrorMessage(error, '撤回失败，请重试。'))
    } finally {
      setWithdrawingMessageId(null)
    }
  }

  const chooseStarterPrompt = (prompt: string, announceDraft = false): void => {
    composerHandleRef.current?.setDocument(composerDocumentFromText(prompt), 'end')
    if (announceDraft) setStarterNotice('内容已填入，可编辑后发送。')
  }

  const selectInspectorTab = (tab: CampInspectorTab): void => {
    if (controlledInspectorTab === undefined) setLocalInspectorTab(tab)
    onInspectorTabChange?.(tab)
  }

  const rememberExecutionReadingPosition = (): ExecutionConsoleReadingPosition | null => {
    const position = captureExecutionConsoleReadingPosition(
      executionDrawerPortal?.querySelector<HTMLElement>('.execution-drawer') ?? null,
      executionReadingPosition.current
    )
    executionReadingPosition.current = position
    return position
  }

  const restoreExecutionReadingPositionAfterLayout = (
    position: ExecutionConsoleReadingPosition | null
  ): void => {
    if (!position || !executionDrawerPortal) return
    if (executionReadingRestoreFrames.current) {
      window.cancelAnimationFrame(executionReadingRestoreFrames.current[0])
      window.cancelAnimationFrame(executionReadingRestoreFrames.current[1])
    }
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        executionReadingRestoreFrames.current = null
        restoreExecutionConsoleReadingPosition(
          executionDrawerPortal.querySelector<HTMLElement>('.execution-drawer'),
          position
        )
      })
      executionReadingRestoreFrames.current = [firstFrame, secondFrame]
    })
    executionReadingRestoreFrames.current = [firstFrame, firstFrame]
  }

  const captureExecutionPlacementMenuReadingPosition = (): void => {
    const position = executionReadingPosition.current
      ?? captureExecutionConsoleReadingPosition(
        executionDrawerPortal?.querySelector<HTMLElement>('.execution-drawer') ?? null
      )
    executionPlacementMenuReadingPosition.current = position
    executionReadingPosition.current = position
  }

  const trackExecutionPlacementMenu = (open: boolean): void => {
    if (open && executionPlacementMenuReadingPosition.current === null) {
      captureExecutionPlacementMenuReadingPosition()
    }
  }

  const selectInspectorSurfaceTab = (tab: CampInspectorSurfaceTab): void => {
    if (tab === 'execution') {
      setExecutionInspectorActive(true)
      restoreExecutionReadingPositionAfterLayout(executionReadingPosition.current)
      return
    }
    if (executionPlacement === 'inspector' && executionInspectorActive) {
      rememberExecutionReadingPosition()
      executionDrawerPortal
        ?.querySelector<HTMLElement>('.execution-drawer-body')
        ?.removeAttribute('data-execution-reading-intent')
    }
    setExecutionInspectorActive(false)
    selectInspectorTab(tab)
  }

  const closeMobileSecondaryPanel = (): void => {
    onCloseSingleChat()
    if (mobilePrimaryView.current === 'execution') {
      selectInspectorSurfaceTab('execution')
      onOpenInspector?.(inspectorTab)
    } else {
      onCloseInspector()
    }
    detailEntryHost?.querySelector<HTMLButtonElement>('.mobile-camp-more')?.focus({ preventScroll: true })
  }

  const openInspector = (tab: CampInspectorTab): void => {
    setExecutionInspectorActive(false)
    selectInspectorTab(tab)
    onOpenInspector?.(tab)
  }

  const focusPlacementButton = (placement: ExecutionConsolePlacement): void => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const target = placement === 'right'
          ? rightPlacementButtonRef.current
          : placement === 'inspector'
            ? inspectorPlacementButtonRef.current
            : bottomPlacementButtonRef.current
        target?.focus({ preventScroll: true })
      })
    })
  }

  const moveExecution = async (target: ExecutionConsolePlacement): Promise<void> => {
    if (!executionPlacementChangeShouldStart(
      executionPlacement,
      target,
      executionPlacementRequest.current
    )) return
    executionPlacementRequest.current = true
    setExecutionPlacementPending(true)
    setExecutionPlacementError(null)
    const readingPosition = executionPlacementMenuReadingPosition.current
      ?? executionReadingPosition.current
      ?? captureExecutionConsoleReadingPosition(
        executionDrawerPortal?.querySelector<HTMLElement>('.execution-drawer') ?? null,
        executionReadingPosition.current
      )
    executionPlacementMenuReadingPosition.current = null
    try {
      const confirmedPlacement = await onExecutionPlacementChange(target)
      if (!executionPlacementMounted.current) return
      if (confirmedPlacement && confirmedPlacement !== target) {
        throw new Error('保存后的执行台位置与请求不一致')
      }
      executionReadingPosition.current = readingPosition
      pendingExecutionReadingPosition.current = readingPosition
      if (target === 'inspector') {
        const executionTab = filePreview?.tabs.find((tab) => tab.kind === 'execution')
        if (executionTab) filePreview?.close(executionTab.id)
        setExecutionInspectorActive(true)
        onOpenInspector?.(inspectorTab)
      } else if (target === 'right') {
        setExecutionInspectorActive(false)
        onCloseInspector()
        filePreview?.openExecution()
      } else {
        const executionTab = filePreview?.tabs.find((tab) => tab.kind === 'execution')
        if (executionTab) filePreview?.close(executionTab.id)
        setExecutionInspectorActive(false)
        onCloseInspector()
      }
      focusPlacementButton(target)
    } catch (nextError) {
      if (!executionPlacementMounted.current) return
      setExecutionPlacementError({
        message: executionPlacementSaveFailureMessage(executionPlacement),
        detail: readErrorMessage(nextError, null),
        target
      })
    } finally {
      executionPlacementRequest.current = false
      if (executionPlacementMounted.current) setExecutionPlacementPending(false)
    }
  }

  const loadEarlierMessages = async (): Promise<void> => {
    if (
      !onLoadEarlierMessages
      || !messageHistory?.hasEarlier
      || earlierMessageLoadInFlightRef.current
    ) return
    const timeline = timelineScrollRef.current
    if (!timeline) return
    const campId = snapshot.camp.id
    const readingAnchor = captureTimelineReadingAnchor(timeline)
    const previousScrollHeight = timeline.scrollHeight
    const previousScrollTop = timeline.scrollTop
    earlierMessageLoadInFlightRef.current = true
    setEarlierMessageStatus('loading')
    try {
      await onLoadEarlierMessages()
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve())
        })
      })

      if (
        timelineScrollRef.current === timeline
        && mountedCampId.current === campId
        && !timeline.hidden
        && !conversationFindOpenRef.current
      ) {
        if (readingAnchor.source || readingAnchor.message) {
          restoreTimelineReadingAnchor(timeline, readingAnchor)
        } else {
          timeline.scrollTop = previousScrollTop + timeline.scrollHeight - previousScrollHeight
        }
        recordTimelineReadingPosition(campId, timeline)
      }
      setEarlierMessageStatus('idle')
    } catch {
      setEarlierMessageStatus(mountedCampId.current === campId ? 'error' : 'idle')
    } finally {
      earlierMessageLoadInFlightRef.current = false
    }
  }

  const maybeLoadEarlierFromUserInput = (): void => {
    const timeline = timelineScrollRef.current
    if (
      !timeline
      || conversationView !== 'conversation'
      || conversationFindOpenRef.current
      || earlierMessageStatus !== 'idle'
      || !messageHistory?.hasEarlier
      || timeline.scrollTop > CAMP_HISTORY_AUTOLOAD_THRESHOLD_PX
    ) return

    void loadEarlierMessages()
  }

  const checkHistoryAfterUserInput = (): void => {
    window.requestAnimationFrame(maybeLoadEarlierFromUserInput)
  }

  const openExecutionProcess = (
    agentId: string,
    trigger: HTMLButtonElement | null = null,
    options: { runId?: string | null; moveDomFocus?: boolean; reveal?: boolean; entryInteraction?: boolean } = {}
  ): void => {
    const process = executionProcessByAgentId.get(agentId)
    if (!process) return
    if (options.entryInteraction !== false) executionEntryInteractionCampId.current = snapshot.camp.id
    if (executionPlacement === 'inspector' && options.reveal !== false) {
      setExecutionInspectorActive(true)
      onOpenInspector?.(inspectorTab)
    } else if (executionPlacement === 'right' && options.reveal !== false) {
      filePreview?.openExecution()
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

  const openExecutionOverview = (
    trigger: HTMLButtonElement | null = null,
    moveDomFocus = true
  ): void => {
    executionEntryInteractionCampId.current = snapshot.camp.id
    if (executionPlacement === 'inspector') {
      setExecutionInspectorActive(true)
      onOpenInspector?.(inspectorTab)
    } else if (executionPlacement === 'right') {
      filePreview?.openExecution()
    }
    if (trigger) executionDrawerTriggerRef.current = trigger
    executionDrawerReturnAgentIdRef.current = EXECUTION_OVERVIEW_SCOPE
    setExecutionDrawerAgentId(EXECUTION_OVERVIEW_SCOPE)
    setExecutionDrawerFocusedRunId(null)
    setExecutionDrawerFocusRequest((request) => ({
      sequence: request.sequence + 1,
      moveDomFocus
    }))
  }

  const closeExecutionProcess = (): void => {
    executionEntryInteractionCampId.current = snapshot.camp.id
    setExecutionDrawerAgentId(null)
    setExecutionDrawerFocusedRunId(null)
  }

  useEffect(() => {
    const submittedExecutionRequest = submittedExecutionRequests[0]
    if (!submittedExecutionRequest) return
    const consumeRequest = (): void => { setSubmittedExecutionRequests((current) => current.slice(1)) }
    if (suppressExecutionAutoOpen) { consumeRequest(); return }
    if (taskCreationBlocksSubmittedRunAutoFocus(
      taskCreationActive,
      inspectorVisible,
      inspectorSurfaceTab
    )) {
      consumeRequest()
      return
    }
    const targetRun = firstSubmittedAgentRun(submittedExecutionRequest, snapshot.agentRuns)
    if (!targetRun) return
    consumeRequest()
    if (executionConsoleIsVisible(
      executionPlacement,
      inspectorVisible,
      inspectorSurfaceTab,
      Boolean(
        filePreview?.paneVisible
        && filePreview.activeTab?.kind === 'execution'
      )
    ) && isViewingNonTerminalAgentRun(
      executionDrawerAgentId,
      executionDrawerFocusedRunId,
      snapshot.agentRuns
    )) return
    openExecutionProcess(targetRun.agentId, null, {
      runId: targetRun.id,
      moveDomFocus: false,
      reveal: !mobile,
      entryInteraction: false
    })
  }, [
    executionDrawerAgentId,
    executionDrawerFocusedRunId,
    executionPlacement,
    inspectorSurfaceTab,
    inspectorVisible,
    filePreview,
    snapshot.agentRuns,
    submittedExecutionRequests,
    mobile,
    taskCreationActive,
    suppressExecutionAutoOpen
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
      overview={executionDrawerOverview}
      memberFast={memberFast}
      member={memberById.get(executionDrawerProcess.agentId) ?? null}
      profile={executionDrawerProfile}
      installation={executionDrawerInstallation}
      turns={snapshot.turns}
      messages={visibleCampMessages}
      deliveries={snapshot.messageDeliveries}
      progressByRunId={executionProgressByRunId}
      windowedEvidence={openCoverage !== null}
      executionEventsByRunId={executionEventsByRunId}
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
      onCancelAgentRun={onCancelAgentRun}
      memberById={memberById}
      onRevealMessage={(messageId) => void revealReplyParent(messageId)}
      onFileOpenError={notifyError}
    />
  ) : null
  const rightExecutionVisible = executionPlacement === 'right'
    && Boolean(filePreview?.paneVisible && filePreview.activeTab?.kind === 'execution')

  return (
    <section ref={workspaceShellRef} className="workspace-shell camp-workspace" data-mobile-panel={mobile && inspectorVisible ? inspectorSurfaceTab : undefined} data-mobile-execution-maximized={mobile && mobileExecutionMaximized || undefined} aria-label={`会话：${formatCampTitle(snapshot.camp)}`}>
      <FilePreviewWorkspace
      >
        <RevealNotificationConversation active={!!notificationFocus?.active
          && ['camp_message', 'camp_turn', 'mission', 'task'].includes(notificationFocus.kind)}
          onHidePreview={filePreview?.hidePane} />
        <section
          className="timeline-pane"
          tabIndex={-1}
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
              {worldMapEnabled && (
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
              )}
            </div>
            <div
              className="timeline-scroll camp-timeline"
              ref={timelineScrollRef}
              tabIndex={-1}
              aria-label="对话时间线"
              hidden={conversationView !== 'conversation'}
              onWheelCapture={(event) => {
                captureFilePreviewAnchor()
                if (event.deltaY < 0) checkHistoryAfterUserInput()
              }}
              onTouchStartCapture={() => captureFilePreviewAnchor()}
              onKeyDownCapture={(event) => {
                if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
                  captureFilePreviewAnchor()
                }
                if (campHistoryKeyboardInputMovesEarlier(event.key, event.shiftKey)) {
                  checkHistoryAfterUserInput()
                }
              }}
              onScroll={(event) => recordTimelineReadingPosition(
                snapshot.camp.id,
                event.currentTarget
              )}
            >
              <div className="timeline-track">
              {missionBoard}
              {!conversationFind.open && messageHistory?.hasEarlier && (
                <div
                  className={`camp-history-loader is-${earlierMessageStatus}`}
                  role={earlierMessageStatus === 'error' ? 'alert' : 'status'}
                  aria-live={earlierMessageStatus === 'error' ? 'assertive' : 'polite'}
                  aria-atomic="true"
                >
                  {earlierMessageStatus === 'error' ? (
                    <>
                      <span className="camp-history-error-message">较早消息暂时没有加载</span>
                      <span className="camp-history-separator" aria-hidden="true">·</span>
                      <button
                        className="camp-history-text-button"
                        type="button"
                        onClick={() => void loadEarlierMessages()}
                      >
                        重试
                      </button>
                    </>
                  ) : (
                    <button
                      className="camp-history-text-button"
                      type="button"
                      disabled={earlierMessageStatus === 'loading'}
                      onClick={() => void loadEarlierMessages()}
                    >
                      {earlierMessageStatus === 'loading' ? (
                        <>
                          <span className="camp-history-spinner" aria-hidden="true" />
                          <span>正在加载更早消息…</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">↑</span>
                          <span>加载更早消息</span>
                        </>
                      )}
                    </button>
                  )}
                  <span className="camp-history-separator" aria-hidden="true">·</span>
                  <span className="camp-history-count">
                    已显示 {messageHistory.loadedCount} / {messageHistory.totalCount} 条
                  </span>
                </div>
              )}
              {(() => {
                const items: JSX.Element[] = []
                let lastDayKey = ''
                let previousMessageAuthorKey: string | null = null
                for (let timelineIndex = 0; timelineIndex < conversationTimeline.length; timelineIndex += 1) {
                  const timelineItem = conversationTimeline[timelineIndex]
                  const dayKey = localDayKey(timelineItem.createdAt)
                  if (dayKey && dayKey !== lastDayKey) {
                    lastDayKey = dayKey
                    previousMessageAuthorKey = null
                    items.push(
                      <div className="timeline-node timeline-day" key={`day-${dayKey}-${timelineItem.id}`}>
                        {timelineDayLabel(timelineItem.createdAt)}
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
                  if (timelineItem.kind === 'run_artifacts') {
                    previousMessageAuthorKey = null
                    const { run, imageGroups, fileChanges } = timelineItem
                    const member = memberById.get(run.agentId)
                    const profile = profileById.get(run.agentId)
                    const author = member?.displayName ?? profile?.displayName ?? run.agentId
                    const canInspect = Boolean(member && profile
                      && member.membershipStatus === 'active' && member.profilePresence !== 'removed')
                    const authorPart = (variant: 'avatar' | 'name'): JSX.Element => {
                      const content = variant === 'avatar'
                        ? <MemberAvatar agentId={run.agentId} avatarRef={member?.avatarRef ?? profile?.avatarRef ?? null}
                            displayName={author} size="list" decorative />
                        : <strong>{author}</strong>
                      return canInspect
                        ? <MessageAuthorProfileTrigger agentId={run.agentId} displayName={author}
                            variant={variant} onActivate={openMemberProfilePopover}>{content}</MessageAuthorProfileTrigger>
                        : content
                    }
                    items.push(
                      <section className="agent-message-output run-artifact-output" key={timelineItem.id}
                        data-run-artifact-output-id={run.id} data-camp-turn-id={run.campTurnId}
                        aria-label={`${author}的运行产物`}>
                        <div className="timeline-node conversation-bubble agent"
                          style={{ '--agent-accent': identityColorToken(run.agentId) } as CSSProperties}>
                          {authorPart('avatar')}
                          <div className="message-body">
                            <div className="bubble-meta">
                              {authorPart('name')}
                              {profile?.runtimeConfiguration && <span>{runtimeAdapterLabel(profile.runtimeConfiguration.adapterKind)}</span>}
                              <time>{messageClockTime(run.endedAt ?? timelineItem.createdAt)}</time>
                            </div>
                            {imageGroups.length > 0 && (
                              <section className="message-attachments agent-message-outputs" aria-label="Agent 输出图片">
                                <div className="agent-output-images">
                                  <ImageGallery images={imageGroups.flatMap((group) => group.images.map((image) => ({
                                    kind: 'runtime' as const, campId: snapshot.camp.id, image
                                  })))} />
                                </div>
                              </section>
                            )}
                          </div>
                        </div>
                        {fileChanges.map((changes) => (
                          <AgentRunFileChangesTimelineCard key={`${changes.agentRunId}:${changes.executionEpoch}`}
                            changes={changes} onOpenReview={(selectedEvidenceFileId) => {
                              return filePreview?.openFileChanges(snapshot.camp.id, changes, selectedEvidenceFileId)
                            }} onOpenCurrent={(evidenceFileId) => openCurrentAgentRunFile(changes, evidenceFileId)} />
                        ))}
                      </section>
                    )
                    continue
                  }
                  if (timelineItem.kind === 'run_images') {
                    previousMessageAuthorKey = null
                    items.push(
                      <div className="timeline-node conversation-bubble runtime-image-supplement" key={timelineItem.id}>
                        <div className="message-body">
                          <ImageGallery images={timelineItem.images.images.map((image) => ({ kind: 'runtime', campId: snapshot.camp.id, image }))} />
                        </div>
                      </div>
                    )
                    continue
                  }
                  if (timelineItem.kind === 'run_file_changes') {
                    previousMessageAuthorKey = null
                    items.push(
                      <AgentRunFileChangesTimelineCard
                        key={timelineItem.id}
                        changes={timelineItem.changes}
                        onOpenReview={(selectedEvidenceFileId) => {
                          return filePreview?.openFileChanges(snapshot.camp.id, timelineItem.changes, selectedEvidenceFileId)
                        }}
                        onOpenCurrent={(evidenceFileId) => openCurrentAgentRunFile(timelineItem.changes, evidenceFileId)}
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
                  if (campMessage.withdrawn) {
                    previousMessageAuthorKey = null
                    items.push(
                      <div
                        className="timeline-node withdrawn-message-event"
                        key={campMessage.id}
                        role="status"
                        aria-label={`你撤回了第${campMessage.sequence}条消息`}
                      >
                        <span>你撤回了一条消息</span>
                        <time>{messageClockTime(campMessage.createdAt)}</time>
                      </div>
                    )
                    continue
                  }
                  const member = memberById.get(campMessage.authorId)
                  const author = campMessageAuthorLabel(campMessage, memberById, currentUserName)
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
                  const humanAuthored = campMessage.authorType === 'user'
                    || campMessage.authorType === 'external_principal'
                  const defaultRecipientAgentId = defaultRecipientMentionAgentId(campMessage)
                  const runtimeImages = timelineItem.runtimeImageGroups.flatMap((group) => group.images)
                  const messageAuthorKey = campMessage.authorType === 'user'
                    || campMessage.authorType === 'agent'
                    || campMessage.authorType === 'external_principal'
                    ? `${campMessage.authorType}:${campMessage.authorId}`
                    : null
                  const followsSameAuthor = messageAuthorKey !== null
                    && previousMessageAuthorKey === messageAuthorKey
                  const previousItem = conversationTimeline[timelineIndex - 1]
                  const nextItem = conversationTimeline[timelineIndex + 1]
                  const groupingMessage = (message: CampMessageView): CampMessageView => ({
                    ...message,
                    campTurnId: message.campTurnId
                      ?? (message.sourceAgentRunId ? runById.get(message.sourceAgentRunId)?.campTurnId : null)
                      ?? null
                  })
                  const isGroupContinuation = previousItem?.kind === 'camp_message'
                    && shortPublicMessages.has(previousItem.message.id)
                    && samePublicMessageSegment(groupingMessage(previousItem.message), groupingMessage(campMessage))
                  const joinsNextMessage = nextItem?.kind === 'camp_message'
                    && shortPublicMessages.has(campMessage.id)
                    && samePublicMessageSegment(groupingMessage(campMessage), groupingMessage(nextItem.message))
                  const campMessageDeliveries = snapshot.messageDeliveries.filter((delivery) =>
                    delivery.deliveryKind === 'public_a2a'
                    && delivery.messageId === campMessage.id
                  )
                  const userMessageRuns = campMessage.authorType === 'user'
                    ? snapshot.agentRuns.filter((run) =>
                        (run.inputMessageIds ?? []).includes(campMessage.id)
                      )
                    : []
                  const replyParentId = campMessage.replyToCampMessageId
                  const replyParent = replyParentId ? replyParentById.get(replyParentId) ?? null : null
                  const replyParentUnavailable = Boolean(
                    replyParentId
                    && replyAnchorWindows.has(replyParentId)
                    && replyAnchorWindows.get(replyParentId) === null
                  )
                  const isConversationFindCurrent = conversationFind.open
                    && conversationFind.snapshot?.match?.messageId === campMessage.id
                  const trailingFileChangeItems: Extract<
                    CampConversationTimelineItem,
                    { kind: 'run_file_changes' }
                  >[] = []
                  if (campMessage.authorType === 'agent' && campMessage.sourceAgentRunId) {
                    for (
                      let nextIndex = timelineIndex + 1;
                      nextIndex < conversationTimeline.length;
                      nextIndex += 1
                    ) {
                      const candidate = conversationTimeline[nextIndex]
                      if (
                        candidate.kind !== 'run_file_changes'
                        || candidate.changes.agentRunId !== campMessage.sourceAgentRunId
                      ) break
                      trailingFileChangeItems.push(candidate)
                    }
                  }
                  const copied = copiedMessageId === campMessage.id
                  const handleReply = campMessage.id.startsWith('optimistic:')
                    ? undefined
                    : (modality: ReplyFocusModality) => void startReply(campMessage, modality)
                  const handleCopy = (): void => copyMessage(
                    campMessage.id,
                    displayBody.trim() ? displayBody : [
                      ...campMessage.attachments.map(attachment => attachment.displayName),
                      ...runtimeImages.map(image => image.displayName)
                    ].join('\n'),
                    campMessage.content
                  )
                  const messageClasses = [
                    'timeline-node conversation-bubble', campMessage.authorType,
                    campMessage.authorType === 'agent' && 'public-agent-message',
                    followsSameAuthor && 'same-author',
                    isGroupContinuation && 'is-group-continuation',
                    joinsNextMessage && 'joins-next-message',
                    isConversationFindCurrent && 'conversation-find-current-message'
                  ].filter(Boolean).join(' ')
                  const messageElement = (
                    <article
                      className={messageClasses}
                      key={campMessage.id}
                      data-message-id={campMessage.id}
                      data-camp-turn-id={campMessage.campTurnId ?? sourceRun?.campTurnId}
                      aria-label={`${author}，${messageClockTime(campMessage.createdAt)}，第${campMessage.sequence}条消息`}
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
                      {(campMessage.authorType === 'user' || campMessage.authorType === 'external_principal') && (
                        <button
                          type="button"
                          className="message-author-trigger message-author-avatar-trigger current-user-profile-trigger"
                          aria-label={`查看${currentUserDisplayName(currentUserProfile)}的个人资料`}
                          aria-haspopup="dialog"
                          aria-expanded={false}
                          onClick={(event) => openCurrentUserProfilePopover(event.currentTarget, event.detail === 0)}
                        >
                          <CurrentUserAvatar profile={currentUserProfile} className="local-message-avatar" />
                        </button>
                      )}
                      {campMessage.authorType === 'agent' && (
                        <time className="message-continuation-time" aria-hidden="true">
                          {messageClockTime(campMessage.createdAt)}
                        </time>
                      )}
                      {(campMessage.authorType === 'user'
                        || campMessage.authorType === 'agent'
                        || campMessage.authorType === 'external_principal')
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
                              <div className="public-message-readout">
                              <MessageSurface
                                copied={copied}
                                hasDelivery={campMessage.authorType === 'agent' && campMessageDeliveries.length > 0}
                                showActions={campMessage.authorType !== 'agent'}
                                actionBefore={campMessage.authorType === 'user' ? (
                                  <UserMessageDeliveryReceipt
                                    message={campMessage}
                                    runs={userMessageRuns}
                                    memberById={memberById}
                                    onOpenExecution={(run, trigger) => openExecutionProcess(
                                      run.agentId,
                                      trigger,
                                      { runId: run.id }
                                    )}
                                    onWithdraw={campMessage.canWithdraw && onWithdrawMessage
                                      ? () => {
                                          setWithdrawalError(null)
                                          setWithdrawalMessage(campMessage)
                                        }
                                      : undefined}
                                  />
                                ) : undefined}
                                onReply={humanAuthored ? undefined : handleReply}
                                onCopy={handleCopy}
                              >
                                <MessageQuotes history quotes={campMessage.quotes ?? []} onReveal={revealQuote} />
                                {replyParentId && (
                                  <ReplyParentQuote
                                    parent={replyParent}
                                    projectedBody={replyParent?.content
                                      ? structuredCampContentPlainText(replyParent.content, snapshot.members, currentUserName)
                                      : replyParent?.body ?? ''}
                                    authorLabel={replyParent
                                      ? campMessageAuthorLabel(replyParent, memberById, currentUserName)
                                      : null}
                                    unavailable={replyParentUnavailable}
                                    loading={!replyParent && !replyParentUnavailable}
                                    onReveal={() => void revealReplyParent(replyParentId)}
                                  />
                                )}
                                {humanAuthored && (
                                  <MessageAttachmentGroups
                                    attachments={campMessage.attachments}
                                    campId={snapshot.camp.id}
                                    messageId={campMessage.id}
                                    presentation="user"
                                    onNotify={onNotify}
                                  />
                                )}
                                {(displayBody.trim().length > 0 || defaultRecipientAgentId !== null) && (
                                  campMessage.authorType === 'agent'
                                  && !campMessage.content?.some((segment) =>
                                    segment.kind === 'current_user_mention'
                                  )
                                    ? (
                                        <div className="final-copy" data-message-quote-body={campMessage.id} data-quote-owner={`camp:${snapshot.camp.id}`}>
                                          <AgentMessageMarkdownBody
                                            body={displayBody}
                                            content={campMessage.content}
                                            members={snapshot.members}
                                            onActivateMemberMention={openMemberProfilePopover}
                                            onFileReference={(rawReference, source, target) => {
                                              if (!filePreview) return
                                              captureFilePreviewAnchor(source)
                                              void filePreview.open({
                                                kind: 'message_reference',
                                                campId: snapshot.camp.id,
                                                messageId: campMessage.id,
                                                rawReference
                                              }, target).then((outcome) => {
                                                if (outcome.kind === 'error') onNotify(outcome.error.message)
                                              })
                                            }}
                                          />
                                        </div>
                                      )
                                    : (
                                        <div className="message-bubble" data-message-quote-body={campMessage.authorType === 'user' || campMessage.authorType === 'agent' ? campMessage.id : undefined} data-quote-owner={`camp:${snapshot.camp.id}`}>
                                          <TruncatedStructuredMessageBody
                                            body={displayBody}
                                            content={campMessage.content}
                                            members={snapshot.members}
                                            leadingRecipientAgentId={defaultRecipientAgentId}
                                            truncate={humanAuthored}
                                            forceExpanded={isConversationFindCurrent || quoteSourceId === campMessage.id}
                                            renderLeadingCurrentUserMarkdown={campMessage.authorType === 'agent'}
                                            onActivateCurrentUserMention={openCurrentUserProfilePopover}
                                            onActivateMemberMention={openMemberProfilePopover}
                                            onActivateAllMembersMention={(trigger, focusPanel) =>
                                              openAllMembersMentionPopover(
                                                'history',
                                                campMessage.addressedAgentIds,
                                                trigger,
                                                focusPanel
                                              )}
                                            onActivateSkillMention={openSkillPreview}
                                            onFileReference={(rawReference, source, target) => {
                                              if (!filePreview) return
                                              captureFilePreviewAnchor(source)
                                              void filePreview.open({
                                                kind: 'message_reference',
                                                campId: snapshot.camp.id,
                                                messageId: campMessage.id,
                                                rawReference
                                              }, target).then((outcome) => {
                                                if (outcome.kind === 'error') onNotify(outcome.error.message)
                                              })
                                            }}
                                          />
                                        </div>
                                      )
                                )}
                                {!humanAuthored && (
                                  <MessageAttachmentGroups
                                    attachments={campMessage.attachments}
                                    runtimeImages={runtimeImages.map((image) => ({
                                      kind: 'runtime',
                                      campId: snapshot.camp.id,
                                      image
                                    }))}
                                    campId={snapshot.camp.id}
                                    messageId={campMessage.id}
                                    presentation="agent"
                                    onNotify={onNotify}
                                  />
                                )}
                              </MessageSurface>
                              {campMessage.authorType === 'agent' && (
                                <CampMessageDeliveryFooter
                                  deliveries={campMessageDeliveries}
                                  memberById={memberById}
                                  onActivateMemberMention={openMemberProfilePopover}
                                />
                              )}
                              {campMessage.authorType === 'agent'
                                && trailingFileChangeItems.length === 0
                                && (
                                  <MessageActions
                                    copied={copied}
                                    className={`agent-message-actions${campMessage.id === latestAgentMessageId ? ' is-persistent' : ''}`}
                                    onReply={handleReply}
                                    onCopy={handleCopy}
                                  />
                                )}
                              </div>
                            </div>
                          )
                        : (
                            <MessageSurface copied={copied} hasDelivery={false} onCopy={handleCopy}>
                              <div className="system-message-card">
                                <div className="system-message-meta">
                                  <NavigationIcon name="cpu" />
                                  <span>系统</span>
                                  <time dateTime={campMessage.createdAt} title={`#${campMessage.sequence}`}>
                                    {messageClockTime(campMessage.createdAt)}
                                  </time>
                                </div>
                                <p>{displayBody}</p>
                              </div>
                            </MessageSurface>
                          )}
                    </article>
                  )
                  if (trailingFileChangeItems.length > 0) {
                    items.push(
                      <div
                        className={`agent-message-output public-message-output${followsSameAuthor ? ' same-author' : ''}${isGroupContinuation ? ' is-group-continuation' : ''}`}
                        data-message-output-id={campMessage.id}
                        key={`agent-message-output:${campMessage.id}`}
                      >
                        {messageElement}
                        {trailingFileChangeItems.map((fileChangeItem) => (
                          <AgentRunFileChangesTimelineCard
                            key={fileChangeItem.id}
                            changes={fileChangeItem.changes}
                            onOpenReview={(selectedEvidenceFileId) => {
                              return filePreview?.openFileChanges(
                                snapshot.camp.id,
                                fileChangeItem.changes,
                                selectedEvidenceFileId
                              )
                            }}
                            onOpenCurrent={(evidenceFileId) => openCurrentAgentRunFile(
                              fileChangeItem.changes,
                              evidenceFileId
                            )}
                          />
                        ))}
                        <MessageActions
                          copied={copied}
                          className={`agent-message-output-actions${campMessage.id === latestAgentMessageId ? ' is-persistent' : ''}`}
                          onReply={handleReply}
                          onCopy={handleCopy}
                        />
                      </div>
                    )
                    timelineIndex += trailingFileChangeItems.length
                    previousMessageAuthorKey = null
                    continue
                  }
                  items.push(messageElement)
                  previousMessageAuthorKey = messageAuthorKey
                }
                return items
              })()}
              {!missionBoard && conversationTimeline.length === 0 && snapshot.agentRuns.length === 0 && (
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
            <ReturnToLatest
              viewportRef={timelineScrollRef}
              ownerKey={snapshot.camp.id}
              contentRevision={publishedMessageSequence}
              scope="camp"
              enabled={conversationView === 'conversation' && !conversationFind.open}
              onLatest={() => followTimelineAfterUserSend(snapshot.camp.id)}
            />
            {worldMapEnabled && (
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
            )}
            {snapshot.camp.activationState === 'active' && <CampDetailPopover
              entryHost={detailEntryHost}
              activeTab={inspectorSurfaceTab}
              visible={inspectorVisible}
              showExecution={executionPlacement !== 'bottom'}
              executionExpanded={executionPlacement === 'inspector'
                ? inspectorVisible && inspectorSurfaceTab === 'execution'
                : rightExecutionVisible}
              mobileExecutionMaximized={mobileExecutionMaximized}
              onToggleMobileExecutionMaximized={mobile ? () => setMobileExecutionMaximized((expanded) => !expanded) : undefined}
              runningMembers={runningMembers}
              executionCount={executionProcesses.length}
              taskCount={openCoverage?.tasks.totalCount ?? snapshot.tasks.length}
              memberCount={campInspectorMembers(snapshot.members).length}
              singleChatVisible={singleChatVisible}
              onOpenSingleChat={onOpenSingleChat}
              onOpenMissionActivity={mobile && snapshot.camp.missionId && filePreview ? () => {
                onCloseInspector(); onCloseSingleChat()
                filePreview.openMissionActivity(snapshot.camp.missionId!)
              } : undefined}
              onOpen={(tab) => {
                if (tab === 'execution' && executionPlacement === 'right') {
                  onCloseInspector()
                  if (executionDrawerAgentId === null) openExecutionOverview(null, false)
                  else filePreview?.openExecution()
                  return
                }
                selectInspectorSurfaceTab(tab)
                onOpenInspector?.(tab === 'execution' ? inspectorTab : tab)
              }}
              onClose={mobile && inspectorSurfaceTab !== 'execution' ? closeMobileSecondaryPanel : onCloseInspector}
            >
            <section className="camp-detail-content execution-sidecar-panel" hidden={inspectorSurfaceTab !== 'execution'}>
              {executionPlacement === 'inspector' && (
                <RunPulse
                  key={snapshot.camp.id}
                  placement="inspector"
                  placementButtonRef={inspectorPlacementButtonRef}
                  processes={executionProcesses}
                  memberById={memberById}
                  stopping={stopping}
                  selectedAgentId={executionDrawerAgentId}
                  railActive={inspectorVisible && inspectorSurfaceTab === 'execution'}
                  revealRequest={executionDrawerFocusRequest.sequence}
                  onOpen={openExecutionProcess}
                  onOpenOverview={openExecutionOverview}
                  onClose={closeExecutionProcess}
                  onPlacementMenuIntent={captureExecutionPlacementMenuReadingPosition}
                  onPlacementMenuOpenChange={trackExecutionPlacementMenu}
                  onMovePlacement={moveExecution}
                  placementPending={executionPlacementPending}
                  placementError={executionPlacementError}
                />
              )}
              <div
                ref={inspectorExecutionDrawerHostRef}
                className="execution-sidecar-detail execution-drawer-host execution-drawer-host-inspector"
              >
                {!executionDrawerPortal && executionPlacement === 'inspector' && executionDrawer}
                {executionPlacement === 'inspector' && !executionDrawer && (
                  <div className="execution-sidecar-empty">
                    {executionProcesses.length > 0 ? '选择一位队员，查看连续执行历史。' : <>
                      <span>暂无执行记录</span>
                      <button
                        ref={inspectorPlacementButtonRef}
                        className="quiet-button compact"
                        type="button"
                        disabled={executionPlacementPending}
                        onClick={() => void moveExecution('bottom')}
                      >{executionPlacementPending ? '正在保存…' : '移到底部'}</button>
                      {executionPlacementError && <span role="alert">{executionPlacementError.message}</span>}
                    </>}
                  </div>
                )}
              </div>
            </section>
            <section className="camp-detail-content tab-scroll task-panel-scroll" hidden={inspectorSurfaceTab !== 'tasks'}>
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
            </section>
            <section className="camp-detail-content tab-scroll camp-members-panel" hidden={inspectorSurfaceTab !== 'members'}>
              <CampMembersPanel key={snapshot.camp.id}
                memberFast={memberFast}
                snapshot={snapshot}
                profileById={profileById}
                installations={installations}
                busy={busy}
                onChangeLead={onChangeLead}
                onAddMembers={onAddMembers}
                onPreviewMemberRemoval={onPreviewMemberRemoval}
                onRemoveMember={onRemoveMember}
                onNotify={onNotify}
              />
            </section>
            </CampDetailPopover>}
            {snapshot.camp.activationState === 'active' && (
              <SingleChatPanel
                onLeaveGuardChange={bindSingleChatLeaveGuard}
                target={singleChatTarget}
                notificationFocus={notificationFocus?.kind === 'single_chat' ? notificationFocus : null}
                onNotificationFocusPresented={onNotificationFocusPresented}
                onVisibleNotificationSources={onVisibleSingleChatSources}
                profileById={profileById}
                busy={busy}
                onResolveApproval={onResolveApproval}
                campId={snapshot.camp.id}
                members={snapshot.members}
                entryHost={detailEntryHost}
                visible={singleChatVisible}
                onOpen={onOpenSingleChat}
                onClose={mobile ? closeMobileSecondaryPanel : onCloseSingleChat}
                onNotify={onNotify}
              />
            )}
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
              onOpenOverview={openExecutionOverview}
              onClose={closeExecutionProcess}
              onPlacementMenuIntent={captureExecutionPlacementMenuReadingPosition}
              onPlacementMenuOpenChange={trackExecutionPlacementMenu}
              onMovePlacement={moveExecution}
              placementPending={executionPlacementPending}
              placementError={executionPlacementError}
            />
          )}
          <div
            ref={bottomExecutionDrawerHostRef}
            className="execution-drawer-host execution-drawer-host-bottom"
          >
            {!executionDrawerPortal && executionPlacement === 'bottom' && executionDrawer}
          </div>
        </section>

        {filePreview ? (
          <>
            <FilePreviewResizeHandle onClose={filePreview.hidePane} />
            <FilePreviewPane tabsInPane={previewTabsInPane} />
          </>
        ) : null}

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
          attachmentDragState ? 'is-dragging-attachments' : ''
        ].filter(Boolean).join(' ')}
        onSubmit={(event) => void submit(event)}
      >
        <div>
        <div className="composer-route-slot">
        {draftLoadState.state === 'loading' && (
          <div className="composer-route-rail" aria-label="正在加载接收者路由" aria-busy="true">
            <span className="composer-route-placeholder" aria-hidden="true"><span /><span /></span>
          </div>
        )}
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
                          disabled={composerInteractionDisabled}
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
                        <span>{defaultLead
                          ? <>默认由队长 <strong>@{defaultLead.displayName}</strong> 接收</>
                          : recipientSummary}</span>
                      </span>
                    )}
              </div>
            )
          : null}
        </div>
        <MessageQuoteSelectionToolbar
          ownerKey={`camp:${snapshot.camp.id}`}
          messages={visibleCampMessages}
          disabled={composerInteractionDisabled}
          onAdd={async (selection) => { await mutateRoutingDraft(() => draftCoordinator.mutateQuote({ type: 'add', selection })) }}
        />
        <div className="composer-box">
          {attachmentDragState && (
            <span className="composer-destination">将添加到这条消息</span>
          )}
          <div className="composer-input">
            {(composerDraft?.attachments.length ?? 0) > 0
              || preparingAttachments.length > 0
              || failedAttachments.length > 0
              ? (
                  <ComposerAttachmentStrip>
                    {composerDraft?.attachments.map((attachment) => (
                      <AttachmentCard
                        attachment={attachment}
                        locator={{
                          owner: 'composer',
                          campId: snapshot.camp.id,
                          attachmentRefId: attachment.id
                        }}
                        key={attachment.id}
                        onRemove={() => void removePreparedAttachment(attachment.id)}
                        presentation="composer"
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
                  </ComposerAttachmentStrip>
                )
              : null}
            {composerDraft?.replyIntent && (
              <div className="composer-reply-region">
                <div
                  className={`composer-reply-line${replyRepairRequired ? ' needs-repair' : ''}`}
                  title={`${composerDraft.replyIntent.author?.displayName ?? '引用消息'} · ${composerDraft.replyIntent.excerpt ?? '引用的消息当前不可用'}`}
                >
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
                    disabled={composerInteractionDisabled}
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
                            <span>请取消引用后再发送，当前输入会继续保留。</span>
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
                                  disabled={composerInteractionDisabled}
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
                                disabled={composerInteractionDisabled}
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
                    当前输入与附件会继续保留；只有你显式选择新接收者后才能发送。
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
                        disabled={composerInteractionDisabled}
                        onClick={() => void resolveContinuationRecipient(member.agentId)}
                      >
                        @{member.displayName}
                      </button>
                    ))}
                </div>
              </div>
            )}
            {draftLoadState.state === 'error' && (
              <div className="reply-recipient-repair composer-draft-load-error" role="alert">
                <div className="reply-recipient-repair-copy">
                  <strong>输入框无法初始化</strong>
                  <span>{draftLoadState.error.message}</span>
                </div>
                <button
                  className="quiet-button compact"
                  type="button"
                  onClick={() => void retryComposerDraftLoad()}
                >
                  重新初始化
                </button>
              </div>
            )}
            <MessageQuotes key={snapshot.camp.id} quotes={composerDraft?.quotes ?? []}
              disabled={composerInteractionDisabled}
              onReveal={revealQuote}
              onEmptyFocus={() => composerEditorRef.current?.focus()}
              onMutate={async (action) => { await mutateRoutingDraft(() => draftCoordinator.mutateQuote(action)) }} />
            <StructuredMentionComposer
              ref={composerHandleRef}
              id="camp-message"
              draftIdentity={`${snapshot.camp.id}:composer`}
              document={composerDraft?.campId === snapshot.camp.id
                ? composerDraft.content
                : emptyComposerDocument()}
              ready={draftLoadState.state === 'ready'
                && composerDraft?.campId === snapshot.camp.id}
              getAuthoritativeDraft={() => draftCoordinator.getCurrentDraft()}
              persistDocument={(content) => saveStructuredDraft(snapshot.camp.id, content)}
              waitForDraftAuthority={() => draftCoordinator.waitForIdle().then(() => undefined)}
              onLocalStatusChange={setComposerLocalStatus}
              onPersistenceErrorChange={setComposerPersistenceError}
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
              skillCatalogErrors={composerSkillCatalog.candidates.errors}
              skillCatalogRefreshing={skillCatalogRefreshing}
              onRefreshSkills={() => refreshSkillCatalogRef.current?.()}
              ariaLabel={`给 ${defaultLead?.displayName ?? '默认负责人'} 发消息`}
              placeholder={draftLoadState.state === 'error'
                ? '输入框暂不可用'
                : isCampEmpty
                  ? '集结队伍，写下这次冒险的目标…'
                  : '和队伍继续前行：补充线索、调整方向或布置新任务…'}
              disabled={composerInteractionDisabled}
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
              onActivateSkillMention={openSkillPreview}
            />
            {unlistedSkillName && (
              <span className="composer-reply-status" role="status" aria-live="polite">
                {unlistedSkillName} 的来源当前不在候选中，仍可发送。
              </span>
            )}
            {!composerDraft?.replyIntent && replyInteractionError && (
              <span className="composer-reply-status" role="status" aria-live="polite">
                {replyInteractionError}
              </span>
            )}
            {composerPersistenceError && (
              <span className="composer-reply-status" role="status" aria-live="polite">
                本机草稿保存失败；当前窗口内内容仍保留。{composerPersistenceError.message}
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
                disabled={composerInteractionDisabled}
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
                disabled={busy || composerInteractionDisabled}
                onClick={() => composerFileInputRef.current?.click()}
              >
                <svg aria-hidden="true" viewBox="0 0 18 18">
                  <path d="m6.2 9.8 4.65-4.65a2.5 2.5 0 0 1 3.54 3.54l-6.1 6.1a4 4 0 0 1-5.66-5.66l6.1-6.1" />
                </svg>
              </button>
              {mobile && <button className="composer-attachment-button" type="button" aria-label="提及队员" disabled={busy || composerInteractionDisabled} onPointerDown={(event) => event.preventDefault()} onClick={() => composerHandleRef.current?.startMention()}>@</button>}
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
              <ComposerPrimaryAction
                action="send"
                type="submit"
                disabled={composerSendDisabled}
                busy={Boolean(busy || composerSubmitting || preparingAttachments.length > 0)}
              />
            </div>
          </div>
        </div>
        </div>
          </form>
        </div>
        {attachmentDragState && (
          <div
            className={`conversation-drop-layer ${
              executionDrawerProcess && executionPlacement === 'bottom'
                ? 'has-bottom-execution-drawer'
                : ''
            }`.trim()}
            aria-hidden="true"
          >
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
                    ? '将引用此文件夹的当前位置，不会移动原文件'
                    : '支持文件与文件夹 · 原位置移动或删除后可能不可用'}
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
      </FilePreviewWorkspace>
      {mentionPopover && (
        <MentionProfilePopover
          request={mentionPopover}
          members={snapshot.members}
          profiles={agents}
          onClose={closeMentionPopover}
        />
      )}
      {executionPlacement === 'right' && executionPreviewHost && createPortal(
        <>
          {executionProcesses.length > 0 && <RunPulse
            key={snapshot.camp.id}
            placement="right"
            placementButtonRef={rightPlacementButtonRef}
            processes={executionProcesses}
            memberById={memberById}
            stopping={stopping}
            selectedAgentId={executionDrawerAgentId}
            revealRequest={executionDrawerFocusRequest.sequence}
            onOpen={openExecutionProcess}
            onOpenOverview={openExecutionOverview}
            onClose={closeExecutionProcess}
            onPlacementMenuIntent={captureExecutionPlacementMenuReadingPosition}
            onPlacementMenuOpenChange={trackExecutionPlacementMenu}
            onMovePlacement={moveExecution}
            placementPending={executionPlacementPending}
            placementError={executionPlacementError}
          />}
          {!executionDrawer && (
            <div className="execution-sidecar-empty execution-preview-empty">
              {executionProcesses.length > 0 ? '选择一位队员，查看连续执行历史。' : '暂无执行记录'}
            </div>
          )}
        </>,
        executionPreviewHost
      )}
      {executionDrawerPortal && createPortal(executionDrawer, executionDrawerPortal)}
      <Dialog.Root
        open={withdrawalMessage !== null}
        onOpenChange={(open) => {
          if (!open && !withdrawingMessageId) {
            setWithdrawalMessage(null)
            setWithdrawalError(null)
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="message-withdraw-dialog" tone="danger" width="compact">
            <AppDialogHeader
              icon="warning"
              title="撤回这条消息？"
              description="所有接收队员尚未领取，可直接撤回。"
              closeDisabled={withdrawingMessageId !== null}
            />
            {withdrawalError && <AppDialogBody>
              <p className="message-withdraw-error" role="alert">{withdrawalError}</p>
            </AppDialogBody>}
            <AppDialogFooter>
              <button
                className="quiet-button"
                type="button"
                aria-label="取消撤回"
                disabled={withdrawingMessageId !== null}
                onClick={() => {
                  setWithdrawalMessage(null)
                  setWithdrawalError(null)
                }}
              >取消</button>
              <button
                className="danger-button"
                type="button"
                aria-label="确认撤回消息"
                disabled={withdrawingMessageId !== null}
                onClick={() => void confirmMessageWithdrawal()}
              >{withdrawingMessageId ? '正在撤回…' : '撤回'}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
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

type RunPulseStateShape = ExecutionStatusShape

function runPulseStateShape(run: AgentRunView, stopping: boolean): RunPulseStateShape {
  if (stopping && NON_TERMINAL_RUNS.has(run.status)) return 'cancelling'
  if (run.status === 'running') return 'running'
  if (run.status === 'queued') return 'queued'
  if (run.status === 'waiting') return 'waiting'
  if (run.status === 'succeeded') return 'completed'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'cancelled') return 'stopped'
  return 'recorded'
}

function runPulseProcessState(
  process: AgentExecutionProcess,
  stopping: boolean
): {
  run: AgentRunView | null
  label: string
  tone: 'info' | 'attention' | 'success' | 'danger' | 'neutral'
  shape: RunPulseStateShape
} {
  const run = preferredAgentProcessRun(process.runs)
  if (run && NON_TERMINAL_RUNS.has(run.status)) {
    const presentation = agentRunPresentation(run, stopping && NON_TERMINAL_RUNS.has(run.status))
    return { run, label: presentation.label, tone: presentation.tone, shape: runPulseStateShape(run, stopping) }
  }
  if (process.waitingDeliveries.length > 0) {
    return { run: null, label: '排队中', tone: 'attention', shape: 'queued' }
  }
  if (run) {
    const presentation = agentRunPresentation(run)
    return { run, label: presentation.label, tone: presentation.tone, shape: runPulseStateShape(run, false) }
  }
  return { run: null, label: '暂无执行', tone: 'neutral', shape: 'recorded' }
}

function RunPulse({
  placement,
  placementButtonRef,
  processes,
  memberById,
  stopping,
  selectedAgentId,
  railActive = true,
  revealRequest = 0,
  onOpen,
  onOpenOverview,
  onClose,
  onPlacementMenuIntent,
  onPlacementMenuOpenChange,
  onMovePlacement,
  placementPending,
  placementError
}: {
  placement: ExecutionConsolePlacement
  placementButtonRef: RefObject<HTMLButtonElement | null>
  processes: AgentExecutionProcess[]
  memberById: Map<string, CampSnapshot['members'][number]>
  stopping: boolean
  selectedAgentId: string | null
  railActive?: boolean
  revealRequest?: number
  onOpen(agentId: string, trigger: HTMLButtonElement): void
  onOpenOverview(trigger: HTMLButtonElement): void
  onClose(): void
  onPlacementMenuIntent(): void
  onPlacementMenuOpenChange(open: boolean): void
  onMovePlacement(target: ExecutionConsolePlacement): Promise<void>
  placementPending: boolean
  placementError: { message: string; detail: string | null; target: ExecutionConsolePlacement } | null
}): JSX.Element {
  const visibleProcesses = processes.slice().sort((left, right) => {
    const leftPosition = memberById.get(left.agentId)?.memberOrder ?? Number.MAX_SAFE_INTEGER
    const rightPosition = memberById.get(right.agentId)?.memberOrder ?? Number.MAX_SAFE_INTEGER
    return leftPosition - rightPosition || left.agentId.localeCompare(right.agentId)
  })
  const activeProcessCount = visibleProcesses.filter((process) =>
    process.runs.some(agentRunCountsAsExecuting) || process.waitingDeliveries.length > 0
  ).length
  if (visibleProcesses.length === 0) return <></>
  const placementLabel = placement === 'right'
    ? '固定到右侧'
    : placement === 'inspector'
      ? '浮层'
      : '底部'
  return (
    <div className={`run-pulse run-pulse-${placement}${placement === 'right' ? ' run-pulse-inspector' : ''}`} aria-label="Agent 执行台">
      {placement === 'bottom' && <span className="run-pulse-bottom-caption">
        <ExecutionIcon />
        <span>执行</span>
      </span>}
      {placement !== 'bottom' ? <ExecutionAvatarRail
        items={[{
          agentId: EXECUTION_OVERVIEW_SCOPE,
          avatarRef: null,
          displayName: '总览',
          overview: true,
          statusLabel: '全部队员',
          statusTone: activeProcessCount > 0 ? 'info' : 'neutral',
          stateShape: activeProcessCount > 0 ? 'running' : 'recorded'
        }, ...visibleProcesses.flatMap(process => {
          const state = runPulseProcessState(process, stopping)
          if (!state.run && process.waitingDeliveries.length === 0) return []
          const member = memberById.get(process.agentId)
          return [{
            agentId: process.agentId,
            avatarRef: member?.avatarRef ?? null,
            displayName: member?.displayName ?? process.agentId,
            statusLabel: state.label,
            statusTone: state.tone,
            stateShape: state.shape
          }]
        })]}
        selectedAgentId={selectedAgentId}
        revealRequest={revealRequest}
        active={railActive}
        onOpen={(agentId, trigger) => {
          if (agentId === EXECUTION_OVERVIEW_SCOPE) onOpenOverview(trigger)
          else onOpen(agentId, trigger)
        }}
      /> : <ul className="run-pulse-list" aria-label="队员执行过程入口">
        <li>
          <button
            type="button"
            className={`run-pulse-chip run-pulse-overview-chip${selectedAgentId === EXECUTION_OVERVIEW_SCOPE ? ' is-selected' : ''}`}
            aria-label="打开全部队员执行总览"
            aria-pressed={selectedAgentId === EXECUTION_OVERVIEW_SCOPE}
            aria-expanded={selectedAgentId === EXECUTION_OVERVIEW_SCOPE}
            aria-controls="agent-execution-drawer"
            title="总览 · 全部队员"
            data-agent-id={EXECUTION_OVERVIEW_SCOPE}
            onClick={(event) => onOpenOverview(event.currentTarget)}
          >
            <ExecutionOverviewMark className="run-pulse-overview-mark" />
            <span className="run-pulse-chip-copy"><strong><span>总览</span></strong></span>
          </button>
        </li>
        {visibleProcesses.map((process) => {
          const state = runPulseProcessState(process, stopping)
          if (!state.run && process.waitingDeliveries.length === 0) return null
          const member = memberById.get(process.agentId)
          const memberName = member?.displayName ?? process.agentId
          return (
            <li key={process.agentId}>
              <button
                type="button"
                className={`run-pulse-chip${selectedAgentId === process.agentId ? ' is-selected' : ''}`}
                aria-label={`打开${memberName}的执行过程，${state.label}`}
                aria-pressed={selectedAgentId === process.agentId}
                aria-expanded={selectedAgentId === process.agentId}
                aria-controls="agent-execution-drawer"
                title={`${memberName} · ${state.label}`}
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
                  <strong><span>{memberName}</span></strong>
                </span>
                <span
                  className={`run-pulse-chip-state tone-${state.tone} state-${state.shape}`}
                  role="img"
                  aria-label={state.label}
                  title={state.label}
                >
                  <ExecutionStatusGlyph status={state.shape} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>}
      <div className="execution-placement-control">
        <DropdownMenu.Root onOpenChange={onPlacementMenuOpenChange}>
          <DropdownMenu.Trigger asChild>
            <button
              ref={placementButtonRef}
              className="execution-placement-button"
              type="button"
              aria-label={`切换执行台位置，当前${placementLabel}`}
              aria-busy={placementPending}
              title={placementPending ? '正在保存执行台位置' : `切换执行台位置 · ${placementLabel}`}
              disabled={placementPending}
              onPointerDownCapture={onPlacementMenuIntent}
              onKeyDownCapture={(event) => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
                  onPlacementMenuIntent()
                }
              }}
            >
              <ExecutionPlacementSwitchIcon />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="execution-placement-menu" sideOffset={6} align="end">
              <div className="execution-placement-menu-heading">切换执行台位置</div>
              {([
                ['right', '固定到右侧', '与会话并排，不遮挡正文'],
                ['inspector', '浮层', '保持会话宽度，按需展开'],
                ['bottom', '底部', '宽幅查看过程与工具输出']
              ] as const).map(([target, title, description]) => (
                <DropdownMenu.Item
                  className={`execution-placement-option${placement === target ? ' is-selected' : ''}`}
                  data-placement={target}
                  key={target}
                  disabled={placementPending}
                  onSelect={() => { void onMovePlacement(target) }}
                >
                  <ExecutionPlacementIcon target={target} />
                  <span><strong>{title}</strong><small>{description}</small></span>
                  {placement === target && <svg className="execution-placement-check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        {placementError && (
          <span className="execution-placement-feedback" role="alert" title={placementError.detail ?? undefined}>
            <span>{placementError.message}</span>
            <button type="button" onClick={() => void onMovePlacement(placementError.target)}>重试</button>
          </span>
        )}
      </div>
      {placement === 'bottom' && <button
        className="execution-bottom-collapse-button"
        type="button"
        aria-expanded={selectedAgentId !== null}
        aria-controls="agent-execution-drawer"
        aria-label={selectedAgentId === null ? '展开执行详情' : '收起执行详情'}
        onClick={(event) => {
          if (selectedAgentId === null) onOpenOverview(event.currentTarget)
          else onClose()
        }}
      >
        <span>{selectedAgentId === null ? '展开' : '收起'}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={selectedAgentId === null ? 'm5 15 7-7 7 7' : 'm5 9 7 7 7-7'} />
        </svg>
      </button>}
    </div>
  )
}

function ExecutionPlacementIcon({ target }: { target: ExecutionConsolePlacement }): JSX.Element {
  if (target === 'right') return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.5" y="3" width="15" height="14" rx="1.5" />
      <path d="M12.5 3v14" />
    </svg>
  )
  return target === 'inspector' ? (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="5" width="12" height="10" rx="1.5" />
      <path d="M6.5 7.5h7" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 15.5h13" />
      <path d="m6.5 7 3.5 3.5L13.5 7" />
    </svg>
  )
}

function ExecutionPlacementSwitchIcon(): JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 8h18M8 8v13m3-8h7m-2-2 2 2-2 2m-5 3h7m-5-2-2 2 2 2" />
  </svg>
}

type ExecutionQueueBatch = {
  agentId: string
  runs: AgentRunView[]
  createdAt: string
}

type ExecutionDeliveryQueueBatch = {
  agentId: string
  deliveries: MessageDeliveryView[]
  messageIds: string[]
  createdAt: string
}

export function executionRunInputMessageIds(
  run: AgentRunView,
  turns: CampSnapshot['turns']
): string[] {
  const sourceIds: string[] = []
  for (const messageId of run.inputMessageIds ?? []) {
    if (messageId && !sourceIds.includes(messageId)) sourceIds.push(messageId)
  }
  if (run.anchorMessageId && !sourceIds.includes(run.anchorMessageId)) {
    sourceIds.push(run.anchorMessageId)
  }
  const turn = turns.find((candidate) => candidate.id === run.campTurnId)
  if (turn?.triggerType === 'camp_message' && !sourceIds.includes(turn.triggerId)) {
    sourceIds.push(turn.triggerId)
  }
  return sourceIds
}

function executionSourceMessages(
  run: AgentRunView,
  turns: CampSnapshot['turns'],
  messageById: ReadonlyMap<string, CampMessageView>
): CampMessageView[] {
  return executionRunInputMessageIds(run, turns).flatMap((messageId) => {
    const message = messageById.get(messageId)
    return message ? [message] : []
  })
}

function executionTriggerMessage(
  run: AgentRunView,
  turns: CampSnapshot['turns'],
  messageById: ReadonlyMap<string, CampMessageView>
): CampMessageView | null {
  return executionSourceMessages(run, turns, messageById)[0] ?? null
}

export function executionMessageSummary(
  message: Pick<CampMessageView, 'body' | 'attachments'> | null,
  run: Pick<AgentRunView, 'inputSummary' | 'purpose'>
): string {
  if (run.inputSummary !== undefined) {
    return run.inputSummary || run.purpose.trim().replace(/\s+/gu, ' ') || '执行记录'
  }
  const body = message?.body.trim().replace(/\s+/gu, ' ')
  if (body) return body
  const attachment = message?.attachments[0]?.displayName
  if (attachment) return message!.attachments.length > 1
    ? `${attachment} 等 ${message!.attachments.length} 个附件`
    : attachment
  return run.purpose.trim().replace(/\s+/gu, ' ') || '执行记录'
}

export function executionEmptyStateShouldRender(
  currentEntryCount: number,
  historyRunCount: number,
  runHistoryComplete: boolean
): boolean {
  return currentEntryCount === 0 && historyRunCount === 0 && runHistoryComplete
}

export function executionQueueBatches(runs: readonly AgentRunView[]): ExecutionQueueBatch[] {
  const byAgent = new Map<string, AgentRunView[]>()
  for (const run of runs) {
    if (run.status !== 'queued') continue
    byAgent.set(run.agentId, [...(byAgent.get(run.agentId) ?? []), run])
  }
  return [...byAgent.entries()].map(([agentId, queuedRuns]) => {
    const newestFirst = queuedRuns.slice().sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
    )
    return { agentId, runs: newestFirst, createdAt: newestFirst[0]?.createdAt ?? '' }
  }).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.agentId.localeCompare(right.agentId)
  )
}

export function executionDeliveryQueueBatches(
  deliveries: readonly MessageDeliveryView[]
): ExecutionDeliveryQueueBatch[] {
  const byAgent = new Map<string, MessageDeliveryView[]>()
  for (const delivery of deliveries) {
    if (!messageDeliveryWaitsInExecutionQueue(delivery)) continue
    byAgent.set(delivery.recipientAgentId, [
      ...(byAgent.get(delivery.recipientAgentId) ?? []),
      delivery
    ])
  }
  return [...byAgent.entries()].map(([agentId, agentDeliveries]) => {
    const ordered = agentDeliveries.slice().sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )
    const messageIds = [...new Set(ordered.map((delivery) => delivery.messageId))]
    return {
      agentId,
      deliveries: ordered,
      messageIds,
      createdAt: ordered.at(-1)?.createdAt ?? ''
    }
  }).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || left.agentId.localeCompare(right.agentId)
  )
}

function executionRunDurationLabel(run: AgentRunView, now: number): string {
  const start = Date.parse(run.startedAt ?? run.createdAt)
  const end = NON_TERMINAL_RUNS.has(run.status)
    ? now
    : Date.parse(run.endedAt ?? run.updatedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return '—'
  const elapsedSeconds = Math.max(0, Math.floor((end - start) / 1_000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  if (minutes >= 60) return `${Math.floor(minutes / 60)}时 ${minutes % 60}分`
  return `${minutes}分 ${String(seconds).padStart(2, '0')}秒`
}

function ExecutionRunMetric({ run }: { run: AgentRunView }): JSX.Element {
  const live = NON_TERMINAL_RUNS.has(run.status) && run.status !== 'queued'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [live])
  return <span className={`execution-run-metric${live ? ' is-live' : ''}${run.status === 'queued' ? ' is-queued' : ''}`}>
    {run.status === 'queued' ? '排队中' : executionRunDurationLabel(run, now)}
  </span>
}

function ExecutionCardChevron({ expanded }: { expanded: boolean }): JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={expanded ? 'm5 15 7-7 7 7' : 'm5 9 7 7 7-7'} />
  </svg>
}

function ExecutionStopIcon(): JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
}

function ExecutionBatchIcon(): JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5" />
  </svg>
}

function ExecutionLocateIcon(): JSX.Element {
  return <svg className="execution-input-locate-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 11V4h16v12h-6l-4 4v-4H8M2 12h8m-3-3 3 3-3 3" />
  </svg>
}

function ExecutionInputList({
  messageIds,
  messageById,
  memberById,
  onRevealMessage
}: {
  messageIds: readonly string[]
  messageById: ReadonlyMap<string, CampMessageView>
  memberById: Map<string, CampSnapshot['members'][number]>
  onRevealMessage(messageId: string): void
}): JSX.Element {
  return <ol className="execution-input-list">
    {messageIds.map((messageId) => {
      const message = messageById.get(messageId)
      const authorMember = message?.authorType === 'agent'
        ? memberById.get(message.authorId)
        : null
      const author = message
        ? message.authorType === 'agent'
          ? authorMember?.displayName ?? message.authorId
          : '你'
        : '消息'
      const summary = message
        ? message.body || message.attachments.map((item) => item.displayName).join('、')
        : '消息内容尚未载入'
      return <li key={messageId}>
        {message?.authorType === 'agent'
          ? <MemberAvatar agentId={message.authorId} avatarRef={authorMember?.avatarRef ?? null}
              displayName={author} size="execution" decorative />
          : message
            ? <span className="execution-input-user" aria-hidden="true">你</span>
            : <span className="execution-input-placeholder" aria-hidden="true"><ExecutionBatchIcon /></span>}
        <div>
          <div><strong>{author}</strong><button type="button" onClick={() => onRevealMessage(messageId)}>
            <ExecutionLocateIcon />定位原消息
          </button></div>
          <p title={summary}>{summary}</p>
        </div>
      </li>
    })}
  </ol>
}

function ExecutionInputCountPopover({
  messageIds,
  messageById,
  memberById,
  onRevealMessage,
  subject
}: {
  messageIds: readonly string[]
  messageById: ReadonlyMap<string, CampMessageView>
  memberById: Map<string, CampSnapshot['members'][number]>
  onRevealMessage(messageId: string): void
  subject: string
}): JSX.Element | null {
  if (messageIds.length <= 1) return null
  const label = `查看${subject}的 ${messageIds.length} 条输入`
  return <Popover.Root>
    <Popover.Trigger asChild>
      <button className="execution-batch-count" type="button" aria-label={label} title={`${messageIds.length} 条输入`}>
        <ExecutionBatchIcon /><span>{messageIds.length}</span>
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        className="compact-menu execution-input-popover"
        side="bottom"
        align="end"
        sideOffset={6}
        collisionPadding={12}
        aria-label={`${subject}输入`}
      >
        <div className="execution-input-popover-heading">
          <strong>{messageIds.length} 条输入</strong>
          <span>{subject}</span>
        </div>
        <ExecutionInputList
          messageIds={messageIds}
          messageById={messageById}
          memberById={memberById}
          onRevealMessage={onRevealMessage}
        />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

function ExecutionDrawer({
  memberFast,
  placement,
  process,
  overview,
  member,
  profile,
  installation,
  turns,
  messages,
  deliveries,
  progressByRunId,
  windowedEvidence,
  executionEventsByRunId,
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
  onCancelAgentRun,
  memberById,
  onRevealMessage,
  onFileOpenError
}: {
  memberFast: CampMemberFastControls
  placement: ExecutionConsolePlacement
  process: AgentExecutionProcess
  overview: boolean
  member: CampSnapshot['members'][number] | null
  profile: AgentProfile | null
  installation: AdapterInstallation | null
  turns: CampSnapshot['turns']
  messages: CampMessageView[]
  deliveries: CampSnapshot['messageDeliveries']
  progressByRunId: Map<string, LiveExecutionProgress>
  windowedEvidence: boolean
  executionEventsByRunId: Map<string, LiveRuntimeEvent[]>
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
  onCancelAgentRun(run: AgentRunView): Promise<void>
  memberById: Map<string, CampSnapshot['members'][number]>
  onRevealMessage(messageId: string): void
  onFileOpenError(message: string): void
}): JSX.Element {
  const mobile = useMobileLayout()
  const recovery = useEditingRecovery()
  const groupKey = `mobile-execution-groups:${campId}:${process.agentId}`
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => {
    try {
      const saved = mobile ? recovery?.get(groupKey) : null
      return new Set(Array.isArray(saved) ? saved.filter((key): key is string => typeof key === 'string') : [])
    } catch { return new Set() }
  })
  useEffect(() => { if (!mobile) setExpandedGroups(new Set()) }, [campId, mobile])
  useEffect(() => { try { if (mobile) recovery?.set(groupKey, [...expandedGroups]) } catch { /* Optional disclosure memory must not block the editor. */ } }, [mobile, recovery, groupKey, expandedGroups])
  const groupState = useMemo(() => ({
    expanded: expandedGroups,
    change(keys: string[], expanded: boolean): void {
      setExpandedGroups(previous => {
        const next = new Set(previous)
        for (const key of keys) { if (expanded) next.add(key); else next.delete(key) }
        return next
      })
    }
  }), [expandedGroups])
  const fastControl = overview ? null : memberFast.get(process.agentId)
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
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<string>>(
    () => new Set(resolvedFocusedRunId ? [resolvedFocusedRunId] : [])
  )
  const [expandedQueueAgents, setExpandedQueueAgents] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [historyOpen, setHistoryOpen] = useState(false)
  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  )
  const newestFirstRuns = useMemo(() => process.runs.slice().sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  ), [process.runs])
  const currentRuns = newestFirstRuns.filter((run) =>
    NON_TERMINAL_RUNS.has(run.status) && run.status !== 'queued'
  )
  const queueBatches = executionQueueBatches(newestFirstRuns)
  const deliveryQueueBatches = executionDeliveryQueueBatches(process.waitingDeliveries)
  const historyRuns = newestFirstRuns.filter((run) => !NON_TERMINAL_RUNS.has(run.status))
  const latestRun = resolvedFocusedRun ?? currentRuns[0] ?? null
  const latestProgress = latestRun
    ? progressByRunId.get(latestRun.id)
    : undefined
  const progressFollowKey = JSON.stringify([
    latestRun?.status ?? null,
    latestRun?.waitReason ?? null,
    windowedEvidence ? latestRun?.executionEvidenceCount : latestProgress?.items ?? []
  ])
  const followedProgressKey = useRef(progressFollowKey)
  const followingLatestRef = useRef(false)
  const resumeFollowingLatestFrames = useRef<[number, number] | null>(null)
  const [followingLatest, setFollowingLatestState] = useState(false)
  const [latestRequest, setLatestRequest] = useState(0)
  const [hasNewer, setHasNewer] = useState(false)
  const latestContext = useMemo(() => ({
    runId: latestRun?.id ?? null, request: latestRequest, setHasNewer
  }), [latestRun?.id, latestRequest])
  const setFollowingLatest = (following: boolean): void => {
    followingLatestRef.current = following
    if (drawerBodyRef.current) drawerBodyRef.current.dataset.followingLatest = String(following)
    setFollowingLatestState((current) => current === following ? current : following)
  }
  const resumeFollowingLatestAfterReadingInteraction = (): void => {
    if (resumeFollowingLatestFrames.current) {
      window.cancelAnimationFrame(resumeFollowingLatestFrames.current[0])
      window.cancelAnimationFrame(resumeFollowingLatestFrames.current[1])
    }
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        resumeFollowingLatestFrames.current = null
        const body = drawerBodyRef.current
        if (!body || !latestRun || !NON_TERMINAL_RUNS.has(latestRun.status)) return
        if (executionDrawerIsNearBottom(body.scrollTop, body.scrollHeight, body.clientHeight)) {
          setFollowingLatest(true)
        }
      })
      resumeFollowingLatestFrames.current = [firstFrame, secondFrame]
    })
    resumeFollowingLatestFrames.current = [firstFrame, firstFrame]
  }
  const markExecutionReadingIntent = (): void => {
    const body = drawerBodyRef.current
    if (body) body.dataset.executionReadingIntent = String(window.performance.now())
  }
  const finishExecutionReadingInteraction = (): void => {
    markExecutionReadingIntent()
    resumeFollowingLatestAfterReadingInteraction()
  }
  useEffect(() => () => {
    if (!resumeFollowingLatestFrames.current) return
    window.cancelAnimationFrame(resumeFollowingLatestFrames.current[0])
    window.cancelAnimationFrame(resumeFollowingLatestFrames.current[1])
  }, [])
  useExecutionDisclosureAnchor(drawerBodyRef, `${campId}:${process.agentId}`, () => setFollowingLatest(false))
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
    drawerRef.current?.style.removeProperty('--execution-reading-height')
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
    if (placement !== 'bottom') return
    const drawer = drawerRef.current
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
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
    drawer?.addEventListener('keydown', handleKeyDown)
    return () => {
      drawer?.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, placement])

  useLayoutEffect(() => {
    const requestedRunId = focusedRunId
      && processRef.current.runs.some((run) => run.id === focusedRunId)
      ? focusedRunId
      : preferredAgentProcessRun(processRef.current.runs)?.id ?? null
    const runId = requestedRunId
    drawerBodyRef.current?.dispatchEvent(new Event('execution-return-latest'))
    if (!runId) return undefined
    const run = processRef.current.runs.find((candidate) => candidate.id === runId) ?? null
    const followLatest = Boolean(run && NON_TERMINAL_RUNS.has(run.status))
    followedProgressKey.current = progressFollowKey
    setExpandedRunIds((current) => current.has(runId) ? current : new Set(current).add(runId))
    setFollowingLatest(followLatest)
    const frame = window.requestAnimationFrame(() => {
      const target = drawerRef.current?.querySelector<HTMLElement>(
        `[data-agent-run-id="${CSS.escape(runId)}"]`
      )
      const body = drawerBodyRef.current
      if (followLatest && body) scrollExecutionDrawerToLatest(body)
      else target?.scrollIntoView({ block: 'start' })
      if (focusRequest.moveDomFocus) target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusRequest.sequence, process.agentId])

  useLayoutEffect(() => {
    if (!followingLatestRef.current || !latestRun) return undefined
    if (followedProgressKey.current === progressFollowKey) return undefined
    followedProgressKey.current = progressFollowKey
    const terminal = !NON_TERMINAL_RUNS.has(latestRun.status)
    const frame = window.requestAnimationFrame(() => {
      const body = drawerBodyRef.current
      if (body && followingLatestRef.current) scrollExecutionDrawerToLatest(body)
      if (terminal) setFollowingLatest(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [progressFollowKey, latestRun?.id])

  const displayName = overview
    ? '全部队员'
    : member?.displayName ?? profile?.displayName ?? process.agentId
  const drawerTitle = overview
    ? '总览'
    : executionDrawerTitle(displayName, profile?.runtimeConfiguration?.adapterKind ?? null)
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
  const drawerStyle: CSSProperties | undefined = placement !== 'bottom'
    ? undefined
    : appliedHeight === null
      ? defaultMaxHeight === null ? undefined : { maxHeight: defaultMaxHeight }
      : { height: appliedHeight, minHeight: appliedHeight, maxHeight: appliedHeight }

  const toggleRun = (runId: string): void => {
    setExpandedRunIds((current) => {
      const next = new Set(current)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

  const stopRun = (run: AgentRunView): void => {
    setSubmittingStopRunIds((current) => new Set(current).add(run.id))
    void onCancelAgentRun(run).finally(() => {
      setSubmittingStopRunIds((current) => {
        if (!current.has(run.id)) return current
        const next = new Set(current)
        next.delete(run.id)
        return next
      })
    })
  }

  const runStopState = (run: AgentRunView): AgentRunStopViewState => {
    const owningTurn = turns.find((turn) => turn.id === run.campTurnId) ?? null
    return agentRunStopViewState(run, owningTurn, {
      cancelling: cancellingRunIds.has(run.id)
        || submittingStopRunIds.has(run.id)
        || run.cancelRequestedAt !== null,
      confirming: confirmingRunIds.has(run.id),
      turnCancelling: run.campTurnId !== null && cancellingTurnIds.has(run.campTurnId)
    })
  }

  const renderRunCard = (run: AgentRunView): JSX.Element => {
    const cancelling = NON_TERMINAL_RUNS.has(run.status) && (
      (run.campTurnId !== null && cancellingTurnIds.has(run.campTurnId))
      || cancellingRunIds.has(run.id)
      || submittingStopRunIds.has(run.id)
      || run.cancelRequestedAt !== null
    )
    const focused = run.id === resolvedFocusedRunId
    const expanded = expandedRunIds.has(run.id)
    const state = agentRunPresentation(run, cancelling)
    const stateShape = runPulseStateShape(run, cancelling)
    const sourceMessage = executionTriggerMessage(run, turns, messageById)
    const inputMessageIds = executionRunInputMessageIds(run, turns)
    const summary = executionMessageSummary(sourceMessage, run)
    const runMember = memberById.get(run.agentId)
    const runMemberName = runMember?.displayName ?? run.agentId
    const stopState = runStopState(run)
    const contentId = `execution-run-content-${run.id}`
    return (
      <li
        className={`execution-process-stage status-${run.status}${focused ? ' is-focused' : ''}`}
        data-agent-run-id={run.id}
        key={run.id}
        tabIndex={-1}
        aria-current={focused ? 'step' : undefined}
        aria-label={`${runMemberName}，${state.label}，${summary}`}
      >
        <span className={`execution-process-node tone-${state.tone} state-${stateShape}`} aria-hidden="true">
          <ExecutionStatusGlyph status={stateShape} />
        </span>
        <article className="execution-process-card">
          <header className="execution-run-card-header">
            <h3 className="execution-run-heading">
              <button
                className="execution-run-toggle"
                type="button"
                aria-expanded={expanded}
                aria-controls={contentId}
                title={`${runMemberName} · ${summary}`}
                onClick={() => toggleRun(run.id)}
              >
                {overview && <MemberAvatar agentId={run.agentId} avatarRef={runMember?.avatarRef ?? null}
                  displayName={runMemberName} size="execution" decorative />}
                <span className="execution-run-summary">{summary}</span>
              </button>
            </h3>
            <ExecutionInputCountPopover
              messageIds={inputMessageIds}
              messageById={messageById}
              memberById={memberById}
              onRevealMessage={onRevealMessage}
              subject="本次执行"
            />
            <span className="execution-run-trailing">
              <ExecutionRunMetric run={run} />
              <span className="execution-run-operations">
                <button type="button" aria-label={expanded ? '收起卡片' : '展开卡片'} aria-expanded={expanded}
                  aria-controls={contentId} onClick={() => toggleRun(run.id)}>
                  <ExecutionCardChevron expanded={expanded} />
                </button>
                {(stopState === 'available' || stopState === 'stopping' || stopState === 'confirming') && (
                  <button className="is-danger" type="button" aria-label={`终止${runMemberName}的本次执行`}
                    title="终止本次执行" disabled={stopState !== 'available'} onClick={() => stopRun(run)}>
                    <ExecutionStopIcon />
                  </button>
                )}
              </span>
            </span>
          </header>
          <div id={contentId} hidden={!expanded}>
            <RunExecutionDisclosure
              run={run}
              windowedEvidence={windowedEvidence}
              liveRevision={executionEventsByRunId.get(run.id)}
              progress={progressByRunId.get(run.id)}
              campId={campId}
              truncatedEvidence={truncatedEvidenceByRunId.get(run.id)}
              loadedEvidenceCount={loadedEvidenceCountByRunId.get(run.id) ?? 0}
              cancelling={cancelling}
              focused={focused}
              expanded={expanded}
              hideSummary
              onFileOpenError={onFileOpenError}
            />
            <AgentRunDeliveryRecipients
              sourceAgentRunId={run.id}
              deliveries={deliveries}
              memberById={memberById}
            />
          </div>
        </article>
      </li>
    )
  }

  const renderQueueBatch = (batch: ExecutionQueueBatch): JSX.Element => {
    const expansionKey = `run:${batch.agentId}`
    const expanded = expandedQueueAgents.has(expansionKey)
    const runMember = memberById.get(batch.agentId)
    const runMemberName = runMember?.displayName ?? batch.agentId
    const batchMessageIds = [...new Set(batch.runs.flatMap((run) =>
      executionRunInputMessageIds(run, turns)
    ))]
    const summary = executionMessageSummary(
      batchMessageIds.flatMap((messageId) => {
        const message = messageById.get(messageId)
        return message ? [message] : []
      })[0] ?? null,
      batch.runs[0]
    )
    const stoppingBatch = batch.runs.some((run) => runStopState(run) !== 'available')
    const contentId = `execution-queue-content-${batch.agentId}`
    const toggle = (): void => setExpandedQueueAgents((current) => {
      const next = new Set(current)
      if (next.has(expansionKey)) next.delete(expansionKey)
      else next.add(expansionKey)
      return next
    })
    return (
      <li className="execution-process-stage status-queued" data-queue-agent-id={batch.agentId} key={`queue:${batch.agentId}`}>
        <span className="execution-process-node tone-attention state-queued" aria-hidden="true">
          <ExecutionStatusGlyph status="queued" />
        </span>
        <article className="execution-process-card">
          <header className="execution-run-card-header">
            <h3 className="execution-run-heading">
              <button className="execution-run-toggle" type="button" aria-expanded={expanded}
                aria-controls={contentId} title={`${runMemberName} · ${summary}`} onClick={toggle}>
                {overview && <MemberAvatar agentId={batch.agentId} avatarRef={runMember?.avatarRef ?? null}
                  displayName={runMemberName} size="execution" decorative />}
                <span className="execution-run-summary">{summary}</span>
              </button>
            </h3>
            <ExecutionInputCountPopover
              messageIds={batchMessageIds}
              messageById={messageById}
              memberById={memberById}
              onRevealMessage={onRevealMessage}
              subject="排队批次"
            />
            <span className="execution-run-trailing">
              <span className="execution-run-metric is-queued">排队中</span>
              <span className="execution-run-operations">
                <button type="button" aria-label={expanded ? '收起排队批次' : '展开排队批次'}
                  aria-expanded={expanded} aria-controls={contentId} onClick={toggle}>
                  <ExecutionCardChevron expanded={expanded} />
                </button>
                <button className="is-danger" type="button" aria-label={`终止${runMemberName}的本批排队`}
                  title="终止本批排队" disabled={stoppingBatch} onClick={() => {
                    for (const run of batch.runs) stopRun(run)
                  }}>
                  <ExecutionStopIcon />
                </button>
              </span>
            </span>
          </header>
          <div className="execution-queue-inputs" id={contentId} hidden={!expanded}>
            {batchMessageIds.length > 0
              ? <ExecutionInputList messageIds={batchMessageIds} messageById={messageById}
                  memberById={memberById} onRevealMessage={onRevealMessage} />
              : <p className="execution-queue-empty">排队输入当前未载入。</p>}
          </div>
        </article>
      </li>
    )
  }

  const renderDeliveryQueueBatch = (batch: ExecutionDeliveryQueueBatch): JSX.Element => {
    const expansionKey = `delivery:${batch.agentId}`
    const expanded = expandedQueueAgents.has(expansionKey)
    const runMember = memberById.get(batch.agentId)
    const runMemberName = runMember?.displayName ?? batch.agentId
    const sourceMessage = messageById.get(batch.messageIds[0]) ?? null
    const summary = sourceMessage
      ? sourceMessage.body.trim().replace(/\s+/gu, ' ')
        || sourceMessage.attachments.map((item) => item.displayName).join('、')
        || '排队消息'
      : '排队消息'
    const contentId = `execution-delivery-queue-content-${batch.agentId}`
    const toggle = (): void => setExpandedQueueAgents((current) => {
      const next = new Set(current)
      if (next.has(expansionKey)) next.delete(expansionKey)
      else next.add(expansionKey)
      return next
    })
    return (
      <li className="execution-process-stage status-queued" data-delivery-queue-agent-id={batch.agentId}
        key={`delivery-queue:${batch.agentId}`}>
        <span className="execution-process-node tone-attention state-queued" aria-hidden="true">
          <ExecutionStatusGlyph status="queued" />
        </span>
        <article className="execution-process-card">
          <header className="execution-run-card-header">
            <h3 className="execution-run-heading">
              <button className="execution-run-toggle" type="button" aria-expanded={expanded}
                aria-controls={contentId} title={`${runMemberName} · ${summary}`} onClick={toggle}>
                {overview && <MemberAvatar agentId={batch.agentId} avatarRef={runMember?.avatarRef ?? null}
                  displayName={runMemberName} size="execution" decorative />}
                <span className="execution-run-summary">{summary}</span>
              </button>
            </h3>
            <ExecutionInputCountPopover
              messageIds={batch.messageIds}
              messageById={messageById}
              memberById={memberById}
              onRevealMessage={onRevealMessage}
              subject="排队消息"
            />
            <span className="execution-run-trailing">
              <span className="execution-run-metric is-queued">排队中</span>
              <span className="execution-run-operations">
                <button type="button" aria-label={expanded ? '收起排队消息' : '展开排队消息'}
                  aria-expanded={expanded} aria-controls={contentId} onClick={toggle}>
                  <ExecutionCardChevron expanded={expanded} />
                </button>
              </span>
            </span>
          </header>
          <div className="execution-queue-inputs" id={contentId} hidden={!expanded}>
            <ExecutionInputList messageIds={batch.messageIds} messageById={messageById}
              memberById={memberById} onRevealMessage={onRevealMessage} />
          </div>
        </article>
      </li>
    )
  }

  const currentEntries = [
    ...currentRuns.map((run) => ({ kind: 'run' as const, createdAt: run.createdAt, id: run.id, run })),
    ...queueBatches.map((batch) => ({ kind: 'queue' as const, createdAt: batch.createdAt, id: batch.agentId, batch })),
    ...deliveryQueueBatches.map((batch) => ({
      kind: 'delivery_queue' as const,
      createdAt: batch.createdAt,
      id: batch.agentId,
      batch
    }))
  ].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
  )

  return (
    <section
      id="agent-execution-drawer"
      ref={drawerRef}
      className={`execution-drawer execution-drawer-${placement}${placement === 'right' ? ' execution-drawer-inspector' : ''}${preferredHeight !== null && placement === 'bottom' ? ' is-user-sized' : ''}${resizing ? ' is-resizing' : ''}`}
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
        <header className={`execution-drawer-header${overview ? ' is-overview' : ''}`}>
          <div className="execution-drawer-agent">
            {overview
              ? <ExecutionOverviewMark className="execution-overview-mark" />
              : <MemberAvatar
                  agentId={process.agentId}
                  avatarRef={member?.avatarRef ?? profile?.avatarRef ?? null}
                  displayName={displayName}
                  size="list"
                  decorative
                />}
            <div>
              <div className="execution-drawer-title-line">
                <h2 id="execution-drawer-title">{drawerTitle}</h2>
                {(runtimeConfiguration || fastControl) && (
                  <span className="execution-config-line">
                    {runtimeConfiguration && (
                      <span className="execution-model-params" title={runtimeConfiguration.summary}>{runtimeConfiguration.summary}</span>
                    )}
                    {fastControl && <span className="execution-drawer-fast-slot">
                      {fastControl.value && <CampMemberFastToggle value={fastControl.value} displayName={displayName}
                        pending={fastControl.pending} onToggle={next => { void memberFast.save(process.agentId, next) }} />}
                    </span>}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>
        <div
          ref={drawerBodyRef}
          className="execution-drawer-body"
          aria-label={overview ? '全部队员的执行总览' : `${displayName}的连续执行历史`}
          data-following-latest={followingLatest ? 'true' : 'false'}
          onWheelCapture={finishExecutionReadingInteraction}
          onPointerDownCapture={markExecutionReadingIntent}
          onPointerMoveCapture={(event) => {
            if (event.buttons !== 0) markExecutionReadingIntent()
          }}
          onPointerUpCapture={finishExecutionReadingInteraction}
          onKeyDownCapture={markExecutionReadingIntent}
          onKeyUpCapture={finishExecutionReadingInteraction}
          onScroll={(event) => {
            const body = event.currentTarget
            if (body.dataset.executionDisclosureAnchor === 'true') return
            if (body.dataset.executionAdjustedTop !== undefined
              && Math.abs(Number(body.dataset.executionAdjustedTop) - body.scrollTop) < 1) return
            if (body.scrollHeight - body.clientHeight <= 1) return
            const eligible = Boolean(
              latestRun && NON_TERMINAL_RUNS.has(latestRun.status)
            )
            const nearBottom = executionDrawerIsNearBottom(
              body.scrollTop,
              body.scrollHeight,
              body.clientHeight
            )
            if (!eligible || !nearBottom) setFollowingLatest(false)
          }}
        >
          <ExecutionLatestContext.Provider value={latestContext}>
          <ExecutionReadingContext.Provider value={setFollowingLatest}>
          <ExecutionToolGroupStateContext.Provider value={groupState}>
          {currentEntries.length > 0 && <section aria-label="当前执行与排队">
            <ol className="execution-process-timeline">{currentEntries.map((entry) =>
              entry.kind === 'run'
                ? renderRunCard(entry.run)
                : entry.kind === 'queue'
                  ? renderQueueBatch(entry.batch)
                  : renderDeliveryQueueBatch(entry.batch)
            )}</ol>
          </section>}
          {(historyRuns.length > 0 || !runHistoryComplete) && <section className={`execution-history-section${currentEntries.length === 0 ? ' is-first' : ''}`} aria-label="执行历史">
            <button className="execution-history-toggle" type="button" aria-expanded={historyOpen}
              aria-controls={`execution-history-${process.agentId}`} onClick={() => setHistoryOpen((open) => !open)}>
              <ExecutionCardChevron expanded={historyOpen} />
              <span>执行历史</span>
              {historyRuns.length > 0 && <span className="execution-history-count">{historyRuns.length}</span>}
            </button>
            <div className="execution-history-list" id={`execution-history-${process.agentId}`} hidden={!historyOpen}>
              {historyRuns.length > 0
                ? <ol className="execution-process-timeline">{historyRuns.map(renderRunCard)}</ol>
                : <div className="execution-current-empty">暂无执行历史</div>}
              {!runHistoryComplete && <p className="execution-history-partial">更早执行尚未载入</p>}
            </div>
          </section>}
          {executionEmptyStateShouldRender(
            currentEntries.length,
            historyRuns.length,
            runHistoryComplete
          )
            && <div className="execution-current-empty">当前没有执行</div>}
          <div className="execution-reading-space" aria-hidden="true" />
          </ExecutionToolGroupStateContext.Provider>
          </ExecutionReadingContext.Provider>
          </ExecutionLatestContext.Provider>
        </div>
        <ReturnToLatest
          viewportRef={drawerBodyRef}
          ownerKey={campId + ':' + process.agentId}
          contentRevision={latestRun ? latestRun.id + ':' + latestRun.executionEvidenceCount + ':' + latestRun.updatedAt : null}
          scope="execution"
          hasNewer={hasNewer}
          onLatest={() => {
            setFollowingLatest(Boolean(latestRun && NON_TERMINAL_RUNS.has(latestRun.status)))
            setLatestRequest((request) => request + 1)
            const body = drawerBodyRef.current
            if (body) {
              body.dispatchEvent(new Event('execution-return-latest'))
              delete body.dataset.executionAnchorKey
            }
          }}
        />
    </section>
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

function userMessageRunStatusLabel(run: AgentRunView | null): string {
  if (!run) return '未读'
  if (run.status === 'queued') return '待处理'
  if (run.status === 'running') return '处理中'
  if (run.status === 'waiting') return '等待中'
  if (run.status === 'succeeded') return '已完成'
  if (run.status === 'failed') return '未完成'
  return '已停止'
}

function UserMessageDeliveryReceipt({
  message,
  runs,
  memberById,
  onOpenExecution,
  onWithdraw
}: {
  message: CampMessageView
  runs: AgentRunView[]
  memberById: Map<string, CampSnapshot['members'][number]>
  onOpenExecution(run: AgentRunView, trigger: HTMLButtonElement): void
  onWithdraw?(): void
}): JSX.Element | null {
  if (message.id.startsWith('optimistic:') || message.addressedAgentIds.length === 0) return null
  const runByAgentId = new Map<string, AgentRunView>()
  for (const run of runs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (!runByAgentId.has(run.agentId)) runByAgentId.set(run.agentId, run)
  }
  const ordered = message.addressedAgentIds.map((agentId) => ({
    agentId,
    run: runByAgentId.get(agentId) ?? null
  }))
  const pending = ordered.filter(({ run }) => !run || (run.status === 'queued' && !run.cancelRequestedAt))
  const inProgress = ordered.filter(({ run }) => run?.status === 'running' || run?.status === 'waiting')
  const canWithdraw = message.canWithdraw && Boolean(onWithdraw)
  const presentation = pending.length > 0
    ? { className: 'is-queued', label: `待处理 · ${pending.length}` }
    : inProgress.length > 0
      ? { className: 'is-progress', label: `处理中 · ${inProgress.length}` }
      : null
  if (!presentation) return null
  return (
    <div className="user-message-receipt-row">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={`user-message-receipt ${presentation.className}`}
            type="button"
            aria-label={`查看消息处理状态，${presentation.label}`}
          >
            {presentation.className === 'is-progress' ? <ExecutionIcon />
              : <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="5.6" /><path d="M8 4.7V8l2.2 1.4" />
                </svg>}
            <span>{presentation.label}</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="user-message-receipt-menu" sideOffset={5} align="end">
            <h3>消息处理状态</h3>
            {ordered.map(({ agentId, run }) => {
              const member = memberById.get(agentId)
              const displayName = member?.displayName ?? agentId
              return <div className="user-message-receipt-recipient" key={agentId}>
                <MemberAvatar agentId={agentId} avatarRef={member?.avatarRef ?? null} displayName={displayName} size="mention" decorative />
                <span><strong>{displayName}</strong><small>{userMessageRunStatusLabel(run)}</small></span>
                {run && <DropdownMenu.Item asChild>
                  <button type="button" onClick={(event) => onOpenExecution(run, event.currentTarget)}>查看执行</button>
                </DropdownMenu.Item>}
              </div>
            })}
            {canWithdraw && <div className="user-message-receipt-actions">
              <DropdownMenu.Item asChild>
                <button type="button" onClick={onWithdraw}>撤回消息</button>
              </DropdownMenu.Item>
            </div>}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {canWithdraw && <button className="user-message-withdraw" type="button" aria-label="撤回尚未领取的消息" title="撤回消息" onClick={onWithdraw}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 4H2.5v2.5M2.8 6.2A5.4 5.4 0 1 1 3 10" /></svg>
      </button>}
    </div>
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
  const { profile: currentUserProfile } = useCurrentUserProfile()
  const currentUser = request.target.kind === 'current_user'
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
  const ariaLabel = currentUser
    ? `${currentUserDisplayName(currentUserProfile)}的个人资料`
    : profile ? `${profile.displayName}的基础信息` : '所有队员范围'

  return createPortal(
    <div
      ref={panelRef}
      className={`mention-profile-popover${position ? ' is-positioned' : ''}`}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
      data-content-kind={currentUser ? 'current_user' : profile ? 'member' : 'group'}
      data-placement={position?.placement ?? 'bottom'}
      tabIndex={-1}
      style={style}
    >
      <div className="mention-profile-popover-arrow" aria-hidden="true" />
      <div className="mention-profile-popover-inner">
        {currentUser && (
          <div className="current-user-profile-card">
            <CurrentUserAvatar profile={currentUserProfile} size={160} />
            <h2>{currentUserDisplayName(currentUserProfile)}</h2>
          </div>
        )}
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
                  <div className="mention-profile-fields">
                    <dl>
                      <div>
                        <dt>专业职责</dt>
                        <dd>{profile.professionalResponsibilities.trim() || '未设置'}</dd>
                      </div>
                    </dl>
                    <details className="app-dialog-disclosure">
                      <summary>工作准则与性格底色</summary>
                      <dl>
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
                    </details>
                  </div>
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

export function RuntimeRecoveryDock({
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
            <span>{targetCount} 位目标队员暂时不可执行 · 当前输入已保留</span>
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
  memberFast,
  snapshot,
  profileById,
  installations,
  busy,
  onChangeLead,
  onAddMembers,
  onPreviewMemberRemoval,
  onRemoveMember,
  onNotify
}: {
  memberFast: CampMemberFastControls
  snapshot: CampSnapshot
  profileById: Map<string, AgentProfile>
  installations: AdapterInstallation[]
  busy: boolean
  onChangeLead(agentId: string): Promise<void>
  onAddMembers?(agentIds: string[]): Promise<CampMemberAddOutcome>
  onPreviewMemberRemoval?(agentId: string): Promise<CampMemberRemovalPreview>
  onRemoveMember?(preview: CampMemberRemovalPreview): Promise<CampMemberRemoveOutcome>
  onNotify(message: string): void
}): JSX.Element {
  const mobile = useMobileLayout()
  const members = campInspectorMembers(snapshot.members)
  const presentCount = members.filter(campMemberIsLeadEligible).length
  const awayCount = members.length - presentCount
  const activeAgentIds = useMemo(
    () => new Set(members.map((member) => member.agentId)),
    [members]
  )
  const candidateProfiles = useMemo(
    () => [...profileById.values()]
      .filter((profile) => profile.presence === 'present' && !activeAgentIds.has(profile.agentId))
      .sort((left, right) => left.memberOrder - right.memberOrder || left.agentId.localeCompare(right.agentId)),
    [activeAgentIds, profileById]
  )
  const [expandedRuntimeAgentIds, setExpandedRuntimeAgentIds] = useState<Set<string>>(
    () => new Set()
  )
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set())
  const [addSubmitting, setAddSubmitting] = useState(false)
  const [addResult, setAddResult] = useState<{
    tone: 'success' | 'attention' | 'danger'
    message: string
    failures: Map<string, string>
  } | null>(null)
  const [removalTarget, setRemovalTarget] = useState<CampSnapshot['members'][number] | null>(null)
  const [removalPreviewState, setRemovalPreviewState] = useState<
    | { status: 'idle' | 'loading' }
    | { status: 'ready'; preview: CampMemberRemovalPreview }
    | { status: 'conflict' | 'error'; message: string }
  >({ status: 'idle' })
  const [removeSubmitting, setRemoveSubmitting] = useState(false)

  const filteredCandidates = useMemo(() => {
    const needle = addSearch.trim().toLocaleLowerCase()
    if (!needle) return candidateProfiles
    return candidateProfiles.filter((profile) =>
      `${profile.displayName} ${profile.teamRole}`.toLocaleLowerCase().includes(needle)
    )
  }, [addSearch, candidateProfiles])

  const openAddDialog = (): void => {
    setAddSearch('')
    setSelectedCandidateIds(new Set())
    setAddResult(null)
    setAddDialogOpen(true)
  }

  const closeAddDialog = (): void => {
    if (addSubmitting) return
    setAddDialogOpen(false)
    setAddResult(null)
  }

  const toggleCandidate = (agentId: string): void => {
    setSelectedCandidateIds((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  const submitAddMembers = async (): Promise<void> => {
    if (!onAddMembers || selectedCandidateIds.size === 0 || addSubmitting) return
    const requestedAgentIds = [...selectedCandidateIds]
    setAddSubmitting(true)
    setAddResult(null)
    try {
      const outcome = await onAddMembers(requestedAgentIds)
      const succeeded = [...outcome.addedAgentIds, ...outcome.unchangedAgentIds]
      if (outcome.failures.length === 0) {
        setAddDialogOpen(false)
        setSelectedCandidateIds(new Set())
        onNotify(outcome.addedAgentIds.length === 1
          ? '1 位队员已加入；将在之后新建的执行中生效'
          : `${outcome.addedAgentIds.length} 位队员已加入；将在之后新建的执行中生效`)
        return
      }
      setSelectedCandidateIds(new Set(outcome.failures.map((failure) => failure.agentId)))
      setAddResult({
        tone: succeeded.length > 0 ? 'attention' : 'danger',
        message: succeeded.length > 0
          ? `已加入 ${succeeded.length} 位；另有 ${outcome.failures.length} 位未加入，可直接重试。`
          : `${outcome.failures.length} 位队员均未加入，请检查后重试。`,
        failures: new Map(outcome.failures.map((failure) => [failure.agentId, failure.message]))
      })
    } catch (error) {
      setAddResult({
        tone: 'danger',
        message: readErrorMessage(error, '邀请队员失败，请重试。'),
        failures: new Map()
      })
    } finally {
      setAddSubmitting(false)
    }
  }

  const loadRemovalPreview = useCallback(async (agentId: string): Promise<void> => {
    if (!onPreviewMemberRemoval) {
      setRemovalPreviewState({ status: 'error', message: '当前版本无法读取移出影响。' })
      return
    }
    setRemovalPreviewState({ status: 'loading' })
    try {
      const preview = await onPreviewMemberRemoval(agentId)
      setRemovalPreviewState({ status: 'ready', preview })
    } catch (error) {
      setRemovalPreviewState({
        status: 'error',
        message: readErrorMessage(error, '无法读取 Core 权威影响，请重试。')
      })
    }
  }, [onPreviewMemberRemoval])

  const openRemovalDialog = (member: CampSnapshot['members'][number]): void => {
    if (members.length <= 1 || !onRemoveMember) return
    setRemovalTarget(member)
    void loadRemovalPreview(member.agentId)
  }

  const closeRemovalDialog = (): void => {
    if (removeSubmitting) return
    setRemovalTarget(null)
    setRemovalPreviewState({ status: 'idle' })
  }

  const submitRemoveMember = async (): Promise<void> => {
    if (!onRemoveMember || removalPreviewState.status !== 'ready' || removeSubmitting) return
    setRemoveSubmitting(true)
    try {
      const outcome = await onRemoveMember(removalPreviewState.preview)
      if (outcome.status === 'removed') {
        const displayName = removalPreviewState.preview.displayName
        setRemovalTarget(null)
        setRemovalPreviewState({ status: 'idle' })
        onNotify(outcome.reconciliationStatus === 'reconciling'
          ? `已将${displayName}移出当前会话；正在收拢已开始的工作`
          : `已将${displayName}移出当前会话`)
        return
      }
      setRemovalPreviewState({
        status: outcome.status === 'conflict' ? 'conflict' : 'error',
        message: outcome.message ?? (outcome.status === 'conflict'
          ? '名册已发生变化。请重新读取影响后再确认，本次没有移出任何队员。'
          : '移出未完成，请重试。')
      })
    } catch (error) {
      setRemovalPreviewState({
        status: 'error',
        message: readErrorMessage(error, '移出未完成，请重试。')
      })
    } finally {
      setRemoveSubmitting(false)
    }
  }

  const toggleRuntimeDetails = (agentId: string): void => {
    setExpandedRuntimeAgentIds((current) => {
      const next = new Set(current)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  const removalPreview = removalPreviewState.status === 'ready'
    ? removalPreviewState.preview
    : null
  const removalDeliveryCount = removalPreview
    ? removalPreview.pendingDeliveryCount + removalPreview.runningDeliveryCount
    : 0
  const removalHasActualImpact = Boolean(removalPreview && (
    removalPreview.nonTerminalAgentRunCount > 0
    || removalPreview.openAssignedTaskCount > 0
    || removalDeliveryCount > 0
    || removalPreview.isDefaultLead
  ))
  const showRemovalDialogBody = removalPreviewState.status !== 'ready'
    || Boolean(removalPreview && (!removalPreview.removable || removalHasActualImpact))

  return (
    <section aria-label="当前会话队员">
      <div className="camp-members-summary">
        <div className="camp-members-summary-line">
          <div>
            <small>{presentCount} 位在队 · {awayCount} 位暂离</small>
          </div>
          <div className="camp-members-summary-actions">
            <button
              className="camp-add-member-button"
              type="button"
              disabled={busy || !onAddMembers}
              onClick={openAddDialog}
            >
              <span aria-hidden="true">＋</span> 邀请
            </button>
          </div>
        </div>
      </div>

      {snapshot.membershipReconciliations.map((reconciliation) => {
        const displayName = profileById.get(reconciliation.agentId)?.displayName ?? '已移出队员'
        return (
          <div className="camp-members-reconciliation" role="status" key={reconciliation.id}>
            <span className="camp-members-reconciliation-mark" aria-hidden="true">↻</span>
            <span>
              <strong>正在收拢{displayName}的已开始工作</strong>
              <small>{reconciliation.settledRunCount}/{reconciliation.targetRunCount} 个执行已结束；新消息和工具写入已停止。</small>
            </span>
          </div>
        )
      })}

      <div className="camp-inspector-member-list" role="list" aria-label="会话队员列表">
        {members.map((member) => {
          const profile = profileById.get(member.agentId) ?? null
          const fastControl = memberFast.get(member.agentId)
          const fast = fastControl?.value
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
            <article className={`camp-inspector-member-row ${fast ? 'has-fast' : ''} ${present ? '' : 'is-away'}`} role="listitem" key={member.agentId}>
              <span className="camp-inspector-member-avatar">
                <MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="list" decorative />
              </span>
              <span className="camp-inspector-member-copy">
                <span className="camp-inspector-member-name">
                  <strong>{member.displayName}</strong>
                  {member.isDefaultLead && <small>队长</small>}
                </span>
                <small title={member.teamRole || undefined}>{runtimeLabel}</small>
              </span>
              {!mobile && fast && <CampMemberFastToggle value={fast} displayName={member.displayName} pending={fastControl!.pending}
                onToggle={next => { void memberFast.save(member.agentId, next) }} />}
              <span className={`camp-inspector-member-state ${present ? '' : 'is-away'}`}>
                <strong>{presenceLabel}</strong>
                {runtimeTone === 'attention' && profile && <small className="runtime-attention">{runtimeReadinessLabel(profile.runtimeReadiness.status)}</small>}
              </span>
              {!mobile && <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="camp-member-action-button"
                    type="button"
                    aria-label={`${member.displayName}的队员操作`}
                    disabled={busy}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <circle cx="3" cy="8" r="1.35" />
                      <circle cx="8" cy="8" r="1.35" />
                      <circle cx="13" cy="8" r="1.35" />
                    </svg>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()}
                    className="camp-member-menu"
                    align="end"
                    sideOffset={5}
                    collisionPadding={10}
                    aria-label={`${member.displayName}的队员操作`}
                  >
                    <DropdownMenu.Item
                      className="camp-member-menu-item"
                      disabled={busy || member.isDefaultLead || !present}
                      onSelect={() => { void onChangeLead(member.agentId).catch(() => undefined) }}
                    >
                      <strong>{member.isDefaultLead ? '当前队长' : '设为队长'}</strong>
                      {!present && <small>暂离的队员不可设为队长</small>}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="camp-member-menu-separator" />
                    <DropdownMenu.Item
                      className="camp-member-menu-item"
                      disabled={!runtimeConfiguration}
                      onSelect={() => runtimeConfiguration && toggleRuntimeDetails(member.agentId)}
                    >
                      <strong>模型信息</strong>
                      {!runtimeConfiguration && <small>请先配置 Agent 运行时</small>}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="camp-member-menu-separator" />
                    <DropdownMenu.Item
                      className="camp-member-menu-item is-danger"
                      disabled={members.length <= 1 || !onRemoveMember}
                      onSelect={() => openRemovalDialog(member)}
                    >
                      <strong>移出当前会话</strong>
                      {members.length <= 1 && <small>会话至少保留 1 位队员</small>}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>}
              {!mobile && runtimeConfiguration && runtimeDetailsOpen && (
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

      <Dialog.Root open={addDialogOpen} onOpenChange={(open) => !open && closeAddDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="camp-member-dialog" width="wide" aria-describedby="camp-add-member-description">
            <AppDialogHeader
              title="邀请队员"
              description="选择要加入这次讨论的队员。"
              descriptionId="camp-add-member-description"
              icon="user"
              kicker="当前会话"
              closeDisabled={addSubmitting}
              hideDescription
            />
            <AppDialogBody className="camp-member-dialog-body">
              {addResult && (
                <div className={`camp-member-dialog-alert is-${addResult.tone}`} role="status">{addResult.message}</div>
              )}
              <label className="camp-member-search-field">
                <svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
                <input
                  type="search"
                  placeholder="搜索队员…"
                  value={addSearch}
                  data-dialog-autofocus
                  autoComplete="off"
                  onChange={(event) => setAddSearch(event.target.value)}
                />
              </label>
              <div className="camp-member-candidate-caption">
                <strong>可邀请队员</strong>
                <span>{filteredCandidates.length} 位</span>
              </div>
              <div className="camp-member-candidate-list" role="group" aria-label="可邀请队员">
                {filteredCandidates.map((profile) => {
                  const failure = addResult?.failures.get(profile.agentId) ?? null
                  const checked = selectedCandidateIds.has(profile.agentId)
                  return (
                    <div className="camp-member-candidate-entry" key={profile.agentId}>
                      <label className="camp-member-candidate-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={addSubmitting}
                          onChange={() => toggleCandidate(profile.agentId)}
                        />
                        <MemberAvatar agentId={profile.agentId} avatarRef={profile.avatarRef} displayName={profile.displayName} size="list" decorative />
                        <span className="camp-member-candidate-copy">
                          <strong>{profile.displayName}<small>{profile.teamRole || '团队角色未设置'}</small></strong>
                          <small>{profile.professionalResponsibilities || '职责尚未填写'}</small>
                        </span>
                        <span className={`camp-member-candidate-runtime ${profile.runtimeReadiness.status === 'ready' ? 'is-ready' : 'is-attention'}`}>
                          <i aria-hidden="true" />{mentionRuntimeLabel(profile)}
                        </span>
                      </label>
                      <details className="camp-member-invite-detail">
                        <summary>职责</summary>
                        <p>{profile.professionalResponsibilities || '职责尚未填写'}</p>
                      </details>
                      {failure && <div className="camp-member-candidate-error" role="alert">{failure}</div>}
                    </div>
                  )
                })}
                {filteredCandidates.length === 0 && (
                  <div className="camp-member-candidate-empty">
                    <strong>{candidateProfiles.length === 0 ? '没有可邀请的队员' : '没有匹配的队员'}</strong>
                    <p>{candidateProfiles.length === 0
                      ? '所有当前在队的队员都已加入本会话。'
                      : '换一个姓名或角色关键词试试。'}</p>
                  </div>
                )}
              </div>
            </AppDialogBody>
            <AppDialogFooter>
              <Dialog.Close asChild><button className="quiet-button" type="button" disabled={addSubmitting}>取消</button></Dialog.Close>
              <button
                className="primary-button conversation-primary-button"
                type="button"
                disabled={selectedCandidateIds.size === 0 || addSubmitting}
                onClick={() => void submitAddMembers()}
              >{addSubmitting ? '正在邀请…' : `邀请队员${selectedCandidateIds.size > 0 ? ` · ${selectedCandidateIds.size}` : ''}`}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={removalTarget !== null} onOpenChange={(open) => !open && closeRemovalDialog()}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent
            className="camp-member-removal-dialog"
            tone="danger"
            aria-describedby="camp-remove-member-description"
          >
            <AppDialogHeader
              title={`移出${removalTarget?.displayName ?? '这位队员'}？`}
              description="只影响当前会话，移出后不再接收这里的新工作。"
              descriptionId="camp-remove-member-description"
              icon="user"
              kicker="当前会话"
              closeDisabled={removeSubmitting}
            />
            {showRemovalDialogBody && (
              <AppDialogBody>
                {(removalPreviewState.status === 'loading' || removalPreviewState.status === 'idle') && (
                  <div className="camp-member-preview-loading" aria-label="正在读取移出影响">
                    <span /><span /><span className="is-short" />
                  </div>
                )}
                {(removalPreviewState.status === 'conflict' || removalPreviewState.status === 'error') && (
                  <div className={`camp-member-dialog-alert ${removalPreviewState.status === 'conflict' ? 'is-attention' : 'is-danger'}`} role="alert">
                    {removalPreviewState.message}
                  </div>
                )}
                {removalPreview && (
                  <>
                    {!removalPreview.removable && (
                      <div className="camp-member-dialog-alert is-danger" role="alert">
                        会话至少保留 1 位队员，本次没有移出任何队员。
                      </div>
                    )}
                    {removalHasActualImpact && (
                      <AppDialogImpactList>
                        {removalPreview.nonTerminalAgentRunCount > 0 && (
                          <AppDialogImpact tone="warning" icon="bolt" label="已开始的执行">
                            {removalPreview.nonTerminalAgentRunCount} 个执行将停止接收新写入，并在后台收拢。
                          </AppDialogImpact>
                        )}
                        {removalPreview.openAssignedTaskCount > 0 && (
                          <AppDialogImpact tone="warning" icon="keep" label="未完成任务">
                            {removalPreview.openAssignedTaskCount} 个任务将释放负责人，回到待分配状态。
                          </AppDialogImpact>
                        )}
                        {removalDeliveryCount > 0 && (
                          <AppDialogImpact tone="warning" icon="info" label="等待消息">
                            {removalDeliveryCount} 个投递将取消或结束。
                          </AppDialogImpact>
                        )}
                        {removalPreview.isDefaultLead && (
                          <AppDialogImpact tone="warning" icon="user" label="队长职责">
                            {removalPreview.nextDefaultLeadAgentId
                              ? `将交给${profileById.get(removalPreview.nextDefaultLeadAgentId)?.displayName ?? '另一位在队队员'}。`
                              : '剩余队员都处于暂离状态，会话将暂时没有队长；有人归队后自动恢复。'}
                          </AppDialogImpact>
                        )}
                      </AppDialogImpactList>
                    )}
                  </>
                )}
              </AppDialogBody>
            )}
            <AppDialogFooter note={removalPreviewState.status === 'ready' ? '提交后立即阻止该队员的新消息与工具写入。' : '请先读取 Core 权威影响。'}>
              <Dialog.Close asChild><button className="quiet-button" type="button" disabled={removeSubmitting}>取消</button></Dialog.Close>
              {(removalPreviewState.status === 'conflict' || removalPreviewState.status === 'error') && removalTarget && (
                <button className="quiet-button" type="button" disabled={removeSubmitting} onClick={() => void loadRemovalPreview(removalTarget.agentId)}>重新读取影响</button>
              )}
              <button
                className="danger-button"
                type="button"
                disabled={removeSubmitting || removalPreviewState.status !== 'ready' || !removalPreviewState.preview.removable}
                onClick={() => void submitRemoveMember()}
              >{removeSubmitting ? '正在移出…' : '移出当前会话'}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}

export function ApprovalDock({
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
  const [expandedReasonIds, setExpandedReasonIds] = useState<Set<string>>(() => new Set())
  const contentId = useId()
  const presentedFocusRequest = useRef<number | null>(null)
  const currentIndex = Math.min(activeIndex, approvals.length - 1)
  const approval = approvals[currentIndex]
  const previousApprovals = useRef({ ids: approvals.map((item) => item.id), activeId: approval.id })
  const sourceLabel = `${profileById.get(approval.agentId)?.displayName ?? approval.agentId} · ${runtimeAdapterLabel(approval.adapterKind)}`
  const showReason = Boolean(approval.reason?.trim())
    && normalizedApprovalText(approval.reason ?? '') !== normalizedApprovalText(approval.actionSummary)

  useEffect(() => {
    if (activeIndex >= approvals.length) setActiveIndex(Math.max(approvals.length - 1, 0))
  }, [activeIndex, approvals.length])

  useEffect(() => {
    const previous = previousApprovals.current
    const ids = approvals.map((item) => item.id)
    previousApprovals.current = { ids, activeId: approval.id }
    if (ids.some((id) => !previous.ids.includes(id))) setCollapsed(false)
    setExpandedReasonIds((expanded) => {
      const retained = new Set([...expanded].filter((id) => ids.includes(id)))
      return retained.size === expanded.size ? expanded : retained
    })
    if (ids.includes(previous.activeId)) return undefined
    setCollapsed(false)
    const frame = window.requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>('[data-approval-summary]')
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [approvals, approval.id, containerRef])

  useEffect(() => {
    if (focusRequest === null || presentedFocusRequest.current === focusRequest) return
    setCollapsed(false)
    if (focusApprovalId) {
      const targetIndex = approvals.findIndex((candidate) => candidate.id === focusApprovalId)
      if (targetIndex >= 0) setActiveIndex(targetIndex)
    }
  }, [approvals, focusApprovalId, focusRequest])

  useEffect(() => {
    if (focusRequest === null || presentedFocusRequest.current === focusRequest || collapsed) return undefined
    if (focusApprovalId && approval.id !== focusApprovalId) return undefined
    let frame: number | null = null
    let scrolled = false
    let focusObserved = false
    const present = (): void => {
      const target = containerRef.current?.querySelector<HTMLElement>(focusApprovalId
        ? `[data-approval-summary="${CSS.escape(focusApprovalId)}"]`
        : '[data-approval-summary]')
      if (!target) {
        frame = window.requestAnimationFrame(present)
        return
      }
      if (!scrolled) {
        scrolled = true
        target.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth'
        })
      }
      if (focusObserved && document.activeElement === target) {
        presentedFocusRequest.current = focusRequest
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
        <div className="approval-dock-heading" tabIndex={-1} data-approval-summary={approval.id}
          aria-label={`${approval.actionSummary}, ${sourceLabel}`}>
          <strong title={approval.actionSummary}>{approval.actionSummary}</strong>
          <span title={sourceLabel}>{sourceLabel}</span>
        </div>
        <nav aria-label="审批请求控制">
          {approvals.length > 1 && (
            <>
            <button type="button" aria-label="上一项审批" aria-disabled={currentIndex === 0} onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true })
              if (currentIndex > 0) setActiveIndex(currentIndex - 1)
            }}>‹</button>
            <span>{currentIndex + 1} / {approvals.length}</span>
            <button type="button" aria-label="下一项审批" aria-disabled={currentIndex === approvals.length - 1} onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true })
              if (currentIndex < approvals.length - 1) setActiveIndex(currentIndex + 1)
            }}>›</button>
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
        {showReason && <ApprovalReason key={approval.id} reason={approval.reason!}
          expanded={expandedReasonIds.has(approval.id)}
          onToggle={() => setExpandedReasonIds((previous) => {
            const next = new Set(previous)
            if (next.has(approval.id)) next.delete(approval.id)
            else next.add(approval.id)
            return next
          })} />}
        <pre tabIndex={0} role="region" aria-label="完整审批请求，可滚动">{JSON.stringify(approval.canonicalInput, null, 2)}</pre>
        <div className="approval-dock-actions">
          {approval.options.map((option) => (
            <button
              className={`runtime-option option-${option.kind}`}
              type="button"
              key={option.optionId}
              onClick={() => onResolve(approval, option.optionId)}
              disabled={busy}
              title={option.label}
              aria-label={option.label}
            >
              {option.label}
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

function normalizedApprovalText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function ApprovalReason({ reason, expanded, onToggle }: {
  reason: string
  expanded: boolean
  onToggle(): void
}): JSX.Element {
  const reasonId = useId()
  const reasonRef = useRef<HTMLParagraphElement>(null)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const element = reasonRef.current
    if (!element) return undefined
    const measure = (): void => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight)
      setOverflows(element.scrollHeight > lineHeight * 2 + 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [reason])

  return <div className="approval-reason-wrap">
    <p ref={reasonRef} id={reasonId} className={expanded ? 'approval-reason is-expanded' : 'approval-reason'}>{reason}</p>
    {(overflows || expanded) && <button type="button" className="approval-reason-toggle"
      aria-expanded={expanded} aria-controls={reasonId} onClick={onToggle}>
      {expanded ? '收起全文' : '展开全文'}
    </button>}
  </div>
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
  const mobile = useMobileLayout()
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
        starterNotice={starterNotice}
        onChoosePrompt={onChoosePrompt}
      />
    )
  }

  if (mobile) {
    return (
      <MobileEmptyCampWelcome
        pending={snapshot.camp.activationState === 'pending'}
        onChoosePrompt={onChoosePrompt}
      />
    )
  }

  const runtimeSummary = emptyCampRuntimeSummary(snapshot.members, agents)
  return (
    <section className="empty-camp-welcome camp-home-welcome" aria-labelledby="empty-camp-title">
      <h2 id="empty-camp-title">想先做些什么？</h2>
      <p className="camp-home-context">
        <span className="sr-only">当前协作配置：</span>
        <span className="camp-home-project" title={projectLabel}>{projectLabel}</span>
        <span className="camp-home-separator">·</span>
        <span>{lead ? `队长${lead.displayName}` : '默认队长未设置'}</span>
        <span className="camp-home-separator">·</span>
        <span>{activeMembers.length} 位队员</span>
      </p>
      <div className="camp-home-actions" aria-label="起步建议">
        {EMPTY_CAMP_STARTERS.map((starter) => (
          <button type="button" key={starter.title} onClick={() => onChoosePrompt(starter.prompt)}>
            {starter.title}
          </button>
        ))}
      </div>
      {runtimeSummary !== 'Agent 运行时可用' && (
        <p className="camp-home-runtime" role="status">{runtimeSummary}</p>
      )}
    </section>
  )
}

function MobileEmptyCampWelcome({
  pending,
  onChoosePrompt
}: {
  pending: boolean
  onChoosePrompt(prompt: string, announceDraft?: boolean): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const suggestionsId = useId()
  return (
    <section className="empty-camp-welcome mobile-empty-camp-welcome" aria-labelledby={titleId}>
      <h2 id={titleId}>{pending ? '开始一段新对话' : '开始这段协作'}</h2>
      <div className="mobile-starter-panel">
        <button
          type="button"
          className="mobile-starter-toggle"
          aria-expanded={open}
          aria-controls={suggestionsId}
          onClick={() => setOpen((current) => !current)}
        >
          <span>起步建议</span>
          <svg className={open ? 'is-open' : ''} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 8 4 4 4-4" />
          </svg>
        </button>
        {open && (
          <div className="mobile-starter-list" id={suggestionsId} aria-label="起步建议">
            {EMPTY_CAMP_STARTERS.map((starter) => (
              <button
                type="button"
                key={starter.title}
                onClick={() => {
                  onChoosePrompt(starter.prompt)
                  setOpen(false)
                }}
              >
                <span>{starter.title}</span>
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m8 5 5 5-5 5" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function FirstRunCampWelcome({
  displayName,
  agentId,
  avatarRef,
  starterNotice,
  onChoosePrompt
}: {
  displayName: string
  agentId: string
  avatarRef: string | null
  starterNotice: string | null
  onChoosePrompt(prompt: string, announceDraft?: boolean): void
}): JSX.Element {
  const starters = firstRunCampStarters()
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
          <h2 id="first-run-camp-title">你好，我是{displayName}。</h2>
          <p>从一件具体的事开始。</p>
        </div>
      </div>

      <div className="first-run-starters" aria-label="可选的起步内容">
        {starters.map((starter, index) => (
          <button
            type="button"
            key={starter.title}
            onClick={() => onChoosePrompt(starter.prompt, true)}
          >
            <span className="first-run-starter-glyph" aria-hidden="true">
              {index < 2 ? <NavigationIcon name={index === 0 ? 'users' : 'calendar-clock'} /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" /></svg>}
            </span>
            <span><strong>{starter.title}</strong><small>{starter.body}</small></span>
          </button>
        ))}
      </div>

      <p className="first-run-draft-notice sr-only" role="status" aria-live="polite">
        {starterNotice}
      </p>
    </section>
  )
}

export function AgentRunFileChangesTimelineCard({
  changes,
  onOpenReview,
  onOpenCurrent
}: {
  changes: AgentRunFileChangesView
  onOpenReview(selectedEvidenceFileId: string | undefined, trigger: HTMLButtonElement): string | void
  onOpenCurrent(evidenceFileId: string, trigger: HTMLButtonElement): void
}): JSX.Element {
  const find = useOptionalFileFind()
  const [showAllFiles, setShowAllFiles] = useState(false)
  const visibleFiles = showAllFiles ? changes.files : changes.files.slice(0, 3)
  const additionalFileCount = Math.max(0, changes.files.length - 3)
  const defaultPreviewTarget = agentRunFileChangesPreviewTarget(changes)
  const hasReviewableDiff = defaultPreviewTarget?.kind === 'review'
  useEffect(() => {
    setShowAllFiles(false)
  }, [changes.agentRunId, changes.executionEpoch])
  return (
    <article className="timeline-node run-file-changes-card">
      <div className="run-file-changes-header-actions">
        <button
          className="run-file-changes-card-header"
          type="button"
          disabled={!defaultPreviewTarget}
          aria-label={hasReviewableDiff
            ? `查看 Files Changed，${agentRunFileChangesSummaryLabel(changes)}`
            : defaultPreviewTarget
              ? `打开当前文件 ${defaultPreviewTarget.file.path}，${agentRunFileChangesSummaryLabel(changes)}`
              : `Files Changed，${agentRunFileChangesSummaryLabel(changes)}`}
          onClick={(event) => {
            if (!defaultPreviewTarget) return
            if (defaultPreviewTarget.kind === 'review') {
              onOpenReview(undefined, event.currentTarget)
            } else {
              onOpenCurrent(defaultPreviewTarget.file.evidenceFileId, event.currentTarget)
            }
          }}
        >
          <span className="run-file-changes-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M4 7h6l2 2h8v10H4Z" />
              <path d="M8 13h8M12 11v4" />
            </svg>
          </span>
          <span className="run-file-changes-card-copy">
            <strong>Files Changed</strong>
            <span>{agentRunFileChangesSummaryLabel(changes)}</span>
          </span>
          <span className="run-file-changes-card-view" aria-hidden="true">
            {hasReviewableDiff ? '查看变化' : '查看文件'}
          </span>
        </button>
        {find && <button type="button" className="file-find-icon" aria-label="查找这次文件变化" title="查找这次文件变化"
          disabled={!hasReviewableDiff}
          onClick={event => { const id = onOpenReview(undefined, event.currentTarget); if (id) find.request(id, true) }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        </button>}
      </div>
      <div className="run-file-changes-card-files" aria-label="变更文件">
        {visibleFiles.map((file) => {
          return (
            <button
              key={file.evidenceFileId}
              className="run-file-change-file"
              type="button"
              aria-label={agentRunFileChangeHasReviewableDiff(file)
                ? `查看 ${file.path} 的文件变化`
                : `打开当前文件预览：${file.path}`}
              onClick={(event) => {
                if (agentRunFileChangeHasReviewableDiff(file)) {
                  onOpenReview(file.evidenceFileId, event.currentTarget)
                } else {
                  onOpenCurrent(file.evidenceFileId, event.currentTarget)
                }
              }}
            >
              <RunFileChangePath path={file.path} />
              <span className="run-file-change-stats" aria-hidden="true">
                {file.additions !== undefined && file.deletions !== undefined
                  ? <>
                      {file.additions > 0 && <i className="addition">+{file.additions}</i>}
                      {file.deletions > 0 && <i className="deletion">−{file.deletions}</i>}
                    </>
                  : <i>{file.operationCount} 次修改</i>}
              </span>
              <svg className="run-file-change-file-arrow" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m6.25 3.75 4 4.25-4 4.25" />
              </svg>
            </button>
          )
        })}
        {additionalFileCount > 0 && (
          <button
            className="run-file-changes-more-files"
            type="button"
            aria-expanded={showAllFiles}
            onClick={() => setShowAllFiles((visible) => !visible)}
          >
            <span>{showAllFiles ? '收起文件' : `再显示 ${additionalFileCount} 个文件`}</span>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
            </svg>
          </button>
        )}
      </div>
    </article>
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

export function defaultRecipientMentionAgentId(
  message: Pick<CampMessageView, 'authorType' | 'addressMode' | 'addressedAgentIds'>
): string | null {
  const humanAuthored = message.authorType === 'user'
    || message.authorType === 'external_principal'
  return humanAuthored
    && message.addressMode === 'default'
    && message.addressedAgentIds.length === 1
    ? message.addressedAgentIds[0]
    : null
}

function campMessageAuthorLabel(
  message: CampMessageView,
  memberById: ReadonlyMap<string, CampSnapshot['members'][number]>,
  currentUserName: string
): string {
  // Channel admission is Owner-only; this label does not change the stored author.
  if (message.authorType === 'user' || message.authorType === 'external_principal') return currentUserName
  if (message.authorType === 'system') return '系统'
  return memberById.get(message.authorId)?.displayName ?? message.authorId
}

function ReplyParentQuote({
  parent,
  projectedBody,
  authorLabel,
  unavailable,
  loading,
  onReveal
}: {
  parent: CampMessageView | null
  projectedBody: string
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
  return (
    <MessageQuotePreview
      authorLabel={authorLabel ?? '原消息'}
      body={projectedBody}
      onReveal={onReveal}
    />
  )
}

function MessageQuotePreview({
  authorLabel,
  body,
  onReveal
}: {
  authorLabel: string
  body: string
  onReveal?(): void
}): JSX.Element {
  const excerpt = body.split(/\s+/u).filter(Boolean).join(' ')
  const label = `${authorLabel} · ${excerpt}`
  const preview = (
    <>
      <ReplyMark />
      <strong>{authorLabel}</strong>
      <span>{excerpt}</span>
    </>
  )
  if (!onReveal) {
    return (
      <span className="reply-parent-quote is-static" title={label}>
        {preview}
      </span>
    )
  }
  return (
    <button className="reply-parent-quote" type="button" title={label} onClick={onReveal}>
      {preview}
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
  showActions = true,
  actionBefore,
  onReply,
  onCopy,
  onWithdraw,
  withdrawing = false,
  children
}: {
  copied: boolean
  hasDelivery: boolean
  showActions?: boolean
  actionBefore?: React.ReactNode
  onReply?(modality: ReplyFocusModality): void
  onCopy(): void
  onWithdraw?(): void
  withdrawing?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={`message-surface${hasDelivery ? ' has-delivery' : ''}${copied ? ' copied' : ''}`}>
      {children}
      {showActions && (
        <div className="message-action-line">
          {actionBefore}
          <MessageActions
            copied={copied}
            onReply={onReply}
            onCopy={onCopy}
            onWithdraw={onWithdraw}
            withdrawing={withdrawing}
          />
        </div>
      )}
    </div>
  )
}

function MessageActions({
  copied,
  className,
  onReply,
  onCopy,
  onWithdraw,
  withdrawing = false
}: {
  copied: boolean
  className?: string
  onReply?(modality: ReplyFocusModality): void
  onCopy(): void
  onWithdraw?(): void
  withdrawing?: boolean
}): JSX.Element {
  return (
    <div
      className={`message-actions${copied ? ' copied' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label="消息操作"
    >
      <span className="copy-feedback" role="status" aria-live="polite">
        {copied ? '已复制' : ''}
      </span>
      <MessageCopyButton copied={copied} onCopy={onCopy} />
      {onWithdraw && (
        <button
          className="message-withdraw-button"
          type="button"
          aria-label={withdrawing ? '正在撤回这条消息' : '撤回这条消息'}
          title="撤回"
          disabled={withdrawing}
          onClick={onWithdraw}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 7H5v-4" />
            <path d="M5.4 7.1A8 8 0 1 1 4.2 15" />
          </svg>
        </button>
      )}
      {onReply && (
        <button
          className="message-reply-button"
          type="button"
          aria-label="回复这条消息"
          title="回复"
          onClick={(event) => onReply(event.detail === 0 ? 'keyboard' : 'pointer')}
        >
          <MessageReplyIcon />
        </button>
      )}
    </div>
  )
}

function MessageReplyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.7 17.3H10l-4.2 3.1v-3.1h-.7a2.6 2.6 0 0 1-2.6-2.6V7.6A2.6 2.6 0 0 1 5.1 5h11.8a2.6 2.6 0 0 1 2.6 2.6v2.2" />
      <path d="m15.2 9.2-3.6 3.5 3.6 3.5" />
      <path d="M11.8 12.7h8.7" />
    </svg>
  )
}

function TruncatedStructuredMessageBody({
  body,
  content,
  members,
  leadingRecipientAgentId,
  truncate,
  forceExpanded,
  renderLeadingCurrentUserMarkdown = false,
  onActivateCurrentUserMention,
  onActivateMemberMention,
  onActivateAllMembersMention,
  onActivateSkillMention,
  onFileReference
}: {
  body: string
  content: StructuredCampMessageContent | null
  members: CampSnapshot['members']
  leadingRecipientAgentId?: string | null
  truncate: boolean
  forceExpanded: boolean
  renderLeadingCurrentUserMarkdown?: boolean
  onActivateCurrentUserMention?(trigger: HTMLElement, focusPanel: boolean): void
  onActivateMemberMention?(
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
  onActivateSkillMention?(skillId: string, trigger: HTMLElement): void
  onFileReference?: FileReferenceActivation
}): JSX.Element {
  const projection = useMemo(
    () => truncate ? collapsedMessageProjection(body, content) : null,
    [body, content, truncate]
  )
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const displayFullMessage = forceExpanded || expanded || projection === null
  const displayBody = displayFullMessage ? body : projection.body
  const displayContent = displayFullMessage ? content : projection.content

  const messageBody = (
    <StructuredMessageBody
      body={displayBody}
      content={displayContent}
      members={members}
      leadingRecipientAgentId={leadingRecipientAgentId}
      renderLeadingCurrentUserMarkdown={renderLeadingCurrentUserMarkdown}
      onActivateCurrentUserMention={onActivateCurrentUserMention}
      onActivateMemberMention={onActivateMemberMention}
      onActivateAllMembersMention={onActivateAllMembersMention}
      onActivateSkillMention={onActivateSkillMention}
      onFileReference={onFileReference}
    />
  )
  if (!projection || forceExpanded) return messageBody

  return (
    <div className="message-long-copy">
      <div id={contentId}>{messageBody}</div>
      <button
        className="message-long-toggle"
        type="button"
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>{expanded ? '收起' : '展开'}</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <span className="sr-only" aria-live="polite">
        {expanded ? '全文已展开' : '其余内容已收起'}，共 {projection.lineCount} 行
      </span>
    </div>
  )
}

export function AgentMessageMarkdownBody({
  body,
  content,
  members,
  onActivateMemberMention,
  onFileReference
}: {
  body: string
  content: StructuredCampMessageContent | null
  members: CampSnapshot['members']
  onActivateMemberMention(agentId: string, trigger: HTMLElement, focusPanel: boolean): void
  onFileReference?: FileReferenceActivation
}): JSX.Element {
  // Only authoritative leading tokens form a recipient prefix. Literal @names
  // stay Markdown text; the Renderer never derives addressing from the body.
  let prefixLength = 0
  for (const [index, segment] of (content ?? []).entries()) {
    if (segment.kind === 'member_mention') prefixLength = index + 1
    else if (segment.kind !== 'text' || segment.text.trim().length > 0) break
  }
  const markdownBody = content && prefixLength > 0
    ? structuredCampContentMarkdownText(content.slice(prefixLength), members)
    : body
  if (!content || prefixLength === 0) {
    return <SafeMarkdown onFileReference={onFileReference}>{body}</SafeMarkdown>
  }

  const hasBody = markdownBody.trim().length > 0
  const inlineBody = hasBody && !/^\s*[\r\n]/u.test(markdownBody)
  const prefix = (
    <StructuredMessageBody
      inline={hasBody}
      body=""
      content={content.slice(0, prefixLength)}
      members={members}
      onActivateMemberMention={onActivateMemberMention}
    />
  )
  return (
    <div className="member-mention-markdown-body" data-inline-body={inlineBody}>
      {hasBody ? (
        <SafeMarkdown
          className="member-mention-markdown-content"
          leadingContent={prefix}
          inlineLeadingContent={inlineBody}
          onFileReference={onFileReference}
        >
          {markdownBody}
        </SafeMarkdown>
      ) : prefix}
    </div>
  )
}

export function StructuredMessageBody({
  body,
  content,
  members,
  leadingRecipientAgentId,
  inline = false,
  renderLeadingCurrentUserMarkdown = false,
  onActivateCurrentUserMention,
  onActivateMemberMention,
  onActivateAllMembersMention,
  onActivateSkillMention,
  onFileReference
}: {
  body: string
  content: StructuredCampMessageContent | null
  members: CampSnapshot['members']
  leadingRecipientAgentId?: string | null
  inline?: boolean
  renderLeadingCurrentUserMarkdown?: boolean
  onActivateCurrentUserMention?(trigger: HTMLElement, focusPanel: boolean): void
  onActivateMemberMention?(
    agentId: string,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
  onActivateSkillMention?(skillId: string, trigger: HTMLElement): void
  onFileReference?: FileReferenceActivation
}): JSX.Element {
  const memberById = new Map(members.map((member) => [member.agentId, member]))
  const leadingRecipientPrefix = leadingRecipientAgentId ? (
    <span className="default-recipient-mention-prefix" data-quote-exclude="">
      <MemberMentionToken
        agentId={leadingRecipientAgentId}
        member={memberById.get(leadingRecipientAgentId)}
        onActivate={onActivateMemberMention}
      />
      {body.length > 0 && !/^\s/u.test(body) ? ' ' : ''}
    </span>
  ) : null
  const markdownBody = renderLeadingCurrentUserMarkdown && content !== null
    ? projectLeadingCurrentUserMentionMarkdownBody(content, members)
    : null
  if (content === null) {
    return <p>{leadingRecipientPrefix}<FileReferenceText text={body} onActivate={onFileReference} /></p>
  }
  if (markdownBody !== null) {
    return (
      <div className="current-user-markdown-body">
        {leadingRecipientPrefix}
        <span className="current-user-mention-prefix">
          <CurrentUserMentionToken onActivate={onActivateCurrentUserMention} />
          {markdownBody.length > 0 ? ' ' : ''}
        </span>
        {markdownBody.length > 0 && (
          <SafeMarkdown className="current-user-markdown-content" onFileReference={onFileReference}>
            {markdownBody}
          </SafeMarkdown>
        )}
      </div>
    )
  }
  if (renderLeadingCurrentUserMarkdown && content.some((segment) => segment.kind === 'current_user_mention')) {
    const source = structuredCampContentMarkdownText(content, members)
    const prefix = markdownInlineContentPrefix(source)
    // Every CurrentUser occurrence has the same identity. Keep its placeholder
    // identical too, so Markdown reference labels match Core's quote projection.
    const token = `${prefix}END`
    const inlineContent = { [token]: <CurrentUserMentionToken onActivate={onActivateCurrentUserMention} /> }
    const markdown = content.map((segment, index) => {
      if (segment.kind !== 'current_user_mention') {
        return structuredCampContentMarkdownText([segment], members)
      }
      return token + (index === 0 && content.length > 1 ? ' ' : '')
    }).join('')
    return <SafeMarkdown onFileReference={onFileReference} inlineContent={inlineContent}>{markdown}</SafeMarkdown>
  }
  const Tag = inline ? 'span' : 'p'
  return (
    <Tag className="structured-message-body">
      {leadingRecipientPrefix}
      {content.map((segment, index) => {
        if (segment.kind === 'text') {
          // Core's quote separator belongs to the plain-text/context projection;
          // the shared preview already owns the visual gap before the message.
          const text = content[index - 1]?.kind === 'external_quote'
            ? segment.text.replace(/^\n\n/u, '')
            : segment.text
          return text ? (
            <span key={`text-${index}`}>
              <FileReferenceText text={text} onActivate={onFileReference} />
            </span>
          ) : null
        }
        if (segment.kind === 'current_user_mention') {
          return (
            <span key={`current-user-${index}`}>
              <CurrentUserMentionToken onActivate={onActivateCurrentUserMention} />
              {index === 0 && content.slice(1).some((candidate) => (
                candidate.kind !== 'text' || candidate.text.length > 0
              )) ? ' ' : ''}
            </span>
          )
        }
        if (segment.kind === 'skill_mention') {
          return (
            <button
              type="button"
              className="message-mention-token skill-mention is-interactive"
              aria-label={`预览 Skill /${segment.nameAtSend} 文件`}
              key={`skill-${index}-${segment.skillId}`}
              onClick={(event) => onActivateSkillMention?.(segment.skillId, event.currentTarget)}
            >
              /{segment.nameAtSend}
            </button>
          )
        }
        if (segment.kind === 'external_quote') {
          const excerpt = [
            segment.body,
            ...segment.attachmentSummaries.map((attachment) => `[附件] ${attachment.name}`)
          ].filter((text) => text.trim().length > 0).join(' ')
          return (
            <MessageQuotePreview
              key={`external-quote-${index}`}
              authorLabel={segment.senderDisplayName}
              body={excerpt || '（无文本）'}
            />
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
        return (
          <MemberMentionToken
            key={`member-${index}-${segment.agentId}`}
            agentId={segment.agentId}
            member={memberById.get(segment.agentId)}
            onActivate={onActivateMemberMention}
          />
        )
      })}
    </Tag>
  )
}

function MemberMentionToken({
  agentId,
  member,
  onActivate
}: {
  agentId: string
  member: CampSnapshot['members'][number] | undefined
  onActivate?(agentId: string, trigger: HTMLElement, focusPanel: boolean): void
}): JSX.Element {
  const available = Boolean(
    member
    && member.membershipStatus === 'active'
    && member.profilePresence !== 'removed'
  )
  const interactive = Boolean(available && onActivate)
  const showMemberProfile = (
    trigger: HTMLElement,
    respectTextSelection: boolean,
    focusPanel: boolean
  ): void => {
    if (!interactive || !member || !onActivate) return
    if (respectTextSelection && window.getSelection()?.toString()) return
    onActivate(member.agentId, trigger, focusPanel)
  }
  return (
    <span
      className={`message-mention-token${available ? '' : ' is-unavailable'}${interactive ? ' is-interactive' : ''}`}
      data-agent-id={agentId}
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
    >
      @{member?.displayName ?? '不可用队员'}
    </span>
  )
}

function CurrentUserMentionToken({ onActivate }: {
  onActivate?(trigger: HTMLElement, focusPanel: boolean): void
}): JSX.Element {
  const { profile } = useCurrentUserProfile()
  const displayName = currentUserDisplayName(profile)
  return (
    <span
      className={`message-mention-token current-user${onActivate ? ' is-interactive' : ''}`}
      data-quote-current-user-name={displayName}
      role={onActivate ? 'button' : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? `查看${displayName}的个人资料` : `提及当前用户：${displayName}`}
      aria-haspopup={onActivate ? 'dialog' : undefined}
      aria-expanded={onActivate ? false : undefined}
      onClick={(event) => {
        if (window.getSelection()?.toString()) return
        onActivate?.(event.currentTarget, false)
      }}
      onKeyDown={(event) => {
        if (!onActivate || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onActivate(event.currentTarget, true)
      }}
    >
      @{displayName}
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
      title="复制"
      onClick={() => { dismissMessageQuoteSelection(); onCopy() }}
    >
      <CopyIcon copied={copied} />
    </button>
  )
}


export function MessageAttachmentGroups({
  attachments,
  runtimeImages = [],
  campId,
  messageId,
  presentation,
  onNotify
}: {
  attachments: CampMessageAttachmentView[]
  runtimeImages?: GalleryImage[]
  campId: string
  messageId: string
  presentation: 'user' | 'agent'
  onNotify: (message: string) => void
}): JSX.Element | null {
  const groups = partitionMessageAttachments(attachments)
  const images: GalleryImage[] = [
    ...groups.images.map((image): GalleryImage => ({
      kind: 'attachment',
      campId,
      locator: { owner: 'message', campId, messageId, attachmentRefId: image.id },
      image
    })),
    ...runtimeImages
  ]
  if (images.length === 0 && groups.files.length === 0) return null

  if (presentation === 'user') {
    return (
      <section className="message-attachments user-message-attachments" aria-label="消息附件">
        {images.length > 0 && (
          <div className="user-message-images">
            <ImageGallery images={images} variant="user-attachment" />
          </div>
        )}
        {groups.files.length > 0 && (
          <div className="user-message-files" role="group" aria-label="消息文件">
            {groups.files.map((attachment) => (
              <AttachmentCard
                attachment={attachment}
                locator={{ owner: 'message', campId, messageId, attachmentRefId: attachment.id }}
                key={attachment.id}
                onNotify={onNotify}
                presentation="user-timeline"
              />
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="message-attachments agent-message-outputs" aria-label="Agent 交付">
      {images.length > 0 && (
        <div className="agent-output-images">
          <ImageGallery images={images} variant="agent-output" />
        </div>
      )}
      {groups.files.length > 0 && (
        <div className="agent-output-files">
          <div className="agent-output-file-grid" role="group" aria-label={`Agent 交付文件：${groups.files.length} 个`}>
            {groups.files.map((attachment) => (
              <AttachmentCard
                attachment={attachment}
                locator={{ owner: 'message', campId, messageId, attachmentRefId: attachment.id }}
                key={attachment.id}
                onNotify={onNotify}
                presentation="agent-timeline"
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}


function attachmentErrorMessage(error: unknown): string {
  const message = readErrorMessage(error)
  if (message.includes('25 MiB')) return '文件超过 25 MiB'
  if (message.includes('attachment_unreadable')) return '文件当前无法读取'
  if (message.includes('attachment_kind_changed')) return '文件类型已变化'
  if (message.includes('legacy_draft.attachments_locked')) return '请先发送或移除旧版草稿附件'
  if (message.includes('unsupported item')) return '文件夹包含不支持的项目'
  if (message.includes('regular files and directories')) return '仅支持普通文件或文件夹'
  return '安全接入失败，可移除后重试'
}

function replyDraftErrorMessage(error: unknown): string {
  const message = readErrorMessage(error)
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

export function TaskTimelineCard({
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
        状态：{taskStatusLabel(task.status)}；负责人：{assigneeName}；
        {presentation.noteLabel}：{presentation.note}
      </span>
    </button>
  )
}

type RunExecutionHistoryStatus = 'idle' | 'loading' | 'ready' | 'failed'

function RunExecutionContent({
  run,
  windowedEvidence = false,
  liveRevision,
  progress,
  campId,
  truncatedEvidence,
  historicalEvidence,
  historyStatus,
  finalBody,
  cancelling,
  onLoadHistoricalEvidence,
  onFileOpenError
}: {
  run: AgentRunView
  windowedEvidence?: boolean
  liveRevision?: unknown
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence: AgentRunExecutionEvidenceView[]
  historicalEvidence: AgentRunExecutionEvidenceView[] | null
  historyStatus: RunExecutionHistoryStatus
  finalBody: string | null
  cancelling: boolean
  onLoadHistoricalEvidence(): Promise<void>
  onFileOpenError(message: string): void
}): JSX.Element {
  const client = useCampClient()
  const mobile = useMobileLayout()
  const nonTerminal = NON_TERMINAL_RUNS.has(run.status)
  const publicFailure = run.status === 'failed' ? run.failure : null
  const showUnsettledWarning = agentRunShowsUnsettledWarning(run)
  const [narrationBodies, setNarrationBodies] = useState<Map<string, string>>(new Map())
  const windowPage = useExecutionWindow(windowedEvidence, campId, run, liveRevision, narrationBodies)
  const displayedEvidence = windowedEvidence ? windowPage.evidence : historicalEvidence
  const narrationEvidence = displayedEvidence ?? truncatedEvidence
  const narrationCache = useRef(new Map<string, { stamp: string; body: string }>())
  const latestNarrationIds = useRef(new Set<string>())
  const [narrationStatus, setNarrationStatus] = useState<RunExecutionHistoryStatus>('idle')
  const [narrationRetry, setNarrationRetry] = useState(0)
  useEffect(() => {
    if (windowedEvidence) return undefined
    let disposed = false
    const needed = narrationEvidence.filter(item => item.eventType === 'agent.text.block'
      && item.isTruncated && item.contentBlobId)
    const stamps = new Map(needed.map(item => [item.id, `${item.contentBlobId}:${item.contentByteCount}`]))
    const cache = narrationCache.current
    if (!windowPage.hasNewer) latestNarrationIds.current = new Set(stamps.keys())
    for (const [id, stamp] of stamps) {
      const cached = cache.get(id)
      if (!cached) continue
      cache.delete(id)
      if (cached.stamp === stamp) cache.set(id, cached)
    }
    const cachedBodies = (): Map<string, string> => {
      let bytes = [...cache.values()].reduce((total, value) => total + value.body.length * 2, 0)
      for (const [id, value] of cache) {
        if (cache.size <= 64 && bytes <= 8 * 1024 * 1024) break
        if (stamps.has(id) || latestNarrationIds.current.has(id)) continue
        cache.delete(id)
        bytes -= value.body.length * 2
      }
      // Body retention is independent from the two mounted pages as well.
      return new Map(needed.flatMap(item => {
        const cached = cache.get(item.id)
        return cached ? [[`narration:${item.id}`, cached.body] as const] : []
      }))
    }
    setNarrationBodies(cachedBodies())
    const missing = needed.filter(item => !cache.has(item.id))
    if (missing.length === 0) {
      setNarrationStatus('ready')
      return undefined
    }
    setNarrationStatus('loading')
    void loadExecutionNarrationBodies(missing, (evidenceId) =>
      client.request('agentRunEvidence.getContent', { campId, evidenceId })
    ).then((bodies) => {
      if (disposed) return
      for (const item of missing) {
        const body = bodies.get(`narration:${item.id}`)
        if (body !== undefined) cache.set(item.id, { stamp: stamps.get(item.id)!, body })
      }
      setNarrationBodies(cachedBodies())
      setNarrationStatus('ready')
    }).catch(() => {
      if (!disposed) setNarrationStatus('failed')
    })
    return () => { disposed = true }
  }, [client, campId, narrationEvidence, narrationRetry, windowPage.hasNewer, windowedEvidence])
  const historicalProgress = useMemo(() => {
    if (!displayedEvidence) return null
    const build = () => buildLiveExecutionProgress(displayedEvidence.map(liveRuntimeEventFromExecutionEvidence),
      run.id, { includePublicResults: false })
    return windowedEvidence ? windowPage.project(displayedEvidence, build) : build()
  }, [displayedEvidence, run.id, windowedEvidence])
  const effectiveProgress = historicalProgress ?? progress
  const finalKey = finalBody ? comparableMessageText(finalBody) : null
  const processItems = useMemo(() => (effectiveProgress?.items ?? []).map((item) =>
    item.kind === 'narration' && narrationBodies.has(item.key)
      ? { ...item, body: narrationBodies.get(item.key)! }
      : item
  ).filter((item) =>
    item.kind !== 'narration' || !finalKey || comparableMessageText(item.body) !== finalKey
  ), [effectiveProgress?.items, finalKey, narrationBodies])
  const windowGroupKeys = useRef({ next: 0, byItem: new Map<string, string>() })
  const groupedProcessItems = useMemo(() => {
    const groups = groupConsecutiveToolItems(processItems)
    if (!windowedEvidence) return groups
    const identities = windowGroupKeys.current
    const currentKeys = new Set(processItems.map(item => item.key))
    for (const key of identities.byItem.keys()) if (!currentKeys.has(key)) identities.byItem.delete(key)
    const used = new Set<string>()
    return groups.map(group => {
      if (group.kind !== 'toolGroup') return group
      // A page can prepend the first operation of an existing group. Keep its
      // React identity so expanded child results and keyboard focus survive.
      const key = group.items.map(item => identities.byItem.get(item.key))
        .find((key): key is string => key !== undefined && !used.has(key))
        ?? `window-tool-group:${identities.next++}`
      used.add(key)
      for (const item of group.items) identities.byItem.set(item.key, key)
      return { ...group, key }
    })
  }, [processItems, windowedEvidence])
  const activeToolItems = useMemo(
    () => processItems.filter((item): item is ToolProgressItem => item.kind === 'tool'),
    [processItems]
  )
  const hasActiveTool = toolActivityGroupHasActiveTool(activeToolItems, run.status)
  const hasActiveCompaction = executionHasActiveCompaction(processItems)
  const trailingProcessItem = groupedProcessItems[groupedProcessItems.length - 1]
  const runtimePhase = windowedEvidence ? windowPage.runtimePhase : effectiveProgress?.runtimePhase
  const thinkingAfterTool = run.status === 'running'
    && runtimePhase === 'thinking'
    && trailingProcessItem?.kind === 'toolGroup'
    && (!windowedEvidence || !windowPage.hasNewer)
    && !hasActiveTool
    && !hasActiveCompaction
    && !finalBody
  const liveTailToolGroupKey = run.status === 'running'
    && !cancelling
    && !thinkingAfterTool
    && trailingProcessItem?.kind === 'toolGroup'
    ? trailingProcessItem.key
    : null
  const activeRetryDiagnostic = nonTerminal
    ? processItems.reduce<RuntimeDiagnostic | null>((latest, item) =>
        item.kind === 'diagnostic' ? item.diagnostic : latest, null)
    : null
  const completeEvidence = selectCompletePresentableExecutionEvidence(
    displayedEvidence ?? truncatedEvidence
  )
  const initialFeedback = executionInitialFeedback(
    run.status,
    processItems,
    Boolean(finalBody),
    runtimePhase
  )
  const phaseFeedback = thinkingAfterTool ? '思考中' : initialFeedback
  const feedback = run.status === 'waiting' ? agentRunWaitDetail(run.waitReason) ?? '等待继续'
    : run.failure?.code === 'runtime_network_interrupted' ? '正在恢复连接'
      : activeRetryDiagnostic
        ? `等待 Claude Code 自动重试（${activeRetryDiagnostic.attempt}/${activeRetryDiagnostic.maxAttempts}）`
        : phaseFeedback
  const sequenceByKey = useMemo(() => new Map<string, number>((displayedEvidence ?? []).flatMap(item => [
    [`narration:${item.id}`, item.sequence] as const,
    [`tool:${item.canonical?.operationId ?? item.id}`, item.sequence] as const
  ])), [displayedEvidence])
  const narrationByKey = useMemo(() => new Map((displayedEvidence ?? []).map(item => [`narration:${item.id}`, item])), [displayedEvidence])
  const earlierLoadError = windowPage.direction === 'newer' ? null : windowPage.error
  // A live Run already presents its connection/thinking feedback. Stacking the
  // empty initial history-page loader above it makes the card 50px taller until
  // the first window request settles, then visibly moves that feedback upward.
  const earlierLoading = windowPage.loading
    && windowPage.direction !== 'newer'
    && (!nonTerminal || windowPage.evidence.length > 0)
  const processItemGap = mobile ? 14 : 8

  return (
    <ExecutionContentContext.Provider value={windowedEvidence ? windowPage.contentCache : null}>
    <div className="process-content" ref={windowPage.root}
      data-execution-run-id={run.id}
      data-execution-loaded-count={windowedEvidence ? windowPage.evidence.length : undefined}
      data-execution-first-sequence={windowedEvidence ? windowPage.evidence[0]?.sequence : undefined}>
      {windowedEvidence && (windowPage.hasEarlier || earlierLoadError || earlierLoading) && (
        <div className={`camp-history-loader execution-history-loader${earlierLoadError ? ' is-error' : ''}`}
          role={earlierLoadError ? 'alert' : 'status'} aria-atomic="true">
          {earlierLoadError && <>
            <span>执行记录暂时没有加载</span>
            <span className="camp-history-separator" aria-hidden="true">·</span>
          </>}
          <button className="camp-history-text-button" type="button" disabled={windowPage.loading} onClick={() => {
            void windowPage.move(earlierLoadError ? 'retry' : windowPage.evidence.length ? 'earlier' : 'latest')
          }}>{earlierLoading ? <>
            <span className="camp-history-spinner" aria-hidden="true" />
            <span>{windowPage.evidence.length ? '正在加载执行记录…' : '正在加载…'}</span>
          </> : earlierLoadError ? '重试' : <><span aria-hidden="true">↑</span><span>加载更早记录</span></>}</button>
          {!earlierLoadError && windowPage.evidence.length > 0 && <>
            <span className="camp-history-separator" aria-hidden="true">·</span>
            <span className="camp-history-count">已载入 {processItems.length} 项</span>
          </>}
        </div>
      )}
      {showUnsettledWarning && (
        <p className="execution-uncertain" role="status">
          仍有外部效果待确认
        </p>
      )}
      <ExecutionVirtualList items={groupedProcessItems} enabled={windowedEvidence} gap={processItemGap}
        gapAfter={(item, next) => (item.kind === 'toolGroup' && next.kind === 'compaction')
          || (item.kind === 'compaction' && (next.kind === 'toolGroup' || next.kind === 'compaction')) ? 4 : processItemGap}
        onVisible={visible => {
        const keys = visible.flatMap(item => item.kind === 'toolGroup' ? item.items.map(child => child.key) : [item.key])
        const sequences = keys.flatMap(key => sequenceByKey.has(key) ? [sequenceByKey.get(key)!] : [])
        if (sequences.length) windowPage.setViewport(Math.min(...sequences), Math.max(...sequences))
      }}>{(item) => {
        if (item.kind === 'toolGroup') {
          return (
            <ToolActivityGroup
              key={item.key}
              campId={campId}
              items={item.items}
              liveTail={item.key === liveTailToolGroupKey}
              cancelling={cancelling}
              runId={run.id}
              runStatus={run.status}
              completeEvidence={completeEvidence}
              onFileOpenError={onFileOpenError}
            />
          )
        }
        if (item.kind === 'diagnostic') {
          return nonTerminal
            ? <RuntimeRetryNotice diagnostic={item.diagnostic} key={item.key} />
            : null
        }
        if (item.kind === 'compaction') {
          return (
            <CompactionEventRow
              key={item.key}
              campId={campId}
              compaction={item.compaction}
              runId={run.id}
              runStatus={run.status}
              completeEvidence={completeEvidence.byCompactionId.get(item.compaction.id)}
            />
          )
        }
        if (item.kind === 'narration') {
          return (
            <div className={`process-copy stream-${item.kind}`} key={item.key} data-execution-item-key={item.key}>
              {windowedEvidence ? <ExecutionNarration campId={campId} evidence={narrationByKey.get(item.key)} preview={item.body} />
                : <SafeMarkdown>{item.body}</SafeMarkdown>}
            </div>
          )
        }
        if (item.kind === 'plan') {
          return (
            <div className="process-plan live-progress-plan" key={item.key} data-execution-item-key={item.key}>
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
        if (step.fileChanges?.length) {
          return step.fileChanges.map((change, index) => (
            <ModifiedFileRow
              change={change}
              itemKey={`${item.key}:file:${index}`}
              completeEvidence={completeEvidence.byToolId.get(step.id)}
              campId={campId}
              key={`${item.key}:file:${index}:${change.path}`}
              onFileOpenError={onFileOpenError}
              semanticKind={step.fileChangeSemantics}
            />
          ))
        }
        if (step.fileOperation) {
          return (
            <FileOperationRow
              key={item.key}
              campId={campId}
              step={step as ToolCallStep & { fileOperation: NonNullable<ToolCallStep['fileOperation']> }}
              runStatus={run.status}
              completeEvidence={completeEvidence.byFileOperationToolId.get(step.id)}
              onFileOpenError={onFileOpenError}
            />
          )
        }
        const fullEvidence = completeEvidence.byToolId.get(step.detailOperationId ?? step.id)
        return (
          <ToolCallRow
            key={item.key}
            campId={campId}
            step={step}
            runId={run.id}
            runStatus={run.status}
            completeEvidence={fullEvidence}
            onFileOpenError={onFileOpenError}
          />
        )
      }}</ExecutionVirtualList>
      {windowedEvidence && windowPage.direction === 'newer' && (windowPage.loading || windowPage.error) && <div className={`camp-history-loader execution-history-loader${windowPage.error ? ' is-error' : ''}`}
        role={windowPage.error ? 'alert' : 'status'}>
        {windowPage.loading && <span className="camp-history-spinner" aria-label="正在加载执行记录" />}
        {windowPage.error && <button className="camp-history-text-button" type="button"
          onClick={() => void windowPage.move('retry')}>读取失败，重试</button>}
      </div>}
      {(historyStatus === 'loading' || narrationStatus === 'loading') && (
        <div className="process-action current" role="status">
          <span className="process-spinner" aria-hidden="true" />
          <span>正在读取完整过程</span>
        </div>
      )}
      {(historyStatus === 'failed' || narrationStatus === 'failed') && (
        <div className="process-action history-load-error" role="status">
          <span>完整执行过程读取失败。</span>
          <button className="quiet-button compact" type="button" onClick={() => {
            if (narrationStatus === 'failed') setNarrationRetry((value) => value + 1)
            if (historyStatus === 'failed') void onLoadHistoricalEvidence()
          }}>
            重试
          </button>
        </div>
      )}
      {nonTerminal && !cancelling && run.waitReason === 'recovery_blocked' && (
        <div className="process-recovery-blocker" role="status">
          <div>
            <strong>执行异常，正在清理</strong>
            <p>原请求不会自动重发；清理完成后，后续消息会按正常顺序继续执行。</p>
          </div>
        </div>
      )}
      {nonTerminal && !cancelling && run.waitReason === 'network_recovery_blocked' && (
        <div className="process-recovery-blocker" role="status">
          <div>
            <strong>自动恢复已停止</strong>
            <p>
              恢复前的安全条件已经变化，Rovai AI 不会自动重发原请求。
              请检查执行记录；需要继续时可停止本次运行，再发送后续任务。
            </p>
          </div>
        </div>
      )}
      {nonTerminal
        && !cancelling
        && run.waitReason !== 'recovery_blocked'
        && run.waitReason !== 'network_recovery_blocked'
        && !hasActiveTool
        && !hasActiveCompaction
        && liveTailToolGroupKey === null
        && feedback
        && (
          <div className={`process-action current${feedback === phaseFeedback ? ' is-phase-feedback' : ''}`} role="status">
            <span className="process-spinner" aria-hidden="true" />
            <RunningText text={feedback} />
          </div>
        )}
      {cancelling && nonTerminal && (
        <div className="process-action cancelling" role="status">
          正在提交停止请求，完成后即可继续发送。
        </div>
      )}
      {publicFailure && <RuntimeFailureNotice failure={publicFailure} presentation="agent-run" />}
    </div>
    </ExecutionContentContext.Provider>
  )
}

export function RunExecutionDisclosure({
  run,
  windowedEvidence = false,
  liveRevision,
  progress,
  campId,
  truncatedEvidence = [],
  loadedEvidenceCount = 0,
  finalBody = null,
  cancelling = false,
  focused = false,
  expanded,
  hideSummary = false,
  onFileOpenError = () => undefined
}: {
  run: AgentRunView
  windowedEvidence?: boolean
  liveRevision?: unknown
  progress?: LiveExecutionProgress
  campId: string
  truncatedEvidence?: AgentRunExecutionEvidenceView[]
  loadedEvidenceCount?: number
  finalBody?: string | null
  cancelling?: boolean
  focused?: boolean
  expanded?: boolean
  hideSummary?: boolean
  onFileOpenError?(message: string): void
}): JSX.Element | null {
  const client = useCampClient()
  const mobile = useMobileLayout()
  const recovery = useEditingRecovery()
  const recoveryKey = `mobile-run:${campId}:${run.id}`
  const nonTerminal = NON_TERMINAL_RUNS.has(run.status)
  const active = executionDisclosureIsLiveOpen(run.status, focused, cancelling)
  const cancellingActive = nonTerminal && cancelling && focused
  const publicFailure = run.status === 'failed' ? run.failure : null
  const hasPublicFailure = publicFailure !== null
  const defaultOpen = (mobile ? nonTerminal : active) || hasPublicFailure
  const [open, setOpen] = useState(() => {
    try {
      const saved = mobile ? recovery?.get(recoveryKey) : null
      return typeof saved === 'boolean' ? saved : defaultOpen
    } catch { return defaultOpen }
  })
  useEffect(() => { try { if (mobile) recovery?.set(recoveryKey, open) } catch { /* Optional disclosure memory. */ } }, [mobile, recovery, recoveryKey, open])
  const previousNonTerminal = useRef(nonTerminal)
  const [historicalEvidence, setHistoricalEvidence] = useState<AgentRunExecutionEvidenceView[] | null>(null)
  const [historyStatus, setHistoryStatus] = useState<RunExecutionHistoryStatus>('idle')
  const shouldActivateContent = expanded !== undefined
    ? expanded
    : windowedEvidence
      ? open || active || cancellingActive
      : open || focused || nonTerminal
  const [contentMounted, setContentMounted] = useState(() => shouldActivateContent)
  useEffect(() => {
    if (expanded !== undefined) {
      previousNonTerminal.current = nonTerminal
      return
    }
    const completed = previousNonTerminal.current && !nonTerminal
    if (mobile) { previousNonTerminal.current = nonTerminal; return }
    setOpen((currentOpen) => completed
      ? hasPublicFailure
      : executionDisclosureOpenAfterActivity(currentOpen, active || cancellingActive || hasPublicFailure))
    previousNonTerminal.current = nonTerminal
  }, [active, cancellingActive, expanded, hasPublicFailure, nonTerminal, mobile])
  useEffect(() => {
    if (shouldActivateContent) setContentMounted(true)
  }, [shouldActivateContent])

  const durableEvidenceCount = Math.max(0, run.executionEvidenceCount)
  const historyNeeded = !windowedEvidence && !nonTerminal && loadedEvidenceCount < durableEvidenceCount
  const showUnsettledWarning = agentRunShowsUnsettledWarning(run)
  const hasDisclosureWithoutProgress = nonTerminal
    || durableEvidenceCount > 0
    || truncatedEvidence.length > 0
    || showUnsettledWarning
    || hasPublicFailure
  if (!hasDisclosureWithoutProgress) {
    const finalKey = finalBody ? comparableMessageText(finalBody) : null
    const hasProgress = (progress?.items ?? []).some((item) =>
      item.kind !== 'narration' || !finalKey || comparableMessageText(item.body) !== finalKey
    )
    if (!hasProgress) return null
  }

  const loadHistoricalEvidence = async (): Promise<void> => {
    if (!historyNeeded || historyStatus === 'loading' || historyStatus === 'ready') return
    setHistoryStatus('loading')
    try {
      const evidence = await loadCompleteAgentRunExecutionEvidence(
        (params) => client.request<AgentRunExecutionEvidencePage>(
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

  useEffect(() => {
    if (!hideSummary || !expanded) return
    setContentMounted(true)
    void loadHistoricalEvidence()
  }, [expanded, hideSummary])

  const shouldMountContent = windowedEvidence ? shouldActivateContent : contentMounted || shouldActivateContent
  const content = shouldMountContent ? (
    <RunExecutionContent
      run={run}
      windowedEvidence={windowedEvidence}
      liveRevision={liveRevision}
      progress={progress}
      campId={campId}
      truncatedEvidence={truncatedEvidence}
      historicalEvidence={historicalEvidence}
      historyStatus={historyStatus}
      finalBody={finalBody}
      cancelling={cancelling}
      onLoadHistoricalEvidence={loadHistoricalEvidence}
      onFileOpenError={onFileOpenError}
    />
  ) : null

  const liveOpen = !mobile && (active || cancellingActive)
  if (hideSummary) {
    return expanded
      ? <div className={`execution-disclosure ${nonTerminal
        ? `run-live ${cancellingActive ? 'is-cancelling' : 'is-running'}`
        : 'worked is-terminal'}`}>{content}</div>
      : null
  }
  return (
    <details
      className={`execution-disclosure ${liveOpen
        ? `run-live ${cancellingActive ? 'is-cancelling' : 'is-running'}`
        : `worked ${nonTerminal ? 'is-live-collapsed' : 'is-terminal'}`}`}
      open={liveOpen || open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        if (!liveOpen) setOpen(nextOpen)
        if (nextOpen) {
          setContentMounted(true)
          void loadHistoricalEvidence()
        }
      }}
    >
      <summary hidden={liveOpen} className={mobile ? 'mobile-run-summary' : undefined}>
        {mobile && <time className="mobile-run-time">{runIntervalLabel(run)}</time>}
        <span className="process-disclosure-label">{mobile ? agentRunPresentation(run, cancelling).label : !liveOpen && (nonTerminal
          ? cancelling ? '正在停止' : run.status === 'waiting' ? agentRunWaitDetail(run.waitReason) ?? '等待继续'
            : executionInitialFeedback(
              run.status,
              progress?.items ?? [],
              Boolean(finalBody),
              progress?.runtimePhase
            ) ?? '执行中'
          : executionRunSummary(run, run.updatedAt))}</span>
        {mobile && focused && nonTerminal && <span className="current-run-badge">当前执行</span>}
        <span className="process-disclosure-slot" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4.75 6.25 3.25 3.5 3.25-3.5" />
          </svg>
        </span>
      </summary>
      {content}
    </details>
  )
}

function comparableMessageText(value: string): string {
  return value.replace(/[\s*_`#>-]+/g, '').toLocaleLowerCase()
}

function runtimeAdapterLabel(kind: string): string {
  return ({
    'codex-cli': 'Codex CLI',
    pi: 'Pi Coding Agent',
    'opencode-cli': 'OpenCode',
    'copilot-cli': 'GitHub Copilot',
    'claude-code-cli': 'Claude Code',
    'kiro-cli': 'Kiro',
    'qoder-cli': 'Qoder',
    'codebuddy-cli': 'CodeBuddy',
    'qwen-code': 'Qwen Code',
    'trae-cn-cli': 'TRAE CLI',
    'cursor-agent': 'Cursor Agent',
    'kimi-code-cli': 'Kimi Code',
    'grok-build': 'Grok Build',
    'deepseek-harness': 'DeepSeek Harness',
    'zcode-app': 'ZCode',
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
  return choices.find((choice) => choice.value === value)?.label ?? value
}

export function executionDrawerTitle(
  displayName: string,
  runtimeAdapterKind: string | null
): string {
  return runtimeAdapterKind
    ? `${displayName} ${runtimeAdapterLabel(runtimeAdapterKind)}`
    : displayName
}

function runIntervalLabel(run: AgentRunView): string {
  const startedAt = run.startedAt ?? run.createdAt
  const endedAt = NON_TERMINAL_RUNS.has(run.status)
    ? null
    : run.endedAt ?? run.updatedAt
  return `${messageClockTime(startedAt)}–${endedAt ? messageClockTime(endedAt) : '现在'}`
}

interface TaskEditorValues {
  title: string
  description: string
  assigneeAgentId: string
  status: TaskStatus
  blockedReason: string
  completionSummary: string
}

interface TaskEditorDraft extends TaskEditorValues {
  base?: TaskEditorValues
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
  const client = useCampClient()
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const detailRef = useRef<HTMLElement>(null)
  const drafts = useRef(new Map<string, TaskEditorDraft>())
  const editBase = useRef<TaskEditorValues | null>(null)
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeAgentId, setAssigneeAgentId] = useState('')
  const [status, setStatus] = useState<TaskStatus>('pending')
  const [blockedReason, setBlockedReason] = useState('')
  const [completionSummary, setCompletionSummary] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const selectedTask = selectedTaskId
    ? snapshot.tasks.find((task) => task.taskId === selectedTaskId) ?? null
    : null
  const detailTask = detailTaskId
    ? snapshot.tasks.find((task) => task.taskId === detailTaskId) ?? null
    : null
  const visibleTasks = snapshot.tasks.filter((task) => statusFilter === 'all' || task.status === statusFilter)
  const openTaskCount = snapshot.tasks.filter((task) => task.status !== 'completed' && task.status !== 'cancelled').length
  const activeMembers = snapshot.members.filter((member) =>
    member.membershipStatus === 'active' && member.leaveRequestedAt === null)

  useEffect(() => {
    onCreateModeChange?.(editorOpen && mode === 'create')
    return () => onCreateModeChange?.(false)
  }, [editorOpen, mode, onCreateModeChange])

  const resetForm = (): void => {
    setEditorOpen(false)
    setCancelOpen(false)
    setMode('list')
    setSelectedTaskId(null)
    setTitle('')
    setDescription('')
    setAssigneeAgentId('')
    setStatus('pending')
    setBlockedReason('')
    setCompletionSummary('')
    setCancelReason('')
    editBase.current = null
    setFormError(null)
  }

  const applyDraft = (draft: TaskEditorDraft): void => {
    setTitle(draft.title)
    setDescription(draft.description)
    setAssigneeAgentId(draft.assigneeAgentId)
    setStatus(draft.status)
    setBlockedReason(draft.blockedReason)
    setCompletionSummary(draft.completionSummary)
    editBase.current = draft.base ?? null
    setFormError(null)
  }

  const closeEditor = (): void => {
    if (submitting) return
    drafts.current.set(selectedTaskId ?? 'new', {
      title, description, assigneeAgentId, status,
      blockedReason, completionSummary,
      ...(editBase.current ? { base: editBase.current } : {})
    })
    setEditorOpen(false)
  }

  const beginCreate = (): void => {
    resetForm()
    const draft = drafts.current.get('new')
    if (draft) applyDraft(draft)
    setMode('create')
    setEditorOpen(true)
  }

  const beginEdit = (task: TaskView): void => {
    setSelectedTaskId(task.taskId)
    const values: TaskEditorValues = {
      title: task.title,
      description: task.description,
      assigneeAgentId: task.assigneeAgentId ?? '',
      status: task.status,
      blockedReason: task.blockedReason ?? '',
      completionSummary: task.completionSummary ?? ''
    }
    applyDraft(drafts.current.get(task.taskId) ?? { ...values, base: values })
    setMode('edit')
    setEditorOpen(true)
  }

  useEffect(() => {
    if (!focusTaskId || focusRequest === 0) return
    const task = snapshot.tasks.find((candidate) => candidate.taskId === focusTaskId)
    if (task) {
      setDetailTaskId(task.taskId)
    } else {
      setDetailTaskId(null)
      setFormError('这项任务当前不可见，无法打开详情。')
    }
  }, [focusRequest, focusTaskId])

  useEffect(() => {
    if (!detailTaskId) return
    detailRef.current?.focus({ preventScroll: true })
    const scroll = detailRef.current?.closest('.task-panel-scroll')
    if (scroll) scroll.scrollTop = 0
  }, [detailTaskId, focusRequest])

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
      const result = await client.request<StoredCommandResult>('tasks.create', {
        commandId: newCommandId(),
        campId: snapshot.camp.id,
        title: title.trim(),
        description: description.trim(),
        assigneeAgentId
      })
      if (result.status === 'rejected') {
        setFormError(taskCommandMessage(result))
        return
      }
      drafts.current.delete(selectedTaskId ?? 'new')
      resetForm()
      await onTasksChanged()
    } catch (error) {
      setFormError(localizeExecutionEngineTerms(readErrorMessage(error)))
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
    const base = editBase.current
    if (!base) {
      setFormError('编辑草稿已失效，请重新打开任务。')
      setSubmitting(false)
      return
    }
    const patch = {
      ...(title.trim() !== base.title ? { title: title.trim() } : {}),
      ...(description.trim() !== base.description ? { description: description.trim() } : {}),
      ...(status !== base.status ? { status } : {}),
      ...(assigneeAgentId !== base.assigneeAgentId ? {
        assignee: assigneeAgentId
          ? { operation: 'assign' as const, agentId: assigneeAgentId }
          : { operation: 'clear' as const }
      } : {}),
      ...(status === 'blocked' && blockedReason.trim() !== base.blockedReason
        ? { blockedReason: blockedReason.trim() } : {}),
      ...(status === 'completed' && completionSummary.trim() !== base.completionSummary
        ? { completionSummary: completionSummary.trim() } : {})
    }
    if (Object.keys(patch).length === 0) {
      setFormError('没有需要提交的修改。')
      setSubmitting(false)
      return
    }
    try {
      const result = await client.request<StoredCommandResult>('tasks.update', {
        commandId: newCommandId(),
        campId: snapshot.camp.id,
        taskId: selectedTask.taskId,
        ...patch
      })
      if (result.status === 'rejected') {
        setFormError(taskCommandMessage(result))
        return
      }
      drafts.current.delete(selectedTaskId ?? 'new')
      resetForm()
      await onTasksChanged()
    } catch (error) {
      setFormError(localizeExecutionEngineTerms(readErrorMessage(error)))
    } finally {
      setSubmitting(false)
    }
  }

  const submitCancel = async (): Promise<void> => {
    if (!selectedTask || !cancelReason.trim() || submitting || busy) return
    setSubmitting(true)
    setFormError(null)
    try {
      const result = await client.request<StoredCommandResult>('tasks.update', {
        commandId: newCommandId(),
        campId: snapshot.camp.id,
        taskId: selectedTask.taskId,
        status: 'cancelled',
        cancelReason: cancelReason.trim()
      })
      if (result.status === 'rejected') {
        setFormError(taskCommandMessage(result))
        return
      }
      drafts.current.delete(selectedTaskId ?? 'new')
      resetForm()
      await onTasksChanged()
    } catch (error) {
      setFormError(localizeExecutionEngineTerms(readErrorMessage(error)))
    } finally {
      setSubmitting(false)
    }
  }

  const terminal = selectedTask
    ? selectedTask.status === 'completed' || selectedTask.status === 'cancelled'
    : false

  const detailTerminal = detailTask?.status === 'completed' || detailTask?.status === 'cancelled'

  return (
    <div className="task-panel">
      {!detailTask && <>
        <div className="task-action-row">
          <span className="task-list-summary">{openTaskCount > 0 ? `${openTaskCount} 项未完成` : `${snapshot.tasks.length} 项任务`}</span>
          <select
            className="task-status-filter"
            aria-label="筛选任务状态"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as 'all' | TaskStatus)}
          >
            <option value="all">全部状态</option>
            <option value="in_progress">进行中</option>
            <option value="pending">待处理</option>
            <option value="blocked">已阻塞</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
          <button className="primary-button conversation-primary-button compact task-new-button" type="button" onClick={() => beginCreate()} disabled={busy}>
            <span aria-hidden="true">＋</span> 新建
          </button>
        </div>
        {formError && !editorOpen && !cancelOpen && <p className="task-form-error" role="alert">{formError}</p>}
        {coverage && !coverage.complete && (
          <p className="task-history-note" role="status">
            当前显示 {coverage.loadedCount} / {coverage.totalCount} 个任务；更早的已结束任务尚未载入。
          </p>
        )}
        <div className="task-list">
          {visibleTasks.map((task) => (
            <button className="task-list-row" type="button" key={task.taskId} data-task-id={task.taskId} onClick={() => setDetailTaskId(task.taskId)}>
              <span className={`task-state-dot state-${task.status}`} aria-hidden="true">{task.status === 'completed' ? '✓' : task.status === 'blocked' ? '!' : task.status === 'cancelled' ? '−' : ''}</span>
              <span className="task-list-copy">
                <strong>{task.title}</strong>
                <span className="task-list-meta">
                  <b className={`state-${task.status}`}>{taskStatusLabel(task.status)}</b>
                  <small>{taskAssigneeName(task, snapshot)}</small>
                </span>
                {task.status === 'blocked' && task.blockedReason && <small className="task-list-note">{task.blockedReason}</small>}
              </span>
              <svg className="task-list-chevron" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="m6 4 4 4-4 4" /></svg>
            </button>
          ))}
          {visibleTasks.length === 0 && <p className="task-empty">{snapshot.tasks.length === 0 ? '暂无任务' : '没有符合筛选条件的任务'}</p>}
        </div>
      </>}

      {detailTask && <article className="task-detail" ref={detailRef} tabIndex={-1} aria-label="任务详情" data-task-id={detailTask.taskId}>
        <div className="task-detail-navigation">
          <button className="quiet-button compact" type="button" onClick={() => setDetailTaskId(null)}><span aria-hidden="true">←</span> 返回</button>
        </div>
        <h3>{detailTask.title}</h3>
        <div className="task-detail-meta"><span className={`task-detail-status state-${detailTask.status}`}>{taskStatusLabel(detailTask.status)}</span><span>{taskAssigneeName(detailTask, snapshot)}</span></div>
        <section className="task-detail-section"><strong>责任范围与要求</strong><p className="task-detail-copy">{detailTask.description || '暂无责任范围与要求'}</p></section>
        {detailTask.blockedReason && <section className="task-detail-section task-outcome is-blocked"><strong>阻塞原因</strong><p className="task-detail-copy">{detailTask.blockedReason}</p></section>}
        {detailTask.completionSummary && <section className="task-detail-section task-outcome is-completed"><strong>完成摘要</strong><p className="task-detail-copy">{detailTask.completionSummary}</p></section>}
        {detailTask.cancelReason && <section className="task-detail-section task-outcome"><strong>取消原因</strong><p className="task-detail-copy">{detailTask.cancelReason}</p></section>}
        <RelatedTaskExecution task={detailTask} snapshot={snapshot} onOpenAgent={onOpenAgent} />
        <details className="task-audit-disclosure"><summary>更多信息</summary><TaskAuditDetail task={detailTask} /></details>
        {detailTerminal
          ? <p className="task-terminal-note">已结束的任务保留为只读记录，不能重新打开或删除。</p>
          : <div className="task-detail-actions">
              <button className="quiet-button" type="button" disabled={busy} onClick={() => beginEdit(detailTask)}>编辑</button>
              <button className="quiet-button task-cancel-action" type="button" disabled={busy} onClick={() => {
                setSelectedTaskId(detailTask.taskId)
                setCancelReason('')
                setFormError(null)
                setCancelOpen(true)
              }}>取消任务</button>
            </div>}
      </article>}

      <Dialog.Root open={editorOpen} onOpenChange={(open) => { if (!open) closeEditor() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="task-editor-dialog" width="wide">
            <AppDialogHeader icon="pencil" title={mode === 'create' ? '新建任务' : '编辑任务'} description={mode === 'create' ? '记录需要持续跟踪的责任范围与要求。' : '修改任务内容与状态。'}
            hideDescription />
            <form className="task-editor" onSubmit={(event) => void (mode === 'create' ? submitCreate(event) : submitUpdate(event))}>
              <AppDialogBody>
                {formError && <p className="task-form-error" role="alert">{formError}</p>}
                {mode === 'edit' && terminal && <p className="task-terminal-note" role="status">这项任务已结束，不能再修改。你的草稿仍保留。</p>}
                <TaskFields
                  title={title}
                  description={description}
                  assigneeAgentId={assigneeAgentId}
                  status={mode === 'create' ? 'pending' : status}
                  blockedReason={blockedReason}
                  completionSummary={completionSummary}
                  members={activeMembers}
                  disabled={submitting || busy || (mode === 'edit' && terminal)}
                  showStatus={mode === 'edit'}
                  requireAssignee={mode === 'create'}
                  autoFocusTitle
                  onTitle={setTitle}
                  onDescription={setDescription}
                  onAssignee={setAssigneeAgentId}
                  onStatus={setStatus}
                  onBlockedReason={setBlockedReason}
                  onCompletionSummary={setCompletionSummary}
                />
              </AppDialogBody>
              <AppDialogFooter>
                <small className="task-draft-note">关闭后保留本次草稿</small>
                <button className="quiet-button" type="button" disabled={submitting} onClick={closeEditor}>收起</button>
                <button className="primary-button conversation-primary-button task-submit" type="submit" disabled={!title.trim() || submitting || busy || (mode === 'edit' && (terminal || !selectedTask))}>
                  {submitting ? '正在保存…' : mode === 'create' ? '新建' : '保存'}
                </button>
              </AppDialogFooter>
            </form>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={cancelOpen} onOpenChange={(open) => { if (!submitting) setCancelOpen(open) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent className="task-cancel-dialog" tone="danger" width="compact">
            <AppDialogHeader icon="warning" title="取消任务？" description={selectedTask?.title} />
            <AppDialogBody>
              <p className="task-cancel-description">任务将结束，已经接受或正在进行的执行不会停止。</p>
              <label className="task-field"><span>取消原因</span><textarea data-dialog-autofocus value={cancelReason} rows={3} maxLength={4000} required disabled={submitting || busy} onChange={(event) => setCancelReason(event.currentTarget.value)} /></label>
              {formError && <p className="task-form-error" role="alert">{formError}</p>}
            </AppDialogBody>
            <AppDialogFooter>
              <button className="quiet-button" type="button" disabled={submitting} onClick={() => setCancelOpen(false)}>取消</button>
              <button className="danger-button" type="button" disabled={!cancelReason.trim() || submitting || busy || terminal} onClick={() => void submitCancel()}>{submitting ? '正在取消…' : '取消任务'}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function TaskFields({
  title,
  description,
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
  onAssignee,
  onStatus,
  onBlockedReason = () => {},
  onCompletionSummary = () => {}
}: {
  title: string
  description: string
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
  onAssignee(value: string): void
  onStatus(value: TaskStatus): void
  onBlockedReason?(value: string): void
  onCompletionSummary?(value: string): void
}): JSX.Element {
  const unavailableAssignee = assigneeAgentId
    && !members.some((member) => member.agentId === assigneeAgentId)

  return (
    <>
      <label className="task-field"><span>标题</span><input value={title} maxLength={160} required data-dialog-autofocus={autoFocusTitle || undefined} disabled={disabled} onChange={(event) => onTitle(event.currentTarget.value)} /></label>
      <label className="task-field"><span>责任范围与要求</span><textarea value={description} rows={6} maxLength={16000} disabled={disabled} onChange={(event) => onDescription(event.currentTarget.value)} placeholder="记录需要跨消息持续跟踪的责任范围与要求…" /></label>
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value))
}

function TaskAuditDetail({ task }: { task: TaskView }): JSX.Element {
  return (
    <section className="task-detail-section" aria-label="任务审计信息">
      <strong>责任与审计</strong>
      <dl className="task-detail-grid">
        <div><dt>任务 ID</dt><dd>{task.taskId}</dd></div>
        <div><dt>创建者</dt><dd>{task.createdByType} · {task.createdById}</dd></div>
        <div><dt>来源执行</dt><dd>{task.sourceAgentRunId ?? '无'}</dd></div>
        <div><dt>创建时间</dt><dd>{formatDateTime(task.createdAt)}</dd></div>
        <div><dt>更新时间</dt><dd>{formatDateTime(task.updatedAt)}</dd></div>
        <div><dt>结束者</dt><dd>{task.closedByType ? `${task.closedByType} · ${task.closedById}` : '未结束'}</dd></div>
        <div><dt>结束时间</dt><dd>{task.closedAt ? formatDateTime(task.closedAt) : '未结束'}</dd></div>
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
    'task.invalid_status_transition': '当前任务状态不允许这样变更。'
  }
  return messages[result.code] ?? `修改未完成：${result.code}`
}

function shortIdentity(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`
}
