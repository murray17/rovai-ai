import type { RuntimeStartupConfiguration, RuntimeStartupSettings, RuntimeStartupFieldEdit as FieldEdit, RuntimeStartupFieldConflict as FieldConflict } from '@contracts'
export type { RuntimeStartupConfiguration, RuntimeStartupSettings, FieldEdit, FieldConflict }

type EditableSnapshot = {
  programPath: string | null
  environment: Record<string, string | null>
}

export function editableSnapshot(configuration: RuntimeStartupConfiguration): EditableSnapshot {
  return {
    programPath: configuration.programPath,
    environment: Object.fromEntries(configuration.environment.map(({ name, value }) => [name, value]))
  }
}

export function withSnapshotValue(snapshot: EditableSnapshot, path: string[], value: unknown): EditableSnapshot {
  const text = typeof value === 'string' ? value : null
  return path[0] === 'programPath'
    ? { ...snapshot, programPath: text }
    : { ...snapshot, environment: { ...snapshot.environment, [path[1]]: text } }
}

export function configurationFromSnapshot(snapshot: EditableSnapshot): RuntimeStartupConfiguration {
  return {
    programPath: snapshot.programPath,
    environment: Object.entries(snapshot.environment).flatMap(([name, value]) => value === null ? [] : [{ name, value }])
  }
}

export function editedFields(before: EditableSnapshot, after: EditableSnapshot): FieldEdit[] {
  const edits: FieldEdit[] = []
  if (before.programPath !== after.programPath) {
    edits.push({ path: ['programPath'], before: before.programPath, after: after.programPath, label: '程序路径' })
  }
  for (const name of new Set([...Object.keys(before.environment), ...Object.keys(after.environment)])) {
    const oldValue = before.environment[name] ?? null
    const newValue = after.environment[name] ?? null
    if (oldValue !== newValue) edits.push({ path: ['environment', name], before: oldValue, after: newValue, label: `环境变量 ${name}` })
  }
  return edits
}

export function conflictValue(conflict: FieldConflict): string {
  if (conflict.path[0] === 'environment') return '该变量的值已在外部更新'
  return conflict.current === null ? '已删除' : String(conflict.current || '已清空')
}
