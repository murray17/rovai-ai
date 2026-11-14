import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MemoryCapabilitySnapshot } from '@contracts'
import type { ThreadClient } from './camp-client'

interface MemoryObservation {
  version: number
  changeSequence: number
}
interface MemoryCapability extends MemoryCapabilitySnapshot {
  ready: boolean
  active: boolean
  saving: boolean
  error: 'read' | 'save' | null
  setEnabled(enabled: boolean): Promise<void>
  retry(): Promise<void>
  beginObservation(): MemoryObservation
  acceptSnapshot(snapshot: MemoryCapabilitySnapshot | null, observation: MemoryObservation): MemoryCapabilitySnapshot | null
}
const initialSnapshot: MemoryCapabilitySnapshot = { enabled: false, headsUpAfterGlobalSequence: 0, observedThroughChangeSequence: 0 }
const unavailable: MemoryCapability = { ...initialSnapshot, ready: false, active: false, saving: false, error: null, setEnabled: async () => {}, retry: async () => {}, beginObservation: () => ({ version: 0, changeSequence: 0 }), acceptSnapshot: () => null }
const Context = createContext<MemoryCapability>(unavailable)
export const useMemoryCapability = (): MemoryCapability => useContext(Context)

export function validMemoryCapability(next: MemoryCapabilitySnapshot): boolean {
  return typeof next?.enabled === 'boolean'
    && Number.isSafeInteger(next.headsUpAfterGlobalSequence) && next.headsUpAfterGlobalSequence >= 0
    && Number.isSafeInteger(next.observedThroughChangeSequence)
    && next.observedThroughChangeSequence >= 0
}

/** One Host projection shared by settings and notification responses. The Core
 * clock orders snapshots; a failed read is not a confirmed disable. */
export function MemoryCapabilityProvider({ client, children }: { client: ThreadClient; children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState({ client, ...initialSnapshot, ready: false, saving: false, error: null as MemoryCapability['error'] })
  const current = useRef(client)
  // A return to a cached client is still a new Host visit.
  const clientGeneration = useRef(0)
  const version = useRef(0)
  const latest = useRef<{ snapshot: MemoryCapabilitySnapshot; observation: number; available: boolean } | null>(null)
  const pendingSave = useRef<boolean | null>(null)
  const saving = useRef(false)
  if (current.current !== client) {
    current.current = client
    clientGeneration.current++
    version.current++
    latest.current = null
    pendingSave.current = null
    saving.current = false
  }
  const generation = clientGeneration.current
  const beginObservation = useCallback((): MemoryObservation => ({
    version: ++version.current,
    changeSequence: latest.current?.snapshot.observedThroughChangeSequence ?? 0
  }), [])
  const acceptSnapshot = useCallback((next: MemoryCapabilitySnapshot | null, observation: MemoryObservation): MemoryCapabilitySnapshot | null => {
    if (current.current !== client || generation !== clientGeneration.current) return null
    if (next !== null && !validMemoryCapability(next)) throw new Error('Invalid Memory capability')
    const previous = latest.current
    const sequence = previous?.snapshot.observedThroughChangeSequence ?? 0
    // A newer Core setting wins even if its request started earlier. Within the
    // same setting, get, event snapshots and failures share observation order.
    if ((next !== null && next.observedThroughChangeSequence < sequence)
      || ((next === null || next.observedThroughChangeSequence === sequence)
        && ((previous && observation.version < previous.observation)
          || (next === null && observation.changeSequence < sequence)))) {
      return previous?.available ? previous.snapshot : null
    }
    latest.current = { snapshot: next ?? previous?.snapshot ?? initialSnapshot, observation: observation.version, available: next !== null }
    if (next === null) {
      setState(old => !old.ready && old.error ? old : { ...old, ready: false, error: old.error === 'save' ? 'save' : 'read' })
      return null
    }
    setState(old => old.client === client && old.ready
      && old.enabled === next.enabled && old.headsUpAfterGlobalSequence === next.headsUpAfterGlobalSequence
      && old.observedThroughChangeSequence === next.observedThroughChangeSequence && old.error !== 'read'
      ? old : { ...old, client, ...next, ready: true, error: old.error === 'save' ? 'save' : null })
    return next
  }, [client, generation])
  const reload = useCallback(async () => {
    const observation = beginObservation()
    try {
      const next = await client.request<MemoryCapabilitySnapshot>('preferences.memory.get', {})
      acceptSnapshot(next, observation)
    } catch {
      acceptSnapshot(null, observation)
    }
  }, [client, beginObservation, acceptSnapshot])
  useEffect(() => {
    setState({ client, ...initialSnapshot, ready: false, saving: false, error: null })
    void reload()
    const event = client.onEvent?.(value => { if (value.method === 'preferences.memory_changed') void reload() })
    const invalidation = client.onInvalidated?.(change => {
      if (!change || change.resync || change.memoryChanged) void reload()
    })
    const focus = (): void => { void reload() }
    window.addEventListener('focus', focus)
    return () => { version.current++; event?.(); invalidation?.(); window.removeEventListener('focus', focus) }
  }, [client, reload])
  const setEnabled = useCallback(async (enabled: boolean) => {
    if (saving.current) return
    saving.current = true
    pendingSave.current = enabled
    const observation = beginObservation()
    setState(old => ({ ...old, client, saving: true, error: null }))
    try {
      const next = await client.request<MemoryCapabilitySnapshot>('preferences.memory.set', { enabled })
      if (current.current !== client || generation !== clientGeneration.current) return
      acceptSnapshot(next, observation)
      pendingSave.current = null
      setState(old => old.error === 'save' ? { ...old, error: old.ready ? null : 'read' } : old)
      void reload()
    } catch {
      if (current.current === client && generation === clientGeneration.current) {
        setState(old => ({ ...old, error: 'save' }))
        acceptSnapshot(null, observation)
        void reload()
      }
    } finally {
      if (current.current === client && generation === clientGeneration.current) { saving.current = false; setState(old => ({ ...old, saving: false })) }
    }
  }, [client, generation, reload, beginObservation, acceptSnapshot])
  const value = state.client === client ? state : { ...unavailable, client }
  return <Context.Provider value={{ ...value, active: value.ready && value.enabled, setEnabled, beginObservation, acceptSnapshot, retry: () => pendingSave.current === null ? reload() : setEnabled(pendingSave.current) }}>{children}</Context.Provider>
}
