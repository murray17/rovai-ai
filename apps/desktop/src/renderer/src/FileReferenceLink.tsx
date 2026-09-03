import { useMemo, useRef, type JSX, type ReactNode } from 'react'
import type { FileLocationTarget } from '@contracts'
import { parseFileReference } from '../../file-preview-reference'
import { FileReferenceIcon } from './FilePreviewTabIcon'
import { projectMessageFileReferences, projectMessageInlineCodes } from './safe-markdown-model'

export const FILE_REFERENCE_FRAGMENT = '#rovai-file-reference='
export type FileReferenceActivation = (rawReference: string, source: HTMLElement, target?: FileLocationTarget) => void

export function FileReferenceLink({
  rawReference,
  children,
  className,
  onActivate
}: {
  rawReference: string
  children: ReactNode
  className: string
  onActivate: FileReferenceActivation
}): JSX.Element {
  const selectionAtPointerDown = useRef<Range | null>(null)
  const parsedReference = parseFileReference(rawReference)

  return (
    <a
      className={className}
      href={`${FILE_REFERENCE_FRAGMENT}${encodeURIComponent(rawReference)}`}
      title={parsedReference?.pathKind === 'relative' ? rawReference : undefined}
      onPointerDown={() => {
        const selection = window.getSelection()
        selectionAtPointerDown.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
      }}
      onPointerCancel={() => { selectionAtPointerDown.current = null }}
      onClick={(event) => {
        event.preventDefault()
        const before = selectionAtPointerDown.current
        selectionAtPointerDown.current = null
        const selection = window.getSelection()
        if (event.detail > 0 && selection?.rangeCount && selection.toString()) {
          const range = selection.getRangeAt(0)
          // An existing selection must not disable links; only suppress this gesture's new selection.
          if (!before
            || range.compareBoundaryPoints(Range.START_TO_START, before) !== 0
            || range.compareBoundaryPoints(Range.END_TO_END, before) !== 0) return
        }
        onActivate(rawReference, event.currentTarget)
      }}
      onAuxClick={(event) => event.preventDefault()}
    >
      <FileReferenceIcon rawReference={rawReference} />
      <span className="file-reference-label">{children}</span>
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
  const references = useMemo(
    () => enabled ? projectMessageFileReferences(text) : [],
    [enabled, text]
  )
  const inlineCodes = useMemo(() => enabled ? projectMessageInlineCodes(text) : [], [enabled, text])
  if (!onActivate || (references.length === 0 && inlineCodes.length === 0)) return <>{text}</>
  const parts = [
    ...references.map((reference) => ({ kind: 'reference' as const, ...reference })),
    ...inlineCodes
      .filter((inlineCode) => !references.some((reference) => (
        inlineCode.start < reference.end && inlineCode.end > reference.start
      )))
      .map((inlineCode) => ({ kind: 'code' as const, ...inlineCode }))
  ].sort((left, right) => left.start - right.start)
  const output: ReactNode[] = []
  let offset = 0
  for (const part of parts) {
    if (part.start > offset) output.push(text.slice(offset, part.start))
    if (part.kind === 'code') {
      output.push(<code key={`code-${part.start}`}>{part.value}</code>)
      offset = part.end
      continue
    }
    output.push(
      <FileReferenceLink
        className="message-file-reference"
        rawReference={part.rawReference}
        key={`${part.start}:${part.rawReference}`}
        onActivate={onActivate}
      >
        {part.label}
      </FileReferenceLink>
    )
    offset = part.end
  }
  if (offset < text.length) output.push(text.slice(offset))
  return <>{output}</>
}
