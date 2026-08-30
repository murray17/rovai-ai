import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  CampPendingInputsView, PendingCampInputView, PendingInputEditAction,
  StoredCommandResult, StructuredCampMessageContent
} from '@contracts'
import { StructuredMentionComposer, type StructuredMentionMember } from './StructuredMentionComposer'
import type { ComposerSkillOption } from './composer-skill-picker'
import { AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { readErrorMessage } from './error-message'

export type PendingInputSnapshot = {
  content: StructuredCampMessageContent
  replyToCampMessageId: string | null
  recipientSelectionRequired: boolean
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
    recipientSelectionRequired: item.recipientSelectionRequired
  }
}

export function pendingInputIsDirty(initial: PendingInputSnapshot, current: PendingInputSnapshot): boolean {
  return JSON.stringify(initial.content) !== JSON.stringify(current.content)
    || initial.replyToCampMessageId !== current.replyToCampMessageId
    || initial.recipientSelectionRequired !== current.recipientSelectionRequired
}

export function pendingInputHasContent(content: StructuredCampMessageContent): boolean {
  return content.some((segment) => segment.kind !== 'text' || segment.text.trim().length > 0)
}

export function pendingQueueRequiresEnqueue(queue: CampPendingInputsView | null, executionActive: boolean): boolean {
  return executionActive || Boolean(queue && (queue.executionActive || queue.items.length > 0))
}

