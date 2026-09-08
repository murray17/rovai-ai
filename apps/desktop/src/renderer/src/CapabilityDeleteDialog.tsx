import { useRef, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { CapabilityError } from './CapabilityWorkspace'

export function CapabilityDeleteDialog({
  open,
  title,
  description,
  busy,
  error,
  triggerRef,
  onCancel,
  onConfirm
}: {
  open: boolean
  title: string
  description: string
  busy: boolean
  error: string | null
  triggerRef: RefObject<HTMLButtonElement | null>
  onCancel(): void
  onConfirm(): void
}): React.JSX.Element {
  const workspace = useRef<HTMLElement | null>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const cancelled = useRef(false)
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          cancelled.current = true
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
            cancelled.current = false
            workspace.current = triggerRef.current?.closest('.capability-workspace') ?? null
            cancel.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const candidates = [
              cancelled.current ? triggerRef.current : null,
              workspace.current?.querySelector<HTMLElement>('.capability-item[aria-current="true"]'),
              ...(workspace.current?.querySelectorAll<HTMLElement>(
                '.capability-library-heading button, .capability-back'
              ) ?? [])
            ]
            candidates.find((target) =>
              target?.isConnected && !target.matches(':disabled') && target.getBoundingClientRect().width
            )?.focus()
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
