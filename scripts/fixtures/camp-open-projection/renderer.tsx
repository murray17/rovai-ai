import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  AgentProfile,
  CampComposerDraftView,
  CampOpenMessageCoverage,
  CampOpenProjection,
  NavigationCampItem,
  NavigationSnapshot
} from '@contracts'
import { AppHeader, campOpenProjectionAsSnapshot } from '../../../apps/desktop/src/renderer/src/App'
import { CampWorkspace, type CampInspectorTab } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { CampNavigation } from '../../../apps/desktop/src/renderer/src/CampNavigation'
import '../../../apps/desktop/src/renderer/src/styles.css'

const now = '2026-08-31T00:00:00Z'
const campId = 'rvcamp_01m0wzxbb8e1ht984tsbjmysfe'
const attachmentReviewMode = new URLSearchParams(window.location.search).get('review') === 'attachments'
const createAgent = (
  agentId: string,
  displayName: string,
  teamRole: string,
  memberOrder: number,
  accent: string
): AgentProfile => ({
  agentId, displayName, avatarRef: null, accent, teamRole,
  professionalResponsibilities: '在隔离验收 Camp 中提供稳定的界面数据。', personalityTraits: [],
  workingPrinciples: '', growthTopic: '', defaultCapabilities: [], presence: 'present',
  runtimeConfiguration: { adapterKind: 'opencode-cli', model: { mode: 'runtime_default' },
    permissions: { adapterKind: 'opencode-cli', schemaVersion: 1, values: {} } },
  runtimeReadiness: { status: 'ready', blockers: [] }, memberOrder, version: 1,
  createdAt: now, updatedAt: now, removedAt: null
})
const agents = [
  createAgent('agent-1', '爱丽丝', '五号街卖花女', 0, '#a65f4a'),
  createAgent('agent-2', '奥黛丽', '正义小姐 · 观众途径', 1, '#39777a'),
  createAgent('agent-3', '雾切响子', '超高校级的侦探', 2, '#74628f'),
  createAgent('agent-4', '药师寺惠', '机兵驾驶员 · 咲良高校学生', 3, '#9a6a32')
]
const agent = agents[0]
const messages: CampOpenProjection['messages'] = Array.from({ length: 61 }, (_, index) => ({
  id: `message-${index + 1}`, sequence: index + 1, timelineGlobalSequence: null,
  authorType: index % 2 === 0 ? 'user' : 'agent', authorId: index % 2 === 0 ? 'local_user' : agent.agentId,
  sourceAgentRunId: null, body: `第 ${index + 1} 条消息：保留较早历史和当前阅读位置。`,
  content: [{ kind: 'text', text: `第 ${index + 1} 条消息：保留较早历史和当前阅读位置。` }],
  attachments: [], addressMode: 'default', addressedAgentIds: [agent.agentId],
  replyToCampMessageId: null, campTurnId: null, presentation: null,
  createdAt: new Date(Date.parse(now) + index * 60_000).toISOString()
}))
const coverage = (count: number) => ({ loadedCount: count, totalCount: count, omittedCount: 0, complete: true })
const projection = (count: number): CampOpenProjection => ({
  schemaVersion: 6, throughGlobalSequence: count,
  camp: { id: campId, title: '仅业务投影的会话刷新', activationState: 'active', projectBindingKind: 'directory',
    projectPath: '/fixture/workspace', defaultLeadAgentId: agent.agentId, membershipGeneration: 1, version: 1,
    createdAt: now, updatedAt: now },
  members: agents.map((member) => ({
    agentId: member.agentId, displayName: member.displayName, avatarRef: null, teamRole: member.teamRole,
    accent: member.accent ?? '', membershipStatus: 'active' as const, leaveRequestedAt: null,
    profilePresence: 'present' as const, memberOrder: member.memberOrder,
    isDefaultLead: member.agentId === agent.agentId, version: 1
  })),
  membershipReconciliations: [],
  tasks: [{ taskId: 'task-1', campId, title: '检查业务投影', description: '任务仍然直接来自业务数据。',
    acceptanceCriteria: ['不读取审计事件'], status: 'blocked', assigneeAgentId: agent.agentId,
    blockedReason: '业务状态原因', completionSummary: null, cancelReason: null,
    createdByType: 'user', createdById: 'local_user', sourceAgentRunId: null,
    closedByType: null, closedById: null, closedByAgentRunId: null,
    version: 1, createdAt: messages[23].createdAt, updatedAt: messages[23].createdAt, closedAt: null, availableActions: ['update'] }],
  messages: messages.slice(count - 20, count), messageDeliveries: [],
  turns: [{ id: 'stopped-turn', triggerType: 'camp_message', triggerId: 'message-24', status: 'cancelled',
    cancelRequestedAt: messages[23].createdAt, aggregateReasonCode: null, version: 1,
    createdAt: now, updatedAt: messages[23].createdAt, endedAt: messages[23].createdAt,
    executionBudget: { schemaVersion: 1, acceptedAt: now, deadlineAt: messages[60].createdAt,
      elapsedSeconds: 3600, maxAgentRunResponsibilities: 32, maxAcceptedA2a: 16,
      allocatedAgentRunResponsibilities: 1, acceptedA2a: 0, exhaustedAt: null, exhaustionReason: null,
      exhaustionCommandId: null } }],
  agentRuns: [], executionEvidence: [], approvals: [],
  agentRunFileChanges: [{ schemaVersion: 2, agentRunId: 'completed-run', executionEpoch: 1,
    files: [{ evidenceFileId: 'file-1', path: 'src/fixture.ts', changeKind: 'update',
      presentationKind: 'operation_history', operationCount: 1 }],
    fileCount: 1, operationCount: 1, completedAt: messages[23].createdAt }],
  coverage: { tasks: coverage(1), messages: { ...coverage(count), loadedCount: 20, omittedCount: count - 20,
    complete: false, hasEarlier: true, oldestLoadedSequence: count - 19, newestLoadedSequence: count },
    messageDeliveries: coverage(0), turns: coverage(1), agentRuns: coverage(0), executionEvidence: coverage(0), approvals: coverage(0) }
})
// The reader has loaded an earlier page through the existing history API.
const earlier = { ...campOpenProjectionAsSnapshot(projection(60)),
  messages: messages.slice(0, 40).map(message => ({ ...message, timelineGlobalSequence: message.sequence })) }
