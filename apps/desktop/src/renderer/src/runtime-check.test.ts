import { afterEach, describe, expect, it, vi } from 'vitest'
import { openRuntimeModelCatalog, requestProductRuntimeCheck } from './runtime-check'

describe('explicit Runtime check targeting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('checks only the Qwen Runtime selected by the user', async () => {
    const request = vi.fn().mockResolvedValue({
      scheduled: true,
      completed: true,
      ready: true,
      runtimeKind: 'qwen-code'
    })
    vi.stubGlobal('window', { rovai: { request } })

    await requestProductRuntimeCheck('qwen-code')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('runtime.product.check', {
      runtimeKind: 'qwen-code'
    })
  })

  it('opens only the selected Runtime model catalog', async () => {
    const request = vi.fn().mockResolvedValue({
      runtimeKind: 'copilot-cli',
      cache: {
        status: 'fresh',
        observedAt: '2026-08-18T00:00:00Z',
        revalidateAfter: '2026-08-18T00:01:00Z',
        expiresAt: '2026-08-19T00:00:00Z'
      },
      models: [],
      refreshStatus: 'not_required',
      diagnosticCode: null
    })
    vi.stubGlobal('window', { rovai: { request } })

    await openRuntimeModelCatalog('copilot-cli')

    expect(request).toHaveBeenCalledWith('runtime.modelCatalog.open', {
      runtimeKind: 'copilot-cli'
    })
  })
})
