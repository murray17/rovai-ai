import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentProfile, AgentRunView, MessageDeliveryView, ThreadMessageView, ThreadSnapshot } from '@contracts'
import { ThreadWorkspace } from './ThreadWorkspace'

const createdAt = '2026-09-12T02:30:00Z'
const agents: AgentProfile[] = ['alice', 'audrey'].map((agentId, memberOrder) => ({
  agentId, displayName: agentId, avatarRef: null, accent: '', teamRole: '',
  professionalResponsibilities: '', personalityTraits: [], workingPrinciples: '', growthTopic: '',
  defaultCapabilities: [], presence: 'present', runtimeConfiguration: null,
  runtimeReadiness: { status: 'runtime_not_configured', blockers: [] }, memberOrder,
  version: 1, createdAt, updatedAt: createdAt, removedAt: null
}))
const messages: ThreadMessageView[] = [1, 2].map(sequence => ({
  id: `input-${sequence}`, sequence, timelineGlobalSequence: null, authorType: 'user',
  authorId: 'local_user', sourceAgentRunId: null, body: `请求 ${sequence}`,
  content: [{ kind: 'text', text: `请求 ${sequence}` }], quotes: [], attachments: [],
  addressMode: 'explicit', addressedAgentIds: [agents[0].agentId], replyToThreadMessageId: null,
  threadTurnId: null, presentation: null, withdrawn: false, canWithdraw: false, version: 1, createdAt
}))
const inputMessageIds = messages.map(message => message.id)
const source: AgentRunView = {
  id: 'failed-run', invocationKind: 'batch', status: 'failed', agentId: agents[0].agentId,
  threadTurnId: null, conversationId: 'conversation', taskId: null, responsibilityKey: 'root',
  responsibilityGeneration: 1, purpose: '检查消息', completionRole: 'required', waitReason: null,
  cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null,
  terminalResolutionSource: null, terminalReasonCode: null, failure: null, runtimeModel: null,
  executionEpoch: 1, permissionSemantics: 'runtime_managed_v2', triggerDeliveryGeneration: 0,
  a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
  hasUnsettledExternalEffects: false, workspace: null, startingGitObservation: null,
  endingGitObservation: null, version: 1, createdAt, startedAt: createdAt, updatedAt: createdAt,
  inputMessageIds, executionEvidenceCount: 0, executionEvidenceChangeSequence: 0,
  endedAt: '2026-09-12T02:30:30Z'
}
const successor: AgentRunView = {
  ...source, id: 'continued-run', status: 'running', endedAt: null,
  createdAt: '2026-09-12T02:32:00Z', startedAt: '2026-09-12T02:32:01Z'
}

type PublicDelivery = Extract<MessageDeliveryView, { deliveryKind: 'public_a2a' }>
function delivery(overrides: Partial<PublicDelivery> = {}): PublicDelivery {
  return {
    id: 'original-delivery', messageId: inputMessageIds[0], recipientAgentId: source.agentId,
    targetAgentRunId: source.id, status: 'failed', requestedMode: 'start',
    threadTurnId: null, taskId: null, recipientMembershipVersionAtAdmission: 1,
    dispatchPhase: 'terminal', waitCondition: null, dispatchAttemptCount: 1,
    retryGeneration: 0, contextManifestId: null, manualInterventionRequired: false,
    failureCode: null, version: 1, createdAt: source.createdAt, updatedAt: source.createdAt,
    endedAt: source.endedAt, deliveryKind: 'public_a2a', dispatchDisposition: 'dispatch',
    completionRole: 'required', gatherId: null, gatherDispatchDeliveryId: null,
    recipientCanonicalPosition: 0, edgeKind: 'forward', targetParentAgentRunId: null,
    returnToAgentRunId: null, ...overrides
  }
}

const originalDeliveries = inputMessageIds.map((messageId, index) => delivery({ id: `original-${index}`, messageId }))
const continuation = delivery({
  id: 'continuation', continuationRequest: true, inputMessageIds,
  status: 'claimed', targetAgentRunId: successor.id, dispatchPhase: 'materialized',
  createdAt: '2026-09-12T02:31:00Z', endedAt: null
})

const initial: ThreadSnapshot = {
  schemaVersion: 36, tasksEnabled: true, throughGlobalSequence: 1,
  thread: { id: 'receipt-thread', title: '消息回执', activationState: 'active',
    projectBindingKind: 'quick_chat', projectPath: '/quick-chat', defaultLeadAgentId: agents[0].agentId,
    membershipGeneration: 1, version: 1, createdAt, updatedAt: createdAt },
  members: agents.map((agent, memberOrder) => ({
    agentId: agent.agentId, displayName: agent.displayName, avatarRef: null, teamRole: '', accent: '',
    membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder,
    isDefaultLead: memberOrder === 0, version: 1
  })),
  membershipReconciliations: [], messages, tasks: [], messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], contextManifests: [], agentRunFileChanges: [], approvals: [], actions: [], timeline: []
}

