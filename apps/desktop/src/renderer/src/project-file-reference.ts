import type { ComposerAtom, ProjectFileReferenceAtom, PublishedProjectFileReference } from '@contracts'
import { uiAttribute } from './interface-language'
import { escapeReferenceLinkLabel } from './reference-markdown'

export const isProjectFileAtom = (atom: ComposerAtom): atom is ProjectFileReferenceAtom => atom.type === 'project_file_reference'
export type FileReference = ProjectFileReferenceAtom | PublishedProjectFileReference
export const fileReferenceKey = (file: Pick<FileReference, 'threadId' | 'rawReference' | 'targetKind'>): string => JSON.stringify([file.threadId, file.rawReference, ...(file.targetKind === 'directory' ? ['directory'] : [])])
export const fileReferencePath = (file: FileReference): string => { const path = 'labelAtSend' in file ? file.labelAtSend : file.labelFallback; return file.targetKind === 'directory' ? path.replace(/\/+$/u, '') : path }
export const fileName = (path: string): string => path.split('/').at(-1) ?? path
export function validProjectFileAtom(value: Record<string, unknown>): value is Record<string, unknown> & ProjectFileReferenceAtom {
  const bytes = (text: string): number => new TextEncoder().encode(text).byteLength
  return (Object.keys(value).length === 4 || Object.keys(value).length === 5) && Object.keys(value).every(key => ['type', 'threadId', 'rawReference', 'labelFallback', 'targetKind'].includes(key))
    && (!Object.hasOwn(value, 'targetKind') || value.targetKind === 'file' || value.targetKind === 'directory')
    && value.type === 'project_file_reference'
    && typeof value.threadId === 'string' && value.threadId.trim() === value.threadId && value.threadId.length > 0 && bytes(value.threadId) <= 256 && !/\p{Cc}/u.test(value.threadId)
    && typeof value.rawReference === 'string' && value.rawReference.length > 0 && bytes(value.rawReference) <= 16384 && !/\p{Cc}/u.test(value.rawReference)
    && typeof value.labelFallback === 'string' && value.labelFallback.length > 0 && !/\p{Cc}/u.test(value.labelFallback)
}

/** Disambiguation uses only this document's distinct identities, never a project scan. */
export function fileReferencePresentation(file: FileReference, files: readonly FileReference[]) {
  const path = fileReferencePath(file)
  const parts = path.split('/')
  const others = [...new Map(files.map(item => [fileReferenceKey(item), item])).values()]
    .filter(item => fileReferenceKey(item) !== fileReferenceKey(file) && fileName(fileReferencePath(item)) === fileName(path))
  let depth = 1
  while (depth < parts.length && others.some(item => fileReferencePath(item).split('/').slice(-depth).join('/') === parts.slice(-depth).join('/'))) depth++
  let label = parts.slice(-depth).join('/')
  let sourceLabel = ''
  if (others.some(item => fileReferencePath(item) === path)) {
    const identities = [...new Set([...files.filter(item => fileReferencePath(item) === path).map(fileReferenceKey), fileReferenceKey(file)])]
    sourceLabel = uiAttribute('来源 {0}', String(identities.indexOf(fileReferenceKey(file)) + 1))
    label = `${sourceLabel} · ${label}`
  }
  return { label, fileName: fileName(path), path, ariaLabel: uiAttribute(file.targetKind === 'directory' ? '目录引用：{0}' : '文件引用：{0}', sourceLabel ? `${sourceLabel} · ${path}` : path), directory: parts.slice(0, -1).join('/') }
}

/** Kept byte-for-byte aligned with Core's project_file_reference::render_link. */
export function projectFileLink(file: PublishedProjectFileReference): string {
  const frozenPath = file.pathAtSend.startsWith('\\\\?\\UNC\\') ? `\\\\${file.pathAtSend.slice(8)}`
    : file.pathAtSend.startsWith('\\\\?\\') ? file.pathAtSend.slice(4) : file.pathAtSend
  const path = frozenPath.replace(/%/gu, '%25')
  const url = new URL('file:///')
  if (/^[A-Za-z]:[\\/]/u.test(path)) url.pathname = `/${path.replace(/\\/gu, '/')}`
  else if (/^\\\\/u.test(path)) {
    const [host, ...parts] = path.slice(2).split('\\'); url.hostname = host!; url.pathname = `/${parts.join('/')}`
  } else url.pathname = path.replace(/\\/gu, '%5C')
  if (file.targetKind === 'directory' && !url.pathname.endsWith('/')) url.pathname += '/'
  const label = escapeReferenceLinkLabel(fileName(fileReferencePath(file)).replace(/[\u0000-\u001f\u007f]/gu, ' '))
  return `[${label}](${url.href.replace(/\(/gu, '%28').replace(/\)/gu, '%29')})`
}
