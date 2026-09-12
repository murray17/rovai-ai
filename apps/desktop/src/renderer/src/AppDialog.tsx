import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'

export type AppDialogTone = 'brand' | 'danger' | 'attention' | 'info' | 'neutral'

export type AppDialogIconName =
  | 'bolt'
  | 'brain'
  | 'clock'
  | 'download'
  | 'folder'
  | 'image'
  | 'info'
  | 'keep'
  | 'pencil'
  | 'server'
  | 'shield'
  | 'sparkles'
  | 'trash'
  | 'user'
  | 'warning'

type AppDialogContentProps = ComponentPropsWithoutRef<typeof Dialog.Content> & {
  tone?: AppDialogTone
  width?: 'compact' | 'wide' | 'large'
}

export function AppDialogContent({
  className = '',
  tone = 'brand',
  width = 'compact',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: AppDialogContentProps): React.JSX.Element {
  return (
    <Dialog.Content
      className={[
        'dialog-content',
        'app-dialog',
        tone === 'brand' ? '' : `tone-${tone}`,
        width === 'compact' ? '' : `app-dialog-${width}`,
        className
      ].filter(Boolean).join(' ')}
      onOpenAutoFocus={onOpenAutoFocus ?? ((event) => {
        const eventTarget = event.target instanceof HTMLElement ? event.target : null
        const content = eventTarget?.matches('.app-dialog')
          ? eventTarget
          : eventTarget?.closest<HTMLElement>('.app-dialog')
            ?? Array.from(document.querySelectorAll<HTMLElement>('.app-dialog[data-state="open"]')).at(-1)
        const preferred = content?.querySelector<HTMLElement>('[data-dialog-autofocus]')
        if (!preferred || preferred.matches(':disabled')) return
        event.preventDefault()
        preferred.focus()
      })}
      onCloseAutoFocus={onCloseAutoFocus ?? ((event) => event.preventDefault())}
      {...props}
    />
  )
}

export function AppDialogHeader({
  title,
  description,
  hideDescription = false,
  closeLabel = '关闭',
  closeDisabled = false,
  descriptionId,
  hideClose = false
}: {
  title: ReactNode
  description: ReactNode
  hideDescription?: boolean
  icon?: AppDialogIconName
  kicker?: ReactNode
  closeLabel?: string
  closeDisabled?: boolean
  descriptionId?: string
  hideClose?: boolean
}): React.JSX.Element {
  return (
    <header className="app-dialog-header">
      <div className="app-dialog-title-row">
        <Dialog.Title className="app-dialog-title">{title}</Dialog.Title>
        {!hideClose && (
          <Dialog.Close asChild>
            <button className="app-dialog-close compact-close" type="button" aria-label={closeLabel} disabled={closeDisabled}>
              <DialogControlIcon name="close" />
            </button>
          </Dialog.Close>
        )}
      </div>
      <Dialog.Description className={hideDescription ? 'sr-only' : 'app-dialog-description'} id={descriptionId}>{description}</Dialog.Description>
    </header>
  )
}

export function AppDialogBody({ children, className = '' }: {
  children: ReactNode
  className?: string
  divided?: boolean
}): React.JSX.Element {
  return <div className={`app-dialog-body${className ? ` ${className}` : ''}`}>{children}</div>
}

export function AppDialogFooter({ children, note, leading }: {
  children: ReactNode
  note?: ReactNode
  leading?: ReactNode
}): React.JSX.Element {
  return (
    <footer className="app-dialog-footer">
      {(leading || note) && <div className="app-dialog-footer-copy">{leading ?? note}</div>}
      <div className="dialog-actions">{children}</div>
    </footer>
  )
}

export function AppDialogFactGrid({ children }: { children: ReactNode }): React.JSX.Element {
  return <dl className="app-dialog-fact-grid">{children}</dl>
}

export function AppDialogFact({ label, children }: { label: ReactNode; children: ReactNode }): React.JSX.Element {
  return <div className="app-dialog-fact"><dt>{label}</dt><dd>{children}</dd></div>
}

export function AppDialogImpactList({ children }: { children: ReactNode }): React.JSX.Element {
  return <ul className="app-dialog-impact-list">{children}</ul>
}

export function AppDialogImpact({ tone = 'neutral', label, children }: {
  tone?: 'neutral' | 'delete' | 'keep' | 'warning'
  icon?: AppDialogIconName
  label: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return <li className={`app-dialog-impact is-${tone}`}><span>{label}</span><p>{children}</p></li>
}

export function DialogControlIcon({ name }: { name: 'close' | 'chevron' | 'plus' | 'check' | 'save' | 'refresh' }): React.JSX.Element {
  return <svg className="dialog-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'close' ? <path d="m5 5 10 10M15 5 5 15" />
      : name === 'plus' ? <path d="M10 4v12M4 10h12" />
      : name === 'check' ? <path d="m4.5 10 3.5 3.5L15.5 6" />
      : name === 'refresh' ? <path d="M16.5 4.5v5h-5M16.5 9.5a6.5 6.5 0 1 0-1.8 5" />
      : name === 'save' ? <><path d="M5 3h9l3 3v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M6 3v5h7V3M6 17v-6h8v6" /></>
      : <path d="m6 8 4 4 4-4" />}
  </svg>
}

export function AppDialogGlyph({ name }: { name: AppDialogIconName }): React.JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true">{glyphPaths(name)}</svg>
}

