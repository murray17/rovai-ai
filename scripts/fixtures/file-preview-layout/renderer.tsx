import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ActionApprovalView, AgentRunFileChangesDetailView, AgentRunFileChangesView, ComposerDocument, FilePreviewApi, OpenFilePreviewRequest, ResolvedFilePreview, TaskView } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { AgentRunFileChangesTimelineCard, ApprovalDock, RuntimeRecoveryDock, TaskTimelineCard } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { FilePreviewProvider, useFilePreview, type FilePreviewContextValue } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { FilePreviewResizeHandle, FilePreviewWorkspace } from '../../../apps/desktop/src/renderer/src/FilePreviewLayout'
import { FilePreviewPane } from '../../../apps/desktop/src/renderer/src/FilePreviewPane'
import { FileReferenceLink } from '../../../apps/desktop/src/renderer/src/FileReferenceLink'
import { StructuredMentionComposer } from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'
import { FILE_PREVIEW_RATIO_STORAGE_KEY } from '../../../apps/desktop/src/renderer/src/file-preview-layout'
import '../../../apps/desktop/src/renderer/src/styles.css'

const file: ResolvedFilePreview = {
  previewKey: 'split-fixture', handleId: 'handle-1', reopenToken: 'reopen-1',
  displayPath: 'src/preview-layout.ts', fileName: 'preview-layout.ts',
  pathPresentation: 'project_relative',
  size: 8_000, mime: 'text/plain', extension: '.ts', kind: 'code',
  hasExternalUpdate: false, contentVersion: { size: 8_000, mtimeMs: 1 },
  contentGeneration: 'generation-1', capabilities: ['read']
}
const tabFiles = ['src/app.ts', 'src/layout.tsx', 'src/theme.ts', 'src/routes.ts', 'src/search.ts',
  'src/settings.tsx', 'src/navigation.ts', 'src/very-long-file-preview-reading-anchor.tsx']
const fileNameOnlyReference = 'external-preview.ts'
const missingReference = 'src/missing-report.ts'
const toolPreviewReference = 'src/tool-link-preview.ts'
const unsupported = async (): Promise<never> => { throw new Error('Unexpected fixture API operation') }
const fileOpens: OpenFilePreviewRequest[] = []
const fileRestores: OpenFilePreviewRequest[] = []
const campBindings: Array<string | null> = []
const releases: string[] = []
const reviewRequests: Array<{ campId: string; agentRunId: string; executionEpoch: number }> = []
let failNextReview = false
let failNextRead = false
let fileReads = 0
async function resolvePreview(request: OpenFilePreviewRequest) {
  if (request.kind === 'message_reference' && request.rawReference === missingReference) {
    return { ok: false as const, error: {
      code: 'file_not_found' as const,
      message: 'Fixture detail must not reach the recovery surface.',
      retryable: false
    } }
  }
  let target = file
  if (request.kind === 'run_evidence' && request.action === 'open_current') {
    const selected = changes.files.find((entry) => entry.evidenceFileId === request.evidenceFileId)
    if (!selected) return unsupported()
    target = { ...file, previewKey: `current:${selected.path}`, displayPath: selected.path, fileName: selected.path.split('/').at(-1)! }
  } else if (request.kind === 'message_reference' && tabFiles.includes(request.rawReference)) {
    target = { ...file, previewKey: request.rawReference, displayPath: request.rawReference,
      fileName: request.rawReference.split('/').at(-1)! }
  } else if (request.kind === 'message_reference' && request.rawReference === fileNameOnlyReference) {
    target = { ...file, previewKey: fileNameOnlyReference, displayPath: fileNameOnlyReference,
      pathPresentation: 'file_name_only', fileName: fileNameOnlyReference }
  } else if (request.kind === 'camp_workspace' && request.rawReference === toolPreviewReference) {
    target = { ...file, previewKey: toolPreviewReference, displayPath: toolPreviewReference,
      fileName: toolPreviewReference.split('/').at(-1)! }
  } else if (request.kind !== 'message_reference' || request.rawReference !== file.displayPath) return unsupported()
  return { ok: true as const, value: { kind: 'file_preview' as const, file: { ...target, handleId: crypto.randomUUID() } } }
}
const api: FilePreviewApi = {
  bindCamp: async (campId) => { campBindings.push(campId) },
  open: async (request) => {
    fileOpens.push(request)
    return resolvePreview(request)
  },
  restore: async (request) => {
    fileRestores.push(request)
    return resolvePreview(request)
  },
  readText: async () => {
    fileReads += 1
    if (failNextRead) {
      failNextRead = false
      return { ok: false, error: { code: 'read_failed', message: 'Fixture read failed.', retryable: true } }
    }
    return { ok: true, value: {
      text: Array.from({ length: 300 }, (_, index) => `const readingLine${index + 1} = "保持会话和文件的阅读位置"`).join('\n'),
      contentGeneration: file.contentGeneration, contentVersion: file.contentVersion
    } }
  },
  release: async ({ handleId }) => { releases.push(handleId); return { released: true } },
  onExternalUpdate: () => () => {},
  reopen: unsupported, readPage: unsupported, resolveLine: unsupported,
  readBinary: unsupported, prepareHtml: unsupported, reload: unsupported,
  openInSystem: unsupported, revealInFolder: unsupported, copyPath: unsupported,
  chooseAuthorizedRoot: unsupported
}

