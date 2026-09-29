import type { InterfaceLanguage, ResolvedFilePreview } from '@contracts'
import { getResourceVisualKind, type ResourceVisualKind } from '../../resource-type-registry'
import type { PreviewTabModel } from './FilePreviewContext'
import { agentRunFilePathParts } from './file-changes-presentation'
import { translateUi } from './interface-language'

export function previewTabPresentation(tab: PreviewTabModel, language: InterfaceLanguage = 'zh-CN'): {
  fileName: string
  displayPath: string
  icon: ResourceVisualKind
} {
  if (tab.kind === 'mission_activity') {
    const label = translateUi(language, '活动')
    return { fileName: label, displayPath: label, icon: 'text' }
  }
  if (tab.kind === 'execution') {
    const label = translateUi(language, '执行')
    return { fileName: label, displayPath: label, icon: 'text' }
  }
  if (tab.kind === 'file') return {
    fileName: tab.presentation.fileName,
    displayPath: tab.presentation.displayPath,
    icon: getResourceVisualKind(tab.presentation.fileName)
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

function previewTabNameKey(tab: PreviewTabModel, language: InterfaceLanguage): string {
  return `${tab.kind}:${previewTabPresentation(tab, language).fileName}`
}

export function previewPathIsVisible(
  file: Pick<ResolvedFilePreview, 'displayPath' | 'pathPresentation'>
): boolean {
  return file.pathPresentation !== 'file_name_only' && file.displayPath.length > 0
}

function shortestUniqueTabLabel(
  tab: PreviewTabModel,
  duplicates: readonly PreviewTabModel[],
  duplicateOrdinal: number,
  language: InterfaceLanguage
): string {
  const { fileName, displayPath } = previewTabPresentation(tab, language)
  const pathParts = normalizedPathParts(displayPath)
  for (let depth = 2; depth <= pathParts.length; depth += 1) {
    const candidate = pathParts.slice(-depth).join('/')
    const unique = duplicates.every((other) => {
      if (other.id === tab.id) return true
      const otherParts = normalizedPathParts(previewTabPresentation(other, language).displayPath)
      return otherParts.slice(-Math.min(depth, otherParts.length)).join('/') !== candidate
    })
    if (unique) return candidate
  }
  if (displayPath !== fileName
    && duplicates.every((other) => other.id === tab.id
      || previewTabPresentation(other, language).displayPath !== displayPath)) {
    return displayPath
  }
  return `${fileName} · ${duplicateOrdinal}`
}

export function previewTabLabel(
  tab: PreviewTabModel,
  language: InterfaceLanguage = 'zh-CN',
  duplicateNames: ReadonlySet<string> = new Set(),
  duplicateOrdinal = 1
): string {
  const { fileName, displayPath } = previewTabPresentation(tab, language)
  const pathParts = normalizedPathParts(displayPath)
  const parentQualifiedName = pathParts.length > 1 ? pathParts.slice(-2).join('/') : ''
  const name = duplicateNames.has(previewTabNameKey(tab, language))
    ? parentQualifiedName || `${fileName} · ${duplicateOrdinal}`
    : fileName
  return tab.kind === 'file_change' ? `File Change·${name}` : name
}

export function previewTabLabels(
  tabs: readonly PreviewTabModel[], language: InterfaceLanguage = 'zh-CN'
): ReadonlyMap<string, string> {
  const groups = new Map<string, PreviewTabModel[]>()
  for (const tab of tabs) {
    const key = previewTabNameKey(tab, language)
    const group = groups.get(key) ?? []
    group.push(tab)
    groups.set(key, group)
  }
  const ordinals = new Map<string, number>()
  return new Map(tabs.map((tab) => {
    const key = previewTabNameKey(tab, language)
    const ordinal = (ordinals.get(key) ?? 0) + 1
    ordinals.set(key, ordinal)
    const duplicates = groups.get(key) ?? [tab]
    const name = duplicates.length > 1
      ? shortestUniqueTabLabel(tab, duplicates, ordinal, language)
      : previewTabPresentation(tab, language).fileName
    return [tab.id, tab.kind === 'file_change' ? `File Change·${name}` : name]
  }))
}
