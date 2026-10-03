import type { AdapterKind, RuntimeApiKeyChange } from '@contracts'
import { editableSnapshot, editedFields, initialConfiguration, reusableCredential, supportsOfficialLogin, usesCustomApi, type FieldEdit, type NativeCredential, type RuntimeCustomApiConfiguration, type RuntimeStartupConfiguration, type RuntimeStartupSettings } from './runtime-connection-editor'

export function normalizedStartupConfiguration(draft: RuntimeStartupConfiguration): RuntimeStartupConfiguration {
  return {
    programPath: draft.programPath?.trim() || null,
    environment: draft.environment.map(({ name, value }) => ({ name: name.trim(), value })),
    ...(draft.customApi ? { customApi: normalizedCustomApi(draft.customApi) } : {})
  }
}

export function emptyCustomApi(kind: AdapterKind): RuntimeCustomApiConfiguration | null {
  switch (kind) {
    case 'claude-code-cli': return { baseUrl: '', mode: null, kind, models: { model: '', reasoningModel: '', haikuModel: '', sonnetModel: '', opusModel: '' } }
    case 'codex-cli': return { baseUrl: '', mode: null, kind, models: [], defaultModel: '', defaultRowId: null }
    default: return null
  }
}

function normalizedCustomApi(api: RuntimeCustomApiConfiguration): RuntimeCustomApiConfiguration {
  const connection = { ...api, baseUrl: api.baseUrl.trim() }
  switch (connection.kind) {
    case 'claude-code-cli': return { ...connection, models: Object.fromEntries(Object.entries(connection.models).map(([key, value]) => [key, value.trim()])) as typeof connection.models }
    case 'codex-cli': return { ...connection, defaultModel: connection.models.find(row => row.rowId === connection.defaultRowId)?.id.trim() ?? '', models: connection.models.map(({ rowId, id, displayName }) => ({ rowId, id: id.trim(), displayName: displayName.trim() })) }
  }
}

// Produce only the fields edited in this form, never an old native-file copy.
export function startupEdits(saved: RuntimeStartupSettings, draft: RuntimeStartupConfiguration, key: RuntimeApiKeyChange): FieldEdit[] {
  const edits = editedFields(editableSnapshot(normalizedStartupConfiguration(initialConfiguration(saved))), editableSnapshot(normalizedStartupConfiguration(draft)))
  if (key.action !== 'keep') edits.push({ path: ['credentialVersion'], before: saved.credential?.version ?? null, after: key.action, label: 'API Key' })
  return edits
}

export function nativeConnectionChange(saved: RuntimeStartupSettings, draft: RuntimeStartupConfiguration, key: RuntimeApiKeyChange): FieldEdit[] | null {
  const edits = startupEdits(saved, draft, key).filter(edit => !['programPath', 'environment'].includes(edit.path[0]))
  return edits.length ? edits : null
}

export function customApiError(draft: RuntimeStartupConfiguration, key: RuntimeApiKeyChange, credential: NativeCredential | undefined): string | null {
  const api = draft.customApi ? normalizedCustomApi(draft.customApi) : null
  if (key.action === 'replace' && credential?.canReplace === false) return [credential.sourceLabel, credential.restriction, credential.remedy].filter(Boolean).join('。')
  if (key.action === 'clear' && credential?.canClear === false) return `无法在此清除 ${credential.sourceLabel}。${credential.remedy ?? '请在该原生来源处理。'}`
  if (api && supportsOfficialLogin(api) && api.mode === null) return '请选择官方登录或自定义 API。'
  if (!api || !usesCustomApi(api)) return null
  try {
    const url = new URL(api.baseUrl)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) throw new Error()
  } catch { return '请输入有效的 HTTP 或 HTTPS 地址，且不要在地址中包含账号或密码。' }
  // Explicit removal is savable; the resulting missing-credential state remains visible.
  if (key.action === 'keep' && !reusableCredential(credential)) return '当前连接没有可复用的凭据，请填写 API Key 或修复原生凭据来源。'
  if (key.action === 'replace' && !key.value.trim()) return '请输入 API Key。'
  if (api.kind === 'codex-cli') {
    if (!api.models.length || api.models.some((model) => !model.id)) return '请至少添加一个模型，并填写每个模型 ID。'
    if (new Set(api.models.map((model) => model.id)).size !== api.models.length) return '模型 ID 不能重复。'
    if (!api.defaultRowId || !api.models.some((model) => model.rowId === api.defaultRowId)) return '请选择一个默认模型。'
  }
  return null
}

export function runtimeStartupKey(draft: RuntimeStartupConfiguration): string {
  const normalized = normalizedStartupConfiguration(draft)
  return JSON.stringify({ ...normalized, environment: [...normalized.environment].sort((a, b) => a.name.localeCompare(b.name)) })
}

export function runtimeEnvironmentErrors(draft: RuntimeStartupConfiguration, windows: boolean): Record<number, string> {
  const errors: Record<number, string> = {}
  const names = new Map<string, number>()
  draft.environment.forEach(({ name: raw, value }, index) => {
    const name = raw.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,255}$/.test(name)) {
      errors[index] = '变量名需以字母或下划线开头，只含字母、数字、下划线。'
    } else if (name.toUpperCase().startsWith('ROVAI_')) {
      errors[index] = 'ROVAI_ 开头的变量由应用管理。'
    } else if (['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'].includes(name.toUpperCase())) {
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
