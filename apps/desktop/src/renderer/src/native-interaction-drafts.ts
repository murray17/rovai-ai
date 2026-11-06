// Tab-local recovery only. The current Core list decides which drafts remain valid.
const memory = new Map<string, Record<string, string>>()
export interface InteractionDraftScope { threadId: string; conversationId: string | null }
const key = ({ threadId, conversationId }: InteractionDraftScope): string => `rovai.native-interaction-drafts.v1:${threadId}:${conversationId ?? 'public'}`
function load(scope: InteractionDraftScope): Record<string, string> {
  const scopeKey = key(scope)
  if (memory.has(scopeKey)) return memory.get(scopeKey)!
  let drafts: Record<string, string> = {}
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(scopeKey) ?? '{}')
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      drafts = Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    }
  } catch { /* Editing still works when browser storage is unavailable. */ }
  memory.set(scopeKey, drafts)
  return drafts
}
export function interactionDraft(scope: InteractionDraftScope, id: string, prefill: string): string {
  return load(scope)[id] ?? prefill
}
export function saveInteractionDraft(scope: InteractionDraftScope, id: string, text: string): void {
  const drafts = load(scope)
  drafts[id] = text
  persist(scope, drafts)
}
export function retainInteractionDrafts(scope: InteractionDraftScope, ids: Set<string>): void {
  const drafts = load(scope)
  let changed = false
  for (const id of Object.keys(drafts)) if (!ids.has(id)) { delete drafts[id]; changed = true }
  if (changed) persist(scope, drafts)
}
function persist(scope: InteractionDraftScope, drafts: Record<string, string>): void {
  try {
    if (Object.keys(drafts).length) window.sessionStorage.setItem(key(scope), JSON.stringify(drafts))
    else window.sessionStorage.removeItem(key(scope))
  } catch { /* Preserve the in-memory draft. */ }
}
