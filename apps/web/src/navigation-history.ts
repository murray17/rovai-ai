import type { NavigationHistory, NavigationState, NavigationTarget } from '../../desktop/src/renderer/src/desktop-navigation'

// The browser owns traversal. This is a projection for button availability,
// refresh and guarded popstate recovery, never a second independently moving stack.
export function createBrowserNavigationHistory(scope: string, host: Window = window): NavigationHistory {
  const key = `rovai.web.history.v1:${scope}`
  const parse = (value: unknown): NavigationState | null => {
    if (!value || typeof value !== 'object') return null
    const candidate = value as NavigationState
    return Array.isArray(candidate.entries) && candidate.entries.length > 0
      && Number.isInteger(candidate.index) && candidate.index >= 0 && candidate.index < candidate.entries.length
      && candidate.entries.every(isTarget) ? candidate : null
  }
  let stored: NavigationState | null = null
  let ids: string[] = []
  try { const saved = JSON.parse(host.sessionStorage.getItem(key) ?? 'null'); stored = parse(saved?.snapshot); ids = Array.isArray(saved?.ids) ? saved.ids : [] } catch { /* Invalid old presentation state is discarded. */ }
  const marker = () => host.history.state?.rovai as { scope?: string; id?: string; target?: unknown } | undefined
  const initialMarker = marker()
  if (initialMarker?.scope === scope && stored && ids.length === stored.entries.length && ids.includes(initialMarker.id ?? '')) stored = { ...stored, index: ids.indexOf(initialMarker.id!) }
  else if (initialMarker?.scope && initialMarker.scope !== scope && isTarget(initialMarker.target)) {
    // A copied tab inherits its current page, but starts a separate editor/history scope.
    stored = { entries: [initialMarker.target], index: 0 }; ids = [newId()]
    host.history.replaceState({ rovai: { scope, id: ids[0], target: initialMarker.target } }, '')
  } else { stored = null; ids = [] }
  let committed = stored
  let physicalIndex = stored?.index ?? 0
  let sequence = 0
  let rollback: number | null = null
  let apply: ((state: NavigationState) => Promise<NavigationState | null>) | null = null
  let waiting: Array<(value: boolean) => void> = []
  const persist = () => { if (committed) host.sessionStorage.setItem(key, JSON.stringify({ snapshot: committed, ids })) }
  if (stored) persist()
  const finish = (value: boolean) => { const callbacks = waiting; waiting = []; callbacks.forEach(done => done(value)) }
  const pop = async (): Promise<void> => {
    const current = marker()
    if (current?.scope !== scope || !committed || !ids.includes(current.id ?? '') || !isTarget(current.target)) return
    physicalIndex = ids.indexOf(current.id!)
    if (rollback === physicalIndex) { rollback = null; finish(false); return }
    const request = ++sequence
    const before = committed
    const entries = [...before.entries]
    if (physicalIndex < 0 || physicalIndex >= entries.length) return
    // Stored page repairs may be newer than an inactive native history marker.
    const next = { entries, index: physicalIndex }
    const accepted = await apply?.(next).catch(() => null)
    if (request !== sequence) return
    if (accepted) {
      committed = accepted
      host.history.replaceState({ rovai: { scope, id: ids[accepted.index], target: accepted.entries[accepted.index] } }, '')
      persist(); finish(true)
    }
    else {
      rollback = before.index
      if (rollback === physicalIndex) { rollback = null; finish(false) }
      else host.history.go(rollback - physicalIndex)
    }
  }
  return {
    initial: stored,
    write(next, mode) {
      if (mode === 'repair') {
        // Repair the displayed entry without cancelling an in-flight native traversal.
        committed = next
        if (physicalIndex === next.index) host.history.replaceState({ rovai: { scope, id: ids[next.index], target: next.entries[next.index] } }, '')
        persist()
        return next
      }
      ++sequence; rollback = null; finish(false)
      // Keep native history entries addressable; only Desktop applies its window cap.
      if (mode === 'push' && committed && physicalIndex !== committed.index) {
        const entries = [...committed.entries.slice(0, physicalIndex + 1), next.entries[next.index]]
        next = { entries, index: entries.length - 1 }
      }
      if (mode === 'push' && committed) ids = [...ids.slice(0, physicalIndex + 1), newId()].slice(-next.entries.length)
      else if (!committed) ids = next.entries.map(() => newId())
      const state = { rovai: { scope, id: ids[next.index], target: next.entries[next.index] } }
      if (mode === 'push' && committed) host.history.pushState(state, '')
      else host.history.replaceState(state, '')
      committed = next; physicalIndex = next.index; persist()
      return next
    },
    go(delta) {
      if (!committed || rollback !== null) return Promise.resolve(false)
      const index = physicalIndex + delta
      if (index < 0 || index >= committed.entries.length) return Promise.resolve(false)
      return new Promise(resolve => { waiting.push(resolve); host.history.go(delta) })
    },
    listen(listener) {
      apply = listener
      host.addEventListener('popstate', pop)
      return () => { apply = null; ++sequence; finish(false); host.removeEventListener('popstate', pop) }
    }
  }
}

function isTarget(value: unknown): value is NavigationTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  switch (target.kind) {
    case 'quick_chat': case 'automations': case 'missions': return true
    case 'camp': return typeof target.campId === 'string'
    case 'members': return (target.agentId === null || typeof target.agentId === 'string') && ['identity', 'runtime', 'skills', 'mcp'].includes(String(target.tab))
    case 'memory': return target.memoryId === null || typeof target.memoryId === 'string'
    case 'settings': return typeof target.section === 'string' && (target.overview === undefined || target.overview === true)
    default: return false
  }
}

function newId(): string { return [...crypto.getRandomValues(new Uint8Array(12))].map(v => v.toString(16).padStart(2, '0')).join('') }
