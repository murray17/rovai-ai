import type { ComposerDocument } from '@contracts'
import { HistoryExtension } from '@lexical/history'
import { PlainTextExtension } from '@lexical/plain-text'
import {
  $addUpdateTag,
  $createLineBreakNode,
  $createRangeSelection,
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  BEFORE_INPUT_COMMAND,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMPOSITION_START_COMMAND,
  CUT_COMMAND,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  PASTE_TAG,
  CUT_TAG,
  COPY_COMMAND,
  ParagraphNode,
  SET_TEXT_FORMAT_COMMAND,
  configExtension,
  defineExtension,
  mergeRegister,
  type LexicalEditor,
  type RangeSelection
} from 'lexical'
import { ComposerAtomNode, $isComposerAtomNode } from './ComposerAtomNode'
import {
  $insertComposerDocument,
  $selectedComposerDocument
} from './composer-editor-state'
import type { ComposerDraftSync } from './composer-draft-sync'
import {
  ROVAI_ATOM_PRESENTATION_TAG,
  ROVAI_COMPOSER_INITIALIZE_TAG,
  ROVAI_COMPOSER_REPLACE_TAG
} from './composer-draft-sync'
import { ROVAI_COMPOSER_CLIPBOARD_MIME } from './composer-document'

export interface ComposerExtensionRuntime<Result = unknown> {
  sync: ComposerDraftSync<Result>
  submit(): void
  enterInsertsLineBreak?(): boolean
  backspaceAtStart(): void
  pasteFiles(files: File[]): void
  plainText(document: ComposerDocument): string
  recoverClipboard(value: string): ComposerDocument | null
  activateAtom(node: ComposerAtomNode, trigger: HTMLElement, focusPanel: boolean): void
}

// The runtime is intentionally outside React state. The Extension graph remains
// module-stable while each editor instance receives current catalogs/callbacks.
const runtimes = new WeakMap<LexicalEditor, ComposerExtensionRuntime<unknown>>()

export function setComposerExtensionRuntime(
  editor: LexicalEditor,
  runtime: ComposerExtensionRuntime<unknown> | null
): void {
  if (runtime) runtimes.set(editor, runtime)
  else runtimes.delete(editor)
}

export function getComposerExtensionRuntime(
  editor: LexicalEditor
): ComposerExtensionRuntime<unknown> | null {
  return runtimes.get(editor) ?? null
}

export const ComposerAtomExtension = defineExtension({
  name: 'rovai:composer-atom',
  nodes: [ComposerAtomNode],
  register(editor) {
    let selectedElements = new Set<HTMLElement>()
    return mergeRegister(
      editor.registerNodeTransform(ParagraphNode, normalizeParagraphBoundary),
      editor.registerUpdateListener(({ editorState }) => {
        const nextElements = editorState.read(() => {
          const selection = $getSelection()
          return new Set($isNodeSelection(selection)
            ? selection.getNodes().filter($isComposerAtomNode)
              .map(node => editor.getElementByKey(node.getKey()))
              .filter((element): element is HTMLElement => element !== null)
            : [])
        })
        for (const element of selectedElements) {
          if (!nextElements.has(element)) delete element.dataset.composerSelected
        }
        for (const element of nextElements) element.dataset.composerSelected = 'true'
        editor.getRootElement()?.toggleAttribute('data-composer-atom-selected', nextElements.size > 0)
        selectedElements = nextElements
      }),
      () => {
        for (const element of selectedElements) delete element.dataset.composerSelected
        editor.getRootElement()?.removeAttribute('data-composer-atom-selected')
      }
    )
  }
})

function normalizeParagraphBoundary(paragraph: ParagraphNode): void {
  if (!$isParagraphNode(paragraph)) return
  const previous = paragraph.getPreviousSibling()
  if (!$isParagraphNode(previous)) return
  previous.append($createLineBreakNode(), ...paragraph.getChildren())
  paragraph.remove()
}

