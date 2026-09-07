import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  AgentRunExecutionEvidenceView,
  AgentRunView,
  CoreEvent,
  CampMemberView,
  CanonicalRuntimeActivityView,
  SingleChatSnapshot,
  NotificationSingleChatSource,
  StoredCommandResult
} from '@contracts'
import { RunExecutionDisclosure } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { buildLiveExecutionProgress, liveRuntimeEventFromExecutionEvidence } from '../../../apps/desktop/src/renderer/src/ui-model'
import { SingleChatPanel } from '../../../apps/desktop/src/renderer/src/SingleChatPanel'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'rvcamp_01m1jkkpkzfvgraw1p4r9zfb7v'
const conversationId = 'single-chat-fixture-conversation'
const members: CampMemberView[] = [
  {
    agentId: 'agent_1', displayName: '爱丽丝', avatarRef: null, teamRole: '五号街卖花女', accent: '',
    membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
    isDefaultLead: true, version: 1
  },
  {
    agentId: 'agent_7', displayName: '雾切响子', avatarRef: null, teamRole: '超高校级的侦探', accent: '',
    membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 1,
    isDefaultLead: false, version: 1
  },
  {
    agentId: 'agent_8', displayName: '药师寺惠', avatarRef: null, teamRole: '机兵驾驶员', accent: '',
    membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 2,
    isDefaultLead: false, version: 1
  }
]

function canonical(
  operationId: string,
  title: string,
  sequence: number,
  phase: CanonicalRuntimeActivityView['phase'] = 'terminal',
  outcome: CanonicalRuntimeActivityView['outcome'] = 'succeeded'
): CanonicalRuntimeActivityView {
  return {
    operationId,
    activityDomain: 'shell',
    semanticKind: 'shell.execute',
    toolName: '终端',
    presentationHint: title,
    phase,
    outcome,
    credibility: 'runtime_structured',
    coverageLevel: 'fine_grained',
    sourceAuthority: 'runtime',
    sourceEvidenceIds: [`evidence-${operationId}`],
    classifierVersion: 'fixture-v1',
    firstEvidenceSequence: sequence,
    lastEvidenceSequence: sequence,
    revision: 1
  }
}

function narration(id: string, runId: string, sequence: number, body: string): AgentRunExecutionEvidenceView {
  return {
    id, agentRunId: runId, executionEpoch: 1, sequence, eventType: 'agent.text.delta', kind: 'narration',
    phase: 'updated', payload: { itemId: id, delta: body }, contentBlobId: null,
    contentByteCount: body.length, isTruncated: false, occurredAt: `2026-09-03T10:00:0${sequence}.000Z`, canonical: null
  }
}

function command(
  id: string,
  runId: string,
  sequence: number,
  body: string,
  running = false
): AgentRunExecutionEvidenceView {
  return {
    id: `evidence-${id}`,
    agentRunId: runId,
    executionEpoch: 1,
    sequence,
    eventType: running ? 'activity.started' : 'activity.completed',
    kind: 'command',
    phase: running ? 'started' : 'completed',
    payload: { item: { id, type: 'commandExecution', command: body, status: running ? 'inProgress' : 'completed', output: running ? '' : 'PRIVATE_RESULT_END'  } },
    contentBlobId: null,
    contentByteCount: body.length,
    isTruncated: false,
    occurredAt: `2026-09-03T10:00:0${sequence}.000Z`,
    canonical: canonical(id, body, sequence, running ? 'started' : 'terminal', running ? 'unknown' : 'succeeded')
  }
}

