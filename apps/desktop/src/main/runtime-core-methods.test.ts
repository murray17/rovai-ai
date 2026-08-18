import { describe, expect, it } from 'vitest'
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'

describe('Runtime Renderer Core method allowlist', () => {
  it('exposes discovery, background ensure, explicit checking, and pending execution cancellation', () => {
    expect(RUNTIME_RENDERER_CORE_METHODS).toEqual([
      'runtime.discovery.rescan',
      'runtime.product.ensure',
      'runtime.product.check',
      'runtime.modelCatalog.open',
      'runtime.pendingExecution.cancel'
    ])
    expect(RUNTIME_RENDERER_CORE_METHODS).not.toContain('core.shutdown')
  })
})
