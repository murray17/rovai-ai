import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentProfile, ThreadMessageView, ThreadOpenMessageCoverage, ThreadSnapshot } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { ThreadWorkspace } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import '../../../apps/desktop/src/renderer/src/styles.css'

// Closed Renderer fixture: no Core, SQLite, Skill Library, model, or daily bridge is started.
const now = '2026-09-30T10:00:00Z'
const threadId = 'rvcamp_01m3rs4y3gfjssw5nstbzbdx7g'
const agent: AgentProfile = { agentId: 'agent-fixture', displayName: '爱丽丝', avatarRef: null, accent: null,
  teamRole: '五号街卖花女', professionalResponsibilities: '', personalityTraits: [], workingPrinciples: '',
  growthTopic: '', defaultCapabilities: [], presence: 'present', runtimeConfiguration: null,
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder: 0, version: 1,
  createdAt: now, updatedAt: now, removedAt: null }
function message(id: string, sequence: number, authorType: ThreadMessageView['authorType'], body: string,
  replyToThreadMessageId: string | null = null): ThreadMessageView {
  return { id, sequence, authorType, authorId: authorType === 'agent' ? agent.agentId : 'local_user',
    timelineGlobalSequence: null, sourceAgentRunId: null, body, content: [{ kind: 'text', text: body }],
    attachments: [], quotes: [], addressMode: 'default', addressedAgentIds: [], replyToThreadMessageId,
    threadTurnId: null, presentation: null, createdAt: now, withdrawn: false, canWithdraw: false, version: 1 }
}
const longTitle = '请保留现有会话风格，补充左侧用户消息锚点，并确认长标题、首条回复、紧凑间距和窗口宽度变化时的呈现。'.repeat(3)
const firstReply = '第一条回复：保持原有的 Porcelain Day 与 Steel Night 视觉；每条用户消息对应一个短横线，悬浮才变长。'.repeat(5)
function messages(count: number, start = 1): ThreadMessageView[] {
  return Array.from({ length: count }, (_, offset) => {
    const n = start + offset
    const user = message(`user-${n}`, n * 3, 'user', n === 1 ? longTitle : `第 ${n} 个问题：确认阅读位置与会话交互。`)
    return n === start + count - 1 ? [user] : [user,
      message(`reply-${n}`, n * 3 + 1, 'agent', n === 1 ? firstReply : '已保留原有正文、附件和操作方式。', user.id),
      ...(n === 1 ? [message('second-reply', 5, 'agent', '第二条回复不应进入预览。', user.id)] : [])]
  }).flat()
}
const initial: ThreadSnapshot = { schemaVersion: 35, throughGlobalSequence: 1,
  thread: { id: threadId, title: '会话内消息锚点', activationState: 'active', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agent.agentId, membershipGeneration: 1,
    version: 1, createdAt: now, updatedAt: now },
  members: [{ agentId: agent.agentId, displayName: agent.displayName, avatarRef: null, teamRole: agent.teamRole,
    accent: '', membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
    isDefaultLead: true, version: 1 }],
  membershipReconciliations: [], tasks: [], messages: messages(12), messageDeliveries: [], turns: [], agentRuns: [],
  executionEvidence: [], agentRunFileChanges: [], agentRunImages: [], contextManifests: [], approvals: [], actions: [], timeline: [] }
