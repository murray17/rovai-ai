/** Self-contained so the same index can run inside the existing isolated HTML bridge. */
export function createFileFindDomIndex(root: HTMLElement, selector?: string, includeButtons = false) {
  const document = root.ownerDocument
  const entries: { node: Text; from: number; to: number }[] = []
  let text = ''
  let block: Element | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const parent = node.parentElement
    if (!parent || !node.textContent || parent.closest('script,style,noscript,svg,input,textarea,select,[hidden],[aria-hidden="true"],[data-file-find-exclude]')) continue
    if (!includeButtons && parent.closest('button:not(.message-file-reference)')) continue
    if (selector && !parent.closest(selector)) continue
    if (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden') continue
    const nextBlock = parent.closest('p,h1,h2,h3,h4,h5,h6,pre,li,td,th,div,section,article')
    if (entries.length && nextBlock !== block) text += '\n'
    const from = text.length
    text += node.textContent
    entries.push({ node: node as Text, from, to: text.length })
    block = nextBlock
    if (text.length > 8 * 1024 * 1024) throw new Error('页面正文过大，暂时无法查找。')
  }
  return {
    text,
    range(from: number, to: number): Range | null {
      if (from < 0 || to <= from || to > text.length) return null
      const locate = (offset: number, inclusive: boolean) => {
        let low = 0, high = entries.length
        while (low < high) {
          const middle = (low + high) >>> 1
          if (inclusive ? entries[middle].to < offset : entries[middle].to <= offset) low = middle + 1
          else high = middle
        }
        return entries[low]
      }
      const start = locate(from, false)
      const end = locate(to, true)
      if (!start || !end || !start.node.isConnected || !end.node.isConnected) return null
      const range = document.createRange()
      range.setStart(start.node, Math.max(0, from - start.from))
      range.setEnd(end.node, to - end.from)
      return range
    }
  }
}

export function paintFileFindRanges(ranges: Range[], current: Range | null): void {
  CSS.highlights.set('rovai-file-find-match', new Highlight(...ranges))
  CSS.highlights.set('rovai-file-find-current', new Highlight(...(current ? [current] : [])))
}
export function clearFileFindRanges(): void {
  CSS.highlights.delete('rovai-file-find-match')
  CSS.highlights.delete('rovai-file-find-current')
}
export function scrollFileFindRange(range: Range, root: HTMLElement, clearance: number): void {
  const bounds = range.getBoundingClientRect()
  let element = range.startContainer.parentElement
  while (element && root.contains(element)) {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    if (/(auto|scroll)/u.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
      const top = Math.max(box.top, root.getBoundingClientRect().top + clearance)
      const bottom = Math.min(box.bottom, root.getBoundingClientRect().bottom)
      element.scrollTop += bounds.top + bounds.height / 2 - (top + bottom) / 2
    }
    if (/(auto|scroll)/u.test(style.overflowX) && element.scrollWidth > element.clientWidth) {
      if (bounds.left < box.left || bounds.right > box.right) element.scrollLeft += bounds.left - box.left - 24
    }
    element = element.parentElement
  }
}
