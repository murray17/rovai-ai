import { useEffect, useState } from 'react'
import type { AgentRunExecutionBlockPage } from '@contracts'
import { useThreadClient } from './camp-client'
import { runtimeThinkingTitleText } from './ui-model'

type Phase = Pick<AgentRunExecutionBlockPage, 'runtimePhase' | 'runtimeThinkingTitle'>

/** Restore ephemeral feedback on open/reconnect; never read or retain reasoning. */
export function useRuntimePhase(threadId: string, run: {
  id: string; executionEpoch: number; status: string; cancelRequestedAt: string | null
}, enabled = true): Phase {
  const client = useThreadClient()
  const active = enabled && run.status === 'running' && !run.cancelRequestedAt
  const key = `${threadId}\0${run.id}\0${run.executionEpoch}`
  const [value, setValue] = useState<{ key: string; phase: Phase } | null>(null)
  useEffect(() => {
    if (!active) { setValue(null); return }
    let disposed = false
    let revision = 0
    const apply = (phase: Phase): void => {
      if (!disposed) setValue({ key, phase: { runtimePhase: phase.runtimePhase,
        runtimeThinkingTitle: phase.runtimePhase === 'thinking'
          ? runtimeThinkingTitleText(phase.runtimeThinkingTitle) : null } })
    }
    const refresh = async (): Promise<void> => {
      const requested = ++revision
      try {
        const page = await client.request<AgentRunExecutionBlockPage>('agentRunExecution.page', {
          threadId, agentRunId: run.id, projection: 'blocks', limit: 1
        })
        if (requested === revision) apply(page)
      } catch { /* Run status and existing evidence remain authoritative. */ }
    }
    const unlisten = client.onEvent?.(event => {
      if (event.method !== 'agent_run.runtime_phase_changed') return
      const params = event.params as Record<string, unknown> | null
      if (params?.agentRunId !== run.id || params.executionEpoch !== run.executionEpoch) return
      if (params.phase !== 'thinking' && params.phase !== 'executing') return
      ++revision
      apply({ runtimePhase: params.phase, runtimeThinkingTitle: runtimeThinkingTitleText(params.thinkingTitle) })
    })
    const invalidate = client.onInvalidated?.(() => { void refresh() })
    void refresh()
    return () => { disposed = true; ++revision; unlisten?.(); invalidate?.() }
  }, [active, client, key, threadId, run.id, run.executionEpoch])
  return active && value?.key === key ? value.phase : {}
}
