import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ConsoleClient } from './client'
import { useUiText } from '../../desktop/src/renderer/src/interface-language'

/** One Web-wide interaction boundary; the business page and its drafts stay mounted. */
export function WebConnectionRecovery({ transport, enabled, onNotice, children }: {
  transport: ConsoleClient
  enabled: boolean
  /** Source copy for the entry to translate with the current interface language. */
  onNotice(message: string): void
  children: ReactNode
}) {
  const t = useUiText()
  const subscribe = useCallback((listener: () => void) => transport.onConnectionChanged(listener), [transport])
  const snapshot = useCallback(() => transport.connectionState, [transport])
  const connection = useSyncExternalStore(subscribe, snapshot)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const active = useRef({ enabled, busy })
  active.current = { enabled, busy }
  const blocked = enabled && (connection !== 'live' || busy)

  // Installed while WebEntry is still showing login/startup, before business
  // shortcuts register their Window capture listeners. A modal focus trap alone
  // cannot prevent those listeners from acting on the page underneath a portal.
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (!active.current.enabled || transport.connectionState === 'live' && !active.current.busy) return
      event.stopImmediatePropagation()
      if (event.type !== 'keydown') return
      if (event.key === 'Tab' || event.key === 'Escape') {
        event.preventDefault()
        const target = button.current?.disabled ? dialog.current : button.current
        target?.focus({ preventScroll: true })
      } else if (!event.isComposing && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey
        && (event.key === 'Enter' || event.key === ' ') && event.target === button.current) {
        event.preventDefault()
        button.current?.click()
      }
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('keyup', key, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true) }
  }, [transport])
  useEffect(() => { if (!blocked) setFailed(false) }, [blocked])
  useEffect(() => {
    if (blocked) (busy ? dialog.current : button.current)?.focus({ preventScroll: true })
  }, [blocked, busy])

  const recover = async (): Promise<void> => {
    if (active.current.busy) return
    active.current.busy = true
    setBusy(true); setFailed(false)
    try {
      const needsFile = await transport.retryPending()
      if (needsFile) onNotice('连接已恢复。未完成的上传需要重新选择原文件。')
    } catch { if (transport.authenticated) setFailed(true) }
    finally { active.current.busy = false; setBusy(false) }
  }

  return <>
    <div className="web-connection-content" inert={blocked}>{children}</div>
    <Dialog.Root open={blocked} modal>
      <Dialog.Portal>
        <Dialog.Overlay className="web-offline-scrim" />
        <Dialog.Content ref={dialog} className="web-offline-dialog app-dialog" role="alertdialog" aria-busy={busy}
          onEscapeKeyDown={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
          onOpenAutoFocus={event => { event.preventDefault(); button.current?.focus({ preventScroll: true }) }}
          onCloseAutoFocus={event => event.preventDefault()}>
          <div className="web-offline-symbol" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 3 14 14M2 7a14 14 0 0 1 3.3-1.8M8 4.7A14 14 0 0 1 18 7M5 10a9 9 0 0 1 3.2-1.3M12 8.8a9 9 0 0 1 3 1.2M8 13a4 4 0 0 1 4 0M10 16h.01" />
            </svg>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true">
            <Dialog.Title className="web-offline-title">{t(busy ? '正在恢复连接…' : failed ? '仍无法连接服务' : '服务连接已断开')}</Dialog.Title>
            <Dialog.Description className="web-offline-description">{t(busy ? '正在恢复未完成的操作，请稍候。' : failed ? '请确认服务已启动后重试，页面和草稿会继续保留。' : '页面和草稿已保留。恢复连接后，将重试未完成的操作。')}</Dialog.Description>
          </div>
          <button ref={button} type="button" className="primary-button conversation-primary-button web-offline-retry"
            disabled={busy} onClick={() => { void recover() }}>
            {busy && <span className="web-login-spinner" aria-hidden="true" />}
            {t(busy ? '正在恢复…' : '恢复连接并重试')}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>
}
