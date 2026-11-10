import type { ExecutionConsolePlacement, GeneralPreferencesSnapshot, GeneralPreferencesStorage, InterfaceLanguage, InterfaceLanguagePreference, StructuredError, NewConversationDefaults, SettingsSection, StartupLocationMode } from '@contracts'

const STARTUP_LOCATION_MODES = new Set<StartupLocationMode>(['last_location', 'quick_chat'])
const EXECUTION_CONSOLE_PLACEMENTS = new Set<ExecutionConsolePlacement>(['right', 'inspector', 'bottom'])
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  'remote',
  'general',
  'memory',
  'skills',
  'toolbox',
  'mcp',
  'runtime',
  'channels',
  'appearance',
  'shortcuts',
  'notifications',
  'monitoring',
  'diagnostics',
  'about'
])
const INTERFACE_LANGUAGES = new Set<InterfaceLanguage>(['zh-CN', 'en'])

export const DEFAULT_STORED_GENERAL_PREFERENCES: GeneralPreferencesStorage = {
  schemaVersion: 8,
  interfaceLanguagePreference: 'system',
  startupLocationMode: 'last_location',
  lastSettingsSection: 'general',
  executionConsolePlacement: 'inspector',
  executionConsoleAutoOpen: false,
  newConversationDefaults: null,
  newConversationTeamId: null,
  newConversationDefaultsRequireConfirmation: false,
  oneClickNewConversationEnabled: false,
  worldMapEnabled: false
}

export const DEFAULT_GENERAL_PREFERENCES = resolveGeneralPreferences(DEFAULT_STORED_GENERAL_PREFERENCES)

export function resolveInterfaceLanguage(preference: InterfaceLanguagePreference, languages: readonly string[] = []): InterfaceLanguage {
  if (preference !== 'system') return preference
  for (const tag of languages) {
    const primary = tag.trim().toLowerCase().replaceAll('_', '-').split('-')[0]
    if (primary === 'zh') return 'zh-CN'
    if (primary === 'en') return 'en'
  }
  return 'en'
}

export function resolveGeneralPreferences(stored: GeneralPreferencesStorage, languages: readonly string[] = [], languageRevision = 0, readError: StructuredError | null = null): GeneralPreferencesSnapshot {
  return { ...structuredClone(stored), interfaceLanguage: resolveInterfaceLanguage(stored.interfaceLanguagePreference, languages), systemLanguage: resolveInterfaceLanguage('system', languages), languageRevision, readError }
}

export function storedGeneralPreferences(snapshot: GeneralPreferencesSnapshot): GeneralPreferencesStorage {
  const { interfaceLanguage: _language, systemLanguage: _systemLanguage, languageRevision: _revision, readError: _error, ...stored } = snapshot
  return structuredClone(stored)
}

export function isInterfaceLanguagePreference(value: unknown): value is InterfaceLanguagePreference {
  return value === 'system' || isInterfaceLanguage(value)
}

