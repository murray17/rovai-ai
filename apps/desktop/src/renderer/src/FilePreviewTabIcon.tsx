import type { FilePreviewKind } from '@contracts'
import {
  resourceReferenceVisualKind,
  type ResourceReferenceVisualKind
} from './file-reference-presentation'

function ResourceReferenceGlyph({ kind }: { kind: ResourceReferenceVisualKind }): React.JSX.Element {
  switch (kind) {
    case 'web':
      return <><circle cx="12" cy="12" r="8.25" /><path d="M3.9 12h16.2" /><path d="M12 3.75c2.45 2.35 3.85 5.15 3.85 8.25S14.45 17.9 12 20.25c-2.45-2.35-3.85-5.15-3.85-8.25S9.55 6.1 12 3.75Z" /></>
    case 'folder':
      return <><path d="M3.75 8.75a2 2 0 0 1 2-2H10l1.7 1.7h6.55a2 2 0 0 1 2 2v5.8a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2Z" /><path d="M3.75 10.4h16.5" /></>
    case 'markdown':
      return <><path d="M6.75 5.5h10.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><path d="M8 14.8V9.2l2 2.45 2-2.45v5.6" /><path d="M15 9.4v4.1" /><path d="m13.8 12.3 1.2 1.3 1.2-1.3" /></>
    case 'html':
      return <><path d="M6.75 5.25h10.5a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H6.75a2 2 0 0 1-2-2v-9.5a2 2 0 0 1 2-2Z" /><path d="m9.2 9.25-2 2 2 2" /><path d="m14.8 9.25 2 2-2 2" /><path d="m13.1 8.7-2.2 5.1" /></>
    case 'code':
      return <><path d="m9 8.5-3 3.5 3 3.5" /><path d="m15 8.5 3 3.5-3 3.5" /><path d="m13.1 6.75-2.2 10.5" /></>
    case 'config':
      return <><path d="M6.75 5.75h8.5l2 2v10.5a1.75 1.75 0 0 1-1.75 1.75h-8.75A1.75 1.75 0 0 1 5 18.25V7.5a1.75 1.75 0 0 1 1.75-1.75Z" /><path d="M15.2 5.9v2.35h2.35" /><path d="M8.35 12h7.3" /><path d="M8.35 15.2h5.1" /><circle cx="9.4" cy="9.2" r="1" /></>
    case 'text':
      return <><path d="M6.8 5.5h10.4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6.8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" /><path d="M8.4 9.3h7.2" /><path d="M8.4 12.1h7.2" /><path d="M8.4 14.9h4.8" /></>
    case 'image':
      return <><rect x="4.75" y="5.5" width="14.5" height="13" rx="2" /><circle cx="9.2" cy="10.1" r="1.25" /><path d="m7 16 3.2-3.4 2.5 2.5 1.8-1.9 2.5 2.8" /></>
    case 'svg':
      return <><rect x="4.75" y="5.5" width="14.5" height="13" rx="2" /><path d="m9 15 2.5-5.5 2.5 5.5" /><path d="M10 13.2h3" /><path d="M14.8 15h2.2" /><path d="M15.9 13.9v2.2" /></>
    case 'patch':
      return <><path d="M8 6.5h8a2 2 0 0 1 2 2v2.5" /><path d="M16 17.5H8a2 2 0 0 1-2-2V13" /><path d="M12 9v6" /><path d="M9 12h6" /></>
    case 'pdf':
      return <><path d="M7 5.5h7.7l2.3 2.35v10.4a1.75 1.75 0 0 1-1.75 1.75H7a1.75 1.75 0 0 1-1.75-1.75V7.25A1.75 1.75 0 0 1 7 5.5Z" /><path d="M14.6 5.75V8h2.2" /><path d="M8.2 15.2v-4.4h1.7a1.25 1.25 0 1 1 0 2.5H8.2" /><path d="M12.2 15.2v-4.4h1.1c1.55 0 2.45.8 2.45 2.2 0 1.45-.9 2.2-2.45 2.2z" /></>
    case 'document':
      return <><path d="M7 5.5h7.7l2.3 2.35v10.4a1.75 1.75 0 0 1-1.75 1.75H7a1.75 1.75 0 0 1-1.75-1.75V7.25A1.75 1.75 0 0 1 7 5.5Z" /><path d="M14.6 5.75V8h2.2" /><path d="M8.4 11h6.4" /><path d="M8.4 14h6.4" /><path d="M8.4 17h4.2" /></>
    case 'spreadsheet':
      return <><rect x="5" y="5.5" width="14" height="13" rx="2" /><path d="M9.7 5.8v12.4" /><path d="M14.3 5.8v12.4" /><path d="M5.3 10.1h13.4" /><path d="M5.3 14.3h13.4" /></>
    case 'presentation':
      return <><rect x="5" y="6" width="14" height="10.5" rx="2" /><path d="M12 16.5v2.7" /><path d="M9.2 19.2h5.6" /><path d="m9.1 13.3 2.1-3.1 1.6 1.95 1.95-2.7" /></>
    case 'notebook':
      return <><path d="M8 5.5h8.3a1.8 1.8 0 0 1 1.8 1.8v9.4a1.8 1.8 0 0 1-1.8 1.8H8" /><path d="M8 5.5v13" /><path d="M5.3 8.6h2" /><path d="M5.3 12h2" /><path d="M5.3 15.4h2" /><path d="M10.5 9.8h4.5" /><path d="M10.5 13.1h4.5" /></>
    case 'archive':
      return <><rect x="5" y="7" width="14" height="11" rx="2" /><path d="M5 10h14" /><path d="M10.4 5.5h3.2" /><path d="M12 10.2v4.2" /><path d="M10.6 12.1H13.4" /></>
    case 'audio':
      return <><path d="M9.2 16.5a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z" /><path d="M16.1 14.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z" /><path d="M11.1 18.3V8.2l6-1.4v9.7" /></>
    case 'video':
      return <><rect x="4.75" y="6.2" width="12" height="11.6" rx="2" /><path d="m12.2 12-3 1.85V10.15Z" /><path d="m16.75 10.2 2.7-1.5v6.6l-2.7-1.5" /></>
    case 'database':
      return <><ellipse cx="12" cy="7.25" rx="5.8" ry="2.35" /><path d="M6.2 7.25v8.9c0 1.3 2.6 2.35 5.8 2.35s5.8-1.05 5.8-2.35v-8.9" /><path d="M6.2 11.7c0 1.3 2.6 2.35 5.8 2.35s5.8-1.05 5.8-2.35" /></>
    case 'executable':
      return <><rect x="5" y="5.5" width="14" height="13" rx="2" /><path d="M9.2 9.6h5.6" /><path d="M9.2 12h3.6" /><path d="M9.2 14.4h5.6" /><path d="m16.4 7.9 1.4 1.4" /></>
    case 'file':
      return <><path d="M7 5.5h7.7l2.3 2.35v10.4a1.75 1.75 0 0 1-1.75 1.75H7a1.75 1.75 0 0 1-1.75-1.75V7.25A1.75 1.75 0 0 1 7 5.5Z" /><path d="M14.6 5.75V8h2.2" /></>
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
