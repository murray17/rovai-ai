import type { MessageQuoteSnapshot } from '@contracts'
import { prefersReducedMotion } from './reduced-motion'

/** Optional navigation never changes the saved excerpt or tries to reconstruct it. */
export function revealMessageQuote(root: HTMLElement): void {
  if (!root.isConnected) throw new Error('quote.source_unavailable')
  root.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  root.tabIndex = -1
  root.focus({ preventScroll: true })
}

export function revealPrivateQuote(quote: MessageQuoteSnapshot): void {
  if (!quote.source) return
  const root = document.querySelector<HTMLElement>(`[data-single-chat-owner="${CSS.escape(quote.source.conversationId ?? '')}"]`)
  const target = root?.querySelector<HTMLElement>(`[data-message-quote-body="${CSS.escape(quote.source.messageId)}"]`)
  if (!target) throw new Error('quote.source_unavailable')
  revealMessageQuote(target)
}
