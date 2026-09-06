import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, AgentRunView, CampMessageView, CampSnapshot } from '@contracts'
import { CampWorkspace, campConversationTimeline } from './CampWorkspace'

const createdAt = '2026-09-06T06:00:00Z'
const endedAt = '2026-09-06T06:01:00Z'

function run(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: 'run-1', campTurnId: 'turn-1', conversationId: 'conversation-1', agentId: 'agent_1',
    taskId: null, responsibilityKey: 'root', responsibilityGeneration: 1, purpose: '制作页面',
    completionRole: 'required', status: 'failed', waitReason: null, cancelRequestedAt: null,
    cancelReasonCode: null, cancelAcknowledgedAt: null, terminalResolutionSource: null,
    terminalReasonCode: null, failure: null, runtimeModel: null, executionEpoch: 1,
    permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
    a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 1,
    hasUnsettledExternalEffects: false, workspace: null, startingGitObservation: null,
    endingGitObservation: null, version: 1, createdAt, startedAt: createdAt, endedAt,
    updatedAt: endedAt, ...overrides
  }
}

function snapshot(runs: AgentRunView[] = [run()], images = true, files = true): CampSnapshot {
  return {
    schemaVersion: 34, throughGlobalSequence: 1,
    camp: { id: 'camp-artifacts', title: '运行产物', activationState: 'active',
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

function renderTimeline(candidate: CampSnapshot): string {
  const agents: AgentProfile[] = candidate.members.map(member => ({
    agentId: member.agentId, displayName: member.displayName, avatarRef: member.avatarRef,
    accent: member.accent, teamRole: '', professionalResponsibilities: '', personalityTraits: [],
    workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: member.profilePresence,
    runtimeConfiguration: null, runtimeReadiness: { status: 'runtime_not_configured', blockers: [] },
    memberOrder: member.memberOrder, version: 1, createdAt, updatedAt: endedAt, removedAt: null
  }))
  const markup = renderToStaticMarkup(createElement(CampWorkspace, {
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

function publicMessage(source: AgentRunView): CampMessageView {
  return { id: 'public-message', sequence: 1, timelineGlobalSequence: null, authorType: 'agent',
    authorId: source.agentId, sourceAgentRunId: source.id, body: '已完成部分修改。',
    content: [{ kind: 'text', text: '已完成部分修改。' }], attachments: [], addressMode: 'default',
    addressedAgentIds: [], replyToCampMessageId: null, campTurnId: source.campTurnId,
    presentation: null, createdAt }
}

const avatars = (markup: string): number => (markup.match(/class="member-avatar(?: |")/g) ?? []).length

describe('Run artifacts retain their execution author', () => {
  it.each(['failed', 'cancelled', 'succeeded'] as const)('%s output without a public message has one author', status => {
    for (const [images, files] of [[true, true], [true, false], [false, true]]) {
      const candidate = snapshot([run({ status })], images, files)
      const markup = renderTimeline(candidate)
      expect(avatars(markup)).toBe(1)
      expect(markup).toContain('<strong>奥黛丽</strong>')
      expect(markup).toContain('aria-label="查看奥黛丽的基础信息"')
      expect(markup).not.toContain('data-message-id=')
      expect(markup).not.toContain('class="message-actions')
      if (files) expect(markup).toContain('run-file-changes-card')
      if (images && files) expect(markup.indexOf('image-gallery')).toBeLessThan(markup.indexOf('run-file-changes-card'))
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
