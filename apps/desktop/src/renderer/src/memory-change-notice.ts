import type { DomainEventView, MemoryScopeKind, MemoryCapabilitySnapshot } from '@contracts'
import { uiAttribute } from './interface-language'

export interface MemoryChange {
  memoryId: string
  action: 'created' | 'updated'
  scope: MemoryScopeKind | null
  actorId: string | null
  sequence: number
}

/** Apply a re-enable boundary to notices already displayed, before merging. */
export function memoryChangesAfter(changes: MemoryChange[], afterGlobalSequence: number): MemoryChange[] {
  return changes.some(change => change.sequence <= afterGlobalSequence)
    ? changes.filter(change => change.sequence > afterGlobalSequence) : changes
}

/** Only the existing Memory event clock defines notice freshness. */
export function memoryEventsForNotice(
  events: readonly DomainEventView[], capability: MemoryCapabilitySnapshot | null,
  active: boolean, afterGlobalSequence: number
): DomainEventView[] {
  if (!active || !capability?.enabled) return []
  const floor = Math.max(afterGlobalSequence, capability.headsUpAfterGlobalSequence)
  return events.filter(event => event.globalSequence > floor && (
    event.eventType === 'memory.agent_created' || event.eventType === 'memory.agent_revised'
    || event.eventType === 'memory.hearth_review_created'
  ))
}

/** Count changed records, not repeated revisions of the same record. */
export function collectMemoryChanges(current: readonly MemoryChange[], events: readonly DomainEventView[]): MemoryChange[] {
  const changes = new Map(current.map(change => [change.memoryId, change]))
  for (const event of events) {
    if (event.eventType !== 'memory.agent_created' && event.eventType !== 'memory.agent_revised') continue
    const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {}
    const memoryId = typeof payload.memoryId === 'string' ? payload.memoryId : event.entityType === 'memory' ? event.entityId : null
    if (!memoryId) continue
    const previous = changes.get(memoryId)
    if (previous && previous.sequence >= event.globalSequence) continue
    const scope = payload.scope === 'hearth' || payload.scope === 'companion' || payload.scope === 'relationship' ? payload.scope : null
    changes.set(memoryId, {
      memoryId,
      action: previous?.action === 'created' || event.eventType === 'memory.agent_created' ? 'created' : 'updated',
      // Scope may be reused only for this same immutable Memory identity.
      scope: scope ?? previous?.scope ?? null,
      actorId: event.actorType === 'agent' ? event.actorId : null,
      sequence: event.globalSequence
    })
  }
  return [...changes.values()].sort((left, right) => left.sequence - right.sequence)
}

export function resolveMemoryChangeScope(current: MemoryChange[], memoryId: string, sequence: number, scope: MemoryScopeKind | null): MemoryChange[] {
  // A late lookup must neither restore a dismissed notice nor overwrite a later event.
  return current.map(change => change.memoryId === memoryId && change.sequence === sequence ? { ...change, scope } : change)
}

export function memoryChangeText(changes: readonly MemoryChange[], actorName?: string): string {
  if (changes.length === 0) return ''
  const created = changes.filter(change => change.action === 'created').length
  const updated = changes.length - created
  if (changes.length > 1) return created && updated
    ? uiAttribute('新增 {0} 条 · 更新 {1} 条记忆', created, updated)
    : created ? uiAttribute('新增 {0} 条记忆', created) : uiAttribute('更新 {0} 条记忆', updated)
  const change = changes[0]
  const scope = change.scope === 'hearth' ? uiAttribute('共同记忆') : change.scope === 'companion' ? uiAttribute('队员记忆') : change.scope === 'relationship' ? uiAttribute('队员间记忆') : uiAttribute('记忆')
  const text = change.action === 'created' ? uiAttribute('新增 1 条{0}', scope) : uiAttribute('{0}已更新', scope)
  return actorName ? `${actorName} · ${text}` : text
}
