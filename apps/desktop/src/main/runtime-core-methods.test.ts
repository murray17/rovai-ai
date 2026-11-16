import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('Desktop Renderer Core method allowlist', () => {
  it('exposes discovery, recovery wake, input reconciliation, explicit checking, and cancellation', () => {
    expect(RUNTIME_RENDERER_CORE_METHODS).toEqual([
      'runtime.status.get',
      'runtime.discovery.rescan',
      'runtime.product.ensure',
      'runtime.product.check',
      'runtime.startup.get',
      'runtime.environment.get',
      'member.runtimeEnvironment.get',
      'runtime.environmentLegacy.list',
      'runtime.environmentLegacy.get',
      'runtime.environmentLegacy.acknowledge',
      'runtime.startup.inspect',
      'runtime.startup.check',
      'runtime.startup.save',
      'runtime.networkRecovery.wake',
      'runtimeInputs.reconcile',
      'runtime.modelCatalog.open',
      'runtime.pendingExecution.cancel'
    ])
    expect(RUNTIME_RENDERER_CORE_METHODS).not.toContain('core.shutdown')
    const allowlistStart = mainSource.indexOf('const allowedMethods = new Set<CoreMethod>([')
    const allowlistEnd = mainSource.indexOf('\n])', allowlistStart)
    expect(allowlistStart).toBeGreaterThan(-1)
    expect(allowlistEnd).toBeGreaterThan(allowlistStart)
    expect(mainSource.slice(allowlistStart, allowlistEnd))
      .toContain('...RUNTIME_RENDERER_CORE_METHODS')
  })

  it('wakes the same Core recovery check when the operating system resumes', () => {
    expect(mainSource).toContain("powerMonitor.on('resume', wakeNetworkRecoveryAfterSystemResume)")
    expect(mainSource).toContain("core.request('runtime.networkRecovery.wake')")
    expect(mainSource).toContain(
      "powerMonitor.removeListener('resume', wakeNetworkRecoveryAfterSystemResume)"
    )
  })

  it.each([
    'singleChat.pendingInputs.edit',
    'preferences.memory.get',
    'preferences.memory.set'
  ])('allows the desktop Renderer to call %s', (method) => {
    const allowlistStart = mainSource.indexOf('const allowedMethods = new Set<CoreMethod>([')
    const allowlistEnd = mainSource.indexOf('\n])', allowlistStart)
    expect(allowlistStart).toBeGreaterThan(-1)
    expect(allowlistEnd).toBeGreaterThan(allowlistStart)
    expect(mainSource.slice(allowlistStart, allowlistEnd))
      .toContain(`'${method}'`)
  })
})