let current = campOpenProjectionAsSnapshot(projection(60), earlier)
let updateSnapshot: (snapshot: typeof current) => void
let updateMessageHistory: (coverage: CampOpenMessageCoverage | null) => void
let closeTask: () => void
type FixtureImageResult = { displayName: string; mediaType: string; data: string }
const mockImageResult = (
  displayName: string,
  accent: string,
  secondary: string,
  label: string
): FixtureImageResult => ({
  displayName,
  mediaType: 'image/svg+xml',
  data: btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${accent}"/><stop offset="1" stop-color="${secondary}"/></linearGradient></defs>
    <rect width="1200" height="720" rx="42" fill="url(#g)"/>
    <rect x="76" y="74" width="1048" height="572" rx="28" fill="#f7f8f8" fill-opacity=".91"/>
    <circle cx="126" cy="121" r="10" fill="${accent}"/><circle cx="158" cy="121" r="10" fill="${secondary}"/><circle cx="190" cy="121" r="10" fill="#d3a45f"/>
    <rect x="116" y="184" width="236" height="390" rx="20" fill="${accent}" fill-opacity=".13"/>
    <rect x="392" y="184" width="672" height="74" rx="18" fill="${secondary}" fill-opacity=".16"/>
    <rect x="392" y="290" width="286" height="208" rx="22" fill="${accent}" fill-opacity=".28"/>
    <rect x="706" y="290" width="358" height="98" rx="20" fill="${secondary}" fill-opacity=".22"/>
    <rect x="706" y="412" width="358" height="86" rx="20" fill="#d3a45f" fill-opacity=".25"/>
    <text x="392" y="562" fill="#35434d" font-family="-apple-system,sans-serif" font-size="34" font-weight="700">${label}</text>
  </svg>`)
})
const reviewImages = [
  mockImageResult('会话布局参考.svg', '#526f88', '#9fb2bf', 'CAMP LAYOUT'),
  mockImageResult('附件密度参考.svg', '#39777a', '#8fbeb7', 'ATTACHMENT DENSITY'),
  mockImageResult('交付卡片参考.svg', '#a65f4a', '#d3a45f', 'DELIVERY CARDS')
]
let imageResult: FixtureImageResult = reviewImages[0]
let imageResultsById = new Map<string, FixtureImageResult>()
let draft: CampComposerDraftView = { campId, body: '', content: [], revision: 1, attachments: [],
  replyIntent: null, continuationIntent: null, updatedAt: now, expiresAt: null }

const attachmentFile = (id: string, displayName: string, mediaType: string, options: {
  previewKind?: 'image' | 'none'
  kind?: 'file' | 'directory'
  fileCount?: number
} = {}) => ({
  id, displayName, kind: options.kind ?? 'file', fileCount: options.fileCount ?? 1,
  mediaType, byteSize: id.length * 2048, previewKind: options.previewKind ?? 'none',
  runtimeProjectionState: 'available' as const
})

function installAttachmentSurfaceState(result: FixtureImageResult): void {
  const supplied = { ...result, displayName: result.displayName || '会话布局参考' }
  imageResult = supplied
  const imageVariants = [supplied, reviewImages[1], reviewImages[2]]
  imageResultsById = new Map([
    ['user-image-one', imageVariants[0]], ['user-image-two', imageVariants[1]], ['user-image-three', imageVariants[2]],
    ['agent-preview-one', imageVariants[2]], ['agent-preview-two', imageVariants[0]],
    ['agent-runtime-preview', imageVariants[1]],
    ['draft-image-one', imageVariants[0]], ['draft-image-two', imageVariants[1]], ['draft-image-three', imageVariants[2]]
  ])
  const userAttachments = [
    attachmentFile('user-report', '调研说明.pdf', 'application/pdf'),
    attachmentFile('user-image-one', '参考界面.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('user-sheet', '附件矩阵.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    attachmentFile('user-image-two', '布局标注.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('user-notes', '展示规则.md', 'text/markdown'),
    attachmentFile('user-json', 'icon-map.json', 'application/json'),
    attachmentFile('user-image-three', '交付样式.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('user-code', 'surface-spec.py', 'text/x-python'),
    attachmentFile('user-archive', '参考素材.zip', 'application/zip')
  ]
  const agentFiles = [
    attachmentFile('agent-web', 'rovai-file-surfaces.html', 'text/html'),
    attachmentFile('agent-code', 'file-icon-map.ts', 'text/typescript'),
    attachmentFile('agent-notes', 'implementation-notes.md', 'text/markdown'),
    attachmentFile('agent-pdf', 'attachment-spec.pdf', 'application/pdf'),
    attachmentFile('agent-word', 'copy-guide.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    attachmentFile('agent-sheet', 'attachment-matrix.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    attachmentFile('agent-slide', 'handoff-slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    attachmentFile('agent-image', 'corrupt-preview.webp', 'image/webp'),
    attachmentFile('agent-archive', 'design-export.zip', 'application/zip'),
    attachmentFile('agent-generic', 'handoff.asset', 'application/octet-stream')
  ]
  const agentImages = [
    attachmentFile('agent-preview-one', '交付预览一.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('agent-preview-two', '交付预览二.svg', 'image/svg+xml', { previewKind: 'image' })
  ]
  const composerFiles = [
    attachmentFile('draft-pdf', '文件展示参考.pdf', 'application/pdf'),
    attachmentFile('draft-image-one', '会话截图.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('draft-image-two', '布局参考.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('draft-folder', '参考素材', 'inode/directory', { kind: 'directory', fileCount: 12 }),
    attachmentFile('draft-notes', '交互记录.log', 'text/plain'),
    attachmentFile('draft-code', 'surface-spec.py', 'text/x-python'),
    attachmentFile('draft-image-three', '交付预览.svg', 'image/svg+xml', { previewKind: 'image' }),
    attachmentFile('draft-archive', '导出结果.zip', 'application/zip'),
    attachmentFile('draft-json', 'icon-map.json', 'application/json')
  ]
  const draftBody = '请按交互稿核对附件尺寸、顺序、图标和视觉层级。'
  draft = {
    ...draft,
    body: draftBody,
    content: [{ kind: 'text', text: draftBody }],
    revision: draft.revision + 1,
    attachments: composerFiles.map(({ runtimeProjectionState: _state, ...attachment }) => ({
      ...attachment, state: 'ready' as const, errorMessage: null, createdAt: now
    }))
  }
  current = {
    ...current,
    camp: { ...current.camp, title: '附件呈现验收 · 全量 Mock Camp' },
    tasks: [], turns: [], agentRuns: [], agentRunFileChanges: [], messageDeliveries: [],
    messages: [{
      ...messages[0], id: 'attachment-surface-user', sequence: 101, authorType: 'user', authorId: 'local_user',
      sourceAgentRunId: null,
      body: '短消息。',
      content: [{ kind: 'text', text: '短消息。' }],
      attachments: userAttachments
    }, {
      ...messages[1], id: 'attachment-surface-agent', sequence: 102, authorType: 'agent', authorId: agent.agentId,
      sourceAgentRunId: 'attachment-output-run',
      body: '已按交互稿整理：正文在前，图片单独成组，十类交付文件在下方使用两列布局。',
      content: [{ kind: 'text', text: '已按交互稿整理：正文在前，图片单独成组，十类交付文件在下方使用两列布局。' }],
      attachments: [agentFiles[0], ...agentImages, ...agentFiles.slice(1)]
    }],
    agentRunImages: [{
      agentRunId: 'attachment-output-run', executionEpoch: 1, createdAt: now,
      images: [{ id: 'agent-runtime-preview', displayName: imageVariants[1].displayName,
        mediaType: imageVariants[1].mediaType, byteSize: atob(imageVariants[1].data).length }]
    }]
  }
}

if (attachmentReviewMode) installAttachmentSurfaceState(reviewImages[0])

Object.assign(window, { rovai: {
  platform: 'darwin', onEvent: () => () => {},
  request: async (method: string, params?: {
    imageId?: string
    content?: CampComposerDraftView['content']
  }): Promise<unknown> => {
    if (method === 'skills.list' || method === 'skills.deliveryGroups.list') return []
    if (method === 'camp.composerDraft.get') return draft
    if (method === 'camp.composerDraft.save') {
      const content = params?.content ?? []
      draft = { ...draft, content, body: content.map(segment => segment.kind === 'text' ? segment.text : '').join(''),
        revision: draft.revision + 1 }
      return draft
    }
    if (method === 'agentRunImages.read') return imageResultsById.get(params?.imageId ?? '') ?? imageResult
    throw new Error(`Unexpected fixture API: ${method}`)
  },
  composerAttachments: { preview: async (attachmentId: string) => {
    const result = imageResultsById.get(attachmentId) ?? imageResult
    return { mediaType: result.mediaType,
      bytes: Uint8Array.from(atob(result.data), character => character.charCodeAt(0)) }
  } }
} })

const navigationCamp = (
  id: string,
  title: string,
  projectBindingKind: 'quick_chat' | 'directory',
  projectPath: string,
  marker: NavigationCampItem['marker'] = 'none'
): NavigationCampItem => ({
  id, title, activationState: 'active', projectBindingKind, projectPath,
  defaultLead: { agentId: agent.agentId, displayName: agent.displayName }, marker,
  lastActivityAt: now, lastActivityGlobalSequence: 102,
  latestCompletionGlobalSequence: marker === 'unread_completed' ? 102 : 0, version: 1
})
const activeNavigationCamp = navigationCamp(
  campId,
  attachmentReviewMode ? '附件呈现验收 · 全量 Mock Camp' : '仅业务投影的会话刷新',
  'directory',
  '/fixture/workspace'
)
const navigation: NavigationSnapshot = {
  schemaVersion: 3,
  throughGlobalSequence: 102,
  quickChat: {
    totalCount: 2,
    recentCamps: [
      navigationCamp('mock-quick-1', '设计讨论与视觉对照', 'quick_chat', '/fixture/quick-chat'),
      navigationCamp('mock-quick-2', '交互细节复核', 'quick_chat', '/fixture/quick-chat', 'unread_completed')
    ]
  },
  projects: [{
    projectKey: 'directory:/fixture/workspace', projectPath: '/fixture/workspace', name: 'rovai-ai',
    lastActivityAt: now, lastActivityGlobalSequence: 102, totalCount: 3,
    recentCamps: [
      activeNavigationCamp,
      navigationCamp('mock-project-2', 'Runtime 图片解码验证', 'directory', '/fixture/workspace'),
      navigationCamp('mock-project-3', 'Composer 附件键盘导航', 'directory', '/fixture/workspace')
    ]
  }]
}

function Fixture(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(current)
  const [messageHistory, setMessageHistory] = useState<CampOpenMessageCoverage | null>(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<CampInspectorTab>(attachmentReviewMode ? 'members' : 'tasks')
  const [entryHost, setEntryHost] = useState<HTMLElement | null>(null)
  updateSnapshot = setSnapshot
  updateMessageHistory = setMessageHistory
  closeTask = () => setOpen(false)
  return <div className="app-shell app-shell-camp">
    <CampNavigation view="camp" state="ready" navigation={navigation} activeCampId={campId}
      currentProjectKey="directory:/fixture/workspace" pendingMemoryCount={2}
      onNewConversation={() => {}} onMembers={() => {}} onMemory={() => {}} onSettings={() => {}}
      onOpenProject={() => {}} onCamp={() => {}} onRemoveProject={async () => {}}
      onRename={async () => {}} onDelete={async () => {}} onError={error => { throw error }} />
    <AppHeader campTitle={snapshot.camp.title}
      contextLabel={attachmentReviewMode ? 'Mock Camp · 无 Core / LLM' : '隔离验收'} camp={snapshot}
      detailEntryHostRef={setEntryHost} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <CampWorkspace snapshot={snapshot} projectName="rovai-ai" agents={agents} busy={false} stopping={false}
        messageHistory={messageHistory}
        onLoadEarlierMessages={async () => {
          current = { ...current, messages: [...current.messages, messages[60]] }
          setSnapshot(current)
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          current = { ...current, messages: [...messages.slice(0, 20), ...current.messages] }
          setSnapshot(current)
          setMessageHistory({ loadedCount: 61, totalCount: 61, omittedCount: 0, complete: true,
            oldestLoadedSequence: 1, newestLoadedSequence: 61, hasEarlier: false })
        }}
        onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}}
        onResolveApproval={() => {}} onStop={() => {}} worldMapEnabled={false} executionPlacement="bottom"
        inspectorVisible={open} inspectorTab={tab} detailEntryHost={entryHost}
        onInspectorTabChange={setTab}
        onOpenInspector={next => { setTab(next); setOpen(true) }} onCloseInspector={() => setOpen(false)} />
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
const element = (selector: string): HTMLElement => document.querySelector(selector)!
let anchor: HTMLElement | null = null
Object.assign(window, { campOpenTest: {
  settle: async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))) },
  openTask: () => element('.task-event-card').click(),
  closeTask: () => closeTask(),
  bookmark: () => {
    anchor = element('[data-message-id="message-25"]')
    anchor.scrollIntoView({ block: 'center' })
    element('.timeline-scroll').dispatchEvent(new Event('scroll'))
  },
  refresh: (append: boolean) => {
    current = campOpenProjectionAsSnapshot({ ...projection(append ? 61 : 60), throughGlobalSequence: append ? 101 : 100 }, current)
    updateSnapshot(current)
  },
  prepareHistoryLoad: () => {
    current = { ...current, messages: messages.slice(20, 60) }
    updateSnapshot(current)
    updateMessageHistory({ loadedCount: 40, totalCount: 61, omittedCount: 21, complete: false,
      oldestLoadedSequence: 21, newestLoadedSequence: 60, hasEarlier: true })
  },
  loadEarlier: async () => {
    element('.camp-history-text-button').click()
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
  },
  showImages: (result: { displayName: string; mediaType: string; data: string }, count = 1) => {
    imageResult = result
    imageResultsById.clear()
    const images = Array.from({ length: count }, (_, index) => ({ id: `image-${index}`, displayName: result.displayName,
      mediaType: result.mediaType, byteSize: atob(result.data).length }))
    current = { ...current, tasks: [], turns: [], agentRuns: [], agentRunFileChanges: [], messageDeliveries: [],
      // Two distinct Runs deliberately show identical bytes to compare the two presentation paths.
      messages: ['Tool 返回的图片', '通过 send 发送的图片'].map((body, index) => ({
        ...messages[index], id: `image-message-${index}`, authorType: 'agent', authorId: agent.agentId,
        sourceAgentRunId: index === 0 ? 'tool-run' : 'send-run', body, content: [{ kind: 'text', text: body }],
        attachments: index === 0 ? [] : images.map(image => ({ ...image, kind: 'file', fileCount: 1,
          previewKind: 'image', runtimeProjectionState: 'available' }))
      })),
      agentRunImages: [{ agentRunId: 'tool-run', executionEpoch: 1, createdAt: now, images }]
    }
    updateSnapshot(current)
  },
  showAttachmentSurfaces: (result: { displayName: string; mediaType: string; data: string }) => {
    installAttachmentSurfaceState(result)
    updateSnapshot(current)
  },
  setComposerText: (value: string) => {
    const editor = element('#camp-message')
    editor.focus()
    editor.textContent = value
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: value,
      inputType: 'insertText'
    }))
  },
  scrollAttachmentSurface: (surface: 'user' | 'agent') => {
    element(`[data-message-id="attachment-surface-${surface}"]`).scrollIntoView({ block: surface === 'agent' ? 'center' : 'start' })
  },
  browseComposerAttachments: (key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End') => {
    const strip = element('.composer-attachment-strip')
    strip.focus()
    strip.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    return strip.scrollLeft
  },
  wheelComposerAttachments: (deltaY: number) => {
    const strip = element('.composer-attachment-strip')
    strip.scrollLeft = 0
    const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
    strip.dispatchEvent(event)
    return { scrollLeft: strip.scrollLeft, defaultPrevented: event.defaultPrevented }
  },
  setAgentOutputWidth: (width: number | null) => {
    const outputs = element('[data-message-id="attachment-surface-agent"] .agent-message-outputs')
    outputs.style.width = width === null ? '' : `${width}px`
  },
  attachmentSurfaceState: () => {
    const user = element('[data-message-id="attachment-surface-user"]')
    const agent = element('[data-message-id="attachment-surface-agent"]')
    const userImages = user.querySelector('.user-message-images')!
    const userFiles = user.querySelector('.user-message-files')!
    const userAttachments = user.querySelector<HTMLElement>('.user-message-attachments')!
    const userBody = user.querySelector('.message-bubble')!
    const userAvatar = user.querySelector<HTMLElement>('.local-message-avatar')!
    const agentAvatar = agent.querySelector<HTMLElement>('.message-author-avatar-trigger, .member-avatar')!
    const agentMessageBody = agent.querySelector<HTMLElement>('.message-body')!
    const agentBody = agent.querySelector('.final-copy')!
    const agentImages = agent.querySelector('.agent-output-images')!
    const agentFiles = agent.querySelector('.agent-output-files')!
    const imageTile = user.querySelector<HTMLElement>('.image-tile-preview')!
    const userFileCards = Array.from(user.querySelectorAll<HTMLElement>('.user-timeline'))
    const composerCards = Array.from(document.querySelectorAll<HTMLElement>('.composer-attachment-card'))
    const composerFileCards = composerCards.filter(card => !card.classList.contains('composer-image-attachment'))
    const heading = agent.querySelector<HTMLElement>('.agent-delivery-heading')!
    const headingLabel = heading.querySelector<HTMLElement>('strong')!
    const headingCount = heading.querySelector<HTMLElement>('span')!
    const userAttachmentBounds = userAttachments.getBoundingClientRect()
    const userBodyBounds = userBody.getBoundingClientRect()
    const userAvatarBounds = userAvatar.getBoundingClientRect()
    const agentAvatarBounds = agentAvatar.getBoundingClientRect()
    const agentMessageBodyBounds = agentMessageBody.getBoundingClientRect()
    return {
      decodedImages: document.querySelectorAll('.image-tile-preview img').length,
      userImageCount: user.querySelectorAll('.image-tile-preview').length,
      agentImageCount: agent.querySelectorAll('.image-tile-preview').length,
      composerImageCount: document.querySelectorAll('.composer-image-attachment').length,
      userFileCount: userFileCards.length,
      order: {
        userImagesBeforeFiles: Boolean(userImages.compareDocumentPosition(userFiles) & Node.DOCUMENT_POSITION_FOLLOWING),
        userFilesBeforeBody: Boolean(userFiles.compareDocumentPosition(userBody) & Node.DOCUMENT_POSITION_FOLLOWING),
        agentBodyBeforeImages: Boolean(agentBody.compareDocumentPosition(agentImages) & Node.DOCUMENT_POSITION_FOLLOWING),
        agentImagesBeforeFiles: Boolean(agentImages.compareDocumentPosition(agentFiles) & Node.DOCUMENT_POSITION_FOLLOWING)
      },
      userImage: { width: Math.round(imageTile.getBoundingClientRect().width), height: Math.round(imageTile.getBoundingClientRect().height) },
      userLayout: {
        attachmentWidth: Math.round(userAttachmentBounds.width),
        attachmentLeft: Math.round(userAttachmentBounds.left),
        attachmentRight: Math.round(userAttachmentBounds.right),
        messageWidth: Math.round(userBodyBounds.width),
        messageLeft: Math.round(userBodyBounds.left),
        messageRight: Math.round(userBodyBounds.right),
        userAvatarLeft: Math.round(userAvatarBounds.left),
        agentAvatarLeft: Math.round(agentAvatarBounds.left),
        agentMessageBodyLeft: Math.round(agentMessageBodyBounds.left)
      },
      userFileHeights: userFileCards.map(card => Math.round(card.getBoundingClientRect().height)),
      userFileWidths: userFileCards.map(card => Math.round(card.getBoundingClientRect().width)),
      userFileDetails: user.querySelectorAll('.user-timeline .attachment-copy small').length,
      agentFileCount: agent.querySelectorAll('.agent-timeline').length,
      agentIconTypes: Array.from(agent.querySelectorAll('.agent-artifact-icon')).map(icon =>
        Array.from(icon.classList).find(name => name.startsWith('type-'))),
      agentColumns: getComputedStyle(agent.querySelector('.agent-output-file-grid')!).gridTemplateColumns.split(' ').length,
      composerHeights: composerCards.map(card => Math.round(card.getBoundingClientRect().height)),
      composerFileWidths: composerFileCards.map(card => Math.round(card.getBoundingClientRect().width)),
      composerImageWidths: Array.from(document.querySelectorAll<HTMLElement>('.composer-image-attachment')).map(card =>
        Math.round(card.getBoundingClientRect().width)),
      composerText: element('#camp-message').textContent?.trim() ?? '',
      composerOverflow: element('.composer-attachment-strip').scrollWidth > element('.composer-attachment-strip').clientWidth,
      composerScrollbar: getComputedStyle(element('.composer-attachment-strip')).scrollbarWidth,
      agentOutputWidth: Math.round(agent.querySelector<HTMLElement>('.agent-message-outputs')!.getBoundingClientRect().width),
      agentHeadingGap: Math.round(headingCount.getBoundingClientRect().left - headingLabel.getBoundingClientRect().right),
      agentOpenCueDisplay: getComputedStyle(agent.querySelector<HTMLElement>('.agent-file-open-cue')!).display,
      agentCardBackground: getComputedStyle(agent.querySelector<HTMLElement>('.agent-timeline')!).backgroundColor,
      surfaceRaised: getComputedStyle(document.documentElement).getPropertyValue('--surface-raised').trim(),
      theme: document.documentElement.dataset.theme ?? '',
      overflow: document.documentElement.scrollWidth > innerWidth
    }
  },
  imageAppearance: (source: 'tool' | 'send') => {
    const container = element(`[data-message-id="image-message-${source === 'tool' ? 0 : 1}"] .agent-output-images`)
    const previews = Array.from(container.querySelectorAll<HTMLButtonElement>('.image-tile-preview'))
    container.scrollIntoView({ block: 'center' })
    return previews.map(preview => {
      const image = preview.querySelector('img')!
      const bounds = preview.getBoundingClientRect()
      const style = getComputedStyle(preview)
      return { decoded: Boolean(image?.naturalWidth), width: Math.round(bounds.width), height: Math.round(bounds.height),
        left: Math.round(bounds.left), border: style.border, radius: style.borderRadius, background: style.backgroundColor,
        fit: image ? getComputedStyle(image).objectFit : null,
        extraText: container.querySelector('.image-gallery')!.textContent!.trim() }
    })
  },
  state: () => {
    const scroll = element('.timeline-scroll')
    const node = element('[data-message-id="message-25"]')
    return {
      messages: Array.from(document.querySelectorAll('article[data-message-id]')).map(node => node.getAttribute('data-message-id')),
      timelineLength: current.timeline.length, allEventSequencesNull: current.messages.every(message => message.timelineGlobalSequence === null),
      cards: { task: document.querySelectorAll('.task-event-card').length, stop: document.querySelectorAll('.run-stopped-event').length,
        files: document.querySelectorAll('.run-file-changes-card').length },
      auditText: element('.task-detail')?.textContent ?? '', scrollTop: scroll.scrollTop,
      bottomGap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
      anchorTop: node?.getBoundingClientRect().top, sameAnchorNode: node === anchor
    }
  }
} })
