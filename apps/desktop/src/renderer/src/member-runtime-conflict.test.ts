import { describe, expect, it } from 'vitest'
import {
  persistedRuntimeChangeDisposition,
  persistedRuntimeConfigurationKey,
  submittedRuntimeConfigurationKey
} from './member-runtime-conflict'

describe('member Runtime persisted-change handling', () => {
  const savedConfiguration = {
    adapterKind: 'codex-cli' as const,
    model: { mode: 'runtime_default' as const },
    permissions: {
      adapterKind: 'codex-cli' as const,
      schemaVersion: 1,
      values: {
        sandbox_mode: 'workspace-write',
        approval_policy: 'on-request'
      }
    }
  }

  it('accepts the persisted value produced by the current save instead of reporting a conflict', () => {
    const submittedPersistedKey = submittedRuntimeConfigurationKey(
      savedConfiguration.adapterKind,
      {
        model: savedConfiguration.model,
        permissions: savedConfiguration.permissions
      }
    )
    const nextPersistedKey = persistedRuntimeConfigurationKey(savedConfiguration)

    expect(submittedPersistedKey).toBe(nextPersistedKey)
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey,
      submittedPersistedKey,
      dirty: true
    })).toBe('saved_submission')
  })

  it('still protects a dirty draft from a different persisted update', () => {
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      submittedPersistedKey: submittedRuntimeConfigurationKey('copilot-cli', {
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind: 'copilot-cli',
          schemaVersion: 1,
          values: { allow_all: true }
        }
      }),
      dirty: true
    })).toBe('external_conflict')
  })

  it('reloads external changes when there is no local draft', () => {
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(null),
      nextPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      submittedPersistedKey: null,
      dirty: false
    })).toBe('reload')
  })

  it('represents a submitted clear separately from no pending submission', () => {
    expect(submittedRuntimeConfigurationKey('', null)).toBe('null')
    expect(persistedRuntimeChangeDisposition({
      previousPersistedKey: persistedRuntimeConfigurationKey(savedConfiguration),
      nextPersistedKey: persistedRuntimeConfigurationKey(null),
      submittedPersistedKey: submittedRuntimeConfigurationKey('', null),
      dirty: true
    })).toBe('saved_submission')
  })
})