const terminalSnapshot: SingleChatSnapshot = {
  approvals: [],
  conversation: {
    id: conversationId, campId, agentId: 'agent_1', version: 4, status: 'active', lastMessageSequence: 3,
    lastAcceptedPublicBoundarySequence: 19, activeAgentRunId: null,
    createdAt: '2026-09-03T09:58:00.000Z', updatedAt: '2026-09-03T11:05:38.000Z', endedAt: null
  },
  messages: [
    {
      id: 'message-user-1', sequence: 1, authorType: 'user', authorId: 'local-user',
      body: '帮我核对这份实现，重点看输出路由和结束后的迟到事件。',
      attachments: [{
        id: 'private-attachment-1', displayName: 'single-chat-contract.md', kind: 'file',
        fileCount: 1, mediaType: 'text/markdown', byteSize: 18_432, previewKind: 'none',
        availability: 'available'
      }],
      agentRunId: 'run-complete',
      createdAt: '2026-09-03T10:00:00.000Z'
    },
    {
      id: 'message-agent-1', sequence: 2, authorType: 'agent', authorId: 'agent_1',
      body: '核心链路已经闭合：final 只进入当前单聊，旧 Run 的迟到事件不会进入后续 Conversation。',
      attachments: [], agentRunId: 'run-complete', createdAt: '2026-09-03T10:39:17.000Z'
    },
    {
      id: 'message-user-2', sequence: 3, authorType: 'user', authorId: 'local-user',
      body: '再检查一下取消后的显示。', attachments: [], agentRunId: 'run-cancelled',
      createdAt: '2026-09-03T11:00:00.000Z'
    }
  ],
  draft: { revision: 0, attachments: [], updatedAt: null },
  pendingInputs: { executionActive: false, items: [], editSession: null },
  agentRuns: [
    {
      id: 'run-complete', campTurnId: 'turn-run-complete', triggerConversationMessageId: 'message-user-1', status: 'succeeded', version: 3,
      executionEpoch: 1, cancelRequestedAt: null, lastErrorCode: null, createdAt: '2026-09-03T10:00:00.000Z',
      startedAt: '2026-09-03T10:00:00.000Z', endedAt: '2026-09-03T10:39:17.000Z',
      finalConversationMessageId: 'message-agent-1', executionEvidenceCount: 4
    },
    {
      id: 'run-cancelled', campTurnId: 'turn-run-cancelled', triggerConversationMessageId: 'message-user-2', status: 'cancelled', version: 3,
      executionEpoch: 1, cancelRequestedAt: '2026-09-03T11:05:38.000Z', lastErrorCode: null,
      createdAt: '2026-09-03T11:00:00.000Z', startedAt: '2026-09-03T11:00:00.000Z',
      endedAt: '2026-09-03T11:05:38.000Z', finalConversationMessageId: null, executionEvidenceCount: 1
    }
  ],
  executionEvidence: [
    narration('narration-complete', 'run-complete', 1, '我先检查领域身份和 terminal route，再核对取消边界。'),
    command('read-contract', 'run-complete', 2, 'rg -n "response_delivery" crates/rovai-core/src'),
    command('run-tests', 'run-complete', 3, 'cargo test -p rovai-core single_chat::tests'),
    command('check-ui', 'run-complete', 4, 'pnpm vitest run SingleChatPanel.test.ts'),
    narration('narration-cancelled', 'run-cancelled', 1, '正在核对取消后的状态投影。')
  ]
}

function runningSnapshot(): SingleChatSnapshot {
  return {
    ...terminalSnapshot,
    conversation: {
      ...terminalSnapshot.conversation,
      version: 5,
      lastMessageSequence: 4,
      activeAgentRunId: 'run-running',
      updatedAt: '2026-09-03T12:00:00.000Z'
    },
    messages: [...terminalSnapshot.messages, {
      id: 'message-user-3', sequence: 4, authorType: 'user', authorId: 'local-user',
      body: '最后检查一下正在执行时的展示。', attachments: [], agentRunId: 'run-running',
      createdAt: '2026-09-03T12:00:00.000Z'
    }],
    agentRuns: [...terminalSnapshot.agentRuns, {
      id: 'run-running', campTurnId: 'turn-run-running', triggerConversationMessageId: 'message-user-3', status: 'running', version: 2,
      executionEpoch: 1, cancelRequestedAt: null, lastErrorCode: null, createdAt: '2026-09-03T12:00:00.000Z',
      startedAt: '2026-09-03T12:00:00.000Z', endedAt: null, finalConversationMessageId: null,
      executionEvidenceCount: 2
    }],
    pendingInputs: { ...terminalSnapshot.pendingInputs, executionActive: true },
    executionEvidence: [...terminalSnapshot.executionEvidence,
      narration('narration-running', 'run-running', 1, '我正在检查双主题、窄窗口和键盘焦点。'),
      command('visual-check', 'run-running', 2, 'pnpm run accept:single-chat-ui -- --theme night --viewport 1040x700 --check-keyboard-focus', true)]
  }
}

