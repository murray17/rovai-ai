import type { MessageQuoteSelection } from '@contracts'

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE'])
const EXCLUDED = '[data-quote-exclude], [aria-hidden="true"], img, input, button:not(.message-mention-token), .message-quote-preview, .external-quote'
const INVALID_RANGE = '[data-quote-exclude], img, input:not([type=checkbox]), button:not(.message-mention-token), .message-quote-preview, .external-quote'
type TextPosition = { node: Text; start: number; end: number }

/** Mirrors MessageQuoteTextProjection v1; positions address actual DOM text, never card/UI copy. */
export function projectQuoteBody(root: HTMLElement, plainBody?: string): { text: string; positions: TextPosition[] } {
  let text = ''
  let boundary = 0
  let sourceCursor = 0
  const positions: TextPosition[] = []
  const boundaryAt = (amount: number): void => { boundary = Math.max(boundary, amount) }
  const append = (node: Text): void => {
    const value = node.data.replace(/\r\n/gu, '\n')
    if (plainBody !== undefined) {
      const at = plainBody.indexOf(value, sourceCursor)
      if (at < 0) throw new Error('quote.projection_mismatch')
      positions.push({ node, start: Array.from(plainBody.slice(0, at)).length, end: Array.from(plainBody.slice(0, at + value.length)).length })
      sourceCursor = at + value.length
      return
    }
    if (text) text += '\n'.repeat(Math.max(0, boundary - (text.match(/\n*$/u)?.[0].length ?? 0)))
    boundary = 0
    const start = Array.from(text).length
    text += value
    positions.push({ node, start, end: Array.from(text).length })
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement
      // react-markdown inserts formatting whitespace between HTML blocks, not readable body text.
      if (plainBody === undefined && !node.textContent?.trim() && parent && ['DIV', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR'].includes(parent.tagName)) return
      if (plainBody === undefined && node.previousSibling instanceof Element && node.previousSibling.tagName === 'BR' && node.textContent === '\n') return
      append(node as Text)
      return
    }
    if (!(node instanceof Element) || node.matches(EXCLUDED)) return
    if (node.tagName === 'BR') { text += '\n'; return }
    if (BLOCKS.has(node.tagName) && text) boundaryAt(2)
    for (const child of node.childNodes) walk(child)
    if (node.tagName === 'TD' || node.tagName === 'TH') {
      if (node.nextElementSibling) text += '\t'
    } else if (node.tagName === 'TR') boundaryAt(1)
    else if (BLOCKS.has(node.tagName) || node.tagName === 'HR') boundaryAt(2)
  }
  walk(root)
  return { text: plainBody ?? text, positions }
}

function rangePoint(positions: TextPosition[], node: Node, offset: number, end: boolean): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const position = positions.find((entry) => entry.node === node)
    return position ? position.start + Array.from((node.textContent ?? '').slice(0, offset)).length : null
  }
  const children = [...node.childNodes]
  if (end && offset > 0) {
    for (let index = offset - 1; index >= 0; index -= 1) {
      const last = positions.filter((entry) => children[index]?.contains(entry.node)).at(-1)
      if (last) return last.end
    }
  }
  for (let index = offset; index < children.length; index += 1) {
    const first = positions.find((entry) => children[index]?.contains(entry.node))
    if (first) return first.start
  }
  return positions.filter((entry) => node.contains(entry.node)).at(-1)?.end ?? null
}

export function readMessageQuoteSelection(
  selection: Selection | null,
  ownerKey: string,
  message: (id: string) => { id: string; body: string; authorType: string } | undefined
): { selection: MessageQuoteSelection; range: Range; root: HTMLElement } | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement
  const root = element?.closest<HTMLElement>('[data-message-quote-body]')
  if (!root || root.dataset.quoteOwner !== ownerKey || !root.contains(range.endContainer) || !root.isConnected) return null
  const source = message(root.dataset.messageQuoteBody ?? '')
  if (!source || !['user', 'agent'].includes(source.authorType) || source.id.startsWith('optimistic:')) return null
  if ([...root.querySelectorAll(INVALID_RANGE)].some((excluded) => range.intersectsNode(excluded))) return null
  try {
    const projection = projectQuoteBody(root, source.authorType === 'user' ? source.body.replace(/\r\n/gu, '\n') : undefined)
    const startScalar = rangePoint(projection.positions, range.startContainer, range.startOffset, false)
    const endScalar = rangePoint(projection.positions, range.endContainer, range.endOffset, true)
    if (startScalar === null || endScalar === null || endScalar <= startScalar) return null
    const text = Array.from(projection.text).slice(startScalar, endScalar).join('')
    if (!text.trim()) return null
    return { selection: { messageId: source.id, bodyAtSelection: source.body, startScalar, endScalar, text }, range: range.cloneRange(), root }
  } catch { return null }
}

export function dismissMessageQuoteSelection(): void {
  window.dispatchEvent(new Event('rovai-dismiss-message-quote'))
}
