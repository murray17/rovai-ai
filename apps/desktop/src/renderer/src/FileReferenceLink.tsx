import { Children, isValidElement, useMemo, type JSX, type ReactNode } from 'react'
import type { FileLocationTarget } from '@contracts'
import { parseFileReference } from '../../file-preview-reference'
import { FilePreviewTabIcon } from './FilePreviewTabIcon'
import { projectMessageFileReferences } from './safe-markdown-model'

export const FILE_REFERENCE_FRAGMENT = '#rovai-file-reference='
export type FileReferenceActivation = (rawReference: string, source: HTMLElement, target?: FileLocationTarget) => void

export function FileReferenceLink({
  rawReference,
  children,
  className,
  sourceReference,
  onActivate
}: {
  rawReference: string
  children: ReactNode
  className: string
  sourceReference?: string
  onActivate: FileReferenceActivation
}): JSX.Element {
  const labelNodes = Children.toArray(children)
  const onlyChild = labelNodes.length === 1 ? labelNodes[0] : null
  const codeLabel = isValidElement<{ children?: ReactNode }>(onlyChild) && onlyChild.type === 'code'
    ? onlyChild
    : null

  return (
    <a
      className={codeLabel ? `${className} inline-code-file-reference` : className}
      href={`${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(rawReference)}`}
      title={rawReference}
      onClick={(event) => {
        event.preventDefault()
        if (event.detail > 0 && window.getSelection()?.toString()) return
        onActivate(sourceReference ?? rawReference, event.currentTarget,
          sourceReference ? parseFileReference(rawReference)?.target : undefined)
      }}
      onAuxClick={(event) => event.preventDefault()}
    >
      {codeLabel ? (
        <>
          <FilePreviewTabIcon kind="text" />
          <span className="inline-code-file-reference-label">{codeLabel.props.children}</span>
        </>
      ) : children}
    </a>
  )
}

export function FileReferenceText({
  text,
  onActivate
}: {
  text: string
  onActivate?: FileReferenceActivation
}): JSX.Element {
  const enabled = Boolean(onActivate)
  const references = useMemo(() => enabled ? projectMessageFileReferences(text) : [], [enabled, text])
  if (!onActivate || references.length === 0) return <>{text}</>
  const output: ReactNode[] = []
  let offset = 0
  for (const reference of references) {
    if (reference.start > offset) output.push(text.slice(offset, reference.start))
    output.push(
      <FileReferenceLink
        className="message-file-reference"
        rawReference={reference.rawReference}
        sourceReference={reference.sourceReference}
        key={`${reference.start}:${reference.rawReference}`}
        onActivate={onActivate}
      >
        {reference.inlineCode ? <code>{reference.label}</code> : reference.label}
      </FileReferenceLink>
    )
    offset = reference.end
  }
  if (offset < text.length) output.push(text.slice(offset))
  return <>{output}</>
}
