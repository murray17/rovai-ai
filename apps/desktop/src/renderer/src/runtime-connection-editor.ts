import type { RuntimeConnectionMode as ConnectionMode, RuntimeConnectionObservation as ConnectionObservation, RuntimeNativeCredential as NativeCredential, RuntimeCustomApiConfiguration, RuntimeStartupConfiguration, RuntimeStartupSettings, RuntimeStartupFieldEdit as FieldEdit, RuntimeStartupFieldConflict as FieldConflict } from '@contracts'
export type { ConnectionMode, ConnectionObservation, NativeCredential, RuntimeCustomApiConfiguration, RuntimeStartupConfiguration, RuntimeStartupSettings, FieldEdit, FieldConflict }
export type EditableSnapshot = Record<string, any>

export function supportsOfficialLogin(value: RuntimeCustomApiConfiguration): value is Extract<RuntimeCustomApiConfiguration, { kind: 'claude-code-cli' | 'codex-cli' }> {
  return value.kind === 'claude-code-cli' || value.kind === 'codex-cli'
}

export function usesCustomApi(value: RuntimeCustomApiConfiguration): boolean {
  return value.mode === 'custom_api'
}

export function reusableCredential(credential: NativeCredential | undefined): boolean {
  // Static keys have no inferred URL binding. Normal execution reports authentication failures.
  return credential?.status === 'available'
}

export function initialConfiguration(settings: RuntimeStartupSettings): RuntimeStartupConfiguration {
  const api = settings.configuration.customApi
  if (!api || !supportsOfficialLogin(api) || api.mode !== null) return settings.configuration
  // Explicitly saved selection always wins. Key presence is never an input.
  return { ...settings.configuration, customApi: { ...api, mode: settings.connectionObservation?.initialMode ?? null } }
}

export function editableSnapshot(configuration: RuntimeStartupConfiguration): EditableSnapshot {
  const api = configuration.customApi
  return {
    programPath: configuration.programPath,
    environment: Object.fromEntries(configuration.environment.map(({ name, value }) => [name, value])),
    mode: api?.mode ?? null,
    baseUrl: api?.baseUrl ?? '',
    ...(api?.kind === 'claude-code-cli' ? { claudeModels: { ...api.models } } : {}),
    ...(api?.kind === 'codex-cli' ? {
      codexModels: Object.fromEntries(api.models.map(({ rowId, id, displayName }) => [rowId, { id, displayName }])),
      defaultRowId: api.defaultRowId
    } : {})
  }
}
export function snapshotValue(snapshot: EditableSnapshot, path: string[]): any {
  return path.reduce((value, key) => value && Object.hasOwn(value, key) ? value[key] : null, snapshot) ?? null
}
export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
export function withSnapshotValue(snapshot: EditableSnapshot, path: string[], value: unknown): EditableSnapshot {
  const [key, ...rest] = path
  return { ...snapshot, [key]: rest.length ? withSnapshotValue(snapshot[key] ?? {}, rest, value) : value }
}
export function configurationFromSnapshot(configuration: RuntimeStartupConfiguration, snapshot: EditableSnapshot): RuntimeStartupConfiguration {
  const api = configuration.customApi
  const common = { programPath: snapshot.programPath, environment: Object.entries(snapshot.environment).filter(([, value]) => value !== null).map(([name, value]) => ({ name, value: String(value) })) }
  if (!api) return common
  const connection = { ...api, mode: snapshot.mode, baseUrl: snapshot.baseUrl }
  if (connection.kind === 'claude-code-cli') return { ...common, customApi: { ...connection, models: snapshot.claudeModels } }
  const models = Object.entries(snapshot.codexModels).filter(([, value]) => value !== null).map(([rowId, value]) => ({ rowId, ...(value as { id: string; displayName: string }) }))
  return { ...common, customApi: { ...connection, models, defaultRowId: snapshot.defaultRowId, defaultModel: models.find(row => row.rowId === snapshot.defaultRowId)?.id ?? '' } }
}
export function editedFields(before: EditableSnapshot, after: EditableSnapshot): FieldEdit[] {
  const edits: FieldEdit[] = []
  const add = (path: string[], label: string): void => {
    const oldValue = snapshotValue(before, path), newValue = snapshotValue(after, path)
    if (!sameValue(oldValue, newValue)) edits.push({ path, before: oldValue, after: newValue, label })
  }
  for (const [name, label] of [['programPath', '程序路径'], ['mode', '连接方式'], ['baseUrl', '接口地址'], ['defaultRowId', '默认模型']]) add([name], label)
  for (const name of new Set([...Object.keys(before.environment), ...Object.keys(after.environment)])) add(['environment', name], `环境变量 ${name}`)
  const modelLabels = { model: '主模型', reasoningModel: '推理模型', haikuModel: 'Haiku 默认模型', sonnetModel: 'Sonnet 默认模型', opusModel: 'Opus 默认模型' }
  for (const [name, label] of Object.entries(modelLabels)) add(['claudeModels', name], label)
  for (const rowId of new Set([...Object.keys(before.codexModels ?? {}), ...Object.keys(after.codexModels ?? {})])) {
    const original = before.codexModels?.[rowId], current = after.codexModels?.[rowId]
    const label = original?.id || current?.id || '新增模型'
    if (!original || !current) add(['codexModels', rowId], `模型 ${label}`)
    else for (const [field, text] of [['id', 'ID'], ['displayName', '显示名称']]) add(['codexModels', rowId, field], `${label} 的${text}`)
  }
  return edits
}
export function conflictValue(conflict: FieldConflict, snapshot: EditableSnapshot): string {
  if (conflict.path[0] === 'credentialVersion') return 'API Key 已在外部更新（不显示密钥）'
  if (conflict.path[0] === 'environment') return '该变量的值已在外部更新'
  if (conflict.path[0] === 'defaultRowId') return snapshot.codexModels?.[String(conflict.current)]?.id || '未指定'
  if (conflict.path[0] === 'mode') return conflict.current === 'official_login' ? '官方登录' : conflict.current === 'custom_api' ? '自定义 API' : '未选择'
  if (conflict.current === null) return '已删除'
  if (typeof conflict.current === 'object') return String((conflict.current as { id?: string }).id ?? '已修改')
  return String(conflict.current || '已清空')
}
