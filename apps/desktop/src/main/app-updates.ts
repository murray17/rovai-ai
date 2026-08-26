import { randomUUID } from 'node:crypto'
import type {
  AppUpdateCheckSource,
  AppUpdateFailureReason,
  AppUpdateRelease,
  AppUpdateSnapshot
} from '@contracts'

export const FIRST_CHECK_DELAY_MS = 5_000
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000

interface DesktopUpdateInfo {
  version: string
  releaseName?: unknown
  releaseDate?: unknown
  releaseNotes?: unknown
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
  downloadUpdate(): Promise<readonly string[]>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

interface AppUpdatesServiceOptions {
  currentVersion(): string
  isPackaged(): boolean
  updater: DesktopAutoUpdater | null
  automaticChecksEnabled?: boolean
  now?: () => Date
  nextPromptId?: () => string
  scheduleTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
  warn?: (message: string) => void
}

type SnapshotListener = (snapshot: AppUpdateSnapshot) => void
type FailedOperation = 'check' | 'download' | 'install'

export function createAppUpdatesServiceFailOpen(
  options: AppUpdatesServiceOptions,
  reportFailure: (error: unknown) => void
): AppUpdatesService {
  try {
    return new AppUpdatesService(options)
  } catch (error) {
    reportFailure(error)
    return new AppUpdatesService({ ...options, updater: null })
  }
}

export class AppUpdatesService {
  readonly #currentVersion: () => string
  readonly #isPackaged: () => boolean
  readonly #updater: DesktopAutoUpdater | null
  readonly #automaticChecksEnabled: boolean
  readonly #now: () => Date
  readonly #nextPromptId: () => string
  readonly #scheduleTimer: AppUpdatesServiceOptions['scheduleTimer']
  readonly #clearTimer: AppUpdatesServiceOptions['clearTimer']
  readonly #warn: (message: string) => void
  readonly #listeners = new Set<SnapshotListener>()
  #snapshot: AppUpdateSnapshot
  #checkInFlight: Promise<AppUpdateSnapshot> | null = null
  #checkSources: Set<AppUpdateCheckSource> | null = null
  #downloadInFlight: Promise<AppUpdateSnapshot> | null = null
  #automaticTimer: ReturnType<typeof setTimeout> | null = null
  #automaticChecksStarted = false
  #disposed = false

