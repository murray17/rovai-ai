import { useRef, useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { ProjectNavigationGroup } from '@contracts'
import { AppDialogBody, AppDialogContent, AppDialogFooter, AppDialogHeader } from './AppDialog'
import { normalizeProjectDisplayName, projectDirectoryName, projectDisplayNameError } from '../../shared/project-display-name'

export function ProjectRenameDialog({ project, onClose, onSave }: {
  project: ProjectNavigationGroup
  onClose(): void
  onSave(project: ProjectNavigationGroup, name: string | null): Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState(project.name)
  const [restoreDirectoryName, setRestoreDirectoryName] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const normalized = normalizeProjectDisplayName(name)
  const validationError = restoreDirectoryName ? null : projectDisplayNameError(name)
  const directoryName = projectDirectoryName(project.projectPath)
  const error = normalized ? validationError ?? saveError : saveError

  const close = (): void => { if (!submitting.current) onClose() }
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (validationError || submitting.current) return
    submitting.current = true
    setBusy(true)
    setSaveError(null)
    try {
      await onSave(project, restoreDirectoryName || normalized === directoryName ? null : normalized)
      onClose()
    } catch {
      setSaveError('名称未能保存，请重试。')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return <Dialog.Root open onOpenChange={(open) => { if (!open) close() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay app-dialog-overlay" />
      <AppDialogContent className="camp-action-dialog" onOpenAutoFocus={(event) => {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      }} onEscapeKeyDown={(event) => { if (submitting.current) event.preventDefault() }}
      onPointerDownOutside={(event) => { if (submitting.current) event.preventDefault() }}>
        <AppDialogHeader title="重命名项目" description="修改此设备上的项目显示名称。" hideDescription closeDisabled={busy} />
        <form className="app-dialog-form" onSubmit={(event) => void save(event)}>
          <AppDialogBody>
            <label className="field-label" htmlFor="rename-project-name">项目名称
              <input id="rename-project-name" ref={input} data-dialog-autofocus value={name} disabled={busy}
                autoComplete="off" aria-invalid={Boolean(error)} aria-describedby="rename-project-context rename-project-error"
                onChange={(event) => { setName(event.target.value); setRestoreDirectoryName(false); setSaveError(null) }}
                onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault() }} />
            </label>
            <div className="rename-project-context" id="rename-project-context"><span>工作目录</span><code>{project.projectPath}</code></div>
            <p className="rename-project-error" id="rename-project-error" role="alert">{error}</p>
          </AppDialogBody>
          <AppDialogFooter leading={project.name !== directoryName
            ? <button className="quiet-button" type="button" disabled={busy} onClick={() => {
                setName(directoryName)
                setRestoreDirectoryName(true)
                setSaveError(null)
                input.current?.focus()
              }}>使用目录名</button>
            : undefined}>
            <Dialog.Close asChild><button className="quiet-button" type="button" disabled={busy}>取消</button></Dialog.Close>
            <button className="primary-button" type="submit" disabled={Boolean(validationError) || busy}>{busy ? '保存中…' : '保存名称'}</button>
          </AppDialogFooter>
        </form>
      </AppDialogContent>
    </Dialog.Portal>
  </Dialog.Root>
}
