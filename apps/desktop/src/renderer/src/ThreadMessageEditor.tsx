import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { LocalAttachmentSourceView, StoredCommandResult, ThreadMessageAroundSnapshot, ThreadMessageView } from '@contracts'
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
type EditConflict = { minimumRevision: number } & (
  { status: 'loading' | 'error' } | { status: 'ready'; latest: ThreadMessageView }
)

function messageDocument(message: ThreadMessageView) {
  return message.content.length
    ? composerDocumentFromLegacyContent(message.content)
    : composerDocumentFromText(message.body)
}

export function ThreadMessageEditor({
  message,
  threadId,
  defaultLead,
  contentWidth,
  editorContext,
  onCancel,
  onSaved
}: {
  message: ThreadMessageView
  threadId: string
  defaultLead: string | null
  contentWidth?: number
  editorContext: EditorContext
  onCancel(): void
  onSaved(): Promise<void>
}): JSX.Element {
  const client = useThreadClient()
  const [initial] = useState(() => messageDocument(message))
  const [retained, setRetained] = useState(() => message.attachments)
  const [added, setAdded] = useState<LocalAttachmentSourceView[]>([])
  const [revision, setRevision] = useState(message.contentRevision ?? 1)
  const [document, setDocument] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [pendingInsertion, setPendingInsertion] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<EditConflict | null>(null)
  const editor = useRef<StructuredMentionComposerHandle>(null)
  const picker = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const requestRef = useRef<{ id: string; command: string } | null>(null)
  const preparedRef = useRef<string[]>([])
  const sentRef = useRef(false)
  const mounted = useRef(true)
  const status = composerDocumentStatus(document, editorContext.members, editorContext.skills ?? [])
  const attachmentCount = retained.length + added.length
  const canSubmit = !saving && !preparing && !pendingInsertion && (status.hasContent || attachmentCount > 0)

  useLayoutEffect(() => { editor.current?.focus() }, [])

  const discardPrepared = useCallback(() => {
    const ids = preparedRef.current.splice(0)
    if (ids.length) void client.composerAttachments.discard?.(threadId, ids).catch(() => undefined)
  }, [client, threadId])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (!sentRef.current) discardPrepared()
    }
  }, [discardPrepared])

  const addFiles = async (files: File[]): Promise<void> => {
    if (busy.current || !files.length) return
    if (attachmentCount + files.length > MAX_LOCAL_COMPOSER_ATTACHMENTS) {
      setError(uiAttribute('最多可添加 10 个附件。'))
      return
    }
    busy.current = true
    setPreparing(true)
    setError(null)
    const failed: string[] = []
    try {
      for (const file of files) {
        if (!mounted.current) break
        try {
          const attachment = await client.composerAttachments.prepare(threadId, revision, file)
          if (!mounted.current) {
            void client.composerAttachments.discard?.(threadId, [attachment.id]).catch(() => undefined)
            break
          }
          preparedRef.current.push(attachment.id)
          setAdded(current => [...current, attachment])
        } catch {
          failed.push(file.name)
        }
      }
      if (mounted.current && failed.length) {
        setError(uiAttribute('无法添加 {0}，请重新选择。', failed.join('、')))
      }
    } finally {
      busy.current = false
      if (mounted.current) setPreparing(false)
    }
  }

  const readLatest = async (minimumRevision: number): Promise<void> => {
    setConflict({ status: 'loading', minimumRevision })
    try {
      const around = await client.request<ThreadMessageAroundSnapshot>('thread.messages.around', { threadId, messageId: message.id })
      if (!mounted.current) return
      if (around.schemaVersion !== 1 || around.threadId !== threadId || around.anchorMessageId !== message.id) {
        throw new Error('Message edit conflict response does not match the message')
      }
      const latest = around.messages.find(item => item.id === message.id)
      if (!around.sourceAvailable || latest?.withdrawn || latest?.canEdit === false) {
        onCancel()
        return
      }
      if (!latest || (latest.contentRevision ?? 1) < minimumRevision) throw new Error('Message revision has not caught up')
      setConflict({ status: 'ready', minimumRevision, latest })
    } catch {
      if (mounted.current) setConflict({ status: 'error', minimumRevision })
    }
  }

  const loadLatest = (latest: ThreadMessageView): void => {
    if (busy.current || pendingInsertion) return
    const content = messageDocument(latest)
    editor.current?.replaceDocument(content)
    setDocument(content)
    setRevision(latest.contentRevision ?? 1)
    setRetained(latest.attachments)
    setAdded([])
    if (!sentRef.current) discardPrepared()
    setConflict(null)
    setError(null)
  }

  const save = async (replacement?: ThreadMessageView): Promise<void> => {
    if (busy.current || !canSubmit || (conflict && !replacement)) return
    const content = editor.current?.getDocument() ?? document
    const latestStatus = composerDocumentStatus(content, editorContext.members, editorContext.skills ?? [])
    if (!latestStatus.hasContent && !attachmentCount) return
    if (latestStatus.hasUnavailableAtom) {
      setError(uiAttribute('有队员无法接收，请修改提及后再保存。'))
      return
    }
    if (replacement && retained.some(file => !replacement.attachments.some(latest => latest.id === file.id))) {
      setError(uiAttribute('部分附件已被移除，请先从草稿中移除或重新添加。'))
      return
    }
    const expectedContentRevision = replacement?.contentRevision ?? revision
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      const command = {
        threadId,
        messageId: message.id,
        expectedContentRevision,
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
        if (!mounted.current) {
          discardPrepared()
          return
        }
        if (result.code === 'message.edit_conflict') {
          const latest = result.payload.currentContentRevision
          void readLatest(typeof latest === 'number' ? latest : expectedContentRevision + 1)
        } else if (result.code === 'message.edit_forbidden' || result.code === 'message.not_found') {
          onCancel()
        } else if (result.code === 'mention_target_unavailable' || result.code === 'camp.default_lead_invariant'
          || result.code === 'camp_message.invalid_explicit_target') {
          setError(uiAttribute('有队员无法接收，请修改提及后再保存。'))
        } else {
          const reason = result.payload.message
          setError(typeof reason === 'string' ? reason : uiAttribute('保存失败，请重试。'))
        }
        return
      }
      discardPrepared()
      await onSaved()
    } catch (failure) {
      if (mounted.current) setError(readErrorMessage(failure, uiAttribute('保存失败，请重试。')))
    } finally {
      busy.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return <form className="revision-editor" aria-label={uiAttribute('编辑消息')}
    style={contentWidth ? { '--revision-content-width': `${contentWidth}px` } as CSSProperties : undefined}
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
      onPasteFiles={files => { void addFiles(files) }} onSubmit={() => void save()} />
    {conflict && <div className="inline-edit-conflict">
      {conflict.status === 'loading' && <div role="status"><UiText zh="正在读取最新内容…" /></div>}
      {conflict.status === 'error' && <div role="alert">
        <UiText zh="最新内容暂时无法读取。" />
        <button className="quiet-button compact" type="button" onClick={() => void readLatest(conflict.minimumRevision)}>
          <UiText zh="重试" />
        </button>
      </div>}
      {conflict.status === 'ready' && <>
        <div role="status"><UiText zh="消息已在别处更新" /></div>
        <div className="inline-edit-conflict-preview" tabIndex={0} role="region" aria-label={uiAttribute('最新内容')}>
          {conflict.latest.body && <p>{conflict.latest.body}</p>}
          {conflict.latest.attachments.length > 0 && <ul>
            {conflict.latest.attachments.map(file => <li key={file.id}>{file.displayName}</li>)}
          </ul>}
        </div>
        <div className="inline-edit-conflict-actions">
          <button className="quiet-button compact" type="button" disabled={saving || preparing || pendingInsertion}
            onClick={() => loadLatest(conflict.latest)}><UiText zh="载入最新内容" /></button>
          <button className="primary-button conversation-primary-action" type="button" disabled={!canSubmit}
            onClick={() => void save(conflict.latest)}><UiText zh="用我的修改替换" /></button>
        </div>
      </>}
    </div>}
    {error && <div className="message-withdraw-error" role="alert">{error}</div>}
    <div className="revision-editor-actions">
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
      <button className="primary-button conversation-primary-action" type="submit" disabled={!canSubmit || conflict !== null} aria-busy={saving}>
        {saving ? uiAttribute('正在保存…') : uiAttribute('保存')}
      </button>
    </div>
  </form>
}
