import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import * as Dialog from '@radix-ui/react-dialog'
import type { MessageQuoteAction, MessageQuoteSelection, MessageQuoteSnapshot } from '@contracts'
import { readMessageQuoteSelection } from './message-quote-selection'

export function quoteErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes('limit_exceeded')) return '引用选文合计最多 12,000 字，请缩小选区或移除已有引用。'
  if (text.includes('source_changed') || text.includes('projection_mismatch')) return '原消息内容已变化，请重新选择要引用的文字。'
  if (text.includes('source_unavailable') || text.includes('owner_mismatch')) return '原消息暂不可用，已保留已有引用。'
  if (text.includes('question_required')) return '请填写这次的问题后再发送。'
  if (text.includes('draft_changed')) return '草稿已更新，请重试；已有问题和引用已保留。'
  return '引用操作未完成，请重试。'
}
function QuoteGlyph(): JSX.Element {
  return <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M6.8 5.6c0-1.4-.9-2.3-2.2-2.3s-2.3.9-2.3 2.3.9 2.2 2.2 2.2h.3C4.6 9.3 3.8 10.1 2.5 10.7v1.5c2.7-1 4.3-3.2 4.3-6.6Zm7 0c0-1.4-.9-2.3-2.2-2.3s-2.3.9-2.3 2.3.9 2.2 2.2 2.2h.3c-.2 1.5-1 2.3-2.3 2.9v1.5c2.7-1 4.3-3.2 4.3-6.6Z" />
  </svg>
}
function ExpandGlyph(): JSX.Element {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5.5 6.5 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
const excerpt = (text: string): string => text.replace(/\s+/gu, ' ').trim()

type QuoteProps = {
  quotes: MessageQuoteSnapshot[]
  onReveal(quote: MessageQuoteSnapshot): void | Promise<void>
  onMutate?(action: MessageQuoteAction): Promise<void>
  disabled?: boolean
  history?: boolean
}

export function MessageQuotes({ quotes, onReveal, onMutate, disabled = false, history = false }: QuoteProps): JSX.Element | null {
  const restoreFocus = useRef<HTMLElement | null>(null)
  const [view, setView] = useState<'list' | string | null>(null)
  const openView = (next: string): void => { if (view === null) restoreFocus.current = document.activeElement as HTMLElement | null; setView(next) }
  const [undo, setUndo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = quotes.find((quote) => quote.quoteId === view)
  const mutate = async (action: MessageQuoteAction): Promise<void> => {
    if (!onMutate || disabled || busy) return
    setBusy(true); setError(null)
    try {
      await onMutate(action)
      if (action.type === 'remove') { setUndo(action.quoteId); if (view === action.quoteId) setView('list') }
      if (action.type === 'restore') setUndo(null)
    } catch (nextError) { setError(quoteErrorMessage(nextError)) }
    finally { setBusy(false) }
  }
  const reveal = async (quote: MessageQuoteSnapshot): Promise<void> => {
    setError(null)
    try { await onReveal(quote); restoreFocus.current = null; setView(null) }
    catch { setError('原消息暂不可用，已保留引用选文。') }
  }
  if (!quotes.length && !undo && !error) return null
  const undoControl = undo && onMutate ? <button type="button" className="message-quotes-undo" disabled={disabled || busy} onClick={() => void mutate({ type: 'restore', quoteId: undo })}>撤销移除</button> : null
  const authors = [...new Set(quotes.map((quote) => quote.authorAtCapture.displayName))].join('、')
  return <div className={`message-quotes${history ? ' is-history' : ''}`} data-quote-exclude>
    <div className="message-quotes-row" aria-label={`已引用 ${quotes.length} 段`}>
      {quotes.length > 0 && <button
        type="button"
        className="message-quotes-trigger"
        onClick={() => openView(quotes.length === 1 ? quotes[0].quoteId : 'list')}
        aria-label={`${history ? '查看' : '管理'} ${quotes.length} 段引用，来自${authors}`}
        aria-haspopup="dialog"
        aria-expanded={view !== null}
      >
        <QuoteGlyph />
        <span className="message-quotes-label">引用 {quotes.length} 段</span>
        <span className="message-quotes-authors">{authors}</span>
        <ExpandGlyph />
      </button>}
      {undoControl}
    </div>
    {error && <div className="message-quote-error" role="alert">{error}</div>}
    <Dialog.Root open={view !== null} onOpenChange={(open) => { if (!open) setView(null) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="message-quotes-overlay" />
        <Dialog.Content className="message-quotes-dialog" onCloseAutoFocus={(event) => { event.preventDefault(); if (restoreFocus.current?.isConnected) restoreFocus.current.focus() }}>
          <div className="message-quotes-dialog-heading">
            {active && <button type="button" className="message-quotes-back" onClick={() => openView('list')} aria-label="返回引用列表">‹</button>}
            <Dialog.Title>{active ? '引用全文' : `引用 · ${quotes.length} 段`}</Dialog.Title>
            <Dialog.Close className="message-quotes-close" aria-label="关闭引用详情">×</Dialog.Close>
          </div>
          <Dialog.Description className="message-quotes-description">{active ? '已保留选取时的文字' : '按添加顺序随本次问题发送'}</Dialog.Description>
          <div className="message-quotes-dialog-body">
            {(active ? [active] : quotes).map((quote, index) => <section className="message-quote-detail" key={quote.quoteId}>
              <div className="message-quote-detail-heading">
                {!active && <span className="message-quote-number">{index + 1}</span>}
                <button type="button" className="message-quote-source" onClick={() => void reveal(quote)}>{quote.authorAtCapture.displayName}<span>原消息 ↗</span></button>
                {onMutate && <button type="button" disabled={disabled || busy} className="message-quotes-remove-detail" onClick={() => void mutate({ type: 'remove', quoteId: quote.quoteId })}>移除</button>}
              </div>
              {active ? <div className="message-quote-full-text">{quote.text}</div> : <button type="button" className="message-quote-detail-excerpt" onClick={() => openView(quote.quoteId)}>{excerpt(quote.text)}<span>查看全文</span></button>}
            </section>)}
            {!quotes.length && <p className="message-quotes-empty">当前没有引用</p>}
          </div>
          {(undoControl || error) && <div className="message-quotes-dialog-footer">{undoControl}{error && <p role="alert">{error}</p>}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}

type Candidate = NonNullable<ReturnType<typeof readMessageQuoteSelection>>
export function MessageQuoteSelectionToolbar({ ownerKey, messages, disabled, onAdd }: {
  ownerKey: string
  messages: { id: string; body: string; authorType: string }[]
  disabled: boolean
  onAdd(selection: MessageQuoteSelection): Promise<void>
}): JSX.Element | null {
  const [candidate, setCandidate] = useState<Candidate | null>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef({ messages, onAdd, disabled })
  latest.current = { messages, onAdd, disabled }
  const dismissed = useRef<Range | null>(null)
  useEffect(() => {
    let dragging = false
    let frame = 0
    const same = (range: Range | null, other: Range): boolean => Boolean(range && range.startContainer === other.startContainer && range.startOffset === other.startOffset && range.endContainer === other.endContainer && range.endOffset === other.endOffset)
    const dismiss = (): void => {
      const selection = window.getSelection()
      dismissed.current = selection?.rangeCount === 1 ? selection.getRangeAt(0).cloneRange() : null
      setCandidate(null); setError(null)
    }
    const update = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (dragging || latest.current.disabled) { setCandidate(null); return }
        const next = readMessageQuoteSelection(window.getSelection(), ownerKey, (id) => latest.current.messages.find((message) => message.id === id))
        if (!next || same(dismissed.current, next.range)) { setCandidate(null); return }
        const rects = [...next.range.getClientRects()]
        const rect = rects.at(-1) ?? next.range.getBoundingClientRect()
        const viewport = next.root.closest('.conversation-timeline, .single-chat-transcript')?.getBoundingClientRect()
        if (!rect.width || rect.bottom < Math.max(0, viewport?.top ?? 0) || rect.top > Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight)) { setCandidate(null); return }
        setPosition({ x: Math.max(8, Math.min(window.innerWidth - 100, rect.right - 50)), y: Math.max(8, Math.min(window.innerHeight - 44, rect.bottom + 7)) })
        setCandidate(next); setError(null)
      })
    }
    const down = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('.message-quote-selection-toolbar')) return
      const root = target?.closest<HTMLElement>('[data-message-quote-body]')
      if (root?.dataset.quoteOwner === ownerKey && !target?.closest('button, input, textarea, [data-quote-exclude]')) {
        dragging = true; dismissed.current = null; setCandidate(null); setError(null)
      } else dismiss()
    }
    const up = (): void => { if (dragging) { dragging = false; update() } }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') dismiss() }
    const focus = (event: FocusEvent): void => { if (!(event.target instanceof Element) || !event.target.closest('.message-quote-selection-toolbar')) dismiss() }
    document.addEventListener('selectionchange', update)
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('copy', dismiss, true)
    document.addEventListener('contextmenu', dismiss, true)
    document.addEventListener('focusin', focus, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('scroll', update, true)
    window.addEventListener('blur', dismiss)
    window.addEventListener('rovai-dismiss-message-quote', dismiss)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', update)
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('copy', dismiss, true)
      document.removeEventListener('contextmenu', dismiss, true)
      document.removeEventListener('focusin', focus, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('rovai-dismiss-message-quote', dismiss)
      setCandidate(null); dismissed.current = null
    }
  }, [ownerKey])
  if (!candidate || disabled) return null
  return createPortal(<div className="message-quote-selection-toolbar" style={{ left: position.x, top: position.y }}>
    <button type="button" disabled={busy} onPointerDown={(event) => event.preventDefault()} onClick={() => {
      if (busy || !candidate.root.isConnected || candidate.root.dataset.quoteOwner !== ownerKey) return
      setBusy(true); setError(null)
      void latest.current.onAdd(candidate.selection).then(() => {
        dismissed.current = candidate.range; setCandidate(null)
      }).catch((nextError: unknown) => setError(quoteErrorMessage(nextError))).finally(() => setBusy(false))
    }}><QuoteGlyph />{busy ? '引用中…' : '引用'}</button>
    {error && <div className="message-quote-selection-error" role="alert">{error}</div>}
  </div>, document.body)
}
