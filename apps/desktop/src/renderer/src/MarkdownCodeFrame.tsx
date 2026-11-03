import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { CopyIcon } from './CopyIcon'
import { writeClipboardText } from './clipboard'
import { useUiText } from './interface-language'
import { dismissMessageQuoteSelection } from './message-quote-selection'

export function MarkdownCodeFrame({ code, children }: {
  /** Undefined only when trusted inline UI supplies part of the displayed code. */
  code?: string
  children: ReactNode
}): React.JSX.Element {
  const t = useUiText()
  const frameRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const request = useRef(0)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const [manualCode, setManualCode] = useState<string | null>(null)

  useEffect(() => {
    busy.current = false
    setStatus('idle')
    setManualCode(null)
    return () => {
      request.current += 1
      clearTimeout(timer.current)
    }
  }, [code])

  async function copy(text: string): Promise<void> {
    if (busy.current) return
    busy.current = true
    const current = ++request.current
    clearTimeout(timer.current)
    dismissMessageQuoteSelection()
    setStatus('copying')
    const copied = await writeClipboardText(text)
    // Streaming updates and unmounts invalidate the previous code's feedback.
    if (request.current !== current) return
    busy.current = false
    // File tabs retain their React trees while hidden. A late failure must not
    // open a dialog over the next file, or leave the old button busy on return.
    if (!frameRef.current?.getClientRects().length) {
      setStatus('idle')
      return
    }
    setStatus(copied ? 'copied' : 'failed')
    if (copied) {
      setManualCode(null)
      timer.current = setTimeout(() => setStatus('idle'), 1800)
    } else {
      setManualCode(text)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  const label = status === 'copied' ? t('已复制代码')
    : status === 'copying' ? t('正在复制代码')
      : status === 'failed' ? t('重试复制代码') : t('复制代码')

  return (
    <div className="markdown-code-frame" ref={frameRef}>
      {children}
      <div className="markdown-code-corner" data-quote-exclude data-file-find-exclude>
        <button
          type="button"
          className="markdown-code-copy"
          ref={buttonRef}
          aria-label={label}
          title={label}
          aria-busy={status === 'copying'}
          disabled={status === 'copying'}
          data-copy-state={status}
          onClick={() => {
            // Normal fences use parser text, never highlighted innerText. Trusted
            // mention UI has no literal placeholder in the copied projection.
            const text = code ?? frameRef.current?.querySelector('pre')?.textContent ?? ''
            void copy(text)
          }}
        >
          <CopyIcon copied={status === 'copied'} />
        </button>
        <span className="sr-only" role="status">
          {status === 'copied' ? t('代码已复制到剪贴板')
            : status === 'failed' ? t('自动复制未成功，可手动复制') : ''}
        </span>
      </div>
      <Dialog.Root open={manualCode !== null} onOpenChange={(open) => { if (!open) setManualCode(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
          <AppDialogContent
            className="markdown-code-manual"
            data-quote-exclude
            data-file-find-exclude
            onEscapeKeyDown={event => {
              // Consume Escape here even while an enclosing reader's layer is settling.
              event.preventDefault()
              event.stopImmediatePropagation()
              setManualCode(null)
            }}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              inputRef.current?.focus()
              inputRef.current?.select()
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              buttonRef.current?.focus({ preventScroll: true })
            }}
          >
            <AppDialogHeader
              title={t('请手动复制')}
              description={t('未能写入剪贴板。选中下面的代码，按 ⌘C 或 Ctrl+C。')}
              closeLabel={t('关闭')}
            />
            <AppDialogBody>
              <textarea ref={inputRef} aria-label={t('待复制的完整代码')} readOnly value={manualCode ?? ''} />
            </AppDialogBody>
            <AppDialogFooter>
              <Dialog.Close asChild><button type="button" className="quiet-button">{t('关闭')}</button></Dialog.Close>
              <button type="button" className="quiet-button" disabled={status === 'copying'}
                onClick={() => { if (manualCode !== null) void copy(manualCode) }}>{t('重试复制')}</button>
            </AppDialogFooter>
          </AppDialogContent>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
