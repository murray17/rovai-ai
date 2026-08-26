import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  AppUpdatesService,
  CHECK_INTERVAL_MS,
  createAppUpdatesServiceFailOpen,
  FIRST_CHECK_DELAY_MS,
  type DesktopAutoUpdater
} from './app-updates'

const NOW = new Date('2026-08-24T08:00:00.000Z')

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  autoRunAppAfterInstall = false
  allowPrerelease = true
  checkForUpdates = vi.fn<() => Promise<unknown>>(async () => ({}))
  downloadUpdate = vi.fn<() => Promise<readonly string[]>>(async () => ['/tmp/update.zip'])
  quitAndInstall = vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>()
}

function service(
  updater: FakeUpdater | null,
  options: {
    isPackaged?: boolean
    nextPromptId?: () => string
    scheduleTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
    clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
    warn?: (message: string) => void
  } = {}
): AppUpdatesService {
  return new AppUpdatesService({
    currentVersion: () => '0.0.2',
    isPackaged: () => options.isPackaged ?? true,
    updater: updater as unknown as DesktopAutoUpdater | null,
    now: () => NOW,
    nextPromptId: options.nextPromptId,
    scheduleTimer: options.scheduleTimer,
    clearTimer: options.clearTimer,
    warn: options.warn
  })
}

function emitAvailable(updater: FakeUpdater, overrides: Record<string, unknown> = {}): void {
  updater.emit('update-available', {
    version: '0.0.3',
    releaseName: 'Calmer updates',
    releaseDate: '2026-08-25T09:30:00Z',
    releaseNotes: '## Fixed\n\n- Reliable download',
    ...overrides
  })
}

