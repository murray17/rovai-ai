import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, AgentRunView, MemberCreationView, ThreadMessageView, ThreadSnapshot } from '@contracts'
import { ThreadWorkspace, campConversationTimeline } from './ThreadWorkspace'

const createdAt = '2026-09-06T06:00:00Z'
const endedAt = '2026-09-06T06:01:00Z'

function run(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: 'run-1', threadTurnId: 'turn-1', conversationId: 'conversation-1', agentId: 'agent_1',
    taskId: null, responsibilityKey: 'root', responsibilityGeneration: 1, purpose: '制作页面',
    completionRole: 'required', status: 'failed', waitReason: null, cancelRequestedAt: null,
    cancelReasonCode: null, cancelAcknowledgedAt: null, terminalResolutionSource: null,
    terminalReasonCode: null, failure: null, runtimeModel: null, executionEpoch: 1,
    permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
    a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 1,
    executionEvidenceChangeSequence: 1,
    hasUnsettledExternalEffects: false, workspace: null, startingGitObservation: null,
    endingGitObservation: null, version: 1, createdAt, startedAt: createdAt, endedAt,
    updatedAt: endedAt, ...overrides
  }
}

function snapshot(runs: AgentRunView[] = [run()], images = true, files = true): ThreadSnapshot {
  return {
    schemaVersion: 35, throughGlobalSequence: 1,
    thread: { id: 'camp-artifacts', title: '运行产物', activationState: 'active',
      projectBindingKind: 'quick_chat', projectPath: '/quick-chat', defaultLeadAgentId: 'agent_1',
      membershipGeneration: 1, version: 1, createdAt, updatedAt: endedAt },
    members: [...new Set(runs.map(item => item.agentId))].map((agentId, index) => ({
      agentId, displayName: index === 0 ? '奥黛丽' : '爱丽丝', teamRole: '',
      avatarRef: 'rovai://member-avatar/builtin/luoke/v1', accent: 'var(--identity-1)',
      membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
      memberOrder: index, isDefaultLead: index === 0, version: 1
    })),
    membershipReconciliations: [], messages: [], tasks: [], messageDeliveries: [], turns: [],
    agentRuns: runs, executionEvidence: [], contextManifests: [],
    agentRunFileChanges: files ? runs.map(item => ({
      schemaVersion: 2, agentRunId: item.id, executionEpoch: 1,
      files: [{ evidenceFileId: `file-${item.id}`, path: `${item.id}/result.ts`, changeKind: 'update',
        presentationKind: 'operation_history', operationCount: 1 }],
      fileCount: 1, operationCount: 1, completedAt: endedAt
    })) : [],
    agentRunImages: images ? runs.map(item => ({
      agentRunId: item.id, executionEpoch: 1, createdAt: endedAt,
      images: [{ id: `image-${item.id}`, displayName: 'result.png', mediaType: 'image/png', byteSize: 32 }]
    })) : [],
    approvals: [], actions: [], timeline: []
  }
}

function renderTimeline(candidate: ThreadSnapshot): string {
  const agents: AgentProfile[] = candidate.members.map(member => ({
    agentId: member.agentId, displayName: member.displayName, avatarRef: member.avatarRef,
    accent: member.accent, teamRole: '', professionalResponsibilities: '', personalityTraits: [],
    workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: member.profilePresence,
    runtimeConfiguration: null, runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: member.memberOrder, version: 1, createdAt, updatedAt: endedAt, removedAt: null
  }))
  const markup = renderToStaticMarkup(createElement(ThreadWorkspace, {
    snapshot: candidate, projectName: null, agents, busy: false,
    onSend: async () => undefined, onChangeLead: async () => undefined,
    onTasksChanged: async () => undefined, onResolveApproval: () => undefined,
    stopping: false, onStop: () => undefined
  }))
  const start = markup.indexOf('<div class="timeline-track">')
  expect(start).toBeGreaterThan(-1)
  const tags = /<\/?div\b[^>]*>/g
  tags.lastIndex = start
  let depth = 0
  for (let match = tags.exec(markup); match; match = tags.exec(markup)) {
    depth += match[0].startsWith('</') ? -1 : 1
    if (depth === 0) return markup.slice(start, tags.lastIndex)
  }
  throw new Error('timeline-track is unclosed')
}

