import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, AgentRunView, ThreadComposerDraftView, ThreadSnapshot, ExecutionConsolePlacement, MessageDeliveryView } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { ThreadWorkspace, type NotificationFocusTarget, type VisibleNotificationSources } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { ThreadClientProvider } from '../../../apps/desktop/src/renderer/src/camp-client'
import { MobileLayoutProvider } from '../../../apps/desktop/src/renderer/src/MobileLayout'
import { desktopThreadClient } from '../../../apps/desktop/src/renderer/src/desktop-camp-client'
import '../../../apps/desktop/src/renderer/src/styles.css'

// The actual production workspace, with closed local fixtures. No Core, Runtime or daily data.
const now = '2026-08-31T04:00:00Z'
const threadId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
const fixtureMessage = '本页挂载真实的执行浮层、执行详情和三个生产入口。可检查头像横滑、键盘导航，并从任务的关联执行定位最后一位队员。'
const longPath = `/fixture/workspace/${'execution_popover_width_regression_'.repeat(7)}report.md`
const longCommand = `git show HEAD -- ${longPath}`
const longNarration = `这是隔离验收数据。长正文、路径和行内代码应在浮层内完整换行，命令标题保持单行省略。\n\n检查文件：\`${longPath}\`。\n\n\`\`\`text\n${longPath}\n\`\`\`\n\n正文结束标记：完整可读。`
const names = ['洛可', '沐瓦', '绵栀', '奇鹿', '言川', '予墨', '知夏', '负责跨项目执行审查与回归验收的长名称队员', '时屿', '星澜', '安禾', '云舒']
const agents: AgentProfile[] = Array.from({ length: 49 }, (_, index) => ({
  agentId: `agent-${index + 1}`, displayName: names[index] ?? `队员 ${index + 1}`,
  avatarRef: index < 4 ? `rovai://member-avatar/builtin/${['luoke', 'muwa', 'mianzhi', 'qilu'][index]}/v1` : null,
  accent: null, teamRole: '项目协作', professionalResponsibilities: '', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: 'claude-code-cli', model: { mode: 'explicit', modelId: 'claude-opus-4-6', options: {} },
    permissions: { adapterKind: 'claude-code-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: index, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
}))

function snapshotFor(count: number, revision: number, recipientCount = 0): ThreadSnapshot {
  const profiles = agents.slice(0, count)
  const members = agents.slice(0, Math.max(count, recipientCount > 0 ? recipientCount + 1 : 0))
  const deliveries: MessageDeliveryView[] = agents.slice(1, recipientCount + 1).flatMap((recipient, index) =>
    [0, 1, 2].map(attempt => ({
      id: `delivery-${index}-${attempt}`, messageId: `public-message-${attempt}`, threadTurnId: 'turn-agent-1',
      taskId: null, recipientAgentId: recipient.agentId, recipientMembershipVersionAtAdmission: 1,
      deliveryKind: 'public_a2a' as const, sourceAgentRunId: 'run-agent-1', dispatchDisposition: 'dispatch' as const,
      completionRole: 'required' as const, gatherId: null, gatherDispatchDeliveryId: null,
      recipientCanonicalPosition: index, edgeKind: 'forward' as const, targetParentAgentRunId: 'run-agent-1',
      returnToAgentRunId: null, status: attempt === 0 ? 'running' : 'pending',
      dispatchPhase: attempt === 0 ? 'materialized' : 'attempted_waiting', waitCondition: attempt === 0 ? null : 'target_busy' as const,
      dispatchAttemptCount: 1, retryGeneration: 0, contextManifestId: null,
      targetAgentRunId: attempt === 0 ? `run-${recipient.agentId}` : null,
      manualInterventionRequired: false, failureCode: null, version: 1,
      createdAt: now, updatedAt: now, endedAt: null
    }))
  )
  if (deliveries[0]?.deliveryKind === 'public_a2a') deliveries.push({
    ...deliveries[0], id: 'incoming-delivery', sourceAgentRunId: 'run-agent-3',
    recipientAgentId: 'agent-1', targetAgentRunId: 'run-agent-1', targetParentAgentRunId: 'run-agent-3'
  })
  const runs: AgentRunView[] = profiles.map((agent, index) => {
    const status = (['running', 'waiting', 'running', 'succeeded', 'failed', 'cancelled'] as const)[index < 3 ? index : 3 + (index % 3)]
    return {
      id: `run-${agent.agentId}`, threadTurnId: `turn-${agent.agentId}`, conversationId: `conversation-${agent.agentId}`,
      inputMessageIds: index === 0 ? ['public-message-0', 'public-message-1', 'public-message-2'] : ['message-1'],
      anchorMessageId: index === 0 ? 'public-message-2' : 'message-1',
      agentId: agent.agentId, taskId: index === count - 1 ? 'task-rail' : null,
      responsibilityKey: `direct:${agent.agentId}`, responsibilityGeneration: 0, purpose: '执行台界面与交互检查',
      completionRole: 'required', status: revision % 2 && index === 0 ? 'succeeded' : status,
      waitReason: status === 'waiting' ? 'dependency' : null, cancelRequestedAt: null, cancelReasonCode: null,
      cancelAcknowledgedAt: null, terminalResolutionSource: null, terminalReasonCode: null, failure: null,
      runtimeModel: { modelId: 'claude-opus-4-6' }, executionEpoch: 1, permissionSemantics: 'runtime_managed_v2',
      invocationKind: 'direct', triggerDeliveryGeneration: 0, a2aParentAgentRunId: null, a2aRootAgentRunId: null,
      a2aDepth: 0, executionEvidenceCount: 2, hasUnsettledExternalEffects: false, workspace: { path: '/fixture/workspace' },
      startingGitObservation: null, endingGitObservation: null, version: revision + 1,
      createdAt: now, startedAt: now, endedAt: index < 3 ? null : now, updatedAt: now
    }
  })
  return {
    schemaVersion: 36, throughGlobalSequence: revision + 1, tasksEnabled: true,
    thread: { id: threadId, title: '执行台头像轨道', activationState: 'active', projectBindingKind: 'directory',
      projectPath: '/fixture/workspace', defaultLeadAgentId: profiles[0]?.agentId ?? null,
      membershipGeneration: 1, version: 1, createdAt: now, updatedAt: now },
    members: members.map((agent, index) => ({ agentId: agent.agentId, displayName: agent.displayName,
      avatarRef: agent.avatarRef, teamRole: agent.teamRole, accent: '', membershipStatus: 'active',
      leaveRequestedAt: null, profilePresence: 'present', memberOrder: index, isDefaultLead: index === 0, version: 1 })),
    membershipReconciliations: [],
    tasks: count ? [{ taskId: 'task-rail', threadId, title: '检查最后一位队员的执行', description: '从关联执行定位轨道末尾，随后可重复定位同一队员，并确保目标头像完整可见。',
      status: 'in_progress', assigneeAgentId: profiles.at(-1)!.agentId,
      blockedReason: null, completionSummary: null, cancelReason: null, createdByType: 'user', createdById: 'local-user',
      sourceAgentRunId: null, closedByType: null, closedById: null, closedByAgentRunId: null,
      version: 1, createdAt: now, updatedAt: now, closedAt: null, availableActions: [] }] : [],
    messages: [{ id: 'message-1', sequence: 1, timelineGlobalSequence: 1, authorType: 'user', authorId: 'local-user',
      sourceAgentRunId: null, body: fixtureMessage,
      content: [{ kind: 'text', text: fixtureMessage }], addressMode: 'default', attachments: [], addressedAgentIds: [], replyToThreadMessageId: null,
      threadTurnId: null, presentation: null, createdAt: now }, ...[0, 1, 2].map((index) => ({
      id: `public-message-${index}`, sequence: index + 2, timelineGlobalSequence: index + 2,
      authorType: 'user' as const, authorId: 'local-user', sourceAgentRunId: null,
      body: `第 ${index + 1} 条合批输入`, content: [{ kind: 'text' as const, text: `第 ${index + 1} 条合批输入` }],
      addressMode: 'explicit' as const, attachments: [], addressedAgentIds: ['agent-1'],
      replyToThreadMessageId: null, threadTurnId: null, presentation: null, createdAt: now
    }))],
    messageDeliveries: deliveries, turns: [], agentRuns: runs,
    executionEvidence: runs.flatMap<ThreadSnapshot['executionEvidence'][number]>(run => [{ id: `evidence-${run.agentId}`, agentRunId: run.id, executionEpoch: 1,
      sequence: 1, eventType: 'agent.text.delta', kind: 'narration', phase: 'updated',
      payload: { itemId: `message-${run.agentId}`, delta: longNarration },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now }, {
      id: `command-${run.agentId}`, agentRunId: run.id, executionEpoch: 1, sequence: 2,
      eventType: 'activity.completed', kind: 'command', phase: 'completed',
      payload: { item: { id: `shell-${run.agentId}`, type: 'commandExecution', command: longCommand,
        status: 'completed', aggregatedOutput: `检查文件 ${longPath}\n${'完整输出仍可纵向滚动。\n'.repeat(24)}输出结束标记。` } },
      canonical: { operationId: `shell-${run.agentId}`, classifierVersion: 'activity-v1',
        activityDomain: 'shell', semanticKind: 'shell.execute', toolName: null, presentationHint: '执行 Shell 命令',
        phase: 'terminal', outcome: 'succeeded', credibility: 'runtime_structured', coverageLevel: 'fine_grained',
        sourceAuthority: 'runtime', sourceEvidenceIds: [`command-${run.agentId}`],
        firstEvidenceSequence: 2, lastEvidenceSequence: 2, revision: 1 },
      contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: now
    }]),
    agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
  }
}

let draft: ThreadComposerDraftView = { threadId, body: '', content: { version: 2, segments: [] }, revision: 1, attachments: [],
  replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  filePreview: {
    bindThread: async () => {}, onExternalUpdate: () => () => {}, release: async () => ({ released: true }),
    open: async (request: { threadId: string }) => ({ ok: true, value: { kind: 'file_preview', file: {
      previewKey: `selection-file:${request.threadId}`, handleId: `selection-file:${request.threadId}`,
      reopenToken: 'selection-file', fileName: 'selection.txt', displayPath: 'selection.txt',
      pathPresentation: 'project_relative', size: 32, mime: 'text/plain', extension: '.txt', kind: 'text',
      hasExternalUpdate: false, contentVersion: { size: 32, mtimeMs: 1 }, contentGeneration: 'selection-1',
      capabilities: ['read']
    } } }),
    readText: async () => ({ ok: true, value: { text: '执行选择回归：当前文件应保持可见。',
      contentGeneration: 'selection-1', contentVersion: { size: 32, mtimeMs: 1 } } })
  },
  windowControls: { onCloseTabRequested: () => () => {} },
  request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (method === 'preferences.tasks.get') return { enabled: true, headsUpAfterSequence: 0, observedThroughChangeSequence: 0 }
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.composerDraft.get') return { ...draft, threadId: params?.threadId ?? draft.threadId }
    if (method === 'camp.composerDraft.save') { draft = { ...draft, ...params, revision: draft.revision + 1 }; return draft }
    if (method === 'thread.messages.replies') return {
      schemaVersion: 1, threadId: params?.threadId, messageId: params?.messageId, rootMessageId: 'message-1',
      throughGlobalSequence: 1, sourceAvailable: true, replyCount: 1, hasEarlier: false, hasLater: false,
      messages: snapshotFor(4, 0).messages.filter(message => message.id === params?.messageId)
        .map(message => ({ ...message, replyToThreadMessageId: 'message-1' })),
      runAnchorMessageIds: ['public-message-2']
    }
    if (method === 'agentRunEvidence.getContent') {
      const evidence = snapshotFor(20, 0).executionEvidence.find(item => item.id === params?.evidenceId)
      if (evidence) return { payload: evidence.payload }
    }
    throw new Error(`Unexpected fixture API: ${method}`)
  }
} })

