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
  id: 'retry',
  status: 'claimed', targetAgentRunId: successor.id, dispatchPhase: 'materialized',
  createdAt: '2026-09-12T02:31:00Z', endedAt: null
})

function redeliveries(template: PublicDelivery) {
  return inputMessageIds.map((messageId, index) => ({ ...template, id: template.id + index, messageId }))
}

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

function workspaceMarkup(agentRuns: AgentRunView[], messageDeliveries: MessageDeliveryView[],
  overrides: Partial<ThreadSnapshot> = {}, workspaceEntrySnapshotReady = true): string {
  return renderToStaticMarkup(createElement(ThreadWorkspace, {
    snapshot: { ...initial, messages, agentRuns, messageDeliveries, ...overrides },
    agents, projectName: null, busy: false, stopping: false, workspaceEntrySnapshotReady,
    onSend: async () => undefined, onChangeLead: async () => undefined,
    onTasksChanged: async () => undefined, onResolveApproval: () => undefined,
    onStop: () => undefined
  }))
}

function receipts(agentRuns: AgentRunView[], messageDeliveries: MessageDeliveryView[] = originalDeliveries,
  overrides: Partial<ThreadSnapshot> = {}): string[] {
  return [...workspaceMarkup(agentRuns, messageDeliveries, overrides).matchAll(/aria-label="查看消息处理状态，([^"]*)"/g)].map(match => match[1])
}

