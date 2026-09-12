import { Readable } from 'node:stream'
import { net, type Session } from 'electron'
import { abortable, throwIfAborted } from './feishu-session-http'

/**
 * Electron fetch's manual redirect rejects with "Redirect was cancelled" instead
 * of exposing a Response. Use its underlying Chromium request with an explicit
 * Session and capture the redirect event; the policy layer follows each hop.
 */
export async function requestInFeishuSession(
  session: Session,
  url: string,
  init: RequestInit
): Promise<Response> {
  const outgoing = new Request(url, init)
  const signal = outgoing.signal
  throwIfAborted(signal)
  const bytes = outgoing.body ? await abortable(outgoing.arrayBuffer(), signal) : undefined
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const request = net.request({
      session, url, method: outgoing.method, credentials: 'include', useSessionCookies: true,
      redirect: 'manual', cache: 'no-store', headers: Object.fromEntries(outgoing.headers)
    })
    let settled = false
    const cleanup = (): void => signal.removeEventListener('abort', abort)
    const fail = (error: Error): void => {
      cleanup()
      if (!settled) { settled = true; reject(error) }
    }
    const abort = (): void => {
      fail(signal.reason instanceof Error ? signal.reason : new Error('feishu_operation_cancelled'))
      request.abort()
    }
    signal.addEventListener('abort', abort, { once: true })
    request.on('error', fail)
    request.on('redirect', (status, _method, location, rawHeaders) => {
      if (settled) return
      settled = true
      cleanup()
      const headers = responseHeaders(rawHeaders)
      headers.set('location', location)
      resolve(new Response(null, { status, headers }))
      // Never call followRedirect: it would forward headers/body before validation.
      request.abort()
    })
    request.on('response', (incoming) => {
      if (settled) return
      try {
        const noBody = outgoing.method === 'HEAD' || [204, 205, 304].includes(incoming.statusCode)
        const body = noBody ? null
          : Readable.toWeb(incoming as unknown as Readable) as ReadableStream<Uint8Array>
        const response = new Response(body, {
          status: incoming.statusCode, statusText: incoming.statusMessage,
          headers: responseHeaders(incoming.headers)
        })
        incoming.once('end', cleanup)
        incoming.once('error', cleanup)
        request.once('close', cleanup)
        if (noBody) (incoming as unknown as Readable).resume()
        settled = true
        resolve(response)
      } catch (error) {
        fail(error instanceof Error ? error : new Error('feishu_network_error'))
        request.abort()
      }
    })
    if (signal.aborted) { abort(); return }
    request.end(bytes ? Buffer.from(bytes) : undefined)
  })
}

function responseHeaders(raw: Record<string, string | string[]>): Headers {
  const headers = new Headers()
  for (const [name, values] of Object.entries(raw)) {
    for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value)
  }
  return headers
}
