import { parse as parseScript, type Expression, type Program } from 'acorn'
import { parse as parseHtml, type DefaultTreeAdapterMap } from 'parse5'
import type { FeishuDeveloperIdentity } from './feishu-developer-session'
import { brandForPortal, openPlatformOrigin } from './feishu-domains'
import { FeishuSessionError } from './feishu-session-http'

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function normalizeFeishuIdentity(raw: unknown, portalUrl: string): FeishuDeveloperIdentity {
  const user = record(raw)
  const userId = firstString(user.id, user.userId, user.user_id)
  const userName = firstString(user.name, user.userName, user.user_name, record(user.displayName).value)
  const tenantId = firstString(user.tenantId, user.tenant_id)
  const tenantName = firstString(record(user.tenantDisplayName).value, user.tenantName, user.tenant_name)
  const missingFields = Object.entries({ userId, userName, tenantId, tenantName })
    .filter(([, value]) => !value).map(([field]) => field)
  if (!userId || !userName || !tenantId || !tenantName) {
    throw new FeishuSessionError('feishu_developer_identity_incomplete', { missingFields })
  }
  const email = firstString(user.email)
  return { brand: brandForPortal(portalUrl), userId, userName, tenantId, tenantName,
    ...(email ? { email } : {}) }
}

export interface FeishuOpenPlatformBootstrap {
  identity: FeishuDeveloperIdentity
  apiOrigin: string
  csrfToken: string
}

export function readOpenPlatformBootstrap(html: string, finalUrl: string): FeishuOpenPlatformBootstrap {
  const apiOrigin = openPlatformOrigin(finalUrl)
  const fields: Record<string, unknown> = Object.create(null)
  for (const source of inlineScripts(parseHtml(html))) {
    let program: Program
    try { program = parseScript(source, { ecmaVersion: 'latest' }) } catch {
      // Unrelated scripts do not become identity evidence.
      if (/\bwindow\s*(?:\.\s*(?:user|csrfToken|outDomain)\b|\[)/.test(source)) {
        throw new FeishuSessionError('feishu_open_platform_bootstrap_unsupported')
      }
      continue
    }
    readStatements(program.body, fields)
  }
  const declaredOrigin = firstString(record(fields.outDomain).larkOpen)
  if (declaredOrigin && openPlatformOrigin(declaredOrigin) !== apiOrigin) {
    throw new FeishuSessionError('feishu_open_platform_origin_rejected')
  }
  const identity = normalizeFeishuIdentity(fields.user, finalUrl)
  const csrfToken = firstString(fields.csrfToken)
  if (!csrfToken) throw new FeishuSessionError('feishu_open_platform_bootstrap_incomplete', {
    missingFields: ['csrfToken']
  })
  return { identity, apiOrigin, csrfToken }
}

function* inlineScripts(node: DefaultTreeAdapterMap['node']): Generator<string> {
  if ('tagName' in node && node.tagName === 'script') {
    const type = node.attrs.find((attribute) => attribute.name === 'type')?.value
    if (node.attrs.some((attribute) => attribute.name === 'src')
      || (type && !['text/javascript', 'application/javascript'].includes(type))) return
    yield node.childNodes.flatMap((child) => 'value' in child ? [child.value] : []).join('')
  } else if ('childNodes' in node) {
    for (const child of node.childNodes) yield* inlineScripts(child)
  }
}

function readStatements(statements: Program['body'], fields: Record<string, unknown>): void {
  for (const statement of statements) {
    if (statement.type === 'ExpressionStatement') readExpression(statement.expression, fields)
  }
}

function readExpression(expression: Expression, fields: Record<string, unknown>): void {
  if (expression.type === 'SequenceExpression') {
    for (const item of expression.expressions) readExpression(item, fields)
  } else if (expression.type === 'UnaryExpression' && ['!', 'void', '+', '-'].includes(expression.operator)) {
    readExpression(expression.argument, fields)
  } else if (expression.type === 'CallExpression'
    && expression.arguments.length === 0
    && (expression.callee.type === 'FunctionExpression' || expression.callee.type === 'ArrowFunctionExpression')
    && expression.callee.params.length === 0 && !expression.callee.async
    && !expression.callee.generator) {
    // Only the common bootstrap wrapper; no arbitrary call, branch, loop or function is executed.
    const body = expression.callee.body
    if (body.type === 'BlockStatement') readStatements(body.body, fields)
    else readExpression(body, fields)
  } else if (expression.type === 'AssignmentExpression' && expression.operator === '=') {
    const target = expression.left
    if (target.type !== 'MemberExpression' || target.object.type !== 'Identifier'
      || target.object.name !== 'window') return
    const field = target.computed && target.property.type === 'Literal'
      ? target.property.value : !target.computed && target.property.type === 'Identifier'
        ? target.property.name : null
    if (typeof field !== 'string' || !['user', 'csrfToken', 'outDomain'].includes(field)) return
    fields[field] = literalData(expression.right)
  }
}

// A data decoder, not a JavaScript interpreter. Unsupported values remain missing.
function literalData(expression: Expression, depth = 0): unknown {
  if (depth > 32) throw new FeishuSessionError('feishu_open_platform_bootstrap_unsupported')
  if (expression.type === 'Literal') {
    return typeof expression.value === 'string' || typeof expression.value === 'number'
      || typeof expression.value === 'boolean' || expression.value === null ? expression.value : undefined
  }
  if (expression.type === 'ObjectExpression') {
    const value: Record<string, unknown> = Object.create(null)
    for (const property of expression.properties) {
      if (property.type !== 'Property' || property.kind !== 'init' || property.computed || property.method) continue
      const key = property.key.type === 'Identifier' ? property.key.name
        : property.key.type === 'Literal' ? property.key.value : null
      if (typeof key === 'string') value[key] = literalData(property.value as Expression, depth + 1)
    }
    return value
  }
  if (expression.type === 'ArrayExpression') {
    return expression.elements.map((element) => element && element.type !== 'SpreadElement'
      ? literalData(element, depth + 1) : undefined)
  }
  if (expression.type === 'CallExpression' && expression.arguments.length === 1
    && expression.callee.type === 'MemberExpression' && !expression.callee.computed
    && expression.callee.object.type === 'Identifier' && expression.callee.object.name === 'JSON'
    && expression.callee.property.type === 'Identifier' && expression.callee.property.name === 'parse') {
    const argument = expression.arguments[0]
    if (argument?.type === 'Literal' && typeof argument.value === 'string') {
      try { return JSON.parse(argument.value) as unknown } catch { return undefined }
    }
  }
  return undefined
}
