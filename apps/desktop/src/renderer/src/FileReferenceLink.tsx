import { Children, isValidElement, useMemo, type JSX, type ReactNode } from 'react'
import { FilePreviewTabIcon } from './FilePreviewTabIcon'
import { projectMessageFileReferences } from './safe-markdown-model'

export const FILE_REFERENCE_FRAGMENT = '#rovai-file-reference='

export function FileReferenceLink({
  rawReference,
  children,
  className,
  onActivate
}: {
  rawReference: string
  children: ReactNode
  className: string
  onActivate(rawReference: string): void
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
        onActivate(rawReference)
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
  onActivate?(rawReference: string): void
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
