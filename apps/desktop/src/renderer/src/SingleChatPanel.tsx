import { revealMessageQuote } from './message-quote-reveal'
import { MessageQuotes, MessageQuoteSelectionToolbar } from './MessageQuotes'
import type { MessageQuoteAction, MessageQuoteSnapshot } from '@contracts'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent
} from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AgentRunExecutionEvidenceView,
  AgentProfile,
  ActionApprovalView,
  NotificationSingleChatSource,
  CampMemberView,
  CoreEvent,
  SingleChatPendingInputView,
  SingleChatConversationView,
  SingleChatMessageView,
  SingleChatRunView,
  SingleChatSnapshot,
  StoredCommandResult
} from '@contracts'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { AttachmentCard } from './AttachmentCard'
import {
  attachmentDragKind,
  dataTransferContainsFiles,
  droppedAttachmentInputs,
  type AttachmentDragKind
} from './attachment-drop'
import { MemberAvatar } from './MemberAvatar'
import { ApprovalDock, rectanglesOverlap, type CampLeavePreparation, type NotificationFocusTarget, type VisibleNotificationSources } from './CampWorkspace'
import { CompactionEventRow, RuntimeRetryNotice, ToolActivityGroup, isPresentableExecutionEvidence } from './ExecutionToolGroup'
import { executionInitialFeedback, executionRunSummary } from './execution-run-summary'
import { ComposerPrimaryAction } from './ComposerPrimaryAction'
import { SafeMarkdown } from './SafeMarkdown'
import { shouldSubmitStructuredComposerOnEnter } from './StructuredMentionComposer'
import { readErrorMessage } from './error-message'
import {
  buildLiveExecutionProgress,
  selectCompleteExecutionEvidence,
  liveRuntimeEventFromExecutionEvidence,
  type ExecutionProgressItem
} from './ui-model'
import {
  executionHasActiveCompaction,
  groupConsecutiveToolItems,
  toolActivityGroupHasActiveTool,
  type GroupedExecutionProgressItem,
  type ToolProgressItem
} from './execution-tool-grouping'

const NON_TERMINAL_RUNS = new Set<SingleChatRunView['status']>(['queued', 'running', 'waiting'])
export const SINGLE_CHAT_POLL_INTERVAL_MS = 800
const END_CONFIRMATION_STORAGE_KEY = 'rovai.single-chat.skip-end-confirmation.v1'

export type SingleChatTargetRequest = {
  agentId: string
  sequence: number
}

export type SingleChatEndTarget = {
  campId: string
  conversationId: string
  displayName: string
}

export function singleChatTargetRequestIsCurrent(
  request: SingleChatTargetRequest,
  currentSequence: number,
  selectedAgentId: string | null
): boolean {
  return request.sequence === currentSequence && request.agentId === selectedAgentId
}

export function singleChatConversationReady(
  snapshot: SingleChatSnapshot | null,
  selectedAgentId: string | null,
  loading: boolean
): boolean {
  return Boolean(
    !loading
    && selectedAgentId
    && (!snapshot || snapshot.conversation.agentId === selectedAgentId)
  )
}

export function singleChatEndTargetFromSnapshot(
  snapshot: SingleChatSnapshot,
  displayName: string
): SingleChatEndTarget {
  return {
    campId: snapshot.conversation.campId,
    conversationId: snapshot.conversation.id,
    displayName
  }
}

export function singleChatEndCommand(
  target: SingleChatEndTarget
): {
  campId: string
  conversationId: string
} {
  return {
    campId: target.campId,
    conversationId: target.conversationId
  }
}

export function singleChatSnapshotNeedsPolling(snapshot: SingleChatSnapshot | null): boolean {
  return Boolean(
    snapshot
    && (
      snapshot.agentRuns.some((run) => NON_TERMINAL_RUNS.has(run.status))
      || snapshot.pendingInputs.items.some((item) => item.state === 'queued')
    )
  )
}

export function startSingleChatPolling<Timer>(
  conversationId: string,
  refresh: (conversationId: string) => Promise<SingleChatSnapshot | null | undefined>,
  schedule: (callback: () => void, delayMs: number) => Timer,
  cancel: (timer: Timer) => void
): () => void {
  let disposed = false
  let timer: Timer | null = null

  const queueNext = (): void => {
    timer = schedule(() => void poll(), SINGLE_CHAT_POLL_INTERVAL_MS)
  }
  const poll = async (): Promise<void> => {
    timer = null
    let next: SingleChatSnapshot | null | undefined
    try {
      next = await refresh(conversationId)
    } catch {
      next = undefined
    }
    if (disposed) return
    if (next === undefined || singleChatSnapshotNeedsPolling(next)) queueNext()
  }

  queueNext()
  return () => {
    disposed = true
    if (timer !== null) cancel(timer)
    timer = null
  }
}

export type SingleChatChangeRefreshTarget = 'none' | 'conversation-list' | 'current-conversation'

function eventRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nonEmptyEventString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function singleChatChangeRefreshTarget(
  event: CoreEvent,
  campId: string,
  currentConversationId: string | null
): SingleChatChangeRefreshTarget {
  if (event.method !== 'single_chat.changed') return 'none'
  const params = eventRecord(event.params)
  if (params?.campId !== campId) return 'none'
  const result = eventRecord(params.result)
  const resultPayload = eventRecord(result?.payload)
  const conversationId = nonEmptyEventString(params.conversationId)
    ?? nonEmptyEventString(resultPayload?.conversationId)
  const resultCode = nonEmptyEventString(result?.code)
  const reason = nonEmptyEventString(params.reason)

  if (resultCode === 'single_chat.opened' || resultCode === 'single_chat.ended') {
    return 'conversation-list'
  }
  if (conversationId && conversationId === currentConversationId) {
    return 'current-conversation'
  }
  if (resultCode === 'single_chat.reply_queued' || reason === 'pending_input_published') {
    return 'conversation-list'
  }
  // If Core cannot identify the changed conversation, reconcile the bounded
  // active list. Other identified conversations cannot affect this transcript.
  return conversationId ? 'none' : 'conversation-list'
}

function SingleChatGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.6-4.5A7 7 0 0 1 3 13V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
    </svg>
  )
}

function ChevronGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
}

function CloseGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m4 4 8 8M12 4l-8 8" /></svg>
}

function LockGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
}

function CheckGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3.2 8.2 2.7 2.7 6.8-6.4" /></svg>
}

type PreparingSingleChatAttachment = {
  id: string
  name: string
  error: string | null
}


function SingleChatAttachmentStrip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="composer-attachment-strip" role="group" aria-label="待发送附件">{children}</div>
}

function SingleChatAttachmentPlaceholder({ item, onRemove }: {
  item: PreparingSingleChatAttachment
  onRemove?(): void
}): React.JSX.Element {
  return (
    <div className={`attachment-card composer-attachment-card attachment-${item.error ? 'error' : 'preparing'}`}>
      <span className="attachment-visual" aria-hidden="true">
        {item.error ? '!' : <i className="attachment-loading" />}
      </span>
      <span className="attachment-copy">
        <strong title={item.name}>{item.name}</strong>
        <small>{item.error ?? '正在安全接入…'}</small>
      </span>
      {item.error && onRemove && <button className="attachment-remove" type="button" aria-label={`移除失败附件 ${item.name}`} onClick={onRemove}>×</button>}
    </div>
  )
}

function safeStoredBoolean(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function storeBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // A denied local-storage write should not block the explicit end action.
  }
}

function resultMessage(result: StoredCommandResult): string {
  const message = result.payload.message
  if (typeof message === 'string' && message.trim()) return message
  if (result.code === 'single_chat.runtime_not_ready') return '这位队员的运行时暂不可用。'
  if (result.code === 'single_chat.member_unavailable') return '这位队员已不在当前会话中。'
  if (result.code === 'single_chat.draft_changed') return '附件草稿刚刚发生变化，请重试。'
  if (result.code === 'single_chat.pending_input_changed') return '这条排队消息刚刚发生变化，请重试。'
  if (result.code === 'single_chat.pending_input_edit_open') return '另一处正在编辑这条排队消息。'
  return `操作未完成：${result.code}`
}

function resultPayloadString(result: StoredCommandResult, field: string): string | null {
  const value = result.payload[field]
  return typeof value === 'string' && value.trim() ? value : null
}

