import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CampMessageAttachmentView, LocalAttachmentOwnerLocator } from '@contracts'
import { AttachmentCard } from './AttachmentCard'

vi.mock('./FilePreviewContext', () => ({
  useOptionalFilePreview: () => ({ open: vi.fn() })
}))

const fileAttachment: CampMessageAttachmentView = {
  id: 'attachment-1',
  displayName: 'report.md',
  kind: 'file',
  fileCount: 1,
  mediaType: 'text/markdown',
  byteSize: 128,
  previewKind: 'none',
  availability: 'available'
}

const composerLocators: Array<[string, LocalAttachmentOwnerLocator]> = [[
  'Camp composer',
  { owner: 'composer', campId: 'camp-1', attachmentRefId: fileAttachment.id }
], [
  'single-chat composer',
  {
    owner: 'single_chat_composer',
    campId: 'camp-1',
    conversationId: 'conversation-1',
    attachmentRefId: fileAttachment.id
  }
]]

describe('AttachmentCard composer actions', () => {
  it.each(composerLocators)('exposes a preview button in the %s without adding a context menu', (_name, locator) => {
    const markup = renderToStaticMarkup(createElement(AttachmentCard, {
      attachment: fileAttachment,
      locator,
      presentation: 'composer'
    }))

    expect(markup).toMatch(/<button class="attachment-open(?: [^"]*)?"/)
    expect(markup).toContain('aria-label="打开文件预览 report.md"')
    expect(markup).not.toContain('attachment-context-anchor')
  })

  it('exposes a primary open button for a composer directory', () => {
    const directoryAttachment: CampMessageAttachmentView = {
      ...fileAttachment,
      id: 'attachment-directory',
      displayName: 'research',
      kind: 'directory',
      fileCount: 3,
      mediaType: 'inode/directory'
    }
    const markup = renderToStaticMarkup(createElement(AttachmentCard, {
      attachment: directoryAttachment,
      locator: {
        owner: 'composer',
        campId: 'camp-1',
        attachmentRefId: directoryAttachment.id
      },
      presentation: 'composer'
    }))

    expect(markup).toMatch(/<button class="attachment-open(?: [^"]*)?"/)
    expect(markup).toContain('aria-label="打开文件夹 research"')
    expect(markup).not.toContain('attachment-context-anchor')
  })

  it('keeps a composer image non-interactive until its thumbnail is ready', () => {
    const imageAttachment: CampMessageAttachmentView = {
      ...fileAttachment,
      id: 'attachment-image',
      displayName: 'diagram.png',
      mediaType: 'image/png',
      previewKind: 'image'
    }
    const markup = renderToStaticMarkup(createElement(AttachmentCard, {
      attachment: imageAttachment,
      locator: {
        owner: 'composer',
        campId: 'camp-1',
        attachmentRefId: imageAttachment.id
      },
      presentation: 'composer'
    }))

    expect(markup).toContain('<div class="attachment-open">')
    expect(markup).not.toMatch(/<button class="attachment-open(?: [^"]*)?"/)
  })
})
