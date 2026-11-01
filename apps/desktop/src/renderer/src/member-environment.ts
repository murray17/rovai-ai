import type { AdapterKind, ModelSelection } from '@contracts'
import { uiAttribute } from './interface-language'

export const ENVIRONMENT_PLACEHOLDER = '{\n  "VARIABLE_NAME": "value"\n}'
export type EnvironmentSnapshot = { revision: number; environment: Record<string, string>; error?: string }
export type MemberEnvironmentSnapshot = EnvironmentSnapshot & { inheritCommon?: boolean; common?: EnvironmentSnapshot }
export type MemberEnvironmentEdit = { expectedRevision: number; json: string; inheritCommon?: boolean }
export const environmentText = (values: Record<string, string>): string => Object.keys(values).length ? JSON.stringify(values, null, 2) : ''

export function parseMemberEnvironment(text: string, windows: boolean, kind: AdapterKind | '', model: ModelSelection | undefined): Record<string, string> {
  let values: unknown
  try { values = JSON.parse(text.trim() || '{}') } catch { throw new Error(uiAttribute('JSON 格式有误，请检查双引号、逗号和括号。')) }
  if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error(uiAttribute('请填写 JSON 对象，例如 {"ANTHROPIC_API_KEY": "..."}。'))
  // JSON.parse discards duplicate keys, so inspect the original string tokens too.
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/g) ?? []
  const names = new Set<string>()
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === '{' || token === '[') depth++
    else if (token === '}' || token === ']') depth--
    else if (depth === 1 && token.startsWith('"') && tokens[i + 1] === ':') {
      const raw = JSON.parse(token) as string, name = windows ? raw.toUpperCase() : raw
      if (names.has(name)) throw new Error(uiAttribute('变量名重复：{0}', raw))
      names.add(name)
    }
  }
  const entries = Object.entries(values).map(([name, value]): [string, string] => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
        throw new Error(uiAttribute('变量「{0}」的数字无法安全表示，请改用字符串。', name))
      }
    } else if (typeof value !== 'string' && typeof value !== 'boolean') {
      throw new Error(uiAttribute('变量「{0}」的值仅支持字符串、数字或布尔值。', name))
    }
    return [name, String(value)]
  })
  let bytes = 0
  const encoder = new TextEncoder()
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(uiAttribute('变量名只能包含字母、数字和下划线，且不能以数字开头。'))
    if (/^ROVAI_/i.test(name) || ['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', 'PI_TELEMETRY'].includes(name.toUpperCase())) throw new Error(uiAttribute('此变量由 Rovai 管理：{0}', name))
    if (value.includes('\0') || encoder.encode(value).length > 65536) throw new Error(uiAttribute('变量值不能包含 NUL 字符或超过 64 KiB。'))
    bytes += encoder.encode(name + value).length
  }
  if (bytes > 128 * 1024) throw new Error(uiAttribute('环境变量总长度超过限制。'))
  if (kind === 'claude-code-cli' && model?.mode === 'explicit' && entries.some(([name]) => (windows ? name.toUpperCase() : name) === 'ANTHROPIC_MODEL')) throw new Error(uiAttribute('已选择模型。请删除 ANTHROPIC_MODEL，或将模型切回默认。'))
  return Object.fromEntries(entries.map(([name, value]) => [windows ? name.toUpperCase() : name, value]))
}

export const COMMON_ENVIRONMENT_CHANGED = 'rovai-common-environment-changed'
export function mergeEnvironment(common: Record<string, string>, local: Record<string, string>, inherit: boolean): Record<string, string> {
  return { ...(inherit ? common : {}), ...local }
}
