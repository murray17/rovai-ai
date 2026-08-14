import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  ActionApprovalView,
  AdapterInstallation,
  AgentProfile,
  AgentRunView,
  AgentRunExecutionEvidenceView,
  CampComposerDraftView,
  CampMessageView,
  CampSnapshot,
  CanonicalRuntimeActivityView,
  HealthStatus,
  MessageDeliveryView,
  NotificationActionView
} from '@contracts'
import {
  AppHeader,
  ControlledShutdownOverlay,
  WindowDragStrip,
  allNavigationCamps,
  campActivationStateForCreation,
  campViewIsVisibleForReadAcknowledgement,
  campInspectorVisibleFromStoredValue,
  cancellableTurnIds,
  campCreationPreflightFromAgents,
  campMessageSendParams,
  campSnapshotWithCurrentAnchor,
  campSnapshotWithAnchoredMessages,
  commandFailureMessage,
  effectiveCancellingTurnIds,
  notificationFocusMatchesAction,
  optimisticCampMessage,
  rectanglesIntersect,
  recentCampSnapshot,
  reconcileCancellingTurnIds,
  rememberCampSnapshot,
  runtimeRecoveryFromCommandResult,
  SettingsView,
  shouldLoadRuntimeHealth,
  windowDragStripPage
} from './App'
import {
  CampNavigation,
  campNavigationMenuLabels,
  copyCampIdToClipboard,
  projectNavigationMenuLabels,
  toggleNavigationGroup,
  type NavigationSettingsSection
} from './CampNavigation'
import {
  CampWorkspace,
  QuickChatWorkspace,
  RunExecutionDisclosure,
  TaskPanel,
  agentExecutionProcesses,
  agentRunTerminalNote,
  agentRunCountsAsExecuting,
  agentRunShowsUnsettledWarning,
  attachmentDragKind,
  campConversationViewFromStoredValue,
  campConversationTimeline,
  composerDraftNeedsContinuationRepair,
  composerDraftNeedsReplyRepair,
  composerRecipientSummary,
  campInspectorMembers,
  campMemberIsLeadEligible,
  clampExecutionDrawerHeight,
  defaultExecutionDrawerMaxHeight,
  dataTransferContainsFiles,
  droppedAttachmentInputs,
  emptyCampRuntimeSummary,
  executionDrawerHeightBounds,
  executionDrawerHeightFromStoredValue,
  executionDrawerIsNearBottom,
  executionDrawerTitle,
  executionDisclosureOpenAfterActivity,
  executionDisclosureIsLiveOpen,
  firstSubmittedAgentRun,
  formatStopElapsed,
  isViewingNonTerminalAgentRun,
  loadCompleteAgentRunExecutionEvidence,
  preferredAgentProcessRun,
  rectanglesOverlap,
  runtimeOptionsForDisplay
} from './CampWorkspace'
import {
  describeInitialCampSelectionAdjustments,
  initialCampSelection,
  limitDraftNameInput,
  normalizeDraftName,
  planInitialCampSelection,
  toggleCampMemberSelection,
  workspaceCapability
} from './NewConversationDialog'
import {
  MemberRuntimeForm,
  MembersView,
  RuntimeInstallationsPanel,
  hasDuplicateMemberDisplayName,
  memberIdentityTargetAgent
} from './MemberManagement'

import { MemoryLibrary } from './MemoryLibrary'
import { SafeMarkdown } from './SafeMarkdown'
import {
  agentRunPresentation,
  agentRunStateTag,
  agentRunWaitDetail,
  buildGitStatusEntries,
  buildLiveExecutionProgress,
  diffLineKind,
  executionEvidenceCopyText,
  formatByteSize,
  liveRuntimeEventFromCore,
  liveRuntimeEventFromExecutionEvidence,
  parseGitStatus,
  selectCompleteExecutionEvidence,
  toolDetailPreview
} from './ui-model'

const TEST_EXECUTION_BUDGET = {
  schemaVersion: 1 as const,
  acceptedAt: '2026-07-30T10:00:00Z',
  deadlineAt: '2026-07-30T11:00:00Z',
  elapsedSeconds: 3600,
  maxAgentRunResponsibilities: 32,
  maxAcceptedA2a: 16,
  allocatedAgentRunResponsibilities: 1,
  acceptedA2a: 0,
  exhaustedAt: null,
  exhaustionReason: null,
  exhaustionCommandId: null
}

function canonicalActivity(
  operationId: string,
  overrides: Partial<CanonicalRuntimeActivityView> = {}
): CanonicalRuntimeActivityView {
  return {
    operationId,
    classifierVersion: 'activity-v1',
    activityDomain: 'tool',
    semanticKind: 'tool.call',
    toolName: null,
    presentationHint: 'Runtime 工具调用',
    phase: 'terminal',
    outcome: 'succeeded',
    credibility: 'runtime_structured',
    coverageLevel: 'fine_grained',
    sourceAuthority: 'runtime',
    sourceEvidenceIds: [],
    firstEvidenceSequence: 1,
    lastEvidenceSequence: 1,
    revision: 1,
    ...overrides
  }
}

describe('Camp snapshot cache', () => {
  it('keeps a bounded least-recently-used Camp snapshot cache', () => {
    const snapshot = (campId: string): CampSnapshot => ({
      camp: { id: campId }
    } as CampSnapshot)
    const cache = new Map<string, CampSnapshot>()
    const first = snapshot('camp-1')
    const second = snapshot('camp-2')
    const third = snapshot('camp-3')

    rememberCampSnapshot(cache, first, 2)
    rememberCampSnapshot(cache, second, 2)
    expect(recentCampSnapshot(cache, 'camp-1')).toBe(first)
    rememberCampSnapshot(cache, third, 2)

    expect([...cache.keys()]).toEqual(['camp-1', 'camp-3'])
    expect(recentCampSnapshot(cache, 'camp-2')).toBeNull()
  })
})