function publicMessage(source: AgentRunView): ThreadMessageView {
  return {
    quotes: [], withdrawn: false, canWithdraw: false, version: 1,
    id: 'public-message', sequence: 1, timelineGlobalSequence: null, authorType: 'agent',
    authorId: source.agentId, sourceAgentRunId: source.id, body: '已完成部分修改。',
    content: [{ kind: 'text', text: '已完成部分修改。' }], attachments: [], addressMode: 'default',
    addressedAgentIds: [], replyToThreadMessageId: null, threadTurnId: source.threadTurnId,
    presentation: null, createdAt }
}

const avatars = (markup: string): number => (markup.match(/class="member-avatar(?: |")/g) ?? []).length

function receipt(overrides: Partial<MemberCreationView> = {}): MemberCreationView {
  return { creationId: 'creation-1', sourceAgentRunId: 'run-1', agentId: 'created-member',
    displayName: 'Nova', avatarRef: null, teamRole: 'Research partner',
    professionalResponsibilities: 'Compare evidence.', personalityTraits: ['Curious'],
    creatorAgentId: 'agent_1', creatorDisplayName: '奥黛丽', createdAt, ...overrides }
}

const timeline = (candidate: ThreadSnapshot) => campConversationTimeline(candidate.messages, candidate.turns,
  candidate.agentRuns, candidate.tasks, candidate.agentRunFileChanges, candidate.agentRunImages, candidate.memberCreations)

describe('Run artifacts retain their execution author', () => {
  it.each(['failed', 'cancelled', 'succeeded'] as const)('%s output without a public message has one author', status => {
    for (const [images, files] of [[true, true], [true, false], [false, true]]) {
      const candidate = snapshot([run({ status })], images, files)
      candidate.memberCreations = [receipt()]
      const markup = renderTimeline(candidate)
      expect(avatars(markup)).toBe(1)
      expect(markup).toContain('<strong>奥黛丽</strong>')
      expect(markup).toContain('aria-label="查看奥黛丽的基础信息"')
      expect(markup).not.toContain('data-message-id=')
      expect(markup).not.toContain('class="message-actions')
      if (files) expect(markup).toContain('run-file-changes-card')
      if (images) expect(markup.indexOf('image-gallery')).toBeLessThan(markup.indexOf('member-joined-card'))
      if (files) expect(markup.indexOf('member-joined-card')).toBeLessThan(markup.indexOf('run-file-changes-card'))
    }
  })

  it.each(['camp_turn_cancelled', 'user_requested_agent_run_stop'] as const)('uses the author for %s', cancelReasonCode => {
    expect(avatars(renderTimeline(snapshot([run({ status: 'cancelled', cancelReasonCode,
      cancelRequestedAt: endedAt, cancelAcknowledgedAt: endedAt })], false)))).toBe(1)
  })

  it('keeps parallel Runs and multiple epochs under their own authors', () => {
    const candidate = snapshot([run(), run({ id: 'run-2', agentId: 'agent_2' })])
    candidate.agentRunImages!.push({ ...candidate.agentRunImages![0], executionEpoch: 2,
      images: [{ ...candidate.agentRunImages![0].images[0], id: 'image-epoch-2' }] })
    const markup = renderTimeline(candidate)
    expect(avatars(markup)).toBe(2)
    expect(markup.indexOf('<strong>奥黛丽</strong>')).toBeLessThan(markup.indexOf('run-1/result.ts'))
    expect(markup.indexOf('run-1/result.ts')).toBeLessThan(markup.indexOf('<strong>爱丽丝</strong>'))
    expect(markup.indexOf('<strong>爱丽丝</strong>')).toBeLessThan(markup.indexOf('run-2/result.ts'))
  })

  it('uses the public message author once when an output message is available', () => {
    const candidate = snapshot()
    candidate.messages = [publicMessage(candidate.agentRuns[0])]
    const markup = renderTimeline(candidate)
    expect(avatars(markup)).toBe(1)
    expect(markup).toContain('data-message-id="public-message"')
    expect(markup).toContain('run-file-changes-card')
    expect(markup).not.toContain('run-artifact-output')
  })

  it('keeps removed members static and preserves identity fallback', () => {
    const candidate = snapshot()
    candidate.members[0] = { ...candidate.members[0], profilePresence: 'removed', avatarRef: null }
    const markup = renderTimeline(candidate)
    expect(avatars(markup)).toBe(1)
    expect(markup).toContain('member-avatar-fallback')
    expect(markup).toContain('<strong>奥黛丽</strong>')
    expect(markup).not.toContain('message-author-trigger')
  })

  it('does not invent an author for missing Runs or release active images', () => {
    const candidate = snapshot()
    candidate.agentRuns = []
    expect(avatars(renderTimeline(candidate))).toBe(0)
    candidate.agentRuns = [run({ status: 'running', endedAt: null })]
    candidate.agentRunFileChanges = []
    expect(campConversationTimeline([], [], candidate.agentRuns, [], [], candidate.agentRunImages)).toEqual([])
  })
})

