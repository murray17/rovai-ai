import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRunExecutionEvidenceView, AgentRunView } from '@contracts'
import {
  CompactionEventRow,
  ExecutionToolGroupStateContext,
  ToolActivityGroup,
  ToolCallRow,
  ToolOutputTruncationNotice,
  selectCompletePresentableExecutionEvidence
} from './ExecutionToolGroup'
import type { ToolProgressItem } from './execution-tool-grouping'
import type { ActivityIconKind } from './ui-model'
import { openAgentRunActivityFilePreview } from './agent-run-file-preview'

const tool = (id: string, iconKind: ActivityIconKind, status: ToolProgressItem['step']['status']): ToolProgressItem => ({
  kind: 'tool', key: `tool:${id}`, step: {
    id, iconKind, status, title: `指令 ${id}`, publicCommand: null, publicResult: null,
    detail: `指令 ${id} 结果`, activityDomain: 'shell', toolName: null, credibility: 'runtime_structured'
  }
})
const renderGroup = (items: ToolProgressItem[], expanded = false, liveTail = false,
  runStatus: AgentRunView['status'] = 'running', cancelling = false) => renderToStaticMarkup(
  <ExecutionToolGroupStateContext.Provider value={{
    expanded: new Set(expanded ? items.map(item => `run:${item.key}`) : []), change() {}
  }}>
    <ToolActivityGroup items={items} runId="run" runStatus={runStatus} campId="camp" liveTail={liveTail}
      cancelling={cancelling} completeEvidence={{ byToolId: new Map() }} onFileOpenError={() => {}} />
  </ExecutionToolGroupStateContext.Provider>
)

