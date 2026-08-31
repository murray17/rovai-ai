import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { SafeMarkdown } from './SafeMarkdown'
import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { FileChangesPreview } from './FileChangesPreview'
import { FilePreviewTabIcon } from './FilePreviewTabIcon'
import { previewTabLabel } from './file-preview-tab-presentation'
import { filePreviewAssetUrl } from '../../file-preview-asset-url'
import { parseUnifiedPatch } from './file-preview-patch'

function RelativePath({ path, fileName }: { path: string; fileName: string }): React.JSX.Element {
  const normalized = path.replace(/\\/gu, '/')
  const suffix = normalized.endsWith(fileName) ? fileName : normalized.split('/').at(-1) ?? fileName
  const directories = normalized.split('/').filter(Boolean).slice(0, -1)
  if (directories.length === 0) {
    return <span className="file-preview-path-name" title={normalized}>{suffix}</span>
  }
  const leading = directories[0]
  const trailing = directories.length > 1 ? directories.at(-1) : null
  const middle = directories.length > 2 ? directories.slice(1, -1).join(' > ') : null
  return (
    <span className="file-preview-path-parts" title={normalized} aria-label={normalized}>
      <span className="file-preview-path-leading">{leading}</span>
      {middle && (
        <>
          <span className="file-preview-path-separator" aria-hidden="true">&gt;</span>
          <span className="file-preview-path-middle">{middle}</span>
        </>
      )}
      {trailing && (
        <>
          <span className="file-preview-path-separator" aria-hidden="true">&gt;</span>
          <span className="file-preview-path-trailing">{trailing}</span>
        </>
      )}
      <span className="file-preview-path-separator" aria-hidden="true">&gt;</span>
      <strong className="file-preview-path-name">{suffix}</strong>
    </span>
  )
}

