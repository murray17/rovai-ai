import type { AdapterKind, MemberRuntimeConfiguration } from '@contracts'
import type { MemberRuntimeDraft } from './MemberRuntimeParameters'

export type PersistedRuntimeChangeDisposition =
  | 'unchanged'
  | 'saved_submission'
  | 'external_conflict'
  | 'reload'

export function persistedRuntimeConfigurationKey(
  configuration: MemberRuntimeConfiguration | null
): string {
  return JSON.stringify(configuration)
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
  submittedPersistedKey,
  dirty
}: {
  previousPersistedKey: string
  nextPersistedKey: string
  submittedPersistedKey: string | null
  dirty: boolean
}): PersistedRuntimeChangeDisposition {
  if (previousPersistedKey === nextPersistedKey) return 'unchanged'
  if (submittedPersistedKey === nextPersistedKey) return 'saved_submission'
  return dirty ? 'external_conflict' : 'reload'
}
