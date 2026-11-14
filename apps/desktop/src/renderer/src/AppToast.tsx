import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { uiAttribute } from './interface-language'

export type AppToastValue = {
  message: string
  tone: 'neutral' | 'danger'
  action?: { label: string; icon?: 'open' | 'retry'; onSelect(): void }
  persistent?: boolean
  loading?: boolean
  keepOnAction?: boolean
  dismissible?: boolean
}

const viewports = new WeakMap<Document, { element: HTMLDivElement; users: number }>()

function useToastViewport(): HTMLDivElement | null {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const document = window.document
    let entry = viewports.get(document)
    if (!entry?.element.isConnected) {
      const element = document.createElement('div')
      element.className = 'app-toast-viewport'
      ;(document.querySelector('.app-shell') ?? document.body).append(element)
      entry = { element, users: 0 }
      viewports.set(document, entry)
    }
    const retained = entry
    retained.users++
    setViewport(retained.element)
    return () => {
      if (--retained.users === 0) {
        retained.element.remove()
        if (viewports.get(document) === retained) viewports.delete(document)
      }
    }
  }, [])
  return viewport
}

export function AppToast({
  toast,
  onClose
}: {
  toast: AppToastValue
  onClose(): void
}): React.JSX.Element {
  const viewport = useToastViewport()
  if (!viewport) return <></>
  return createPortal(
    <div
      className={`app-toast${toast.tone === 'danger' ? ' is-danger' : ''}`}
      aria-busy={toast.loading || undefined}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      aria-live={toast.tone === 'danger' ? 'assertive' : 'polite'}
    >
      {toast.loading && <svg className="app-toast-spinner" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 0 1 7 7" /></svg>}
      <span className="app-toast-message">{toast.message}</span>
      {toast.action && <button className="app-toast-action" type="button" onClick={() => { if (!toast.keepOnAction) onClose(); toast.action?.onSelect() }}>
        <span>{toast.action.label}</span>
        {toast.action.icon && <svg className="app-toast-action-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d={toast.action.icon === 'open' ? 'M3.5 8h9m-3.5-3.5L12.5 8 9 11.5' : 'M12.7 6A5 5 0 1 0 13 9M12.7 6V2.8M12.7 6H9.5'} />
        </svg>}
      </button>}
      {!toast.loading && toast.dismissible !== false && <button className="icon-button app-toast-close" type="button" aria-label={uiAttribute("关闭提示")} title={uiAttribute('关闭提示')} onClick={onClose}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
      </button>}
    </div>, viewport
  )
}