describe('AppUpdatesService', () => {
  it('falls back to an unavailable service when updater binding throws', async () => {
    const updater = new FakeUpdater()
    const reportFailure = vi.fn()
    Object.defineProperty(updater, 'autoDownload', {
      configurable: true,
      get: () => true,
      set: () => { throw new Error('native updater binding failed') }
    })

    const updates = createAppUpdatesServiceFailOpen({
      currentVersion: () => '0.0.2',
      isPackaged: () => true,
      updater: updater as unknown as DesktopAutoUpdater,
      now: () => NOW
    }, reportFailure)

    expect(reportFailure).toHaveBeenCalledOnce()
    expect(reportFailure.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      message: 'native updater binding failed'
    }))
    expect(updates.startAutomaticChecks()).toBe(false)
    await expect(updates.check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'updater_unavailable',
      availableRelease: null
    })
  })

  it('keeps downloading and installation user-controlled', () => {
    const updater = new FakeUpdater()
    const updates = service(updater)

    expect(updates.get()).toEqual({
      currentVersion: '0.0.2',
      status: 'idle',
      availableRelease: null,
      lastCheckSource: null,
      checkedAt: null,
      lastSuccessfulCheckAt: null,
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      failureReason: null,
      pendingPrompt: null
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.autoRunAppAfterInstall).toBe(true)
    expect(updater.allowPrerelease).toBe(false)
  })

  it('keeps manual checks on the page without creating a global prompt', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })

    await expect(updates.check()).resolves.toMatchObject({
      status: 'available',
      lastCheckSource: 'manual',
      availableRelease: {
        version: '0.0.3',
        releaseName: 'Calmer updates',
        releaseDate: '2026-08-25T09:30:00.000Z',
        releaseNotes: '## Fixed\n\n- Reliable download'
      },
      pendingPrompt: null,
      downloadPercent: null
    })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('starts once after the first window load, then reschedules from completion', async () => {
    const updater = new FakeUpdater()
    const timers: Array<{ callback: () => void; delayMs: number }> = []
    const updates = service(updater, {
      nextPromptId: () => 'prompt-startup',
      scheduleTimer: (callback, delayMs) => {
        timers.push({ callback, delayMs })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      }
    })
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })

    expect(updates.startAutomaticChecks()).toBe(true)
    expect(updates.startAutomaticChecks()).toBe(false)
    expect(timers).toHaveLength(1)
    expect(timers[0].delayMs).toBe(FIRST_CHECK_DELAY_MS)

    timers[0].callback()
    await vi.waitFor(() => expect(updater.checkForUpdates).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(timers).toHaveLength(2))
    expect(updates.get()).toMatchObject({
      status: 'available',
      lastCheckSource: 'startup',
      pendingPrompt: { id: 'prompt-startup', version: '0.0.3' }
    })
    expect(timers[1].delayMs).toBe(CHECK_INTERVAL_MS)
  })

  it('coalesces manual and automatic participants without losing prompt semantics', async () => {
    const updater = new FakeUpdater()
    let resolveCheck!: (value: unknown) => void
    updater.checkForUpdates.mockImplementation(() => new Promise((resolve) => {
      resolveCheck = resolve
    }))
    const updates = service(updater, { nextPromptId: () => 'prompt-coalesced' })

    const manual = updates.check('manual')
    const automatic = updates.check('interval')
    expect(manual).toBe(automatic)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()

    emitAvailable(updater)
    resolveCheck({})
    await expect(manual).resolves.toMatchObject({
      lastCheckSource: 'interval',
      pendingPrompt: { id: 'prompt-coalesced', version: '0.0.3' }
    })
  })

  it('dismisses one exact prompt and creates a new id on the next automatic round', async () => {
    const updater = new FakeUpdater()
    const promptIds = ['prompt-1', 'prompt-2']
    const updates = service(updater, { nextPromptId: () => promptIds.shift() ?? 'unexpected' })
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })

    await updates.check('startup')
    expect(updates.dismissPrompt('wrong-id')).toBe(false)
    expect(updates.dismissPrompt('prompt-1')).toBe(true)
    expect(updates.get().pendingPrompt).toBeNull()

    await updates.check('interval')
    expect(updates.get().pendingPrompt).toEqual({ id: 'prompt-2', version: '0.0.3' })
  })

  it('preserves the last valid release when a later check fails', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    updater.checkForUpdates.mockImplementationOnce(async () => {
      emitAvailable(updater)
      return {}
    })
    await updates.check()

    updater.checkForUpdates.mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    await expect(updates.check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'network',
      availableRelease: { version: '0.0.3' },
      lastSuccessfulCheckAt: NOW.toISOString()
    })
  })

  it('normalizes bounded release-note arrays without passing unknown values through', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater, {
        releaseNotes: [
          { version: '0.0.3', note: 'First note' },
          { version: '<script>', note: 'Second note' },
          { version: '0.0.1', note: { unsafe: true } },
          'unknown'
        ]
      })
      return {}
    })

    await updates.check()
    expect(updates.get().availableRelease?.releaseNotes).toBe(
      '## v0.0.3\n\nFirst note\n\nSecond note'
    )
  })

  it('coalesces downloads, publishes progress, and waits for explicit install', async () => {
    const updater = new FakeUpdater()
    let resolveDownload!: (value: readonly string[]) => void
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })
    updater.downloadUpdate.mockImplementation(() => new Promise((resolve) => {
      resolveDownload = resolve
    }))
    const updates = service(updater)
    await updates.check()

    const first = updates.download()
    const second = updates.download()
    expect(first).toBe(second)
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledOnce())
    expect(updates.get()).toMatchObject({ status: 'downloading', downloadPercent: 0 })

    updater.emit('download-progress', {
      percent: 42.34,
      transferred: 42_340_000,
      total: 100_000_000,
      bytesPerSecond: 5_000_000
    })
    expect(updates.get()).toMatchObject({
      downloadPercent: 42.3,
      transferredBytes: 42_340_000,
      totalBytes: 100_000_000,
      bytesPerSecond: 5_000_000
    })

    updater.emit('update-downloaded', { version: '0.0.3' })
    resolveDownload(['/tmp/update.zip'])
    await expect(first).resolves.toMatchObject({
      status: 'ready_to_install',
      downloadPercent: 100,
      transferredBytes: 100_000_000
    })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('settles one download failure once and retries the download directly', async () => {
    const updater = new FakeUpdater()
    const observed: string[] = []
    const updates = service(updater)
    updates.onChanged((snapshot) => observed.push(`${snapshot.status}:${snapshot.failureReason}`))
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })
    updater.downloadUpdate
      .mockImplementationOnce(async () => {
        updater.emit('error', new Error('download connection reset'))
        throw new Error('download connection reset')
      })
      .mockImplementationOnce(async () => ['/tmp/update.zip'])
    await updates.check()

    await expect(updates.download()).resolves.toMatchObject({
      status: 'download_failed',
      failureReason: 'download_failed',
      availableRelease: { version: '0.0.3' }
    })
    expect(observed.filter((entry) => entry === 'download_failed:download_failed')).toHaveLength(1)

    await expect(updates.download()).resolves.toMatchObject({ status: 'ready_to_install' })
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(2)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('clears stale release and prompt facts after an up-to-date result', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater, { nextPromptId: () => 'prompt-1' })
    updater.checkForUpdates.mockImplementationOnce(async () => {
      emitAvailable(updater)
      return {}
    })
    await updates.check('startup')

    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-not-available', { version: '0.0.2' })
      return {}
    })
    await expect(updates.check()).resolves.toMatchObject({
      status: 'up_to_date',
      availableRelease: null,
      pendingPrompt: null,
      lastSuccessfulCheckAt: NOW.toISOString()
    })
  })

  it('keeps unavailable and invalid providers recoverable without blocking startup', async () => {
    await expect(service(null).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'updater_unavailable'
    })

    const unpackagedUpdater = new FakeUpdater()
    await expect(service(unpackagedUpdater, { isPackaged: false }).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'updater_unavailable'
    })
    expect(unpackagedUpdater.checkForUpdates).not.toHaveBeenCalled()

    const invalidUpdater = new FakeUpdater()
    invalidUpdater.checkForUpdates.mockImplementation(async () => {
      invalidUpdater.emit('update-available', { version: '<script>' })
      return {}
    })
    await expect(service(invalidUpdater).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'invalid_release'
    })

    const prereleaseUpdater = new FakeUpdater()
    prereleaseUpdater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(prereleaseUpdater, { version: '0.0.3-beta.1' })
      return {}
    })
    await expect(service(prereleaseUpdater).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'invalid_release',
      availableRelease: null
    })
  })

  it('triggers installation once and leaves a synchronously failed App retryable', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })
    await updates.check()
    await updates.download()

    expect(updates.install()).toBe(true)
    expect(updates.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)

    const failingUpdater = new FakeUpdater()
    const failing = service(failingUpdater)
    failingUpdater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(failingUpdater)
      return {}
    })
    failingUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('installer unavailable')
    })
    await failing.check()
    await failing.download()

    expect(failing.install()).toBe(false)
    expect(failing.get()).toMatchObject({
      status: 'install_failed',
      failureReason: 'install_failed',
      availableRelease: { version: '0.0.3' }
    })
    expect(failing.install()).toBe(false)
    expect(failingUpdater.quitAndInstall).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed staged install retryable when an interval check fires', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    updater.checkForUpdates.mockImplementation(async () => {
      emitAvailable(updater)
      return {}
    })
    updater.quitAndInstall.mockImplementation(() => {
      throw new Error('installer unavailable')
    })

    await updates.check()
    await updates.download()
    expect(updates.install()).toBe(false)
    expect(updates.get()).toMatchObject({
      status: 'install_failed',
      availableRelease: { version: '0.0.3' }
    })

    await expect(updates.check('interval')).resolves.toMatchObject({
      status: 'install_failed',
      availableRelease: { version: '0.0.3' }
    })
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updates.install()).toBe(false)
    expect(updater.quitAndInstall).toHaveBeenCalledTimes(2)
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
  })
})
