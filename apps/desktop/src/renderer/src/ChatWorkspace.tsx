import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  AgentProfile,
  AgentRunExecutionWindowPage,
  AgentRunExecutionWindowChanges,
  AgentRunExecutionEvidenceView,
  ChatOpenResult,
  ChatSendResult,
  ChatSupplement,
  ResolvedTheme,
  SingleChatMessageView
} from '@contracts'
import type { ThreadClient } from './camp-client'
import { MemberAvatar } from './MemberAvatar'
import { FilePreviewPane } from './FilePreviewPane'
import { useOptionalFilePreview } from './file-preview-context'
import { newCommandId } from '../../shared/command-id'
import { ApprovalDock } from './ThreadWorkspace'
import { ChatReply } from './ChatReply'
import { AttachmentCard } from './AttachmentCard'
import { SingleChatRunHistory } from './SingleChatPanel'
import { chatDocumentFromInput } from './chat-draft'
import { InlineThreadReference } from './ThreadReferencePreview'
import { ChatComposer } from './ChatComposer'
import { uiAttribute } from './interface-language'

type Run = ChatOpenResult['runs'][number]
type WindowPage = Omit<AgentRunExecutionWindowPage, 'threadId'> & { chatId: string }
const processing = (status: Run['status']) => ['queued', 'running', 'waiting'].includes(status)

function ChatUserText({ body }: { body: string }) {
  return chatDocumentFromInput(body, []).segments.map((item, i) => {
    if (item.kind === 'text') return item.text
    const atom = item.atom
    if (atom.type === 'thread_reference')
      return (
        <InlineThreadReference
          key={i}
          segment={{
            kind: 'thread_reference',
            threadId: atom.threadId,
            titleAtSend: atom.labelFallback ?? atom.threadId
          }}
        />
      )
    if (atom.type === 'mission_reference')
      return (
        <InlineThreadReference
          key={i}
          segment={{
            kind: 'mission_reference',
            missionId: atom.missionId,
            titleAtSend: atom.labelFallback ?? atom.missionId
          }}
        />
      )
    return null
  })
}

