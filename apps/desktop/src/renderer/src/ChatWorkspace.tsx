import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentProfile, AgentRunExecutionWindowPage, ChatOpenResult, ChatSendResult, ResolvedTheme, SingleChatMessageView } from '@contracts'
import type { ThreadClient } from './camp-client'
import { MemberAvatar } from './MemberAvatar'
import { MessageMarkdown } from './MessageMarkdown'
import { SingleChatRunHistory } from './SingleChatPanel'
import { ChatComposer } from './ChatComposer'
import { uiAttribute } from './interface-language'

type Run = ChatOpenResult['runs'][number]
type WindowPage = Omit<AgentRunExecutionWindowPage, 'threadId'> & {chatId:string}
const processing = (status: Run['status']) => ['queued','running','waiting'].includes(status)

function ChatRound({ client, chatId, run, final }: { client: ThreadClient; chatId: string; run: Run; final: SingleChatMessageView | null }) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState<WindowPage | null>(null)
  const [before,setBefore] = useState<number | null>(null)
  const [retry,setRetry] = useState(0)
  const [failed,setFailed] = useState(false)
  const visible = expanded || processing(run.status)
  useEffect(() => {
    if (!visible || !run.throughChangeSequence) return
    let current = true
    void client.request<WindowPage>('agentRunExecution.page', {chatId,agentRunId:run.runId,beforeSequence:before}).then(next => {
      if (!current) return
      setFailed(false)
      setPage(previous => {
        const items = new Map((before ? previous?.evidence ?? [] : []).map(item => [item.id,item]))
        for (const item of [...next.evidence,...(next.activeEvidence ?? [])]) items.set(item.id,item)
        return {...next,evidence:[...items.values()].sort((a,b) => a.sequence-b.sequence)}
      })
    }).catch(() => { if (current) setFailed(true) })
    return () => { current=false }
  },[client,chatId,run.runId,run.throughChangeSequence,visible,before,retry])
  return <div data-reply-sequence={final?.sequence}>
    {visible && failed && <button type="button" className="quiet-button" onClick={() => setRetry(value => value+1)}>{uiAttribute('重新读取执行记录')}</button>}
    {visible && page?.hasMore && page.nextBeforeSequence && <button type="button" className="quiet-button" onClick={() => setBefore(page.nextBeforeSequence)}>{uiAttribute('更早的步骤')}</button>}
    <SingleChatRunHistory threadId={chatId} conversationId={chatId} onExpand={setExpanded}
      run={{...run,id:run.runId,triggerConversationMessageId:run.triggerMessageId,finalConversationMessageId:run.finalMessageId,executionEvidenceCount:page?.evidence.length ?? 0,executionEvidenceChangeSequence:run.throughChangeSequence}}
      evidence={page?.evidence ?? []} finalMessage={final} now={new Date().toISOString()}/>
  </div>
}

