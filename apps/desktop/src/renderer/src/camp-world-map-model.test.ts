import { describe, expect, it } from 'vitest'
import type { AgentRunView, ThreadMemberView, GeneralPreferencesApi } from '@contracts'
import type { LiveExecutionProgress } from './ui-model'
import { changeInterfaceLanguage } from './interface-language'
import { DEFAULT_GENERAL_PREFERENCES } from '../../shared/general-preferences-model'
import {
  campWorldMapInitialNodes,
  campWorldMapExecutionSummary,
  campWorldMapPlainText,
  campWorldMapRendezvousNode,
  campWorldMapShortestPath,
  projectThreadWorldMap,
  truncateThreadWorldMapSpeech
} from './camp-world-map-model'

function member(
  agentId: string,
  memberOrder: number,
  overrides: Partial<ThreadMemberView> = {}
): ThreadMemberView {
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
    threadTurnId: 'turn_1',
    conversationId: 'conversation_1',
    agentId,
    taskId: null,
    responsibilityKey: id,
    responsibilityGeneration: 1,
    purpose: '完成真实任务',
    completionRole: 'required',
    status,
    waitReason: null,
    cancelRequestedAt: null,
    cancelReasonCode: null,
    cancelAcknowledgedAt: null,
    terminalResolutionSource: null,
    terminalReasonCode: null,
    failure: null,
    runtimeModel: null,
    executionEpoch: 1,
    permissionSemantics: 'runtime_managed_v2',
    invocationKind: 'direct',
    triggerDeliveryGeneration: 0,
    a2aParentAgentRunId: null,
    a2aRootAgentRunId: null,
    a2aDepth: 0,
    executionEvidenceCount: 0,
    executionEvidenceChangeSequence: 0,
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

describe('Thread world map model', () => {
  it('places a Thread member set deterministically without collisions', () => {
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

  it('normalizes Markdown and truncates by grapheme without leaking formatting syntax', () => {
    expect(campWorldMapPlainText('### 检查\n- **路线**与[地图](https://example.com)')).toBe('检查 路线与地图')
    expect(truncateThreadWorldMapSpeech('甲乙丙丁', 3)).toBe('甲乙丙…')
    expect(truncateThreadWorldMapSpeech('👩‍💻正在检查', 2)).toBe('👩‍💻正…')
  })

  it('localizes structured file activity in the world map without translating Runtime detail', async () => {
    const languageApi = {
      setInterfaceLanguage: async (interfaceLanguage: 'zh-CN' | 'en') =>
        ({ ...DEFAULT_GENERAL_PREFERENCES, interfaceLanguage })
    } as GeneralPreferencesApi
    await changeInterfaceLanguage(languageApi, 'en')
    try {
      const read = {
        key: 'tool:read', kind: 'tool' as const,
        step: {
          id: 'read', title: '阅读 README.md', publicCommand: null, publicResult: null,
          detail: '', status: 'running' as const, activityDomain: 'file', iconKind: 'file-read' as const,
          toolName: null, credibility: 'runtime_structured',
          fileOperation: { operationKind: 'read' as const, path: 'docs/README.md' }
        }
      }
      expect(campWorldMapExecutionSummary({ items: [read] })).toMatchObject({ text: 'Read README.md' })
      expect(campWorldMapExecutionSummary({ items: [{
        ...read, key: 'tool:edit', step: {
          ...read.step, id: 'edit', title: '编辑 settings.ts', detail: 'Runtime 原文',
          fileOperation: { operationKind: 'write', changeKind: 'update', path: 'src/settings.ts' }
        }
      }] })).toMatchObject({ text: 'Edit settings.ts: Runtime 原文' })
    } finally {
      await changeInterfaceLanguage(languageApi, 'zh-CN')
    }
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
            publicCommand: null,
            publicResult: null,
            detail: 'ThreadWorkspace.tsx',
            status: 'running',
            activityDomain: 'filesystem',
            iconKind: 'file',
            toolName: 'read',
            credibility: 'runtime_structured'
          }
        }]
      }]
    ])
    const projection = projectThreadWorldMap(
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
        label: '执行 · 正在运行',
        text: '正在核对 会话区尺寸约束。'
      }
    })
    expect(projection.agents[1]).toMatchObject({
      mode: 'waiting',
      speech: {
        kind: 'waiting',
        label: '执行 · 结果待确认',
        text: '读取文件：ThreadWorkspace.tsx'
      }
    })
  })

  it('shows an honest no-output state instead of synthesizing task progress', () => {
    const projection = projectThreadWorldMap(
      [member('alice', 1)],
      [run('run_alice', 'alice', 'running')],
      new Map()
    )

    expect(projection.agents[0]?.speech).toEqual({
      key: 'run_alice:running-without-output',
      kind: 'real',
      label: '执行 · 等待输出',
      text: '运行已开始，暂未收到可展示步骤。'
    })
  })

  it('projects a rendezvous only from two currently running linked A2A runs', () => {
    const source = run('run_source', 'alice', 'running')
    const target = run('run_target', 'kyoko', 'running', {
      invocationKind: 'a2a',
      triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: source.id,
      a2aRootAgentRunId: source.id,
      a2aDepth: 1,
      createdAt: '2026-08-13T12:00:03.000Z'
    })
    const running = projectThreadWorldMap(
      [member('alice', 1), member('kyoko', 2)],
      [source, target],
      new Map()
    )
    const waiting = projectThreadWorldMap(
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