export function isInterfaceLanguage(value: unknown): value is InterfaceLanguage {
  return typeof value === 'string' && INTERFACE_LANGUAGES.has(value as InterfaceLanguage)
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

export function parseGeneralPreferences(value: unknown): GeneralPreferencesStorage | null {
  if (hasExactKeys(value, ['schemaVersion', 'startupLocationMode', 'lastSettingsSection'])) {
    if (value.schemaVersion !== 1) return null
    if (!isStartupLocationMode(value.startupLocationMode)) return null
    if (!isSettingsSection(value.lastSettingsSection)) return null
    return {
      ...DEFAULT_STORED_GENERAL_PREFERENCES,
      interfaceLanguagePreference: 'zh-CN',
      startupLocationMode: value.startupLocationMode,
      lastSettingsSection: value.lastSettingsSection,
      worldMapEnabled: true
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
  const v5Keys = [...v4Keys, 'interfaceLanguage']
  const v6Keys = [...v4Keys, 'interfaceLanguagePreference']
  const v7Keys = [...v6Keys, 'newConversationTeamId']
  const v8Keys = [...v7Keys, 'executionConsoleAutoOpen']
  if (!hasExactKeys(value, v2Keys)
    && !hasExactKeys(value, v3Keys)
    && !hasExactKeys(value, v4Keys)
    && !hasExactKeys(value, v5Keys)
    && !hasExactKeys(value, v6Keys)
    && !hasExactKeys(value, v7Keys)
    && !hasExactKeys(value, v8Keys)) return null
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4 && value.schemaVersion !== 5 && value.schemaVersion !== 6 && value.schemaVersion !== 7 && value.schemaVersion !== 8) return null
  if (value.schemaVersion === 2 && !hasExactKeys(value, v2Keys)) return null
  if (value.schemaVersion === 3
    && !hasExactKeys(value, v2Keys)
    && !hasExactKeys(value, v3Keys)) return null
  if (value.schemaVersion === 4 && !hasExactKeys(value, v4Keys)) return null
  if (value.schemaVersion === 5 && !hasExactKeys(value, v5Keys)) return null
  if (value.schemaVersion === 6 && !hasExactKeys(value, v6Keys)) return null
  if (value.schemaVersion === 7 && !hasExactKeys(value, v7Keys)) return null
  if (value.schemaVersion === 8 && !hasExactKeys(value, v8Keys)) return null
  if (value.schemaVersion === 8 && typeof value.executionConsoleAutoOpen !== 'boolean') return null
  if (value.schemaVersion >= 7 && value.newConversationTeamId !== null && !isStableId(value.newConversationTeamId)) return null
  if (!isStartupLocationMode(value.startupLocationMode)) return null
  if (!isSettingsSection(value.lastSettingsSection)) return null
  if (value.newConversationDefaults !== null && !isNewConversationDefaults(value.newConversationDefaults)) return null
  if (typeof value.newConversationDefaultsRequireConfirmation !== 'boolean') return null
  if (typeof value.oneClickNewConversationEnabled !== 'boolean') return null
  if (value.schemaVersion >= 4 && typeof value.worldMapEnabled !== 'boolean') return null
  if (value.schemaVersion === 5 && !isInterfaceLanguage(value.interfaceLanguage)) return null
  if (value.schemaVersion >= 6 && !isInterfaceLanguagePreference(value.interfaceLanguagePreference)) return null
  if (value.newConversationDefaults === null && !(value.schemaVersion >= 7 && value.newConversationTeamId) && (
    value.newConversationDefaultsRequireConfirmation
    || value.oneClickNewConversationEnabled
  )) return null
  return {
    schemaVersion: 8,
    interfaceLanguagePreference: value.schemaVersion >= 6 ? value.interfaceLanguagePreference as InterfaceLanguagePreference
      : value.schemaVersion === 5 ? value.interfaceLanguage as InterfaceLanguage : 'zh-CN',
    startupLocationMode: value.startupLocationMode,
    lastSettingsSection: value.lastSettingsSection,
    executionConsolePlacement: isExecutionConsolePlacement(value.executionConsolePlacement)
      ? value.executionConsolePlacement
      : DEFAULT_GENERAL_PREFERENCES.executionConsolePlacement,
    executionConsoleAutoOpen: value.schemaVersion === 8 ? value.executionConsoleAutoOpen as boolean : false,
    newConversationDefaults: value.newConversationDefaults
      ? structuredClone(value.newConversationDefaults)
      : null,
    newConversationTeamId: value.schemaVersion >= 7 ? value.newConversationTeamId as string | null : null,
    newConversationDefaultsRequireConfirmation: value.newConversationDefaultsRequireConfirmation,
    oneClickNewConversationEnabled: value.oneClickNewConversationEnabled,
    worldMapEnabled: value.schemaVersion >= 4 && typeof value.worldMapEnabled === 'boolean'
      ? value.worldMapEnabled
      : true
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