function ChatRound({
  client,
  chatId,
  run,
  final,
  supplements,
  theme,
  visibleMessages,
  latestPage
}: {
  visibleMessages: ReadonlySet<string>
  latestPage: boolean
  theme: ResolvedTheme
  supplements: ChatSupplement[]
  client: ThreadClient
  chatId: string
  run: Run
  final: SingleChatMessageView | null
}) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState<WindowPage | null>(null)
  const latest = useRef<WindowPage | null>(null)
  const [before, setBefore] = useState<number | null>(null)
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  const visible = expanded || processing(run.status)
  useEffect(() => {
    if (!visible || !run.throughChangeSequence) return
    let current = true
    const merge = (existing: AgentRunExecutionEvidenceView[], updates: AgentRunExecutionEvidenceView[]) => {
      const items = new Map(existing.map((item) => [item.id, item]))
      for (const item of updates) items.set(item.id, item)
      return [...items.values()].sort((a, b) => a.sequence - b.sequence)
    }
    const update = async () => {
      let result = latest.current
      if (!result || (before !== null && before === result.nextBeforeSequence)) {
        const next = await client.request<WindowPage>('agentRunExecution.page', {
          chatId,
          agentRunId: run.runId,
          beforeSequence: before
        })
        if (!current) return
        result = {
          ...next,
          throughChangeSequence: result?.throughChangeSequence ?? next.throughChangeSequence,
          evidence: merge(result?.evidence ?? [], [...next.evidence, ...(next.activeEvidence ?? [])])
        }
      }
      while (result.throughChangeSequence < run.throughChangeSequence) {
        const after: number = result.throughChangeSequence
        const changes: AgentRunExecutionWindowChanges = await client.request<AgentRunExecutionWindowChanges>(
          'agentRunExecution.changes',
          { chatId, agentRunId: run.runId, afterChangeSequence: after }
        )
        if (!current) return
        if (changes.nextAfterChangeSequence <= after) break
        result = {
          ...result,
          throughChangeSequence: changes.nextAfterChangeSequence,
          evidence: merge(result.evidence, [...changes.evidence, ...changes.refreshedEvidence])
        }
      }
      latest.current = result
      setPage(result)
      setFailed(false)
    }
    void update().catch(() => {
      if (current) setFailed(true)
    })
    return () => {
      current = false
    }
  }, [client, chatId, run.runId, run.throughChangeSequence, visible, before, retry])
  return (
    <>
      {visible && failed && (
        <button type="button" className="quiet-button" onClick={() => setRetry((value) => value + 1)}>
          {uiAttribute('重新读取执行记录')}
        </button>
      )}
      {visible && page?.hasMore && page.nextBeforeSequence && (
        <button type="button" className="quiet-button" onClick={() => setBefore(page.nextBeforeSequence)}>
          {uiAttribute('更早的步骤')}
        </button>
      )}
      {Array.from({ length: supplements.length + 1 }, (_, index) => {
        const previous = supplements[index - 1]
        const next = supplements[index]
        const showSupplement = previous && (previous.messageId ? visibleMessages.has(previous.messageId) : latestPage)
        const showSegment =
          showSupplement ||
          (!previous && visibleMessages.has(run.triggerMessageId)) ||
          (!next && (final || (latestPage && processing(run.status))))
        if (!showSegment) return null
        const evidence = (page?.evidence ?? []).filter(
          (step) =>
            step.eventType !== 'agent_run.input' &&
            (!previous || step.sequence > previous.evidenceSequence) &&
            (!next || step.sequence < next.evidenceSequence)
        )
        return (
          <Fragment key={previous?.inputId ?? 'initial'}>
            {showSupplement && (
              <div className="single-chat-user-message">
                <div className="single-chat-user-column">
                  <div className="single-chat-user-bubble">
                    {previous.quotes.map((quote) => (
                      <blockquote key={quote.quoteId}>{quote.text}</blockquote>
                    ))}
                    <span
                      data-message-quote-body={previous.messageId ?? undefined}
                      data-quote-owner={previous.messageId ? 'single_chat:' + chatId : undefined}
                    >
                      <ChatUserText body={previous.body} />
                    </span>
                    {previous.attachments.map((file) => (
                      <AttachmentCard
                        key={file.id}
                        attachment={file}
                        locator={
                          previous.messageId
                            ? {
                                owner: 'single_chat_message',
                                threadId: chatId,
                                conversationId: chatId,
                                conversationMessageId: previous.messageId,
                                attachmentRefId: file.id
                              }
                            : {
                                owner: 'single_chat_pending',
                                threadId: chatId,
                                conversationId: chatId,
                                pendingInputId: previous.inputId,
                                attachmentRefId: file.id
                              }
                        }
                      />
                    ))}
                  </div>
                  {previous.unconfirmed && <small>{uiAttribute('未确认送达')}</small>}
                </div>
              </div>
            )}
            {(!next || evidence.length > 0 || !page) && (
              <SingleChatRunHistory
                chatId={chatId}
                threadId={chatId}
                conversationId={chatId}
                onExpand={setExpanded}
                summaryLabel={next ? uiAttribute('插话前的步骤') : undefined}
                privateFinal={
                  !next && final ? (
                    <ChatReply
                      chatId={chatId}
                      messageId={final.id}
                      body={final.body}
                      theme={theme}
                    />
                  ) : undefined
                }
                run={{
                  ...run,
                  id: run.runId,
                  status:
                    next &&
                    !evidence.some(
                      (step) => processing(run.status) && (step.phase === 'started' || step.phase === 'updated')
                    )
                      ? 'succeeded'
                      : run.status,
                  triggerConversationMessageId: run.triggerMessageId,
                  finalConversationMessageId: next ? null : run.finalMessageId,
                  executionEvidenceCount: evidence.length,
                  executionEvidenceChangeSequence: run.throughChangeSequence
                }}
                evidence={evidence}
                finalMessage={next ? null : final}
                now={new Date().toISOString()}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

export function ChatWorkspace({
  client,
  chatId,
  draftAgentId,
  profiles,
  header,
  theme,
  onRead,
  onFirst
}: {
  client: ThreadClient
  chatId: string | null
  draftAgentId: string | null
  profiles: AgentProfile[]
  header: HTMLElement | null
  theme: ResolvedTheme
  onRead(chatId: string, sequence: number): void
  onFirst(chatId: string): void
}) {
  const [detail, setDetail] = useState<ChatOpenResult | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, refresh] = useState(0)
  const [before, setBefore] = useState<number | null>(null)
  const preview = useOptionalFilePreview()
  const root = useRef<HTMLDivElement>(null)
  const followsLatest = useRef(true)
  const transcript = useRef<HTMLDivElement>(null)
  const approvalDock = useRef<HTMLElement>(null)
  const lastSeen = useRef(0)
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  useEffect(() => {
    if (!chatId) return
    const update = () => refresh((value) => value + 1)
    const stop = client.onEvent?.((event) => {
      const changed = (event.params as { chatId?: string })?.chatId
      if (event.method === 'chats.listChanged' && (!changed || changed === chatId)) update()
    })
    const web = client.onInvalidated?.((change) => {
      if (!change || change.resync || change.chatsChanged) update()
    })
    return () => {
      stop?.()
      web?.()
    }
  }, [client, chatId])
  useEffect(() => {
    if (!chatId) return
    let current = true
    void client
      .request<ChatOpenResult>('chats.open', { chatId, beforeSequence: before })
      .then((next) => {
        if (current) {
          setDetail(next)
          setFailed(false)
        }
      })
      .catch(() => {
        if (current) setFailed(true)
      })
    return () => {
      current = false
    }
  }, [client, chatId, before, revision])
  useEffect(() => {
    if (!chatId || !detail || !root.current) return
    const visible = new Set<Element>()
    const record = () => {
      if (document.visibilityState !== 'visible') return
      const latest = Math.max(
        lastSeen.current,
        ...[...visible].map((el) => Number(el.getAttribute('data-reply-sequence')))
      )
      if (latest > lastSeen.current) {
        lastSeen.current = latest
        onReadRef.current(chatId, latest)
      }
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target)
        else visible.delete(entry.target)
      }
      record()
    })
    root.current.querySelectorAll('[data-reply-sequence]').forEach((item) => observer.observe(item))
    document.addEventListener('visibilitychange', record)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', record)
    }
  }, [detail, chatId])
  useLayoutEffect(() => {
    const scroll = root.current
    const content = transcript.current
    if (!scroll || !content || !detail) return
    const follow = () => {
      if (before === null && followsLatest.current) scroll.scrollTop = scroll.scrollHeight
    }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(content)
    return () => observer.disconnect()
  }, [detail, before])
  const activeRunId = detail?.runs.find((run) => processing(run.status))?.runId
  useEffect(() => {
    if (!activeRunId) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh((value) => value + 1)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [activeRunId])
  const id = detail?.chat.agentId ?? draftAgentId
  const profile = profiles.find((item) => item.agentId === id)
  const name = profile?.displayName ?? detail?.chat.displayName
  const avatar = profile?.avatarRef ?? detail?.chat.avatarRef ?? null
  const title = detail?.chat.title ?? uiAttribute(chatId || !id ? '聊天' : '新聊天')
  const byId = new Map(detail?.messages.map((message) => [message.id, message]))
  const visibleMessages = new Set(byId.keys())
  const roundsByMessage = new Map<string, Run>()
  const roundsById = new Map(detail?.runs.map((run) => [run.runId, run]))
  for (const run of roundsById.values()) {
    roundsByMessage.set(run.triggerMessageId, run)
    if (run.finalMessageId) roundsByMessage.set(run.finalMessageId, run)
  }
  for (const input of detail?.supplements ?? []) {
    const run = roundsById.get(input.runId)
    if (run && input.messageId) roundsByMessage.set(input.messageId, run)
  }
  const renderedRounds = new Set<string>()
  function sent(result: ChatSendResult) {
    if (!chatId) onFirst(result.chatId)
    else {
      followsLatest.current = true
      setBefore(null)
      refresh((value) => value + 1)
    }
  }
  return (
    <>
      {header &&
        createPortal(
          <div className="context-breadcrumb workspace-title">
            {id && name && (
              <span className="workspace-title-icon is-avatar" title={name}>
                <MemberAvatar agentId={id} displayName={name} avatarRef={avatar} size="execution" decorative />
              </span>
            )}
            <h1 title={title}>{title}</h1>
          </div>,
          header
        )}
      {preview?.paneVisible && <FilePreviewPane tabsInPane />}
      <div
        className="chat-timeline"
        ref={root}
        onScroll={(event) => {
          const el = event.currentTarget
          followsLatest.current = before === null && el.scrollHeight - el.scrollTop - el.clientHeight < 48
        }}
      >
        {failed && (
          <button type="button" className="quiet-button" onClick={() => refresh((value) => value + 1)}>
            {uiAttribute('重新读取聊天')}
          </button>
        )}
        {!chatId && id && name && (
          <section className="empty-camp-welcome first-run-camp-welcome">
            <div className="first-run-camp-intro">
              <MemberAvatar
                agentId={id}
                displayName={name}
                avatarRef={avatar}
                size="profile"
                className="first-run-camp-avatar"
                decorative
              />
              <div>
                <h2>{uiAttribute('你好，我是{0}。', name)}</h2>
                <p>{uiAttribute('可以直接聊，也可以请我查阅其他对话、建任务或发通知。')}</p>
              </div>
            </div>
          </section>
        )}
        {detail && (
          <div ref={transcript} className="single-chat-transcript independent-chat-transcript">
            {detail.nextBeforeSequence !== null && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  followsLatest.current = false
                  setBefore(detail.nextBeforeSequence)
                  if (root.current) root.current.scrollTop = 0
                }}
              >
                {uiAttribute('更早的消息')}
              </button>
            )}
            {before !== null && (
              <button
                className="quiet-button"
                type="button"
                onClick={() => {
                  followsLatest.current = true
                  setBefore(null)
                }}
              >
                {uiAttribute('最新消息')}
              </button>
            )}
            {detail.messages.map((message) => {
              const run = roundsByMessage.get(message.id)
              if (run && renderedRounds.has(run.runId)) return null
              if (run) renderedRounds.add(run.runId)
              if (!run && message.authorType !== 'user')
                return (
                  <div key={message.id} className="single-chat-final" data-reply-sequence={message.sequence}>
                    <ChatReply
                      theme={theme}
                      chatId={detail.chat.chatId}
                      messageId={message.id}
                      body={message.body}
                    />
                  </div>
                )
              return (
                <div className="single-chat-turn" key={run?.runId ?? message.id}>
                  {(!run || run.triggerMessageId === message.id) && (
                    <div className="single-chat-user-message">
                      <div className="single-chat-user-column">
                        <div className="single-chat-user-bubble">
                          {message.quotes.map((quote) => (
                            <blockquote key={quote.quoteId}>{quote.text}</blockquote>
                          ))}
                          <span
                            data-message-quote-body={message.id}
                            data-quote-owner={'single_chat:' + detail.chat.chatId}
                          >
                            <ChatUserText body={message.body} />
                          </span>
                          {message.attachments.map((item) => (
                            <AttachmentCard
                              key={item.id}
                              attachment={item}
                              locator={{
                                owner: 'single_chat_message',
                                threadId: detail.chat.chatId,
                                conversationId: detail.chat.chatId,
                                conversationMessageId: message.id,
                                attachmentRefId: item.id
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {run && chatId && (
                    <ChatRound
                      latestPage={before === null}
                      visibleMessages={visibleMessages}
                      theme={theme}
                      client={client}
                      chatId={chatId}
                      run={run}
                      supplements={(detail.supplements ?? []).filter((input) => input.runId === run.runId)}
                      final={byId.get(run.finalMessageId ?? '') ?? null}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {chatId && detail && !detail.chat.archivedAt && (
        <ApprovalDock
          approvals={detail.approvals ?? []}
          interactions={detail.nativeInteractions}
          profileById={new Map(profiles.map((profile) => [profile.agentId, profile]))}
          agentRuns={detail.runs.map((r) => ({ id: r.runId, agentId: detail.chat.agentId }))}
          conversationId={chatId}
          busy={false}
          containerRef={approvalDock}
          focusRequest={null}
          focusApprovalId={null}
          onResolve={async (approval, optionId) => {
            const result = await client.request<import('@contracts').StoredCommandResult>('action.approvals.resolve', {
              commandId: newCommandId(),
              chatId,
              approvalId: approval.id,
              expectedVersion: approval.version,
              optionId
            })
            refresh((value) => value + 1)
            if (result.status === 'rejected') throw new Error(result.code)
          }}
          onRespond={async (interaction, answer) => {
            const result = await client.request<import('@contracts').NativeInteractionResult>(
              'nativeInteractions.respond',
              {
                commandId: newCommandId(),
                chatId,
                agentRunId: interaction.agentRunId,
                executionEpoch: interaction.executionEpoch,
                interactionId: interaction.id,
                answer
              }
            )
            refresh((value) => value + 1)
            return result
          }}
        />
      )}
      {id && name && !detail?.chat.archivedAt && (
        <ChatComposer
          client={client}
          chatId={chatId}
          agentId={id}
          name={name}
          runtime={profile?.runtimeConfiguration?.adapterKind ?? null}
          detail={detail}
          onSent={sent}
        />
      )}
    </>
  )
}
