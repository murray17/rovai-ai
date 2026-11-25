import { useEffect, useRef, useState } from 'react'
import type { ChatOpenResult, ResolvedTheme } from '@contracts'
import type { ThreadClient } from './camp-client'
import { MemberAvatar } from './MemberAvatar'
import { MessageMarkdown } from './MessageMarkdown'
import { uiAttribute } from './interface-language'

export function ChatWorkspace({ client, chatId, theme, onRead }: {
  client: ThreadClient
  chatId: string
  theme: ResolvedTheme
  onRead(chatId: string, sequence: number): void
}): React.JSX.Element {
  const [detail, setDetail] = useState<ChatOpenResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, refresh] = useState(0)
  const [before, setBefore] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  const lastSeen = useRef(-1)
  useEffect(() => {
    const update = () => refresh(value => value + 1)
    const stop = client.onEvent?.(event => {
      if (event.method === 'chats.listChanged' && (event.params as {chatId?: string})?.chatId === chatId) update()
    })
    const stopWeb = client.onInvalidated?.(change => { if (!change || change.resync || change.chatsChanged) update() })
    return () => { stop?.(); stopWeb?.() }
  }, [client, chatId])
  useEffect(() => {
    let current = true
    void client.request<ChatOpenResult>('chats.open', {chatId, beforeSequence: before}).then(value => {
      if (current) { setDetail(value); setFailed(false) }
    }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [client, chatId, before, revision])
  useEffect(() => {
    if (!detail || !root.current || !('IntersectionObserver' in window)) return
    const visible = new Set<Element>()
    const record = () => {
      if (document.visibilityState !== 'visible') return
      for (const element of visible) {
        const sequence = Number(element.getAttribute('data-reply-sequence'))
        if (sequence > lastSeen.current) {
          lastSeen.current = sequence
          onReadRef.current(chatId,sequence)
        }
      }
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target)
        else visible.delete(entry.target)
      }
      record()
    })
    root.current.querySelectorAll('[data-reply-sequence]').forEach(item => observer.observe(item))
    document.addEventListener('visibilitychange',record)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange',record) }
  }, [detail, chatId])
  return <div className="chat-workspace-messages" ref={root}>
    {failed && <button className="quiet-button" type="button" onClick={() => refresh(value => value+1)}>{uiAttribute('重新读取聊天')}</button>}
    {detail && <>
      <header className="chat-workspace-header"><MemberAvatar agentId={detail.chat.agentId} avatarRef={detail.chat.avatarRef} displayName={detail.chat.displayName} size="execution" decorative/><h1>{detail.chat.title}</h1></header>
      {detail.nextBeforeSequence !== null && <button type="button" className="quiet-button" onClick={() => setBefore(detail.nextBeforeSequence)}>{uiAttribute('更早的消息')}</button>}
      {before !== null && <button type="button" className="quiet-button" onClick={() => setBefore(null)}>{uiAttribute('最新消息')}</button>}
      {detail.messages.map(message => <article className={message.authorType === 'user' ? 'single-chat-user-message' : 'single-chat-agent-message'}
        key={message.id} data-reply-sequence={detail.runs.some(run => run.finalMessageId === message.id) ? message.sequence : undefined}>
        {message.quotes.map(quote => <blockquote key={quote.quoteId}>{quote.text}</blockquote>)}
        {message.authorType === 'agent' ? <MessageMarkdown theme={theme}>{message.body}</MessageMarkdown> : <p>{message.body}</p>}
        {message.attachments.map(attachment => <span key={attachment.id} className="attachment-name">{attachment.displayName}</span>)}
      </article>)}
    </>}
  </div>
}
