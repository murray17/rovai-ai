import { useRef, type ReactElement, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { NavigationIcon } from './NavigationIcon'
import { UiText, uiAttribute } from './interface-language'

/** One draft owner; only the picker presentation changes on phones. */
export function NewConversationPicker({ mobile, open, onOpenChange, busy, title, trigger, menu, children, multiple = false }: {
  mobile: boolean
  open: boolean
  onOpenChange(open: boolean): void
  busy: boolean
  title: string
  trigger: ReactElement
  menu: ReactNode
  children: ReactNode
  multiple?: boolean
}): React.JSX.Element {
  const backRef = useRef<HTMLButtonElement>(null)
  const changeOpen = (next: boolean): void => { if (!busy) onOpenChange(next) }
  if (!mobile) return <DropdownMenu.Root open={open} onOpenChange={changeOpen}>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>{menu}</DropdownMenu.Portal>
  </DropdownMenu.Root>

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay new-camp-picker-overlay" />
      <Dialog.Content className={`compact-dialog new-camp-picker-sheet${multiple ? ' is-multiple' : ''}`} aria-describedby={undefined}
        onOpenAutoFocus={event => { event.preventDefault(); backRef.current?.focus() }}
        onEscapeKeyDown={event => { event.stopPropagation(); if (busy) event.preventDefault() }}>
        <header className="compact-header">
          <Dialog.Close asChild><button ref={backRef} className="compact-close" type="button" aria-label={uiAttribute("返回新对话")} disabled={busy}><NavigationIcon name="arrow-left" /></button></Dialog.Close>
          <Dialog.Title>{title}</Dialog.Title>
        </header>
        <div className="compact-body new-camp-picker-body">{children}</div>
        {multiple && <footer className="compact-footer"><Dialog.Close asChild><button type="button" className="compact-primary" disabled={busy}><UiText zh={"完成"} /></button></Dialog.Close></footer>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
