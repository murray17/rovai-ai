import { uiAttribute } from './interface-language'

export type AppToastValue = {
  message: string
  tone: 'neutral' | 'danger'
  action?: { label: string; onSelect(): void }
  persistent?: boolean
  loading?: boolean
  position?: 'top-center'
  keepOnAction?: boolean
  dismissible?: boolean
}

export function AppToast({
  toast,
  onClose
}: {
  toast: AppToastValue
  onClose(): void
}): React.JSX.Element {
  return (
    <div
      className={`app-toast${toast.tone === 'danger' ? ' is-danger' : ''}${toast.position === 'top-center' ? ' is-top-center' : ''}`}
      aria-busy={toast.loading || undefined}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      aria-live={toast.tone === 'danger' ? 'assertive' : 'polite'}
    >
      {toast.loading && <svg className="app-toast-spinner" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 0 1 7 7" /></svg>}
      <span>{toast.message}</span>
      {toast.action && <button className="app-toast-action" type="button" onClick={() => { if (!toast.keepOnAction) onClose(); toast.action?.onSelect() }}>{toast.action.label}</button>}
      {!toast.loading && toast.dismissible !== false && <button className="icon-button" type="button" aria-label={uiAttribute("关闭提示")} onClick={onClose}>×</button>}
    </div>
  )
}
