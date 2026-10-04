import { describe, expect, it } from 'vitest'
import { parseCoreFilePreviewAuthorityResult } from './file-preview-authority'

describe('parseCoreFilePreviewAuthorityResult', () => {
  it('accepts a matching authority receipt', () => {
    const request = {
      kind: 'camp_workspace' as const,
      threadId: 'camp-1',
      rawReference: 'docs/guide.md'
    }
    expect(parseCoreFilePreviewAuthorityResult({
      kind: 'file_target',
      threadId: 'camp-1',
      sourceKind: 'camp_workspace',
      sourceIdentity: 'thread:camp-1',
      rootPath: '/repo',
      basePath: '/repo',
      rawReference: 'docs/guide.md',
      allowChildren: true
    }, request)).toMatchObject({ kind: 'file_target', rootPath: '/repo' })
  })

  it('fails closed when the receipt changes source identity or request data', () => {
    const request = {
      kind: 'message_reference' as const,
      threadId: 'camp-1',
      messageId: 'message-1',
      rawReference: './secret.txt'
    }
    expect(parseCoreFilePreviewAuthorityResult({
      kind: 'file_target',
      threadId: 'camp-2',
      sourceKind: 'message_reference',
      sourceIdentity: 'message:other',
      rootPath: '/repo',
      basePath: '/repo',
      rawReference: './secret.txt',
      allowChildren: true
    }, request)).toBeNull()
  })

  it('accepts only the exact path returned for a Run activity file', () => {
    const request = {
      kind: 'run_activity_file' as const,
      threadId: 'camp-1',
      agentRunId: 'run-1',
      executionEpoch: 2,
      evidenceId: 'evidence-1',
      rawReference: 'src/generated.ts'
    }
    const receipt = {
      kind: 'file_target',
      threadId: 'camp-1',
      sourceKind: 'run_activity_file',
      sourceIdentity: 'run-activity-file:run-1:2:evidence-1',
      rootPath: '/mission-worktree',
      basePath: '/mission-worktree',
      rawReference: 'src/generated.ts',
      allowChildren: true
    }
    expect(parseCoreFilePreviewAuthorityResult(receipt, request)).toMatchObject({
      kind: 'file_target',
      rootPath: '/mission-worktree',
      rawReference: 'src/generated.ts'
    })
    expect(parseCoreFilePreviewAuthorityResult({
      ...receipt,
      rawReference: 'src/other.ts'
    }, request)).toBeNull()
  })
})
