import type { createFileFindDomIndex } from './find-dom'
import type { HtmlInjectionMap } from './document'
import type { parseHtmlPreviewDiagnostic, HtmlPreviewDiagnostic, HtmlPreviewDiagnosticKind } from './protocol'

export interface PreviewBridgeConfig {
  previewId: string
  generation: string
  documentId: string
  origin: string
  hostOrigin: string
  documentUrl: string
  map: HtmlInjectionMap
  documentError: string | null
}

/** Serialized into a site-owned script. All runtime dependencies are arguments
 * or browser APIs; author globals, History and resource attributes stay native. */
export function previewBrowserBridge(config: PreviewBridgeConfig, createIndex: typeof createFileFindDomIndex, parseDiagnostic: typeof parseHtmlPreviewDiagnostic): void {
  const protocol = 'rovai-html-preview-v1'
  const nativePost = window.postMessage
  const post = (target: Window, origin: string, data: unknown): void => nativePost.call(target, data, { targetOrigin: origin === 'null' ? '*' : origin })
  const sendRaw = (target: Window, origin: string, type: string, data: Record<string, unknown> = {}): void => post(target, origin, {
    protocol, previewId: config.previewId, generation: config.generation, documentId: config.documentId, type, ...data
  })
  let connection: { id: string; origin: string } | null = null
  let loaded = document.readyState !== 'loading'
  const children = new Map<Window, { id: string; documentId: string | null }>()
  const diagnostics: HtmlPreviewDiagnostic[] = []
  const keys = new Map<string, number>()
  const abort = new AbortController()
  let indexes: { document: Document; index: ReturnType<typeof createIndex>; offset: number }[] = []
  const clean = (value: unknown, limit: number): string => {
    try { return String(value).slice(0, limit) } catch { return '未知错误' }
  }
  const send = (type: string, data: Record<string, unknown> = {}): void => {
    if (connection) sendRaw(parent, connection.origin, type, { connectionId: connection.id, ...data })
  }
  const state = (): void => send('state', { document: config.documentError ? 'failed' : loaded ? 'loaded' : 'loading', message: config.documentError })
  const add = (value: unknown): void => {
    const item = parseDiagnostic(value, config)
    if (!item) return
    const key = item.kind === 'resource' && item.resourceUrl ? JSON.stringify([item.kind, item.resourceUrl]) : JSON.stringify([item.kind, item.message, item.resourceUrl, item.line, item.column])
    const previous = keys.get(key)
    if (previous !== undefined) {
      // The browser error event often arrives before the service's HTTP result.
      if (item.status == null || diagnostics[previous].status != null) return
      diagnostics[previous] = item
    } else {
      if (diagnostics.length >= 100) return
      keys.set(key, diagnostics.length); diagnostics.push(item)
    }
    send('diagnostic', { diagnostic: item })
  }
  const position = (url: string | null, line: number | null, column: number | null): { line: number | null; column: number | null } => {
    if (url !== config.documentUrl || line !== config.map.line || column === null || column < config.map.column) return { line, column }
    if (column < config.map.column + config.map.length) return { line: null, column: null }
    return { line, column: column - config.map.length }
  }
  const report = (kind: HtmlPreviewDiagnosticKind, message: unknown, url: string | null = null, line: number | null = null, column: number | null = null, stack: unknown = null): void => {
    const located = position(url, line && line > 0 ? line : null, column && column > 0 ? column : null)
    const mappedStack = stack == null ? null : clean(stack, 8000).replace(/(https?:\/\/[^\s)]+):(\d+):(\d+)/gu, (match, resource: string, row: string, col: string) => {
      const mapped = position(resource, Number(row), Number(col))
      return mapped.line === null ? `${resource}:unknown` : `${resource}:${mapped.line}:${mapped.column ?? 'unknown'}`
    })
    add({ previewId: config.previewId, generation: config.generation, kind, message: clean(message, 2000) || '未知错误',
      resourceUrl: url?.slice(0, 2048) ?? null, ...located, stack: mappedStack, timestamp: new Date().toISOString() })
  }
  addEventListener('error', (event: Event) => {
    if (event instanceof ErrorEvent) {
      report('script', event.message || '脚本错误（浏览器未提供跨域详情）', event.filename || null, event.lineno || null, event.colno || null, event.error?.stack)
    } else if (event.target instanceof Element) {
      const target = event.target as HTMLImageElement & HTMLLinkElement
      report('resource', '资源加载失败（状态码未知）', target.currentSrc || target.src || target.href || null)
    }
  }, { capture: true, signal: abort.signal })
  addEventListener('unhandledrejection', event => {
    const reason = event.reason
    report('promise', reason instanceof Error ? reason.message : clean(reason, 2000), null, null, null, reason instanceof Error ? reason.stack : null)
  }, { signal: abort.signal })
  document.addEventListener('securitypolicyviolation', event => report('policy', `浏览器策略阻止：${event.effectiveDirective}（${clean(event.blockedURI || '资源未知', 1024)}）`, event.sourceFile || null, event.lineNumber || null, event.columnNumber || null), { signal: abort.signal })

  const childWindow = (source: MessageEventSource | null): source is Window => Boolean(source && [...document.querySelectorAll<HTMLIFrameElement>('iframe,frame')].some(frame => frame.contentWindow === source))
  const connectChild = (source: Window): void => {
    for (const child of children.keys()) if (!childWindow(child)) children.delete(child)
    if (children.size >= 64 && !children.has(source)) return
    const id = crypto.randomUUID()
    children.set(source, { id, documentId: null })
    sendRaw(source, config.origin, 'connect', { connectionId: id })
  }
  const clearFind = (): void => {
    for (const item of indexes) {
      const view = item.document.defaultView as (Window & typeof globalThis) | null
      view?.CSS?.highlights?.delete('rovai-file-find-match'); view?.CSS?.highlights?.delete('rovai-file-find-current')
    }
  }
  const invalidate = (): void => {
    if (indexes.length) { clearFind(); indexes = []; send('find-invalidated') }
    else if (connection?.origin === config.origin) send('find-invalidated')
  }
  const snapshot = (): string => {
    clearFind(); indexes = []
    let text = '', count = 0
    const visit = (doc: Document, depth: number): void => {
      if (!doc.body || depth > 8 || ++count > 32) return
      const index = createIndex(doc.body, undefined, true)
      if (text) text += '\n'
      indexes.push({ document: doc, index, offset: text.length }); text += index.text
      if (text.length > 8 * 1024 * 1024) throw new Error('页面正文过大，暂时无法查找。')
      for (const frame of doc.querySelectorAll<HTMLIFrameElement>('iframe,frame')) {
        if (!frame.getClientRects().length) continue
        try { if (frame.contentDocument) visit(frame.contentDocument, depth + 1) } catch { /* Cross-origin pages remain opaque. */ }
      }
    }
    visit(document, 0)
    return text
  }
  const fragment = (value: unknown): boolean => {
    if (typeof value !== 'string' || value.length > 1024) return false
    const raw = value.replace(/^#/u, '')
    let id = raw
    try { id = decodeURIComponent(raw) } catch { /* Already-decoded literal percent is a valid ID. */ }
    const target = document.getElementById(raw) || document.getElementsByName(raw)[0] || document.getElementById(id) || document.getElementsByName(id)[0]
    target?.scrollIntoView({ block: 'start' })
    return Boolean(target)
  }
  const command = (data: Record<string, unknown>): void => {
    if (data.type === 'fragment') { send('fragment-result', { found: fragment(data.fragment) }); return }
    if (data.type === 'find-snapshot' && Number.isSafeInteger(data.requestId)) {
      try { send('find-document', { requestId: data.requestId, text: snapshot() }) }
      catch { send('find-document', { requestId: data.requestId, error: true }) }
      return
    }
    if (data.type === 'find-clear') { clearFind(); return }
    if (data.type !== 'find-matches' || !Array.isArray(data.matches) || data.matches.length > 10000 || !Number.isSafeInteger(data.current) || typeof data.scroll !== 'boolean') return
    const matches = data.matches as { from: number; to: number }[]
    if (matches.some(match => !match || !Number.isSafeInteger(match.from) || !Number.isSafeInteger(match.to))) return
    for (const item of indexes) {
      const view = item.document.defaultView as (Window & typeof globalThis) | null
      if (!view?.CSS?.highlights || !view.Highlight) continue
      const rangeFor = (match: { from: number; to: number } | undefined): Range | null => match ? item.index.range(match.from - item.offset, match.to - item.offset) : null
      const ranges = matches.map(rangeFor).filter((range): range is Range => Boolean(range))
      const selected = rangeFor(matches[data.current as number])
      let style = item.document.querySelector<HTMLStyleElement>('style[data-rovai-preview-find]')
      if (!style) { style = item.document.createElement('style'); style.dataset.rovaiPreviewFind = ''; item.document.head.append(style) }
      if (Array.isArray(data.colors) && data.colors.length === 3 && data.colors.every(color => typeof color === 'string' && view.CSS.supports('color', color))) {
        style.textContent = `::highlight(rovai-file-find-match){background:${data.colors[0]};color:${data.colors[2]}}::highlight(rovai-file-find-current){background:${data.colors[1]};color:${data.colors[2]};text-decoration:underline}`
      }
      view.CSS.highlights.set('rovai-file-find-match', new view.Highlight(...ranges))
      view.CSS.highlights.set('rovai-file-find-current', new view.Highlight(...(selected ? [selected] : [])))
      if (selected && data.scroll) { selected.startContainer.parentElement?.scrollIntoView({ block: 'center', inline: 'nearest' }); view.frameElement?.scrollIntoView({ block: 'nearest' }) }
    }
  }
  addEventListener('message', event => {
    const data = event.data as Record<string, unknown> | null
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.protocol !== protocol
      || data.previewId !== config.previewId || data.generation !== config.generation) return
    if (event.source === parent && (event.origin === config.hostOrigin || event.origin === config.origin)) {
      if (data.type === 'connect' && typeof data.connectionId === 'string' && data.connectionId.length <= 128) {
        connection = { id: data.connectionId, origin: event.origin }
        send('connected'); state(); send('find-ready')
        if (event.origin !== config.origin) startServerDiagnostics()
        diagnostics.forEach(diagnostic => send('diagnostic', { diagnostic }))
      } else if (connection && data.connectionId === connection.id && data.documentId === config.documentId) command(data)
      return
    }
    if (event.origin !== config.origin || !childWindow(event.source)) return
    if (data.type === 'hello') { connectChild(event.source); return }
    const child = children.get(event.source)
    if (!child || child.id !== data.connectionId) return
    if (data.type === 'connected' && typeof data.documentId === 'string' && data.documentId.length <= 128) { child.documentId = data.documentId; return }
    if (child.documentId !== data.documentId) return
    if (data.type === 'diagnostic') {
      add(data.diagnostic)
    } else if (data.type === 'find-open' || data.type === 'find-close') send(data.type)
    else if (data.type === 'find-invalidated') invalidate()
  }, { signal: abort.signal })
  document.addEventListener('load', event => { if (event.target instanceof HTMLIFrameElement && event.target.contentWindow && event.target.contentDocument) connectChild(event.target.contentWindow) }, { capture: true, signal: abort.signal })
  document.addEventListener('keydown', event => {
    if (event.isTrusted && !event.isComposing && !event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation(); send('find-open')
    }
  }, { capture: true, signal: abort.signal })
  document.addEventListener('pointerdown', event => { if (event.isTrusted) send('find-close') }, { signal: abort.signal })
  // Ordinary HTTP navigation, hash routing and author click handlers stay native.
  document.addEventListener('click', event => {
    if (!event.isTrusted || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
    if (link?.protocol !== 'file:' || link.href.length > 4096) return
    event.preventDefault(); send('link', { href: link.href })
  }, { signal: abort.signal })
  const observer = new MutationObserver(invalidate)
  const ready = (): void => { loaded = true; if (document.body) observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true }); state(); send('find-ready') }
  if (!loaded) document.addEventListener('DOMContentLoaded', ready, { once: true, signal: abort.signal })
  else ready()
  // Parent challenges the actual current WindowProxy. A late old-document hello
  // cannot establish a connection or contribute diagnostics to a new document.
  sendRaw(parent, '*', 'hello')
  if (config.documentError) report('document', config.documentError, config.documentUrl)
  let serverDiagnosticsStarted = false
  function startServerDiagnostics(): void {
    if (serverDiagnosticsStarted) return
    serverDiagnosticsStarted = true
    // One stream per root document: subframes relay their own errors to it.
    // A stream in every iframe would exhaust HTTP/1 browser connection slots.
    void (async () => {
    try {
      const response = await fetch(`${config.origin}/__rovai-preview/events`, { signal: abort.signal, credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok || !response.body) throw new Error('预览诊断通道不可用。')
      const reader = response.body.getReader(), decoder = new TextDecoder()
      let pending = ''
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        pending += decoder.decode(next.value, { stream: true })
        if (pending.length > 128 * 1024) throw new Error('诊断响应超过上限。')
        const lines = pending.split('\n'); pending = lines.pop() ?? ''
        for (const line of lines) if (line) add(JSON.parse(line) as HtmlPreviewDiagnostic)
      }
      if (!abort.signal.aborted) throw new Error('预览诊断通道已断开。')
    } catch (error) { if (!abort.signal.aborted) { report('channel', error instanceof Error ? error.message : '预览诊断通道不可用。'); send('channel-unavailable') } }
    })()
  }
  addEventListener('pagehide', () => { abort.abort(); observer.disconnect(); children.clear(); indexes = []; connection = null }, { once: true })
}
