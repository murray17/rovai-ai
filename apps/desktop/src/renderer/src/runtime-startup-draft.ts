import type { AdapterKind, RuntimeStartupConfiguration, RuntimeStartupSettings } from '@contracts'
import { editableSnapshot, editedFields, type FieldEdit } from './runtime-startup-editor'

export function normalizedStartupConfiguration(draft: RuntimeStartupConfiguration): RuntimeStartupConfiguration {
  return {
    programPath: draft.programPath?.trim() || null,
    environment: draft.environment.map(({ name, value }) => ({ name: name.trim(), value }))
  }
}

export function startupEdits(saved: RuntimeStartupSettings, draft: RuntimeStartupConfiguration): FieldEdit[] {
  return editedFields(editableSnapshot(normalizedStartupConfiguration(saved.configuration)), editableSnapshot(normalizedStartupConfiguration(draft)))
}

export function runtimeStartupKey(draft: RuntimeStartupConfiguration): string {
  const normalized = normalizedStartupConfiguration(draft)
  return JSON.stringify({ ...normalized, environment: [...normalized.environment].sort((a, b) => a.name.localeCompare(b.name)) })
}

export function runtimeEnvironmentErrors(draft: RuntimeStartupConfiguration, windows: boolean, kind: AdapterKind): Record<number, string> {
  const errors: Record<number, string> = {}
  const names = new Map<string, number>()
  draft.environment.forEach(({ name: raw, value }, index) => {
    const name = raw.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name)) {
      errors[index] = '变量名需以字母或下划线开头，只含字母、数字、下划线。'
    } else if (name.toUpperCase().startsWith('ROVAI_')) {
      errors[index] = 'ROVAI_ 开头的变量由应用管理。'
    } else if ((kind === 'claude-code-cli' ? ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'] : kind === 'codex-cli' ? ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'] : []).includes(name.toUpperCase())) {
      errors[index] = '请在原生凭据来源中配置此密钥。'
    } else if (value.includes('\0') || value.length > 65536) {
      errors[index] = '变量值包含空字符或超过长度限制。'
    }
    const key = windows ? name.toUpperCase() : name
    const previous = names.get(key)
    if (previous !== undefined) errors[index] = errors[previous] = '变量名重复。'
    names.set(key, index)
  })
  return errors
}
