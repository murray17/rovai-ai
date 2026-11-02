import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ResolvedTheme } from '@contracts'
import { AppDialogContent, AppDialogHeader } from './AppDialog'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { PreviewImage } from './PreviewImage'
import { renderMermaid } from './mermaid-renderer'
import { useUiText } from './interface-language'

type ImageResult = { source: string; theme: ResolvedTheme; url: string }
type RenderState = { source: string; theme: ResolvedTheme; status: 'loading' | 'ready' | 'error' }

export function MarkdownMermaidBlock({ source, theme }: { source: string; theme: ResolvedTheme }): React.JSX.Element {
  const t = useUiText()
  const sequence = useRef(0)
  const expandButton = useRef<HTMLButtonElement>(null)
  const [result, setResult] = useState<ImageResult | null>(null)
  const [renderState, setRenderState] = useState<RenderState>({ source, theme, status: 'loading' })
  const [view, setView] = useState<'diagram' | 'source'>('diagram')
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const image = result?.source === source ? result : null
  const status = renderState.source === source && renderState.theme === theme ? renderState.status : 'loading'

  // Submitted results belong to React's committed display, separately from candidates.
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  useEffect(() => { setExpanded(false) }, [source])
  useEffect(() => {
    const current = ++sequence.current
    let candidate: string | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const valid = () => sequence.current === current
    setRenderState({ source, theme, status: 'loading' })
    setResult(previous => previous?.source === source ? previous : null)
    void (async () => {
      try {
        const svg = await renderMermaid(source, theme)
        if (!valid()) return
        candidate = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        const decoded = new Image()
        decoded.src = candidate
        await Promise.race([decoded.decode(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('image-timeout')), 15_000)
        })])
        if (!valid()) return
        if (!decoded.naturalWidth || !decoded.naturalHeight) throw new Error('empty-image')
        setResult({ source, theme, url: candidate })
        candidate = null
        setRenderState({ source, theme, status: 'ready' })
      } catch {
        if (!valid()) return
        setResult(null)
        setRenderState({ source, theme, status: 'error' })
      } finally {
        clearTimeout(timer)
        if (candidate) { URL.revokeObjectURL(candidate); candidate = null }
      }
    })()
    return () => {
      sequence.current += 1
      clearTimeout(timer)
      if (candidate) { URL.revokeObjectURL(candidate); candidate = null }
    }
  }, [source, theme, retry])

  const failImage = (): void => {
    sequence.current += 1
    setResult(null)
    setRenderState({ source, theme, status: 'error' })
  }
  return <div className="markdown-mermaid" data-mermaid-state={status} data-mermaid-view={view}>
    <div className="markdown-mermaid-toolbar" data-file-find-exclude data-quote-exclude>
      <button type="button" aria-pressed={view === 'source'} onClick={() => setView(view === 'source' ? 'diagram' : 'source')}>
        {view === 'source' ? t('查看图形') : t('查看源码')}
      </button>
      {image && view === 'diagram' && <button ref={expandButton} type="button" onClick={() => setExpanded(true)}>{t('查看大图')}</button>}
      {status === 'loading' && <span role="status">{t('正在绘制图表')}</span>}
      {status === 'error' && <><span role="status">{t('图表暂时无法渲染')}</span>
        <button type="button" onClick={() => setRetry(value => value + 1)}>{t('重试')}</button></>}
    </div>
    {image && view === 'diagram'
      ? <img className="markdown-mermaid-image" src={image.url} alt={t('Mermaid 图表')} onError={failImage} />
      : <MarkdownCodeBlock code={source} languageName="mermaid" theme={theme} />}
    <Dialog.Root open={expanded && image !== null} onOpenChange={setExpanded}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="markdown-mermaid-dialog" width="large" tone="neutral"
          onCloseAutoFocus={event => { event.preventDefault(); expandButton.current?.focus({ preventScroll: true }) }}>
          <AppDialogHeader title={t('Mermaid 图表')} description={t('使用缩放按钮查看细节，方向键滚动图形。')}
            hideDescription closeLabel={t('关闭')} />
          {image && <PreviewImage src={image.url} alt={t('Mermaid 图表')} onError={failImage} />}
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}
