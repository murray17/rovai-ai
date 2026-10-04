import { readFileSync } from 'node:fs'
import type { WindowCloseBehavior } from '@contracts'
import { isWindowCloseBehavior } from '../shared/window-close'
import { writePrivateJson } from './general-preferences'

/** Desktop-local preference; never added to Host/Web or conversation state. */
export class WindowClosePreferences {
  #behavior: WindowCloseBehavior = 'ask'
  readonly loadFailed: boolean

  constructor(private readonly filePath: string) {
    let failed = false
    try {
      const value = JSON.parse(readFileSync(filePath, 'utf8'))
      if (value?.schemaVersion !== 1 || !isWindowCloseBehavior(value.behavior)) throw new Error('Invalid close preference')
      this.#behavior = value.behavior
    } catch (error) {
      failed = !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    }
    this.loadFailed = failed
  }

  get(): WindowCloseBehavior { return this.#behavior }

  // The owning close controller serializes all mutations, including remembered choices.
  async set(behavior: WindowCloseBehavior): Promise<void> {
    if (!isWindowCloseBehavior(behavior)) throw new Error('Invalid close behavior')
    await writePrivateJson(this.filePath, { schemaVersion: 1, behavior })
    this.#behavior = behavior
  }
}
