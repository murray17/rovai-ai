import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  ActionApprovalView,
  AdapterInstallation,
  AgentProfile,
  Approval,
  CampSnapshot,
  HealthStatus,
  TimelineEvent
} from '@contracts'
import {
  AppHeader,
  WindowDragStrip,
  allNavigationCamps,
  campInspectorVisibleFromStoredValue,
  cancellableTurnIds,
  campCreationPreflightFromAgents,
  campMessageSendParams,
  commandFailureMessage,
  effectiveCancellingTurnIds,
  optimisticCampMessage,
  reconcileCancellingTurnIds,
  SettingsView,
  shouldLoadRuntimeHealth
} from './App'
import {
  CampNavigation,
  campNavigationMenuLabels,
  projectNavigationMenuLabels
} from './CampNavigation'
import {
  AgentMentionTextarea,
  formatMentionDisplayText,
  mentionQueryAtCaret,
  resolveMentionedAgentIds,
  shouldResetMentionActiveOption,
  shouldSubmitTextareaOnEnter
} from './AgentMentionTextarea'
import {
  CampWorkspace,
  QuickChatWorkspace,
  TaskPanel,
  campConversationTimeline,
  emptyCampRuntimeSummary,
  formatStopElapsed,
  loadCompleteAgentRunExecutionEvidence,
  readyCampMentionCandidates,
  runtimeOptionsForDisplay
} from './CampWorkspace'
import {
  initialCampSelection,
  normalizeDraftName,
  toggleCampMemberSelection,
  workspaceCapability
} from './NewConversationDialog'
import {
  MemberRuntimeForm,
  MemberAdvancedSettings,
  MembersView,
  RuntimeInstallationsPanel,
  hasDuplicateMemberDisplayName,
  memberMemorySwitchReducer,
  memberIdentityTargetAgent
} from './MemberManagement'

