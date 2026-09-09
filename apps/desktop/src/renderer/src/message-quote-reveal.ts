import type { MessageQuoteSnapshot } from '@contracts'
import { projectQuoteBody, quoteDomOffset } from './message-quote-selection'
import { prefersReducedMotion } from './reduced-motion'

let generation = 0
let clearActive: (() => void) | undefined

export async function quoteProjectionDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Old snapshots can locate only an unambiguous full excerpt. Never guess a repeated occurrence. */
function uniqueRange(text: string, excerpt: string): [number, number] | null {
  const start = text.indexOf(excerpt)
  if (start < 0 || text.indexOf(excerpt, start + 1) >= 0) return null
  return [Array.from(text.slice(0, start)).length, Array.from(text.slice(0, start + excerpt.length)).length]
}

export async function revealMessageQuote(quote: MessageQuoteSnapshot, root: HTMLElement, plainBody?: string): Promise<void> {
  const current = ++generation
  clearActive?.()
  if (!root.isConnected) throw new Error('quote.source_unavailable')
  const projection = projectQuoteBody(root, plainBody)
  let selected: [number, number] | null
  if (quote.locator) {
    const { startScalar, endScalar, projectionDigest, projectionVersion } = quote.locator
    selected = projectionVersion === 1 && startScalar >= 0 && endScalar > startScalar
      && await quoteProjectionDigest(projection.text) === projectionDigest
      && Array.from(projection.text).slice(startScalar, endScalar).join('') === quote.text
      ? [startScalar, endScalar] : null
  } else selected = uniqueRange(projection.text, quote.text)
  if (current !== generation || !root.isConnected) return
  if (!selected) {
    root.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    throw new Error('quote.selection_unavailable')
  }
  const [start, end] = selected
  let decorations: HTMLElement[] = []
  let targets: HTMLElement[] = []
  let frame = 0
  let fade: ReturnType<typeof setTimeout>
  let finish: ReturnType<typeof setTimeout>
  let observer: ResizeObserver
  let mutation: MutationObserver
  const removeBands = (): void => {
    decorations.forEach(node => node.remove())
    targets.forEach(node => node.classList.remove('message-quote-line-target'))
    decorations = []; targets = []
  }
  const clear = (): void => {
    clearTimeout(fade); clearTimeout(finish); cancelAnimationFrame(frame)
    observer?.disconnect(); mutation?.disconnect()
    removeBands(); delete root.dataset.quoteLocated
    if (clearActive === clear) clearActive = undefined
  }
  const paint = (): { top: number; bottom: number } | null => {
    mutation?.disconnect()
    removeBands()
    if (!root.isConnected) { clear(); return null }
    let next: ReturnType<typeof projectQuoteBody>
    try { next = projectQuoteBody(root, plainBody) }
    catch { clear(); return null }
    if (next.text !== projection.text) { clear(); return null }
    const blocks = new Map<HTMLElement, Array<{ top: number; height: number }>>()
    for (const position of next.positions) {
      if (position.end <= start || position.start >= end) continue
      const range = document.createRange()
      range.setStart(position.node, quoteDomOffset(position.node.data, Math.max(0, start - position.start)))
      range.setEnd(position.node, quoteDomOffset(position.node.data, Math.min(position.end - position.start, end - position.start)))
      const closest = position.node.parentElement?.closest<HTMLElement>('pre, p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote')
      const block = closest && root.contains(closest) ? closest : root
      const lines = blocks.get(block) ?? []
      const lineHeight = Number.parseFloat(getComputedStyle(position.node.parentElement ?? block).lineHeight)
      for (const rect of range.getClientRects()) {
        if (rect.height <= 0) continue
        const height = Number.isFinite(lineHeight) ? Math.max(rect.height, lineHeight) : rect.height
        const top = rect.top - (height - rect.height) / 2
        if (!lines.some(line => Math.abs(line.top - top) < 2)) lines.push({ top, height })
      }
      blocks.set(block, lines)
    }
    let top = Infinity, bottom = -Infinity
    for (const [block, lines] of blocks) {
      if (!lines.length) continue
      lines.sort((a, b) => a.top - b.top)
      const bands: Array<{ top: number; bottom: number; lines: number }> = []
      for (const line of lines) {
        const previous = bands.at(-1)
        if (previous && line.top <= previous.bottom + 1) { previous.bottom = Math.max(previous.bottom, line.top + line.height); previous.lines++ }
        else bands.push({ top: line.top, bottom: line.top + line.height, lines: 1 })
      }
      block.classList.add('message-quote-line-target'); targets.push(block)
      const bounds = block.getBoundingClientRect()
      const layer = document.createElement('span')
      layer.className = 'message-quote-line-layer'
      // Empty decoration must not become an excluded selection obstacle.
      layer.dataset.quoteDecoration = ''; layer.setAttribute('aria-hidden', 'true')
      for (const band of bands) {
        const mark = document.createElement('span')
        mark.className = 'message-quote-line-band'; mark.dataset.lines = String(band.lines)
        mark.style.top = `${band.top - bounds.top - block.clientTop + block.scrollTop}px`
        mark.style.height = `${band.bottom - band.top}px`
        layer.append(mark)
        top = Math.min(top, band.top); bottom = Math.max(bottom, band.bottom)
      }
      block.append(layer); decorations.push(layer)
    }
    mutation?.observe(root, { childList: true, characterData: true, subtree: true })
    return top < Infinity ? { top, bottom } : null
  }
  const bounds = paint()
  if (!bounds) { clear(); throw new Error('quote.selection_unavailable') }
  clearActive = clear
  root.dataset.quoteLocated = 'true'
  const timeline = root.closest<HTMLElement>('.conversation-timeline, .single-chat-transcript')
  if (timeline) {
    const viewport = timeline.getBoundingClientRect()
    const padding = 40
    const center = Math.min(bounds.bottom - bounds.top, timeline.clientHeight - 2 * padding) / 2
    timeline.scrollTo({ top: timeline.scrollTop + bounds.top - viewport.top + center - timeline.clientHeight / 2, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  } else root.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  // Keyboard navigation leaves the popover at the actual source, without a message-wide focus rail.
  root.tabIndex = -1
  root.focus({ preventScroll: true })
  const repaint = (): void => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { paint() }) }
  observer = new ResizeObserver(repaint); observer.observe(root)
  mutation = new MutationObserver(repaint)
  mutation.observe(root, { childList: true, characterData: true, subtree: true })
  fade = setTimeout(() => { decorations.forEach(node => node.classList.add('is-fading')) }, 3000)
  finish = setTimeout(clear, 3650)
}
