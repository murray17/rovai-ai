import { usePreviewHost } from './FilePreviewContext'
import { FilePreviewTabs } from './FilePreviewTabs'
import { useOptionalFilePreviewLayout } from './FilePreviewLayout'
import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from 'react'
import { MarkdownFilePreview } from './MarkdownFilePreview'
import { FileFindScope } from './FilePreviewFind'
import { FileFindDomAdapter } from './FileFindDomAdapter'
import { HtmlViewer } from './HtmlFileViewer'
import { useFilePreview, useFilePreviewApi, type FilePreviewTabModel } from './FilePreviewContext'
import { FileChangesPreview } from './FileChangesPreview'
import { FilePreviewTabIcon, ResourceReferenceIcon } from './FilePreviewTabIcon'
import { ReadonlyCodeViewer } from './ReadonlyCodeViewer'
import { previewPathIsVisible, previewTabLabel, previewTabLabels } from './file-preview-tab-presentation'
import { filePreviewAssetUrl } from '../../file-preview-asset-url'
import { parseUnifiedPatch } from './file-preview-patch'
import { selectPreviewContents } from './file-preview-selection'
import { UiText, uiAttribute, useInterfaceLanguage } from './interface-language'

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
        aria-label={uiAttribute("在文件夹中显示 {0}", String(path))}
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
        aria-label={uiAttribute("在文件夹中显示 {0}", String(path))}
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
  // Reading samples are mutable snapshots. They may suppress an old target on a
  // cold mount, but must not remove the current highlight on a theme/parent render.
  const target = useMemo(() => tab.reading ? undefined : tab.file?.target, [tab.file?.target])
  const text = tab.content?.kind === 'page' ? tab.content.page.text
    : tab.content && 'text' in tab.content ? tab.content.text : ''
  const startLine = tab.content?.kind === 'page' ? tab.content.page.startLine : 1
  return (
    <ReadonlyCodeViewer
      fileName={tab.presentation.fileName}
      text={text}
      startLine={startLine}
      findScopeLabel={tab.content?.kind === 'page' ? uiAttribute("仅查找当前已加载页") : ''}
      target={target}
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
  const { saveReading } = useFilePreview()
  const [scale, setScale] = useState<number | null>(tab.reading?.imageScale ?? null)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    setDimensions(null)
    setScale(tab.reading?.imageScale ?? null)
    setImageError(false)
  }, [content?.url])

  if (!content) return <div className="file-preview-empty-content" />
  if (imageError) {
    return (
      <div className="file-preview-error" role="alert">
        <strong><UiText zh={"无法显示图片"} /></strong>
        <span><UiText zh={"可以从文件标签页菜单使用系统默认应用打开。"} /></span>
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
    const next = Math.min(8, Math.max(.1, (scale ?? 1) * factor))
    setScale(next); saveReading(tab.id, { imageScale: next })
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
      <div className="file-preview-image-controls" aria-label={uiAttribute("图片缩放")}>
        <button type="button" aria-label={uiAttribute("缩小")} onClick={() => changeScale(.8)}>−</button>
        <button type="button" onClick={() => { setScale(null); saveReading(tab.id, { imageScale: null }) }}><UiText zh={"适应"} /></button>
        <button type="button" onClick={() => setScale(1)}>100%</button>
        <button type="button" aria-label={uiAttribute("放大")} onClick={() => changeScale(1.25)}>＋</button>
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
      <span><UiText zh={"正在打开文件"} /></span>
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
      <nav className="file-preview-patch-outline" aria-label={uiAttribute("补丁目录")}>
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
                title={file.rawReference ? uiAttribute("打开 {0}", String(file.displayPath)) : undefined}
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
                      <span aria-label={line.oldLine === null ? '' : uiAttribute("旧文件第 {0} 行", String(line.oldLine))}>
                        {line.oldLine ?? ''}
                      </span>
                      <span aria-label={line.newLine === null ? '' : uiAttribute("新文件第 {0} 行", String(line.newLine))}>
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
  const headingTarget = tab.reading ? undefined : file?.target?.heading
  const api = useFilePreviewApi()
  const readImage = useCallback((rawReference: string) => {
    if (!file || !api.readChildImage) throw new Error(uiAttribute('图片资源适配不可用。'))
    return api.readChildImage({ handleId: file.handleId, expectedGeneration: file.contentGeneration, rawReference })
  }, [api, file])
  if (!tab.content) return <div className="file-preview-empty-content" />
  if (tab.content.kind === 'markdown' && file) {
    return (
      <div className="file-preview-markdown" ref={root} tabIndex={0}
        onKeyDown={(event) => selectPreviewContents(event, event.currentTarget.querySelector('.file-preview-markdown-document'))}>
        <FileFindDomAdapter root={root} selector=".file-preview-markdown-document" revision={tab.content} />
        {linkError && <p className="file-preview-inline-error" role="alert">{linkError}</p>}
        <MarkdownFilePreview
          source={tab.content.text}
          theme={resolvedTheme}
          headingTarget={headingTarget}
          onHeadingTargetResult={(found) => setLinkError(found ? null : uiAttribute('未找到指定的标题，已保持在文件顶部。'))}
          localImageContent={api.readChildImage && file.capabilities.includes('read_child') ? readImage : undefined}
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
        />
      </div>
    )
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
  const { reload, retry, changePage, revealInFolder, displayed } = useFilePreview()
  const [pathActionError, setPathActionError] = useState<string | null>(null)
  useEffect(() => setPathActionError(null), [tab.file?.handleId, tab.id])
  useEffect(() => { if (tab.file && tab.content && tab.content.kind !== 'html') displayed(tab.id, tab.file.handleId) }, [tab.file?.handleId, tab.content, tab.id, displayed])
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
      {tab.isRefreshing ? uiAttribute("正在重新加载") : uiAttribute("有更新")}
    </button>
  ) : null
  const pathControl = showPath ? <>
    <FilePathButton
      path={tab.presentation.displayPath}
      fileName={tab.presentation.fileName}
      onReveal={() => {
        setPathActionError(null)
        void revealInFolder(tab.id).then((result) => {
          setPathActionError(result.ok ? null : result.error.message)
        }).catch(() => {
          setPathActionError(uiAttribute('暂时无法显示这个文件的位置'))
        })
      }}
    />
    {pathActionError && <span className="file-preview-path-error" role="alert" title={pathActionError}>
      {pathActionError}
    </span>}
  </> : null
  if (tab.content?.kind === 'html') {
    return <HtmlViewer tab={tab} pathControl={pathControl} updateAction={tab.isRefreshing ? null : updateAction} />
  }
  return (
    <>
      {showPath && <div className="file-preview-path-row">
        {pathControl}
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
              <p>{tab.error?.message ?? uiAttribute("暂时无法读取文件")}</p>
              {tab.file?.kind === 'html' && <button type="button" onClick={() => void retry(tab.id)}><UiText zh={"重试"} /></button>}
            </div>
          </div>
        )}
        {tab.content && <Viewer tab={tab} />}
        {tab.refreshError && (
          <div className="file-preview-refresh-error" role="alert">
            <span>{tab.refreshError}</span>
            <button type="button" onClick={() => void reload(tab.id)}><UiText zh={"重试"} /></button>
          </div>
        )}
      </div>
      {page && (
        <footer className="file-preview-page-controls">
          <span><UiText zh={"第 "} />{page.startLine}<UiText zh={" 行起"} /></span>
          <div>
            <button type="button" disabled={!page.hasPrevious} onClick={() => void changePage(tab.id, -1)}><UiText zh={"上一页"} /></button>
            <button type="button" disabled={!page.hasNext} onClick={() => void changePage(tab.id, 1)}><UiText zh={"下一页"} /></button>
          </div>
        </footer>
      )}
    </>
  )
}

