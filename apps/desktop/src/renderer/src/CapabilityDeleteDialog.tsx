import { useRef } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { CapabilityError } from './CapabilityWorkspace'

export function CapabilityDeleteDialog({
  open,
  title,
  description,
  busy,
  error,
  onCancel,
  onConfirm
}: {
  open: boolean
  title: string
  description: string
  busy: boolean
  error: string | null
  onCancel(): void
  onConfirm(): void
}): React.JSX.Element {
  const cancel = useRef<HTMLButtonElement>(null)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          onCancel()
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
        <AppDialogContent
          className="capability-delete-dialog"
          tone="danger"
          aria-busy={busy}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancel.current?.focus()
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault()
          }}
        >
          <AppDialogHeader title={title} description={description} closeDisabled={busy} />
          <CapabilityError error={error} />
          <AppDialogFooter>
            <Dialog.Close asChild>
              <button ref={cancel} className="quiet-button" type="button" disabled={busy}>
                取消
              </button>
            </Dialog.Close>
            <button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>
              {busy ? '正在删除…' : '确认删除'}
            </button>
          </AppDialogFooter>
        </AppDialogContent>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
