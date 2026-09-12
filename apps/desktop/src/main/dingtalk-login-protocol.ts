import { parse as parseScript, type Expression } from 'acorn'
import { parse as parseHtml, type DefaultTreeAdapterMap } from 'parse5'
import {
  DINGTALK_CONSOLE_ORIGIN, DINGTALK_LOGIN_ORIGIN, DINGTALK_PORTAL_URL, DINGTALK_SSO_PATH,
  DingTalkLoginTransport, requireDingTalkNavigation
} from './dingtalk-login-transport'
import { DingTalkConsoleError, requireDingTalkActive } from './dingtalk-session-error'

export type DingTalkQrChallenge = { ticket: string; qrPayload: string; expiresAt: number | null }
export type DingTalkAuthContext = {
  challengeUrl: string
  parameters: URLSearchParams
  callbackUrl: string
  exclusiveCorpId: string
}
export type DingTalkQrState =
  | { kind: 'waiting' | 'scanned' | 'expired' }
  | { kind: 'interaction'; url: string }
  | { kind: 'authenticated'; secondaryValidationResult: string }

/** Internal, observed OAuth web protocol. Evidence and unverified branches live in docs/research. */
export class DingTalkLoginProtocol {
  constructor(private readonly transport: DingTalkLoginTransport) {}

  async open(signal: AbortSignal): Promise<
    | { kind: 'console' }
    | { kind: 'challenge'; context: DingTalkAuthContext; next: DingTalkQrState | null }
  > {
    const page = await this.transport.navigate(DINGTALK_PORTAL_URL, signal)
    requireDingTalkActive(signal)
    const url = requireDingTalkNavigation(page.url)
    if (url.origin === DINGTALK_CONSOLE_ORIGIN) return { kind: 'console' }
    const context = parseDingTalkAuthContext(url.href)
    const bootstrap = readDingTalkLoginBootstrap(page.text)
    const exclusiveCorpId = bootstrap.exclusiveCorpId
    if (typeof exclusiveCorpId === 'string') context.exclusiveCorpId = exclusiveCorpId
    const interactionFlags = ['exclusiveLogin', 'disableScanLogin', 'needSecondaryValidation', 'usingMfa', 'usingMfaQr',
      'needConfirm', 'studentLogin']
    if (interactionFlags.some(key => bootstrap[key] !== undefined && typeof bootstrap[key] !== 'boolean')
      || Object.keys(bootstrap).some(key => key.startsWith('need') && key !== 'needLogin'
        && !interactionFlags.includes(key) && bootstrap[key] !== false)) throw incompatible()
    if (interactionFlags.some(key => bootstrap[key] === true) || nonempty(bootstrap.ssoUrl)) {
      return { kind: 'challenge', context, next: { kind: 'interaction', url: context.challengeUrl } }
    }
    if (bootstrap.needLogin === false) {
      let result = bootstrap.oauthLoginResult
      if (typeof result === 'string') {
        try { result = JSON.parse(result) } catch { throw incompatible() }
      }
      return { kind: 'challenge', context, next: normalizeLoginResult(result, context) }
    }
    if (bootstrap.needLogin !== true) throw incompatible()
    return { kind: 'challenge', context, next: null }
  }

  async initialize(context: DingTalkAuthContext, signal: AbortSignal): Promise<DingTalkQrChallenge> {
    const response = record(await this.transport.form('/oauth2/generate_qrcode',
      new URLSearchParams(context.parameters), context.challengeUrl, signal))
    requireDingTalkActive(signal)
    if (response?.success !== true) throw protocolFailure(response)
    const qrPayload = nonempty(response.result)
    if (!qrPayload) throw incompatible()
    let url: URL
    try { url = new URL(qrPayload) } catch { throw incompatible() }
    if (url.origin !== DINGTALK_LOGIN_ORIGIN || url.pathname !== '/oauth2/qr_confirm.htm'
      || url.username || url.password || url.hash || /[\u0000-\u0020\\]/u.test(qrPayload)
      || url.searchParams.getAll('code').length !== 1) throw incompatible()
    const ticket = nonempty(url.searchParams.get('code'))
    if (!ticket) throw incompatible()
    // The endpoint returns the complete scan link. No fabricated token encoding or expiry.
    return { ticket, qrPayload, expiresAt: null }
  }

