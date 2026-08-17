import { describe, expect, it } from 'vitest'
import {
  persistedRuntimeChangeDisposition,
  persistedRuntimeConfigurationKey,
  submittedRuntimeConfigurationKey
} from './member-runtime-conflict'

describe('member Runtime persisted-change handling', () => {
  const savedConfiguration = {
    adapterKind: 'copilot-cli' as const,
    model: {
      mode: 'explicit' as const,
      modelId: 'claude-opus-5',
      options: { reasoning_effort: 'medium' }
    },
    permissions: {
      adapterKind: 'copilot-cli' as const,
      schemaVersion: 1,
      values: { allow_all: 'on' }
    }
  }
  const submittedEditorStateKey = JSON.stringify({
    selectedKind: savedConfiguration.adapterKind,
    draft: {
      model: savedConfiguration.model,
      permissions: savedConfiguration.permissions
    }
  })
  const pendingSubmission = {
    baseVersion: 5,
    persistedKey: submittedRuntimeConfigurationKey(
      savedConfiguration.adapterKind,
      {
        model: savedConfiguration.model,
        permissions: savedConfiguration.permissions
      }
    ),
    editorStateKey: submittedEditorStateKey
  }

  it('accepts the persisted value produced by the current save after its version advances', () => {
    const nextPersistedKey = persistedRuntimeConfigurationKey(savedConfiguration)

    expect(pendingSubmission.persistedKey).toBe(nextPersistedKey)
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey,
      currentVersion: 6,
      pendingSubmission,
      currentEditorStateKey: submittedEditorStateKey,
      dirty: true
    })).toBe('saved_submission')
  })

  it('compares Runtime configuration values independently from object key order', () => {
    const reordered = {
      permissions: {
        values: { allow_all: 'on' },
        schemaVersion: 1,
        adapterKind: 'copilot-cli' as const
      },
      model: {
        options: { reasoning_effort: 'medium' },
        modelId: 'claude-opus-5',
        mode: 'explicit' as const
      },
      adapterKind: 'copilot-cli' as const
    }

    expect(persistedRuntimeConfigurationKey(reordered))
      .toBe(persistedRuntimeConfigurationKey(savedConfiguration))
  })

  it('acknowledges a successful no-op save from its version even when the persisted key is unchanged', () => {
    const persistedKey = persistedRuntimeConfigurationKey(savedConfiguration)

    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedKey,
      nextPersistedKey: persistedKey,
      currentVersion: 6,
      pendingSubmission,
      currentEditorStateKey: submittedEditorStateKey,
      dirty: true
    })).toBe('saved_submission')
  })

  it('acknowledges the save without discarding edits made after submission', () => {
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      currentVersion: 6,
      pendingSubmission,
      currentEditorStateKey: `${submittedEditorStateKey}:newer-draft`,
      dirty: true
    })).toBe('saved_submission_with_newer_draft')
  })

  it('still protects a dirty draft from a different persisted update', () => {
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      currentVersion: 6,
      pendingSubmission: {
        baseVersion: 5,
        persistedKey: submittedRuntimeConfigurationKey('copilot-cli', {
          model: { mode: 'runtime_default' },
          permissions: {
            adapterKind: 'copilot-cli',
            schemaVersion: 1,
            values: { allow_all: 'off' }
          }
        }),
        editorStateKey: submittedEditorStateKey
      },
      currentEditorStateKey: submittedEditorStateKey,
      dirty: true
    })).toBe('external_conflict')
  })

  it('does not acknowledge a pending submission before the profile version advances', () => {
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      currentVersion: 5,
      pendingSubmission,
      currentEditorStateKey: submittedEditorStateKey,
      dirty: true
    })).toBe('external_conflict')
  })

  it('reloads external changes when there is no local draft', () => {
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      currentVersion: 6,
      pendingSubmission: null,
      currentEditorStateKey: submittedEditorStateKey,
      dirty: false
    })).toBe('reload')
  })

  it('represents a submitted clear separately from no pending submission', () => {
    const clearEditorStateKey = JSON.stringify({ selectedKind: '', draft: null })
    expect(submittedRuntimeConfigurationKey('', null)).toBe('null')
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      nextPersistedKey: persistedRuntimeConfigurationKey(null),
      currentVersion: 6,
      pendingSubmission: {
        baseVersion: 5,
        persistedKey: submittedRuntimeConfigurationKey('', null),
        editorStateKey: clearEditorStateKey
      },
      currentEditorStateKey: clearEditorStateKey,
      dirty: true
    })).toBe('saved_submission')
  })
})