describe('user message receipts follow the current execution attempt', () => {
  it('shows the reason a waiting recipient was dropped after leaving the group', () => {
    const cancelled = delivery({ status: 'cancelled', targetAgentRunId: null,
      failureCode: 'channel.target_bot_not_in_roster' })
    expect(workspaceMarkup([], [cancelled])).toContain('未派发，机器人已离群')
  })

  it('shows only recipients with retained Run or Delivery facts', () => {
    expect(receipts([], [])).toEqual([])
    const waiting = originalDeliveries.map(item => ({
      ...item, status: 'waiting' as const, targetAgentRunId: null, endedAt: null
    }))
    expect(receipts([], waiting)).toEqual(['排队中', '排队中'])
    expect(receipts([], waiting, {
      messages: messages.map(message => ({ ...message, addressedAgentIds: agents.map(agent => agent.agentId) }))
    })).toEqual(['排队中 1', '排队中 1'])
  })

  it('replaces the original failed receipt for every continued batch input', () => {
    expect(receipts([source, successor], [...originalDeliveries, ...redeliveries(continuation)]))
      .toEqual([])
  })

  it('shows accepted continuation requests as pending before a Run exists', () => {
    expect(receipts([source], [...originalDeliveries,
      ...redeliveries({ ...continuation, status: 'waiting', targetAgentRunId: null })]))
      .toEqual(['排队中', '排队中'])
  })

  it.each([
    ['waiting', ['排队中', '排队中']], ['running', []], ['succeeded', []]
  ] as const)('also follows a %s continuation after a manual stop', (status, labels) => {
    const stopped = { ...source, status: 'cancelled' as const,
      cancelReasonCode: 'user_requested_agent_run_stop' as const }
    const runs = status === 'waiting' ? [stopped] : [stopped, { ...successor, status }]
    expect(receipts(runs, [
      ...originalDeliveries.map(item => ({ ...item, status: 'cancelled' })),
      ...redeliveries({ ...continuation, status: status === 'waiting' ? 'waiting' : 'claimed',
        targetAgentRunId: status === 'waiting' ? null : successor.id })
    ])).toEqual(labels)
  })

  it.each([
    ['queued', null], ['failed', null], ['cancelled', null], ['succeeded', null]
  ] as const)('uses the successor %s state without reviving the original failure', (status, label) => {
    expect(receipts([source, { ...successor, status }], [...originalDeliveries, ...redeliveries(continuation)]))
      .toEqual(label ? [label, label] : [])
  })

  it.each(['failed', 'cancelled', 'waiting', 'delivery_unknown'])(
    'uses newer input Runs when the projection retains only the original %s Delivery', state => {
      expect(receipts([source, successor], originalDeliveries.map(item => state === 'delivery_unknown'
        ? { ...item, inputDeliveryStatus: state } : { ...item, status: state })))
        .toEqual([])
    }
  )

  it('ignores older continuation outcomes when a newer input Run is present', () => {
    expect(receipts([source, successor], [...originalDeliveries,
      { ...continuation, targetAgentRunId: source.id, status: 'failed' }]))
      .toEqual([])
  })

  it('keeps later queued requests ahead of earlier Run outcomes', () => {
    const later = { ...continuation, id: 'next-continuation', status: 'waiting',
      targetAgentRunId: null, createdAt: '2026-09-12T02:33:00Z' }
    expect(receipts([successor, source], [...redeliveries(later), ...originalDeliveries, ...redeliveries(continuation)]))
      .toEqual(['排队中', '排队中'])
  })

  it('orders queued requests by acceptance even when an older request is claimed later', () => {
    const later = { ...continuation, id: 'next-continuation', status: 'waiting',
      targetAgentRunId: null, createdAt: '2026-09-12T02:31:30Z' }
    expect(receipts([source, successor], [...originalDeliveries, ...redeliveries(continuation), ...redeliveries(later)]))
      .toEqual(['排队中', '排队中'])
  })

  it('leaves other recipients and unrelated messages attached to their own attempts', () => {
    const other = { ...source, id: 'other-agent-run', agentId: agents[1].agentId }
    const unrelated = { ...successor, id: 'unrelated-run', inputMessageIds: ['another-message'],
      createdAt: '2026-09-12T02:34:00Z' }
    expect(receipts([source, successor, other, unrelated], [...originalDeliveries, ...redeliveries(continuation),
      ...inputMessageIds.map(messageId => delivery({ id: `other-${messageId}`, messageId,
        recipientAgentId: other.agentId, targetAgentRunId: other.id }))], {
      messages: messages.map(message => ({ ...message, addressedAgentIds: [source.agentId, other.agentId] }))
    })).toEqual([])
  })

  it('shows regrouped ordinary messages as pending while the stopped batch remains in history', () => {
    const stopped: AgentRunView = { ...source, status: 'cancelled', cancelReasonCode: 'message_input_edited' }
    const replacement = delivery({
      id: 'replacement', recipientAgentId: stopped.agentId, messageId: inputMessageIds[1],
      targetAgentRunId: null, status: 'waiting', endedAt: null, createdAt: '2026-09-12T02:31:00Z'
    })
    expect(receipts([stopped], [...originalDeliveries.map(item => ({ ...item, status: 'cancelled' as const })), replacement]))
      .toEqual(['排队中'])
  })

  it('retains old direct failures without a presence row and moves a displaced stop back to its receipt', () => {
    const historical = { ...source, invocationKind: 'direct' as const, inputMessageIds: [], anchorMessageId: inputMessageIds[0] }
    expect(receipts([historical], [])).toEqual(['执行失败'])
    const stop = { ...historical, status: 'cancelled' as const }
    expect(receipts([stop], [])).toEqual([])
    expect(receipts([stop, { ...successor, inputMessageIds: ['unrelated'] }], [])).toEqual(['已停止'])
  })

  it.each(['failed', 'cancelled'] as const)('reserves the %s row during cached entry', status => {
    const run = { ...source, status, cancelReasonCode: status === 'cancelled' ? 'user_requested_agent_run_stop' as const : null }
    const reply: ThreadMessageView = { ...messages[0], id: 'reply', sequence: 3, authorType: 'agent',
      authorId: run.agentId, addressedAgentIds: [], sourceAgentRunId: run.id }
    for (const ready of [false, true]) {
      const markup = workspaceMarkup([run], originalDeliveries, { messages: [...messages, reply] }, ready)
      expect(markup.includes(`data-presence-run="${run.id}"`)).toBe(ready)
      expect(markup).not.toContain('aria-label="查看消息处理状态，')
      expect(markup).not.toContain(`data-interrupted-run-id="${run.id}"`)
    }
  })

  it.each([false, true])('keeps displaced outcomes at their visible marker or receipt, snapshot ready = %s', ready => {
    const stopped: AgentRunView = { ...source, status: 'cancelled', cancelReasonCode: 'user_requested_agent_run_stop' }
    const later = { ...successor, inputMessageIds: ['unrelated'] }
    const reply: ThreadMessageView = { ...messages[0], id: 'reply', sequence: 3, authorType: 'agent',
      authorId: stopped.agentId, addressedAgentIds: [], sourceAgentRunId: stopped.id }
    const render = (overrides: Partial<ThreadSnapshot>) => workspaceMarkup([stopped, later], originalDeliveries, overrides, ready)
    const withReply = render({ messages: [...messages, reply] })
    expect(withReply).not.toContain(`data-presence-run="${stopped.id}"`)
    expect(withReply).toContain(`data-interrupted-run-id="${stopped.id}"`)
    expect(withReply).not.toContain('aria-label="查看消息处理状态，')
    const withFiles = render({ agentRunFileChanges: [{ schemaVersion: 2, agentRunId: stopped.id, executionEpoch: 1,
      files: [{ evidenceFileId: 'file', path: 'result.ts', changeKind: 'update', presentationKind: 'operation_history', operationCount: 1 }],
      fileCount: 1, operationCount: 1, completedAt: createdAt }] })
    expect(withFiles).toContain(`data-interrupted-run-id="${stopped.id}"`)
    expect(withFiles).not.toContain('aria-label="查看消息处理状态，')
    const withWithdrawnReply = render({ messages: [...messages, { ...reply, withdrawn: true }] })
    expect(withWithdrawnReply).not.toContain('data-interrupted-run-id=')
    expect(withWithdrawnReply).toContain('aria-label="查看消息处理状态，已停止"')
    const direct = { ...source, invocationKind: 'direct' as const }
    expect(workspaceMarkup([direct], originalDeliveries, {}, ready)).toContain('aria-label="查看消息处理状态，执行失败"')
  })

  it('counts only pending Pi questions for this Run and epoch as user work', () => {
    const request = { id: 'q', agentRunId: successor.id, executionEpoch: successor.executionEpoch,
      status: 'pending' as const, createdAt: Date.now(), expiresAt: null, canSkip: false, questions: [] }
    const row = (interaction: NonNullable<ThreadSnapshot['nativeInteractions']>[number]) =>
      workspaceMarkup([successor], [], { nativeInteractions: [interaction] }).match(/<article[^>]+data-presence-run="continued-run"[^>]+>/)?.[0]
    expect(row(request)).toContain('需要你处理，等你回答')
    for (const other of [
      { ...request, agentRunId: source.id }, { ...request, executionEpoch: request.executionEpoch + 1 },
      { ...request, status: 'unknown' as const }, { ...request, expiresAt: Date.now() - 1 }
    ]) expect(row(other)).toContain('执行中')
  })

  it('preserves accepted and unknown Steer receipts across subsequent continuation', () => {
    expect(receipts([source, successor], [
      delivery({ requestedMode: 'steer', inputDeliveryStatus: 'accepted' }),
      delivery({ id: 'unknown-steer', messageId: inputMessageIds[1], requestedMode: 'steer',
        inputDeliveryStatus: 'delivery_unknown' })
    ])).toEqual(['插话 · alice已收到', '插话 · 未确认送达'])
  })
})