function pendingError(code: string): string {
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

export function PendingCampInputs({
  campId, refreshKey, members, skills, skillCatalogStatus, stopping, onStop,
  onQueueChange, onEditingChange
}: {
  campId: string
  refreshKey: number
  members: readonly StructuredMentionMember[]
  skills: readonly ComposerSkillOption[]
  skillCatalogStatus: 'loading' | 'ready' | 'error'
  stopping: boolean
  onStop(): void
  onQueueChange(queue: CampPendingInputsView): void
  onEditingChange(editing: boolean): void
}): JSX.Element {
  const [queue, setQueue] = useState<CampPendingInputsView | null>(null)
  const [edit, setEdit] = useState<LocalEdit | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [switchTarget, setSwitchTarget] = useState<PendingCampInputView | 'close' | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const requestSequence = useRef(0)
  const callbacks = useRef({ onQueueChange, onEditingChange })
  callbacks.current = { onQueueChange, onEditingChange }

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    const next = await window.rovai.request<CampPendingInputsView>('camp.pendingInputs.get', { campId })
    if (!mounted.current || sequence !== requestSequence.current || next?.campId !== campId) return
    setQueue(next)
    callbacks.current.onQueueChange(next)
  }, [campId])

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async (): Promise<void> => {
      try { await refresh() } catch { /* Keep last authority; mutations surface actionable errors. */ }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => {
      cancelled = true
      mounted.current = false
      clearTimeout(timer)
      // Deliberately do not cancel the Core lock on unmount/crash.
      // Unsaved edits are local and reopening requires an explicit recovery action.
    }
  }, [refresh])

  useEffect(() => { void refresh().catch(() => undefined) }, [refreshKey, refresh])
  useEffect(() => { callbacks.current.onEditingChange(edit !== null) }, [edit !== null])

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

  const ownsEdit = Boolean(edit && queue?.editSession?.pendingInputId === edit.item.id
    && queue.editSession.editToken === edit.token && !queue.editSession.recoveryRequired)
  const saveDisabled = !edit || busy || !ownsEdit || !pendingInputHasContent(edit.content)
  const visible = Boolean(queue && queue.items.length > 0)

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
          return <li className={`pending-input-row${selected ? ' is-editing' : ''}`} key={item.id}>
            <div className="pending-input-preview" title={item.body}>
              <span className="pending-input-mark" aria-hidden="true" />
              <span className="pending-input-copy">{item.body}</span>
              {(selected || recovery || item.state === 'needs_repair') && <small>
                {selected ? '正在编辑' : recovery ? '未完成的编辑 · 重新编辑' : '需要处理'}
              </small>}
            </div>
            {recovery && <button type="button" className="quiet-button compact" disabled={busy} onClick={() => void perform(async () => {
              await mutate(item, { type: 'cancel' }, queue.editSession?.editToken ?? null)
            })}>放弃未保存修改</button>}
            <span className="pending-input-actions">
              <button type="button" className="pending-input-edit" disabled={busy} onClick={() => requestEdit(item)}
                aria-label={`${recovery ? '重新编辑' : '编辑待发送消息'}：${item.body}`} aria-pressed={selected}
                title={selected ? '正在输入框中编辑' : recovery ? '重新编辑' : '编辑'}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 11.9.7-3.2 6.8-6.8a1.25 1.25 0 0 1 1.8 0l1.6 1.6a1.25 1.25 0 0 1 0 1.8L6.3 12l-3.1.7Z" /><path d="m9.8 2.8 3.4 3.4" /></svg>
              </button>
              <button type="button" className="pending-input-delete" aria-label={`删除待发送消息：${item.body}`} title="删除" disabled={busy} onClick={() => deleteItem(item)}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
              </button>
            </span>
            {item.lastAttemptErrorCode && <p className="pending-input-error">{pendingError(item.lastAttemptErrorCode)}</p>}
          </li>
        })}
      </ul>
      {queue.editSession?.pendingInputId === queue.items[0]?.id ? (
        <span className="pending-input-status">队首正在编辑，保存或取消后继续。</span>
      ) : queue.items[0]?.state === 'needs_repair' ? (
        <span className="pending-input-status">队首需要处理，请编辑保存或删除。</span>
      ) : null}
    </section>}
    {error && <p className="pending-input-notice" role="alert">{error}</p>}
    {edit && <div className="composer-box pending-input-editor" onKeyDown={(event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); requestClose() }
    }}>
      <div className="pending-input-edit-heading"><strong>编辑待发送消息</strong><span>保存后保持原顺序</span></div>
      {!ownsEdit && <p role="alert" className="pending-input-error">编辑占用已变化。未保存的修改只在本窗口；关闭后可重新编辑。</p>}
      {edit.replyToCampMessageId && <div className="composer-reply-line">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3-4 4 4 4M2 7h8c3 0 4 2 4 5" /></svg>
        <span className="composer-reply-copy"><strong>回复 {edit.item.replyIntent?.author?.displayName ?? '引用消息'}</strong><span>{edit.item.replyIntent?.excerpt ?? '引用的消息当前不可用'}</span></span>
        <button type="button" className="composer-reply-cancel" aria-label="取消待发送消息的回复" disabled={busy} onClick={() => setEdit({ ...edit, replyToCampMessageId: null, recipientSelectionRequired: false })}>取消</button>
      </div>}
      {edit.recipientSelectionRequired && <p className="pending-input-error" role="alert">请在正文中选择 @成员；引用会继续保留。</p>}
      <StructuredMentionComposer id="pending-camp-message" value={edit.content} members={members} skills={skills} skillCatalogStatus={skillCatalogStatus}
        ariaLabel="编辑待发送消息" placeholder="修改这条待发送消息…" editorRef={editorRef} disabled={busy || !ownsEdit}
        onChange={(content) => setEdit({ ...edit, content, recipientSelectionRequired: content.some((segment) => segment.kind === 'member_mention' || segment.kind === 'all_members_mention') ? false : edit.recipientSelectionRequired })}
        onPasteFiles={() => setError('待发送消息暂不支持附件。')}
        onBackspaceAtStart={() => { if (edit.replyToCampMessageId) setEdit({ ...edit, replyToCampMessageId: null, recipientSelectionRequired: false }) }}
        onSubmit={() => { if (!saveDisabled) return perform(() => finish(true)) }} />
      <div className="composer-action-row">
        <span className="pending-input-status">未保存的修改仅保留在当前窗口。</span>
        <div className="composer-actions">
          {queue?.executionActive && <button className="danger-button composer-stop" type="button" disabled={stopping} onClick={onStop}>{stopping ? '正在停止…' : '停止'}</button>}
          <button type="button" className="quiet-button" disabled={busy} onClick={() => {
            if (!ownsEdit) { setEdit(null); return }
            requestClose()
          }}>取消</button>
          <button type="button" className="primary-button composer-send" disabled={saveDisabled} onClick={() => void perform(() => finish(true))}>{busy ? '处理中…' : '保存'}</button>
        </div>
      </div>
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
