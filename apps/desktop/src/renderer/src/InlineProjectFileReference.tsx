import { useProjectFiles } from './ProjectFilesContext'
import { ProjectFileReferenceLabel } from './ProjectFileReferenceLabel'
import { uiAttribute } from './interface-language'
import { useEffect, useRef, useState } from 'react'
import type { PublishedProjectFileReference } from '@contracts'
import { useOptionalFilePreview } from './file-preview-context'
import { ProjectFileIcon, ProjectFolderIcon } from './ProjectFileIcon'
import { projectFileLink, fileReferencePresentation } from './project-file-reference'

export function InlineProjectFileReference({ file, files }: { file: PublishedProjectFileReference; files: readonly PublishedProjectFileReference[] }) {
  const preview = useOptionalFilePreview()
  const browser = useProjectFiles()
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const presentation = fileReferencePresentation(file, files)
  useEffect(() => { sequence.current++; setError(''); return () => { sequence.current++ } }, [file.threadId, file.rawReference, file.targetKind, browser?.store])
  return <span className="inline-project-file">
    <button type="button" className="message-mention-token thread-reference project-file-reference is-interactive"
      data-quote-reference-source={projectFileLink(file)} title={presentation.path} aria-label={presentation.ariaLabel} onClick={event => {
        if (window.getSelection()?.toString()) return
        const ticket = ++sequence.current
        const trigger = event.currentTarget
        if (file.targetKind === 'directory') {
          void browser?.revealReference(file.threadId, file.rawReference, file.pathAtSend).then(ok => { if (ok !== null && ticket === sequence.current && trigger.isConnected) setError(ok ? '' : uiAttribute('目录当前不可用')) }).catch(() => { if (ticket === sequence.current) setError(uiAttribute('连接失败，请重试')) })
          return
        }
        void preview?.open({ kind: 'project_file', threadId: file.threadId, rawReference: file.rawReference, expectedPathAtSend: file.pathAtSend }).then(result => {
          if (ticket !== sequence.current || !trigger.isConnected) return
          setError(result.kind === 'error' ? uiAttribute('文件当前不可用') : '')
        }).catch(() => { if (ticket === sequence.current) setError(uiAttribute('连接失败，请重试')) })
      }}>{file.targetKind === 'directory' ? <ProjectFolderIcon /> : <ProjectFileIcon fileName={presentation.fileName} />}<ProjectFileReferenceLabel label={presentation.label} fileName={presentation.fileName} /></button>
    {error && <span role="status" className="file-reference-error">{error}</span>}
  </span>
}
