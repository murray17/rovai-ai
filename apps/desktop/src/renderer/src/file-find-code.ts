import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { FileFindAdapter } from './FilePreviewFind'
import type { FileFindMatch } from './file-find'

const setMatches = StateEffect.define<{ matches: FileFindMatch[]; current: number }>()
export const fileFindDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none
    for (const effect of transaction.effects) {
      if (!effect.is(setMatches)) continue
      value = Decoration.set(effect.value.matches.filter(match => match.to <= transaction.state.doc.length).map((match, index) =>
        Decoration.mark({ class: index === effect.value.current ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch' }).range(match.from, match.to)
      ), true)
    }
    return value
  },
  provide: field => EditorView.decorations.from(field)
})
export function codeFileFindAdapter(view: EditorView, scopeLabel = ''): FileFindAdapter {
  return {
    scopeLabel,
    documents: () => [{ id: 'source', text: view.state.doc.toString() }],
    show(matches, current, scroll, clearance) {
      const match = matches[current]
      view.dispatch({ effects: [setMatches.of({ matches, current }), ...(scroll && match
        ? [EditorView.scrollIntoView(match.from, { y: 'center', x: 'nearest', yMargin: clearance + 12 })] : [])] })
    },
    clear: () => { if (view.dom.isConnected) view.dispatch({ effects: setMatches.of({ matches: [], current: -1 }) }) },
    focus: () => view.focus(),
    selection: () => {
      const selection = window.getSelection()
      return selection?.anchorNode && view.dom.contains(selection.anchorNode) ? selection.toString() : view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
    }
  }
}