describe('task event projections', () => {
  it('shows the complete structured recipient fanout and never infers recipients from a reply', () => {
    const members: CampSnapshot['members'] = [
      {
        agentId: 'agent_1', displayName: '叮叮', teamRole: 'Lead', avatarRef: null,
        accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null,
        profilePresence: 'present', memberOrder: 0, isDefaultLead: true, version: 1
      },
      {
        agentId: 'agent_2', displayName: '芝士', teamRole: 'Reviewer', avatarRef: null,
        accent: '#4F7F9F', membershipStatus: 'active', leaveRequestedAt: null,
        profilePresence: 'present', memberOrder: 1, isDefaultLead: false, version: 1
      }
    ]
    expect(composerRecipientSummary([], members)).toBe('默认由 Lead · 叮叮接收')
    expect(composerRecipientSummary([
      { kind: 'member_mention', agentId: 'agent_2' },
      { kind: 'member_mention', agentId: 'agent_1' }
    ], members)).toBeNull()
    expect(composerRecipientSummary([{ kind: 'all_members_mention' }], members))
      .toBeNull()
  })

  it('requires explicit repair only until an unavailable reply author is visibly replaced', () => {
    const base: CampComposerDraftView = {
      campId: 'camp-1', body: '继续', revision: 4, attachments: [],
      updatedAt: '2026-08-14T00:00:00Z', expiresAt: '2026-08-21T00:00:00Z',
      content: [{ kind: 'member_mention', agentId: 'agent_2' }],
      continuationIntent: null,
      replyIntent: {
        replyToCampMessageId: 'message-1', targetState: 'available', excerpt: '原消息',
        recipientSelectionRequired: false,
        author: {
          authorType: 'agent', authorId: 'agent_2', displayName: '芝士',
          recipientAvailability: 'unavailable'
        }
      }
    }
    expect(composerDraftNeedsReplyRepair(base)).toBe(true)
    expect(composerDraftNeedsReplyRepair({
      ...base,
      content: [{ kind: 'member_mention', agentId: 'agent_1' }]
    })).toBe(false)
    expect(composerDraftNeedsReplyRepair({
      ...base,
      content: [],
      replyIntent: { ...base.replyIntent!, recipientSelectionRequired: true }
    })).toBe(true)
    expect(composerDraftNeedsReplyRepair({
      ...base,
      content: [],
      replyIntent: {
        ...base.replyIntent!, targetState: 'message_unavailable', author: null, excerpt: null
      }
    })).toBe(true)
  })

  it('treats only timeline nodes that overlap the visible viewport as observed', () => {
    const viewport = { top: 100, right: 500, bottom: 500, left: 100 }
    expect(rectanglesOverlap(
      { top: 120, right: 480, bottom: 240, left: 120 },
      viewport
    )).toBe(true)
    expect(rectanglesOverlap(
      { top: 500, right: 480, bottom: 620, left: 120 },
      viewport
    )).toBe(false)
    expect(rectanglesOverlap(
      { top: 120, right: 100, bottom: 240, left: 20 },
      viewport
    )).toBe(false)
  })

  it('accepts only file payloads and keeps a dragged directory as one attachment input', () => {
    const directoryFile = { name: '项目资料' } as File
    const directoryItem = {
      kind: 'file',
      getAsFile: () => directoryFile,
      webkitGetAsEntry: () => ({ isDirectory: true })
    } as unknown as DataTransferItem
    const transfer = {
      types: ['Files'],
      items: [directoryItem],
      files: [directoryFile]
    } as unknown as DataTransfer

    expect(dataTransferContainsFiles(transfer)).toBe(true)
    expect(attachmentDragKind(transfer)).toBe('directory')
    expect(droppedAttachmentInputs(transfer)).toEqual([
      { file: directoryFile, kindHint: 'directory' }
    ])
    expect(dataTransferContainsFiles({ types: ['text/plain'] } as unknown as DataTransfer))
      .toBe(false)
  })

  it('renders controlled shutdown as an assertive non-cancellable dialog with honest unknown copy', () => {
    const markup = renderToStaticMarkup(createElement(ControlledShutdownOverlay))
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('aria-labelledby="controlled-shutdown-title"')
    expect(markup).toContain('aria-describedby="controlled-shutdown-description"')
    expect(markup).toContain('正在停止运行并关闭 Rovai')
    expect(markup).toContain('执行引擎返回可靠终态')
    expect(markup).toContain('无法确认的执行也会停止')
    expect(markup).toContain('保留外部效果现场')
    expect(markup).not.toContain('<button')
  })

  it('uses Pending only for one-click creation and Active for the explicit Dialog', () => {
    expect(campActivationStateForCreation('one_click')).toBe('pending')
    expect(campActivationStateForCreation('dialog')).toBe('active')
  })

  it('projects one live Task card at creation and suppresses legacy status cards', () => {
    const task = {
      taskId: 'task-live-card',
      campId: 'camp-live-card',
      title: '更新后的任务标题',
      description: '只在任务详情显示',
      acceptanceCriteria: [],
      status: 'completed',
      assigneeAgentId: 'agent_2',
      blockedReason: null,
      completionSummary: '已经完成',
      cancelReason: null,
      createdByType: 'user',
      createdById: 'local_user',
      sourceAgentRunId: null,
      closedByType: 'user',
      closedById: 'local_user',
      closedByAgentRunId: null,
      version: 4,
      createdAt: '2026-08-05T02:00:00Z',
      updatedAt: '2026-08-05T02:10:00Z',
      closedAt: '2026-08-05T02:10:00Z',
      availableActions: []
    } satisfies CampSnapshot['tasks'][number]
    const message = (
      id: string,
      sequence: number,
      createdAt: string,
      presentation: CampSnapshot['messages'][number]['presentation'] = null
    ): CampSnapshot['messages'][number] => ({
      id,
      sequence,
      timelineGlobalSequence: sequence,
      authorType: presentation ? 'system' : 'user',
      authorId: presentation ? 'task-state' : 'local_user',
      sourceAgentRunId: null,
      body: presentation ? 'legacy task status' : id,
      content: [{ kind: 'text', text: presentation ? 'legacy task status' : id }],
      attachments: [],
      addressMode: presentation ? 'broadcast' : 'default',
      addressedAgentIds: [],
      replyToCampMessageId: null,
      campTurnId: null,
      presentation,
      createdAt
    })
    const legacyTaskPresentation = (
      fromStatus: 'pending' | 'in_progress',
      toStatus: 'in_progress' | 'completed'
    ): CampSnapshot['messages'][number]['presentation'] => ({
      kind: 'task_event',
      taskId: task.taskId,
      titleAtEvent: task.title,
      fromStatus,
      toStatus,
      assigneeNameAtEvent: '沐瓦',
      occurredAt: '2026-08-05T02:05:00Z'
    })
    const createdEvent = {
      globalSequence: 2,
      eventId: 'event-task-created',
      eventType: 'task.created',
      campId: 'camp-live-card',
      entityType: 'task',
      entityId: task.taskId,
      actorType: 'user',
      actorId: 'local_user',
      sourceAgentRunId: null,
      executionEpoch: null,
      payload: { status: 'pending' },
      createdAt: task.createdAt
    } satisfies CampSnapshot['timeline'][number]

    const projected = campConversationTimeline(
      [
        message('before-task', 1, '2026-08-05T01:59:00Z'),
        message('legacy-started', 3, '2026-08-05T02:05:00Z', legacyTaskPresentation('pending', 'in_progress')),
        message('legacy-completed', 4, '2026-08-05T02:10:00Z', legacyTaskPresentation('in_progress', 'completed')),
        message('after-task', 5, '2026-08-05T02:11:00Z')
      ],
      [],
      [createdEvent],
      [],
      [task]
    )

    expect(projected.map((item) => item.id)).toEqual([
      'before-task',
      `task:${task.taskId}`,
      'after-task'
    ])
    expect(projected[1]).toMatchObject({
      kind: 'task_card',
      timelineGlobalSequence: 2,
      task: {
        taskId: task.taskId,
        title: '更新后的任务标题',
        status: 'completed',
        assigneeAgentId: 'agent_2',
        version: 4
      }
    })

    const updated = campConversationTimeline([], [], [createdEvent], [], [{
      ...task,
      title: '再次更新标题',
      status: 'cancelled',
      completionSummary: null,
      cancelReason: '不再需要',
      assigneeAgentId: null,
      version: 5
    }])
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: `task:${task.taskId}`,
      kind: 'task_card',
      task: {
        title: '再次更新标题',
        status: 'cancelled',
        assigneeAgentId: null,
        version: 5
      }
    })
  })

  it('keeps a Task card when its creation event is outside the audit window', () => {
    const task = {
      taskId: 'task-old',
      campId: 'camp-old',
      title: '较早的任务',
      description: '',
      acceptanceCriteria: [],
      status: 'pending',
      assigneeAgentId: null,
      blockedReason: null,
      completionSummary: null,
      cancelReason: null,
      createdByType: 'user',
      createdById: 'local_user',
      sourceAgentRunId: null,
      closedByType: null,
      closedById: null,
      closedByAgentRunId: null,
      version: 1,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
      closedAt: null,
      availableActions: ['update']
    } satisfies CampSnapshot['tasks'][number]

    expect(campConversationTimeline([], [], [], [], [task])).toMatchObject([{
      id: 'task:task-old',
      kind: 'task_card',
      timelineGlobalSequence: null,
      createdAt: task.createdAt
    }])
  })

  it('presents ordinary, empty, valid, and invalid Git workspace capability states', () => {
    const inspection = (
      state: 'not_git' | 'git_valid' | 'git_invalid',
      headCommit: string | null = null
    ) => ({
      name: 'workspace',
      projectPath: '/workspace',
      gitObservation: {
        state,
        repositoryRoot: state === 'git_valid' ? '/workspace' : null,
        gitCommonDir: state === 'git_valid' ? '/workspace/.git' : null,
        objectFormat: state === 'git_valid' ? 'sha1' as const : null,
        headCommit,
        branch: null,
        dirty: state === 'git_valid' ? false : null,
        observedAt: '2026-07-30T00:00:00Z'
      }
    })

    expect(workspaceCapability(inspection('not_git')).label).toBe('普通目录')
    expect(workspaceCapability(inspection('git_valid')).label).toBe('空 Git 仓库')
    expect(workspaceCapability(inspection(
      'git_valid',
      '1111111111111111111111111111111111111111'
    )).label).toBe('Git 仓库')
    expect(workspaceCapability(inspection('git_invalid')).label).toBe('Git 状态异常')
    expect(workspaceCapability({ name: 'workspace', projectPath: '/workspace' }, 'loading'))
      .toMatchObject({ label: '正在检测 Git…', tone: 'neutral' })
    expect(workspaceCapability({ name: 'workspace', projectPath: '/workspace' }, 'failed'))
      .toMatchObject({ label: 'Git 检测失败', tone: 'attention' })
  })

  it('loads Runtime health only for member and Runtime settings views', () => {
    expect(shouldLoadRuntimeHealth('compose', 'skills', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('camp', 'skills', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('settings', 'skills', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('members', 'skills', false, false)).toBe(true)
    expect(shouldLoadRuntimeHealth('settings', 'runtime', false, false)).toBe(true)
    expect(shouldLoadRuntimeHealth('settings', 'diagnostics', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('members', 'skills', true, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('members', 'skills', false, true)).toBe(false)
  })

  it('merges an anchored message window without replacing newer snapshot messages', () => {
    const campMessage = (id: string, sequence: number, body: string): CampMessageView => ({
      id,
      sequence,
      timelineGlobalSequence: sequence,
      authorType: 'agent',
      authorId: 'agent_1',
      sourceAgentRunId: 'run-1',
      body,
      content: [{ kind: 'text', text: body }],
      attachments: [],
      addressMode: 'default',
      addressedAgentIds: [],
      replyToCampMessageId: null,
      campTurnId: null,
      presentation: null,
      createdAt: `2026-08-01T00:00:${String(sequence % 60).padStart(2, '0')}Z`
    })
    const latest = campMessage('message-latest', 1001, 'latest')
    const anchor = campMessage('message-anchor', 1, 'anchor')
    const neighbor = campMessage('message-neighbor', 2, 'neighbor')
    const snapshot = {
      messages: [latest]
    } as unknown as CampSnapshot

    const merged = campSnapshotWithAnchoredMessages(snapshot, [neighbor, anchor, latest])

    expect(merged.messages.map((entry) => entry.id)).toEqual([
      'message-anchor',
      'message-neighbor',
      'message-latest'
    ])
    expect(merged.messages.filter((entry) => entry.id === latest.id)).toHaveLength(1)
    expect(snapshot.messages).toEqual([latest])
    expect(campSnapshotWithCurrentAnchor(snapshot, 'camp-1', {
      campId: 'camp-1',
      messages: [anchor]
    }).messages.map((entry) => entry.id)).toEqual(['message-anchor', 'message-latest'])
    expect(campSnapshotWithCurrentAnchor(snapshot, 'camp-1', {
      campId: 'camp-other',
      messages: [anchor]
    })).toBe(snapshot)
  })

  it('requires a message rectangle to intersect the timeline viewport before auto-read', () => {
    const viewport = { top: 100, right: 500, bottom: 500, left: 100 }
    expect(rectanglesIntersect(
      { top: 450, right: 300, bottom: 550, left: 200 },
      viewport
    )).toBe(true)
    expect(rectanglesIntersect(
      { top: 500, right: 300, bottom: 550, left: 200 },
      viewport
    )).toBe(false)
    expect(rectanglesIntersect(
      { top: 0, right: 300, bottom: 100, left: 200 },
      viewport
    )).toBe(false)
    expect(rectanglesIntersect(
      { top: 200, right: 100, bottom: 300, left: 0 },
      viewport
    )).toBe(false)
  })

  it('binds presentation completion to the exact typed notification target', () => {
    const messageAction = {
      kind: 'open_camp_message',
      messageId: 'message-1',
      campTurnId: 'turn-1',
      approvalId: null
    } as NotificationActionView
    expect(notificationFocusMatchesAction({
      requestId: 1,
      kind: 'camp_message',
      campTurnId: 'turn-1',
      messageId: 'message-1'
    }, messageAction)).toBe(true)
    expect(notificationFocusMatchesAction({
      requestId: 2,
      kind: 'camp_message',
      campTurnId: 'turn-1',
      messageId: 'message-stale'
    }, messageAction)).toBe(false)
    expect(notificationFocusMatchesAction({
      requestId: 3,
      kind: 'camp_turn',
      campTurnId: 'turn-1'
    }, { ...messageAction, kind: 'open_camp_turn', messageId: null })).toBe(true)
    expect(notificationFocusMatchesAction({
      requestId: 4,
      kind: 'approval',
      campTurnId: null,
      approvalId: 'approval-1'
    }, { ...messageAction, kind: 'open_approval', messageId: null, approvalId: 'approval-1' })).toBe(true)
  })

  it('projects a user message into the conversation before Core acknowledgement', () => {
    const optimistic = optimisticCampMessage(
      null,
      'command-optimistic',
      {
        campId: 'camp-optimistic',
        body: '立即显示这条消息',
        content: [
          { kind: 'text', text: '立即显示这条消息 ' },
          { kind: 'member_mention', agentId: 'agent_2' },
          { kind: 'member_mention', agentId: 'agent_2' }
        ],
        revision: 3,
        attachments: [{
          id: 'attachment-1',
          displayName: '说明.txt',
          kind: 'file',
          fileCount: 1,
          mediaType: 'text/plain',
          byteSize: 12,
          previewKind: 'none',
          state: 'ready',
          errorMessage: null,
          createdAt: '2026-07-30T09:59:00Z'
        }],
        continuationIntent: null,
        replyIntent: {
          replyToCampMessageId: 'message-parent',
          targetState: 'available',
          author: {
            authorType: 'agent',
            authorId: 'agent_2',
            displayName: '芝士',
            recipientAvailability: 'available'
          },
          excerpt: '原消息',
          recipientSelectionRequired: false
        },
        updatedAt: '2026-07-30T09:59:00Z',
        expiresAt: '2026-08-06T09:59:00Z'
      },
      '2026-07-30T10:00:00Z'
    )

    expect(optimistic).toMatchObject({
      id: 'optimistic:command-optimistic',
      sequence: 1,
      authorType: 'user',
      authorId: 'local_user',
      body: '立即显示这条消息',
      addressMode: 'explicit',
      addressedAgentIds: ['agent_2'],
      replyToCampMessageId: 'message-parent',
      attachments: [{
        id: 'attachment-1',
        displayName: '说明.txt'
      }],
      timelineGlobalSequence: null
    })
    expect(campConversationTimeline([optimistic]).map((item) => item.id)).toEqual([
      'optimistic:command-optimistic'
    ])
  })

  it('submits only the exact Core Draft revision as message content authority', () => {
    const params = campMessageSendParams('command-1', 'camp-1', {
      campId: 'camp-1',
      body: '请 @沐瓦 检查',
      content: [{ kind: 'member_mention', agentId: 'agent_2' }],
      revision: 7,
      attachments: [],
      replyIntent: null,
      continuationIntent: null,
      updatedAt: '2026-08-03T00:00:00Z',
      expiresAt: '2026-08-10T00:00:00Z'
    })

    expect(params).toMatchObject({
      commandId: 'command-1',
      campId: 'camp-1',
      draftRevision: 7
    })
    expect(params).not.toHaveProperty('body')
    expect(params).not.toHaveProperty('address')
    expect(params).not.toHaveProperty('agentIds')
    expect(params).not.toHaveProperty('preparedAttachmentIds')
    expect(params).not.toHaveProperty('replyToCampMessageId')
    expect(params.execution).not.toHaveProperty('expectedOutput')
  })

  it('keeps local cancelling state until the authoritative turn becomes terminal', () => {
    const running = {
      turns: [{
        id: 'turn-running',
        triggerType: 'camp_message' as const,
        triggerId: 'message-1',
        status: 'running' as const,
        cancelRequestedAt: null,
        aggregateReasonCode: null,
        executionBudget: TEST_EXECUTION_BUDGET,
        version: 1,
        createdAt: '2026-07-30T10:00:00Z',
        updatedAt: '2026-07-30T10:00:00Z',
        endedAt: null
      }]
    }
    const cancellationSnapshot = {
      turns: [{
        id: 'turn-running',
        status: 'running' as const
      }, {
        id: 'turn-waiting-for-retry',
        status: 'waiting' as const
      }],
      agentRuns: [{
        campTurnId: 'turn-running',
        status: 'running' as const
      }, {
        campTurnId: 'turn-waiting-for-retry',
        status: 'failed' as const
      }]
    }
    expect(cancellableTurnIds(cancellationSnapshot)).toEqual(['turn-running'])
    expect(cancellableTurnIds(cancellationSnapshot, 'camp_cleanup')).toEqual([
      'turn-running',
      'turn-waiting-for-retry'
    ])

    const cancelling = new Set(['turn-running'])
    expect(reconcileCancellingTurnIds(cancelling, running)).toBe(cancelling)
    expect([...effectiveCancellingTurnIds(new Set(), {
      turns: running.turns.map((turn) => ({
        ...turn,
        cancelRequestedAt: '2026-07-30T10:00:01Z'
      }))
    })]).toEqual(['turn-running'])
    expect([...effectiveCancellingTurnIds(
      new Set(['turn-running', 'turn-from-another-camp']),
      running
    )]).toEqual(['turn-running'])

    const cancelled = {
      turns: running.turns.map((turn) => ({
        ...turn,
        status: 'cancelled' as const,
        cancelRequestedAt: '2026-07-30T10:00:01Z',
        endedAt: '2026-07-30T10:00:02Z'
      }))
    }
    expect([...reconcileCancellingTurnIds(cancelling, cancelled)]).toEqual([])
  })

  it('projects one terminal Stop outcome at the authoritative cancellation boundary', () => {
    const userMessage: CampMessageView = {
      id: 'message-stop',
      sequence: 1,
      timelineGlobalSequence: 10,
      authorType: 'user' as const,
      authorId: 'local_user',
      sourceAgentRunId: null,
      body: '停止这个执行',
      content: [{ kind: 'text', text: '停止这个执行' }],
      attachments: [],
      addressMode: 'default' as const,
      addressedAgentIds: ['agent-1'],
      replyToCampMessageId: null,
      campTurnId: 'turn-stop',
      presentation: null,
      createdAt: '2026-07-31T10:00:00Z'
    }
    const turn = {
      id: 'turn-stop',
      triggerType: 'camp_message' as const,
      triggerId: userMessage.id,
      status: 'cancelled' as const,
      cancelRequestedAt: '2026-07-31T10:02:18Z',
      aggregateReasonCode: null,
      executionBudget: TEST_EXECUTION_BUDGET,
      version: 3,
      createdAt: '2026-07-31T10:00:00Z',
      updatedAt: '2026-07-31T10:02:19Z',
      endedAt: '2026-07-31T10:02:19Z'
    }
    const timeline = [{
      globalSequence: 14,
      eventId: 'event-stop',
      eventType: 'camp_turn.cancel_requested',
      campId: 'camp-1',
      entityType: 'camp_turn',
      entityId: turn.id,
      actorType: 'user',
      actorId: 'local_user',
      sourceAgentRunId: null,
      executionEpoch: null,
      payload: { agentRunCount: 2 },
      createdAt: turn.cancelRequestedAt
    }]
    const agentRuns = [{
      campTurnId: turn.id,
      hasUnsettledExternalEffects: true
    }] as CampSnapshot['agentRuns']

    expect(formatStopElapsed(turn.createdAt, turn.cancelRequestedAt)).toBe('2分18秒')
    expect(formatStopElapsed('invalid', 'invalid')).toBe('0 秒')

    const projected = campConversationTimeline(
      [userMessage],
      [turn],
      timeline,
      agentRuns
    )
    expect(projected.map((item) => item.kind)).toEqual(['camp_message', 'stop_event'])
    expect(projected[1]).toMatchObject({
      id: 'stop:turn-stop',
      timelineGlobalSequence: 14,
      elapsedLabel: '2分18秒',
      hasUnsettledExternalEffects: true
    })

    expect(campConversationTimeline(
      [userMessage],
      [{ ...turn, status: 'waiting' as const, endedAt: null }],
      timeline,
      agentRuns
    ).map((item) => item.kind)).toEqual(['camp_message'])
  })

  it('defaults Inspector visibility on and restores only the explicit hidden preference', () => {
    expect(campInspectorVisibleFromStoredValue(null)).toBe(true)
    expect(campInspectorVisibleFromStoredValue('visible')).toBe(true)
    expect(campInspectorVisibleFromStoredValue('hidden')).toBe(false)
    expect(campInspectorVisibleFromStoredValue('legacy-value')).toBe(true)
  })

  it('shows unsettled external effects only after a failed or cancelled AgentRun', () => {
    expect(agentRunShowsUnsettledWarning({
      status: 'running',
      hasUnsettledExternalEffects: true
    })).toBe(false)
    expect(agentRunShowsUnsettledWarning({
      status: 'waiting',
      hasUnsettledExternalEffects: true
    })).toBe(false)
    expect(agentRunShowsUnsettledWarning({
      status: 'failed',
      hasUnsettledExternalEffects: true
    })).toBe(true)
    expect(agentRunShowsUnsettledWarning({
      status: 'cancelled',
      hasUnsettledExternalEffects: true
    })).toBe(true)
    expect(agentRunShowsUnsettledWarning({
      status: 'failed',
      hasUnsettledExternalEffects: false
    })).toBe(false)
  })

  it('requires continuation repair only after payload exists and never while reply owns routing', () => {
    const members: CampSnapshot['members'] = [{
      agentId: 'agent_2', displayName: '芝士', teamRole: 'Reviewer', avatarRef: null,
      accent: '#4F7F9F', membershipStatus: 'active', leaveRequestedAt: null,
      profilePresence: 'away', memberOrder: 1, isDefaultLead: false, version: 1
    }]
    const draft: CampComposerDraftView = {
      campId: 'camp-1', body: '继续', revision: 3, attachments: [],
      updatedAt: '2026-08-14T00:00:00Z', expiresAt: '2026-08-21T00:00:00Z',
      content: [{ kind: 'text', text: '继续' }], replyIntent: null,
      continuationIntent: {
        sourceCampMessageId: 'message-1', recipientSelectionRequired: false,
        recipient: {
          agentId: 'agent_2', displayName: '芝士', recipientAvailability: 'available'
        }
      }
    }
    expect(composerDraftNeedsContinuationRepair(draft, members, true)).toBe(true)
    expect(composerDraftNeedsContinuationRepair(draft, members, false)).toBe(false)
    expect(composerDraftNeedsContinuationRepair({
      ...draft,
      replyIntent: {
        replyToCampMessageId: 'message-2', targetState: 'available', excerpt: '引用',
        recipientSelectionRequired: false,
        author: {
          authorType: 'user', authorId: 'current-user', displayName: '你',
          recipientAvailability: 'not_applicable'
        }
      }
    }, members, true)).toBe(false)
  })

  it('keeps every Runtime option while placing cancel and deny first', () => {
    const options = [
      {
        optionId: 'session', kind: 'allow_session' as const, label: '本 Session 允许',
        consequence: '仅当前 Session。', nativeResponseDigest: 'session-digest'
      },
      {
        optionId: 'custom', kind: 'other' as const, label: 'Runtime 自定义',
        consequence: '保持 Runtime 原生语义。', nativeResponseDigest: 'custom-digest'
      },
      {
        optionId: 'once', kind: 'allow_once' as const, label: '允许一次',
        consequence: '仅当前请求。', nativeResponseDigest: 'once-digest'
      },
      {
        optionId: 'deny', kind: 'deny' as const, label: '拒绝',
        consequence: '不执行当前请求。', nativeResponseDigest: 'deny-digest'
      },
      {
        optionId: 'cancel', kind: 'cancel' as const, label: '取消',
        consequence: '取消当前请求。', nativeResponseDigest: 'cancel-digest'
      }
    ]

    expect(runtimeOptionsForDisplay(options).map((option) => option.optionId)).toEqual([
      'cancel',
      'deny',
      'custom',
      'once',
      'session'
    ])
    expect(runtimeOptionsForDisplay(options.slice(2)).map((option) => option.optionId)).toEqual([
      'cancel',
      'deny',
      'once'
    ])
  })

  it('renders the visible Camp header and limits structural drag strips to overlay pages', () => {
    const camp = {
      camp: { activationState: 'active', createdAt: '2026-07-31T00:00:00Z' },
      agentRuns: [{ status: 'running' }],
      approvals: [{ status: 'pending' }]
    } as unknown as CampSnapshot
    const campMarkup = renderToStaticMarkup(createElement(AppHeader, {
      campTitle: '会话界面',
      contextLabel: 'Quick Chat',
      camp,
      inspectorVisible: false,
      onToggleInspector: () => undefined,
      onFocusApprovals: () => undefined
    }))
    expect(campMarkup).toContain('Quick Chat')
    expect(campMarkup).not.toContain('运行中 1')
    expect(campMarkup).toContain('待审批 1')
    expect(campMarkup).toContain('aria-label="待审批 1，定位输入框上方审批"')
    expect(campMarkup).toContain('aria-label="显示右侧检查器"')
    expect(campMarkup).toContain('aria-pressed="false"')

    const composeStrip = renderToStaticMarkup(createElement(WindowDragStrip, {
      page: 'compose'
    }))
    const settingsStrip = renderToStaticMarkup(createElement(WindowDragStrip, {
      page: 'settings'
    }))
    expect(composeStrip).toContain('window-drag-strip-compose')
    expect(settingsStrip).toContain('window-drag-strip-settings')
    expect(composeStrip).toContain('aria-hidden="true"')
    expect(settingsStrip).toContain('aria-hidden="true"')
    expect(composeStrip).not.toContain('快速对话')
    expect(settingsStrip).not.toContain('设置')
    expect(windowDragStripPage('compose')).toBe('compose')
    expect(windowDragStripPage('settings')).toBe('settings')
    expect(windowDragStripPage('camp')).toBeNull()
    expect(windowDragStripPage('members')).toBeNull()
    expect(windowDragStripPage('memory')).toBeNull()
  })

  it('only acknowledges a Camp as viewed while that exact conversation is visible', () => {
    expect(campViewIsVisibleForReadAcknowledgement(
      'camp', 'camp-1', 'camp-1', 'visible', true
    )).toBe(true)
    expect(campViewIsVisibleForReadAcknowledgement(
      'settings', 'camp-1', 'camp-1', 'visible', true
    )).toBe(false)
    expect(campViewIsVisibleForReadAcknowledgement(
      'camp', 'camp-1', 'camp-1', 'hidden', true
    )).toBe(false)
    expect(campViewIsVisibleForReadAcknowledgement(
      'camp', 'camp-1', 'camp-1', 'visible', false
    )).toBe(false)
    expect(campViewIsVisibleForReadAcknowledgement(
      'camp', 'camp-1', 'camp-2', 'visible', true
    )).toBe(false)
  })

  it('keeps create mode independent from the currently selected member', () => {
    const selected = agentProfile()
    expect(memberIdentityTargetAgent('create', selected)).toBeNull()
    expect(memberIdentityTargetAgent('edit', selected)).toBe(selected)
  })

  it('keeps Quick Chat as a durable-Camp entry surface without a direct composer', () => {
    const markup = renderToStaticMarkup(createElement(QuickChatWorkspace, {
      agents: [],
      recentCamps: [],
      onOpenCamp: () => undefined,
      onNewConversation: () => undefined
    }))

    expect(markup).toContain('aria-label="快速对话"')
    expect(markup).toContain('>Quick Chat<')
    expect(markup).toContain('class="quick-chat-mark" data-brand-mark="horizon" data-brand-layout="separated"')
    expect(markup).toContain('data-brand-point="rendezvous"')
    expect(markup).toContain('开始下一段协作')
    expect(markup).not.toContain('Arctic Dawn')
    expect(markup).not.toContain('在晨光里')
    expect(markup).toContain('这里还没有可继续的对话。')
    expect(markup).toContain('>新对话</button>')
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('<form')
  })

  it('defaults to every present member and recommends the first Runtime Ready Lead', () => {
    const selection = initialCampSelection({
      admissible: true,
      presentMembers: [
        {
          agentId: 'agent-unready', displayName: '未就绪',
          memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'needs_attention'
        },
        {
          agentId: 'agent-ready', displayName: '已就绪',
          memberOrder: 1, runtimeConfigured: true, runtimeReadiness: 'ready'
        }
      ],
      initialLeadAgentId: 'agent-ready',
      blockers: []
    })

    expect(selection).toEqual({
      memberIds: ['agent-unready', 'agent-ready'],
      leadId: 'agent-ready'
    })
  })

  it('normalizes optional Camp names before applying the local scalar boundary', () => {
    expect(normalizeDraftName('  重构\n\tMCP  设置页  ')).toBe('重构 MCP 设置页')
    expect(Array.from(normalizeDraftName('😀'.repeat(80))).length).toBe(80)
    expect(Array.from(normalizeDraftName(limitDraftNameInput('😀'.repeat(81)))).length).toBe(80)
    expect(limitDraftNameInput('  重构   MCP  ')).toBe('  重构   MCP  ')
  })

  it('prefers saved default members and keeps invalid stored defaults outside the dialog draft', () => {
    const preflight = {
      admissible: true,
      presentMembers: [
        { agentId: 'agent-a', displayName: '洛可', memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'ready' as const },
        { agentId: 'agent-b', displayName: '沐瓦', memberOrder: 1, runtimeConfigured: true, runtimeReadiness: 'ready' as const }
      ],
      initialLeadAgentId: 'agent-a',
      blockers: []
    }
    expect(initialCampSelection(preflight, {
      memberAgentIds: ['agent-b', 'removed-agent'],
      defaultLeadAgentId: 'removed-agent'
    })).toEqual({ memberIds: ['agent-b'], leadId: 'agent-b' })
  })

  it('explains invalid saved members and a temporary Lead without changing the saved defaults', () => {
    const preflight = {
      admissible: true,
      presentMembers: [
        { agentId: 'agent-a', displayName: '洛可', memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'ready' as const }
      ],
      initialLeadAgentId: 'agent-a',
      blockers: []
    }
    const preferred = {
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-b'
    }
    const agents = [
      { ...agentProfile(), agentId: 'agent-a', displayName: '洛可' },
      { ...agentProfile(), agentId: 'agent-b', displayName: '沐瓦', presence: 'away' as const }
    ]
    const plan = planInitialCampSelection(preflight, preferred)

    expect(plan).toMatchObject({
      memberIds: ['agent-a'],
      leadId: 'agent-a',
      excludedMemberIds: ['agent-b'],
      usedPresentMembersFallback: false,
      leadChanged: true
    })
    expect(describeInitialCampSelectionAdjustments(plan, preferred, agents)).toEqual({
      items: [
        '沐瓦已暂时离队，本次未加入',
        '原默认负责人 沐瓦已暂时离队',
        '本次暂时选择洛可作为负责人'
      ],
      note: '以上调整只用于本次创建，不会修改“设置 → 通用”中保存的默认配置。'
    })
    expect(preferred).toEqual({
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-b'
    })
  })

  it('explains a latched invalid configuration that is currently selectable', () => {
    const preflight = {
      admissible: true,
      presentMembers: [
        { agentId: 'agent-a', displayName: '洛可', memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'ready' as const }
      ],
      initialLeadAgentId: 'agent-a',
      blockers: []
    }
    const preferred = { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' }
    const explanation = describeInitialCampSelectionAdjustments(
      planInitialCampSelection(preflight, preferred),
      preferred,
      [{ ...agentProfile(), agentId: 'agent-a', displayName: '洛可' }]
    )
    expect(explanation?.items).toEqual([
      '已保存配置曾失效，本次仍按当前可用的保存值预选，请确认后创建'
    ])
  })

  it('explains when every saved member is replaced in the dialog draft', () => {
    const preflight = {
      admissible: true,
      presentMembers: [
        { agentId: 'agent-a', displayName: '洛可', memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'ready' as const }
      ],
      initialLeadAgentId: 'agent-a',
      blockers: []
    }
    const preferred = { memberAgentIds: ['agent-b'], defaultLeadAgentId: 'agent-b' }
    const agents = [
      { ...agentProfile(), agentId: 'agent-a', displayName: '洛可' },
      { ...agentProfile(), agentId: 'agent-b', displayName: '沐瓦', presence: 'removed' as const, removedAt: '2026-08-09T00:00:00Z' }
    ]
    const explanation = describeInitialCampSelectionAdjustments(
      planInitialCampSelection(preflight, preferred),
      preferred,
      agents
    )

    expect(explanation?.items).toEqual([
      '沐瓦已永久移除，本次未加入',
      '默认队员均不可用，本次暂时选择全部当前在队队员：洛可',
      '原默认负责人 沐瓦已永久移除',
      '本次暂时选择洛可作为负责人'
    ])
  })

  it('protects the last member, switches a removed Lead, and preserves a manual Lead', () => {
    const removedLead = toggleCampMemberSelection({
      memberIds: ['agent-a', 'agent-b'],
      leadId: 'agent-a',
      toggledMemberId: 'agent-a',
      stableMemberOrder: ['agent-a', 'agent-b']
    })
    expect(removedLead).toEqual({
      memberIds: ['agent-b'],
      leadId: 'agent-b',
      blocked: false
    })

    expect(toggleCampMemberSelection({
      ...removedLead,
      toggledMemberId: 'agent-b',
      stableMemberOrder: ['agent-a', 'agent-b']
    })).toEqual({
      memberIds: ['agent-b'],
      leadId: 'agent-b',
      blocked: true
    })

    expect(toggleCampMemberSelection({
      ...removedLead,
      toggledMemberId: 'agent-a',
      stableMemberOrder: ['agent-a', 'agent-b']
    })).toEqual({
      memberIds: ['agent-a', 'agent-b'],
      leadId: 'agent-b',
      blocked: false
    })
  })

  it('derives the initial Quick Chat preflight from the already loaded member order', () => {
    const unconfigured = agentProfile()
    const configured: AgentProfile = {
      ...agentProfile(),
      agentId: 'agent_1',
      displayName: '洛可',
      memberOrder: 1,
      runtimeConfiguration: {
        adapterKind: 'codex-cli',
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind: 'codex-cli',
          schemaVersion: 1,
          values: {
            sandbox_mode: 'workspace-write',
            approval_policy: 'on-request'
          }
        }
      },
      runtimeReadiness: { status: 'needs_attention', blockers: [] }
    }
    expect(campCreationPreflightFromAgents([configured, unconfigured])).toEqual({
      admissible: true,
      presentMembers: [
        {
          agentId: unconfigured.agentId,
          displayName: unconfigured.displayName,
          memberOrder: 0,
          runtimeConfigured: false,
          runtimeReadiness: 'runtime_not_configured'
        },
        {
          agentId: configured.agentId,
          displayName: configured.displayName,
          memberOrder: 1,
          runtimeConfigured: true,
          runtimeReadiness: 'needs_attention'
        }
      ],
      initialLeadAgentId: unconfigured.agentId,
      blockers: []
    })
  })

  it('orders Camp navigation by the authoritative activity sequence', () => {
    const baseCamp = {
      title: '对话', activationState: 'active' as const,
      projectBindingKind: 'directory' as const, projectPath: '/repo',
      defaultLead: null, marker: 'none' as const, lastActivityAt: '2026-07-22T00:00:00Z',
      latestCompletionGlobalSequence: 0, version: 1
    }
    const camps = allNavigationCamps({
      schemaVersion: 3,
      throughGlobalSequence: 20,
      quickChat: {
        totalCount: 1,
        recentCamps: [{
          ...baseCamp, id: 'older', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
          lastActivityGlobalSequence: 9
        }]
      },
      projects: [{
        projectKey: 'directory:/repo', name: 'rovai', projectPath: '/repo',
        lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 10,
        totalCount: 1,
        recentCamps: [{
          ...baseCamp, id: 'newer',
          lastActivityGlobalSequence: 10
        }]
      }]
    })
    expect(camps.map((camp) => camp.id)).toEqual(['newer', 'older'])
  })

  it('defines the final unified Camp and Project menu labels', () => {
    expect(campNavigationMenuLabels(false)).toEqual(['置顶', '重命名', '复制会话 ID', '删除'])
    expect(campNavigationMenuLabels(true)).toEqual(['取消置顶', '重命名', '复制会话 ID', '删除'])
    expect(projectNavigationMenuLabels(false)).toEqual(['置顶项目', '移除项目'])
    expect(projectNavigationMenuLabels(true)).toEqual(['取消置顶项目', '移除项目'])
  })

  it('copies only the exact Camp ID and reports clipboard failures', async () => {
    const copied: string[] = []
    await copyCampIdToClipboard('camp-copy-target', async (text) => {
      copied.push(text)
      return true
    })
    expect(copied).toEqual(['camp-copy-target'])

    await expect(copyCampIdToClipboard('camp-copy-target', async () => false))
      .rejects.toThrow('无法复制会话 ID，请重试。')
    await expect(copyCampIdToClipboard('camp-copy-target', async () => {
      throw new Error('clipboard unavailable')
    })).rejects.toThrow('无法复制会话 ID，请重试。')
  })

  it('renders Camp-first navigation with unified menus and Quick Chat as the last visual project', () => {
    const longTitle = '围绕多 Agent 协作控制面梳理一个足够长、必须由真实侧栏宽度裁切的对话标题'
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'camp',
      state: 'ready',
      navigation: {
        schemaVersion: 3,
        throughGlobalSequence: 12,
        quickChat: {
          totalCount: 12,
          recentCamps: [{
            id: 'camp-quick-chat', title: '快速对话讨论', activationState: 'active', projectPath: '/quick-chat',
            projectBindingKind: 'quick_chat', defaultLead: null, marker: 'none',
            lastActivityAt: '2026-07-22T00:00:00Z', lastActivityGlobalSequence: 10,
            latestCompletionGlobalSequence: 0, version: 1
          }]
        },
        projects: [{
          projectKey: 'directory:/repo', name: 'rovai-ai', projectPath: '/repo',
          lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 12,
          totalCount: 1,
          recentCamps: [{
            id: 'camp-project', title: longTitle, activationState: 'active', projectPath: '/repo',
            projectBindingKind: 'directory', defaultLead: null, marker: 'unread_completed',
            lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 12,
            latestCompletionGlobalSequence: 12, version: 2
          }]
        }]
      },
      activeCampId: 'camp-project',
      pins: [
        { kind: 'camp', targetKey: 'camp-quick-chat', pinnedAt: '2026-07-30T10:00:00Z' },
        { kind: 'project', targetKey: 'directory:/repo', pinnedAt: '2026-07-30T11:00:00Z' }
      ],
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 2,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('新对话')
    expect(markup).toContain('aria-label="Rovai AI"')
    expect(markup).toContain('data-brand-mark="horizon"')
    expect(markup).toContain('data-brand-layout="separated"')
    expect(markup).toContain('data-brand-point="rendezvous"')
    expect(markup).toContain('<strong>Rovai AI</strong>')
    expect(markup).toContain('队员')
    expect(markup).toContain('记忆，2 条普通提案待确认')
    expect(markup).toContain('id="pinned-heading">置顶')
    expect(markup).toContain('快速对话讨论')
    expect(markup).toContain('rovai-ai')
    expect(markup).toContain(longTitle)
    expect(markup).toContain('管理')
    expect(markup).toContain('aria-label="管理项目“rovai-ai”"')
    expect(markup).toContain('aria-label="管理“快速对话讨论”"')
    expect(markup).toContain('aria-label="在“rovai-ai”中新建对话"')
    expect(markup).toContain('aria-label="在“快速对话”中新建对话"')
    expect(markup).toContain('class="project-heading-row current-project"')
    expect(markup).toContain('class="project-select-row"')
    expect(markup).not.toContain('class="project-disclosure-button"')
    expect(markup).toContain('data-sidebar-menu-target="project:directory:/repo"')
    expect(markup).toContain('data-sidebar-menu-target="camp:camp-quick-chat"')
    expect(markup).not.toContain('data-sidebar-menu-target="project:quick-chat"')
    expect(markup).not.toContain('row-pin-button')
    expect(markup).not.toContain('group-pin-button')
    expect(markup).not.toContain('camp-group-count')
    expect(markup).toContain('查看更多')
    expect(markup).not.toContain('查看全部')
    expect(markup).not.toContain('5 / 12')
    expect(markup).toContain('设置')
    expect(markup).toContain('viewBox="0 0 24 24"')
    expect(markup.indexOf('id="projects-heading"')).toBeLessThan(markup.indexOf('data-group="quick-chat"'))
    expect(markup).not.toContain('北极晨光 · Workspace')
    expect(markup).not.toContain('Core 尚未检测')
    expect(markup).not.toContain('⌄')
    expect(markup).toContain('data-group="directory:/repo"')
    expect(markup).not.toContain('data-group="pinned-directory:/repo"')
    expect(markup).not.toContain('最近任务')
    expect(markup).not.toContain('Lumen AI')
    expect(markup).not.toContain('Horizonward')
  })

  it('renders the current empty workspace without inventing a pinnable Core project', () => {
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'camp',
      state: 'ready',
      navigation: {
        schemaVersion: 3,
        throughGlobalSequence: 1,
        quickChat: { totalCount: 0, recentCamps: [] },
        projects: [{
          projectKey: 'directory:/repo/empty-project',
          name: 'empty-project',
          projectPath: '/repo/empty-project',
          lastActivityAt: '',
          lastActivityGlobalSequence: 0,
          totalCount: 0,
          recentCamps: []
        }]
      },
      activeCampId: null,
      currentProjectKey: 'directory:/repo/empty-project',
      shellOnlyProjectPath: '/repo/empty-project',
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('data-group="directory:/repo/empty-project"')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('empty-project')
    expect(markup).toContain('还没有对话')
    expect(markup).toContain('管理项目“empty-project”')
  })

  it('keeps navigation marker slots stable and lets the project row control selection and disclosure', () => {
    const makeCamp = (id: string, marker: 'none' | 'unread_completed' | 'loading') => ({
      id,
      title: `${id} 对话`,
      activationState: 'pending' as const,
      projectPath: '/repo',
      projectBindingKind: 'directory' as const,
      defaultLead: null,
      marker,
      lastActivityAt: '2026-08-05T00:00:00Z',
      lastActivityGlobalSequence: 1,
      latestCompletionGlobalSequence: 0,
      version: 1
    })
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'camp',
      state: 'ready',
      navigation: {
        schemaVersion: 3,
        throughGlobalSequence: 1,
        quickChat: { totalCount: 0, recentCamps: [] },
        projects: [{
          projectKey: 'directory:/repo',
          name: 'rovai-ai',
          projectPath: '/repo',
          lastActivityAt: '2026-08-05T00:00:00Z',
          lastActivityGlobalSequence: 1,
          totalCount: 3,
          recentCamps: [makeCamp('plain', 'none'), makeCamp('unread', 'unread_completed'), makeCamp('running', 'loading')]
        }]
      },
      activeCampId: 'plain',
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup.match(/class="camp-marker-slot"/g)).toHaveLength(3)
    expect(markup).not.toContain('camp-marker-none')
    expect(markup).toContain('camp-marker-unread_completed')
    expect(markup).toContain('camp-marker-loading')
    expect(markup).toContain('aria-label="unread 对话，有新回复"')
    expect(markup).toContain('title="unread 对话 · 有新回复"')
    expect(markup).toContain('<span class="sr-only">有新回复</span>')
    expect(markup).toContain('role="img" aria-label="正在运行"')
    expect(markup.match(/class="camp-draft-badge">草稿/g)).toHaveLength(3)
    expect(markup).toContain('aria-expanded="true" aria-controls="camp-group-content-directory--repo"')
    expect(markup).toContain('project-folder-open')
    expect(markup).toContain('project-folder-closed')
    expect(markup).not.toContain('project-disclosure-button')
    const selectStart = markup.indexOf('class="project-select-row"')
    const selectEnd = markup.indexOf('</button>', selectStart)
    const menuStart = markup.indexOf('group-menu-trigger')
    const createStart = markup.indexOf('group-create-button')
    expect(menuStart).toBeGreaterThan(selectEnd)
    expect(createStart).toBeGreaterThan(menuStart)
  })

  it('keeps project disclosure state stable without coupling it to Camp pagination', () => {
    const collapsed = toggleNavigationGroup(new Set<string>(), 'directory:/repo')
    expect(collapsed.has('directory:/repo')).toBe(true)
    const reopened = toggleNavigationGroup(collapsed, 'directory:/repo')
    expect(reopened.has('directory:/repo')).toBe(false)
    expect(toggleNavigationGroup(new Set(['directory:/repo']), 'quick-chat')).toEqual(
      new Set(['directory:/repo', 'quick-chat'])
    )
  })

  it('replaces ordinary navigation with the grouped settings category list', () => {
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'settings',
      state: 'ready',
      navigation: null,
      activeCampId: null,
      settingsSection: 'diagnostics',
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onSettingsSectionChange: () => undefined,
      onSettingsBack: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('aria-label="设置分类"')
    expect(markup).toContain('aria-label="Rovai AI"')
    expect(markup).toContain('返回 App')
    expect(markup).toContain('应用级偏好与本机能力')
    expect(markup.match(/class="settings-sidebar-group"/g)).toHaveLength(3)
    const applicationHeading = '<h2 id="settings-sidebar-group-application" class="settings-sidebar-group-title">应用</h2>'
    const capabilitiesHeading = '<h2 id="settings-sidebar-group-capabilities" class="settings-sidebar-group-title">能力</h2>'
    const supportHeading = '<h2 id="settings-sidebar-group-support" class="settings-sidebar-group-title">支持</h2>'
    const applicationStart = markup.indexOf(applicationHeading)
    const capabilitiesStart = markup.indexOf(capabilitiesHeading)
    const supportStart = markup.indexOf(supportHeading)
    expect(applicationStart).toBeGreaterThanOrEqual(0)
    expect(applicationStart).toBeLessThan(capabilitiesStart)
    expect(capabilitiesStart).toBeLessThan(supportStart)
    const applicationGroup = markup.slice(applicationStart, capabilitiesStart)
    const capabilitiesGroup = markup.slice(capabilitiesStart, supportStart)
    const supportGroup = markup.slice(supportStart)
    expect(applicationGroup).toContain('<strong>通用</strong>')
    expect(applicationGroup).toContain('<strong>外观</strong>')
    expect(applicationGroup).toContain('<strong>提醒</strong>')
    expect(applicationGroup.indexOf('<strong>通用</strong>')).toBeLessThan(applicationGroup.indexOf('<strong>外观</strong>'))
    expect(applicationGroup.indexOf('<strong>外观</strong>')).toBeLessThan(applicationGroup.indexOf('<strong>提醒</strong>'))
    expect(capabilitiesGroup).toContain('<strong>Skill</strong>')
    expect(capabilitiesGroup).toContain('<strong>MCP</strong>')
    expect(capabilitiesGroup).toContain('<strong>Agent 运行时</strong>')
    expect(capabilitiesGroup.indexOf('<strong>Skill</strong>')).toBeLessThan(capabilitiesGroup.indexOf('<strong>MCP</strong>'))
    expect(capabilitiesGroup.indexOf('<strong>MCP</strong>')).toBeLessThan(capabilitiesGroup.indexOf('<strong>Agent 运行时</strong>'))
    expect(supportGroup).toContain('<strong>诊断与修复</strong>')
    expect(markup).toContain('class="active" type="button" aria-current="page"')
    expect(markup).not.toContain('关于与更新')
    expect(markup).not.toContain('新对话')
    expect(markup).not.toContain('快速对话')
    expect(markup).not.toContain('Core')
  })

  it('maps each settings category to its corresponding right-side content', () => {
    const baseProps = {
      appearance: { preference: 'system' as const, resolvedTheme: 'day' as const },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }
    const contentBySection: Record<NavigationSettingsSection, string> = {
      general: '通用',
      skills: 'Skill 管理',
      mcp: 'MCP 配置',
      runtime: 'Agent 运行时',
      appearance: '外观',
      notifications: '提醒',
      diagnostics: '诊断与修复'
    }
    for (const [section, heading] of Object.entries(contentBySection) as Array<[NavigationSettingsSection, string]>) {
      const markup = renderToStaticMarkup(createElement(SettingsView, { ...baseProps, section }))
      expect(markup).toContain(`<h1>${heading}</h1>`)
      expect(markup.match(/class="settings-page-heading"/g)).toHaveLength(1)
      expect(markup).not.toContain('project-hero')
    }
  })

  it('keeps only lightweight in-app reminder settings', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'system', resolvedTheme: 'day' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      section: 'notifications',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).not.toContain('notification-center-link')
    expect(markup).not.toContain('打开通知中心')
    expect(markup).toContain('Rovai AI 不在前台时会先保留')
    expect(markup).toContain('aria-label="应用内提醒设置"')
    expect(markup).toContain('正在读取提醒设置')
    expect(markup).not.toContain('持久边界')
  })

  it('keeps the resolved theme and saved preference in the Appearance page header', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'night', resolvedTheme: 'night' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      section: 'appearance',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).toContain('当前 · Steel Night · 偏好：夜间')
    expect(markup).toContain('瓷灰日间与 Steel Night 共享全部产品功能')
    expect(markup).not.toContain('当前视觉语言')
  })

  it('places the real Runtime rescan action in the shared page header', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'system', resolvedTheme: 'day' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      section: 'runtime',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))
    const headerEnd = markup.indexOf('</header>')
    const rescan = markup.indexOf('重新检测全部')
    const directory = markup.indexOf('Agent 运行时目录')

    expect(markup.match(/class="settings-page-heading"/g)).toHaveLength(1)
    expect(rescan).toBeGreaterThan(0)
    expect(rescan).toBeLessThan(headerEnd)
    expect(headerEnd).toBeLessThan(directory)
    expect(markup).toContain('高级诊断与自定义启动入口')
  })

  it('replaces project navigation with the member roster on the members page', () => {
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'members',
      state: 'ready',
      navigation: {
        schemaVersion: 3,
        throughGlobalSequence: 1,
        quickChat: { totalCount: 0, recentCamps: [] },
        projects: [{
          projectKey: 'directory:/repo',
          name: 'should-not-render',
          projectPath: '/repo',
          lastActivityAt: '2026-08-01T00:00:00Z',
          lastActivityGlobalSequence: 0,
          totalCount: 0,
          recentCamps: []
        }]
      },
      activeCampId: null,
      memberSidebar: createElement('section', { 'aria-label': '队员名册' }, '唯一队员名册'),
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('唯一队员名册')
    expect(markup).toContain('跳转到对话')
    expect(markup).toContain('新对话')
    expect(markup).toContain('设置')
    expect(markup).not.toContain('should-not-render')
    expect(markup).not.toContain('id="projects-heading"')
  })

  it('keeps an unready Default Lead selectable while warning that execution is blocked', () => {
    const profile = agentProfile()
    const unreadyProfile: AgentProfile = {
      ...profile,
      agentId: 'agent_1',
      displayName: '洛可',
      runtimeConfiguration: null,
      runtimeReadiness: { status: 'runtime_not_configured', blockers: [] }
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 29,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-1', title: 'Lead 调整', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1',
        version: 2, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z'
      },
      members: [{
        agentId: 'agent_1', displayName: '洛可', teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
        isDefaultLead: true, version: 1
      }],
      tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
      contextManifests: [], executionEvidence: [],
      approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [unreadyProfile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      inspectorTab: 'members',
      runtimeRecovery: {
        campId: 'camp-1',
        targets: [{
          agentId: 'agent_1',
          blockerCode: 'runtime_not_configured'
        }]
      },
      onConfigureRuntime: () => undefined,
      onDismissRuntimeRecovery: () => undefined
    }))

    expect(markup).toContain('给 洛可 发消息')
    expect(markup).not.toContain('默认由 Lead · 洛可接收')
    expect(markup).toContain('开始这段协作')
    expect(markup).toContain('快速对话')
    expect(markup).toContain('负责人 · 洛可')
    expect(markup).toContain('1 位队员已在队')
    expect(markup).toContain('Agent 运行时不可用')
    expect(markup).toContain('先了解项目')
    expect(markup).toContain('整理成任务')
    expect(markup).toContain('检查工作区')
    expect(markup).toContain('队员 <small>1</small>')
    expect(markup).toContain('协作队员')
    expect(markup).toContain('默认负责人 · 洛可')
    expect(markup).toContain('1 位在队 · 0 位暂离')
    expect(markup).not.toContain('上下文投递')
    expect(markup).not.toContain('AgentRun 上下文投递清单')
    expect(markup).not.toContain('value="approvals"')
    expect(markup).not.toContain('当前 Camp 上下文')
    expect(markup).toContain('消息未发送')
    expect(markup).toContain('1 位目标队员暂时不可执行')
    expect(markup).toContain('草稿已保留')
    expect(markup).toContain('尚未配置 Agent 运行时')
    expect(markup).toContain('配置洛可的 Agent 运行时')
    expect(markup.indexOf('class="runtime-recovery-dock"')).toBeLessThan(markup.indexOf('class="composer"'))
    expect(markup).toMatch(
      /<div class="composer-actions"><span class="composer-hint">Enter<\/span><button class="primary-button composer-send"/
    )
    expect(markup).not.toContain('agent_run.runtime_not_ready')
    expect(markup).not.toContain('agent_1')
    expect(markup).not.toContain('Runtime')
  })

  it('turns runtime admission rejection into a scoped composer recovery', () => {
    const result = {
      commandId: 'command-runtime-recovery',
      commandType: 'camp.message.send',
      requestDigest: 'digest',
      requestDigestVersion: 1,
      status: 'rejected' as const,
      code: 'agent_run.runtime_not_ready',
      payload: {
        agentId: 'agent_2',
        conversationId: 'conversation-1',
        blockerCode: 'runtime_authentication_required',
        detail: 'raw runtime detail'
      },
      resultEntity: null,
      recordedAt: '2026-08-06T00:00:00Z'
    }

    expect(runtimeRecoveryFromCommandResult('camp-1', result)).toEqual({
      campId: 'camp-1',
      targets: [{
        agentId: 'agent_2',
        blockerCode: 'runtime_authentication_required'
      }]
    })
    expect(commandFailureMessage(result)).toBe('目标队员的 Agent 运行时暂不可用。')
    expect(runtimeRecoveryFromCommandResult('camp-1', {
      ...result,
      code: 'camp_message.no_addressable_member'
    })).toBeNull()
    expect(runtimeRecoveryFromCommandResult('camp-1', {
      ...result,
      payload: { blockerCode: 'runtime_not_configured' }
    })).toBeNull()
    expect(commandFailureMessage({ ...result, code: 'reply_recipient_required' }))
      .toBe('原作者当前不可接收，请选择其他成员。')
    expect(commandFailureMessage({ ...result, code: 'mention_target_unavailable' }))
      .toBe('消息未发送：一位收件人当前不可接收，请重新选择。')
    expect(commandFailureMessage({ ...result, code: 'camp_message.invalid_reply' }))
      .toBe('消息未发送：引用的消息当前不可用。请取消引用后重试。')
  })

  it('summarizes empty Camp runtime readiness without inventing Ready state', () => {
    const member = {
      agentId: 'agent_1', displayName: '洛可', teamRole: 'Lead',
      avatarRef: null, accent: '#D56A4A', membershipStatus: 'active' as const, leaveRequestedAt: null,
      profilePresence: 'present' as const, memberOrder: 0, isDefaultLead: true,
      version: 1
    }
    const ready = {
      ...agentProfile(),
      agentId: member.agentId,
      runtimeReadiness: { status: 'ready' as const, blockers: [] }
    }
    const unready = {
      ...ready,
      agentId: 'agent_2',
      runtimeReadiness: { status: 'needs_attention' as const, blockers: [] }
    }
    const secondMember = {
      ...member,
      agentId: unready.agentId,
      displayName: '沐瓦',
      isDefaultLead: false,
      memberOrder: 1
    }

    expect(emptyCampRuntimeSummary([member], [])).toBe('正在检查 Agent 运行时…')
    expect(emptyCampRuntimeSummary([member], [ready])).toBe('Agent 运行时可用')
    expect(emptyCampRuntimeSummary([member, secondMember], [ready, unready])).toBe('1/2 个 Agent 运行时可用')
    expect(emptyCampRuntimeSummary([{ ...member, profilePresence: 'away' }], [ready])).toBe('暂无在队的队员')
  })

  it('projects current Camp members and admits only present members as Default Lead', () => {
    const present: CampSnapshot['members'][number] = {
      agentId: 'agent_present', displayName: '洛可', teamRole: '协调',
      avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null,
      profilePresence: 'present', memberOrder: 2, isDefaultLead: true, version: 1
    }
    const away: CampSnapshot['members'][number] = {
      ...present,
      agentId: 'agent_away', displayName: '沐瓦', membershipStatus: 'active',
      profilePresence: 'away', memberOrder: 1, isDefaultLead: false
    }
    const leaving: CampSnapshot['members'][number] = {
      ...present,
      agentId: 'agent_leaving', displayName: '栖鹿', leaveRequestedAt: '2026-08-11T00:00:00Z',
      memberOrder: 3, isDefaultLead: false
    }
    const removed: CampSnapshot['members'][number] = {
      ...present,
      agentId: 'agent_removed', displayName: '已移除', profilePresence: 'removed',
      memberOrder: 0, isDefaultLead: false
    }
    const left: CampSnapshot['members'][number] = {
      ...present,
      agentId: 'agent_left', displayName: '已离开', membershipStatus: 'left',
      memberOrder: 4, isDefaultLead: false
    }

    expect(campInspectorMembers([present, removed, left, leaving, away]).map((member) => member.agentId)).toEqual([
      'agent_away',
      'agent_present',
      'agent_leaving'
    ])
    expect(campMemberIsLeadEligible(present)).toBe(true)
    expect(campMemberIsLeadEligible(away)).toBe(false)
    expect(campMemberIsLeadEligible(leaving)).toBe(false)
    expect(campMemberIsLeadEligible(left)).toBe(false)
  })

  it('keeps the Camp composer interactive when reconciliation leaves no Default Lead', () => {
    const profile: AgentProfile = {
      ...agentProfile(),
      agentId: 'agent_1',
      displayName: '洛可',
      presence: 'away'
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 29,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-empty', title: '暂无可用队员', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: null,
        version: 2, createdAt: '2026-07-27T00:00:00Z', updatedAt: '2026-07-27T00:00:00Z'
      },
      members: [{
        agentId: profile.agentId, displayName: profile.displayName, teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'away', memberOrder: 0,
        isDefaultLead: false, version: 1
      }],
      tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
      contextManifests: [], executionEvidence: [],
      approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('给 默认负责人 发消息')
    expect(markup).not.toMatch(/id="camp-message"[^>]*disabled/)
    expect(commandFailureMessage({
      commandId: 'command-1',
      commandType: 'camp.message.send',
      requestDigest: 'digest',
      requestDigestVersion: 1,
      status: 'rejected',
      code: 'camp_message.no_addressable_member',
      payload: { message: 'Execution request requires at least one addressable Agent' },
      resultEntity: null,
      recordedAt: '2026-07-27T00:00:00Z'
    })).toBe('当前无可用队员。')
  })

  it('renders a copy action and routes one long-lived execution entry per Agent', () => {
    const profile = {
      ...agentProfile(),
      agentId: 'agent_2',
      displayName: '沐瓦',
      runtimeReadiness: { status: 'ready' as const, blockers: [] }
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 29,
      throughGlobalSequence: 3,
      camp: {
        id: 'camp-live', title: '实现功能', activationState: 'active', projectBindingKind: 'directory', projectPath: '/repo',
        defaultLeadAgentId: 'agent_2',
        version: 1, createdAt: '2026-07-28T05:00:00Z', updatedAt: '2026-07-28T05:01:00Z'
      },
      members: [{
        agentId: 'agent_2', displayName: '沐瓦', teamRole: '开发者',
        avatarRef: null, accent: '#39777a', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
        memberOrder: 0, isDefaultLead: true, version: 1
      }],
      tasks: [],
      messageDeliveries: [],
      messages: [{
        id: 'message-user', sequence: 1, timelineGlobalSequence: 1,
        authorType: 'user', authorId: 'local_user',
        sourceAgentRunId: null, body: '请 @沐瓦 实现复制。',
        content: [
          { kind: 'text', text: '请 ' },
          { kind: 'member_mention', agentId: 'agent_2' },
          { kind: 'text', text: ' 实现复制。' }
        ],
        addressMode: 'explicit',
        attachments: [],
        addressedAgentIds: ['agent_2'], replyToCampMessageId: null,
        campTurnId: 'turn-1', presentation: null, createdAt: '2026-07-28T05:00:00Z'
      }],
      turns: [{
        id: 'turn-1', triggerType: 'camp_message', triggerId: 'message-user', status: 'running',
        cancelRequestedAt: null, aggregateReasonCode: null, executionBudget: TEST_EXECUTION_BUDGET,
        version: 1, createdAt: '2026-07-28T05:00:00Z',
        updatedAt: '2026-07-28T05:01:00Z', endedAt: null
      }],
      agentRuns: [{
        id: 'run-muwa', campTurnId: 'turn-1', conversationId: 'conversation-muwa',
        agentId: 'agent_2', taskId: null, responsibilityKey: 'direct:agent_2',
        responsibilityGeneration: 0, purpose: '实现复制',
        completionRole: 'required', status: 'running', waitReason: null, executionEpoch: 1,
        terminalResolutionSource: null, terminalReasonCode: null,
        permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
        a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
        executionEvidenceCount: 3,
        hasUnsettledExternalEffects: false,
        workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
        version: 2,
        createdAt: '2026-07-28T05:00:00Z', startedAt: '2026-07-28T05:00:01Z',
        endedAt: null, updatedAt: '2026-07-28T05:01:00Z'
      }],
      contextManifests: [],
      executionEvidence: [{
        id: 'evidence-1', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 1,
        eventType: 'agent.reasoning.summary.delta', kind: 'reasoning_summary', phase: 'updated',
        payload: { itemId: 'reasoning-1', delta: '先检查消息组件。' }, contentBlobId: 'blob-reasoning', contentByteCount: 42,
        isTruncated: true, occurredAt: '2026-07-28T05:00:02Z'
      }, {
        id: 'evidence-2', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 2,
        eventType: 'activity.completed', kind: 'reasoning_summary', phase: 'completed',
        payload: { item: { id: 'reasoning-1', type: 'reasoning', status: 'completed' } },
        contentBlobId: null, contentByteCount: 96, isTruncated: false,
        occurredAt: '2026-07-28T05:00:03Z'
      }, {
        id: 'evidence-3', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 3,
        eventType: 'activity.started', kind: 'command', phase: 'started',
        payload: { item: { id: 'command-1', type: 'commandExecution', command: 'pnpm test', status: 'inProgress' } },
        canonical: canonicalActivity('command-1', {
          activityDomain: 'shell', semanticKind: 'shell.execute',
          presentationHint: '执行 Shell 命令', phase: 'started', outcome: 'unknown',
          sourceEvidenceIds: ['evidence-3'], firstEvidenceSequence: 3,
          lastEvidenceSequence: 3
        }),
        contentBlobId: null, contentByteCount: 120, isTruncated: false,
        occurredAt: '2026-07-28T05:00:04Z'
      }],
      approvals: [], actions: [], timeline: []
    }
    const historicalRun = {
      ...snapshot.agentRuns[0],
      id: 'run-muwa-history',
      status: 'succeeded' as const,
      executionEvidenceCount: 0,
      createdAt: '2026-07-28T04:30:00Z',
      startedAt: '2026-07-28T04:30:01Z',
      endedAt: '2026-07-28T04:31:00Z',
      updatedAt: '2026-07-28T04:31:00Z'
    }
    const groupedSnapshot = {
      ...snapshot,
      agentRuns: [historicalRun, ...snapshot.agentRuns]
    }
    const processes = agentExecutionProcesses(groupedSnapshot.agentRuns)
    expect(processes).toHaveLength(1)
    expect(processes[0].agentId).toBe('agent_2')
    expect(processes[0].runs.map((run) => run.id)).toEqual(['run-muwa-history', 'run-muwa'])
    expect(preferredAgentProcessRun(processes[0].runs)?.id).toBe('run-muwa')
    expect(executionDisclosureOpenAfterActivity(true, false)).toBe(true)
    expect(executionDisclosureOpenAfterActivity(false, true)).toBe(true)
    expect(executionDisclosureOpenAfterActivity(false, false)).toBe(false)
    expect(executionDisclosureIsLiveOpen('running', true, false)).toBe(true)
    expect(executionDisclosureIsLiveOpen('running', false, false)).toBe(false)
    expect(executionDisclosureIsLiveOpen('queued', true, true)).toBe(false)
    expect(agentRunCountsAsExecuting({ status: 'waiting', waitReason: 'runtime_recovery' })).toBe(true)
    expect(agentRunCountsAsExecuting({ status: 'waiting', waitReason: 'recovery_blocked' })).toBe(false)

    const submittedFirstRun = {
      ...snapshot.agentRuns[0],
      id: 'run-submitted-first',
      agentId: 'agent_3',
      campTurnId: 'turn-submitted',
      status: 'queued' as const,
      createdAt: '2026-07-28T06:00:00Z'
    }
    const submittedSecondRun = {
      ...snapshot.agentRuns[0],
      id: 'run-submitted-second',
      campTurnId: 'turn-submitted',
      status: 'queued' as const,
      createdAt: '2026-07-28T06:00:00Z'
    }
    const submittedRuns = [submittedSecondRun, submittedFirstRun]
    expect(firstSubmittedAgentRun({
      campTurnId: 'turn-submitted',
      agentRunIds: ['run-submitted-first', 'run-submitted-second'],
      addressedAgentIds: ['agent_3', 'agent_2']
    }, submittedRuns)?.id).toBe('run-submitted-first')
    expect(firstSubmittedAgentRun({
      campTurnId: 'turn-submitted',
      agentRunIds: [],
      addressedAgentIds: ['agent_3', 'agent_2']
    }, submittedRuns)?.id).toBe('run-submitted-first')
    expect(isViewingNonTerminalAgentRun('agent_2', 'run-muwa', groupedSnapshot.agentRuns))
      .toBe(true)
    expect(isViewingNonTerminalAgentRun('agent_2', 'run-muwa-history', groupedSnapshot.agentRuns))
      .toBe(false)
    expect(isViewingNonTerminalAgentRun(null, 'run-muwa', groupedSnapshot.agentRuns))
      .toBe(false)
    expect(executionDrawerIsNearBottom(648, 1_000, 320)).toBe(true)
    expect(executionDrawerIsNearBottom(647, 1_000, 320)).toBe(false)
    expect(executionDrawerHeightBounds(600, 54, 920)).toEqual({ min: 160, max: 434 })
    expect(executionDrawerHeightBounds(260, 54, 700)).toEqual({ min: 141, max: 141 })
    expect(defaultExecutionDrawerMaxHeight(1_440, 920, { min: 160, max: 434 })).toBe(320)
    expect(defaultExecutionDrawerMaxHeight(1_040, 700, { min: 160, max: 334 })).toBe(210)
    expect(clampExecutionDrawerHeight(300, { min: 160, max: 280 })).toBe(280)
    expect(clampExecutionDrawerHeight(120, { min: 160, max: 280 })).toBe(160)
    expect(executionDrawerHeightFromStoredValue('312.4')).toBe(312)
    expect(executionDrawerHeightFromStoredValue('47')).toBeNull()
    expect(executionDrawerHeightFromStoredValue('not-a-height')).toBeNull()
    expect(campConversationViewFromStoredValue('conversation')).toBe('conversation')
    expect(campConversationViewFromStoredValue('world')).toBe('world')
    expect(campConversationViewFromStoredValue(null)).toBe('world')

    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: groupedSnapshot,
      projectName: 'Rovai',
      agents: [profile],
      liveRuntimeEvents: [{
        id: 'live-2', agentRunId: 'run-muwa', eventType: 'agent.text.delta',
        payload: { itemId: 'message-1', delta: '正在补充复制入口。' },
        createdAt: '2026-07-28T05:00:03Z'
      }],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('aria-label="复制这条消息"')
    expect(markup).toContain('>复制</button>')
    expect(markup).toContain('class="message-surface"')
    expect(markup).toContain('class="message-mention-token is-interactive"')
    expect(markup).toContain('data-agent-id="agent_2"')
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('aria-label="查看沐瓦的基础信息"')
    expect(markup).toContain('title="查看沐瓦的基础信息"')
    expect(markup).toContain('aria-haspopup="dialog"')
    expect(markup).not.toContain('role="link"')
    expect(markup.indexOf('class="message-bubble"'))
      .toBeLessThan(markup.indexOf('class="message-copy-button"'))
    expect(markup).toContain('aria-label="Agent 执行台"')
    expect(markup).toContain('class="run-pulse-chip"')
    expect((markup.match(/class="run-pulse-chip(?: is-selected)?"/g) ?? [])).toHaveLength(1)
    expect(markup).toContain('data-agent-id="agent_2"')
    expect(markup).toContain('执行中')
    expect(markup.indexOf('class="local-message-avatar"'))
      .toBeLessThan(markup.indexOf('class="message-body"'))
    expect(markup).not.toContain('>审计 <small>')
    expect(markup).not.toContain('Thinking')
    expect(markup).not.toContain('先检查消息组件。')
    expect(markup).not.toContain('完整证据')
    expect(markup).not.toContain('正在整理思路')
    expect(markup).not.toContain('Progress')
    expect(markup).not.toContain('正在补充复制入口。')
    expect(markup).not.toContain('Steps')
    expect(markup).toContain('aria-label="会话世界地图"')
    expect(markup).toContain('执行 · 正在运行')
    expect(markup).toContain('执行 Shell 命令：pnpm test')
    expect(markup).not.toContain('conversation-bubble agent agent-run-message')
    expect(markup).not.toContain('execution-disclosure')
    expect(markup).not.toContain('stream-reasoning')
    expect(markup).not.toContain('process-copy stream-narration')
    expect(markup).not.toContain('tool-call-disclosure')
    expect(markup).not.toContain('working-row')
    expect(markup).not.toContain('live-execution-progress')
    expect(markup).toContain('aria-label="停止当前执行"')
    expect(markup).not.toContain('class="primary-button composer-send"')

    const groupedEvidenceMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: {
        ...snapshot,
        agentRuns: snapshot.agentRuns.map((run) => ({ ...run, executionEvidenceCount: 5 })),
        executionEvidence: [{
          id: 'command-started', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 1,
          eventType: 'activity.started', kind: 'command' as const, phase: 'started' as const,
          payload: { item: { id: 'command-1', type: 'commandExecution', command: 'pnpm test', status: 'inProgress' } },
          canonical: canonicalActivity('command-1', {
            activityDomain: 'shell', semanticKind: 'shell.execute', presentationHint: '执行 Shell 命令',
            sourceEvidenceIds: ['command-started', 'command-completed'], firstEvidenceSequence: 1,
            lastEvidenceSequence: 2, revision: 2
          }),
          contentBlobId: 'blob-command-started', contentByteCount: 20_000, isTruncated: true,
          occurredAt: '2026-07-28T05:00:02Z'
        }, {
          id: 'command-completed', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 2,
          eventType: 'activity.completed', kind: 'command' as const, phase: 'completed' as const,
          payload: { item: { id: 'command-1', type: 'commandExecution', command: 'pnpm test', status: 'completed' } },
          canonical: canonicalActivity('command-1', {
            activityDomain: 'shell', semanticKind: 'shell.execute', presentationHint: '执行 Shell 命令',
            sourceEvidenceIds: ['command-started', 'command-completed'], firstEvidenceSequence: 1,
            lastEvidenceSequence: 2, revision: 2
          }),
          contentBlobId: 'blob-command-completed', contentByteCount: 20_000, isTruncated: true,
          occurredAt: '2026-07-28T05:00:03Z'
        }, {
          id: 'files-started', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 3,
          eventType: 'activity.started', kind: 'file_change' as const, phase: 'started' as const,
          payload: { item: { id: 'files-1', type: 'fileChange', status: 'inProgress', changes: [{ path: 'app.tsx' }] } },
          canonical: canonicalActivity('files-1', {
            activityDomain: 'file', semanticKind: 'file.write', presentationHint: '修改文件',
            sourceEvidenceIds: ['files-started', 'files-completed'], firstEvidenceSequence: 3,
            lastEvidenceSequence: 4, revision: 2
          }),
          contentBlobId: 'blob-files-started', contentByteCount: 20_000, isTruncated: true,
          occurredAt: '2026-07-28T05:00:04Z'
        }, {
          id: 'files-completed', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 4,
          eventType: 'activity.completed', kind: 'file_change' as const, phase: 'completed' as const,
          payload: { item: { id: 'files-1', type: 'fileChange', status: 'completed', changes: [{ path: 'app.tsx' }] } },
          canonical: canonicalActivity('files-1', {
            activityDomain: 'file', semanticKind: 'file.write', presentationHint: '修改文件',
            sourceEvidenceIds: ['files-started', 'files-completed'], firstEvidenceSequence: 3,
            lastEvidenceSequence: 4, revision: 2
          }),
          contentBlobId: 'blob-files-completed', contentByteCount: 20_000, isTruncated: true,
          occurredAt: '2026-07-28T05:00:05Z'
        }, {
          id: 'second-command', agentRunId: 'run-muwa', executionEpoch: 1, sequence: 5,
          eventType: 'activity.started', kind: 'command' as const, phase: 'started' as const,
          payload: { item: { id: 'command-2', type: 'commandExecution', command: 'pnpm typecheck', status: 'inProgress' } },
          canonical: canonicalActivity('command-2', {
            activityDomain: 'shell', semanticKind: 'shell.execute', presentationHint: '执行 Shell 命令',
            phase: 'started', outcome: 'unknown', sourceEvidenceIds: ['second-command'],
            firstEvidenceSequence: 5, lastEvidenceSequence: 5
          }),
          contentBlobId: 'blob-second-command', contentByteCount: 20_000, isTruncated: true,
          occurredAt: '2026-07-28T05:00:06Z'
        }]
      },
      projectName: 'Rovai',
      agents: [profile],
      liveRuntimeEvents: [],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))
    expect(groupedEvidenceMarkup).not.toContain('tool-call-disclosure')
    expect(groupedEvidenceMarkup).not.toContain('complete-evidence-control')
    expect(groupedEvidenceMarkup).not.toContain('查看完整工具调用')
    expect(groupedEvidenceMarkup).not.toContain('查看完整文件变更')
    expect(groupedEvidenceMarkup).not.toContain('complete-evidence-standalone')
    expect(groupedEvidenceMarkup).not.toContain('完整证据')

    const cancellingMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: 'Rovai',
      agents: [profile],
      liveRuntimeEvents: [],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      cancellingTurnIds: new Set(['turn-1']),
      stopping: true,
      onStop: () => undefined
    }))
    expect(cancellingMarkup).toContain('正在停止')
    expect(cancellingMarkup).not.toContain('停止请求已发送，正在等待 Agent 运行时退出。')
    expect(cancellingMarkup).not.toContain('execution-disclosure')
    expect(cancellingMarkup).toContain('aria-label="正在停止当前执行"')
    expect(cancellingMarkup).not.toMatch(/<textarea[^>]*disabled/)
    expect(cancellingMarkup).not.toContain('execution-disclosure is-running')

    const terminalMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: {
        ...snapshot,
        messages: [...snapshot.messages, {
          id: 'message-agent', sequence: 2, timelineGlobalSequence: 4,
          authorType: 'agent' as const, authorId: 'agent_2',
          sourceAgentRunId: 'run-muwa', body: '复制入口已完成。', content: [{ kind: 'text', text: '复制入口已完成。' }], addressMode: 'broadcast' as const,
          attachments: [],
          addressedAgentIds: [], replyToCampMessageId: 'message-user',
          campTurnId: 'turn-1', presentation: null, createdAt: '2026-07-28T05:02:00Z'
        }],
        turns: snapshot.turns.map((turn) => ({
          ...turn,
          status: 'completed' as const,
          endedAt: '2026-07-28T05:02:00Z'
        })),
        agentRuns: snapshot.agentRuns.map((run) => ({
          ...run,
          status: 'succeeded' as const,
          endedAt: '2026-07-28T05:02:00Z'
        }))
      },
      projectName: 'Rovai',
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))
    expect(terminalMarkup).not.toContain('execution-disclosure')
    expect(terminalMarkup).not.toContain(' open=""')
    expect(terminalMarkup).not.toContain('terminal-run-row')
    expect(terminalMarkup).not.toContain('来自执行')
    expect(terminalMarkup).not.toContain('message-run-origin')
    expect(terminalMarkup).toContain('复制入口已完成。')
    expect(terminalMarkup).toContain('reply-parent-quote')
    expect(terminalMarkup).toContain('你 ·')
    expect(terminalMarkup).toContain('aria-label="回复这条消息"')

    const restoredMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: {
        ...snapshot,
        executionEvidence: [],
        turns: snapshot.turns.map((turn) => ({
          ...turn,
          status: 'completed' as const,
          endedAt: '2026-07-28T05:02:00Z'
        })),
        agentRuns: snapshot.agentRuns.map((run) => ({
          ...run,
          status: 'succeeded' as const,
          endedAt: '2026-07-28T05:02:00Z'
        }))
      },
      projectName: 'Rovai',
      agents: [profile],
      liveRuntimeEvents: [],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))
    expect(restoredMarkup).toContain('已完成')
    expect(restoredMarkup).not.toContain('处理过程 · 1分59秒')

    const cancelledMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: {
        ...snapshot,
        throughGlobalSequence: 4,
        turns: snapshot.turns.map((turn) => ({
          ...turn,
          status: 'cancelled' as const,
          cancelRequestedAt: '2026-07-28T05:00:05Z',
          endedAt: '2026-07-28T05:00:06Z'
        })),
        agentRuns: snapshot.agentRuns.map((run) => ({
          ...run,
          status: 'cancelled' as const,
          hasUnsettledExternalEffects: true,
          endedAt: '2026-07-28T05:00:06Z'
        })),
        timeline: [{
          globalSequence: 4,
          eventId: 'event-cancel',
          eventType: 'camp_turn.cancel_requested',
          campId: snapshot.camp.id,
          entityType: 'camp_turn',
          entityId: 'turn-1',
          actorType: 'user',
          actorId: 'local_user',
          sourceAgentRunId: null,
          executionEpoch: null,
          payload: { agentRunCount: 1 },
          createdAt: '2026-07-28T05:00:05Z'
        }]
      },
      projectName: 'Rovai',
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      inspectorVisible: false
    }))
    expect(cancelledMarkup).toContain('workspace-grid inspector-collapsed')
    expect(cancelledMarkup).not.toContain('aria-label="会话详情"')
    expect(cancelledMarkup).toContain('你已在 5 秒后停止')
    expect(cancelledMarkup).toContain('结果待确认 · 查看执行详情')
    expect(cancelledMarkup).not.toContain('run-message-state tone-neutral')
    expect(cancelledMarkup).not.toContain('pnpm test')

    const plannedStoppedMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: {
        ...snapshot,
        throughGlobalSequence: 5,
        turns: snapshot.turns.map((turn) => ({
          ...turn,
          status: 'failed' as const,
          cancelRequestedAt: null,
          aggregateReasonCode: 'required_run_incomplete' as const,
          endedAt: '2026-07-28T05:00:06Z'
        })),
        agentRuns: snapshot.agentRuns.map((run) => ({
          ...run,
          status: 'cancelled' as const,
          terminalResolutionSource: 'runtime_terminal' as const,
          terminalReasonCode: 'planned_shutdown_cancelled' as const,
          hasUnsettledExternalEffects: true,
          endedAt: '2026-07-28T05:00:06Z'
        })),
        timeline: []
      },
      projectName: 'Rovai',
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      inspectorVisible: false
    }))
    expect(plannedStoppedMarkup).toContain('已停止')
  })

  it('labels the execution drawer with the member and configured Runtime product', () => {
    expect(executionDrawerTitle('雾切响子', 'copilot-cli'))
      .toBe('雾切响子 GitHub Copilot')
    expect(executionDrawerTitle('爱丽丝', 'codex-cli')).toBe('爱丽丝 Codex CLI')
    expect(executionDrawerTitle('药师寺惠', null)).toBe('药师寺惠')
  })

  it('keeps concurrent Runtime approvals in one dock directly above the composer', () => {
    const profiles = [{
      ...agentProfile(),
      agentId: 'agent_1',
      displayName: '洛可'
    }, {
      ...agentProfile(),
      agentId: 'agent_2',
      displayName: '沐瓦'
    }]
    const approvals: ActionApprovalView[] = profiles.map((profile, index) => ({
      id: `approval-${index + 1}`,
      actionId: `action-${index + 1}`,
      actionKind: 'command',
      actionSummary: index === 0 ? '运行 pnpm test' : '写入构建产物',
      canonicalInput: { command: index === 0 ? 'pnpm test' : 'pnpm build' },
      reason: 'Agent 运行时需要用户确认。',
      agentRunId: `run-${index + 1}`,
      agentId: profile.agentId,
      adapterKind: 'codex-cli',
      nativeMethod: 'item/commandExecution/requestApproval',
      requestDigest: `digest-${index + 1}`,
      permissionSemantics: 'runtime_managed_v2',
      options: [{
        optionId: 'allow-once',
        kind: 'allow_once',
        label: '允许一次',
        consequence: '只允许当前请求。',
        nativeResponseDigest: `response-${index + 1}`
      }],
      status: 'pending',
      requestedForUserId: 'local_user',
      resolvedByType: null,
      resolvedById: null,
      resolutionCode: null,
      version: 1,
      requestedAt: `2026-07-30T03:00:0${index}Z`,
      resolvedAt: null
    }))
    const snapshot: CampSnapshot = {
      schemaVersion: 29,
      throughGlobalSequence: 2,
      camp: {
        id: 'camp-approval', title: '审批停靠区', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1',
        version: 1, createdAt: '2026-07-30T03:00:00Z', updatedAt: '2026-07-30T03:00:01Z'
      },
      members: profiles.map((profile, index) => ({
        agentId: profile.agentId,
        displayName: profile.displayName,
        teamRole: index === 0 ? 'Lead' : '开发者',
        avatarRef: null,
        accent: index === 0 ? '#A65F4A' : '#39777A',
        membershipStatus: 'active',
        leaveRequestedAt: null,
        profilePresence: 'present',
        memberOrder: index,
        isDefaultLead: index === 0,
        version: 1
      })),
      tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
      contextManifests: [], executionEvidence: [],
      approvals, actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: profiles,
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('aria-label="2 项待审批"')
    expect(markup).toContain('洛可、沐瓦')
    expect(markup).toContain('运行 pnpm test')
    expect(markup).toContain('aria-label="收起审批详情"')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).not.toContain('class="approval-card')
    expect((markup.match(/role="tab"/g) ?? []).length).toBe(2)
    expect(markup).toContain('任务 <small>0</small>')
    expect(markup).toContain('队员 <small>2</small>')
    expect(markup).not.toContain('上下文投递')
    expect(markup).not.toContain('>审批<')
    expect(markup.indexOf('class="approval-dock"')).toBeLessThan(markup.indexOf('class="composer"'))
  })

  it('renders a public A2A message with the Scheme C handoff footer', () => {
    const publicMessage: CampMessageView = {
      id: 'public-a2a-message',
      sequence: 1,
      timelineGlobalSequence: 2,
      authorType: 'agent',
      authorId: 'agent_1',
      sourceAgentRunId: 'run-luoke',
      body: '请检查 Downloads 目录里的页面。',
      content: [{ kind: 'text', text: '请检查 Downloads 目录里的页面。' }],
      attachments: [],
      addressMode: 'explicit',
      addressedAgentIds: ['agent_2', 'agent_3'],
      replyToCampMessageId: null,
      campTurnId: 'turn-a2a',
      presentation: null,
      createdAt: '2026-07-30T03:00:00Z'
    }
    const delivery: MessageDeliveryView = {
      id: 'delivery-a2a',
      messageId: publicMessage.id,
      campTurnId: 'turn-a2a',
      taskId: null,
      recipientAgentId: 'agent_2',
      recipientCanonicalPosition: 0,
      edgeKind: 'forward',
      targetParentAgentRunId: 'run-luoke',
      returnToAgentRunId: null,
      status: 'settled',
      dispatchPhase: 'terminal',
      waitCondition: null,
      dispatchAttemptCount: 1,
      retryGeneration: 0,
      contextManifestId: 'manifest-a2a',
      targetAgentRunId: 'run-muwa',
      manualInterventionRequired: false,
      failureCode: null,
      version: 3,
      createdAt: '2026-07-30T03:00:00Z',
      updatedAt: '2026-07-30T03:00:02Z',
      endedAt: '2026-07-30T03:00:02Z'
    }
    const failedDelivery: MessageDeliveryView = {
      ...delivery,
      id: 'delivery-a2a-failed',
      recipientAgentId: 'agent_3',
      recipientCanonicalPosition: 1,
      status: 'failed',
      dispatchAttemptCount: 2,
      contextManifestId: null,
      targetAgentRunId: null,
      failureCode: 'runtime_unavailable'
    }
    expect(campConversationTimeline([publicMessage]).map((item) => item.id)).toEqual([publicMessage.id])

    const snapshot: CampSnapshot = {
      schemaVersion: 29,
      throughGlobalSequence: 3,
      camp: {
        id: 'camp-a2a', title: 'Agent 协作', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1',
        version: 1, createdAt: '2026-07-30T03:00:00Z', updatedAt: '2026-07-30T03:00:01Z'
      },
      members: [{
        agentId: 'agent_1', displayName: '洛可', teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
        memberOrder: 0, isDefaultLead: true, version: 1
      }, {
        agentId: 'agent_2', displayName: '沐瓦', teamRole: '开发者',
        avatarRef: null, accent: '#39777a', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
        memberOrder: 1, isDefaultLead: false, version: 1
      }, {
        agentId: 'agent_3', displayName: '小狐狸', teamRole: '评审',
        avatarRef: null, accent: '#8a5c75', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
        memberOrder: 2, isDefaultLead: false, version: 1
      }],
      tasks: [],
      messages: [publicMessage],
      messageDeliveries: [failedDelivery, delivery],
      turns: [],
      agentRuns: [],
      contextManifests: [],
      executionEvidence: [],
      approvals: [],
      actions: [],
      timeline: []
    }
    const agents: AgentProfile[] = [{
      ...agentProfile(),
      agentId: 'agent_1',
      displayName: '洛可',
      runtimeReadiness: { status: 'ready', blockers: [] }
    }, {
      ...agentProfile(),
      agentId: 'agent_2',
      displayName: '沐瓦',
      runtimeReadiness: { status: 'ready', blockers: [] }
    }, {
      ...agentProfile(),
      agentId: 'agent_3',
      displayName: '小狐狸',
      runtimeReadiness: { status: 'ready', blockers: [] }
    }]
    const renderWorkspace = (candidateSnapshot: CampSnapshot): string =>
      renderToStaticMarkup(createElement(CampWorkspace, {
        snapshot: candidateSnapshot,
        projectName: null,
        agents,
        busy: false,
        onSend: async () => undefined,
        onChangeLead: async () => undefined,
        onTasksChanged: async () => undefined,
        onResolveApproval: () => undefined,
        stopping: false,
        onStop: () => undefined
      }))
    const markup = renderWorkspace(snapshot)

    expect(markup).not.toContain('<h2>会话</h2>')
    expect(markup).toContain('请检查 Downloads 目录里的页面。')
    expect(markup).toContain('class="message-surface has-delivery"')
    expect(markup).toContain('class="message-delivery-footer"')
    expect(markup).toContain('class="message-delivery-handoff-rail"')
    const handoffText = markup.replace(/<[^>]+>/g, '')
    expect(handoffText).toContain('发送给@沐瓦、@小狐狸')
    expect(markup).not.toContain('发送给：')
    expect(markup.indexOf('@沐瓦')).toBeLessThan(markup.indexOf('@小狐狸'))
    expect((markup.match(/class="message-delivery-recipient-name message-mention-token is-interactive"/g) ?? []))
      .toHaveLength(2)
    expect(markup).toContain('aria-label="查看沐瓦的基础信息"')
    expect(markup).toContain('aria-label="查看小狐狸的基础信息"')
    expect(markup).toContain('role="button"')
    expect(markup).toContain('tabindex="0"')
    expect(markup).toContain('class="message-author-trigger message-author-avatar-trigger"')
    expect(markup).toContain('class="message-author-trigger message-author-name-trigger"')
    expect((markup.match(/aria-label="查看洛可的基础信息"/g) ?? [])).toHaveLength(2)
    expect((markup.match(/data-agent-id="agent_1"/g) ?? [])).toHaveLength(2)
    expect(markup).not.toContain('message-author-link')
    expect(markup).toMatch(/<div class="timeline-node timeline-day">\d{1,2}月\d{1,2}日 周[一二三四五六日] · DAY \d+<\/div>/)
    expect(markup).not.toContain('今天 ·')
    expect(markup).not.toContain('发布准备')
    expect(markup).not.toContain('投递失败')
    expect(markup).not.toContain('message-delivery-state')
    expect(markup).not.toContain('已送达')
    expect(markup).not.toContain('来自执行')
    expect(markup).not.toContain('message-run-origin')
    expect(markup).not.toContain('delivery-status-list is-compact')
    expect(markup).not.toContain('个收件人')
    expect(markup).not.toContain('活动')
    expect(markup).not.toContain('Core Outcome')
    expect(markup).not.toContain('返回责任')
    expect(markup).not.toContain('Correlation')

    const unavailableAuthorMarkup = renderWorkspace({
      ...snapshot,
      members: snapshot.members.map((member) => member.agentId === publicMessage.authorId
        ? { ...member, profilePresence: 'removed' as const }
        : member)
    })
    expect(unavailableAuthorMarkup).not.toContain('message-author-trigger')
    expect(unavailableAuthorMarkup).not.toContain('aria-label="查看洛可的基础信息"')
    expect(unavailableAuthorMarkup).toContain('<strong>洛可</strong>')
  })

  it('renders GFM while removing raw HTML and remote images', () => {
    const markup = renderToStaticMarkup(createElement(
      SafeMarkdown,
      null,
      '### 结论\n\n| 项目 | 结果 |\n| --- | --- |\n| **测试** | `PASS` |\n\n<script>alert(1)</script>\n\n![remote](https://example.com/image.png)'
    ))

    expect(markup).toContain('<table>')
    expect(markup).toContain('<strong>测试</strong>')
    expect(markup).toContain('<code>PASS</code>')
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('alert(1)')
  })

  it('renders durable Task records below a single explicit creation action', () => {
    const snapshot: CampSnapshot = {
      schemaVersion: 29,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-task', title: 'Task 管理', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_2',
        version: 1, createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z'
      },
      members: [{
        agentId: 'agent_2', displayName: '沐瓦', teamRole: '开发者',
        avatarRef: null, accent: '#39777a', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
        isDefaultLead: true, version: 1
      }],
      tasks: [{
        taskId: 'task-1', campId: 'camp-task', title: '实现 Task 工具', description: '跨消息持续跟踪，不自动唤醒负责人。',
        acceptanceCriteria: [], blockedReason: null, completionSummary: null, cancelReason: null,
        status: 'pending', assigneeAgentId: 'agent_2', createdByType: 'user',
        createdById: 'local_user', sourceAgentRunId: null, closedByType: null,
        closedById: null, closedByAgentRunId: null, version: 1,
        createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z',
        closedAt: null, availableActions: ['update']
      }],
      messages: [], messageDeliveries: [], turns: [], agentRuns: [], contextManifests: [],
      executionEvidence: [], approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(TaskPanel, {
      snapshot,
      busy: false,
      onTasksChanged: async () => undefined
    }))
    const emptyMarkup = renderToStaticMarkup(createElement(TaskPanel, {
      snapshot: { ...snapshot, tasks: [] },
      busy: false,
      onTasksChanged: async () => undefined
    }))

    expect(markup).toContain('task-action-row')
    expect(markup).toContain('task-action-button')
    expect(markup).toContain('新建任务')
    expect(markup).toContain('实现 Task 工具')
    expect(markup).toContain('跨消息持续跟踪，不自动唤醒负责人。')
    expect(markup).toContain('沐瓦')
    expect(markup).not.toContain('acceptanceCriteria')
    expect(markup).not.toContain('长期事项')
    expect(markup).not.toContain('创建或指派不会唤醒队员')
    expect(emptyMarkup).toContain('新建任务')
    expect(emptyMarkup).not.toContain('普通对话不需要 Task')
    expect(emptyMarkup).not.toContain('empty-inline')
  })

  it('explains context blockers and A2A delivery without relying on color', () => {
    expect(agentRunPresentation({ status: 'waiting', waitReason: 'delivery_unknown' })).toEqual({
      label: '投递待确认',
      tone: 'danger'
    })
    expect(agentRunPresentation({ status: 'waiting', waitReason: 'recovery_blocked' })).toEqual({
      label: '结果待确认',
      tone: 'danger'
    })
    expect(agentRunStateTag({ status: 'waiting', waitReason: 'recovery_blocked' })).toEqual({
      tag: 'REVIEW',
      tone: 'danger'
    })
    expect(agentRunWaitDetail('recovery_blocked')).toContain('原请求不会自动重发')
    expect(agentRunPresentation({ status: 'running', waitReason: null }, true)).toEqual({
      label: '正在停止…',
      tone: 'neutral'
    })
    expect(agentRunStateTag({ status: 'running', waitReason: null }, true)).toEqual({
      tag: '正在停止',
      tone: 'neutral'
    })
    expect(agentRunPresentation({
      status: 'cancelled',
      waitReason: null,
      terminalReasonCode: 'planned_shutdown_cancelled'
    })).toEqual({
      label: '已停止',
      tone: 'neutral'
    })
    expect(agentRunStateTag({
      status: 'cancelled',
      waitReason: null,
      terminalReasonCode: 'planned_shutdown_cancelled'
    })).toEqual({
      tag: 'STOPPED',
      tone: 'neutral'
    })
    expect(agentRunStateTag({ status: 'cancelled', waitReason: null })).toEqual({
      tag: 'CANCELLED',
      tone: 'neutral'
    })
    expect(agentRunTerminalNote({
      terminalReasonCode: 'planned_shutdown_cancelled'
    })).toBe('因 Rovai 计划关闭，执行引擎已确认取消本次执行。')
    expect(agentRunTerminalNote({ terminalReasonCode: null })).toBeNull()
    expect(formatByteSize(4_096)).toBe('4.0 KB')
  })

  it('omits live reasoning summaries while projecting narration, plans and execution steps', () => {
    const reasoningEvent = liveRuntimeEventFromCore({
      method: 'agent.reasoning.summary.delta',
      params: {
        agentRunId: 'run-muwa',
        payload: { itemId: 'reasoning-1', delta: '先检查现有实现。' }
      }
    }, 'live-1')
    expect(reasoningEvent).not.toBeNull()

    const captured = [
      reasoningEvent,
      liveRuntimeEventFromCore({
        method: 'agent.text.delta',
        params: {
          agentRunId: 'run-muwa',
          payload: { itemId: 'message-1', delta: '正在核对时间线。' }
        }
      }, 'live-2'),
      liveRuntimeEventFromCore({
        method: 'runtime.plan',
        params: {
          agentRunId: 'run-muwa',
          payload: {
            explanation: '定位后再修改。',
            plan: [
              { step: '检查事件流', status: 'completed' },
              { step: '补充界面投影', status: 'inProgress' }
            ]
          }
        }
      }, 'live-3'),
      liveRuntimeEventFromCore({
        method: 'activity.started',
        params: {
          agentRunId: 'run-muwa',
          canonical: canonicalActivity('command-1', {
            activityDomain: 'shell', semanticKind: 'shell.execute',
            presentationHint: '执行 Shell 命令', phase: 'started', outcome: 'unknown'
          }),
          payload: {
            item: {
              id: 'command-1',
              type: 'commandExecution',
              command: 'pnpm test',
              status: 'inProgress'
            }
          }
        }
      }, 'live-4')
    ].filter((value) => value !== null)

    const progress = buildLiveExecutionProgress(captured, 'run-muwa')
    expect(progress.items.map((item) => item.kind)).toEqual([
      'narration', 'plan', 'tool'
    ])
    expect(progress.items[0]).toMatchObject({ body: '正在核对时间线。' })
    expect(progress.items[1]).toMatchObject({
      plan: [
        { step: '检查事件流', status: 'completed' },
        { step: '补充界面投影', status: 'inProgress' }
      ]
    })
    expect(progress.items[2]).toMatchObject({
      step: {
        title: '执行 Shell 命令',
        detail: 'pnpm test',
        status: 'running'
      }
    })
    expect(liveRuntimeEventFromCore({ method: 'runtime.usage', params: {} }, 'ignored')).toBeNull()

    const historicalProgress = buildLiveExecutionProgress([{
      id: 'reasoning-1',
      agentRunId: 'run-muwa',
      eventType: 'agent.reasoning.summary.delta',
      payload: { itemId: 'reasoning-1', delta: '不会显示的思考摘要。' },
      createdAt: '2026-07-28T05:00:04Z'
    },
      {
        id: 'live-5',
        agentRunId: 'run-muwa',
        eventType: 'activity.completed',
        payload: {
          item: {
            id: 'reasoning-1',
            type: 'reasoning',
            status: 'completed'
          }
        },
        createdAt: '2026-07-28T05:00:05Z'
      }
    ], 'run-muwa')
    expect(historicalProgress.items).toEqual([])
  })

  it('omits anonymous ACP thoughts without merging narration across tool boundaries', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'thought-1', agentRunId: 'run-acp', eventType: 'agent.thought.delta',
      payload: { itemId: null, delta: '先检查' }, createdAt: '2026-08-03T00:00:01Z'
    }, {
      id: 'thought-2', agentRunId: 'run-acp', eventType: 'agent.thought.delta',
      payload: { itemId: null, delta: '页面。' }, createdAt: '2026-08-03T00:00:02Z'
    }, {
      id: 'text-1', agentRunId: 'run-acp', eventType: 'agent.text.delta',
      payload: { itemId: null, delta: '第一段' }, createdAt: '2026-08-03T00:00:03Z'
    }, {
      id: 'text-2', agentRunId: 'run-acp', eventType: 'agent.text.delta',
      payload: { itemId: null, delta: '说明。' }, createdAt: '2026-08-03T00:00:04Z'
    }, {
      id: 'tool-1', agentRunId: 'run-acp', eventType: 'runtime.action',
      payload: { toolCallId: 'tool-1', title: '运行命令', status: 'completed' },
      createdAt: '2026-08-03T00:00:05Z'
    }, {
      id: 'text-3', agentRunId: 'run-acp', eventType: 'agent.text.delta',
      payload: { itemId: null, delta: '第二段' }, createdAt: '2026-08-03T00:00:06Z'
    }, {
      id: 'text-4', agentRunId: 'run-acp', eventType: 'agent.text.delta',
      payload: { itemId: null, delta: '说明。' }, createdAt: '2026-08-03T00:00:07Z'
    }], 'run-acp')

    expect(progress.items.map((item) => item.kind)).toEqual([
      'narration', 'tool', 'narration'
    ])
    expect(progress.items[0]).toMatchObject({ body: '第一段说明。' })
    expect(progress.items[2]).toMatchObject({ body: '第二段说明。' })
  })

  it('preserves canonical identity when rebuilding terminal execution history', () => {
    const canonical = canonicalActivity('command-1', {
      activityDomain: 'shell', semanticKind: 'shell.execute',
      presentationHint: '读取 SKILL.md', phase: 'terminal', outcome: 'succeeded',
      sourceEvidenceIds: ['command-started', 'command-completed'],
      firstEvidenceSequence: 1, lastEvidenceSequence: 2, revision: 2
    })
    const evidence: AgentRunExecutionEvidenceView[] = [{
      id: 'command-started', agentRunId: 'run-terminal', executionEpoch: 1, sequence: 1,
      eventType: 'activity.started', kind: 'command', phase: 'started',
      payload: {
        item: {
          id: 'native-command-1', type: 'commandExecution',
          command: 'sed -n 1,120p SKILL.md', status: 'inProgress'
        }
      },
      canonical,
      contentBlobId: null, contentByteCount: 0, isTruncated: false,
      occurredAt: '2026-08-12T03:14:07Z'
    }, {
      id: 'command-completed', agentRunId: 'run-terminal', executionEpoch: 1, sequence: 2,
      eventType: 'activity.completed', kind: 'command', phase: 'completed',
      payload: {
        item: {
          id: 'native-command-1', type: 'commandExecution',
          command: 'sed -n 1,120p SKILL.md', status: 'completed'
        }
      },
      canonical,
      contentBlobId: null, contentByteCount: 0, isTruncated: false,
      occurredAt: '2026-08-12T03:14:08Z'
    }]

    const progress = buildLiveExecutionProgress(
      evidence.map(liveRuntimeEventFromExecutionEvidence),
      'run-terminal'
    )

    expect(progress.items).toEqual([expect.objectContaining({
      kind: 'tool',
      step: expect.objectContaining({
        id: 'command-1',
        title: '读取 SKILL.md',
        status: 'completed'
      })
    })])
  })

  it('does not present a denied or not-executed canonical outcome as completed', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'tool-denied', agentRunId: 'run-acp', eventType: 'runtime.action',
      payload: { toolCallId: 'tool-1', status: 'declined' },
      canonical: canonicalActivity('tool-1', {
        activityDomain: 'tool', phase: 'terminal', outcome: 'not_executed'
      }),
      createdAt: '2026-08-05T00:00:00Z'
    }], 'run-acp')

    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: { status: 'recorded' }
    })
  })

  it('does not present an ACP protocol kind as Copilot execution detail', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'copilot-tool-call', agentRunId: 'run-copilot', eventType: 'runtime.action',
      payload: {
        toolCallId: 'tool-1', kind: 'execute', title: '检查工作区状态', status: 'pending'
      },
      canonical: canonicalActivity('tool-1', {
        activityDomain: 'shell', semanticKind: 'shell.execute',
        presentationHint: '检查工作区状态', phase: 'started', outcome: 'unknown'
      }),
      createdAt: '2026-08-14T00:00:00Z'
    }], 'run-copilot')

    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        title: '检查工作区状态',
        detail: '',
        status: 'running'
      }
    })
    expect(executionEvidenceCopyText('runtime.action', { kind: 'execute' })).toBeNull()

    const run: AgentRunView = {
      id: 'run-copilot', campTurnId: 'turn-1', conversationId: 'conversation-copilot',
      agentId: 'agent-copilot', taskId: null, responsibilityKey: 'direct:agent-copilot',
      responsibilityGeneration: 0, purpose: '检查工作区状态', completionRole: 'required',
      status: 'running', waitReason: null, executionEpoch: 1,
      terminalResolutionSource: null, terminalReasonCode: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
      executionEvidenceCount: 1, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-14T00:00:00Z', startedAt: '2026-08-14T00:00:01Z',
      endedAt: null, updatedAt: '2026-08-14T00:00:02Z'
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-1', focused: true
    }))
    expect(markup).toContain('tool-call-static')
    expect(markup).not.toContain('tool-call-disclosure')
    expect(markup).not.toContain('tool-call-chevron')
    expect(markup).not.toContain('>execute<')
  })

  it('uses the Core Codex presentation hint without parsing the command in Renderer', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'codex-command', agentRunId: 'run-codex', eventType: 'activity.started',
      payload: {
        item: {
          id: 'command-1', type: 'commandExecution', status: 'inProgress',
          command: '/bin/zsh -lc "sed -n 1,120p /repo/docs/README.md"'
        }
      },
      canonical: canonicalActivity('command-1', {
        activityDomain: 'shell', semanticKind: 'shell.execute',
        presentationHint: '读取 README.md', phase: 'started', outcome: 'unknown'
      }),
      createdAt: '2026-08-11T00:00:00Z'
    }], 'run-codex')

    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        title: '读取 README.md',
        detail: '/bin/zsh -lc "sed -n 1,120p /repo/docs/README.md"',
        activityDomain: 'shell'
      }
    })
  })

  it('selects one terminal full-content entry per logical Tool item', () => {
    const evidence: AgentRunExecutionEvidenceView[] = [{
      id: 'command-started', agentRunId: 'run-1', executionEpoch: 1, sequence: 1,
      eventType: 'activity.started', kind: 'command', phase: 'started',
      payload: { item: { id: 'command-1', type: 'commandExecution' } },
      canonical: canonicalActivity('command-1', {
        activityDomain: 'shell', sourceEvidenceIds: ['command-started', 'command-completed'],
        firstEvidenceSequence: 1, lastEvidenceSequence: 2, revision: 2
      }),
      contentBlobId: 'blob-1', contentByteCount: 20_000, isTruncated: true,
      occurredAt: '2026-08-05T01:00:00Z'
    }, {
      id: 'command-completed', agentRunId: 'run-1', executionEpoch: 1, sequence: 2,
      eventType: 'activity.completed', kind: 'command', phase: 'completed',
      payload: { item: { id: 'command-1', type: 'commandExecution' } },
      canonical: canonicalActivity('command-1', {
        activityDomain: 'shell', sourceEvidenceIds: ['command-started', 'command-completed'],
        firstEvidenceSequence: 1, lastEvidenceSequence: 2, revision: 2
      }),
      contentBlobId: 'blob-2', contentByteCount: 20_000, isTruncated: true,
      occurredAt: '2026-08-05T01:00:01Z'
    }, {
      id: 'files-started', agentRunId: 'run-1', executionEpoch: 1, sequence: 3,
      eventType: 'activity.started', kind: 'file_change', phase: 'started',
      payload: { item: { id: 'files-1', type: 'fileChange' } },
      canonical: canonicalActivity('files-1', {
        activityDomain: 'file', sourceEvidenceIds: ['files-started', 'files-failed'],
        firstEvidenceSequence: 3, lastEvidenceSequence: 4, revision: 2
      }),
      contentBlobId: 'blob-3', contentByteCount: 20_000, isTruncated: true,
      occurredAt: '2026-08-05T01:00:02Z'
    }, {
      id: 'files-failed', agentRunId: 'run-1', executionEpoch: 1, sequence: 4,
      eventType: 'activity.completed', kind: 'file_change', phase: 'failed',
      payload: { item: { id: 'files-1', type: 'fileChange' } },
      canonical: canonicalActivity('files-1', {
        activityDomain: 'file', phase: 'terminal', outcome: 'failed',
        sourceEvidenceIds: ['files-started', 'files-failed'], firstEvidenceSequence: 3,
        lastEvidenceSequence: 4, revision: 2
      }),
      contentBlobId: 'blob-4', contentByteCount: 20_000, isTruncated: true,
      occurredAt: '2026-08-05T01:00:03Z'
    }, {
      id: 'second-command', agentRunId: 'run-1', executionEpoch: 1, sequence: 5,
      eventType: 'command.output.delta', kind: 'command', phase: 'updated',
      payload: { itemId: 'command-2', delta: 'output' },
      canonical: canonicalActivity('command-2', {
        activityDomain: 'shell', phase: 'progress', outcome: 'unknown',
        sourceEvidenceIds: ['second-command'], firstEvidenceSequence: 5,
        lastEvidenceSequence: 5
      }),
      contentBlobId: 'blob-5', contentByteCount: 20_000, isTruncated: true,
      occurredAt: '2026-08-05T01:00:04Z'
    }, {
      id: 'narration', agentRunId: 'run-1', executionEpoch: 1, sequence: 6,
      eventType: 'agent.text.delta', kind: 'narration', phase: 'updated',
      payload: { itemId: 'message-1', delta: '说明' },
      contentBlobId: 'blob-6', contentByteCount: 20_000, isTruncated: true,
      occurredAt: '2026-08-05T01:00:05Z'
    }]

    const selected = selectCompleteExecutionEvidence(evidence)
    expect([...selected.byToolId.keys()]).toEqual(['command-1', 'files-1', 'command-2'])
    expect(selected.byToolId.get('command-1')?.id).toBe('command-completed')
    expect(selected.byToolId.get('files-1')?.id).toBe('files-failed')
    expect(selected.byToolId.get('command-2')?.id).toBe('second-command')
    expect(selected.unassigned.map((item) => item.id)).toEqual(['narration'])
  })

  it('keeps only the beginning of long Tool output and extracts copyable public content', () => {
    expect(toolDetailPreview('short output', false)).toEqual({
      text: 'short output',
      truncated: false
    })
    expect(toolDetailPreview('short output', true)).toEqual({
      text: 'short output',
      truncated: false
    })
    const lines = Array.from({ length: 14 }, (_, index) => `line ${index + 1}`)
    const preview = toolDetailPreview(lines.join('\n'), false)
    expect(preview.truncated).toBe(true)
    expect(preview.text).toContain('line 1')
    expect(preview.text).toContain('line 10')
    expect(preview.text).not.toContain('line 11')
    expect(preview.text).not.toContain('line 14')
    expect(preview.text).toMatch(/line 10\n…（后续内容未显示）$/)

    expect(toolDetailPreview(
      `first line\n…（内容已截断，可按需读取完整证据）`,
      true
    )).toEqual({
      text: 'first line\n…（后续内容未显示）',
      truncated: true
    })

    expect(executionEvidenceCopyText('activity.completed', {
      item: {
        command: 'git diff',
        aggregatedOutput: '\u001b[31mfull diff\u001b[0m\nsecond line',
        exitCode: 0
      },
      _rovaiTruncated: true
    })).toBe('full diff\nsecond line')
    expect(executionEvidenceCopyText('runtime.action', {
      output: { status: 'accepted', receiptId: 'receipt-1' },
      rawOutputDigest: 'must-not-be-copied'
    })).toBe('{\n  "status": "accepted",\n  "receiptId": "receipt-1"\n}')
    expect(executionEvidenceCopyText('file.change.updated', {
      patch: '*** Begin Patch\n*** End Patch',
      itemId: 'hidden-identity'
    })).toBe('*** Begin Patch\n*** End Patch')
    expect(executionEvidenceCopyText('agent.text.delta', {
      delta: 'not a Tool output'
    })).toBeNull()
  })

  it('loads complete historical execution evidence through stable per-AgentRun pages', async () => {
    const requestedAfter: number[] = []
    const evidence = (sequence: number) => ({
      id: `evidence-${sequence}`,
      agentRunId: 'run-history',
      executionEpoch: 1,
      sequence,
      eventType: 'agent.text.delta',
      kind: 'narration' as const,
      phase: 'updated' as const,
      payload: { itemId: null, delta: `片段${sequence}` },
      contentBlobId: null,
      contentByteCount: 32,
      isTruncated: false,
      occurredAt: `2026-08-03T00:00:0${sequence}Z`
    })
    const events = await loadCompleteAgentRunExecutionEvidence(async (params) => {
      requestedAfter.push(params.afterSequence)
      return params.afterSequence === 0
        ? {
            schemaVersion: 1,
            agentRunId: 'run-history',
            requestedAfterSequence: 0,
            nextAfterSequence: 2,
            throughSequence: 3,
            hasMore: true,
            evidence: [evidence(1), evidence(2)]
          }
        : {
            schemaVersion: 1,
            agentRunId: 'run-history',
            requestedAfterSequence: 2,
            nextAfterSequence: 3,
            throughSequence: 3,
            hasMore: false,
            evidence: [evidence(3)]
          }
    }, 'camp-history', 'run-history')

    expect(requestedAfter).toEqual([0, 2])
    expect(events.map((event) => event.id)).toEqual([
      'evidence-1', 'evidence-2', 'evidence-3'
    ])
  })

  it('classifies diff lines without treating file headers as changes', () => {
    expect(diffLineKind('--- a/file.ts')).toBe('metadata')
    expect(diffLineKind('+++ b/file.ts')).toBe('metadata')
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk')
    expect(diffLineKind('-old')).toBe('deletion')
    expect(diffLineKind('+new')).toBe('addition')
    expect(diffLineKind(' unchanged')).toBe('context')
  })

  it('turns git porcelain rows into visible status semantics', () => {
    expect(parseGitStatus(' M src/App.tsx')).toEqual({
      code: 'M',
      label: '修改',
      path: 'src/App.tsx',
      kind: 'change'
    })
    expect(parseGitStatus('?? docs/notes.md')).toMatchObject({ label: '未跟踪', kind: 'addition' })
  })

  it('keeps baseline files visible after the working tree becomes clean', () => {
    const entries = buildGitStatusEntries([], [
      'diff --git a/src/App.tsx b/src/App.tsx',
      'index 123..456 100644',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts'
    ].join('\n'))

    expect(entries).toEqual([
      { code: 'Δ', label: '修改', path: 'src/App.tsx', kind: 'change' },
      { code: 'A', label: '新增', path: 'src/new.ts', kind: 'addition' }
    ])
  })

  it('keeps member selection and Runtime binding explicit', () => {
    const markup = renderToStaticMarkup(createElement(MembersView, {
      agents: [agentProfile()],
      installations: [codexInstallation()],
      runtimeAvailability: [],
      runtimeDiscoveryPending: false,
      selectedAgentId: 'agent_2',
      activeTab: 'identity',
      runtimeFocusRequest: 0,
      onSelectedAgentChange: () => undefined,
      onTabChange: () => undefined,
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('class="member-portrait-button"')
    expect(markup).toContain('aria-label="更换沐瓦的角色图片"')
    expect(markup).toContain('title="更换角色图片"')
    expect(markup).toContain('class="member-runtime-entry-arrow"')
    expect(markup).toContain('class="member-detail-page"')
    expect(markup).toContain('Member / Long-lived identity')
    expect(markup).not.toContain('member-detail-avatar-button')
    expect(markup).not.toContain('memory-capability-toggle')
    expect(markup).toContain('>身份</button>')
    expect(markup).toContain('>运行配置</button>')
    expect(markup).not.toContain('member-list')
    expect(markup).not.toContain('@muwa')
    expect(markup).not.toContain('身份强调色')
    expect(markup).not.toContain('保存运行配置')
  })

  it('keeps a visible draggable member header skeleton when no member is selected', () => {
    const markup = renderToStaticMarkup(createElement(MembersView, {
      agents: [],
      installations: [],
      runtimeAvailability: [],
      runtimeDiscoveryPending: false,
      selectedAgentId: null,
      activeTab: 'identity',
      runtimeFocusRequest: 0,
      topNotices: createElement('div', { className: 'test-page-notice' }, '页面提示'),
      onSelectedAgentChange: () => undefined,
      onTabChange: () => undefined,
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('member-detail-header-empty')
    expect(markup).toContain('<h2>队员</h2>')
    expect(markup).toContain('从左侧选择或创建队员')
    expect(markup.indexOf('member-detail-header-empty'))
      .toBeLessThan(markup.indexOf('test-page-notice'))
    expect(markup.indexOf('test-page-notice'))
      .toBeLessThan(markup.indexOf('member-empty'))
  })
  it('does not expose a standalone context destination in settings navigation', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'system', resolvedTheme: 'day' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      section: 'appearance',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).not.toContain('<strong>上下文</strong>')
    expect(markup).not.toContain('<strong>记忆</strong>')
  })

  it('renders the formal diagnostics center without prototype-only controls', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'system', resolvedTheme: 'day' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      section: 'diagnostics',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).toContain('<h1>诊断与修复</h1>')
    expect(markup).toContain('运行完整自检')
    expect(markup).toContain('导出诊断 JSON')
    expect(markup).toContain('正在读取诊断事实')
    expect(markup).not.toContain('交互稿状态切换器')
    expect(markup).not.toContain('修复全部')
  })

  it('renders long-term memory as a first-class scope and governance workbench', () => {
    const markup = renderToStaticMarkup(createElement(MemoryLibrary, {
      agents: [],
      topNotices: createElement('div', { className: 'test-page-notice' }, '页面提示')
    }))

    expect(markup).toContain('记忆')
    expect(markup).not.toContain('Memory / Governed context')
    expect(markup).toContain('共同记忆')
    expect(markup).toContain('队员记忆')
    expect(markup).toContain('队员间记忆')
    expect(markup).toContain('队员形成')
    expect(markup).toContain('待审核')
    expect(markup).toContain('建议复核')
    expect(markup).toContain('已停止沿用')
    expect(markup).not.toContain('可回看 · 可修订 · 可遗忘')
    expect(markup.indexOf('memory-library-header'))
      .toBeLessThan(markup.indexOf('test-page-notice'))
    expect(markup.indexOf('test-page-notice'))
      .toBeLessThan(markup.indexOf('memory-summary-strip'))
    expect(markup).not.toContain('未确认')
    expect(markup).not.toContain('provisional')
    expect(markup).not.toContain('user_confirmed')
  })

  it('detects duplicate member names independently from hidden handles', () => {
    const existing = agentProfile()
    expect(hasDuplicateMemberDisplayName('  沐瓦  ', null, [existing])).toBe(true)
    expect(hasDuplicateMemberDisplayName('沐瓦', existing.agentId, [existing])).toBe(false)
    expect(hasDuplicateMemberDisplayName('洛可', null, [existing])).toBe(false)
  })

  it('always offers the complete Product Runtime catalog without exposing paths', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: agentProfile(),
      installations: [codexInstallation()],
      runtimeAvailability: [productAvailability('codex-cli', 'ready')],
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('>Codex CLI</option>')
    expect(markup).toContain('>OpenCode</option>')
    expect(markup).toContain('>GitHub Copilot</option>')
    expect(markup).toContain('>Claude Code</option>')
    expect(markup).toContain('>Kiro</option>')
    expect(markup).toContain('>Qoder</option>')
    expect(markup).toContain('>CodeBuddy</option>')
    expect(markup).toContain('>Qwen Code</option>')
    expect(markup).toContain('>Antigravity</option>')
    expect(markup).toContain('未配置 Agent 运行时')
    expect(markup).not.toContain('已找到')
    expect(markup).not.toContain('尚未检查')
    expect(markup).not.toContain('Claude Code CLI')
    expect(markup).not.toContain('Antigravity App')
    expect(markup).not.toContain('/opt/homebrew/bin/codex')
    expect(markup).toContain('<h3>Agent 运行时</h3>')
    expect(markup).toContain('Agent 运行时')
    expect(markup).toContain('保存运行时')
    expect(markup).not.toContain('放弃更改')
    expect(markup).not.toContain('清除 Agent 运行时')
    expect(markup).toContain('选择产品并使用当前能力快照')
  })

  it('keeps a missing Product Runtime as an unsaved draft and links to its checks', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: {
        ...agentProfile(),
        runtimeConfiguration: configuredRuntime('copilot-cli'),
        runtimeReadiness: {
          status: 'needs_attention',
          blockers: [{ code: 'adapter_installation_missing', detail: null }]
        }
      },
      installations: [],
      runtimeAvailability: [productAvailability('copilot-cli', 'missing')],
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('GitHub Copilot')
    expect(markup).toContain('只会在 Agent 运行时可用并通过当前能力快照校验后原子保存')
    expect(markup).toContain('未安装')
    expect(markup).toContain('前往 Agent 运行时')
    expect(markup).toContain('<button class="primary-button" disabled="">保存运行时</button>')
    expect(markup).not.toContain('放弃更改')
    expect(markup).not.toContain('清除 Agent 运行时')
  })

  it('disables the Runtime save only while the request is in flight', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: {
        ...agentProfile(),
        runtimeConfiguration: configuredRuntime('codebuddy-cli'),
        runtimeReadiness: {
          status: 'needs_attention',
          blockers: [{ code: 'runtime_authentication_required', detail: null }]
        }
      },
      installations: [],
      runtimeAvailability: [productAvailability('codebuddy-cli', 'authentication_required')],
      busy: 'runtime',
      onSave: async () => undefined,
      onClear: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('<button class="primary-button" disabled="">正在保存…</button>')
  })

  it('shows a selected Runtime as checking without leaking discovery stages', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: {
        ...agentProfile(),
        runtimeConfiguration: configuredRuntime('kiro-cli'),
        runtimeReadiness: {
          status: 'needs_attention',
          blockers: [{ code: 'runtime_probe_required', detail: null }]
        }
      },
      installations: [],
      runtimeAvailability: [],
      runtimeDiscoveryPending: true,
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('正在检查…')
    expect(markup).toContain('Codex CLI')
    expect(markup).toContain('Antigravity')
    expect(markup).not.toContain('正在检测')
    expect(markup).not.toContain('已找到')
    expect(markup).not.toContain('尚未检查')
  })

  it('shows one available status and version without the former blocker banner', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: {
        ...agentProfile(),
        runtimeConfiguration: configuredRuntime('kiro-cli'),
        runtimeReadiness: { status: 'ready', blockers: [] }
      },
      installations: [],
      runtimeAvailability: [productAvailability('kiro-cli', 'ready')],
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('<strong>Kiro</strong>')
    expect(markup).toContain('status-available')
    expect(markup).toContain('可用')
    expect(markup).toContain('kiro-cli 1.0.0')
    expect(markup).not.toContain('runtime-blockers')
    expect(markup).not.toContain('需要探测 Agent 运行时')
  })

  it('keeps product operations visible and paths inside advanced diagnostics', () => {
    const health: HealthStatus = {
      core: { ok: true, version: '0.0.1', dataDir: '/tmp/rovai' },
      database: { ok: true, path: '/tmp/rovai/rovai.db' },
      git: { installed: true, version: 'git version 2.0' },
      runtimeCatalog: [],
      runtimeAvailability: [
        productAvailability('codex-cli', 'ready'),
        productAvailability('opencode-cli', 'found_uninspected'),
        productAvailability('copilot-cli', 'checking'),
        productAvailability('claude-code-cli', 'authentication_required'),
        productAvailability('antigravity-app', 'missing')
      ],
      searchEnvironment: {
        generation: 1,
        createdAt: '2026-07-22T00:00:00Z',
        pathEntryCount: 4,
        shell: {
          status: 'captured',
          interactive: false,
          shellName: 'zsh',
          entryCount: 2,
          elapsedMillis: 12
        }
      }
    }
    const markup = renderToStaticMarkup(createElement(RuntimeInstallationsPanel, {
      health,
      installations: [],
      onReload: async () => undefined
    }))

    expect(markup).toContain('Codex CLI')
    expect(markup).toContain('OpenCode')
    expect(markup).toContain('GitHub Copilot')
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('Antigravity')
    expect(markup).toContain('可用')
    expect(markup).toContain('正在检查…')
    expect(markup).toContain('需要登录')
    expect(markup).toContain('未安装')
    expect(markup).not.toContain('已找到')
    expect(markup).not.toContain('尚未检查')
    expect(markup).not.toContain('已检查')
    expect(markup).toContain('实验性')
    expect(markup).toContain('检查可用性')
    expect(markup).toContain('自查命令')
    expect(markup).toContain('command -v codex &amp;&amp; codex --version')
    expect(markup.match(/安装说明/g)?.length).toBe(9)
    expect(markup).toContain('高级诊断与自定义启动入口')
    expect(markup).not.toContain('/opt/homebrew/bin/codex')
  })
})

