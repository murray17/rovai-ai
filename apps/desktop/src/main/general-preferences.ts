import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  GeneralPreferencesSnapshot,
  NewConversationDefaults,
  SettingsSection,
  StartupLocationMode
} from '@contracts'

const STARTUP_LOCATION_MODES = new Set<StartupLocationMode>(['last_location', 'quick_chat'])
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  'general',
  'skills',
  'mcp',
  'runtime',
  'appearance',
  'notifications',
  'monitoring',
  'diagnostics'
])

export const DEFAULT_GENERAL_PREFERENCES: GeneralPreferencesSnapshot = {
  schemaVersion: 2,
  startupLocationMode: 'last_location',
  lastSettingsSection: 'general',
  newConversationDefaults: null,
  newConversationDefaultsRequireConfirmation: false,
  oneClickNewConversationEnabled: false
}

export function isStartupLocationMode(value: unknown): value is StartupLocationMode {
  return typeof value === 'string' && STARTUP_LOCATION_MODES.has(value as StartupLocationMode)
}

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && SETTINGS_SECTIONS.has(value as SettingsSection)
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
  if (!hasExactKeys(value, [
    'schemaVersion',
    'startupLocationMode',
    'lastSettingsSection',
    'newConversationDefaults',
    'newConversationDefaultsRequireConfirmation',
    'oneClickNewConversationEnabled'
  ])) return null
  if (value.schemaVersion !== 2) return null
  if (!isStartupLocationMode(value.startupLocationMode)) return null
  if (!isSettingsSection(value.lastSettingsSection)) return null
  if (value.newConversationDefaults !== null && !isNewConversationDefaults(value.newConversationDefaults)) return null
  if (typeof value.newConversationDefaultsRequireConfirmation !== 'boolean') return null
  if (typeof value.oneClickNewConversationEnabled !== 'boolean') return null
  if (value.newConversationDefaults === null && (
    value.newConversationDefaultsRequireConfirmation
    || value.oneClickNewConversationEnabled
  )) return null
  return {
    schemaVersion: 2,
    startupLocationMode: value.startupLocationMode,
    lastSettingsSection: value.lastSettingsSection,
    newConversationDefaults: value.newConversationDefaults
      ? structuredClone(value.newConversationDefaults)
      : null,
    newConversationDefaultsRequireConfirmation: value.newConversationDefaultsRequireConfirmation,
    oneClickNewConversationEnabled: value.oneClickNewConversationEnabled
  }
}

export async function readGeneralPreferences(filePath: string): Promise<GeneralPreferencesSnapshot> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown
    return parseGeneralPreferences(parsed) ?? { ...DEFAULT_GENERAL_PREFERENCES }
  } catch {
    return { ...DEFAULT_GENERAL_PREFERENCES }
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
  #writeTail: Promise<void> = Promise.resolve()

  private constructor(filePath: string, snapshot: GeneralPreferencesSnapshot) {
    this.#filePath = filePath
    this.#snapshot = snapshot
  }

  static async load(filePath: string): Promise<GeneralPreferencesStore> {
    return new GeneralPreferencesStore(filePath, await readGeneralPreferences(filePath))
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