describe('command disclosure presentation', () => {
  it('states permanent Tool output loss without offering a full-result recovery path', () => {
    const markup = renderToStaticMarkup(<ToolOutputTruncationNotice visible />)
    expect(markup).toContain('结果过长，部分内容已省略。')
    expect(markup).not.toContain('读取完整结果')
    expect(renderToStaticMarkup(<ToolOutputTruncationNotice visible={false} />)).toBe('')
  })

  it('keeps bounded inline output addressable for the saved-result detail notice', () => {
    const evidence = {
      id: 'bounded-output', agentRunId: 'run', executionEpoch: 1, sequence: 1,
      eventType: 'activity.completed', kind: 'command', phase: 'completed', payload: {},
      contentBlobId: null, contentByteCount: 8_000, isTruncated: false,
      outputTruncated: true, occurredAt: '2026-09-22T00:00:00Z',
      canonical: {
        operationId: 'command-1', classifierVersion: 'activity-v4', activityDomain: 'shell',
        semanticKind: 'shell.execute', toolName: null, presentationHint: null, phase: 'terminal',
        outcome: 'succeeded', sourceAuthority: 'runtime', credibility: 'runtime_structured',
        coverageLevel: 'fine_grained', sourceEvidenceIds: ['bounded-output'],
        firstEvidenceSequence: 1, lastEvidenceSequence: 1, revision: 1
      }
    } satisfies AgentRunExecutionEvidenceView
    expect(selectCompletePresentableExecutionEvidence([evidence]).byToolId.get('command-1')?.id)
      .toBe('bounded-output')
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)(
    'gives the authoritative %s Run priority over a retained cancellation flag', runStatus => {
      const completed = renderGroup([tool('done', 'terminal', 'completed')], true, false, runStatus, true)
      const unfinished = renderGroup([tool('active', 'terminal', 'running')], true, false, runStatus, true)
      expect(completed).not.toContain('正在停止')
      expect(unfinished).not.toContain('等待执行结束')
      expect(completed).toContain('tool-call-state status-completed')
      if (runStatus === 'cancelled') expect(unfinished).toContain('tool-call-state status-stopped')
    }
  )
  it('still presents an in-flight stop before the Run becomes terminal', () => {
    expect(renderGroup([tool('active', 'terminal', 'running')], false, false, 'running', true))
      .toContain('正在停止：等待执行结束')
  })
  it('routes a non-truncated canonical Command Diff through its exact Run activity evidence', async () => {
    const evidence = {
      id: 'diff-evidence',
      agentRunId: 'direct-camp-run',
      executionEpoch: 1,
      sequence: 1,
      eventType: 'activity.completed',
      kind: 'file_change',
      phase: 'completed',
      payload: {},
      contentBlobId: null,
      contentByteCount: 512,
      isTruncated: false,
      occurredAt: '2026-09-19T00:00:00Z',
      canonical: {
        operationId: 'edit-mission',
        classifierVersion: 'activity-v4',
        activityDomain: 'file',
        semanticKind: 'file.write',
        toolName: 'apply_patch',
        presentationHint: null,
        phase: 'terminal',
        outcome: 'succeeded',
        sourceAuthority: 'runtime',
        credibility: 'runtime_structured',
        coverageLevel: 'fine_grained',
        sourceEvidenceIds: ['diff-evidence'],
        firstEvidenceSequence: 1,
        lastEvidenceSequence: 1,
        revision: 1,
        diffProjection: {
          schemaVersion: 1,
          source: 'runtime_reported',
          revision: 1,
          sourceEvidenceIds: ['diff-evidence'],
          status: 'available',
          semanticKind: 'unified_diff_snapshot',
          entries: [{
            path: 'crates/rovai-core/src/application/mission.rs',
            changeKind: 'update',
            additions: 1,
            deletions: 1,
            diff: '@@ -1 +1 @@\n-old\n+new\n'
          }]
        }
      }
    } satisfies AgentRunExecutionEvidenceView
    const selected = selectCompletePresentableExecutionEvidence([evidence])
    const open = vi.fn().mockResolvedValue({ kind: 'preview', tabId: 'mission-file' })

    await expect(openAgentRunActivityFilePreview({
      filePreview: { open },
      campId: 'mission-camp',
      evidence: selected.byToolId.get('edit-mission'),
      path: 'crates/rovai-core/src/application/mission.rs',
      onError: vi.fn()
    })).resolves.toBe(true)

    expect(open).toHaveBeenCalledWith({
      kind: 'run_activity_file',
      campId: 'mission-camp',
      agentRunId: 'direct-camp-run',
      executionEpoch: 1,
      evidenceId: 'diff-evidence',
      rawReference: 'crates/rovai-core/src/application/mission.rs'
    }, undefined, { fileName: 'crates/rovai-core/src/application/mission.rs' }, {
      commitOnSuccess: true,
      previewOnly: true
    })
  })

  it('keeps a non-truncated operation-only file Evidence available to its Command row', () => {
    const evidence = {
      id: 'write-evidence',
      agentRunId: 'direct-camp-run',
      executionEpoch: 1,
      sequence: 1,
      eventType: 'runtime.action',
      kind: 'tool_call',
      phase: 'completed',
      payload: {
        runtimeFileOperation: {
          schemaVersion: 2, status: 'available', operationKind: 'write',
          path: 'docs/versions/v1.69/proposal.md'
        }
      },
      contentBlobId: null,
      contentByteCount: 512,
      isTruncated: false,
      occurredAt: '2026-09-24T00:00:00Z',
      canonical: {
        operationId: 'write-proposal',
        classifierVersion: 'activity-v4',
        activityDomain: 'file',
        semanticKind: 'file.write',
        toolName: 'Write',
        presentationHint: null,
        phase: 'terminal',
        outcome: 'succeeded',
        sourceAuthority: 'runtime',
        credibility: 'runtime_structured',
        coverageLevel: 'fine_grained',
        sourceEvidenceIds: ['write-evidence'],
        firstEvidenceSequence: 1,
        lastEvidenceSequence: 1,
        revision: 1
      }
    } satisfies AgentRunExecutionEvidenceView
    const laterOutput = {
      ...evidence,
      id: 'write-output',
      sequence: 2,
      payload: {},
      isTruncated: true
    } satisfies AgentRunExecutionEvidenceView
    const selected = selectCompletePresentableExecutionEvidence([evidence, laterOutput])
    expect(selected.byToolId.get('write-proposal')).toBe(laterOutput)
    expect(selected.byFileOperationToolId.get('write-proposal')).toBe(evidence)
  })

  it.each(['terminal', 'file-read', 'file-write', 'web'] as ActivityIconKind[])(
    'selects the same %s instruction for both the current title and icon', icon => {
      const markup = renderGroup([tool('old', 'terminal', 'completed'), tool('current', icon, 'running'), tool('later', 'unknown', 'completed')])
      expect(markup).toContain(`data-icon-domain="${icon}"`)
      expect(markup).toContain('data-text="指令 current"')
      expect(markup).not.toContain('<strong>执行中</strong>')
      expect(markup).not.toContain('tool-group-disclosure')
      expect(markup).not.toContain('tool-group-items')
    }
  )
  it('stops the group highlight on expansion and keeps child commands and results static', () => {
    const markup = renderGroup([tool('current', 'web', 'running')], true)
    expect(markup).not.toContain('running-text-highlight')
    expect(markup).toContain('command-expand-cue')
    expect(markup).toContain('tool-call-state status-running')
    expect(markup).not.toContain('tool-call-disclosure-slot')
  })
  it('keeps waiting, failed and stopped states static, and restores the completed group icon/count', () => {
    for (const status of ['waiting', 'failed', 'stopped', 'recorded', 'skipped'] as const) {
      expect(renderGroup([tool('current', 'terminal', status)])).not.toContain('running-text-highlight')
    }
    const settled = renderGroup([tool('one', 'file-read', 'completed'), tool('two', 'web', 'completed')])
    expect(settled).toContain('已完成 2 个步骤')
    expect(settled).toContain('tool-group-icon')
    expect(settled).toContain('tool-group-disclosure')
    expect(settled).not.toContain('tool-group-state')
    const provisional = renderGroup([tool('one', 'file-read', 'completed')], false, true)
    expect(provisional).toContain('data-icon-domain="file-read"')
    expect(provisional).toContain('data-text="指令 one"')
  })
  it('omits expansion cues on commands without detail and retains independent read-file buttons', () => {
    const step = { ...tool('read', 'file-read', 'completed').step, detail: '',
      shellReadSummary: { title: '阅读 a.ts，b.ts', paths: ['src/a.ts', 'src/b.ts'], displayPaths: ['a.ts', 'b.ts'] } }
    const markup = renderToStaticMarkup(<ToolCallRow campId="camp" step={step} runId="run" runStatus="running" onFileOpenError={() => {}} />)
    expect(markup).not.toContain('command-expand-cue')
    expect(markup.match(/class="tool-file-link shell-read-file-link"/g)).toHaveLength(2)
    expect(markup).toContain('打开文件预览：src/a.ts')
  })
  it('highlights only an active Compact and never infers completion from a finished Run', () => {
    for (const runStatus of ['running', 'waiting', 'succeeded', 'failed', 'cancelled'] as const) {
      const markup = renderToStaticMarkup(<CompactionEventRow campId="camp" runId="run" runStatus={runStatus}
        compaction={{ id: 'compact', phase: 'started', completionEvidence: null, adapterKind: 'codex-cli', tokens: {}, messages: {}, summaryText: null }} />)
      expect(markup.includes('running-text-highlight')).toBe(runStatus === 'running')
      expect(markup).not.toContain('status-completed')
      expect(markup).not.toContain('command-expand-cue')
      expect(markup).toContain('data-icon-domain="compaction"')
    }
  })
})
