import { extname } from 'node:path'
import type { FilePreviewKind } from '@contracts'

const WHOLE_TEXT_LIMIT = 4 * 1024 * 1024

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
const HTML_EXTENSIONS = new Set(['.html', '.htm'])
const PATCH_EXTENSIONS = new Set(['.diff', '.patch'])
const IMAGE_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon']
])
const TEXT_MIME = new Map([
  ['.txt', 'text/plain'],
  ['.log', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.tsv', 'text/tab-separated-values'],
  ['.json', 'application/json'],
  ['.jsonc', 'application/json'],
  ['.json5', 'application/json'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.toml', 'application/toml'],
  ['.xml', 'application/xml'],
  ['.ini', 'text/plain'],
  ['.cfg', 'text/plain'],
  ['.conf', 'text/plain'],
  ['.env', 'text/plain'],
  ['.properties', 'text/plain']
])
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.pyi', '.rb', '.rake', '.php', '.lua', '.rs', '.go',
  '.java', '.kt', '.kts', '.swift', '.dart', '.c', '.h', '.cc', '.cpp',
  '.cxx', '.hh', '.hpp', '.hxx', '.cs', '.m', '.mm', '.sh', '.bash',
  '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd', '.css', '.scss',
  '.sass', '.less', '.vue', '.svelte', '.hbs', '.handlebars', '.pug',
  '.sql', '.pgsql', '.graphql', '.gql', '.cypher', '.tf', '.tfvars',
  '.hcl', '.proto', '.xsd', '.xsl', '.plist'
])
const SYSTEM_ONLY_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar', '.bz2', '.xz',
  '.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg', '.mp4', '.mov',
  '.mkv', '.avi', '.webm', '.sqlite', '.sqlite3', '.db', '.dmg', '.pkg',
  '.exe', '.msi', '.app', '.deb', '.rpm', '.iso'
])
const RISKY_EXTENSIONS = new Set([
  '.app', '.bat', '.cmd', '.com', '.deb', '.dmg', '.exe', '.jar', '.js',
  '.jse', '.lnk', '.msi', '.msp', '.pkg', '.ps1', '.reg', '.rpm', '.scr',
  '.sh', '.vbs', '.vbe', '.wsf'
])

export interface FilePreviewClassification {
  extension: string
  mime: string
  kind: FilePreviewKind | 'system'
  openRisk: 'normal' | 'confirm'
}

function textKind(kind: Exclude<FilePreviewKind, 'image'>, size: number): FilePreviewKind {
  return size > WHOLE_TEXT_LIMIT ? 'paged_text' : kind
}

export function classifyFilePreview(
  path: string,
  size: number,
  sample: Uint8Array,
  decoder = new TextDecoder('utf-8', { fatal: true })
): FilePreviewClassification {
  const extension = extname(path).toLocaleLowerCase('en-US')
  const openRisk = RISKY_EXTENSIONS.has(extension) ? 'confirm' : 'normal'
  if (SYSTEM_ONLY_EXTENSIONS.has(extension)) {
    return { extension, mime: 'application/octet-stream', kind: 'system', openRisk }
  }
  const imageMime = IMAGE_MIME.get(extension)
  if (imageMime) return { extension, mime: imageMime, kind: 'image', openRisk }
  if (extension === '.svg') return { extension, mime: 'image/svg+xml', kind: textKind('svg', size), openRisk }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return { extension, mime: 'text/markdown', kind: textKind('markdown', size), openRisk }
  }
  if (HTML_EXTENSIONS.has(extension)) {
    return { extension, mime: 'text/html', kind: textKind('html', size), openRisk }
  }
  if (PATCH_EXTENSIONS.has(extension)) {
    return { extension, mime: 'text/x-diff', kind: textKind('patch', size), openRisk }
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return { extension, mime: 'text/plain', kind: textKind('code', size), openRisk }
  }
  const textMime = TEXT_MIME.get(extension)
  if (textMime) return { extension, mime: textMime, kind: textKind('text', size), openRisk }
  try {
    decoder.decode(sample)
    return { extension, mime: 'text/plain', kind: textKind('text', size), openRisk }
  } catch {
    return { extension, mime: 'application/octet-stream', kind: 'system', openRisk }
  }
}

export const filePreviewLimits = {
  wholeTextBytes: WHOLE_TEXT_LIMIT,
  pageBytes: 256 * 1024,
  binaryBytes: 32 * 1024 * 1024,
  sampleBytes: 64 * 1024
} as const
