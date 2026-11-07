import { ProjectFileReferenceLabel } from './ProjectFileReferenceLabel'
import { uiAttribute } from './interface-language'
import { useRef, useState } from 'react'
import type { PublishedProjectFileReference } from '@contracts'
import { useOptionalFilePreview } from './file-preview-context'
import { ProjectFileIcon } from './ProjectFileIcon'
import { projectFileLink, fileReferencePresentation } from './project-file-reference'

export function InlineProjectFileReference({ file, files }: { file: PublishedProjectFileReference; files: readonly PublishedProjectFileReference[] }) {
  const preview = useOptionalFilePreview()
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const presentation = fileReferencePresentation(file, files)
  return <span className="inline-project-file">
    <button type="button" className="message-mention-token thread-reference project-file-reference is-interactive"
      data-quote-reference-source={projectFileLink(file)} title={presentation.path} aria-label={presentation.ariaLabel} onClick={event => {
        if (window.getSelection()?.toString()) return
        const ticket = ++sequence.current
        const trigger = event.currentTarget
        void preview?.open({ kind: 'project_file', threadId: file.threadId, rawReference: file.rawReference, expectedPathAtSend: file.pathAtSend }).then(result => {
          if (ticket !== sequence.current || !trigger.isConnected) return
          setError(result.kind === 'error' ? uiAttribute('文件当前不可用') : '')
        }).catch(() => { if (ticket === sequence.current) setError(uiAttribute('连接失败，请重试')) })
      }}><ProjectFileIcon fileName={presentation.fileName} /><ProjectFileReferenceLabel label={presentation.label} fileName={presentation.fileName} /></button>
    {error && <span role="status" className="file-reference-error">{error}</span>}
  </span>
}
