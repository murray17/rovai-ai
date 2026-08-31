import { homedir } from 'node:os'
import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { FileContentVersion, ParsedFileReference } from '@contracts'

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

export async function inspectPreviewPath(rootPath: string, candidatePath: string): Promise<{
  canonicalRoot: string
  canonicalPath: string
  kind: 'file' | 'directory'
}> {
  const canonicalRoot = await canonicalizeExistingPath(rootPath)
  const canonicalPath = await canonicalizeExistingPath(candidatePath)
  if (!pathIsWithin(canonicalRoot, canonicalPath)) {
    throw new FilePreviewAccessError('outside_authorized_root', '这个文件不在已授权目录中。')
  }
  const metadata = await stat(canonicalPath)
  if (!metadata.isFile() && !metadata.isDirectory()) {
    throw new FilePreviewAccessError('not_regular_file', '这里只能打开普通文件或文件夹。')
  }
  return { canonicalRoot, canonicalPath, kind: metadata.isDirectory() ? 'directory' : 'file' }
}

export async function openPreviewFile(rootPath: string, candidatePath: string): Promise<OpenedPreviewFile> {
  const { canonicalRoot, canonicalPath, kind } = await inspectPreviewPath(rootPath, candidatePath)
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
