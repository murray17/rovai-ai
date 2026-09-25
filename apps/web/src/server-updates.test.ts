import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdateSnapshot } from '@contracts'
import type { ConsoleClient } from './client'
import { createServerUpdates } from './server-updates'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('Server updates transport', () => {
  it('uses version identity for installed notes while retaining a newer candidate after a failed check', async () => {
    const installed = { version: '0.2.6', releaseName: 'Server 0.2.6', releaseNotes: 'Installed notes' }
    const newer = { version: '0.2.7', releaseName: 'Server 0.2.7', releaseNotes: 'Newer notes' }
    const base = { currentVersion: '0.2.6', currentRelease: null }
    const updates = vi.fn()
      .mockResolvedValueOnce({ ...base, status: 'up_to_date', availableRelease: installed })
      .mockResolvedValueOnce({ ...base, status: 'available', availableRelease: newer })
      .mockResolvedValueOnce({ ...base, status: 'check_failed', availableRelease: newer, failureReason: 'network' })
      .mockResolvedValueOnce({ ...base, status: 'up_to_date', availableRelease: { version: '0.2.5' } })
    const api = createServerUpdates({ authenticated: true, updates } as unknown as ConsoleClient)

    expect(await api.get()).toMatchObject({
      status: 'up_to_date', currentRelease: installed, availableRelease: null
    })
    expect(await api.check()).toMatchObject({
      status: 'available', currentRelease: installed, availableRelease: newer
    })
    expect(await api.get()).toMatchObject({
      status: 'check_failed', currentRelease: installed, availableRelease: newer
    })
    expect(await api.check()).toMatchObject({
      status: 'up_to_date', currentRelease: installed, availableRelease: null
    })
  })

  it('pins explicit actions to the observed release and resumes polling through restart without logging in', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const initial = { currentVersion: '0.2.6', status: 'available', availableRelease: { version: '0.2.7' } } as AppUpdateSnapshot
    let snapshot = initial
    let offline = false
    const transport = { authenticated: true, updates: vi.fn(async () => {
      if (offline) throw new TypeError('network')
      return snapshot
    }) }
    const reload = vi.fn(), changed = vi.fn()
    const api = createServerUpdates(transport as unknown as ConsoleClient, reload)
    await api.get()
    await api.download()
    expect(transport.updates).toHaveBeenLastCalledWith('download', '0.2.7')
    snapshot = { ...initial, status: 'installing' }
    expect(await api.install()).toBe(true)
    expect(transport.updates).toHaveBeenLastCalledWith('install', '0.2.7')
    const unsubscribe = api.onChanged(changed)
    offline = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(changed.mock.lastCall?.[0].failureReason).toBe('restart_unconfirmed')
    offline = false
    snapshot = { ...initial, currentVersion: '0.2.7', status: 'idle', availableRelease: null }
    await api.check()
    expect(transport.updates).toHaveBeenLastCalledWith('get', undefined)
    expect(reload).toHaveBeenCalledOnce()
    unsubscribe()
    const count = transport.updates.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(transport.updates).toHaveBeenCalledTimes(count)
  })

  it('does not let a delayed status read replace a newer accepted action', async () => {
    const idle = { currentVersion: '0.2.6', status: 'idle', availableRelease: null } as AppUpdateSnapshot
    const checking = { ...idle, status: 'checking' } as AppUpdateSnapshot
    let finishRead!: (value: AppUpdateSnapshot) => void
    const updates = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve })).mockResolvedValueOnce(checking)
    const api = createServerUpdates({ authenticated: true, updates } as unknown as ConsoleClient)
    const read = api.get()
    expect((await api.check()).status).toBe('checking')
    finishRead(idle)
    expect((await read).status).toBe('checking')
  })
})