  constructor(options: AppUpdatesServiceOptions) {
    this.#currentVersion = options.currentVersion
    this.#isPackaged = options.isPackaged
    this.#updater = options.updater
    this.#automaticChecksEnabled = options.automaticChecksEnabled ?? true
    this.#now = options.now ?? (() => new Date())
    this.#nextPromptId = options.nextPromptId ?? randomUUID
    this.#scheduleTimer = options.scheduleTimer ?? setTimeout
    this.#clearTimer = options.clearTimer ?? clearTimeout
    this.#warn = options.warn ?? ((message) => console.warn(message))
    this.#snapshot = idleSnapshot(this.#currentVersion())

    if (!this.#updater) return
    this.#updater.autoDownload = false
    this.#updater.autoInstallOnAppQuit = false
    this.#updater.autoRunAppAfterInstall = true
    this.#updater.allowPrerelease = false

    this.#updater.on('checking-for-update', () => {
      if (this.#snapshot.status === 'checking') return
      if (blocksCheck(this.#snapshot.status)) return
      this.#replace({
        ...this.#snapshot,
        currentVersion: this.#currentVersion(),
        status: 'checking',
        checkedAt: this.#nowIso(),
        downloadPercent: null,
        transferredBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
        failureReason: null
      })
    })
    this.#updater.on('update-available', (info) => {
      const release = safeRelease(info)
      if (!release) {
        this.#acceptFailure('invalid_release', 'check')
        return
      }
      this.#replace({
        ...this.#snapshot,
        currentVersion: this.#currentVersion(),
        status: 'available',
        availableRelease: release,
        checkedAt: this.#snapshot.checkedAt ?? this.#nowIso(),
        lastSuccessfulCheckAt: this.#nowIso(),
        downloadPercent: null,
        transferredBytes: null,
        totalBytes: null,
        bytesPerSecond: null,
        failureReason: null,
        pendingPrompt: this.#snapshot.pendingPrompt?.version === release.version
          ? this.#snapshot.pendingPrompt
          : null
      })
    })
    this.#updater.on('update-not-available', (info) => {
      if (!safeVersion(info.version)) {
        this.#acceptFailure('invalid_release', 'check')
        return
      }
      this.#replace({
        ...idleSnapshot(this.#currentVersion()),
        status: 'up_to_date',
        lastCheckSource: this.#snapshot.lastCheckSource,
        checkedAt: this.#snapshot.checkedAt ?? this.#nowIso(),
        lastSuccessfulCheckAt: this.#nowIso()
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
      if (this.#snapshot.status !== 'downloading') return
      this.#acceptDownloaded(info.version)
    })
    this.#updater.on('update-cancelled', () => {
      if (this.#snapshot.status === 'downloading') {
        this.#acceptFailure('download_failed', 'download')
      }
    })
    this.#updater.on('error', (error) => {
      const operation = failedOperation(this.#snapshot.status)
      this.#acceptFailure(failureReason(error, operation), operation)
    })
  }

  get(): AppUpdateSnapshot {
    return structuredClone(this.#snapshot)
  }

  onChanged(listener: SnapshotListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  startAutomaticChecks(): boolean {
    if (this.#automaticChecksStarted
        || this.#disposed
        || !this.#automaticChecksEnabled
        || !this.#isPackaged()
        || !this.#updater) return false
    this.#automaticChecksStarted = true
    this.#scheduleAutomaticCheck('startup', FIRST_CHECK_DELAY_MS)
    return true
  }

  dispose(): void {
    this.#disposed = true
    if (this.#automaticTimer !== null) this.#clearTimer?.(this.#automaticTimer)
    this.#automaticTimer = null
  }

  check(source: AppUpdateCheckSource = 'manual'): Promise<AppUpdateSnapshot> {
    if (this.#checkInFlight) {
      this.#checkSources?.add(source)
      return this.#checkInFlight
    }
    if (blocksCheck(this.#snapshot.status)) return Promise.resolve(this.get())

    this.#checkSources = new Set([source])
    const request = (async (): Promise<AppUpdateSnapshot> => {
      await this.#performCheck(source)
      this.#finishCheckRound()
      return this.get()
    })().finally(() => {
      if (this.#checkInFlight === request) {
        this.#checkInFlight = null
        this.#checkSources = null
      }
    })
    this.#checkInFlight = request
    return request
  }

  download(): Promise<AppUpdateSnapshot> {
    if (this.#downloadInFlight) return this.#downloadInFlight
    const release = this.#snapshot.availableRelease
    if (!this.#updater
        || !release
        || (this.#snapshot.status !== 'available' && this.#snapshot.status !== 'download_failed')) {
      return Promise.resolve(this.get())
    }

    this.#replace({
      ...this.#snapshot,
      status: 'downloading',
      downloadPercent: 0,
      transferredBytes: 0,
      totalBytes: null,
      bytesPerSecond: null,
      failureReason: null,
      pendingPrompt: null
    })
    const request = (async (): Promise<AppUpdateSnapshot> => {
      try {
        // Assign #downloadInFlight before a test double or provider can emit synchronously.
        await Promise.resolve()
        await this.#updater?.downloadUpdate()
        if (this.#snapshot.status === 'downloading') this.#acceptDownloaded(release.version)
      } catch {
        if (this.#snapshot.status === 'downloading') {
          this.#acceptFailure('download_failed', 'download')
        }
      }
      return this.get()
    })().finally(() => {
      if (this.#downloadInFlight === request) this.#downloadInFlight = null
    })
    this.#downloadInFlight = request
    return request
  }

  install(): boolean {
    if (this.#snapshot.status === 'installing') return true
    if (!this.#updater
        || !this.#snapshot.availableRelease
        || (this.#snapshot.status !== 'ready_to_install'
          && this.#snapshot.status !== 'install_failed')) return false
    this.#replace({
      ...this.#snapshot,
      status: 'installing',
      failureReason: null,
      pendingPrompt: null
    })
    try {
      this.#updater.quitAndInstall(true, true)
      return this.get().status === 'installing'
    } catch {
      this.#acceptFailure('install_failed', 'install')
      return false
    }
  }

  dismissPrompt(promptId: string): boolean {
    if (!promptId || this.#snapshot.pendingPrompt?.id !== promptId) return false
    this.#replace({ ...this.#snapshot, pendingPrompt: null })
    return true
  }

  async #performCheck(source: AppUpdateCheckSource): Promise<void> {
    this.#replace({
      ...this.#snapshot,
      currentVersion: this.#currentVersion(),
      status: 'checking',
      lastCheckSource: source,
      checkedAt: this.#nowIso(),
      downloadPercent: null,
      transferredBytes: null,
      totalBytes: null,
      bytesPerSecond: null,
      failureReason: null
    })
    if (!this.#isPackaged() || !this.#updater) {
      this.#acceptFailure('updater_unavailable', 'check')
      return
    }
    try {
      const result = await this.#updater.checkForUpdates()
      if (result === null && this.#snapshot.status === 'checking') {
        this.#acceptFailure('updater_unavailable', 'check')
      } else if (this.#snapshot.status === 'checking') {
        this.#acceptFailure('updater_unavailable', 'check')
      }
    } catch (error) {
      if (!isFailureStatus(this.#snapshot.status)) {
        this.#acceptFailure(failureReason(error, 'check'), 'check')
      }
    }
  }

  #finishCheckRound(): void {
    const source = effectiveCheckSource(this.#checkSources ?? new Set())
    const release = this.#snapshot.availableRelease
    const automatic = source === 'startup' || source === 'interval'
    const nextPrompt = automatic && this.#snapshot.status === 'available' && release
      ? { id: this.#nextPromptId(), version: release.version }
      : this.#snapshot.pendingPrompt
    if (this.#snapshot.lastCheckSource === source && nextPrompt === this.#snapshot.pendingPrompt) return
    this.#replace({
      ...this.#snapshot,
      lastCheckSource: source,
      pendingPrompt: nextPrompt
    })
  }

  #acceptDownloaded(versionValue: string): void {
    const release = this.#snapshot.availableRelease
    const version = safeVersion(versionValue)
    if (!release || !version || release.version !== version) {
      this.#acceptFailure('invalid_release', 'download')
      return
    }
    this.#replace({
      ...this.#snapshot,
      status: 'ready_to_install',
      downloadPercent: 100,
      transferredBytes: this.#snapshot.totalBytes ?? this.#snapshot.transferredBytes,
      failureReason: null,
      pendingPrompt: null
    })
  }

  #acceptFailure(reason: AppUpdateFailureReason, operation: FailedOperation): void {
    const status = operation === 'install'
      ? 'install_failed'
      : operation === 'download'
        ? 'download_failed'
        : 'check_failed'
    if (this.#snapshot.status === status && this.#snapshot.failureReason === reason) return
    this.#replace({
      ...this.#snapshot,
      currentVersion: this.#currentVersion(),
      status,
      checkedAt: this.#snapshot.checkedAt ?? this.#nowIso(),
      failureReason: reason
    })
  }

  #scheduleAutomaticCheck(source: 'startup' | 'interval', delayMs: number): void {
    if (this.#disposed || this.#automaticTimer !== null) return
    this.#automaticTimer = this.#scheduleTimer?.(() => {
      this.#automaticTimer = null
      void this.check(source)
        .then((snapshot) => {
          if (snapshot.status === 'check_failed') {
            this.#warn(`[rovai] Automatic update check failed (${snapshot.failureReason ?? 'unknown'}).`)
          }
        })
        .catch((error: unknown) => {
          this.#warn(`[rovai] Automatic update check failed (${String(error)}).`)
        })
        .finally(() => {
          if (!this.#disposed) this.#scheduleAutomaticCheck('interval', CHECK_INTERVAL_MS)
        })
    }, delayMs) ?? null
  }

  #nowIso(): string {
    return this.#now().toISOString()
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
  }
}

