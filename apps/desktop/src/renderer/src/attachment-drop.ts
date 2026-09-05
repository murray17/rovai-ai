export type AttachmentKind = 'file' | 'directory'
export type AttachmentDragKind = 'files' | 'directory'
export type AttachmentPreparationInput = { file: File; kindHint: AttachmentKind }

export function dataTransferContainsFiles(
  dataTransfer: Pick<DataTransfer, 'types'>
): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

export function attachmentDragKind(
  dataTransfer: Pick<DataTransfer, 'items' | 'types'>
): AttachmentDragKind | null {
  if (!dataTransferContainsFiles(dataTransfer)) return null
  const fileItems = Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
  if (fileItems.length !== 1) return 'files'
  const entry = fileItems[0].webkitGetAsEntry?.()
  return entry?.isDirectory ? 'directory' : 'files'
}

export function droppedAttachmentInputs(
  dataTransfer: Pick<DataTransfer, 'files' | 'items'>
): AttachmentPreparationInput[] {
  const fromItems = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .flatMap((item) => {
      const file = item.getAsFile()
      if (!file) return []
      return [{
        file,
        kindHint: item.webkitGetAsEntry?.()?.isDirectory ? 'directory' : 'file'
      } satisfies AttachmentPreparationInput]
    })
  if (fromItems.length > 0) return fromItems
  return Array.from(dataTransfer.files).map((file) => ({ file, kindHint: 'file' }))
}