type Phase = 'terminal' | 'queued' | 'thinking' | 'narration' | 'running' | 'returned' | 'continuation' | 'complete' | 'waiting' | 'failed'
const eventListeners = new Set<(event: CoreEvent) => void>()
let phaseListener: ((phase: Phase) => void) | null = null
let currentSnapshot = terminalSnapshot
let releaseSend: (() => void) | null = null
let sendHeld = false
let rejectSend = false
let resultAttempts = 0
const requests: Array<{ method: string; params: unknown }> = []

function setMode(phase: Phase, notify = true): void {
  if (phase === 'terminal') currentSnapshot = terminalSnapshot
  else {
    const next = runningSnapshot()
    const run = next.agentRuns.at(-1)!
    const complete = phase === 'complete' || phase === 'failed'
    run.status = phase === 'queued' ? 'queued' : phase === 'waiting' ? 'waiting' : complete
      ? phase === 'complete' ? 'succeeded' : 'failed' : 'running'
    run.startedAt = phase === 'queued' ? null : run.startedAt
    run.endedAt = complete ? '2026-09-03T12:00:26.000Z' : null
    next.conversation.activeAgentRunId = complete ? null : run.id
    next.pendingInputs.executionActive = !complete
    const items: AgentRunExecutionEvidenceView[] = []
    if (!['queued', 'thinking'].includes(phase)) {
      items.push(narration('narration-running', run.id, 1, '我正在检查双主题、窄窗口和键盘焦点。'))
    }
    if (!['queued', 'thinking', 'narration'].includes(phase)) {
      const tool = command('visual-check', run.id, 2, 'pnpm run accept:single-chat-ui -- --theme night --viewport 1040x700 --check-keyboard-focus', phase === 'running')
      if (phase !== 'running') tool.isTruncated = true
      if (phase === 'waiting') {
        tool.canonical = null
        tool.eventType = 'runtime.action'
        tool.kind = 'step'
        tool.phase = 'updated'
        tool.isTruncated = false
        tool.payload = { toolCallId: 'visual-check', kind: 'execute', title: '验证命令等待授权', status: 'waiting_approval' }
      }
      items.push(tool)
    }
    if (['continuation', 'complete'].includes(phase)) {
      items.push(narration('narration-boundary', run.id, 3, '工具检查已通过，我正在整理最终结论。'))
    }
    run.executionEvidenceCount = items.length
    next.executionEvidence = [...terminalSnapshot.executionEvidence, ...items]
    if (phase === 'complete') {
      run.finalConversationMessageId = 'final-running'
      next.messages.push({
        id: 'final-running', sequence: 5, authorType: 'agent', authorId: 'agent_1',
        body: '七个阶段检查完成，单聊结果只保留在这段私有对话中。', attachments: [], agentRunId: run.id,
        createdAt: run.endedAt!
      })
    }
    currentSnapshot = next
  }
  phaseListener?.(phase)
  if (notify) emitChange()
}

function emitChange(): void {
  for (const listener of eventListeners) listener({
    method: 'single_chat.changed', params: { campId, conversationId, reason: 'run_updated' }
  })
}

