import type { FilePreviewKind } from '@contracts'

export function FilePreviewTabIcon({ kind }: { kind: FilePreviewKind | 'file_change' }): React.JSX.Element {
  const glyph = kind === 'markdown'
    ? <><path d="M3 3.5h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3Zm18 0h-6a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h5Z" /></>
    : kind === 'code'
      ? <><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" /></>
      : kind === 'html'
        ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M6 6.5h.01M9 6.5h.01m.5 6-2 2 2 2m5-4 2 2-2 2" /></>
        : kind === 'image' || kind === 'svg'
          ? <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>
          : kind === 'patch' || kind === 'file_change'
            ? <><path d="M5 3h9l5 5v13H5ZM14 3v5h5M8 11h6m-3-3v6m-3 3h6" /></>
            : <><path d="M5 3h9l5 5v13H5ZM14 3v5h5M8 12h8m-8 4h6" /></>
  return <svg className="file-preview-tab-icon" data-file-type={kind} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{glyph}</svg>
}
