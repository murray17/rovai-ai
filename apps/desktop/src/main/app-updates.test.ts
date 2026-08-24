import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  AppUpdatesService,
  type DesktopAutoUpdater
} from './app-updates'

const NOW = new Date('2026-08-24T08:00:00.000Z')

class FakeUpdater extends EventEmitter {
  autoDownload = false
  autoInstallOnAppQuit = true
  autoRunAppAfterInstall = false
  allowPrerelease = true
  checkForUpdates = vi.fn<() => Promise<unknown>>(async () => ({}))
  quitAndInstall = vi.fn<(isSilent?: boolean, isForceRunAfter?: boolean) => void>()
}

function service(updater: FakeUpdater, isPackaged = true): AppUpdatesService {
  return new AppUpdatesService({
    currentVersion: () => '0.0.2',
    isPackaged: () => isPackaged,
    updater: updater as unknown as DesktopAutoUpdater,
    now: () => NOW
  })
}

describe('AppUpdatesService', () => {
  it('keeps checks manual while configuring found updates to download immediately', () => {
    const updater = new FakeUpdater()
    const updates = service(updater)

    expect(updates.get()).toEqual({
      currentVersion: '0.0.2',
      status: 'idle',
      latestVersion: null,
      checkedAt: null,
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      failureReason: null
    })
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.autoRunAppAfterInstall).toBe(true)
    expect(updater.allowPrerelease).toBe(false)
  })

  it('publishes checking, download progress, and ready-to-install snapshots', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    const observed: string[] = []
    updates.onChanged((snapshot) => observed.push(snapshot.status))
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('checking-for-update')
      updater.emit('update-available', { version: '0.0.3' })
      return {}
    })

    await expect(updates.check()).resolves.toMatchObject({
      status: 'downloading',
      latestVersion: '0.0.3',
      downloadPercent: 0
    })
    updater.emit('download-progress', {
      percent: 42.34,
      transferred: 42_340_000,
      total: 100_000_000,
      bytesPerSecond: 5_000_000
    })
    expect(updates.get()).toMatchObject({
      status: 'downloading',
      downloadPercent: 42.3,
      transferredBytes: 42_340_000,
      totalBytes: 100_000_000,
      bytesPerSecond: 5_000_000
    })
    updater.emit('update-downloaded', { version: '0.0.3' })
    expect(updates.get()).toMatchObject({
      status: 'ready_to_install',
      latestVersion: '0.0.3',
      downloadPercent: 100,
      transferredBytes: 100_000_000
    })
    expect(observed).toEqual([
      'checking',
      'downloading',
      'downloading',
      'ready_to_install'
    ])
  })

  it('reports the current version as up to date without starting a download', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-not-available', { version: '0.0.2' })
      return {}
    })

    await expect(updates.check()).resolves.toMatchObject({
      status: 'up_to_date',
      latestVersion: '0.0.2',
      downloadPercent: null
    })
  })

  it('keeps unpackaged, network, invalid-release, and download failures recoverable', async () => {
    const unpackagedUpdater = new FakeUpdater()
    await expect(service(unpackagedUpdater, false).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'updater_unavailable'
    })
    expect(unpackagedUpdater.checkForUpdates).not.toHaveBeenCalled()

    const networkUpdater = new FakeUpdater()
    networkUpdater.checkForUpdates.mockRejectedValue(new Error('connect ETIMEDOUT'))
    await expect(service(networkUpdater).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'network'
    })

    const invalidUpdater = new FakeUpdater()
    invalidUpdater.checkForUpdates.mockImplementation(async () => {
      invalidUpdater.emit('update-available', { version: '<script>' })
      return {}
    })
    await expect(service(invalidUpdater).check()).resolves.toMatchObject({
      status: 'check_failed',
      failureReason: 'invalid_release'
    })

    const downloadUpdater = new FakeUpdater()
    downloadUpdater.checkForUpdates.mockImplementation(async () => {
      downloadUpdater.emit('update-available', { version: '0.0.3' })
      return {}
    })
    const downloading = service(downloadUpdater)
    await downloading.check()
    downloadUpdater.emit('error', new Error('download connection reset'))
    expect(downloading.get()).toMatchObject({
      status: 'download_failed',
      failureReason: 'download_failed',
      latestVersion: '0.0.3'
    })
  })

  it('coalesces simultaneous checks', async () => {
    const updater = new FakeUpdater()
    let resolveCheck!: (value: unknown) => void
    updater.checkForUpdates.mockImplementation(() => new Promise((resolve) => {
      resolveCheck = resolve
    }))
    const updates = service(updater)

    const first = updates.check()
    const second = updates.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    updater.emit('update-not-available', { version: '0.0.2' })
    resolveCheck({})
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('only installs a fully downloaded update and keeps installation retryable', async () => {
    const updater = new FakeUpdater()
    const updates = service(updater)
    expect(updates.install()).toBe(false)

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '0.0.3' })
      return {}
    })
    await updates.check()
    updater.emit('update-downloaded', { version: '0.0.3' })
    expect(updates.install()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(updates.get().status).toBe('installing')
    updater.emit('error', new Error('native installer failed'))
    expect(updates.get()).toMatchObject({
      status: 'install_failed',
      failureReason: 'install_failed'
    })

    const failingUpdater = new FakeUpdater()
    failingUpdater.quitAndInstall.mockImplementation(() => {
      throw new Error('installer unavailable')
    })
    const failing = service(failingUpdater)
    failingUpdater.emit('update-available', { version: '0.0.3' })
    failingUpdater.emit('update-downloaded', { version: '0.0.3' })
    expect(failing.install()).toBe(false)
    expect(failing.get()).toMatchObject({
      status: 'install_failed',
      failureReason: 'install_failed'
    })
  })
})
