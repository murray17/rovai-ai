import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ContextSummaryModelConfig,
  ContextSummaryModelPreference
} from '@contracts'
import {
  loadSummaryModelConfig,
  saveSummaryModelConfig
} from './SummaryModelSettings'

describe('summary model settings API', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps using the existing summary model get and set methods', async () => {
    const config: ContextSummaryModelConfig = {
      preference: null,
      version: 3,
      updatedAt: null
    }
    const savedPreference: ContextSummaryModelPreference = {
      installationId: 'installation-codex',
      model: { mode: 'runtime_default' }
    }
    const saved: ContextSummaryModelConfig = {
      preference: savedPreference,
      version: 4,
      updatedAt: '2026-07-28T10:00:00Z'
    }
    const request = vi.fn()
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(saved)
    vi.stubGlobal('window', { rovai: { request } })

    await expect(loadSummaryModelConfig()).resolves.toEqual(config)
    await expect(saveSummaryModelConfig(config, savedPreference)).resolves.toEqual(saved)
    expect(request).toHaveBeenNthCalledWith(1, 'context.summaryModel.get')
    expect(request).toHaveBeenNthCalledWith(2, 'context.summaryModel.set', {
      expectedVersion: 3,
      preference: savedPreference
    })
  })
})