let configureNotificationFixture: (() => void) | null = null
let configureFailureFixture: (() => void) | null = null
let focusNotificationRun: ((requestId: number, runId: string) => void) | null = null
let focusNotificationSubject: ((kind: 'task' | 'mission', requestId: number) => void) | null = null
let notificationFixtureEnabled = false
let latestVisibleNotificationSources: VisibleNotificationSources | null = null
const visibleNotificationSourceReports: VisibleNotificationSources[] = []
const presentedNotificationRequests: number[] = []
let previewHarness: {
  openExecution(): void
  openFile(): Promise<unknown>
  hidePane(): void
  paneVisible: boolean
  activeTabKind: string | null
} | null = null

function NotificationFixtureBridge(): null {
  const preview = useFilePreview()
  previewHarness = {
    openExecution: preview.openExecution,
    openFile: () => preview.open({ kind: 'camp_workspace', threadId: selectionThreadId, rawReference: 'selection.txt' }),
    hidePane: preview.hidePane,
    paneVisible: preview.paneVisible,
    activeTabKind: preview.activeTab?.kind ?? null
  }
  return null
}

Object.assign(window, { executionNotificationTest: {
  configureRight: () => configureNotificationFixture?.(),
  configureFailure: () => configureFailureFixture?.(),
  openExecution: () => previewHarness?.openExecution(),
  hideExecution: () => previewHarness?.hidePane(),
  focusRun: (requestId: number, runId = 'run-agent-1') => focusNotificationRun?.(requestId, runId),
  focusSubject: (kind: 'task' | 'mission', requestId: number) => focusNotificationSubject?.(kind, requestId),
  state: () => {
    const target = document.querySelector<HTMLElement>('[data-agent-run-id="run-agent-1"]')
    const terminalTarget = document.querySelector<HTMLElement>('[data-agent-run-id="run-agent-1-history"]')
    const otherTerminalTarget = document.querySelector<HTMLElement>('[data-agent-run-id="run-agent-4"]')
    const preview = document.querySelector<HTMLElement>('[data-preview-camp]')
    const executionPortal = document.querySelector<HTMLElement>('.execution-drawer-portal')
    const viewport = target?.closest<HTMLElement>('.execution-drawer-body') ?? null
    const rect = (element: HTMLElement | null) => element?.getBoundingClientRect().toJSON() ?? null
    return {
      focusedTask: document.activeElement?.getAttribute('data-task-id'),
      focusedMission: document.activeElement?.getAttribute('data-mission-id'),
      paneVisible: previewHarness?.paneVisible ?? false,
      activeTabKind: previewHarness?.activeTabKind ?? null,
      compact: document.querySelector('.workspace-grid')?.classList.contains('file-preview-compact') ?? false,
      targetPresent: target !== null,
      targetVisible: Boolean(target?.getClientRects().length),
      targetFocused: document.activeElement === target,
      terminalTargetVisible: Boolean(terminalTarget?.getClientRects().length),
      terminalTargetFocused: document.activeElement === terminalTarget,
      otherTerminalTargetVisible: Boolean(otherTerminalTarget?.getClientRects().length),
      otherTerminalTargetFocused: document.activeElement === otherTerminalTarget,
      historyExpanded: document.querySelector('.execution-history-toggle')?.getAttribute('aria-expanded') === 'true',
      targetInsideWorkspace: Boolean(target?.closest('.workspace-shell')),
      targetInsideExecutionPortal: Boolean(target && executionPortal?.contains(target)),
      portalRunCount: executionPortal?.querySelectorAll('.execution-drawer [data-agent-run-id]').length ?? 0,
      previewHidden: preview?.hidden ?? true,
      documentFocused: document.hasFocus(),
      documentVisibility: document.visibilityState,
      targetRect: rect(target),
      viewportRect: rect(viewport),
      viewportHidden: viewport?.hidden ?? null,
      visibleRunIds: latestVisibleNotificationSources?.agentRunIds ?? [],
      failureBubbleVisible: !!document.querySelector<HTMLElement>('[data-presence-run="silent-failure"]')?.checkVisibility(),
      executionVisible: !!document.querySelector<HTMLElement>('.execution-drawer')?.checkVisibility(),
      visibleSourceReports: visibleNotificationSourceReports.map((sources) => sources.agentRunIds),
      presentedRequests: [...presentedNotificationRequests]
    }
  }
} })