function PublicExecutionFixture({ phase }: { phase: Phase }): React.JSX.Element {
  const status = phase === 'complete' || phase === 'terminal' ? 'succeeded'
    : phase === 'failed' ? 'failed' : phase === 'waiting' ? 'waiting'
      : phase === 'queued' ? 'queued' : 'running'
  const run: AgentRunView = {
    id: 'public-run', campTurnId: 'public-turn', conversationId: 'public-conversation', agentId: 'public-agent',
    taskId: null, responsibilityKey: 'direct:public-agent', responsibilityGeneration: 0,
    purpose: '检查公共项目类型', completionRole: 'required', status, waitReason: null,
    cancelRequestedAt: null, cancelReasonCode: null, cancelAcknowledgedAt: null, executionEpoch: 1,
    terminalResolutionSource: null, terminalReasonCode: null, failure: null, runtimeModel: null,
    permissionSemantics: 'runtime_managed_v2', invocationKind: 'direct', triggerDeliveryGeneration: 0,
    a2aParentAgentRunId: null, a2aRootAgentRunId: null, a2aDepth: 0, executionEvidenceCount: 0,
    hasUnsettledExternalEffects: false, workspace: { path: '/fixture-public' },
    startingGitObservation: null, endingGitObservation: null, version: 1,
    createdAt: '2026-09-03T12:00:00.000Z', startedAt: '2026-09-03T12:00:00.000Z',
    endedAt: status === 'succeeded' || status === 'failed' ? '2026-09-03T12:00:26.000Z' : null,
    updatedAt: '2026-09-03T12:00:26.000Z'
  }
  const events: AgentRunExecutionEvidenceView[] = []
  if (!['queued', 'thinking'].includes(phase)) events.push(narration('public-narration', run.id, 1, '正在核对公共项目的类型。'))
  if (!['queued', 'thinking', 'narration'].includes(phase)) {
    const tool = command('public-command', run.id, 2, 'pnpm typecheck', phase === 'running')
    tool.payload = { item: { id: 'public-command', type: 'commandExecution', command: 'pnpm typecheck',
      status: phase === 'running' ? 'inProgress' : 'completed', output: 'PUBLIC_TYPES_OK' } }
    events.push(tool)
  }
  if (['continuation', 'complete'].includes(phase)) events.push(narration('public-boundary', run.id, 3, '正在整理类型检查结论。'))
  return <section className="public-execution-fixture" style={{ width: 440, margin: '36px 24px', padding: 16 }}>
    <p style={{ color: 'var(--muted)', fontSize: 12 }}>执行台 · 独立合成公共任务</p>
    <RunExecutionDisclosure run={run} campId={campId} focused
      progress={buildLiveExecutionProgress(events.map(liveRuntimeEventFromExecutionEvidence), run.id)} />
  </section>
}

Object.assign(window, {
  rovai: {
    platform: 'darwin',
    onEvent: (listener: (event: CoreEvent) => void) => {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
    singleChatAttachments: {
      prepare: async () => currentSnapshot,
      preparePending: async () => currentSnapshot,
      remove: async () => currentSnapshot
    },
    request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      requests.push({ method, params })
      if (method === 'singleChat.list') return [currentSnapshot.conversation]
      if (method === 'singleChat.get') return currentSnapshot
      if (method === 'singleChat.open') return {
        status: 'applied', code: 'single_chat.opened',
        payload: { conversationId, conversationVersion: currentSnapshot.conversation.version, created: false }
      } satisfies StoredCommandResult
      if (method === 'agentRunEvidence.getContent') {
        resultAttempts += 1
        if (resultAttempts === 1) throw new Error('合成结果读取失败')
        return { payload: { item: { id: 'visual-check', type: 'commandExecution',
          command: 'pnpm run accept:single-chat-ui -- --theme night --viewport 1040x700 --check-keyboard-focus', status: 'completed',
          output: Array.from({ length: 100 }, (_, index) => `private output ${index}`).join('\n') + '\nPRIVATE_RESULT_END' } } }
      }
      if (method === 'singleChat.send') {
        if (sendHeld) await new Promise<void>((resolve) => { releaseSend = resolve })
        if (rejectSend) {
          rejectSend = false
          return { status: 'rejected', code: 'fixture.send_rejected', payload: {} }
        }
        setMode('queued', false)
        return {
        status: 'accepted', code: 'single_chat.reply_queued', payload: {
          conversationId,
          conversationVersion: currentSnapshot.conversation.version + 1,
          conversationMessageId: 'message-keyboard-fixture',
          campTurnId: 'turn-keyboard-fixture',
          agentRunId: 'run-keyboard-fixture'
        }
      } satisfies StoredCommandResult
      }
      if (method === 'agentRuns.cancel') {
        const running = currentSnapshot.agentRuns.find((run) => run.id === 'run-running')
        currentSnapshot = {
          ...currentSnapshot,
          conversation: { ...currentSnapshot.conversation, activeAgentRunId: null },
          agentRuns: currentSnapshot.agentRuns.map((run) => run.id === 'run-running'
            ? { ...run, status: 'cancelled', version: run.version + 1, cancelRequestedAt: '2026-09-03T12:03:12.000Z', endedAt: '2026-09-03T12:03:12.000Z' }
            : run),
          executionEvidence: currentSnapshot.executionEvidence
        }
        if (!running) throw new Error('Fixture running Run is missing')
        return { status: 'applied', code: 'agent_run.cancelled', payload: {} } satisfies StoredCommandResult
      }
      if (method === 'singleChat.end') return {
        status: 'applied', code: 'single_chat.ended', payload: { conversationId }
      } satisfies StoredCommandResult
      throw new Error(`Unexpected Single Chat fixture request: ${method}`)
    }
  }
})

