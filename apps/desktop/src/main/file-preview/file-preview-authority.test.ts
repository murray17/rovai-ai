import { describe, expect, it } from 'vitest'
import { parseCoreFilePreviewAuthorityResult } from './file-preview-authority'

describe('parseCoreFilePreviewAuthorityResult', () => {
  it('accepts a matching authority receipt', () => {
    const request = {
      kind: 'camp_workspace' as const,
      campId: 'camp-1',
      rawReference: 'docs/guide.md'
    }
    expect(parseCoreFilePreviewAuthorityResult({
      kind: 'file_target',
      campId: 'camp-1',
      sourceKind: 'camp_workspace',
      sourceIdentity: 'camp:camp-1',
      rootPath: '/repo',
      basePath: '/repo',
      rawReference: 'docs/guide.md',
      allowChildren: true
    }, request)).toMatchObject({ kind: 'file_target', rootPath: '/repo' })
  })

  it('fails closed when the receipt changes source identity or request data', () => {
    const request = {
      kind: 'message_reference' as const,
      campId: 'camp-1',
      messageId: 'message-1',
      rawReference: './secret.txt'
    }
    expect(parseCoreFilePreviewAuthorityResult({
      kind: 'file_target',
      campId: 'camp-2',
      sourceKind: 'message_reference',
      sourceIdentity: 'message:other',
      rootPath: '/repo',
      basePath: '/repo',
      rawReference: './secret.txt',
      allowChildren: true
    }, request)).toBeNull()
  })
})
