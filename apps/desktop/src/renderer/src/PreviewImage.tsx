import { useEffect, useRef, useState } from 'react'
import { useUiText } from './interface-language'

/** Shared image reading controls; file ownership and image URL lifetime stay with the caller. */
export function PreviewImage({ src, contentKey = src, alt, info = '', errorHint, initialScale = null, onScale, onError }: {
  src: string; alt: string; info?: string; errorHint?: string; initialScale?: number | null
  /** Stable across presentation-only replacements, such as a diagram theme change. */
  contentKey?: string
  onScale?(scale: number | null): void
  onError?(): void
}): React.JSX.Element {
  const t = useUiText()
  const viewport = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scale, setScale] = useState<number | null>(initialScale)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setDimensions(null); setFailed(false); setScale(initialScale)
  }, [contentKey])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const fit = dimensions && size.width && size.height
    ? Math.min(1, Math.max(1, size.width - 48) / dimensions.width, Math.max(1, size.height - 48) / dimensions.height) : 1
  const effectiveScale = scale ?? fit
  const changeScale = (next: number | null): void => { setScale(next); onScale?.(next) }
  const zoom = (factor: number): void => changeScale(Math.min(8, Math.max(.1, effectiveScale * factor)))
  return <div className="file-preview-image-stage">
    <div ref={viewport} className="file-preview-image-scroll" tabIndex={0} role="region" aria-label={t('图片区域')} data-dialog-autofocus
      onKeyDown={event => {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.25) }
        if (event.key === '-') { event.preventDefault(); zoom(.8) }
        if (event.key === '0') { event.preventDefault(); changeScale(null) }
        if (event.key === '1') { event.preventDefault(); changeScale(1) }
      }}>
      {failed ? <div className="file-preview-error" role="alert"><strong>{t('无法显示图片')}</strong>{errorHint && <span>{errorHint}</span>}</div>
        : <div className="file-preview-image-content"><img src={src} alt={alt} draggable={false}
          style={dimensions ? { width: dimensions.width * effectiveScale, height: dimensions.height * effectiveScale } : undefined}
          onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => { setFailed(true); onError?.() }} /></div>}
    </div>
    <div className="file-preview-image-toolbar" data-file-find-exclude>
      <div className="file-preview-image-info" aria-live="polite">
        {dimensions ? `${dimensions.width} × ${dimensions.height}` : ''}{info ? ` · ${info}` : ''}
        {dimensions ? ` · ${Math.round(effectiveScale * 100)}%` : ''}
      </div>
      <div className="file-preview-image-controls" role="group" aria-label={t('图片缩放')}>
        <button type="button" aria-label={t('缩小')} disabled={failed || effectiveScale <= .1} onClick={() => zoom(.8)}>−</button>
        <button type="button" aria-pressed={scale === null} onClick={() => changeScale(null)}>{t('适应')}</button>
        <button type="button" aria-pressed={scale === 1} onClick={() => changeScale(1)}>100%</button>
        <button type="button" aria-label={t('放大')} disabled={failed || effectiveScale >= 8} onClick={() => zoom(1.25)}>＋</button>
      </div>
    </div>
  </div>
}
