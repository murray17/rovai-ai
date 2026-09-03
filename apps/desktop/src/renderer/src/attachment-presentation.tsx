import type { JSX } from 'react'

export type AttachmentKind = 'file' | 'directory'
export type AttachmentPreviewKind = 'image' | 'none'
export type UserAttachmentDisplayType = 'document' | 'code' | 'folder' | 'image'
export type AgentAttachmentDisplayType =
  | 'web'
  | 'code'
  | 'notes'
  | 'pdf'
  | 'word'
  | 'sheet'
  | 'slide'
  | 'image'
  | 'archive'
  | 'generic'

export type AttachmentDisplayClassification = {
  userDisplayType: UserAttachmentDisplayType
  agentDisplayType: AgentAttachmentDisplayType
}

export type AttachmentPresentationSource = {
  displayName: string
  kind: AttachmentKind
  mediaType: string
  previewKind: AttachmentPreviewKind
}

const DOCUMENT_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'text', 'log', 'csv', 'xls', 'xlsx', 'ods', 'pdf',
  'doc', 'docx', 'odt', 'rtf', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml',
  'ini', 'cfg', 'conf'
])
const CODE_EXTENSIONS = new Set([
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'js', 'jsx', 'mjs', 'cjs', 'ts',
  'tsx', 'java', 'class', 'jar', 'py', 'pyw', 'pyc', 'rs', 'go', 'rb', 'php', 'c',
  'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp', 'cs', 'fs', 'fsx', 'swift', 'kt', 'kts',
  'scala', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'vue', 'svelte', 'astro', 'sql',
  'graphql', 'gql', 'lua', 'dart', 'ex', 'exs', 'erl', 'hrl'
])
const ARCHIVE_EXTENSIONS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab', 'iso', 'dmg',
  'deb', 'rpm', 'apk'
])
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'avif', 'heic', 'heif', 'tif',
  'tiff', 'ico'
])
const NOTES_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'text', 'log'])
const PDF_EXTENSIONS = new Set(['pdf'])
const WORD_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'rtf'])
const SHEET_EXTENSIONS = new Set(['csv', 'xls', 'xlsx', 'ods'])
const SLIDE_EXTENSIONS = new Set(['ppt', 'pptx', 'odp'])
const WEB_EXTENSIONS = new Set(['html', 'htm'])

export function attachmentExtension(displayName: string): string {
  const leaf = displayName.replaceAll('\\', '/').split('/').at(-1) ?? displayName
  const dot = leaf.lastIndexOf('.')
  if (dot <= 0 || dot === leaf.length - 1) return ''
  return leaf.slice(dot + 1).toLocaleLowerCase('en-US')
}

export function attachmentBaseName(displayName: string, kind: AttachmentKind): string {
  if (kind === 'directory') return displayName
  const extension = attachmentExtension(displayName)
  return extension ? displayName.slice(0, -(extension.length + 1)) : displayName
}

export function attachmentFormatLabel(displayName: string, kind: AttachmentKind): string {
  if (kind === 'directory') return 'DIR'
  return attachmentExtension(displayName).toLocaleUpperCase('en-US') || 'FILE'
}

export function classifyAttachmentDisplay(
  source: AttachmentPresentationSource
): AttachmentDisplayClassification {
  const extension = attachmentExtension(source.displayName)
  const mediaType = source.mediaType.toLocaleLowerCase('en-US')
  const previewableImage = source.kind === 'file' && source.previewKind === 'image'

  let userDisplayType: UserAttachmentDisplayType = 'document'
  if (previewableImage) userDisplayType = 'image'
  else if (source.kind === 'directory' || ARCHIVE_EXTENSIONS.has(extension)) userDisplayType = 'folder'
  else if (CODE_EXTENSIONS.has(extension)) userDisplayType = 'code'
  else if (DOCUMENT_EXTENSIONS.has(extension)) userDisplayType = 'document'

  let agentDisplayType: AgentAttachmentDisplayType = 'generic'
  if (previewableImage) agentDisplayType = 'image'
  else if (source.kind === 'directory' || ARCHIVE_EXTENSIONS.has(extension)
    || mediaType === 'inode/directory' || mediaType.includes('zip') || mediaType.includes('archive')) {
    agentDisplayType = 'archive'
  } else if (WEB_EXTENSIONS.has(extension) || mediaType === 'text/html') agentDisplayType = 'web'
  else if (PDF_EXTENSIONS.has(extension) || mediaType === 'application/pdf') agentDisplayType = 'pdf'
  else if (WORD_EXTENSIONS.has(extension)
    || mediaType.includes('wordprocessingml') || mediaType.includes('msword')) agentDisplayType = 'word'
  else if (SHEET_EXTENSIONS.has(extension)
    || mediaType.includes('spreadsheet') || mediaType.includes('excel')) agentDisplayType = 'sheet'
  else if (SLIDE_EXTENSIONS.has(extension)
    || mediaType.includes('presentation') || mediaType.includes('powerpoint')) agentDisplayType = 'slide'
  else if (NOTES_EXTENSIONS.has(extension) || mediaType === 'text/plain') agentDisplayType = 'notes'
  else if (IMAGE_EXTENSIONS.has(extension) || mediaType.startsWith('image/')) agentDisplayType = 'image'
  else if (CODE_EXTENSIONS.has(extension) || DOCUMENT_EXTENSIONS.has(extension)
    || mediaType.includes('json') || mediaType.includes('xml') || mediaType.includes('yaml')) {
    agentDisplayType = 'code'
  }

  return { userDisplayType, agentDisplayType }
}

