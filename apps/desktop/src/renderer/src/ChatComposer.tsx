import { useEffect, useRef, useState } from 'react'
import type { AdapterKind, ChatOpenResult, ChatSendResult, ComposerDocument } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import type { ThreadClient } from './camp-client'
import { loadLocalThreadComposerDraft } from './camp-composer-local-store'
import { composerDocumentToPlainText, emptyComposerDocument } from './composer-document'
import { ChatQueue } from './ChatQueue'
import { chatDraftKey, chatInputFromDocument, consumeChatDraft, newChatDraftId, readChatDraft, saveChatDraft } from './chat-draft'
import { StructuredMentionComposer, type StructuredMentionComposerHandle } from './StructuredMentionComposer'
import { ComposerDeliveryAction } from './ComposerDeliveryAction'
import { useChatSkills } from './useChatSkills'
import { uiAttribute } from './interface-language'

export function ChatComposer({ client, chatId, agentId, name, runtime, detail, onSent }: {
  client: ThreadClient; chatId: string | null; agentId: string; name: string; runtime: AdapterKind | null
  detail: ChatOpenResult | null; onSent(result: ChatSendResult): void
}) {
  const [draftId] = useState(() => newChatDraftId(agentId))
  const key = chatDraftKey(agentId, chatId, draftId)
  const [initial] = useState(() => readChatDraft(key))
  const [content, setContent] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'start' | 'steer'>('steer')
  const handle = useRef<StructuredMentionComposerHandle>(null)
  const persistenceError = useRef<Error | null>(null)
  const sending = useRef(false)
  const mounted = useRef(true)
  const attempt = useRef<{ signature: string; commandId: string } | null>(null)
  const active = detail?.runs.find(run => ['queued','running','waiting'].includes(run.status))
  const skills = useChatSkills(client, agentId, runtime)
  useEffect(() => {
    mounted.current = true
    if (!chatId) handle.current?.focus('end')
    return () => { mounted.current = false }
  }, [chatId])
  const body = composerDocumentToPlainText(content)
  async function submit() {
    if (sending.current || !handle.current) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      const { document } = await handle.current.flush({ forSubmission: true })
      const input = chatInputFromDocument(document)
      if (!input.body.trim()) return
      const command = { ...(chatId ? {chatId} : {draftId, agentId}), ...input, mode: 'start' }
      const signature = JSON.stringify(command)
      if (attempt.current?.signature !== signature) attempt.current = { signature, commandId: newCommandId() }
      const result = await client.request<ChatSendResult>('chats.send', { commandId: attempt.current.commandId, command })
      consumeChatDraft(key, document, agentId, draftId, !chatId)
      attempt.current = null
      if (mounted.current) {
        handle.current?.replaceDocument(emptyComposerDocument()); setContent(emptyComposerDocument())
        onSent(result)
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      sending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <div className="chat-composer-dock">
    {chatId && detail && <ChatQueue items={detail.pendingInputs} client={client} chatId={chatId}
      canEdit={!busy && !body} onRestore={value => {
        saveChatDraft(key,value); handle.current?.replaceDocument(value); setContent(value); handle.current?.focus('end')
      }} onError={setError}/>}
    <form className="composer" onSubmit={event => { event.preventDefault(); void submit() }}>
      <div className="composer-box">
        <div className="composer-input"><StructuredMentionComposer ref={handle} id="independent-chat-input" draftIdentity={key}
          document={initial} members={[]} purpose="chat" {...skills} ariaLabel={uiAttribute('给 {0} 发消息', name)}
          placeholder={uiAttribute('给 {0} 发消息', name)} disabled={busy}
          onEffectiveDocumentChange={setContent} getAuthoritativeDraft={() => loadLocalThreadComposerDraft(key)}
          persistDocument={async () => { if (persistenceError.current) throw persistenceError.current }}
          onDocumentChange={value => {
            try { saveChatDraft(key,value); persistenceError.current=null }
            catch (failure) { persistenceError.current=failure instanceof Error ? failure : new Error(String(failure)); setError(persistenceError.current.message) }
          }}
          onPersistenceErrorChange={value => { if (value) setError(value.message) }}
          onSubmit={submit}/></div>
        <div className="composer-action-row"><div className="composer-tools"/><div className="composer-actions">
          <ComposerDeliveryAction type="submit" action="send" mode={mode} onModeChange={setMode} busy={busy} disabled={busy || !body.trim()}
            plans={active ? [{ agentId, name, target:{agentRunId:active.runId,executionEpoch:active.executionEpoch}, canSteer:false, reason:null, route:'queue' }] : []}/>
        </div></div>
      </div>
      {error && <div className="single-chat-error" role="alert">{error}</div>}
    </form>
  </div>
}
