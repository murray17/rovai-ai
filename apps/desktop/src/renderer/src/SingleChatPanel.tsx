import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type {
  AgentRunExecutionEvidenceView,
  CampMessageAttachmentView,
  CampMemberView,
  PreparedAttachmentView,
  SingleChatConversationView,
  SingleChatMessageView,
  SingleChatRunView,
  SingleChatSnapshot,
  StoredCommandResult
} from '@contracts'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { MemberAvatar } from './MemberAvatar'
import { SafeMarkdown } from './SafeMarkdown'
import { shouldSubmitStructuredComposerOnEnter } from './StructuredMentionComposer'
import { readErrorMessage } from './error-message'
import {
  buildLiveExecutionProgress,
  executionStepPublicTitle,
  liveRuntimeEventFromExecutionEvidence,
  type ExecutionProgressItem
} from './ui-model'
import {
  groupConsecutiveToolItems,
  type GroupedExecutionProgressItem,
  type ToolProgressItem
} from './execution-tool-grouping'
import {
  attachmentBaseName,
  attachmentFormatLabel,
  classifyAttachmentDisplay,
  UserFileIcon
} from './attachment-presentation'

const NON_TERMINAL_RUNS = new Set<SingleChatRunView['status']>(['queued', 'running', 'waiting'])
const END_CONFIRMATION_STORAGE_KEY = 'rovai.single-chat.skip-end-confirmation.v1'

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

function ToolGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9.65 2.35a3.15 3.15 0 0 0-3.2 3.85L2.8 9.85a1.85 1.85 0 0 0 2.62 2.62l3.65-3.65a3.15 3.15 0 0 0 3.85-3.2L10.8 7.74l-2.5-.45-.45-2.5z" /></svg>
}

function CheckGlyph(): React.JSX.Element {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3.2 8.2 2.7 2.7 6.8-6.4" /></svg>
}

type SingleChatAttachment = CampMessageAttachmentView | PreparedAttachmentView

type PreparingSingleChatAttachment = {
  id: string
  name: string
  error: string | null
}

function formatAttachmentBytes(byteSize: number): string {
  if (byteSize < 1_024) return `${byteSize} B`
  if (byteSize < 1_048_576) return `${Math.max(1, Math.round(byteSize / 1_024))} KB`
  return `${(byteSize / 1_048_576).toFixed(byteSize < 10_485_760 ? 1 : 0)} MB`
}

