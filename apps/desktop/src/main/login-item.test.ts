import { describe, expect, it } from 'vitest'
import { LoginItemService, loginItemSnapshot } from './login-item'

describe('login item state mapping', () => {
  it('maps every macOS system state without inventing a local boolean', () => {
    expect(loginItemSnapshot('enabled')).toEqual({
      status: 'enabled',
      checked: true,
      effective: true
    })
    expect(loginItemSnapshot('not-registered')).toEqual({
      status: 'not-registered',
      checked: false,
      effective: false
    })
    expect(loginItemSnapshot('requires-approval')).toEqual({
      status: 'requires-approval',
      checked: true,
      effective: false
    })
    expect(loginItemSnapshot('not-found')).toEqual({
      status: 'not-found',
      checked: false,
      effective: false
    })
    expect(loginItemSnapshot('development')).toEqual({
      status: 'development',
      checked: false,
      effective: false
    })
  })

  it('never reads or writes the system registration in development', () => {
    let reads = 0
    let writes = 0
    const service = new LoginItemService({
      platform: 'darwin',
      isPackaged: () => false,
      getStatus: () => {
        reads += 1
        return 'enabled'
      },
      setEnabled: () => { writes += 1 },
      openSystemSettings: async () => undefined
    })

    expect(service.get().status).toBe('development')
    expect(service.setEnabled(true).status).toBe('development')
    expect(reads).toBe(0)
    expect(writes).toBe(0)
  })

  it.each([
    ['enabled', true],
    ['not-registered', false],
    ['requires-approval', true],
    ['not-found', false]
  ] as const)('reads the packaged macOS %s state as checked=%s', (status, checked) => {
    const service = new LoginItemService({
      platform: 'darwin',
      isPackaged: () => true,
      getStatus: () => status,
      setEnabled: () => undefined,
      openSystemSettings: async () => undefined
    })
    expect(service.get()).toMatchObject({ status, checked })
  })

  it('reads back the system state after every mutation, including cancellation of approval', () => {
    let status: 'not-registered' | 'requires-approval' = 'not-registered'
    let reads = 0
    const writes: boolean[] = []
    const service = new LoginItemService({
      platform: 'darwin',
      isPackaged: () => true,
      getStatus: () => {
        reads += 1
        return status
      },
      setEnabled: (enabled) => {
        writes.push(enabled)
        status = enabled ? 'requires-approval' : 'not-registered'
      },
      openSystemSettings: async () => undefined
    })

    expect(service.setEnabled(true).status).toBe('requires-approval')
    expect(service.setEnabled(false).status).toBe('not-registered')
    expect(writes).toEqual([true, false])
    expect(reads).toBe(2)
  })
})
