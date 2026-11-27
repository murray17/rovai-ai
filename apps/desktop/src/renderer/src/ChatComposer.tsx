import { useEffect, useMemo, useRef, useState } from 'react'
import type { AdapterKind, ChatOpenResult, ChatSendResult, ComposerDocument } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'
import { loadLocalThreadComposerDraft } from './camp-composer-local-store'
import { composerDocumentToPlainText, emptyComposerDocument } from './composer-document'
import { MessageQuotes, MessageQuoteSelectionToolbar } from './MessageQuotes'
import { AttachmentCard } from './AttachmentCard'
import { ComposerPrimaryAction } from './ComposerPrimaryAction'
import { ChatQueue } from './ChatQueue'
import {
  chatDraftKey,
  chatInputFromDocument,
  consumeChatDraft,
  forkConflictedChat,
  saveChatExtras,
  type ChatDraftExtras,
  newChatDraftId,
  readChatDraft,
  saveChatDraft
} from './chat-draft'
import { StructuredMentionComposer, type StructuredMentionComposerHandle } from './StructuredMentionComposer'
import { ComposerDeliveryAction } from './ComposerDeliveryAction'
import { useChatSkills } from './useChatSkills'
import { uiAttribute } from './interface-language'
import { chatDraftRecovery, requestChatDraftCommand } from './chat-draft-recovery'
import { reportOperationFailure } from './operation-failure'
import { attachmentErrorMessage } from './ThreadWorkspace'
import { useComposerSendShortcut } from './ShortcutProvider'
import { revealPrivateQuote } from './message-quote-reveal'

