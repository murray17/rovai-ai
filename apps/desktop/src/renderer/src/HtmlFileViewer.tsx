import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { HtmlPreviewHostChannel } from '../../../../../packages/html-preview/src/host-channel'
import { htmlPreviewDiagnosticKey, parseHtmlPreviewDiagnostic, validPreviewOrigin, type HtmlPreviewDiagnostic } from '../../../../../packages/html-preview/src/protocol'
import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { HtmlPreviewSource } from './HtmlPreviewSource'
import { useHtmlFileFind } from './file-find-html'
import { HtmlPreviewLoadState, type HtmlPreviewLoadSnapshot } from './file-preview-html-load'
import { UiText, uiAttribute } from './interface-language'

const labels = { script: '脚本错误', promise: '异步脚本错误', resource: '资源加载失败', policy: '浏览器策略阻止', document: '页面加载失败', channel: '诊断通道不可用' }

export function HtmlViewer({ tab, pathControl, updateAction }: {
  tab: FilePreviewTabModel; pathControl: ReactNode; updateAction: ReactNode
}): React.JSX.Element {
  const versions = [{ file: tab.file, content: tab.content, candidate: false },
    ...(tab.candidate ? [{ file: tab.candidate.file, content: tab.candidate.loaded.content, candidate: true }] : [])]
  return <>{versions.map(version => <div key={version.file?.handleId ?? tab.id}
    className="file-preview-html-version" hidden={version.candidate} inert={version.candidate}>
    <HtmlPageViewer tab={{ ...tab, file: version.file, content: version.content }}
      candidate={version.candidate} pathControl={pathControl} updateAction={updateAction} />
  </div>)}</>
}

