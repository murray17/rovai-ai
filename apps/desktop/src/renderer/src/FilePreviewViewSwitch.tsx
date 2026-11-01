import { uiAttribute } from './interface-language'

/** Shared with the original HTML reader; changing views never saves the document. */
export function FilePreviewViewSwitch({ sourceMode, onChange, interactive = false }: {
  sourceMode: boolean
  onChange(sourceMode: boolean): void
  interactive?: boolean
}): React.JSX.Element {
  const previewLabel = uiAttribute(interactive ? '交互预览' : '预览')
  return <div className="file-preview-view-switch" role="group" aria-label={uiAttribute(interactive ? 'HTML 视图' : '文件视图')}>
    <button type="button" className="file-action-button" aria-label={previewLabel} title={previewLabel}
      aria-pressed={!sourceMode} onClick={() => { if (sourceMode) onChange(false) }}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2"/><path d="M3 8h14M6 6h.01M9 6h.01"/></svg>
    </button>
    <button type="button" className="file-action-button" aria-label={uiAttribute('查看源码')} title={uiAttribute('查看源码')}
      aria-pressed={sourceMode} onClick={() => { if (!sourceMode) onChange(true) }}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6-4 4 4 4m8-8 4 4-4 4M11.5 3.5l-3 13"/></svg>
    </button>
  </div>
}
