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
function latestIds(records: Map<string, AutomationView>, filter: AutomationFilter, query: string): string[] {
  return filterAutomations([...records.values()], filter, query).sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1
    return a.automationId === b.automationId ? 0 : a.automationId > b.automationId ? -1 : 1
  }).map(task => task.automationId)
}

export function changeAutomationList(list: AutomationList, change: AutomationListChange): AutomationList {
  switch (change.type) {
    case 'criteria': {
      const { filter, query } = change
      if (filter === list.filter && query === list.query) return list
      return { ...list, filter, query, visibleIds: latestIds(list.records, filter, query) }
    }
    case 'loaded': {
      const records = new Map(change.tasks.map(task => [task.automationId, task]))
      const retained = list.visibleIds.filter(id => records.has(id))
      // Keep membership as well as position. An old task matching the filter for the first time is not a creation.
      const visibleIds = list.initialized
        ? [...records.keys()].filter(id => !list.records.has(id)).concat(retained)
        : retained.concat(latestIds(records, list.filter, list.query).filter(id => !list.records.has(id)))
      return { ...list, records, visibleIds, initialized: true }
    }
    case 'created':
    case 'saved': {
      const task = change.task
      const previous = list.records.get(task.automationId)
      if (!previous && change.type === 'saved') return list
      if (previous && (previous.version > task.version ||
          (previous.version === task.version && previous.updatedAt >= task.updatedAt))) return list
      const records = new Map(list.records).set(task.automationId, task)
      const visibleIds = change.type === 'created' && !previous ? [task.automationId, ...list.visibleIds] : list.visibleIds
      return { ...list, records, visibleIds }
    }
    case 'deleted': {
      const records = new Map(list.records)
      records.delete(change.id)
      return { ...list, records, visibleIds: list.visibleIds.filter(id => id !== change.id) }
    }
  }
}
