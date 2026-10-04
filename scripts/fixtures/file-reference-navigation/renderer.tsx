import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ThreadSnapshot, FilePreviewApi, NavigationThreadItem, OpenFilePreviewRequest, ResolvedFilePreview } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { ThreadWorkspace, QuickChatWorkspace } from '../../../apps/desktop/src/renderer/src/ThreadWorkspace'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { FilePreviewTabs } from '../../../apps/desktop/src/renderer/src/FilePreviewTabs'
import { visibleTimelineMessageAnchor } from '../../../apps/desktop/src/renderer/src/timeline-reading-anchor'
import '../../../apps/desktop/src/renderer/src/styles.css'

const threadId = 'camp-file-navigation'
const file: ResolvedFilePreview = {
  previewKey: 'report', handleId: 'report', reopenToken: 'report', displayPath: 'src/report/run_report.py',
  pathPresentation: 'project_relative',
  fileName: 'run_report.py', size: 8_000, mime: 'text/plain', extension: '.py', kind: 'code',
  hasExternalUpdate: false, contentVersion: { size: 8_000, mtimeMs: 1 },
  contentGeneration: 'generation-1', capabilities: ['read']
}
const opens: OpenFilePreviewRequest[] = []
const notices: string[] = []
let chooseRootCalls = 0
const unsupported = async (): Promise<never> => { throw new Error('Unexpected navigation fixture operation') }
const api: FilePreviewApi = {
  bindCamp: async () => {},
  open: async (request) => {
    opens.push(request)
    if (request.kind === 'message_reference' && request.rawReference === '../outside/config.toml') {
      return { ok: false, error: {
        code: 'authorization_required', message: '内部目录授权原因不应显示给用户。', retryable: false,
        authorizationChallenge: {
          pendingOpenId: 'pending-external-file', threadId, displayReference: request.rawReference, expiresAt: Date.now() + 60_000
        }
      } }
    }
    if (request.kind !== 'message_reference'
      || (request.rawReference !== file.displayPath && request.rawReference !== 'run_report.py:44-46')) {
      return unsupported()
    }
    return { ok: true, value: { kind: 'file_preview', file: {
      ...file,
      handleId: crypto.randomUUID(),
      ...(request.rawReference === 'run_report.py:44-46'
        ? { target: { line: 44, endLine: 46 } }
        : {})
    } } }
  },
  restore: unsupported,
  readText: async () => ({ ok: true, value: {
    text: Array.from({ length: 300 }, (_, index) => `value_${index + 1} = "line ${index + 1}"`).join('\n'),
    contentGeneration: file.contentGeneration, contentVersion: file.contentVersion
  } }),
  release: async () => ({ released: true }), onExternalUpdate: () => () => {},
  reopen: unsupported, readPage: unsupported, resolveLine: unsupported, readBinary: unsupported,
  prepareHtml: unsupported, reload: unsupported, openInSystem: unsupported, revealInFolder: unsupported,
  copyPath: unsupported, chooseAuthorizedRoot: async () => { chooseRootCalls += 1; return null as never }
}
const draft = { threadId, body: '保留原有草稿', content: {
  version: 2 as const,
  segments: [{ kind: 'text' as const, text: '保留原有草稿' }]
}, revision: 1,
  attachments: [], replyIntent: null, continuationIntent: null, updatedAt: null, expiresAt: null }
