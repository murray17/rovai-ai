import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ExecutionConsolePlacement,
  GeneralPreferencesSnapshot,
  NewConversationDefaults,
  SettingsSection,
  StartupLocationMode,
  StructuredError
} from '@contracts'

import { DEFAULT_GENERAL_PREFERENCES, parseGeneralPreferences, isExecutionConsolePlacement, isNewConversationDefaults } from '../shared/general-preferences-model'
export { DEFAULT_GENERAL_PREFERENCES, parseGeneralPreferences, isExecutionConsolePlacement, isNewConversationDefaults, isStartupLocationMode, isSettingsSection } from '../shared/general-preferences-model'

export async function readGeneralPreferences(filePath: string): Promise<GeneralPreferencesSnapshot> {
  return (await readGeneralPreferencesResult(filePath)).snapshot
}

async function readGeneralPreferencesResult(filePath: string): Promise<{
  snapshot: GeneralPreferencesSnapshot
  degradation: StructuredError | null
}> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    const snapshot = parseGeneralPreferences(parsed)
    return snapshot
      ? { snapshot, degradation: null }
      : {
          snapshot: { ...DEFAULT_GENERAL_PREFERENCES },
          degradation: preferenceDegradation(
            'general_preferences_invalid',
            'General preferences are invalid; in-memory defaults are active and the original file was not changed.'
          )
        }
  } catch (error) {
    return {
      snapshot: { ...DEFAULT_GENERAL_PREFERENCES },
      degradation: isMissingPathError(error)
        ? null
        : preferenceDegradation(
            'general_preferences_unreadable',
            'General preferences could not be read; in-memory defaults are active and the original file was not changed.'
          )
    }
  }
}

export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx'
    })
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

export class GeneralPreferencesStore {
  readonly #filePath: string
  #snapshot: GeneralPreferencesSnapshot
  readonly loadDegradation: StructuredError | null
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(
    filePath: string,
    snapshot: GeneralPreferencesSnapshot,
    loadDegradation: StructuredError | null = null
  ) {
    this.#filePath = filePath
    this.#snapshot = snapshot
    this.loadDegradation = loadDegradation
  }

  static async load(filePath: string): Promise<GeneralPreferencesStore> {
    const result = await readGeneralPreferencesResult(filePath)
    return new GeneralPreferencesStore(filePath, result.snapshot, result.degradation)
  }

  static defaults(filePath: string): GeneralPreferencesStore {
    return new GeneralPreferencesStore(filePath, { ...DEFAULT_GENERAL_PREFERENCES })
  }

  get(): GeneralPreferencesSnapshot {
    return structuredClone(this.#snapshot)
  }

  setStartupLocationMode(mode: StartupLocationMode): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, startupLocationMode: mode }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  setLastSettingsSection(section: SettingsSection): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, lastSettingsSection: section }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  setExecutionConsolePlacement(
    placement: ExecutionConsolePlacement
  ): Promise<GeneralPreferencesSnapshot> {
    if (!isExecutionConsolePlacement(placement)) {
      return Promise.reject(new Error('Unsupported execution console placement'))
    }
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, executionConsolePlacement: placement }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  setNewConversationDefaults(defaults: NewConversationDefaults, enableOneClick = false): Promise<GeneralPreferencesSnapshot> {
    if (!isNewConversationDefaults(defaults)) {
      return Promise.reject(new Error('Default new conversation members and Lead are invalid'))
    }
    if (typeof enableOneClick !== 'boolean') {
      return Promise.reject(new Error('Invalid one-click new conversation preference'))
    }
    const savedDefaults = structuredClone(defaults)
    return this.#enqueue(async () => {
      const next = {
        ...this.#snapshot,
        newConversationDefaults: savedDefaults,
        newConversationDefaultsRequireConfirmation: false,
        oneClickNewConversationEnabled: enableOneClick || this.#snapshot.oneClickNewConversationEnabled
      }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  setOneClickNewConversationEnabled(enabled: boolean): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      if (enabled && (
        !this.#snapshot.newConversationDefaults
        || this.#snapshot.newConversationDefaultsRequireConfirmation
      )) {
        throw new Error('Default new conversation configuration requires confirmation')
      }
      const next = { ...this.#snapshot, oneClickNewConversationEnabled: enabled }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  setWorldMapEnabled(enabled: boolean): Promise<GeneralPreferencesSnapshot> {
    if (typeof enabled !== 'boolean') {
      return Promise.reject(new Error('Invalid world map preference'))
    }
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, worldMapEnabled: enabled }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  invalidateNewConversationDefaults(): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      if (
        !this.#snapshot.newConversationDefaults
        || this.#snapshot.newConversationDefaultsRequireConfirmation
      ) return this.get()
      const next = { ...this.#snapshot, newConversationDefaultsRequireConfirmation: true }
      await writePrivateJson(this.#filePath, next)
      this.#snapshot = next
      return this.get()
    })
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation)
    this.#writeTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function preferenceDegradation(code: string, message: string): StructuredError {
  return { code, message, retryable: true, details: {} }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
