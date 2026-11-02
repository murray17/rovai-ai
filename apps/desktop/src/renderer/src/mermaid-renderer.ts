import type { ResolvedTheme } from '@contracts'
import { MERMAID_CHANNEL, MERMAID_MAX_TEXT_SIZE, type MermaidPalette } from './mermaid-renderer-policy'

const WAIT_MS = 15_000
type Request = { generation: number; resolve(svg: string): void; reject(error: Error): void; timer?: ReturnType<typeof setTimeout> }
let generation = 0
let requestId = 0
let frame: HTMLIFrameElement | null = null
let loading: Promise<HTMLIFrameElement> | null = null
let disposeLoading: (() => void) | null = null
let removeListener: (() => void) | null = null
let queue: Promise<void> = Promise.resolve()
const requests = new Map<number, Request>()

function settle(id: number, svg?: string): void {
  const request = requests.get(id)
  if (!request) return
  requests.delete(id)
  clearTimeout(request.timer)
  if (svg) request.resolve(svg)
  else request.reject(new Error('mermaid-render-failed'))
}

function resetRenderer(): void {
  generation += 1
  disposeLoading?.()
  disposeLoading = null
  removeListener?.()
  removeListener = null
  frame?.remove()
  frame = null
  loading = null
  for (const id of requests.keys()) settle(id)
  // Old chains may finish later; the generation check stops them before send.
  queue = Promise.resolve()
}

function loadRenderer(): Promise<HTMLIFrameElement> {
  if (loading) return loading
  const currentGeneration = generation
  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (currentGeneration === generation) resetRenderer() }, WAIT_MS)
    disposeLoading = () => { clearTimeout(timer); reject(new Error('mermaid-load-failed')) }
    void import('./mermaid-sandbox').then(async ({ sandboxDocument }) => {
      const documentSource = await sandboxDocument(currentGeneration)
      if (currentGeneration !== generation) return
      const element = document.createElement('iframe')
      element.setAttribute('sandbox', 'allow-scripts')
      element.setAttribute('aria-hidden', 'true')
      element.tabIndex = -1
      element.title = 'Mermaid renderer'
      element.dataset.mermaidRenderer = ''
      // Hidden, but measurable: display:none would break SVG text/layout metrics.
      element.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;visibility:hidden;pointer-events:none;border:0;'
      frame = element
      const receive = (event: MessageEvent): void => {
        const data = event.data
        if (event.source !== element.contentWindow || currentGeneration !== generation || !data
          || data.channel !== MERMAID_CHANNEL || data.generation !== currentGeneration) return
        if (data.type === 'ready') {
          clearTimeout(timer)
          disposeLoading = null
          resolve(element)
        } else if (data.type === 'result' && Number.isSafeInteger(data.id)) {
          const request = requests.get(data.id)
          if (request?.generation === currentGeneration) settle(data.id, typeof data.svg === 'string' ? data.svg : undefined)
        }
      }
      window.addEventListener('message', receive)
      removeListener = () => window.removeEventListener('message', receive)
      element.srcdoc = documentSource
      document.body.append(element)
    }).catch(() => { if (currentGeneration === generation) resetRenderer() })
  })
  return loading
}

function palette(theme: ResolvedTheme): MermaidPalette {
  const style = getComputedStyle(document.documentElement)
  const color = (token: string): string => style.getPropertyValue(token).trim()
  return { darkMode: theme === 'night', background: color('--file-canvas'), foreground: color('--file-ink'),
    line: color('--file-muted'), border: color('--file-muted'), fontFamily: getComputedStyle(document.body).fontFamily }
}

/** Returns SVG intended exclusively for a Blob-backed img, never host innerHTML. */
export function renderMermaid(source: string, theme: ResolvedTheme): Promise<string> {
  if (source.length > MERMAID_MAX_TEXT_SIZE) return Promise.reject(new Error('mermaid-source-limit'))
  const id = ++requestId
  const currentGeneration = generation
  // Snapshot tokens at submission, not after waiting behind another theme.
  const colors = palette(theme)
  const result = new Promise<string>((resolve, reject) => requests.set(id, { generation: currentGeneration, resolve, reject }))
  queue = queue.then(async () => {
    if (currentGeneration !== generation || !requests.has(id)) return
    try {
      const renderer = await loadRenderer()
      const request = requests.get(id)
      if (currentGeneration !== generation || !request) return
      request.timer = setTimeout(() => { if (currentGeneration === generation) resetRenderer() }, WAIT_MS)
      renderer.contentWindow?.postMessage({ channel: MERMAID_CHANNEL, generation: currentGeneration,
        type: 'render', id, source, palette: colors }, '*')
      await result.catch(() => undefined)
    } catch { if (currentGeneration === generation) resetRenderer() }
  })
  // Attach a handler immediately, including while this request is still queued.
  void result.catch(() => undefined)
  return result
}