Object.assign(window, { rovai: {
  windowControls: { onCloseTabRequested: () => () => {} },
  filePreview: api, platform: 'darwin', onEvent: () => () => {},
  request: async (method: string) => {
    if (method.startsWith('camp.composerDraft.')) return draft
    if (method.startsWith('skills.')) return []
    return unsupported()
  }
} })
const prose = '这段较长的历史消息用于验证文件预览改变会话宽度后，正文自然换行而阅读位置保持稳定。'.repeat(6)
const targetBody = [
  '主实现 `src/report/run_report.py`。',
  ...Array.from({ length: 12 }, (_, index) => `段落 ${index + 1}：${prose}`),
  '显式入口：[主实现](src/report/run_report.py)。',
  '普通正文 src/report/run_report.py 保持文本。',
  '外部配置：[config.toml](../outside/config.toml)。',
  '定位入口：[对应代码](run_report.py:44-46)，这里是当前阅读位置。',
  '本地配置 `config.toml`；视频 `demo.mp4`；绝对路径 `/Users/name/Downloads/demo.html`；不存在 `missing.toml`。',
  'WBS(外码)/WBS描述/成本中心/FBP/GR-手工金额；心/FBP）有值；`run_gr_reminder.py`。',
  '网页入口：[网页 · GitHub](https://github.com/)。文档中的改动：',
  ...Array.from({ length: 4 }, () => prose)
].join('\n\n')
const snapshot: ThreadSnapshot = {
  schemaVersion: 35, throughGlobalSequence: 36,
  thread: { id: threadId, title: '文件引用回归', activationState: 'active', projectBindingKind: 'directory',
    projectPath: '/fixture', defaultLeadAgentId: 'author', membershipGeneration: 1, version: 1,
    createdAt: '2026-08-31T00:00:00Z', updatedAt: '2026-08-31T00:00:00Z' },
  members: [{ agentId: 'author', displayName: '队员', teamRole: 'Lead', avatarRef: null, accent: '#526f88',
    membershipStatus: 'active', leaveRequestedAt: null, profilePresence: 'present', memberOrder: 0,
    isDefaultLead: true, version: 1 }],
  messages: Array.from({ length: 36 }, (_, index) => {
    const body = index === 12 ? targetBody : `历史消息 ${index + 1}：${prose}`
    return { id: `message-${index}`, sequence: index + 1, timelineGlobalSequence: index + 1,
      authorType: 'agent', authorId: 'author', sourceAgentRunId: null, body,
      content: [{ kind: 'text', text: body }], attachments: [], addressMode: 'default', addressedAgentIds: [],
      replyToThreadMessageId: null, threadTurnId: null, presentation: null, createdAt: '2026-08-31T00:00:00Z' }
  }),
  membershipReconciliations: [], tasks: [], messageDeliveries: [], turns: [], agentRuns: [], executionEvidence: [],
  agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
}
const wideBody = [
  '长命令与宽表格应在正文内部滚动。',
  '```sh',
  `node scripts/report.mjs --output=/fixture/${'nested-directory/'.repeat(20)}report.html`,
  '```',
  '',
  `| ${Array.from({ length: 24 }, (_, index) => `字段 ${index + 1}`).join(' | ')} |`,
  `| ${Array.from({ length: 24 }, () => '---').join(' | ')} |`,
  `| ${Array.from({ length: 24 }, () => '已完成').join(' | ')} |`
].join('\n')
const wideSnapshot: ThreadSnapshot = { ...snapshot, messages: snapshot.messages.map((message, index) => index === 35
  ? { ...message, body: wideBody, content: [{ kind: 'text', text: wideBody }] } : message) }
const recentThreads: NavigationThreadItem[] = ['长'.repeat(80), 'W'.repeat(80), '日常对话'].map((title, index) => ({
  id: `recent-${index}`, title, activationState: 'active', projectBindingKind: 'directory', projectPath: '/fixture',
  defaultLead: null, marker: index === 0 ? 'unread_completed' : index === 1 ? 'loading' : 'none',
  lastActivityAt: snapshot.thread.updatedAt, lastActivityGlobalSequence: index + 1, latestCompletionGlobalSequence: 0, version: 1
}))
type FixtureSurface = 'history' | 'wide-message' | 'home'
let setSurface: (surface: FixtureSurface) => void

function Workspace({ surface }: { surface: FixtureSurface }): React.JSX.Element {
  const preview = useFilePreview()
  if (surface === 'home') return <div className="app-shell">
    <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)' }}>Rovai AI</aside>
    <AppHeader threadTitle={null} contextLabel="Rovai AI" thread={null} onFocusApprovals={() => {}} />
    <main className="content task-content">
      <QuickChatWorkspace agents={[]} recentThreads={recentThreads} onOpenCamp={() => {}}
        onNewConversation={() => {}} onOpenMembers={() => {}} onOpenRuntimeSettings={() => {}} />
    </main>
  </div>
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', height: 40, flexShrink: 0 }}>
      <button id="toggle-preview" onClick={() => preview.paneVisible ? preview.hidePane() : preview.showPane()}>文件预览</button>
      <FilePreviewTabs />
    </header>
    <ThreadWorkspace snapshot={surface === 'wide-message' ? wideSnapshot : snapshot} initialComposerDraft={draft} projectName="fixture" agents={[]} busy={false} stopping={false}
      onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}}
      onResolveApproval={() => {}} onStop={() => {}} inspectorVisible={false} worldMapEnabled={false}
      onNotify={(message) => notices.push(message)} />
  </div>
}
function Fixture(): React.JSX.Element {
  const [surface, updateSurface] = useState<FixtureSurface>('history')
  setSurface = updateSurface
  return <FilePreviewProvider threadId={surface === 'home' ? null : threadId} resolvedTheme="day">
    <Workspace surface={surface} />
  </FilePreviewProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

const element = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!
const link = () => element('[data-message-id="message-12"] [title="run_report.py:44-46"]')
const timeline = () => element('.camp-timeline')
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 190))))
const overflows = (selectors: string) => [...document.querySelectorAll<HTMLElement>(selectors)]
  .filter(node => node.getBoundingClientRect().width > 0 && node.scrollWidth > node.clientWidth + 1)
  .map(node => ({ className: node.className || node.tagName, width: node.clientWidth, scrollWidth: node.scrollWidth }))
