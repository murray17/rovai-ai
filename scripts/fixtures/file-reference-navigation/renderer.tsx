import { createRoot } from 'react-dom/client'
import type { CampSnapshot, FilePreviewApi, OpenFilePreviewRequest, ResolvedFilePreview } from '@contracts'
import { CampWorkspace } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { FilePreviewProvider, useFilePreview } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { FilePreviewTabs } from '../../../apps/desktop/src/renderer/src/FilePreviewTabs'
import { visibleTimelineMessageAnchor } from '../../../apps/desktop/src/renderer/src/timeline-reading-anchor'
import '../../../apps/desktop/src/renderer/src/styles.css'

const campId = 'camp-file-navigation'
const file: ResolvedFilePreview = {
  previewKey: 'report', handleId: 'report', reopenToken: 'report', displayPath: 'src/report/run_report.py',
  fileName: 'run_report.py', size: 8_000, mime: 'text/plain', extension: '.py', kind: 'code',
  hasExternalUpdate: false, contentVersion: { size: 8_000, mtimeMs: 1 },
  contentGeneration: 'generation-1', capabilities: ['read']
}
const opens: OpenFilePreviewRequest[] = []
const notices: string[] = []
const unsupported = async (): Promise<never> => { throw new Error('Unexpected navigation fixture operation') }
const api: FilePreviewApi = {
  bindCamp: async () => {},
  open: async (request) => {
    opens.push(request)
    if (request.kind !== 'message_reference' || request.rawReference !== file.displayPath) return unsupported()
    return { ok: true, value: { kind: 'file_preview', file: { ...file, handleId: crypto.randomUUID() } } }
  },
  readText: async () => ({ ok: true, value: {
    text: Array.from({ length: 300 }, (_, index) => `value_${index + 1} = "line ${index + 1}"`).join('\n'),
    contentGeneration: file.contentGeneration, contentVersion: file.contentVersion
  } }),
  release: async () => ({ released: true }), onExternalUpdate: () => () => {},
  reopen: unsupported, readPage: unsupported, resolveLine: unsupported, readBinary: unsupported,
  prepareHtml: unsupported, reload: unsupported, openInSystem: unsupported, revealInFolder: unsupported,
  copyPath: unsupported, chooseAuthorizedRoot: unsupported
}
const draft = { campId, body: '保留原有草稿', content: [{ kind: 'text', text: '保留原有草稿' }], revision: 1,
  attachments: [], replyIntent: null, continuationIntent: null, updatedAt: null, expiresAt: null }
Object.assign(window, { rovai: {
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
  '完整路径 src/report/run_report.py。',
  '定位 `run_report.py:44-46`，这里是当前阅读位置。',
  'WBS(外码)/WBS描述/成本中心/FBP/GR-手工金额；心/FBP）有值；`run_gr_reminder.py`。',
  '已读取（https://example.com/wiki/spec）。文档中的改动：',
  ...Array.from({ length: 4 }, () => prose)
].join('\n\n')
const snapshot: CampSnapshot = {
  schemaVersion: 34, throughGlobalSequence: 36,
  camp: { id: campId, title: '文件引用回归', activationState: 'active', projectBindingKind: 'directory',
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
      replyToCampMessageId: null, campTurnId: null, presentation: null, createdAt: '2026-08-31T00:00:00Z' }
  }),
  membershipReconciliations: [], tasks: [], messageDeliveries: [], turns: [], agentRuns: [], executionEvidence: [],
  agentRunFileChanges: [], contextManifests: [], approvals: [], actions: [], timeline: []
}

function Workspace(): React.JSX.Element {
  const preview = useFilePreview()
  return <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', height: 40, flexShrink: 0 }}>
      <button id="toggle-preview" onClick={() => preview.paneVisible ? preview.hidePane() : preview.showPane()}>文件预览</button>
      <FilePreviewTabs />
    </header>
    <CampWorkspace snapshot={snapshot} projectName="fixture" agents={[]} busy={false} stopping={false}
      onSend={async () => {}} onChangeLead={async () => {}} onTasksChanged={async () => {}}
      onResolveApproval={() => {}} onStop={() => {}} inspectorVisible={false} worldMapEnabled={false}
      onNotify={(message) => notices.push(message)} />
  </div>
}
createRoot(document.getElementById('root')!).render(<FilePreviewProvider campId={campId}><Workspace /></FilePreviewProvider>)

const element = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!
const link = () => element('[data-message-id="message-12"] [title="run_report.py:44-46"]')
const timeline = () => element('.camp-timeline')
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 190))))
let bookmarkedTimeline: HTMLElement
let bookmarkedLink: HTMLElement
let anchorMessageId: string | null = null
let trace: number[] = []
Object.assign(window, { navigationTest: {
  settle,
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
    const scroll = timeline()
    const viewer = element('.file-preview-code')
    const target = viewer?.querySelector<HTMLElement>('[data-file-row="44"]')
    const message = anchorMessageId ? element(`[data-message-id="${anchorMessageId}"]`) : null
    return {
      linkY: link().getBoundingClientRect().top, scrollTop: scroll.scrollTop, width: scroll.clientWidth,
      bottomGap: scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight,
      visible: Boolean(element('.file-preview-pane')?.getBoundingClientRect().width),
      sameTimeline: scroll === bookmarkedTimeline, sameLink: link() === bookmarkedLink,
      targetLines: [...document.querySelectorAll<HTMLElement>('.is-location-target')].map((row) => Number(row.dataset.fileRow)),
      targetVisible: Boolean(target && target.getBoundingClientRect().top >= viewer.getBoundingClientRect().top
        && target.getBoundingClientRect().bottom <= viewer.getBoundingClientRect().bottom),
      messageY: message?.getBoundingClientRect().top, opens, notices, trace,
      draft: element('[contenteditable]')?.textContent,
      falseLinks: [...document.querySelectorAll<HTMLAnchorElement>('a[title]')]
        .filter((a) => /FBP|run_gr_reminder/u.test(a.title)).length,
      webHref: element('[data-message-id="message-12"] a[href^="https:"]')?.getAttribute('href'),
      webText: element('[data-message-id="message-12"] a[href^="https:"]')?.textContent,
      tabCount: document.querySelectorAll('[role="tab"]').length,
      overflow: document.documentElement.scrollWidth > innerWidth
    }
  }
} })
