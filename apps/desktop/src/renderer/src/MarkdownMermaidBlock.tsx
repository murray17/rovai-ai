import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ResolvedTheme } from '@contracts'
import { AppDialogContent, DialogControlIcon } from './AppDialog'
import { FilePreviewViewSwitch } from './FilePreviewViewSwitch'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { MarkdownCodeFrame } from './MarkdownCodeFrame'
import { PreviewImage } from './PreviewImage'
import { ReadonlyCodeViewer } from './ReadonlyCodeViewer'
import { renderMermaid } from './mermaid-renderer'
import { useUiText } from './interface-language'

type ImageResult = { source: string; theme: ResolvedTheme; url: string }
type RenderState = { source: string; theme: ResolvedTheme; status: 'loading' | 'ready' | 'error' }

export function MarkdownMermaidBlock({ source, theme, renderReady = true }: { source: string; theme: ResolvedTheme; renderReady?: boolean }): React.JSX.Element {
  const t = useUiText()
  const sequence = useRef(0)
  const expandButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const blockRoot = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<ImageResult | null>(null)
  const [renderState, setRenderState] = useState<RenderState>({ source, theme, status: 'loading' })
  const [view, setView] = useState<'diagram' | 'source'>('diagram')
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const image = renderReady && result?.source === source ? result : null
  const status = !renderReady ? 'pending' : renderState.source === source && renderState.theme === theme ? renderState.status : 'loading'

  // Submitted results belong to React's committed display, separately from candidates.
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  useEffect(() => { setExpanded(false) }, [source, renderReady])
  useEffect(() => {
    const current = ++sequence.current
    if (!renderReady) { setResult(null); return }
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
  }, [source, theme, retry, renderReady])

  const failImage = (): void => {
    sequence.current += 1
    setResult(null)
    setRenderState({ source, theme, status: 'error' })
  }
  const sourceMode = !image || view === 'source'
  const openReader = (trigger: HTMLButtonElement): void => {
    opener.current = trigger
    setExpanded(true)
  }
  const viewSwitch = <FilePreviewViewSwitch sourceMode={sourceMode} previewDisabled={!image}
    previewLabel={t('查看图形')} groupLabel={t('图表视图')}
    onChange={source => setView(source ? 'source' : 'diagram')} />
  const expandLabel = t(sourceMode ? '展开源码' : '查看大图')
  return <div ref={blockRoot} className="markdown-mermaid" data-mermaid-state={status} data-mermaid-view={view}>
    <div className="markdown-mermaid-toolbar" data-file-find-exclude data-quote-exclude>
      <span className="markdown-mermaid-title">Mermaid</span>
      <div className="markdown-mermaid-actions">
        {viewSwitch}
        <button ref={expandButton} type="button" className="file-action-button" disabled={!image}
          aria-label={expandLabel} title={expandLabel} onClick={event => openReader(event.currentTarget)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12 3h5v5M17 3l-6 6M8 17H3v-5M3 17l6-6" /></svg>
        </button>
      </div>
    </div>
    {(status === 'loading' || status === 'error') && <div className={`markdown-mermaid-feedback ${status}`} data-quote-exclude data-file-find-exclude>
      <span role="status">{t(status === 'error' ? '图表暂时无法渲染' : image ? '正在更新图形' : '正在绘制图表')}</span>
      {status === 'error' && <button type="button" className="file-action-button" aria-label={t('重试')} title={t('重试')}
        onClick={() => setRetry(value => value + 1)}><DialogControlIcon name="refresh" /></button>}
    </div>}
    {image && !sourceMode
      ? <button type="button" className="markdown-mermaid-image-trigger" aria-label={t('查看 Mermaid 大图')} title={t('查看大图')}
          onClick={event => openReader(event.currentTarget)}>
          <img className="markdown-mermaid-image" src={image.url} alt={t('Mermaid 图表')} onError={failImage} />
        </button>
      : <div className="markdown-mermaid-source"><MarkdownCodeBlock code={source} languageName="mermaid" theme={theme} /></div>}
    <Dialog.Root open={expanded && image !== null} onOpenChange={setExpanded}>
      <Dialog.Portal><Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent className="markdown-mermaid-dialog" width="large" tone="neutral"
          data-quote-exclude data-file-find-exclude
          onEscapeKeyDown={event => {
            const focusedDialog = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null
            if (focusedDialog && !focusedDialog.classList.contains('markdown-mermaid-dialog')) event.preventDefault()
          }}
          onOpenAutoFocus={event => {
            if (!(event.target instanceof HTMLElement)) return
            const target = event.target.querySelector<HTMLElement>(sourceMode
              ? '.markdown-mermaid-reader-source .cm-content' : '.markdown-mermaid-reader-image [data-dialog-autofocus]')
            if (target) { event.preventDefault(); target.focus({ preventScroll: true }) }
          }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            const trigger = opener.current
            // Switching views can replace the inline image button while its dialog stays open.
            const fallback = trigger?.classList.contains('markdown-mermaid-image-trigger')
              ? blockRoot.current?.querySelector<HTMLButtonElement>('.markdown-mermaid-image-trigger') : null
            const target = trigger?.isConnected && trigger.getClientRects().length ? trigger : fallback ?? expandButton.current
            target?.focus({ preventScroll: true })
          }}>
          <MarkdownCodeFrame code={source}>
            <header className="app-dialog-header markdown-mermaid-dialog-header">
              <Dialog.Title className="app-dialog-title">{t('Mermaid 图表')}</Dialog.Title>
              <div className="markdown-mermaid-actions">
                {viewSwitch}
                <span className="markdown-mermaid-copy-slot" aria-hidden="true" />
                <Dialog.Close asChild><button type="button" className="file-action-button" aria-label={t('关闭大图')} title={t('关闭')}>
                  <DialogControlIcon name="close" />
                </button></Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">{t('切换图形与源码。图形可缩放，方向键滚动，Escape 关闭。')}</Dialog.Description>
            </header>
            <div className="markdown-mermaid-reader file-preview-document-panel">
              {/* Keep both viewports mounted and measured, so switching preserves their reading state. */}
              <div className="markdown-mermaid-reader-image" data-active={!sourceMode} aria-hidden={sourceMode} inert={sourceMode}>
                {image && <PreviewImage src={image.url} contentKey={source} alt={t('Mermaid 图表')} onError={failImage} />}
              </div>
              <div className="markdown-mermaid-reader-source" data-active={sourceMode} aria-hidden={!sourceMode} inert={!sourceMode}>
                <ReadonlyCodeViewer fileName="diagram.mmd" text={source} theme={theme} registerFileFind={false} />
              </div>
            </div>
          </MarkdownCodeFrame>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}
