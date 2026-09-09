import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import * as Popover from '@radix-ui/react-popover'
import type { MessageQuoteAction, MessageQuoteSelection, MessageQuoteSnapshot } from '@contracts'
import { readMessageQuoteSelection } from './message-quote-selection'
import { readErrorMessage } from './error-message'

export function quoteErrorMessage(error: unknown): string {
  const text = readErrorMessage(error)
  if (text.includes('limit_exceeded')) return '引用选文合计最多 12,000 字，请缩小选区或移除已有引用。'
  if (text.includes('source_changed')) return '原消息内容已变化，请重新选择要引用的文字。'
  if (text.includes('projection_mismatch')) return '选文位置未能确认，请重新选择要引用的文字。'
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

type QuoteProps = {
  quotes: MessageQuoteSnapshot[]
  onReveal(quote: MessageQuoteSnapshot): void | Promise<void>
  onMutate?(action: MessageQuoteAction): Promise<void>
  disabled?: boolean
  history?: boolean
}

export function MessageQuotes({ quotes, onReveal, onMutate, disabled = false, history = false }: QuoteProps): JSX.Element | null {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressFocusOpen = useRef(false)
  const [open, setOpen] = useState(false)
  const [undo, setUndo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelTimer = (): void => { clearTimeout(timer.current) }
  useEffect(() => () => clearTimeout(timer.current), [])
  const close = (): void => { cancelTimer(); setOpen(false) }
  const leave = (): void => {
    cancelTimer()
    timer.current = setTimeout(() => {
      if (!bubble.current?.contains(document.activeElement)) setOpen(false)
    }, 220)
  }
  const blur = (next: EventTarget | null): void => {
    if (!(next instanceof Node) || (!trigger.current?.contains(next) && !bubble.current?.contains(next))) leave()
  }
  const escape = (): void => {
    close()
    suppressFocusOpen.current = document.activeElement !== trigger.current
    trigger.current?.focus({ preventScroll: true })
  }
  const enterRows = (): void => {
    cancelTimer(); setOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => bubble.current?.querySelector<HTMLButtonElement>('.message-quote-jump')?.focus()))
  }
  const mutate = async (action: MessageQuoteAction, retainFocus = false): Promise<void> => {
    if (!onMutate || disabled || busy) return
    setBusy(true); setError(null)
    try {
      await onMutate(action)
      if (action.type === 'remove') {
        setUndo(action.quoteId)
        if (retainFocus) requestAnimationFrame(() => bubble.current?.querySelector<HTMLButtonElement>('.message-quote-jump, .message-quotes-undo')?.focus())
      }
      if (action.type === 'restore') setUndo(null)
    } catch (nextError) { setError(quoteErrorMessage(nextError)) }
    finally { setBusy(false) }
  }
  const reveal = async (quote: MessageQuoteSnapshot): Promise<void> => {
    setError(null)
    try { await onReveal(quote); close() }
    catch (failure) {
      setError(String(failure).includes('selection_unavailable')
        ? '已跳到原消息，选文位置已变化；引用文字仍保留。'
        : '原消息暂不可用，已保留引用选文。')
    }
  }
  if (!quotes.length && !undo && !error) return null
  const undoControl = undo && onMutate ? <button type="button" className="message-quotes-undo" disabled={disabled || busy} onClick={() => void mutate({ type: 'restore', quoteId: undo })}>撤销移除</button> : null
  const authors = [...new Set(quotes.map((quote) => quote.authorAtCapture.displayName))].join('、')
  return <div className={`message-quotes${history ? ' is-history' : ''}`} data-quote-exclude>
    <Popover.Root open={open} onOpenChange={(next) => { cancelTimer(); setOpen(next) }} modal={false}>
      <div className="message-quotes-row" aria-label={`已引用 ${quotes.length} 段`}>
        {(quotes.length > 0 || open) && <Popover.Anchor asChild><button
          ref={trigger} type="button" className="message-quotes-trigger"
          onPointerEnter={(event) => {
            if (event.pointerType === 'touch') return
            cancelTimer(); timer.current = setTimeout(() => setOpen(true), 160)
          }}
          onPointerLeave={leave}
          onFocus={() => { if (suppressFocusOpen.current) suppressFocusOpen.current = false; else { cancelTimer(); setOpen(true) } }}
          onBlur={(event) => blur(event.relatedTarget)}
          onClick={() => { cancelTimer(); setOpen(true) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); escape() }
            if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey && open)) { event.preventDefault(); enterRows() }
          }}
          aria-label={`${history ? '查看' : '管理'} ${quotes.length} 段引用，来自${authors}`}
          aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        >
          <QuoteGlyph /><span className="message-quotes-label">引用 {quotes.length} 段</span>
          {authors && <span className="message-quotes-authors">{authors}</span>}<ExpandGlyph />
        </button></Popover.Anchor>}
        {undoControl}
      </div>
      <Popover.Portal>
        <Popover.Content ref={bubble} id={id} className="message-quotes-popover" side="top" align="start" sideOffset={7} collisionPadding={12}
          aria-label={`引用 · ${quotes.length} 段`} data-quote-exclude
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent.target
            if (target instanceof Node && trigger.current?.contains(target)) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => { event.preventDefault(); escape() }}
          onPointerEnter={cancelTimer} onPointerLeave={leave} onFocusCapture={cancelTimer}
          onBlur={(event) => blur(event.relatedTarget)}
        >
          <div className="message-quotes-popover-heading">引用 · {quotes.length} 段<span>点击选文定位</span></div>
          <div className="message-quotes-popover-body">
            {quotes.map((quote, index) => <div className="message-quote-entry" key={quote.quoteId}>
              <button type="button" className="message-quote-jump" onClick={(event) => {
                const selection = window.getSelection()
                if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return
                void reveal(quote)
              }} aria-label={`定位第 ${index + 1} 段引用，来自${quote.authorAtCapture.displayName}`}>
                <span className="message-quote-entry-author"><span>{index + 1}</span>{quote.authorAtCapture.displayName}</span>
                <span className="message-quote-full-text">{quote.text}</span>
              </button>
              {onMutate && <button type="button" className="message-quote-remove" disabled={disabled || busy} onClick={(event) => void mutate({ type: 'remove', quoteId: quote.quoteId }, event.detail === 0)} aria-label={`移除第 ${index + 1} 段引用`}>×</button>}
            </div>)}
            {!quotes.length && <p className="message-quotes-empty">当前没有引用</p>}
          </div>
          {(undoControl || error) && <div className="message-quotes-popover-footer">{undoControl}{error && <p role="alert">{error}</p>}</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    {error && !open && <div className="message-quote-error" role="alert">{error}</div>}
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
        const viewport = next.root.closest('.conversation-timeline, .single-chat-viewport')?.getBoundingClientRect()
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
