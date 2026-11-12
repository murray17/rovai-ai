import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MemoryCapabilitySnapshot } from '@contracts'
import type { ThreadClient } from './camp-client'

interface MemoryCapability extends MemoryCapabilitySnapshot {
  ready: boolean
  active: boolean
  saving: boolean
  error: 'read' | 'save' | null
  setEnabled(enabled: boolean): Promise<void>
  retry(): Promise<void>
  acceptSnapshot(snapshot: MemoryCapabilitySnapshot | null, expectedChangeSequence?: number): MemoryCapabilitySnapshot | null
}
const initialSnapshot: MemoryCapabilitySnapshot = { enabled: false, headsUpAfterGlobalSequence: 0, observedThroughChangeSequence: 0 }
const unavailable: MemoryCapability = { ...initialSnapshot, ready: false, active: false, saving: false, error: null, setEnabled: async () => {}, retry: async () => {}, acceptSnapshot: () => null }
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
  const latest = useRef<MemoryCapabilitySnapshot | null>(null)
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
  const acceptSnapshot = useCallback((next: MemoryCapabilitySnapshot | null, expectedChangeSequence?: number): MemoryCapabilitySnapshot | null => {
    if (current.current !== client || generation !== clientGeneration.current) return null
    if (next === null) {
      if (expectedChangeSequence !== undefined && latest.current
        && latest.current.observedThroughChangeSequence > expectedChangeSequence) return latest.current
      version.current++
      setState(old => old.error === 'read' && !old.ready ? old : { ...old, ready: false, error: old.error === 'save' ? 'save' : 'read' })
      return null
    }
    if (!validMemoryCapability(next)) throw new Error('Invalid Memory capability')
    if (latest.current && next.observedThroughChangeSequence < latest.current.observedThroughChangeSequence) return latest.current
    latest.current = next
    version.current++ // A later failure cannot erase this authoritative snapshot.
    setState(old => old.client === client && old.ready
      && old.enabled === next.enabled && old.headsUpAfterGlobalSequence === next.headsUpAfterGlobalSequence
      && old.observedThroughChangeSequence === next.observedThroughChangeSequence && old.error !== 'read'
      ? old : { ...old, client, ...next, ready: true, error: old.error === 'save' ? 'save' : null })
    return next
  }, [client, generation])
  const reload = useCallback(async () => {
    const request = ++version.current
    try {
      const next = await client.request<MemoryCapabilitySnapshot>('preferences.memory.get', {})
      // A newer unavailable projection need not advance the setting clock.
      // Keep an older read from replacing it; accepted snapshots still use
      // the Core clock for ordering within the current Host.
      if (request !== version.current) return
      acceptSnapshot(next)
    } catch {
      if (current.current === client && generation === clientGeneration.current && request === version.current) {
        setState(old => ({ ...old, error: old.error === 'save' ? 'save' : 'read' }))
      }
    }
  }, [client, generation, acceptSnapshot])
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
    version.current++
    setState(old => ({ ...old, client, saving: true, error: null }))
    try {
      const next = await client.request<MemoryCapabilitySnapshot>('preferences.memory.set', { enabled })
      if (!acceptSnapshot(next)) return
      pendingSave.current = null
      setState(old => ({ ...old, error: null }))
      void reload()
    } catch {
      if (current.current === client && generation === clientGeneration.current) { setState(old => ({ ...old, ready: false, error: 'save' })); void reload() }
    } finally {
      if (current.current === client && generation === clientGeneration.current) { saving.current = false; setState(old => ({ ...old, saving: false })) }
    }
  }, [client, generation, reload, acceptSnapshot])
  const value = state.client === client ? state : { ...unavailable, client }
  return <Context.Provider value={{ ...value, active: value.ready && value.error !== 'read' && value.enabled, setEnabled, acceptSnapshot, retry: () => pendingSave.current === null ? reload() : setEnabled(pendingSave.current) }}>{children}</Context.Provider>
}
