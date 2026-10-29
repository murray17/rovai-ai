import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { defaultKeymap, history, historyField, historyKeymap, indentWithTab } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { FileLocationTarget, ResolvedTheme } from '@contracts'
import { loadSourceLanguageForFilename, sourceCodeMirrorTheme, sourceReaderExtensions } from './source-preview'
import { codeFileFindAdapter } from './file-find-code'
import { useFileFindAdapter } from './FilePreviewFind'
import type { FileEditDocument, FileEditStore } from './file-edit-store'
import { uiAttribute, useInterfaceLanguage } from './interface-language'

const historyFields = { history: historyField }
/** One visible editor per document; its CM state (including history) belongs to the window buffer. */
export function EditableCodeViewer({ doc, store, theme, target }: {
  doc: FileEditDocument; store: FileEditStore; theme: ResolvedTheme; target?: FileLocationTarget
}): React.JSX.Element {
  const languageCode = useInterfaceLanguage()
  const [language, setLanguage] = useState<Awaited<ReturnType<typeof loadSourceLanguageForFilename>>>(null)
  const [editor, setEditor] = useState<EditorView | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const initialState = useMemo(() => doc.editorState ? { json: doc.editorState.toJSON(historyFields), fields: historyFields } : undefined, [doc])
  useEffect(() => { let active = true; void loadSourceLanguageForFilename(doc.name).then(value => { if (active) setLanguage(value) }); return () => { active = false } }, [doc.name])
  const extensions = useMemo(() => [
    ...sourceReaderExtensions({ ariaLabel: uiAttribute('{0} 内容', doc.name), language, startLine: 1, target, theme }),
    EditorState.transactionFilter.of(transaction => !transaction.docChanged || store.allowChange(doc, transaction.newDoc.length) ? transaction : []),
    history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab])
  ], [doc, store, language, languageCode, theme, target])
  const find = useMemo(() => editor ? codeFileFindAdapter(editor, '') : null, [editor, doc.draft])
  useFileFindAdapter(find)
  useEffect(() => {
    if (!editor) return
    const frame = requestAnimationFrame(() => {
      if (!editor.dom.isConnected) return
      if (target?.line && target !== doc.navigationTarget) {
        const line = Math.max(1, Math.min(editor.state.doc.lines, target.line))
        editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: 'center' }) })
        doc.navigationTarget = target
      } else if (doc.scrollTop !== undefined) editor.scrollDOM.scrollTop = doc.scrollTop
    })
    return () => cancelAnimationFrame(frame)
  }, [doc, editor, target])
  return <div className="file-preview-code" onScrollCapture={event => {
    const view = viewRef.current
    if (view && event.target === view.scrollDOM) doc.scrollTop = view.scrollDOM.scrollTop
  }}>
    <CodeMirror className="file-preview-code-mirror" value={doc.draft} width="100%" height="100%"
      theme={sourceCodeMirrorTheme(theme)} extensions={extensions} basicSetup={false} indentWithTab={false}
      initialState={initialState} onChange={text => store.change(doc, text)}
      onUpdate={update => { doc.editorState = update.state }}
      onCreateEditor={view => {
        viewRef.current = view; setEditor(view)
      }} />
  </div>
}
