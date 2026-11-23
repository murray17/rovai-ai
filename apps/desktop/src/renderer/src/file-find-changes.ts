import type { AgentRunChangedFileDetailView } from '@contracts'
import { exactMutationDiffLines, inlineDiffLines, reviewableFileChangeBlocks } from './file-changes-presentation'

export function fileChangeFindLines(file: AgentRunChangedFileDetailView) {
  return reviewableFileChangeBlocks(file).flatMap((block, blockIndex) => {
    const lines = block.semantics === 'exact_mutation' || block.semantics === 'reported_mutation' ? exactMutationDiffLines(block.diff) : inlineDiffLines(block.diff)
    return lines.flatMap((line, lineIndex) => line.kind === 'hunk' || line.kind === 'metadata' ? [] : [{
      id: fileChangeFindLineId(file.evidenceFileId, blockIndex, lineIndex), text: line.text || ' ', kind: line.kind, evidenceFileId: file.evidenceFileId
    }])
  })
}
export function fileChangeFindLineId(fileId: string, block: number, line: number): string {
  return `${fileId}:${block}:${line}`
}