const task: TaskView = {
  taskId: 'task-1', campId: 'camp-1', title: '检查文件预览的拖拽边界，并保留窄会话中的完整任务信息',
  description: '验证会话与文件预览可以独立调整。', acceptanceCriteria: ['保留草稿', '文件可以重新打开'],
  status: 'pending', assigneeAgentId: null, blockedReason: null, completionSummary: null, cancelReason: null,
  createdByType: 'user', createdById: 'local_user', sourceAgentRunId: null,
  closedByType: null, closedById: null, closedByAgentRunId: null, version: 1,
  createdAt: '2026-08-30T08:00:00Z', updatedAt: '2026-08-30T08:00:00Z', closedAt: null, availableActions: ['update']
}
const changes: AgentRunFileChangesView = {
  schemaVersion: 2, agentRunId: 'run-1', executionEpoch: 1,
  files: ['apps/desktop/src/renderer/src/components/conversation/very-long-file-preview-name.tsx', 'apps/desktop/src/renderer/src/styles.css'].map((path, index) => ({
    evidenceFileId: `file-${index}`, path, changeKind: 'update', presentationKind: 'full_net_diff',
    operationCount: 1, additions: 123 + index, deletions: 45 + index
  })),
  fileCount: 2, operationCount: 2, additions: 247, deletions: 91, completedAt: '2026-08-30T08:00:00Z'
}
Object.assign(window, { rovai: {
  filePreview: api,
  request: async (method: string, request: { campId: string; agentRunId: string; executionEpoch: number }): Promise<AgentRunFileChangesDetailView> => {
    if (method !== 'agentRunFileChanges.get' || request.campId !== 'camp-1' || request.agentRunId !== changes.agentRunId) return unsupported()
    reviewRequests.push(request)
    if (failNextReview) { failNextReview = false; throw new Error('Fixture detail unavailable') }
    return {
      schemaVersion: 2, card: { ...changes, executionEpoch: request.executionEpoch },
      files: changes.files.map((entry) => ({ ...entry, blocks: [{
        sequence: 1, semantics: 'full_net_diff', changeKind: 'update',
        diff: `@@ -1,${entry.deletions} +1,${entry.additions} @@\n`
          + Array.from({ length: entry.deletions! }, (_, index) => `-历史旧内容 ${index + 1}`).join('\n') + '\n'
          + Array.from({ length: entry.additions! }, (_, index) => `+历史新内容 ${index + 1}${entry.evidenceFileId === 'file-1' && index === 0 ? ' const preservedLongLine = '.repeat(30) : ''}`).join('\n')
      }] }))
    }
  }
} })
const approval: ActionApprovalView = {
  id: 'approval-1', actionId: 'action-1', actionKind: 'command',
  actionSummary: '运行文件预览验证并写入当前工作区的构建产物', canonicalInput: { command: 'pnpm test:file-preview-layout' },
  reason: '请确认此次操作范围。仅允许当前请求不会授予后续命令权限，也不会更改其他会话或工作目录。',
  agentRunId: 'run-1', agentId: '等待确认工作区文件写入范围的队员', adapterKind: 'codex-cli',
  nativeMethod: 'item/commandExecution/requestApproval', requestDigest: 'request-1', permissionSemantics: 'runtime_managed_v2',
  options: [{ optionId: 'allow-once', kind: 'allow_once', label: '仅允许这一次请求',
    consequence: '仅批准当前命令；之后的操作仍需要单独确认。', nativeResponseDigest: 'response-1' },
  { optionId: 'deny', kind: 'deny', label: '拒绝本次操作并保留当前草稿',
    consequence: '不会写入任何文件，其他待审批请求保持不变。', nativeResponseDigest: 'response-2' }],
  status: 'pending', requestedForUserId: 'local_user', resolvedByType: null, resolvedById: null,
  resolutionCode: null, version: 1, requestedAt: '2026-08-30T08:00:00Z', resolvedAt: null
}
let showFind: (open: boolean) => void
let showDocks: (mode: 'none' | 'approval' | 'recovery' | 'both') => void
let previewController: FilePreviewContextValue

