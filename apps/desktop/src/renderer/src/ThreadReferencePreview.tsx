import * as Popover from '@radix-ui/react-popover'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ReferenceCandidate, ReferenceIdentity } from '@contracts'
import { useThreadClient } from './camp-client'
import { MissionIcon } from './MissionIcon'
import { NavigationIcon } from './NavigationIcon'
import { projectReference, referenceIdentity, referenceProject, type ReferenceSegment } from './thread-reference'
import { uiAttribute } from './interface-language'
import './thread-reference.css'

interface PreviewRequest {
  reference: ReferenceIdentity
  title: string
  titleMode: 'current' | 'at-send'
  trigger: HTMLElement
  restoreFocus?(): void
  remove?(): void
  replace?(): void
}
const PreviewContext = createContext<((request: PreviewRequest) => void) | null>(null)
export const useReferencePreview = () => useContext(PreviewContext)

export function ThreadReferencePreviewProvider({ threadId, onOpen, children }: {
  threadId: string | null; onOpen(reference: ReferenceIdentity): Promise<void>; children: ReactNode
}) {
  const client = useThreadClient()
  const [request, setRequest] = useState<PreviewRequest | null>(null)
  const [result, setResult] = useState<{ item: ReferenceCandidate | null; error: boolean } | null>(null)
  const [opening, setOpening] = useState(false)
  const returnFocus = useRef<Pick<PreviewRequest, 'trigger' | 'restoreFocus'> | null>(null)
  const show = useCallback((next: PreviewRequest) => {
    returnFocus.current = next
    setResult(null)
    setOpening(false)
    setRequest(next)
  }, [])
  const virtualRef = useRef<{ getBoundingClientRect(): DOMRect } | null>(null)
  virtualRef.current = request?.trigger ?? null
  useEffect(() => { returnFocus.current = null; setRequest(null) }, [threadId])
  useEffect(() => {
    if (!request || threadId === null) return
    let cancelled = false
    setResult(null)
    void client.request<Array<ReferenceCandidate | null>>('threadReferences.resolve', { threadId, references: [request.reference] })
      .then(items => { if (!cancelled) setResult({ item: items[0] ?? null, error: false }) })
      .catch(() => { if (!cancelled) setResult({ item: null, error: true }) })
    return () => { cancelled = true }
  }, [client, threadId, request])
  const close = () => { setRequest(null); setOpening(false) }
  return <PreviewContext.Provider value={show}>
    {children}
    <Popover.Root open={!!request} onOpenChange={open => { if (!open) close() }}>
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal><Popover.Content className="ref-popover" side="top" align="start" sideOffset={8} collisionPadding={12}
        aria-label={uiAttribute('引用详情')}
        onInteractOutside={() => { returnFocus.current = null }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          const target = returnFocus.current
          returnFocus.current = null
          if (target?.restoreFocus) target.restoreFocus()
          else if (target?.trigger.isConnected) target.trigger.focus({ preventScroll: true })
        }}>
        {request && <>
          <div className="ref-popover-title">{request.reference.kind === 'mission' ? <MissionIcon /> : <NavigationIcon name="messages" />}<strong>{request.titleMode === 'at-send' ? request.title : result?.item?.title ?? request.title}</strong></div>
          {result?.item && <p className="ref-meta">{referenceProject(result.item)}</p>}
          {!result ? <p className="ref-meta" role="status">{uiAttribute('读取中…')}</p>
            : !result.item && <p className="ref-unavailable-text" role="status">{uiAttribute(result.error ? '暂时无法读取' : '引用不可用')}</p>}
          <div className="ref-popover-actions">
            {request.remove && <button type="button" className="ref-text-button" onClick={() => { request.remove?.(); close() }}>{uiAttribute('移除引用')}</button>}
            {request.replace && <button type="button" className="ref-text-button" onClick={() => { request.replace?.(); close() }}>{uiAttribute('重新选择')}</button>}
            {result?.item && <button type="button" className="ref-text-button" disabled={opening} onClick={() => {
              setOpening(true)
              void onOpen(request.reference).then(() => { returnFocus.current = null; close() }).catch(() => { setOpening(false); setResult({ item: null, error: true }) })
            }}>{uiAttribute('打开')}</button>}
          </div>
        </>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </PreviewContext.Provider>
}

export function InlineThreadReference({ segment }: { segment: ReferenceSegment }) {
  const show = useReferencePreview()
  const reference = referenceIdentity(segment)
  const icon = reference.kind === 'mission' ? <MissionIcon /> : <NavigationIcon name="messages" />
  const label = <span className="reference-token-label">{segment.titleAtSend}</span>
  const ariaLabel = uiAttribute(reference.kind === 'mission' ? '使命引用：{0}' : '会话引用：{0}', segment.titleAtSend)
  return show ? <button className="message-mention-token ref-message-link" type="button" data-reference-id={reference.id}
    aria-label={ariaLabel}
    data-quote-reference-source={projectReference(segment)}
    onClick={event => { if (!window.getSelection()?.toString()) show({ reference, title: segment.titleAtSend, titleMode: 'at-send', trigger: event.currentTarget }) }}>
    {icon}{label}
  </button> : <span className="message-mention-token ref-message-link" aria-label={ariaLabel} data-quote-reference-source={projectReference(segment)}>{icon}{label}</span>
}