let fullMessages = initial.messages
let watermark = 1
let previewFailure = false
const events = new Set<(event: unknown) => void>()
const emitChange = (indexChanged: boolean) => {
  watermark++
  for (const listener of events) listener({ method: 'thread.messages.changed', params: { threadId, indexChanged, throughGlobalSequence: watermark } })
}
const requests: string[] = []
const indexBodyMounted: boolean[] = []
const earlierCursors: number[] = []
Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: (listener: (event: unknown) => void) => { events.add(listener); return () => events.delete(listener) }, clipboard: { write: async () => {} },
  request: async (method: string, params?: { messageId: string }) => {
    requests.push(method)
    if (method === 'thread.messages.anchors') {
      indexBodyMounted.push(Boolean(document.querySelector('[data-message-id]')))
      const items = fullMessages.filter(message => message.authorType === 'user' && !message.withdrawn)
        .map(message => ({ messageId: message.id, sequence: message.sequence, title: message.body, messageVersion: message.version }))
      return { schemaVersion: 1, throughGlobalSequence: watermark, threadId, totalCount: items.length, items }
    }
    if (method === 'thread.messages.anchorPreview') {
      if (previewFailure) { previewFailure = false; throw new Error('fixture preview failure') }
      const reply = fullMessages.find(message => message.replyToThreadMessageId === params?.messageId)
      return { schemaVersion: 1, throughGlobalSequence: watermark, threadId, messageId: params?.messageId,
        sourceAvailable: true, firstReply: reply ? { messageId: reply.id, sequence: reply.sequence, summary: reply.body, messageVersion: reply.version } : null }
    }
    if (method === 'thread.messages.around') {
      const index = fullMessages.findIndex(message => message.id === params?.messageId)
      return { schemaVersion: 1, throughGlobalSequence: watermark, threadId, anchorMessageId: params?.messageId,
        sourceAvailable: index >= 0, messages: fullMessages.slice(Math.max(0, index - 20), index + 21),
        nextMessageSequence: fullMessages[index + 21]?.sequence ?? null }
    }
    if (method === 'skills.list'  || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.pendingInputs.get') return { threadId, executionActive: false, items: [], editSession: null, submissionOutcomes: [] }
    throw new Error(`Unexpected anchor fixture request: ${method}`)
  }
} })
let updateSnapshot: React.Dispatch<React.SetStateAction<ThreadSnapshot>>
let updateWidth: React.Dispatch<React.SetStateAction<number | undefined>>
let updateHistory: React.Dispatch<React.SetStateAction<ThreadOpenMessageCoverage | null>>
let updateBodyReady: React.Dispatch<React.SetStateAction<boolean>>
function Fixture(): React.JSX.Element {
  const [bodyReady, setBodyReady] = useState(false)
  updateBodyReady = setBodyReady
  const [snapshot, setSnapshot] = useState(initial)
  const [paneWidth, setPaneWidth] = useState<number>()
  const [history, setHistory] = useState<ThreadOpenMessageCoverage | null>(null)
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  updateSnapshot = setSnapshot
  updateWidth = setPaneWidth
  updateHistory = setHistory
  return <div className="app-shell app-shell-camp">
    <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)' }}>Rovai AI</aside>
    <AppHeader threadTitle={snapshot.thread.title} contextLabel="rovai-ai" thread={snapshot}
      detailEntryHostRef={setEntryHost} onFocusApprovals={() => {}} />
    <main className="content task-content" style={{ width: paneWidth }}>
      <ThreadWorkspace workspaceEntrySnapshotReady={bodyReady} snapshot={snapshot} projectName="rovai-ai" agents={[agent]} busy={false} stopping={false}
        onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}}
        onResolveApproval={() => {}} worldMapEnabled={false} detailEntryHost={entryHost}
        messageHistory={history} onLoadEarlierMessages={async () => {
          const before = history?.oldestLoadedSequence ?? null
          if (before === null) return
          earlierCursors.push(before)
          const start = Math.max(1, before / 3 - 20)
          const page = fullMessages.filter(message => message.sequence >= start * 3 && message.sequence < before)
          setSnapshot(current => ({ ...current, messages: [...page, ...current.messages] }))
          setHistory(current => current && ({ ...current, oldestLoadedSequence: start * 3,
            loadedCount: current.loadedCount + page.length, hasEarlier: start > 1, complete: start === 1 }))
        }} />
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
const viewport = (): HTMLElement => document.querySelector('.camp-timeline')!
const rail = (): HTMLElement | null => document.querySelector('.conversation-anchor-items')
const target = (id: string): HTMLElement => document.querySelector(`[data-message-id="${id}"]`)!
const markers = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.conversation-anchor-item')]
const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 220))
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}
const point = (node: Element): { x: number; y: number } => {
  const rect = node.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}