export function UserFileIcon({ type }: { type: Exclude<UserAttachmentDisplayType, 'image'> }): JSX.Element {
  if (type === 'folder') {
    return (
      <span className="user-file-icon" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <path d="M5.8 12.6a3.4 3.4 0 0 1 3.4-3.4h6.2c1 0 1.9.42 2.56 1.14l1.52 1.66h7.28a3.4 3.4 0 0 1 3.4 3.4v10.38a3.4 3.4 0 0 1-3.4 3.4H9.2a3.4 3.4 0 0 1-3.4-3.4Z" />
          <path d="M5.8 15h24.4" />
        </svg>
      </span>
    )
  }
  if (type === 'code') {
    return (
      <span className="user-file-icon" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <rect x="7.8" y="7.1" width="20.4" height="21.8" rx="5.4" />
          <path d="m15 14.5-4 4 4 4M21 14.5l4 4-4 4M18.8 13.2l-1.6 10.4" />
        </svg>
      </span>
    )
  }
  return (
    <span className="user-file-icon" aria-hidden="true">
      <svg viewBox="0 0 36 36">
        <rect x="8.2" y="5.6" width="18.6" height="24.8" rx="4.4" />
        <path d="M20.8 5.6v5.8a2.2 2.2 0 0 0 2.2 2.2h3.8" />
        <path d="M14.1 18h8.3M14.1 22h7.3M14.1 26h5.9" />
      </svg>
    </span>
  )
}

export function AgentArtifactIcon({ type }: { type: AgentAttachmentDisplayType }): JSX.Element {
  const paths: Record<AgentAttachmentDisplayType, JSX.Element> = {
    web: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 8h18M7 6h.01M10 6h.01M9.2 11.2 6.7 13.7l2.5 2.5M14.8 11.2l2.5 2.5-2.5 2.5M13.2 10.7l-2.4 6" /></>,
    code: <path d="m8.5 6-5 6 5 6M15.5 6l5 6-5 6M14 4l-4 16" />,
    notes: <><path d="M6 3.5h9l3 3V20.5H6Z" /><path d="M15 3.5v3h3M9 10h6M9 13.5h6M9 17h4" /></>,
    pdf: <><path d="M6 3.5h9l3 3V20.5H6Z" /><path d="M15 3.5v3h3" /><path d="M8.7 16.9c2.4-1.25 4.15-3.75 4.4-6.45.15-1.55-.65-2.05-1.25-.75-.55 1.2.2 3.8 1.35 5.25 1.2 1.5 2.55 2.05 3.1 1.35.55-.7-.6-1.35-2.7-1.15-1.9.2-4.05.8-4.9 1.75Z" /></>,
    word: <><path d="M6 3.5h9l3 3V20.5H6Z" /><path d="M15 3.5v3h3M9 10h6M9 13.5h6M9 17h4" /><path d="M7.6 9.4v8.2" /></>,
    sheet: <><path d="M6 3.5h9l3 3V20.5H6Z" /><path d="M15 3.5v3h3M8.8 10h6.4M8.8 13.4h6.4M8.8 16.8h6.4M12 9.6v7.6" /></>,
    slide: <><rect x="4.5" y="5" width="15" height="11.5" rx="2.2" /><path d="M12 16.5v3.5M9 20h6M8 8.2h8M8 11.2h5.3" /></>,
    image: <><rect x="3.5" y="4" width="17" height="16" rx="2.7" /><path d="M7 15.8 10.4 12.4l2.7 2.5 3.9-4.2 3 3.4" /><circle cx="9" cy="8.5" r="1.4" /></>,
    archive: <><path d="M6 6.2h12v2.6H6zM7 8.8h10v10.7H7Z" /><path d="M10.2 11.4h3.6M11.1 8.8v2.6" /></>,
    generic: <><path d="M6 3.5h9l3 3V20.5H6Z" /><path d="M15 3.5v3h3M9 10h6M9 14h6M9 18h4" /></>
  }
  return (
    <span className={`agent-artifact-icon type-${type}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">{paths[type]}</svg>
    </span>
  )
}

export function FileExtensionLabel({ children }: { children: string }): JSX.Element {
  return <span className="file-extension-label">{children}</span>
}
