import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { CampPendingInputsView, ComposerDocument, PendingCampInputView, StoredCommandResult } from '@contracts'
import { readErrorMessage } from './error-message'
import { createPendingInputsRefresh, shouldRefreshPendingInputs } from './pending-input-refresh'

export interface PendingCampInputsHandle {
  prepareForLeave(): Promise<void>
}

export class PendingInputReturnRejectedError extends Error {}

export function pendingInputHasContent(content: ComposerDocument): boolean {
  return content.segments.some((segment) => segment.kind !== 'text' || segment.text.trim().length > 0)
}

export function pendingQueueRequiresEnqueue(queue: CampPendingInputsView | null, executionActive: boolean): boolean {
  return executionActive || Boolean(queue && (queue.executionActive || queue.items.length > 0))
}

export function pendingError(code: string): string {
  if (code === 'attachment_missing') return '附件已被移动或删除，请移除后重新添加。'
  if (code === 'attachment_unreadable') return '附件当前无法读取，请检查权限或移除后重新添加。'
  if (code === 'attachment_kind_changed') return '附件的文件类型已经变化，请移除后重新添加。'
  if (code === 'mention_target_unavailable' || code === 'camp_message.invalid_explicit_target') return '接收者已不可用，请修改 @成员后重新发送这条消息。'
  if (code === 'camp.default_lead_invariant') return '当前队长不可用，请设置队长或 @指定成员，再发送这条消息。'
  if (code === 'camp_message.no_addressable_member') return '当前会话没有可用的接收者，请先邀请队员，再编辑后重新发送这条消息。'
  if (code === 'agent_run.runtime_not_ready') return '接收队员的 Runtime 尚未就绪，请检查队员配置，再编辑后重新发送这条消息。'
  if (code === 'camp_message.invalid_reply') return '引用消息已不可用，请取消引用后重新发送这条消息。'
  if (code === 'reply_recipient_required') return '请选择 @接收者后重新发送这条消息。'
  if (code === 'pending_input.edit_open') return '请先结束当前编辑，再编辑另一条消息。'
  if (code === 'pending_input.changed') return '这条消息已经变化或发出，请查看最新队列。'
  if (code === 'pending_input.edit_fenced') return '编辑已在别处关闭或重新打开，本次修改未保存。'
  if (code === 'camp_message.empty_body') return '消息不能为空。'
  return `发送未完成（${code}），消息已保留。请检查后编辑后重新发送，或删除这条消息。`
}


export function PendingInputRows({ queue, disabled, onEdit, onDelete }: {
  queue: CampPendingInputsView
  disabled: boolean
  onEdit(item: PendingCampInputView): void
  onDelete(item: PendingCampInputView): void
}): React.JSX.Element | null {
  if (queue.items.length === 0) return null
  return <section className="pending-input-queue" aria-label="待发送消息">
    <div className="pending-input-heading"><span>待发送 · {queue.items.length}</span></div>
    <ul className="pending-input-list">
      {queue.items.map((item) => {
        const label = item.body.trim() || `第 ${item.enqueueSequence} 条消息`
        return <li className="pending-input-row" key={item.id}>
          <div className="pending-input-preview" title={item.body}>
            <span className="pending-input-mark" aria-hidden="true" />
            <span className="pending-input-copy">{item.body}</span>
            {(item.quotes?.length ?? 0) > 0 && <small>引用 {item.quotes.length} 段</small>}
            {queue.editSession?.pendingInputId === item.id && <small>上次编辑未完成 · 请移回输入框</small>}
            {item.state === 'needs_repair' && <small>需要处理</small>}
          </div>
          <span className="pending-input-actions">
            <button type="button" className="pending-input-edit" disabled={disabled} onClick={() => onEdit(item)}
              aria-label={`编辑待发送消息：${label}`} title="移回输入框编辑（覆盖当前内容）">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 11.9.7-3.2 6.8-6.8a1.25 1.25 0 0 1 1.8 0l1.6 1.6a1.25 1.25 0 0 1 0 1.8L6.3 12l-3.1.7Z" /><path d="m9.8 2.8 3.4 3.4" /></svg>
            </button>
            <button type="button" className="pending-input-delete" disabled={disabled} onClick={() => onDelete(item)}
              aria-label={`删除待发送消息：${label}`} title="删除">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
            </button>
          </span>
          {item.lastAttemptErrorCode && <p className="pending-input-error">{pendingError(item.lastAttemptErrorCode)}</p>}
        </li>
      })}
    </ul>
  </section>
}