// PlainTextExtension can enter a Decorator NodeSelection, but only edits and
// navigates RangeSelection. Restore an equivalent range before handing it back.
function $restoreComposerAtomSelection(backward = false): RangeSelection | null {
  const selection = $getSelection()
  if (!$isNodeSelection(selection)) return null
  const nodes = selection.getNodes()
  // Arrow navigation selects one Atom. Do not expand a discontiguous selection
  // into a range that could also replace unselected text between its nodes.
  if (nodes.length !== 1 || !$isComposerAtomNode(nodes[0])) return null
  const node = nodes[0]
  const parentKey = node.getParentOrThrow().getKey()
  const offset = node.getIndexWithinParent()
  const range = $createRangeSelection()
  const start = backward ? range.focus : range.anchor
  const end = backward ? range.anchor : range.focus
  start.set(parentKey, offset, 'element')
  end.set(parentKey, offset + 1, 'element')
  $setSelection(range)
  return range
}

function moveFromComposerAtomSelection(editor: LexicalEditor, event: KeyboardEvent, left: boolean): boolean {
  if (editor.isComposing()) return false
  const selection = $getSelection()
  if (!$isNodeSelection(selection)) return false
  const node = selection.getNodes()[0]
  const parentDOM = node && editor.getElementByKey(node.getParentOrThrow().getKey())
  const backward = parentDOM && getComputedStyle(parentDOM).direction === 'rtl' ? !left : left
  const range = $restoreComposerAtomSelection(backward)
  if (!range) return false
  event.preventDefault()
  range.modify(event.shiftKey ? 'extend' : 'move', backward, 'character')
  return true
}