function Workspace(): React.JSX.Element {
  const preview = useFilePreview()
  previewController = preview
  const [draft] = useState<ComposerDocument>({
    version: 2,
    segments: [{ kind: 'text', text: '保留这条未发送草稿' }]
  })
  const [findOpen, setFindOpen] = useState(false)
  const [docks, setDocks] = useState<'none' | 'approval' | 'recovery' | 'both'>('none')
  const approvalRef = useRef<HTMLElement>(null)
  showFind = setFindOpen
  showDocks = setDocks
  return <section className="workspace-shell camp-workspace">
    <FilePreviewWorkspace>
      <section className="timeline-pane" tabIndex={-1}>
        <div className={`camp-conversation-stage ${findOpen ? 'conversation-find-open' : ''}`}>
          <div className={`conversation-floating-tools ${findOpen ? 'find-open' : ''}`}>
            {findOpen && <div className="conversation-find-surface">
              <form className="conversation-find-form" role="search" onSubmit={(event) => event.preventDefault()}>
                <svg className="conversation-find-glyph" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></svg>
                <input type="text" aria-label="搜索当前会话" placeholder="搜索当前会话" />
                <span className="conversation-find-count">1 / 12</span>
                <span className="conversation-find-divider" />
                <button type="button" className="conversation-find-icon-button" aria-label="上一个匹配项">↑</button>
                <button type="button" className="conversation-find-icon-button" aria-label="下一个匹配项">↓</button>
                <button type="button" className="conversation-find-icon-button close" aria-label="关闭会话查找" onClick={() => setFindOpen(false)}>×</button>
              </form>
            </div>}
            <div className="camp-conversation-view-controls" role="group" aria-label="会话区视图">
              <button aria-pressed="true">会话</button><button aria-pressed="false">地图</button>
            </div>
          </div>
          <div className="camp-timeline timeline-scroll" tabIndex={-1}>
            <div className="timeline-track">
              <h2>文件预览比例与拖拽</h2>
              <p>从会话内的文件引用打开预览。文字自然换行，不影响任务、文件变化与输入区域。</p>
              <FileReferenceLink className="message-file-reference" rawReference="src/preview-layout.ts"
                onActivate={(rawReference) => void preview.open({ kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference })}>
                preview-layout.ts
              </FileReferenceLink>
              <FileReferenceLink className="message-file-reference missing-file-reference" rawReference={missingReference}
                onActivate={(rawReference) => void preview.open({ kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference })}>
                missing-report.ts
              </FileReferenceLink>
              <TaskTimelineCard task={task} assigneeName="未分配" onOpen={() => {}} />
              <AgentRunFileChangesTimelineCard changes={changes} onOpenReview={(evidenceFileId) => preview.openFileChanges('camp-1', changes, evidenceFileId)} />
              <div className="safe-markdown">
                <p>宽代码和表格保持各自的横向滚动，会话仍可以收窄至 420px。</p>
                <pre><code>{'const keepConversationReadable = '.repeat(12)}</code></pre>
                <table><tbody><tr>{Array.from({ length: 8 }, (_, index) => <td key={index}>独立横向滚动的文件数据 {index}</td>)}</tr></tbody></table>
              </div>
              <p style={{ marginTop: 900 }}>会话阅读位置保持在同一条内容中。</p>
            </div>
          </div>
        </div>
      </section>
      <FilePreviewResizeHandle onClose={preview.hidePane} />
      <FilePreviewPane />
      <div className="conversation-controls">
        {(docks === 'approval' || docks === 'both') && <ApprovalDock approvals={[approval]} profileById={new Map()} busy={false}
          onResolve={() => {}} containerRef={approvalRef} focusRequest={null} focusApprovalId={null} />}
        {(docks === 'recovery' || docks === 'both') && <RuntimeRecoveryDock
          recovery={{ campId: 'camp-1', targets: [{ agentId: 'agent-1', blockerCode: 'runtime_not_configured' }] }}
          memberById={new Map()} profileById={new Map()} onConfigure={() => {}} onDismiss={() => setDocks('none')} />}
        <form className="composer" onSubmit={(event) => event.preventDefault()}>
          <div className="composer-route-rail"><span className="mention-target-summary">新消息交给当前队长</span></div>
          <div className="composer-box">
            <div className="composer-input"><StructuredMentionComposer
              id="fixture-message"
              draftIdentity="fixture-camp-1"
              document={draft}
              members={[]}
              ariaLabel="消息草稿"
              onSubmit={() => {}}
            /></div>
            <div className="composer-action-row">
              <div className="composer-tools"><button type="button" className="composer-attachment-button" aria-label="添加文件">＋</button></div>
              <div className="composer-actions">
                <span className="composer-hint"><span className="sr-only">Enter 发送，Shift+Enter 换行</span>
                  <span className="composer-hint-visual" aria-hidden="true"><kbd>↵</kbd><span>发送</span><span>·</span><kbd>⇧↵</kbd><span>换行</span></span></span>
                <button className="danger-button composer-stop" type="button">停止</button>
                <button className="primary-button composer-send" type="submit">发送</button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </FilePreviewWorkspace>
  </section>
}

