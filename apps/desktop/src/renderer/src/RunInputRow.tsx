import { createContext, useContext, useEffect, useId, useRef } from 'react'
import type { RunInputDisplayItem } from '../../shared/execution-presentation'
import { useExecutionRetainedState } from './ExecutionVirtualList'
import { CommandExpandCue, handleToolResultKeyDown } from './ExecutionToolGroup'
import { ExecutionStatusGlyph } from './ExecutionStatusGlyph'
import { UiText, useUiText } from './interface-language'
import { messageClockTime } from './ui-model'

export const RunInputSourceContext = createContext<{
  bodyIsUnavailable(messageId: string): boolean
  body(messageId: string): Promise<string | null>
  reveal(messageId: string): void
} | null>(null)

type BodyState = { status: 'idle' | 'loading' | 'ready' | 'unavailable'; text?: string }
const labels = { pending: '待插话', sending: '发送中', accepted: '运行时已接收', delivery_unknown: '待核对', not_accepted: '未送达', queued: '已转排队', unavailable: '原消息不可用' }
const shapes = { pending: 'queued', sending: 'running', accepted: 'completed', delivery_unknown: 'waiting', not_accepted: 'failed', queued: 'queued', unavailable: 'recorded' }

/** An input uses the command row's disclosure grammar, but never counts as a tool. */
export function RunInputRow({ input, runId, itemKey }: { input: RunInputDisplayItem; runId: string; itemKey: string }) {
  const t = useUiText()
  const source = useContext(RunInputSourceContext)
  const sourceRef = useRef(source)
  sourceRef.current = source
  const [expanded, setExpanded] = useExecutionRetainedState(`input-expanded:${runId}:${input.deliveryId}`, false)
  const [body, setBody] = useExecutionRetainedState<BodyState>(`input-body:${runId}:${input.deliveryId}`, { status: 'idle' })
  const summaryRef = useRef<HTMLElement>(null)
  const helpId = useId()
  const sourceDeleted = input.sourceDeleted || source?.bodyIsUnavailable(input.messageId)
  const available = input.sourceAvailable && !sourceDeleted
  const inputStatus = available ? input.status : 'unavailable'
  const status = t(sourceDeleted ? '原消息已删除' : labels[inputStatus])
  const shape = shapes[inputStatus]
  const preview = available ? input.preview.replace(/\s+/gu, ' ').trim() : ''
  const title = [t('插话'), inputStatus !== 'accepted' ? status : '', preview].filter(Boolean).join(' · ')

  useEffect(() => {
    if (!available) {
      if (body.status !== 'idle') setBody({ status: 'idle' })
      return
    }
    if (!expanded || body.status === 'ready') return
    let cancelled = false
    setBody({ status: 'loading' })
    void (sourceRef.current?.body(input.messageId) ?? Promise.resolve(null)).catch(() => null).then(text => {
      if (!cancelled) setBody(text === null ? { status: 'unavailable' } : { status: 'ready', text })
    })
    return () => { cancelled = true }
  }, [expanded, input.messageId, available])

  return <details className={`process-action tool-call-disclosure run-input-row status-${shape}`}
    data-execution-item-key={itemKey} data-activity-domain="input" open={expanded}
    onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary ref={summaryRef} className="tool-call-summary" aria-expanded={expanded}
      aria-label={t('用户插话，{0}，{1}', status, preview)}>
      <span className="tool-call-icon" data-icon-domain="input" aria-hidden="true">
        <svg viewBox="0 0 16 16" focusable="false"><path d="M3 3.5h10v7H7l-3.5 2v-2H3z"/><path d="M5.5 6h5M5.5 8h3"/></svg>
      </span>
      <span className="command-copy"><span className="tool-call-title" title={title}>{title}</span><CommandExpandCue /></span>
      <span className={`tool-call-state status-${shape}`} role="img" aria-label={status} title={status}><ExecutionStatusGlyph status={shape} /></span>
    </summary>
    {expanded && <div className="tool-call-detail">
      {available && body.status === 'ready' ? <>
        <span className="sr-only" id={helpId}><UiText zh="正文区域可用方向键、Page Up、Page Down、空格、Home 和 End 滚动；按 Escape 返回插话行。" /></span>
        <pre className="tool-call-result-scroll" tabIndex={0} role="region" aria-label={t('插话正文，可滚动')} aria-describedby={helpId}
          onKeyDown={event => handleToolResultKeyDown(event, summaryRef.current)}>{body.text || t('此消息没有文本。')}</pre>
      </> : <div className="tool-result-state" role="status">{!available ? status
        : t(body.status === 'unavailable' ? '原消息不可用' : '正在读取原消息…')}</div>}
      {available && <button className="tool-file-link run-input-source" type="button" disabled={!source}
        aria-label={t('查看原消息')} onClick={() => source?.reveal(input.messageId)}>
        <UiText zh="原消息" />{input.createdAt && ` · ${messageClockTime(input.createdAt)}`}
      </button>}
    </div>}
  </details>
}
