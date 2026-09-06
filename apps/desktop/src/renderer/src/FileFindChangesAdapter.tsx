import { useMemo, useRef, type RefObject } from 'react'
import type { AgentRunFileChangesDetailView } from '@contracts'
import { useFileFindAdapter, type FileFindAdapter } from './FilePreviewFind'
import { fileChangeFindLines } from './file-find-changes'
import { clearFileFindRanges, createFileFindDomIndex, paintFileFindRanges, scrollFileFindRange } from './file-find-dom'

export function FileFindChangesAdapter({ root, detail, selected, select }: {
  root: RefObject<HTMLElement | null>; detail: AgentRunFileChangesDetailView | null; selected: string | null; select(id: string): void
}): null {
  const current = useRef({ selected, select })
  current.current = { selected, select }
  const adapter = useMemo<FileFindAdapter | null>(() => {
    const lines = detail?.files.flatMap(fileChangeFindLines) ?? []
    if (!lines.length) return null
    const lineMap = new Map(lines.map(line => [line.id, line]))
    let frame = 0
    return {
      scopeLabel: '', changes: true,
      documents: options => lines.filter(line => (options.allChanges || line.evidenceFileId === current.current.selected)
        && (!options.changesOnly || line.kind === 'addition' || line.kind === 'deletion')),
      show(matches, index, scroll, clearance) {
        cancelAnimationFrame(frame)
        const match = matches[index]
        const fileId = match && lineMap.get(match.documentId)?.evidenceFileId
        if (fileId && current.current.selected !== fileId) current.current.select(fileId)
        let attempts = 0
        const paint = (): void => {
          if (!root.current) return
          const nodes = new Map([...root.current.querySelectorAll<HTMLElement>('[data-file-find-id]')].map(node => [node.dataset.fileFindId!, node]))
          if (match && !nodes.has(match.documentId) && attempts++ < 10) { frame = requestAnimationFrame(paint); return }
          const indices = new Map([...nodes].map(([id, node]) => [id, createFileFindDomIndex(node)]))
          const ranges = matches.map(hit => indices.get(hit.documentId)?.range(hit.from, hit.to) ?? null)
          const selected = ranges[index] ?? null
          paintFileFindRanges(ranges.filter((range): range is Range => range !== null), selected)
          if (scroll && selected) scrollFileFindRange(selected, root.current, clearance)
        }
        frame = requestAnimationFrame(paint)
      },
      clear: () => { cancelAnimationFrame(frame); clearFileFindRanges() },
      focus: () => root.current?.querySelector<HTMLElement>('.agent-run-file-review-scroll')?.focus({ preventScroll: true }),
      selection: () => { const selection = window.getSelection(); return selection?.anchorNode && root.current?.contains(selection.anchorNode) ? selection.toString() : '' }
    }
  }, [detail, root])
  useFileFindAdapter(adapter)
  return null
}
