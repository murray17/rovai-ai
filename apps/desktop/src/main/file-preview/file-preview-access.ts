import { homedir } from 'node:os'
import { lstat, open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { FileContentVersion, ParsedFileReference } from '@contracts'
import { parseFileReference } from '../../file-preview-reference'

export class FilePreviewAccessError extends Error {
  constructor(
    readonly code:
      | 'file_not_found'
      | 'not_regular_file'
      | 'outside_authorized_root'
      | 'read_failed',
    message: string
  ) {
    super(message)
  }
}

export interface OpenedPreviewFile {
  file: FileHandle
  canonicalRoot: string
  canonicalPath: string
  displayPath: string
  fileName: string
  version: FileContentVersion
}

export function referenceCandidatePath(
  reference: ParsedFileReference,
  rootPath: string,
  basePath: string
): string {
  if (reference.pathKind === 'home_relative') {
    return resolve(homedir(), reference.pathPart.slice(2))
  }
  if (isAbsolute(reference.pathPart)) return resolve(reference.pathPart)
  return resolve(basePath || rootPath, reference.pathPart)
}

// Resolve message punctuation only against an existing regular file. This does
// not authorize the candidate: callers must still enforce canonical containment.
export async function resolveFileReferencePath(
  reference: ParsedFileReference,
  rootPath: string,
  basePath: string
): Promise<string> {
  const candidate = referenceCandidatePath(reference, rootPath, basePath)
  const { line, column, endLine, endColumn } = reference.target ?? {}
  if ([line, column, endLine, endColumn].some((value) => value !== undefined)
    || !/[^:]:$/u.test(reference.pathPart)) return candidate

  const path = reference.pathPart.slice(0, -1)
  const repaired = parseFileReference(path)
  // Do not create a location suffix or decode the already parsed path twice.
  if (!repaired || repaired.target || repaired.pathPart !== path) return candidate
  try {
    await lstat(candidate)
    return candidate
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return candidate
  }
  const repairedCandidate = referenceCandidatePath({ ...reference, pathPart: path }, rootPath, basePath)
  try {
    return (await stat(repairedCandidate)).isFile() ? repairedCandidate : candidate
  } catch {
    return candidate
  }
}

export function pathIsWithin(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return remainder === '' || (!remainder.startsWith(`..${sep}`) && remainder !== '..' && !isAbsolute(remainder))
}

export async function canonicalizeExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    throw new FilePreviewAccessError('file_not_found', '找不到这个文件。')
  }
}

export async function inspectPreviewPath(
  rootPath: string,
  candidatePath: string,
  options: { allowExternalDirectory?: boolean; allowExternalFile?: boolean } = {}
): Promise<{
  canonicalRoot: string
  canonicalPath: string
  kind: 'file' | 'directory'
}> {
  let canonicalRoot = await canonicalizeExistingPath(rootPath)
  const canonicalPath = await canonicalizeExistingPath(candidatePath)
  const withinRoot = pathIsWithin(canonicalRoot, canonicalPath)
  const metadata = await stat(canonicalPath)
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new FilePreviewAccessError('not_regular_file', '这里只能打开普通文件或文件夹。')
  }
  if (!withinRoot) {
    const externalFile = metadata.isFile() && options.allowExternalFile
    const externalDirectory = metadata.isDirectory()
      && options.allowExternalDirectory
      && !pathIsWithin(canonicalRoot, resolve(candidatePath))
    if (!externalFile && !externalDirectory) {
      throw new FilePreviewAccessError('outside_authorized_root', '这个文件不在已授权目录中。')
    }
    // One exact external file gets a file-scoped capability. Its parent is
    // retained only as the ephemeral watcher/relative-child boundary; it is
    // never persisted or returned as a Root Grant.
    if (externalFile) canonicalRoot = dirname(canonicalPath)
  }
  return { canonicalRoot, canonicalPath, kind: metadata.isDirectory() ? 'directory' : 'file' }
}

export async function openPreviewFile(
  rootPath: string,
  candidatePath: string,
  options: { allowExternalFile?: boolean } = {}
): Promise<OpenedPreviewFile> {
  const { canonicalRoot, canonicalPath, kind } = await inspectPreviewPath(rootPath, candidatePath, options)
  if (kind !== 'file') throw new FilePreviewAccessError('not_regular_file', '这里只能读取普通文件。')
  let file: FileHandle
  try {
    file = await open(canonicalPath, 'r')
  } catch {
    throw new FilePreviewAccessError('read_failed', '无法读取这个文件。')
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile()) {
      throw new FilePreviewAccessError('not_regular_file', '这里只能打开普通文件。')
    }
    const displayPath = relative(canonicalRoot, canonicalPath).split(sep).join('/') || basename(canonicalPath)
    return {
      file,
      canonicalRoot,
      canonicalPath,
      displayPath,
      fileName: basename(canonicalPath),
      version: {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        fileId: `${stat.dev}:${stat.ino}`
      }
    }
  } catch (error) {
    await file.close().catch(() => undefined)
    if (error instanceof FilePreviewAccessError) throw error
    throw new FilePreviewAccessError('read_failed', '无法读取这个文件。')
  }
}

export function parentDirectory(path: string): string {
  return dirname(path)
}
