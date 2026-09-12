import type { Session } from 'electron'
import { isFeishuLoginUrl, openPlatformApiUrl, trustedFeishuUrl } from './feishu-domains'

export class FeishuSessionError extends Error {
  constructor(code: string, readonly details: {
    httpStatus?: number
    remoteCode?: string
    missingFields?: string[]
  } = {}) {
    super(code)
    this.name = 'FeishuSessionError'
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error
    ? signal.reason : new FeishuSessionError('feishu_operation_cancelled')
}

// Also bounds operations whose implementation does not cooperate with AbortSignal.
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason
        : new FeishuSessionError('feishu_operation_cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then((value) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) abort()
      else resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort() }
  })
}

export function loginDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const done = (): void => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export type FeishuRequestScope =
  | { kind: 'login'; origin: string }
  | { kind: 'navigation' }
  | { kind: 'api'; origin: string }

export interface FeishuHttpResult {
  response: Response
  // Tracked through validated Location hops; Electron Response.url is unreliable.
  finalUrl: string
}

export type FeishuRequestDiagnostic = {
  requestDurationMs: number
  httpStatus?: number
  domain: string
  path: string
}

export class FeishuSessionHttp {
  constructor(
    private readonly session: Pick<Session, 'fetch'>,
    private readonly timeoutMs = 15_000,
    private readonly diagnostic?: (event: FeishuRequestDiagnostic) => void
  ) {}

  async request(
    rawUrl: string,
    scope: FeishuRequestScope,
    init: RequestInit = {}
  ): Promise<FeishuHttpResult> {
    const timeout = new AbortController()
    const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal
    const timer = setTimeout(() => timeout.abort(
      new FeishuSessionError('feishu_request_timeout')
    ), this.timeoutMs)
    let response: Response | undefined
    const started = performance.now()
    let observedUrl: URL | undefined
    const cancelBody = (): void => { void response?.body?.cancel().catch(() => undefined) }
    signal.addEventListener('abort', cancelBody, { once: true })
    try {
      let url = trustedFeishuUrl(rawUrl)
      observedUrl = url
      if (scope.kind === 'login' && (!isFeishuLoginUrl(url.href)
        || url.origin !== scope.origin || !/^\/accounts\/qrlogin\/(init|polling)$/.test(url.pathname))) {
        throw new FeishuSessionError('feishu_login_protocol_url_rejected')
      }
      if (scope.kind === 'api') openPlatformApiUrl(url.href, scope.origin)
      // Navigation carries no caller-provided credentials/flow/CSRF headers or bodies.
      let method = scope.kind === 'navigation' ? 'GET' : (init.method ?? 'GET')
      let body = scope.kind === 'navigation' ? undefined : init.body
      let headers = scope.kind === 'navigation'
        ? new Headers({ accept: 'text/html,application/xhtml+xml' }) : new Headers(init.headers)
      headers.delete('cookie')
      headers.delete('authorization')
      for (let hop = 0; ; hop += 1) {
        throwIfAborted(signal)
        response = await abortable(this.session.fetch(url.href, {
          method, body, headers, signal, credentials: 'include', redirect: 'manual', cache: 'no-store'
        }), signal)
        throwIfAborted(signal)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location')
          if (!location) throw new FeishuSessionError('feishu_session_redirect_invalid')
          const target = trustedFeishuUrl(location, url.href)
          if (scope.kind === 'login') throw new FeishuSessionError('feishu_login_protocol_redirect')
          if (scope.kind === 'api') {
            // Mutations are never replayed on a redirect. The API adapter classifies it.
            if (target.origin !== scope.origin && !isFeishuLoginUrl(target.href)) {
              throw new FeishuSessionError('feishu_open_platform_api_url_rejected')
            }
            cancelBody()
            return { response: new Response(null, {
              status: response.status, headers: response.headers
            }), finalUrl: url.href }
          }
          cancelBody()
          if (hop >= 8) throw new FeishuSessionError('feishu_session_redirect_limit')
          url = target
          observedUrl = target
          method = 'GET'
          body = undefined
          headers = new Headers({ accept: 'text/html,application/xhtml+xml' })
          continue
        }
        const bytes = await readBody(response, signal)
        throwIfAborted(signal)
        return {
          response: new Response([204, 205, 304].includes(response.status) ? null : bytes, {
            status: response.status, statusText: response.statusText, headers: response.headers
          }),
          finalUrl: url.href
        }
      }
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof Error && /^feishu_[a-z_]+$/.test(error.message)) throw error
      // Raw fetch errors can include credential-bearing URLs.
      throw new FeishuSessionError('feishu_network_error')
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancelBody)
      cancelBody()
      if (observedUrl) this.diagnostic?.({
        requestDurationMs: Math.round(performance.now() - started),
        httpStatus: response?.status,
        domain: observedUrl.hostname,
        // Handoff URLs may contain secrets even in path segments; only log known paths.
        path: ['/accounts/qrlogin/init', '/accounts/qrlogin/polling', '/app'].includes(observedUrl.pathname)
          ? observedUrl.pathname : '/…'
      })
    }
  }
}

async function readBody(response: Response, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const cancel = (): void => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      length += value.byteLength
      if (length > 16 * 1024 * 1024) throw new FeishuSessionError('feishu_response_too_large')
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