function ReadingPanel({ tab, children }: { tab: import('./FilePreviewContext').PreviewTabModel; children: React.ReactNode }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const { saveReading, isCurrentCamp } = useFilePreview()
  const content = tab.kind === 'file'
    ? tab.content
    : tab.kind === 'file_change'
      ? tab.detail
      : tab.kind === 'mission_activity' && isCurrentCamp
        ? tab.missionId
        : null
  const restoring = useRef(false)
  useLayoutEffect(() => {
    if (!tab.reading || !content || !root.current) return
    const reading = { ...tab.reading }
    restoring.current = true
    let frame = 0
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore) })
    const restore = (): void => {
      const node = root.current
      if (!node?.clientHeight) return
      const code = node.querySelector<HTMLElement>('.cm-scroller')
      if (code && !code.clientHeight) return
      if (code) { code.scrollTop = reading.codeScrollTop ?? 0; code.scrollLeft = reading.codeScrollLeft ?? 0 }
      const body = node.querySelector<HTMLElement>('.file-preview-markdown, .file-preview-content, .agent-run-file-review-scroll, .mission-activity-document')
      if (body) { body.scrollTop = reading.scrollTop ?? 0; body.scrollLeft = reading.scrollLeft ?? 0 }
      const image = node.querySelector<HTMLElement>('.file-preview-image-stage')
      if (image) { image.scrollTop = reading.imageScrollTop ?? 0; image.scrollLeft = reading.imageScrollLeft ?? 0 }
      restoring.current = false
      observer.disconnect()
    }
    observer.observe(root.current)
    frame = requestAnimationFrame(restore)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); restoring.current = false }
  }, [content])
  return <div ref={root} className="file-preview-reading-panel" onScrollCapture={event => {
    if (restoring.current || !root.current?.clientHeight || !(event.target instanceof HTMLElement)) return
    const node = event.target
    if (node.classList.contains('cm-scroller')) saveReading(tab.id, { codeScrollTop: node.scrollTop, codeScrollLeft: node.scrollLeft })
    else if (node.classList.contains('file-preview-image-stage')) saveReading(tab.id, { imageScrollTop: node.scrollTop, imageScrollLeft: node.scrollLeft })
    else if ((node.classList.contains('file-preview-markdown') || node.classList.contains('file-preview-content') || node.classList.contains('agent-run-file-review-scroll') || node.classList.contains('mission-activity-document'))) saveReading(tab.id, { scrollTop: node.scrollTop, scrollLeft: node.scrollLeft })
  }}>{children}</div>
}

