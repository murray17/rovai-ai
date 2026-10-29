import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { AdapterInstallation, AgentProfile, AgentRunView, ThreadSnapshot } from '@contracts'
import { ContinueAgentRunButton } from './ContinueAgentRunButton'
import { ExecutionIcon, ExecutionStopIcon } from './ExecutionIcons'
import { ExecutionStatusGlyph } from './ExecutionStatusGlyph'
import { ToolCallIcon } from './ExecutionToolGroup'
import { MemberAvatar } from './MemberAvatar'
import { MessageAuthorProfileTrigger } from './MessageAuthorProfileTrigger'
import { RunModelSummary } from './ThreadModelInformation'
import { formatRunPresenceDuration, isUserInterruptedRun, runPresenceElapsedSeconds, runPresencePreview, type ConversationRunPresenceSlot } from './conversation-run-presence'
import { identityColorToken } from './theme'
import { uiAttribute, useInterfaceLanguage } from './interface-language'
import { agentRunIsStarting, agentRunHasCurrentActivity, type LiveRuntimeEvent } from './ui-model'
import { groupExecutionEventsByRunId } from './execution-events'
import { useExecutionWindow } from './useExecutionWindow'
import { useNavigationPressMenu } from './useNavigationPressMenu'
import type { AgentRunStopViewState } from './ThreadWorkspace'
import './conversation-run-presence.css'