export const ComposerCommandExtension = defineExtension({
  name: 'rovai:composer-commands',
  register(editor) {
    const cleanups = [
      editor.registerCommand(FORMAT_TEXT_COMMAND, () => true, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(SET_TEXT_FORMAT_COMMAND, () => true, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_LEFT_COMMAND,
        event => moveFromComposerAtomSelection(editor, event, true), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_RIGHT_COMMAND,
        event => moveFromComposerAtomSelection(editor, event, false), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(BEFORE_INPUT_COMMAND, () => {
        if (!editor.isComposing()) $restoreComposerAtomSelection()
        return false
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(COMPOSITION_START_COMMAND, () => {
        if (!editor.isComposing()) $restoreComposerAtomSelection()
        return false
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_DELETE_COMMAND, () => {
        if (!editor.isComposing()) $restoreComposerAtomSelection()
        return false
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
        const runtime = runtimes.get(editor)
        if (!runtime) return false
        if (editor.isComposing() || event?.isComposing) return true
        if (event?.shiftKey || runtime.enterInsertsLineBreak?.()) {
          event?.preventDefault()
          $restoreComposerAtomSelection()
          const selection = $getSelection()
          if ($isRangeSelection(selection)) selection.insertNodes([$createLineBreakNode()])
          return true
        }
        event?.preventDefault()
        runtime.submit()
        return true
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
        const runtime = runtimes.get(editor)
        if (!runtime || editor.isComposing()) return false
        $restoreComposerAtomSelection()
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false
        const anchor = selection.anchor
        const node = anchor.getNode()
        const atStart = anchor.offset === 0
          && (node.getKey() === 'root'
            || ($isParagraphNode(node) && node.getPreviousSibling() === null)
            || (node.getPreviousSibling() === null && node.getTopLevelElementOrThrow().getPreviousSibling() === null))
        if (!atStart) return false
        event.preventDefault()
        runtime.backspaceAtStart()
        return true
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CLICK_COMMAND, (event) => {
        const runtime = runtimes.get(editor)
        const target = event.target
        if (!runtime || !(target instanceof HTMLElement)) return false
        const atomElement = target.closest<HTMLElement>('[data-composer-atom]')
        if (!atomElement) return false
        const node = $getNearestNodeFromDOMNode(atomElement)
        if (!$isComposerAtomNode(node)) return false
        event.preventDefault()
        runtime.activateAtom(node, atomElement, event.detail === 0)
        return true
      }, COMMAND_PRIORITY_HIGH)
    ]
    return () => cleanups.forEach((cleanup) => cleanup())
  }
})

export const ComposerClipboardExtension = defineExtension({
  name: 'rovai:composer-clipboard',
  register(editor) {
    const writeSelection = (event: ClipboardEvent | KeyboardEvent | null, cut: boolean): boolean => {
      const runtime = runtimes.get(editor)
      const clipboard = event && 'clipboardData' in event ? event.clipboardData : null
      if (!runtime || !clipboard || !event) return false
      const document = $selectedComposerDocument()
      if (document.segments.length === 0) return false
      const text = runtime.plainText(document)
      clipboard.setData('text/plain', text)
      clipboard.setData(ROVAI_COMPOSER_CLIPBOARD_MIME, JSON.stringify(document))
      clipboard.setData('text/html', `<span style="white-space: pre-wrap">${escapeHtml(text)}</span>`)
      event.preventDefault()
      if (cut) {
        $addUpdateTag(CUT_TAG)
        const selection = $getSelection()
        if ($isRangeSelection(selection)) selection.removeText()
        else if ($isNodeSelection(selection)) selection.deleteNodes()
      }
      return true
    }
    const cleanups = [
      editor.registerCommand(COPY_COMMAND, (event) => writeSelection(event, false), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(CUT_COMMAND, (event) => writeSelection(event, true), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(PASTE_COMMAND, (event) => {
        const runtime = runtimes.get(editor)
        const clipboard = 'clipboardData' in event ? event.clipboardData : null
        if (!runtime || !clipboard) return false
        const files = Array.from(clipboard.files ?? [])
        if (files.length > 0) {
          event.preventDefault()
          runtime.pasteFiles(files)
          return true
        }
        const structured = clipboard.getData(ROVAI_COMPOSER_CLIPBOARD_MIME)
        const document = structured ? runtime.recoverClipboard(structured) : null
        event.preventDefault()
        $addUpdateTag(PASTE_TAG)
        $restoreComposerAtomSelection()
        if (document) {
          $insertComposerDocument(document)
        } else {
          const selection = $getSelection()
          const plainText = clipboard.getData('text/plain')
            || htmlClipboardToPlainText(clipboard.getData('text/html'))
          if ($isRangeSelection(selection)) selection.insertRawText(plainText)
        }
        return true
      }, COMMAND_PRIORITY_HIGH)
    ]
    return () => cleanups.forEach((cleanup) => cleanup())
  }
})

export const ComposerDraftSyncExtension = defineExtension({
  name: 'rovai:composer-draft-sync',
  register(editor) {
    return editor.registerUpdateListener((payload) => runtimes.get(editor)?.sync.handleEditorUpdate(payload))
  }
})

export const RovaiComposerExtension = defineExtension({
  name: 'rovai:composer',
  namespace: 'RovaiComposerV2',
  theme: {
    paragraph: 'structured-mention-paragraph'
  },
  dependencies: [
    PlainTextExtension,
    configExtension(HistoryExtension, { maxDepth: 100 }),
    ComposerAtomExtension,
    ComposerCommandExtension,
    ComposerClipboardExtension,
    ComposerDraftSyncExtension
  ]
})

export {
  ROVAI_ATOM_PRESENTATION_TAG,
  ROVAI_COMPOSER_INITIALIZE_TAG,
  ROVAI_COMPOSER_REPLACE_TAG
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function htmlClipboardToPlainText(value: string): string {
  if (!value || typeof DOMParser === 'undefined') return ''
  const body = new DOMParser().parseFromString(value, 'text/html').body
  return body.innerText || body.textContent || ''
}
