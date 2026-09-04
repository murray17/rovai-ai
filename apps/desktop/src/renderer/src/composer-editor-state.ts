import type { ComposerAtom, ComposerDocument, ComposerSegment } from '@contracts'
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type TextNode
} from 'lexical'
import { $createComposerAtomNode, $isComposerAtomNode } from './ComposerAtomNode'
import {
  COMPOSER_DOCUMENT_VERSION,
  emptyComposerDocument,
  normalizeComposerDocument
} from './composer-document'

export function $replaceEditorWithComposerDocument(
  document: ComposerDocument
): void {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  root.append(paragraph)
  for (const node of $composerNodesFromDocument(document)) paragraph.append(node)
}

export function composerDocumentToEditorState(
  editor: LexicalEditor,
  document: ComposerDocument
): EditorState {
  const previous = editor.getEditorState()
  let next = previous
  editor.update(() => {
    $replaceEditorWithComposerDocument(document)
  }, {
    discrete: true,
    onUpdate: () => { next = editor.getEditorState() }
  })
  return next
}

export function editorStateToComposerDocument(editorState: EditorState): ComposerDocument {
  return editorState.read(() => $rootToComposerDocument())
}

export function $rootToComposerDocument(): ComposerDocument {
  const segments: ComposerSegment[] = []
  const rootChildren = $getRoot().getChildren()
  rootChildren.forEach((topLevel, index) => {
    if (index > 0) appendTextSegment(segments, '\n')
    if ($isElementNode(topLevel)) {
      for (const child of topLevel.getChildren()) appendNodeSegment(segments, child)
    } else {
      appendNodeSegment(segments, topLevel)
    }
  })
  return normalizeComposerDocument({ version: COMPOSER_DOCUMENT_VERSION, segments })
}

export function $selectedComposerDocument(): ComposerDocument {
  const selection = $getSelection()
  if ($isNodeSelection(selection)) {
    const segments: ComposerSegment[] = []
    for (const node of selection.getNodes()) {
      if (!$isElementNode(node)) appendNodeSegment(segments, node)
    }
    return normalizeComposerDocument({ version: COMPOSER_DOCUMENT_VERSION, segments })
  }
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return emptyComposerDocument()
  const selectedNodes = selection.getNodes()
  const orderedPoints = selection.isBackward()
    ? { start: selection.focus, end: selection.anchor }
    : { start: selection.anchor, end: selection.focus }
  const segments: ComposerSegment[] = []
  let previousTopLevelKey: NodeKey | null = null

  for (const node of selectedNodes) {
    if ($isElementNode(node)) continue
    const topLevelKey = node.getTopLevelElementOrThrow().getKey()
    if (previousTopLevelKey !== null && topLevelKey !== previousTopLevelKey) {
      appendTextSegment(segments, '\n')
    }
    previousTopLevelKey = topLevelKey

    if ($isComposerAtomNode(node)) {
      segments.push({ kind: 'atom', atom: node.getAtom() })
      continue
    }
    if ($isLineBreakNode(node)) {
      appendTextSegment(segments, '\n')
      continue
    }
    if (!$isTextNode(node)) continue
    let start = 0
    let end = node.getTextContentSize()
    if (orderedPoints.start.type === 'text' && orderedPoints.start.key === node.getKey()) {
      start = orderedPoints.start.offset
    }
    if (orderedPoints.end.type === 'text' && orderedPoints.end.key === node.getKey()) {
      end = orderedPoints.end.offset
    }
    if (end > start) appendTextSegment(segments, node.getTextContent().slice(start, end))
  }
  return normalizeComposerDocument({ version: COMPOSER_DOCUMENT_VERSION, segments })
}

export function $insertComposerDocument(
  document: ComposerDocument
): void {
  const selection = $getSelection()
  if (!$isRangeSelection(selection)) return
  selection.insertNodes($composerNodesFromDocument(document))
}

export function $insertComposerAtomWithTrailingSpace(
  queryNode: TextNode,
  atom: ComposerAtom
): void {
  const nextSibling = queryNode.getNextSibling()
  const atomNode = $createComposerAtomNode(atom)
  queryNode.replace(atomNode)

  if ($isTextNode(nextSibling) && !$isComposerAtomNode(nextSibling)) {
    const whitespace = leadingWhitespaceLength(nextSibling.getTextContent())
    if (whitespace > 0) {
      nextSibling.select(whitespace, whitespace)
      return
    }
  }
  if ($isLineBreakNode(nextSibling)) {
    nextSibling.selectNext()
    return
  }
  const space = $createTextNode(' ')
  atomNode.insertAfter(space)
  space.selectEnd()
}

function $composerNodesFromDocument(
  document: ComposerDocument
): LexicalNode[] {
  const nodes: LexicalNode[] = []
  for (const segment of normalizeComposerDocument(document).segments) {
    if (segment.kind === 'atom') {
      nodes.push($createComposerAtomNode(segment.atom))
      continue
    }
    const text = segment.text.replace(/\r\n?/gu, '\n')
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      if (index > 0) nodes.push($createLineBreakNode())
      if (line) nodes.push($createTextNode(line))
    })
  }
  return nodes
}

function appendNodeSegment(segments: ComposerSegment[], node: LexicalNode): void {
  if ($isComposerAtomNode(node)) {
    segments.push({ kind: 'atom', atom: node.getAtom() })
  } else if ($isLineBreakNode(node)) {
    appendTextSegment(segments, '\n')
  } else if ($isTextNode(node)) {
    appendTextSegment(segments, node.getTextContent().replace(/\r\n?/gu, '\n'))
  }
}

function appendTextSegment(segments: ComposerSegment[], text: string): void {
  if (!text) return
  const previous = segments.at(-1)
  if (previous?.kind === 'text') previous.text += text
  else segments.push({ kind: 'text', text })
}

function leadingWhitespaceLength(text: string): number {
  if (text.startsWith('\r\n')) return 2
  const match = /^\s/u.exec(text)
  return match?.[0].length ?? 0
}
