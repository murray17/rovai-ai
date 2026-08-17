import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestProductRuntimeCheck } from './runtime-check'

describe('explicit Runtime check targeting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('checks only the Qwen Runtime selected by the user', async () => {
    const request = vi.fn().mockResolvedValue({ scheduled: true })
    vi.stubGlobal('window', { rovai: { request } })

    await requestProductRuntimeCheck('qwen-code')

    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('runtime.product.check', {
      runtimeKind: 'qwen-code'
    })
  })
})