let configureInterruptionFixture: (() => void) | undefined
Object.assign(window, { configureRunInterruption: () => configureInterruptionFixture?.() })

let configureEmptyExecutionFixture: ((pending: boolean, placement: ExecutionConsolePlacement) => void) | undefined
type SelectionScenario = { threadId: string; running?: boolean; missingAgent?: string; ready?: boolean; placement?: ExecutionConsolePlacement; reply?: boolean; autoOpen?: boolean; mobile?: boolean }
let configureSelectionFixture: ((scenario: SelectionScenario) => void) | undefined
let updateSelectionFixture: ((patch: Partial<SelectionScenario>) => void) | undefined
let publishSubmittedRun: (() => void) | undefined
let submittedMessages = 0
let selectionThreadId = threadId
Object.assign(window, { executionSelectionTest: {
  configure: (scenario: SelectionScenario) => configureSelectionFixture?.(scenario),
  update: (patch: Partial<SelectionScenario>) => updateSelectionFixture?.(patch),
  publishSubmittedRun: () => publishSubmittedRun?.(),
  submittedMessages: () => submittedMessages,
  openFile: () => previewHarness?.openFile(),
  openExecution: () => previewHarness?.openExecution(),
  hideExecution: () => previewHarness?.hidePane()
} })
let rejectNextPlacement = false
Object.assign(window, {
  configureEmptyExecution: (pending = false, placement: ExecutionConsolePlacement = 'inspector') => configureEmptyExecutionFixture?.(pending, placement),
  failNextExecutionPlacement: () => { rejectNextPlacement = true }
})

