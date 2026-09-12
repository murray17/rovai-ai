import type { ExecutionConsolePlacement, GeneralPreferencesSnapshot, NewConversationDefaults, SettingsSection, StartupLocationMode } from '@contracts'

const STARTUP_LOCATION_MODES = new Set<StartupLocationMode>(['last_location', 'quick_chat'])
const EXECUTION_CONSOLE_PLACEMENTS = new Set<ExecutionConsolePlacement>(['bottom', 'inspector'])
const SETTINGS_SECTIONS = new Set<SettingsSection>([
  'remote',
  'general',
  'skills',
  'mcp',
  'runtime',
  'channels',
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
  executionConsolePlacement: 'inspector',
  newConversationDefaults: null,
  newConversationDefaultsRequireConfirmation: false,
  oneClickNewConversationEnabled: false,
  worldMapEnabled: false
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
      : DEFAULT_GENERAL_PREFERENCES.executionConsolePlacement,
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
