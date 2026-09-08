import { searchFileDocuments } from '../../../apps/desktop/src/renderer/src/file-find-client'
import { EMPTY_FILE_FIND } from '../../../apps/desktop/src/renderer/src/file-find'
import { isFileFindTarget } from '../../../apps/desktop/src/renderer/src/FilePreviewFind'
import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ActionApprovalView, AgentRunFileChangesDetailView, AgentRunFileChangesView, ComposerDocument, FilePreviewApi, OpenFilePreviewRequest, ResolvedFilePreview, ResolvedTheme, TaskView } from '@contracts'
import { AppHeader } from '../../../apps/desktop/src/renderer/src/App'
import { AgentRunFileChangesTimelineCard, ApprovalDock, RuntimeRecoveryDock, TaskTimelineCard } from '../../../apps/desktop/src/renderer/src/CampWorkspace'
import { FilePreviewProvider, useFilePreview, type FilePreviewContextValue } from '../../../apps/desktop/src/renderer/src/FilePreviewContext'
import { FilePreviewResizeHandle, FilePreviewWorkspace } from '../../../apps/desktop/src/renderer/src/FilePreviewLayout'
import { FilePreviewPane } from '../../../apps/desktop/src/renderer/src/FilePreviewPane'
import { FileReferenceLink } from '../../../apps/desktop/src/renderer/src/FileReferenceLink'
import { StructuredMentionComposer } from '../../../apps/desktop/src/renderer/src/StructuredMentionComposer'
import { FileOperationRow, ModifiedFileRow, ToolCallRow } from '../../../apps/desktop/src/renderer/src/ExecutionToolGroup'
import { buildLiveExecutionProgress } from '../../../apps/desktop/src/shared/execution-presentation'
import { FILE_PREVIEW_RATIO_STORAGE_KEY } from '../../../apps/desktop/src/renderer/src/file-preview-layout'
import { openAgentRunCurrentFilePreview } from '../../../apps/desktop/src/renderer/src/agent-run-file-preview'
import '../../../apps/desktop/src/renderer/src/styles.css'

const file: ResolvedFilePreview = {
  previewKey: 'split-fixture', handleId: 'handle-1', reopenToken: 'reopen-1',
  displayPath: 'src/preview-layout.ts', fileName: 'preview-layout.ts',
  pathPresentation: 'project_relative',
  size: 8_000, mime: 'text/plain', extension: '.ts', kind: 'code',
  hasExternalUpdate: false, contentVersion: { size: 8_000, mtimeMs: 1 },
  contentGeneration: 'generation-1', capabilities: ['read'], target: { line: 120, endLine: 122 }
}
const markdownReference = 'docs/preview-reader.md'
const markdownFile: ResolvedFilePreview = {
  ...file,
  previewKey: 'markdown-reader',
  displayPath: markdownReference,
  fileName: 'preview-reader.md',
  size: 2_000,
  mime: 'text/markdown',
  extension: '.md',
  kind: 'markdown',
  target: { heading: '核心阅读' }
}
const markdownSource = [
  '# 文件预览',
  '',
  '正文以舒适字号呈现，并保留清楚的文档层级。文件**预览**支持跨行内格式查找。',
  '',
  '## 核心阅读',
  '',
  '### 静态代码高亮',
  '',
  '```tsx',
  'const Preview = ({ title }: { title: string }) => <main>{title}</main>',
  '```',
  '',
  '| 项目 | 说明 |',
  '| --- | --- |',
  `| 宽表格 | ${'wideTableColumn'.repeat(40)} |`,
  '',
  '## 后续阅读',
  '',
  '滚轮经过宽表格后仍应继续滚动 Markdown 阅读区。'.repeat(80)
].join('\n')
const tabFiles = ['src/app.ts', 'src/layout.tsx', 'src/theme.ts', 'src/routes.ts', 'src/search.ts',
  'src/settings.tsx', 'src/navigation.ts', 'src/very-long-file-preview-reading-anchor.tsx']