function SingleChatAttachmentCard({
  attachment,
  presentation,
  onRemove
}: {
  attachment: SingleChatAttachment
  presentation: 'composer' | 'user-timeline'
  onRemove?: () => void
}): React.JSX.Element {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const composerImage = presentation === 'composer' && attachment.previewKind === 'image'
  const classification = classifyAttachmentDisplay(attachment)
  const baseName = attachmentBaseName(attachment.displayName, attachment.kind)
  const formatLabel = attachmentFormatLabel(attachment.displayName, attachment.kind)

  useEffect(() => {
    if (attachment.previewKind !== 'image') return
    let active = true
    let objectUrl: string | null = null
    void window.rovai.singleChatAttachments.preview(attachment.id)
      .then((preview) => {
        if (!active || !preview) return
        objectUrl = URL.createObjectURL(new Blob(
          [Uint8Array.from(preview.bytes).buffer],
          { type: preview.mediaType }
        ))
        setPreviewUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.id, attachment.previewKind])

  const content = composerImage
    ? (
        <span className="attachment-visual composer-image-preview" aria-hidden="true">
          {previewUrl ? <img src={previewUrl} alt="" /> : <i className="attachment-loading" />}
        </span>
      )
    : (
        <>
          <UserFileIcon
            type={classification.userDisplayType === 'image'
              ? 'document'
              : classification.userDisplayType}
          />
          <span className="attachment-copy">
            <span className="attachment-title-line">
              <strong title={attachment.displayName}>{baseName}</strong>
              <span className="file-extension-label">{formatLabel}</span>
            </span>
            <small>{attachment.kind === 'directory'
              ? `${attachment.fileCount} 个文件 · ${formatAttachmentBytes(attachment.byteSize)}`
              : formatAttachmentBytes(attachment.byteSize)}</small>
          </span>
        </>
      )

  return (
    <div className={`attachment-card ${presentation === 'composer' ? 'composer-attachment-card' : presentation} ${composerImage ? 'composer-image-attachment' : ''} type-${classification.agentDisplayType}`}>
      {previewUrl
        ? <button className="attachment-open is-preview" type="button" aria-label={`预览附件 ${attachment.displayName}`} onClick={() => setPreviewOpen(true)}>{content}</button>
        : <div className="attachment-open">{content}</div>}
      {previewUrl && (
        <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="attachment-lightbox-overlay" />
            <Dialog.Content className="attachment-lightbox" aria-describedby={undefined}>
              <Dialog.Title>{attachment.displayName}</Dialog.Title>
              <img src={previewUrl} alt={attachment.displayName} />
              <Dialog.Close className="attachment-lightbox-close" aria-label="关闭附件预览">×</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {onRemove && (
        <button className="attachment-remove" type="button" aria-label={`移除附件 ${attachment.displayName}`} onClick={onRemove}>×</button>
      )}
    </div>
  )
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
  if (result.code === 'single_chat.reply_in_progress') return '上一条消息仍在处理中。'
  if (result.code === 'single_chat.runtime_not_ready') return '这位队员的运行时暂不可用。'
  if (result.code === 'single_chat.member_unavailable') return '这位队员已不在当前会话中。'
  if (result.code === 'single_chat.version_conflict') return '对话刚刚发生变化，请重试。'
  return `操作未完成：${result.code}`
}

function resultPayloadString(result: StoredCommandResult, field: string): string | null {
  const value = result.payload[field]
  return typeof value === 'string' && value.trim() ? value : null
}

export function formatSingleChatDuration(startedAt: string, endedAt: string): string {
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  const totalSeconds = Number.isFinite(started) && Number.isFinite(ended)
    ? Math.max(0, Math.floor((ended - started) / 1_000))
    : 0
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return [
    ...(hours > 0 ? [`${hours} 小时`] : []),
    ...(minutes > 0 ? [`${minutes} 分`] : []),
    `${seconds} 秒`
  ].join(' ')
}

export function singleChatRunSummary(run: SingleChatRunView, now: string): string {
  const start = run.startedAt ?? run.createdAt
  const end = run.endedAt ?? now
  const duration = formatSingleChatDuration(start, end)
  if (run.status === 'succeeded') return `工作了 ${duration}`
  if (run.status === 'cancelled') return `你在 ${duration}后停止了运行`
  if (run.status === 'failed') return `运行 ${duration}后失败`
  if (run.status === 'queued') return '等待开始'
  if (run.status === 'waiting') return `等待继续 · ${duration}`
  return `正在工作 · ${duration}`
}

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

function ToolGroup({
  items,
  runStatus
}: {
  items: ToolProgressItem[]
  runStatus: SingleChatRunView['status']
}): React.JSX.Element {
  const running = NON_TERMINAL_RUNS.has(runStatus)
    && items.some((item) => item.step.status === 'running' || item.step.status === 'waiting')
  const stopped = runStatus === 'cancelled'
  const label = running ? '正在执行' : `已执行 ${items.length} 项操作`
  return (
    <details className="single-chat-tool-group" open={running || undefined}>
      <summary aria-label={`${label}；展开操作详情`}>
        <span className="single-chat-tool-icon"><ToolGlyph /></span>
        <span>{label}</span>
        <span className={`single-chat-tool-state${running ? ' is-running' : stopped ? ' is-stopped' : ''}`} aria-hidden="true" />
        <span className="single-chat-disclosure"><ChevronGlyph /></span>
      </summary>
      <div className="single-chat-tool-items">
        {items.map((item) => (
          <div className="single-chat-tool-row" key={item.key}>
            <span className="single-chat-tool-icon"><ToolGlyph /></span>
            <span className="single-chat-tool-copy">
              <strong>{item.step.toolName ?? item.step.activityDomain ?? '操作'}</strong>
              <code title={executionStepPublicTitle(item.step)}>{executionStepPublicTitle(item.step)}</code>
            </span>
            <span className={`single-chat-tool-result is-${item.step.status}`} aria-hidden="true">
              {item.step.status === 'running' || item.step.status === 'waiting'
                ? <span className="single-chat-spinner" />
                : item.step.status === 'failed'
                  ? '×'
                  : <CheckGlyph />}
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}

function ExecutionItem({ item, runStatus }: {
  item: GroupedExecutionProgressItem
  runStatus: SingleChatRunView['status']
}): React.JSX.Element | null {
  if (item.kind === 'toolGroup') return <ToolGroup items={item.items} runStatus={runStatus} />
  if (item.kind === 'narration') {
    return <div className="single-chat-narration"><SafeMarkdown>{item.body}</SafeMarkdown></div>
  }
  if (item.kind === 'plan') {
    return (
      <div className="single-chat-plan">
        {item.explanation && <SafeMarkdown>{item.explanation}</SafeMarkdown>}
        {item.plan.length > 0 && <ol>{item.plan.map((step, index) => (
          <li className={`is-${step.status}`} key={`${index}:${step.step}`}>
            <span aria-hidden="true">{step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '●' : '○'}</span>
            <span>{step.step}</span>
          </li>
        ))}</ol>}
      </div>
    )
  }
  if (item.kind === 'diagnostic') {
    return <p className="single-chat-process-note">运行时正在重试（{item.diagnostic.attempt}/{item.diagnostic.maxAttempts}）</p>
  }
  if (item.kind === 'compaction') {
    return <p className="single-chat-process-note">已整理较早的执行上下文</p>
  }
  if (item.kind === 'tool') return <ToolGroup items={[item]} runStatus={runStatus} />
  return null
}

function SingleChatRunHistory({
  run,
  evidence,
  finalMessage,
  now
}: {
  run: SingleChatRunView
  evidence: AgentRunExecutionEvidenceView[]
  finalMessage: SingleChatMessageView | null
  now: string
}): React.JSX.Element {
  const terminal = !NON_TERMINAL_RUNS.has(run.status)
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
  const hasProcess = grouped.length > 0

  return (
    <section className="single-chat-agent-response" aria-label="队员回复">
      <div className="single-chat-agent-column">
        <details
          className={`single-chat-run-history${terminal ? ' is-terminal' : ' is-live'}`}
          open={open}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary>
            <span className="single-chat-run-summary" aria-live={terminal ? undefined : 'polite'}>
              {singleChatRunSummary(run, now)}
            </span>
            <span className="single-chat-disclosure" aria-hidden="true"><ChevronGlyph /></span>
          </summary>
          <div className="single-chat-execution-content">
            {grouped.map((item) => (
              <ExecutionItem item={item} runStatus={run.status} key={item.key} />
            ))}
            {!hasProcess && NON_TERMINAL_RUNS.has(run.status) && (
              <div className="single-chat-processing" role="status">
                <span className="single-chat-spinner" aria-hidden="true" />
                <span>{run.status === 'queued' ? '等待开始' : run.status === 'waiting' ? '等待继续' : '正在处理'}</span>
              </div>
            )}
            {!hasProcess && run.status === 'failed' && (
              <p className="single-chat-process-note is-error">本轮回复失败，可以重新发送。</p>
            )}
          </div>
        </details>
        {finalMessage && <>
          <hr className="single-chat-final-rule" />
          <div className="single-chat-final"><SafeMarkdown>{finalMessage.body}</SafeMarkdown></div>
        </>}
      </div>
    </section>
  )
}

function SingleChatTranscript({ snapshot, now }: { snapshot: SingleChatSnapshot; now: string }): React.JSX.Element {
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
        <div className="single-chat-turn" key={message.id}>
          <div className="single-chat-user-message">
            <div className="single-chat-user-content">
              {message.body && <div className="single-chat-user-bubble">{message.body}</div>}
              {message.attachments.length > 0 && (
                <div className="single-chat-message-attachments" role="group" aria-label={`附件 ${message.attachments.length} 个`}>
                  {message.attachments.map((attachment) => (
                    <SingleChatAttachmentCard attachment={attachment} presentation="user-timeline" key={attachment.id} />
                  ))}
                </div>
              )}
            </div>
          </div>
          {run && (
            <SingleChatRunHistory
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

export function SingleChatPanel({
  campId,
  members,
  entryHost,
  visible,
  onOpen,
  onClose,
  onNotify = () => undefined
}: {
  campId: string
  members: CampMemberView[]
  entryHost?: HTMLElement | null
  visible: boolean
  onOpen(): void
  onClose(): void
  onNotify?(message: string): void
}): React.JSX.Element {
  const panelId = useId()
  const initialAgentId = members.find((member) => memberCanSingleChat(member) && member.isDefaultLead)?.agentId
    ?? members.find(memberCanSingleChat)?.agentId
    ?? null
  const panelRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const focusPanel = useRef(false)
  const selectedAgentIdRef = useRef<string | null>(initialAgentId)
  const snapshotRef = useRef<SingleChatSnapshot | null>(null)
  const viewportRef = useRef<HTMLElement>(null)
  const viewportEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const followLatestRef = useRef(true)
  const [conversations, setConversations] = useState<SingleChatConversationView[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(initialAgentId)
  const [snapshot, setSnapshot] = useState<SingleChatSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [ending, setEnding] = useState(false)
  const [preparingAttachments, setPreparingAttachments] = useState<PreparingSingleChatAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [endDialogOpen, setEndDialogOpen] = useState(false)
  const [skipEndConfirmation, setSkipEndConfirmation] = useState(false)
  const [now, setNow] = useState(() => new Date().toISOString())

  const activeMembers = useMemo(() => members.filter(memberCanSingleChat), [members])
  const memberById = useMemo(() => new Map(activeMembers.map((member) => [member.agentId, member])), [activeMembers])
  const selectedMember = selectedAgentId ? memberById.get(selectedAgentId) ?? null : null
  const activeRun = snapshot?.agentRuns.find((run) => NON_TERMINAL_RUNS.has(run.status)) ?? null
  const runningCount = conversations.filter((conversation) => conversation.activeAgentRunId !== null).length

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId
  }, [selectedAgentId])
  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    let disposed = false
    void window.rovai.request<SingleChatConversationView[]>('singleChat.list', { campId })
      .then((nextConversations) => {
        if (!disposed) setConversations(nextConversations)
      })
      .catch(() => undefined)
    return () => {
      disposed = true
    }
  }, [campId])

  const loadConversation = async (conversationId: string): Promise<SingleChatSnapshot | null> => {
    const next = await window.rovai.request<SingleChatSnapshot | null>('singleChat.get', { conversationId })
    if (!next || next.conversation.campId !== campId) return null
    return next
  }

  const refresh = async (showLoading = false): Promise<void> => {
    if (showLoading) setLoading(true)
    try {
      const nextConversations = await window.rovai.request<SingleChatConversationView[]>('singleChat.list', { campId })
      setConversations(nextConversations)
      let agentId = selectedAgentIdRef.current
      if (!agentId || !memberById.has(agentId)) {
        agentId = nextConversations.find((conversation) => memberById.has(conversation.agentId))?.agentId
          ?? activeMembers.find((member) => member.isDefaultLead)?.agentId
          ?? activeMembers[0]?.agentId
          ?? null
        selectedAgentIdRef.current = agentId
        setSelectedAgentId(agentId)
      }
      const conversation = agentId
        ? nextConversations.find((candidate) => candidate.agentId === agentId) ?? null
        : null
      const nextSnapshot = conversation ? await loadConversation(conversation.id) : null
      snapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      setError(null)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '单聊暂时无法读取。'))
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    if (!visible) return
    let disposed = false
    let timeout: number | null = null
    const poll = async (showLoading = false): Promise<void> => {
      if (disposed) return
      await refresh(showLoading)
      if (!disposed) timeout = window.setTimeout(() => void poll(false), 800)
    }
    void poll(true)
    return () => {
      disposed = true
      if (timeout !== null) window.clearTimeout(timeout)
    }
  // The latest member maps are intentional refresh inputs; a roster change must fence the selector.
  }, [campId, visible, memberById, activeMembers])

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
      triggerRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('keydown', dismissOnEscape)
    return () => document.removeEventListener('keydown', dismissOnEscape)
  }, [onClose, visible])

  useEffect(() => {
    if (!visible || !followLatestRef.current) return
    viewportEndRef.current?.scrollIntoView({ block: 'end' })
  }, [snapshot?.conversation.lastMessageSequence, activeRun?.executionEvidenceCount, visible])

  const openConversation = async (agentId: string): Promise<SingleChatSnapshot> => {
    const result = await window.rovai.request<StoredCommandResult>('singleChat.open', {
      commandId: crypto.randomUUID(),
      command: { campId, agentId }
    })
    if (result.status === 'rejected') throw new Error(resultMessage(result))
    const conversationId = resultPayloadString(result, 'conversationId')
    if (!conversationId) throw new Error('单聊已打开，但未返回对话标识。')
    const next = await loadConversation(conversationId)
    if (!next) throw new Error('单聊已不在当前会话中。')
    snapshotRef.current = next
    setSnapshot(next)
    return next
  }

  const chooseTarget = async (agentId: string): Promise<void> => {
    followLatestRef.current = true
    setPreparingAttachments([])
    selectedAgentIdRef.current = agentId
    setSelectedAgentId(agentId)
    setError(null)
    setLoading(true)
    try {
      await openConversation(agentId)
      await refresh(false)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '无法打开这段单聊。'))
    } finally {
      setLoading(false)
    }
  }

  const prepareFiles = async (files: File[]): Promise<void> => {
    const agentId = selectedAgentIdRef.current
    if (!agentId || activeRun || ending || files.length === 0) return
    const pending = files.map((file) => ({ id: crypto.randomUUID(), name: file.name, error: null }))
    setPreparingAttachments((current) => [...current, ...pending])
    setError(null)
    let current = snapshotRef.current?.conversation.agentId === agentId
      ? snapshotRef.current
      : null
    try {
      if (!current) current = await openConversation(agentId)
      for (const [index, file] of files.entries()) {
        const item = pending[index]
        try {
          const next = await window.rovai.singleChatAttachments.prepare(
            current.conversation.id,
            current.conversation.version,
            file
          )
          current = next
          snapshotRef.current = next
          setSnapshot(next)
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

  const removePreparedAttachment = async (attachmentId: string): Promise<void> => {
    const current = snapshotRef.current
    if (!current || activeRun || ending) return
    setError(null)
    try {
      const next = await window.rovai.singleChatAttachments.remove(
        current.conversation.id,
        current.conversation.version,
        attachmentId
      )
      snapshotRef.current = next
      setSnapshot(next)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '附件未能移除，请重试。'))
    }
  }

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const body = draft.trim()
    const agentId = selectedAgentIdRef.current
    if (!agentId || activeRun || sending || preparingAttachments.some((item) => !item.error)) return
    followLatestRef.current = true
    setSending(true)
    setError(null)
    try {
      const current = snapshotRef.current?.conversation.agentId === agentId
        ? snapshotRef.current
        : await openConversation(agentId)
      if (!current) throw new Error('无法打开这段单聊。')
      const attachmentIds = current.preparedAttachments.map((attachment) => attachment.id)
      if (!body && attachmentIds.length === 0) return
      const result = await window.rovai.request<StoredCommandResult>('singleChat.send', {
        commandId: crypto.randomUUID(),
        command: {
          campId,
          conversationId: current.conversation.id,
          body,
          attachmentIds,
          expectedConversationVersion: current.conversation.version
        }
      })
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      setDraft('')
      setPreparingAttachments([])
      await refresh(false)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '消息未发送，请重试。'))
    } finally {
      setSending(false)
    }
  }

  const stopCurrentRun = async (): Promise<void> => {
    const run = activeRun
    if (!run || cancelling) return
    setCancelling(true)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('agentRuns.cancel', {
        commandId: crypto.randomUUID(),
        command: { campId, agentRunId: run.id, expectedVersion: run.version }
      })
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      await refresh(false)
    } catch (nextError) {
      setError(readErrorMessage(nextError, '停止请求未完成，请重试。'))
    } finally {
      setCancelling(false)
    }
  }

  const endConversation = async (): Promise<void> => {
    const current = snapshotRef.current
    if (!current || ending) return
    setEnding(true)
    setError(null)
    try {
      const result = await window.rovai.request<StoredCommandResult>('singleChat.end', {
        commandId: crypto.randomUUID(),
        command: {
          campId,
          conversationId: current.conversation.id,
          expectedConversationVersion: current.conversation.version
        }
      })
      if (result.status === 'rejected') throw new Error(resultMessage(result))
      if (skipEndConfirmation) storeBoolean(END_CONFIRMATION_STORAGE_KEY, true)
      setEndDialogOpen(false)
      setPreparingAttachments([])
      snapshotRef.current = null
      setSnapshot(null)
      setConversations((currentConversations) => currentConversations.filter((conversation) => conversation.id !== current.conversation.id))
      onNotify('单聊已结束')
    } catch (nextError) {
      setError(readErrorMessage(nextError, '单聊未结束，请重试。'))
    } finally {
      setEnding(false)
    }
  }

  const requestEnd = (): void => {
    if (!snapshotRef.current) return
    if (safeStoredBoolean(END_CONFIRMATION_STORAGE_KEY)) {
      void endConversation()
      return
    }
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
      className="single-chat-popover"
      role="dialog"
      aria-modal={false}
      aria-labelledby={`${panelId}-title`}
      tabIndex={-1}
      hidden={!visible}
    >
      <header className="single-chat-heading">
        <SingleChatGlyph />
        <strong id={`${panelId}-title`}>单聊</strong>
        <span>当前会话</span>
        <button className="icon-button" type="button" aria-label="收起单聊" title="收起 · Esc" onClick={() => {
          onClose()
          triggerRef.current?.focus({ preventScroll: true })
        }}><CloseGlyph /></button>
      </header>

      <div className="single-chat-target-bar">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className={`single-chat-target-trigger${selectedMember ? '' : ' no-target'}`} type="button" disabled={activeMembers.length === 0 || ending || sending || preparingAttachments.some((item) => !item.error)}>
              {selectedMember && <MemberAvatar agentId={selectedMember.agentId} avatarRef={selectedMember.avatarRef} displayName={selectedMember.displayName} size="mention" decorative />}
              <span className="single-chat-target-copy">
                <strong>{selectedMember?.displayName ?? '选择单聊对象'}</strong>
                <small>{selectedMember?.teamRole ?? '当前会话中的队员'}</small>
              </span>
              <span className="single-chat-target-chevron"><ChevronGlyph /></span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="single-chat-target-menu" sideOffset={6} align="start" collisionPadding={12}>
              <div className="single-chat-target-menu-heading">
                <strong>选择单聊对象</strong>
                <span>单聊正文不会进入 Camp 公屏</span>
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
        <button className="single-chat-end-button" type="button" disabled={!snapshot || ending} aria-label={selectedMember ? `结束与${selectedMember.displayName}的单聊` : '结束单聊'} onClick={requestEnd}>
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
        }}
      >
        <div className="single-chat-transcript">
          {loading && !snapshot && <div className="single-chat-empty" role="status"><span className="single-chat-spinner" /><strong>正在打开单聊</strong></div>}
          {!loading && !selectedMember && <div className="single-chat-empty"><strong>当前没有可单聊的队员</strong><span>队员回到当前会话后即可开始单聊。</span></div>}
          {!loading && selectedMember && !snapshot && <div className="single-chat-empty"><strong>和 {selectedMember.displayName} 单独聊聊</strong><span>发送第一条消息开始这段对话。</span></div>}
          {snapshot && snapshot.messages.length === 0 && <div className="single-chat-empty"><strong>和 {selectedMember?.displayName} 单独聊聊</strong><span>发送第一条消息开始这段对话。</span></div>}
          {snapshot && <SingleChatTranscript snapshot={snapshot} now={now} />}
          <div ref={viewportEndRef} aria-hidden="true" />
        </div>
      </section>

      <form className="composer single-chat-composer" onSubmit={(event) => void send(event)}>
        <div className={`composer-box single-chat-composer-box${activeRun ? ' is-running' : ''}`}>
          <div className="composer-input">
            {((snapshot?.preparedAttachments.length ?? 0) > 0 || preparingAttachments.length > 0) && (
              <SingleChatAttachmentStrip>
                {snapshot?.preparedAttachments.map((attachment) => (
                  <SingleChatAttachmentCard
                    attachment={attachment}
                    presentation="composer"
                    key={attachment.id}
                    onRemove={() => void removePreparedAttachment(attachment.id)}
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
            <label className="sr-only" htmlFor={`${panelId}-composer`}>发送单聊消息</label>
            <textarea
              id={`${panelId}-composer`}
              value={draft}
              disabled={!selectedMember || Boolean(activeRun) || sending || ending}
              placeholder={activeRun ? '队员正在回复…' : selectedMember ? `给 ${selectedMember.displayName} 发消息…` : '选择一位队员后开始单聊'}
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
                  isComposing: event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229,
                  suggestionMenuOpen: false
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
                disabled={!selectedMember || Boolean(activeRun) || sending || ending || preparingAttachments.some((item) => !item.error)}
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
              {activeRun
                ? <button className="danger-button composer-stop single-chat-stop" type="button" disabled={cancelling} onClick={() => void stopCurrentRun()}>{cancelling ? '正在提交停止请求…' : '停止'}</button>
                : <button
                    className="primary-button composer-send single-chat-send"
                    type="submit"
                    aria-busy={sending || preparingAttachments.some((item) => !item.error)}
                    disabled={(!draft.trim() && (snapshot?.preparedAttachments.length ?? 0) === 0) || !selectedMember || sending || ending || preparingAttachments.some((item) => !item.error)}
                  >发送</button>}
            </div>
          </div>
        </div>
        {error && <div className="single-chat-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>关闭</button></div>}
      </form>
      <footer className="single-chat-footer">
        <span>单聊正文不会进入 Camp 公屏</span>
        <span><kbd>Esc</kbd> 收起</span>
      </footer>
    </aside>

    <Dialog.Root open={endDialogOpen} onOpenChange={(open) => !ending && setEndDialogOpen(open)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <AppDialogContent tone="danger" aria-describedby={`${panelId}-end-description`}>
          <AppDialogHeader
            title={selectedMember ? `结束与${selectedMember.displayName}的单聊？` : '结束单聊？'}
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
            <button className="danger-button" type="button" disabled={ending} onClick={() => void endConversation()}>{ending ? '结束中…' : '结束'}</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
