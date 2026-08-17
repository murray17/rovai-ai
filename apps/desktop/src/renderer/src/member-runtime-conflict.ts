import type { AdapterKind, MemberRuntimeConfiguration } from '@contracts'
import type { MemberRuntimeDraft } from './MemberRuntimeParameters'

export type PersistedRuntimeChangeDisposition =
  | 'unchanged'
  | 'saved_submission'
  | 'saved_submission_with_newer_draft'
  | 'external_conflict'
  | 'reload'

export type PendingRuntimeSubmission = {
  baseVersion: number
  persistedKey: string
  editorStateKey: string
}

export function persistedRuntimeConfigurationKey(
  configuration: MemberRuntimeConfiguration | null
): string {
  return JSON.stringify(stableJsonValue(configuration))
}

export function submittedRuntimeConfigurationKey(
  adapterKind: AdapterKind | '',
  draft: MemberRuntimeDraft | null
): string {
  return persistedRuntimeConfigurationKey(adapterKind && draft
    ? {
        adapterKind,
        model: draft.model,
        permissions: draft.permissions
      }
    : null)
}

export function persistedRuntimeChangeDisposition({
  previousPersistedKey,
  nextPersistedKey,
  currentVersion,
  pendingSubmission,
  currentEditorStateKey,
  dirty
}: {
  previousPersistedKey: string
  nextPersistedKey: string
  currentVersion: number
  pendingSubmission: PendingRuntimeSubmission | null
  currentEditorStateKey: string
  dirty: boolean
}): PersistedRuntimeChangeDisposition {
  if (
    pendingSubmission
    && currentVersion > pendingSubmission.baseVersion
    && pendingSubmission.persistedKey === nextPersistedKey
  ) {
    return currentEditorStateKey === pendingSubmission.editorStateKey
      ? 'saved_submission'
      : 'saved_submission_with_newer_draft'
  }
  if (previousPersistedKey === nextPersistedKey) return 'unchanged'
  return dirty ? 'external_conflict' : 'reload'
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, stableJsonValue(entry)])
  )
}