function safeRelease(info: DesktopUpdateInfo): AppUpdateRelease | null {
  const version = safeVersion(info.version)
  if (!version) return null
  return {
    version,
    releaseName: boundedText(info.releaseName, 500),
    releaseDate: safeReleaseDate(info.releaseDate),
    releaseNotes: safeReleaseNotes(info.releaseNotes)
  }
}

function safeVersion(value: string): string | null {
  const match = value.trim().match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  )
  if (!match) return null
  return `${match[1]}.${match[2]}.${match[3]}`
}

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maximumLength) : null
}

function safeReleaseDate(value: unknown): string | null {
  const text = boundedText(value, 100)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function safeReleaseNotes(value: unknown): string | null {
  if (typeof value === 'string') return boundedText(value, 100_000)
  if (!Array.isArray(value)) return null
  const sections = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const record = entry as Record<string, unknown>
    const note = boundedText(record.note, 100_000)
    if (!note) return []
    const version = typeof record.version === 'string' ? safeVersion(record.version) : null
    return [version ? `## v${version}\n\n${note}` : note]
  })
  return boundedText(sections.join('\n\n'), 100_000)
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
  operation: FailedOperation
): AppUpdateFailureReason {
  if (operation === 'download') return 'download_failed'
  if (operation === 'install') return 'install_failed'
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

function failedOperation(status: AppUpdateSnapshot['status']): FailedOperation {
  if (status === 'downloading' || status === 'download_failed') return 'download'
  if (status === 'installing' || status === 'ready_to_install' || status === 'install_failed') {
    return 'install'
  }
  return 'check'
}

function effectiveCheckSource(sources: ReadonlySet<AppUpdateCheckSource>): AppUpdateCheckSource {
  if (sources.has('startup')) return 'startup'
  if (sources.has('interval')) return 'interval'
  return 'manual'
}

function blocksCheck(status: AppUpdateSnapshot['status']): boolean {
  return status === 'checking'
    || status === 'downloading'
    || status === 'ready_to_install'
    || status === 'installing'
    || status === 'install_failed'
}

function isFailureStatus(status: AppUpdateSnapshot['status']): boolean {
  return status === 'check_failed' || status === 'download_failed' || status === 'install_failed'
}
