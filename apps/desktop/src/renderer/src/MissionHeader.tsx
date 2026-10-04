import { useLayoutEffect, useRef } from 'react'
import type { ThreadSnapshot, MissionRecord } from '@contracts'
import { AppHeader } from './AppHeader'
import { useMobileLayout } from './MobileLayout'
import { DialogControlIcon } from './AppDialog'
import { Icon } from './MissionControls'
import { useFilePreview } from './FilePreviewContext'
import { UiText, uiAttribute } from './interface-language'

export function MissionHeader({ mission, drawer, projectName, thread, openRequest, executionTakesPreviewPriority = false, onExpand, onFold, onClose, onFocusApprovals, detailEntryHostRef }: {
  mission: MissionRecord; drawer: boolean; projectName: string | null; thread: ThreadSnapshot; openRequest: number
  executionTakesPreviewPriority?: boolean
  onExpand(): void; onFold(): void; onClose(): void; onFocusApprovals(): void
  detailEntryHostRef(host: HTMLDivElement | null): void
}): React.JSX.Element {
  const mobile = useMobileLayout()
  const preview = useFilePreview()
  const activityTab = preview.tabs.find(tab => tab.kind === 'mission_activity')
  const activitySelected = preview.paneVisible && preview.activeTabId === activityTab?.id
  const executionPriorityOnOpen = useRef(executionTakesPreviewPriority)
  executionPriorityOnOpen.current = executionTakesPreviewPriority
  // Presentation changes do not remount this header or reset the selected tab.
  useLayoutEffect(() => {
    if (mobile) return
    preview.openMissionActivity(mission.missionId)
    if (executionPriorityOnOpen.current) preview.openExecution()
  }, [
    mobile,
    mission.missionId,
    openRequest,
    preview.openExecution,
    preview.openMissionActivity
  ])
  if (mobile) return <AppHeader threadTitle={mission.title} contextLabel={projectName} thread={thread}
    detailEntryHostRef={detailEntryHostRef} onFocusApprovals={onFocusApprovals}
    onOpenConversationList={onClose} conversationListLabel={uiAttribute("返回使命板")} />
  return <AppHeader threadTitle={mission.title} contextLabel={projectName} thread={thread} detailEntryHostRef={detailEntryHostRef}
    onFocusApprovals={onFocusApprovals} hideTitle={drawer}
    leading={<div className="mission-session-leading">
      <button className="file-preview-toggle" aria-label={drawer ? uiAttribute("关闭使命抽屉") : uiAttribute("返回使命板")} title={drawer ? uiAttribute("关闭使命抽屉") : uiAttribute("返回使命板")} onClick={onClose}>
        {drawer ? <DialogControlIcon name="close"/> : <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 4-6 6 6 6M3 10h14"/></svg>}
      </button>
      <button className="file-preview-toggle" aria-label={drawer ? uiAttribute("展开为完整会话") : uiAttribute("折叠为使命抽屉")} title={drawer ? uiAttribute("展开为完整会话") : uiAttribute("折叠为使命抽屉")} onClick={drawer ? onExpand : onFold}>
        <Icon name={drawer ? 'expand' : 'collapse'}/>
      </button>
    </div>}
    conversationActions={<button className="mission-activity-entry" aria-pressed={activitySelected} onClick={() => {
      if (activitySelected && activityTab) preview.close(activityTab.id)
      else preview.openMissionActivity(mission.missionId)
    }}><Icon name="history"/><span><UiText zh={"活动"} /></span></button>}
  />
}
