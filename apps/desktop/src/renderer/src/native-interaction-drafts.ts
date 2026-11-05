// Tab-local recovery only. The current Core list decides which drafts remain valid.
const memory = new Map<string, Record<string, string>>()
const key = (threadId: string): string => `rovai.native-interaction-drafts.v1:${threadId}`
function load(threadId: string): Record<string, string> {
  if (memory.has(threadId)) return memory.get(threadId)!
  let drafts: Record<string, string> = {}
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key(threadId)) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      drafts = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    }
  } catch { /* Editing still works when browser storage is unavailable. */ }
  memory.set(threadId, drafts)
  return drafts
}
export function interactionDraft(threadId: string, id: string, prefill: string): string {
  return load(threadId)[id] ?? prefill
}
export function saveInteractionDraft(threadId: string, id: string, text: string): void {
  const drafts = load(threadId)
  drafts[id] = text
  persist(threadId, drafts)
}
export function retainInteractionDrafts(threadId: string, ids: Set<string>): void {
  const drafts = load(threadId)
  let changed = false
  for (const id of Object.keys(drafts)) if (!ids.has(id)) { delete drafts[id]; changed = true }
  if (changed) persist(threadId, drafts)
}
function persist(threadId: string, drafts: Record<string, string>): void {
  try {
    if (Object.keys(drafts).length) window.sessionStorage.setItem(key(threadId), JSON.stringify(drafts))
    else window.sessionStorage.removeItem(key(threadId))
  } catch { /* Preserve the in-memory draft. */ }
}
