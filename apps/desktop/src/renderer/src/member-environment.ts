import type { AdapterKind, ModelSelection } from '@contracts'
import { uiAttribute } from './interface-language'

export const SAVED_ENVIRONMENT_VALUE = '<saved>'
export const ENVIRONMENT_PLACEHOLDER = '{\n  "ANTHROPIC_BASE_URL": "https://api.anthropic.com",\n  "ANTHROPIC_API_KEY": "sk-ant-..."\n}'
export type MemberEnvironmentSnapshot = { revision: number; environment: Record<string, string> }
export type MemberEnvironmentEdit = { expectedRevision: number; json: string; confirmTargetChange: boolean }
export const sensitiveEnvironmentName = (name: string): boolean => /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|AUTH/i.test(name)
export const environmentText = (values: Record<string, string>): string => Object.keys(values).length ? JSON.stringify(values, null, 2) : ''

export function parseMemberEnvironment(text: string, windows: boolean, kind: AdapterKind | '', model: ModelSelection | undefined): Record<string, string> {
  let values: unknown
  try { values = JSON.parse(text.trim() || '{}') } catch { throw new Error(uiAttribute('JSON 格式有误，请检查双引号、逗号和括号。')) }
  if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error(uiAttribute('请填写 JSON 对象，例如 {"ANTHROPIC_API_KEY": "..."}。'))
  const entries = Object.entries(values)
  if (entries.length > 128) throw new Error(uiAttribute('最多可配置 128 项变量。'))
  if (entries.some(([, value]) => typeof value !== 'string')) throw new Error(uiAttribute('所有变量值都必须是字符串，请使用双引号。'))
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
  let bytes = 0
  const encoder = new TextEncoder()
  for (const [name, raw] of entries) {
    const value = raw as string
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 256) throw new Error(uiAttribute('变量名只能包含字母、数字和下划线，且不能以数字开头。'))
    if (/^ROVAI_/i.test(name) || ['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS', 'PI_TELEMETRY'].includes(name.toUpperCase())) throw new Error(uiAttribute('此变量由 Rovai 管理：{0}', name))
    if (value.includes('\0') || encoder.encode(value).length > 65536) throw new Error(uiAttribute('变量值不能包含 NUL 字符或超过 64 KiB。'))
    bytes += encoder.encode(name + value).length
  }
  if (bytes > 128 * 1024) throw new Error(uiAttribute('环境变量总长度超过限制。'))
  if (kind === 'claude-code-cli' && model?.mode === 'explicit' && entries.some(([name]) => (windows ? name.toUpperCase() : name) === 'ANTHROPIC_MODEL')) throw new Error(uiAttribute('已选择模型。请删除 ANTHROPIC_MODEL，或将模型切回默认。'))
  return windows ? Object.fromEntries(entries.map(([name, value]) => [name.toUpperCase(), value as string])) : values as Record<string, string>
}

export function environmentNeedsConsent(before: Record<string, string>, after: Record<string, string>): boolean {
  return Object.keys({ ...before, ...after }).some(name => /URL|ENDPOINT|HOST/i.test(name) && before[name] !== after[name])
    && Object.entries(after).some(([name, value]) => sensitiveEnvironmentName(name) && value !== '' && Object.hasOwn(before, name) && (value === SAVED_ENVIRONMENT_VALUE || value === before[name]))
}
