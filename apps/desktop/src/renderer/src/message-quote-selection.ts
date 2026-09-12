import type { MessageQuoteSelection } from '@contracts'

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE'])
const EXCLUDED = '[data-quote-exclude], [aria-hidden="true"], img, input, button:not(.message-mention-token), .message-quote-preview, .external-quote'
const INVALID_RANGE = '[data-quote-exclude], img, input:not([type=checkbox]), button:not(.message-mention-token), .message-quote-preview, .external-quote'
type TextPosition = { node: Text; start: number; end: number }

/** Converts normalized Unicode scalar offsets back into the DOM's UTF-16 offsets. */
export function quoteDomOffset(text: string, scalar: number): number {
  let offset = 0
  for (let count = 0; count < scalar && offset < text.length; count++) {
    const code = text.codePointAt(offset)!
    offset += code > 0xffff ? 2 : 1
    if (code === 13 && text.charCodeAt(offset) === 10) offset++
  }
  return offset
}

/** Mirrors MessageQuoteTextProjection v1; positions address actual DOM text, never card/UI copy. */
export function projectQuoteBody(root: HTMLElement, plainBody?: string): { text: string; positions: TextPosition[] } {
  let text = ''
  let boundary = 0
  let sourceCursor = 0
  let scalarLength = 0
  const positions: TextPosition[] = []
  const boundaryAt = (amount: number): void => { boundary = Math.max(boundary, amount) }
  const append = (node: Text): void => {
    const value = node.data.replace(/\r\n/gu, '\n')
    if (plainBody !== undefined) {
      const at = plainBody.indexOf(value, sourceCursor)
      if (at < 0) throw new Error('quote.projection_mismatch')
      const start = scalarLength + Array.from(plainBody.slice(sourceCursor, at)).length
      scalarLength = start + Array.from(value).length
      positions.push({ node, start, end: scalarLength })
      sourceCursor = at + value.length
      return
    }
    if (text && boundary) {
      const separator = '\n'.repeat(Math.max(0, boundary - (text.match(/\n*$/u)?.[0].length ?? 0)))
      text += separator; scalarLength += separator.length
    }
    boundary = 0
    const start = scalarLength
    text += value
    scalarLength += Array.from(value).length
    positions.push({ node, start, end: scalarLength })
  }
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement
      // react-markdown inserts formatting whitespace between HTML blocks, not readable body text.
      if (plainBody === undefined && !node.textContent?.trim() && parent) {
        const layoutContainer = ['DIV', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR'].includes(parent.tagName)
        // Loose lists put newline nodes around paragraphs; tight lists need their inline spaces and soft breaks.
        const listBlockSeparator = parent.tagName === 'LI' && [node.previousSibling, node.nextSibling]
          .some(sibling => sibling instanceof Element && BLOCKS.has(sibling.tagName))
        if (layoutContainer || listBlockSeparator) return
      }
      if (plainBody === undefined && node.previousSibling instanceof Element && node.previousSibling.tagName === 'BR' && node.textContent === '\n') return
      append(node as Text)
      return
    }
    if (!(node instanceof Element) || node.matches(EXCLUDED)) return
    if (node.tagName === 'BR') { text += '\n'; scalarLength++; return }
    if (BLOCKS.has(node.tagName) && text) boundaryAt(2)
    for (const child of node.childNodes) walk(child)
    if (node.tagName === 'TD' || node.tagName === 'TH') {
      if (node.nextElementSibling) { text += '\t'; scalarLength++ }
    } else if (node.tagName === 'TR') boundaryAt(1)
    else if (BLOCKS.has(node.tagName) || node.tagName === 'HR') boundaryAt(2)
  }
  walk(root)
  return { text: plainBody ?? text, positions }
}

function rangePoint(positions: TextPosition[], node: Node, offset: number, end: boolean): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const position = positions.find((entry) => entry.node === node)
    return position ? position.start + Array.from((node.textContent ?? '').slice(0, offset).replace(/\r\n/gu, '\n')).length : null
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

function messageQuoteRootAt(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return element?.closest<HTMLElement>('[data-message-quote-body]') ?? null
}

/**
 * Native block/line selection may place an empty endpoint in adjacent UI. Clamp that boundary
 * back to the message, while continuing to reject any actual selected text outside it.
 */
function rangeWithinMessage(nativeRange: Range, ownerKey: string): { range: Range; root: HTMLElement } | null {
  const selectedText = nativeRange.toString().trim()
  const roots = [messageQuoteRootAt(nativeRange.startContainer), messageQuoteRootAt(nativeRange.endContainer)]
  const seen = new Set<HTMLElement>()
  for (const root of roots) {
    if (!root || root.dataset.quoteOwner !== ownerKey || seen.has(root)) continue
    seen.add(root)
    const range = nativeRange.cloneRange()
    try {
      if (!root.contains(range.startContainer)) range.setStart(root, 0)
      if (!root.contains(range.endContainer)) range.setEnd(root, root.childNodes.length)
    } catch { continue }
    if (!range.collapsed && range.toString().trim() === selectedText) return { range, root }
  }
  return null
}

export function readMessageQuoteSelection(
  selection: Selection | null,
  ownerKey: string,
  message: (id: string) => { id: string; body: string; authorType: string } | undefined
): { selection: MessageQuoteSelection; range: Range; root: HTMLElement } | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
  const contained = rangeWithinMessage(selection.getRangeAt(0), ownerKey)
  if (!contained) return null
  const { range, root } = contained
  if (!root.isConnected) return null
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
    const currentUserDisplayName = root.querySelector<HTMLElement>('[data-quote-current-user-name]')?.dataset.quoteCurrentUserName
    return { selection: { messageId: source.id, bodyAtSelection: source.body, startScalar, endScalar, text,
      ...(currentUserDisplayName ? { currentUserDisplayName } : {}) }, range: range.cloneRange(), root }
  } catch { return null }
}

export function dismissMessageQuoteSelection(): void {
  window.dispatchEvent(new Event('rovai-dismiss-message-quote'))
}