  async poll(context: DingTalkAuthContext, challenge: DingTalkQrChallenge, signal: AbortSignal): Promise<DingTalkQrState> {
    const parameters = new URLSearchParams(context.parameters)
    parameters.set('code', challenge.ticket)
    parameters.set('exclusiveCorpId', context.exclusiveCorpId)
    parameters.set('stayLogin', 'false')
    const response = record(await this.transport.form('/oauth2/login_with_qr', parameters, context.challengeUrl, signal))
    requireDingTalkActive(signal)
    if (response?.success === false) {
      // These string business codes are from the official QRListener, not guessed status numbers.
      if (response.errorCode === '11021') return { kind: 'waiting' }
      if (response.errorCode === '11041') return { kind: 'scanned' }
      if (response.errorCode === '11019') return { kind: 'expired' }
      if (typeof response.context === 'string') {
        let contextValue: unknown
        try { contextValue = JSON.parse(response.context) } catch { throw incompatible() }
        const raw = nonempty(record(contextValue)?.url)
        if (raw) return { kind: 'interaction', url: requireDingTalkNavigation(raw, context.challengeUrl).href }
      }
      throw protocolFailure(response)
    }
    if (response?.success !== true) throw incompatible()
    return normalizeLoginResult(response.result, context)
  }

  async complete(context: DingTalkAuthContext, state: Extract<DingTalkQrState, { kind: 'authenticated' }>,
    signal: AbortSignal
  ): Promise<{ kind: 'console' } | { kind: 'interaction'; url: string }> {
    const parameters = new URLSearchParams(context.parameters)
    parameters.set('corpId', '') // No organization is selected on the user's behalf.
    parameters.set('secondaryValidationResult', state.secondaryValidationResult)
    parameters.set('redirect_uri', context.callbackUrl)
    const response = record(await this.transport.form('/oauth2/confirm_auth', parameters, context.challengeUrl, signal))
    requireDingTalkActive(signal)
    if (response?.success !== true) throw protocolFailure(response)
    const raw = nonempty(record(response.result)?.url)
    if (!raw) throw incompatible()
    const target = requireDingTalkNavigation(raw, context.challengeUrl)
    if (target.origin === DINGTALK_LOGIN_ORIGIN) return { kind: 'interaction', url: target.href }
    requireDingTalkSsoCallback(target, context)
    const page = await this.transport.navigate(target.href, signal)
    requireDingTalkActive(signal)
    return new URL(page.url).origin === DINGTALK_CONSOLE_ORIGIN
      ? { kind: 'console' } : { kind: 'interaction', url: page.url }
  }
}

export function parseDingTalkAuthContext(raw: string): DingTalkAuthContext {
  const url = requireDingTalkNavigation(raw)
  if (url.origin !== DINGTALK_LOGIN_ORIGIN || url.pathname !== '/oauth2/challenge.htm') throw incompatible()
  const parameters = new URLSearchParams(url.search)
  for (const key of ['client_id', 'redirect_uri', 'response_type', 'scope']) {
    if (parameters.getAll(key).length !== 1 || !nonempty(parameters.get(key))) throw incompatible()
  }
  if (parameters.get('response_type') !== 'code'
    || !['openid', 'corpid'].every(scope => parameters.get('scope')!.split(/\s+/u).includes(scope))
    || ['code', 'access_token', '_csrf_token_'].some(key => parameters.has(key))) throw incompatible()
  const callbackUrl = parameters.get('redirect_uri')!
  const callback = requireDingTalkNavigation(callbackUrl)
  if (callback.origin !== DINGTALK_CONSOLE_ORIGIN || callback.pathname !== DINGTALK_SSO_PATH || callback.hash) throw incompatible()
  return { challengeUrl: url.href, parameters, callbackUrl, exclusiveCorpId: '' }
}

function requireDingTalkSsoCallback(target: URL, context: DingTalkAuthContext): void {
  const expected = new URL(context.callbackUrl)
  if (target.origin !== expected.origin || target.pathname !== expected.pathname || target.hash) throw incompatible()
  // Preserve the backend's continue/correlation parameters, including repeated values.
  for (const key of new Set(expected.searchParams.keys())) {
    if (JSON.stringify(expected.searchParams.getAll(key)) !== JSON.stringify(target.searchParams.getAll(key))) throw incompatible()
  }
  if (target.searchParams.has('error')) throw new DingTalkConsoleError('dingtalk_login_rejected', true)
}