export const PendingCampInputs = forwardRef<PendingCampInputsHandle, {
  campId: string
  refreshKey: number
  executionActive: boolean
  disabled: boolean
  submittedInputIds?: string[]
  onQueueChange(queue: CampPendingInputsView): void
  onReturnToComposer(item: PendingCampInputView, editToken: string | null): Promise<void>
}>(function PendingCampInputs({ campId, refreshKey, executionActive, disabled,
  submittedInputIds = [], onQueueChange, onReturnToComposer }, ref) {
  const [queue, setQueue] = useState<CampPendingInputsView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const mounted = useRef(false)
  const readerRef = useRef<ReturnType<typeof createPendingInputsRefresh> | null>(null)
  const callbacks = useRef({ onQueueChange, submittedInputIds })
  callbacks.current = { onQueueChange, submittedInputIds }
  const submittedKey = JSON.stringify(submittedInputIds)
  const refresh = useCallback(() => readerRef.current?.refresh() ?? Promise.resolve(), [])

  useImperativeHandle(ref, () => ({ async prepareForLeave() {
    if (busyRef.current) throw new Error('待发送消息正在移回或删除，请稍后再离开。')
  } }), [])

  useEffect(() => {
    mounted.current = true
    const reader = createPendingInputsRefresh(
      () => window.rovai.request<CampPendingInputsView>('camp.pendingInputs.get', {
        campId, submittedInputIds: callbacks.current.submittedInputIds
      }),
      (next) => { if (next.campId === campId) { setQueue(next); callbacks.current.onQueueChange(next) } }
    )
    readerRef.current = reader
    const invalidate = (): void => { void reader.refresh().catch(() => undefined) }
    const foreground = (): void => { if (document.visibilityState !== 'hidden') invalidate() }
    const unsubscribe = window.rovai.onEvent((event) => { if (shouldRefreshPendingInputs(event, campId)) invalidate() })
    window.addEventListener('focus', foreground)
    document.addEventListener('visibilitychange', foreground)
    invalidate()
    return () => {
      mounted.current = false
      reader.dispose()
      readerRef.current = null
      unsubscribe()
      window.removeEventListener('focus', foreground)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [campId])
  useEffect(() => { void refresh().catch(() => undefined) }, [refresh, refreshKey, executionActive, submittedKey])

  const perform = async (item: PendingCampInputView, remove: boolean): Promise<void> => {
    if (busyRef.current || disabled) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const editToken = queue?.editSession?.pendingInputId === item.id ? queue.editSession.editToken : null
    try {
      if (remove) {
        const result = await window.rovai.request<StoredCommandResult>('camp.pendingInputs.edit', {
          commandId: crypto.randomUUID(), command: { campId, pendingInputId: item.id,
            expectedRevision: item.revision, editToken, action: { type: 'delete' } }
        })
        if (result.status === 'rejected') throw new Error(pendingError(result.code))
      } else await onReturnToComposer(item, editToken)
    } catch (nextError) {
      if (mounted.current) setError(readErrorMessage(nextError))
    } finally {
      await refresh().catch(() => undefined)
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <>
    {queue && <PendingInputRows queue={queue} disabled={busy || disabled}
      onEdit={(item) => { void perform(item, false) }} onDelete={(item) => { void perform(item, true) }} />}
    {error && <p className="pending-input-notice" role="alert">{error}</p>}
  </>
})
