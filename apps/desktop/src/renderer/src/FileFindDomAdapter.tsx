import { useMemo, type RefObject } from 'react'
import { useFileFindAdapter, type FileFindAdapter } from './FilePreviewFind'
import { createFileFindDomIndex, clearFileFindRanges, paintFileFindRanges, scrollFileFindRange } from './file-find-dom'

export function FileFindDomAdapter({ root, selector, revision, scopeLabel = '' }: {
  root: RefObject<HTMLElement | null>; selector?: string; revision: unknown; scopeLabel?: string
}): null {
  const adapter = useMemo<FileFindAdapter>(() => {
    let index: ReturnType<typeof createFileFindDomIndex> | null = null
    return {
      scopeLabel,
      documents() {
        if (!root.current) return []
        index = createFileFindDomIndex(root.current, selector)
        return [{ id: 'document', text: index.text }]
      },
      show(matches, current, scroll, clearance) {
        const ranges = matches.map(match => index?.range(match.from, match.to) ?? null)
        const selected = ranges[current] ?? null
        paintFileFindRanges(ranges.filter((range): range is Range => range !== null), selected)
        if (scroll && selected && root.current) scrollFileFindRange(selected, root.current, clearance)
      },
      clear: clearFileFindRanges,
      focus: () => root.current?.focus({ preventScroll: true }),
      selection: () => { const selection = window.getSelection(); return selection?.anchorNode && root.current?.contains(selection.anchorNode) ? selection.toString() : '' },
      subscribe(invalidate) {
        if (!root.current) return () => undefined
        const observer = new MutationObserver(invalidate)
        observer.observe(root.current, { childList: true, characterData: true, subtree: true })
        return () => observer.disconnect()
      }
    }
  }, [root, selector, revision, scopeLabel])
  useFileFindAdapter(adapter)
  return null
}
