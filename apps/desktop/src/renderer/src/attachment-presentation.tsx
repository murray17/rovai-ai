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
  if (kind === 'directory') return '文件夹'
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
          <path d="M5.5 11.3c0-1.5 1.2-2.7 2.7-2.7h7l2.8 3h9.8c1.5 0 2.7 1.2 2.7 2.7v11c0 1.5-1.2 2.7-2.7 2.7H8.2c-1.5 0-2.7-1.2-2.7-2.7Z" />
          <path d="M5.5 14h25" />
        </svg>
      </span>
    )
  }
  if (type === 'code') {
    return (
      <span className="user-file-icon" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <rect x="5.5" y="6" width="25" height="24" rx="6" />
          <path d="m15.2 14.2-4 3.8 4 3.8M20.8 14.2l4 3.8-4 3.8" />
        </svg>
      </span>
    )
  }
  return (
    <span className="user-file-icon" aria-hidden="true">
      <svg viewBox="0 0 36 36">
        <path d="M9 5.7h12l6 6v18.6H9Z" />
        <path d="M21 5.7v6h6M13.5 17h9M13.5 21.5h9M13.5 26h6" />
      </svg>
    </span>
  )
}

export function AgentArtifactIcon({ type }: { type: AgentAttachmentDisplayType }): JSX.Element {
  const paths: Record<AgentAttachmentDisplayType, JSX.Element> = {
    web: <><rect x="3.5" y="4" width="17" height="16" rx="2.7" /><path d="M3.5 8.5h17M7 6.2h.1M9.5 6.2h.1M12 6.2h.1M7 13h10M7 16.2h7" /></>,
    code: <><rect x="3.5" y="4" width="17" height="16" rx="2.7" /><path d="m9.4 9.5-3 2.5 3 2.5M14.6 9.5l3 2.5-3 2.5M13 7.8l-2 8.4" /></>,
    notes: <><path d="M6 3.8h9l3 3V20H6Z" /><path d="M15 3.8v3h3M9 10h6M9 13.3h6M9 16.6h4" /></>,
    pdf: <><path d="M6 3.8h9l3 3V20H6Z" /><path d="M15 3.8v3h3M8.7 15.8c1.7-2.1 2.8-4.3 3.4-6.7.2 2.6 1.2 4.8 3 6.5-2.2-.8-4.3-.7-6.4.2Z" /></>,
    word: <><path d="M6 3.8h9l3 3V20H6Z" /><path d="M15 3.8v3h3M9 10.2h6M9 13.2h6M9 16.2h4.5" /><path d="M7.2 9.5v7.4" /></>,
    sheet: <><rect x="4" y="4" width="16" height="16" rx="2.5" /><path d="M4 9h16M4 14h16M9.3 4v16M14.7 4v16" /></>,
    slide: <><rect x="3.5" y="4" width="17" height="13" rx="2.7" /><path d="M8 20h8M12 17v3M7.5 13l3-3 2.3 2.2 3.7-4" /></>,
    image: <><rect x="3.5" y="4" width="17" height="16" rx="2.7" /><path d="m7 16 3.4-3.6 2.7 2.5 3.9-4.2 3 3.4" /><circle cx="9" cy="8.5" r="1.4" /></>,
    archive: <><path d="M4.5 7.5 12 3.8l7.5 3.7v9L12 20.2l-7.5-3.7Z" /><path d="m4.5 7.5 7.5 3.7 7.5-3.7M12 11.2v9M8.2 5.7l7.5 3.7" /></>,
    generic: <><path d="M6 3.8h9l3 3V20H6Z" /><path d="M15 3.8v3h3M9 11h6M9 14.2h6M9 17.4h4" /></>
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
