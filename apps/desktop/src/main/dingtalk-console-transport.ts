import { net, type Session } from 'electron'

export type DingTalkConsoleFetch = (url: string, options: {
  method: string
  headers: Headers
  body?: string
  signal: AbortSignal
  credentials: 'include'
  redirect: 'manual'
}) => Promise<Response>

/** Session.fetch rejects manual redirects instead of exposing their status.
 * Keep the redirect event inside Main so no credential-bearing URL is followed
 * or logged, and the caller can distinguish a login redirect from a network error.
 */
export function dingTalkConsoleFetch(session: Session): DingTalkConsoleFetch {
  return (url, options) => new Promise<Response>((resolve, reject) => {
    if (options.signal.aborted) { reject(options.signal.reason); return }
    const request = net.request({
      url, session, method: options.method, credentials: 'include', redirect: 'manual',
      origin: 'https://open-dev.dingtalk.com',
      headers: Object.fromEntries(options.headers.entries())
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
      finish(new Error('dingtalk_console_request_aborted'))
      request.abort()
    }
    options.signal.addEventListener('abort', abort, { once: true })
    request.on('error', () => finish(new Error('dingtalk_console_network_failed')))
    // Electron may close the outgoing request before emitting its response.
    // Only response end/error or the caller's bounded signal settles the body.
    request.on('redirect', (status, _method, location) => {
      finish(new Response(null, { status, headers: { location } }))
      request.abort()
    })
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('error', () => finish(new Error('dingtalk_console_response_failed')))
      response.on('aborted', () => finish(new Error('dingtalk_console_response_failed')))
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.byteLength
        if (size > 2_000_000) {
          finish(new Response(null, { status: 200, headers: { 'content-length': '2000001' } }))
          request.abort()
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => {
        try {
          const headers = new Headers()
          for (const [key, values] of Object.entries(response.headers)) {
            if (!['content-length', 'content-type'].includes(key.toLowerCase())) continue
            for (const value of Array.isArray(values) ? values : [values]) headers.append(key, value)
          }
          finish(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), {
            status: response.statusCode, headers
          }))
        } catch {
          finish(new Error('dingtalk_console_response_failed'))
        }
      })
    })
    if (options.signal.aborted) abort()
    else request.end(options.body)
  })
}
