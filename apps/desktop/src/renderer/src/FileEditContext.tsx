import { createContext, useContext, useRef, useSyncExternalStore } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AppDialogContent, AppDialogHeader, AppDialogFooter } from './AppDialog'
import { uiAttribute } from './interface-language'
import type { FileEditStore } from './file-edit-store'

export const FileEditContext = createContext<FileEditStore | null>(null)
const noopSubscribe = (): (() => void) => () => undefined
const zero = (): number => 0
export function useFileEdits(): FileEditStore | null {
  const store = useContext(FileEditContext)
  useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? zero, zero)
  return store
}
export function FileEditDialogs(): React.JSX.Element | null {
  const store = useFileEdits()
  const returnFocus = useRef<HTMLElement | null>(null)
  const dialog = store?.dialog
  if (!dialog) return null
  const conflict = dialog.kind === 'conflict'
  return <Dialog.Root open onOpenChange={open => { if (!open) dialog.resolve('cancel') }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
      <AppDialogContent tone="neutral" className={conflict ? undefined : 'file-close-dialog'}
        onOpenAutoFocus={event => {
          returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          event.preventDefault()
          const content = event.target as HTMLElement
          content.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus()
        }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (returnFocus.current?.isConnected) returnFocus.current.focus()
        }}>
        <AppDialogHeader hideClose title={conflict ? uiAttribute('文件已在外部更新') : uiAttribute('关闭 {0}？', dialog.doc.name)}
          description={conflict ? uiAttribute('磁盘上的 {0} 已更改，你的修改仍然保留。', dialog.doc.name) : uiAttribute('未保存的更改将丢失。')} />
        <AppDialogFooter>
          <button type="button" className="quiet-button" data-dialog-autofocus onClick={() => dialog.resolve('cancel')}>{uiAttribute('取消')}</button>
          {conflict ? <>
            <button type="button" className="quiet-button" onClick={() => dialog.resolve('discard')}>{uiAttribute('放弃修改并重新载入')}</button>
            <button type="button" className="primary-button" onClick={() => dialog.resolve('save')}>{uiAttribute('覆盖保存')}</button>
          </> : <button type="button" className="danger-button" onClick={() => dialog.resolve('discard')}>{uiAttribute('确定')}</button>}
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}
