import { filePreviewRetentionLimits } from '../../file-preview-retention'

export const EXECUTION_OVERVIEW_SCOPE = '__execution_overview__'

// Renderer memory only: keep the last Tab, without retaining a Run or its view state.
const selectedTabs = new Map<string, string>()

export function rememberExecutionTab(threadId: string, agentId: string): void {
  selectedTabs.delete(threadId)
  selectedTabs.set(threadId, agentId)
  while (selectedTabs.size > filePreviewRetentionLimits.snapshots) {
    selectedTabs.delete(selectedTabs.keys().next().value!)
  }
}

export function restoredExecutionTab(threadId: string, agentIds: Iterable<string>): string {
  const saved = selectedTabs.get(threadId)
  return saved && (saved === EXECUTION_OVERVIEW_SCOPE || new Set(agentIds).has(saved))
    ? saved
    : EXECUTION_OVERVIEW_SCOPE
}
