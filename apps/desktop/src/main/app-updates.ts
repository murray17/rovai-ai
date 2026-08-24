import type {
  AppUpdateFailureReason,
  AppUpdateSnapshot
} from '@contracts'

interface DesktopUpdateInfo {
  version: string
}

interface DesktopDownloadProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface DesktopAutoUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  autoRunAppAfterInstall: boolean
  allowPrerelease: boolean
  on(event: 'checking-for-update', listener: () => void): this
  on(event: 'update-available', listener: (info: DesktopUpdateInfo) => void): this
  on(event: 'update-not-available', listener: (info: DesktopUpdateInfo) => void): this
  on(event: 'download-progress', listener: (progress: DesktopDownloadProgress) => void): this
  on(event: 'update-downloaded', listener: (info: DesktopUpdateInfo) => void): this
  on(event: 'update-cancelled', listener: (info: DesktopUpdateInfo) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

interface AppUpdatesServiceOptions {
  currentVersion(): string
  isPackaged(): boolean
  updater: DesktopAutoUpdater
  now?: () => Date
}

type SnapshotListener = (snapshot: AppUpdateSnapshot) => void

export class AppUpdatesService {
  readonly #currentVersion: () => string
  readonly #isPackaged: () => boolean
  readonly #updater: DesktopAutoUpdater
  readonly #now: () => Date
  readonly #listeners = new Set<SnapshotListener>()
  #snapshot: AppUpdateSnapshot
  #checkInFlight: Promise<AppUpdateSnapshot> | null = null

  constructor(options: AppUpdatesServiceOptions) {
    this.#currentVersion = options.currentVersion
    this.#isPackaged = options.isPackaged
    this.#updater = options.updater
    this.#now = options.now ?? (() => new Date())
    this.#snapshot = idleSnapshot(this.#currentVersion())

    this.#updater.autoDownload = true
    this.#updater.autoInstallOnAppQuit = false
    this.#updater.autoRunAppAfterInstall = true
    this.#updater.allowPrerelease = false

    this.#updater.on('checking-for-update', () => {
      if (this.#snapshot.status === 'checking') return
      this.#replace({
        ...idleSnapshot(this.#currentVersion()),
        status: 'checking',
        checkedAt: this.#now().toISOString()
      })
    })
    this.#updater.on('update-available', (info) => {
      const latestVersion = safeVersion(info.version)
      if (!latestVersion) {
        this.#acceptFailure('invalid_release')
        return
      }
      this.#replace({
        ...this.#snapshot,
        currentVersion: this.#currentVersion(),
        status: 'downloading',
        latestVersion,
        checkedAt: this.#snapshot.checkedAt ?? this.#now().toISOString(),
        downloadPercent: 0,
        transferredBytes: 0,
        totalBytes: null,
        bytesPerSecond: null,
        failureReason: null
      })
    })
    this.#updater.on('update-not-available', (info) => {
      this.#replace({
        ...idleSnapshot(this.#currentVersion()),
        status: 'up_to_date',
        latestVersion: safeVersion(info.version) ?? safeVersion(this.#currentVersion()),
        checkedAt: this.#snapshot.checkedAt ?? this.#now().toISOString()
      })
    })
    this.#updater.on('download-progress', (progress) => {
      if (this.#snapshot.status !== 'downloading') return
      this.#replace({
        ...this.#snapshot,
        downloadPercent: boundedPercent(progress.percent),
        transferredBytes: boundedBytes(progress.transferred),
        totalBytes: boundedBytes(progress.total),
        bytesPerSecond: boundedBytes(progress.bytesPerSecond)
      })
    })
    this.#updater.on('update-downloaded', (info) => {
      const latestVersion = safeVersion(info.version) ?? this.#snapshot.latestVersion
      if (!latestVersion) {
        this.#acceptFailure('invalid_release')
        return
      }
      this.#replace({
        ...this.#snapshot,
        status: 'ready_to_install',
        latestVersion,
        downloadPercent: 100,
        transferredBytes: this.#snapshot.totalBytes ?? this.#snapshot.transferredBytes,
        failureReason: null
      })
    })
    this.#updater.on('update-cancelled', () => {
      this.#acceptFailure('download_failed')
    })
    this.#updater.on('error', (error) => {
      this.#acceptFailure(failureReason(error, this.#snapshot.status))
    })
  }

  get(): AppUpdateSnapshot {
    return structuredClone(this.#snapshot)
  }

  onChanged(listener: SnapshotListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  check(): Promise<AppUpdateSnapshot> {
    if (this.#checkInFlight) {
      return this.#checkInFlight.then(() => this.get())
    }
    if (this.#snapshot.status === 'downloading'
        || this.#snapshot.status === 'ready_to_install'
        || this.#snapshot.status === 'installing') {
      return Promise.resolve(this.get())
    }
    const request = this.#performCheck().finally(() => {
      this.#checkInFlight = null
    })
    this.#checkInFlight = request
    return request.then(() => this.get())
  }

  install(): boolean {
    if (this.#snapshot.status !== 'ready_to_install'
        && this.#snapshot.status !== 'install_failed') return false
    this.#replace({
      ...this.#snapshot,
      status: 'installing',
      failureReason: null
    })
    try {
      this.#updater.quitAndInstall(true, true)
      return true
    } catch {
      this.#replace({
        ...this.#snapshot,
        status: 'install_failed',
        failureReason: 'install_failed'
      })
      return false
    }
  }

  async #performCheck(): Promise<AppUpdateSnapshot> {
    this.#replace({
      ...idleSnapshot(this.#currentVersion()),
      status: 'checking',
      checkedAt: this.#now().toISOString()
    })
    if (!this.#isPackaged()) {
      this.#acceptFailure('updater_unavailable')
      return this.get()
    }
    try {
      const result = await this.#updater.checkForUpdates()
      if (result === null && this.#snapshot.status === 'checking') {
        this.#acceptFailure('updater_unavailable')
      }
    } catch (error) {
      if (!isFailureStatus(this.#snapshot.status)) {
        this.#acceptFailure(failureReason(error, this.#snapshot.status))
      }
    }
    return this.get()
  }

  #acceptFailure(reason: AppUpdateFailureReason): void {
    const downloadFailure = reason === 'download_failed'
    const installFailure = reason === 'install_failed'
    this.#replace({
      ...this.#snapshot,
      currentVersion: this.#currentVersion(),
      status: installFailure ? 'install_failed' : downloadFailure ? 'download_failed' : 'check_failed',
      checkedAt: this.#snapshot.checkedAt ?? this.#now().toISOString(),
      failureReason: reason
    })
  }

  #replace(snapshot: AppUpdateSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) listener(structuredClone(snapshot))
  }
}

