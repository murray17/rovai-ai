import { createContext, useContext, useSyncExternalStore } from 'react'
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
  const dialog = store?.dialog
  if (!dialog) return null
  const conflict = dialog.kind === 'conflict'
  return <Dialog.Root open onOpenChange={open => { if (!open) dialog.resolve('cancel') }}>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" />
      <AppDialogContent tone="neutral">
        <AppDialogHeader hideClose title={uiAttribute(conflict ? '文件已在外部更新' : '保存文件更改？')}
          description={conflict ? uiAttribute('磁盘上的 {0} 已更改，你的修改仍然保留。', dialog.doc.name) : dialog.doc.name} />
        <AppDialogFooter>
          <button type="button" className="secondary-button" data-dialog-autofocus onClick={() => dialog.resolve('cancel')}>{uiAttribute('取消')}</button>
          <button type="button" className="secondary-button" onClick={() => dialog.resolve('discard')}>{uiAttribute(conflict ? '放弃修改并重新载入' : '不保存')}</button>
          <button type="button" className="primary-button" onClick={() => dialog.resolve('save')}>{uiAttribute(conflict ? '覆盖保存' : '保存')}</button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}