let switchCamp: () => void
function Fixture(): React.JSX.Element {
  const [camp, setCamp] = useState('camp-1')
  switchCamp = () => setCamp((previous) => previous === 'camp-1' ? 'camp-2' : 'camp-1')
  return <FilePreviewProvider campId={camp}>
    <div className="app-shell app-shell-camp">
      <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)' }}>Rovai AI</aside>
      <AppHeader campTitle="文件预览验收" contextLabel="Rovai AI" camp={null} onFocusApprovals={() => {}} />
      <main className="content task-content"><Workspace /></main>
    </div>
  </FilePreviewProvider>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)

const element = (selector: string): HTMLElement | null => document.querySelector(selector)
const visible = (selector: string): boolean => Boolean(element(selector)?.getClientRects().length)
let bookmarkedViewer: HTMLElement | null = null
let bookmarkedEditor: HTMLElement | null = null
let bookmarkedTimeline: HTMLElement | null = null
let bookmarkedTask: HTMLElement | null = null
let bookmarkedReview: HTMLElement | null = null
let lastPointer = 0
const pointerEvents: unknown[] = []
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
  document.addEventListener(type, (event) => {
    const pointer = event as PointerEvent
    pointerEvents.push({ type, buttons: pointer.buttons, x: pointer.clientX, target: (event.target as HTMLElement).className })
    if (pointerEvents.length > 16) pointerEvents.shift()
  }, true)
}
document.addEventListener('pointerdown', (event) => { lastPointer = event.pointerId }, true)
async function settle(): Promise<void> {
  const deadline = performance.now() + 3_000
  do {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (performance.now() > deadline) throw new Error('File preview layout did not settle')
  } while (!element('.workspace-grid') || element('.is-file-preview-snapping'))
}

