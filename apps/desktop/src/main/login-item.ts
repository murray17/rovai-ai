import type { LoginItemSnapshot } from '@contracts'

export type MacLoginItemSystemStatus =
  | 'enabled'
  | 'not-registered'
  | 'requires-approval'
  | 'not-found'

export interface LoginItemSystemAdapter {
  platform: NodeJS.Platform
  isPackaged(): boolean
  getStatus(): MacLoginItemSystemStatus
  setEnabled(enabled: boolean): void
  openSystemSettings(): Promise<void>
}

export function loginItemSnapshot(
  status: MacLoginItemSystemStatus | 'development'
): LoginItemSnapshot {
  return {
    status,
    checked: status === 'enabled' || status === 'requires-approval',
    effective: status === 'enabled'
  }
}

export class LoginItemService {
  readonly #system: LoginItemSystemAdapter

  constructor(system: LoginItemSystemAdapter) {
    this.#system = system
  }

  get(): LoginItemSnapshot {
    if (!this.#system.isPackaged()) return loginItemSnapshot('development')
    if (this.#system.platform !== 'darwin') return loginItemSnapshot('not-found')
    return loginItemSnapshot(this.#system.getStatus())
  }

  setEnabled(enabled: boolean): LoginItemSnapshot {
    if (!this.#system.isPackaged() || this.#system.platform !== 'darwin') return this.get()
    this.#system.setEnabled(enabled)
    return this.get()
  }

  async openSystemSettings(): Promise<void> {
    if (!this.#system.isPackaged() || this.#system.platform !== 'darwin') {
      throw new Error('Login item settings are only available in the installed macOS app')
    }
    await this.#system.openSystemSettings()
  }
}