let locateNotification: (conversation: string) => void
const notificationPresentations: number[] = []
let notificationRequest = 0

function Fixture(): React.JSX.Element {
  const [entryHost, setEntryHost] = useState<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(true)
  const [phase, setPhase] = useState<Phase>('terminal')
  const [notificationTarget, setNotificationTarget] = useState<(NotificationSingleChatSource & { requestId: number }) | null>(null)
  locateNotification = conversation => {
    setVisible(true)
    setNotificationTarget({ conversationId: conversation, agentId: 'agent_1', agentDisplayName: '爱丽丝',
      agentRunId: 'run-complete', requestId: ++notificationRequest })
  }
  useEffect(() => {
    phaseListener = setPhase
    return () => { phaseListener = null }
  }, [])
  return <div className="single-chat-fixture">
    <header className="single-chat-fixture-header">
      <div className="single-chat-fixture-title"><span>rovai-ai</span><strong>单聊样式验收</strong></div>
      <div className="single-chat-fixture-entries" ref={setEntryHost} />
    </header>
    <main className="single-chat-fixture-stage">
      <PublicExecutionFixture phase={phase} />
      <SingleChatPanel
        target={notificationTarget}
        notificationFocus={notificationTarget ? { requestId: notificationTarget.requestId,
          kind: 'single_chat', conversationId: notificationTarget.conversationId, agentRunId: notificationTarget.agentRunId,
          campTurnId: 'turn-run-complete', active: true } : null}
        onNotificationFocusPresented={requestId => { if (!notificationPresentations.includes(requestId)) notificationPresentations.push(requestId) }}
        campId={campId}
        members={members}
        entryHost={entryHost}
        visible={visible}
        onOpen={() => setVisible(true)}
        onClose={() => setVisible(false)}
      />
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<Fixture />)

