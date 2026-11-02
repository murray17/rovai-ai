import { describe, expect, it } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import { groupExecutionEventsByRunId } from './execution-events'
import { buildLiveExecutionProgress, liveRuntimeEventFromExecutionEvidence, liveRuntimeEventFromCore } from './ui-model'
import { groupConsecutiveToolItems, toolActivityGroupPresentation } from './execution-tool-grouping'

const narration = (revision: number, text: string, status = 'streaming'): AgentRunExecutionEvidenceView => ({
  id: 'text', agentRunId: 'run', executionEpoch: 1, sequence: 1, operationId: null,
  revision, changeSequence: revision, eventType: 'agent.text.block', kind: 'narration', phase: 'updated',
  payload: { blockId: 'text', status, text, textLength: text.length },
  contentBlobId: null, contentByteCount: text.length, isTruncated: false, occurredAt: '2026-10-11T00:00:00Z'
})

describe('restored and live execution progress', () => {
  it('flattens scoped parent and child calls in first-recorded order across result updates and history', () => {
    const tool = (id: string, sequence: number, name: string): AgentRunExecutionEvidenceView => ({
      ...narration(1, ''), id, sequence, kind: 'tool_call', eventType: 'runtime.action', phase: 'started',
      occurredAt: `2026-10-11T00:00:0${4 - sequence}Z`,
      canonical: { operationId: id, classifierVersion: 'activity-v5', activityDomain: 'tool',
        semanticKind: name === 'Agent' ? 'tool.agent' : 'tool.call', toolName: name, presentationHint: name,
        phase: 'started', outcome: 'unknown', sourceAuthority: 'runtime', credibility: 'runtime_structured',
        coverageLevel: 'fine_grained', sourceEvidenceIds: [id], firstEvidenceSequence: sequence,
        lastEvidenceSequence: sequence, revision: 1 },
      payload: { toolCallId: 'same-native-id', toolName: name, status: 'in_progress', input: '{"prompt":"Read fixture"}' }
    })
    const launch = tool('root-call', 1, 'Agent')
    const child = tool('child-call', 2, 'Read')
    const later = tool('later-root-call', 3, 'Bash')
    const complete: AgentRunExecutionEvidenceView = { ...launch, revision: 2, changeSequence: 9, phase: 'completed',
      canonical: { ...launch.canonical!, phase: 'terminal', outcome: 'succeeded', revision: 2 },
      payload: { ...launch.payload as object, status: 'completed', output: 'CHILD_REPORT' } }
    const live = liveRuntimeEventFromCore({ method: 'runtime.action', params: {
      agentRunId: 'run', evidenceId: complete.id, sequence: complete.sequence, revision: complete.revision,
      changeSequence: complete.changeSequence, occurredAt: complete.occurredAt, payload: complete.payload, canonical: complete.canonical
    } }, 'notification', '2030-01-01T00:00:00Z')!
    const events = groupExecutionEventsByRunId([{ id: 'run' }], [later, child, launch], [live]).get('run')!
    expect(events.map(event => event.id)).toEqual(['root-call', 'child-call', 'later-root-call'])
    const progress = buildLiveExecutionProgress(events, 'run')
    const groups = groupConsecutiveToolItems(progress.items)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ kind: 'toolGroup', items: [
      { step: { id: 'root-call', status: 'completed', iconKind: 'agent', detail: '{"prompt":"Read fixture"}\nCHILD_REPORT' } },
      { step: { id: 'child-call', status: 'running' } },
      { step: { id: 'later-root-call', status: 'running' } }
    ] })
    const history = groupExecutionEventsByRunId([{ id: 'run' }], [complete, child, later], []).get('run')!
    expect(buildLiveExecutionProgress(history, 'run').items).toEqual(progress.items)
    const unsequenced = { ...live, id: 'legacy', sequence: null, canonical: null, createdAt: '2026-10-11T00:00:02Z' }
    const mixed = groupExecutionEventsByRunId([{ id: 'run' }], [later, child, launch], [live, unsequenced]).get('run')!
    expect(mixed.filter(event => event.id !== 'legacy').map(event => event.id)).toEqual(['root-call', 'child-call', 'later-root-call'])

  })
  it('keeps Steer outside command folds while receipts and preceding commands finish in place', () => {
    const command = (id: string, phase: 'started' | 'completed'): AgentRunExecutionEvidenceView => ({
      ...narration(1, ''), id, eventType: `activity.${phase}`, kind: 'command', phase,
      payload: { item: { id, type: 'commandExecution', command: 'pwd', status: phase === 'started' ? 'inProgress' : 'completed' } }
    })
    const input: AgentRunExecutionEvidenceView = { ...narration(1, ''), id: 'input', kind: 'step',
      eventType: 'agent_run.input', payload: { messageId: 'message', deliveryId: 'delivery',
        status: 'pending', preview: '采用这条更正', sourceAvailable: true } }
    const page = [command('before', 'started'), input, command('after', 'completed')]
    const live = [{ ...input, revision: 2, changeSequence: 5, payload: { ...input.payload as object, status: 'accepted' } },
      { ...command('before', 'completed'), revision: 2, changeSequence: 6 }]
    const events = groupExecutionEventsByRunId([{ id: 'run' }], page, live.map(liveRuntimeEventFromExecutionEvidence)).get('run')!
    const grouped = groupConsecutiveToolItems(buildLiveExecutionProgress(events, 'run').items)
    expect(grouped.map(item => item.kind)).toEqual(['toolGroup', 'input', 'toolGroup'])
    expect(grouped[1]).toMatchObject({ key: 'input:input', input: { status: 'accepted', messageId: 'message' } })
    for (const group of grouped) {
      if (group.kind === 'toolGroup') expect(toolActivityGroupPresentation(group.items, 'succeeded').primary).toBe('已完成 1 个步骤')
    }
    expect(buildLiveExecutionProgress([liveRuntimeEventFromExecutionEvidence({ ...input, payload: {} })], 'run').items).toEqual([])
  })

  it('keeps newer live narration across a late initial page, including uncheckpointed streaming growth', () => {
    for (const revision of [1, 2]) {
      const events = groupExecutionEventsByRunId([{ id: 'run' }], [narration(1, 'old')], [
        liveRuntimeEventFromExecutionEvidence(narration(revision, 'old and new live text'))
      ]).get('run')!
      expect(buildLiveExecutionProgress(events, 'run').items).toEqual([
        { key: 'narration:text', kind: 'narration', body: 'old and new live text' }
      ])
    }
  })

  it('keeps newer restored evidence over an older live buffer, even an older terminal event', () => {
    const restored = narration(3, 'current')
    for (const status of ['streaming', 'completed']) {
      const events = groupExecutionEventsByRunId([{ id: 'run' }], [restored], [
        liveRuntimeEventFromExecutionEvidence(narration(2, 'stale but longer text', status))
      ]).get('run')!
      expect(events).toEqual([liveRuntimeEventFromExecutionEvidence(restored)])
    }
  })

  it('keeps new live activity after a restored command instead of selecting the entire restored projection', () => {
    const command = { ...narration(1, ''), id: 'command', kind: 'command' as const, eventType: 'activity.started',
      payload: { activityId: 'command', activityType: 'shell', title: 'old command' } }
    const next = { ...narration(2, 'new live output'), occurredAt: '2026-10-11T00:00:01Z' }
    const events = groupExecutionEventsByRunId([{ id: 'run' }], [command], [liveRuntimeEventFromExecutionEvidence(next)]).get('run')!
    expect(events.map(event => event.id)).toEqual(['command', 'text'])
    expect(buildLiveExecutionProgress(events, 'run').items.at(-1)).toEqual({
      key: 'narration:text', kind: 'narration', body: 'new live output'
    })
  })
})
