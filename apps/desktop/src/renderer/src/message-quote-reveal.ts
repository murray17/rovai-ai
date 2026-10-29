import { prefersReducedMotion } from './reduced-motion'

/** Optional navigation never changes the saved excerpt or tries to reconstruct it. */
export function revealMessageQuote(root: HTMLElement): void {
  if (!root.isConnected) throw new Error('quote.source_unavailable')
  root.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  root.tabIndex = -1
  root.focus({ preventScroll: true })
}
