import { APPEARANCE_READING_CHANGED } from './reduced-motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { useFileFindAdapter } from './FilePreviewFind'
import { codeFileFindAdapter } from './file-find-code'
import type { FileLocationTarget, ResolvedTheme } from '@contracts'
import {
  loadSourceLanguageForFilename,
  sourceCodeMirrorTheme,
  sourceReaderExtensions,
  sourceTargetLocalLines
} from './source-preview'

interface LoadedLanguage {
  filename: string
  support: Awaited<ReturnType<typeof loadSourceLanguageForFilename>>
}

export function ReadonlyCodeViewer({
  fileName,
  text,
  startLine = 1,
  target,
  theme,
  findScopeLabel = ''
}: {
  fileName: string
  text: string
  startLine?: number
  target?: FileLocationTarget
  theme: ResolvedTheme
  findScopeLabel?: string
}): React.JSX.Element {
  const viewRef = useRef<EditorView | null>(null)
  const previousThemeRef = useRef(theme)
  const themeAnchorRef = useRef<{ theme: ResolvedTheme; view: EditorView; position: number } | null>(null)
  const [editor, setEditor] = useState<EditorView | null>(null)
  const scheduledTargetRef = useRef<{
    view: EditorView
    text: string
    startLine: number
    line: number
    endLine?: number
  } | null>(null)
  const [loadedLanguage, setLoadedLanguage] = useState<LoadedLanguage | null>(null)
  const languageSettled = loadedLanguage?.filename === fileName
  const language = languageSettled ? loadedLanguage.support : null
  const targetLine = target?.line
  const targetEndLine = target?.endLine

  useEffect(() => {
    let active = true
    void loadSourceLanguageForFilename(fileName).then((support) => {
      if (active) setLoadedLanguage({ filename: fileName, support })
    })
    return () => {
      active = false
    }
  }, [fileName])

  useEffect(() => {
    const measure = (): void => viewRef.current?.requestMeasure()
    document.addEventListener(APPEARANCE_READING_CHANGED, measure)
    return () => document.removeEventListener(APPEARANCE_READING_CHANGED, measure)
  }, [])

  const findAdapter = useMemo(() => editor ? codeFileFindAdapter(editor, findScopeLabel) : null, [editor, text, findScopeLabel])
  useFileFindAdapter(findAdapter)

  const extensions = useMemo(() => sourceReaderExtensions({
    ariaLabel: `${fileName} 内容`,
    language,
    startLine,
    target,
    theme
  }), [fileName, language, startLine, targetEndLine, targetLine, theme])

  const targetScrollTop = useCallback((view: EditorView): number | null => {
    const local = sourceTargetLocalLines(startLine, view.state.doc.lines, target)
    if (!local) return null
    const block = view.lineBlockAt(view.state.doc.line(local.from).from)
    return Math.max(0, block.top - (view.scrollDOM.clientHeight - block.height) / 2)
  }, [startLine, targetEndLine, targetLine])

  const scheduleTargetScroll = useCallback((view: EditorView): void => {
    if (!targetLine) return
    const scheduled = scheduledTargetRef.current
    if (scheduled?.view === view && scheduled.text === text && scheduled.startLine === startLine
      && scheduled.line === targetLine && scheduled.endLine === targetEndLine) return
    scheduledTargetRef.current = { view, text, startLine, line: targetLine, endLine: targetEndLine }
    window.requestAnimationFrame(() => {
      if (viewRef.current !== view || !view.dom.isConnected) return
      view.requestMeasure({
        read: targetScrollTop,
        write: (scrollTop) => {
          if (scrollTop === null || viewRef.current !== view || !view.dom.isConnected) return
          view.scrollDOM.scrollTop = scrollTop
        }
      })
    })
  }, [startLine, targetEndLine, targetLine, targetScrollTop, text])

  useEffect(() => {
    if (editor && languageSettled) scheduleTargetScroll(editor)
  }, [editor, languageSettled, scheduleTargetScroll])

  useLayoutEffect(() => {
    if (previousThemeRef.current === theme) return undefined
    previousThemeRef.current = theme
    const view = viewRef.current
    if (!view) return undefined
    const scrollerBounds = view.scrollDOM.getBoundingClientRect()
    const visibleLine = [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')]
      .find(line => line.getBoundingClientRect().bottom > scrollerBounds.top)
    // A virtualized editor may still have old layout estimates during theme reconfiguration.
    // Resolve the rendered line through its DOM position instead of estimated screen coordinates.
    const anchor = visibleLine ? view.posAtDOM(visibleLine) : view.lineBlockAtHeight(view.scrollDOM.scrollTop).from
    themeAnchorRef.current = { theme, view, position: anchor }
    return undefined
  }, [theme])

  useEffect(() => {
    const anchor = themeAnchorRef.current
    if (!anchor || anchor.theme !== theme) return undefined
    const frame = window.requestAnimationFrame(() => {
      if (viewRef.current === anchor.view && anchor.view.dom.isConnected) {
        anchor.view.dispatch({ effects: EditorView.scrollIntoView(anchor.position, { y: 'start', yMargin: 0 }) })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [theme])

  return (
    <div
      className="file-preview-code"
      role="region"
      aria-label={`${fileName} 内容`}
      tabIndex={0}
    >
      <CodeMirror
        className="file-preview-code-mirror"
        value={text}
        width="100%"
        height="100%"
        theme={sourceCodeMirrorTheme(theme)}
        extensions={extensions}
        basicSetup={false}
        indentWithTab={false}
        readOnly
        editable={false}
        onCreateEditor={(view) => {
          viewRef.current = view
          setEditor(view)
        }}
      />
    </div>
  )
}