Object.assign(window, { anchorsTest: {
  settle, longTitle, firstReply,
  bodyReady: async () => { updateBodyReady(true); await settle() },
  indexBodyMounted: () => indexBodyMounted,
  count: async (count: number, start = 1) => {
    fullMessages = messages(count + start - 1)
    earlierCursors.length = 0
    emitChange(true)
    updateHistory(start > 1 ? { loadedCount: count * 2 - 1, totalCount: (count + start - 1) * 2 - 1,
      omittedCount: (start - 1) * 2, complete: false, hasEarlier: true,
      oldestLoadedSequence: start * 3, newestLoadedSequence: (count + start - 1) * 3 } : null)
    updateSnapshot(current => ({ ...current, messages: messages(count, start) }))
    await settle()
  },
  width: async (width: number | undefined) => { updateWidth(width); await settle() },
  theme: async (theme: string) => { document.documentElement.dataset.theme = theme; await settle() },
  top: async () => { viewport().scrollTop = 0; await settle() },
  read: async (id: string) => {
    viewport().scrollTop += target(id).getBoundingClientRect().top - viewport().getBoundingClientRect().top - 18
    await settle()
  },
  firstMarker: () => point(markers()[0]),
  jump: async (id: string) => { markers().find(marker => marker.dataset.userMessageAnchor === id)!.click(); await settle() },
  failNextPreview: () => { previewFailure = true; emitChange(false) },
  earlierCursors: () => [...earlierCursors],
  upInput: async () => { viewport().dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -20 })); await settle(); await settle() },
  atLoader: async () => { const loader = document.querySelector('.camp-history-loader')!;
    viewport().scrollTop += loader.getBoundingClientRect().top - viewport().getBoundingClientRect().top; await settle() },
  gap: () => Boolean(document.querySelector('.camp-history-gap')),
  loadedIds: () => [...viewport().querySelectorAll<HTMLElement>('[data-message-id]')].map(node => node.dataset.messageId),
  loaderTop: () => document.querySelector('.camp-history-loader')?.getBoundingClientRect().top,
  targetTop: (id: string) => target(id).getBoundingClientRect().top,
  runtimeEvent: () => { for (const listener of events) listener({ method: 'agent.run.phase_changed', params: { threadId } }) },
  focus: () => markers().find(button => button.tabIndex === 0)!.focus({ preventScroll: true }),
  firstFocus: () => markers()[0].focus({ preventScroll: true }),
  railTop: async () => { rail()!.scrollTop = 0; await settle() },
  railPoint: () => point(rail()!),
  appendAgent: async () => {
    fullMessages = [...fullMessages, message('background-reply', 10000, 'agent', '后台队员回复。', fullMessages.at(-1)!.id)]
    emitChange(false)
    updateSnapshot(current => ({ ...current, messages: [...current.messages,
      message('background-reply', 10000, 'agent', '后台队员回复。', current.messages.at(-1)!.id)] }))
    await settle()
  },
  appendUser: async () => {
    fullMessages = [...fullMessages, message('new-user', 10001, 'user', '新增用户问题。')]
    emitChange(true)
    updateSnapshot(current => ({ ...current, messages: [...current.messages, message('new-user', 10001, 'user', '新增用户问题。')] }))
    await settle()
  },
  draft: (text: string) => {
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
    editor.focus(); document.execCommand('insertText', false, text)
  },
  loadEarlier: async () => { document.querySelector<HTMLButtonElement>('.camp-history-text-button')!.click(); await settle(); await settle() },
  reading: () => {
    const bounds = viewport().getBoundingClientRect()
    const user = [...viewport().querySelectorAll<HTMLElement>('.conversation-bubble.user')]
      .find(node => node.getBoundingClientRect().bottom > bounds.top && node.getBoundingClientRect().top < bounds.bottom)
    return { id: user?.dataset.messageId, top: user ? user.getBoundingClientRect().top - bounds.top : null }
  },
  actionOnly: async () => {
    const body = target('user-1').querySelector<HTMLElement>('.message-bubble')!
    viewport().scrollTop += body.getBoundingClientRect().bottom - viewport().getBoundingClientRect().top + 1
    await settle()
  },
  snapshot: () => ({
    markers: markers().map(button => ({ id: button.dataset.userMessageAnchor,
      current: button.getAttribute('data-visible'), label: button.getAttribute('aria-label'), tabIndex: button.tabIndex,
      width: parseFloat(getComputedStyle(button.firstElementChild!).width), color: getComputedStyle(button.firstElementChild!).backgroundColor })),
    height: rail()?.clientHeight ?? 0, railTop: rail()?.scrollTop ?? 0,
    scrollTop: viewport().scrollTop, paneWidth: viewport().parentElement!.clientWidth,
    gutter: getComputedStyle(viewport()).paddingLeft, draft: document.querySelector('[contenteditable="true"]')?.textContent,
    focusedMessage: (document.activeElement as HTMLElement)?.dataset.messageId,
    focusedAnchor: (document.activeElement as HTMLElement)?.dataset.userMessageAnchor,
    title: document.querySelector('.conversation-anchor-preview-title')?.textContent ?? null,
    reply: document.querySelector('.conversation-anchor-preview-copy')?.textContent ?? null,
    titleStyle: document.querySelector('.conversation-anchor-preview-title') ? {
      color: getComputedStyle(document.querySelector('.conversation-anchor-preview-title')!).color,
      whiteSpace: getComputedStyle(document.querySelector('.conversation-anchor-preview-title')!).whiteSpace,
      overflow: getComputedStyle(document.querySelector('.conversation-anchor-preview-title')!).textOverflow
    } : null,
    replyStyle: document.querySelector('.conversation-anchor-preview-copy') ? {
      color: getComputedStyle(document.querySelector('.conversation-anchor-preview-copy')!).color,
      lines: getComputedStyle(document.querySelector('.conversation-anchor-preview-copy')!).webkitLineClamp
    } : null,
    ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
    navArrows: document.querySelector('.conversation-anchor-nav')?.querySelectorAll('svg').length ?? 0,
    requests: [...requests]
  })
} })
