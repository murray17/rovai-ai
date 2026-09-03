import { parseFileReference } from '../../file-preview-reference'
import {
  getResourceVisualKind,
  type ResourceVisualKind
} from '../../resource-type-registry'

export type ResourceReferenceVisualKind = ResourceVisualKind

function fallbackPath(target: string): string {
  return target
    .replace(/[?#].*$/u, '')
    .replace(/:(?:[1-9]\d*)(?::[1-9]\d*|-[1-9]\d*)?$/u, '')
}

export function resourceReferenceVisualKind(target: string): ResourceReferenceVisualKind {
  const trimmed = target.trim()
  if (/^https:\/\//iu.test(trimmed)) return 'web'

  const path = parseFileReference(trimmed)?.pathPart ?? fallbackPath(trimmed)
  if (/[\\/]$/u.test(path)) return 'folder'

  return getResourceVisualKind(path)
}
