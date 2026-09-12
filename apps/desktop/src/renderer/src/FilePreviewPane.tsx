import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { SafeMarkdown } from './SafeMarkdown'
import { FileFindScope } from './FilePreviewFind'
import { FileFindDomAdapter } from './FileFindDomAdapter'
import { useHtmlFileFind } from './file-find-html'
import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { FileChangesPreview } from './FileChangesPreview'
import { FilePreviewTabIcon, ResourceReferenceIcon } from './FilePreviewTabIcon'
import { ReadonlyCodeViewer } from './ReadonlyCodeViewer'
import { previewPathIsVisible, previewTabLabel, previewTabLabels } from './file-preview-tab-presentation'
import { filePreviewAssetUrl } from '../../file-preview-asset-url'
import { parseUnifiedPatch } from './file-preview-patch'
import { selectPreviewContents } from './file-preview-selection'

function FilePathButton({
  path,
  fileName,
  onReveal
}: {
  path: string
  fileName: string
  onReveal(): void
}): React.JSX.Element {
  const tooltipId = useId()
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const normalized = path.replace(/\\/gu, '/')
  let prefix = ''
  let remainder = normalized
  if (remainder.startsWith('~/')) {
    prefix = '~/'
    remainder = remainder.slice(2)
  } else if (remainder.startsWith('//')) {
    prefix = separator === '\\' ? '\\\\' : '//'
    remainder = remainder.slice(2)
  } else if (/^[A-Za-z]:\//u.test(remainder)) {
    prefix = `${remainder.slice(0, 2)}${separator}`
    remainder = remainder.slice(3)
  } else if (remainder.startsWith('/')) {
    prefix = '/'
    remainder = remainder.slice(1)
  }
  const segments = remainder.split('/').filter(Boolean)
  const suffix = segments.at(-1) ?? fileName
  const directories = segments.slice(0, -1)
  const pathName = directories.length === 0 ? `${prefix}${suffix}` : suffix
  if (directories.length === 0) {
    return <span className="file-preview-path-control">
      <button
        type="button"
        className="file-preview-path-button"
        title={path}
        aria-label={`在文件夹中显示 ${path}`}
        aria-describedby={tooltipId}
        onClick={onReveal}
      ><span className="file-preview-path-parts" aria-hidden="true">
        <strong className="file-preview-path-name">{pathName}</strong>
      </span></button>
      <span className="file-preview-path-tooltip" id={tooltipId} role="tooltip">{path}</span>
    </span>
  }
  const leading = `${prefix}${directories[0]}`
  const trailing = directories.length > 1 ? directories.at(-1) : null
  const middle = directories.length > 2 ? directories.slice(1, -1).join(` ${separator} `) : null
  return (
    <span className="file-preview-path-control">
      <button
        type="button"
        className="file-preview-path-button"
        title={path}
        aria-label={`在文件夹中显示 ${path}`}
        aria-describedby={tooltipId}
        onClick={onReveal}
      ><span className="file-preview-path-parts" aria-hidden="true">
        <span className="file-preview-path-leading">{leading}</span>
        {middle && (
          <>
            <span className="file-preview-path-separator" aria-hidden="true">{separator}</span>
            <span className="file-preview-path-middle">{middle}</span>
          </>
        )}
        {trailing && (
          <>
            <span className="file-preview-path-separator" aria-hidden="true">{separator}</span>
            <span className="file-preview-path-trailing">{trailing}</span>
          </>
        )}
        <span className="file-preview-path-separator" aria-hidden="true">{separator}</span>
        <strong className="file-preview-path-name">{suffix}</strong>
      </span></button>
      <span className="file-preview-path-tooltip" id={tooltipId} role="tooltip">{path}</span>
    </span>
  )
}

function SourceViewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const { resolvedTheme } = useFilePreview()
  const text = tab.content?.kind === 'page' ? tab.content.page.text
    : tab.content && 'text' in tab.content ? tab.content.text : ''
  const startLine = tab.content?.kind === 'page' ? tab.content.page.startLine : 1
  return (
    <ReadonlyCodeViewer
      fileName={tab.presentation.fileName}
      text={text}
      startLine={startLine}
      findScopeLabel={tab.content?.kind === 'page' ? '仅查找当前已加载页' : ''}
      target={tab.file?.target}
      theme={resolvedTheme}
    />
  )
}

function fileSizeLabel(size: number): string {
  if (size < 1_024) return `${size} B`
  if (size < 1_024 * 1_024) return `${(size / 1_024).toFixed(1)} KiB`
  return `${(size / (1_024 * 1_024)).toFixed(1)} MiB`
}

function ImageViewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const content = tab.content?.kind === 'image' ? tab.content : null
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [scale, setScale] = useState<number | null>(null)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setDimensions(null)
    setScale(null)
    setImageError(false)
  }, [content?.url])

  if (!content) return <div className="file-preview-empty-content" />
  if (imageError) {
    return (
      <div className="file-preview-error" role="alert">
        <strong>无法显示图片</strong>
        <span>可以从文件标签页菜单使用系统默认应用打开。</span>
      </div>
    )
  }
  const effectiveScale = scale ?? 1
  const scaledStyle = scale !== null && dimensions
    ? {
        width: dimensions.width * effectiveScale,
        height: dimensions.height * effectiveScale,
        maxWidth: 'none',
        maxHeight: 'none'
      }
    : undefined
  const changeScale = (factor: number): void => {
    setScale((current) => Math.min(8, Math.max(.1, (current ?? 1) * factor)))
  }
  return (
    <div className="file-preview-image-stage">
      <img
        src={content.url}
        alt={tab.presentation.fileName}
        draggable={false}
        style={scaledStyle}
        onLoad={(event) => setDimensions({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight
        })}
        onError={() => setImageError(true)}
      />
      <div className="file-preview-image-info" aria-live="polite">
        {dimensions ? `${dimensions.width} × ${dimensions.height} · ` : ''}{tab.file ? fileSizeLabel(tab.file.size) : ''}
        {scale === null ? '' : ` · ${Math.round(effectiveScale * 100)}%`}
      </div>
      <div className="file-preview-image-controls" aria-label="图片缩放">
        <button type="button" aria-label="缩小" onClick={() => changeScale(.8)}>−</button>
        <button type="button" onClick={() => setScale(null)}>适应</button>
        <button type="button" onClick={() => setScale(1)}>100%</button>
        <button type="button" aria-label="放大" onClick={() => changeScale(1.25)}>＋</button>
      </div>
    </div>
  )
}

function OpeningIndicator(): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 140)
    return () => window.clearTimeout(timer)
  }, [])
  if (!visible) return null
  return (
    <div className="file-preview-loading" role="status">
      <i aria-hidden="true" />
      <span>正在打开文件</span>
    </div>
  )
}

function HtmlViewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element | null {
  const content = tab.content?.kind === 'html' ? tab.content : null
  const iframeRef = useRef<HTMLIFrameElement>(null)
  useHtmlFileFind(iframeRef, content)
  const { open } = useFilePreview()
  const [linkError, setLinkError] = useState<string | null>(null)
  const fragment = tab.file?.target?.htmlFragment

  const scrollToFragment = (): void => {
    if (!content || !fragment) return
    iframeRef.current?.contentWindow?.postMessage({
      type: 'rovai-preview-fragment',
      tabToken: content.tabToken,
      fragment
    }, '*')
  }

  useEffect(() => {
    if (!content || !fragment) return undefined
    const frame = window.requestAnimationFrame(scrollToFragment)
    return () => window.cancelAnimationFrame(frame)
  }, [content, fragment])

  useEffect(() => {
    if (!content) return undefined
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object' || Array.isArray(data)) return
      const message = data as Record<string, unknown>
      if (
        message.type === 'rovai-preview-fragment-result'
        && message.tabToken === content.tabToken
        && message.bridgeToken === content.bridgeToken
        && typeof message.found === 'boolean'
      ) {
        setLinkError(message.found ? null : '未找到指定的页内位置，已保持在文件顶部。')
        return
      }
      if (
        message.type !== 'rovai-preview-link'
        || message.tabToken !== content.tabToken
        || message.bridgeToken !== content.bridgeToken
        || typeof message.href !== 'string'
        || message.href.length === 0
        || message.href.length > 4_096
      ) return
      if (/^[a-z][a-z0-9+.-]*:/iu.test(message.href) && !message.href.startsWith('file:')) {
        setLinkError('预览中的外部链接已阻止。')
        return
      }
      if (!tab.file) return
      void open({
        kind: 'child_of_handle',
        parentHandleId: tab.file.handleId,
        rawReference: message.href,
        allowSystemOpen: true
      }).then((outcome) => {
        setLinkError(outcome.kind === 'error' ? outcome.error.message : null)
      })
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [content, open, tab.file])

  if (!content || !tab.file) return null
  return (
    <div className="file-preview-html-stage">
      <iframe
        ref={iframeRef}
        className="file-preview-html"
        title={`${tab.presentation.fileName} HTML 预览`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={content.html}
        onLoad={scrollToFragment}
      />
      {linkError && <p className="file-preview-html-error" role="alert">{linkError}</p>}
    </div>
  )
}

function PatchViewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const text = tab.content && 'text' in tab.content ? tab.content.text : ''
  const patch = useMemo(() => parseUnifiedPatch(text), [text])
  const { open } = useFilePreview()
  const [linkError, setLinkError] = useState<string | null>(null)
  if (!patch) return <SourceViewer tab={tab} />

  const scrollTo = (id: string): void => {
    document.getElementById(`${tab.id}-${id}`)?.scrollIntoView({ block: 'start' })
  }
  const openFile = (rawReference: string | null): void => {
    if (!rawReference || !tab.file) return
    void open({
      kind: 'child_of_handle',
      parentHandleId: tab.file.handleId,
      rawReference,
      allowSystemOpen: true
    }).then((outcome) => {
      setLinkError(outcome.kind === 'error' ? outcome.error.message : null)
    })
  }

  return (
    <div className="file-preview-patch" ref={root} tabIndex={0}
      onKeyDown={(event) => selectPreviewContents(event, event.currentTarget.querySelector('.file-preview-patch-document'))}>
      <FileFindDomAdapter root={root} selector=".file-preview-patch-line:not(.is-metadata) code" revision={text} />
      <nav className="file-preview-patch-outline" aria-label="补丁目录">
        {patch.files.map((file) => (
          <div key={file.id}>
            <button type="button" title={file.displayPath} onClick={() => scrollTo(file.id)}>
              {file.displayPath}
            </button>
            {file.hunks.map((hunk) => (
              <button
                className="file-preview-patch-hunk-link"
                type="button"
                key={hunk.id}
                title={hunk.header}
                onClick={() => scrollTo(hunk.id)}
              >
                {hunk.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="file-preview-patch-document">
        {linkError && <p className="file-preview-inline-error" role="alert">{linkError}</p>}
        {patch.files.map((file) => (
          <section id={`${tab.id}-${file.id}`} className="file-preview-patch-file" key={file.id}>
            <header>
              <button
                type="button"
                disabled={!file.rawReference}
                title={file.rawReference ? `打开 ${file.displayPath}` : undefined}
                onClick={() => openFile(file.rawReference)}
              >
                {file.displayPath}
              </button>
            </header>
            {file.metadata.length > 0 && (
              <pre className="file-preview-patch-metadata">{file.metadata.join('\n')}</pre>
            )}
            {file.hunks.map((hunk) => (
              <article id={`${tab.id}-${hunk.id}`} className="file-preview-patch-hunk" key={hunk.id}>
                <h3>{hunk.header}</h3>
                <div>
                  {hunk.lines.map((line, index) => (
                    <div className={`file-preview-patch-line is-${line.kind}`} key={`${index}:${line.text}`}>
                      <span aria-label={line.oldLine === null ? '' : `旧文件第 ${line.oldLine} 行`}>
                        {line.oldLine ?? ''}
                      </span>
                      <span aria-label={line.newLine === null ? '' : `新文件第 ${line.newLine} 行`}>
                        {line.newLine ?? ''}
                      </span>
                      <code>{line.text || ' '}</code>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function Viewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const { open, resolvedTheme } = useFilePreview()
  const [linkError, setLinkError] = useState<string | null>(null)
  const file = tab.file
  if (!tab.content || !file) return <div className="file-preview-empty-content" />
  if (tab.content.kind === 'markdown') {
    return (
      <div className="file-preview-markdown" ref={root} tabIndex={0}
        onKeyDown={(event) => selectPreviewContents(event, event.currentTarget.querySelector('.safe-markdown'))}>
        <FileFindDomAdapter root={root} selector=".safe-markdown" revision={tab.content} />
        {linkError && <p className="file-preview-inline-error" role="alert">{linkError}</p>}
        <SafeMarkdown
          mode="document"
          theme={resolvedTheme}
          headingTarget={file.target?.heading}
          onHeadingTargetResult={(found) => setLinkError(found ? null : '未找到指定的标题，已保持在文件顶部。')}
          localImageUrl={file.capabilities.includes('preview_asset') ? (rawReference) => filePreviewAssetUrl(
            rawReference,
            tab.content?.kind === 'markdown' ? tab.content.tabToken : '',
            tab.content?.kind === 'markdown' ? tab.content.assetBasePath : ''
          ) : undefined}
          onFileReference={(rawReference, _source, target) => {
            void open({
              kind: 'child_of_handle',
              parentHandleId: file.handleId,
              rawReference,
              allowSystemOpen: true
            }, target).then((outcome) => {
              setLinkError(outcome.kind === 'error' ? outcome.error.message : null)
            })
          }}
        >
          {tab.content.text}
        </SafeMarkdown>
      </div>
    )
  }
  if (tab.content.kind === 'html') {
    return <HtmlViewer tab={tab} />
  }
  if (tab.content.kind === 'image') {
    return <ImageViewer tab={tab} />
  }
  if (tab.content.kind === 'patch') {
    return <PatchViewer tab={tab} />
  }
  return <SourceViewer tab={tab} />
}

function FilePreviewDocument({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const { reload, changePage, revealInFolder } = useFilePreview()
  const [pathActionError, setPathActionError] = useState<string | null>(null)
  useEffect(() => setPathActionError(null), [tab.file?.handleId, tab.id])
  const page = tab.content?.kind === 'page' ? tab.content.page : null
  const showPath = tab.loadState === 'ready' && previewPathIsVisible(tab.presentation)
  const showUpdate = tab.loadState === 'ready' && Boolean(tab.file)
    && (tab.hasExternalUpdate || tab.isRefreshing)
  const updateAction = showUpdate ? (
    <button
      className="file-preview-update-action"
      type="button"
      disabled={tab.isRefreshing}
      onClick={() => void reload(tab.id)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5.5V2.8l-1.2 1.1A5.4 5.4 0 1 0 13.2 9" /></svg>
      {tab.isRefreshing ? '正在重新加载' : '有更新'}
    </button>
  ) : null
  return (
    <>
      {showPath && <div className="file-preview-path-row">
        <FilePathButton
          path={tab.presentation.displayPath}
          fileName={tab.presentation.fileName}
          onReveal={() => {
            setPathActionError(null)
            void revealInFolder(tab.id).then((result) => {
              setPathActionError(result.ok ? null : result.error.message)
            }).catch(() => {
              setPathActionError('暂时无法显示这个文件的位置')
            })
          }}
        />
        {pathActionError && <span className="file-preview-path-error" role="alert" title={pathActionError}>
          {pathActionError}
        </span>}
        {updateAction}
      </div>}
      {!showPath && updateAction && <div className="file-preview-update-row">{updateAction}</div>}
      <div className="file-preview-content">
        {tab.loadState === 'opening' && !tab.content && (
          <OpeningIndicator />
        )}
        {['missing', 'unavailable', 'error'].includes(tab.loadState) && !tab.content && (
          <div className="file-preview-recovery-stage">
            <div className="file-preview-recovery" role="status" aria-live="polite">
              <ResourceReferenceIcon kind="file" className="file-preview-recovery-icon" />
              <p>{tab.error?.message ?? '暂时无法读取文件'}</p>
            </div>
          </div>
        )}
        {tab.content && <Viewer tab={tab} />}
        {tab.refreshError && (
          <div className="file-preview-refresh-error" role="alert">
            <span>重新加载失败</span>
            <button type="button" onClick={() => void reload(tab.id)}>重试</button>
          </div>
        )}
      </div>
      {page && (
        <footer className="file-preview-page-controls">
          <span>第 {page.startLine} 行起</span>
          <div>
            <button type="button" disabled={!page.hasPrevious} onClick={() => void changePage(tab.id, -1)}>上一页</button>
            <button type="button" disabled={!page.hasNext} onClick={() => void changePage(tab.id, 1)}>下一页</button>
          </div>
        </footer>
      )}
    </>
  )
}

export function FilePreviewPane(): React.JSX.Element {
  const { tabs, activeTabId, paneVisible } = useFilePreview()
  const tabLabels = useMemo(() => previewTabLabels(tabs), [tabs])
  return (
    <section id="file-preview-pane" className="file-preview-pane" hidden={!paneVisible} aria-label="文件预览">
      {tabs.length === 0 && <div className="file-preview-empty">
        <FilePreviewTabIcon kind="text" />
        <h2>选择一个文件预览</h2>
        <p>点击会话中的文件链接或 File Change 卡片，在这里查看文件和变更。</p>
      </div>}
      {tabs.map((tab) => <section
        key={tab.id}
        id={`file-preview-panel-${tab.id}`}
        className="file-preview-tab-panel"
        hidden={tab.id !== activeTabId}
        role="tabpanel"
        tabIndex={0}
        aria-label={tabLabels.get(tab.id) ?? previewTabLabel(tab)}
        aria-labelledby={`file-preview-tab-${tab.id}`}
      >
        <FileFindScope id={tab.id}>{tab.kind === 'file_change' ? <FileChangesPreview tab={tab} /> : <FilePreviewDocument tab={tab} />}</FileFindScope>
      </section>)}
    </section>
  )
}
