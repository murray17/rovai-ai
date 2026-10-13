import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { AgentProfile, AgentRunView, ThreadSnapshot } from '@contracts'
import { AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { ContinueAgentRunButton } from './ContinueAgentRunButton'
import { ExecutionIcon, ExecutionStopIcon } from './ExecutionIcons'
import { ExecutionStatusGlyph } from './ExecutionStatusGlyph'
import { ToolCallIcon } from './ExecutionToolGroup'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { RunningText } from './RunningText'
import { runPresencePreview, type ConversationRunPresenceSlot } from './conversation-run-presence'
import { identityColorToken } from './theme'
import { uiAttribute, useInterfaceLanguage } from './interface-language'
import { buildLiveExecutionProgress, type LiveRuntimeEvent } from './ui-model'
import { groupExecutionEventsByRunId } from './execution-events'
import { useExecutionWindow } from './useExecutionWindow'
import { useNavigationPressMenu } from './useNavigationPressMenu'
import type { AgentRunStopViewState } from './ThreadWorkspace'
import './conversation-run-presence.css'

export function ConversationRunPresence({ snapshot, slot, profiles, eventsByRunId, windowedEvidence, stopState, onStop, onOpen, onOpenMotionSettings, onError }: {
  snapshot: ThreadSnapshot
  slot: ConversationRunPresenceSlot
  profiles: readonly AgentProfile[]
  eventsByRunId: ReadonlyMap<string, LiveRuntimeEvent[]>
  windowedEvidence: boolean
  stopState(run: AgentRunView): AgentRunStopViewState
  onStop(run: AgentRunView): Promise<void>
  onOpen(agentId: string, trigger: HTMLButtonElement, options: { runId: string }): void
  onOpenMotionSettings?(): void
  onError(message: string): void
}): React.JSX.Element | null {
  useInterfaceLanguage()
  // Immediate receipt feedback while the refreshed Core projection is in flight.
  // Re-entry is owned by run.hasAcceptedContinuation, not this component Set.
  const [continuedRunIds, setContinuedRunIds] = useState<ReadonlySet<string>>(() => new Set())
  const [stopId, setStopId] = useState<string | null>(null)
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const submitting = useRef(false)
  const stopTrigger = useRef<HTMLButtonElement | null>(null)
  const slots = continuedRunIds.has(slot.run.id) ? [] : [slot]
  const target = snapshot.agentRuns.find(run => run.id === stopId)
  const canConfirm = Boolean(target && stopState(target) === 'available')
  const memberName = (run: AgentRunView): string => snapshot.members.find(member => member.agentId === run.agentId)?.displayName
    ?? profiles.find(profile => profile.agentId === run.agentId)?.displayName ?? run.agentId

  useEffect(() => {
    if (stopId && !canConfirm && !submittingId) setStopId(null)
  }, [stopId, canConfirm, submittingId])

  const confirmStop = async (): Promise<void> => {
    if (!target || !canConfirm || submitting.current) return
    submitting.current = true
    setSubmittingId(target.id)
    try {
      // Resolve the same ID against the latest snapshot. The existing command owns CAS and uncertainty.
      await onStop(target)
      setStopId(null)
    } catch {
      onError(uiAttribute('停止请求未成功，请重试。'))
    } finally {
      submitting.current = false
      setSubmittingId(null)
    }
  }

  return <>
    {slots.length > 0 && <div className={`conversation-run-presence-tail${slots[0].continuation ? ' has-continuation' : ''}`}>
      {slots.map(({ run, continuation }) => {
        const name = memberName(run)
        const member = snapshot.members.find(member => member.agentId === run.agentId)
        const profile = profiles.find(profile => profile.agentId === run.agentId)
        const state = submittingId === run.id ? 'stopping' : stopState(run)
        const canStop = state === 'available' || state === 'stopping' || state === 'confirming'
        const canRetry = run.status === 'failed' && run.invocationKind === 'batch' && (run.inputMessageIds?.length ?? 0) > 0
        const description = run.status === 'failed' ? uiAttribute('执行中断，查看原因')
          : uiAttribute('查看执行过程')
        return <article key={run.id} className="conversation-bubble agent conversation-run-presence"
          data-presence-run={run.id} data-presence-state={run.status} data-continuation={continuation}
          aria-label={`${name}，${description}`} style={{ '--agent-accent': identityColorToken(run.agentId) } as CSSProperties}>
          {!continuation && <MemberAvatar agentId={run.agentId} avatarRef={member?.avatarRef ?? profile?.avatarRef ?? null}
            displayName={name} size="list" decorative />}
          <div className="message-body">
            {!continuation && <div className="bubble-meta"><strong>{name}</strong></div>}
            <div className="run-presence-line">
              <RunPresenceOpen threadId={snapshot.thread.id} run={run} name={name} description={description}
                windowedEvidence={windowedEvidence} events={eventsByRunId.get(run.id)}
                stopping={state === 'stopping' || state === 'confirming'} onOpen={onOpen} onOpenMotionSettings={onOpenMotionSettings} />
              {(canStop || canRetry) && <span className="run-presence-guide" aria-hidden="true" />}
              {canStop && <button className="run-presence-stop" type="button" disabled={state !== 'available'}
                title={state === 'confirming' ? uiAttribute('正在确认停止结果') : uiAttribute('停止{0}的本次执行', name)}
                aria-label={state === 'stopping' ? uiAttribute('正在提交停止请求…') : state === 'confirming'
                  ? uiAttribute('正在确认停止结果') : uiAttribute('停止{0}的本次执行', name)}
                aria-busy={state === 'stopping' || state === 'confirming' || undefined}
                onClick={event => { stopTrigger.current = event.currentTarget; setStopId(run.id) }}>
                <ExecutionStopIcon />
              </button>}
              {canRetry &&
                <ContinueAgentRunButton threadId={snapshot.thread.id} agentRunId={run.id} appearance="retry"
                  onError={onError} onApplied={() => setContinuedRunIds(current => new Set(current).add(run.id))} />}
            </div>
          </div>
        </article>
      })}
    </div>}
    <Dialog.Root open={stopId !== null} onOpenChange={open => { if (!open && !submitting.current) setStopId(null) }}>
      <AppDialogContent className="run-presence-stop-dialog" onCloseAutoFocus={event => {
        event.preventDefault()
        if (stopTrigger.current?.isConnected) stopTrigger.current.focus()
      }} onEscapeKeyDown={event => { if (submitting.current) event.preventDefault() }}
        onPointerDownOutside={event => { if (submitting.current) event.preventDefault() }}>
        <AppDialogHeader title={uiAttribute('停止这次执行？')}
          description={uiAttribute('只停止{0}的这次执行，已经发送的消息会保留。', target ? memberName(target) : '')}
          closeDisabled={submittingId !== null} />
        <AppDialogFooter>
          <button className="quiet-button" data-dialog-autofocus disabled={submittingId !== null} onClick={() => setStopId(null)}>{uiAttribute('取消')}</button>
          <button className="danger-button" disabled={!canConfirm || submittingId !== null} onClick={() => void confirmStop()}>
            {uiAttribute(submittingId ? '正在提交停止请求…' : '停止执行')}
          </button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog.Root>
  </>
}

function RunPresenceOpen({ threadId, run, name, description, windowedEvidence, events, stopping, onOpen, onOpenMotionSettings }: {
  threadId: string
  run: AgentRunView
  name: string
  description: string
  windowedEvidence: boolean
  events?: LiveRuntimeEvent[]
  stopping: boolean
  onOpen(agentId: string, trigger: HTMLButtonElement, options: { runId: string }): void
  onOpenMotionSettings?(): void
}): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null)
  const restoreFocusOnClose = useRef(false)
  const menuId = useId()
  const menu = useNavigationPressMenu(Boolean(onOpenMotionSettings))
  const tail = useExecutionWindow(windowedEvidence && run.status === 'running', threadId, run, events, null, true)
  const progress = useMemo(() => {
    // Reconcile evidence by identity/revision before projecting a line. A late
    // restored page must not replace newer live text or a newly started command.
    const merged = groupExecutionEventsByRunId([{ id: run.id }], tail.evidence, windowedEvidence ? events?.slice(-48) ?? [] : events ?? [])
    return buildLiveExecutionProgress(merged.get(run.id) ?? [], run.id, { includePublicResults: false })
  }, [tail.evidence, events, run.id, windowedEvidence])
  const preview = runPresencePreview(run, progress)
  const running = run.status === 'running' && !run.cancelRequestedAt && !stopping
  const button = <button ref={trigger} {...menu.rowProps} className={`run-presence-open is-${preview.kind}`} type="button" data-preview-kind={preview.kind}
    title={uiAttribute('查看执行过程')} aria-label={`${name}，${preview.text}，${description}`}
    aria-expanded={onOpenMotionSettings ? menu.open : undefined} aria-controls={menu.open ? menuId : undefined}
    onClick={event => onOpen(run.agentId, event.currentTarget, { runId: run.id })}>
    {!running && <span className={`run-presence-status is-${run.status}`} aria-hidden="true"><ExecutionStatusGlyph status={run.status} /></span>}
    {preview.iconKind && <ToolCallIcon iconKind={preview.iconKind} />}
    <RunningText className={`run-presence-preview is-${preview.kind}`} text={preview.text} active={running} />
  </button>
  if (!onOpenMotionSettings) return button
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
        <DropdownMenu.Separator className="sidebar-action-menu-separator" />
        <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={onOpenMotionSettings}>
          <NavigationIcon name="sun-moon" /><span>{uiAttribute('减少动态效果…')}</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
