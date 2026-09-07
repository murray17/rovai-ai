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

  it('waits for interactive discovery before checking a newly installed Runtime', async () => {
    let finishDiscovery!: () => void
    const discovery = new Promise<void>(resolve => { finishDiscovery = resolve })
    const request = vi.fn().mockReturnValueOnce(discovery).mockResolvedValueOnce({ ready: false, outcome: 'stable_failure' })
    vi.stubGlobal('window', { rovai: { request } })

    const check = requestProductRuntimeCheck('codex-cli', true)
    expect(request).toHaveBeenCalledExactlyOnceWith('runtime.discovery.rescan', { interactiveShell: true })
    finishDiscovery()
    await expect(check).resolves.toEqual({ ready: false, outcome: 'stable_failure' })
    expect(request).toHaveBeenNthCalledWith(2, 'runtime.product.check', { runtimeKind: 'codex-cli' })
  })

  it('does not check stale discovery after a failed rescan', async () => {
    const request = vi.fn().mockRejectedValue(new Error('discovery failed'))
    vi.stubGlobal('window', { rovai: { request } })
    await expect(requestProductRuntimeCheck('codex-cli', true)).rejects.toThrow('discovery failed')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