const artifacts = () => [...document.querySelectorAll<HTMLElement>('[data-message-id="message-35"] pre, [data-message-id="message-35"] table')]
let bookmarkedTimeline: HTMLElement
let bookmarkedLink: HTMLElement
let anchorMessageId: string | null = null
let trace: number[] = []
Object.assign(window, { navigationTest: {
  settle,
  async surface(value: FixtureSurface) { setSurface(value); await settle() },
  async scrollArtifacts() { for (const node of artifacts()) node.scrollLeft = node.scrollWidth; await settle() },
  trace() {
    trace = []
    const deadline = performance.now() + 3_000
    const sample = () => requestAnimationFrame(() => setTimeout(() => {
      trace.push(link().getBoundingClientRect().top)
      if (performance.now() < deadline) sample()
    }, 0))
    sample()
  },
  async bookmark() {
    const scroll = timeline()
    scroll.scrollTop += link().getBoundingClientRect().top - scroll.getBoundingClientRect().top - 160
    await settle()
    bookmarkedTimeline = scroll
    bookmarkedLink = link()
  },
  async scrollBy(amount: number) { timeline().scrollTop += amount; await settle() },
  async bottom() { timeline().scrollTop = timeline().scrollHeight; await settle() },
  rememberMessage() { anchorMessageId = visibleTimelineMessageAnchor(timeline())?.messageId ?? null },
  async theme(value: string) { document.documentElement.dataset.theme = value; await settle() },
  state() {
    if (element('.quick-chat-workspace')) return {
      overflows: overflows('html, body, .app-shell, .content, .quick-chat-workspace, .new-conversation-main, .new-conversation-stage, .quick-chat-continue, .quick-chat-continue-row'),
      recentRows: [...document.querySelectorAll<HTMLElement>('.quick-chat-continue-row')].map(row => {
        const title = row.querySelector<HTMLElement>('.truncate')!
        const time = row.querySelector<HTMLElement>('small')!
        const status = row.querySelector<HTMLElement>('.task-dot, .camp-loading-spinner')
        const fits = (node: HTMLElement) => node.getBoundingClientRect().left >= row.getBoundingClientRect().left
          && node.getBoundingClientRect().right <= row.getBoundingClientRect().right
        return { title: title.textContent, fullTitle: title.title, truncated: title.scrollWidth > title.clientWidth,
          ellipsis: getComputedStyle(title).textOverflow, timeVisible: fits(time) && time.clientWidth > 0,
          statusVisible: status ? fits(status) && status.getBoundingClientRect().width > 0 : null }
      })
    }
    const scroll = timeline()
    const viewer = element('.file-preview-code')
    const target = viewer?.querySelector<HTMLElement>('.cm-location-target')
    const viewerScroller = viewer?.querySelector<HTMLElement>('.cm-scroller')
    const message = anchorMessageId ? element(`[data-message-id="${anchorMessageId}"]`) : null
    return {
      linkY: link().getBoundingClientRect().top, scrollTop: scroll.scrollTop, width: scroll.clientWidth,
      overflows: overflows('html, body, .camp-workspace, .workspace-grid, .timeline-pane, .camp-timeline, .timeline-track, .conversation-bubble.agent, .message-body, .public-message-readout, .message-surface, .final-copy, .safe-markdown'),
      artifacts: artifacts().map(node => ({ tag: node.tagName, width: node.clientWidth, scrollWidth: node.scrollWidth,
        scrollLeft: node.scrollLeft, overflowX: getComputedStyle(node).overflowX })),
      timelineScrollLeft: scroll.scrollLeft,
      bottomGap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
      visible: Boolean(element('.file-preview-pane')?.getBoundingClientRect().width),
      sameTimeline: scroll === bookmarkedTimeline, sameLink: link() === bookmarkedLink,
      targetLines: [...document.querySelectorAll<HTMLElement>('.cm-location-target')]
        .map((row) => Number(/value_(\d+)/u.exec(row.textContent ?? '')?.[1])),
      viewerGeometry: { target: target?.getBoundingClientRect().toJSON(), viewport: viewerScroller?.getBoundingClientRect().toJSON(), scrollTop: viewerScroller?.scrollTop },
      targetVisible: Boolean(target && viewerScroller
        && target.getBoundingClientRect().top >= viewerScroller.getBoundingClientRect().top
        && target.getBoundingClientRect().bottom <= viewerScroller.getBoundingClientRect().bottom),
      messageY: message?.getBoundingClientRect().top, opens, notices, chooseRootCalls, trace,
      draft: element('.structured-mention-editor[contenteditable]')?.textContent,
      falseLinks: [...document.querySelectorAll<HTMLAnchorElement>('a[title]')]
        .filter((a) => /FBP|run_gr_reminder/u.test(a.title)).length,
      explicitReferenceTypes: [...document.querySelectorAll<HTMLAnchorElement>(
        '[data-message-id="message-12"] a.markdown-file-reference'
      )].map((anchor) => ({
        title: anchor.title,
        type: anchor.querySelector('svg')?.dataset.resourceType
      })),
      inlineFileLinkCount: document.querySelectorAll(
        '[data-message-id="message-12"] a.inline-code-file-reference'
      ).length,
      inertInlineCodes: [...document.querySelectorAll<HTMLElement>(
        '[data-message-id="message-12"] code'
      )].map((code) => code.textContent),
      webHref: element('[data-message-id="message-12"] a[href^="https:"]')?.getAttribute('href'),
      webText: element('[data-message-id="message-12"] a[href^="https:"]')?.textContent,
      tabCount: document.querySelectorAll('[role="tab"]').length,
      overflow: document.documentElement.scrollWidth > innerWidth
    }
  }
} })