import { MemoryLibrary } from './MemoryLibrary'
import { SafeMarkdown } from './SafeMarkdown'
import {
  agentRunPresentation,
  agentRunStateTag,
  agentRunWaitDetail,
  buildActivities,
  buildConversation,
  buildGitStatusEntries,
  buildLiveExecutionProgress,
  diffLineKind,
  formatByteSize,
  inboxMessagePresentation,
  liveRuntimeEventFromCore,
  parseGitStatus,
  stripAnsi,
  summarizeApproval,
  taskStateSummary
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

function event(id: number, eventType: string, payload: unknown, nativeMethod: string | null = null): TimelineEvent {
  return {
    id,
    taskId: 'task-1',
    sequence: id,
    eventType,
    nativeMethod,
    payload,
    createdAt: `2026-07-17T10:00:0${id}Z`
  }
}

describe('task event projections', () => {
  it('projects one live Task card at creation and suppresses legacy status cards', () => {
    const task = {
      id: 'task-live-card',
      title: '更新后的任务标题',
      description: '只在任务详情显示',
      status: 'completed',
      assigneeAgentId: 'agent-muwa',
      createdByType: 'user',
      createdById: 'local-user',
      sourceAgentRunId: null,
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
      authorId: presentation ? 'task-state' : 'local-user',
      sourceAgentRunId: null,
      body: presentation ? 'legacy task status' : id,
      content: null,
      attachments: [],
      addressMode: presentation ? 'broadcast' : 'default',
      addressedAgentProfileIds: [],
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
      taskId: task.id,
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
      entityId: task.id,
      actorType: 'user',
      actorId: 'local-user',
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
      [],
      [createdEvent],
      [],
      [task]
    )

    expect(projected.map((item) => item.id)).toEqual([
      'before-task',
      `task:${task.id}`,
      'after-task'
    ])
    expect(projected[1]).toMatchObject({
      kind: 'task_card',
      timelineGlobalSequence: 2,
      task: {
        id: task.id,
        title: '更新后的任务标题',
        status: 'completed',
        assigneeAgentId: 'agent-muwa',
        version: 4
      }
    })

    const updated = campConversationTimeline([], [], [], [createdEvent], [], [{
      ...task,
      title: '再次更新标题',
      status: 'cancelled',
      assigneeAgentId: null,
      version: 5
    }])
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({
      id: `task:${task.id}`,
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
      id: 'task-old',
      title: '较早的任务',
      description: '',
      status: 'pending',
      assigneeAgentId: null,
      createdByType: 'user',
      createdById: 'local-user',
      sourceAgentRunId: null,
      version: 1,
      createdAt: '2026-07-01T00:00:00Z',
      updatedAt: '2026-07-01T00:00:00Z',
      closedAt: null,
      availableActions: ['update']
    } satisfies CampSnapshot['tasks'][number]

    expect(campConversationTimeline([], [], [], [], [], [task])).toMatchObject([{
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
  })

  it('loads Runtime health only for member, Runtime, and diagnostics views', () => {
    expect(shouldLoadRuntimeHealth('compose', 'skills', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('camp', 'skills', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('settings', 'skills', false, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('members', 'skills', false, false)).toBe(true)
    expect(shouldLoadRuntimeHealth('settings', 'runtime', false, false)).toBe(true)
    expect(shouldLoadRuntimeHealth('settings', 'diagnostics', false, false)).toBe(true)
    expect(shouldLoadRuntimeHealth('members', 'skills', true, false)).toBe(false)
    expect(shouldLoadRuntimeHealth('members', 'skills', false, true)).toBe(false)
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
          { kind: 'member_mention', agentProfileId: 'agent-muwa' },
          { kind: 'member_mention', agentProfileId: 'agent-muwa' }
        ],
        revision: 3,
        attachments: [{
          id: 'attachment-1',
          displayName: '说明.txt',
          mediaType: 'text/plain',
          byteSize: 12,
          previewKind: 'none',
          state: 'ready',
          errorMessage: null,
          createdAt: '2026-07-30T09:59:00Z'
        }],
        updatedAt: '2026-07-30T09:59:00Z',
        expiresAt: '2026-08-06T09:59:00Z'
      },
      '2026-07-30T10:00:00Z'
    )

    expect(optimistic).toMatchObject({
      id: 'optimistic:command-optimistic',
      sequence: 1,
      authorType: 'user',
      authorId: 'local-user',
      body: '立即显示这条消息',
      addressMode: 'explicit',
      addressedAgentProfileIds: ['agent-muwa'],
      attachments: [{
        id: 'attachment-1',
        displayName: '说明.txt'
      }],
      timelineGlobalSequence: null
    })
    expect(campConversationTimeline([optimistic], []).map((item) => item.id)).toEqual([
      'optimistic:command-optimistic'
    ])
  })

  it('submits only the exact Core Draft revision as message content authority', () => {
    const params = campMessageSendParams('command-1', 'camp-1', {
      campId: 'camp-1',
      body: '请 @沐瓦 检查',
      content: [{ kind: 'member_mention', agentProfileId: 'agent-muwa' }],
      revision: 7,
      attachments: [],
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
    expect(params).not.toHaveProperty('agentProfileIds')
    expect(params).not.toHaveProperty('preparedAttachmentIds')
  })

  it('keeps local cancelling state until the authoritative turn becomes terminal', () => {
    const running = {
      turns: [{
        id: 'turn-running',
        triggerType: 'camp_message' as const,
        triggerId: 'message-1',
        status: 'running' as const,
        cancelRequestedAt: null,
        executionBudget: TEST_EXECUTION_BUDGET,
        version: 1,
        createdAt: '2026-07-30T10:00:00Z',
        updatedAt: '2026-07-30T10:00:00Z',
        endedAt: null
      }]
    }
    expect(cancellableTurnIds(running)).toEqual(['turn-running'])

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
    const userMessage = {
      id: 'message-stop',
      sequence: 1,
      timelineGlobalSequence: 10,
      authorType: 'user' as const,
      authorId: 'local-user',
      sourceAgentRunId: null,
      body: '停止这个执行',
      content: null,
      attachments: [],
      addressMode: 'default' as const,
      addressedAgentProfileIds: ['agent-1'],
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
      actorId: 'local-user',
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
      [],
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
      [],
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

  it('renders the visible Camp header and structural page drag strips', () => {
    const camp = {
      camp: { createdAt: '2026-07-31T00:00:00Z' },
      agentRuns: [{ status: 'running' }],
      approvals: [{ status: 'pending' }]
    } as unknown as CampSnapshot
    const campMarkup = renderToStaticMarkup(createElement(AppHeader, {
      campTitle: '会话界面',
      contextLabel: 'Quick Chat',
      camp,
      stopping: false,
      inspectorVisible: false,
      onToggleInspector: () => undefined,
      onOpenInspector: () => undefined
    }))
    expect(campMarkup).toContain('Quick Chat')
    expect(campMarkup).toContain('运行中 1')
    expect(campMarkup).toContain('待审批 1')
    expect(campMarkup).toContain('aria-label="显示右侧检查器"')
    expect(campMarkup).toContain('aria-pressed="false"')

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
    expect(membersStrip).not.toContain('队员')
    expect(memoryStrip).not.toContain('记忆')
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
    expect(markup).toContain('Arctic Dawn · Quick Chat')
    expect(markup).toContain('在晨光里，开始下一段协作')
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
          agentProfileId: 'agent-unready', handle: 'unready', displayName: '未就绪',
          memberOrder: 0, runtimeConfigured: true, runtimeReadiness: 'needs_attention'
        },
        {
          agentProfileId: 'agent-ready', handle: 'ready', displayName: '已就绪',
          memberOrder: 1, runtimeConfigured: true, runtimeReadiness: 'ready'
        }
      ],
      initialLeadAgentProfileId: 'agent-ready',
      blockers: []
    })

    expect(selection).toEqual({
      memberIds: ['agent-unready', 'agent-ready'],
      leadId: 'agent-ready'
    })
  })

  it('sends with Enter while preserving mention selection, composition, and Shift+Enter newline', () => {
    expect(shouldSubmitTextareaOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      mentionMenuOpen: false
    })).toBe(true)
    expect(shouldSubmitTextareaOnEnter({
      key: 'Enter',
      shiftKey: true,
      isComposing: false,
      mentionMenuOpen: false
    })).toBe(false)
    expect(shouldSubmitTextareaOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      mentionMenuOpen: false
    })).toBe(false)
    expect(shouldSubmitTextareaOnEnter({
      key: 'Enter',
      shiftKey: false,
      isComposing: false,
      mentionMenuOpen: true
    })).toBe(false)
  })

  it('normalizes optional Camp names before applying the local scalar boundary', () => {
    expect(normalizeDraftName('  重构\n\tMCP  设置页  ')).toBe('重构 MCP 设置页')
    expect(Array.from(normalizeDraftName('😀'.repeat(80))).length).toBe(80)
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

  it('hides only the implicit recipient summary while preserving explicit target feedback', () => {
    const markup = renderToStaticMarkup(createElement(AgentMentionTextarea, {
      id: 'new-message-with-mention',
      value: '@luoke 请看看',
      candidates: [{
        agentProfileId: 'agent-luoke',
        handle: 'luoke',
        displayName: '洛可',
        avatarRef: null
      }],
      inputLabel: '写下新对话消息',
      showDefaultTargetSummary: false,
      placeholder: '说点什么…',
      rows: 3,
      disabled: false,
      onChange: () => undefined
    }))

    expect(markup).toContain('将同时唤醒 1 位队员')
    expect(markup).not.toContain('未提及时发送给 Lead')
  })

  it('derives the initial Quick Chat preflight from the already loaded member order', () => {
    const unconfigured = agentProfile()
    const configured: AgentProfile = {
      ...agentProfile(),
      id: 'agent-luoke',
      handle: 'luoke',
      displayName: '洛可',
      memberOrder: 1,
      runtimeSelection: {
        adapterKind: 'codex-cli'
      },
      runtimePreference: {
        installationId: 'installation-codex',
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
          agentProfileId: unconfigured.id,
          handle: unconfigured.handle,
          displayName: unconfigured.displayName,
          memberOrder: 0,
          runtimeConfigured: false,
          runtimeReadiness: 'runtime_not_configured'
        },
        {
          agentProfileId: configured.id,
          handle: configured.handle,
          displayName: configured.displayName,
          memberOrder: 1,
          runtimeConfigured: true,
          runtimeReadiness: 'needs_attention'
        }
      ],
      initialLeadAgentProfileId: unconfigured.id,
      blockers: []
    })
  })

  it('resolves member-name mentions and keeps legacy handles compatible without routing email text', () => {
    const candidates = [
      { agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', avatarRef: null },
      { agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', avatarRef: null }
    ]

    expect(resolveMentionedAgentIds('@沐瓦 请实现，@洛可 请复核；再次 @沐瓦', candidates)).toEqual([
      'agent-muwa',
      'agent-luoke'
    ])
    expect(resolveMentionedAgentIds('@muwa 请处理旧消息', candidates)).toEqual(['agent-muwa'])
    expect(resolveMentionedAgentIds('发送到 dev@muwa.example.com', candidates)).toEqual([])
    expect(mentionQueryAtCaret('请 @沐', 4)).toEqual({ start: 2, end: 4, query: '沐' })
    expect(shouldResetMentionActiveOption(
      { start: 2, end: 4, query: '沐' },
      { start: 2, end: 4, query: '沐' }
    )).toBe(false)
    expect(shouldResetMentionActiveOption(
      { start: 2, end: 4, query: '沐' },
      { start: 2, end: 5, query: '沐瓦' }
    )).toBe(true)
  })

  it('renders legacy mention handles as names without exposing a parenthesized handle', () => {
    const candidates = [
      { agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', avatarRef: null },
      { agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', avatarRef: null },
      { agentProfileId: 'agent-mianzhi', handle: 'mianzhi', displayName: '眠枝', avatarRef: null }
    ]
    expect(formatMentionDisplayText('@luoke @muwa @mianzhi 报个到', candidates))
      .toBe('@洛可 @沐瓦 @眠枝 报个到')
    expect(formatMentionDisplayText('邮箱 dev@muwa.example.com 和未知队员 @other 不变', candidates))
      .toBe('邮箱 dev@muwa.example.com 和未知队员 @other 不变')

    const duplicateNames = [
      ...candidates,
      { agentProfileId: 'agent-luoke-2', handle: 'luoke2', displayName: '洛可', avatarRef: null }
    ]
    expect(formatMentionDisplayText('@luoke @luoke2 请分别确认', duplicateNames))
      .toBe('@洛可 @洛可 请分别确认')
  })

  it('offers every present Camp member independently from Runtime readiness', () => {
    const ready = {
      ...agentProfile(),
      runtimeReadiness: { status: 'ready' as const, blockers: [] }
    }
    const unready = {
      ...agentProfile(),
      id: 'agent-luoke',
      handle: 'luoke',
      displayName: '洛可'
    }
    const members: CampSnapshot['members'] = [
      {
        agentProfileId: ready.id, handle: ready.handle, displayName: ready.displayName,
        avatarRef: null, teamRole: '开发者', accent: '#39777a', membershipStatus: 'active', profilePresence: 'present',
        memberOrder: 0, isDefaultLead: false, memoryWriteEnabled: true, version: 1
      },
      {
        agentProfileId: unready.id, handle: unready.handle, displayName: unready.displayName,
        avatarRef: null, teamRole: 'Lead', accent: '#D56A4A', membershipStatus: 'active', profilePresence: 'present',
        memberOrder: 1, isDefaultLead: true, memoryWriteEnabled: true, version: 1
      }
    ]

    expect(readyCampMentionCandidates(members, [ready, unready])).toEqual([
      { agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', avatarRef: null },
      { agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', avatarRef: null }
    ])
  })

  it('orders Camp navigation by the authoritative activity sequence', () => {
    const baseCamp = {
      title: '对话', projectBindingKind: 'directory' as const, projectPath: '/repo',
      defaultLead: null, marker: 'none' as const, lastActivityAt: '2026-07-22T00:00:00Z',
      latestCompletionGlobalSequence: 0, version: 1
    }
    const camps = allNavigationCamps({
      schemaVersion: 2,
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
    expect(campNavigationMenuLabels(false)).toEqual(['置顶', '重命名', '删除'])
    expect(campNavigationMenuLabels(true)).toEqual(['取消置顶', '重命名', '删除'])
    expect(projectNavigationMenuLabels(false)).toEqual(['置顶项目'])
    expect(projectNavigationMenuLabels(true)).toEqual(['取消置顶项目'])
  })

  it('renders Camp-first navigation with unified menus and Quick Chat as the last visual project', () => {
    const longTitle = '围绕多 Agent 协作控制面梳理一个足够长、必须由真实侧栏宽度裁切的对话标题'
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'camp',
      state: 'ready',
      navigation: {
        schemaVersion: 2,
        throughGlobalSequence: 12,
        quickChat: {
          totalCount: 12,
          recentCamps: [{
            id: 'camp-quick-chat', title: '快速对话讨论', projectPath: '/quick-chat',
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
            id: 'camp-project', title: longTitle, projectPath: '/repo',
            projectBindingKind: 'directory', defaultLead: null, marker: 'unread_completed',
            lastActivityAt: '2026-07-22T00:00:01Z', lastActivityGlobalSequence: 12,
            latestCompletionGlobalSequence: 12, version: 2
          }]
        }]
      },
      agents: [],
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
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('新对话')
    expect(markup).toContain('aria-label="Rovai AI"')
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
    expect(markup).toContain('data-sidebar-menu-target="project:directory:/repo"')
    expect(markup).toContain('data-sidebar-menu-target="camp:camp-quick-chat"')
    expect(markup).not.toContain('data-sidebar-menu-target="project:quick-chat"')
    expect(markup).not.toContain('row-pin-button')
    expect(markup).not.toContain('group-pin-button')
    expect(markup).not.toContain('camp-group-count')
    expect(markup).toContain('查看全部')
    expect(markup).not.toContain('查看全部 12 个')
    expect(markup).toContain('设置')
    expect(markup).toContain('viewBox="0 0 24 24"')
    expect(markup.indexOf('id="projects-heading"')).toBeLessThan(markup.indexOf('data-group="quick-chat"'))
    expect(markup).not.toContain('北极晨光 · Workspace')
    expect(markup).not.toContain('Core 尚未检测')
    expect(markup).not.toContain('⌄')
    expect(markup).not.toContain('data-group="directory:/repo"')
    expect(markup).not.toContain('最近任务')
    expect(markup).not.toContain('Lumen AI')
    expect(markup).not.toContain('Horizonward')
  })

  it('replaces ordinary navigation with the remembered settings category list', () => {
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'settings',
      state: 'ready',
      navigation: null,
      agents: [],
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
      onRename: async () => undefined,
      onDelete: async () => ({ deleted: true, blockers: [] }),
      onStop: async () => undefined,
      onError: () => undefined
    }))

    expect(markup).toContain('aria-label="设置分类"')
    expect(markup).toContain('aria-label="Rovai AI"')
    expect(markup).toContain('返回 App')
    expect(markup).toContain('应用级偏好与本机能力')
    expect(markup).toContain('<strong>Skill</strong>')
    expect(markup).toContain('<strong>MCP</strong>')
    expect(markup).toContain('<strong>Agent 运行时</strong>')
    expect(markup).toContain('<strong>外观</strong>')
    expect(markup).toContain('class="active" type="button" aria-current="page"')
    expect(markup).not.toContain('新对话')
    expect(markup).not.toContain('快速对话')
    expect(markup).not.toContain('Core')
  })

  it('replaces project navigation with the member roster on the members page', () => {
    const markup = renderToStaticMarkup(createElement(CampNavigation, {
      view: 'members',
      state: 'ready',
      navigation: {
        schemaVersion: 2,
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
      agents: [],
      activeCampId: null,
      memberSidebar: createElement('section', { 'aria-label': '队员名册' }, '唯一队员名册'),
      onNewConversation: () => undefined,
      onMembers: () => undefined,
      onMemory: () => undefined,
      pendingMemoryCount: 0,
      onSettings: () => undefined,
      onOpenProject: () => undefined,
      onCamp: () => undefined,
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
      id: 'agent-luoke',
      displayName: '洛可',
      runtimePreference: null,
      runtimeReadiness: { status: 'runtime_not_configured', blockers: [] }
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 18,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-1', title: 'Lead 调整', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent-luoke', status: 'active',
        version: 2, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z'
      },
      members: [{
        agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', profilePresence: 'present', memberOrder: 0,
        isDefaultLead: true, memoryWriteEnabled: true, version: 1
      }],
      tasks: [], messages: [], turns: [], agentRuns: [], inboxMessages: [],
      conversationInputs: [],
      contextManifests: [], contextCompactions: [], executionEvidence: [],
      approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [unreadyProfile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('给 洛可 发消息')
    expect(markup).toContain('未提及时发送给 Lead')
    expect(markup).toContain('开始这段协作')
    expect(markup).toContain('快速对话')
    expect(markup).toContain('Lead · 洛可')
    expect(markup).toContain('1 位队员已在队')
    expect(markup).toContain('Agent 运行时不可用')
    expect(markup).toContain('先了解项目')
    expect(markup).toContain('整理成任务')
    expect(markup).toContain('检查工作区')
    expect(markup).not.toContain('Runtime')
  })

  it('summarizes empty Camp runtime readiness without inventing Ready state', () => {
    const member = {
      agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', teamRole: 'Lead',
      avatarRef: null, accent: '#D56A4A', membershipStatus: 'active' as const,
      profilePresence: 'present' as const, memberOrder: 0, isDefaultLead: true,
      memoryWriteEnabled: true, version: 1
    }
    const ready = {
      ...agentProfile(),
      id: member.agentProfileId,
      runtimeReadiness: { status: 'ready' as const, blockers: [] }
    }
    const unready = {
      ...ready,
      id: 'agent-muwa',
      runtimeReadiness: { status: 'needs_attention' as const, blockers: [] }
    }
    const secondMember = {
      ...member,
      agentProfileId: unready.id,
      displayName: '沐瓦',
      isDefaultLead: false,
      memberOrder: 1
    }

    expect(emptyCampRuntimeSummary([member], [])).toBe('正在检查 Agent 运行时…')
    expect(emptyCampRuntimeSummary([member], [ready])).toBe('Agent 运行时可用')
    expect(emptyCampRuntimeSummary([member, secondMember], [ready, unready])).toBe('1/2 个 Agent 运行时可用')
    expect(emptyCampRuntimeSummary([{ ...member, profilePresence: 'away' }], [ready])).toBe('暂无在队的队员')
  })

  it('keeps the Camp composer interactive when reconciliation leaves no Default Lead', () => {
    const profile: AgentProfile = {
      ...agentProfile(),
      id: 'agent-luoke',
      handle: 'luoke',
      displayName: '洛可',
      presence: 'away'
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 18,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-empty', title: '暂无可用队员', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: null, status: 'active',
        version: 2, createdAt: '2026-07-27T00:00:00Z', updatedAt: '2026-07-27T00:00:00Z'
      },
      members: [{
        agentProfileId: profile.id, handle: profile.handle, displayName: profile.displayName, teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', profilePresence: 'away', memberOrder: 0,
        isDefaultLead: false, memoryWriteEnabled: true, version: 1
      }],
      tasks: [], messages: [], turns: [], agentRuns: [], inboxMessages: [],
      conversationInputs: [],
      contextManifests: [], contextCompactions: [], executionEvidence: [],
      approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [profile],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('给 Default Lead 发消息')
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

  it('renders a copy action for user messages and live Agent execution evidence', () => {
    const profile = {
      ...agentProfile(),
      id: 'agent-muwa',
      displayName: '沐瓦',
      runtimeReadiness: { status: 'ready' as const, blockers: [] }
    }
    const snapshot: CampSnapshot = {
      schemaVersion: 18,
      throughGlobalSequence: 3,
      camp: {
        id: 'camp-live', title: '实现功能', projectBindingKind: 'directory', projectPath: '/repo',
        defaultLeadAgentId: 'agent-muwa', status: 'active',
        version: 1, createdAt: '2026-07-28T05:00:00Z', updatedAt: '2026-07-28T05:01:00Z'
      },
      members: [{
        agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', teamRole: '开发者',
        avatarRef: null, accent: '#39777a', membershipStatus: 'active', profilePresence: 'present',
        memberOrder: 0, isDefaultLead: true, memoryWriteEnabled: true, version: 1
      }],
      tasks: [],
      messages: [{
        id: 'message-user', sequence: 1, timelineGlobalSequence: 1,
        authorType: 'user', authorId: 'local-user',
        sourceAgentRunId: null, body: '请 @沐瓦 实现复制。',
        content: [
          { kind: 'text', text: '请 ' },
          { kind: 'member_mention', agentProfileId: 'agent-muwa' },
          { kind: 'text', text: ' 实现复制。' }
        ],
        addressMode: 'explicit',
        attachments: [],
        addressedAgentProfileIds: ['agent-muwa'], replyToCampMessageId: null,
        campTurnId: 'turn-1', presentation: null, createdAt: '2026-07-28T05:00:00Z'
      }],
      turns: [{
        id: 'turn-1', triggerType: 'camp_message', triggerId: 'message-user', status: 'running',
        cancelRequestedAt: null, executionBudget: TEST_EXECUTION_BUDGET,
        version: 1, createdAt: '2026-07-28T05:00:00Z',
        updatedAt: '2026-07-28T05:01:00Z', endedAt: null
      }],
      agentRuns: [{
        id: 'run-muwa', campTurnId: 'turn-1', conversationId: 'conversation-muwa',
        agentProfileId: 'agent-muwa', taskId: null, responsibilityKey: 'direct:agent-muwa',
        responsibilityGeneration: 0, purpose: '实现复制', expectedOutput: '完成并验证',
        completionRole: 'required', status: 'running', waitReason: null, executionEpoch: 1,
        permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct',
        a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0,
        sourceInboxMessageId: null, executionEvidenceCount: 3,
        hasUnsettledExternalEffects: false,
        workspace: { path: '/repo' }, startingGitObservation: null, endingGitObservation: null,
        version: 2,
        createdAt: '2026-07-28T05:00:00Z', startedAt: '2026-07-28T05:00:01Z',
        endedAt: null, updatedAt: '2026-07-28T05:01:00Z'
      }],
      inboxMessages: [], conversationInputs: [],
      contextManifests: [], contextCompactions: [],
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
        contentBlobId: null, contentByteCount: 120, isTruncated: false,
        occurredAt: '2026-07-28T05:00:04Z'
      }],
      approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
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
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      onOpenMember: () => undefined
    }))

    expect(markup).toContain('aria-label="复制这条消息"')
    expect(markup).toContain('class="message-surface"')
    expect(markup).toContain('class="message-mention-token is-interactive"')
    expect(markup).toContain('data-agent-profile-id="agent-muwa"')
    expect(markup).toContain('role="link"')
    expect(markup).toContain('tabindex="0"')
    expect(markup.indexOf('class="message-bubble"'))
      .toBeLessThan(markup.indexOf('class="message-copy-button"'))
    expect(markup).toContain('沐瓦的执行过程')
    expect(markup).not.toContain('Thinking')
    expect(markup).not.toContain('先检查消息组件。')
    expect(markup).not.toContain('完整证据')
    expect(markup).not.toContain('正在整理思路')
    expect(markup).toContain('正在处理')
    expect(markup).not.toContain('Progress')
    expect(markup).toContain('正在补充复制入口。')
    expect(markup).not.toContain('Steps')
    expect(markup).toContain('pnpm test')
    expect(markup).toContain('conversation-bubble agent agent-run-message')
    expect(markup).toContain('<div class="message-body"><div class="bubble-meta">')
    expect(markup).toContain('<div class="execution-disclosure run-live is-running">')
    expect(markup).not.toContain('stream-reasoning')
    expect(markup).toContain('<div class="process-copy stream-narration"><div class="safe-markdown">')
    expect(markup).toContain('<details class="process-action tool-call-disclosure status-running"><summary>')
    expect(markup).not.toContain('working-row')
    expect(markup).not.toContain('live-execution-progress')
    expect(markup).toContain('aria-label="停止当前执行"')
    expect(markup).not.toContain('class="primary-button composer-send"')

    const cancellingMarkup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: 'Rovai',
      agents: [profile],
      liveRuntimeEvents: [],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onSetMemoryWrite: async () => undefined,
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
          authorType: 'agent' as const, authorId: 'agent-muwa',
          sourceAgentRunId: 'run-muwa', body: '复制入口已完成。', content: null, addressMode: 'broadcast' as const,
          attachments: [],
          addressedAgentProfileIds: [], replyToCampMessageId: 'message-user',
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
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))
    expect(terminalMarkup).toContain('<details class="execution-disclosure worked is-terminal"><summary>')
    expect(terminalMarkup).not.toContain(' open=""')
    expect(terminalMarkup).not.toContain('terminal-run-row')
    expect(terminalMarkup).toContain('复制入口已完成。')
    expect(terminalMarkup.indexOf('execution-disclosure worked is-terminal'))
      .toBeLessThan(terminalMarkup.indexOf('复制入口已完成。'))

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
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))
    expect(restoredMarkup).toContain('处理过程 · 1分59秒')

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
          actorId: 'local-user',
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
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined,
      inspectorVisible: false
    }))
    expect(cancelledMarkup).toContain('workspace-grid inspector-collapsed')
    expect(cancelledMarkup).not.toContain('aria-label="Camp 检查器"')
    expect(cancelledMarkup).toContain('你已在 5 秒后停止')
    expect(cancelledMarkup).toContain('结果待确认 · 查看活动')
    expect(cancelledMarkup).not.toContain('run-message-state tone-neutral')
    expect(cancelledMarkup.indexOf('pnpm test')).toBeLessThan(cancelledMarkup.indexOf('你已在 5 秒后停止'))
  })

  it('keeps concurrent Runtime approvals in one dock directly above the composer', () => {
    const profiles = [{
      ...agentProfile(),
      id: 'agent-luoke',
      displayName: '洛可'
    }, {
      ...agentProfile(),
      id: 'agent-muwa',
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
      agentProfileId: profile.id,
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
      requestedForUserId: 'local-user',
      resolvedByType: null,
      resolvedById: null,
      resolutionCode: null,
      version: 1,
      requestedAt: `2026-07-30T03:00:0${index}Z`,
      resolvedAt: null
    }))
    const snapshot: CampSnapshot = {
      schemaVersion: 18,
      throughGlobalSequence: 2,
      camp: {
        id: 'camp-approval', title: '审批停靠区', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent-luoke', status: 'active',
        version: 1, createdAt: '2026-07-30T03:00:00Z', updatedAt: '2026-07-30T03:00:01Z'
      },
      members: profiles.map((profile, index) => ({
        agentProfileId: profile.id,
        handle: profile.handle,
        displayName: profile.displayName,
        teamRole: index === 0 ? 'Lead' : '开发者',
        avatarRef: null,
        accent: index === 0 ? '#A65F4A' : '#39777A',
        membershipStatus: 'active',
        profilePresence: 'present',
        memberOrder: index,
        isDefaultLead: index === 0,
        memoryWriteEnabled: true,
        version: 1
      })),
      tasks: [], messages: [], turns: [], agentRuns: [], inboxMessages: [],
      conversationInputs: [],
      contextManifests: [], contextCompactions: [], executionEvidence: [],
      approvals, actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: profiles,
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).toContain('aria-label="2 项待审批"')
    expect(markup).toContain('洛可、沐瓦')
    expect(markup).toContain('运行 pnpm test')
    expect(markup).not.toContain('class="approval-card')
    expect(markup.indexOf('class="approval-dock"')).toBeLessThan(markup.indexOf('class="composer"'))
  })

  it('renders delivered A2A content as a directed sender-authored conversation message', () => {
    const legacyA2aMessage = {
      id: 'legacy-a2a-state',
      sequence: 1,
      timelineGlobalSequence: 2,
      authorType: 'system' as const,
      authorId: 'a2a-state',
      sourceAgentRunId: null,
      body: 'legacy delivery status card',
      content: null,
      attachments: [],
      addressMode: 'broadcast' as const,
      addressedAgentProfileIds: [],
      replyToCampMessageId: null,
      campTurnId: null,
      presentation: {
        kind: 'a2a_event',
        event: 'request_accepted',
        senderNameAtEvent: '洛可',
        recipientNameAtEvent: '沐瓦',
        occurredAt: '2026-07-30T03:00:00Z'
      } as never,
      createdAt: '2026-07-30T03:00:00Z'
    }
    const deliveredMessage = {
      id: 'inbox-delivered',
      timelineGlobalSequence: 3,
      senderAgentId: 'agent-luoke',
      recipientAgentId: 'agent-muwa',
      body: '请检查 Downloads 目录里的页面。',
      sourceAgentRunId: 'run-luoke',
      targetAgentRunId: 'run-muwa',
      recipientMessageId: 'conversation-message-1',
      deliveredAt: '2026-07-30T03:00:01Z',
      failedAt: null,
      lastError: null,
      createdAt: '2026-07-30T03:00:01Z',
      updatedAt: '2026-07-30T03:00:01Z'
    }
    const failedMessage = {
      ...deliveredMessage,
      id: 'inbox-failed',
      timelineGlobalSequence: null,
      body: '不应进入会话的失败请求',
      recipientMessageId: null,
      deliveredAt: null,
      failedAt: '2026-07-30T03:00:02Z'
    }
    const projected = campConversationTimeline(
      [legacyA2aMessage],
      [deliveredMessage, failedMessage]
    )
    expect(projected.map((item) => item.id)).toEqual(['inbox-delivered'])

    const snapshot: CampSnapshot = {
      schemaVersion: 18,
      throughGlobalSequence: 3,
      camp: {
        id: 'camp-a2a', title: 'Agent 协作', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent-luoke', status: 'active',
        version: 1, createdAt: '2026-07-30T03:00:00Z', updatedAt: '2026-07-30T03:00:01Z'
      },
      members: [{
        agentProfileId: 'agent-luoke', handle: 'luoke', displayName: '洛可', teamRole: 'Lead',
        avatarRef: null, accent: '#D56A4A', membershipStatus: 'active', profilePresence: 'present',
        memberOrder: 0, isDefaultLead: true, memoryWriteEnabled: true, version: 1
      }, {
        agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', teamRole: '开发者',
        avatarRef: null, accent: '#39777a', membershipStatus: 'active', profilePresence: 'present',
        memberOrder: 1, isDefaultLead: false, memoryWriteEnabled: true, version: 1
      }],
      tasks: [],
      messages: [legacyA2aMessage],
      turns: [],
      agentRuns: [],
      inboxMessages: [deliveredMessage],
      conversationInputs: [{
        id: 'input-member-call', conversationId: 'conversation-muwa', campTurnId: 'turn-a2a',
        sequence: 1, status: 'materialized', sourceInboxMessageId: 'inbox-delivered',
        consumingAgentRunId: 'run-muwa', terminalReason: null,
        createdAt: '2026-07-30T03:00:01Z', materializedAt: '2026-07-30T03:00:02Z', terminalAt: null
      }],
      contextManifests: [],
      contextCompactions: [],
      executionEvidence: [],
      approvals: [],
      actions: [],
      timeline: []
    }
    const markup = renderToStaticMarkup(createElement(CampWorkspace, {
      snapshot,
      projectName: null,
      agents: [{
        ...agentProfile(),
        id: 'agent-luoke',
        handle: 'luoke',
        displayName: '洛可',
        runtimeReadiness: { status: 'ready', blockers: [] }
      }, {
        ...agentProfile(),
        id: 'agent-muwa',
        handle: 'muwa',
        displayName: '沐瓦',
        runtimeReadiness: { status: 'ready', blockers: [] }
      }],
      busy: false,
      onSend: async () => undefined,
      onChangeLead: async () => undefined,
      onSetMemoryWrite: async () => undefined,
      onTasksChanged: async () => undefined,
      onResolveApproval: () => undefined,
      stopping: false,
      onStop: () => undefined
    }))

    expect(markup).not.toContain('<h2>会话</h2>')
    expect(markup).toContain('<strong>洛可</strong><span class="collaboration-recipient">→ @沐瓦</span>')
    expect(markup).toContain('请检查 Downloads 目录里的页面。')
    expect(markup).not.toContain('legacy delivery status card')
    expect(markup).not.toContain('协作请求已送达')
    expect(markup).not.toContain('协作结果已返回')
    expect(markup).not.toContain('执行中')
    expect(markup).toContain('1 条持久化输入')
    expect(markup).not.toContain('Core Outcome')
    expect(markup).not.toContain('返回责任')
    expect(markup).not.toContain('Correlation')
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

  it('renders lightweight Task records as editable long-lived responsibilities', () => {
    const snapshot: CampSnapshot = {
      schemaVersion: 18,
      throughGlobalSequence: 1,
      camp: {
        id: 'camp-task', title: 'Task 管理', projectBindingKind: 'quick_chat', projectPath: '/quick-chat',
        defaultLeadAgentId: 'agent-muwa', status: 'active',
        version: 1, createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z'
      },
      members: [{
        agentProfileId: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', teamRole: '开发者',
        avatarRef: null, accent: '#39777a', membershipStatus: 'active', profilePresence: 'present', memberOrder: 0,
        isDefaultLead: true, memoryWriteEnabled: true, version: 1
      }],
      tasks: [{
        id: 'task-1', title: '实现 Task 工具', description: '跨消息持续跟踪，不自动唤醒负责人。',
        status: 'pending', assigneeAgentId: 'agent-muwa', createdByType: 'user',
        createdById: 'local-user', sourceAgentRunId: null, version: 1,
        createdAt: '2026-07-23T00:00:00Z', updatedAt: '2026-07-23T00:00:00Z',
        closedAt: null, availableActions: ['update']
      }],
      messages: [], turns: [], agentRuns: [], inboxMessages: [],
      conversationInputs: [], contextManifests: [],
      contextCompactions: [], executionEvidence: [], approvals: [], actions: [], timeline: []
    }
    const markup = renderToStaticMarkup(createElement(TaskPanel, {
      snapshot,
      busy: false,
      onTasksChanged: async () => undefined
    }))

    expect(markup).toContain('长期事项')
    expect(markup).toContain('＋ 新建')
    expect(markup).toContain('实现 Task 工具')
    expect(markup).toContain('跨消息持续跟踪，不自动唤醒负责人。')
    expect(markup).toContain('沐瓦')
    expect(markup).not.toContain('acceptanceCriteria')
  })

  it('coalesces streamed agent text by item', () => {
    const conversation = buildConversation([
      event(1, 'user.message', { text: '修复设置页' }),
      event(2, 'agent.text.delta', { turnId: 'turn-1', itemId: 'message-1', delta: '我先' }),
      event(3, 'agent.text.delta', { turnId: 'turn-1', itemId: 'message-1', delta: '检查。' })
    ])

    expect(conversation).toHaveLength(2)
    expect(conversation[1]?.text).toBe('我先检查。')
  })

  it('explains context blockers and A2A delivery without relying on color', () => {
    expect(agentRunPresentation({ status: 'waiting', waitReason: 'context_compaction' })).toEqual({
      label: '压缩上下文',
      tone: 'attention'
    })
    expect(agentRunPresentation({ status: 'waiting', waitReason: 'delivery_unknown' })).toEqual({
      label: '投递待确认',
      tone: 'danger'
    })
    expect(agentRunPresentation({ status: 'running', waitReason: null }, true)).toEqual({
      label: '正在停止…',
      tone: 'neutral'
    })
    expect(agentRunStateTag({ status: 'running', waitReason: null }, true)).toEqual({
      tag: '正在停止',
      tone: 'neutral'
    })
    expect(agentRunWaitDetail('context_overloaded')).toContain('没有静默裁剪')
    expect(inboxMessagePresentation({ deliveredAt: '2026-07-23T00:00:00Z', failedAt: null }, 'queued')).toEqual({
      label: '已排队',
      tone: 'neutral'
    })
    expect(formatByteSize(4_096)).toBe('4.0 KB')
  })

  it('coalesces command output without hiding file activity', () => {
    const activities = buildActivities([
      event(1, 'command.output.delta', { itemId: 'command-1', delta: 'pass ' }),
      event(2, 'command.output.delta', { itemId: 'command-1', delta: '12 tests' }),
      event(3, 'file.change.updated', { itemId: 'patch-1' })
    ])

    expect(activities).toHaveLength(2)
    expect(activities[0]?.detail).toBe('pass 12 tests')
    expect(activities[1]?.kind).toBe('file')
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
        title: '运行命令',
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

  it('loads complete historical execution evidence through stable per-Run pages', async () => {
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

  it('projects a command lifecycle as one atomic activity', () => {
    const activities = buildActivities([
      event(1, 'activity.started', {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: 'pnpm test',
          cwd: '/repo',
          status: 'inProgress'
        }
      }),
      event(2, 'command.output.delta', { itemId: 'command-1', delta: 'running tests…\n' }),
      event(3, 'activity.completed', {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          command: 'pnpm test',
          cwd: '/repo',
          status: 'completed',
          durationMs: 1234,
          exitCode: 0,
          aggregatedOutput: 'pass 12 tests'
        }
      })
    ])

    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      kind: 'command',
      status: 'completed',
      command: 'pnpm test',
      cwd: '/repo',
      durationMs: 1234,
      exitCode: 0,
      detail: 'pass 12 tests'
    })
  })

  it('removes terminal color control sequences from visible output', () => {
    const activities = buildActivities([
      event(1, 'command.output.delta', {
        itemId: 'command-1',
        delta: '\u001b[31mfailed\u001b[0m\n'
      }),
      event(2, 'activity.completed', {
        item: {
          id: 'command-1',
          type: 'commandExecution',
          status: 'completed',
          exitCode: 1,
          aggregatedOutput: '\u001b[31mfailed\u001b[0m'
        }
      })
    ])

    expect(stripAnsi('\u001b[32mpass\u001b[0m')).toBe('pass')
    expect(activities[0]).toMatchObject({ status: 'failed', detail: 'failed', exitCode: 1 })
  })

  it('surfaces recovery boundaries in the conversation', () => {
    const conversation = buildConversation([
      event(1, 'runtime.state', { status: 'recovering' }, 'application/restarted'),
      event(2, 'runtime.state', { sessionGeneration: 2 }, 'session/generation-changed')
    ])

    expect(conversation.map((item) => item.kind)).toEqual(['system', 'system'])
    expect(conversation[1]?.text).toContain('Session Generation')
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

  it('explains approval scope and each decision consequence', () => {
    const approval: Approval = {
      id: 'approval-1',
      taskId: 'task-1',
      nativeRequestId: 'native-1',
      approvalType: 'execCommandApproval',
      reason: '需要运行现有测试验证变更。',
      request: { command: 'pnpm test', cwd: '/repo' },
      status: 'pending',
      decision: null,
      requestedAt: '2026-07-17T10:00:00Z',
      resolvedAt: null
    }

    const summary = summarizeApproval(approval)
    expect(summary.capability).toBe('执行终端命令')
    expect(summary.scope).toContain('pnpm test')
    expect(summary.scope).toContain('/repo')
    expect(summary.blockingImpact).toContain('Turn 已暂停')
    expect(summary.allowOnceEffect).not.toBe(summary.allowSessionEffect)
    expect(summary.declineEffect).not.toBe(summary.cancelEffect)
  })

  it('describes Quick Chat state without implying project access', () => {
    const summary = taskStateSummary('preparing', 0, undefined, 'quick_chat')
    expect(summary).toContain('快速对话上下文')
    expect(summary).toContain('不会读取用户项目')
  })

  it('keeps queued Task state distinct from an already running AgentRun', () => {
    expect(taskStateSummary('pending', 0)).toContain('等待 Scheduler')
    expect(taskStateSummary('in_progress', 0)).toContain('已经开始执行')
  })

  it('keeps member selection and Runtime binding explicit', () => {
    const markup = renderToStaticMarkup(createElement(MembersView, {
      agents: [agentProfile()],
      installations: [codexInstallation()],
      runtimeAvailability: [],
      runtimeDiscoveryPending: false,
      selectedAgentId: 'agent-muwa',
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
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('独立保存，只影响之后创建的 Run。')
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

  it('keeps partner memory saving local and rolls back a failed switch change', () => {
    const initial = {
      enabled: true,
      previousEnabled: true,
      saving: false,
      error: null
    }
    const saving = memberMemorySwitchReducer(initial, { type: 'start', enabled: false })
    expect(saving).toEqual({
      enabled: false,
      previousEnabled: true,
      saving: true,
      error: null
    })

    const failed = memberMemorySwitchReducer(saving, {
      type: 'failure',
      error: '保存失败'
    })
    expect(failed).toEqual({
      enabled: true,
      previousEnabled: true,
      saving: false,
      error: '保存失败'
    })
  })

  it('keeps summary model settings folded until advanced settings are expanded', () => {
    const folded = renderToStaticMarkup(createElement(MemberAdvancedSettings, {
      installations: [codexInstallation()],
      agent: agentProfile()
    }))
    const expanded = renderToStaticMarkup(createElement(MemberAdvancedSettings, {
      installations: [codexInstallation()],
      agent: agentProfile(),
      defaultOpen: true
    }))

    expect(folded).toContain('高级设置')
    expect(folded).not.toContain('正在读取摘要模型设置')
    expect(folded).not.toContain('<details open')
    expect(expanded).toContain('<details open')
    expect(expanded).toContain('正在读取摘要模型设置')
    expect(expanded).toContain('Camp 共享摘要')
    expect(expanded).not.toContain('这是所有 Camp 共享摘要使用的模型配置')
    expect(expanded).not.toContain('自动回退')
    expect(expanded).not.toContain('执行引擎')
  })

  it('does not expose a standalone context destination in settings navigation', () => {
    const markup = renderToStaticMarkup(createElement(SettingsView, {
      appearance: { preference: 'system', resolvedTheme: 'day' },
      health: null,
      agents: [],
      installations: [],
      readyCount: 0,
      busy: null,
      section: 'appearance',
      onRefresh: () => undefined,
      onExport: () => undefined,
      onReload: async () => undefined,
      onThemeChange: () => undefined
    }))

    expect(markup).not.toContain('<strong>上下文</strong>')
    expect(markup).not.toContain('<strong>记忆</strong>')
  })

  it('renders long-term memory as a first-class scope and governance workbench', () => {
    const markup = renderToStaticMarkup(createElement(MemoryLibrary, {
      agents: [],
      topNotices: createElement('div', { className: 'test-page-notice' }, '页面提示')
    }))

    expect(markup).toContain('记忆')
    expect(markup).toContain('共同约定')
    expect(markup).toContain('伙伴经验')
    expect(markup).toContain('协作默契')
    expect(markup).toContain('伙伴形成')
    expect(markup).toContain('Hearth 待确认')
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
    expect(hasDuplicateMemberDisplayName('沐瓦', existing.id, [existing])).toBe(false)
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

  it('persists a missing Product Runtime choice and links to its checks', () => {
    const markup = renderToStaticMarkup(createElement(MemberRuntimeForm, {
      agent: {
        ...agentProfile(),
        runtimeSelection: { adapterKind: 'copilot-cli' },
        runtimeReadiness: {
          status: 'selected_unresolved',
          blockers: [{ code: 'runtime_selection_unresolved', detail: null }]
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
    expect(markup).toContain('未安装的 Agent 运行时也可以保存')
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
        runtimeSelection: { adapterKind: 'codebuddy-cli' },
        runtimeReadiness: {
          status: 'selected_unresolved',
          blockers: [{ code: 'runtime_selection_unresolved', detail: null }]
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
        runtimeSelection: { adapterKind: 'kiro-cli' },
        runtimeReadiness: {
          status: 'selected_unresolved',
          blockers: [{ code: 'runtime_selection_unresolved', detail: null }]
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
        runtimeSelection: { adapterKind: 'kiro-cli' },
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
    id: 'agent-muwa', handle: 'muwa', displayName: '沐瓦', avatarRef: null,
    accent: '#39777a', teamRole: '开发者',
    professionalResponsibilities: '负责实现和验证。', personalityTraits: ['严谨'],
    workingPrinciples: '遵循项目规范。', growthTopic: '',
    defaultCapabilities: [], presence: 'present', runtimeSelection: null, runtimePreference: null,
    runtimeReadiness: { status: 'runtime_not_configured', blockers: [{ code: 'runtime_not_configured', detail: null }] },
    memberOrder: 0, version: 1, createdAt: '2026-07-22T00:00:00Z', updatedAt: '2026-07-22T00:00:00Z', removedAt: null
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
