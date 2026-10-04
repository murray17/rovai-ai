import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadMessageAttachmentView, LocalAttachmentOwnerLocator } from '@contracts'
import { AttachmentCard } from './AttachmentCard'

vi.mock('./FilePreviewContext', () => ({
  useOptionalFilePreview: () => ({ open: vi.fn() })
}))

const fileAttachment: ThreadMessageAttachmentView = {
  id: 'attachment-1',
  displayName: 'report.md',
  kind: 'file',
  fileCount: 1,
  mediaType: 'text/markdown',
  byteSize: 128,
  previewKind: 'none',
  availability: 'available'
}

const composerLocators: Array<[string, LocalAttachmentOwnerLocator, boolean]> = [[
  'Thread composer',
  { owner: 'composer', threadId: 'camp-1', attachmentRefId: fileAttachment.id },
  true
], [
  'single-chat composer',
  {
    owner: 'single_chat_composer',
    threadId: 'camp-1',
    conversationId: 'conversation-1',
    attachmentRefId: fileAttachment.id
  },
  false
]]

describe('AttachmentCard composer actions', () => {
  it.each(composerLocators)('exposes preview and applicable context actions in the %s', (_name, locator, hasContextMenu) => {
    const markup = renderToStaticMarkup(createElement(AttachmentCard, {
      attachment: fileAttachment,
      locator,
      presentation: 'composer'
    }))

    expect(markup).toMatch(/<button class="attachment-open(?: [^"]*)?"/)
    expect(markup).toContain('aria-label="打开文件预览 report.md"')
    expect(markup.includes('attachment-context-anchor')).toBe(hasContextMenu)
  })

  it('exposes a primary open button for a composer directory', () => {
    const directoryAttachment: ThreadMessageAttachmentView = {
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
        threadId: 'camp-1',
        attachmentRefId: directoryAttachment.id
      },
      presentation: 'composer'
    }))

    expect(markup).toMatch(/<button class="attachment-open(?: [^"]*)?"/)
    expect(markup).toContain('aria-label="打开文件夹 research"')
    expect(markup).toContain('attachment-context-anchor')
  })

  it('keeps a composer image openable while its thumbnail is loading', () => {
    const imageAttachment: ThreadMessageAttachmentView = {
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
        threadId: 'camp-1',
        attachmentRefId: imageAttachment.id
      },
      presentation: 'composer'
    }))

    expect(markup).toMatch(/<button class="attachment-open(?: [^"]*)?"/)
    expect(markup).toContain('aria-label="打开文件预览 diagram.png"')
    expect(markup).toContain('attachment-context-anchor')
  })
})
