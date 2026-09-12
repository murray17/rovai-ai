import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pipeline } from 'node:stream/promises'
import { previewBrowserBridge, type PreviewBridgeConfig } from './browser-bridge'
import { injectPreviewScript } from './document'
import { createFileFindDomIndex } from './find-dom'
import { PreviewResourceError, previewRequestPath, type PreviewResource } from './file-source'
import { HTML_PREVIEW_DIAGNOSTIC_LIMIT, htmlPreviewDiagnosticKey, parseHtmlPreviewDiagnostic, type HtmlPreviewDescriptor, type HtmlPreviewDiagnostic, type HtmlPreviewDiagnosticKind } from './protocol'

export interface HtmlPreviewSiteOptions {
  generation: string
  hostOrigin: string
  entryPath: string
  validate(signal: AbortSignal): Promise<void>
  openResource(path: string, signal: AbortSignal): Promise<PreviewResource>
  /** Navigation-only fallback; absent means an ordinary static site. */
  spaEntryPath?: string
  idleTimeoutMs?: number
}

const COOKIE = '__Host-rovai-preview'
const INTERNAL = '/__rovai-preview/'

function sameSecret(value: string, expected: string): boolean {
  const left = Buffer.from(value), right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029')
}

/** Electron-free, revocable HTTP site. Host allocation gives each instance a
 * distinct origin; a capability exchange and cookie guard every resource read. */
export class HtmlPreviewSite {
  readonly descriptor: HtmlPreviewDescriptor
  readonly #options: HtmlPreviewSiteOptions
  readonly #server: Server
  readonly #credential = randomBytes(32).toString('base64url')
  readonly #cookie = randomBytes(32).toString('base64url')
  readonly #abort = new AbortController()
  readonly #scripts = new Map<string, string>()
  readonly #events = new Set<ServerResponse>()
  readonly #diagnostics: HtmlPreviewDiagnostic[] = []
  readonly #diagnosticKeys = new Set<string>()
  #entryNavigationPending = false
  #timer: ReturnType<typeof setTimeout> | null = null
  #closing: Promise<void> | null = null

  private constructor(options: HtmlPreviewSiteOptions) {
    this.#options = options
    const previewId = randomUUID()
    this.descriptor = { previewId, generation: options.generation, origin: '', entryUrl: '', documentUrl: '' }
    this.#server = createServer((request, response) => { void this.#serve(request, response) })
    this.#server.requestTimeout = 15_000
    this.#server.headersTimeout = 10_000
    this.#server.keepAliveTimeout = 5_000
    this.#server.maxHeadersCount = 64
  }

