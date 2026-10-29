import type { MessageQuoteSelection } from '@contracts'

const BLOCKS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'TABLE', 'DETAILS', 'SUMMARY'])
const EXCLUDED = '[data-quote-exclude], [aria-hidden="true"], img, input, button:not(.message-mention-token), .message-quote-preview, .external-quote'
const INVALID_RANGE = '[data-quote-exclude], img, input:not([type=checkbox]), button:not(.message-mention-token), .message-quote-preview, .external-quote'
/** Extract only visible selected text; no source-body projection or persisted offsets. */
export function readMessageQuoteText(root: Node): string {
  let text = ''
  let boundary = 0
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement
      let value = node.textContent?.replace(/\r\n/gu, '\n') ?? ''
      if (!value.trim() && !parent?.closest('pre, code')) {
        const blockSeparator = [node.previousSibling, node.nextSibling]
          .some(sibling => sibling instanceof Element && BLOCKS.has(sibling.tagName))
        const layout = ['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR'].includes(parent?.tagName ?? '')
        const containerEdge = ['DIV', 'BLOCKQUOTE'].includes(parent?.tagName ?? '') && (!node.previousSibling || !node.nextSibling)
        // Spaces between inline siblings belong to the selected message text.
        if (layout || blockSeparator || containerEdge) return
      }
      if (node.previousSibling instanceof Element && node.previousSibling.tagName === 'BR' && value.startsWith('\n')) value = value.slice(1)
      if (text && boundary) text += '\n'.repeat(Math.max(0, boundary - (text.match(/\n*$/u)?.[0].length ?? 0)))
      boundary = 0
      text += value
      return
    }
    if (node instanceof Element) {
      if (node.matches(EXCLUDED)) return
      if (node.tagName === 'BR') { text += '\n'; return }
      if (BLOCKS.has(node.tagName) && text) boundary = Math.max(boundary, 2)
      if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
        const summary = [...node.children].find(child => child.tagName === 'SUMMARY')
        if (summary) walk(summary)
        return
      }
    }
    for (const child of node.childNodes) walk(child)
    if (!(node instanceof Element)) return
    if (node.tagName === 'TD' || node.tagName === 'TH') {
      if (node.nextElementSibling) text += '\t'
    } else if (node.tagName === 'TR') boundary = Math.max(boundary, 1)
    else if (BLOCKS.has(node.tagName) || node.tagName === 'HR') boundary = Math.max(boundary, 2)
  }
  walk(root)
  return text
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
  message: (id: string) => { id: string } | undefined
): { selection: MessageQuoteSelection; range: Range; root: HTMLElement } | null {
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null
  const contained = rangeWithinMessage(selection.getRangeAt(0), ownerKey)
  if (!contained) return null
  const { range, root } = contained
  if (!root.isConnected) return null
  const source = message(root.dataset.messageQuoteBody ?? '')
  if ([...root.querySelectorAll(INVALID_RANGE)].some((excluded) => {
    if (!range.intersectsNode(excluded)) return false
    for (let parent = excluded.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(excluded)) return false
    }
    return true
  })) return null
  // Preserve the selection's container so layout whitespace and code spaces keep their meaning.
  const ancestor = range.commonAncestorContainer
  const element = ancestor instanceof Element ? ancestor : ancestor.parentElement
  const selected = element?.cloneNode(false) ?? document.createDocumentFragment()
  selected.appendChild(range.cloneContents())
  const text = readMessageQuoteText(selected)
  if (!text.trim()) return null
  const messageId = source && !source.id.startsWith('optimistic:') ? source.id : undefined
  return { selection: { ...(messageId ? { messageId } : {}), text }, range: range.cloneRange(), root }

}

export function dismissMessageQuoteSelection(): void {
  window.dispatchEvent(new Event('rovai-dismiss-message-quote'))
}
