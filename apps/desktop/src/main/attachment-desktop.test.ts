import { describe, expect, it } from 'vitest'
import {
  attachmentOpenResultFromNativeError,
  isAttachmentId,
  openDesktopAttachmentTarget,
  revealDesktopAttachmentTarget,
  parseDesktopAttachmentTarget
} from './attachment-desktop'

const ATTACHMENT_ID = '8b85752a-76a5-4b9d-92d8-a70b6285a0d0'

describe('Desktop Attachment target boundary', () => {
  it('accepts only a matching, absolute, closed-shape Core target', () => {
    const target = {
      attachmentId: ATTACHMENT_ID,
      displayName: '计划.md',
      kind: 'file' as const,
      mediaType: 'text/plain; charset=utf-8',
      path: '/private/var/folders/managed/计划.md',
      openRisk: 'normal' as const
    }
    expect(parseDesktopAttachmentTarget(target, ATTACHMENT_ID)).toEqual(target)
    expect(parseDesktopAttachmentTarget({ ...target, attachmentId: 'other' }, ATTACHMENT_ID)).toBeNull()
    expect(parseDesktopAttachmentTarget({ ...target, path: '../计划.md' }, ATTACHMENT_ID)).toBeNull()
    expect(parseDesktopAttachmentTarget({ ...target, openRisk: 'unknown' }, ATTACHMENT_ID)).toBeNull()
    expect(parseDesktopAttachmentTarget({ ...target, kind: 'symlink' }, ATTACHMENT_ID)).toBeNull()
    expect(parseDesktopAttachmentTarget({ ...target, authorityRoot: '/private/secret' }, ATTACHMENT_ID)).toBeNull()
    expect(parseDesktopAttachmentTarget({ ...target, displayName: '😀'.repeat(120) }, ATTACHMENT_ID)).not.toBeNull()
    expect(parseDesktopAttachmentTarget({ ...target, displayName: '😀'.repeat(121) }, ATTACHMENT_ID)).toBeNull()
  })

  it('rejects malformed Attachment IPC identities', () => {
    expect(isAttachmentId(ATTACHMENT_ID)).toBe(true)
    expect(isAttachmentId('../secret')).toBe(false)
    expect(isAttachmentId('attachment with spaces')).toBe(false)
    expect(isAttachmentId('')).toBe(false)
  })

  it('does not expose a native Shell error that contains an Authority path', () => {
    expect(attachmentOpenResultFromNativeError(
      'Failed to open /Users/example/Library/Application Support/Rovai/camp-attachments/secret.txt'
    )).toEqual({ opened: false, error: 'open_failed' })
    expect(attachmentOpenResultFromNativeError('')).toEqual({ opened: true, error: null })
  })

  it('does not invoke the native Shell when a risky target is cancelled', async () => {
    let openedPath: string | null = null
    const result = await openDesktopAttachmentTarget({
      attachmentId: ATTACHMENT_ID,
      displayName: 'setup.pkg',
      kind: 'file',
      mediaType: 'application/vnd.apple.installer+xml',
      path: '/private/managed/setup.pkg',
      openRisk: 'confirm'
    }, {
      async confirm() {
        return false
      },
      async openPath(path) {
        openedPath = path
        return ''
      }
    })
    expect(result).toEqual({ opened: false, error: null })
    expect(openedPath).toBeNull()
  })

  it('maps native open and reveal failures to path-free stable codes', async () => {
    const target = {
      attachmentId: ATTACHMENT_ID,
      displayName: '计划.md',
      kind: 'file' as const,
      mediaType: 'text/plain',
      path: '/private/managed/计划.md',
      openRisk: 'normal' as const
    }
    await expect(openDesktopAttachmentTarget(target, {
      async confirm() {
        return true
      },
      async openPath() {
        throw new Error(`cannot open ${target.path}`)
      }
    })).resolves.toEqual({ opened: false, error: 'open_failed' })
    expect(revealDesktopAttachmentTarget(target, () => {
      throw new Error(`cannot reveal ${target.path}`)
    })).toEqual({ revealed: false, error: 'reveal_failed' })
  })
})
