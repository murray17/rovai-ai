import { useCallback, useEffect, useRef, useState, type DragEvent, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  CampPendingInputsView, LocalAttachmentAvailability, LocalAttachmentOwnerLocator,
  LocalAttachmentSourceView, PendingCampInputView, PendingInputEditAction,
  StoredCommandResult, StructuredCampMessageContent
} from '@contracts'
import { StructuredMentionComposer, type StructuredMentionMember } from './StructuredMentionComposer'
import type { ComposerSkillOption } from './composer-skill-picker'
import { AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { readErrorMessage } from './error-message'
import { createPendingInputsRefresh, shouldRefreshPendingInputs } from './pending-input-refresh'
import { useOptionalFilePreview } from './FilePreviewContext'

export type PendingInputSnapshot = {
  content: StructuredCampMessageContent
  replyToCampMessageId: string | null
  recipientSelectionRequired: boolean
  attachments: LocalAttachmentSourceView[]
}

type LocalEdit = PendingInputSnapshot & {
  item: PendingCampInputView
  token: string
  initial: PendingInputSnapshot
}

export function pendingInputSnapshot(item: PendingCampInputView): PendingInputSnapshot {
  return {
    content: item.content,
    replyToCampMessageId: item.replyIntent?.replyToCampMessageId ?? null,
    recipientSelectionRequired: item.recipientSelectionRequired,
    attachments: item.attachments
  }
}

export function pendingInputIsDirty(initial: PendingInputSnapshot, current: PendingInputSnapshot): boolean {
  return JSON.stringify(initial.content) !== JSON.stringify(current.content)
    || initial.replyToCampMessageId !== current.replyToCampMessageId
    || initial.recipientSelectionRequired !== current.recipientSelectionRequired
    || JSON.stringify(initial.attachments.map(({ id }) => id))
      !== JSON.stringify(current.attachments.map(({ id }) => id))
}

export function pendingInputHasContent(content: StructuredCampMessageContent): boolean {
  return content.some((segment) => segment.kind !== 'text' || segment.text.trim().length > 0)
}

export function pendingQueueRequiresEnqueue(queue: CampPendingInputsView | null, executionActive: boolean): boolean {
  return executionActive || Boolean(queue && (queue.executionActive || queue.items.length > 0))
}

function pendingError(code: string): string {
  if (code === 'attachment_missing') return '附件已被移动或删除，请移除后重新添加。'
  if (code === 'attachment_unreadable') return '附件当前无法读取，请检查权限或移除后重新添加。'
  if (code === 'attachment_kind_changed') return '附件的文件类型已经变化，请移除后重新添加。'
  if (code === 'mention_target_unavailable' || code === 'camp_message.invalid_explicit_target') return '接收者已不可用，请修改 @成员并保存这条消息。'
  if (code === 'camp.default_lead_invariant') return '当前队长不可用，请设置队长或 @指定成员，再保存这条消息。'
  if (code === 'camp_message.no_addressable_member') return '当前会话没有可用的接收者，请先邀请队员，再编辑并保存这条消息。'
  if (code === 'agent_run.runtime_not_ready') return '接收队员的 Runtime 尚未就绪，请检查队员配置，再编辑并保存这条消息。'
  if (code === 'camp_message.invalid_reply') return '引用消息已不可用，请取消引用并保存这条消息。'
  if (code === 'reply_recipient_required') return '请选择 @接收者并保存这条消息。'
  if (code === 'pending_input.edit_open') return '请先结束当前编辑，再编辑另一条消息。'
  if (code === 'pending_input.changed') return '这条消息已经变化或发出，请查看最新队列。'
  if (code === 'pending_input.edit_fenced') return '编辑已在别处关闭或重新打开，本次修改未保存。'
  if (code === 'camp_message.empty_body') return '消息不能为空。'
  return `发送未完成（${code}），消息已保留。请检查后编辑并保存，或删除这条消息。`
}

function availabilityFromPreviewError(code: string): LocalAttachmentAvailability | null {
  if (code === 'attachment_missing') return 'missing'
  if (code === 'attachment_unreadable') return 'unreadable'
  if (code === 'attachment_kind_changed') return 'kind_changed'
  return null
}

function attachmentLocatorKey(locator: LocalAttachmentOwnerLocator): string {
  return `${locator.owner}:${locator.campId}:${'pendingInputId' in locator ? locator.pendingInputId : ''}:${locator.attachmentRefId}`
}

export function PendingCampInputs({
  campId, refreshKey, executionActive, members, skills, skillCatalogStatus,
  onQueueChange, onEditingChange
}: {
  campId: string
  refreshKey: number
  executionActive: boolean
  members: readonly StructuredMentionMember[]
  skills: readonly ComposerSkillOption[]
  skillCatalogStatus: 'loading' | 'ready' | 'error'
  onQueueChange(queue: CampPendingInputsView): void
  onEditingChange(editing: boolean): void
}): JSX.Element {
  const filePreview = useOptionalFilePreview()
  const [queue, setQueue] = useState<CampPendingInputsView | null>(null)
  const [edit, setEdit] = useState<LocalEdit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [switchTarget, setSwitchTarget] = useState<PendingCampInputView | 'close' | null>(null)
  const [attachmentAvailability, setAttachmentAvailability] = useState<Record<string, LocalAttachmentAvailability>>({})
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const refreshReader = useRef<ReturnType<typeof createPendingInputsRefresh> | null>(null)
  const callbacks = useRef({ onQueueChange, onEditingChange })
  callbacks.current = { onQueueChange, onEditingChange }

  const refresh = useCallback((): Promise<void> => refreshReader.current?.refresh() ?? Promise.resolve(), [])

  useEffect(() => {
    mounted.current = true
    const reader = createPendingInputsRefresh(
      () => window.rovai.request<CampPendingInputsView>('camp.pendingInputs.get', { campId }),
      (next) => {
        if (next.campId !== campId) return
        setQueue(next)
        callbacks.current.onQueueChange(next)
      }
    )
    refreshReader.current = reader
    const invalidate = (): void => { void reader.refresh().catch(() => undefined) }
    const foreground = (): void => { if (document.visibilityState !== 'hidden') invalidate() }
    const unsubscribe = window.rovai.onEvent((event) => {
      if (shouldRefreshPendingInputs(event, campId)) invalidate()
    })
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    invalidate()
    return () => {
      mounted.current = false
      reader.dispose()
      if (refreshReader.current === reader) refreshReader.current = null
      unsubscribe()
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
      // Deliberately do not cancel the Core lock on unmount/crash.
      // Unsaved edits are local and reopening requires an explicit recovery action.
    }
  }, [campId])

  useEffect(() => { void refresh().catch(() => undefined) }, [refreshKey, executionActive, refresh])
  useEffect(() => { callbacks.current.onEditingChange(edit !== null) }, [edit !== null])

  useEffect(() => {
    const session = queue?.editSession
    if (!edit || !session || session.pendingInputId !== edit.item.id || session.editToken !== edit.token) return
    setEdit((current) => current && current.item.id === edit.item.id
      ? { ...current, attachments: session.workingAttachments }
      : current)
  }, [edit?.item.id, edit?.token, queue?.editSession])

  const ownsEdit = Boolean(edit && queue?.editSession?.pendingInputId === edit.item.id
    && queue.editSession.editToken === edit.token && !queue.editSession.recoveryRequired)

  const mutate = async (item: PendingCampInputView, action: PendingInputEditAction, token: string | null): Promise<StoredCommandResult> => {
    const result = await window.rovai.request<StoredCommandResult>('camp.pendingInputs.edit', {
      commandId: crypto.randomUUID(),
      command: { campId, pendingInputId: item.id, expectedRevision: item.revision, editToken: token, action }
    })
    if (result.status === 'rejected') throw new Error(pendingError(result.code))
    return result
  }

  const perform = async (operation: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await operation() } catch (cause) { if (mounted.current) setError(readErrorMessage(cause, '操作未完成，请稍后再试。')) }
    finally {
      await refresh().catch(() => undefined)
      if (mounted.current) setBusy(false)
    }
  }

  const prepareFiles = (files: File[]): void => {
    if (!edit || !ownsEdit || files.length === 0) return
    void perform(async () => {
      let nextQueue: CampPendingInputsView | null = null
      const failures: string[] = []
      for (const [index, original] of files.entries()) {
        const file = original.name
          ? original
          : new File([original], `粘贴图片-${Date.now()}-${index + 1}.png`, { type: original.type })
        try {
          nextQueue = await window.rovai.composerAttachments.preparePending({
            campId,
            pendingInputId: edit.item.id,
            expectedRevision: edit.item.revision,
            editToken: edit.token
          }, file)
        } catch (cause) {
          failures.push(`${file.name}：${readErrorMessage(cause, '添加失败')}`)
        }
      }
      if (nextQueue && mounted.current) {
        setQueue(nextQueue)
        callbacks.current.onQueueChange(nextQueue)
        const working = nextQueue.editSession?.workingAttachments
        if (working) setEdit((current) => current ? { ...current, attachments: working } : current)
      }
      if (failures.length > 0) throw new Error(failures.join('\n'))
    })
  }

  const mutateAttachments = (action: PendingInputEditAction): void => {
    if (!edit || !ownsEdit) return
    void perform(async () => {
      await mutate(edit.item, action, edit.token)
    })
  }

  const openAttachment = async (
    attachment: LocalAttachmentSourceView,
    locator: LocalAttachmentOwnerLocator
  ): Promise<void> => {
    const key = attachmentLocatorKey(locator)
    if (attachment.kind === 'file' && filePreview) {
      const outcome = await filePreview.open({ kind: 'attachment', campId, locator })
      if (outcome.kind === 'error') {
        const availability = availabilityFromPreviewError(outcome.error.code)
        if (availability) setAttachmentAvailability((current) => ({ ...current, [key]: availability }))
        throw new Error(outcome.error.message)
      }
      setAttachmentAvailability((current) => ({ ...current, [key]: 'available' }))
      return
    }
    const result = await window.rovai.attachments.open(locator)
    setAttachmentAvailability((current) => ({ ...current, [key]: result.availability }))
    if (result.error === 'target_unavailable') throw new Error('此附件当前不可用。')
    if (result.error) throw new Error('无法使用系统应用打开此附件。')
  }

  const begin = async (item: PendingCampInputView): Promise<void> => {
    const existing = queue?.editSession
    const recovering = existing?.pendingInputId === item.id
    const result = await mutate(item, { type: recovering ? 'takeover' : 'begin' }, recovering ? existing.editToken : null)
    const token = result.payload.editToken
    if (typeof token !== 'string') throw new Error('无法确认编辑占用，请重新打开。')
    const initial = pendingInputSnapshot(item)
    if (!mounted.current) return
    setEdit({ ...initial, item, token, initial })
    requestAnimationFrame(() => editorRef.current?.focus())
  }

  const finish = async (save: boolean): Promise<void> => {
    if (!edit) return
    await mutate(edit.item, save ? {
      type: 'save', content: edit.content, replyToCampMessageId: edit.replyToCampMessageId,
      recipientSelectionRequired: edit.recipientSelectionRequired
    } : { type: 'cancel' }, edit.token)
    if (mounted.current) setEdit(null)
  }

  const requestEdit = (item: PendingCampInputView): void => {
    if (edit?.item.id === item.id || busy) return
    if (edit && pendingInputIsDirty(edit.initial, edit)) { setSwitchTarget(item); return }
    void perform(async () => { if (edit) await finish(false); await begin(item) })
  }

  const requestClose = (): void => {
    if (edit && pendingInputIsDirty(edit.initial, edit)) { setSwitchTarget('close'); return }
    void perform(() => finish(false))
  }

  const confirmSwitch = async (save: boolean): Promise<void> => {
    const target = switchTarget
    await finish(save)
    setSwitchTarget(null)
    if (target && target !== 'close') await begin(target)
  }

  const deleteItem = (item: PendingCampInputView): void => {
    const session = queue?.editSession
    void perform(async () => {
      await mutate(item, { type: 'delete' }, session?.pendingInputId === item.id ? session.editToken : null)
      if (edit?.item.id === item.id) setEdit(null)
    })
  }

  const saveDisabled = !edit || busy || !ownsEdit
    || (!pendingInputHasContent(edit.content) && edit.attachments.length === 0)
  const visible = Boolean(queue && queue.items.length > 0)

  const acceptAttachmentDrag = (event: DragEvent<HTMLDivElement>): void => {
    if (!ownsEdit || !Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const dropAttachmentFiles = (event: DragEvent<HTMLDivElement>): void => {
    if (!ownsEdit || !Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    prepareFiles(Array.from(event.dataTransfer.files))
  }

  return <>
    {visible && queue && <section className="pending-input-queue" aria-label="待发送消息">
      <div className="pending-input-heading">
        <span>待发送 · {queue.items.length}</span>
      </div>
      <ul className="pending-input-list">
        {queue.items.map((item) => {
          const openSession = queue.editSession?.pendingInputId === item.id
          const selected = edit?.item.id === item.id
          const recovery = openSession && !selected
          const itemLabel = item.body.trim() || `${item.attachments.length} 个附件`
          return <li className={`pending-input-row${selected ? ' is-editing' : ''}`} key={item.id}>
            <div className="pending-input-preview" title={itemLabel}>
              <span className="pending-input-mark" aria-hidden="true" />
              <span className="pending-input-copy">{itemLabel}</span>
              {(selected || recovery || item.state === 'needs_repair') && <small>
                {selected ? '正在编辑' : recovery ? '未完成的编辑 · 重新编辑' : '需要处理'}
              </small>}
            </div>
            {item.attachments.length > 0 && <div className="pending-input-attachments" aria-label="待发送附件">
              {item.attachments.map((attachment) => {
                const locator: LocalAttachmentOwnerLocator = {
                  owner: 'pending', campId, pendingInputId: item.id, attachmentRefId: attachment.id
                }
                const availability = attachmentAvailability[attachmentLocatorKey(locator)] ?? attachment.availability
                return <button key={attachment.id} type="button" disabled={busy}
                  className={`pending-input-attachment availability-${availability}`}
                  title={`打开 ${attachment.displayName}`}
                  onClick={() => void perform(() => openAttachment(attachment, locator))}>
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 2.5h6l3.6 3.6v7.4H3.2Z" /><path d="M9.2 2.5v3.7h3.6" /></svg>
                  <span>{attachment.displayName}</span>
                  {availability !== 'unknown' && availability !== 'available'
                    ? <small>{availability === 'missing' ? '已丢失' : availability === 'kind_changed' ? '类型已变化' : '不可读'}</small>
                    : null}
                </button>
              })}
            </div>}
            {recovery && <button type="button" className="quiet-button compact" disabled={busy} onClick={() => void perform(async () => {
              await mutate(item, { type: 'cancel' }, queue.editSession?.editToken ?? null)
            })}>放弃未保存修改</button>}
            <span className="pending-input-actions">
              <button type="button" className="pending-input-edit" disabled={busy} onClick={() => requestEdit(item)}
                aria-label={`${recovery ? '重新编辑' : '编辑待发送消息'}：${itemLabel}`} aria-pressed={selected}
                title={selected ? '正在输入框中编辑' : recovery ? '重新编辑' : '编辑'}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 11.9.7-3.2 6.8-6.8a1.25 1.25 0 0 1 1.8 0l1.6 1.6a1.25 1.25 0 0 1 0 1.8L6.3 12l-3.1.7Z" /><path d="m9.8 2.8 3.4 3.4" /></svg>
              </button>
              <button type="button" className="pending-input-delete" aria-label={`删除待发送消息：${itemLabel}`} title="删除" disabled={busy} onClick={() => deleteItem(item)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
              </button>
            </span>
            {item.lastAttemptErrorCode && <p className="pending-input-error">{pendingError(item.lastAttemptErrorCode)}</p>}
          </li>
        })}
      </ul>
      {queue.editSession?.pendingInputId !== queue.items[0]?.id && queue.items[0]?.state === 'needs_repair' ? (
        <span className="pending-input-status">队首需要处理，请编辑保存或删除。</span>
      ) : null}
    </section>}
    {error && <p className="pending-input-notice" role="alert">{error}</p>}
    {edit && <div className="composer-box pending-input-editor"
      onDragEnter={acceptAttachmentDrag} onDragOver={acceptAttachmentDrag} onDrop={dropAttachmentFiles}
      onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); requestClose() }
    }}>
      {!ownsEdit && <p role="alert" className="pending-input-error">编辑占用已变化。未保存的修改只在本窗口；关闭后可重新编辑。</p>}
      {edit.replyToCampMessageId && <div className="composer-reply-line">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3-4 4 4 4M2 7h8c3 0 4 2 4 5" /></svg>
        <span className="composer-reply-copy"><strong>回复 {edit.item.replyIntent?.author?.displayName ?? '引用消息'}</strong><span>{edit.item.replyIntent?.excerpt ?? '引用的消息当前不可用'}</span></span>
        <button type="button" className="composer-reply-cancel" aria-label="取消待发送消息的回复" disabled={busy} onClick={() => setEdit({ ...edit, replyToCampMessageId: null, recipientSelectionRequired: false })}>取消</button>
      </div>}
      {edit.recipientSelectionRequired && <p className="pending-input-error" role="alert">请在正文中选择 @成员；引用会继续保留。</p>}
      {edit.attachments.length > 0 && <div className="pending-edit-attachments" role="list" aria-label="编辑中的附件">
        {edit.attachments.map((attachment, index) => {
          const locator: LocalAttachmentOwnerLocator = {
            owner: 'pending_edit', campId, pendingInputId: edit.item.id,
            editToken: edit.token, attachmentRefId: attachment.id
          }
          const availability = attachmentAvailability[attachmentLocatorKey(locator)] ?? attachment.availability
          const order = edit.attachments.map(({ id }) => id)
          return <div className={`pending-edit-attachment availability-${availability}`} role="listitem" key={attachment.id}>
            <button type="button" className="pending-edit-attachment-open" disabled={busy || !ownsEdit}
              title={`打开 ${attachment.displayName}`}
              onClick={() => void perform(() => openAttachment(attachment, locator))}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 2.5h6l3.6 3.6v7.4H3.2Z" /><path d="M9.2 2.5v3.7h3.6" /></svg>
              <span>{attachment.displayName}</span>
              {availability !== 'unknown' && availability !== 'available'
                ? <small>{availability === 'missing' ? '已丢失' : availability === 'kind_changed' ? '类型已变化' : '不可读'}</small>
                : null}
            </button>
            <span className="pending-edit-attachment-actions">
              <button type="button" disabled={busy || !ownsEdit || index === 0} aria-label={`上移 ${attachment.displayName}`}
                onClick={() => {
                  const next = [...order]
                  ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                  mutateAttachments({ type: 'reorder_attachments', attachmentRefIds: next })
                }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 9.5 3.5-3 3.5 3" /></svg></button>
              <button type="button" disabled={busy || !ownsEdit || index === order.length - 1} aria-label={`下移 ${attachment.displayName}`}
                onClick={() => {
                  const next = [...order]
                  ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                  mutateAttachments({ type: 'reorder_attachments', attachmentRefIds: next })
                }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3 3.5-3" /></svg></button>
              <button type="button" disabled={busy || !ownsEdit} aria-label={`移除 ${attachment.displayName}`}
                onClick={() => mutateAttachments({ type: 'remove_attachment', attachmentRefId: attachment.id })}>移除</button>
            </span>
          </div>
        })}
      </div>}
      <StructuredMentionComposer id="pending-camp-message" value={edit.content} members={members} skills={skills} skillCatalogStatus={skillCatalogStatus}
        ariaLabel="编辑待发送消息" placeholder="修改这条待发送消息…" editorRef={editorRef} disabled={busy || !ownsEdit}
        onChange={(content) => setEdit({ ...edit, content, recipientSelectionRequired: content.some((segment) => segment.kind === 'member_mention' || segment.kind === 'all_members_mention') ? false : edit.recipientSelectionRequired })}
        onPasteFiles={prepareFiles}
        onBackspaceAtStart={() => { if (edit.replyToCampMessageId) setEdit({ ...edit, replyToCampMessageId: null, recipientSelectionRequired: false }) }}
        onSubmit={() => { if (!saveDisabled) return perform(() => finish(true)) }} />
      <PendingInputEditorActions
        busy={busy}
        saveDisabled={saveDisabled}
        tools={<>
          <input ref={fileInputRef} className="composer-file-input" type="file" multiple tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              prepareFiles(files)
            }} />
          <button className="composer-attachment-button" type="button" aria-label="为待发送消息添加文件"
            title="添加文件" disabled={busy || !ownsEdit} onClick={() => fileInputRef.current?.click()}>
            <svg aria-hidden="true" viewBox="0 0 18 18"><path d="m6.2 9.8 4.65-4.65a2.5 2.5 0 0 1 3.54 3.54l-6.1 6.1a4 4 0 0 1-5.66-5.66l6.1-6.1" /></svg>
          </button>
        </>}
        onCancel={() => {
          if (!ownsEdit) { setEdit(null); return }
          requestClose()
        }}
        onSave={() => void perform(() => finish(true))}
      />
    </div>}
    <Dialog.Root open={switchTarget !== null} onOpenChange={(open) => { if (!open && !busy) setSwitchTarget(null) }}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent width="compact" onCloseAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => editorRef.current?.focus())
        }}>
          <AppDialogHeader icon="pencil" title="保留这次修改吗？"
            description="当前待发送消息有未保存的修改。保存或放弃后再离开。" />
          <AppDialogFooter>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => setSwitchTarget(null)}>继续编辑</button>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => void perform(() => confirmSwitch(false))}>放弃修改</button>
            <button type="button" className="primary-button" disabled={saveDisabled} onClick={() => void perform(() => confirmSwitch(true))}>保存</button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}

export function PendingInputEditorActions({
  busy,
  saveDisabled,
  tools,
  onCancel,
  onSave
}: {
  busy: boolean
  saveDisabled: boolean
  tools?: JSX.Element
  onCancel(): void
  onSave(): void
}): JSX.Element {
  return (
    <div className="composer-action-row">
      {tools ? <div className="composer-tools">{tools}</div> : null}
      <div className="composer-actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="primary-button composer-send"
          disabled={saveDisabled}
          onClick={onSave}
        >
          {busy ? '处理中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