function Fixture(): React.JSX.Element {
  const [count, setCount] = useState(12)
  const [pendingThread, setPendingThread] = useState(false)
  const [recipientCount, setRecipientCount] = useState(0)
  const [revision, setRevision] = useState(0)
  const [entryRunningCount, setEntryRunningCount] = useState<number | null>(null)
  const [open, setOpen] = useState(true)
  const [placement, setPlacement] = useState<ExecutionConsolePlacement>('inspector')
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  const [theme, setTheme] = useState('day')
  const [longTitleScenario, setLongTitleScenario] = useState(false)
  const [stoppedRuns, setStoppedRuns] = useState<string[]>([])
  const [interruptionScenario, setInterruptionScenario] = useState(false)
  const [failureScenario, setFailureScenario] = useState(false)
  const [notificationFocus, setNotificationFocus] = useState<NotificationFocusTarget | null>(null)
  const [selectionScenario, setSelectionScenario] = useState<SelectionScenario | null>(null)
  const [submittedRunVisible, setSubmittedRunVisible] = useState(false)
  updateSelectionFixture = patch => setSelectionScenario(current => current ? { ...current, ...patch } : current)
  publishSubmittedRun = () => setSubmittedRunVisible(true)
  configureSelectionFixture = scenario => {
    submittedMessages = 0
    setSubmittedRunVisible(false)
    notificationFixtureEnabled = false
    setNotificationFocus(null)
    setSelectionScenario(scenario)
    setCount(4)
    setOpen(false)
    setPlacement(scenario.placement ?? 'right')
  }
  configureNotificationFixture = () => {
    notificationFixtureEnabled = true
    setOpen(false)
    setPlacement('right')
    setNotificationFocus(null)
    latestVisibleNotificationSources = null
    visibleNotificationSourceReports.length = 0
    presentedNotificationRequests.length = 0
  }
  configureFailureFixture = () => {
    notificationFixtureEnabled = true
    setFailureScenario(true)
    setCount(1)
    setOpen(false)
    setPlacement('right')
    setNotificationFocus(null)
    previewHarness?.hidePane()
    latestVisibleNotificationSources = null
  }
  focusNotificationRun = (requestId, runId) => setNotificationFocus({
    requestId,
    kind: 'agent_run',
    agentRunId: runId,
    threadTurnId: null,
    active: true
  })
  focusNotificationSubject = (kind, requestId) => setNotificationFocus({ requestId, kind, subjectId: kind === 'task' ? 'task-rail' : 'mission-rail', threadTurnId: null, active: true })
  configureInterruptionFixture = () => {
    setInterruptionScenario(true)
    setLongTitleScenario(false)
    setEntryRunningCount(null)
    setCount(1)
    setRecipientCount(0)
    setOpen(false)
  }
  configureEmptyExecutionFixture = (pending, placement) => {
    notificationFixtureEnabled = false
    setNotificationFocus(null)
    previewHarness?.hidePane()
    setCount(0)
    setRecipientCount(0)
    setEntryRunningCount(null)
    setLongTitleScenario(false)
    setInterruptionScenario(false)
    setPendingThread(pending)
    setPlacement(placement)
    setOpen(false)
  }
  const snapshot = snapshotFor(count, revision, recipientCount)
  if (pendingThread) {
    snapshot.thread.activationState = 'pending'
    snapshot.messages = []
    snapshot.tasks = []
  }
  if (notificationFixtureEnabled && snapshot.agentRuns[0]) {
    snapshot.agentRuns.push({ ...snapshot.agentRuns[0], id: 'run-agent-1-history',
      status: 'succeeded', createdAt: '2026-08-30T04:00:00Z', endedAt: now })
  }
  if (longTitleScenario) {
    snapshot.turns = snapshot.agentRuns.map(run => ({ id: run.threadTurnId!, triggerType: 'camp_message',
      triggerId: run.anchorMessageId!, status: 'running', aggregateReasonCode: null,
      cancelRequestedAt: null, createdAt: now, updatedAt: now, endedAt: null, version: 1,
      executionBudget: { schemaVersion: 1, acceptedAt: now, deadlineAt: null, elapsedSeconds: null,
        maxAgentRunResponsibilities: 32, maxAcceptedA2a: 16, allocatedAgentRunResponsibilities: 1,
        acceptedA2a: 0, exhaustedAt: null, exhaustionReason: null, exhaustionCommandId: null } }))
    snapshot.agentRuns = snapshot.agentRuns.map(run => ({ ...run,
      status: stoppedRuns.includes(run.id) ? 'cancelled' : run.agentId === 'agent-1' ? 'running' : run.status,
      createdAt: run.agentId === 'agent-3' ? '2026-08-31T04:01:00Z' : run.createdAt,
      cancelRequestedAt: stoppedRuns.includes(run.id) ? now : null,
      endedAt: stoppedRuns.includes(run.id) ? now : run.endedAt
    }))
    snapshot.executionEvidence = snapshot.executionEvidence.map(evidence => evidence.kind === 'narration'
      ? { ...evidence, payload: { ...evidence.payload,
          delta: `${('长记录用于检查卡片标题吸顶、键盘焦点与单卡终止。\n\n').repeat(24)}${longNarration}` } }
      : evidence)
  }
  if (entryRunningCount !== null) {
    snapshot.agentRuns = snapshot.agentRuns.map((run, index) => ({
      ...run, status: index < entryRunningCount ? 'running' : 'waiting',
      waitReason: index < entryRunningCount ? null : 'dependency', endedAt: null
    }))
    // Multiple runs of one member must still occupy a single entry avatar.
    if (entryRunningCount > 0) snapshot.agentRuns.push({ ...snapshot.agentRuns[0], id: 'duplicate-entry-run' })
    // Keep one roster-only member so the entry proves it counts execution history, not the roster.
    const rosterOnlyAgent = agents.find(agent => !snapshot.members.some(member => member.agentId === agent.agentId))
    if (rosterOnlyAgent) snapshot.members.push({
      agentId: rosterOnlyAgent.agentId, displayName: rosterOnlyAgent.displayName,
      avatarRef: rosterOnlyAgent.avatarRef, teamRole: rosterOnlyAgent.teamRole, accent: '',
      membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present',
      memberOrder: snapshot.members.length, isDefaultLead: false, version: 1
    })
  }
  if (interruptionScenario) {
    const stopped = { ...snapshot.agentRuns[0], threadTurnId: null, status: 'cancelled' as const,
      cancelReasonCode: 'user_requested_agent_run_stop', cancelRequestedAt: now, endedAt: now }
    snapshot.agentRuns = [stopped, { ...stopped, id: 'run-agent-1-successor', status: 'running',
      cancelRequestedAt: null, cancelReasonCode: null, endedAt: null, createdAt: '2026-08-31T04:02:00Z' }]
    snapshot.messages = snapshot.messages.slice(0, 1)
    snapshot.tasks = []
    snapshot.turns = []
    snapshot.agentRunFileChanges = [{ schemaVersion: 2, agentRunId: stopped.id, executionEpoch: 1,
      files: [{ evidenceFileId: 'interrupted-file', path: 'docs/proposals/thread-runs.md', changeKind: 'add',
        presentationKind: 'operation_history', operationCount: 1 }],
      fileCount: 1, operationCount: 1, completedAt: now }]
  }
  if (failureScenario) {
    snapshot.agentRuns = [{ ...snapshot.agentRuns[0], id: 'silent-failure', status: 'failed',
      invocationKind: 'batch', threadTurnId: null, conversationId: null, endedAt: now,
      inputMessageIds: ['message-1'], anchorMessageId: 'message-1', executionEvidenceCount: 0 }]
    snapshot.messages = snapshot.messages.slice(0, 1)
    snapshot.executionEvidence = []
    snapshot.tasks = []
    snapshot.agentRunFileChanges = []
  }
  if (selectionScenario) {
    snapshot.thread = { ...snapshot.thread, id: selectionScenario.threadId, title: selectionScenario.threadId }
    snapshot.agentRuns = snapshot.agentRuns.filter(run => run.agentId !== selectionScenario.missingAgent)
      .map((run, index) => ({ ...run, status: selectionScenario.running && index === 0 ? 'running' : 'succeeded',
        waitReason: null, endedAt: selectionScenario.running && index === 0 ? null : now }))
    snapshot.tasks = []
    if (selectionScenario.reply) snapshot.messages = snapshot.messages.map(message => message.id === 'public-message-2'
      ? { ...message, replyToThreadMessageId: 'message-1' } : message)
    if (submittedRunVisible) snapshot.agentRuns.push({ ...snapshot.agentRuns[0],
      id: 'run-submitted', status: 'running', endedAt: null,
      inputMessageIds: ['message-submitted'], anchorMessageId: 'message-submitted',
      executionEvidenceCount: 0, createdAt: '2026-08-31T04:02:00Z' })
  }
  selectionThreadId = snapshot.thread.id
  return <FilePreviewProvider threadId={snapshot.thread.id} resolvedTheme={theme === 'night' ? 'night' : 'day'}>
    <NotificationFixtureBridge />
    <div className="app-shell app-shell-camp">
    <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)', color: 'var(--rail-ink)' }}>
      <strong>Rovai AI · 隔离验收</strong>
      <p style={{ fontSize: 12, lineHeight: 1.7 }}>真实生产组件，模拟队员数据。<br />不调用模型，不访问日常 Camp。</p>
      <div style={{ display: 'grid', gap: 8 }}>
        <label>入口运行人数 <select data-entry-running-count value={entryRunningCount ?? 'mixed'}
          onChange={event => setEntryRunningCount(event.target.value === 'mixed' ? null : Number(event.target.value))}>
          <option value="mixed">混合状态</option>
          {[0, 1, 2, 3, 5].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        {[0, 1, 8, 12, 20].map(value => <button key={value} className="quiet-button" data-count={value} onClick={() => setCount(value)}>{value} 位队员</button>)}
        {[0, 1, 2, 16, 48].map(value => <button key={`recipient-${value}`} className="quiet-button" data-recipient-count={value} onClick={() => setRecipientCount(value)}>{value} 位投递对象</button>)}
        <button className="quiet-button" data-refresh onClick={() => setRevision(value => value + 1)}>模拟状态刷新</button>
        <button data-title-scenario onClick={() => setLongTitleScenario(true)}>长卡片标题验收</button>
        <output data-stopped-runs>{stoppedRuns.join(',')}</output>
        <button className="quiet-button" data-theme-toggle onClick={() => {
          const next = theme === 'day' ? 'night' : 'day'
          document.documentElement.dataset.theme = next
          setTheme(next)
        }}>{theme === 'day' ? '切换夜间主题' : '切换日间主题'}</button>
      </div>
    </aside>
    <AppHeader threadTitle={snapshot.thread.title} contextLabel="隔离验收" thread={snapshot} detailEntryHostRef={setEntryHost} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <MobileLayoutProvider value={selectionScenario?.mobile ?? false}>
      <ThreadWorkspace key={snapshot.thread.id} missionBoard={notificationFixtureEnabled ? <section className="mission-intro" data-mission-id="mission-rail" tabIndex={-1}>使命来源</section> : null} snapshot={snapshot} projectName="隔离验收" agents={agents.slice(0, snapshot.members.length)} busy={false} stopping={false}
        executionAutoOpen={selectionScenario?.autoOpen ?? true}
        onSend={async () => {
          if (!selectionScenario) return
          submittedMessages++
          return { threadMessageId: 'message-submitted', deliveryIds: ['delivery-submitted'], agentRunIds: [], addressedAgentIds: ['agent-1'] }
        }} onChangeLead={async () => {}} onTasksChanged={async () => {}} onResolveApproval={() => {}}
        onStop={() => {}} worldMapEnabled={false} inspectorVisible={open} detailEntryHost={entryHost}
        workspaceEntrySnapshotReady={selectionScenario?.ready ?? true}
        onCancelAgentRun={async run => { setStoppedRuns(current => [...current, run.id]) }}
        executionPlacement={placement} onExecutionPlacementChange={async value => {
          if (rejectNextPlacement) { rejectNextPlacement = false; throw new Error('位置保存失败（隔离验收）') }
          setPlacement(value)
          return value
        }}
        onOpenInspector={() => setOpen(true)} onCloseInspector={() => setOpen(false)}
        notificationFocus={notificationFocus}
        onNotificationFocusPresented={(requestId) => {
          presentedNotificationRequests.push(requestId)
          setNotificationFocus((current) => current?.requestId === requestId
            ? { ...current, active: false }
            : current)
        }}
        onVisibleNotificationSources={notificationFixtureEnabled ? (sources) => {
          latestVisibleNotificationSources = sources
          visibleNotificationSourceReports.push(sources)
        } : undefined} />
      </MobileLayoutProvider>
    </main>
  </div></FilePreviewProvider>
}
createRoot(document.getElementById('root')!).render(<ThreadClientProvider client={desktopThreadClient}><Fixture /></ThreadClientProvider>)
