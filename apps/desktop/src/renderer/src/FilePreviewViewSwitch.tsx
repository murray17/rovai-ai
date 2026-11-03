import { uiAttribute } from './interface-language'

/** Shared reading controls. Selecting the current view also records explicit intent. */
export function FilePreviewViewSwitch({ sourceMode, onChange, interactive = false, previewDisabled = false, previewLabel: label, groupLabel }: {
  sourceMode: boolean
  onChange(sourceMode: boolean): void
  interactive?: boolean
  previewDisabled?: boolean
  previewLabel?: string
  groupLabel?: string
}): React.JSX.Element {
  const previewLabel = label ?? uiAttribute(interactive ? '交互预览' : '预览')
  return <div className="file-preview-view-switch" role="group" aria-label={groupLabel ?? uiAttribute(interactive ? 'HTML 视图' : '文件视图')}>
    <button type="button" className="file-action-button" aria-label={previewLabel} title={previewLabel}
      aria-pressed={!sourceMode} disabled={previewDisabled} onClick={() => onChange(false)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 8h14M6 6h.01M9 6h.01"/></svg>
    </button>
    <button type="button" className="file-action-button" aria-label={uiAttribute('查看源码')} title={uiAttribute('查看源码')}
      aria-pressed={sourceMode} onClick={() => onChange(true)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6-4 4 4 4m8-8 4 4-4 4M11.5 3.5l-3 13"/></svg>
    </button>
  </div>
}
