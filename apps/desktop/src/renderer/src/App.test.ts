import { CampDetailEntries } from './CampDetailPopover'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  ActionApprovalView,
  AdapterInstallation,
  AgentProfile,
  AgentRunFileChangesDetailView,
  AgentRunFileChangesView,
  AgentRunView,
  AgentRunExecutionEvidenceView,
  AppUpdateSnapshot,
  CampComposerDraftView,
  CampMessageView,
  CampOpenProjection,
  CampSnapshot,
  CanonicalRuntimeActivityView,
  CoreMethod,
  HealthStatus,
  MessageDeliveryView,
  NotificationActionView,
  RovaiApi,
  SupervisorSnapshot
} from '@contracts'
import {
  App,
  AppHeader,
  CAMP_OPEN_FEEDBACK_DELAY_MS,
  ControlledShutdownOverlay,
  SHUTDOWN_FEEDBACK_DELAY_MS,
  STARTUP_FEEDBACK_DELAY_MS,
  WindowDragStrip,
  allNavigationCamps,
  appendLiveRuntimeEvent,
  authoritativeWorkspaceIsAvailable,
  bootstrapAuthorityCopy,
  campActivationPreview,
  campActivationStateForCreation,
  campDeleteCommand,
  campViewIsVisibleForReadAcknowledgement,
  cancellableTurnIds,
  campCreationPreflightFromAgents,
  campMessageExecutionPurpose,
  campMessageSendParams,
  campOpenProjectionAsSnapshot,
  campSnapshotWithCurrentAnchor,
  campSnapshotWithAnchoredMessages,
  commandFailureMessage,
  createActiveCampRefreshCoordinator,
  effectiveCancellingRunIds,
  effectiveCancellingTurnIds,
  notificationFocusMatchesAction,
  optimisticCampMessage,
  rectanglesIntersect,
  recentCampSnapshot,
  reconcileCancellingTurnIds,
  reconcileRunCancellationIds,
  refreshActiveCampForCoreEvent,
  rememberCampSnapshot,
  requestAuthoritativeCampOpenProjection,
  runtimeRecoveryFromCommandResult,
  selectProjectDirectory,
  SettingsView,
  shouldRefreshNavigationForCoreEvent,
  shouldRefreshActiveCampForCoreEvent,
  StartupRouteLoading,
  shouldLoadRuntimeHealth,
  startupFeedbackShouldBeVisible,
  startupGateShouldBeVisible,
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
  AgentRunFileChangesTimelineCard,
  AgentRunFileChangesReviewSurface,
  agentExecutionProcesses,
  agentRunTerminalNote,
  agentRunCountsAsExecuting,
  agentRunRuntimeModelPresentation,
  agentRunShowsUnsettledWarning,
  attachmentDragKind,
  attachmentDropIsBlocked,
  agentRunStopViewState,
  attachmentRevealLabel,
  canStopAgentRun,
  campConversationHasVisibleHistory,
  campConversationViewFromStoredValue,
  campConversationTimeline,
  composerDraftNeedsContinuationRepair,
  composerDraftNeedsReplyRepair,
  composerHasSendablePayload,
  composerRecipientSummary,
  composerSendIsDisabled,
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
  executionConsoleIsVisible,
  executionPlacementChangeShouldStart,
  executionPlacementSaveFailureMessage,
  executionDisclosureOpenAfterActivity,
  executionDisclosureIsLiveOpen,
  firstSubmittedAgentRun,
  formatStopElapsed,
  isViewingNonTerminalAgentRun,
  loadCompleteAgentRunExecutionEvidence,
  memberRuntimeConfigurationPresentation,
  preferredAgentProcessRun,
  rectanglesOverlap,
  runningAgentRunForWorkspaceEntry,
  runPulseMemberNameLines,
  runtimeOptionsForDisplay,
  taskCreationBlocksSubmittedRunAutoFocus
} from './CampWorkspace'
import {
  initialCampSelection,
  limitDraftNameInput,
  normalizeDraftName,
  planInitialCampSelection,
  projectWorkspaceActionsDisabled,
  toggleCampMemberSelection,
  workspaceInspectionShouldStart,
  workspaceSubmissionBlocked,
  workspaceGitPresentation
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
import type { AppUpdatesController } from './useAppUpdates'
import {
  activityStatusForAgentRun,
  activityIconKind,
  agentRunPresentation,
  agentRunStateTag,
  agentRunWaitDetail,
  buildGitStatusEntries,
  buildLiveExecutionProgress,
  diffLineKind,
  executionActivityTitle,
  executionEvidenceResultText,
  formatByteSize,
  liveRuntimeEventFromCore,
  liveRuntimeEventFromExecutionEvidence,
  parseGitStatus,
  selectCompleteExecutionEvidence,
  type LiveRuntimeEvent
} from './ui-model'

function testAppUpdatesController(): AppUpdatesController {
  return {
    snapshot: null,
    loading: false,
    loadError: true,
    actionError: null,
    check: async () => false,
    download: async () => false,
    install: async () => false,
    dismissPrompt: async () => false
  }
}

function testAppUpdateSnapshot(overrides: Partial<AppUpdateSnapshot> = {}): AppUpdateSnapshot {
  return {
    currentVersion: '0.0.2',
    status: 'available',
    availableRelease: {
      version: '0.0.3',
      releaseName: null,
      releaseDate: null,
      releaseNotes: null
    },
    lastCheckSource: 'startup',
    checkedAt: '2026-08-24T08:00:00.000Z',
    lastSuccessfulCheckAt: '2026-08-24T08:00:01.000Z',
    downloadPercent: null,
    transferredBytes: null,
    totalBytes: null,
    bytesPerSecond: null,
    failureReason: null,
    pendingPrompt: { id: 'prompt-1', version: '0.0.3' },
    ...overrides
  }
}

function supervisorSnapshot(
  overrides: Partial<SupervisorSnapshot> = {}
): SupervisorSnapshot {
  return {
    schemaVersion: 1,
    revision: 1,
    generation: 1,
    runtimeMode: 'bootstrap_only',
    fullCoreState: 'starting',
    authorityState: { kind: 'assessing' },
    startupPhase: 'assessing_authority',
    restartAttempt: 0,
    capabilities: {
      authoritativeWorkspace: false,
      coreRequests: false,
      localPreferences: true,
      supervisorStatus: true,
      diagnosticsExport: true,
      fullCoreRetry: false
    },
    localDegradations: [],
    coreSubsystems: [],
    lastError: null,
    migrationProgress: null,
    ...overrides
  }
}

describe('availability-first workspace gate', () => {
  it('starts with the ordinary page frame before the first Supervisor snapshot, without loading feedback', () => {
    vi.stubGlobal('document', { documentElement: { dataset: {}, style: {} } })
    vi.stubGlobal('window', { rovai: { platform: 'darwin' } })
    try {
      const markup = renderToStaticMarkup(createElement(App))
      expect(markup).toContain('unified-sidebar')
      expect(markup).not.toContain('bootstrap-shell')
      expect(markup).not.toContain('startup-route-loading')
      expect(markup).not.toContain('sidebar-empty')
      expect(markup).not.toContain('onboarding-app-shell')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('mounts the authoritative workspace only for one fully ready capability snapshot', () => {
    expect(authoritativeWorkspaceIsAvailable(null)).toBe(false)
    expect(authoritativeWorkspaceIsAvailable(supervisorSnapshot())).toBe(false)
    expect(authoritativeWorkspaceIsAvailable(supervisorSnapshot({
      runtimeMode: 'full_core',
      fullCoreState: 'ready',
      authorityState: { kind: 'current', origin: 'existing' },
      capabilities: {
        authoritativeWorkspace: true,
        coreRequests: false,
        localPreferences: true,
        supervisorStatus: true,
        diagnosticsExport: true,
        fullCoreRetry: false
      }
    }))).toBe(false)
    expect(authoritativeWorkspaceIsAvailable(supervisorSnapshot({
      runtimeMode: 'full_core',
      fullCoreState: 'ready',
      authorityState: { kind: 'current', origin: 'existing' },
      startupPhase: null,
      capabilities: {
        authoritativeWorkspace: true,
        coreRequests: true,
        localPreferences: true,
        supervisorStatus: true,
        diagnosticsExport: true,
        fullCoreRetry: false
      }
    }))).toBe(true)
  })

  it('explains an occupied authority without presenting an empty workspace', () => {
    const copy = bootstrapAuthorityCopy(supervisorSnapshot({
      fullCoreState: 'blocked',
      authorityState: {
        kind: 'owned_by_active_core',
        dataDir: '/private/authority',
        owner: { pid: 42 }
      },
      startupPhase: null
    }))

    expect(copy.title).toContain('另一个 Rovai Core')
    expect(copy.description).toContain('没有创建第二份数据')
    expect(`${copy.title}${copy.description}`).not.toMatch(/空工作区|空列表/)
  })

  it('describes Windows preparation refusal as a shell-only state with a desktop restart', () => {
    const copy = bootstrapAuthorityCopy(supervisorSnapshot({
      fullCoreState: 'blocked',
      authorityState: { kind: 'unknown' },
      startupPhase: 'preparing_windows_data_root'
    }))

    expect(copy.title).toContain('数据目录尚未准备好')
    expect(copy.description).toContain('Core 尚未启动')
    expect(copy.description).toContain('重启桌面壳层')
    expect(`${copy.title}${copy.description}`).not.toMatch(/数据库损坏|权限已修复/)
  })
})

describe('active Camp event invalidation', () => {
  it('refreshes the active Camp when a persisted AgentRun reaches terminal', () => {
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.terminal',
      params: { agentRunId: 'run-1' }
    }, 'camp-1')).toBe(true)
  })

  it('keeps Camp-scoped invalidations on their target Camp', () => {
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.terminal',
      params: { campId: 'camp-2', agentRunId: 'run-2' }
    }, 'camp-1')).toBe(false)
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.cancelled',
      params: { campId: 'camp-1', agentRunId: 'run-1' }
    }, 'camp-1')).toBe(true)
  })

  it('refreshes membership cutover and reconciliation projections', () => {
    for (const method of [
      'camp.member_added',
      'camp.member_removed',
      'camp.membership_reconciliation_started',
      'camp.membership_reconciliation_completed'
    ]) {
      expect(shouldRefreshActiveCampForCoreEvent({
        method,
        params: { campId: 'camp-1' }
      }, 'camp-1')).toBe(true)
    }
  })

  it('requires an exact Camp for runtime model observation events', () => {
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.runtime_model_observed',
      params: { agentRunId: 'run-1' }
    }, 'camp-1')).toBe(false)
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.runtime_model_observed',
      params: { campId: 'camp-1', agentRunId: 'run-1' }
    }, 'camp-1')).toBe(true)
  })

  it('ignores unrelated events and missing active Camps', () => {
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'monitoring.changed',
      params: {}
    }, 'camp-1')).toBe(false)
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.terminal',
      params: { agentRunId: 'run-1' }
    }, null)).toBe(false)
  })

  it('does not start a projection refresh after shutdown begins', () => {
    expect(shouldRefreshActiveCampForCoreEvent({
      method: 'agent_run.cancelled',
      params: { campId: 'camp-1', agentRunId: 'run-1' }
    }, 'camp-1', true)).toBe(false)
  })

  it('coalesces an invalidation burst into one in-flight read and one trailing read', async () => {
    let releaseFirstRead!: () => void
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const refreshOnce = vi.fn()
      .mockImplementationOnce(() => firstRead)
      .mockResolvedValue(undefined)
    const coordinator = createActiveCampRefreshCoordinator(refreshOnce)

    const first = coordinator.refresh('camp-1')
    await Promise.resolve()
    expect(refreshOnce).toHaveBeenCalledTimes(1)

    const joinedSecond = coordinator.refresh('camp-1')
    const joinedThird = coordinator.refresh('camp-1')
    expect(joinedSecond).toBe(first)
    expect(joinedThird).toBe(first)
    expect(refreshOnce).toHaveBeenCalledTimes(1)

    releaseFirstRead()
    await first

    expect(refreshOnce).toHaveBeenCalledTimes(2)
    expect(refreshOnce).toHaveBeenNthCalledWith(1, 'camp-1')
    expect(refreshOnce).toHaveBeenNthCalledWith(2, 'camp-1')
  })

  it('does not lose an invalidation at the refresh completion boundary', async () => {
    let releaseFirstRead!: () => void
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const refreshOnce = vi.fn()
      .mockImplementationOnce(() => firstRead)
      .mockResolvedValue(undefined)
    const coordinator = createActiveCampRefreshCoordinator(refreshOnce)

    const first = coordinator.refresh('camp-1')
    await Promise.resolve()
    const boundaryRefresh = firstRead.then(() => coordinator.refresh('camp-1'))

    releaseFirstRead()
    await Promise.all([first, boundaryRefresh])

    expect(refreshOnce).toHaveBeenCalledTimes(2)
  })

  it('refreshes terminal state from camps.open and replaces the running Camp surface', async () => {
    const projection = (status: AgentRunView['status']): CampOpenProjection => {
      const terminal = status === 'succeeded'
      const complete = {
        loadedCount: 0,
        totalCount: 0,
        omittedCount: 0,
        complete: true
      }
      return {
        schemaVersion: 5,
        throughGlobalSequence: terminal ? 12 : 10,
        camp: {
          id: 'camp-terminal-refresh', title: '终态刷新', activationState: 'active',
          projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
          defaultLeadAgentId: 'agent_2', membershipGeneration: 1, version: 1,
          createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:02Z'
        },
        members: [{
          agentId: 'agent_2', displayName: '沐瓦', teamRole: '验收员', avatarRef: null,
          accent: '#39777a', membershipStatus: 'active', leaveRequestedAt: null,
          profilePresence: 'present', memberOrder: 0, isDefaultLead: true, version: 1
        }],
        membershipReconciliations: [],
        tasks: [],
        messages: [{
          id: 'message-terminal-refresh', sequence: 1, timelineGlobalSequence: 1,
          authorType: 'user', authorId: 'local_user', sourceAgentRunId: null,
          body: '完成验收', content: [{ kind: 'text', text: '完成验收' }], attachments: [],
          addressMode: 'default', addressedAgentIds: [], replyToCampMessageId: null,
          campTurnId: 'turn-terminal-refresh', presentation: null,
          createdAt: '2026-08-25T00:00:00Z'
        }],
        messageDeliveries: [],
        turns: [{
          id: 'turn-terminal-refresh', triggerType: 'camp_message',
          triggerId: 'message-terminal-refresh', status: terminal ? 'completed' : 'running',
          cancelRequestedAt: null, aggregateReasonCode: null,
          executionBudget: TEST_EXECUTION_BUDGET, version: terminal ? 2 : 1,
          createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:02Z',
          endedAt: terminal ? '2026-08-25T00:00:02Z' : null
        }],
        agentRuns: [{
          id: 'run-terminal-refresh', campTurnId: 'turn-terminal-refresh',
          conversationId: 'conversation-terminal-refresh', agentId: 'agent_2', taskId: null,
          responsibilityKey: 'direct:agent_2', responsibilityGeneration: 0,
          purpose: '完成验收', completionRole: 'required', status,
          waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
          cancelAcknowledgedAt: null, terminalResolutionSource: null, terminalReasonCode: null,
          failure: null, runtimeModel: null, executionEpoch: 1,
          permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
          triggerDeliveryGeneration: 0, a2aParentAgentRunId: null,
          a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 0,
          hasUnsettledExternalEffects: false, workspace: { path: '/quick-chat' },
          startingGitObservation: null, endingGitObservation: null,
          version: terminal ? 2 : 1, createdAt: '2026-08-25T00:00:00Z',
          startedAt: '2026-08-25T00:00:00Z',
          endedAt: terminal ? '2026-08-25T00:00:02Z' : null,
          updatedAt: '2026-08-25T00:00:02Z'
        }],
        executionEvidence: [], agentRunFileChanges: [], approvals: [], timeline: [],
        coverage: {
          tasks: complete,
          messages: {
            loadedCount: 1, totalCount: 1, omittedCount: 0, complete: true,
            oldestLoadedSequence: 1, newestLoadedSequence: 1, hasEarlier: false
          },
          messageDeliveries: complete,
          turns: { ...complete, loadedCount: 1, totalCount: 1 },
          agentRuns: { ...complete, loadedCount: 1, totalCount: 1 },
          executionEvidence: complete,
          approvals: complete,
          timeline: complete
        }
      }
    }

    let snapshot = campOpenProjectionAsSnapshot(projection('running'), null)
    const renderCamp = (): string => renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [agentProfile()],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))
    const runningMarkup = renderCamp()
    expect(runningMarkup).toContain('执行中')
    expect(runningMarkup).toContain('status-running')

    const request = vi.fn()
    const api: Pick<RovaiApi, 'request'> = {
      async request<T>(method: CoreMethod, params?: unknown): Promise<T> {
        request(method, params)
        return projection('succeeded') as T
      }
    }
    const coordinator = createActiveCampRefreshCoordinator(async (campId) => {
      const refreshed = await requestAuthoritativeCampOpenProjection(
        api,
        campId,
        'trace-terminal-refresh'
      )
      snapshot = campOpenProjectionAsSnapshot(refreshed, snapshot)
    })
    const refresh = refreshActiveCampForCoreEvent({
      method: 'agent_run.terminal',
      params: { agentRunId: 'run-terminal-refresh' }
    }, 'camp-terminal-refresh', coordinator)

    expect(refresh).not.toBeNull()
    await refresh

    expect(request).toHaveBeenCalledWith('camps.open', {
      traceId: 'trace-terminal-refresh',
      campId: 'camp-terminal-refresh'
    })
    const refreshedMarkup = renderCamp()
    expect(refreshedMarkup).toContain('已完成')
    expect(refreshedMarkup).toContain('state-completed')
    expect(refreshedMarkup).not.toContain('state-running')
    expect(refreshedMarkup).not.toContain('execution-disclosure is-running')
    expect(snapshot.agentRuns[0]?.status).toBe('succeeded')
  })
})

