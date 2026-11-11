import mark from './assets/rovai-mark.svg?raw'

// Trusted bundled artwork stays inline, including on the public page whose CSP disallows images.
const artwork = mark.replace(/^<svg\b[^>]*>\s*|\s*<\/svg>\s*$/gu, '')

/** One fixed brand asset for Desktop, authenticated Web and public execution. */
export function RovaiBrandMark({ className, width, height, wide = false, label }: {
  className?: string
  width?: number
  height?: number
  wide?: boolean
  label?: string
}): React.JSX.Element {
  const size = wide ? 56 : 24
  return <svg
    className={className}
    data-brand-mark="horizon"
    data-brand-layout="separated"
    width={width}
    height={height}
    viewBox={wide ? '0 0 72 56' : '0 0 24 24'}
    aria-hidden={label ? undefined : true}
    aria-label={label}
    role={label ? 'img' : undefined}
    focusable="false"
  >
    <svg x={wide ? 8 : 0} y="0" width={size} height={size} viewBox="0 0 1024 1024"
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: artwork }} />
  </svg>
}