function normalizeLoginResult(value: unknown, context: DingTalkAuthContext): DingTalkQrState {
  const result = record(value)
  if (!result) throw incompatible()
  const interactionFlags = ['needConfirmAgreement', 'needChangePwd', 'needBindEmail', 'needBindMobile',
    'chooseOrganization', 'needConsent', 'needSecondaryValidation']
  if (interactionFlags.some(key => result[key] === true)
    || ['pbcProtocolList', 'channelList'].some(key => Array.isArray(result[key]) && result[key].length > 0)) {
    return { kind: 'interaction', url: context.challengeUrl }
  }
  if (interactionFlags.some(key => result[key] !== undefined && typeof result[key] !== 'boolean')
    || Object.keys(result).some(key => key.startsWith('need') && !interactionFlags.includes(key) && result[key] !== false)
    || ['pbcProtocolList', 'channelList'].some(key => result[key] !== undefined && !Array.isArray(result[key]))
    || (result.secondaryValidationResult !== undefined && typeof result.secondaryValidationResult !== 'string')
    || (result.secondaryValidationResult === undefined && !interactionFlags.some(key => result[key] === false)
      && typeof result.pass !== 'boolean')) throw incompatible()
  // The official confirm_auth wrapper defaults an omitted secondary result to the empty string.
  return { kind: 'authenticated', secondaryValidationResult: typeof result.secondaryValidationResult === 'string'
    ? result.secondaryValidationResult : '' }
}

function incompatible(): DingTalkConsoleError { return new DingTalkConsoleError('dingtalk_login_protocol_incompatible', true) }
function protocolFailure(response: Record<string, unknown> | null): DingTalkConsoleError {
  const code = response?.errorCode
  return typeof code === 'string' && /^\d{1,9}$/u.test(code)
    ? new DingTalkConsoleError(`dingtalk_login_business_${code}`, true) : incompatible()
}
function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= 16_384 && !value.includes('\0') ? value : null
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Reads inert structured bootstrap data; never executes remote JavaScript or inspects presentation. */
export function readDingTalkLoginBootstrap(html: string): Record<string, unknown> {
  let result: Record<string, unknown> | null = null
  for (const script of inlineScripts(parseHtml(html))) {
    let program
    try { program = parseScript(script, { ecmaVersion: 'latest' }) } catch { continue }
    for (const statement of program.body) {
      if (statement.type !== 'ExpressionStatement') continue
      const assignment = statement.expression
      if (assignment.type !== 'AssignmentExpression' || assignment.operator !== '=') continue
      const left = assignment.left
      if (left.type !== 'MemberExpression' || left.computed || left.object.type !== 'Identifier'
        || left.object.name !== 'window' || left.property.type !== 'Identifier' || left.property.name !== '__LOGIN_PAGE_VARS') continue
      if (result) throw incompatible()
      result = record(literal(assignment.right))
    }
  }
  if (!result) throw incompatible()
  return result
}

function literal(value: Expression, depth = 0): unknown {
  if (depth > 12) throw incompatible()
  if (value.type === 'Literal' && !value.regex && value.bigint === undefined) return value.value
  if (value.type === 'ObjectExpression') {
    const result: Record<string, unknown> = Object.create(null)
    for (const prop of value.properties) {
      if (prop.type !== 'Property' || prop.kind !== 'init' || prop.computed || prop.method) throw incompatible()
      const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'Literal' ? String(prop.key.value) : null
      if (!key || Object.hasOwn(result, key)) throw incompatible()
      result[key] = literal(prop.value, depth + 1)
    }
    return result
  }
  if (value.type === 'ArrayExpression') return value.elements.map(item => {
    if (!item || item.type === 'SpreadElement') throw incompatible()
    return literal(item, depth + 1)
  })
  throw incompatible()
}

function* inlineScripts(node: DefaultTreeAdapterMap['node']): Generator<string> {
  if ('tagName' in node && node.tagName === 'script' && !node.attrs.some(attr => attr.name === 'src')) {
    yield node.childNodes.filter(child => child.nodeName === '#text').map(child => (child as DefaultTreeAdapterMap['textNode']).value).join('')
  }
  if ('childNodes' in node) for (const child of node.childNodes) yield* inlineScripts(child)
}
