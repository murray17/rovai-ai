import { randomUUID } from 'node:crypto'
import type {
  DesktopStartupSnapshot,
  GeneralPreferencesSnapshot
} from '@contracts'
import type { RestorableLocationReadResult } from './restorable-location'

export class DesktopSessionRegistry {
  readonly #snapshots = new Map<number, DesktopStartupSnapshot>()
  readonly #createSessionId: () => string

  constructor(createSessionId: () => string = randomUUID) {
    this.#createSessionId = createSessionId
  }

  create(
    webContentsId: number,
    preferences: GeneralPreferencesSnapshot,
    restorable: RestorableLocationReadResult
  ): DesktopStartupSnapshot {
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

  delete(webContentsId: number): void {
    this.#snapshots.delete(webContentsId)
  }
}
