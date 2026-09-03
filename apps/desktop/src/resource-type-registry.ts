import definitions from './resource-type-registry.json'

export type ResourceVisualKind =
  | 'web'
  | 'markdown'
  | 'html'
  | 'code'
  | 'config'
  | 'text'
  | 'image'
  | 'svg'
  | 'patch'
  | 'folder'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'notebook'
  | 'archive'
  | 'audio'
  | 'video'
  | 'database'
  | 'executable'
  | 'file'

export interface ResourceTypeDefinition {
  extensions: readonly string[]
  visualKind: Exclude<ResourceVisualKind, 'web' | 'folder' | 'file'>
  fileNames?: readonly string[]
  fileNamePrefixes?: readonly string[]
}

export const RESOURCE_TYPE_DEFINITIONS = definitions as readonly ResourceTypeDefinition[]

const extensionKinds = new Map<string, ResourceVisualKind>()
const fileNameKinds = new Map<string, ResourceVisualKind>()
const fileNamePrefixes: Array<readonly [string, ResourceVisualKind]> = []

for (const definition of RESOURCE_TYPE_DEFINITIONS) {
  for (const extension of definition.extensions) {
    if (extensionKinds.has(extension)) throw new Error(`Duplicate resource extension: ${extension}`)
    extensionKinds.set(extension, definition.visualKind)
  }
  for (const fileName of definition.fileNames ?? []) {
    if (fileNameKinds.has(fileName)) throw new Error(`Duplicate resource file name: ${fileName}`)
    fileNameKinds.set(fileName, definition.visualKind)
  }
  for (const prefix of definition.fileNamePrefixes ?? []) {
    fileNamePrefixes.push([prefix, definition.visualKind])
  }
}

function resourceFileName(target: string): string {
  const path = target
    .trim()
    .replace(/[?#].*$/u, '')
    .replace(/:(?:[1-9]\d*)(?::[1-9]\d*|-[1-9]\d*)?$/u, '')
    .replace(/\\/gu, '/')
  return path.split('/').at(-1)?.toLowerCase() ?? ''
}

function visualKindForFileName(fileName: string): ResourceVisualKind | undefined {
  const namedKind = fileNameKinds.get(fileName)
  if (namedKind) return namedKind
  const prefixedKind = fileNamePrefixes.find(([prefix]) => fileName.startsWith(prefix))?.[1]
  if (prefixedKind) return prefixedKind
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? extensionKinds.get(fileName.slice(dot)) : undefined
}

export function hasKnownResourceType(target: string): boolean {
  return visualKindForFileName(resourceFileName(target)) !== undefined
}

export function getResourceVisualKind(target: string): ResourceVisualKind {
  return visualKindForFileName(resourceFileName(target)) ?? 'file'
}
