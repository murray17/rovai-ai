import { useEffect, useMemo, useRef, useState } from 'react'
import { HtmlPreviewHostChannel } from '../../../../../packages/html-preview/src/host-channel'
import { htmlPreviewDiagnosticKey, parseHtmlPreviewDiagnostic, validPreviewOrigin, type HtmlPreviewDiagnostic } from '../../../../../packages/html-preview/src/protocol'
import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { HtmlPreviewSource } from './HtmlPreviewSource'
import { useHtmlFileFind } from './file-find-html'

type DocumentState = 'loading' | 'loaded' | 'unresponsive' | 'failed'
type ChannelState = 'waiting' | 'connected' | 'unavailable'
const labels = { script: '脚本错误', promise: '异步脚本错误', resource: '资源加载失败', policy: '浏览器策略阻止', document: '页面加载失败', channel: '诊断通道不可用' }

export function HtmlViewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element | null {
  const content = tab.content?.kind === 'html' ? tab.content : null
  const preview = content?.preview
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const channel = useMemo(() => preview ? new HtmlPreviewHostChannel(preview, () => iframeRef.current?.contentWindow ?? null) : null, [preview])
  const [sourceMode, setSourceMode] = useState(false)
  useHtmlFileFind(iframeRef, sourceMode ? null : channel)
  const { open, reload, resolvedTheme } = useFilePreview()
  const [documentState, setDocumentState] = useState<DocumentState>('loading')
  const [channelState, setChannelState] = useState<ChannelState>('waiting')
  const [diagnostics, setDiagnostics] = useState<HtmlPreviewDiagnostic[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const loaded = useRef(false)
  const fragment = tab.file?.target?.htmlFragment
  const retry = (): void => { void reload(tab.id) }

  useEffect(() => {
    if (!channel || !preview) return
    loaded.current = false; setDocumentState('loading'); setChannelState('waiting'); setDiagnostics([]); setFailure(null); setNotice(null)
    let timer: ReturnType<typeof setTimeout> | null = null
    const documentTimer = setTimeout(() => {
      if (loaded.current) return
      if (channel.connected) {
        setDocumentState('unresponsive'); setNotice('页面尚未完成加载。已显示的内容会保留，你可以重试。')
      } else { setDocumentState('failed'); setFailure('未收到预览响应。页面或预览服务可能无法加载。') }
    }, 12_000)
    const wait = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        setChannelState('unavailable')
        if (!loaded.current) { setDocumentState('failed'); setFailure('未收到预览响应。页面或预览服务可能无法加载。') }
        else setNotice('未收到预览诊断响应，无法确认脚本运行状态。')
      }, 12_000)
    }
    const unsubscribe = channel.subscribe(message => {
      if (message.type === 'connecting') { setChannelState('waiting'); wait(); return }
      if (message.type === 'connected') {
        if (timer) clearTimeout(timer)
        setChannelState('connected'); setDiagnostics([]); setNotice(null); setFailure(null)
        return
      }
      if (message.type === 'state' && ['loading', 'loaded', 'failed'].includes(String(message.document))) {
        setDocumentState(message.document as DocumentState)
        if (message.document === 'loaded') { clearTimeout(documentTimer); loaded.current = true; if (fragment) channel.send('fragment', { fragment }) }
        if (message.document === 'failed') setFailure(typeof message.message === 'string' ? message.message.slice(0, 2000) : '无法加载页面。')
      } else if (message.type === 'diagnostic') {
        const diagnostic = parseHtmlPreviewDiagnostic(message.diagnostic, preview)
        if (diagnostic) setDiagnostics(items => items.length >= 100 || items.some(item => htmlPreviewDiagnosticKey(item) === htmlPreviewDiagnosticKey(diagnostic)) ? items : [...items, diagnostic])
      } else if (message.type === 'channel-unavailable') setChannelState('unavailable')
      else if (message.type === 'fragment-result' && typeof message.found === 'boolean') setNotice(message.found ? null : '未找到指定的页内位置。')
      else if (message.type === 'link' && typeof message.href === 'string' && message.href.startsWith('file:') && message.href.length <= 4096 && tab.file) {
        void open({ kind: 'child_of_handle', parentHandleId: tab.file.handleId, rawReference: message.href, allowSystemOpen: true })
          .then(outcome => setNotice(outcome.kind === 'error' ? outcome.error.message : null))
      }
    })
    let detach: (() => void) | undefined
    try { detach = channel.attach(window) } catch (error) { setDocumentState('failed'); setFailure(error instanceof Error ? error.message : '无法建立预览。') }
    return () => { unsubscribe(); detach?.(); if (timer) clearTimeout(timer); clearTimeout(documentTimer) }
  }, [channel, preview, open, tab.file, fragment])

  useEffect(() => { if (fragment) channel?.send('fragment', { fragment }) }, [channel, fragment])
  if (!preview || !tab.file) return null
  const safe = validPreviewOrigin(preview, window.location.origin)
  const scriptFailed = diagnostics.some(item => item.kind === 'script' || item.kind === 'promise')
  const resourceFailed = diagnostics.some(item => item.kind === 'resource' || item.kind === 'policy')
  const summary = documentState === 'unresponsive' ? '页面尚未完成加载' : diagnostics.length ? `此页面有 ${diagnostics.length} 项加载问题` : documentState === 'loading' ? '页面加载中…' : channelState === 'connected' ? '页面已加载' : '未收到预览响应'
  return <div className="file-preview-html-stage" data-document-state={documentState} data-script-state={scriptFailed ? 'error' : 'no-error-observed'} data-resource-state={resourceFailed ? 'partial-failure' : 'no-error-observed'} data-channel-state={channelState}>
    <div className="file-preview-html-status">
      <details>
        <summary><span role="status">{summary}</span><span className="file-preview-html-detail-label">查看详情</span></summary>
        <div className="file-preview-html-diagnostics">
          <p>文档：{documentState === 'loaded' ? '已加载' : documentState === 'failed' ? '加载失败' : documentState === 'unresponsive' ? '尚未完成加载' : '加载中'} · 脚本：{scriptFailed ? '已发现运行错误' : '尚未发现异常'} · 资源：{resourceFailed ? '部分资源失败' : '尚未发现失败'} · 诊断：{channelState === 'connected' ? '已连接' : channelState === 'waiting' ? '尚未响应' : '不可用'}</p>
          {diagnostics.length > 0 && <ol>{diagnostics.map((item, index) => <li key={index}>
            <strong>{labels[item.kind]}</strong>：{item.message}
            {item.resourceUrl && <div>{item.resourceUrl}{item.line ? `:${item.line}${item.column ? `:${item.column}` : ''}` : '（位置未知）'}</div>}
            {item.stack && <pre>{item.stack}</pre>}
          </li>)}</ol>}
          {diagnostics.length === 100 && <p>已达到 100 项记录上限。</p>}
        </div>
      </details>
      <button type="button" aria-pressed={sourceMode} onClick={() => setSourceMode(!sourceMode)}>{sourceMode ? '交互预览' : '查看源码'}</button>
      {(channelState === 'unavailable' || documentState === 'unresponsive') && <button type="button" onClick={retry} disabled={tab.isRefreshing}>重试</button>}
    </div>
    {notice && <p className="file-preview-html-notice" role="status">{notice}</p>}
    {sourceMode && <HtmlPreviewSource key={preview.generation} file={tab.file} theme={resolvedTheme} />}
    {safe && <iframe hidden={sourceMode} ref={iframeRef} className="file-preview-html" title={`${tab.presentation.fileName} HTML 预览`}
      src={preview.entryUrl} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"
      onLoad={() => { loaded.current = true; setDocumentState(state => state === 'failed' ? state : 'loaded'); channel?.connect() }}
      onError={() => { setDocumentState('failed'); setFailure('无法加载预览页面。') }} />}
    {!sourceMode && (documentState === 'failed' || !safe) && <div className="file-preview-error file-preview-html-failure" role="alert">
      <strong>无法加载 HTML 预览</strong><p>{failure ?? '预览站点未与主应用隔离。'}</p><button type="button" onClick={retry} disabled={tab.isRefreshing}>{tab.isRefreshing ? '重试中…' : '重试'}</button>
    </div>}
  </div>
}
