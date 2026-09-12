import { net, type Session } from 'electron'
import {
  DingTalkConsoleError, dingTalkAbortable, dingTalkDeadline, requireDingTalkActive
} from './dingtalk-session-error'

export const DINGTALK_LOGIN_ORIGIN = 'https://login.dingtalk.com'
export const DINGTALK_CONSOLE_ORIGIN = 'https://open-dev.dingtalk.com'
export const DINGTALK_PORTAL_URL = `${DINGTALK_CONSOLE_ORIGIN}/`
export const DINGTALK_SSO_PATH = '/dingtalk_sso_call_back'
const MAX_RESPONSE_BYTES = 2_000_000

export type DingTalkLoginFetch = (url: string, options: {
  method: 'GET' | 'POST'
  headers: Headers
  body?: string
  signal: AbortSignal
}) => Promise<Response>

export function requireDingTalkNavigation(raw: string, base?: string): URL {
  let url: URL
  try { url = new URL(raw, base) } catch { throw rejectedUrl() }
  if (url.username || url.password || url.protocol !== 'https:' || url.port
    || /[\u0000-\u0020\\]/u.test(raw)) throw rejectedUrl()
  if (url.origin === DINGTALK_CONSOLE_ORIGIN && (
    url.pathname === '/' || url.pathname === DINGTALK_SSO_PATH
    || url.pathname === '/fe' || url.pathname.startsWith('/fe/')
  )) return url
  if (url.origin === DINGTALK_LOGIN_ORIGIN && [
    '/oauth2/challenge.htm', '/oauth2/auth', '/oauth2/authorize'
  ].includes(url.pathname)) return url
  throw rejectedUrl()
}

function rejectedUrl(): DingTalkConsoleError {
  return new DingTalkConsoleError('dingtalk_login_redirect_rejected', true)
}

/** Login requests have their own origin and headers; console access_token/CSRF never enter here. */
export function dingTalkLoginFetch(session: Session): DingTalkLoginFetch {
  return (url, options) => new Promise((resolve, reject) => {
    if (options.signal.aborted) { reject(options.signal.reason); return }
    const request = net.request({
      url, session, method: options.method, credentials: 'include', redirect: 'manual',
      ...(options.method === 'POST' ? { origin: DINGTALK_LOGIN_ORIGIN } : {}),
      headers: Object.fromEntries(options.headers)
    })
    let settled = false
    const finish = (value: Response | Error): void => {
      if (settled) return
      settled = true
      options.signal.removeEventListener('abort', abort)
      if (value instanceof Error) reject(value)
      else resolve(value)
    }
    const abort = (): void => {
      finish(new DingTalkConsoleError('dingtalk_operation_cancelled'))
      request.abort()
    }
    options.signal.addEventListener('abort', abort, { once: true })
    request.on('error', () => finish(new DingTalkConsoleError('dingtalk_login_unavailable')))
    request.on('redirect', (status, _method, location) => {
      finish(new Response(null, { status, headers: { location } }))
      request.abort()
    })
    request.on('response', response => {
      const chunks: Buffer[] = []
      let size = 0
      const failed = (): void => { finish(new DingTalkConsoleError('dingtalk_login_unavailable')) }
      response.on('error', failed)
      response.on('aborted', failed)
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.byteLength
        if (size > MAX_RESPONSE_BYTES) {
          finish(new DingTalkConsoleError('dingtalk_login_response_too_large'))
          request.abort()
        } else chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => {
        if (settled) return
        try {
          const headers = new Headers()
          for (const [key, values] of Object.entries(response.headers)) {
            if (!['content-type', 'content-length'].includes(key.toLowerCase())) continue
            for (const value of Array.isArray(values) ? values : [values]) headers.append(key, value)
          }
          finish(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), {
            status: response.statusCode, headers
          }))
        } catch { failed() }
      })
    })
    if (options.signal.aborted) abort()
    else request.end(options.body)
  })
}

export class DingTalkLoginTransport {
  constructor(private readonly fetch: DingTalkLoginFetch, private readonly requestTimeoutMs = 20_000) {}

  async navigate(raw: string, signal: AbortSignal): Promise<{ url: string; text: string }> {
    let url = requireDingTalkNavigation(raw)
    for (let hop = 0; hop <= 10; hop += 1) {
      requireDingTalkActive(signal)
      if (url.searchParams.has('error')) throw new DingTalkConsoleError('dingtalk_login_rejected', true)
      const result = await this.#request(url.href, { method: 'GET', headers: new Headers({
        Accept: 'text/html,application/xhtml+xml'
      }), signal })
      if (result.location !== null) {
        url = requireDingTalkNavigation(result.location, url.href)
      } else return { url: url.href, text: result.text }
    }
    throw new DingTalkConsoleError('dingtalk_login_redirect_limit')
  }

  async form(path: '/oauth2/generate_qrcode' | '/oauth2/login_with_qr' | '/oauth2/confirm_auth',
    parameters: URLSearchParams, referer: string, signal: AbortSignal
  ): Promise<unknown> {
    const page = requireDingTalkNavigation(referer)
    if (page.origin !== DINGTALK_LOGIN_ORIGIN) throw rejectedUrl()
    const result = await this.#request(`${DINGTALK_LOGIN_ORIGIN}${path}`, {
      method: 'POST', headers: new Headers({ Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded', Referer: page.href }),
      body: parameters.toString(), signal
    })
    // Login submissions are never replayed across redirects.
    if (result.location !== null) throw new DingTalkConsoleError('dingtalk_login_protocol_incompatible')
    try { return JSON.parse(result.text) as unknown }
    catch { throw new DingTalkConsoleError('dingtalk_login_response_invalid') }
  }

  async #request(url: string, options: Parameters<DingTalkLoginFetch>[1]): Promise<{
    text: string; location: string | null
  }> {
    const deadline = dingTalkDeadline(options.signal, this.requestTimeoutMs, 'dingtalk_login_request_timeout')
    let response: Response | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancel = (): void => { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined) }
    deadline.signal.addEventListener('abort', cancel, { once: true })
    try {
      requireDingTalkActive(deadline.signal)
      response = await dingTalkAbortable<Response>(this.fetch(url, { ...options, signal: deadline.signal }).then(value => {
        if (deadline.signal.aborted) void value.body?.cancel().catch(() => undefined)
        return value
      }), deadline.signal)
      requireDingTalkActive(deadline.signal)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw rejectedUrl()
        return { text: '', location }
      }
      if (!response.ok) throw new DingTalkConsoleError(`dingtalk_login_http_${response.status}`)
      if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
        throw new DingTalkConsoleError('dingtalk_login_response_too_large')
      }
      reader = response.body?.getReader()
      if (!reader) throw new DingTalkConsoleError('dingtalk_login_response_invalid')
      const decoder = new TextDecoder()
      let size = 0
      let text = ''
      while (true) {
        const chunk = await dingTalkAbortable(reader.read(), deadline.signal)
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > MAX_RESPONSE_BYTES) throw new DingTalkConsoleError('dingtalk_login_response_too_large')
        text += decoder.decode(chunk.value, { stream: true })
      }
      requireDingTalkActive(deadline.signal)
      return { text: text + decoder.decode(), location: null }
    } catch (error) {
      requireDingTalkActive(deadline.signal)
      if (error instanceof DingTalkConsoleError) throw error
      throw new DingTalkConsoleError('dingtalk_login_unavailable')
    } finally {
      cancel()
      deadline.signal.removeEventListener('abort', cancel)
      deadline.dispose()
    }
  }
}