  static async create(options: HtmlPreviewSiteOptions): Promise<HtmlPreviewSite> {
    const site = new HtmlPreviewSite(options)
    try {
      if (options.hostOrigin !== 'null' && !/^https?:\/\//u.test(options.hostOrigin)) throw new Error('Invalid preview host origin')
      if (options.hostOrigin !== 'null' && new URL(options.hostOrigin).origin !== options.hostOrigin) throw new Error('Invalid preview host origin')
      await options.validate(site.#abort.signal)
      await new Promise<void>((resolve, reject) => {
        site.#server.once('error', reject)
        site.#server.listen(0, '127.0.0.1', () => { site.#server.removeListener('error', reject); resolve() })
      })
      const port = (site.#server.address() as AddressInfo).port
      const origin = `http://preview-${site.descriptor.previewId}.localhost:${port}`
      const entry = new URL(options.entryPath, `${origin}/`)
      if (entry.origin !== origin || !options.entryPath.startsWith('/') || options.entryPath.startsWith('//')) throw new Error('Invalid preview entry path')
      previewRequestPath(entry.pathname)
      Object.assign(site.descriptor, { origin, documentUrl: entry.href, entryUrl: `${origin}${INTERNAL}start/${site.#credential}` })
      await options.validate(site.#abort.signal)
      site.#touch()
      return site
    } catch (error) { await site.close(); throw error }
  }

  get closed(): boolean { return this.#abort.signal.aborted }

  #touch(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => { void this.close() }, this.#options.idleTimeoutMs ?? 30 * 60 * 1000)
    this.#timer.unref()
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing
    this.#abort.abort()
    if (this.#timer) clearTimeout(this.#timer)
    this.#scripts.clear()
    for (const response of this.#events) response.end()
    this.#events.clear()
    this.#closing = new Promise(resolve => {
      this.#server.closeAllConnections()
      if (!this.#server.listening) { resolve(); return }
      this.#server.close(() => resolve())
    })
    return this.#closing
  }

  report(kind: HtmlPreviewDiagnosticKind, message: string, resourceUrl: string | null, status: number | null = null): void {
    const item: HtmlPreviewDiagnostic = { previewId: this.descriptor.previewId, generation: this.descriptor.generation,
      kind, message: message.slice(0, 2000), resourceUrl: resourceUrl?.slice(0, 2048) ?? null,
      line: null, column: null, stack: null, timestamp: new Date().toISOString(), status }
    const key = htmlPreviewDiagnosticKey(item)
    if (this.closed || this.#diagnosticKeys.has(key) || this.#diagnostics.length >= HTML_PREVIEW_DIAGNOSTIC_LIMIT) return
    this.#diagnosticKeys.add(key); this.#diagnostics.push(item)
    for (const stream of this.#events) {
      if (stream.writableLength > 128 * 1024) { stream.end(); this.#events.delete(stream); continue }
      stream.write(`${JSON.stringify(item)}\n`)
    }
  }

  #headers(response: ServerResponse): void {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Origin-Agent-Cluster', '?1')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // Browser CORS, mixed-content, TLS, and author CSP remain effective. A site
    // cannot opt out of origin isolation or use its iframe to navigate the host.
    const host = this.#options.hostOrigin === 'null' ? 'file:' : this.#options.hostOrigin
    response.setHeader('Content-Security-Policy', `default-src 'self' http: https: data: blob:; script-src 'self' http: https: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' http: https: 'unsafe-inline'; connect-src 'self' http: https: ws: wss:; frame-src 'self' http: https:; object-src 'none'; frame-ancestors 'self' ${host}`)
  }

  #document(html: string, url: string, documentError: string | null): string {
    const documentId = randomUUID()
    const scriptPath = `${INTERNAL}bridge/${documentId}.js`
    const injected = injectPreviewScript(html, scriptPath)
    const config: PreviewBridgeConfig = { previewId: this.descriptor.previewId, generation: this.descriptor.generation, origin: this.descriptor.origin, documentId, hostOrigin: this.#options.hostOrigin,
      documentUrl: url, map: injected.map, documentError }
    this.#scripts.set(scriptPath, `(${previewBrowserBridge.toString()})(${jsonForScript(config)},(${createFileFindDomIndex.toString()}),(${parseHtmlPreviewDiagnostic.toString()}));`)
    // A bounded collection retains outstanding document requests and subframes.
    while (this.#scripts.size > 128) this.#scripts.delete(this.#scripts.keys().next().value!)
    return injected.html
  }

  async #serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestAbort = new AbortController()
    response.once('close', () => requestAbort.abort())
    const signal = AbortSignal.any([this.#abort.signal, requestAbort.signal])
    let resource: PreviewResource | null = null
    let url: URL | null = null
    let authenticated = false
    const navigation = ['document', 'iframe', 'frame'].includes(request.headers['sec-fetch-dest'] as string)
      || String(request.headers.accept ?? '').includes('text/html')
    try {
      this.#headers(response)
      if (this.closed) throw new PreviewResourceError(410, '这个预览已关闭。')
      if (request.headers.host !== new URL(this.descriptor.origin).host || !request.url?.startsWith('/') || request.url.startsWith('//')) throw new PreviewResourceError(403, '预览来源不匹配。')
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); throw new PreviewResourceError(405, '此预览只提供文件读取。') }
      url = new URL(request.url, this.descriptor.origin)
      if (url.origin !== this.descriptor.origin || url.username || url.password) throw new PreviewResourceError(403, '预览来源不匹配。')
      const cookie = String(request.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? ''
      const bootstrap = url.pathname.startsWith(`${INTERNAL}start/`) && sameSecret(url.pathname.slice(`${INTERNAL}start/`.length), this.#credential)
      authenticated = sameSecret(cookie, this.#cookie)
      if (!bootstrap && !authenticated) throw new PreviewResourceError(403, '这个预览访问已失效，请重新打开。')
      const fetchSite = request.headers['sec-fetch-site']
      const entryDocument = new URL(this.descriptor.documentUrl)
      entryDocument.hash = ''
      const entryNavigation = authenticated && navigation && this.#entryNavigationPending && url.href === entryDocument.href
      if (!bootstrap && !entryNavigation && fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new PreviewResourceError(403, '资源请求来自另一个页面。')
      if (request.headers.origin && request.headers.origin !== this.descriptor.origin) throw new PreviewResourceError(403, '资源请求来源不匹配。')
      await this.#options.validate(signal)
      signal.throwIfAborted()
      if (bootstrap) {
        this.#entryNavigationPending = true
        response.setHeader('Set-Cookie', `${COOKIE}=${this.#cookie}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned`)
        response.setHeader('Cache-Control', 'no-store')
        response.writeHead(302, { Location: this.descriptor.documentUrl }); response.end(); this.#touch(); return
      }
      if (entryNavigation) this.#entryNavigationPending = false
      if (url.pathname === `${INTERNAL}events`) {
        if (request.method !== 'GET' || this.#events.size >= 64) throw new PreviewResourceError(429, '预览诊断连接过多。')
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' })
        response.flushHeaders()
        for (const item of this.#diagnostics) response.write(`${JSON.stringify(item)}\n`)
        this.#events.add(response); response.once('close', () => this.#events.delete(response)); return
      }
      const script = this.#scripts.get(url.pathname)
      if (script) {
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(request.method === 'HEAD' ? undefined : script); return
      }
      if (url.pathname.startsWith(INTERNAL)) throw new PreviewResourceError(404, '预览内部资源不存在。')
      const path = previewRequestPath(request.url)
      try { resource = await this.#options.openResource(path, signal) }
      catch (error) {
        if (!(error instanceof PreviewResourceError) || error.status !== 404 || !navigation || !this.#options.spaEntryPath || /\.[^/]+$/u.test(url.pathname)) throw error
        resource = await this.#options.openResource(previewRequestPath(this.#options.spaEntryPath), signal)
      }
      await this.#options.validate(signal)
      signal.throwIfAborted(); this.#touch()
      response.setHeader('Content-Type', resource.mime)
      const isHtml = resource.mime.startsWith('text/html')
      response.setHeader('Cache-Control', isHtml ? 'no-store' : 'private, no-cache')
      response.setHeader('Accept-Ranges', isHtml ? 'none' : 'bytes')
      if (isHtml) {
        const bytes = await resource.file.readFile({ signal })
        let html: string
        try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new PreviewResourceError(422, '无法按 UTF-8 读取 HTML 文档。') }
        await this.#options.validate(signal)
        signal.throwIfAborted()
        const body = Buffer.from(this.#document(html, url.href, null))
        response.setHeader('Content-Length', body.length)
        response.writeHead(200); response.end(request.method === 'HEAD' ? undefined : body); return
      }
      const etag = `"${resource.identity}-${resource.size}-${resource.mtimeMs}"`
      response.setHeader('ETag', etag)
      if (request.headers['if-none-match'] === etag && !request.headers.range) { response.writeHead(304); response.end(); return }
      let start = 0, end = resource.size - 1, status = 200
      if (request.headers.range && (!request.headers['if-range'] || request.headers['if-range'] === etag)) {
        const range = /^bytes=(\d*)-(\d*)$/u.exec(request.headers.range)
        if (!range || (!range[1] && !range[2])) throw new PreviewResourceError(416, '资源范围无效。')
        start = range[1] ? Number(range[1]) : Math.max(0, resource.size - Number(range[2]))
        end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= resource.size) { response.setHeader('Content-Range', `bytes */${resource.size}`); throw new PreviewResourceError(416, '资源范围无效。') }
        status = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${resource.size}`)
      }
      response.setHeader('Content-Length', Math.max(0, end - start + 1))
      response.writeHead(status)
      if (request.method === 'HEAD' || resource.size === 0) { response.end(); return }
      await pipeline(resource.file.createReadStream({ start, end, autoClose: false }), response, { signal })
    } catch (error) {
      if (signal.aborted || response.destroyed) return
      const status = error instanceof PreviewResourceError ? error.status : 410
      const message = error instanceof PreviewResourceError ? error.message : '预览文件上下文已失效，请重新打开。'
      if (authenticated && url && !url.pathname.startsWith(INTERNAL)) this.report('resource', `${message}（HTTP ${status}）`, url.href, status)
      if (response.headersSent) { response.destroy(); return }
      response.removeHeader('Content-Length'); response.setHeader('Cache-Control', 'no-store')
      // An authenticated failed navigation is still a real error response. Its
      // bridge lets the host distinguish a missing document from a missing image.
      const body = authenticated && navigation && url
        ? this.#document('<!doctype html><html><head><meta charset="utf-8"><title>无法加载页面</title></head><body>无法加载页面</body></html>', url.href, `${message}（HTTP ${status}）`)
        : message
      response.writeHead(status, { 'Content-Type': authenticated && navigation ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' })
      response.end(request.method === 'HEAD' ? undefined : body)
    } finally { await resource?.file.close().catch(() => undefined) }
  }
}
