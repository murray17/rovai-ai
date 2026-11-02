import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RUNTIME_RENDERER_CORE_METHODS } from './runtime-core-methods'

const mainSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('Runtime Renderer Core method allowlist', () => {
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

  it('allows member chat settings without exposing host-only chat submission', () => {
    const start = mainSource.indexOf('const allowedMethods = new Set<CoreMethod>([')
    const end = mainSource.indexOf(String.fromCharCode(10) + '])', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const allowlist = mainSource.slice(start, end)
    expect(allowlist).toContain("'members.chat.set'")
    expect(allowlist).not.toContain("'channels.chat.submit'")
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
