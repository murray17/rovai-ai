import { useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { currentUserDisplayName, type AgentRunView, type ThreadMessageView, type ThreadSnapshot } from '@contracts'
import { CurrentUserAvatar, useCurrentUserProfile } from './CurrentUserProfile'
import { MemberAvatar } from './MemberAvatar'
import { MessageQuotePreview, ReplyMark } from './MessageQuotePreview'
import { uiAttribute } from './interface-language'
import { messageClockTime } from './ui-model'

/** References describe frozen Run inputs, independently of the row's timeline anchor. */
export function ConversationRunSource({ run, messages, members, text, loading, unavailable, error, onReveal }: {
  run: AgentRunView
  messages: ReadonlyMap<string, ThreadMessageView>
  members: ThreadSnapshot['members']
  text(message: ThreadMessageView): string
  loading: string | null
  unavailable: ReadonlySet<string>
  error: string | null
  onReveal(messageId: string): void
}): React.JSX.Element {
  const { profile } = useCurrentUserProfile()
  const [open, setOpen] = useState(false)
  const navigating = useRef(false)
  const ids = [...new Set(run.inputMessageIds ?? [])]
  const first = ids[0]
  const message = run.inputPreviews?.[first]?.deleted ? undefined : messages.get(first)
  const author = (source: ThreadMessageView): string => source.authorType === 'agent'
    ? members.find(member => member.agentId === source.authorId)?.displayName ?? source.authorId
    : source.authorType === 'system' ? uiAttribute('系统') : currentUserDisplayName(profile)
  const summary = (source: ThreadMessageView): string => text(source).trim()
    || source.attachments.map(attachment => attachment.displayName).join('、') || uiAttribute('此消息没有文本。')
  const missing = (id: string): boolean => Boolean(run.inputPreviews?.[id]?.deleted)
    || unavailable.has(id) || Boolean(messages.get(id)?.withdrawn)
  const unavailableLabel = (id: string): string => run.inputPreviews?.[id]?.deleted
    ? uiAttribute('原消息已删除') : uiAttribute('原消息不可用')
  const inputSummary = (id: string, source?: ThreadMessageView): string => {
    const frozen = run.inputPreviews?.[id]
    if (frozen) return frozen.summary || uiAttribute('消息内容尚未载入')
    if (source) return summary(source)
    return (id === first && run.inputSummary?.trim()) || uiAttribute('消息内容尚未载入')
  }
  const staticLabel = !first ? uiAttribute('来源未记录') : missing(first) ? unavailableLabel(first) : null
  return <div className="run-source-reference" aria-busy={ids.includes(loading ?? '') || undefined}>
    {staticLabel ? <span className="reply-parent-quote is-static"><ReplyMark /><span>{staticLabel}</span></span>
      : <MessageQuotePreview authorLabel={message ? author(message) : uiAttribute('原消息')}
          body={loading === first ? uiAttribute('正在读取原消息…') : error === first ? uiAttribute('原消息读取失败，重试')
            : inputSummary(first,message)}
          onReveal={() => { if (loading !== first) onReveal(first) }} />}
    {ids.length > 1 && <Popover.Root modal={false} open={open} onOpenChange={value => {
      if (value) navigating.current = false
      setOpen(value)
    }}>
      <Popover.Trigger asChild>
        <button type="button" className="execution-batch-count"
          aria-label={uiAttribute('查看本次执行的 {0} 条原消息', String(ids.length))}
          title={uiAttribute('{0} 条原消息', String(ids.length))}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 17l10 5 10-5" /></svg>
          <span>{ids.length}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="compact-menu execution-input-popover run-source-popover" side="bottom" align="end"
          sideOffset={6} collisionPadding={12} aria-label={uiAttribute('本次执行的原消息')}
          onCloseAutoFocus={event => { if (navigating.current) event.preventDefault() }}>
          <div className="execution-input-popover-heading"><strong>{uiAttribute('{0} 条原消息', String(ids.length))}</strong></div>
          <ol className="execution-input-list">
            {ids.map(id => {
              const source = run.inputPreviews?.[id]?.deleted ? undefined : messages.get(id)
              const member = source?.authorType === 'agent' ? members.find(item => item.agentId === source.authorId) : null
              const label = source ? author(source) : uiAttribute('原消息')
              return <li key={id}>
                {source?.authorType === 'agent'
                  ? <MemberAvatar agentId={source.authorId} avatarRef={member?.avatarRef ?? null} displayName={label} size="execution" decorative />
                  : source ? <CurrentUserAvatar profile={profile} className="execution-input-user" />
                    : <span className="execution-input-placeholder" aria-hidden="true"><ReplyMark /></span>}
                <div>
                  <div><strong>{label}</strong>{source && <time>{messageClockTime(source.createdAt)}</time>}
                    {!run.inputPreviews?.[id]?.deleted && <button type="button" disabled={missing(id) || loading === id} onClick={() => {
                      navigating.current = true
                      setOpen(false)
                      onReveal(id)
                    }}>{uiAttribute(loading === id ? '正在读取原消息…' : error === id ? '重试' : '定位原消息')}</button>}
                  </div>
                  <p>{missing(id) ? unavailableLabel(id) : inputSummary(id,source)}</p>
                </div>
              </li>
            })}
          </ol>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>}
  </div>
}
