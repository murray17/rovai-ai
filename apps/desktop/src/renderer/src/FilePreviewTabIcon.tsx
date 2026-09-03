import type { FilePreviewKind } from '@contracts'
import {
  resourceReferenceVisualKind,
  type ResourceReferenceVisualKind
} from './file-reference-presentation'

function ResourceReferenceGlyph({ kind }: { kind: ResourceReferenceVisualKind }): React.JSX.Element {
  switch (kind) {
    case 'web':
      return <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9S14.4 18.5 12 21M12 3C9.6 5.5 8.5 8.5 8.5 12S9.6 18.5 12 21" /></>
    case 'markdown':
      return <><path d="M4 4.5h7a3 3 0 0 1 3 3v12a4 4 0 0 0-4-2.5H4zM20 4.5h-3.5A2.5 2.5 0 0 0 14 7" /><path d="M7 9.5v4m0-4 2 2 2-2v4" /></>
    case 'html':
      return <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8.5h18M6 6.2h.01M9 6.2h.01m1 6-2 2 2 2m4-4 2 2-2 2" /></>
    case 'code':
      return <><path d="m8 6-5 6 5 6m8-12 5 6-5 6m-3-15-2 18" /></>
    case 'config':
      return <><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h8" /><circle cx="11" cy="8" r="1.2" /><circle cx="14" cy="12" r="1.2" /><circle cx="10" cy="16" r="1.2" /></>
    case 'text':
      return <><path d="M6 3.5h8l4 4V20H6zM14 3.5v4h4M9 12h6m-6 3h6m-6 3h4" /></>
    case 'image':
      return <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>
    case 'svg':
      return <><path d="M7 5h10v4H7zM5 15h4v4H5zm10 0h4v4h-4zM12 9v4m-5 2v-2h10v2" /><circle cx="12" cy="13" r="1" /></>
    case 'patch':
      return <><path d="M6 3.5h8l4 4V20H6zM14 3.5v4h4M9 11h6m-3-3v6m-3 4h6" /></>
    case 'folder':
      return <><path d="M3 6.5h7l2 2h9v10.5H3z" /></>
    case 'pdf':
      return <><path d="M6 3.5h8l4 4V20H6zM14 3.5v4h4" /><path d="M8 16v-4h1.6a1.4 1.4 0 0 1 0 2.8H8m5.2 1.2v-4h1.2c1.6 0 2.6.8 2.6 2s-1 2-2.6 2h-1.2" /></>
    case 'document':
      return <><path d="M6 3.5h8l4 4V20H6zM14 3.5v4h4M9 11h6M9 14h6M9 17h4" /></>
    case 'spreadsheet':
      return <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16M4 14h16M10 4v16M15 4v16" /></>
    case 'presentation':
      return <><rect x="4" y="4" width="16" height="13" rx="2" /><path d="M8 20h8M12 17v3M8 8h8M8 11h5" /></>
    case 'notebook':
      return <><path d="M6 4h12v16H6zM9 4v16M3.5 7H6M3.5 11H6M3.5 15H6" /><path d="m12 9-2 2 2 2m3-4 2 2-2 2" /></>
    case 'archive':
      return <><path d="M6 3.5h12V20H6zM9 3.5v3h3v3H9v3h3v3H9v3h3" /><path d="M12 16h3v3h-3z" /></>
    case 'audio':
      return <><path d="M9 18V7l9-2v11" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="15.5" cy="16" r="2.5" /></>
    case 'video':
      return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3z" /></>
    case 'database':
      return <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>
    case 'executable':
      return <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 15h8M9 8v8M15 8v8" /><circle cx="12" cy="12" r="2" /></>
    case 'file':
      return <><path d="M6 3.5h8l4 4V20H6zM14 3.5v4h4" /></>
  }
}

export function ResourceReferenceIcon({
  kind,
  className,
  fileType
}: {
  kind: ResourceReferenceVisualKind
  className: string
  fileType?: FilePreviewKind | 'file_change'
}): React.JSX.Element {
  const typeAttribute = fileType
    ? { 'data-file-type': fileType }
    : {}
  return (
    <svg className={className} data-resource-type={kind} {...typeAttribute} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <ResourceReferenceGlyph kind={kind} />
    </svg>
  )
}

export function FileReferenceIcon({ rawReference }: { rawReference: string }): React.JSX.Element {
  const kind = resourceReferenceVisualKind(rawReference)
  return <ResourceReferenceIcon kind={kind} className="resource-reference-icon file-reference-icon" />
}

export function FilePreviewTabIcon({
  kind,
  fileType
}: {
  kind: ResourceReferenceVisualKind
  fileType?: FilePreviewKind | 'file_change'
}): React.JSX.Element {
  return <ResourceReferenceIcon kind={kind} className="file-preview-tab-icon" fileType={fileType} />
}