export function FilePreviewPane({ tabsInPane = false }: { tabsInPane?: boolean }): React.JSX.Element {
  const host = usePreviewHost()
  const { paneVisible } = useFilePreview()
  const layout = useOptionalFilePreviewLayout()
  if (tabsInPane) return <section className="file-preview-pane mission-preview-slot" hidden={!paneVisible}>
    <FilePreviewTabs compact={layout?.compact}/>
    <div ref={host} className="file-preview-anchor mission-preview-body" aria-hidden="true"/>
  </section>
  return <div ref={host} className="file-preview-pane file-preview-anchor" hidden={!paneVisible} aria-hidden="true" />
}

export function FilePreviewPaneContent({ visible, missionActivity, executionHostRef }: {
  visible: boolean
  missionActivity?: React.ReactNode
  executionHostRef?(element: HTMLDivElement | null): void
}): React.JSX.Element {
  const language = useInterfaceLanguage()
  const { tabs, activeTabId, paneVisible } = useFilePreview()
  const tabLabels = useMemo(() => previewTabLabels(tabs, language), [tabs, language])
  return (
    <section id={visible ? "file-preview-pane" : undefined} className="file-preview-pane" hidden={!paneVisible} aria-label={uiAttribute("文件预览")}>
      {tabs.length === 0 && <div className="file-preview-empty">
        <FilePreviewTabIcon kind="text" />
        <h2><UiText zh={"选择一个文件预览"} /></h2>
        <p><UiText zh={"点击会话中的文件链接或 File Change 卡片，在这里查看文件和变更。"} /></p>
      </div>}
      {tabs.map((tab) => <section
        key={tab.id}
        id={`file-preview-panel-${tab.id}`}
        className="file-preview-tab-panel"
        hidden={!visible || tab.id !== activeTabId}
        role="tabpanel"
        tabIndex={0}
        aria-label={tabLabels.get(tab.id) ?? previewTabLabel(tab, language)}
        aria-labelledby={`file-preview-tab-${tab.id}`}
      >
        {tab.kind === 'execution'
          ? <div ref={executionHostRef} className="execution-preview-host" />
          : <ReadingPanel tab={tab}>{tab.kind === 'mission_activity' ? missionActivity : <FileFindScope id={tab.id}>{tab.kind === 'file_change' ? <FileChangesPreview tab={tab} visible={visible && tab.id === activeTabId} /> : <FilePreviewDocument tab={tab} />}</FileFindScope>}</ReadingPanel>}
      </section>)}
    </section>
  )
}