function glyphPaths(name: AppDialogIconName): React.JSX.Element {
  switch (name) {
    case 'bolt':
      return <path d="m11.5 2.5-6 8h4l-1 7 6-8h-4Z" />
    case 'brain':
      return <><path d="M8 4.5A3 3 0 0 0 3.8 8a3.2 3.2 0 0 0 .8 5.7A3 3 0 0 0 10 16V4.8A2.8 2.8 0 0 0 8 4.5Z" /><path d="M12 4.5A3 3 0 0 1 16.2 8a3.2 3.2 0 0 1-.8 5.7A3 3 0 0 1 10 16" /><path d="M6.5 9.5c1.1 0 1.9.6 2.2 1.6M13.5 9.5c-1.1 0-1.9.6-2.2 1.6" /></>
    case 'clock':
      return <><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5v4.8l3 1.8" /></>
    case 'download':
      return <><path d="M10 2.5v10M6.5 9l3.5 3.5L13.5 9" /><path d="M3 16.5h14" /></>
    case 'folder':
      return <path d="M2.5 5.5h5l1.5 2h8.5v8.5h-15Z" />
    case 'image':
      return <><rect x="2.5" y="3" width="15" height="14" rx="2" /><circle cx="7" cy="8" r="1.5" /><path d="m4.5 15 4-4 2.6 2.4 2.2-2.1 2.3 2.3" /></>
    case 'keep':
      return <><path d="M4 6h12v10H4Z" /><path d="M7 6V4h6v2M7 10h6" /></>
    case 'pencil':
      return <><path d="m4 14.5-.5 2 2-.5L15 6.5 12.5 4Z" /><path d="m11.5 5 2.5 2.5" /></>
    case 'server':
      return <><rect x="3" y="3.5" width="14" height="5.2" rx="1.2" /><rect x="3" y="11.3" width="14" height="5.2" rx="1.2" /><path d="M6 6h.01M6 13.8h.01M9 6h5M9 13.8h5" /></>
    case 'shield':
      return <><path d="M10 2.5 16 5v4.5c0 3.7-2.1 6.4-6 8-3.9-1.6-6-4.3-6-8V5Z" /><path d="m7.2 10 1.8 1.8 3.8-4" /></>
    case 'sparkles':
      return <><path d="M7.5 2.5c.4 2.2 1.6 3.5 3.8 3.9-2.2.4-3.4 1.7-3.8 3.9-.4-2.2-1.6-3.5-3.8-3.9 2.2-.4 3.4-1.7 3.8-3.9Z" /><path d="M14.3 10.5c.3 1.6 1.2 2.5 2.8 2.8-1.6.3-2.5 1.2-2.8 2.8-.3-1.6-1.2-2.5-2.8-2.8 1.6-.3 2.5-1.2 2.8-2.8Z" /></>
    case 'trash':
      return <><path d="M3.5 5.5h13M7 5.5V3.2h6v2.3M5.5 5.5l.8 11h7.4l.8-11M8.2 8.5v5M11.8 8.5v5" /></>
    case 'user':
      return <><circle cx="10" cy="6.5" r="3" /><path d="M4 17c.5-3.4 2.5-5.2 6-5.2s5.5 1.8 6 5.2" /></>
    case 'warning':
      return <><path d="M10 2.5 18 17H2Z" /><path d="M10 7v4.5M10 14.2h.01" /></>
    case 'info':
    default:
      return <><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6h.01" /></>
  }
}
