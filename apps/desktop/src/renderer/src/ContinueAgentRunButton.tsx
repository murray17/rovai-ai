import { useRef, useState } from 'react'
import type { StoredCommandResult } from '@contracts'
import { newCommandId } from '../../shared/command-id'
import { DialogControlIcon } from './AppDialog'
import { useThreadClient, type ThreadClient } from './camp-client'
import { uiAttribute } from './interface-language'

type Submission = {
  commandId: string
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
  const requests = unresolved.get(client) ?? new Map<string, Submission>()
  unresolved.set(client, requests)
  const requestKey = `${threadId}:${agentRunId}`
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(() => requests.has(requestKey))

  const submit = async (): Promise<void> => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    const request = requests.get(requestKey) ?? { commandId: newCommandId() }
    requests.set(requestKey, request)
    try {
      request.response ??= client.request<StoredCommandResult>('agentRuns.continue', {
        commandId: request.commandId,
        command: { threadId, agentRunId }
      })
      const result = await request.response
      if (requests.get(requestKey) === request) requests.delete(requestKey)
      setUncertain(false)
      if (result.status === 'rejected') onError(uiAttribute('当前执行无法继续，请刷新后查看。'))
    } catch {
      request.response = undefined
      // Transport failure is not proof of rejection. The next click reconciles
      // this exact authorization; it must not create a second request.
      setUncertain(true)
      onError(uiAttribute('未确认提交结果，请再次点击核对。'))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  const label = busy ? uiAttribute('正在提交') : uncertain ? uiAttribute('确认提交结果') : uiAttribute('继续执行')
  return <button className="execution-continue" type="button" title={label}
    aria-label={label} aria-busy={busy || undefined} disabled={busy}
    onClick={() => void submit()}>
    <DialogControlIcon name="refresh" />
  </button>
}
