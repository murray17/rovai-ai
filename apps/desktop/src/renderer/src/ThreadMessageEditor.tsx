import { useEffect, useRef, useState, type JSX } from 'react'
import type { ComposerDocument, LocalAttachmentSourceView, StoredCommandResult, ThreadMessageView } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { AttachmentCard, ComposerAttachmentStrip } from './AttachmentCard'
import { useThreadClient } from './camp-client'
import { MAX_LOCAL_COMPOSER_ATTACHMENTS } from './camp-composer-local-store'
import {
  composerDocumentFromLegacyContent,
  composerDocumentFromText,
  composerDocumentStatus
} from './composer-document'
import { readErrorMessage } from './error-message'
import { UiText, uiAttribute } from './interface-language'
import {
  StructuredMentionComposer,
  type StructuredMentionComposerHandle,
  type StructuredMentionComposerProps
} from './StructuredMentionComposer'

type EditorContext = Pick<StructuredMentionComposerProps, 'referenceScope' | 'members' | 'skills' | 'onNeedSkills'>

export function ThreadMessageEditor({
  message,
  threadId,
  defaultLead,
  editorContext,
  onCancel,
  onSaved
}: {
  message: ThreadMessageView
  threadId: string
  defaultLead: string | null
  editorContext: EditorContext
  onCancel(): void
  onSaved(): Promise<void>
}): JSX.Element {
  const client = useThreadClient()
  const [initial] = useState(() => message.content.length
    ? composerDocumentFromLegacyContent(message.content)
    : composerDocumentFromText(message.body))
  const [retained, setRetained] = useState(() => message.attachments)
  const [added, setAdded] = useState<LocalAttachmentSourceView[]>([])
  const [revision, setRevision] = useState(message.contentRevision ?? 1)
  const [document, setDocument] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [pendingInsertion, setPendingInsertion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editor = useRef<StructuredMentionComposerHandle>(null)
  const picker = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const requestRef = useRef<{ id: string; command: string } | null>(null)
  const preparedRef = useRef<string[]>([])
  const sentRef = useRef(false)
  const mounted = useRef(true)
  const status = composerDocumentStatus(document, editorContext.members, editorContext.skills ?? [])
  const attachmentCount = retained.length + added.length
  const canSave = !saving && !preparing && !pendingInsertion && (status.hasContent || attachmentCount > 0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (!sentRef.current && preparedRef.current.length) {
        void client.composerAttachments.discard?.(threadId, preparedRef.current).catch(() => undefined)
      }
    }
  }, [client, threadId])

  const addFiles = async (files: File[]): Promise<void> => {
    if (busy.current || !files.length) return
    if (attachmentCount + files.length > MAX_LOCAL_COMPOSER_ATTACHMENTS) {
      setError(uiAttribute('最多可添加 10 个附件。'))
      return
    }
    busy.current = true
    setPreparing(true)
    setError(null)
    const prepared: LocalAttachmentSourceView[] = []
    try {
      for (const file of files) {
        prepared.push(await client.composerAttachments.prepare(threadId, revision, file))
      }
      const ids = prepared.map(attachment => attachment.id)
      if (!mounted.current) {
        await client.composerAttachments.discard?.(threadId, ids).catch(() => undefined)
        return
      }
      preparedRef.current.push(...ids)
      setAdded(current => [...current, ...prepared])
    } catch (failure) {
      if (prepared.length) void client.composerAttachments.discard?.(threadId, prepared.map(attachment => attachment.id)).catch(() => undefined)
      setError(readErrorMessage(failure, uiAttribute('添加附件失败，请重试。')))
    } finally {
      busy.current = false
      setPreparing(false)
    }
  }

  const save = async (): Promise<void> => {
    if (busy.current || !canSave) return
    const content = editor.current?.getDocument() ?? document
    const latestStatus = composerDocumentStatus(content, editorContext.members, editorContext.skills ?? [])
    if (!latestStatus.hasContent && !attachmentCount) return
    if (latestStatus.hasUnavailableAtom) {
      setError(uiAttribute('有队员无法接收，请修改提及后再保存。'))
      return
    }
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const command = {
        threadId,
        messageId: message.id,
        expectedContentRevision: revision,
        content,
        retainAttachmentIds: retained.map(attachment => attachment.id),
        sourceAttachments: added.map(attachment => ({
          id: attachment.id,
          sourcePath: attachment.sourcePath,
          displayName: attachment.displayName,
          kind: attachment.kind,
          mediaType: attachment.mediaType,
          observedByteSize: attachment.byteSize
        }))
      }
      const serialized = JSON.stringify(command)
      if (requestRef.current?.command !== serialized) {
        requestRef.current = { id: newCommandId(), command: serialized }
      }
      sentRef.current = true
      const result = await client.request<StoredCommandResult>('thread.messages.edit', {
        commandId: requestRef.current.id,
        command
      })
      requestRef.current = null
      if (result.status === 'rejected') {
        sentRef.current = false
        if (result.code === 'message.edit_conflict') {
          const latest = result.payload.currentContentRevision
          if (typeof latest === 'number') setRevision(latest)
          setError(uiAttribute('消息已更新。请核对内容后再次保存。'))
        } else if (result.code === 'mention_target_unavailable' || result.code === 'camp.default_lead_invariant'
          || result.code === 'camp_message.invalid_explicit_target') {
          setError(uiAttribute('有队员无法接收，请修改提及后再保存。'))
        } else {
          const reason = result.payload.message
          setError(typeof reason === 'string' ? reason : uiAttribute('保存失败，请重试。'))
        }
        return
      }
      const preparedIds = preparedRef.current.splice(0)
      if (preparedIds.length) void client.composerAttachments.discard?.(threadId, preparedIds).catch(() => undefined)
      await onSaved()
    } catch (failure) {
      setError(readErrorMessage(failure, uiAttribute('保存失败，请重试。')))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return <form className="composer inline-message-edit" aria-label={uiAttribute('编辑消息')}
    onSubmit={event => { event.preventDefault(); void save() }}>
    {!status.hasExplicitRecipient && defaultLead && <div className="inline-edit-route">
      <UiText zh="默认由队长" /> <span>@{defaultLead}</span> <UiText zh="接收" />
    </div>}
    {(retained.length > 0 || added.length > 0) && <ComposerAttachmentStrip>
      {retained.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment}
        locator={{ owner: 'message', threadId, messageId: message.id, attachmentRefId: attachment.id }}
        disabled={saving || preparing}
        onRemove={() => setRetained(current => current.filter(file => file.id !== attachment.id))} />)}
      {added.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment}
        locator={{ owner: 'composer', threadId, attachmentRefId: attachment.id }}
        disabled={saving || preparing}
        onRemove={() => setAdded(current => current.filter(file => file.id !== attachment.id))} />)}
    </ComposerAttachmentStrip>}
    <StructuredMentionComposer {...editorContext}
      ref={editor} id={`edit-${message.id}`} document={initial} draftIdentity={`${threadId}:${message.id}:edit`}
      ariaLabel={uiAttribute('编辑消息正文')} disabled={saving}
      onEffectiveDocumentChange={setDocument} onFileInsertionPendingChange={setPendingInsertion}
      onPasteFiles={files => { void addFiles(files) }} onSubmit={save} />
    {error && <div className="message-withdraw-error" role="alert">{error}</div>}
    <div className="inline-edit-actions">
      <input ref={picker} type="file" hidden multiple onChange={event => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        void addFiles(files)
      }} />
      <button className="composer-attachment-button" type="button"
        aria-label={uiAttribute('添加文件')} title={uiAttribute('添加文件')}
        disabled={saving || preparing} aria-busy={preparing} onClick={() => picker.current?.click()}>
        <svg aria-hidden="true" viewBox="0 0 18 18">
          <path d="m6.2 9.8 4.65-4.65a2.5 2.5 0 0 1 3.54 3.54l-6.1 6.1a4 4 0 0 1-5.66-5.66l6.1-6.1" />
        </svg>
      </button>
      <button className="quiet-button" type="button" disabled={saving || preparing} onClick={onCancel}>
        <UiText zh="取消" />
      </button>
      <button className="primary-button conversation-primary-action" type="submit" disabled={!canSave} aria-busy={saving}>
        {saving ? uiAttribute('正在保存…') : uiAttribute('保存')}
      </button>
    </div>
  </form>
}
