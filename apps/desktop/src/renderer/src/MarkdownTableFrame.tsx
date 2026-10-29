import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CopyIcon } from './CopyIcon'
import { writeClipboardText } from './clipboard'
import { useUiText } from './interface-language'
import { createTableClipboardData } from './markdown-table-clipboard'
import { dismissMessageQuoteSelection } from './message-quote-selection'

export function MarkdownTableFrame({ children }: { children: ReactNode }): React.JSX.Element {
  const t = useUiText()
  const frame = useRef<HTMLDivElement>(null)
  const request = useRef(0)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    busy.current = false
    setStatus('idle')
    return () => {
      request.current += 1
      clearTimeout(timer.current)
    }
  }, [children])

  async function copy(): Promise<void> {
    const table = frame.current?.querySelector('table')
    if (!table || busy.current) return
    busy.current = true
    const current = ++request.current
    clearTimeout(timer.current)
    dismissMessageQuoteSelection()
    setStatus('copying')
    const data = createTableClipboardData(table)
    const copied = await writeClipboardText(data.text, data.html)
    if (request.current !== current) return
    busy.current = false
    if (!frame.current?.getClientRects().length) { setStatus('idle'); return }
    setStatus(copied ? 'copied' : 'failed')
    if (copied) timer.current = setTimeout(() => setStatus('idle'), 1800)
  }

  const label = status === 'copied' ? t('已复制表格')
    : status === 'copying' ? t('正在复制表格')
      : status === 'failed' ? t('重试复制表格') : t('复制表格')

  return <div className="markdown-table-frame" ref={frame} data-copy-state={status}>
    <div className="markdown-table-scroll" tabIndex={0} role="region" aria-label={t('表格')}>
      <table>{children}</table>
    </div>
    <div className="markdown-table-corner" data-quote-exclude data-file-find-exclude>
      <button type="button" className="markdown-table-copy" aria-label={label} title={label}
        aria-busy={status === 'copying'} disabled={status === 'copying'} onClick={() => { void copy() }}>
        <CopyIcon copied={status === 'copied'} />
      </button>
      <span className="sr-only" role="status">{status === 'copied' ? t('表格已复制到剪贴板') : ''}</span>
    </div>
    {status === 'failed' && <div className="markdown-table-copy-error" role="alert" data-quote-exclude data-file-find-exclude>
      {t('复制失败，请重试或选中表格后按 ⌘C 或 Ctrl+C。')}
    </div>}
  </div>
}