export { formatExecutionDuration as formatSingleChatDuration, executionRunSummary as singleChatRunSummary } from './execution-run-summary'

export function singleChatEvidenceForRun(
  evidence: readonly AgentRunExecutionEvidenceView[],
  run: Pick<SingleChatRunView, 'id' | 'executionEpoch'>
): AgentRunExecutionEvidenceView[] {
  return evidence
    .filter((item) => item.agentRunId === run.id && item.executionEpoch === run.executionEpoch)
    .sort((left, right) => left.sequence - right.sequence)
}

function memberCanSingleChat(member: CampMemberView): boolean {
  return member.membershipStatus === 'active'
    && member.leaveRequestedAt === null
    && member.profilePresence === 'present'
}

export function SingleChatRunHistory({
  campId,
  conversationId,
  run,
  evidence,
  finalMessage,
  now,
  cancelling = false,
  onNotify = () => undefined
}: {
  campId: string
  conversationId: string
  run: SingleChatRunView
  evidence: AgentRunExecutionEvidenceView[]
  finalMessage: SingleChatMessageView | null
  now: string
  cancelling?: boolean
  onNotify?(message: string): void
}): React.JSX.Element {
  const terminal = !NON_TERMINAL_RUNS.has(run.status)
  const stopping = !terminal && (cancelling || run.cancelRequestedAt !== null)
  const [open, setOpen] = useState(!terminal)
  const previousStatus = useRef(run.status)
  useEffect(() => {
    const wasTerminal = !NON_TERMINAL_RUNS.has(previousStatus.current)
    if (!wasTerminal && terminal) setOpen(false)
    if (wasTerminal && !terminal) setOpen(true)
    previousStatus.current = run.status
  }, [run.status, terminal])

  const processItems = useMemo(() => {
    const events = evidence.map(liveRuntimeEventFromExecutionEvidence)
    return buildLiveExecutionProgress(events, run.id, { textMode: 'complete' }).items
      .filter((item: ExecutionProgressItem) => item.kind !== 'narration'
        || !finalMessage
        || item.body.trim() !== finalMessage.body.trim())
  }, [evidence, finalMessage, run.id])
  const grouped = useMemo(() => groupConsecutiveToolItems(processItems), [processItems])
  const completeEvidence = useMemo(() => selectCompleteExecutionEvidence(
    evidence.filter((item) => item.isTruncated).filter(isPresentableExecutionEvidence)
  ), [evidence])
  const trailingItem = grouped.at(-1)
  const liveTailKey = run.status === 'running' && !stopping && trailingItem?.kind === 'toolGroup'
    ? trailingItem.key
    : null
  const hasActiveTool = toolActivityGroupHasActiveTool(
    processItems.filter((item): item is ToolProgressItem => item.kind === 'tool'), run.status
  )
  const hasActiveCompaction = executionHasActiveCompaction(processItems)
  const retry = !terminal ? processItems.findLast((item) => item.kind === 'diagnostic') : null
  const feedback = run.status === 'waiting' ? '等待继续'
    : retry?.kind === 'diagnostic'
      ? `等待 Claude Code 自动重试（${retry.diagnostic.attempt}/${retry.diagnostic.maxAttempts}）`
      : executionInitialFeedback(run.status, processItems, finalMessage !== null)

  const renderItem = (item: GroupedExecutionProgressItem): React.JSX.Element | null => {
    if (item.kind === 'toolGroup' || item.kind === 'tool') {
      return <ToolActivityGroup
        key={item.key}
        campId={campId}
        items={item.kind === 'toolGroup' ? item.items : [item]}
        liveTail={item.key === liveTailKey}
        cancelling={stopping}
        runId={run.id}
        runStatus={run.status}
        completeEvidence={completeEvidence}
        onFileOpenError={onNotify}
      />
    }
    if (item.kind === 'narration') {
      return <div className="single-chat-narration" key={item.key}><SafeMarkdown>{item.body}</SafeMarkdown></div>
    }
    if (item.kind === 'plan') {
      return <div className="process-plan live-progress-plan" key={item.key}>
        {item.explanation && <SafeMarkdown>{item.explanation}</SafeMarkdown>}
        {item.plan.length > 0 && <ol>{item.plan.map((step, index) => (
          <li className={`plan-${step.status}`} key={`${index}:${step.step}`}>
            <span aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '●' : '○'}</span>
            <span>{step.step}</span>
          </li>
        ))}</ol>}
      </div>
    }
    if (item.kind === 'diagnostic') {
      return !terminal ? <RuntimeRetryNotice diagnostic={item.diagnostic} key={item.key} /> : null
    }
    if (item.kind === 'compaction') {
      return <CompactionEventRow
        key={item.key}
        campId={campId}
        compaction={item.compaction}
        runId={run.id}
        runStatus={run.status}
        completeEvidence={completeEvidence.byCompactionId.get(item.compaction.id)}
      />
    }
    return null
  }

  return (
    <section className="single-chat-agent-response" aria-label="队员回复" data-single-chat-run-id={run.id} tabIndex={-1}>
      <div className="single-chat-agent-column">
        <details
          className={`single-chat-run-history${terminal ? ' is-terminal' : ' is-live'}`}
          open={!terminal || open}
          onToggle={(event) => { if (terminal) setOpen(event.currentTarget.open) }}
        >
          <summary hidden={!terminal}>
            <span className="single-chat-run-summary" data-notification-turn-id={terminal ? run.campTurnId : undefined}>{terminal && executionRunSummary(run, now)}</span>
            <span className="single-chat-disclosure" aria-hidden="true"><ChevronGlyph /></span>
          </summary>
          <div className="single-chat-execution-content process-content">
            {grouped.map(renderItem)}
            {!terminal && !stopping && !hasActiveTool && !hasActiveCompaction && liveTailKey === null && feedback && (
              <div className="process-action current" role="status">
                <span className="process-spinner" aria-hidden="true" />
                <span>{feedback}</span>
              </div>
            )}
            {stopping && <div className="process-action cancelling" role="status">正在提交停止请求，完成后即可继续发送。</div>}
            {grouped.length === 0 && run.status === 'failed' && (
              <p className="single-chat-process-note is-error">本轮回复失败，可以重新发送。</p>
            )}
          </div>
        </details>
        {finalMessage && <>
          <hr className="single-chat-final-rule" />
          <div className="single-chat-final" data-single-chat-message-id={finalMessage.id} data-message-quote-body={finalMessage.id} data-quote-owner={`single_chat:${conversationId}`} data-notification-turn-id={run.campTurnId}><SafeMarkdown>{finalMessage.body}</SafeMarkdown></div>
        </>}
      </div>
    </section>
  )
}

async function revealPrivateQuote(quote: MessageQuoteSnapshot): Promise<void> {
  const root = document.querySelector<HTMLElement>(`[data-single-chat-owner="${CSS.escape(quote.source.conversationId ?? '')}"]`)
  const target = root?.querySelector<HTMLElement>(`[data-message-quote-body="${CSS.escape(quote.source.messageId)}"]`)
  if (!target) throw new Error('quote.source_unavailable')
  await revealMessageQuote(quote, target, quote.authorAtCapture.type === 'user' ? target.textContent ?? '' : undefined)
}

