import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ExecutionConsolePlacement,
  GeneralPreferencesSnapshot,
  InterfaceLanguagePreference,
  InterfaceLanguageSnapshot,
  NewConversationDefaults,
  SettingsSection,
  StartupLocationMode,
  StructuredError
} from '@contracts'

import { DEFAULT_GENERAL_PREFERENCES, parseGeneralPreferences, resolveGeneralPreferences, storedGeneralPreferences, isExecutionConsolePlacement, isInterfaceLanguagePreference, isNewConversationDefaults } from '../shared/general-preferences-model'
export { DEFAULT_GENERAL_PREFERENCES, parseGeneralPreferences, isExecutionConsolePlacement, isInterfaceLanguagePreference, isNewConversationDefaults, isStartupLocationMode, isSettingsSection } from '../shared/general-preferences-model'

export async function readGeneralPreferences(filePath: string): Promise<GeneralPreferencesSnapshot> {
  return (await readGeneralPreferencesResult(filePath)).snapshot
}

async function readGeneralPreferencesResult(filePath: string): Promise<{
  snapshot: GeneralPreferencesSnapshot
  degradation: StructuredError | null
}> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    const stored = parseGeneralPreferences(parsed)
    const snapshot = stored ? resolveGeneralPreferences(stored) : null
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
  readonly #languages: () => readonly string[]
  readonly #listeners = new Set<(snapshot: InterfaceLanguageSnapshot) => void>()
  get loadDegradation(): StructuredError | null { return this.#snapshot.readError }
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(
    filePath: string,
    snapshot: GeneralPreferencesSnapshot,
    loadDegradation: StructuredError | null = null,
    languages: () => readonly string[] = () => []
  ) {
    this.#filePath = filePath
    this.#languages = languages
    this.#snapshot = { ...snapshot, readError: loadDegradation }
    this.refreshInterfaceLanguage()
  }

  static async load(filePath: string, languages: () => readonly string[] = () => []): Promise<GeneralPreferencesStore> {
    const result = await readGeneralPreferencesResult(filePath)
    return new GeneralPreferencesStore(filePath, result.snapshot, result.degradation, languages)
  }

  static defaults(filePath: string, languages: () => readonly string[] = () => []): GeneralPreferencesStore {
    return new GeneralPreferencesStore(filePath, { ...DEFAULT_GENERAL_PREFERENCES }, null, languages)
  }

  get(): GeneralPreferencesSnapshot {
    this.refreshInterfaceLanguage()
    return structuredClone(this.#snapshot)
  }

  refreshInterfaceLanguage(): void {
    let languages: readonly string[] = []
    try { languages = this.#languages() } catch { /* An unavailable system list resolves to English. */ }
    const next = resolveGeneralPreferences(storedGeneralPreferences(this.#snapshot), languages, this.#snapshot.languageRevision, this.#snapshot.readError)
    if (next.interfaceLanguage === this.#snapshot.interfaceLanguage && next.systemLanguage === this.#snapshot.systemLanguage) return
    this.#snapshot = { ...next, languageRevision: next.languageRevision + 1 }
    this.#publish()
  }

  onInterfaceLanguageChanged(listener: (snapshot: InterfaceLanguageSnapshot) => void): () => void {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async getInterfaceLanguage(): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => this.get(), true)
  }

  async #readLocal(): Promise<void> {
    const result = await readGeneralPreferencesResult(this.#filePath)
    const stored = result.degradation ? storedGeneralPreferences(this.#snapshot) : storedGeneralPreferences(result.snapshot)
    const changed = JSON.stringify(stored) !== JSON.stringify(storedGeneralPreferences(this.#snapshot))
      || JSON.stringify(result.degradation) !== JSON.stringify(this.#snapshot.readError)
    this.#snapshot = { ...this.#snapshot, ...stored, readError: result.degradation,
      languageRevision: this.#snapshot.languageRevision + (changed ? 1 : 0) }
    this.refreshInterfaceLanguage()
    if (changed) this.#publish()
  }

  setInterfaceLanguagePreference(preference: InterfaceLanguagePreference): Promise<GeneralPreferencesSnapshot> {
    if (!isInterfaceLanguagePreference(preference)) return Promise.reject(new Error('Unsupported interface language preference'))
    return this.#enqueue(() => this.#commit({ ...this.#snapshot, interfaceLanguagePreference: preference }))
  }

  setStartupLocationMode(mode: StartupLocationMode): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, startupLocationMode: mode }
      return this.#commit(next)
    })
  }

  setLastSettingsSection(section: SettingsSection): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, lastSettingsSection: section }
      return this.#commit(next)
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
      return this.#commit(next)
    })
  }

  setExecutionConsoleAutoOpen(enabled: boolean): Promise<GeneralPreferencesSnapshot> {
    if (typeof enabled !== 'boolean') {
      return Promise.reject(new Error('Invalid execution console auto-open preference'))
    }
    return this.#enqueue(async () => {
      return this.#commit({ ...this.#snapshot, executionConsoleAutoOpen: enabled })
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
      return this.#commit(next)
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
      return this.#commit(next)
    })
  }

  setWorldMapEnabled(enabled: boolean): Promise<GeneralPreferencesSnapshot> {
    if (typeof enabled !== 'boolean') {
      return Promise.reject(new Error('Invalid world map preference'))
    }
    return this.#enqueue(async () => {
      const next = { ...this.#snapshot, worldMapEnabled: enabled }
      return this.#commit(next)
    })
  }

  invalidateNewConversationDefaults(): Promise<GeneralPreferencesSnapshot> {
    return this.#enqueue(async () => {
      if (
        !this.#snapshot.newConversationDefaults
        || this.#snapshot.newConversationDefaultsRequireConfirmation
      ) return this.get()
      const next = { ...this.#snapshot, newConversationDefaultsRequireConfirmation: true }
      return this.#commit(next)
    })
  }

  async #commit(next: GeneralPreferencesSnapshot): Promise<GeneralPreferencesSnapshot> {
    await writePrivateJson(this.#filePath, storedGeneralPreferences(next))
    this.#snapshot = { ...next, languageRevision: this.#snapshot.languageRevision + 1 }
    const snapshot = this.get()
    this.#publish()
    return snapshot
  }

  #publish(): void {
    const snapshot = structuredClone(this.#snapshot)
    for (const listener of this.#listeners) listener(snapshot)
  }

  #enqueue<T>(operation: () => Promise<T>, allowReadError = false): Promise<T> {
    const guarded = async (): Promise<T> => {
      // Recheck before a mutation as well: a damaged source must not be replaced
      // by an unrelated automatic write such as remembering the settings tab.
      await this.#readLocal()
      if (!allowReadError && this.#snapshot.readError) return Promise.reject(this.#snapshot.readError)
      return operation()
    }
    const result = this.#writeTail.then(guarded, guarded)
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