Object.assign(window, {
  singleChatTest: {
    notification: (conversation: string) => locateNotification(conversation),
    settle: async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    },
    setMode,
    holdSend: (reject = false) => { sendHeld = true; rejectSend = reject },
    releaseSend: () => { sendHeld = false; releaseSend?.(); releaseSend = null },
    state: () => {
      const panel = document.querySelector<HTMLElement>('.single-chat-popover')
      const final = document.querySelector<HTMLElement>('.single-chat-final')
      const dialog = document.querySelector<HTMLElement>('.app-dialog')
      const userMessage = document.querySelector<HTMLElement>('.single-chat-user-message')
      const agentResponse = document.querySelector<HTMLElement>('.single-chat-agent-response')
      const liveExecution = document.querySelector<HTMLElement>('.single-chat-run-history.is-live .single-chat-execution-content')
      const composer = document.querySelector<HTMLElement>('.single-chat-composer .composer-box')
      const composerTextarea = document.querySelector<HTMLTextAreaElement>('.single-chat-composer textarea')
      const attachmentButton = document.querySelector<HTMLElement>('.single-chat-composer .composer-attachment-button')
      const composerActions = document.querySelector<HTMLElement>('.single-chat-composer .composer-actions')
      const rect = panel?.getBoundingClientRect()
      return {
        body: document.body.textContent ?? '',
        liveText: document.querySelector('.single-chat-run-history.is-live')?.textContent ?? '',
        sendFeedback: document.querySelector('.single-chat-send-feedback')?.textContent ?? '',
        liveSummaryVisible: Boolean(document.querySelector('.single-chat-run-history.is-live > summary')?.getBoundingClientRect().height),
        liveGroupLabel: document.querySelector('.single-chat-run-history.is-live .tool-group-summary')?.textContent ?? '',
        publicText: document.querySelector('.public-execution-fixture')?.textContent ?? '',
        publicOpen: document.querySelector<HTMLDetailsElement>('.public-execution-fixture .execution-disclosure')?.open ?? null,
        resultRequests: requests.filter((request) => request.method === 'agentRunEvidence.getContent').length,
        panel: rect?.toJSON() ?? null,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        triggerAvatars: document.querySelectorAll('.single-chat-target-trigger .member-avatar').length,
        transcriptAvatars: document.querySelectorAll('.single-chat-transcript .member-avatar').length,
        optionAvatars: document.querySelectorAll('.single-chat-target-option .member-avatar').length,
        terminalOpen: document.querySelector<HTMLDetailsElement>('.single-chat-run-history.is-terminal')?.open ?? null,
        liveOpen: document.querySelector<HTMLDetailsElement>('.single-chat-run-history.is-live')?.open ?? null,
        userMessage: userMessage?.getBoundingClientRect().toJSON() ?? null,
        agentResponse: agentResponse?.getBoundingClientRect().toJSON() ?? null,
        finalVisible: Boolean(final && final.getBoundingClientRect().height > 0),
        groupLabel: document.querySelector('.single-chat-run-history .tool-group-summary')?.textContent?.trim() ?? '',
        dialog: dialog?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        checkbox: Boolean(dialog?.querySelector('input[type="checkbox"]')),
        endButtons: [...(dialog?.querySelectorAll('button') ?? [])].map((button) => button.textContent?.trim()),
        composerDisabled: document.querySelector<HTMLTextAreaElement>('.single-chat-composer textarea')?.disabled ?? null,
        composerValue: document.querySelector<HTMLTextAreaElement>('.single-chat-composer textarea')?.value ?? null,
        stopVisible: Boolean(document.querySelector('.single-chat-composer .composer-primary-action.is-stop')),
        attachmentButton: Boolean(document.querySelector('.single-chat-composer .composer-attachment-button')),
        composerHint: document.querySelector('.single-chat-composer .composer-hint')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        messageAttachments: document.querySelectorAll('.single-chat-message-attachments .attachment-card').length,
        agentBackground: agentResponse ? getComputedStyle(agentResponse).backgroundColor : null,
        liveExecutionBackground: liveExecution ? getComputedStyle(liveExecution).backgroundColor : null,
        liveExecutionBorderWidth: liveExecution ? getComputedStyle(liveExecution).borderTopWidth : null,
        composer: composer?.getBoundingClientRect().toJSON() ?? null,
        composerResize: composerTextarea ? getComputedStyle(composerTextarea).resize : null,
        attachmentButtonBounds: attachmentButton?.getBoundingClientRect().toJSON() ?? null,
        composerActionsBounds: composerActions?.getBoundingClientRect().toJSON() ?? null,
        sendRequests: requests.filter((request) => request.method === 'singleChat.send').length,
        cancelRequests: requests.filter((request) => request.method === 'agentRuns.cancel').length,
        background: panel ? getComputedStyle(panel).backgroundColor : null,
        notificationPresentations,
        notificationFocusedRun: (document.activeElement as HTMLElement)?.dataset.singleChatRunId,
        openRequests: requests.filter(request => request.method === 'singleChat.open').length,
        notificationGets: requests.filter(request => request.method === 'singleChat.get').map(request => request.params)
      }
    }
  }
})