function idleSnapshot(currentVersion: string): AppUpdateSnapshot {
  return {
    currentVersion,
    status: 'idle',
    latestVersion: null,
    checkedAt: null,
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    failureReason: null
  }
}

function safeVersion(value: string): string | null {
  const match = value.trim().match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  )
  if (!match) return null
  return `${match[1]}.${match[2]}.${match[3]}${match[4] ?? ''}`
}

function boundedPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10))
}

function boundedBytes(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

function failureReason(
  error: unknown,
  status: AppUpdateSnapshot['status']
): AppUpdateFailureReason {
  if (status === 'downloading') return 'download_failed'
  if (status === 'installing' || status === 'ready_to_install' || status === 'install_failed') {
    return 'install_failed'
  }
  const message = error instanceof Error
    ? `${error.name} ${error.message}`.toLowerCase()
    : String(error).toLowerCase()
  if (/enet|econn|etimedout|network|timeout|timed out|dns|socket|http status (?:408|429|5\d\d)/.test(message)) {
    return 'network'
  }
  if (/latest-mac|ya?ml|sha512|checksum|signature|semver|release|provider|update info/.test(message)) {
    return 'invalid_release'
  }
  return 'updater_unavailable'
}

function isFailureStatus(status: AppUpdateSnapshot['status']): boolean {
  return status === 'check_failed' || status === 'download_failed' || status === 'install_failed'
}
