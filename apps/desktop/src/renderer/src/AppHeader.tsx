import type { CampSnapshot } from '@contracts'
import type { ReactNode, Ref } from 'react'
import { PanelToggleIcon } from './PanelToggleIcon'
import { MobileBack } from './MobileLayout'
import { useOptionalFilePreview } from './FilePreviewContext'
import { useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { FilePreviewTabs } from './FilePreviewTabs'
import { FileFindButton } from './FilePreviewFind'

export function AppHeader({
  campTitle,
  contextLabel,
  camp,
  detailEntryHostRef,
  onFocusApprovals,
  onBack,
  onOpenConversationList,
  conversationListButtonRef,
  conversationListLabel = '打开主菜单',
  leading,
  hideTitle = false,
  conversationActions,
  previewTabsInPane = false
}: {
  campTitle: string | null
  contextLabel: string | null
  camp: CampSnapshot | null
  detailEntryHostRef?(host: HTMLDivElement | null): void
  onFocusApprovals(): void
  onBack?(): void
  onOpenConversationList?(trigger: HTMLButtonElement): void
  conversationListButtonRef?: Ref<HTMLButtonElement>
  conversationListLabel?: string
  leading?: ReactNode
  hideTitle?: boolean
  conversationActions?: ReactNode
  previewTabsInPane?: boolean
}): React.JSX.Element {
  const filePreview = useOptionalFilePreview()
  const previewLayout = useOptionalFilePreviewLayout()
  const previewVisible = Boolean(filePreview?.paneVisible)
  const title = campTitle ?? '正在打开对话'
  const pendingApprovals = camp?.approvals.filter((approval) => approval.status === 'pending').length ?? 0
  const previewControls = filePreview && <div className="file-preview-toggle-group">
    {filePreview.activeTab?.kind !== 'mission_activity' && filePreview.activeTab?.kind !== 'execution' && <FileFindButton />}
    <button className="file-preview-toggle" type="button" aria-label={previewVisible ? '收起文件预览' : '展开文件预览'}
      title={previewVisible ? '收起文件预览' : '展开文件预览'} aria-expanded={previewVisible} aria-controls="file-preview-pane"
      onClick={previewVisible ? filePreview.hidePane : filePreview.showPane}>
      <PanelToggleIcon side="right" visible={previewVisible}/>
    </button>
  </div>
  return (
    <header
      className={`topbar camp-topbar ${leading ? 'mission-session-header ' : ''}${!previewTabsInPane && previewVisible ? `has-file-preview ${previewLayout?.className ?? ''}` : ''}`.trim()}
      style={previewVisible && !previewTabsInPane ? previewLayout?.style : undefined}
    >
      <div className="topbar-conversation-context">
        {leading}
        {onOpenConversationList && <button
          ref={conversationListButtonRef}
          className="mobile-icon-button mobile-conversation-list-open"
          type="button"
          aria-label={previewVisible ? '返回对话' : conversationListLabel}
          onClick={event => previewVisible ? filePreview!.hidePane() : onOpenConversationList(event.currentTarget)}
        >{previewVisible
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          : <PanelToggleIcon side="left" visible={false} />}</button>}
        {onBack && <MobileBack label={previewVisible ? '返回对话' : '返回对话列表'} onClick={previewVisible ? filePreview!.hidePane : onBack} />}
        <div className="context-breadcrumb" hidden={hideTitle}>
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
        {conversationActions}
        {previewTabsInPane && previewControls}
      </div>
      {!previewTabsInPane && previewVisible && <FilePreviewTabs compact={previewLayout?.compact} />}
      {!previewTabsInPane && previewControls}
    </header>
  )
}
