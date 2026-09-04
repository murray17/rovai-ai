import { describe, expect, it } from 'vitest'
import {
  attachmentBaseName,
  attachmentExtension,
  attachmentFormatLabel,
  classifyAttachmentDisplay
} from './attachment-presentation'

const classify = (
  displayName: string,
  mediaType = 'application/octet-stream',
  previewKind: 'image' | 'none' = 'none',
  kind: 'file' | 'directory' = 'file'
) => classifyAttachmentDisplay({ displayName, mediaType, previewKind, kind })

describe('attachment presentation classification', () => {
  it('normalizes the leaf extension without losing dotted names', () => {
    expect(attachmentExtension('folder/Release.NOTES.MD')).toBe('md')
    expect(attachmentBaseName('Release.NOTES.MD', 'file')).toBe('Release.NOTES')
    expect(attachmentFormatLabel('Release.NOTES.MD', 'file')).toBe('MD')
    expect(attachmentExtension('.env')).toBe('')
    expect(attachmentFormatLabel('.env', 'file')).toBe('FILE')
  })

  it.each([
    ['index.html', 'text/html', 'code', 'web'],
    ['worker.ts', 'text/typescript', 'code', 'code'],
    ['notes.md', 'text/markdown', 'document', 'notes'],
    ['brief.pdf', 'application/pdf', 'document', 'pdf'],
    ['copy.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 'word'],
    ['matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document', 'sheet'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document', 'slide'],
    ['bundle.zip', 'application/zip', 'folder', 'archive'],
    ['opaque.asset', 'application/octet-stream', 'document', 'generic']
  ] as const)('classifies %s for the user and Agent visual systems', (
    displayName,
    mediaType,
    userDisplayType,
    agentDisplayType
  ) => {
    expect(classify(displayName, mediaType)).toEqual({ userDisplayType, agentDisplayType })
  })

  it('puts previewable images in image regions but keeps unpreviewable images as typed files', () => {
    expect(classify('preview.png', 'image/png', 'image')).toEqual({
      userDisplayType: 'image',
      agentDisplayType: 'image'
    })
    expect(classify('corrupt.png', 'image/png', 'none')).toEqual({
      userDisplayType: 'document',
      agentDisplayType: 'image'
    })
  })

  it('uses folder/archive presentation for directory snapshots', () => {
    expect(classify('design-export', 'inode/directory', 'none', 'directory')).toEqual({
      userDisplayType: 'folder',
      agentDisplayType: 'archive'
    })
    expect(attachmentBaseName('design-export', 'directory')).toBe('design-export')
    expect(attachmentFormatLabel('design-export', 'directory')).toBe('DIR')
  })
})
