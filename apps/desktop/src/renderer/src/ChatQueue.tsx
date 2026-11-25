import { useRef, useState } from 'react'
import type { ChatOpenResult, ComposerDocument } from '@contracts'
import type { ThreadClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { uiAttribute } from './interface-language'
import { chatDocumentFromInput } from './chat-draft'

export function ChatQueue({ client, chatId, items, canEdit, onRestore, onError }: {
  client: ThreadClient; chatId: string; items: ChatOpenResult['pendingInputs']; canEdit: boolean
  onRestore(value: ComposerDocument): void; onError(message: string): void
}) {
  const [busy, setBusy] = useState(false)
  const attempt = useRef<{ key: string; id: string } | null>(null)
  async function change(item: typeof items[number], edit: boolean) {
    if (busy) return
    const key = JSON.stringify([item.inputId, item.revision, edit])
    if (attempt.current?.key !== key) attempt.current = {key, id:newCommandId()}
    setBusy(true)
    try {
      const result = await client.request<{body:string; skills:{skillId:string; nameAtSend:string}[]}>('chats.pendingInputs.edit', {
        commandId:attempt.current.id, command:{chatId,inputId:item.inputId,expectedRevision:item.revision,operation:edit ? 'return_to_composer' : 'remove'}
      })
      if (edit) onRestore(chatDocumentFromInput(result.body, result.skills))
      attempt.current = null
    } catch (error) { onError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  if (!items.length) return null
  return <section className="chat-queue-tray" aria-label={uiAttribute('排队中的消息')}>
    {items.map(item => <div className="chat-queue-row" key={item.inputId}>
      <span className="chat-queue-label">{uiAttribute(item.convertedFromSteer ? '已转为排队' : '排队中')}</span>
      <span className="chat-queue-text" title={item.body}>{item.body}</span>
      <button type="button" aria-label={uiAttribute('编辑排队中的消息')} disabled={busy || !canEdit} onClick={() => void change(item,true)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 11.9.7-3.2 6.8-6.8a1.25 1.25 0 0 1 1.8 0l1.6 1.6a1.25 1.25 0 0 1 0 1.8L6.3 12l-3.1.7Z"/></svg>
      </button>
      <button type="button" aria-label={uiAttribute('删除排队中的消息')} disabled={busy} onClick={() => void change(item,false)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>
      </button>
    </div>)}
  </section>
}