function receipts(agentRuns: AgentRunView[], messageDeliveries: MessageDeliveryView[] = originalDeliveries,
  overrides: Partial<ThreadSnapshot> = {}): string[] {
  const markup = renderToStaticMarkup(createElement(ThreadWorkspace, {
    snapshot: { ...initial, messages, agentRuns, messageDeliveries, ...overrides },
    agents, projectName: null, busy: false, stopping: false,
    onSend: async () => undefined, onChangeLead: async () => undefined,
    onTasksChanged: async () => undefined, onResolveApproval: () => undefined,
    onStop: () => undefined
  }))
  return [...markup.matchAll(/aria-label="查看消息处理状态，([^"]*)"/g)].map(match => match[1])
}

describe('user message receipts follow the current execution attempt', () => {
  it('replaces the original failed receipt for every continued batch input', () => {
    expect(receipts([source, successor], [...originalDeliveries, continuation]))
      .toEqual(['处理中 1', '处理中 1'])
  })

  it('shows accepted continuation requests as pending before a Run exists', () => {
    expect(receipts([source], [...originalDeliveries,
      { ...continuation, status: 'waiting', targetAgentRunId: null }]))
      .toEqual(['待处理 1', '待处理 1'])
  })

  it.each([
    ['waiting', ['待处理 1', '待处理 1']], ['running', ['处理中 1', '处理中 1']], ['succeeded', []]
  ] as const)('also follows a %s continuation after a manual stop', (status, labels) => {
    const stopped = { ...source, status: 'cancelled' as const,
      cancelReasonCode: 'user_requested_agent_run_stop' as const }
    const runs = status === 'waiting' ? [stopped] : [stopped, { ...successor, status }]
    expect(receipts(runs, [
      ...originalDeliveries.map(item => ({ ...item, status: 'cancelled' })),
      { ...continuation, status: status === 'waiting' ? 'waiting' : 'claimed',
        targetAgentRunId: status === 'waiting' ? null : successor.id }
    ])).toEqual(labels)
  })

  it.each([
    ['queued', '启动中 1'], ['failed', '执行失败'], ['cancelled', '已停止'], ['succeeded', null]
  ] as const)('uses the successor %s state without reviving the original failure', (status, label) => {
    expect(receipts([source, { ...successor, status }], [...originalDeliveries, continuation]))
      .toEqual(label ? [label, label] : [])
  })

  it.each(['failed', 'cancelled', 'waiting', 'delivery_unknown'])(
    'uses newer input Runs when the projection retains only the original %s Delivery', state => {
      expect(receipts([source, successor], originalDeliveries.map(item => state === 'delivery_unknown'
        ? { ...item, inputDeliveryStatus: state } : { ...item, status: state })))
        .toEqual(['处理中 1', '处理中 1'])
    }
  )

  it('ignores older continuation outcomes when a newer input Run is present', () => {
    expect(receipts([source, successor], [...originalDeliveries,
      { ...continuation, targetAgentRunId: source.id, status: 'failed' }]))
      .toEqual(['处理中 1', '处理中 1'])
  })

  it('keeps later queued requests ahead of earlier Run outcomes', () => {
    const later = { ...continuation, id: 'next-continuation', status: 'waiting',
      targetAgentRunId: null, createdAt: '2026-09-12T02:33:00Z' }
    expect(receipts([successor, source], [later, ...originalDeliveries, continuation]))
      .toEqual(['待处理 1', '待处理 1'])
  })

  it('orders queued requests by acceptance even when an older request is claimed later', () => {
    const later = { ...continuation, id: 'next-continuation', status: 'waiting',
      targetAgentRunId: null, createdAt: '2026-09-12T02:31:30Z' }
    expect(receipts([source, successor], [...originalDeliveries, continuation, later]))
      .toEqual(['待处理 1', '待处理 1'])
  })

  it('leaves other recipients and unrelated messages attached to their own attempts', () => {
    const other = { ...source, id: 'other-agent-run', agentId: agents[1].agentId }
    const unrelated = { ...successor, id: 'unrelated-run', inputMessageIds: ['another-message'],
      createdAt: '2026-09-12T02:34:00Z' }
    expect(receipts([source, successor, other, unrelated], [...originalDeliveries, continuation,
      ...inputMessageIds.map(messageId => delivery({ id: `other-${messageId}`, messageId,
        recipientAgentId: other.agentId, targetAgentRunId: other.id }))], {
      messages: messages.map(message => ({ ...message, addressedAgentIds: [source.agentId, other.agentId] }))
    })).toEqual(['处理中 1 · 执行失败 1', '处理中 1 · 执行失败 1'])
  })

  it('preserves accepted and unknown Steer receipts across subsequent continuation', () => {
    expect(receipts([source, successor], [
      delivery({ requestedMode: 'steer', inputDeliveryStatus: 'accepted' }),
      delivery({ id: 'unknown-steer', messageId: inputMessageIds[1], requestedMode: 'steer',
        inputDeliveryStatus: 'delivery_unknown' }), continuation
    ])).toEqual(['已插话', '待核对 1'])
  })
})