describe('navigation event invalidation', () => {
  it('refreshes only for the generic Core invalidation', () => {
    expect(shouldRefreshNavigationForCoreEvent({
      method: 'navigation.invalidated',
      params: { reason: 'agent_run.terminal', campId: 'camp-1' }
    })).toBe(true)
    expect(shouldRefreshNavigationForCoreEvent({
      method: 'agent_run.terminal',
      params: { agentRunId: 'run-1' }
    })).toBe(false)
  })

  it('ignores unrelated events and all invalidations during shutdown', () => {
    expect(shouldRefreshNavigationForCoreEvent({
      method: 'runtime.discovery.updated',
      params: {}
    })).toBe(false)
    expect(shouldRefreshNavigationForCoreEvent({
      method: 'navigation.invalidated',
      params: {}
    }, true)).toBe(false)
  })
})

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

it('retains every live Runtime event without a rolling count cap', () => {
  const current = Array.from({ length: 600 }, (_, index) => ({
    id: `live-${index + 1}`,
    agentRunId: 'run-long',
    eventType: 'agent.text.delta',
    payload: { itemId: 'message-long', delta: `${index + 1}` },
    createdAt: `2026-08-19T00:00:${String(index % 60).padStart(2, '0')}Z`
  }))
  const next = appendLiveRuntimeEvent(current, {
    id: 'live-601',
    agentRunId: 'run-long',
    eventType: 'runtime.action',
    payload: { toolCallId: 'tool-601', status: 'completed' },
    createdAt: '2026-08-19T00:01:00Z'
  })

  expect(next).toHaveLength(601)
  expect(next[0].id).toBe('live-1')
  expect(next.at(-1)?.id).toBe('live-601')
})

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

describe('AgentRun Runtime model presentation', () => {
  it('shows Runtime defaults before observation and ignores fixed-model Runs', () => {
    expect(agentRunRuntimeModelPresentation({ modelId: null })).toEqual({
      modelId: 'Agent 运行时默认',
      observed: false
    })
    expect(agentRunRuntimeModelPresentation({ modelId: 'gpt-5.6' })).toEqual({
      modelId: 'gpt-5.6',
      observed: true
    })
    expect(agentRunRuntimeModelPresentation(null)).toBeNull()
  })
})

describe('cold startup route presentation', () => {
  it('removes the global gate as soon as Main Window Session returns a target', () => {
    expect(STARTUP_FEEDBACK_DELAY_MS).toBe(400)
    expect(startupFeedbackShouldBeVisible('loading', false)).toBe(false)
    expect(startupFeedbackShouldBeVisible('loading', true)).toBe(true)
    expect(startupFeedbackShouldBeVisible('waiting', false)).toBe(true)
    expect(startupFeedbackShouldBeVisible('resolved', true)).toBe(false)
    expect(startupGateShouldBeVisible(null)).toBe(true)
    expect(startupGateShouldBeVisible({
      schemaVersion: 1,
      sessionId: 'session-1',
      startupLocationMode: 'last_location',
      lastSettingsSection: 'general',
      restorableLocationStatus: 'valid',
      restorableLocation: { kind: 'camp', campId: 'camp-1' }
    })).toBe(false)
  })

  it('renders delayed Camp opening as a local content state with an inline retry', () => {
    const loading = renderToStaticMarkup(createElement(StartupRouteLoading, {
      kind: 'camp',
      waiting: false,
      error: null,
      onRetry: () => undefined
    }))
    const waiting = renderToStaticMarkup(createElement(StartupRouteLoading, {
      kind: 'camp',
      waiting: true,
      error: 'Core unavailable',
      onRetry: () => undefined
    }))
    expect(loading).toContain('data-startup-route="camp"')
    expect(loading).toContain('正在打开对话')
    expect(loading).toContain('最近内容即将就绪')
    expect(loading).not.toContain('startup-gate')
    expect(waiting).toContain('Core unavailable')
    expect(waiting).toContain('重试')
  })
})

describe('Project directory selection', () => {
  it('blocks Project actions and inspection until removed authority is ready', () => {
    const workspace = { name: 'Downloads', projectPath: '/Users/person/Downloads' }

    expect(projectWorkspaceActionsDisabled(false, false)).toBe(true)
    expect(projectWorkspaceActionsDisabled(false, true)).toBe(false)
    expect(workspaceInspectionShouldStart(true, false, workspace.projectPath)).toBe(false)
    expect(workspaceInspectionShouldStart(true, true, workspace.projectPath)).toBe(true)
    expect(workspaceSubmissionBlocked(workspace, false)).toBe(true)
    expect(workspaceSubmissionBlocked(null, false)).toBe(false)
  })

  it('selects the Project without entering the new-conversation flow', async () => {
    const workspace = { name: 'rovai-ai', projectPath: '/repo/rovai-ai' }
    const effects: unknown[] = []

    const outcome = await selectProjectDirectory(
      async () => workspace,
      async (projectPath) => { effects.push(['restore', projectPath]) },
      (project, workspaceHint) => { effects.push(['select', project, workspaceHint]) }
    )

    expect(outcome).toBe('selected')
    expect(effects).toEqual([
      ['restore', '/repo/rovai-ai'],
      ['select', { kind: 'directory', projectPath: '/repo/rovai-ai' }, workspace]
    ])
  })

  it('leaves the current Project unchanged when the directory picker is cancelled', async () => {
    const effects: string[] = []

    const outcome = await selectProjectDirectory(
      async () => null,
      async () => { effects.push('restore') },
      () => { effects.push('select') }
    )

    expect(outcome).toBe('cancelled')
    expect(effects).toEqual([])
  })

  it('does not select or inspect a Project when restoring its access state fails', async () => {
    const workspace = { name: 'Downloads', projectPath: '/Users/person/Downloads' }
    const selectProject = vi.fn()

    await expect(selectProjectDirectory(
      async () => workspace,
      async () => { throw new Error('restore failed') },
      selectProject
    )).rejects.toThrow('restore failed')

    expect(selectProject).not.toHaveBeenCalled()
  })
})

