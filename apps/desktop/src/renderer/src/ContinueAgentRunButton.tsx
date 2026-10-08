import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { AppDialogContent, AppDialogFooter, AppDialogHeader, DialogControlIcon } from './AppDialog'
import { useThreadClient, type ThreadClient } from './camp-client'
import { uiAttribute, UiText } from './interface-language'

type Submission = {
  commandId: string
  useNewSession: boolean
  response?: Promise<StoredCommandResult>
}
// Keep unresolved identity when the drawer unmounts. Two views of the same
// source share an in-flight request; a later deliberate click gets a new ID.
const unresolved = new WeakMap<ThreadClient, Map<string, Submission>>()

/** Submission state belongs to this action, never to the terminal source Run. */
export function ContinueAgentRunButton({ threadId, agentRunId, onError }: {
  threadId: string
  agentRunId: string
  onError: (message: string) => void
}): React.JSX.Element {
  const client = useThreadClient()
  const button = useRef<HTMLButtonElement>(null)
  const requests = unresolved.get(client) ?? new Map<string, Submission>()
  unresolved.set(client, requests)
  const requestKey = `${threadId}:${agentRunId}`
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(() => requests.has(requestKey))
  const [confirmNewSession, setConfirmNewSession] = useState(false)

  const submit = async (useNewSession = false): Promise<void> => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    const request = requests.get(requestKey) ?? { commandId: newCommandId(), useNewSession }
    requests.set(requestKey, request)
    try {
      request.response ??= client.request<StoredCommandResult>('agentRuns.continue', {
        commandId: request.commandId,
        command: { threadId, agentRunId, useNewSession: request.useNewSession }
      })
      const result = await request.response
      if (requests.get(requestKey) === request) requests.delete(requestKey)
      setUncertain(false)
      if (result.code === 'agent_run.new_session_confirmation_required') {
        setConfirmNewSession(true)
      } else {
        setConfirmNewSession(false)
        if (result.status === 'rejected') onError(uiAttribute('当前执行无法继续，请刷新后查看。'))
      }
    } catch {
      request.response = undefined
      // Transport failure is not proof of rejection. The next click reconciles
      // this exact authorization; it must not create a second request.
      setUncertain(true)
      setConfirmNewSession(false)
      onError(uiAttribute('未确认提交结果，请再次点击核对。'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const label = busy ? uiAttribute('正在提交') : uncertain ? uiAttribute('确认提交结果') : uiAttribute('继续执行')
  return <>
    <button ref={button} className="execution-continue" type="button" title={label}
      aria-label={label} aria-busy={busy || undefined} disabled={busy || confirmNewSession}
      onClick={() => void submit()}>
      <DialogControlIcon name="refresh" />
    </button>
    <Dialog.Root open={confirmNewSession} onOpenChange={(open) => { if (!busy) setConfirmNewSession(open) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <AppDialogContent tone="neutral" onCloseAutoFocus={(event) => {
          event.preventDefault()
          requestAnimationFrame(() => button.current?.focus())
        }}>
          <AppDialogHeader title={uiAttribute('使用新会话继续')}
            description={uiAttribute('原会话无法恢复，将使用新会话继续。当前工作区会保留。')}
            closeLabel={uiAttribute('关闭')} closeDisabled={busy} />
          <AppDialogFooter>
            <Dialog.Close asChild><button type="button" className="quiet-button" disabled={busy}><UiText zh="取消" /></button></Dialog.Close>
            <button type="button" className="primary-button conversation-primary-button" disabled={busy} data-dialog-autofocus onClick={() => void submit(true)}>
              <UiText zh={busy ? '正在提交' : '使用新会话继续'} />
            </button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
