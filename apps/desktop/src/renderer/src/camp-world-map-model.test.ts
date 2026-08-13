import { describe, expect, it } from 'vitest'
import type { AgentRunView, CampMemberView } from '@contracts'
import type { LiveExecutionProgress } from './ui-model'
import {
  campWorldMapAmbientSpeech,
  campWorldMapInitialNodes,
  campWorldMapPlainText,
  campWorldMapRendezvousNode,
  campWorldMapShortestPath,
  projectCampWorldMap,
  truncateCampWorldMapSpeech
} from './camp-world-map-model'

function member(
  agentId: string,
  memberOrder: number,
  overrides: Partial<CampMemberView> = {}
): CampMemberView {
  return {
    agentId,
    displayName: `队员 ${agentId}`,
    avatarRef: null,
    teamRole: 'member',
    accent: 'steel',
    membershipStatus: 'active',
    leaveRequestedAt: null,
    profilePresence: 'present',
    memberOrder,
    isDefaultLead: memberOrder === 0,
    version: 1,
    ...overrides
  }
}

function run(
  id: string,
  agentId: string,
  status: AgentRunView['status'],
  overrides: Partial<AgentRunView> = {}
): AgentRunView {
  return {
    id,
    campTurnId: 'turn_1',
    conversationId: 'conversation_1',
    agentId,
    taskId: null,
    responsibilityKey: id,
    responsibilityGeneration: 1,
    purpose: '完成真实任务',
    completionRole: 'required',
    status,
    waitReason: null,
    terminalResolutionSource: null,
    terminalReasonCode: null,
    executionEpoch: 1,
    permissionSemantics: 'runtime_managed_v2',
    invocationKind: 'direct',
    a2aParentAgentRunId: null,
    a2aRootAgentRunId: null,
    a2aDepth: 0,
    executionEvidenceCount: 0,
    hasUnsettledExternalEffects: false,
    workspace: null,
    startingGitObservation: null,
    endingGitObservation: null,
    version: 1,
    createdAt: '2026-08-13T12:00:00.000Z',
    startedAt: status === 'queued' ? null : '2026-08-13T12:00:01.000Z',
    endedAt: null,
    updatedAt: '2026-08-13T12:00:02.000Z',
    ...overrides
  }
}

describe('Camp world map model', () => {
  it('places a Camp member set deterministically without collisions', () => {
    const first = campWorldMapInitialNodes('camp_1', ['agent_4', 'agent_2', 'agent_1', 'agent_3'])
    const second = campWorldMapInitialNodes('camp_1', ['agent_3', 'agent_1', 'agent_4', 'agent_2'])

    expect(second).toEqual(first)
    expect(new Set(Object.values(first)).size).toBe(4)
  })

  it('uses only connected fixed routes and selects a nearby allowed rendezvous', () => {
    const path = campWorldMapShortestPath('research', 'harbor')

    expect(path).not.toBeNull()
    expect(path?.[0]?.from).toBe('research')
    expect(path?.at(-1)?.to).toBe('harbor')
    expect(path?.every((edge, index) => index === 0 || path[index - 1]?.to === edge.from)).toBe(true)
    expect(campWorldMapRendezvousNode('build', 'memory')).toBe('a2a')
  })

  it('builds deterministic, explicitly preset idle copy from task, place, adverb and action', () => {
    const first = campWorldMapAmbientSpeech('camp_1', 'agent_1', 'remote', 3)
    const second = campWorldMapAmbientSpeech('camp_1', 'agent_1', 'remote', 3)

    expect(second).toBe(first)
    expect(first).toContain('观测台')
    expect(first.endsWith('。')).toBe(true)
  })

  it('normalizes Markdown and truncates by grapheme without leaking formatting syntax', () => {
    expect(campWorldMapPlainText('### 检查\n- **路线**与[地图](https://example.com)')).toBe('检查 路线与地图')
    expect(truncateCampWorldMapSpeech('甲乙丙丁', 3)).toBe('甲乙丙…')
    expect(truncateCampWorldMapSpeech('👩‍💻正在检查', 2)).toBe('👩‍💻正…')
  })

  it('projects only active present members and keeps real and waiting output distinct', () => {
    const progress = new Map<string, LiveExecutionProgress>([
      ['run_alice', {
        items: [{ key: 'narration:1', kind: 'narration', body: '**正在核对** 会话区尺寸约束。' }]
      }],
      ['run_kyoko', {
        items: [{
          key: 'tool:1',
          kind: 'tool',
          step: {
            id: 'tool_1',
            title: '读取文件',
            detail: 'CampWorkspace.tsx',
            status: 'running',
            activityDomain: 'filesystem',
            toolName: 'read',
            credibility: 'runtime_structured'
          }
        }]
      }]
    ])
    const projection = projectCampWorldMap(
      [
        member('alice', 1, { displayName: '爱丽丝' }),
        member('kyoko', 2, { displayName: '雾切响子' }),
        member('away', 3, { profilePresence: 'away' }),
        member('left', 4, { membershipStatus: 'left' })
      ],
      [run('run_alice', 'alice', 'running'), run('run_kyoko', 'kyoko', 'waiting')],
      progress
    )

    expect(projection.agents.map((agent) => agent.displayName)).toEqual(['爱丽丝', '雾切响子'])
    expect(projection.agents[0]).toMatchObject({
      mode: 'running',
      speech: {
        kind: 'real',
        label: 'AgentRun · 真实执行',
        text: '正在核对 会话区尺寸约束。'
      }
    })
    expect(projection.agents[1]).toMatchObject({
      mode: 'waiting',
      speech: {
        kind: 'waiting',
        label: 'AgentRun · 结果待确认',
        text: '读取文件：CampWorkspace.tsx'
      }
    })
  })

  it('shows an honest no-output state instead of synthesizing task progress', () => {
    const projection = projectCampWorldMap(
      [member('alice', 1)],
      [run('run_alice', 'alice', 'running')],
      new Map()
    )

    expect(projection.agents[0]?.speech).toEqual({
      key: 'run_alice:running-without-output',
      kind: 'real',
      label: 'AgentRun · 等待输出',
      text: '运行已开始，暂未收到可展示步骤。'
    })
  })

  it('projects a rendezvous only from two currently running linked A2A runs', () => {
    const source = run('run_source', 'alice', 'running')
    const target = run('run_target', 'kyoko', 'running', {
      invocationKind: 'a2a',
      a2aParentAgentRunId: source.id,
      a2aRootAgentRunId: source.id,
      a2aDepth: 1,
      createdAt: '2026-08-13T12:00:03.000Z'
    })
    const running = projectCampWorldMap(
      [member('alice', 1), member('kyoko', 2)],
      [source, target],
      new Map()
    )
    const waiting = projectCampWorldMap(
      [member('alice', 1), member('kyoko', 2)],
      [source, { ...target, status: 'waiting' }],
      new Map()
    )

    expect(running.rendezvous).toEqual([{
      key: 'run_source:run_target',
      sourceAgentId: 'alice',
      targetAgentId: 'kyoko',
      sourceRunId: 'run_source',
      targetRunId: 'run_target'
    }])
    expect(waiting.rendezvous).toEqual([])
  })
})
