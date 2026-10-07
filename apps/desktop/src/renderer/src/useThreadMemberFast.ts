import { newCommandId } from '../../shared/command-id'
import { useThreadClient } from './camp-client'
import { useLayoutEffect, useRef, useState } from 'react'
import type { AdapterInstallation, AgentProfile, ThreadMemberFastView, ThreadSnapshot, StoredCommandResult } from '@contracts'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { readErrorMessage } from './error-message'

type FastEntry = {
  scope: string
  projection: string
  value: ThreadMemberFastView | null | undefined
}

export type ThreadMemberFastControls = {
  get(agentId: string): { value: ThreadMemberFastView | null | undefined; pending: boolean } | undefined
  save(agentId: string, fastOverride: boolean): Promise<void>
}

// One workspace owns both surfaces. Writes are coalesced per Thread/member,
// while entry identity fences late results after a binding, projection or Thread change.
export function useThreadMemberFast(
  snapshot: ThreadSnapshot,
  profiles: Map<string, AgentProfile>,
  installations: AdapterInstallation[],
  onNotify: (message: string) => void
): ThreadMemberFastControls {
  const client = useThreadClient()
  const [, refresh] = useState(0)
  const entries = useRef(new Map<string, FastEntry>())
  const saves = useRef(new Set<string>())
  const mounted = useRef(false)
  const targets = new Map(snapshot.members.flatMap(member => {
    const profile = profiles.get(member.agentId)
    const runtime = profile?.runtimeConfiguration
    if (member.membershipStatus !== 'active' || member.profilePresence !== 'present' || member.leaveRequestedAt
      || (runtime?.adapterKind !== 'claude-code-cli' && runtime?.adapterKind !== 'codex-cli')) return []
    const installation = runtimeEditorInstallation(installations, runtime.adapterKind)
    const scope = JSON.stringify([
      snapshot.thread.id, snapshot.thread.projectPath, member.membershipStatus, member.profilePresence,
      member.fast?.runtimeBindingRevision, runtime.adapterKind,
      installation?.id, installation?.authScope, installation?.executablePath
    ])
    return [[member.agentId, { scope, projection: JSON.stringify(member.fast ?? null), value: member.fast }]] as const
  }))
  const requestKey = (agentId: string) => JSON.stringify([snapshot.thread.id, agentId])
  const changed = () => { if (mounted.current) refresh(current => current + 1) }
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useLayoutEffect(() => {
    for (const agentId of entries.current.keys()) {
      if (!targets.has(agentId)) entries.current.delete(agentId)
    }
    for (const [agentId, target] of targets) {
      const previous = entries.current.get(agentId)
      if (previous?.scope === target.scope && previous.projection === target.projection) continue
      entries.current.set(agentId, {
        scope: target.scope, projection: target.projection,
        // Profile refresh can arrive before the Thread projection. Never reuse the old
        // projection for a changed binding merely because the same object is still present.
        value: previous && previous.scope !== target.scope && previous.projection === target.projection
          ? undefined : target.value
      })
    }
  })
  const get: ThreadMemberFastControls['get'] = agentId => {
    const target = targets.get(agentId)
    if (!target) return undefined
    const entry = entries.current.get(agentId)
    const value = entry?.scope === target.scope && entry.projection === target.projection
      ? entry.value
      : entry && entry.scope !== target.scope && entry.projection === target.projection
        ? undefined : target.value
    return { value, pending: saves.current.has(requestKey(agentId)) }
  }
  const save: ThreadMemberFastControls['save'] = async (agentId, fastOverride) => {
    const value = get(agentId)?.value
    const entry = entries.current.get(agentId)
    const key = requestKey(agentId)
    if (!value || !entry || saves.current.has(key)) return
    saves.current.add(key)
    changed()
    try {
      const result = await client.request<StoredCommandResult>('threads.members.fast.set', {
        commandId: newCommandId(),
        command: { threadId: snapshot.thread.id, agentId, expectedRuntimeBindingRevision: value.runtimeBindingRevision, fastOverride }
      })
      const current = entries.current.get(agentId)
      if (!mounted.current || !current || current.scope !== entry.scope) return
      // An initialization-only projection can arrive while this save is pending.
      // Keep its entry, but still apply this receipt unless a newer choice arrived.
      if (current !== entry && current.value?.fastOverride !== value.fastOverride) return
      if (result.status !== 'applied') throw new Error('队员配置已变化，请稍后重试。')
      current.value = (result.payload as { fast?: ThreadMemberFastView | null }).fast ?? null
    } catch (error) {
      const current = entries.current.get(agentId)
      if (mounted.current && current?.scope === entry.scope
        && (current === entry || current.value?.fastOverride === value.fastOverride)) {
        onNotify(readErrorMessage(error, '响应模式未保存，请重试。'))
      }
    } finally { saves.current.delete(key); changed() }
  }
  return { get, save }
}
