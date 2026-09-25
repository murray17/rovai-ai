import type { AgentRunFileChangesView } from '@contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  openAgentRunActivityFilePreview,
  openAgentRunCurrentFilePreview
} from './agent-run-file-preview'
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

  it('opens a Command file through its exact Run activity evidence', async () => {
    const open = vi.fn().mockResolvedValue({ kind: 'preview', tabId: 'activity-file' })
    const onError = vi.fn()

    await expect(openAgentRunActivityFilePreview({
      filePreview: { open },
      campId: 'camp-1',
      evidence: {
        agentRunId: 'run-mission',
        executionEpoch: 4,
        canonical: { diffProjection: { sourceEvidenceIds: ['diff-evidence-7'] } }
      },
      path: 'src/generated.ts',
      onError
    })).resolves.toBe(true)

    expect(open).toHaveBeenCalledWith({
      kind: 'run_activity_file',
      campId: 'camp-1',
      agentRunId: 'run-mission',
      executionEpoch: 4,
      evidenceId: 'diff-evidence-7',
      rawReference: 'src/generated.ts'
    }, undefined, { fileName: 'src/generated.ts' }, { commitOnSuccess: true, previewOnly: true })
    expect(onError).not.toHaveBeenCalled()
  })

  it.each(['read', 'write'] as const)(
    'opens an operation-only %s from its exact Run evidence',
    async (operationKind) => {
      const open = vi.fn().mockResolvedValue({ kind: 'preview', tabId: 'operation-file' })
      const onError = vi.fn()
      const evidence = {
        id: `operation-${operationKind}`,
        agentRunId: 'run-mission',
        executionEpoch: 4,
        phase: 'completed' as const,
        payload: {
          runtimeFileOperation: {
            schemaVersion: 2,
            status: 'available',
            operationKind,
            path: 'src/operation-only.ts'
          }
        }
      }

      await expect(openAgentRunActivityFilePreview({
        filePreview: { open },
        campId: 'camp-1',
        evidence,
        path: 'src/operation-only.ts',
        onError
      })).resolves.toBe(true)
      expect(open).toHaveBeenCalledWith({
        kind: 'run_activity_file',
        campId: 'camp-1',
        agentRunId: 'run-mission',
        executionEpoch: 4,
        evidenceId: evidence.id,
        rawReference: 'src/operation-only.ts'
      }, undefined, { fileName: 'src/operation-only.ts' }, {
        commitOnSuccess: true,
        previewOnly: true
      })
      expect(onError).not.toHaveBeenCalled()

      open.mockClear()
      await expect(openAgentRunActivityFilePreview({
        filePreview: { open },
        campId: 'camp-1',
        evidence,
        path: 'src/other.ts',
        onError
      })).resolves.toBe(false)
      expect(open).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith('无法打开该文件')
    }
  )

  it('keeps the Camp workspace fallback for legacy Command rows without evidence identity', async () => {
    const open = vi.fn().mockResolvedValue({ kind: 'preview', tabId: 'legacy-file' })
    await expect(openAgentRunActivityFilePreview({
      filePreview: { open },
      campId: 'camp-1',
      evidence: {
        agentRunId: 'run-legacy',
        executionEpoch: 1,
        canonical: null
      },
      path: 'src/legacy.ts',
      allowLegacyWorkspaceFallback: true,
      onError: vi.fn()
    })).resolves.toBe(true)
    expect(open).toHaveBeenCalledWith({
      kind: 'camp_workspace',
      campId: 'camp-1',
      rawReference: 'src/legacy.ts'
    }, undefined, { fileName: 'src/legacy.ts' }, { commitOnSuccess: true, previewOnly: true })
  })

  it('does not fall back to a same-named Camp file when a typed operation lacks Evidence', async () => {
    const open = vi.fn()
    const onError = vi.fn()
    await expect(openAgentRunActivityFilePreview({
      filePreview: { open },
      campId: 'mission-camp',
      path: 'src/worktree-only.ts',
      onError
    })).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('无法打开该文件')
  })

  it('does not downgrade a malformed canonical diff to the Camp workspace', async () => {
    const open = vi.fn()
    const onError = vi.fn()
    await expect(openAgentRunActivityFilePreview({
      filePreview: { open },
      campId: 'camp-1',
      evidence: {
        agentRunId: 'run-mission',
        executionEpoch: 4,
        canonical: { diffProjection: { sourceEvidenceIds: [] } }
      },
      path: 'src/generated.ts',
      onError
    })).resolves.toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('无法打开该文件')
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
