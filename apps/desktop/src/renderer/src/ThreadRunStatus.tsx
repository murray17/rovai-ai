import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AgentRunView, ThreadSnapshot } from '@contracts'
import { agentRunStatus, type AgentRunStatus } from './ui-model'

export type ThreadRunStatusReader = (run: AgentRunView, cancelling?: boolean) => AgentRunStatus
const ThreadRunStatusContext = createContext<ThreadRunStatusReader>((run, cancelling) => agentRunStatus(run, { cancelling }))
export const useThreadRunStatus = (): ThreadRunStatusReader => useContext(ThreadRunStatusContext)

/** Every Thread surface, including portals, reads the same pending actions for this snapshot. */
export function ThreadRunStatusProvider({ approvals, nativeInteractions, children }:
  Pick<ThreadSnapshot, 'approvals' | 'nativeInteractions'> & { children: ReactNode }) {
  const [expiryTick, setExpiryTick] = useState(0)
  const { read, nextExpiry } = useMemo(() => {
    const approvalRuns = new Set(approvals.filter(item => item.status === 'pending').map(item => item.agentRunId))
    const questionEpochs = new Map<string, Set<number>>()
    const now = Date.now()
    let nextExpiry = Infinity
    for (const item of nativeInteractions ?? []) {
      if (item.status !== 'pending' || (item.expiresAt !== null && item.expiresAt <= now)) continue
      const epochs = questionEpochs.get(item.agentRunId) ?? new Set<number>()
      epochs.add(item.executionEpoch)
      questionEpochs.set(item.agentRunId, epochs)
      nextExpiry = Math.min(nextExpiry, item.expiresAt ?? Infinity)
    }
    const read: ThreadRunStatusReader = (run, cancelling) => agentRunStatus(run, {
      cancelling, pendingApproval: approvalRuns.has(run.id), pendingQuestion: questionEpochs.get(run.id)?.has(run.executionEpoch)
    })
    return { read, nextExpiry }
  }, [approvals, nativeInteractions, expiryTick])
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return
    const timer = window.setTimeout(() => setExpiryTick(value => value + 1), Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now())))
    return () => window.clearTimeout(timer)
  }, [nextExpiry, expiryTick])
  return <ThreadRunStatusContext.Provider value={read}>{children}</ThreadRunStatusContext.Provider>
}
