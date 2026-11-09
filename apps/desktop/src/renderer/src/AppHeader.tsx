import { useEffect, useState } from 'react'
import type { ThreadSnapshot } from '@contracts'
import type { ReactNode, Ref } from 'react'
import { PanelToggleIcon } from './PanelToggleIcon'
import { MobileBack } from './MobileLayout'
import { useOptionalFilePreview } from './FilePreviewContext'
import { FilePreviewExpandButton, useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { FilePreviewTabs } from './FilePreviewTabs'
import { FileFindButton } from './FilePreviewFind'
import { UiText, uiAttribute } from './interface-language'
import { useProjectFiles } from './ProjectFilesContext'
import { ProjectFilesButton } from './ProjectFilesPane'
import { ProjectFolderIcon } from './ProjectFileIcon'

export function AppHeader({
  threadTitle,
  contextLabel,
  thread,
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
  threadTitle: string | null
  contextLabel: string | null
  thread: ThreadSnapshot | null
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
  const browser = useProjectFiles()
  const previewLayout = useOptionalFilePreviewLayout()
  const previewVisible = Boolean(filePreview?.paneVisible)
  const title = threadTitle ?? uiAttribute('正在打开对话')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!thread?.nativeInteractions?.some(request => request.expiresAt !== null)) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [thread?.nativeInteractions])
  const pendingApprovals = (thread?.approvals.filter((approval) => approval.status === 'pending').length ?? 0)
    + (thread?.nativeInteractions?.filter(request => request.expiresAt === null || request.expiresAt > now).length ?? 0)
  const previewActions = <>
    {filePreview?.activeTab?.kind !== 'mission_activity' && filePreview?.activeTab?.kind !== 'execution' && <FileFindButton />}
    <FilePreviewExpandButton />
  </>
  const sidecarToggle = filePreview && <button className="file-preview-toggle" type="button" aria-label={previewVisible ? uiAttribute("收起文件预览") : uiAttribute("展开文件预览")}
      title={previewVisible ? uiAttribute("收起文件预览") : uiAttribute("展开文件预览")} aria-expanded={previewVisible} aria-controls="file-preview-pane"
      onClick={previewVisible ? filePreview.hidePane : filePreview.showPane}>
      <PanelToggleIcon side="right" visible={previewVisible}/>
    </button>
  const previewControls = filePreview && (browser?.store ? <>
    <div className="file-preview-toggle-group">{previewActions}</div>
    <div className="project-files-fixed-controls"><ProjectFilesButton />{sidecarToggle}</div>
  </> : <div className="file-preview-toggle-group">{previewActions}{sidecarToggle}</div>)
  return (
    <header
      className={`topbar camp-topbar ${browser?.store ? 'has-project-files ' : ''}${leading ? 'mission-session-header ' : ''}${previewLayout?.className ?? ''} ${!previewTabsInPane && previewVisible ? 'has-file-preview' : ''}`.trim()}
      style={!previewTabsInPane ? previewLayout?.style : undefined}
    >
      <div className="topbar-conversation-context">
        {leading}
        {onOpenConversationList && <button
          ref={conversationListButtonRef}
          className="mobile-icon-button mobile-conversation-list-open"
          type="button"
          aria-label={previewVisible ? uiAttribute("返回对话") : conversationListLabel}
          onClick={event => previewVisible ? filePreview!.hidePane() : onOpenConversationList(event.currentTarget)}
        >{previewVisible
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          : <PanelToggleIcon side="left" visible={false} />}</button>}
        {onBack && <MobileBack label={previewVisible ? uiAttribute("返回对话") : uiAttribute("返回对话列表")} onClick={previewVisible ? filePreview!.hidePane : onBack} />}
        <div className="context-breadcrumb" hidden={hideTitle}>
          {contextLabel && (browser?.store ? <button type="button" className="context-project project-files-project" title={uiAttribute('显示／隐藏文件目录')} aria-expanded={browser.visible} aria-controls="project-files-pane" onClick={event => browser.toggle(event.currentTarget)}><ProjectFolderIcon /><span>{contextLabel}</span></button> : <span className="context-project">{contextLabel}</span>)}
          {contextLabel && <span className="context-sep" aria-hidden="true">›</span>}
          <h1 title={title}>{title}</h1>
        </div>
        <div className="topbar-context-status" aria-live="polite">
          {pendingApprovals > 0 && (
            <button
              className="pending-header-entry"
              type="button"
              onClick={onFocusApprovals}
              aria-label={uiAttribute("待处理 {0}，定位输入框上方待处理区域", String(pendingApprovals))}
            ><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M7 5h9M7 10h9M7 15h9"/><path d="M3.5 5h.01M3.5 10h.01M3.5 15h.01" strokeWidth="2.2"/></svg><UiText zh="待处理" /><span>{pendingApprovals}</span>
            </button>
          )}
        </div>
        <div className="camp-detail-entry-host" ref={detailEntryHostRef}><div className="camp-detail-entry-slot" data-detail-slot="primary" /><div className="camp-detail-entry-slot" data-detail-slot="single-chat" /><div className="camp-detail-entry-slot" data-detail-slot="tasks" /></div>
        {conversationActions}
        {previewTabsInPane && previewControls}
      </div>
      {!previewTabsInPane && previewVisible && <FilePreviewTabs compact={previewLayout?.compact} />}
      {!previewTabsInPane && previewControls}
    </header>
  )
}