function CodeViewer({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const text = tab.content?.kind === 'page' ? tab.content.page.text
    : tab.content && 'text' in tab.content ? tab.content.text : ''
  const startLine = tab.content?.kind === 'page' ? tab.content.page.startLine : 1
  const lines = useMemo(() => text.split('\n').map((line) => line.replace(/\r$/u, '')), [text])
  const searchMatches = useMemo(() => {
    const query = searchQuery.toLocaleLowerCase()
    if (!query) return []
    const matches: Array<{ line: number; start: number; length: number }> = []
    for (let line = 0; line < lines.length; line += 1) {
      const source = lines[line].toLocaleLowerCase()
      let offset = 0
      while (offset <= source.length - query.length) {
        const start = source.indexOf(query, offset)
        if (start < 0) break
        matches.push({ line, start, length: query.length })
        offset = start + Math.max(1, query.length)
      }
    }
    return matches
  }, [lines, searchQuery])

  useEffect(() => {
    setSearchIndex((current) => searchMatches.length === 0
      ? 0
      : Math.min(current, searchMatches.length - 1))
  }, [searchMatches.length])

  useLayoutEffect(() => {
    const targetLine = tab.file.target?.line
    const root = rootRef.current
    const row = targetLine ? root?.querySelector<HTMLElement>(`[data-file-row="${targetLine}"]`) : null
    if (!root || !row) return
    root.scrollTop += row.getBoundingClientRect().top - root.getBoundingClientRect().top
      - (root.clientHeight - row.getBoundingClientRect().height) / 2
  }, [startLine, tab.content, tab.file.target])

  useEffect(() => {
    const match = searchMatches[searchIndex]
    if (!match) return
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-file-row="${startLine + match.line}"]`)
      ?.scrollIntoView({ block: 'center' })
  }, [searchIndex, searchMatches, startLine])

  const changeSearchMatch = (direction: -1 | 1): void => {
    if (searchMatches.length === 0) return
    setSearchIndex((current) => (current + direction + searchMatches.length) % searchMatches.length)
  }
  return (
    <>
      <div
        ref={rootRef}
        className={`file-preview-code kind-${tab.file.kind}`}
        role="region"
        aria-label={`${tab.file.fileName} 内容`}
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
            event.preventDefault()
            setSearchOpen(true)
            return
          }
          if (event.key === 'Escape' && searchOpen) {
            event.preventDefault()
            setSearchOpen(false)
          }
        }}
      >
        {lines.map((line, index) => {
          const patchClass = tab.file.kind === 'patch'
            ? line.startsWith('+') && !line.startsWith('+++')
              ? 'is-addition'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'is-deletion'
                : line.startsWith('@@')
                  ? 'is-hunk'
                  : ''
            : ''
          const currentMatch = searchMatches[searchIndex]
          const highlight = currentMatch?.line === index ? currentMatch : null
          const target = tab.file.target
          const targeted = target?.line !== undefined && startLine + index >= target.line
            && startLine + index <= (target.endLine ?? target.line)
          return (
            <div
              className={`file-preview-code-line ${patchClass}${highlight ? ' is-search-match' : ''}${targeted ? ' is-location-target' : ''}`}
              data-file-row={startLine + index}
              key={`${startLine + index}:${line}`}
            >
              <span aria-hidden="true">{startLine + index}</span>
              <code data-file-line={startLine + index}>{highlight
                ? <>{line.slice(0, highlight.start)}<mark>{line.slice(highlight.start, highlight.start + highlight.length)}</mark>{line.slice(highlight.start + highlight.length) || ' '}</>
                : line || ' '}</code>
            </div>
          )
        })}
      </div>
      {searchOpen && (
        <div className="file-preview-search" role="search" aria-label="在当前文件中查找">
          <input
            autoFocus
            value={searchQuery}
            placeholder="查找"
            aria-label="查找文本"
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setSearchIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                changeSearchMatch(event.shiftKey ? -1 : 1)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                setSearchOpen(false)
                rootRef.current?.focus()
              }
            }}
          />
          <span aria-live="polite">{searchQuery
            ? `${searchMatches.length ? searchIndex + 1 : 0} / ${searchMatches.length}`
            : ''}</span>
          <button type="button" aria-label="上一个匹配项" disabled={searchMatches.length === 0} onClick={() => changeSearchMatch(-1)}>↑</button>
          <button type="button" aria-label="下一个匹配项" disabled={searchMatches.length === 0} onClick={() => changeSearchMatch(1)}>↓</button>
          <button type="button" aria-label="关闭查找" onClick={() => {
            setSearchOpen(false)
            rootRef.current?.focus()
          }}>×</button>
        </div>
      )}
    </>
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
        alt={tab.file.fileName}
        draggable={false}
        style={scaledStyle}
        onLoad={(event) => setDimensions({
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight
        })}
        onError={() => setImageError(true)}
      />
      <div className="file-preview-image-info" aria-live="polite">
        {dimensions ? `${dimensions.width} × ${dimensions.height} · ` : ''}{fileSizeLabel(tab.file.size)}
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
  const { open } = useFilePreview()
  const [linkError, setLinkError] = useState<string | null>(null)
  const fragment = tab.file.target?.htmlFragment

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
  }, [content, open, tab.file.handleId])

  if (!content) return null
  return (
    <div className="file-preview-html-stage">
      <iframe
        ref={iframeRef}
        className="file-preview-html"
        title={`${tab.file.fileName} HTML 预览`}
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
  const text = tab.content && 'text' in tab.content ? tab.content.text : ''
  const patch = useMemo(() => parseUnifiedPatch(text), [text])
  const { open } = useFilePreview()
  const [linkError, setLinkError] = useState<string | null>(null)
  if (!patch) return <CodeViewer tab={tab} />

  const scrollTo = (id: string): void => {
    document.getElementById(`${tab.id}-${id}`)?.scrollIntoView({ block: 'start' })
  }
  const openFile = (rawReference: string | null): void => {
    if (!rawReference) return
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
    <div className="file-preview-patch">
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
  const { open } = useFilePreview()
  const [linkError, setLinkError] = useState<string | null>(null)
  if (!tab.content) return <div className="file-preview-empty-content" />
  if (tab.content.kind === 'markdown') {
    return (
      <div className="file-preview-markdown">
        {linkError && <p className="file-preview-inline-error" role="alert">{linkError}</p>}
        <SafeMarkdown
          headingTarget={tab.file.target?.heading}
          onHeadingTargetResult={(found) => setLinkError(found ? null : '未找到指定的标题，已保持在文件顶部。')}
          localImageUrl={(rawReference) => filePreviewAssetUrl(
            rawReference,
            tab.content?.kind === 'markdown' ? tab.content.tabToken : '',
            tab.content?.kind === 'markdown' ? tab.content.assetBasePath : ''
          )}
          onFileReference={(rawReference, _source, target) => {
            void open({
              kind: 'child_of_handle',
              parentHandleId: tab.file.handleId,
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
  return <CodeViewer tab={tab} />
}

function FilePreviewDocument({ tab }: { tab: FilePreviewTabModel }): React.JSX.Element {
  const { reload, retry, changePage } = useFilePreview()
  const page = tab.content?.kind === 'page' ? tab.content.page : null
  return (
    <>
      <div className="file-preview-path-row">
        <RelativePath path={tab.file.displayPath} fileName={tab.file.fileName} />
        {(tab.hasExternalUpdate || tab.isRefreshing) && (
          <button
            className="file-preview-update-action"
            type="button"
            disabled={tab.isRefreshing}
            onClick={() => void reload(tab.id)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 5.5V2.8l-1.2 1.1A5.4 5.4 0 1 0 13.2 9" /></svg>
            {tab.isRefreshing ? '正在重新加载' : '有更新'}
          </button>
        )}
      </div>
      <div className="file-preview-content">
        {tab.loadState === 'opening' && !tab.content && (
          <OpeningIndicator />
        )}
        {tab.loadState === 'error' && !tab.content && (
          <div className="file-preview-error" role="alert">
            <strong>无法打开文件</strong>
            <span>{tab.error?.message}</span>
            <button type="button" onClick={() => void retry(tab.id)}>重试</button>
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
        aria-label={previewTabLabel(tab)}
        aria-labelledby={`file-preview-tab-${tab.id}`}
      >
        {tab.kind === 'file_change' ? <FileChangesPreview tab={tab} /> : <FilePreviewDocument tab={tab} />}
      </section>)}
    </section>
  )
}