describe('Camp snapshot cache', () => {
  it('authorizes physical deletion from the destructive confirmation', () => {
    expect(campDeleteCommand({ id: 'camp-delete', version: 7 })).toEqual({
      campId: 'camp-delete',
      expectedVersion: 7,
      force: true
    })
  })

  it('retains the current workspace until an uncached Camp projection is ready', () => {
    const snapshot = (campId: string): CampSnapshot => ({
      camp: { id: campId }
    } as CampSnapshot)
    const current = snapshot('camp-current')
    const cachedTarget = snapshot('camp-target')

    expect(campActivationPreview(current, 'camp-current', null, 'camp-target')).toBeNull()
    expect(campActivationPreview(current, 'camp-current', cachedTarget, 'camp-target'))
      .toBe(cachedTarget)
    expect(campActivationPreview(current, 'camp-current', null, 'camp-current')).toBe(current)
    expect(CAMP_OPEN_FEEDBACK_DELAY_MS).toBe(400)
  })

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

  it('adapts the bounded open projection without restoring heavy history', () => {
    const message = (id: string, sequence: number): CampMessageView => ({
      id,
      sequence,
      timelineGlobalSequence: sequence,
      authorType: 'user',
      authorId: 'local_user',
      sourceAgentRunId: null,
      body: id,
      content: [{ kind: 'text', text: id }],
      attachments: [],
      addressMode: 'default',
      addressedAgentIds: [],
      replyToCampMessageId: null,
      campTurnId: null,
      presentation: null,
      createdAt: `2026-08-14T00:00:${String(sequence).padStart(2, '0')}Z`
    })
    const camp = {
      id: 'camp-1',
      title: 'Camp',
      activationState: 'active' as const,
      projectBindingKind: 'quick_chat' as const,
      projectPath: '/quick-chat',
      defaultLeadAgentId: null,
      membershipGeneration: 1,
      version: 1,
      createdAt: '2026-08-14T00:00:00Z',
      updatedAt: '2026-08-14T00:00:00Z'
    }
    const previous = {
      schemaVersion: 33,
      throughGlobalSequence: 10,
      camp,
      members: [],
      membershipReconciliations: [],
      tasks: [],
      messages: [message('older', 1)],
      messageDeliveries: [],
      turns: [],
      agentRuns: [],
      executionEvidence: [],
      contextManifests: [{ id: 'must-not-survive' }],
      approvals: [],
      actions: [{ id: 'must-not-survive' }],
      timeline: []
    } as unknown as CampSnapshot
    const complete = {
      loadedCount: 0,
      totalCount: 0,
      omittedCount: 0,
      complete: true
    }
    const projection = {
      schemaVersion: 5,
      throughGlobalSequence: 20,
      camp,
      members: [],
      membershipReconciliations: [],
      tasks: [],
      messages: [message('recent', 101)],
      messageDeliveries: [],
      turns: [],
      agentRuns: [],
      executionEvidence: [],
      agentRunFileChanges: [],
      approvals: [],
      timeline: [],
      coverage: {
        tasks: complete,
        messages: {
          loadedCount: 1,
          totalCount: 101,
          omittedCount: 100,
          complete: false,
          oldestLoadedSequence: 101,
          newestLoadedSequence: 101,
          hasEarlier: true
        },
        messageDeliveries: complete,
        turns: complete,
        agentRuns: complete,
        executionEvidence: complete,
        approvals: complete,
        timeline: complete
      }
    } satisfies CampOpenProjection

    const snapshot = campOpenProjectionAsSnapshot(projection, previous)

    expect(snapshot.messages.map(({ id }) => id)).toEqual(['older', 'recent'])
    expect(snapshot.contextManifests).toEqual([])
    expect(snapshot.actions).toEqual([])
    expect(snapshot.openCoverage?.messages.loadedCount).toBe(2)
    expect(snapshot.openCoverage?.messages.omittedCount).toBe(99)
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

  it('keeps file drag feedback available while the execution drawer is visible', () => {
    expect(attachmentDropIsBlocked({
      executionDrawerPresent: true,
      mentionPopoverPresent: false
    })).toBe(false)
    expect(attachmentDropIsBlocked({
      executionDrawerPresent: false,
      mentionPopoverPresent: true
    })).toBe(true)
    expect(attachmentDropIsBlocked({
      executionDrawerPresent: true,
      mentionPopoverPresent: true
    })).toBe(true)
  })

  it('delays safe-exit feedback while keeping the shutdown surface non-interactive', () => {
    expect(SHUTDOWN_FEEDBACK_DELAY_MS).toBe(400)

    const pendingMarkup = renderToStaticMarkup(createElement(ControlledShutdownOverlay, {
      visible: false
    }))
    expect(pendingMarkup).toContain('shutdown-scrim is-pending')
    expect(pendingMarkup).toContain('aria-hidden="true"')
    expect(pendingMarkup).not.toContain('role="dialog"')
    expect(pendingMarkup).not.toContain('正在安全退出')

    const markup = renderToStaticMarkup(createElement(ControlledShutdownOverlay))
    expect(markup).toContain('shutdown-scrim is-visible')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('aria-labelledby="controlled-shutdown-title"')
    expect(markup).toContain('aria-describedby="controlled-shutdown-description controlled-shutdown-evidence"')
    expect(markup).toContain('tabindex="-1"')
    expect(markup).toContain('shutdown-safe-mark')
    expect(markup).toContain('正在安全退出')
    expect(markup).toContain('保存本地状态并关闭后台服务')
    expect(markup).toContain('若有尚未完成的 AgentRun，将一并取消')
    expect(markup).toContain('未确认的文件、命令或工具效果')
    expect(markup).toContain('待核对记录')
    expect(markup).not.toContain('shutdown-stop-mark')
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

    const initializationMessage = {
      ...message('camp-initialized', 1, '2026-08-05T01:58:00Z'),
      authorType: 'system' as const,
      authorId: 'camp-initializer'
    }
    const legacyApprovalResolution = {
      ...message('approval-resolved', 6, '2026-08-05T02:12:00Z'),
      authorType: 'system' as const,
      authorId: 'approval',
      body: 'Approval approval-1 for action action-1 was approved.',
      content: [{
        kind: 'text' as const,
        text: 'Approval approval-1 for action action-1 was approved.'
      }]
    }
    expect(campConversationHasVisibleHistory([])).toBe(false)
    expect(campConversationHasVisibleHistory(
      campConversationTimeline([initializationMessage])
    )).toBe(false)
    expect(campConversationHasVisibleHistory(projected)).toBe(true)

    expect(projected.map((item) => item.id)).toEqual([
      'before-task',
      `task:${task.taskId}`,
      'after-task'
    ])
    expect(campConversationTimeline([legacyApprovalResolution])).toEqual([])
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
    expect(campConversationHasVisibleHistory(updated)).toBe(true)
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

  it('projects every completed AgentRun file-change Evidence as its own timeline card', () => {
    const changes: CampSnapshot['agentRunFileChanges'] = [{
      schemaVersion: 2,
      agentRunId: 'run-a',
      executionEpoch: 1,
      files: [{
        evidenceFileId: 'ef-run-a-0',
        path: 'src/app.ts', changeKind: 'update', presentationKind: 'operation_history',
        operationCount: 1, additions: 4, deletions: 1
      }],
      fileCount: 1,
      operationCount: 1,
      additions: 4,
      deletions: 1,
      completedAt: '2026-08-27T00:00:00Z'
    }, {
      schemaVersion: 2,
      agentRunId: 'run-b',
      executionEpoch: 2,
      files: [{
        evidenceFileId: 'ef-run-b-0',
        path: 'src/styles.css', changeKind: 'update', presentationKind: 'exact_mutations',
        operationCount: 2
      }],
      fileCount: 1,
      operationCount: 2,
      completedAt: '2026-08-27T00:01:00Z'
    }]

    expect(campConversationTimeline([], [], [], [], [], changes)).toMatchObject([
      { id: 'run-file-changes:run-a:1', kind: 'run_file_changes', changes: { agentRunId: 'run-a' } },
      { id: 'run-file-changes:run-b:2', kind: 'run_file_changes', changes: { agentRunId: 'run-b' } }
    ])
  })

  it('anchors each Files Changed card after the last public message from its source run', () => {
    const message = (
      id: string,
      sequence: number,
      agentRunId: string,
      authorId: string,
      createdAt: string
    ): CampSnapshot['messages'][number] => ({
      id,
      sequence,
      timelineGlobalSequence: sequence,
      authorType: 'agent',
      authorId,
      sourceAgentRunId: agentRunId,
      body: id,
      content: [{ kind: 'text', text: id }],
      attachments: [],
      addressMode: 'default',
      addressedAgentIds: [],
      replyToCampMessageId: null,
      campTurnId: 'turn-multi-agent',
      presentation: null,
      createdAt
    })
    const changes = (
      agentRunId: string,
      completedAt: string
    ): CampSnapshot['agentRunFileChanges'][number] => ({
      schemaVersion: 2,
      agentRunId,
      executionEpoch: 1,
      files: [{
        evidenceFileId: `ef-${agentRunId}-0`,
        path: `${agentRunId}/result.ts`,
        changeKind: 'update',
        presentationKind: 'full_net_diff',
        operationCount: 1,
        additions: 1,
        deletions: 1
      }],
      fileCount: 1,
      operationCount: 1,
      additions: 1,
      deletions: 1,
      completedAt
    })

    const projected = campConversationTimeline(
      [
        message('claude-message', 1, 'run-claude', 'agent-claude', '2026-08-28T06:49:36.444822Z'),
        message('claude-followup', 2, 'run-claude', 'agent-claude', '2026-08-28T06:49:38.000000Z'),
        message('kiro-message', 3, 'run-kiro', 'agent-kiro', '2026-08-28T06:49:40.099875Z')
      ],
      [],
      [],
      [],
      [],
      [
        changes('run-claude', '2026-08-28T06:49:40.554605Z'),
        changes('run-kiro', '2026-08-28T06:49:40.099875Z')
      ]
    )

    expect(projected.map((item) => item.id)).toEqual([
      'claude-message',
      'claude-followup',
      'run-file-changes:run-claude:1',
      'kiro-message',
      'run-file-changes:run-kiro:1'
    ])
  })

  it('renders a three-row Files Changed card with a quiet View entry and mixed totals', () => {
    const changes = {
      schemaVersion: 2,
      agentRunId: 'run-card',
      executionEpoch: 3,
      files: [{
        evidenceFileId: 'ef-card-0',
        path: 'src/app.ts', changeKind: 'update', presentationKind: 'full_net_diff',
        operationCount: 1, additions: 4, deletions: 1
      }, {
        evidenceFileId: 'ef-card-1',
        path: 'src/styles.css', changeKind: 'update', presentationKind: 'operation_only',
        operationCount: 1
      }, {
        evidenceFileId: 'ef-card-2',
        path: 'src/card.tsx', changeKind: 'update', presentationKind: 'exact_mutations',
        operationCount: 2
      }, {
        evidenceFileId: 'ef-card-3',
        path: '/tmp/outside-fixture.json', changeKind: 'add', presentationKind: 'operation_only',
        operationCount: 1
      }],
      fileCount: 4,
      operationCount: 5,
      completedAt: '2026-08-27T00:00:00Z'
    } satisfies AgentRunFileChangesView

    const markup = renderToStaticMarkup(createElement(AgentRunFileChangesTimelineCard, {
      changes,
      onOpenReview: vi.fn()
    }))

    expect(markup).toContain('Files Changed')
    expect(markup).toContain('4 个文件 · 5 次修改')
    expect(markup).toContain('class="run-file-changes-card-view"')
    expect(markup).toContain('aria-label="查看 src/app.ts 的文件变化"')
    expect(markup).toContain('src/card.tsx')
    expect(markup).not.toContain('/tmp/outside-fixture.json')
    expect(markup).toContain('再显示 1 个文件')
    expect(markup).not.toContain('本次运行的文件变化')
  })

  it('renders Qoder totals when path-only operations stay in the operation count', () => {
    const changes = {
      schemaVersion: 2,
      agentRunId: 'run-qoder-totals',
      executionEpoch: 1,
      files: [{
        evidenceFileId: 'ef-qoder-0',
        path: 'src/app.ts', changeKind: 'update', presentationKind: 'full_net_diff',
        operationCount: 2, additions: 1, deletions: 1
      }],
      fileCount: 1,
      operationCount: 2,
      additions: 1,
      deletions: 1,
      completedAt: '2026-08-28T00:00:00Z'
    } satisfies AgentRunFileChangesView

    const markup = renderToStaticMarkup(createElement(AgentRunFileChangesTimelineCard, {
      changes,
      onOpenReview: vi.fn()
    }))

    expect(markup).toContain('1 个文件 · +1 −1')
    expect(markup).toContain('class="addition">+1</i>')
    expect(markup).toContain('class="deletion">−1</i>')
    expect(markup).not.toContain('2 次修改')
  })

  it('renders full, exact, history, and operation-only evidence honestly in Files Changed Review', () => {
    const changes = {
      schemaVersion: 2,
      agentRunId: 'run-review',
      executionEpoch: 4,
      files: [{
        evidenceFileId: 'ef-review-0',
        path: 'src/full.ts', changeKind: 'update', presentationKind: 'full_net_diff',
        operationCount: 1, additions: 1, deletions: 1
      }, {
        evidenceFileId: 'ef-review-1',
        path: 'src/exact.ts', changeKind: 'update', presentationKind: 'exact_mutations',
        operationCount: 1
      }, {
        evidenceFileId: 'ef-review-2',
        path: '/tmp/history.ts', changeKind: 'update', presentationKind: 'operation_history',
        operationCount: 3
      }, {
        evidenceFileId: 'ef-review-3',
        path: 'src/path-only.ts', changeKind: 'update', presentationKind: 'operation_only',
        operationCount: 1
      }],
      fileCount: 4,
      operationCount: 6,
      completedAt: '2026-08-27T00:00:00Z'
    } satisfies AgentRunFileChangesView
    const detail = {
      schemaVersion: 2,
      card: changes,
      files: [{
        ...changes.files[0],
        blocks: [{
          sequence: 1,
          semantics: 'full_net_diff',
          changeKind: 'update',
          additions: 1,
          deletions: 1,
          diff: '@@ -10,1 +10,1 @@\n-const oldValue = 1\n+const newValue = 2'
        }]
      }, {
        ...changes.files[1],
        blocks: [{
          sequence: 2,
          semantics: 'exact_mutation',
          changeKind: 'update',
          diff: '-const enabled = false\n+const enabled = true'
        }]
      }, {
        ...changes.files[2],
        blocks: [{
          sequence: 3,
          semantics: 'operation_only',
          changeKind: 'update'
        }, {
          sequence: 4,
          semantics: 'exact_mutation',
          changeKind: 'update',
          diff: '-old\n+new'
        }, {
          sequence: 5,
          semantics: 'exact_mutation',
          changeKind: 'update',
          diff: '-before\n+after'
        }]
      }, {
        ...changes.files[3],
        blocks: [{
          sequence: 5,
          semantics: 'operation_only',
          changeKind: 'update'
        }]
      }]
    } satisfies AgentRunFileChangesDetailView
    const renderReview = (selectedPath: string): string => renderToStaticMarkup(createElement(
      AgentRunFileChangesReviewSurface,
      {
        changes,
        detail,
        detailStatus: 'ready',
        selectedEvidenceFileId: changes.files.find((file) => file.path === selectedPath)?.evidenceFileId ?? null,
        onSelectEvidenceFileId: vi.fn(),
        onOpenCurrent: vi.fn(),
        openCurrentStatus: 'idle',
        openCurrentError: null,
        onBack: vi.fn(),
        onRetry: vi.fn()
      }
    ))

    const fullMarkup = renderReview('src/full.ts')
    expect(fullMarkup).toContain('@@ -10,1 +10,1 @@')
    expect(fullMarkup).toContain('>10<')

    const exactMarkup = renderReview('src/exact.ts')
    expect(exactMarkup).not.toContain('Runtime 提供了精确替换片段')
    expect(exactMarkup).toContain('修改 1')
    expect(exactMarkup).not.toContain('is-hunk')
    expect(exactMarkup).not.toContain('>10<')

    const historyMarkup = renderReview('/tmp/history.ts')
    expect(historyMarkup).not.toContain('该文件包含按时序保存的多次操作')
    expect(historyMarkup).toContain('3 次修改')
    expect(historyMarkup).toContain('修改 1')
    expect(historyMarkup).toContain('修改 2')
    expect(historyMarkup).not.toContain('修改 3')
    expect(historyMarkup).toContain('>old<')
    expect(historyMarkup).toContain('>new<')
    expect(historyMarkup).toContain('>before<')
    expect(historyMarkup).toContain('>after<')
    expect(historyMarkup).not.toContain('这次文件操作没有可靠的差异内容')
    expect(historyMarkup).not.toContain('is-operation-only')

    const operationOnlyMarkup = renderReview('src/path-only.ts')
    expect(operationOnlyMarkup).toContain('没有可审查的差异内容')
    expect(operationOnlyMarkup).toContain('Rovai 不读取当前文件，也不推测修改内容')
  })

  it('keeps ordinary directories quiet and presents Git detection metadata and warnings', () => {
    const inspection = (
      state: 'not_git' | 'git_valid' | 'git_invalid',
      headCommit: string | null = null,
      branch: string | null = null
    ) => ({
      name: 'workspace',
      projectPath: '/workspace',
      gitObservation: {
        state,
        repositoryRoot: state === 'git_valid' ? '/workspace' : null,
        gitCommonDir: state === 'git_valid' ? '/workspace/.git' : null,
        objectFormat: state === 'git_valid' ? 'sha1' as const : null,
        headCommit,
        branch,
        dirty: state === 'git_valid' ? false : null,
        observedAt: '2026-07-30T00:00:00Z'
      }
    })

    expect(workspaceGitPresentation(null)).toEqual({ kind: 'none' })
    expect(workspaceGitPresentation(inspection('not_git'))).toEqual({ kind: 'none' })
    expect(workspaceGitPresentation(inspection('git_valid')))
      .toEqual({ kind: 'metadata', label: 'Git · 尚无提交' })
    expect(workspaceGitPresentation(inspection(
      'git_valid',
      '1111111111111111111111111111111111111111',
      'feature/git-label'
    ))).toEqual({ kind: 'metadata', label: 'Git · feature/git-label' })
    expect(workspaceGitPresentation(inspection(
      'git_valid',
      '1111111111111111111111111111111111111111'
    ))).toEqual({ kind: 'metadata', label: 'Git · detached' })
    expect(workspaceGitPresentation(inspection('git_invalid'))).toEqual({
      kind: 'warning',
      label: 'Git 状态异常',
      detail: '无法读取当前 Git 状态。目录仍可使用；执行前会重新检查 Git 状态。'
    })
    expect(workspaceGitPresentation({ name: 'workspace', projectPath: '/workspace' }, 'loading'))
      .toEqual({ kind: 'loading', label: '检测 Git…' })
    expect(workspaceGitPresentation({ name: 'workspace', projectPath: '/workspace' }, 'failed'))
      .toEqual({
        kind: 'warning',
        label: 'Git 检测失败',
        detail: '未能完成 Git 检测。目录仍可使用；执行前会重新检查 Git 状态。'
      })
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

  it('enables one send gate for text or ready attachments and blocks unfinished attachments', () => {
    const baseGate = {
      hasUnavailableMention: false,
      replyRepairRequired: false,
      continuationRepairRequired: false,
      busy: false,
      composerSubmitting: false,
      routingMutating: false,
      composerDraftAvailable: true,
      preparingAttachmentCount: 0,
      failedAttachmentCount: 0
    }

    expect(composerHasSendablePayload('', true)).toBe(true)
    expect(composerSendIsDisabled({
      ...baseGate,
      hasSendablePayload: composerHasSendablePayload('', true)
    })).toBe(false)
    expect(composerHasSendablePayload('   ', false)).toBe(false)
    expect(composerSendIsDisabled({
      ...baseGate,
      hasSendablePayload: composerHasSendablePayload('   ', false)
    })).toBe(true)
    expect(composerSendIsDisabled({
      ...baseGate,
      hasSendablePayload: true,
      preparingAttachmentCount: 1
    })).toBe(true)
    expect(composerSendIsDisabled({
      ...baseGate,
      hasSendablePayload: true,
      failedAttachmentCount: 1
    })).toBe(true)
  })

  it('keeps attachment-only message bytes empty while supplying a non-empty execution purpose', () => {
    const draft: CampComposerDraftView = {
      campId: 'camp-attachment-only',
      body: '',
      content: [],
      revision: 4,
      attachments: [{
        id: 'attachment-only',
        displayName: '说明.txt',
        kind: 'file',
        fileCount: 1,
        mediaType: 'text/plain',
        byteSize: 12,
        previewKind: 'none',
        state: 'ready',
        errorMessage: null,
        createdAt: '2026-08-20T00:00:00Z'
      }],
      replyIntent: null,
      continuationIntent: null,
      updatedAt: '2026-08-20T00:00:00Z',
      expiresAt: '2026-08-27T00:00:00Z'
    }

    expect(campMessageExecutionPurpose(draft)).toBe('Camp attachment-only message')
    expect(campMessageSendParams('command-attachment-only', draft.campId, draft)).toEqual({
      commandId: 'command-attachment-only',
      campId: draft.campId,
      draftRevision: 4,
      execution: {
        taskId: null,
        purpose: 'Camp attachment-only message',
        completionRole: 'required'
      }
    })
    expect(optimisticCampMessage(null, 'command-attachment-only', draft)).toMatchObject({
      body: '',
      content: [],
      attachments: [{ id: 'attachment-only' }]
    })
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

  it('projects Run-local cancellation from local latency into authoritative state', () => {
    const activeRun = {
      id: 'run-local-stop',
      status: 'running' as const,
      cancelRequestedAt: null
    }
    const local = new Set([activeRun.id, 'run-from-another-camp'])
    expect([...effectiveCancellingRunIds(local, { agentRuns: [activeRun] })])
      .toEqual([activeRun.id])
    expect(reconcileRunCancellationIds(local, { agentRuns: [activeRun] }))
      .toEqual(new Set([activeRun.id]))

    const requested = {
      ...activeRun,
      cancelRequestedAt: '2026-08-19T01:00:00Z'
    }
    expect([...effectiveCancellingRunIds(new Set(), { agentRuns: [requested] })])
      .toEqual([activeRun.id])
    expect([...reconcileRunCancellationIds(local, { agentRuns: [requested] })])
      .toEqual([])
    expect([...reconcileRunCancellationIds(local, {
      agentRuns: [{ ...requested, status: 'cancelled' as const }]
    })]).toEqual([])
  })

  it('admits Run Stop only for an active non-blocked Run outside Turn cancellation', () => {
    const run = {
      status: 'waiting' as const,
      waitReason: 'runtime_delivery',
      cancelRequestedAt: null
    }
    const turn = { cancelRequestedAt: null }
    expect(canStopAgentRun(run, turn)).toBe(true)
    expect(canStopAgentRun({ ...run, waitReason: 'recovery_blocked' }, turn)).toBe(false)
    expect(canStopAgentRun({ ...run, cancelRequestedAt: '2026-08-19T01:00:00Z' }, turn))
      .toBe(false)
    expect(canStopAgentRun(run, { cancelRequestedAt: '2026-08-19T01:00:00Z' }))
      .toBe(false)
    expect(canStopAgentRun({ ...run, status: 'cancelled' }, turn)).toBe(false)
    expect(canStopAgentRun(run, null)).toBe(false)

    expect(agentRunStopViewState(run, turn, {
      cancelling: false,
      confirming: false,
      turnCancelling: false
    })).toBe('available')
    expect(agentRunStopViewState(run, turn, {
      cancelling: true,
      confirming: false,
      turnCancelling: false
    })).toBe('stopping')
    expect(agentRunStopViewState(run, turn, {
      cancelling: false,
      confirming: true,
      turnCancelling: false
    })).toBe('confirming')
    expect(agentRunStopViewState({ ...run, status: 'cancelled' }, turn, {
      cancelling: false,
      confirming: false,
      turnCancelling: false
    })).toBe('stopped')
    expect(agentRunStopViewState({ ...run, waitReason: 'recovery_blocked' }, turn, {
      cancelling: false,
      confirming: false,
      turnCancelling: false
    })).toBe('hidden')

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

  it('keeps execution first, exposes the active detail, and only marks actual execution as loading', () => {
    const entries = (executionCount: number | null, runningCount: number): string => renderToStaticMarkup(createElement(CampDetailEntries, {
      activeTab: 'tasks', visible: true, panelId: 'camp-details', executionCount,
      runningCount, taskCount: 4, memberCount: 3, onSelect: () => undefined
    }))
    const running = entries(3, 2)
    expect(running.indexOf('data-detail="execution"')).toBeLessThan(running.indexOf('data-detail="tasks"'))
    expect(running.indexOf('data-detail="tasks"')).toBeLessThan(running.indexOf('data-detail="members"'))
    expect(running).toContain('aria-label="2 位队员正在执行"')
    expect(running).toMatch(/data-detail="tasks" aria-expanded="true"/)
    expect(running).toContain('aria-controls="camp-details"')
    expect(entries(3, 0)).not.toContain('camp-loading-spinner')
    expect(entries(null, 2)).not.toContain('data-detail="execution"')
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
      onFocusApprovals: () => undefined
    }))
    expect(campMarkup).toContain('Quick Chat')
    expect(campMarkup).not.toContain('运行中 1')
    expect(campMarkup).toContain('待审批 1')
    expect(campMarkup).toContain('aria-label="待审批 1，定位输入框上方审批"')
    expect(campMarkup).toContain('camp-detail-entry-host')
    expect(campMarkup).not.toContain('topbar-inspector-toggle')

    const composeStrip = renderToStaticMarkup(createElement(WindowDragStrip, {
      page: 'compose'
    }))
    const settingsStrip = renderToStaticMarkup(createElement(WindowDragStrip, {
      page: 'settings'
    }))
    const membersStrip = renderToStaticMarkup(createElement(WindowDragStrip, {
      page: 'members'
    }))
    const memoryStrip = renderToStaticMarkup(createElement(WindowDragStrip, {
      page: 'memory'
    }))
    expect(composeStrip).toContain('window-drag-strip-compose')
    expect(settingsStrip).toContain('window-drag-strip-settings')
    expect(membersStrip).toContain('window-drag-strip-members')
    expect(memoryStrip).toContain('window-drag-strip-memory')
    expect(composeStrip).toContain('aria-hidden="true"')
    expect(settingsStrip).toContain('aria-hidden="true"')
    expect(membersStrip).toContain('aria-hidden="true"')
    expect(memoryStrip).toContain('aria-hidden="true"')
    expect(composeStrip).not.toContain('快速对话')
    expect(settingsStrip).not.toContain('设置')
    expect(windowDragStripPage('compose')).toBe('compose')
    expect(windowDragStripPage('settings')).toBe('settings')
    expect(windowDragStripPage('members')).toBe('members')
    expect(windowDragStripPage('memory')).toBe('memory')
    expect(windowDragStripPage('camp')).toBeNull()
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

  it('silently filters unavailable saved members and picks an available Lead', () => {
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
    const plan = planInitialCampSelection(preflight, preferred)

    expect(plan).toEqual({
      memberIds: ['agent-a'],
      leadId: 'agent-a'
    })
    expect(preferred).toEqual({
      memberAgentIds: ['agent-a', 'agent-b'],
      defaultLeadAgentId: 'agent-b'
    })
  })

  it('reuses a currently valid saved configuration without extra dialog state', () => {
    const preflight = {
      admissible: true,
      presentMembers: [
        { agentId: 'agent-a', displayName: '洛可', memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'ready' as const }
      ],
      initialLeadAgentId: 'agent-a',
      blockers: []
    }
    const preferred = { memberAgentIds: ['agent-a'], defaultLeadAgentId: 'agent-a' }
    expect(planInitialCampSelection(preflight, preferred)).toEqual({
      memberIds: ['agent-a'],
      leadId: 'agent-a'
    })
  })

  it('falls back to every present member when all saved members are unavailable', () => {
    const preflight = {
      admissible: true,
      presentMembers: [
        { agentId: 'agent-a', displayName: '洛可', memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'ready' as const }
      ],
      initialLeadAgentId: 'agent-a',
      blockers: []
    }
    const preferred = { memberAgentIds: ['agent-b'], defaultLeadAgentId: 'agent-b' }
    expect(planInitialCampSelection(preflight, preferred)).toEqual({
      memberIds: ['agent-a'],
      leadId: 'agent-a'
    })
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
      platform: 'win32',
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
      onDelete: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('新对话')
    expect(markup).toContain('<kbd aria-hidden="true">Ctrl+K</kbd>')
    expect(markup).not.toContain('⌘K')
    expect(markup).toContain('aria-label="Rovai AI"')
    expect(markup).toContain('data-brand-mark="horizon"')
    expect(markup).toContain('data-brand-layout="separated"')
    expect(markup).toContain('data-brand-point="rendezvous"')
    expect(markup).toContain('<strong>Rovai AI</strong>')
    expect(markup).toContain('队员')
    expect(markup).toContain('记忆，2 条普通提案待确认')
    expect(markup).toContain('data-navigation-icon="square-pen"')
    expect(markup).toContain('data-navigation-icon="users"')
    expect(markup).toContain('data-navigation-icon="brain"')
    expect(markup).toContain('data-navigation-icon="settings"')
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
      onDelete: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('data-group="directory:/repo/empty-project"')
    expect(markup).toContain('aria-current="true"')
    expect(markup).toContain('empty-project')
    expect(markup).toContain('还没有对话')
    expect(markup).toContain('管理项目“empty-project”')
  })

  it('keeps Settings restoration separate from the actionable update badge', () => {
    const baseProps = {
      state: 'ready' as const,
      navigation: null,
      activeCampId: null,
      updateSnapshot: testAppUpdateSnapshot(),
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenUpdates: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => undefined,
      onError: () => undefined
    }
    const ordinary = renderToStaticMarkup(createElement(CampNavigation, {
      ...baseProps,
      view: 'camp'
    }))
    expect(ordinary).toContain('role="group" aria-label="设置与应用更新"')
    expect(ordinary).toContain('aria-label="设置，打开上次保留的设置页面"')
    expect(ordinary).toContain('aria-label="打开关于与更新，Rovai AI v0.0.3 更新可用"')
    expect(ordinary).toContain('>更新可用</span>')

    const settings = renderToStaticMarkup(createElement(CampNavigation, {
      ...baseProps,
      view: 'settings',
      settingsSection: 'general'
    }))
    expect(settings).toContain('aria-label="关于与更新，Rovai AI v0.0.3 更新可用"')
    expect(settings).toContain('settings-app-update-badge')
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
      openingCampId: 'unread',
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => undefined,
      onError: () => undefined
    }))

    expect(markup.match(/class="camp-marker-slot"/g)).toHaveLength(3)
    expect(markup).not.toContain('camp-marker-none')
    expect(markup).toContain('camp-marker-unread_completed')
    expect(markup).toContain('camp-marker-loading')
    expect(markup).toContain('aria-busy="true" aria-label="unread 对话，有新回复，正在打开"')
    expect(markup).toContain('title="unread 对话 · 有新回复"')
    expect(markup).toContain('<span class="sr-only">有新回复</span>')
    expect(markup).toContain('class="camp-loading-spinner camp-open-spinner" role="img" aria-label="正在打开对话"')
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
      onDelete: async () => undefined,
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
    expect(applicationGroup).toContain('data-navigation-icon="sliders-horizontal"')
    expect(applicationGroup).toContain('data-navigation-icon="sun-moon"')
    expect(applicationGroup).toContain('data-navigation-icon="bell-ring"')
    expect(applicationGroup.indexOf('<strong>通用</strong>')).toBeLessThan(applicationGroup.indexOf('<strong>外观</strong>'))
    expect(applicationGroup.indexOf('<strong>外观</strong>')).toBeLessThan(applicationGroup.indexOf('<strong>提醒</strong>'))
    expect(capabilitiesGroup).toContain('<strong>Skills</strong>')
    expect(capabilitiesGroup).toContain('<strong>MCP</strong>')
    expect(capabilitiesGroup).toContain('<strong>Agent 运行时</strong>')
    expect(capabilitiesGroup).toContain('<strong>渠道</strong>')
    expect(capabilitiesGroup).toContain('data-navigation-icon="sparkles"')
    expect(capabilitiesGroup).toContain('data-navigation-icon="blocks"')
    expect(capabilitiesGroup).toContain('data-navigation-icon="cpu"')
    expect(capabilitiesGroup).toContain('data-navigation-icon="radio-tower"')
    expect(capabilitiesGroup.indexOf('<strong>Skills</strong>')).toBeLessThan(capabilitiesGroup.indexOf('<strong>MCP</strong>'))
    expect(capabilitiesGroup.indexOf('<strong>MCP</strong>')).toBeLessThan(capabilitiesGroup.indexOf('<strong>Agent 运行时</strong>'))
    expect(capabilitiesGroup.indexOf('<strong>Agent 运行时</strong>')).toBeLessThan(capabilitiesGroup.indexOf('<strong>渠道</strong>'))
    expect(supportGroup).toContain('<strong>诊断与修复</strong>')
    expect(supportGroup).toContain('<strong>运行监控</strong>')
    expect(supportGroup).toContain('<strong>关于与更新</strong>')
    expect(supportGroup).toContain('data-navigation-icon="chart-line"')
    expect(supportGroup).toContain('data-navigation-icon="stethoscope"')
    expect(supportGroup).toContain('data-navigation-icon="info"')
    expect(supportGroup.indexOf('<strong>运行监控</strong>')).toBeLessThan(supportGroup.indexOf('<strong>诊断与修复</strong>'))
    expect(supportGroup.indexOf('<strong>诊断与修复</strong>')).toBeLessThan(supportGroup.indexOf('<strong>关于与更新</strong>'))
    expect(markup).toContain('data-navigation-icon="arrow-left"')
    expect(markup).toContain('class="active" type="button" aria-current="page"')
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
      updates: testAppUpdatesController(),
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }
    const contentBySection: Record<NavigationSettingsSection, string> = {
      general: '通用',
      skills: 'Skills',
      mcp: 'MCP',
      runtime: 'Agent 运行时',
      channels: '渠道',
      appearance: '外观',
      notifications: '提醒',
      monitoring: '运行监控',
      diagnostics: '诊断与修复',
      about: '关于与更新'
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
      updates: testAppUpdatesController(),
      section: 'notifications',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).not.toContain('notification-center-link')
    expect(markup).not.toContain('打开通知中心')
    expect(markup).toContain('设置需要显示临时浮层的提醒。')
    expect(markup).toContain('aria-label="应用内提醒设置"')
    expect(markup).toContain('正在读取提醒设置')
    expect(markup).not.toContain('关闭主开关时会保留四类选择')
    expect(markup).not.toContain('持久边界')
  })

  it('keeps the Appearance page header focused on choosing a theme', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'night', resolvedTheme: 'night' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      updates: testAppUpdatesController(),
      section: 'appearance',
      onDiagnosticsNavigate: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).toContain('选择 Rovai AI 的界面主题。')
    expect(markup).not.toContain('当前 · Steel Night')
    expect(markup).not.toContain('当前呈现')
    expect(markup).not.toContain('已生效')
    expect(markup).not.toContain('当前视觉语言')
  })

  it('places the real Runtime rescan action in the shared page header', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'system', resolvedTheme: 'day' },
      health: null,
      agents: [],
      installations: [],
      busy: null,
      updates: testAppUpdatesController(),
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
    expect(markup).toContain('管理本机 Agent 运行时及其可用状态。')
    expect(markup).not.toContain('Cursor Agent')
    expect(markup).not.toContain('高级诊断与自定义启动入口')
  })

  it('keeps global project navigation on the members page', () => {
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
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('跳转到对话')
    expect(markup).toContain('新对话')
    expect(markup).toContain('设置')
    expect(markup).toContain('should-not-render')
    expect(markup).toContain('id="projects-heading"')
  })

  it('disables the sidebar Project picker while navigation authority is loading', () => {
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'compose',
      state: 'loading',
      navigation: null,
      activeCampId: null,
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
      onRemoveProject: async () => undefined,
      onRename: async () => undefined,
      onDelete: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toMatch(/aria-label="选择工作目录"[^>]*disabled=""/)
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
      schemaVersion: 34,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-1', title: 'Lead 调整', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1',
        membershipGeneration: 1,
        version: 2, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z'
      },
      membershipReconciliations: [],
      members: [{
        agentId: 'agent_1', displayName: '洛可', teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
        isDefaultLead: true, version: 1
      }],
      tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
      contextManifests: [], executionEvidence: [], agentRunFileChanges: [],
      approvals: [], actions: [], timeline: []
    }
    const workspaceProps: Parameters<typeof CampWorkspace>[0] = {
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
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, workspaceProps))
    const pendingMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      ...workspaceProps,
      snapshot: {
        ...snapshot,
        camp: { ...snapshot.camp, activationState: 'pending' }
      }
    }))

    expect(markup).toContain('给 洛可 发消息')
    expect(markup).toContain('集结队伍，写下这次冒险的目标…')
    expect(markup).not.toContain('和队伍继续前行：补充线索、调整方向或布置新任务…')
    expect(markup).not.toContain('默认由 Lead · 洛可接收')
    expect(markup).toContain('开始这段协作')
    expect(markup).toContain('class="empty-camp-mark" data-brand-mark="horizon" data-brand-layout="separated"')
    expect(markup).not.toContain('data-brand-point="rendezvous"')
    expect(markup).not.toContain('linearGradient')
    expect(markup).not.toContain('empty-camp-eyebrow')
    expect(markup).not.toContain('empty-camp-description')
    expect(markup).not.toContain('这里已经保留当前工作区、队员和默认负责人。')
    expect(pendingMarkup).toContain('开始一段新对话')
    expect(pendingMarkup).not.toContain('新对话草稿')
    expect(pendingMarkup).not.toContain('当前只是一份草稿。')
    expect(markup).toContain('快速对话')
    expect(markup).toContain('负责人 · 洛可')
    expect(markup).toContain('1 位队员已在队')
    expect(markup).toContain('Agent 运行时不可用')
    expect(markup).toContain('先了解项目')
    expect(markup).toContain('整理成任务')
    expect(markup).toContain('检查工作区')
    expect(markup).toContain('>队员</span><small>1</small>')
    expect(markup).toContain('协作队员')
    expect(markup).not.toContain('camp-lead-picker')
    expect(markup).toContain('>队长</small>')
    expect(markup).not.toContain('默认负责人 · 洛可')
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
      /<div class="composer-actions"><span class="composer-hint"><span class="sr-only">Enter 发送，Shift\+Enter 换行<\/span><span class="composer-hint-visual" aria-hidden="true"><kbd>↵<\/kbd><span>发送<\/span><span class="composer-hint-separator">·<\/span><kbd>⇧↵<\/kbd><span>换行<\/span><\/span><\/span><button class="primary-button composer-send"/
    )
    expect(markup).not.toContain('<span class="composer-hint">Enter</span>')
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
      schemaVersion: 34,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-empty', title: '暂无可用队员', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: null,
        membershipGeneration: 1,
        version: 2, createdAt: '2026-07-27T00:00:00Z', updatedAt: '2026-07-27T00:00:00Z'
      },
      membershipReconciliations: [],
      members: [{
        agentId: profile.agentId, displayName: profile.displayName, teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'away', memberOrder: 0,
        isDefaultLead: false, version: 1
      }],
      tasks: [], messages: [], messageDeliveries: [], turns: [], agentRuns: [],
      contextManifests: [], executionEvidence: [], agentRunFileChanges: [],
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
      schemaVersion: 34,
      throughGlobalSequence: 3,
      camp: {
        id: 'camp-live', title: '实现功能', activationState: 'active', projectBindingKind: 'directory', projectPath: '/repo',
        defaultLeadAgentId: 'agent_2',
        membershipGeneration: 1,
        version: 1, createdAt: '2026-07-28T05:00:00Z', updatedAt: '2026-07-28T05:01:00Z'
      },
      membershipReconciliations: [],
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
        completionRole: 'required', status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, executionEpoch: 1,
        terminalResolutionSource: null, terminalReasonCode: null,
        failure: null,
        runtimeModel: null,
        permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
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
      agentRunFileChanges: [], approvals: [], actions: [], timeline: []
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
    expect(runningAgentRunForWorkspaceEntry(groupedSnapshot.agentRuns)?.id).toBe('run-muwa')
    expect(runningAgentRunForWorkspaceEntry([
      { ...historicalRun, status: 'waiting' },
      historicalRun
    ])).toBeNull()
    expect(runningAgentRunForWorkspaceEntry([
      snapshot.agentRuns[0],
      {
        ...snapshot.agentRuns[0],
        id: 'run-muwa-newer',
        createdAt: '2026-07-28T05:30:00Z'
      }
    ])?.id).toBe('run-muwa-newer')
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
    expect(taskCreationBlocksSubmittedRunAutoFocus(true, true, 'tasks')).toBe(true)
    expect(taskCreationBlocksSubmittedRunAutoFocus(true, true, 'members')).toBe(false)
    expect(taskCreationBlocksSubmittedRunAutoFocus(true, true, 'execution')).toBe(false)
    expect(taskCreationBlocksSubmittedRunAutoFocus(true, false, 'tasks')).toBe(false)
    expect(taskCreationBlocksSubmittedRunAutoFocus(false, true, 'tasks')).toBe(false)
    expect(executionConsoleIsVisible('bottom', false, 'tasks')).toBe(true)
    expect(executionConsoleIsVisible('inspector', true, 'execution')).toBe(true)
    expect(executionConsoleIsVisible('inspector', true, 'tasks')).toBe(false)
    expect(executionConsoleIsVisible('inspector', false, 'execution')).toBe(false)
    expect(executionPlacementChangeShouldStart('bottom', 'inspector', false)).toBe(true)
    expect(executionPlacementChangeShouldStart('bottom', 'inspector', true)).toBe(false)
    expect(executionPlacementChangeShouldStart('bottom', 'bottom', false)).toBe(false)
    expect(executionPlacementSaveFailureMessage('bottom')).toBe('未能保存，仍在底部。')
    expect(executionPlacementSaveFailureMessage('inspector')).toBe('未能保存，仍在详情浮层。')
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

    const workspaceProps: Parameters<typeof CampWorkspace>[0] = {
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
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, workspaceProps))
    const disabledMapMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      ...workspaceProps,
      worldMapEnabled: false
    }))

    expect(markup).toContain('aria-label="复制这条消息"')
    expect(markup).toContain('和队伍继续前行：补充线索、调整方向或布置新任务…')
    expect(markup).not.toContain('集结队伍，写下这次冒险的目标…')
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
    expect(markup).toContain('aria-label="将执行台移到详情浮层并记住此位置"')
    expect(markup).toContain('class="run-pulse-title"')
    expect(markup).toContain('class="run-pulse-chip is-selected"')
    expect((markup.match(/class="run-pulse-chip(?: is-selected)?"/g) ?? [])).toHaveLength(1)
    expect(markup).not.toContain('<small>执行过程</small>')
    expect(markup).toContain('class="run-pulse-chip-copy"><strong><span>沐瓦</span></strong>')
    expect(markup).toContain('class="run-pulse-chip-state tone-info state-running" role="img"')
    expect(markup).toMatch(/title="沐瓦 · [^"]+"/)
    expect(markup).not.toMatch(/run-pulse-chip-state[^>]*>[^<]+<\/span>/)
    expect(markup).toContain('data-agent-id="agent_2"')
    expect(markup).toContain('执行中')
    expect(markup.indexOf('class="local-message-avatar"'))
      .toBeLessThan(markup.indexOf('class="message-body"'))
    expect(markup).not.toContain('>审计 <small>')
    expect(markup).not.toContain('value="execution"')
    expect(markup).not.toContain('Thinking')
    expect(markup).not.toContain('先检查消息组件。')
    expect(markup).not.toContain('完整证据')
    expect(markup).not.toContain('正在整理思路')
    expect(markup).not.toContain('Progress')
    expect(markup).toContain('正在补充复制入口。')
    expect(markup).not.toContain('Steps')
    expect(markup).toContain('aria-label="会话区视图"')
    expect(markup).toContain('aria-label="会话世界地图"')
    expect(disabledMapMarkup).not.toContain('aria-label="会话区视图"')
    expect(disabledMapMarkup).not.toContain('>会话</button>')
    expect(disabledMapMarkup).not.toContain('>地图</button>')
    expect(disabledMapMarkup).not.toContain('aria-label="会话世界地图"')
    expect(markup).toContain('执行 · 正在运行')
    expect(markup).toContain('pnpm test')
    expect(markup).not.toContain('pnpm test：pnpm test')
    expect(markup).not.toContain('conversation-bubble agent agent-run-message')
    expect(markup).toContain('execution-disclosure')
    expect(markup).not.toContain('stream-reasoning')
    expect(markup).toContain('process-copy stream-narration')
    expect(markup).toContain('tool-call-disclosure')
    expect(markup).not.toContain('working-row')
    expect(markup).not.toContain('live-execution-progress')
    expect(markup).toContain('aria-label="停止当前执行"')
    expect(markup).not.toContain('class="primary-button composer-send"')

    const cachedPreviewMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: groupedSnapshot,
      projectName: 'Rovai',
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      workspaceEntrySnapshotReady: false
    }))
    expect(cachedPreviewMarkup).toContain('class="run-pulse-chip"')
    expect(cachedPreviewMarkup).not.toContain('class="run-pulse-chip is-selected"')
    expect(cachedPreviewMarkup).not.toContain('execution-disclosure')

    const inspectorMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: groupedSnapshot,
      projectName: 'Rovai',
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      executionPlacement: 'inspector',
      inspectorVisible: true
    }))
    const inspectorTabListStart = inspectorMarkup.indexOf('class="camp-detail-entries"')
    const inspectorTabListEnd = inspectorMarkup.indexOf('</div>', inspectorTabListStart)
    const inspectorTabList = inspectorMarkup.slice(inspectorTabListStart, inspectorTabListEnd)
    expect(inspectorTabList.indexOf('>执行</span><small>'))
      .toBeLessThan(inspectorTabList.indexOf('>任务</span><small>'))
    expect(inspectorTabList.indexOf('>任务</span><small>'))
      .toBeLessThan(inspectorTabList.indexOf('>队员</span><small>'))
    expect(inspectorMarkup).toMatch(/data-detail="execution" aria-expanded="true"/)
    expect(inspectorMarkup).toContain('data-placement="inspector"')

    const terminalInspectorMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot: {
        ...groupedSnapshot,
        agentRuns: groupedSnapshot.agentRuns.map((run) => ({
          ...run,
          status: 'succeeded' as const,
          endedAt: run.endedAt ?? '2026-07-28T05:31:00Z'
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
      onStop: () => undefined,
      executionPlacement: 'inspector',
      inspectorVisible: true
    }))
    expect(terminalInspectorMarkup).toMatch(/data-detail="execution" aria-expanded="true"/)

    const ordinaryInspectorMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: 'Rovai',
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      inspectorVisible: true
    }))
    const ordinaryTabListStart = ordinaryInspectorMarkup.indexOf('class="camp-detail-entries"')
    const ordinaryTabListEnd = ordinaryInspectorMarkup.indexOf('</div>', ordinaryTabListStart)
    const ordinaryTabList = ordinaryInspectorMarkup.slice(ordinaryTabListStart, ordinaryTabListEnd)
    expect(ordinaryTabList).not.toContain('>执行</span><small>')
    expect(ordinaryTabList.indexOf('>任务</span><small>'))
      .toBeLessThan(ordinaryTabList.indexOf('>队员</span><small>'))
    expect(ordinaryInspectorMarkup).toMatch(/data-detail="tasks" aria-expanded="true"/)

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
    expect(groupedEvidenceMarkup).toContain('tool-call-disclosure')
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
    expect(cancellingMarkup).toContain('停止请求已发送，正在等待 Agent 运行时退出。')
    expect(cancellingMarkup).toContain('execution-disclosure run-live is-cancelling')
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

  it('splits execution dock member names into two six-grapheme lines and truncates after twelve', () => {
    expect(runPulseMemberNameLines('洛可')).toEqual(['洛可'])
    expect(runPulseMemberNameLines('星野未来产品经理')).toEqual(['星野未来产品', '经理'])
    expect(runPulseMemberNameLines('一二三四五六七八九十甲乙')).toEqual([
      '一二三四五六',
      '七八九十甲乙'
    ])
    expect(runPulseMemberNameLines('一二三四五六七八九十甲乙丙')).toEqual([
      '一二三四五六',
      '七八九十甲乙…'
    ])
    expect(runPulseMemberNameLines('👨‍👩‍👧‍👦一二三四五六')).toEqual([
      '👨‍👩‍👧‍👦一二三四五',
      '六'
    ])
  })

  it('presents the saved model, localized effort and model strategy without inventing Runtime defaults', () => {
    const installation = codexInstallation()
    installation.snapshot!.models = [{
      id: 'gpt-5.6-sol',
      displayName: 'GPT-5.6 Sol',
      isDefault: true,
      hidden: false,
      deprecated: false,
      options: [{
        key: 'reasoning_effort',
        label: 'Reasoning effort',
        valueType: 'enum',
        values: [{ value: 'xhigh', label: 'Extra high' }],
        defaultValue: 'high',
        scope: 'run'
      }]
    }]

    expect(memberRuntimeConfigurationPresentation({
      adapterKind: 'codex-cli',
      model: {
        mode: 'explicit',
        modelId: 'gpt-5.6-sol',
        options: { reasoning_effort: 'xhigh' }
      },
      permissions: { adapterKind: 'codex-cli', schemaVersion: 1, values: {} }
    }, installation)).toEqual({
      model: 'GPT-5.6 Sol',
      effort: { label: '推理强度', value: '极高' },
      strategy: '固定模型',
      summary: 'GPT-5.6 Sol · 推理强度 极高'
    })

    expect(memberRuntimeConfigurationPresentation(
      configuredRuntime('codex-cli'),
      installation
    )).toEqual({
      model: 'Agent 运行时默认',
      effort: null,
      strategy: '跟随 Agent 运行时默认',
      summary: 'Agent 运行时默认'
    })

    expect(memberRuntimeConfigurationPresentation({
      adapterKind: 'claude-code-cli',
      model: {
        mode: 'explicit',
        modelId: 'claude-sonnet-4-6',
        options: { effort: 'high' }
      },
      permissions: { adapterKind: 'claude-code-cli', schemaVersion: 1, values: {} }
    }, null)).toEqual({
      model: 'claude-sonnet-4-6',
      effort: { label: '思考强度', value: '高' },
      strategy: '固定模型',
      summary: 'claude-sonnet-4-6 · 思考强度 高'
    })
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
      schemaVersion: 34,
      throughGlobalSequence: 2,
      camp: {
        id: 'camp-approval', title: '审批停靠区', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1',
        membershipGeneration: 1,
        version: 1, createdAt: '2026-07-30T03:00:00Z', updatedAt: '2026-07-30T03:00:01Z'
      },
      membershipReconciliations: [],
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
      contextManifests: [], executionEvidence: [], agentRunFileChanges: [],
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
    expect((markup.match(/class="camp-detail-entry"/g) ?? []).length).toBe(2)
    expect(markup).toContain('>任务</span><small>0</small>')
    expect(markup).toContain('>队员</span><small>2</small>')
    expect(markup).not.toContain('上下文投递')
    expect(markup).not.toContain('>审批<')
    expect(markup.indexOf('class="approval-dock"')).toBeLessThan(markup.indexOf('class="composer"'))
  })

  it('renders an attachment-only message shell without an empty body bubble', () => {
    const attachmentOnlyMessage: CampMessageView = {
      id: 'message-attachment-only',
      sequence: 1,
      timelineGlobalSequence: 1,
      authorType: 'user',
      authorId: 'local_user',
      sourceAgentRunId: null,
      body: '',
      content: [],
      attachments: [{
        id: 'attachment-timeline',
        displayName: '说明.txt',
        kind: 'file',
        fileCount: 1,
        mediaType: 'text/plain',
        byteSize: 12,
        previewKind: 'none',
        runtimeProjectionState: 'pending'
      }, {
        id: 'attachment-timeline-failed',
        displayName: '不可用.txt',
        kind: 'file',
        fileCount: 1,
        mediaType: 'text/plain',
        byteSize: 8,
        previewKind: 'none',
        runtimeProjectionState: 'failed'
      }],
      addressMode: 'default',
      addressedAgentIds: ['agent_1'],
      replyToCampMessageId: null,
      campTurnId: 'turn-attachment-only',
      presentation: null,
      createdAt: '2026-08-20T00:00:00Z'
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 34,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-attachment-only', title: '附件消息', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1', membershipGeneration: 1, version: 1,
        createdAt: '2026-08-20T00:00:00Z', updatedAt: '2026-08-20T00:00:00Z'
      },
      membershipReconciliations: [],
      members: [{
        agentId: 'agent_1', displayName: '洛可', teamRole: 'Lead',
        avatarRef: null, accent: '#526f88', membershipStatus: 'active', leaveRequestedAt: null,
        profilePresence: 'present', memberOrder: 0, isDefaultLead: true, version: 1
      }],
      tasks: [],
      messages: [attachmentOnlyMessage],
      messageDeliveries: [],
      turns: [],
      agentRuns: [],
      contextManifests: [],
      executionEvidence: [],
      agentRunFileChanges: [],
      approvals: [],
      actions: [],
      timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [agentProfile()],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('class="timeline-node conversation-bubble user"')
    expect(markup).toContain('<strong>你</strong>')
    expect(markup).toContain('aria-label="回复这条消息"')
    expect(markup).toContain('class="timeline-attachments" aria-label="消息附件"')
    expect(markup).toContain('说明.txt')
    expect(markup).toContain('正在准备供队员读取')
    expect(markup).toContain('队员读取不可用')
    expect(markup).toContain('attachment-projection-pending')
    expect(markup).toContain('attachment-projection-failed')
    expect(markup).toContain('aria-label="使用系统应用打开 说明.txt"')
    expect(markup).toContain('aria-label="使用系统应用打开 不可用.txt"')
    expect(markup).not.toContain('aria-label="使用系统应用打开 不可用.txt" disabled=""')
    expect(markup).not.toContain('class="message-bubble"')
  })

  it('uses platform-native labels for revealing Timeline Attachments', () => {
    expect(attachmentRevealLabel('darwin')).toBe('在 Finder 中显示')
    expect(attachmentRevealLabel('win32')).toBe('在文件资源管理器中显示')
    expect(attachmentRevealLabel('linux')).toBe('显示所在位置')
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
      recipientMembershipVersionAtAdmission: 1,
      deliveryKind: 'public_a2a',
      dispatchDisposition: 'dispatch',
      completionRole: 'required',
      gatherId: null,
      gatherDispatchDeliveryId: null,
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
      schemaVersion: 34,
      throughGlobalSequence: 3,
      camp: {
        id: 'camp-a2a', title: 'Agent 协作', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_1',
        membershipGeneration: 1,
        version: 1, createdAt: '2026-07-30T03:00:00Z', updatedAt: '2026-07-30T03:00:01Z'
      },
      membershipReconciliations: [],
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
      agentRunFileChanges: [],
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
      schemaVersion: 34,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-task', title: 'Task 管理', activationState: 'active', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent_2',
        membershipGeneration: 1,
        version: 1, createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z'
      },
      membershipReconciliations: [],
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
      executionEvidence: [], agentRunFileChanges: [], approvals: [], actions: [], timeline: []
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
    expect(markup).toContain('task-new-button')
    expect(markup).toContain('新建任务')
    expect(markup).toContain('实现 Task 工具')
    expect(markup).not.toContain('跨消息持续跟踪，不自动唤醒负责人。')
    expect(markup).toContain('筛选任务状态')
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
    expect(agentRunPresentation({
      status: 'failed',
      waitReason: null,
      terminalReasonCode: 'runtime_interrupted'
    })).toEqual({
      label: '执行已中断',
      tone: 'neutral'
    })
    expect(agentRunStateTag({
      status: 'failed',
      waitReason: null,
      terminalReasonCode: 'runtime_interrupted'
    })).toEqual({
      tag: 'INTERRUPTED',
      tone: 'neutral'
    })
    expect(agentRunTerminalNote({
      terminalReasonCode: 'runtime_interrupted'
    })).toBe('执行连续性已中断，最终结果无法确认；本次执行未被记为已取消。')
    expect(agentRunTerminalNote({ terminalReasonCode: null })).toBeNull()
    expect(formatByteSize(4_096)).toBe('4.0 KB')
  })

  it('drops 100,000 transient Command output frames before Renderer state', () => {
    let accepted = 0
    for (let index = 0; index < 100_000; index += 1) {
      const event = liveRuntimeEventFromCore({
        method: 'command.output.delta',
        params: {
          agentRunId: 'run-output-heavy',
          executionEpoch: 3,
          payload: { itemId: 'command-1', delta: `frame-${index}` }
        }
      }, `transient-${index}`)
      if (event !== null) accepted += 1
    }
    expect(accepted).toBe(0)
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
        title: 'pnpm test',
        detail: '$ pnpm test',
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

  it('omits a renderless Runtime narration fragment after a Tool', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'tool-1', agentRunId: 'run-renderless-narration', eventType: 'runtime.action',
      payload: { toolCallId: 'tool-1', title: 'Edit', status: 'completed' },
      createdAt: '2026-08-27T10:45:16Z'
    }, {
      id: 'thought-close', agentRunId: 'run-renderless-narration', eventType: 'agent.text.delta',
      payload: { itemId: null, delta: '</think>\n\n' },
      createdAt: '2026-08-27T10:45:17Z'
    }], 'run-renderless-narration')

    expect(progress.items.map((item) => item.kind)).toEqual(['tool'])
  })

  it('shows the latest Claude API retry while the AgentRun is still running', () => {
    const retryEvents = [1, 2].map((attempt) => liveRuntimeEventFromCore({
      method: 'runtime.diagnostic',
      params: {
        agentRunId: 'run-claude-retrying',
        payload: {
          diagnosticId: 'claude-api-retry',
          code: 'runtime_api_retrying',
          status: 'retrying',
          attempt,
          maxAttempts: 10,
          retryAfterSeconds: attempt === 1 ? 0 : 4,
          rawDetail: 'api_key=private-key'
        }
      }
    }, `retry-${attempt}`)).filter((event) => event !== null)
    const progress = buildLiveExecutionProgress(retryEvents, 'run-claude-retrying')
    expect(progress.items).toEqual([{
      key: 'diagnostic:claude-api-retry',
      kind: 'diagnostic',
      diagnostic: {
        id: 'claude-api-retry',
        code: 'runtime_api_retrying',
        status: 'retrying',
        attempt: 2,
        maxAttempts: 10,
        retryAfterSeconds: 4
      }
    }])

    const run: AgentRunView = {
      id: 'run-claude-retrying', campTurnId: 'turn-1', conversationId: 'conversation-claude',
      agentId: 'agent-claude', taskId: null, responsibilityKey: 'direct:agent-claude',
      responsibilityGeneration: 0, purpose: '检查 API', completionRole: 'required',
      status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: null,
      terminalReasonCode: null, failure: null, runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
      triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: 2, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-20T15:50:27Z', startedAt: '2026-08-20T15:50:28Z',
      endedAt: null, updatedAt: '2026-08-20T15:50:29Z'
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-1', focused: true
    }))
    expect(markup).toContain('class="runtime-retry-notice"')
    expect(markup).toContain('Claude Code API 暂时不可用')
    expect(markup).toContain('将在 4 秒后重试（第 2/10 次）')
    expect(markup).toContain('本次执行尚未结束，可继续等待或停止执行。')
    expect(markup).toContain('等待 Claude Code 自动重试（2/10）')
    expect(markup).not.toContain('private-key')
  })

  it('keeps the complete Tool chronology after more than twelve operations', () => {
    const progress = buildLiveExecutionProgress(Array.from({ length: 15 }, (_, index) => ({
      id: `tool-evidence-${index + 1}`,
      agentRunId: 'run-long',
      eventType: 'runtime.action',
      payload: {
        toolCallId: `tool-${index + 1}`,
        status: 'completed',
        output: `result-${index + 1}`
      },
      canonical: canonicalActivity(`tool-${index + 1}`, {
        presentationHint: `Tool ${index + 1}`,
        firstEvidenceSequence: index + 1,
        lastEvidenceSequence: index + 1
      }),
      createdAt: `2026-08-18T00:00:${String(index).padStart(2, '0')}Z`
    })), 'run-long')

    expect(progress.items).toHaveLength(15)
    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: { id: 'tool-1', title: 'Tool 1', detail: 'result-1' }
    })
    expect(progress.items[14]).toMatchObject({
      kind: 'tool',
      step: { id: 'tool-15', title: 'Tool 15', detail: 'result-15' }
    })
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
          command: 'sed -n 1,120p SKILL.md', status: 'inProgress',
          commandActions: [{ type: 'read', path: 'SKILL.md' }]
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
          command: 'sed -n 1,120p SKILL.md', status: 'completed',
          commandActions: [{ type: 'read', path: 'SKILL.md' }]
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
        title: 'sed -n 1,120p SKILL.md',
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

  it('projects cancelled activity and unfinished activity in a cancelled run as stopped', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'tool-cancelled', agentRunId: 'run-cancelled', eventType: 'runtime.action',
      payload: { toolCallId: 'tool-1', status: 'cancelled' },
      canonical: canonicalActivity('tool-1', {
        activityDomain: 'shell', phase: 'terminal', outcome: 'cancelled'
      }),
      createdAt: '2026-08-18T02:59:19Z'
    }], 'run-cancelled')

    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: { status: 'stopped' }
    })
    expect(activityStatusForAgentRun('running', 'cancelled')).toBe('stopped')
    expect(activityStatusForAgentRun('completed', 'cancelled')).toBe('completed')
    expect(activityStatusForAgentRun('running', 'failed')).toBe('running')
  })

  it('projects an interrupted terminal as stopped without claiming cancellation', () => {
    const canonical = canonicalActivity('command-interrupted', {
      activityDomain: 'shell', phase: 'terminal', outcome: 'unsettled'
    })
    const progress = buildLiveExecutionProgress([{
      id: 'command-interrupted-terminal',
      agentRunId: 'run-interrupted',
      eventType: 'activity.completed',
      payload: {
        reasonCode: 'runtime_interrupted',
        item: {
          id: 'command-interrupted',
          type: 'commandExecution',
          status: 'interrupted',
          command: 'long-running-command',
          aggregatedOutput: null
        }
      },
      canonical,
      createdAt: '2026-08-18T03:00:00Z'
    }], 'run-interrupted')

    expect(canonical.outcome).toBe('unsettled')
    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: { status: 'stopped' }
    })
  })

  it('shows a failed Claude run public failure even when no execution evidence was recorded', () => {
    const run: AgentRunView = {
      id: 'run-claude-failed', campTurnId: 'turn-1', conversationId: 'conversation-claude',
      agentId: 'agent-claude', taskId: null, responsibilityKey: 'direct:agent-claude',
      responsibilityGeneration: 0, purpose: '检查仓库', completionRole: 'required',
      status: 'failed', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, executionEpoch: 1,
      terminalResolutionSource: 'runtime_terminal', terminalReasonCode: null,
      failure: {
        runtimeKind: 'claude-code-cli', origin: 'runtime', phase: 'terminal',
        code: 'runtime_rate_limited', summary: '请求受到速率限制',
        detail: '请稍后重试。', retryable: true
      },
      runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
      executionEvidenceCount: 0, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-18T00:00:00Z', startedAt: '2026-08-18T00:00:01Z',
      endedAt: '2026-08-18T00:00:02Z', updatedAt: '2026-08-18T00:00:02Z'
    }

    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, campId: 'camp-1'
    }))
    expect(markup).toContain('<details class="execution-disclosure worked is-terminal" open="">')
    expect(markup).toContain('Claude Code 返回错误')
    expect(markup).toContain('请求受到速率限制')
    expect(markup).toContain('请稍后重试。')
    expect(markup).not.toContain('Rovai 内部错误')
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
    expect(executionEvidenceResultText('runtime.action', { kind: 'execute' })).toBeNull()

    const run: AgentRunView = {
      id: 'run-copilot', campTurnId: 'turn-1', conversationId: 'conversation-copilot',
      agentId: 'agent-copilot', taskId: null, responsibilityKey: 'direct:agent-copilot',
      responsibilityGeneration: 0, purpose: '检查工作区状态', completionRole: 'required',
      status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, executionEpoch: 1,
      terminalResolutionSource: null, terminalReasonCode: null,
      failure: null,
      runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
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
    expect(markup).toContain('class="tool-activity-group status-running"')
    expect(markup).toContain('aria-label="执行中：检查工作区状态"')
    expect(markup).not.toContain('class="tool-group-count"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).not.toContain('<span>正在处理</span>')
    expect(markup).not.toContain('<details class="process-action tool-call-disclosure')
    expect(markup).toContain('tool-call-disclosure-slot is-placeholder')
    expect(markup).not.toContain('>execute<')
  })

  it('keeps the settled live-tail Tool group active until a non-Tool boundary arrives', () => {
    const settledTool = {
      key: 'tool:settled',
      kind: 'tool' as const,
      step: {
        id: 'tool-settled',
        title: 'pnpm test',
        publicCommand: 'pnpm test',
        detail: 'Tests passed',
        status: 'completed' as const,
        activityDomain: 'shell',
        iconKind: 'terminal' as const,
        toolName: null,
        credibility: 'runtime_structured' as const
      }
    }
    const run: AgentRunView = {
      id: 'run-live-tail', campTurnId: 'turn-live-tail', conversationId: 'conversation-live-tail',
      agentId: 'agent-live-tail', taskId: null, responsibilityKey: 'direct:agent-live-tail',
      responsibilityGeneration: 0, purpose: '验证连续操作摘要', completionRole: 'required',
      status: 'running', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: null,
      terminalReasonCode: null, failure: null, runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
      triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: 1, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-26T00:00:00Z', startedAt: '2026-08-26T00:00:01Z',
      endedAt: null, updatedAt: '2026-08-26T00:00:02Z'
    }

    const liveTailMarkup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run,
      progress: { items: [settledTool] },
      campId: 'camp-live-tail',
      focused: true
    }))
    expect(liveTailMarkup).toContain('class="tool-activity-group status-running"')
    expect(liveTailMarkup).toContain('aria-label="执行中：pnpm test"')
    expect(liveTailMarkup).toContain('class="tool-group-current"')
    expect(liveTailMarkup).not.toContain('class="tool-group-count"')
    expect(liveTailMarkup).not.toContain('<span>正在处理</span>')

    const boundaryMarkup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run,
      progress: {
        items: [
          settledTool,
          { key: 'narration:boundary', kind: 'narration', body: '继续检查结果。' }
        ]
      },
      campId: 'camp-live-tail',
      focused: true
    }))
    expect(boundaryMarkup).toContain('class="tool-activity-group status-completed"')
    expect(boundaryMarkup).toContain('aria-label="已执行 1 项操作；状态：全部成功"')
    expect(boundaryMarkup).toContain('<span>正在处理</span>')
  })

  it('keeps complete Built-in Camp public results behind nested lazy Tool rows', () => {
    const readResult = {
      mode: 'item',
      message: { messageId: 'message-1', body: '完整消息正文' }
    }
    const searchResult = {
      results: Array.from({ length: 14 }, (_, index) => ({
        messageId: `message-${index + 1}`,
        snippet: `search-result-${index + 1}`
      })),
      truncated: false,
      searchIncomplete: false
    }
    const builtInEvent = (
      operation: 'camp.read' | 'camp.search',
      result: unknown,
      sequence: number
    ) => ({
      id: `${operation}-${sequence}`,
      agentRunId: 'run-builtins',
      eventType: 'runtime.action',
      payload: {
        toolCallId: `${operation}-${sequence}`,
        status: 'completed',
        kind: 'builtin_tool_invocation',
        sourceAuthority: 'core',
        canonicalTool: operation,
        input: null,
        output: null,
        operationProjection: {
          operation,
          canonicalInput: { mustNotAppear: 'private-input-projection' },
          canonicalResult: result
        },
        coreEnvelope: {
          contractVersion: 1,
          ok: true,
          operation,
          requestId: `private-request-${sequence}`,
          receipt: `private-receipt-${sequence}`,
          result
        }
      },
      canonical: canonicalActivity(`${operation}-${sequence}`, {
        toolName: operation,
        presentationHint: operation,
        firstEvidenceSequence: sequence,
        lastEvidenceSequence: sequence
      }),
      createdAt: `2026-08-18T00:00:0${sequence}Z`
    })
    const events = [
      builtInEvent('camp.read', readResult, 1),
      builtInEvent('camp.search', searchResult, 2)
    ]
    const progress = buildLiveExecutionProgress(events, 'run-builtins')
    expect(progress.items).toHaveLength(2)
    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: { title: 'camp.read' }
    })
    const readItem = progress.items[0]
    if (readItem.kind !== 'tool') throw new Error('Expected camp.read Tool progress')
    expect(JSON.parse(readItem.step.detail)).toEqual(readResult)
    expect(readItem.step.detail).not.toContain('coreEnvelope')
    expect(readItem.step.detail).not.toContain('private-request-1')

    const resultText = executionEvidenceResultText('runtime.action', events[1].payload)
    expect(resultText).not.toBeNull()
    expect(JSON.parse(resultText ?? 'null')).toEqual(searchResult)
    expect(resultText).not.toContain('private-input-projection')
    expect(resultText).not.toContain('private-request-2')

    const run: AgentRunView = {
      id: 'run-builtins', campTurnId: 'turn-1', conversationId: 'conversation-builtins',
      agentId: 'agent-builtins', taskId: null, responsibilityKey: 'direct:agent-builtins',
      responsibilityGeneration: 0, purpose: '读取 Camp 历史', completionRole: 'required',
      status: 'succeeded', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, executionEpoch: 1,
      terminalResolutionSource: null, terminalReasonCode: null,
      failure: null,
      runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
      executionEvidenceCount: 2, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-18T00:00:00Z', startedAt: '2026-08-18T00:00:00Z',
      endedAt: '2026-08-18T00:00:02Z', updatedAt: '2026-08-18T00:00:02Z'
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-1', focused: true
    }))
    expect(markup.match(/<details class="tool-activity-group/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="已执行 2 项操作；状态：全部成功"')
    expect(markup).not.toContain('>全部成功<')
    expect(markup).not.toContain('class="tool-group-count"')
    expect(markup.match(/<details class="process-action tool-call-disclosure/g)).toHaveLength(2)
    expect(markup).not.toContain('tool-output-copy-button')
    expect(markup).not.toContain('search-result-1')
    expect(markup).not.toContain('search-result-14')
    expect(markup).not.toContain('role="region"')
    expect(markup).not.toContain('tool-call-result-scroll')
    expect(markup).not.toContain('complete-evidence-control')
    expect(markup).not.toContain('complete-evidence-standalone')
    expect(markup).not.toContain('查看完整工具调用')
    expect(markup).not.toContain('private-input-projection')
    expect(markup).not.toContain('private-request-2')
  })

  it('uses one 16px SVG family and stable four-track markup for the converged icon set', () => {
    const icons = [
      { iconKind: 'terminal' as const, activityDomain: 'shell' },
      { iconKind: 'file' as const, activityDomain: 'file' },
      { iconKind: 'web' as const, activityDomain: 'tool' },
      { iconKind: 'tool' as const, activityDomain: 'tool' },
      { iconKind: 'rovai' as const, activityDomain: 'tool' },
      { iconKind: 'runtime' as const, activityDomain: 'runtime' },
      { iconKind: 'unknown' as const, activityDomain: 'unknown' }
    ]
    const run: AgentRunView = {
      id: 'run-domains', campTurnId: 'turn-domains', conversationId: 'conversation-domains',
      agentId: 'agent-domains', taskId: null, responsibilityKey: 'direct:agent-domains',
      responsibilityGeneration: 0, purpose: '验证指令图标', completionRole: 'required',
      status: 'succeeded', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: null,
      terminalReasonCode: null, failure: null, runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
      triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: icons.length, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-19T00:00:00Z', startedAt: '2026-08-19T00:00:00Z',
      endedAt: '2026-08-19T00:00:09Z', updatedAt: '2026-08-19T00:00:09Z'
    }
    const progress = {
      items: icons.map(({ iconKind, activityDomain }, index) => ({
        key: `tool:${iconKind}`,
        kind: 'tool' as const,
        step: {
          id: `tool-${iconKind}`,
          title: `${iconKind} command`,
          publicCommand: null,
          detail: `${iconKind} complete result`,
          status: 'completed' as const,
          activityDomain,
          iconKind,
          toolName: null,
          credibility: 'runtime_structured' as const
        }
      }))
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-domains', focused: true
    }))

    for (const { iconKind } of icons) {
      expect(markup).toContain(`data-icon-domain="${iconKind}"`)
      expect(markup).not.toContain(`${iconKind} complete result`)
    }
    expect(markup).toContain('aria-label="已执行 7 项操作；状态：全部成功"')
    expect(markup.match(/class="tool-group-icon"/g)).toHaveLength(1)
    expect(markup.match(/class="tool-call-icon"/g)).toHaveLength(icons.length)
    expect(markup.match(/<svg viewBox="0 0 16 16"/g)?.length).toBeGreaterThanOrEqual(icons.length)
    expect(markup.match(/<summary class="tool-call-summary">/g)).toHaveLength(icons.length)
    expect(markup.match(/class="tool-call-state status-completed"/g)).toHaveLength(icons.length)
    expect(markup.match(/class="tool-call-disclosure-slot"/g)).toHaveLength(icons.length)
    expect(markup).toMatch(/tool-call-icon[\s\S]*tool-call-title[\s\S]*tool-call-state[\s\S]*tool-call-disclosure-slot/)
    expect(markup).not.toMatch(/<summary class="tool-call-summary"[^>]*aria-label=/)
  })

  it('keeps a Claude Bash command expandable when the tool result has no output', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'claude-bash-started', agentRunId: 'run-claude', eventType: 'runtime.action',
      payload: {
        toolCallId: 'toolu-claude-bash', status: 'pending', kind: 'execute',
        toolName: 'Bash', title: 'Bash',
        input: "printf '%s\\n' 'ROVAI_CLAUDE_EMPTY_OUTPUT_OK'"
      },
      canonical: canonicalActivity('toolu-claude-bash', {
        activityDomain: 'shell', semanticKind: 'shell.execute',
        presentationHint: 'Bash', phase: 'started', outcome: 'unknown'
      }),
      createdAt: '2026-08-18T00:00:00Z'
    }, {
      id: 'claude-bash-completed', agentRunId: 'run-claude', eventType: 'runtime.action',
      payload: {
        toolCallId: 'toolu-claude-bash', status: 'completed', kind: 'execute',
        toolName: 'Bash', title: 'Bash',
        input: "printf '%s\\n' 'ROVAI_CLAUDE_EMPTY_OUTPUT_OK'", output: null
      },
      canonical: canonicalActivity('toolu-claude-bash', {
        activityDomain: 'shell', semanticKind: 'shell.execute',
        presentationHint: 'Bash', phase: 'terminal', outcome: 'succeeded'
      }),
      createdAt: '2026-08-18T00:00:01Z'
    }], 'run-claude')

    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        title: "printf '%s\\n' 'ROVAI_CLAUDE_EMPTY_OUTPUT_OK'",
        publicCommand: "printf '%s\\n' 'ROVAI_CLAUDE_EMPTY_OUTPUT_OK'",
        status: 'completed'
      }
    })
    const item = progress.items[0]
    if (item.kind !== 'tool') throw new Error('Expected Claude Bash tool progress')
    expect(item.step.detail).toBe(
      "$ printf '%s\\n' 'ROVAI_CLAUDE_EMPTY_OUTPUT_OK'"
    )

    const run: AgentRunView = {
      id: 'run-claude', campTurnId: 'turn-1', conversationId: 'conversation-claude',
      agentId: 'agent-claude', taskId: null, responsibilityKey: 'direct:agent-claude',
      responsibilityGeneration: 0, purpose: '执行无输出 Bash 命令', completionRole: 'required',
      status: 'succeeded', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, executionEpoch: 1,
      terminalResolutionSource: null, terminalReasonCode: null,
      failure: null,
      runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
      a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
      executionEvidenceCount: 2, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-18T00:00:00Z', startedAt: '2026-08-18T00:00:00Z',
      endedAt: '2026-08-18T00:00:01Z', updatedAt: '2026-08-18T00:00:01Z'
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-1', focused: true
    }))
    expect(markup).toContain('tool-call-disclosure')
    expect(markup).toContain('tool-call-disclosure-slot')
    expect(markup).not.toContain('tool-call-disclosure-slot is-placeholder')
    expect(markup).toContain('class="tool-call-state status-completed"')
    expect(markup).toContain('aria-label="成功"')
    expect(markup).not.toContain('tool-call-result-scroll')
    expect(markup).not.toContain('ROVAI_CLAUDE_EMPTY_OUTPUT_OK</pre>')
    expect(markup).toContain(
      'class="tool-call-title" title="printf &#x27;%s\\n&#x27; &#x27;ROVAI_CLAUDE_EMPTY_OUTPUT_OK&#x27;"'
    )
    expect(markup).not.toContain('tool-output-copy-button')
    expect(markup).not.toContain('>已完成<')
    expect(markup).not.toContain('tool-call-static')

    const failedMarkup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run: { ...run, status: 'failed' as const },
      progress: {
        items: [{
          key: 'tool:failed-command',
          kind: 'tool' as const,
          step: {
            id: 'failed-command', title: 'pnpm test', publicCommand: 'pnpm test', detail: 'exit 1',
            status: 'failed' as const, activityDomain: 'shell', iconKind: 'terminal' as const,
            toolName: null,
            credibility: 'runtime_structured'
          }
        }]
      },
      campId: 'camp-1',
      focused: true
    }))
    expect(failedMarkup).toContain('class="tool-call-state status-failed"')
    expect(failedMarkup).toContain('aria-label="失败"')
  })

  it('defers a generic running Shell row until its concrete command is available', () => {
    const pending: LiveRuntimeEvent = {
      id: 'kimi-bash-pending', agentRunId: 'run-kimi', eventType: 'runtime.action',
      payload: {
        toolCallId: 'kimi:tool:1', status: 'pending', kind: 'execute',
        toolName: 'Bash', title: 'Bash', output: '{"command": "pwd"'
      },
      canonical: canonicalActivity('kimi:tool:1', {
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'Bash',
        presentationHint: 'Bash', phase: 'progress', outcome: 'unknown'
      }),
      createdAt: '2026-08-23T00:00:00Z'
    }

    expect(buildLiveExecutionProgress([pending], 'run-kimi').items).toEqual([])

    const completed: LiveRuntimeEvent = {
      ...pending,
      id: 'kimi-bash-completed',
      payload: {
        toolCallId: 'kimi:tool:1', status: 'completed', kind: 'execute',
        toolName: 'Bash', title: 'Bash', input: 'pwd', output: '/repo\n'
      },
      canonical: canonicalActivity('kimi:tool:1', {
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'Bash',
        presentationHint: 'Bash', phase: 'terminal', outcome: 'succeeded'
      }),
      createdAt: '2026-08-23T00:00:01Z'
    }
    const progress = buildLiveExecutionProgress([pending, completed], 'run-kimi')

    expect(progress.items).toHaveLength(1)
    expect(progress.items[0]).toMatchObject({
      key: 'tool:kimi:tool:1',
      kind: 'tool',
      step: {
        title: 'pwd',
        publicCommand: 'pwd',
        detail: '$ pwd\n/repo\n',
        status: 'completed'
      }
    })
  })

  it('still shows concrete running commands and terminal generic Shell evidence', () => {
    const concreteRunning: LiveRuntimeEvent = {
      id: 'shell-concrete', agentRunId: 'run-shell', eventType: 'runtime.action',
      payload: { status: 'pending', kind: 'execute', toolName: 'Bash', input: 'git status' },
      canonical: canonicalActivity('shell-concrete', {
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'Bash',
        presentationHint: 'Bash', phase: 'started', outcome: 'unknown'
      }),
      createdAt: '2026-08-23T00:00:00Z'
    }
    const genericTerminal: LiveRuntimeEvent = {
      id: 'shell-generic-terminal', agentRunId: 'run-shell', eventType: 'runtime.action',
      payload: { status: 'completed', kind: 'execute', toolName: 'Bash' },
      canonical: canonicalActivity('shell-generic-terminal', {
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'Bash',
        presentationHint: 'Bash', phase: 'terminal', outcome: 'succeeded'
      }),
      createdAt: '2026-08-23T00:00:01Z'
    }
    const progress = buildLiveExecutionProgress([concreteRunning, genericTerminal], 'run-shell')

    expect(progress.items).toMatchObject([
      { kind: 'tool', step: { title: 'git status', status: 'running' } },
      { kind: 'tool', step: { title: '终端操作', status: 'completed' } }
    ])
  })

  it('renders one reliable terminal FileChange Activity as sibling rows inside the Tool group', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'raw-apply-patch', agentRunId: 'run-files', eventType: 'runtime.action',
      payload: { toolCallId: 'apply-1', status: 'completed', toolName: 'apply_patch' },
      canonical: canonicalActivity('apply-1', {
        activityDomain: 'file', semanticKind: 'file.write', toolName: 'apply_patch',
        presentationHint: 'apply_patch'
      }),
      createdAt: '2026-08-27T00:00:00Z'
    }, {
      id: 'terminal-file-change', agentRunId: 'run-files', eventType: 'activity.completed',
      payload: {
        item: { id: 'files-1', type: 'fileChange', status: 'completed' }
      },
      canonical: canonicalActivity('files-1', {
        activityDomain: 'file', semanticKind: 'file.write', toolName: null,
        presentationHint: '编辑了 2 个文件',
        diffProjection: {
          schemaVersion: 1,
          source: 'runtime_reported',
          revision: 1,
          sourceEvidenceIds: ['terminal-file-change'],
          status: 'available',
          semanticKind: 'unified_diff_snapshot',
          entries: [{
            path: 'src/app.ts', changeKind: 'update', additions: 2, deletions: 1,
            diff: '@@ -1 +1,2 @@\n-old\n+new\n+next\n'
          }, {
            path: 'src/styles.css', changeKind: 'update', additions: 1, deletions: 1,
            diff: 'old mode 100644\nnew mode 100755\n@@ -4 +4 @@\n-red\n+green\n'
          }]
        }
      }),
      createdAt: '2026-08-27T00:00:01Z'
    }], 'run-files')

    expect(progress.items).toHaveLength(1)
    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        fileChanges: [
          { path: 'src/app.ts', additions: 2, deletions: 1 },
          { path: 'src/styles.css', additions: 1, deletions: 1 }
        ]
      }
    })

    const run: AgentRunView = {
      id: 'run-files', campTurnId: 'turn-files', conversationId: 'conversation-files',
      agentId: 'agent-files', taskId: null, responsibilityKey: 'direct:agent-files',
      responsibilityGeneration: 0, purpose: '修改文件', completionRole: 'required',
      status: 'succeeded', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: 'runtime_terminal',
      terminalReasonCode: null, failure: null, runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
      triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: 2, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-27T00:00:00Z', startedAt: '2026-08-27T00:00:00Z',
      endedAt: '2026-08-27T00:00:02Z', updatedAt: '2026-08-27T00:00:02Z'
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-1', focused: true
    }))
    expect(markup.match(/class="process-action modified-file-row"/g)).toHaveLength(2)
    expect(markup.match(/class="tool-activity-group status-completed"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="已执行 1 项操作；状态：全部成功"')
    expect(markup).toContain('修改 app.ts')
    expect(markup).toContain('修改 styles.css')
    expect(markup).toContain('app.ts 的文件差异')
    expect(markup).toContain('modified-file-diff-line is-metadata')
    expect(markup).toContain('old mode 100644')
    expect(markup).not.toContain('apply_patch')
    expect(markup).not.toContain('编辑了 2 个文件')
  })

  it('keeps a successful path-only file operation as a normal 修改 row without an inline diff', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'terminal-qoder-edit', agentRunId: 'run-qoder', eventType: 'runtime.action',
      payload: {
        toolCallId: 'qoder-edit',
        status: 'completed',
        kind: 'edit',
        output: 'Successfully modified file',
        runtimeFileOperation: {
          status: 'available', operationKind: 'write',
          path: 'rovai-runtime-validation/qoder-cli.txt'
        }
      },
      canonical: canonicalActivity('qoder-edit', {
        activityDomain: 'file',
        semanticKind: 'file.write',
        toolName: 'Edit',
        presentationHint: null,
        phase: 'terminal',
        outcome: 'succeeded'
      }),
      createdAt: '2026-08-27T00:00:00Z'
    }], 'run-qoder')

    expect(progress.items).toHaveLength(1)
    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        title: '修改 qoder-cli.txt',
        detail: 'Successfully modified file',
        status: 'completed',
        activityDomain: 'file'
      }
    })
    if (progress.items[0]?.kind !== 'tool') throw new Error('expected one file Tool row')
    expect(progress.items[0].step.fileChanges).toBeUndefined()
    expect(progress.items[0].step.fileChangeSemantics).toBeUndefined()
  })

  it('renders consecutive Claude Edit mutations as separate rows without inferred hunk line numbers', () => {
    const exactEdit = (
      toolCallId: string,
      oldText: string,
      newText: string
    ): LiveRuntimeEvent => ({
      id: `terminal-${toolCallId}`,
      agentRunId: 'run-claude-edits',
      eventType: 'runtime.action',
      payload: {
        toolCallId,
        status: 'completed',
        kind: 'edit',
        toolName: 'Edit'
      },
      canonical: canonicalActivity(toolCallId, {
        activityDomain: 'file',
        semanticKind: 'file.write',
        toolName: 'Edit',
        presentationHint: 'Edit',
        phase: 'terminal',
        outcome: 'succeeded',
        diffProjection: {
          schemaVersion: 1,
          source: 'runtime_reported',
          revision: 1,
          sourceEvidenceIds: [`evidence-${toolCallId}`],
          status: 'available',
          semanticKind: 'exact_mutation',
          entries: [{
            path: 'apps/desktop/src/renderer/src/CampWorkspace.tsx',
            changeKind: 'update',
            additions: 1,
            deletions: 1,
            diff: `-${oldText}\n+${newText}\n`
          }]
        }
      }),
      createdAt: '2026-08-27T00:00:00Z'
    })
    const progress = buildLiveExecutionProgress([
      exactEdit('toolu-edit-1', 'const enabled = false', 'const enabled = true'),
      exactEdit('toolu-edit-2', 'const enabled = true', 'const enabled = ready')
    ], 'run-claude-edits')

    expect(progress.items).toHaveLength(2)
    expect(progress.items).toMatchObject([
      {
        key: 'tool:toolu-edit-1',
        step: { title: '修改 CampWorkspace.tsx', fileChangeSemantics: 'exact_mutation' }
      },
      {
        key: 'tool:toolu-edit-2',
        step: { title: '修改 CampWorkspace.tsx', fileChangeSemantics: 'exact_mutation' }
      }
    ])

    const run: AgentRunView = {
      id: 'run-claude-edits', campTurnId: 'turn-claude-edits', conversationId: 'conversation-claude-edits',
      agentId: 'agent-claude', taskId: null, responsibilityKey: 'direct:agent-claude',
      responsibilityGeneration: 0, purpose: '连续修改文件', completionRole: 'required',
      status: 'succeeded', waitReason: null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, executionEpoch: 1, terminalResolutionSource: 'runtime_terminal',
      terminalReasonCode: null, failure: null, runtimeModel: null,
      permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
      triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: 4, hasUnsettledExternalEffects: false,
      workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
      version: 1, createdAt: '2026-08-27T00:00:00Z', startedAt: '2026-08-27T00:00:00Z',
      endedAt: '2026-08-27T00:00:02Z', updatedAt: '2026-08-27T00:00:02Z'
    }
    const markup = renderToStaticMarkup(createElement(RunExecutionDisclosure, {
      run, progress, campId: 'camp-1', focused: true
    }))
    expect(markup.match(/class="process-action modified-file-row"/g)).toHaveLength(2)
    expect(markup.match(/modified-file-diff is-exact-mutation/g)).toHaveLength(2)
    expect(markup.match(/class="tool-activity-group status-completed"/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="已执行 2 项操作；状态：全部成功"')
    expect(markup).toContain('CampWorkspace.tsx 的修改片段')
    expect(markup).toContain('const enabled = false')
    expect(markup).toContain('const enabled = ready')
    expect(markup).not.toContain('@@')
    expect(markup).not.toContain('oldLine')
    expect(markup).not.toContain('newLine')
  })

  it('uses truthful public Shell command previews across Runtime adapters', () => {
    const genericShell = canonicalActivity('shell-command', {
      activityDomain: 'shell', semanticKind: 'shell.execute', toolName: null,
      presentationHint: '执行 Shell 命令', phase: 'started', outcome: 'unknown'
    })
    const codexPayload = (command: string): Record<string, unknown> => ({
      item: { type: 'commandExecution', command, commandActions: [{ type: 'unknown' }] }
    })
    const cases = [
      {
        adapter: 'codex-cli',
        canonical: genericShell,
        payload: codexPayload(
          "/bin/zsh -lc 'rovai camp read --help && rovai camp read --camp-id rvcamp_example'"
        ),
        expected: 'rovai camp read --help && rovai camp read --camp-id rvcamp_example'
      },
      { adapter: 'opencode-cli', canonical: { ...genericShell, presentationHint: 'Run fixed printf' }, payload: {}, expected: 'Run fixed printf' },
      { adapter: 'copilot-cli', canonical: { ...genericShell, presentationHint: 'Inspect attachment file' }, payload: {}, expected: 'Inspect attachment file' },
      { adapter: 'kiro-cli', canonical: { ...genericShell, presentationHint: 'Read project file' }, payload: {}, expected: 'Read project file' },
      { adapter: 'qoder-cli', canonical: { ...genericShell, presentationHint: 'Search project' }, payload: {}, expected: 'Search project' },
      { adapter: 'codebuddy-cli', canonical: { ...genericShell, presentationHint: 'Apply patch' }, payload: {}, expected: 'Apply patch' },
      { adapter: 'qwen-code', canonical: { ...genericShell, presentationHint: 'Run tests' }, payload: {}, expected: 'Run tests' },
      {
        adapter: 'trae-cn-cli',
        canonical: { ...genericShell, presentationHint: 'bash' },
        payload: { input: "printf 'TRAE_DISPLAY_LEFT\\n' && printf 'TRAE_DISPLAY_RIGHT\\n'" },
        expected: "printf 'TRAE_DISPLAY_LEFT\\n' && printf 'TRAE_DISPLAY_RIGHT\\n'"
      },
      {
        adapter: 'claude-code-cli',
        canonical: { ...genericShell, toolName: 'Bash', presentationHint: 'Bash' },
        payload: { input: "cargo test --package private-package -- token_must_not_leak" },
        expected: 'cargo test --package private-package -- token_must_not_leak'
      },
      {
        adapter: 'antigravity-app',
        canonical: { ...genericShell, toolName: 'run_command', presentationHint: 'run_command' },
        payload: { input: { command: 'pnpm test' } },
        expected: 'pnpm test'
      }
    ]

    expect(cases).toHaveLength(10)
    for (const testCase of cases) {
      expect(
        executionActivityTitle(testCase.canonical, testCase.payload),
        testCase.adapter
      ).toBe(testCase.expected)
    }
    for (const toolName of [
      'run_command',
      'exec_command',
      'execute_command',
      'bash',
      'execute',
      'shell',
      'terminal'
    ]) {
      expect(executionActivityTitle({
        ...genericShell,
        toolName,
        presentationHint: toolName
      }, {})).toBe('终端操作')
    }
    const agySensitive = executionActivityTitle({
      ...genericShell,
      toolName: 'run_command'
    }, {
      input: {
        command: 'OPENAI_API_KEY=sk-agy-secret pnpm test -- --password agy-password --token agy-token'
      }
    })
    expect(agySensitive).toContain('OPENAI_API_KEY=[已隐藏]')
    expect(agySensitive).toContain('--password [已隐藏]')
    expect(agySensitive).toContain('--token [已隐藏]')
    expect(agySensitive).not.toContain('sk-agy-secret')
    expect(agySensitive).not.toContain('agy-password')
    expect(agySensitive).not.toContain('agy-token')
    const reopenedAgyProgress = buildLiveExecutionProgress([{
      id: 'agy-command-completed', agentRunId: 'run-agy', eventType: 'runtime.action',
      payload: {
        toolCallId: 'agy:conversation:step:4', status: 'completed', kind: 'execute',
        toolName: 'run_command', input: { command: 'pnpm test' }, output: 'tests passed'
      },
      canonical: canonicalActivity('agy:conversation:step:4', {
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'run_command',
        phase: 'terminal', outcome: 'succeeded'
      }),
      createdAt: '2026-08-21T00:00:00Z'
    }], 'run-agy')
    expect(reopenedAgyProgress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        title: 'pnpm test',
        detail: '$ pnpm test\ntests passed',
        status: 'completed',
        activityDomain: 'shell',
        toolName: 'run_command'
      }
    })
    expect(executionActivityTitle(genericShell, codexPayload(
      `/bin/zsh -lc "rovai send --public-only --body 'TOP_SECRET_ARGUMENT'"`
    ))).toBe('rovai send --public-only --body [已隐藏]')
    expect(executionActivityTitle(genericShell, codexPayload(
      `/bin/zsh -lc 'rovai --help'`
    ))).toBe('rovai --help')
    expect(executionActivityTitle(genericShell, codexPayload(
      `/bin/zsh -lc 'rovai send --help'`
    ))).toBe('rovai send --help')
    expect(executionActivityTitle(genericShell, codexPayload(
      `rg --help /private/project/path`
    ))).toBe('rg --help /private/project/path')
    expect(executionActivityTitle(genericShell, codexPayload(
      `rovai send --body '--help'`
    ))).toBe('rovai send --body [已隐藏]')
    expect(executionActivityTitle(genericShell, codexPayload(
      `rovai send 'TOP_SECRET_POSITIONAL_BODY'`
    ))).toBe('rovai send [已隐藏]')
    expect(executionActivityTitle(genericShell, codexPayload(
      `rovai camp TOP_SECRET_UNKNOWN_ACTION`
    ))).toBe('rovai camp TOP_SECRET_UNKNOWN_ACTION')
    expect(executionActivityTitle(genericShell, codexPayload(
      `git status && git checkout feature/command-preview && git rebase main`
    ))).toBe('git status && git checkout feature/command-preview && git rebase main')
    expect(executionActivityTitle(genericShell, codexPayload(
      `node -e 'console.log("一段很长的内联脚本")'`
    ))).toBe(`node -e 'console.log("一段很长的内联脚本")'`)
    expect(executionActivityTitle(genericShell, codexPayload(
      "node <<'NODE'\nconst message = 'heredoc script';\nconsole.log(message);\nNODE"
    ))).toBe("node const message = 'heredoc script' ; console.log(message)")
    const sensitive = executionActivityTitle(genericShell, codexPayload(
      `OPENAI_API_KEY=sk-secret curl -H 'Authorization: Bearer secret-token' --token abc https://example.test`
    ))
    expect(sensitive).toContain('OPENAI_API_KEY=[已隐藏]')
    expect(sensitive).toContain('"Authorization: [已隐藏]"')
    expect(sensitive).toContain('--token [已隐藏]')
    expect(sensitive).not.toContain('sk-secret')
    expect(sensitive).not.toContain('secret-token')
    expect(executionActivityTitle(genericShell, codexPayload(
      `curl --header='Authorization: Bearer another-secret' https://example.test`
    ))).toBe('curl --header="Authorization: [已隐藏]" https://example.test')
    expect(executionActivityTitle({
      ...genericShell,
      presentationHint: '搜索项目文件'
    }, {
      item: {
        type: 'commandExecution', command: 'rg executionActivityTitle apps',
        commandActions: [{ type: 'search', query: 'executionActivityTitle', path: 'apps' }]
      }
    })).toBe('rg executionActivityTitle apps')
    expect(executionActivityTitle(canonicalActivity('file-write', {
      activityDomain: 'file', semanticKind: 'file.write', toolName: null,
      presentationHint: 'write_file', phase: 'started', outcome: 'unknown'
    }), {
      input: 'TOP_SECRET_NON_SHELL_INPUT'
    })).toBe('write_file')
  })

  it('derives the converged icon from canonical identity instead of display text', () => {
    expect(activityIconKind(canonicalActivity('shell-rovai', {
      activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'rovai',
      sourceAuthority: 'core', credibility: 'core_verified'
    }))).toBe('terminal')
    expect(activityIconKind(canonicalActivity('web', {
      activityDomain: 'tool', semanticKind: 'tool.web.search', toolName: 'web_search'
    }))).toBe('web')
    expect(activityIconKind(canonicalActivity('rovai', {
      activityDomain: 'tool', semanticKind: 'tool.call', toolName: 'camp.read',
      sourceAuthority: 'core', credibility: 'core_verified'
    }))).toBe('rovai')
    expect(activityIconKind(canonicalActivity('search', {
      activityDomain: 'tool', semanticKind: 'tool.search', toolName: 'search'
    }))).toBe('tool')
    expect(activityIconKind(canonicalActivity('legacy-git', {
      activityDomain: 'git', semanticKind: 'git.status'
    }))).toBe('unknown')
  })

  it('shows admitted typed Web queries directly and joins multiple queries', () => {
    const query = 'password=公开测试词 token=也照常展示'
    const queries = [query, '第二个搜索词']
    const event: LiveRuntimeEvent = {
      id: 'web-search-completed',
      agentRunId: 'run-search',
      eventType: 'runtime.action',
      payload: {
        toolCallId: 'web-search-1',
        status: 'completed',
        kind: 'web_search',
        toolName: 'WebSearch',
        runtimeSearchOperation: {
          schemaVersion: 1,
          source: 'runtime_reported',
          status: 'available',
          searchKind: 'web',
          query,
          queries
        },
        output: '找到 3 条结果'
      },
      canonical: canonicalActivity('web-search-1', {
        classifierVersion: 'activity-v2',
        activityDomain: 'tool',
        semanticKind: 'tool.web.search',
        toolName: 'WebSearch'
      }),
      createdAt: '2026-08-29T00:00:00Z'
    }
    const progress = buildLiveExecutionProgress([event], 'run-search')

    expect(progress.items[0]).toMatchObject({
      kind: 'tool',
      step: {
        title: 'Web 搜索',
        iconKind: 'web',
        detail: `搜索 ${queries.join('，')}\n找到 3 条结果`
      }
    })
    expect(executionEvidenceResultText('runtime.action', event.payload, event.canonical)).toBe(
      `搜索 ${queries.join('，')}\n找到 3 条结果`
    )
    expect(executionEvidenceResultText('runtime.action', {
      runtimeSearchOperation: {
        schemaVersion: 1,
        source: 'runtime_reported',
        status: 'available',
        searchKind: 'web',
        query
      },
      output: 'single result'
    }, event.canonical)).toBe(
      `搜索 ${query}\nsingle result`
    )
    expect(executionEvidenceResultText('runtime.action', {
      runtimeSearchOperation: {
        schemaVersion: 1,
        source: 'runtime_reported',
        status: 'available',
        searchKind: 'web',
        query
      },
      input: query
    }, event.canonical)).toBe(`搜索 ${query}`)
    expect(executionEvidenceResultText('activity.completed', {
      item: {
        type: 'webSearch',
        output: 'Codex search result'
      },
      runtimeSearchOperation: {
        schemaVersion: 1,
        source: 'runtime_reported',
        status: 'available',
        searchKind: 'web',
        query
      }
    }, event.canonical)).toBe(`搜索 ${query}\nCodex search result`)
    expect(executionEvidenceResultText('runtime.action', {
      runtimeSearchOperation: {
        schemaVersion: 1,
        source: 'runtime_reported',
        status: 'available',
        searchKind: 'web',
        query,
        queries: [query, 42]
      },
      output: 'malformed projection result'
    }, event.canonical)).toBe('malformed projection result')

    expect(executionEvidenceResultText('runtime.action', {
      toolName: 'database.execute',
      query: 'SELECT * FROM users',
      queries: ['SELECT * FROM users', 'DELETE FROM users'],
      output: '1 row'
    }, canonicalActivity('database-1', {
      activityDomain: 'tool', semanticKind: 'tool.call', toolName: 'database.execute'
    }))).toBe('1 row')
    expect(executionEvidenceResultText('runtime.action', {
      runtimeSearchOperation: {
        schemaVersion: 1,
        source: 'runtime_reported',
        status: 'available',
        searchKind: 'web',
        query: 'architecture'
      },
      output: 'vector result'
    }, canonicalActivity('vector-1', {
      activityDomain: 'tool', semanticKind: 'tool.call', toolName: 'vector.lookup'
    }))).toBe('vector result')
    expect(executionEvidenceResultText('activity.completed', {
      item: {
        type: 'dynamicToolCall',
        query: 'some provider argument',
        output: 'done'
      }
    }, canonicalActivity('dynamic-1', {
      activityDomain: 'tool', semanticKind: 'tool.call', toolName: 'dynamic'
    }))).toBe('done')
  })

  it('uses a reliable file-operation path for the Renderer-owned file title', () => {
    expect(executionActivityTitle(canonicalActivity('file-operation', {
      classifierVersion: 'activity-v2',
      activityDomain: 'file',
      semanticKind: 'file.write',
      toolName: 'Edit',
      presentationHint: null
    }), {
      runtimeFileOperation: {
        status: 'available',
        operationKind: 'write',
        path: 'rovai-runtime-validation/qoder-cli.txt'
      }
    })).toBe('修改 qoder-cli.txt')
  })

  it('presents a Codex structured read as the observed terminal command', () => {
    const progress = buildLiveExecutionProgress([{
      id: 'codex-command', agentRunId: 'run-codex', eventType: 'activity.started',
      payload: {
        item: {
          id: 'command-1', type: 'commandExecution', status: 'inProgress',
          command: '/bin/zsh -lc "sed -n 1,120p /repo/docs/README.md"',
          commandActions: [{ type: 'read', path: '/repo/docs/README.md' }]
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
        title: 'sed -n 1,120p /repo/docs/README.md',
        detail: '$ sed -n 1,120p /repo/docs/README.md',
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

  it('extracts only complete public Tool result fields from Evidence', () => {
    expect(executionEvidenceResultText('activity.completed', {
      item: {
        command: 'git diff',
        aggregatedOutput: '\u001b[31mfull diff\u001b[0m\nsecond line',
        exitCode: 0
      },
      _rovaiTruncated: true
    })).toBe('$ git diff\nfull diff\nsecond line')
    expect(executionEvidenceResultText('activity.completed', {
      item: {
        type: 'commandExecution',
        command: "node <<'NODE'\nconst token = 'must-not-leak';\nconsole.log('done');\nNODE",
        aggregatedOutput: 'done'
      }
    })).toBe(
      "$ node <<'NODE' ; const token = '[已隐藏]' ; console.log('done') ; NODE\ndone"
    )
    expect(executionEvidenceResultText('runtime.action', {
      output: { status: 'accepted', receiptId: 'receipt-1' },
      rawOutputDigest: 'must-not-be-rendered'
    })).toBe('{\n  "status": "accepted",\n  "receiptId": "receipt-1"\n}')
    expect(executionEvidenceResultText('runtime.action', {
      kind: 'execute',
      input: "printf 'CLAUDE_DISPLAY_SINGLE\\n'",
      output: 'CLAUDE_DISPLAY_SINGLE\n'
    })).toBe(
      "$ printf 'CLAUDE_DISPLAY_SINGLE\\n'\nCLAUDE_DISPLAY_SINGLE\n"
    )
    expect(executionEvidenceResultText('file.change.updated', {
      patch: '*** Begin Patch\n*** End Patch',
      itemId: 'hidden-identity'
    })).toBe('*** Begin Patch\n*** End Patch')
    expect(executionEvidenceResultText('agent.text.delta', {
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
    expect(markup).not.toContain('Member / Long-lived identity')
    expect(markup).toContain('<h1>沐瓦</h1>')
    expect(markup).not.toContain('<h2>沐瓦</h2>')
    expect(markup).not.toContain('member-detail-avatar-button')
    expect(markup).not.toContain('memory-capability-toggle')
    expect(markup).toContain('>身份</button>')
    expect(markup).toContain('>运行配置</button>')
    expect(markup).not.toContain('member-list')
    expect(markup).not.toContain('@muwa')
    expect(markup).not.toContain('身份强调色')
    expect(markup).toContain('保存运行配置')
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
      updates: testAppUpdatesController(),
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
      updates: testAppUpdatesController(),
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
    expect(markup).toContain('Memory / Library')
    expect(markup).toContain('查看、搜索和管理长期记忆。')
    expect(markup).toContain('记忆库')
    expect(markup).toContain('共同记忆')
    expect(markup).toContain('队员记忆')
    expect(markup).toContain('队员间记忆')
    expect(markup).toContain('队员形成')
    expect(markup).toContain('待审核')
    expect(markup).toContain('待复核')
    expect(markup).not.toContain('建议复核')
    expect(markup).toContain('已停止沿用')
    expect(markup).toContain('class="memory-search"')
    expect(markup).toContain('type="search"')
    expect(markup).not.toContain('范围、治理筛选和搜索只会缩小同一份权威列表')
    expect(markup).not.toContain('可回看 · 可修订 · 可遗忘')
    expect(markup.indexOf('memory-library-header'))
      .toBeLessThan(markup.indexOf('test-page-notice'))
    expect(markup.indexOf('test-page-notice'))
      .toBeLessThan(markup.indexOf('memory-summary-strip'))
    expect(markup).not.toContain('未确认')
    expect(markup).not.toContain('provisional')
    expect(markup).not.toContain('user_confirmed')

    const suppressedMarkup = renderToStaticMarkup(createElement(MemoryLibrary, {
      agents: [],
      startupFeedbackVisible: false
    }))
    expect(suppressedMarkup).toContain('startup-feedback-suppressed')
    expect(suppressedMarkup).toContain('aria-hidden="true"')
  })

  it('detects duplicate member names independently from hidden handles', () => {
    const existing = agentProfile()
    expect(hasDuplicateMemberDisplayName('  沐瓦  ', null, [existing])).toBe(true)
    expect(hasDuplicateMemberDisplayName('沐瓦', existing.agentId, [existing])).toBe(false)
    expect(hasDuplicateMemberDisplayName('洛可', null, [existing])).toBe(false)
  })

  it('offers the selectable Product Runtime catalog without exposing hidden products or paths', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: agentProfile(),
      installations: [codexInstallation()],
      runtimeAvailability: [productAvailability('codex-cli', 'ready')],
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onReload: async () => undefined,
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
    expect(markup).toContain('>TRAE CLI</option>')
    expect(markup).toContain('>Antigravity</option>')
    expect(markup).not.toContain('>Cursor Agent</option>')
    expect(markup).not.toContain('>DeepSeek Harness</option>')
    expect(markup).toContain('未配置 Agent 运行时')
    expect(markup).not.toContain('已找到')
    expect(markup).not.toContain('尚未检查')
    expect(markup).not.toContain('Claude Code CLI')
    expect(markup).not.toContain('Antigravity App')
    expect(markup).not.toContain('/opt/homebrew/bin/codex')
    expect(markup).toContain('<h3>运行时</h3>')
    expect(markup).toContain('Agent 运行时')
    expect(markup).toContain('保存运行配置')
    expect(markup).toContain('放弃更改')
    expect(markup).not.toContain('清除 Agent 运行时')
    expect(markup).toContain('选择执行产品，并确认当前安装与可用状态')
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
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('GitHub Copilot')
    expect(markup).toContain('运行时、模型与权限会作为一份配置共同保存')
    expect(markup).toContain('未安装')
    expect(markup).toContain('前往 Agent 运行时')
    expect(markup).toContain('<button class="primary-button" disabled="">保存运行配置</button>')
    expect(markup).toContain('放弃更改')
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
      onReload: async () => undefined,
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
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('正在检查…')
    expect(markup).toContain('Codex CLI')
    expect(markup).toContain('Antigravity')
    expect(markup).toContain('TRAE CLI')
    expect(markup).not.toContain('Cursor Agent')
    expect(markup).toContain('Kimi Code')
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
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('<strong>Kiro</strong>')
    expect(markup).toContain('status-available')
    expect(markup).toContain('可用')
    expect(markup).toContain('kiro-cli 1.0.0')
    expect(markup).not.toContain('runtime-blockers')
    expect(markup).not.toContain('需要探测 Agent 运行时')
    expect(markup).not.toContain('runtime-status-refresh')
    expect(markup).not.toContain('重新检查')
  })

  it('preserves a historical Windows Runtime configuration as read-only', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: {
        ...agentProfile(),
        runtimeConfiguration: configuredRuntime('kiro-cli'),
        runtimeReadiness: { status: 'ready', blockers: [] }
      },
      installations: [],
      runtimeAvailability: [],
      hostPlatform: 'windows-x64',
      runtimePlatformAdmission: runtimeAdmissionRows('windows-x64', 'not_qualified'),
      busy: null,
      onSave: async () => undefined,
      onClear: async () => undefined,
      onReload: async () => undefined,
      onOpenRuntimeSettings: () => undefined
    }))

    expect(markup).toContain('Windows 尚未验证')
    expect(markup).toContain('这不是本机安装、登录或扫描故障')
    expect(markup).toContain('当前平台仅可查看这份配置')
    expect(markup).toContain('<select id="member-runtime-select" disabled="">')
    expect(markup).not.toContain('前往 Agent 运行时')
  })

  it('keeps all product checks visible with redacted discovery diagnostics', () => {
    const health: HealthStatus = {
      core: { ok: true, version: '0.0.1', dataDir: '/tmp/rovai' },
      database: { ok: true, path: '/tmp/rovai/rovai.db' },
      git: { installed: true, version: 'git version 2.0' },
      hostPlatform: 'macos-arm64',
      runtimeCatalog: [],
      runtimePlatformAdmission: runtimeAdmissionRows('macos-arm64', 'qualified'),
      runtimeAvailability: [
        productAvailability('codex-cli', 'ready'),
        productAvailability('opencode-cli', 'found_uninspected'),
        productAvailability('copilot-cli', 'checking'),
        productAvailability('claude-code-cli', 'authentication_required', {
          runtimeKind: 'claude-code-cli',
          origin: 'runtime',
          phase: 'authentication',
          code: 'runtime_authentication_required',
          summary: 'Claude Code 尚未登录',
          detail: '请先在终端完成 Claude Code 登录。',
          retryable: true
        }),
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
    expect(markup).toContain('TRAE CLI')
    expect(markup).toContain('DeepSeek Harness')
    expect(markup).toContain('待支持')
    expect(markup).toContain('尚未开放')
    expect(markup).toContain('可用')
    expect(markup).toContain('正在检查…')
    expect(markup).toContain('需要登录')
    expect(markup).toContain('Claude Code 返回错误')
    expect(markup).toContain('Claude Code 尚未登录')
    expect(markup).toContain('请先在终端完成 Claude Code 登录。')
    expect(markup).not.toContain('Rovai 内部错误')
    expect(markup).toContain('未安装')
    expect(markup).not.toContain('已找到')
    expect(markup).not.toContain('尚未检查')
    expect(markup).not.toContain('已检查')
    expect(markup).toContain('实验性')
    expect(markup.match(/class="runtime-product-logo"/g)).toHaveLength(13)
    expect(markup.match(/class="quiet-button runtime-product-check"/g)).toHaveLength(13)
    expect(markup.match(/检查可用性/g)).toHaveLength(12)
    expect(markup).not.toContain('重新扫描安装')
    expect(markup).toContain('codex-cli 1.0.0')
    expect(markup).toContain('来源 inherited_path · 入口 native_executable · 后缀 native')
    expect(markup).toContain('Native 目标 未解析 · Version Probe 成功')
    expect(markup).not.toContain('九种已支持产品')
    expect(markup).not.toContain('自查命令')
    expect(markup).not.toContain('command -v')
    expect(markup).not.toContain('安装说明')
    expect(markup).not.toContain('高级诊断与自定义启动入口')
    expect(markup).not.toContain('/opt/homebrew/bin/codex')
  })

  it('renders Windows not-qualified rows without machine checks or rescan actions', () => {
    const health: HealthStatus = {
      core: { ok: true, version: '0.0.1', dataDir: 'C:\\Users\\test\\AppData\\Local\\Rovai AI' },
      database: { ok: true, path: 'C:\\Users\\test\\AppData\\Local\\Rovai AI\\Core\\rovai.db' },
      git: { installed: true, version: 'git version 2.0' },
      hostPlatform: 'windows-x64',
      runtimeCatalog: [],
      runtimePlatformAdmission: runtimeAdmissionRows('windows-x64', 'not_qualified'),
      runtimeAvailability: [],
      searchEnvironment: {
        generation: 1,
        createdAt: '2026-08-18T00:00:00Z',
        pathEntryCount: 0,
        shell: {
          status: 'unavailable',
          interactive: false,
          shellName: null,
          entryCount: 0,
          elapsedMillis: 0
        }
      }
    }
    const markup = renderToStaticMarkup(createElement(RuntimeInstallationsPanel, {
      health,
      installations: [],
      onReload: async () => undefined
    }))

    expect(markup.match(/Windows 尚未验证/g)).toHaveLength(12)
    expect(markup.match(/不可检查/g)).toHaveLength(12)
    expect(markup).not.toContain('检查可用性')
    expect(markup).toContain('当前平台尚无可检测 Runtime')
    expect(markup).toContain('这不是本机安装、登录或扫描故障')
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
    modelCatalog: {
      status: 'fresh', observedAt: '2026-07-22T00:00:00Z',
      revalidateAfter: '2026-07-22T00:01:00Z', expiresAt: '2026-07-23T00:00:00Z'
    },
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
  status: HealthStatus['runtimeAvailability'][number]['status'],
  failure: HealthStatus['runtimeAvailability'][number]['failure'] = null
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
      searchPathSource: status === 'missing' || status === 'detecting' ? null : 'inherited_path',
      entrypointKind: status === 'missing' || status === 'detecting' ? null : 'native_executable',
      candidateExtension: status === 'missing' || status === 'detecting' ? null : 'native',
      resolvedNativeTarget: false,
      versionProbeSucceeded: status === 'missing' || status === 'detecting' ? null : true,
      searchGeneration: 1,
      observedAt: '2026-07-22T00:00:00Z',
      diagnosticCode: null
    },
    installationId: status === 'ready' ? `installation-${runtimeKind}` : null,
    reportedVersion: status === 'missing' || status === 'detecting' ? null : `${runtimeKind} 1.0.0`,
    diagnosticCode: null,
    failure
  }
}

function runtimeAdmissionRows(
  platform: HealthStatus['hostPlatform'],
  status: HealthStatus['runtimePlatformAdmission'][number]['status']
): HealthStatus['runtimePlatformAdmission'] {
  const runtimeKinds: HealthStatus['runtimePlatformAdmission'][number]['runtimeKind'][] = [
    'codex-cli',
    'opencode-cli',
    'copilot-cli',
    'claude-code-cli',
    'kiro-cli',
    'qoder-cli',
    'codebuddy-cli',
    'qwen-code',
    'trae-cn-cli',
    'cursor-agent',
    'kimi-code-cli',
    'grok-build',
    'antigravity-app'
  ]
  return runtimeKinds.map((runtimeKind) => {
    const requiresQualification = runtimeKind === 'cursor-agent'
      || (runtimeKind === 'grok-build' && platform !== 'macos-arm64')
    const effectiveStatus = requiresQualification && status === 'qualified'
      ? 'not_qualified'
      : status
    return {
      runtimeKind,
      platform,
      status: effectiveStatus,
      reasonCode: effectiveStatus === 'qualified'
        ? null
        : 'runtime_platform.qualification_evidence_missing',
      evidenceRevision: effectiveStatus === 'qualified' ? 'sha256:test-macos-evidence' : null
    }
  })
}