const attachmentNameOnlyReference = 'attachment-preview.ts'
const externalReference = '/Users/fixture/Desktop/Reports/report.ts'
const externalDisplayPath = '~/Desktop/Reports/report.ts'
const pathReferences = [
  'crates/rovai-core/src/acp.rs',
  'workspace-crates-directory/core-runtime-source-and-language-adapters/source-implementations/acp.rs'
]
const missingReference = 'src/missing-report.ts'
const toolPreviewReference = 'src/tool-link-preview.ts'
const readReferences = ['src/index.ts', 'tests/index.ts']
const toolNotices: string[] = []
const readSteps = [readReferences, [toolPreviewReference, toolPreviewReference]].map((paths, index) => {
  const item = buildLiveExecutionProgress([{
    id: `tool-read-${index}`, agentRunId: 'tool-run', eventType: 'activity.completed',
    createdAt: '2026-09-07T00:00:00Z',
    payload: { item: { type: 'commandExecution', status: 'completed',
      command: paths.map(path => `sed -n '1,20p' ${path}`).join('; '),
      commandActions: paths.map(path => ({ type: 'read', path })), aggregatedOutput: '完整读取结果' } }
  }], 'tool-run').items[0]
  if (item.kind !== 'tool') throw new Error('Expected a read tool')
  return item.step
})
const unsupported = async (): Promise<never> => { throw new Error('Unexpected fixture API operation') }
const fileOpens: OpenFilePreviewRequest[] = []
const fileRestores: OpenFilePreviewRequest[] = []
const campBindings: Array<string | null> = []
const releases: string[] = []
const revealCalls: string[] = []
const reviewRequests: Array<{ campId: string; agentRunId: string; executionEpoch: number }> = []
let failNextReview = false
let failNextRead = false
let deferNextRead = false
let deferredReadStarted: (() => void) | null = null
let deferredReadRelease: (() => void) | null = null
let pendingToolOpen: ReturnType<FilePreviewContextValue['open']> | null = null
let fileReads = 0
const htmlHandles = new Set<string>()
const patchHandles = new Set<string>()
const htmlSource = '<h1>HTML 文件预览</h1><p>文件<strong>预览</strong> bridge</p><p hidden>隐藏词</p><p style="display:none">隐藏词</p><button>按钮可见词</button>'
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
    const selected = [...changes.files, ...operationOnlyChanges.files]
      .find((entry) => entry.evidenceFileId === request.evidenceFileId)
    if (!selected) return unsupported()
    target = { ...file, previewKey: `current:${selected.path}`, displayPath: selected.path, fileName: selected.path.split('/').at(-1)! }
  } else if (request.kind === 'message_reference'
    && [...tabFiles, ...pathReferences].includes(request.rawReference)) {
    target = { ...file, previewKey: request.rawReference, displayPath: request.rawReference,
      fileName: request.rawReference.split('/').at(-1)! }
  } else if (request.kind === 'attachment') {
    target = { ...file, previewKey: attachmentNameOnlyReference, displayPath: attachmentNameOnlyReference,
      pathPresentation: 'file_name_only', fileName: attachmentNameOnlyReference }
  } else if (request.kind === 'message_reference' && request.rawReference === externalReference) {
    target = { ...file, previewKey: externalReference, displayPath: externalDisplayPath,
      pathPresentation: 'external', fileName: 'report.ts' }
  } else if (request.kind === 'message_reference' && request.rawReference === markdownReference) {
    target = markdownFile
  } else if (request.kind === 'message_reference' && ['find.patch', 'find.log', 'find.svg'].includes(request.rawReference)) {
    target = { ...file, previewKey: request.rawReference, fileName: request.rawReference, displayPath: request.rawReference, target: undefined,
      kind: request.rawReference === 'find.patch' ? 'patch' : request.rawReference === 'find.log' ? 'paged_text' : 'svg', size: 8 * 1024 * 1024 }
  } else if (request.kind === 'message_reference' && request.rawReference === 'find.html') {
    target = { ...markdownFile, kind: 'html', previewKey: 'html-find', fileName: 'find.html', displayPath: 'find.html', target: undefined }
  } else if (request.kind === 'camp_workspace' && [toolPreviewReference, ...readReferences].includes(request.rawReference)) {
    target = { ...file, previewKey: request.rawReference, displayPath: request.rawReference,
      fileName: request.rawReference.split('/').at(-1)! }
  } else if (request.kind !== 'message_reference' || request.rawReference !== file.displayPath) return unsupported()
  const handleId = crypto.randomUUID()
  if (target.kind === 'html') htmlHandles.add(handleId)
  if (target.kind === 'patch') patchHandles.add(handleId)
  return { ok: true as const, value: { kind: 'file_preview' as const, file: { ...target, handleId } } }
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
  readText: async ({ handleId }) => {
    if (patchHandles.has(handleId)) return { ok: true, value: { text: 'diff --git a/find.ts b/find.ts\n--- a/find.ts\n+++ b/find.ts\n@@ -1,2 +1,2 @@\n unchanged\n-before patch\n+after patch\n\\ No newline at end of file', contentGeneration: file.contentGeneration, contentVersion: file.contentVersion } }
    fileReads += 1
    if (deferNextRead) {
      deferNextRead = false
      deferredReadStarted?.()
      await new Promise<void>((resolve) => { deferredReadRelease = resolve })
    }
    if (failNextRead) {
      failNextRead = false
      return { ok: false, error: { code: 'read_failed', message: 'Fixture read failed.', retryable: true } }
    }
    return { ok: true, value: {
      text: Array.from({ length: 300 }, (_, index) => `const readingLine${index + 1} = "保持会话和文件的阅读位置"${index === 122 ? ' + "long-line"'.repeat(70) : ''}`).join('\n'),
      contentGeneration: file.contentGeneration, contentVersion: file.contentVersion
    } }
  },
  release: async ({ handleId }) => { releases.push(handleId); return { released: true } },
  onExternalUpdate: () => () => {},
  reopen: unsupported, resolveLine: unsupported,
  readPage: async ({ offset }) => ({ ok: true, value: {
    text: offset === 0 ? 'first-page needle' : 'second-page needle', startOffset: offset, endOffset: offset + 1024,
    startLine: offset === 0 ? 1 : 101, hasPrevious: offset > 0, hasNext: offset === 0,
    contentGeneration: file.contentGeneration, contentVersion: file.contentVersion
  } }),
  readBinary: async () => ({ ok: true, value: { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>'), mime: 'image/svg+xml', contentGeneration: file.contentGeneration, contentVersion: file.contentVersion } }),
  prepareHtml: async ({ handleId }) => ({ ok: true, value: {
    html: htmlHandles.has(handleId) ? htmlSource : markdownSource,
    tabToken: 'markdown-tab-token',
    bridgeToken: 'markdown-bridge-token',
    assetBasePath: '',
    contentGeneration: markdownFile.contentGeneration,
    contentVersion: markdownFile.contentVersion
  } }),
  reload: unsupported,
  openInSystem: unsupported,
  revealInFolder: async ({ handleId }) => { revealCalls.push(handleId); return { ok: true, value: { revealed: true } } },
  copyPath: unsupported,
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
const operationOnlyChanges: AgentRunFileChangesView = {
  schemaVersion: 2,
  agentRunId: 'run-operation-only',
  executionEpoch: 1,
  files: [{
    evidenceFileId: 'file-operation-only',
    path: 'src/path-only.ts',
    changeKind: 'update',
    presentationKind: 'operation_only',
    operationCount: 1
  }],
  fileCount: 1,
  operationCount: 1,
  completedAt: '2026-08-30T08:01:00Z'
}
Object.assign(window, { rovai: {
  windowControls: (window as unknown as { previewWindowControls: unknown }).previewWindowControls,
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
  const openCurrent = (targetChanges: AgentRunFileChangesView, evidenceFileId: string): void => {
    void openAgentRunCurrentFilePreview({
      filePreview: preview,
      campId: 'camp-1',
      changes: targetChanges,
      evidenceFileId,
      onError: (message) => toolNotices.push(message)
    })
  }
  const [draft] = useState<ComposerDocument>({
    version: 2,
    segments: [{ kind: 'text', text: '保留这条未发送草稿' }]
  })
  const [findOpen, setFindOpen] = useState(false)
  const [docks, setDocks] = useState<'none' | 'approval' | 'recovery' | 'both'>('none')
  const approvalRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || isFileFindTarget(event.target)) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFindOpen(true) }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
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
              <AgentRunFileChangesTimelineCard changes={changes}
                onOpenReview={(evidenceFileId) => preview.openFileChanges('camp-1', changes, evidenceFileId)}
                onOpenCurrent={(evidenceFileId) => openCurrent(changes, evidenceFileId)} />
              <div data-diff-card="operation-only">
                <AgentRunFileChangesTimelineCard changes={operationOnlyChanges}
                  onOpenReview={(evidenceFileId) => preview.openFileChanges('camp-1', operationOnlyChanges, evidenceFileId)}
                  onOpenCurrent={(evidenceFileId) => openCurrent(operationOnlyChanges, evidenceFileId)} />
              </div>
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
let setFixtureTheme: (theme: ResolvedTheme) => void
let showToolRows: () => void
function ToolRows(): React.JSX.Element {
  return <section id="tool-rows" style={{ position: 'fixed', zIndex: 100, inset: 60, padding: 20, background: 'var(--conversation-surface)' }}>
    <div id="tool-row-content" style={{ width: 420 }}>
      {readSteps.map((step, index) => <div data-tool-case={`read-${index}`} key={step.id}>
        <ToolCallRow campId="camp-1" runId="tool-run" runStatus="succeeded" step={step} onFileOpenError={message => toolNotices.push(message)} />
      </div>)}
      <div data-tool-case="edit">
        <ModifiedFileRow campId="camp-1" semanticKind="unified_diff_snapshot" onFileOpenError={message => toolNotices.push(message)}
          change={{ path: toolPreviewReference, changeKind: 'update', additions: 1, deletions: 1,
            diff: '@@ -1 +1 @@\n-old content\n+new content' }} />
      </div>
      <div data-tool-case="path-only">
        <FileOperationRow campId="camp-1" runStatus="succeeded" onFileOpenError={message => toolNotices.push(message)}
          step={{ ...readSteps[0], shellReadSummary: undefined, fileOperation: { operationKind: 'write', path: toolPreviewReference } }} />
      </div>
    </div>
  </section>
}
function Fixture(): React.JSX.Element {
  const [camp, setCamp] = useState('camp-1')
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('day')
  const [toolRowsVisible, setToolRowsVisible] = useState(false)
  showToolRows = () => { setCamp('camp-1'); setToolRowsVisible(true) }
  switchCamp = () => setCamp((previous) => previous === 'camp-1' ? 'camp-2' : 'camp-1')
  setFixtureTheme = (theme) => {
    document.documentElement.dataset.theme = theme
    setResolvedTheme(theme)
  }
  return <FilePreviewProvider campId={camp} resolvedTheme={resolvedTheme}>
    <div className="app-shell app-shell-camp">
      <aside style={{ gridRow: '1 / -1', padding: '48px 24px', background: 'var(--rail)' }}>Rovai AI</aside>
      <AppHeader campTitle="文件预览验收" contextLabel="Rovai AI" camp={null} onFocusApprovals={() => {}} />
      <main className="content task-content"><Workspace /></main>
    </div>
    {toolRowsVisible && <ToolRows />}
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
let bookmarkedSourceEditor: HTMLElement | null = null
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
  showToolRows: () => showToolRows(),
  toolState: () => ({ requests: [...fileRestores], notices: [...toolNotices], tabs: previewController.tabs.length, activeTabId: previewController.activeTabId }),
  clearToolNotices: () => { toolNotices.splice(0) },
  failNextToolRead: () => { failNextRead = true },
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
  async openAttachment() {
    await previewController.open({
      kind: 'attachment',
      campId: 'camp-1',
      locator: {
        owner: 'message',
        campId: 'camp-1',
        messageId: 'message-1',
        attachmentRefId: 'attachment-1'
      }
    })
    await settle()
  },
  async openExternal() {
    await previewController.open({
      kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference: externalReference
    })
    await settle()
  },
  revealCalls: () => [...revealCalls],
  async openPath(index: number) {
    const rawReference = pathReferences[index]
    if (!rawReference) throw new Error('Unknown fixture path')
    await previewController.open({ kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference })
    await settle()
  },
  async openMarkdown() {
    await previewController.open({
      kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference: markdownReference
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
  async startPendingToolPreview() {
    deferNextRead = true
    const started = new Promise<void>((resolve) => { deferredReadStarted = resolve })
    pendingToolOpen = previewController.open(
      { kind: 'camp_workspace', campId: 'camp-1', rawReference: toolPreviewReference },
      undefined,
      undefined,
      { commitOnSuccess: true, previewOnly: true }
    )
    await started
    await settle()
  },
  async finishPendingToolPreview() {
    if (!pendingToolOpen || !deferredReadRelease) throw new Error('No pending Tool preview read')
    deferredReadRelease()
    const outcome = await pendingToolOpen
    pendingToolOpen = null
    deferredReadStarted = null
    deferredReadRelease = null
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
    const button = path?.querySelector<HTMLButtonElement>('.file-preview-path-button')
    const parts = path?.querySelector<HTMLElement>('.file-preview-path-parts')
    const tooltip = path?.querySelector<HTMLElement>('.file-preview-path-tooltip')
    return {
      pathTitle: button?.title,
      pathLabel: button?.getAttribute('aria-label'),
      pathButton: Boolean(button),
      tooltipText: tooltip?.textContent,
      tooltipVisible: tooltip ? getComputedStyle(tooltip).visibility === 'visible' : false,
      pathOverflow: Boolean(path && path.scrollWidth > path.clientWidth + 1),
      partsRight: parts?.getBoundingClientRect().right,
      segments: [...(parts?.querySelectorAll<HTMLElement>(
        '.file-preview-path-leading, .file-preview-path-middle, .file-preview-path-trailing, .file-preview-path-name'
      ) ?? [])].map((segment) => ({
        text: segment.textContent,
        truncated: segment.scrollWidth > segment.clientWidth + 1,
        right: segment.getBoundingClientRect().right
      })),
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
  async setTheme(theme: ResolvedTheme) { setFixtureTheme(theme); await settle() },
  async find(open: boolean) { showFind(open); await settle() },
  async docks(mode: 'none' | 'approval' | 'recovery' | 'both') { showDocks(mode); await settle() },
  async bookmarkSource() {
    bookmarkedSourceEditor = element('.file-preview-tab-panel:not([hidden]) .cm-editor')
    const scroller = element('.file-preview-tab-panel:not([hidden]) .cm-scroller')
    if (scroller) scroller.scrollTop = 480
    await settle()
  },
  async sourceSnapshot(requireTarget = false) {
    const deadline = performance.now() + 3_000
    while (!element('.file-preview-tab-panel:not([hidden]) .cm-content .cm-line span')
      || (requireTarget && !element('.file-preview-tab-panel:not([hidden]) .cm-location-target'))) {
      if (performance.now() > deadline) throw new Error('Source highlighting did not settle')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const panel = element('.file-preview-tab-panel:not([hidden])')!
    const editor = panel.querySelector<HTMLElement>('.cm-editor')!
    const scroller = panel.querySelector<HTMLElement>('.cm-scroller')!
    const content = panel.querySelector<HTMLElement>('.cm-content')!
    const gutter = panel.querySelector<HTMLElement>('.cm-gutters')!
    const keyword = [...panel.querySelectorAll<HTMLElement>('.cm-line span')]
      .find((span) => span.textContent === 'const')!
    const scrollerBounds = scroller.getBoundingClientRect()
    const firstVisibleLine = [...panel.querySelectorAll<HTMLElement>('.cm-line')].find((line) => {
        const bounds = line.getBoundingClientRect()
        return bounds.bottom > scrollerBounds.top && bounds.top < scrollerBounds.bottom
      })!
    const firstLine = panel.querySelector<HTMLElement>('.cm-location-target') ?? firstVisibleLine
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(firstLine)
    selection.removeAllRanges()
    selection.addRange(range)
    const selectedText = selection.toString()
    selection.removeAllRanges()
    return {
      sameEditor: bookmarkedSourceEditor === editor,
      scrollTop: scroller.scrollTop,
      horizontalScroll: scroller.scrollWidth > scroller.clientWidth,
      fontSize: getComputedStyle(scroller).fontSize,
      fontWeight: getComputedStyle(scroller).fontWeight,
      lineHeight: getComputedStyle(scroller).lineHeight,
      contentPaddingTop: getComputedStyle(content).paddingTop,
      contentEditable: content.getAttribute('contenteditable'),
      readOnly: content.getAttribute('aria-readonly'),
      tabIndex: content.getAttribute('tabindex'),
      gutterColor: getComputedStyle(gutter).color,
      sourceColor: getComputedStyle(content).color,
      keywordColor: getComputedStyle(keyword).color,
      firstVisibleLine: firstVisibleLine.textContent?.match(/readingLine\d+/)?.[0],
      selectedText,
      targetLines: [...panel.querySelectorAll<HTMLElement>('.cm-location-target')].map((line) => line.textContent),
      gutterLines: [...panel.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')].map((line) => line.textContent),
      searchVisible: Boolean(panel.querySelector('.file-find-surface')?.getClientRects().length),
      replaceVisible: Boolean(panel.querySelector('[name="replace"]')),
      searchMatches: panel.querySelectorAll('.cm-searchMatch').length,
      currentMatches: panel.querySelectorAll('.cm-searchMatch-selected').length
    }
  },
  async openFindFixture(rawReference: string) {
    await previewController.open({ kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference })
    await settle()
  },
  async workerSafety() {
    const abort = new AbortController()
    const documents = [{ id: 'hostile', text: 'a'.repeat(100_000) + '!' }]
    const options = { ...EMPTY_FILE_FIND, query: '(a+)+$', regexp: true }
    const cancelled = searchFileDocuments(documents, options, abort.signal).catch(error => error.name)
    abort.abort()
    const timedOut = await searchFileDocuments(documents, options, new AbortController().signal)
    return { cancelled: await cancelled, timeout: timedOut.error }
  },
  async openHtml() {
    await previewController.open({ kind: 'message_reference', campId: 'camp-1', messageId: 'message-1', rawReference: 'find.html' })
    await settle()
    const deadline = performance.now() + 4_000
    while (document.querySelector<HTMLButtonElement>('.file-preview-find-trigger')?.disabled) {
      if (performance.now() > deadline) throw new Error('HTML bridge did not become ready')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await settle()
  },
  findSnapshot() {
    const selected = CSS.highlights.get('rovai-file-find-current')
    const range = selected ? [...selected][0] as Range | undefined : undefined
    return {
      visible: Boolean(document.querySelector('.file-find-surface')),
      query: document.querySelector<HTMLInputElement>('.file-find-form > input')?.value,
      count: document.querySelector('.file-find-count')?.textContent,
      error: document.querySelector('.file-find-error')?.textContent,
      marked: CSS.highlights.get('rovai-file-find-match')?.size ?? 0,
      current: range?.toString(),
      selectedFile: previewController.activeTab?.kind === 'file_change' ? previewController.activeTab.selectedEvidenceFileId : null,
      conversationQuery: document.querySelector<HTMLInputElement>('.conversation-find-form input')?.value,
      nativePanel: Boolean(document.querySelector('.cm-panel.cm-search')),
      toggleBackground: getComputedStyle(element('.file-preview-toggle')!).backgroundColor
    }
  },
  async setSourceSearch(query: string) {
    const input = document.querySelector<HTMLInputElement>('.file-preview-tab-panel:not([hidden]) .file-find-form > input')!
    if (!input) throw new Error('The file find input is not open')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const deadline = performance.now() + 4_000
    do {
      await new Promise(resolve => setTimeout(resolve, 25))
      if (performance.now() > deadline) throw new Error('File find did not settle')
    } while (document.querySelector('.file-find-count')?.textContent === '…' || document.querySelector('.file-find-form > input')?.getAttribute('value') !== query)
    await settle()
  },
  async markdownSnapshot() {
    const deadline = performance.now() + 3_000
    while (!element('.file-preview-tab-panel:not([hidden]) .markdown-code-block span')) {
      if (performance.now() > deadline) throw new Error('Markdown syntax highlighting did not load')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const panel = element('.file-preview-tab-panel:not([hidden])')!
    const documentRoot = panel.querySelector<HTMLElement>('.safe-markdown.is-document')!
    const code = panel.querySelector<HTMLElement>('.markdown-code-block code')!
    const syntax = code.querySelector<HTMLElement>('span')!
    const table = panel.querySelector<HTMLElement>('table')!
    const tableScroll = panel.querySelector<HTMLElement>('.markdown-table-scroll')!
    return {
      bodyFontSize: getComputedStyle(documentRoot).fontSize,
      bodyLineHeight: getComputedStyle(documentRoot).lineHeight,
      h1: getComputedStyle(panel.querySelector('h1')!).fontSize,
      h2: getComputedStyle(panel.querySelector('h2')!).fontSize,
      h3: getComputedStyle(panel.querySelector('h3')!).fontSize,
      codeLanguage: code.dataset.codeLanguage,
      codeFontSize: getComputedStyle(code.parentElement!).fontSize,
      syntaxColor: getComputedStyle(syntax).color,
      sourceColor: getComputedStyle(code).color,
      editorCount: panel.querySelectorAll('.cm-editor').length,
      tableFontSize: getComputedStyle(table).fontSize,
      tableScrolls: tableScroll.scrollWidth > tableScroll.clientWidth,
      documentWidth: documentRoot.getBoundingClientRect().width,
      paneWidth: panel.getBoundingClientRect().width,
      pageOverflow: document.documentElement.scrollWidth > innerWidth
    }
  },
  bookmark() {
    bookmarkedViewer = element('.file-preview-code')!
    element('.file-preview-code .cm-scroller')!.scrollTop = 640
    bookmarkedEditor = element('.structured-mention-editor[contenteditable]')
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
    const viewerScroller = viewer?.querySelector<HTMLElement>('.cm-scroller')
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
      lineWidth: handle ? getComputedStyle(handle).width : null,
      lineColor: handle ? getComputedStyle(handle).backgroundColor : null,
      hintColor: handle ? getComputedStyle(handle.querySelector('.file-preview-splitter-tip')!).color : null,
      aria: handle ? { min: handle.getAttribute('aria-valuemin'), max: handle.getAttribute('aria-valuemax'), now: handle.getAttribute('aria-valuenow') } : null,
      hint: handle?.getAttribute('aria-valuetext'),
      armed: grid.classList.contains('is-file-preview-close-armed'),
      opacity: pane ? getComputedStyle(pane).opacity : null,
      resizing: document.documentElement.classList.contains('file-preview-resizing'),
      focused: (document.activeElement as HTMLElement)?.className,
      sameViewer: bookmarkedViewer === viewer, scroll: viewerScroller?.scrollTop,
      draft: element('.structured-mention-editor[contenteditable]')?.textContent,
      sameEditor: bookmarkedEditor === element('.structured-mention-editor[contenteditable]'),
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
      campBindings: [...campBindings], fileReads, releases: [...releases], notices: [...toolNotices]
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
    const reviewableCard = element('.run-file-changes-card')!
    const stats = [...reviewableCard.querySelectorAll<HTMLElement>('.run-file-change-stats')]
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
