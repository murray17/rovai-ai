import type { AutomationView } from '@contracts'
import { filterAutomations, type AutomationFilter } from './automation-workspace-model'

export interface AutomationList {
  records: Map<string, AutomationView>
  visibleIds: string[]
  filter: AutomationFilter
  query: string
  initialized: boolean
}

export function emptyAutomationList(): AutomationList {
  return { records: new Map(), visibleIds: [], filter: 'all', query: '', initialized: false }
}

export type AutomationListChange =
  | { type: 'loaded'; tasks: AutomationView[] }
  | { type: 'saved' | 'created'; task: AutomationView }
  | { type: 'deleted'; id: string }
  | { type: 'criteria'; filter: AutomationFilter; query: string }

// Mirrors Core's ORDER BY updated_at DESC, id DESC, including between a command receipt and the next list read.
function matchingIdsByUpdateTime(tasks: AutomationView[], filter: AutomationFilter, query: string): string[] {
  return filterAutomations(tasks, filter, query).sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1
    return a.automationId === b.automationId ? 0 : a.automationId > b.automationId ? -1 : 1
  }).map(task => task.automationId)
}

export function changeAutomationList(list: AutomationList, change: AutomationListChange): AutomationList {
  switch (change.type) {
    case 'criteria': {
      const { filter, query } = change
      if (filter === list.filter && query === list.query) return list
      return { ...list, filter, query, visibleIds: matchingIdsByUpdateTime([...list.records.values()], filter, query) }
    }
    case 'loaded': {
      const records = new Map(change.tasks.map(task => [task.automationId, task]))
      const retained = list.visibleIds.filter(id => records.has(id))
      const unseen = [...records.values()].filter(task => !list.records.has(task.automationId))
      const matching = matchingIdsByUpdateTime(unseen, list.filter, list.query)
      // A local create can be acknowledged before the initial read finishes.
      const visibleIds = list.initialized ? [...matching, ...retained] : [...retained, ...matching]
      return { ...list, records, visibleIds, initialized: true }
    }
    case 'created':
    case 'saved': {
      const task = change.task
      const previous = list.records.get(task.automationId)
      if (!previous && change.type === 'saved') return list
      const newer = !previous || task.version > previous.version ||
        (task.version === previous.version && task.updatedAt > previous.updatedAt)
      const records = newer ? new Map(list.records).set(task.automationId, task) : list.records
      // A create receipt identifies this window as the creator, even when a refresh arrived first.
      const visibleIds = change.type === 'created' && list.visibleIds[0] !== task.automationId
        ? [task.automationId, ...list.visibleIds.filter(id => id !== task.automationId)]
        : list.visibleIds
      if (records === list.records && visibleIds === list.visibleIds) return list
      return { ...list, records, visibleIds }
    }
    case 'deleted': {
      const records = new Map(list.records)
      records.delete(change.id)
      return { ...list, records, visibleIds: list.visibleIds.filter(id => id !== change.id) }
    }
  }
}
