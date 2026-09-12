import { useEffect, useState } from 'react'
import type { FilePreviewPageContent, ResolvedFilePreview, ResolvedTheme } from '@contracts'
import { ReadonlyCodeViewer } from './ReadonlyCodeViewer'

/** Uses the existing generation-bound source readers, including their separate
 * whole-text budget. Preview injection is never presented as author source. */
export function HtmlPreviewSource({ file, theme }: { file: ResolvedFilePreview; theme: ResolvedTheme }): React.JSX.Element {
  const [offsets, setOffsets] = useState([0])
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<{ text: string; page: FilePreviewPageContent | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setError(null); setResult(null)
    const request = { handleId: file.handleId, expectedGeneration: file.contentGeneration }
    void (async () => {
      const whole = file.size <= 4 * 1024 * 1024
      const response = whole ? await window.rovai.filePreview.readText(request) : await window.rovai.filePreview.readPage({ ...request, offset: offsets[index] })
      if (!active) return
      if (!response.ok) setError(response.error.message)
      else setResult({ text: response.value.text, page: 'endOffset' in response.value ? response.value as FilePreviewPageContent : null })
    })().catch(() => { if (active) setError('无法读取源码，请重新打开文件。') })
    return () => { active = false }
  }, [file.handleId, file.contentGeneration, file.size, offsets, index])
  if (error) return <div className="file-preview-error" role="status">{error}</div>
  if (!result) return <div className="file-preview-loading" role="status">正在读取源码…</div>
  return <div className="file-preview-html-source">
    <ReadonlyCodeViewer fileName={file.fileName} text={result.text} startLine={result.page?.startLine} theme={theme} findScopeLabel={result.page ? '当前页源码' : 'HTML 源码'} />
    {result.page && <footer className="file-preview-page-controls"><span>第 {result.page.startLine} 行起</span><div>
      <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)}>上一页</button>
      <button type="button" disabled={!result.page.hasNext} onClick={() => { setOffsets([...offsets.slice(0, index + 1), result.page!.endOffset]); setIndex(index + 1) }}>下一页</button>
    </div></footer>}
  </div>
}
