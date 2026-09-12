import type { CampSnapshot } from '@contracts'
import { useOptionalFilePreview } from './FilePreviewContext'
import { useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { FilePreviewTabs } from './FilePreviewTabs'
import { FileFindButton } from './FilePreviewFind'

export function AppHeader({
  campTitle,
  contextLabel,
  camp,
  detailEntryHostRef,
  onFocusApprovals
}: {
  campTitle: string | null
  contextLabel: string | null
  camp: CampSnapshot | null
  detailEntryHostRef?(host: HTMLDivElement | null): void
  onFocusApprovals(): void
}): React.JSX.Element {
  const filePreview = useOptionalFilePreview()
  const previewLayout = useOptionalFilePreviewLayout()
  const previewVisible = Boolean(filePreview?.paneVisible)
  const title = campTitle ?? '正在打开对话'
  const pendingApprovals = camp?.approvals.filter((approval) => approval.status === 'pending').length ?? 0
  return (
    <header
      className={`topbar camp-topbar ${previewVisible ? `has-file-preview ${previewLayout?.className ?? ''}` : ''}`.trim()}
      style={previewVisible ? previewLayout?.style : undefined}
    >
      <div className="topbar-conversation-context">
        <div className="context-breadcrumb">
          {contextLabel && <span className="context-project">{contextLabel}</span>}
          {contextLabel && <span className="context-sep" aria-hidden="true">›</span>}
          <h1 title={title}>{title}</h1>
        </div>
        <div className="topbar-context-status" aria-live="polite">
          {pendingApprovals > 0 && (
            <button
              className="approval-badge"
              type="button"
              onClick={onFocusApprovals}
              aria-label={`待审批 ${pendingApprovals}，定位输入框上方审批`}
            >
              ◆ 待审批 {pendingApprovals}
            </button>
          )}
        </div>
        <div className="camp-detail-entry-host" ref={detailEntryHostRef} />
      </div>
      {previewVisible && <FilePreviewTabs compact={previewLayout?.compact} />}
      {filePreview && <div className="file-preview-toggle-group">
        <FileFindButton />
        <span className="file-preview-toggle-divider" aria-hidden="true" />
        <button
          className="file-preview-toggle"
          type="button"
          aria-label={previewVisible ? '收起文件预览' : '展开文件预览'}
          title={previewVisible ? '收起文件预览' : '展开文件预览'}
          aria-expanded={previewVisible}
          aria-controls="file-preview-pane"
          onClick={previewVisible ? filePreview.hidePane : filePreview.showPane}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h3M8 17h3M15 13v5" />
          </svg>
        </button>
      </div>}
    </header>
  )
}

