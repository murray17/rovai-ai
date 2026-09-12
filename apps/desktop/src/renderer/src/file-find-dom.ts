export { createFileFindDomIndex } from '../../../../../packages/html-preview/src/find-dom'

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
