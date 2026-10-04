import { useFilePreview, type FilePreviewTabModel } from './FilePreviewContext'
import { useEffect } from 'react'
import type { ResolvedFilePreview, ResolvedTheme } from '@contracts'
import { ReadonlyCodeViewer } from './ReadonlyCodeViewer'
import { UiText, uiAttribute } from './interface-language'

/** Source requests and loaded pages belong to the preview session. */
export function HtmlPreviewSource({ file, theme, tab }: {
  file: ResolvedFilePreview; theme: ResolvedTheme; tab: FilePreviewTabModel
}): React.JSX.Element {
  const { loadHtmlSource, isCurrentThread, activeTabId, paneVisible } = useFilePreview()
  const source = tab.htmlSource
  const visible = isCurrentThread !== false && paneVisible && activeTabId === tab.id
  useEffect(() => { if (visible && !source) void loadHtmlSource(tab.id).catch(() => undefined) }, [visible, tab.id, file.handleId, file.contentGeneration, source, loadHtmlSource])
  if (!source) return <div className="file-preview-loading" role="status"><UiText zh={"正在读取源码…"} /></div>
  return <div className="file-preview-html-source">
    <ReadonlyCodeViewer fileName={file.fileName} text={source.text} startLine={source.page?.startLine} theme={theme} findScopeLabel={source.page ? uiAttribute("当前页源码") : uiAttribute("HTML 源码")} />
    {source.page && <footer className="file-preview-page-controls"><span><UiText zh={"第 "} />{source.page.startLine}<UiText zh={" 行起"} /></span><div>
      <button type="button" disabled={source.index === 0} onClick={() => void loadHtmlSource(tab.id, source.index - 1)}><UiText zh={"上一页"} /></button>
      <button type="button" disabled={!source.page.hasNext} onClick={() => void loadHtmlSource(tab.id, source.index + 1)}><UiText zh={"下一页"} /></button>
    </div></footer>}
  </div>
}