describe('Manual Run interruption in the conversation', () => {
  const stopped = (overrides: Partial<AgentRunView> = {}) => run({ status: 'cancelled', threadTurnId: null,
    cancelReasonCode: 'user_requested_agent_run_stop', cancelRequestedAt: endedAt, ...overrides })
  const markers = (markup: string) => [...markup.matchAll(/data-interrupted-run-id="([^"]+)"/g)].map(match => match[1])

  it('keeps one marker after every artifact epoch of the exact Run, before another member or successor', () => {
    const candidate = snapshot([stopped(), run({ id: 'other', agentId: 'agent_2' }),
      run({ id: 'successor', status: 'running', createdAt: '2026-09-06T06:02:00Z', endedAt: null })])
    candidate.agentRunFileChanges = candidate.agentRunFileChanges.filter(item => item.agentRunId !== 'successor')
    candidate.agentRunFileChanges.push({ ...candidate.agentRunFileChanges[0], executionEpoch: 2,
      files: [{ ...candidate.agentRunFileChanges[0].files[0], path: 'second-epoch.ts' }] })
    candidate.memberCreations = [receipt()]
    const markup = renderTimeline(candidate)
    expect(markers(markup)).toEqual(['run-1'])
    expect(markup.indexOf('second-epoch.ts')).toBeLessThan(markup.indexOf('data-interrupted-run-id'))
    expect(markup.indexOf('data-interrupted-run-id')).toBeLessThan(markup.indexOf('other/result.ts'))
    expect(markup).toContain('你已中断，查看奥黛丽的本次执行')
    expect(markup).not.toContain('data-message-id=')
  })

  it.each([true, false])('attaches only to the last public reply, with artifacts = %s', artifacts => {
    const source = stopped()
    const candidate = snapshot([source], artifacts, artifacts)
    candidate.messages = [{ ...publicMessage(source), id: 'first', sequence: 1 },
      // Message sequence remains authoritative when the wall clock moves backwards.
      { ...publicMessage(source), id: 'last', sequence: 2, createdAt: '2026-09-06T05:59:00Z' }]
    const items = timeline(candidate)
    expect(items.filter(item => item.kind === 'camp_message' && item.interruptedRun).map(item => item.id)).toEqual(['last'])
    const markup = renderTimeline(candidate)
    expect(markers(markup)).toEqual(['run-1'])
    expect(markup).not.toContain('run-artifact-output')
    expect(markup.indexOf(artifacts ? 'run-file-changes-card-files' : 'data-message-id="last"'))
      .toBeLessThan(markup.indexOf('data-interrupted-run-id'))
  })

  it.each([false, true])('does not create an output row when stopping without a reply or artifacts, with history = %s', hasHistory => {
    const candidate = snapshot([stopped()], false, false)
    if (hasHistory) candidate.messages = [{ ...publicMessage(candidate.agentRuns[0]), id: 'later-user', sequence: 1,
      authorType: 'user', authorId: 'local-user', sourceAgentRunId: null, createdAt: '2026-09-06T06:02:00Z' }]
    expect(timeline(candidate).map(item => item.id)).toEqual(hasHistory ? ['later-user'] : [])
    const markup = renderTimeline(candidate)
    expect(markers(markup)).toEqual([])
    expect(avatars(markup)).toBe(0)
    expect(markup).not.toContain('run-artifact-output')
    expect(markup).not.toContain('run-file-changes-card')
    expect(markup).not.toContain('agent-message-output-actions')
  })

  it.each([
    ['failed', null], ['cancelled', 'camp_turn_cancelled'], ['cancelled', 'single_chat_ended'],
    ['cancelled', 'execution_budget_exhausted'], ['cancelled', null], ['running', 'user_requested_agent_run_stop'],
    ['waiting', 'user_requested_agent_run_stop'], ['succeeded', 'user_requested_agent_run_stop']
  ] as const)('does not call %s / %s a user interruption', (status, cancelReasonCode) => {
    const candidate = snapshot([run({ status, cancelReasonCode, cancelRequestedAt: endedAt })])
    expect(markers(renderTimeline(candidate))).toEqual([])
    expect(timeline({ ...candidate, agentRunFileChanges: [], agentRunImages: [] })).toEqual([])
  })
})

