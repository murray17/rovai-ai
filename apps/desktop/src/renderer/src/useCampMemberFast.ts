import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AdapterInstallation, AgentProfile, CampMemberFastView, CampSnapshot, StoredCommandResult } from '@contracts'
import { runtimeEditorInstallation } from './MemberRuntimeParameters'
import { readErrorMessage } from './error-message'

type FastEntry = {
  scope: string
  projection: string
  value: CampMemberFastView | null | undefined
  failed: boolean
}

export type CampMemberFastControls = {
  get(agentId: string): { value: CampMemberFastView | null | undefined; pending: boolean } | undefined
  save(agentId: string, fastOverride: boolean): Promise<void>
}

// One workspace owns both surfaces. Metadata and writes are coalesced per Camp/member,
// while entry identity fences late results after a binding, projection or Camp change.
export function useCampMemberFast(
  snapshot: CampSnapshot,
  profiles: Map<string, AgentProfile>,
  installations: AdapterInstallation[],
  retrySurface: string | null,
  onNotify: (message: string) => void
): CampMemberFastControls {
  const [, refresh] = useState(0)
  const entries = useRef(new Map<string, FastEntry>())
  const checks = useRef(new Set<string>())
  const saves = useRef(new Set<string>())
  const mounted = useRef(false)
  const previousSurface = useRef(retrySurface)
  const targets = new Map(snapshot.members.flatMap(member => {
    const profile = profiles.get(member.agentId)
    const runtime = profile?.runtimeConfiguration
    if (member.membershipStatus !== 'active' || member.profilePresence !== 'present' || member.leaveRequestedAt
      || (runtime?.adapterKind !== 'claude-code-cli' && runtime?.adapterKind !== 'codex-cli')) return []
    const installation = runtimeEditorInstallation(installations, runtime.adapterKind)
    const scope = JSON.stringify([
      snapshot.camp.id, snapshot.camp.projectPath, member.membershipStatus, member.profilePresence,
      member.fast?.runtimeBindingRevision, profile?.version, runtime.adapterKind, runtime.model,
      installation?.id, installation?.authScope, installation?.executablePath, installation?.enabled,
      installation?.generation, installation?.snapshot?.executableFingerprint,
      installation?.snapshot?.authenticationStatus, installation?.snapshot?.probeStatus,
      installation?.snapshot?.lastSuccessfulProbeAt, installation?.snapshot?.staleAt
    ])
    return [[member.agentId, { scope, projection: JSON.stringify(member.fast ?? null), value: member.fast }]] as const
  }))
  const requestKey = (agentId: string) => JSON.stringify([snapshot.camp.id, agentId])
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
        // Profile refresh can arrive before the Camp projection. Never reuse the old
        // projection for a changed binding merely because the same object is still present.
        value: previous && previous.scope !== target.scope && previous.projection === target.projection
          ? undefined : target.value,
        failed: false
      })
    }
  })
  useEffect(() => {
    const retry = retrySurface !== null && retrySurface !== previousSurface.current
    previousSurface.current = retrySurface
    for (const [agentId, entry] of entries.current) {
      if (retry && entry.failed) { entry.value = undefined; entry.failed = false }
      const key = requestKey(agentId)
      if (entry.value !== undefined || checks.current.has(key)) continue
      checks.current.add(key)
      void window.rovai.request<CampMemberFastView | null>('camps.members.fast.check', {
        campId: snapshot.camp.id, agentId
      }).then(value => {
        if (entries.current.get(agentId) === entry) entry.value = value
      }).catch(() => {
        if (entries.current.get(agentId) !== entry) return
        entry.value = null
        entry.failed = true
      }).finally(() => { checks.current.delete(key); changed() })
    }
  })
  const get: CampMemberFastControls['get'] = agentId => {
    const target = targets.get(agentId)
    if (!target) return undefined
    const entry = entries.current.get(agentId)
    const value = entry?.scope === target.scope && entry.projection === target.projection
      ? entry.value
      : entry && entry.scope !== target.scope && entry.projection === target.projection
        ? undefined : target.value
    return { value, pending: saves.current.has(requestKey(agentId)) }
  }
  const save: CampMemberFastControls['save'] = async (agentId, fastOverride) => {
    const value = get(agentId)?.value
    const entry = entries.current.get(agentId)
    const key = requestKey(agentId)
    if (!value || !entry || saves.current.has(key)) return
    saves.current.add(key)
    changed()
    try {
      const result = await window.rovai.request<StoredCommandResult>('camps.members.fast.set', {
        commandId: crypto.randomUUID(),
        command: { campId: snapshot.camp.id, agentId, expectedRuntimeBindingRevision: value.runtimeBindingRevision, fastOverride }
      })
      if (!mounted.current || entries.current.get(agentId) !== entry) return
      if (result.status !== 'applied') throw new Error('队员配置已变化，请稍后重试。')
      entry.value = (result.payload as { fast?: CampMemberFastView | null }).fast ?? null
    } catch (error) {
      if (mounted.current && entries.current.get(agentId) === entry) {
        onNotify(readErrorMessage(error, '响应模式未保存，请重试。'))
      }
    } finally { saves.current.delete(key); changed() }
  }
  return { get, save }
}