Object.assign(window, { previewTest: {
  settle,
  pointerEvents,
  async open() {
    element('.message-file-reference')!.click()
    await settle()
  },
  async openTab(index: number) {
    const rawReference = tabFiles[index]
    if (!rawReference) throw new Error('Unknown fixture tab')
    await previewController.open({ kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference })
    await settle()
  },
  async openFileNameOnly() {
    await previewController.open({
      kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference: fileNameOnlyReference
    })
    await settle()
  },
  async openToolPreview(failRead = false) {
    failNextRead = failRead
    const outcome = await previewController.open(
      { kind: 'camp_workspace', campId: 'camp-1', rawReference: toolPreviewReference },
      undefined,
      undefined,
      { commitOnSuccess: true, previewOnly: true }
    )
    await settle()
    return outcome
  },
  async openMissing() {
    await previewController.open({
      kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference: missingReference
    })
    await settle()
  },
  async closeExtraTabs() {
    previewController.closeMany(previewController.tabs
      .filter((tab) => tab.kind !== 'file' || tab.file?.previewKey !== file.previewKey)
      .map((tab) => tab.id))
    await settle()
  },
  tabSnapshot() {
    const strip = element('.file-preview-tab-strip')!
    const bounds = strip.getBoundingClientRect()
    const leftButton = element('.file-preview-tab-scroll.is-left')!
    const rightButton = element('.file-preview-tab-scroll.is-right')!
    const edges = { left: getComputedStyle(leftButton).visibility !== 'hidden', right: getComputedStyle(rightButton).visibility !== 'hidden' }
    return {
      overflow: strip.scrollWidth > strip.clientWidth + 1,
      left: bounds.left, right: bounds.right, top: bounds.top, scrollLeft: strip.scrollLeft,
      maximum: strip.scrollWidth - strip.clientWidth, edges,
      visibleLeft: edges.left ? leftButton.getBoundingClientRect().right : bounds.left,
      visibleRight: edges.right ? rightButton.getBoundingClientRect().left : bounds.right,
      tabs: [...document.querySelectorAll<HTMLElement>('.file-preview-tab')].map((tab) => {
        const rect = tab.getBoundingClientRect()
        const label = tab.querySelector<HTMLElement>('.file-preview-tab-label')!
        return { width: rect.width, left: rect.left, right: rect.right,
          selected: tab.querySelector('[role="tab"]')?.getAttribute('aria-selected') === 'true',
          focused: tab.contains(document.activeElement),
          faded: getComputedStyle(label).maskImage !== 'none',
          iconWidth: tab.querySelector('.file-preview-tab-icon')!.getBoundingClientRect().width,
          closeWidth: tab.querySelector('.file-preview-tab-close')!.getBoundingClientRect().width }
      })
    }
  },
  pathSnapshot() {
    const panel = element('.file-preview-tab-panel:not([hidden])')!
    const content = panel.querySelector<HTMLElement>('.file-preview-content')!
    const path = panel.querySelector<HTMLElement>('.file-preview-path-row')
    const update = panel.querySelector<HTMLElement>('.file-preview-update-row')
    return {
      pathVisible: Boolean(path?.getClientRects().length),
      pathHeight: path?.getBoundingClientRect().height ?? 0,
      updateVisible: Boolean(update?.getClientRects().length),
      panelTop: panel.getBoundingClientRect().top,
      contentTop: content.getBoundingClientRect().top
    }
  },
  recoverySnapshot() {
    const panel = element('.file-preview-tab-panel:not([hidden])')
    const content = panel?.querySelector<HTMLElement>('.file-preview-content')
    const recovery = content?.querySelector<HTMLElement>('.file-preview-recovery')
    const icon = recovery?.querySelector<SVGElement>('.file-preview-recovery-icon')
    const contentBounds = content?.getBoundingClientRect()
    const recoveryBounds = recovery?.getBoundingClientRect()
    const style = recovery ? getComputedStyle(recovery) : null
    return {
      text: recovery?.querySelector('p')?.textContent,
      paragraphs: recovery?.querySelectorAll('p').length ?? 0,
      buttons: content?.querySelectorAll('button').length ?? 0,
      childCount: recovery?.children.length ?? 0,
      pathVisible: Boolean(panel?.querySelector('.file-preview-path-row')),
      resourceType: icon?.dataset.resourceType,
      iconWidth: icon?.getBoundingClientRect().width ?? 0,
      iconHeight: icon?.getBoundingClientRect().height ?? 0,
      centeredX: contentBounds && recoveryBounds
        ? Math.abs((contentBounds.left + contentBounds.right - recoveryBounds.left - recoveryBounds.right) / 2)
        : null,
      centeredY: contentBounds && recoveryBounds
        ? Math.abs((contentBounds.top + contentBounds.bottom - recoveryBounds.top - recoveryBounds.bottom) / 2)
        : null,
      borderWidths: style ? [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth] : [],
      background: style?.backgroundColor
    }
  },
  async openReview(index = 0) {
    document.querySelectorAll<HTMLElement>('.run-file-change-file')[index].click()
    await settle()
  },
  async otherEpoch(fail = false) {
    failNextReview = fail
    previewController.openFileChanges('camp-1', { ...changes, executionEpoch: 2 })
    await settle()
  },
  async closeAll() { previewController.closeMany(previewController.tabs.map((tab) => tab.id)); await settle() },
  async selectChangedFile(index: number) {
    const select = document.querySelector<HTMLSelectElement>('.file-preview-tab-panel:not([hidden]) select')!
    select.value = changes.files[index].evidenceFileId
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
  },
  bookmarkReview() {
    bookmarkedReview = element('.file-preview-tab-panel:not([hidden]) .agent-run-file-review-scroll')!
    bookmarkedReview.scrollTop = 640
  },
  async switchCamp() { switchCamp(); await settle() },
  async find(open: boolean) { showFind(open); await settle() },
  async docks(mode: 'none' | 'approval' | 'recovery' | 'both') { showDocks(mode); await settle() },
  bookmark() {
    bookmarkedViewer = element('.file-preview-code')!
    bookmarkedViewer.scrollTop = 640
    bookmarkedEditor = element('[contenteditable]')
    bookmarkedTimeline = element('.camp-timeline')
    bookmarkedTask = element('.task-event-card')
  },
  cancelPointer(lost = false) {
    const handle = element('.file-preview-resize-handle')!
    if (lost) handle.releasePointerCapture(lastPointer)
    else handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: lastPointer }))
  },
  snapshot() {
    const grid = element('.workspace-grid')!
    const pane = element('.file-preview-pane')
    const handle = element('.file-preview-resize-handle')
    const tabs = element('.file-preview-tabs')
    const gridBounds = grid.getBoundingClientRect()
    const paneBounds = pane?.getBoundingClientRect()
    const handleBounds = handle?.getBoundingClientRect()
    const viewer = element('.file-preview-code')
    return {
      available: gridBounds.width, right: gridBounds.right,
      width: paneBounds?.width ?? 0,
      conversation: element('.timeline-pane')!.getBoundingClientRect().width,
      visible: visible('.file-preview-pane'), compact: grid.classList.contains('file-preview-compact'),
      controlsVisible: visible('.conversation-controls'), returnVisible: visible('.file-preview-return'),
      aligned: paneBounds && tabs ? Math.abs(paneBounds.left - tabs.getBoundingClientRect().left) < .1 : true,
      overflow: document.documentElement.scrollWidth > innerWidth,
      stored: localStorage.getItem(FILE_PREVIEW_RATIO_STORAGE_KEY),
      handle: handleBounds ? { x: Math.round(handleBounds.left + handleBounds.width / 2), y: 140, width: handleBounds.width } : null,
      lineWidth: handle ? getComputedStyle(handle, '::after').width : null,
      lineColor: handle ? getComputedStyle(handle, '::after').backgroundColor : null,
      hintColor: handle ? getComputedStyle(handle.querySelector('.file-preview-splitter-tip')!).color : null,
      aria: handle ? { min: handle.getAttribute('aria-valuemin'), max: handle.getAttribute('aria-valuemax'), now: handle.getAttribute('aria-valuenow') } : null,
      hint: handle?.getAttribute('aria-valuetext'),
      armed: grid.classList.contains('is-file-preview-close-armed'),
      opacity: pane ? getComputedStyle(pane).opacity : null,
      resizing: document.documentElement.classList.contains('file-preview-resizing'),
      focused: (document.activeElement as HTMLElement)?.className,
      sameViewer: bookmarkedViewer === viewer, scroll: viewer?.scrollTop,
      draft: element('[contenteditable]')?.textContent,
      sameEditor: bookmarkedEditor === element('[contenteditable]'),
      sameTimeline: bookmarkedTimeline === element('.camp-timeline'),
      sameTask: bookmarkedTask === element('.task-event-card'),
      tabCount: document.querySelectorAll('[role="tab"]').length,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transition: getComputedStyle(grid).transitionDuration
    }
  },
  reviewSnapshot() {
    const panel = element('.file-preview-tab-panel:not([hidden])')
    const review = panel?.querySelector<HTMLElement>('.agent-run-file-review')
    const scroll = review?.querySelector<HTMLElement>('.agent-run-file-review-scroll')
    const bar = element('.file-preview-tabs')
    const strip = element('.file-preview-tab-strip')
    const toggle = element('.file-preview-toggle')!
    const region = (node: Element | null) => node ? getComputedStyle(node).getPropertyValue('-webkit-app-region') : null
    return {
      reviewVisible: Boolean(review && review.getBoundingClientRect().height > 0),
      emptyVisible: visible('.file-preview-empty'),
      selectedFile: review?.querySelector('.agent-run-file-review-pane-header code')?.textContent,
      selectedTab: element('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label'),
      tabs: [...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => ({
        label: tab.getAttribute('aria-label'), icon: tab.querySelector('svg')?.dataset.fileType,
        noDrag: region(tab.parentElement) === 'no-drag', iconVisible: tab.firstElementChild?.tagName === 'svg'
      })),
      sameReview: bookmarkedReview === scroll, reviewScroll: scroll?.scrollTop,
      error: review?.querySelector('[role="alert"]')?.textContent,
      text: scroll?.textContent,
      horizontalScroll: scroll ? scroll.scrollWidth > scroll.clientWidth + 1 : null,
      sidebarVisible: Boolean(review?.querySelector('.agent-run-file-review-sidebar')?.getBoundingClientRect().width),
      pickerVisible: Boolean(review?.querySelector('.agent-run-file-review-file-picker')?.getBoundingClientRect().width),
      reviewInPreview: Boolean(review?.closest('.file-preview-pane')),
      overflow: [...document.querySelectorAll<HTMLElement>('.file-preview-tab-panel:not([hidden]), .agent-run-file-review, .agent-run-file-review-header, .agent-run-file-review-file-picker, .agent-run-file-review-pane-header')]
        .filter((node) => node.getBoundingClientRect().width && node.scrollWidth > node.clientWidth + 1).map(node => node.className),
      headerDrag: region(bar), toggleNoDrag: region(toggle.parentElement) === 'no-drag',
      dragSpace: strip ? toggle.parentElement!.getBoundingClientRect().left - strip.getBoundingClientRect().right : null,
      toggleExpanded: toggle.getAttribute('aria-expanded'), toggleVisible: visible('.file-preview-toggle'),
      separatorVisible: visible('.file-preview-toggle-divider'),
      reviewRequests: [...reviewRequests], fileOpens: [...fileOpens], fileRestores: [...fileRestores],
      campBindings: [...campBindings], fileReads, releases: [...releases]
    }
  },
  conversationSnapshot() {
    const bounds = (selector: string) => {
      const node = element(selector)
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const style = (selector: string, property: string) => getComputedStyle(element(selector)!).getPropertyValue(property)
    const stats = [...document.querySelectorAll<HTMLElement>('.run-file-change-stats')]
    return {
      pane: bounds('.timeline-pane'), track: bounds('.timeline-track'), task: bounds('.task-event-card'), files: bounds('.run-file-changes-card'),
      glyphWidth: bounds('.task-card-glyph')!.width, filesGlyphWidth: bounds('.run-file-changes-card-icon')!.width,
      chevronVisible: visible('.task-card-chevron'), noteLabel: bounds('.task-card-note b'), noteBody: bounds('.task-card-note > span'),
      viewLabel: element('.run-file-changes-card-view')!.textContent,
      fileStatsFit: stats.every(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right < bounds('.run-file-changes-card')!.right),
      fileStats: stats.map(node => node.textContent),
      pathTruncated: element('.run-file-change-file code')!.scrollWidth > element('.run-file-change-file code')!.clientWidth,
      overflows: ['.camp-timeline', '.task-event-card', '.run-file-changes-card', '.composer', '.composer-box', '.composer-action-row', '.approval-dock', '.runtime-recovery-dock']
        .filter(selector => { const node = element(selector); return node && node.scrollWidth > node.clientWidth + 1 }),
      composer: bounds('.composer-box'), attachment: bounds('.composer-attachment-button'), send: bounds('.composer-send'), stop: bounds('.composer-stop'),
      hintVisible: visible('.composer-hint-visual'), viewSwitcherVisible: visible('.camp-conversation-view-controls'), find: bounds('.conversation-find-surface'),
      findOverflow: element('.conversation-find-form') ? element('.conversation-find-form')!.scrollWidth > element('.conversation-find-form')!.clientWidth + 1 : false,
      approval: bounds('.approval-dock'), recovery: bounds('.runtime-recovery-dock'),
      approvalActionsVisible: element('.approval-dock') ? [...document.querySelectorAll('.approval-dock-actions button')]
        .every(button => button.getBoundingClientRect().bottom <= bounds('.approval-dock-scroll')!.bottom) : null,
      approvalHeadingSingleLine: element('.approval-dock') ? ['.approval-dock-heading strong', '.approval-dock-heading span']
        .every(selector => style(selector, 'white-space') === 'nowrap') : null,
      recoveryTextWraps: element('.runtime-recovery-dock') ? style('.runtime-recovery-heading span:not(.runtime-recovery-symbol)', 'white-space') === 'normal' : null,
      codeScrolls: style('.safe-markdown pre', 'overflow-x') === 'auto', tableScrolls: style('.safe-markdown table', 'overflow-x') === 'auto'
    }
  }
} })
