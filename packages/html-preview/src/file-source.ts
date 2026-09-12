import { constants } from 'node:fs'
import { open, realpath, stat, type FileHandle } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

export class PreviewResourceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface PreviewResource {
  file: FileHandle
  size: number
  mtimeMs: number
  identity: string
  mime: string
}

export function previewPathWithin(root: string, path: string): boolean {
  const part = relative(root, path)
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`)
}

export function previewRequestPath(raw: string): string {
  // Decode exactly once; encoded separators, double encodings and platform path
  // syntax never acquire a second meaning at the filesystem boundary.
  const path = raw.split(/[?#]/u, 1)[0]
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 8192) throw new PreviewResourceError(400, '资源路径无效。')
  const parts = path.split('/').filter(Boolean).map(part => {
    let decoded: string
    try { decoded = decodeURIComponent(part) } catch { throw new PreviewResourceError(400, '资源路径编码无效。') }
    if (decoded === '.' || decoded === '..' || /[\\/:\u0000-\u001f\u007f]/u.test(decoded)) throw new PreviewResourceError(403, '资源路径超出预览范围。')
    return decoded
  })
  return [...parts, ...(path.endsWith('/') ? ['index.html'] : [])].join('/')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.vtt': 'text/vtt'
}

/** A projection of an already admitted file capability, never a grant API. */
export function createPreviewFileSource(root: string, entry: string, allowDependencies: boolean, protectedRoots: readonly string[] = []) {
  // A broad workspace must not turn the host's private stores into web assets.
  // An explicitly admitted entry (e.g. a managed attachment) remains readable.
  const protectedPaths = Promise.all(protectedRoots.map(async path => {
    const absolute = resolve(path)
    return [absolute, await realpath(absolute).catch(() => absolute)]
  })).then(paths => paths.flat())
  return async (path: string, signal: AbortSignal): Promise<PreviewResource> => {
    signal.throwIfAborted()
    const candidate = resolve(root, path)
    if (!previewPathWithin(root, candidate) || (!allowDependencies && candidate !== entry)) throw new PreviewResourceError(403, '资源不在此预览的文件范围内。')
    const mime = MIME[extname(candidate).toLowerCase()]
    let file: FileHandle | null = null
    try {
      const canonical = await realpath(candidate)
      if ((candidate !== entry || canonical !== entry) && (await protectedPaths).some(protectedRoot =>
        previewPathWithin(protectedRoot, candidate) || previewPathWithin(protectedRoot, canonical))) {
        throw new PreviewResourceError(403, '主应用的私有数据不能作为网页资源加载。')
      }
      if (!mime) throw new PreviewResourceError(415, '不支持这个资源类型。')
      if (!previewPathWithin(root, canonical) || (!allowDependencies && canonical !== entry)) throw new PreviewResourceError(403, '资源链接超出预览范围。')
      file = await open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const metadata = await file.stat()
      const after = await realpath(candidate)
      const pathMetadata = await stat(after)
      if (after !== canonical || !previewPathWithin(root, after) || metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) throw new PreviewResourceError(409, '资源在读取时发生了变化。')
      if (!metadata.isFile()) throw new PreviewResourceError(403, '这个资源不是普通文件。')
      if (metadata.size > (mime.startsWith('text/html') ? 32 : 256) * 1024 * 1024) throw new PreviewResourceError(413, '资源超过预览大小上限。')
      signal.throwIfAborted()
      return { file, size: metadata.size, mtimeMs: metadata.mtimeMs, identity: `${metadata.dev}:${metadata.ino}`, mime }
    } catch (error) {
      await file?.close().catch(() => undefined)
      if (error instanceof PreviewResourceError || signal.aborted) throw error
      const code = (error as NodeJS.ErrnoException).code
      throw new PreviewResourceError(code === 'ENOENT' || code === 'ENOTDIR' ? 404 : 403, code === 'ENOENT' || code === 'ENOTDIR' ? `找不到资源：${basename(candidate)}` : '无法读取这个资源。')
    }
  }
}
