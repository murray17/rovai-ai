import type { ResolvedFilePreview } from '@contracts'
import { getResourceVisualKind, type ResourceVisualKind } from '../../resource-type-registry'
import type { PreviewTabModel } from './FilePreviewContext'
import { agentRunFilePathParts } from './file-changes-presentation'

export function previewTabPresentation(tab: PreviewTabModel): {
  fileName: string
  displayPath: string
  icon: ResourceVisualKind
} {
  if (tab.kind === 'file') return {
    fileName: tab.file.fileName,
    displayPath: tab.file.displayPath,
    icon: getResourceVisualKind(tab.file.fileName)
  }
  const file = tab.changes.files.find((entry) => entry.evidenceFileId === tab.selectedEvidenceFileId)
    ?? tab.changes.files[0]
  return {
    fileName: file ? agentRunFilePathParts(file.path).basename : '文件变更',
    displayPath: file?.path ?? '',
    icon: 'patch'
  }
}

function normalizedPathParts(displayPath: string): string[] {
  return displayPath.replace(/\\/gu, '/').split('/').filter(Boolean)
}

function previewTabNameKey(tab: PreviewTabModel): string {
  return `${tab.kind}:${previewTabPresentation(tab).fileName}`
}

export function previewPathIsVisible(
  file: Pick<ResolvedFilePreview, 'displayPath' | 'pathPresentation'>
): boolean {
  return file.pathPresentation === 'project_relative'
    && normalizedPathParts(file.displayPath).length > 1
}

export function previewTabLabel(
  tab: PreviewTabModel,
  duplicateNames: ReadonlySet<string> = new Set(),
  duplicateOrdinal = 1
): string {
  const { fileName, displayPath } = previewTabPresentation(tab)
  const pathParts = normalizedPathParts(displayPath)
  const parentQualifiedName = pathParts.length > 1 ? pathParts.slice(-2).join('/') : ''
  const name = duplicateNames.has(previewTabNameKey(tab))
    ? parentQualifiedName || `${fileName} · ${duplicateOrdinal}`
    : fileName
  return tab.kind === 'file_change' ? `File Change·${name}` : name
}

export function previewTabLabels(tabs: readonly PreviewTabModel[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    const key = previewTabNameKey(tab)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const duplicateNames = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key))
  const ordinals = new Map<string, number>()
  return new Map(tabs.map((tab) => {
    const key = previewTabNameKey(tab)
    const ordinal = (ordinals.get(key) ?? 0) + 1
    ordinals.set(key, ordinal)
    return [tab.id, previewTabLabel(tab, duplicateNames, ordinal)]
  }))
}
