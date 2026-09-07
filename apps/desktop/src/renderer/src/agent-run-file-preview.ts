import type { AgentRunFileChangesView } from '@contracts'
import type { FilePreviewContextValue } from './FilePreviewContext'

const CURRENT_FILE_OPEN_ERROR = '无法打开该文件'

export async function openAgentRunCurrentFilePreview({
  filePreview,
  campId,
  changes,
  evidenceFileId,
  onError
}: {
  filePreview: Pick<FilePreviewContextValue, 'open'> | null
  campId: string
  changes: AgentRunFileChangesView
  evidenceFileId: string
  onError(message: string): void
}): Promise<boolean> {
  const file = changes.files.find((candidate) => candidate.evidenceFileId === evidenceFileId)
  if (!filePreview || !file) {
    onError(CURRENT_FILE_OPEN_ERROR)
    return false
  }
  try {
    const outcome = await filePreview.open({
      kind: 'run_evidence',
      campId,
      agentRunId: changes.agentRunId,
      executionEpoch: changes.executionEpoch,
      evidenceFileId,
      action: 'open_current'
    }, undefined, { fileName: file.path }, { commitOnSuccess: true, previewOnly: true })
    if (outcome.kind === 'preview') return true
  } catch {
    // The public failure stays intentionally stable and does not expose host details.
  }
  onError(CURRENT_FILE_OPEN_ERROR)
  return false
}
