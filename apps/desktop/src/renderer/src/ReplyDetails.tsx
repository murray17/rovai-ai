import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { AgentProfile, ThreadMessageView, ThreadSnapshot } from '@contracts'
import { CurrentUserAvatar, useCurrentUserProfile } from './CurrentUserProfile'
import { MemberAvatar } from './MemberAvatar'
import { CopyIcon } from './CopyIcon'
import { RunPresenceOpen } from './ConversationRunPresence'
import { conversationRunPresenceTimeline } from './conversation-run-presence'
import { splitterScale, useCollapsibleSplitter } from './useCollapsibleSplitter'
import { SplitterFeedback } from './SplitterFeedback'
import { uiAttribute, useInterfaceLanguage } from './interface-language'
import type { LiveRuntimeEvent } from './ui-model'
import type { ReplyReaderState, ThreadReplyReader } from './thread-reply-reader'
import './reply-details.css'

export function ReplyDetails({ state, reader, width, full, onWidth, onFull, onClose, onReveal,
  snapshot, profiles, eventsByRunId, windowedEvidence, onOpenExecution, author, renderBody, renderActions, onCopy, onError }: {
  state: ReplyReaderState
  reader: ThreadReplyReader
  width: number
  full: boolean
  onWidth(width: number): void
  onFull(): void
  onClose(): void
  onReveal(messageId: string): void
  snapshot: ThreadSnapshot
  profiles: readonly AgentProfile[]
  eventsByRunId: ReadonlyMap<string, LiveRuntimeEvent[]>
  windowedEvidence: boolean
  onOpenExecution(agentId: string, trigger: HTMLButtonElement, options: { runId: string }): void
  author(message: ThreadMessageView): string
  renderBody(message: ThreadMessageView): ReactNode
  renderActions?(message: ThreadMessageView, copy: {copied: boolean; run(): void}): ReactNode
  onCopy(message: ThreadMessageView): Promise<void>
  onError(error: unknown): void
}): React.JSX.Element {
  useInterfaceLanguage()
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const { profile } = useCurrentUserProfile()
  const [copied, setCopied] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [maximum, setMaximum] = useState(740)
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
    return () => { if (copyTimer.current) clearTimeout(copyTimer.current) }
  }, [])
  useEffect(() => {
    const parent = panel.current?.parentElement
    if (!parent) return
    const measure = (): void => setMaximum(Math.max(360, Math.min(740, parent.clientWidth * .58)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])
  const splitter = useCollapsibleSplitter({ size: Math.min(width, maximum), collapsed: false,
    minimum: 360, maximum, direction: -1, disabled: full, scopeKey: snapshot.thread.id,
    scale: () => splitterScale(panel.current), capture: () => width,
    onPreview: onWidth, onCommit: onWidth, onCancel: onWidth,
    onCollapse: before => { onWidth(before); onClose() } })
  const firstId = state.page?.messages[0]?.id
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }) }, [firstId, state.messageId])
  const member = (id: string) => snapshot.members.find(value => value.agentId === id)
  const avatar = (id: string, name: string) => <MemberAvatar agentId={id} displayName={name}
    avatarRef={profiles.find(value => value.agentId === id)?.avatarRef ?? null} size="workspace" decorative />
  const runs = snapshot.agentRuns.filter(run => !state.page?.hasLater && (run.status === 'running' || run.status === 'waiting')
    && run.invocationKind !== 'single_chat' && run.anchorMessageId
    && state.page?.runAnchorMessageIds.includes(run.anchorMessageId))
  const timeline = conversationRunPresenceTimeline((state.page?.messages ?? []).map(message => ({
    kind: 'camp_message' as const, id: message.id, createdAt: message.createdAt, message, runtimeImageGroups: []
  })), runs)
  const copy = async (message: ThreadMessageView): Promise<void> => {
    try {
      await onCopy(message)
      setCopied(message.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(null), 1600)
    } catch (error) { onError(error) }
  }
  return <aside ref={panel} className="reply-detail-panel" tabIndex={-1} role="region" aria-labelledby={titleId}>
    <div className="reply-detail-resize" role="separator" aria-orientation="vertical"
      aria-label={uiAttribute('调整回复详情宽度')} aria-valuemin={splitter.active ? 0 : 360} aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(Math.min(width, maximum))} tabIndex={0} {...splitter.handlers}
      onKeyDown={event => {
        if (splitter.active || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
        event.preventDefault()
        onWidth(event.key === 'Enter' ? Math.min(466, maximum) : event.key === 'Home' ? 360 : event.key === 'End' ? maximum
          : Math.max(360, Math.min(maximum, width + (event.key === 'ArrowLeft' ? 24 : -24))))
      }}><SplitterFeedback phase={splitter.phase} target={splitter.target} label={uiAttribute('继续拖动收起回复详情')} /></div>
    <header className="reply-detail-header">
      <strong id={titleId}>{uiAttribute('回复详情')}</strong>
      {state.page?.sourceAvailable && <span className="reply-detail-count">{uiAttribute('{0} 条回复', state.page.replyCount)}</span>}
      <button type="button" className="reply-detail-icon reply-detail-expand" onClick={onFull}
        aria-label={full ? uiAttribute('退出完整阅读') : uiAttribute('完整阅读')} title={full ? uiAttribute('退出完整阅读') : uiAttribute('完整阅读')}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d={full ? 'M3 8h5V3m4 0v5h5M3 12h5v5m4 0v-5h5' : 'M8 3H3v5m9-5h5v5M3 12v5h5m4 0h5v-5'} /></svg>
      </button>
      <button type="button" className="reply-detail-icon" onClick={onClose} aria-label={uiAttribute('关闭回复详情')} title={uiAttribute('关闭回复详情')}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
      </button>
    </header>
    <div ref={scroll} className="reply-detail-scroll" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' && !state.page && <div className="reply-detail-status" role="status">{uiAttribute('正在加载回复…')}</div>}
      {state.status === 'error' && <div className="reply-detail-status" role="alert">
        <span>{uiAttribute('回复暂时无法加载')}</span><button className="quiet-button compact" type="button" onClick={reader.retry}>{uiAttribute('重试')}</button>
      </div>}
      {state.page && !state.page.sourceAvailable && <div className="reply-detail-status">{uiAttribute('消息当前不可用')}</div>}
      {state.page?.hasEarlier && <button className="reply-detail-page" type="button" disabled={state.status === 'loading'} onClick={() => reader.page(true)}>{uiAttribute('查看较早回复')}</button>}
      {timeline.map(item => {
        if (item.kind === 'run_presence') {
          const { run, continuation } = item.slot
          const name = member(run.agentId)?.displayName ?? run.agentId
          return <article className={`reply-detail-message reply-detail-run${continuation ? ' is-continuation' : ''}`} key={item.id}>
            {!continuation && avatar(run.agentId, name)}
            <div className="reply-detail-content">
              {!continuation && <div className="reply-detail-meta"><strong>{name}</strong></div>}
              <div className="run-presence-line"><RunPresenceOpen threadId={snapshot.thread.id} run={run} name={name}
                description={uiAttribute('查看执行过程')} windowedEvidence={windowedEvidence} events={eventsByRunId.get(run.id)}
                stopping={false} onOpen={onOpenExecution} /></div>
            </div>
          </article>
        }
        if (item.kind !== 'camp_message') return null
        const message = item.message
        const name = author(message)
        return <article className="reply-detail-message" data-reply-message-id={message.id} key={message.id}>
          {message.authorType === 'agent' ? avatar(message.authorId, name) : <CurrentUserAvatar profile={profile} className="local-message-avatar" />}
          <div className="reply-detail-content">
            <div className="reply-detail-meta"><strong>{name}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
            {message.replyParentDeleted && <p className="reply-detail-deleted-reference">{uiAttribute('原消息已删除')}</p>}
            {message.withdrawn ? <p className="reply-detail-status">{uiAttribute('消息已撤回')}</p> : renderBody(message)}
            <div className="reply-detail-actions">
              {renderActions?.(message, { copied: copied === message.id, run: () => void copy(message) }) ?? (!message.withdrawn && <button type="button" className="reply-detail-icon" aria-label={copied === message.id ? uiAttribute('已复制') : uiAttribute('复制')}
                title={copied === message.id ? uiAttribute('已复制') : uiAttribute('复制')} onClick={() => void copy(message)}><CopyIcon copied={copied === message.id} /></button>)}
              <button type="button" className="reply-detail-icon" aria-label={uiAttribute('回到原文')} title={uiAttribute('回到原文')} onClick={() => onReveal(message.id)}>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4v12m12-6H7m4-4-4 4 4 4" /></svg>
              </button>
            </div>
          </div>
        </article>
      })}
      {state.page?.hasLater && <button className="reply-detail-page" type="button" disabled={state.status === 'loading'} onClick={() => reader.page(false)}>{uiAttribute('查看较新回复')}</button>}
    </div>
  </aside>
}