function SingleChatTranscript({
  snapshot,
  now,
  cancelling,
  onNotify
}: {
  snapshot: SingleChatSnapshot
  now: string
  cancelling: boolean
  onNotify(message: string): void
}): React.JSX.Element {
  const runsByTrigger = useMemo(() => new Map(
    snapshot.agentRuns.map((run) => [run.triggerConversationMessageId, run])
  ), [snapshot.agentRuns])
  const finalByRun = useMemo(() => {
    const result = new Map<string, SingleChatMessageView>()
    for (const message of snapshot.messages) {
      if (message.authorType === 'agent' && message.agentRunId) result.set(message.agentRunId, message)
    }
    return result
  }, [snapshot.messages])

  return <>
    {snapshot.messages.map((message) => {
      if (message.authorType === 'agent') return null
      if (message.authorType === 'system') {
        return <p className="single-chat-system-message" key={message.id}>{message.body}</p>
      }
      const run = runsByTrigger.get(message.id) ?? null
      return (
        <div className="single-chat-turn" key={message.id} data-single-chat-message-id={message.id}>
          <div className="single-chat-user-message">
            <div className="single-chat-user-content">
              <MessageQuotes history quotes={message.quotes ?? []} onReveal={revealPrivateQuote} />
              {message.body && <div className="single-chat-user-bubble" data-message-quote-body={message.id} data-quote-owner={`single_chat:${snapshot.conversation.id}`}>{message.body}</div>}
              {message.attachments.length > 0 && (
                <div className="single-chat-message-attachments" role="group" aria-label={`附件 ${message.attachments.length} 个`}>
                  {message.attachments.map((attachment) => (
                    <AttachmentCard
                      attachment={attachment}
                      locator={{
                        owner: 'single_chat_message',
                        campId: snapshot.conversation.campId,
                        conversationId: snapshot.conversation.id,
                        conversationMessageId: message.id,
                        attachmentRefId: attachment.id
                      }}
                      onNotify={onNotify}
                      presentation="user-timeline"
                      key={attachment.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          {run && (
            <SingleChatRunHistory
              conversationId={snapshot.conversation.id}
              campId={snapshot.conversation.campId}
              cancelling={cancelling && run.id === snapshot.conversation.activeAgentRunId}
              onNotify={onNotify}
              run={run}
              evidence={singleChatEvidenceForRun(snapshot.executionEvidence, run)}
              finalMessage={finalByRun.get(run.id) ?? null}
              now={now}
            />
          )}
        </div>
      )
    })}
  </>
}

function singleChatPendingError(code: string | null): string | null {
  if (!code) return null
  if (code === 'attachment_missing') return '附件已被移动或删除，请编辑这条消息。'
  if (code === 'attachment_unreadable') return '附件当前无法读取，请检查权限或编辑这条消息。'
  if (code === 'attachment_kind_changed') return '附件类型已变化，请编辑这条消息。'
  return `发送未完成（${code}），消息已保留。`
}

function SingleChatPendingQueue({ snapshot, busyOutside, onRefresh, onNotify, onReturnToComposer }: {
  snapshot: SingleChatSnapshot
  busyOutside: boolean
  onRefresh(): Promise<void>
  onNotify(message: string): void
  onReturnToComposer(item: SingleChatPendingInputView, editToken: string | null): Promise<void>
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const queue = snapshot.pendingInputs
  const session = queue.editSession
  const perform = async (item: SingleChatPendingInputView, remove: boolean): Promise<void> => {
    if (busyRef.current || busyOutside) return
    busyRef.current = true
    setBusy(true)
    try {
      const editToken = session?.pendingInputId === item.id ? session.editToken : null
      if (remove) {
        const result = await window.rovai.request<StoredCommandResult>('singleChat.pendingInputs.edit', {
          commandId: crypto.randomUUID(), command: { campId: snapshot.conversation.campId,
            conversationId: snapshot.conversation.id, pendingInputId: item.id,
            expectedRevision: item.revision, editToken, action: { type: 'delete' } }
        })
        if (result.status === 'rejected') throw new Error(resultMessage(result))
      } else await onReturnToComposer(item, editToken)
    } catch (error) {
      onNotify(readErrorMessage(error, '待发送消息操作未完成。'))
    } finally {
      await onRefresh().catch(() => undefined)
      busyRef.current = false
      setBusy(false)
    }
  }
  if (queue.items.length === 0) return null

  return (
    <section className="pending-input-queue single-chat-pending-queue" aria-label="单聊待发送消息">
      <div className="pending-input-heading"><span>待发送 · {queue.items.length}</span></div>
      <ul className="pending-input-list">
        {queue.items.map((item) => {
          const repairMessage = singleChatPendingError(item.lastAttemptErrorCode)
          return (
            <li className="pending-input-row" key={item.id}>
              <div className="pending-input-preview" title={item.body}>
                <span className="pending-input-mark" aria-hidden="true" />
                <span className="pending-input-copy">{item.body || `附件消息 · ${item.attachments.length}`}</span>
                {item.attachments.length > 0 && <small>{item.attachments.length} 个附件</small>}
                {session?.pendingInputId === item.id && <small>上次编辑未完成 · 请移回输入框</small>}
              </div>
              <span className="pending-input-actions">
                <button className="pending-input-edit" type="button" disabled={busy || busyOutside} onClick={() => { void perform(item, false) }} aria-label="编辑待发送消息" title="移回输入框编辑（覆盖当前内容）">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 11.9.7-3.2 6.8-6.8a1.25 1.25 0 0 1 1.8 0l1.6 1.6a1.25 1.25 0 0 1 0 1.8L6.3 12l-3.1.7Z" /><path d="m9.8 2.8 3.4 3.4" /></svg>
                </button>
                <button className="pending-input-delete" type="button" disabled={busy || busyOutside} onClick={() => { void perform(item, true) }} aria-label="删除待发送消息">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
                </button>
              </span>
              {repairMessage && <p className="pending-input-error">{repairMessage}</p>}
              {item.attachments.length > 0 && (
                <div className="single-chat-pending-attachments">
                  {item.attachments.map((attachment) => (
                    <AttachmentCard
                      key={attachment.id}
                      attachment={attachment}
                      locator={{
                        owner: 'single_chat_pending',
                        campId: snapshot.conversation.campId,
                        conversationId: snapshot.conversation.id,
                        pendingInputId: item.id,
                        attachmentRefId: attachment.id
                      }}
                      onNotify={onNotify}
                      presentation="user-timeline"
                    />
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

type PendingReturnRecovery = {
  snapshot: SingleChatSnapshot
  item: SingleChatPendingInputView
  editToken: string | null
  commandId: string
}

export function SingleChatPanel({
  campId,
  members,
  entryHost,
  visible,
  onOpen,
  onClose,
  onLeaveGuardChange,
  onNotify = () => undefined,
  target,
  notificationFocus,
  onNotificationFocusPresented,
  onVisibleNotificationSources,
  profileById = new Map(),
  busy = false,
  onResolveApproval = () => undefined
}: {
  target?: (NotificationSingleChatSource & { requestId: number }) | null
  notificationFocus?: NotificationFocusTarget | null
  onNotificationFocusPresented?(requestId: number): void
  onVisibleNotificationSources?(sources: VisibleNotificationSources): void
  profileById?: Map<string, AgentProfile>
  busy?: boolean
  onResolveApproval?(approval: ActionApprovalView, optionId: string): void
  campId: string
  members: CampMemberView[]
  entryHost?: HTMLElement | null
  visible: boolean
  onOpen(): void
  onClose(): void
  onLeaveGuardChange?(guard: (() => CampLeavePreparation) | null): void
  onNotify?(message: string): void
}): React.JSX.Element {
  const panelId = useId()
  const initialAgentId = members.find((member) => memberCanSingleChat(member) && member.isDefaultLead)?.agentId
    ?? members.find(memberCanSingleChat)?.agentId
    ?? null
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const focusPanel = useRef(false)
  const visibleRef = useRef(visible)
  const campIdRef = useRef(campId)
  const selectedAgentIdRef = useRef<string | null>(initialAgentId)
  const currentConversationIdRef = useRef<string | null>(null)
  const conversationsRef = useRef<SingleChatConversationView[]>([])
  const snapshotRef = useRef<SingleChatSnapshot | null>(null)
  const targetRequestSequenceRef = useRef(0)
  const currentReadInFlightRef = useRef<{
    conversationId: string
    targetRequest: SingleChatTargetRequest
    promise: Promise<SingleChatSnapshot | null | undefined> | null
  } | null>(null)
  const currentReadAgainRef = useRef(false)
  const viewportRef = useRef<HTMLElement>(null)
  const approvalRef = useRef<HTMLElement>(null)
  const lastVisibleSources = useRef('')
  const [hasNewReply, setHasNewReply] = useState(false)
  const viewportEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const dragLeaveTimer = useRef<number | null>(null)
  const dragActivityTimer = useRef<number | null>(null)
  const followLatestRef = useRef(true)
  const [conversations, setConversations] = useState<SingleChatConversationView[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialAgentId)
  const [snapshot, setSnapshot] = useState<SingleChatSnapshot | null>(null)
  const [bodyDrafts, setBodyDrafts] = useState<Record<string, string>>({})
  const [quoteBusy, setQuoteBusy] = useState(false)
  const quoteTailRef = useRef<Promise<void>>(Promise.resolve())
  const quoteOperationCount = useRef(0)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [ending, setEnding] = useState(false)
  const [preparingAttachments, setPreparingAttachments] = useState<PreparingSingleChatAttachment[]>([])
  const [attachmentDragState, setAttachmentDragState] = useState<AttachmentDragKind | null>(null)
  const [returningPending, setReturningPending] = useState(false)
  const returningPendingRef = useRef(false)
  const leaveLeaseCountRef = useRef(0)
  const [leaving, setLeaving] = useState(false)
  const returnRequestInFlightRef = useRef(false)
  const [pendingReturnRecovery, setPendingReturnRecovery] = useState<PendingReturnRecovery | null>(null)
  useLayoutEffect(() => {
    onLeaveGuardChange?.(() => {
      if (returningPendingRef.current) {
        throw new Error('单聊消息移回结果尚未确认，请先在单聊中重试恢复消息。')
      }
      leaveLeaseCountRef.current += 1
      setLeaving(true)
      let completed = false
      return { complete(didLeave) {
        if (completed) return
        completed = true
        if (!didLeave) {
          leaveLeaseCountRef.current -= 1
          setLeaving(leaveLeaseCountRef.current > 0)
        }
      } }
    })
    return () => onLeaveGuardChange?.(null)
  }, [onLeaveGuardChange])
  const [error, setError] = useState<string | null>(null)
  const [endDialogOpen, setEndDialogOpen] = useState(false)
  const [endTarget, setEndTarget] = useState<SingleChatEndTarget | null>(null)
  const [skipEndConfirmation, setSkipEndConfirmation] = useState(false)
  const [now, setNow] = useState(() => new Date().toISOString())

  const activeMembers = useMemo(() => members.filter(memberCanSingleChat), [members])
  const memberById = useMemo(() => new Map(activeMembers.map((member) => [member.agentId, member])), [activeMembers])
  const activeMemberIdsKey = activeMembers.map((member) => member.agentId).join('\u0000')
  const activeMembersRef = useRef(activeMembers)
  const memberByIdRef = useRef(memberById)
  const selectedMember = selectedAgentId ? memberById.get(selectedAgentId) ?? null : null
  const currentTargetReady = singleChatConversationReady(snapshot, selectedAgentId, loading)
  const currentSnapshot = currentTargetReady ? snapshot : null
  const bodyDraftKey = snapshot?.conversation.agentId === selectedAgentId
    ? `${campId}:${snapshot.conversation.id}` : `${campId}:pending:${selectedAgentId ?? ''}`
  const draft = bodyDrafts[bodyDraftKey] ?? ''
  const setDraft = (value: string): void => setBodyDrafts((current) => ({ ...current, [bodyDraftKey]: value }))
  useEffect(() => {
    if (!snapshot || snapshot.conversation.agentId !== selectedAgentId) return
    const pendingKey = `${campId}:pending:${selectedAgentId ?? ''}`
    setBodyDrafts((current) => {
      if (!(pendingKey in current)) return current
      const next = { ...current, [bodyDraftKey]: current[bodyDraftKey] ?? current[pendingKey] }
      delete next[pendingKey]
      return next
    })
  }, [campId, selectedAgentId, snapshot?.conversation.id, bodyDraftKey])
  const activeRun = currentSnapshot?.agentRuns.find((run) => NON_TERMINAL_RUNS.has(run.status)) ?? null
  const runningCount = conversations.filter((conversation) => (
    conversation.id === currentSnapshot?.conversation.id
      ? currentSnapshot.conversation.activeAgentRunId !== null
      : conversation.activeAgentRunId !== null
  )).length

  visibleRef.current = visible
  campIdRef.current = campId
  activeMembersRef.current = activeMembers
  memberByIdRef.current = memberById

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId
  }, [selectedAgentId])
  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  const acceptSnapshot = useCallback((
    conversationId: string,
    next: SingleChatSnapshot | null
  ): void => {
    if (
      !visibleRef.current
      || campIdRef.current !== campId
      || currentConversationIdRef.current !== conversationId
    ) return
    if (next && snapshotRef.current?.conversation.id === conversationId
      && next.draft.revision < snapshotRef.current.draft.revision) return
    snapshotRef.current = next
    setSnapshot(next)
    setError(null)
  }, [campId])

  const refreshCurrent = useCallback((
    conversationId = currentConversationIdRef.current
  ): Promise<SingleChatSnapshot | null | undefined> => {
    if (
      !visibleRef.current
      || campIdRef.current !== campId
      || !conversationId
      || currentConversationIdRef.current !== conversationId
      || !selectedAgentIdRef.current
    ) return Promise.resolve(undefined)

    const targetRequest: SingleChatTargetRequest = {
      agentId: selectedAgentIdRef.current,
      sequence: targetRequestSequenceRef.current
    }
    currentReadAgainRef.current = true
    const inFlight = currentReadInFlightRef.current
    if (
      inFlight
      && inFlight.conversationId === conversationId
      && inFlight.targetRequest.sequence === targetRequest.sequence
      && inFlight.targetRequest.agentId === targetRequest.agentId
      && inFlight.promise
    ) return inFlight.promise

    const currentRead = {
      conversationId,
      targetRequest,
      promise: null as Promise<SingleChatSnapshot | null | undefined> | null
    }
    currentReadInFlightRef.current = currentRead

    const reading = (async (): Promise<SingleChatSnapshot | null | undefined> => {
      let latest: SingleChatSnapshot | null | undefined
      while (
        currentReadInFlightRef.current === currentRead
        && currentReadAgainRef.current
      ) {
        currentReadAgainRef.current = false
        if (
          !visibleRef.current
          || campIdRef.current !== campId
          || currentConversationIdRef.current !== currentRead.conversationId
          || !singleChatTargetRequestIsCurrent(
            currentRead.targetRequest,
            targetRequestSequenceRef.current,
            selectedAgentIdRef.current
          )
        ) break

        try {
          const loaded = await window.rovai.request<SingleChatSnapshot | null>(
            'singleChat.get',
            { conversationId: currentRead.conversationId }
          )
          const next = !loaded || (loaded.conversation.campId === campId
            && loaded.conversation.id === currentRead.conversationId) ? loaded : null
          if (
            currentReadInFlightRef.current === currentRead
            && visibleRef.current
            && campIdRef.current === campId
            && currentConversationIdRef.current === currentRead.conversationId
            && singleChatTargetRequestIsCurrent(
              currentRead.targetRequest,
              targetRequestSequenceRef.current,
              selectedAgentIdRef.current
            )
            && !currentReadAgainRef.current
            && (!next || next.conversation.agentId === currentRead.targetRequest.agentId)
          ) {
            acceptSnapshot(currentRead.conversationId, next)
            latest = next
          }
        } catch (nextError) {
          if (
            currentReadInFlightRef.current === currentRead
            && visibleRef.current
            && campIdRef.current === campId
            && currentConversationIdRef.current === currentRead.conversationId
            && singleChatTargetRequestIsCurrent(
              currentRead.targetRequest,
              targetRequestSequenceRef.current,
              selectedAgentIdRef.current
            )
            && !currentReadAgainRef.current
          ) {
            setError(readErrorMessage(nextError, '单聊暂时无法读取。'))
            latest = undefined
          }
        }
      }
      return latest
    })()
    currentRead.promise = reading
    const clearCurrentRead = (): void => {
      if (currentReadInFlightRef.current === currentRead) currentReadInFlightRef.current = null
    }
    void reading.then(clearCurrentRead, clearCurrentRead)
    return reading
  }, [acceptSnapshot, campId])

  const refreshList = useCallback(async (): Promise<SingleChatConversationView[] | undefined> => {
    if (!visibleRef.current || campIdRef.current !== campId) return undefined
    try {
      const nextConversations = await window.rovai.request<SingleChatConversationView[]>('singleChat.list', { campId })
      if (!visibleRef.current || campIdRef.current !== campId) return undefined
      conversationsRef.current = nextConversations
      setConversations(nextConversations)
      return nextConversations
    } catch (nextError) {
      if (visibleRef.current && campIdRef.current === campId) {
        setError(readErrorMessage(nextError, '单聊列表暂时无法读取。'))
      }
      return undefined
    }
  }, [campId])

  useEffect(() => {
    if (!visible) {
      ++targetRequestSequenceRef.current
      currentReadAgainRef.current = false
      return
    }
    const requestSequence = ++targetRequestSequenceRef.current
    const requestIsCurrent = (): boolean => (
      visibleRef.current
      && campIdRef.current === campId
      && requestSequence === targetRequestSequenceRef.current
    )
    followLatestRef.current = true
    setPreparingAttachments([])
    currentConversationIdRef.current = null
    snapshotRef.current = null
    setSnapshot(null)
    setError(null)
    loadingRef.current = true
    setLoading(true)
    void (async () => {
      try {
        const nextConversations = await refreshList()
        if (!nextConversations || !requestIsCurrent()) return
        const availableMembers = activeMembersRef.current
        const availableMemberById = memberByIdRef.current
        if (target && (!availableMemberById.has(target.agentId)
          || !nextConversations.some((conversation) => conversation.id === target.conversationId
            && conversation.agentId === target.agentId))) {
          throw new Error('原单聊已结束或来源不可用。')
        }
        let agentId = target?.agentId ?? selectedAgentIdRef.current
        if (!agentId || !availableMemberById.has(agentId)) {
          agentId = nextConversations.find((conversation) => availableMemberById.has(conversation.agentId))?.agentId
            ?? availableMembers.find((member) => member.isDefaultLead)?.agentId
            ?? availableMembers[0]?.agentId
            ?? null
        }
        if (!requestIsCurrent()) return
        selectedAgentIdRef.current = agentId
        setSelectedAgentId(agentId)
        const conversation = agentId
          ? nextConversations.find((candidate) => candidate.agentId === agentId
            && (!target || candidate.id === target.conversationId)) ?? null
          : null
        currentConversationIdRef.current = conversation?.id ?? null
        if (conversation) await refreshCurrent(conversation.id)
      } catch (nextError) {
        if (requestIsCurrent()) setError(readErrorMessage(nextError, '无法打开原单聊。'))
      } finally {
        if (requestIsCurrent()) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    })()
    return () => {
      ++targetRequestSequenceRef.current
      currentReadAgainRef.current = false
    }
  // Only actual target eligibility changes should repeat the panel-open list read.
  }, [activeMemberIdsKey, campId, refreshCurrent, refreshList, target, visible])

  const pollingRequired = singleChatSnapshotNeedsPolling(currentSnapshot)
  useEffect(() => {
    const conversationId = currentSnapshot?.conversation.id ?? null
    if (!visible || !conversationId || !pollingRequired) return
    return startSingleChatPolling(
      conversationId,
      refreshCurrent,
      (callback, delayMs) => window.setTimeout(callback, delayMs),
      (timer) => window.clearTimeout(timer)
    )
  }, [currentSnapshot?.conversation.id, pollingRequired, refreshCurrent, visible])

  useEffect(() => {
    if (!visible) return
    return window.rovai.onEvent((event) => {
      const target = singleChatChangeRefreshTarget(
        event,
        campId,
        currentConversationIdRef.current
      )
      if (target === 'current-conversation') {
        void refreshCurrent().catch(() => undefined)
      } else if (target === 'conversation-list') {
        void refreshList().catch(() => undefined)
      }
    })
  }, [campId, refreshCurrent, refreshList, visible])

  useEffect(() => {
    if (!visible || !activeRun) return
    setNow(new Date().toISOString())
    const interval = window.setInterval(() => setNow(new Date().toISOString()), 1_000)
    return () => window.clearInterval(interval)
  }, [activeRun?.id, visible])

  useEffect(() => {
    if (!visible || !focusPanel.current) return
    focusPanel.current = false
    panelRef.current?.focus({ preventScroll: true })
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (document.querySelector('.app-dialog, [role="menu"][data-state="open"]')) return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => document.removeEventListener('keydown', dismissOnEscape)
  }, [onClose, visible])

  useEffect(() => {
    if (!visible) return
    if (!followLatestRef.current) { setHasNewReply(true); return }
    setHasNewReply(false)
    viewportEndRef.current?.scrollIntoView({ block: 'end' })
  }, [currentSnapshot?.conversation.lastMessageSequence, activeRun?.executionEvidenceCount, sending, visible])

  useEffect(() => {
    if (!onVisibleNotificationSources) return
    let frame: number | null = null
    const publish = (): void => {
      frame = null
      const viewport = viewportRef.current
      const canObserve = visible && currentSnapshot !== null && viewport !== null
        && document.visibilityState === 'visible' && document.hasFocus()
      const campTurnIds = new Set<string>()
      const approvalIds = new Set<string>()
      if (canObserve && viewport) {
        const bounds = viewport.getBoundingClientRect()
        for (const node of viewport.querySelectorAll<HTMLElement>('[data-notification-turn-id]')) {
          if (node.getClientRects().length && rectanglesOverlap(node.getBoundingClientRect(), bounds)) {
            campTurnIds.add(node.dataset.notificationTurnId!)
          }
        }
        for (const node of approvalRef.current?.querySelectorAll<HTMLElement>('[data-approval-id]') ?? []) {
          if (node.getClientRects().length && rectanglesOverlap(node.getBoundingClientRect(), {
            top: 0, right: window.innerWidth, bottom: window.innerHeight, left: 0
          })) approvalIds.add(node.dataset.approvalId!)
        }
      }
      const sources: VisibleNotificationSources = { campId,
        conversationId: currentSnapshot?.conversation.id ?? null, surfaceVisible: canObserve,
        snapshotSequence: 0, messageIds: [], campTurnIds: [...campTurnIds].sort(), approvalIds: [...approvalIds].sort() }
      const signature = JSON.stringify(sources)
      if (signature !== lastVisibleSources.current) {
        lastVisibleSources.current = signature
        onVisibleNotificationSources(sources)
      }
    }
    const schedule = (): void => { if (frame === null) frame = window.requestAnimationFrame(publish) }
    const viewport = viewportRef.current
    const observer = new MutationObserver(schedule)
    if (panelRef.current) observer.observe(panelRef.current, { subtree: true, childList: true, attributes: true })
    schedule()
    viewport?.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', schedule)
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame)
      observer.disconnect()
      viewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [campId, currentSnapshot, onVisibleNotificationSources, visible])

  useEffect(() => {
    if (!visible || !notificationFocus?.active || notificationFocus.approvalId
      || currentSnapshot?.conversation.id !== notificationFocus.conversationId) return
    const node = viewportRef.current?.querySelector<HTMLElement>(
      `[data-single-chat-run-id="${CSS.escape(notificationFocus.agentRunId ?? '')}"]`)
    if (!node) return
    node.scrollIntoView({ block: 'center', behavior: 'auto' })
    node.focus({ preventScroll: true })
    if (document.activeElement === node) onNotificationFocusPresented?.(notificationFocus.requestId)
  }, [currentSnapshot, notificationFocus, onNotificationFocusPresented, visible])

  const performPendingReturn = async (transfer: PendingReturnRecovery): Promise<void> => {
    if (leaveLeaseCountRef.current > 0) throw new Error('正在离开当前会话，请稍后再编辑待发送消息。')
    if (returnRequestInFlightRef.current) return
    const { snapshot: current, item, editToken, commandId } = transfer
    returnRequestInFlightRef.current = true
    returningPendingRef.current = true
    setReturningPending(true)
    setPendingReturnRecovery(null)
    if (composerRef.current) composerRef.current.disabled = true
    let uncertain = false
    try {
      let result: StoredCommandResult
      try {
        result = await window.rovai.request<StoredCommandResult>('singleChat.pendingInputs.edit', {
          commandId, command: { campId: current.conversation.campId,
            conversationId: item.conversationId, pendingInputId: item.id, expectedRevision: item.revision,
            editToken, action: { type: 'return_to_composer', expectedDraftRevision: current.draft.revision } }
        })
      } catch {
        // The body lives in the durable command result, not the attachment-only
        // Draft. Retry this exact command to recover a lost successful response.
        uncertain = true
        setPendingReturnRecovery(transfer)
        throw new Error('移回结果尚未确认，请重试恢复消息。当前输入已保留。')
      }
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      const body = resultPayloadString(result, 'body') ?? ''
      const returnedDraft = result.payload.draft as unknown as SingleChatSnapshot['draft']
      const key = `${current.conversation.campId}:${item.conversationId}`
      setBodyDrafts((drafts) => ({ ...drafts, [key]: body }))
      if (currentConversationIdRef.current === item.conversationId) {
        const latest = snapshotRef.current?.conversation.id === item.conversationId ? snapshotRef.current : current
        acceptMutationSnapshot({ ...latest, draft: returnedDraft,
          pendingInputs: { ...latest.pendingInputs,
            items: latest.pendingInputs.items.filter((entry) => entry.id !== item.id),
            editSession: latest.pendingInputs.editSession?.pendingInputId === item.id ? null : latest.pendingInputs.editSession } })
        setPreparingAttachments([])
        setError(null)
        window.requestAnimationFrame(() => composerRef.current?.focus())
      }
    } finally {
      returnRequestInFlightRef.current = false
      if (!uncertain) {
        returningPendingRef.current = false
        setReturningPending(false)
        if (composerRef.current) composerRef.current.disabled = false
      }
    }
  }

  const returnPendingInputToComposer = async (item: SingleChatPendingInputView, editToken: string | null): Promise<void> => {
    const current = snapshotRef.current
    if (!current || current.conversation.id !== item.conversationId || returningPendingRef.current
      || sending || ending || quoteOperationCount.current > 0 || preparingAttachments.some((entry) => !entry.error)) {
      throw new Error('输入框正在处理变更，请稍后再试。')
    }
    await performPendingReturn({ snapshot: current, item, editToken, commandId: crypto.randomUUID() })
  }

  const acceptMutationSnapshot = (next: SingleChatSnapshot): void => {
    acceptSnapshot(next.conversation.id, next)
    void refreshCurrent(next.conversation.id)
  }

  const openConversation = async (
    agentId: string,
    targetRequest: SingleChatTargetRequest = {
      agentId,
      sequence: targetRequestSequenceRef.current
    }
  ): Promise<SingleChatSnapshot | null> => {
    const result = await window.rovai.request<StoredCommandResult>('singleChat.open', {
      commandId: crypto.randomUUID(),
      command: { campId, agentId }
    })
    if (
      !visibleRef.current
      || campIdRef.current !== campId
      || !singleChatTargetRequestIsCurrent(
        targetRequest,
        targetRequestSequenceRef.current,
        selectedAgentIdRef.current
      )
    ) return null
    if (result.status === 'rejected') throw new Error(resultMessage(result))
    const conversationId = resultPayloadString(result, 'conversationId')
    if (!conversationId) throw new Error('单聊已打开，但未返回对话标识。')
    currentConversationIdRef.current = conversationId
    await refreshList()
    const next = await refreshCurrent(conversationId)
    if (!singleChatTargetRequestIsCurrent(
      targetRequest,
      targetRequestSequenceRef.current,
      selectedAgentIdRef.current
    )) return null
    if (!next || next.conversation.id !== conversationId) {
      throw new Error('单聊已不在当前会话中。')
    }
    return next
  }

  const chooseTarget = async (agentId: string): Promise<void> => {
    if (returningPendingRef.current) return
    const targetRequest: SingleChatTargetRequest = {
      agentId,
      sequence: ++targetRequestSequenceRef.current
    }
    const requestIsCurrent = (): boolean => visibleRef.current
      && campIdRef.current === campId
      && singleChatTargetRequestIsCurrent(
        targetRequest,
        targetRequestSequenceRef.current,
        selectedAgentIdRef.current
      )
    followLatestRef.current = true
    setPreparingAttachments([])
    selectedAgentIdRef.current = agentId
    setSelectedAgentId(agentId)
    currentConversationIdRef.current = null
    currentReadAgainRef.current = false
    snapshotRef.current = null
    setSnapshot(null)
    setError(null)
    loadingRef.current = true
    setLoading(true)
    try {
      await openConversation(agentId, targetRequest)
    } catch (nextError) {
      if (requestIsCurrent()) setError(readErrorMessage(nextError, '无法打开这段单聊。'))
    } finally {
      if (requestIsCurrent()) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  const prepareFiles = async (files: File[]): Promise<void> => {
    if (returningPendingRef.current) return
    const agentId = selectedAgentIdRef.current
    if (
      !agentId
      || !singleChatConversationReady(snapshotRef.current, agentId, loadingRef.current)
      || ending
      || files.length === 0
    ) return
    const pending = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, error: null }))
    setPreparingAttachments((current) => [...current, ...pending])
    setError(null)
    let current = snapshotRef.current?.conversation.agentId === agentId
      ? snapshotRef.current
      : null
    try {
      if (!current) current = await openConversation(agentId)
      if (!current) throw new Error('单聊已不在当前会话中。')
      for (const [index, file] of files.entries()) {
        const item = pending[index]
        try {
          const next = await window.rovai.singleChatAttachments.prepare(
            current.conversation.id,
            current.draft.revision,
            file
          )
          current = next
          acceptMutationSnapshot(next)
          setPreparingAttachments((items) => items.filter(({ id }) => id !== item.id))
        } catch (nextError) {
          const message = readErrorMessage(nextError, '附件处理失败，请移除后重试。')
          setPreparingAttachments((items) => items.map((candidate) => (
            candidate.id === item.id ? { ...candidate, error: message } : candidate
          )))
        }
      }
    } catch (nextError) {
      const message = readErrorMessage(nextError, '无法为这段单聊添加附件。')
      setPreparingAttachments((items) => items.map((candidate) => (
        pending.some(({ id }) => id === candidate.id) ? { ...candidate, error: message } : candidate
      )))
    }
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

  const attachmentDropBlocked = !currentTargetReady || ending || sending || quoteBusy
    || returningPending || preparingAttachments.some((item) => !item.error)

  const enterAttachmentDropSurface = (event: ReactDragEvent<HTMLElement>): void => {
    const kind = attachmentDragKind(event.dataTransfer)
    if (!kind) return
    event.stopPropagation()
    if (attachmentDropBlocked) {
      event.dataTransfer.dropEffect = 'none'
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
    event.stopPropagation()
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
    event.stopPropagation()
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
    const files = droppedAttachmentInputs(event.dataTransfer).map(({ file }) => file)
    clearAttachmentDragState()
    if (files.length === 0) return
    void prepareFiles(files)
  }

  useEffect(() => {
    if (attachmentDropBlocked) clearAttachmentDragState()
  }, [attachmentDropBlocked])

  useEffect(() => () => {
    if (dragLeaveTimer.current !== null) window.clearTimeout(dragLeaveTimer.current)
    if (dragActivityTimer.current !== null) window.clearTimeout(dragActivityTimer.current)
  }, [])

  const removeDraftAttachment = async (attachmentId: string): Promise<void> => {
    if (returningPendingRef.current) return
    const current = snapshotRef.current
    if (
      !current
      || !singleChatConversationReady(current, selectedAgentIdRef.current, loadingRef.current)
      || ending
    ) return
    setError(null)
    try {
      const next = await window.rovai.singleChatAttachments.remove(
        current.conversation.id,
        current.draft.revision,
        attachmentId
      )
      acceptMutationSnapshot(next)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '附件未能移除，请重试。'))
    }
  }

  const mutateDraftQuote = (action: MessageQuoteAction): Promise<void> => {
    if (returningPendingRef.current) return Promise.reject(new Error('消息正在移回输入框，请稍后再试。'))
    const owner = snapshotRef.current?.conversation.id
    const commandId = crypto.randomUUID()
    if (!owner) return Promise.reject(new Error('quote.owner_unavailable'))
    quoteOperationCount.current += 1
    setQuoteBusy(true)
    const operation = quoteTailRef.current.then(async () => {
      const current = snapshotRef.current
      if (!current || current.conversation.id !== owner || currentConversationIdRef.current !== owner) throw new Error('quote.owner_unavailable')
      const next = await window.rovai.request<SingleChatSnapshot>('messageQuotes.mutateDraft', {
        commandId, command: { campId, conversationId: owner, expectedRevision: current.draft.revision, action }
      })
      acceptSnapshot(owner, next)
    })
    quoteTailRef.current = operation.then(() => undefined, () => undefined)
    return operation.finally(() => { quoteOperationCount.current -= 1; setQuoteBusy(quoteOperationCount.current > 0) })
  }

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (returningPendingRef.current) return
    const body = draft.trim()
    const agentId = selectedAgentIdRef.current
    if (
      !agentId
      || !singleChatConversationReady(snapshotRef.current, agentId, loadingRef.current)
      || sending
      || quoteBusy
      || preparingAttachments.some((item) => !item.error)
    ) return
    followLatestRef.current = true
    setSending(true)
    setError(null)
    try {
      const current = snapshotRef.current?.conversation.agentId === agentId
        ? snapshotRef.current
        : await openConversation(agentId)
      if (!current) throw new Error('无法打开这段单聊。')
      if (!body && (current.draft.quotes?.length ?? 0) > 0) throw new Error('请填写这次的问题后再发送。')
      if (!body && current.draft.attachments.length === 0) return
      const result = await window.rovai.request<StoredCommandResult>('singleChat.send', {
        commandId: crypto.randomUUID(),
        command: {
          campId,
          conversationId: current.conversation.id,
          body,
          draftRevision: current.draft.revision
        }
      })
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      setDraft('')
      setPreparingAttachments([])
      await refreshCurrent(current.conversation.id)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '消息未发送，请重试。'))
    } finally {
      setSending(false)
    }
  }

  const stopCurrentRun = async (): Promise<void> => {
    const run = activeRun
    const current = snapshotRef.current
    if (
      !run
      || !current
      || !singleChatConversationReady(current, selectedAgentIdRef.current, loadingRef.current)
      || current.conversation.activeAgentRunId !== run.id
      || cancelling
    ) return
    setCancelling(true)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('agentRuns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, agentRunId: run.id, expectedVersion: run.version }
      })
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      await refreshCurrent(current.conversation.id)
    } catch (nextError) {
      if (currentConversationIdRef.current === current.conversation.id) {
        setError(readErrorMessage(nextError, '停止请求未完成，请重试。'))
      }
    } finally {
      setCancelling(false)
    }
  }

  const endConversation = async (target: SingleChatEndTarget): Promise<void> => {
    if (ending) return
    setEnding(true)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('singleChat.end', {
        commandId: crypto.randomUUID(),
        command: singleChatEndCommand(target)
      })
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      if (skipEndConfirmation) storeBoolean(END_CONFIRMATION_STORAGE_KEY, true)
      setEndDialogOpen(false)
      setEndTarget(null)
      if (
        campIdRef.current === target.campId
        && currentConversationIdRef.current === target.conversationId
      ) {
        setPreparingAttachments([])
        currentConversationIdRef.current = null
        currentReadAgainRef.current = false
        snapshotRef.current = null
        setSnapshot(null)
      }
      if (campIdRef.current === target.campId) {
        const remainingConversations = conversationsRef.current.filter((conversation) => (
          conversation.id !== target.conversationId
        ))
        conversationsRef.current = remainingConversations
        setConversations(remainingConversations)
        await refreshList()
      }
      onNotify('单聊已结束')
    } catch (nextError) {
      setError(readErrorMessage(nextError, '单聊未结束，请重试。'))
    } finally {
      setEnding(false)
    }
  }

  const requestEnd = (): void => {
    const current = snapshotRef.current
    const agentId = selectedAgentIdRef.current
    if (
      !current
      || !singleChatConversationReady(current, agentId, loadingRef.current)
      || current.conversation.id !== currentConversationIdRef.current
    ) return
    const target = singleChatEndTargetFromSnapshot(
      current,
      memberByIdRef.current.get(current.conversation.agentId)?.displayName ?? '这位队员'
    )
    if (safeStoredBoolean(END_CONFIRMATION_STORAGE_KEY)) {
      void endConversation(target)
      return
    }
    setEndTarget(target)
    setSkipEndConfirmation(false)
    setEndDialogOpen(true)
  }

  const entries = (
    <div className="camp-detail-entries" role="group" aria-label="单聊入口">
      <button
        ref={triggerRef}
        className="camp-detail-entry"
        type="button"
        data-detail="single-chat"
        aria-expanded={visible}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={(event) => {
          if (visible) {
            onClose()
            return
          }
          focusPanel.current = event.detail === 0
          onOpen()
        }}
      >
        {runningCount > 0
          ? <span className="camp-loading-spinner" role="img" aria-label={`${runningCount} 段单聊正在回复`} />
          : <SingleChatGlyph />}
        <span>单聊</span>
        <small>{conversations.length}</small>
      </button>
    </div>
  )

  return <>
    {entryHost ? createPortal(entries, entryHost) : <div className="camp-detail-entry-fallback">{entries}</div>}
    <aside
      ref={panelRef}
      id={panelId}
      data-single-chat-owner={currentSnapshot?.conversation.id}
      className={`single-chat-popover${attachmentDragState ? ' is-dragging-attachments' : ''}`}
      role="dialog"
      aria-modal={false}
      aria-labelledby={`${panelId}-title`}
      tabIndex={-1}
      hidden={!visible}
      onDragEnter={enterAttachmentDropSurface}
      onDragOver={continueAttachmentDrop}
      onDragLeave={leaveAttachmentDropSurface}
      onDrop={dropAttachments}
    >
      <header className="single-chat-heading">
        <SingleChatGlyph />
        <strong id={`${panelId}-title`}>单聊</strong>
        <span>当前会话</span>
        <button className="icon-button" type="button" aria-label="收起单聊" title="收起 · Esc" onClick={() => {
          onClose()
        }}><CloseGlyph /></button>
      </header>

      <div className="single-chat-target-bar">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={`single-chat-target-trigger${selectedMember ? '' : ' no-target'}`} type="button" disabled={activeMembers.length === 0 || ending || returningPending || sending || quoteBusy || preparingAttachments.some((item) => !item.error)}>
              {selectedMember && <MemberAvatar agentId={selectedMember.agentId} avatarRef={selectedMember.avatarRef} displayName={selectedMember.displayName} size="mention" decorative />}
              <span className="single-chat-target-copy">
                <strong>{selectedMember?.displayName ?? '选择单聊对象'}</strong>
                <small>{selectedMember?.teamRole ?? '当前会话中的队员'}</small>
              </span>
              <span className="single-chat-target-chevron"><ChevronGlyph /></span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content onCloseAutoFocus={(event) => event.preventDefault()} className="single-chat-target-menu" sideOffset={6} align="start" collisionPadding={12}>
              <div className="single-chat-target-menu-heading">
                <strong>选择单聊对象</strong>
                <span>单聊正文不会进入公屏</span>
              </div>
              {activeMembers.map((member) => (
                <DropdownMenu.Item className="single-chat-target-option" key={member.agentId} onSelect={() => void chooseTarget(member.agentId)}>
                  <MemberAvatar agentId={member.agentId} avatarRef={member.avatarRef} displayName={member.displayName} size="mention" decorative />
                  <span className="single-chat-target-option-copy">
                    <strong>{member.displayName}</strong>
                    <span>{member.teamRole}</span>
                  </span>
                  {selectedAgentId === member.agentId && <span className="single-chat-target-current" aria-label="当前对象"><CheckGlyph /></span>}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <span className="single-chat-private-label"><LockGlyph />仅你可见</span>
        <button className="single-chat-end-button" type="button" disabled={!snapshot || !currentTargetReady || returningPending || ending} aria-label={selectedMember ? `结束与${selectedMember.displayName}的单聊` : '结束单聊'} onClick={requestEnd}>
          {ending ? '结束中…' : '结束'}
        </button>
      </div>

      <section
        ref={viewportRef}
        className="single-chat-viewport"
        aria-label={selectedMember ? `与${selectedMember.displayName}的单聊消息` : '单聊消息'}
        onScroll={() => {
          const viewport = viewportRef.current
          if (!viewport) return
          followLatestRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72
          if (followLatestRef.current) setHasNewReply(false)
        }}
      >
        <div className="single-chat-transcript">
          {loading && <div className="single-chat-empty" role="status"><span className="single-chat-spinner" /><strong>正在打开单聊</strong></div>}
          {!loading && !selectedMember && <div className="single-chat-empty"><strong>当前没有可单聊的队员</strong><span>队员回到当前会话后即可开始单聊。</span></div>}
          {!loading && !sending && selectedMember && !currentSnapshot && <div className="single-chat-empty"><strong>和 {selectedMember.displayName} 单独聊聊</strong><span>发送第一条消息开始这段对话。</span></div>}
          {!sending && currentSnapshot && currentSnapshot.messages.length === 0 && <div className="single-chat-empty"><strong>和 {selectedMember?.displayName} 单独聊聊</strong><span>发送第一条消息开始这段对话。</span></div>}
          {currentSnapshot && <SingleChatTranscript snapshot={currentSnapshot} now={now} cancelling={cancelling} onNotify={onNotify} />}
          {sending && !activeRun && <div className="process-action current single-chat-send-feedback" role="status">
            <span className="process-spinner" aria-hidden="true" /><span>连接中</span>
          </div>}
          <div ref={viewportEndRef} aria-hidden="true" />
        </div>
      </section>

      {hasNewReply && <button type="button" className="single-chat-new-reply" onClick={() => {
        followLatestRef.current = true
        setHasNewReply(false)
        viewportEndRef.current?.scrollIntoView({ block: 'end' })
      }}><span className="single-chat-new-reply-dot" aria-hidden="true" />有新回复 · 查看</button>}
      {currentSnapshot && currentSnapshot.approvals.length > 0 && <ApprovalDock
        approvals={currentSnapshot.approvals} profileById={profileById} busy={busy}
        onResolve={onResolveApproval} containerRef={approvalRef}
        focusRequest={notificationFocus?.active && notificationFocus.approvalId ? notificationFocus.requestId : null}
        focusApprovalId={notificationFocus?.approvalId ?? null}
        onFocusPresented={onNotificationFocusPresented}
      />}

      {currentSnapshot && (
        <SingleChatPendingQueue
          snapshot={currentSnapshot}
          busyOutside={sending || ending || quoteBusy || returningPending || leaving || preparingAttachments.some((item) => !item.error)}
          onRefresh={async () => {
            await refreshCurrent()
          }}
          onNotify={onNotify}
          onReturnToComposer={returnPendingInputToComposer}
        />
      )}

      {currentSnapshot && <MessageQuoteSelectionToolbar key={currentSnapshot.conversation.id}
        ownerKey={`single_chat:${currentSnapshot.conversation.id}`} messages={currentSnapshot.messages}
        disabled={!visible || sending || quoteBusy || returningPending || preparingAttachments.some((item) => !item.error)}
        onAdd={(selection) => mutateDraftQuote({ type: 'add', selection })} />}
      <form className="composer single-chat-composer" onSubmit={(event) => void send(event)}>
        <div className={`composer-box single-chat-composer-box${activeRun ? ' is-running' : ''}`}>
          <div className="composer-input">
            {((currentSnapshot?.draft.attachments.length ?? 0) > 0 || preparingAttachments.length > 0) && (
              <SingleChatAttachmentStrip>
                {currentSnapshot?.draft.attachments.map((attachment) => (
                  <AttachmentCard
                    attachment={attachment}
                    locator={{
                      owner: 'single_chat_composer',
                      campId,
                      conversationId: currentSnapshot.conversation.id,
                      attachmentRefId: attachment.id
                    }}
                    onNotify={onNotify}
                    presentation="composer"
                    key={attachment.id}
                    onRemove={() => void removeDraftAttachment(attachment.id)}
                  />
                ))}
                {preparingAttachments.map((item) => (
                  <SingleChatAttachmentPlaceholder
                    item={item}
                    key={item.id}
                    onRemove={item.error
                      ? () => setPreparingAttachments((current) => current.filter(({ id }) => id !== item.id))
                      : undefined}
                  />
                ))}
              </SingleChatAttachmentStrip>
            )}
            <MessageQuotes key={currentSnapshot?.conversation.id ?? 'empty'} quotes={currentSnapshot?.draft.quotes ?? []}
              onEmptyFocus={() => composerRef.current?.focus()}
              disabled={sending || returningPending || quoteBusy} onReveal={revealPrivateQuote} onMutate={mutateDraftQuote} />
            <label className="sr-only" htmlFor={`${panelId}-composer`}>发送单聊消息</label>
            <textarea
              ref={composerRef}
              id={`${panelId}-composer`}
              value={draft}
              disabled={!selectedMember || !currentTargetReady || sending || returningPending || ending}
              placeholder={selectedMember ? `给 ${selectedMember.displayName} 发消息…` : '选择一位队员后开始单聊'}
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files)
                if (files.length === 0) return
                event.preventDefault()
                void prepareFiles(files)
              }}
              onKeyDown={(event) => {
                if (!shouldSubmitStructuredComposerOnEnter({
                  key: event.key,
                  shiftKey: event.shiftKey,
                  isComposing: event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
                })) return
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }}
            />
          </div>
          <div className="composer-action-row">
            <div className="composer-tools">
              <input
                ref={fileInputRef}
                className="composer-file-input"
                type="file"
                multiple
                tabIndex={-1}
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? [])
                  event.currentTarget.value = ''
                  if (files.length > 0) void prepareFiles(files)
                }}
              />
              <button
                className="composer-attachment-button"
                type="button"
                aria-label="添加文件"
                title="添加文件"
                disabled={!selectedMember || !currentTargetReady || sending || returningPending || ending || quoteBusy || preparingAttachments.some((item) => !item.error)}
                onClick={() => fileInputRef.current?.click()}
              >
                <svg aria-hidden="true" viewBox="0 0 18 18"><path d="m6.2 9.8 4.65-4.65a2.5 2.5 0 0 1 3.54 3.54l-6.1 6.1a4 4 0 0 1-5.66-5.66l6.1-6.1" /></svg>
              </button>
            </div>
            <div className="composer-actions">
              {!activeRun && (
                <span className="composer-hint">
                  <span className="sr-only">Enter 发送，Shift+Enter 换行</span>
                  <span className="composer-hint-visual" aria-hidden="true">
                    <kbd>↵</kbd><span>发送</span><span className="composer-hint-separator">·</span><kbd>⇧↵</kbd><span>换行</span>
                  </span>
                </span>
              )}
              {activeRun && !draft.trim() && (currentSnapshot?.draft.attachments.length ?? 0) === 0
                ? <ComposerPrimaryAction action="stop" type="button" busy={cancelling} disabled={!currentTargetReady || cancelling} onClick={() => void stopCurrentRun()} />
                : <ComposerPrimaryAction
                    action="send"
                    type="submit"
                    busy={sending || preparingAttachments.some((item) => !item.error)}
                    disabled={(!draft.trim() && (currentSnapshot?.draft.attachments.length ?? 0) === 0) || !selectedMember || !currentTargetReady || sending || returningPending || ending || quoteBusy || preparingAttachments.some((item) => !item.error)}
                  />}
            </div>
          </div>
        </div>
        {pendingReturnRecovery && <div className="single-chat-error" role="alert">
          <span>移回结果尚未确认，当前输入已保留。</span>
          <button type="button" onClick={() => {
            void performPendingReturn(pendingReturnRecovery).catch((nextError) => setError(readErrorMessage(nextError)))
          }}>重试移回消息</button>
        </div>}
        {error && <div className="single-chat-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>关闭</button></div>}
      </form>
      <footer className="single-chat-footer">
        <span>单聊正文不会进入公屏</span>
        <span><kbd>Esc</kbd> 收起</span>
      </footer>
      {attachmentDragState && (
        <div className="single-chat-drop-layer" aria-hidden="true">
          <div className="single-chat-drop-callout">
            <strong>{'松手添加到当前消息'}</strong>
            <span>
              {attachmentDragState === 'directory'
                ? '将引用此文件夹的当前位置，不会移动原文件'
                : '支持文件与文件夹 · 原位置移动或删除后可能不可用'}
            </span>
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {attachmentDragState ? '已进入单聊附件区域，释放以添加文件或文件夹。' : ''}
      </span>
    </aside>

    <Dialog.Root open={endDialogOpen} onOpenChange={(open) => {
      if (ending) return
      setEndDialogOpen(open)
      if (!open) setEndTarget(null)
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <AppDialogContent tone="danger" aria-describedby={`${panelId}-end-description`}>
          <AppDialogHeader
            title={endTarget ? `结束与${endTarget.displayName}的单聊？` : '结束单聊？'}
            description="这段对话将被删除且无法回复。"
            descriptionId={`${panelId}-end-description`}
            icon="trash"
            hideClose
          />
          <AppDialogBody>
            <label className="single-chat-confirm-choice">
              <input type="checkbox" checked={skipEndConfirmation} onChange={(event) => setSkipEndConfirmation(event.target.checked)} />
              <span>不再询问</span>
            </label>
          </AppDialogBody>
          <AppDialogFooter>
            <Dialog.Close asChild><button className="quiet-button" type="button" data-dialog-autofocus disabled={ending}>取消</button></Dialog.Close>
            <button className="danger-button" type="button" disabled={ending || !endTarget} onClick={() => endTarget && void endConversation(endTarget)}>{ending ? '结束中…' : '结束'}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