function agentProfile(): AgentProfile {
  return {
    agentId: 'agent_2', displayName: '沐瓦', avatarRef: null,
    accent: '#39777a', teamRole: '开发者',
    professionalResponsibilities: '负责实现和验证。', personalityTraits: ['严谨'],
    workingPrinciples: '遵循项目规范。', growthTopic: '',
    defaultCapabilities: [], presence: 'present', runtimeConfiguration: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [{ code: 'runtime_not_configured', detail: null }] },
    memberOrder: 0, version: 1, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z', removedAt: null
  }
}

function configuredRuntime(
  adapterKind: NonNullable<AgentProfile['runtimeConfiguration']>['adapterKind']
): NonNullable<AgentProfile['runtimeConfiguration']> {
  return {
    adapterKind,
    model: { mode: 'runtime_default' },
    permissions: { adapterKind, schemaVersion: 1, values: {} }
  }
}

function codexInstallation(): AdapterInstallation {
  return {
    id: 'installation-codex', adapterKind: 'codex-cli', executablePath: '/opt/homebrew/bin/codex',
    commandName: 'codex', installationClass: 'managed_default', source: 'inherited_path',
    authScope: 'default', enabled: true, generation: 1, pathState: 'valid', version: 1,
    referencedProfileCount: 0, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z',
    lastProbeAttempt: null, relocationHistory: [],
    memberRuntimeDefaults: {
      adapterKind: 'codex-cli',
      model: { mode: 'runtime_default' },
      permissions: {
        adapterKind: 'codex-cli',
        schemaVersion: 1,
        values: {
          sandbox_mode: 'danger-full-access',
          approval_policy: 'never'
        }
      }
    },
    snapshot: {
      reportedVersion: 'codex-cli 0.144.6', executableFingerprint: 'sha256:test',
      authenticationStatus: 'authenticated', probeStatus: 'ready', permissionSchemaVersion: 1,
      permissionSchemaDigest: 'sha256:permissions',
      capabilities: ['model.list'], protocols: ['codex-app-server-v2'], models: [{
        id: 'gpt-5', displayName: 'GPT-5', isDefault: true, hidden: false, deprecated: false,
        options: [{
          key: 'reasoning_effort', label: 'Reasoning effort', valueType: 'enum',
          values: [{ value: 'high', label: 'High' }], defaultValue: 'high', scope: 'run'
        }]
      }],
      permissionOptions: [{
        key: 'sandbox_mode', label: 'sandbox_mode', description: 'Filesystem sandbox.', valueType: 'enum',
        choices: [
          { value: 'workspace-write', label: 'workspace-write' },
          { value: 'danger-full-access', label: 'danger-full-access' }
        ], recommendedValue: 'workspace-write',
        scope: 'session', risk: 'elevated', supported: true, required: true, unsupportedReason: null
      }, {
        key: 'approval_policy', label: 'approval_policy', description: 'Approval policy.', valueType: 'enum',
        choices: [
          { value: 'on-request', label: 'on-request' },
          { value: 'never', label: 'never' }
        ], recommendedValue: 'on-request',
        scope: 'session', risk: 'elevated', supported: true, required: true, unsupportedReason: null
      }],
      observedAt: '2026-07-22T00:00:00Z',
      lastAttemptedAt: '2026-07-22T00:00:00Z',
      lastSuccessfulProbeAt: '2026-07-22T00:00:00Z',
      staleAt: null, lastError: null, nativeSessionCompatibilityKey: 'codex-app-server-v2'
    }
  }
}

function productAvailability(
  runtimeKind: HealthStatus['runtimeAvailability'][number]['runtimeKind'],
  status: HealthStatus['runtimeAvailability'][number]['status']
): HealthStatus['runtimeAvailability'][number] {
  return {
    runtimeKind,
    status,
    checking: status === 'detecting' || status === 'checking',
    discovery: {
      runtimeKind,
      discoveryStatus: status === 'detecting' ? 'detecting' : status === 'missing' ? 'missing' : 'found',
      executablePath: status === 'missing' || status === 'detecting' ? null : `/opt/homebrew/bin/${runtimeKind}`,
      source: status === 'missing' || status === 'detecting' ? null : 'inherited_path',
      reportedVersion: status === 'missing' || status === 'detecting' ? null : `${runtimeKind} 1.0.0`,
      executableFingerprint: status === 'missing' || status === 'detecting' ? null : `sha256:${runtimeKind}`,
      searchGeneration: 1,
      observedAt: '2026-07-22T00:00:00Z',
      diagnosticCode: null
    },
    installationId: status === 'ready' ? `installation-${runtimeKind}` : null,
    reportedVersion: status === 'missing' || status === 'detecting' ? null : `${runtimeKind} 1.0.0`,
    diagnosticCode: null
  }
}
