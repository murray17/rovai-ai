import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadMessageAttachmentView, LocalAttachmentOwnerLocator } from '@contracts'
import { AttachmentCard } from './AttachmentCard'
import { ThreadClientProvider, type ThreadClient } from './camp-client'

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

  it.each(composerLocators)('keeps a loading image focusable without falling back to a file action in the %s', (_name, locator) => {
    const imageAttachment: ThreadMessageAttachmentView = {
      ...fileAttachment,
      id: 'attachment-image',
      displayName: 'diagram.png',
      mediaType: 'image/png',
      previewKind: 'image'
    }
    const markup = renderToStaticMarkup(createElement(AttachmentCard, {
      attachment: imageAttachment,
      locator: { ...locator, attachmentRefId: imageAttachment.id },
      presentation: 'composer'
    }))

    expect(markup).toMatch(/<button class="attachment-open(?: [^"]*)?"/)
    expect(markup).toContain('aria-label="预览附件 diagram.png"')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).not.toContain('attachment-context-anchor')
  })
})

describe('AttachmentCard Web download', () => {
  const locator: LocalAttachmentOwnerLocator = { owner: 'message', threadId: 'camp-1', messageId: 'message-1', attachmentRefId: fileAttachment.id }
  const render = (kind: 'download' | 'native', attachment: ThreadMessageAttachmentView = fileAttachment) => {
    const client = { platform: 'linux', attachments: kind === 'download' ? { kind, download: vi.fn() } : { kind, open: vi.fn(), reveal: vi.fn() } } as unknown as ThreadClient
    return renderToStaticMarkup(createElement(
      ThreadClientProvider,
      { client, children: createElement(AttachmentCard, { attachment, locator, presentation: 'agent-timeline' }) }
    ))
  }

  it('shows a download button beside the open control in the Web timeline', () => {
    const markup = render('download')
    expect(markup).toContain('class="attachment-download"')
    expect(markup).toContain('aria-label="下载文件 report.md"')
    expect(markup.indexOf('attachment-open')).toBeLessThan(markup.indexOf('attachment-download'))
  })

  it('does not add a second download button in Desktop or for directories', () => {
    expect(render('native')).not.toContain('attachment-download')
    expect(render('download', { ...fileAttachment, kind: 'directory', mediaType: 'inode/directory' })).not.toContain('attachment-download')
  })
})
