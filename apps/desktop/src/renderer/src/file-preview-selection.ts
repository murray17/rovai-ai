import type { KeyboardEvent } from 'react'

export function isPreviewSelectAll(event: KeyboardEvent<HTMLElement>): boolean {
  if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.shiftKey
    || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') return false
  const target = event.target
  return !(target instanceof HTMLElement
    && (target.isContentEditable || target.closest('input, textarea, select')))
}

export function selectPreviewContents(event: KeyboardEvent<HTMLElement>, content: HTMLElement | null): void {
  if (!content || !isPreviewSelectAll(event)) return
  const selection = content.ownerDocument.getSelection()
  if (!selection) return
  const range = content.ownerDocument.createRange()
  range.selectNodeContents(content)
  event.preventDefault()
  event.stopPropagation()
  selection.removeAllRanges()
  selection.addRange(range)
}