export function ConversationRunPresence({ snapshot, slot, profiles, installations, source, onActivateMember, eventsByRunId, windowedEvidence, stopState, onStop, onOpen, onError, onContinued }: {
  snapshot: ThreadSnapshot
  slot: ConversationRunPresenceSlot
  profiles: readonly AgentProfile[]
  installations: AdapterInstallation[]
  source: ReactNode
  onActivateMember(agentId: string, trigger: HTMLElement, focusPanel: boolean): void
  eventsByRunId: ReadonlyMap<string, LiveRuntimeEvent[]>
  windowedEvidence: boolean
  stopState(run: AgentRunView): AgentRunStopViewState
  onStop(run: AgentRunView): Promise<void>
  onOpen(agentId: string, trigger: HTMLButtonElement, options: { runId: string }): void
  onError(message: string): void
  onContinued(runId: string): void
}): React.JSX.Element | null {
  useInterfaceLanguage()
  const [stopId, setStopId] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [stopError, setStopError] = useState('')
  const submitting = useRef(false)
  const stopTrigger = useRef<HTMLButtonElement | null>(null)
  const confirmationId = useId()
  const slots = [slot]
  const target = snapshot.agentRuns.find(run => run.id === stopId)
  const canConfirm = Boolean(target && stopState(target) === 'available')
  const memberName = (run: AgentRunView): string => snapshot.members.find(member => member.agentId === run.agentId)?.displayName
    ?? profiles.find(profile => profile.agentId === run.agentId)?.displayName ?? run.agentId
  const question = uiAttribute('停止{0}的执行？', target ? memberName(target) : '')
  const questionTail = '的执行？'

  useEffect(() => {
    if (stopId && !canConfirm && !submittingId) setStopId(null)
  }, [stopId, canConfirm, submittingId])

  useEffect(() => {
    if (!stopId || !stopTrigger.current) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && !submitting.current) setStopId(null)
    })
    observer.observe(stopTrigger.current)
    return () => observer.disconnect()
  }, [stopId, submittingId])

  const confirmStop = async (): Promise<void> => {
    if (!target || !canConfirm || submitting.current) return
    submitting.current = true
    setStopError('')
    setSubmittingId(target.id)
    try {
      // Resolve the same ID against the latest snapshot. The existing command owns CAS and uncertainty.
      await onStop(target)
      setStopId(null)
    } catch {
      setStopError(uiAttribute('停止请求未成功，请重试。'))
    } finally {
      submitting.current = false
      setSubmittingId(null)
    }
  }

  return <Popover.Root modal={false} open={stopId !== null}
    onOpenChange={open => { if (!open && !submitting.current) setStopId(null) }}>
    {slots.length > 0 && <div className={`conversation-run-presence-tail${slots[0].continuation ? ' has-continuation' : ''}`}>
      {slots.map(({ run, continuation }) => {
        const name = memberName(run)
        const member = snapshot.members.find(member => member.agentId === run.agentId)
        const profile = profiles.find(profile => profile.agentId === run.agentId)
        const avatarRef = member?.avatarRef ?? profile?.avatarRef ?? null
        const canInspect = Boolean(profile && member?.membershipStatus === 'active' && member.profilePresence !== 'removed')
        const authorPart = (variant: 'avatar' | 'name'): React.JSX.Element => {
          const content = variant === 'avatar'
            ? <MemberAvatar agentId={run.agentId} avatarRef={avatarRef} displayName={name} size="list" decorative />
            : <strong>{name}</strong>
          return canInspect
            ? <MessageAuthorProfileTrigger agentId={run.agentId} displayName={name} variant={variant}
                onActivate={onActivateMember}>{content}</MessageAuthorProfileTrigger>
            : content
        }
        const state = submittingId === run.id && ['queued', 'running', 'waiting'].includes(run.status) ? 'stopping' : stopState(run)
        const canStop = state === 'available' || state === 'stopping' || state === 'confirming'
        const inputTooLarge = run.failure?.code === 'context_payload_too_large'
        const canContinue = !inputTooLarge && (run.status === 'failed' || isUserInterruptedRun(run))
          && run.invocationKind === 'batch' && (run.inputMessageIds?.length ?? 0) > 0
        const description = inputTooLarge ? uiAttribute('输入内容过大，查看详情') : run.status === 'failed' ? uiAttribute('执行中断，查看原因')
          : uiAttribute('查看执行过程')
        return <article key={run.id} className="conversation-bubble agent conversation-run-presence"
          data-presence-run={run.id} data-presence-state={run.status} data-continuation={continuation}
          aria-label={`${name}，${description}`} style={{ '--agent-accent': identityColorToken(run.agentId) } as CSSProperties}>
          {!continuation && authorPart('avatar')}
          <div className="message-body">
            {!continuation && <div className="bubble-meta">
              {authorPart('name')}
              <RunModelSummary run={run} installations={installations} displayName={name} avatarRef={avatarRef} />
            </div>}
            {source}
            <div className="run-presence-line">
              <RunPresenceOpen threadId={snapshot.thread.id} run={run} name={name} description={description}
                windowedEvidence={windowedEvidence} events={eventsByRunId.get(run.id)}
                stopping={state === 'stopping' || state === 'confirming'} onOpen={onOpen} />
              {canStop && <Popover.Anchor asChild><button className="run-presence-stop" type="button" disabled={state !== 'available'}
                aria-haspopup="dialog" aria-expanded={stopId === run.id} aria-controls={stopId === run.id ? confirmationId : undefined}
                title={state === 'confirming' ? uiAttribute('正在确认停止结果') : uiAttribute('停止{0}的本次执行', name)}
                aria-label={state === 'stopping' ? uiAttribute('正在提交停止请求…') : state === 'confirming'
                  ? uiAttribute('正在确认停止结果') : uiAttribute('停止{0}的本次执行', name)}
                aria-busy={state === 'stopping' || state === 'confirming' || undefined}
                onClick={event => {
                  stopTrigger.current = event.currentTarget
                  setStopError('')
                  setStopId(stopId === run.id ? null : run.id)
                }}>
                <ExecutionStopIcon />
              </button></Popover.Anchor>}
              {canContinue &&
                <ContinueAgentRunButton threadId={snapshot.thread.id} agentRunId={run.id} appearance={run.status === 'failed' ? 'retry' : 'continue'}
                  onError={onError} onApplied={() => onContinued(run.id)} />}
            </div>
          </div>
        </article>
      })}
    </div>}
    <Popover.Portal>
      <Popover.Content id={confirmationId} className="run-presence-stop-confirmation"
        side="top" align="end" sideOffset={7} collisionPadding={16} updatePositionStrategy="always"
        aria-labelledby={`${confirmationId}-question`} aria-describedby={`${confirmationId}-scope`}
        aria-busy={submittingId !== null || undefined}
        onOpenAutoFocus={event => {
          event.preventDefault()
          document.getElementById(confirmationId)?.querySelector<HTMLButtonElement>('.quiet-button')?.focus({ preventScroll: true })
        }}
        onCloseAutoFocus={event => event.preventDefault()}
        onKeyDownCapture={event => leaveStopConfirmation(event, stopTrigger.current, () => { if (!submitting.current) setStopId(null) })}
        onEscapeKeyDown={event => { if (submitting.current) event.preventDefault() }}
        onInteractOutside={event => {
          const outside = event.detail.originalEvent.target
          if (submitting.current || (outside instanceof Node && stopTrigger.current?.contains(outside))) event.preventDefault()
        }}>
        <h2 id={`${confirmationId}-question`} className="run-presence-stop-question">
          {question.endsWith(questionTail) ? <>{question.slice(0, -questionTail.length)}<span>{questionTail}</span></> : question}
        </h2>
        <p id={`${confirmationId}-scope`} className="sr-only">{uiAttribute('只停止{0}的这次执行，已经发送的消息会保留。', target ? memberName(target) : '')}</p>
        <div className="run-presence-stop-actions">
          <button type="button" className="quiet-button" disabled={submittingId !== null} onClick={() => setStopId(null)}>{uiAttribute('取消')}</button>
          <button type="button" className="danger-button" disabled={!canConfirm || submittingId !== null}
            aria-busy={submittingId !== null || undefined}
            aria-label={uiAttribute(submittingId ? '正在提交停止请求…' : '停止{0}的本次执行', target ? memberName(target) : '')}
            onClick={() => void confirmStop()}>
            <span className="run-presence-stop-label" aria-hidden="true">{uiAttribute('停止')}</span>
            {submittingId !== null && <span className="run-presence-stop-busy" aria-hidden="true"><ExecutionStatusGlyph status="cancelling" /></span>}
          </button>
        </div>
        {stopError && <p className="run-presence-stop-error" role="alert">{stopError}</p>}
        <Popover.Arrow className="run-presence-stop-arrow" width={12} height={6} aria-hidden="true" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}