export function ChatComposer({
  client,
  chatId,
  agentId,
  name,
  runtime,
  detail,
  onSent
}: {
  client: ThreadClient
  chatId: string | null
  agentId: string
  name: string
  runtime: AdapterKind | null
  detail: ChatOpenResult | null
  onSent(result: ChatSendResult): void
}) {
  const [draftId, setDraftId] = useState(() => (chatId ? '' : newChatDraftId(agentId)))
  const key = chatDraftKey(agentId, chatId, draftId)
  const initial = useMemo(() => readChatDraft(key), [key])
  const [content, setContent] = useState(initial)
  const [extras, setExtras] = useState<ChatDraftExtras>(() => {
    const draft = loadLocalThreadComposerDraft(key)
    return { attachments: draft?.attachments ?? [], quotes: draft?.quotes ?? [] }
  })
  const filePicker = useRef<HTMLInputElement>(null)
  const [editingQueue, setEditingQueue] = useState(false)
  const [preparing, setPreparing] = useState(false)
  function changeExtras(next: ChatDraftExtras) {
    saveChatExtras(key, next)
    setExtras(next)
  }
  async function attach(files: File[]) {
    if (locked || !files.length) return
    setPreparing(true)
    const attachments = [...extras.attachments]
    try {
      for (const file of files) {
        if (attachments.length >= 10) {
          setError(uiAttribute('最多可添加 10 个附件'))
          break
        }
        const source = await client.composerAttachments.prepare(
          key,
          loadLocalThreadComposerDraft(key)?.revision ?? 1,
          file
        )
        attachments.push(source)
        changeExtras({ ...extras, attachments: [...attachments] })
      }
    } catch (failure) {
      setError(attachmentErrorMessage(failure))
    } finally {
      setPreparing(false)
    }
  }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'start' | 'steer'>('steer')
  const handle = useRef<StructuredMentionComposerHandle>(null)
  const persistenceError = useRef<Error | null>(null)
  const sending = useRef(false)
  const mounted = useRef(true)
  const attempt = useRef<{ signature: string; commandId: string } | null>(null)
  const active = detail?.runs.find((run) => ['queued', 'running', 'waiting'].includes(run.status))
  const skills = useChatSkills(client, agentId, runtime)
  useEffect(() => {
    mounted.current = true
    if (!chatId) handle.current?.focus('end')
    return () => {
      mounted.current = false
    }
  }, [chatId])
  const shortcut = useComposerSendShortcut()
  function syncLocalDraft() {
    const draft = loadLocalThreadComposerDraft(key)
    const value = draft?.content ?? emptyComposerDocument()
    setExtras({ attachments: draft?.attachments ?? [], quotes: draft?.quotes ?? [] })
    handle.current?.replaceDocument(value)
    setContent(value)
  }
  const body = composerDocumentToPlainText(content)
  async function submit() {
    if (sending.current || editingQueue || preparing || checking || !handle.current) return
    sending.current = true
    setBusy(true)
    setError('')
    let submitted = content
    try {
      const { document } = await handle.current.flush({ forSubmission: true })
      submitted = document
      const input = chatInputFromDocument(document)
      if (!input.body.trim() && !extras.attachments.length && !extras.quotes.length) return
      const steer = Boolean(active && detail?.activeInput?.canSteer && mode === 'steer')
      const command = {
        ...(chatId ? { chatId } : { draftId, agentId }),
        ...input,
        quotes: extras.quotes,
        sourceAttachments: extras.attachments.map((source) => ({
          id: source.id,
          sourcePath: source.sourcePath,
          displayName: source.displayName,
          kind: source.kind,
          mediaType: source.mediaType,
          observedByteSize: source.byteSize,
          ...(source.pastedTextPreview ? { pastedTextPreview: source.pastedTextPreview } : {})
        })),
        ...(steer && active
          ? { mode: 'steer', runId: active.runId, executionEpoch: active.executionEpoch }
          : { mode: 'start' })
      }
      const signature = JSON.stringify(command)
      if (attempt.current?.signature !== signature) attempt.current = { signature, commandId: newCommandId() }
      const params = { commandId: attempt.current.commandId, command }
      const result = await requestChatDraftCommand<ChatSendResult>(client, 'chats.send', params)
      consumeChatDraft(key, document, agentId, draftId, !chatId, extras)
      if (chatId) client.chatDraftRecovery?.finish(chatId, params.commandId)
      attempt.current = null
      if (mounted.current) {
        syncLocalDraft()
        onSent(result)
      }
    } catch (failure) {
      if (!mounted.current) return
      if (
        !chatId &&
        (String(failure).includes('idempotency_conflict') ||
          (failure as { code?: string })?.code === 'COMMAND_IDEMPOTENCY_CONFLICT')
      ) {
        const next = forkConflictedChat(agentId, draftId)
        if (next !== draftId) {
          saveChatDraft(chatDraftKey(agentId, null, next), submitted)
          saveChatExtras(chatDraftKey(agentId, null, next), extras)
          setDraftId(next)
        }
        setError(uiAttribute('这份草稿已在其他窗口发送。当前输入已保留，可另开话题发送。'))
      } else {
        setError(reportOperationFailure('chat.send', failure).message)
      }
    } finally {
      sending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const empty = !body.trim() && !extras.attachments.length && !extras.quotes.length
  const [checking, setChecking] = useState(() => Boolean(chatId && chatDraftRecovery.has(chatId)))
  const [recoveryNotice, setRecoveryNotice] = useState(false)
  const [recheck, setRecheck] = useState(0)
  useEffect(() => {
    if (!chatId || !chatDraftRecovery.has(chatId)) {
      setChecking(false)
      setRecoveryNotice(false)
      return
    }
    let current = true
    setChecking(true)
    void chatDraftRecovery.restore(chatId, client.request).then(({ changed, deferred }) => {
      if (!current) return
      if (changed || deferred) syncLocalDraft()
      setRecoveryNotice(deferred)
    }).catch(() => { if (current) setRecoveryNotice(true) })
      .finally(() => { if (current) setChecking(false) })
    return () => { current = false }
  }, [chatId, client, empty, recheck])
  const locked = busy || preparing || editingQueue || checking
  async function stop() {
    if (!chatId || !active || locked) return
    setBusy(true)
    try {
      await client.request('agentRuns.cancel', {
        commandId: newCommandId(),
        command: {
          chatId,
          agentRunId: active.runId,
          executionEpoch: active.executionEpoch,
          expectedVersion: active.version
        }
      })
    } catch (failure) {
      setError(reportOperationFailure('run.stop', failure).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="chat-composer-dock">
      {chatId && detail && (
        <MessageQuoteSelectionToolbar
          ownerKey={'single_chat:' + chatId}
          messages={detail.messages}
          disabled={locked}
          onAdd={async (selection) => {
            const message = detail.messages.find((item) => item.id === selection.messageId)
            const quote = {
              version: 1 as const,
              quoteId: newCommandId(),
              format: 'plain_text' as const,
              text: selection.text,
              capturedAt: new Date().toISOString(),
              ...(message
                ? {
                    source: { scope: 'chat' as const, conversationId: chatId, messageId: message.id },
                    authorAtCapture:
                      message.authorType === 'user'
                        ? { type: 'user' as const, displayName: uiAttribute('用户') }
                        : { type: 'agent' as const, agentId, displayName: name }
                  }
                : {})
            }
            if ([...extras.quotes, quote].reduce((n, q) => n + Array.from(q.text).length, 0) > 12000)
              throw new Error('quote.limit_exceeded')
            changeExtras({ ...extras, quotes: [...extras.quotes, quote] })
            handle.current?.focus('end')
          }}
        />
      )}
      {recoveryNotice && (
        <div className="chat-draft-restore" role="status">
          <span>{uiAttribute('当前草稿已保留。处理后可取回待恢复的输入。')}</span>
          <button className="quiet-button" type="button" disabled={checking} onClick={() => setRecheck(value => value + 1)}>
            {uiAttribute('取回')}
          </button>
        </div>
      )}
      {chatId && detail && (
        <ChatQueue
          items={detail.pendingInputs}
          client={client}
          chatId={chatId}
          canEdit={!locked && empty}
          onEditing={setEditingQueue}
          onRestore={(applied) => {
            setRecoveryNotice(!applied)
            syncLocalDraft()
            handle.current?.focus('end')
          }}
          onError={setError}
        />
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div
          className="composer-box"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files.length) {
              event.preventDefault()
              void attach([...event.dataTransfer.files])
            }
          }}
        >
          <MessageQuotes quotes={extras.quotes} disabled={locked} onReveal={revealPrivateQuote}
            onEmptyFocus={() => handle.current?.focus('end')}
            onMutate={async (action) => {
              if (action.type === 'remove')
                changeExtras({ ...extras, quotes: extras.quotes.filter(quote => quote.quoteId !== action.quoteId) })
            }} />
          {extras.attachments.length > 0 && (
            <div className="composer-attachment-strip">
              {extras.attachments.map((file) => (
                <AttachmentCard
                  key={file.id}
                  attachment={file}
                  disabled={locked}
                  locator={{ owner: 'composer', threadId: key, attachmentRefId: file.id }}
                  onRemove={() =>
                    changeExtras({ ...extras, attachments: extras.attachments.filter((f) => f.id !== file.id) })
                  }
                />
              ))}
            </div>
          )}
          <div className="composer-input">
            <StructuredMentionComposer
              ref={handle}
              id="independent-chat-input"
              draftIdentity={key}
              document={initial}
              members={[]}
              referenceScope={{ client, threadId: '', projectBound: false }}
              purpose="chat"
              onPasteFiles={(files) => void attach(files)}
              {...skills}
              ariaLabel={uiAttribute('给 {0} 发消息', name)}
              placeholder={uiAttribute('给 {0} 发消息', name)}
              disabled={locked}
              onEffectiveDocumentChange={setContent}
              getAuthoritativeDraft={() => loadLocalThreadComposerDraft(key)}
              persistDocument={async () => {
                if (persistenceError.current) throw persistenceError.current
              }}
              onDocumentChange={(value) => {
                try {
                  saveChatDraft(key, value)
                  persistenceError.current = null
                } catch (failure) {
                  persistenceError.current = failure instanceof Error ? failure : new Error(String(failure))
                  setError(persistenceError.current.message)
                }
              }}
              onPersistenceErrorChange={(value) => {
                if (value) setError(value.message)
              }}
              onSubmit={submit}
            />
          </div>
          <div className="composer-action-row">
            <div className="composer-tools">
              <input
                type="file"
                multiple
                hidden
                ref={filePicker}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  event.target.value = ''
                  void attach(files)
                }}
              />
              <button
                type="button"
                className="composer-attachment-button"
                disabled={locked}
                aria-label={uiAttribute('添加附件')}
                onClick={() => filePicker.current?.click()}
              >
                <svg
                  viewBox="0 0 20 20"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <path d="m7 12 5.7-5.7a2 2 0 0 1 2.8 2.8l-7 7a3.6 3.6 0 0 1-5.1-5.1L11 3.4" />
                </svg>
              </button>
            </div>
            <div className="composer-actions">
              {!(active && empty) && <span className="composer-hint">
                <span className="sr-only">{uiAttribute('{0} 发送，Shift+Enter 换行', shortcut?.label ?? 'Enter')}</span>
                <span className="composer-hint-visual" aria-hidden="true">
                  <kbd>{shortcut?.aria && shortcut.aria !== 'Enter' ? shortcut.label : '↵'}</kbd>
                  <span>{uiAttribute('发送')}</span><span className="composer-hint-separator">·</span>
                  <kbd>⇧↵</kbd><span>{uiAttribute('换行')}</span>
                </span>
              </span>}
              {active && empty ? (
                <ComposerPrimaryAction
                  action="stop"
                  type="button"
                  busy={busy}
                  disabled={locked}
                  onClick={() => void stop()}
                />
              ) : (
                <ComposerDeliveryAction
                  type="submit"
                  action="send"
                  mode={mode}
                  onModeChange={setMode}
                  busy={busy}
                  disabled={locked || empty}
                  plans={
                    active
                      ? [
                          {
                            agentId,
                            name,
                            target: { agentRunId: active.runId, executionEpoch: active.executionEpoch },
                            canSteer: Boolean(detail?.activeInput?.canSteer),
                            reason: detail?.activeInput?.unavailableReason,
                            route: detail?.activeInput?.canSteer && mode === 'steer' ? 'steer' : 'queue'
                          }
                        ]
                      : []
                  }
                />
              )}
            </div>
          </div>
        </div>
        {error && (
          <div className="single-chat-error" role="alert">
            {error}
          </div>
        )}
      </form>
    </div>
  )
}
