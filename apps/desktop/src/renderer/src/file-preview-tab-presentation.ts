import type { FilePreviewKind } from '@contracts'
import type { PreviewTabModel } from './FilePreviewContext'
import { agentRunFilePathParts } from './file-changes-presentation'

export function previewTabPresentation(tab: PreviewTabModel): {
  fileName: string
  displayPath: string
  icon: FilePreviewKind | 'file_change'
} {
  if (tab.kind === 'file') return { fileName: tab.file.fileName, displayPath: tab.file.displayPath, icon: tab.file.kind }
  const file = tab.changes.files.find((entry) => entry.evidenceFileId === tab.selectedEvidenceFileId)
    ?? tab.changes.files[0]
  return {
    fileName: file ? agentRunFilePathParts(file.path).basename : '文件变更',
    displayPath: file?.path ?? '',
    icon: 'file_change'
  }
}

export function previewTabLabel(tab: PreviewTabModel, duplicateNames: ReadonlySet<string> = new Set()): string {
  const { fileName, displayPath } = previewTabPresentation(tab)
  const name = duplicateNames.has(`${tab.kind}:${fileName}`)
    ? displayPath.replace(/\\/gu, '/').split('/').filter(Boolean).slice(-2).join('/') || fileName
    : fileName
  return tab.kind === 'file_change' ? `File Change·${name}` : name
}