function HtmlPageViewer({ tab, pathControl, updateAction, candidate }: {
  candidate: boolean
  tab: FilePreviewTabModel
  pathControl: ReactNode
  updateAction: ReactNode
}): React.JSX.Element | null {
  const content = tab.content?.kind === 'html' ? tab.content : null
  const preview = content?.preview
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const channel = useMemo(() => preview ? new HtmlPreviewHostChannel(preview, () => iframeRef.current?.contentWindow ?? null) : null, [preview])
  const sourceMode = !candidate && Boolean(tab.htmlSourceMode)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  useHtmlFileFind(iframeRef, sourceMode || candidate ? null : channel)
  const { open, reload, toggleHtmlSource, resolvedTheme, completeHtmlRefresh, saveReading, displayed } = useFilePreview()
  const [loadState, setLoadState] = useState<HtmlPreviewLoadSnapshot>({ documentId: null, document: 'loading', channel: 'waiting', serverDiagnostics: 'waiting', serverDiagnosticsReason: null, failure: null, notice: null })
  const { document: documentState, channel: channelState, failure } = loadState
  const load = useRef<HtmlPreviewLoadState | null>(null)
  const [diagnostics, setDiagnostics] = useState<HtmlPreviewDiagnostic[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const fragment = tab.reading ? undefined : tab.file?.target?.htmlFragment
  const current = useRef({ file: tab.file, fragment, reading: tab.reading, candidate })
  current.current = { file: tab.file, fragment, reading: tab.reading, candidate }
  const retry = (): void => { void reload(tab.id) }

  useEffect(() => {
    if (!channel || !preview) return
    const state = new HtmlPreviewLoadState(setLoadState, preview.sandboxedDocument === undefined)
    load.current = state; setDiagnostics([]); setNotice(null); setDetailsOpen(false)
    let positionedDocument: string | null = null
    const unsubscribe = channel.subscribe(message => {
      if (message.type === 'connecting') { state.connecting(); return }
      if (message.type === 'connected' && typeof message.documentId === 'string') {
        if (state.connected(message.documentId)) { setDiagnostics([]); setNotice(null); setDetailsOpen(false) }
        return
      }
      if (message.type === 'state' && typeof message.documentId === 'string' && ['loading', 'loaded', 'failed'].includes(String(message.document))) {
        state.state(message.documentId, message.document as 'loading' | 'loaded' | 'failed', typeof message.message === 'string' ? message.message : undefined)
        if (message.document === 'loaded' && positionedDocument !== message.documentId) {
          positionedDocument = message.documentId
          if (current.current.fragment) channel.send('fragment', { fragment: current.current.fragment })
          else if (current.current.reading) channel.send('restore-reading', {
            top: current.current.reading.htmlScrollTop ?? 0, left: current.current.reading.htmlScrollLeft ?? 0
          })
        }
      } else if (message.type === 'reading-position' && !current.current.candidate
        && typeof message.top === 'number' && Number.isFinite(message.top) && message.top >= 0
        && typeof message.left === 'number' && Number.isFinite(message.left) && message.left >= 0) {
        saveReading(tab.id, { htmlScrollTop: message.top, htmlScrollLeft: message.left })
      } else if (message.type === 'diagnostic') {
        const diagnostic = parseHtmlPreviewDiagnostic(message.diagnostic, preview)
        if (diagnostic) setDiagnostics(items => {
          const index = items.findIndex(item => htmlPreviewDiagnosticKey(item) === htmlPreviewDiagnosticKey(diagnostic))
          if (index >= 0) return diagnostic.status != null && items[index].status == null ? items.map((item, offset) => offset === index ? diagnostic : item) : items
          return items.length >= 100 ? items : [...items, diagnostic]
        })
      } else if (message.type === 'server-diagnostics' && typeof message.documentId === 'string'
        && (message.state === 'waiting' || message.state === 'connected' || message.state === 'unavailable')) {
        state.serverDiagnostics(message.documentId, message.state, message.reason)
      } else if (message.type === 'fragment-result' && typeof message.found === 'boolean') setNotice(message.found ? null : uiAttribute('未找到指定的页内位置。'))
      else if (message.type === 'link' && typeof message.href === 'string' && message.href.startsWith('file:') && message.href.length <= 4096 && current.current.file) {
        void open({ kind: 'child_of_handle', parentHandleId: current.current.file.handleId, rawReference: message.href, allowSystemOpen: true })
          .then(outcome => setNotice(outcome.kind === 'error' ? outcome.error.message : null))
      }
    })
    let detach: (() => void) | undefined
    try { detach = channel.attach(window) } catch (error) { state.failed(error instanceof Error ? error.message : uiAttribute('无法建立预览。')) }
    return () => { unsubscribe(); detach?.(); state.close(); load.current = null }
  }, [channel, preview, open])

  useEffect(() => {
    if (!tab.file) return
    if (!candidate) { displayed(tab.id, tab.file.handleId); return }
    if (documentState === 'loaded' && channelState === 'connected') completeHtmlRefresh(tab.id, tab.file.handleId)
    else if (['failed', 'unresponsive', 'unconfirmed'].includes(documentState) || channelState === 'unavailable')
      completeHtmlRefresh(tab.id, tab.file.handleId, failure ?? uiAttribute('无法确认新页面已加载，旧预览已保留。'))
  }, [candidate, tab.id, tab.file?.handleId, documentState, channelState, failure, completeHtmlRefresh, displayed])

  useEffect(() => { if (fragment) channel?.send('fragment', { fragment }) }, [channel, fragment])
  const safe = Boolean(preview && validPreviewOrigin(preview, window.location.origin))
  const currentDiagnostics = loadState.documentId ? diagnostics : []
  const scriptFailed = currentDiagnostics.some(item => item.kind === 'script' || item.kind === 'promise')
  const resourceFailed = currentDiagnostics.some(item => item.kind === 'resource' || item.kind === 'policy')
  const documentFailed = documentState === 'failed' || !safe
  const hasProblem = documentFailed || Boolean(tab.refreshError) || currentDiagnostics.length > 0
    || channelState === 'unavailable' || documentState === 'unresponsive' || documentState === 'unconfirmed'
  const diagnosticsUnavailable = loadState.serverDiagnostics === 'unavailable'
  const hasDetails = hasProblem || diagnosticsUnavailable
  useEffect(() => { if (!hasDetails) setDetailsOpen(false) }, [hasDetails])
  if (!preview || !tab.file) return null
  const status = tab.isRefreshing ? uiAttribute('重新加载中…') : documentFailed ? uiAttribute('加载失败') : tab.refreshError ? uiAttribute('重新加载失败')
    : documentState === 'unconfirmed' || channelState === 'unavailable' ? uiAttribute('状态未确认')
      : documentState === 'unresponsive' ? uiAttribute('加载未完成') : documentState === 'loading' ? uiAttribute('加载中…') : ''
  const summary = [status, currentDiagnostics.length ? uiAttribute("{0} 项问题", String(currentDiagnostics.length)) : ''].filter(Boolean).join(' · ')
  const expanded = hasDetails && detailsOpen
  const feedback = hasDetails ? <button type="button" className={`file-preview-html-feedback${hasProblem ? ' is-problem' : ''}`}
    aria-expanded={expanded} aria-controls={detailsId} onClick={() => setDetailsOpen(!detailsOpen)}>
    {hasProblem && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Z M8 5.5v4 M8 11.5v.5" /></svg>}
    {summary ||uiAttribute("诊断详情")}
    <svg className="file-preview-html-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d={expanded ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'} /></svg>
  </button> : summary && <span className="file-preview-html-feedback">{summary}</span>
  return <div className="file-preview-html-stage" data-document-state={documentState} data-script-state={scriptFailed ? 'error' : 'no-error-observed'} data-resource-state={resourceFailed ? 'partial-failure' : 'no-error-observed'} data-channel-state={channelState} data-server-diagnostics-state={loadState.serverDiagnostics}>
    <span className="sr-only" role="status">{summary}</span>
    {(pathControl || feedback || updateAction) && <div className={pathControl ? 'file-preview-path-row' : 'file-preview-html-feedback-row'}>
      {pathControl}
      {updateAction}
      {feedback}
      {pathControl && <button type="button" className="file-preview-html-source-toggle" aria-pressed={sourceMode}
        onClick={() => toggleHtmlSource(tab.id)}>{sourceMode ? uiAttribute("交互预览") : uiAttribute("源码")}</button>}
    </div>}
    {hasDetails && <div id={detailsId} className="file-preview-html-diagnostics" hidden={!expanded}>
      {tab.refreshError && <p role="alert"><UiText zh={"重新加载失败："} />{tab.refreshError}<UiText zh={"。已显示的内容会保留。"} /></p>}
      {loadState.notice && <p className="file-preview-html-notice">{loadState.notice}</p>}
      {diagnosticsUnavailable && <p className="file-preview-html-notice"><UiText zh={loadState.serverDiagnosticsReason === 'policy' ? "资源诊断受此页面策略限制，部分诊断信息不可用。" : "资源诊断连接中断，部分资源错误信息可能不完整"} /></p>}
      <p><UiText zh={"文档："} />{documentState === 'loaded' ? uiAttribute("已加载") : documentState === 'failed' ? uiAttribute("加载失败") : documentState === 'unresponsive' ? uiAttribute("尚未完成加载") : documentState === 'unconfirmed' ? uiAttribute("无法确认") : uiAttribute("加载中")}<UiText zh={" · 脚本："} />{scriptFailed ? uiAttribute("已发现运行错误") : uiAttribute("尚未发现异常")}<UiText zh={" · 资源："} />{resourceFailed ? uiAttribute("部分资源失败") : uiAttribute("尚未发现失败")}<UiText zh={" · 页面通信："} />{channelState === 'connected' ? uiAttribute("已连接") : channelState === 'waiting' ? uiAttribute("尚未响应") : uiAttribute("不可用")}<UiText zh={" · 资源诊断："} />{loadState.serverDiagnostics === 'connected' ? uiAttribute("已连接") : loadState.serverDiagnostics === 'waiting' ? uiAttribute("连接中") : loadState.serverDiagnostics === 'not-applicable' ? uiAttribute("未启用") : uiAttribute("已中断")}</p>
      {currentDiagnostics.length > 0 && <ol>{currentDiagnostics.map((item, index) => <li key={index}>
        <strong>{labels[item.kind]}</strong>：{item.message}
        {item.resourceUrl && <div>{item.resourceUrl}{item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : uiAttribute("（位置未知）")}</div>}
        {item.stack && <pre>{item.stack}</pre>}
      </li>)}</ol>}
      {currentDiagnostics.length === 100 && <p><UiText zh={"已达到 100 项记录上限。"} /></p>}
      {hasProblem && <button type="button" onClick={retry} disabled={tab.isRefreshing}>{tab.isRefreshing ? uiAttribute("重试中…") : uiAttribute("重试")}</button>}
    </div>}
    {notice && <p className="file-preview-html-notice" role="status">{notice}</p>}
    <div className="file-preview-content">
      {sourceMode && <HtmlPreviewSource key={preview.generation} file={tab.file} theme={resolvedTheme} tab={tab} />}
      {safe && <iframe hidden={sourceMode} ref={iframeRef} className="file-preview-html" title={uiAttribute("{0} HTML 预览", String(tab.presentation.fileName))}
        src={preview.entryUrl} sandbox={preview.sandboxedDocument === undefined ? 'allow-scripts allow-same-origin' : 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals'} referrerPolicy="no-referrer"
        onLoad={() => { load.current?.frameLoaded(); channel?.connect() }}
        onError={() => load.current?.failed(uiAttribute('无法加载预览页面。'))} />}
      {!sourceMode && documentFailed && <div className="file-preview-error file-preview-html-failure" role="alert">
        <strong><UiText zh={"无法加载 HTML 预览"} /></strong><p>{failure ?? uiAttribute("预览站点未与主应用隔离。")}</p><button type="button" onClick={retry} disabled={tab.isRefreshing}>{tab.isRefreshing ? uiAttribute("重试中…") : uiAttribute("重试")}</button>
      </div>}
    </div>
  </div>
}
