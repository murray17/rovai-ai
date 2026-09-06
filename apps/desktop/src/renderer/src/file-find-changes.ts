import type { AgentRunChangedFileDetailView } from '@contracts'
import { exactMutationDiffLines, inlineDiffLines } from './file-changes-presentation'

export function fileChangeFindLines(file: AgentRunChangedFileDetailView) {
  if (file.presentationKind === 'operation_only') return []
  return file.blocks.slice().sort((a, b) => a.sequence - b.sequence).filter(block => Boolean(block.diff)).flatMap((block, blockIndex) => {
    const lines = block.semantics === 'exact_mutation' ? exactMutationDiffLines(block.diff!) : inlineDiffLines(block.diff!)
    return lines.flatMap((line, lineIndex) => line.kind === 'hunk' || line.kind === 'metadata' ? [] : [{
      id: fileChangeFindLineId(file.evidenceFileId, blockIndex, lineIndex), text: line.text || ' ', kind: line.kind, evidenceFileId: file.evidenceFileId
    }])
  })
}
export function fileChangeFindLineId(fileId: string, block: number, line: number): string {
  return `${fileId}:${block}:${line}`
}
