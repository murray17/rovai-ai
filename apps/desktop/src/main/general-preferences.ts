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

const STARTUP_LOCATION_MODES = new Set<StartupLocationMode>(['last_location', 'quick_chat'])
const EXECUTION_CONSOLE_PLACEMENTS = new Set<ExecutionConsolePlacement>(['bottom', 'inspector'])
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  'general',
  'skills',
  'mcp',
  'runtime',
  'appearance',
  'notifications',
  'monitoring',
  'diagnostics',
  'about'
])

export const DEFAULT_GENERAL_PREFERENCES: GeneralPreferencesSnapshot = {
  schemaVersion: 4,
  startupLocationMode: 'last_location',
  lastSettingsSection: 'general',
  executionConsolePlacement: 'bottom',
  newConversationDefaults: null,
  newConversationDefaultsRequireConfirmation: false,
  oneClickNewConversationEnabled: false,
  worldMapEnabled: true
}

export function isStartupLocationMode(value: unknown): value is StartupLocationMode {
  return typeof value === 'string' && STARTUP_LOCATION_MODES.has(value as StartupLocationMode)
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && SETTINGS_SECTIONS.has(value as SettingsSection)
}

export function isExecutionConsolePlacement(value: unknown): value is ExecutionConsolePlacement {
  return typeof value === 'string'
    && EXECUTION_CONSOLE_PLACEMENTS.has(value as ExecutionConsolePlacement)
}

export function isNewConversationDefaults(value: unknown): value is NewConversationDefaults {
  if (!hasExactKeys(value, ['memberAgentIds', 'defaultLeadAgentId'])) return false
  if (!Array.isArray(value.memberAgentIds) || value.memberAgentIds.length === 0) return false
  if (value.memberAgentIds.length > 100) return false
  if (!value.memberAgentIds.every(isStableId)) return false
  if (new Set(value.memberAgentIds).size !== value.memberAgentIds.length) return false
  return isStableId(value.defaultLeadAgentId)
    && value.memberAgentIds.includes(value.defaultLeadAgentId)
}

export function parseGeneralPreferences(value: unknown): GeneralPreferencesSnapshot | null {
  if (hasExactKeys(value, ['schemaVersion', 'startupLocationMode', 'lastSettingsSection'])) {
    if (value.schemaVersion !== 1) return null
    if (!isStartupLocationMode(value.startupLocationMode)) return null
    if (!isSettingsSection(value.lastSettingsSection)) return null
    return {
      ...DEFAULT_GENERAL_PREFERENCES,
      startupLocationMode: value.startupLocationMode,
      lastSettingsSection: value.lastSettingsSection
    }
  }
  const v2Keys = [
    'schemaVersion',
    'startupLocationMode',
    'lastSettingsSection',
    'newConversationDefaults',
    'newConversationDefaultsRequireConfirmation',
    'oneClickNewConversationEnabled'
  ]
  const v3Keys = [...v2Keys, 'executionConsolePlacement']
  const v4Keys = [...v3Keys, 'worldMapEnabled']
  if (!hasExactKeys(value, v2Keys)
    && !hasExactKeys(value, v3Keys)
    && !hasExactKeys(value, v4Keys)) return null
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) return null
  if (value.schemaVersion === 2 && !hasExactKeys(value, v2Keys)) return null
  if (value.schemaVersion === 3
    && !hasExactKeys(value, v2Keys)
    && !hasExactKeys(value, v3Keys)) return null
  if (value.schemaVersion === 4 && !hasExactKeys(value, v4Keys)) return null
  if (!isStartupLocationMode(value.startupLocationMode)) return null
  if (!isSettingsSection(value.lastSettingsSection)) return null
  if (value.newConversationDefaults !== null && !isNewConversationDefaults(value.newConversationDefaults)) return null
  if (typeof value.newConversationDefaultsRequireConfirmation !== 'boolean') return null
  if (typeof value.oneClickNewConversationEnabled !== 'boolean') return null
  if (value.schemaVersion === 4 && typeof value.worldMapEnabled !== 'boolean') return null
  if (value.newConversationDefaults === null && (
    value.newConversationDefaultsRequireConfirmation
    || value.oneClickNewConversationEnabled
  )) return null
  return {
    schemaVersion: 4,
    startupLocationMode: value.startupLocationMode,
    lastSettingsSection: value.lastSettingsSection,
    executionConsolePlacement: isExecutionConsolePlacement(value.executionConsolePlacement)
      ? value.executionConsolePlacement
      : 'bottom',
    newConversationDefaults: value.newConversationDefaults
      ? structuredClone(value.newConversationDefaults)
      : null,
    newConversationDefaultsRequireConfirmation: value.newConversationDefaultsRequireConfirmation,
    oneClickNewConversationEnabled: value.oneClickNewConversationEnabled,
    worldMapEnabled: value.schemaVersion === 4 && typeof value.worldMapEnabled === 'boolean'
      ? value.worldMapEnabled
      : true
  }
}

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

  setNewConversationDefaults(defaults: NewConversationDefaults): Promise<GeneralPreferencesSnapshot> {
    if (!isNewConversationDefaults(defaults)) {
      return Promise.reject(new Error('Default new conversation members and Lead are invalid'))
    }
    return this.#enqueue(async () => {
      const next = {
        ...this.#snapshot,
        newConversationDefaults: structuredClone(defaults),
        newConversationDefaultsRequireConfirmation: false
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

function isStableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function hasExactKeys(
  value: unknown,
  expectedKeys: string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === [...expectedKeys].sort()[index])
}
