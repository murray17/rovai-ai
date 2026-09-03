import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  AgentRunExecutionEvidenceView,
  CampMemberView,
  CanonicalRuntimeActivityView,
  SingleChatSnapshot,
  StoredCommandResult
} from '@contracts'
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
    payload: { item: { id, type: 'commandExecution', command: body, status: running ? 'inProgress' : 'completed' } },
    contentBlobId: null,
    contentByteCount: body.length,
    isTruncated: false,
    occurredAt: `2026-09-03T10:00:0${sequence}.000Z`,
    canonical: canonical(id, body, sequence, running ? 'started' : 'terminal', running ? 'unknown' : 'succeeded')
  }
}

const terminalSnapshot: SingleChatSnapshot = {
  conversation: {
    id: conversationId, campId, agentId: 'agent_1', version: 4, status: 'active', lastMessageSequence: 3,
    lastAcceptedPublicBoundarySequence: 19, activeAgentRunId: null,
    createdAt: '2026-09-03T09:58:00.000Z', updatedAt: '2026-09-03T11:05:38.000Z', endedAt: null
  },
  messages: [
    {
      id: 'message-user-1', sequence: 1, authorType: 'user', authorId: 'local-user',
      body: '帮我核对这份实现，重点看输出路由和结束后的迟到事件。', agentRunId: 'run-complete',
      createdAt: '2026-09-03T10:00:00.000Z'
    },
    {
      id: 'message-agent-1', sequence: 2, authorType: 'agent', authorId: 'agent_1',
      body: '核心链路已经闭合：final 只进入当前单聊，旧 Run 的迟到事件不会进入后续 Conversation。',
      agentRunId: 'run-complete', createdAt: '2026-09-03T10:39:17.000Z'
    },
    {
      id: 'message-user-2', sequence: 3, authorType: 'user', authorId: 'local-user',
      body: '再检查一下取消后的显示。', agentRunId: 'run-cancelled', createdAt: '2026-09-03T11:00:00.000Z'
    }
  ],
  agentRuns: [
    {
      id: 'run-complete', triggerConversationMessageId: 'message-user-1', status: 'succeeded', version: 3,
      executionEpoch: 1, cancelRequestedAt: null, lastErrorCode: null, createdAt: '2026-09-03T10:00:00.000Z',
      startedAt: '2026-09-03T10:00:00.000Z', endedAt: '2026-09-03T10:39:17.000Z',
      finalConversationMessageId: 'message-agent-1', executionEvidenceCount: 4
    },
    {
      id: 'run-cancelled', triggerConversationMessageId: 'message-user-2', status: 'cancelled', version: 3,
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
      body: '最后检查一下正在执行时的展示。', agentRunId: 'run-running', createdAt: '2026-09-03T12:00:00.000Z'
    }],
    agentRuns: [...terminalSnapshot.agentRuns, {
      id: 'run-running', triggerConversationMessageId: 'message-user-3', status: 'running', version: 2,
      executionEpoch: 1, cancelRequestedAt: null, lastErrorCode: null, createdAt: '2026-09-03T12:00:00.000Z',
      startedAt: '2026-09-03T12:00:00.000Z', endedAt: null, finalConversationMessageId: null,
      executionEvidenceCount: 2
    }],
    executionEvidence: [...terminalSnapshot.executionEvidence,
      narration('narration-running', 'run-running', 1, '我正在检查双主题、窄窗口和键盘焦点。'),
      command('visual-check', 'run-running', 2, 'pnpm run accept:single-chat-ui', true)]
  }
}

let currentSnapshot = terminalSnapshot
const requests: Array<{ method: string; params: unknown }> = []

Object.assign(window, {
  rovai: {
    platform: 'darwin',
    onEvent: () => () => undefined,
    request: async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
      requests.push({ method, params })
      if (method === 'singleChat.list') return [currentSnapshot.conversation]
      if (method === 'singleChat.get') return currentSnapshot
      if (method === 'singleChat.open') return {
        status: 'applied', code: 'single_chat.opened',
        payload: { conversationId, conversationVersion: currentSnapshot.conversation.version, created: false }
      } satisfies StoredCommandResult
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

function Fixture(): React.JSX.Element {
  const [entryHost, setEntryHost] = useState<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(true)
  return <div className="single-chat-fixture">
    <header className="single-chat-fixture-header">
      <div className="single-chat-fixture-title"><span>rovai-ai</span><strong>单聊样式验收</strong></div>
      <div className="single-chat-fixture-entries" ref={setEntryHost} />
    </header>
    <main className="single-chat-fixture-stage">
      <div className="single-chat-fixture-watermark">Camp 公共会话保持在背景中</div>
      <SingleChatPanel
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
    settle: async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    },
    setMode: (mode: 'terminal' | 'running') => {
      currentSnapshot = mode === 'running' ? runningSnapshot() : terminalSnapshot
    },
    state: () => {
      const panel = document.querySelector<HTMLElement>('.single-chat-popover')
      const final = document.querySelector<HTMLElement>('.single-chat-final')
      const dialog = document.querySelector<HTMLElement>('.app-dialog')
      const userMessage = document.querySelector<HTMLElement>('.single-chat-user-message')
      const agentResponse = document.querySelector<HTMLElement>('.single-chat-agent-response')
      const rect = panel?.getBoundingClientRect()
      return {
        body: document.body.textContent ?? '',
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
        groupLabel: document.querySelector('.single-chat-tool-group > summary')?.textContent?.trim() ?? '',
        dialog: dialog?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        checkbox: Boolean(dialog?.querySelector('input[type="checkbox"]')),
        endButtons: [...(dialog?.querySelectorAll('button') ?? [])].map((button) => button.textContent?.trim()),
        composerDisabled: document.querySelector<HTMLTextAreaElement>('.single-chat-composer textarea')?.disabled ?? null,
        stopVisible: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === '停止'),
        cancelRequests: requests.filter((request) => request.method === 'agentRuns.cancel').length,
        background: panel ? getComputedStyle(panel).backgroundColor : null
      }
    }
  }
})
