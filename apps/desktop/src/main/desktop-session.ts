import { randomUUID } from 'node:crypto'
import type {
  DesktopStartupSnapshot,
  GeneralPreferencesSnapshot
} from '@contracts'
import type { RestorableLocationReadResult } from './restorable-location'

export interface DesktopSessionSources {
  preferences: GeneralPreferencesSnapshot
  restorable: RestorableLocationReadResult
}

export class DesktopSessionRegistry {
  readonly #snapshots = new Map<number, DesktopStartupSnapshot>()
  readonly #pending = new Map<number, Promise<void>>()
  readonly #createSessionId: () => string

  constructor(createSessionId: () => string = randomUUID) {
    this.#createSessionId = createSessionId
  }

  create(
    webContentsId: number,
    preferences: GeneralPreferencesSnapshot,
    restorable: RestorableLocationReadResult
  ): DesktopStartupSnapshot {
    this.#pending.delete(webContentsId)
    const snapshot: DesktopStartupSnapshot = {
      schemaVersion: 1,
      sessionId: this.#createSessionId(),
      startupLocationMode: preferences.startupLocationMode,
      lastSettingsSection: preferences.lastSettingsSection,
      restorableLocation: restorable.location ? structuredClone(restorable.location) : null,
      restorableLocationStatus: restorable.status
    }
    this.#snapshots.set(webContentsId, snapshot)
    return structuredClone(snapshot)
  }

  get(webContentsId: number): DesktopStartupSnapshot | null {
    const snapshot = this.#snapshots.get(webContentsId)
    return snapshot ? structuredClone(snapshot) : null
  }

  createWhenReady(webContentsId: number, sources: Promise<DesktopSessionSources>): void {
    const pending = sources.then(({ preferences, restorable }) => {
      // A closed/replaced window cannot be resurrected by a late preference read.
      if (this.#pending.get(webContentsId) !== pending) return
      this.create(webContentsId, preferences, restorable)
    })
    this.#pending.set(webContentsId, pending)
  }

  async getWhenReady(webContentsId: number): Promise<DesktopStartupSnapshot | null> {
    await this.#pending.get(webContentsId)
    return this.get(webContentsId)
  }

  delete(webContentsId: number): void {
    this.#pending.delete(webContentsId)
    this.#snapshots.delete(webContentsId)
  }
}
