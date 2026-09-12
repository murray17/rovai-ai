import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('Runtime Renderer Core method allowlist', () => {
  it('exposes discovery, recovery wake, background ensure, explicit checking, and cancellation', () => {
    expect(RUNTIME_RENDERER_CORE_METHODS).toEqual([
      'runtime.discovery.rescan',
      'runtime.product.ensure',
      'runtime.product.check',
      'runtime.startup.get',
      'runtime.startup.inspect',
      'runtime.startup.check',
      'runtime.startup.save',
      'runtime.networkRecovery.wake',
      'runtime.modelCatalog.open',
      'runtime.pendingExecution.cancel'
    ])
    expect(RUNTIME_RENDERER_CORE_METHODS).not.toContain('core.shutdown')
  })

  it('wakes the same Core recovery check when the operating system resumes', () => {
    expect(mainSource).toContain("powerMonitor.on('resume', wakeNetworkRecoveryAfterSystemResume)")
    expect(mainSource).toContain("core.request('runtime.networkRecovery.wake')")
    expect(mainSource).toContain(
      "powerMonitor.removeListener('resume', wakeNetworkRecoveryAfterSystemResume)"
    )
  })

  it('allows the Single Chat pending-input mutation implemented by Core', () => {
    const allowlistStart = mainSource.indexOf('const allowedMethods = new Set<CoreMethod>([')
    const allowlistEnd = mainSource.indexOf('\n])', allowlistStart)
    expect(allowlistStart).toBeGreaterThan(-1)
    expect(allowlistEnd).toBeGreaterThan(allowlistStart)
    expect(mainSource.slice(allowlistStart, allowlistEnd))
      .toContain("'singleChat.pendingInputs.edit'")
  })
})
