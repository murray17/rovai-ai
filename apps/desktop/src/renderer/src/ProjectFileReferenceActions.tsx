import { UiText, uiAttribute } from './interface-language'
import * as Popover from '@radix-ui/react-popover'
import { useEffect, useRef } from 'react'
import type { ProjectFileReferenceAtom } from '@contracts'
import type { FileAvailability } from './useProjectFileAvailability'
import { ProjectFileIcon, ProjectFolderIcon } from './ProjectFileIcon'
export function ProjectFileReferenceActions({ request, status, onClose, onRemove, onReplace, onOpen, onRetry }: {
  request: { trigger: HTMLElement; atom: ProjectFileReferenceAtom; restore(): void } | null
  status?: FileAvailability
  onClose(): void; onRemove(): void; onReplace(): void; onOpen(): void; onRetry(): void
}) {
  const anchor = useRef<{ getBoundingClientRect(): DOMRect } | null>(null)
  anchor.current = request?.trigger ?? null
  const restore = useRef(request?.restore)
  useEffect(() => { if (request) restore.current = request.restore }, [request])
  const directory = request?.atom.targetKind === 'directory'
  const unavailable = status?.status === 'needs_reselect' || status?.status === 'unavailable'
  const retryable = status?.status === 'network_error' || status?.status === 'protocol_error'
    || status?.status === 'unavailable' && ['file_missing', 'unreadable', 'root_unavailable', 'target_kind_changed'].includes(status.reason)
  return <Popover.Root open={!!request} onOpenChange={open => { if (!open) onClose() }}>
    <Popover.Anchor virtualRef={anchor} />
    <Popover.Portal><Popover.Content className="ref-popover project-file-actions" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label={uiAttribute(directory ? '目录引用详情' : '文件引用详情')}
      onCloseAutoFocus={event => { event.preventDefault(); restore.current?.() }}>
      {request && <><div className="ref-popover-title">{directory ? <ProjectFolderIcon /> : <ProjectFileIcon fileName={request.atom.labelFallback} />}<strong style={{ overflowWrap: 'anywhere' }}>{request.atom.labelFallback}</strong></div>
      {status?.status === 'needs_reselect' || status?.status === 'unavailable' ? <p className="ref-unavailable-text" role="status"><UiText zh="引用当前不可用，请重新选择或移除" /></p> : status?.status === 'network_error' ? <p className="ref-meta" role="status"><UiText zh="连接失败，引用已保留，可重新检查" /></p> : status?.status === 'protocol_error' ? <p className="ref-meta" role="status"><UiText zh="文件服务响应异常，引用已保留，请重试" /></p> : null}
      <div className="ref-popover-actions">{!unavailable && <button type="button" className="ref-text-button" onClick={onOpen}><UiText zh={directory ? '打开目录' : '打开预览'} /></button>}<button type="button" className="ref-text-button" onClick={onReplace}><UiText zh="重新选择" /></button><button type="button" className="ref-text-button" onClick={onRemove}><UiText zh="移除引用" /></button>{retryable && <button type="button" className="ref-text-button" onClick={onRetry}><UiText zh="重试" /></button>}</div></>}
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
