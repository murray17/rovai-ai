import type { AgentRunFileChangesView } from '@contracts'
import { describe, expect, it, vi } from 'vitest'
import { openAgentRunCurrentFilePreview } from './agent-run-file-preview'
import { agentRunFileChangesPreviewTarget } from './file-changes-presentation'

const changes = {
  schemaVersion: 2,
  agentRunId: 'run-files',
  executionEpoch: 3,
  files: [{
    evidenceFileId: 'operation-only',
    path: 'src/path-only.ts',
    changeKind: 'update',
    presentationKind: 'operation_only',
    operationCount: 1
  }, {
    evidenceFileId: 'reviewable',
    path: 'src/reviewable.ts',
    changeKind: 'update',
    presentationKind: 'full_net_diff',
    operationCount: 1,
    additions: 1,
    deletions: 1
  }],
  fileCount: 2,
  operationCount: 2,
  completedAt: '2026-09-07T00:00:00Z'
} satisfies AgentRunFileChangesView

describe('AgentRun file preview routing', () => {
  it('prefers reviewable evidence for a generic DiffCard preview', () => {
    expect(agentRunFileChangesPreviewTarget(changes)).toEqual({
      kind: 'review',
      file: changes.files[1]
    })
  })

  it('routes an explicit operation-only file to its current file', () => {
    expect(agentRunFileChangesPreviewTarget(changes, 'operation-only')).toEqual({
      kind: 'current',
      file: changes.files[0]
    })
  })

  it('uses the first current file when the card has no reviewable evidence', () => {
    const operationOnly = { ...changes, files: [changes.files[0]], fileCount: 1, operationCount: 1 }
    expect(agentRunFileChangesPreviewTarget(operationOnly)).toEqual({
      kind: 'current',
      file: operationOnly.files[0]
    })
  })

  it('opens the current file through the run-evidence preview-only path', async () => {
    const open = vi.fn().mockResolvedValue({ kind: 'preview', tabId: 'current-file' })
    const onError = vi.fn()

    await expect(openAgentRunCurrentFilePreview({
      filePreview: { open },
      campId: 'camp-1',
      changes,
      evidenceFileId: 'operation-only',
      onError
    })).resolves.toBe(true)

    expect(open).toHaveBeenCalledWith({
      kind: 'run_evidence',
      campId: 'camp-1',
      agentRunId: 'run-files',
      executionEpoch: 3,
      evidenceFileId: 'operation-only',
      action: 'open_current'
    }, undefined, { fileName: 'src/path-only.ts' }, { commitOnSuccess: true, previewOnly: true })
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'missing preview context', filePreview: null },
    { name: 'non-preview result', filePreview: { open: vi.fn().mockResolvedValue({ kind: 'system' }) } },
    { name: 'rejected open', filePreview: { open: vi.fn().mockRejectedValue(new Error('private host failure')) } }
  ])('keeps failures on the current page for $name', async ({ filePreview }) => {
    const onError = vi.fn()
    await expect(openAgentRunCurrentFilePreview({
      filePreview,
      campId: 'camp-1',
      changes,
      evidenceFileId: 'operation-only',
      onError
    })).resolves.toBe(false)
    expect(onError).toHaveBeenCalledWith('无法打开该文件')
  })
})