describe('Member creation results belong to the creating Run', () => {
  it.each(['queued', 'running', 'waiting'] as const)('withholds a receipt while its Run is %s, even after a public reply', status => {
    const candidate = snapshot([run({ status, endedAt: null })], false, false)
    candidate.memberCreations = [receipt()]
    candidate.messages = [publicMessage(candidate.agentRuns[0])]
    expect(timeline(candidate).map(item => item.kind)).toEqual(['camp_message'])
    expect(renderTimeline(candidate)).not.toContain('member-joined-card')
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('keeps successful creations in order after a %s Run, with or without a reply or diff', status => {
    for (const hasReply of [true, false]) {
      for (const files of [true, false]) {
        const candidate = snapshot([run({ status })], false, files)
        // Input order and IDs deliberately disagree with the creation order.
        candidate.memberCreations = [receipt({ creationId: 'a', displayName: 'Later', createdAt: '2026-09-06T06:00:30Z' }),
          receipt({ creationId: 'z', displayName: 'Earlier' })]
        if (hasReply) candidate.messages = [publicMessage(candidate.agentRuns[0])]
        const markup = renderTimeline(candidate)
        expect(avatars(markup)).toBe(1)
        expect(markup.match(/class="run-result-stack"/g)).toHaveLength(1)
        expect(markup.match(/class="timeline-node member-joined-card"/g)).toHaveLength(2)
        expect(markup.indexOf('Earlier</h3>')).toBeLessThan(markup.indexOf('Later</h3>'))
        if (files) expect(markup.indexOf('Later</h3>')).toBeLessThan(markup.indexOf('run-file-changes-card'))
        if (hasReply) {
          expect(markup.indexOf('已完成部分修改。')).toBeLessThan(markup.indexOf('member-joined-card'))
          expect(markup.match(/class="message-actions /g)).toHaveLength(1)
        } else {
          expect(markup).toContain('data-run-artifact-output-id="run-1"')
          expect(markup).not.toContain('data-message-id=')
          expect(markup).not.toContain('class="message-actions')
        }
      }
    }
  })

  it('anchors to the exact Run’s last public message across parallel Runs by the same member and clock rollback', () => {
    const candidate = snapshot([run(), run({ id: 'run-2' })], false)
    candidate.memberCreations = [receipt(), receipt({ creationId: 'creation-2', sourceAgentRunId: 'run-2' })]
    const first = publicMessage(candidate.agentRuns[0])
    candidate.messages = [first,
      { ...publicMessage(candidate.agentRuns[1]), id: 'other-run', sequence: 2 },
      { ...first, id: 'last-reply', sequence: 3, createdAt: '2026-09-06T05:59:00Z' }]
    expect(timeline(candidate).map(item => item.id)).toEqual([
      'public-message', 'other-run', 'creation-2', 'run-file-changes:run-2:1',
      'last-reply', 'creation-1', 'run-file-changes:run-1:1'
    ])
  })

  it('keeps legacy and unavailable-Run receipts readable without inferring a source from their creator', () => {
    const candidate = snapshot([run({ status: 'running', endedAt: null })], false, false)
    candidate.messages = [publicMessage(candidate.agentRuns[0])]
    candidate.memberCreations = [receipt({ sourceAgentRunId: null }),
      receipt({ creationId: 'missing-run-receipt', sourceAgentRunId: 'unavailable-run' })]
    expect(timeline(candidate).filter(item => item.kind === 'member_joined')).toHaveLength(2)
    const markup = renderTimeline(candidate)
    expect(markup).not.toContain('run-result-stack')
    expect(markup).not.toContain('run-artifact-output')
  })
})