// Radix loops Tab even in a non-modal Popover. Continue the conversation's tab
// order at the anchor when leaving this temporary confirmation's two actions.
function leaveStopConfirmation(event: KeyboardEvent<HTMLElement>, anchor: HTMLButtonElement | null, onLeave: () => void): void {
  if (event.key !== 'Tab' || event.nativeEvent.isComposing || !anchor) return
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const edge = event.shiftKey ? buttons[0] : buttons.at(-1)
  if (edge && document.activeElement !== edge) return
  const outside = [...document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [contenteditable="true"], [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !event.currentTarget.contains(element)
      && !element.closest('[inert], [aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
  const next = event.shiftKey ? anchor : outside[outside.indexOf(anchor) + 1] ?? outside[0]
  if (next) { event.preventDefault(); next.focus(); onLeave() }
}

function RunPresenceTime({ run, id }: { run: AgentRunView, id: string }): React.JSX.Element | null {
  useInterfaceLanguage()
  const [now, setNow] = useState(Date.now)
  const live = (run.status === 'running' || run.status === 'waiting') && !run.endedAt
    && Boolean(run.startedAt && Number.isFinite(Date.parse(run.startedAt)))
  useEffect(() => {
    if (!live) return
    const tick = (): void => setNow(Date.now())
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [live, run.startedAt])
  const seconds = runPresenceElapsedSeconds(run, now)
  if (seconds === null) return null
  const duration = formatRunPresenceDuration(seconds)
  return <time id={id} className="run-presence-time" dateTime={`PT${seconds}S`} title={uiAttribute('已运行 {0}', duration)}>
    <span className="sr-only">{uiAttribute('已运行')}</span>{duration}
  </time>
}

export function RunPresenceOpen({ threadId, run, name, description, windowedEvidence, events, stopping, onOpen }: {
  threadId: string
  run: AgentRunView
  name: string
  description: string
  windowedEvidence: boolean
  events?: LiveRuntimeEvent[]
  stopping: boolean
  onOpen(agentId: string, trigger: HTMLButtonElement, options: { runId: string }): void
}): React.JSX.Element {
  const language = useInterfaceLanguage()
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocusOnClose = useRef(false)
  const menuId = useId()
  const elapsedId = useId()
  const menu = useNavigationPressMenu(true)
  const tail = useExecutionWindow(windowedEvidence && run.status === 'running', threadId, run, events, null, true)
  const mergedEvents = useMemo(() => {
    // Reconcile evidence by identity/revision before projecting a line. A late
    // restored page must not replace newer live text or a newly started command.
    const merged = groupExecutionEventsByRunId([{ id: run.id }], tail.evidence, windowedEvidence ? events?.slice(-48) ?? [] : events ?? [])
    return merged.get(run.id) ?? []
  }, [tail.evidence, events, run.id, windowedEvidence])
  const preview = useMemo(() => stopping && ['queued', 'running', 'waiting'].includes(run.status)
    ? { kind: 'status' as const, text: uiAttribute('正在停止…') }
    : runPresencePreview(run, mergedEvents, name), [run, mergedEvents, name, language, stopping])
  const starting = agentRunIsStarting(run) && !agentRunHasCurrentActivity(run, mergedEvents)
  const running = (run.status === 'running' || starting) && !run.cancelRequestedAt && !stopping
  const button = <button ref={trigger} {...menu.rowProps} className={`run-presence-open is-${preview.kind}`} type="button" data-preview-kind={preview.kind}
    title={uiAttribute('查看执行过程')} aria-label={`${name}，${preview.text}，${description}`}
    aria-describedby={starting ? undefined : elapsedId} aria-expanded={menu.open} aria-controls={menu.open ? menuId : undefined}
    onClick={event => onOpen(run.agentId, event.currentTarget, { runId: run.id })}>
    {running && <span className="run-presence-spinner" aria-hidden="true"><ExecutionStatusGlyph status="cancelling" /></span>}
    {!running && <span className={`run-presence-status is-${run.status}`} aria-hidden="true"><ExecutionStatusGlyph status={run.status === 'cancelled' ? 'stopped' : run.status} /></span>}
    {preview.iconKind && <ToolCallIcon iconKind={preview.iconKind} />}
    <span className={`run-presence-preview is-${preview.kind}`}>{preview.text}</span>
    {!starting && <RunPresenceTime run={run} id={elapsedId} />}
  </button>
  const bounds = menu.open ? trigger.current?.getBoundingClientRect() : undefined
  const point = menu.contextPoint ?? { x: bounds?.left ?? 0, y: bounds?.bottom ?? 0 }
  return <DropdownMenu.Root open={menu.open} onOpenChange={menu.setOpen}>
    {button}
    <DropdownMenu.Trigger asChild>
      <span className="sidebar-context-anchor" aria-hidden="true" tabIndex={-1} style={{ left: point.x, top: point.y }} />
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content {...menu.menuProps} id={menuId} className="sidebar-action-menu run-presence-menu"
        aria-label={uiAttribute('执行行操作')} align="start" sideOffset={4} collisionPadding={8} loop
        onEscapeKeyDown={() => { restoreFocusOnClose.current = true }} onCloseAutoFocus={event => {
          event.preventDefault()
          // Wait for the modal menu's focus trap to release before returning to the row.
          if (restoreFocusOnClose.current) menu.restoreRowFocus()
          restoreFocusOnClose.current = false
        }}>
        <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={() => {
          if (trigger.current) onOpen(run.agentId, trigger.current, { runId: run.id })
        }}>
          <ExecutionIcon className="sidebar-action-menu-icon" /><span>{uiAttribute('查看执行过程')}</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