export function ChatWorkspace({ client, chatId, draftAgentId, profiles, header, theme, onRead, onFirst }: {
  client: ThreadClient; chatId: string | null; draftAgentId: string | null; profiles: AgentProfile[]; header: HTMLElement | null; theme:ResolvedTheme
  onRead(chatId: string, sequence: number): void; onFirst(chatId:string): void
}) {
  const [detail,setDetail] = useState<ChatOpenResult | null>(null)
  const [failed,setFailed] = useState(false)
  const [revision,refresh] = useState(0)
  const [before,setBefore] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const lastSeen = useRef(0)
  const onReadRef=useRef(onRead)
  onReadRef.current=onRead
  useEffect(() => {
    if (!chatId) return
    const update = () => refresh(value => value+1)
    const stop = client.onEvent?.(event => {
      if (event.method==='chats.listChanged' && (event.params as {chatId?:string})?.chatId===chatId) update()
    })
    const web = client.onInvalidated?.(change => { if (!change || change.resync || change.chatsChanged) update() })
    return () => { stop?.(); web?.() }
  },[client,chatId])
  useEffect(() => {
    if (!chatId) return
    let current=true
    void client.request<ChatOpenResult>('chats.open',{chatId,beforeSequence:before}).then(next => {
      if (current) { setDetail(next); setFailed(false) }
    }).catch(() => { if (current) setFailed(true) })
    return () => { current=false }
  },[client,chatId,before,revision])
  useEffect(() => {
    if (!chatId || !detail || !root.current) return
    const visible=new Set<Element>()
    const record = () => {
      if (document.visibilityState!=='visible') return
      const latest=Math.max(lastSeen.current,...[...visible].map(el => Number(el.getAttribute('data-reply-sequence'))))
      if (latest>lastSeen.current) { lastSeen.current=latest; onReadRef.current(chatId,latest) }
    }
    const observer=new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target) }
      record()
    })
    root.current.querySelectorAll('[data-reply-sequence]').forEach(item => observer.observe(item))
    document.addEventListener('visibilitychange',record)
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange',record) }
  },[detail,chatId])
  const id=detail?.chat.agentId ?? draftAgentId
  const profile=profiles.find(item => item.agentId===id)
  const name=profile?.displayName ?? detail?.chat.displayName
  const avatar=profile?.avatarRef ?? detail?.chat.avatarRef ?? null
  const title=detail?.chat.title ?? uiAttribute(chatId || !id ? '聊天' : '新聊天')
  const runsByTrigger=new Map(detail?.runs.map(run => [run.triggerMessageId,run]))
  const byId=new Map(detail?.messages.map(message => [message.id,message]))
  function sent(result:ChatSendResult) {
    if (!chatId) onFirst(result.chatId)
    else { setBefore(null); refresh(value => value+1) }
  }
  return <>
    {header && createPortal(<div className="context-breadcrumb workspace-title">
      {id && name && <span className="workspace-title-icon is-avatar" title={name}><MemberAvatar agentId={id} displayName={name} avatarRef={avatar} size="execution" decorative/></span>}
      <h1 title={title}>{title}</h1></div>,header)}
    <div className="chat-timeline" ref={root}>
      {failed && <button type="button" className="quiet-button" onClick={() => refresh(value => value+1)}>{uiAttribute('重新读取聊天')}</button>}
      {!chatId && id && name && <section className="empty-camp-welcome first-run-camp-welcome"><div className="first-run-camp-intro">
        <MemberAvatar agentId={id} displayName={name} avatarRef={avatar} size="profile" className="first-run-camp-avatar" decorative/>
        <div><h2>{uiAttribute('你好，我是{0}。',name)}</h2><p>{uiAttribute('可以直接聊，也可以请我查阅其他对话、建任务或发通知。')}</p></div></div></section>}
      {detail && <div className="single-chat-transcript independent-chat-transcript">
        {detail.nextBeforeSequence !== null && <button className="quiet-button" type="button" onClick={() => setBefore(detail.nextBeforeSequence)}>{uiAttribute('更早的消息')}</button>}
        {before !== null && <button className="quiet-button" type="button" onClick={() => setBefore(null)}>{uiAttribute('最新消息')}</button>}
        {detail.messages.map(message => {
          if (message.authorType!=='user') {
            if (detail.runs.some(run => run.finalMessageId===message.id && byId.has(run.triggerMessageId))) return null
            return <div key={message.id} className="single-chat-final" data-reply-sequence={message.sequence}><MessageMarkdown theme={theme}>{message.body}</MessageMarkdown></div>
          }
          const run=runsByTrigger.get(message.id)
          return <div className="single-chat-turn" key={message.id}>
            <div className="single-chat-user-message"><div className="single-chat-user-column"><div className="single-chat-user-bubble">
              {message.quotes.map(quote => <blockquote key={quote.quoteId}>{quote.text}</blockquote>)}
              {message.body}{message.attachments.map(item => <span key={item.id}>{item.displayName}</span>)}
            </div></div></div>
            {run && chatId && <ChatRound client={client} chatId={chatId} run={run} final={byId.get(run.finalMessageId ?? '') ?? null}/>}
          </div>
        })}
      </div>}
    </div>
    {id && name && !detail?.chat.archivedAt && <ChatComposer client={client} chatId={chatId} agentId={id} name={name} runtime={profile?.runtimeConfiguration?.adapterKind ?? null} detail={detail} onSent={sent}/>}
  </>
}
