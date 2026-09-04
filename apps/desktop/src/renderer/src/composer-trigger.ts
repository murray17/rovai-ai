import type { ComposerAtom } from '@contracts'
import {
  $getNodeByKey,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type NodeKey,
  type TextNode
} from 'lexical'
import { $isComposerAtomNode } from './ComposerAtomNode'
import { $insertComposerAtomWithTrailingSpace } from './composer-editor-state'
import { MAX_TYPEAHEAD_QUERY_LENGTH } from './composer-document'

export interface ComposerTriggerMatch {
  kind: 'member' | 'skill'
  query: string
  nodeKey: NodeKey
  fromOffset: number
  toOffset: number
}

export interface ComposerTriggerWindow {
  startOffset: number
  text: string
}

const TRIGGER_BOUNDARY = '[\\s，。！？；：、（(\\[【{「『]'
const MEMBER_TRIGGER = new RegExp(`(^|${TRIGGER_BOUNDARY})@([\\p{L}\\p{N}_-]*)$`, 'u')
const SKILL_TRIGGER = new RegExp(`(^|${TRIGGER_BOUNDARY})/([A-Za-z0-9-]*)$`, 'u')

/**
 * Requests only a bounded suffix from the source. TextNode currently exposes
 * a string reference rather than a range reader, so the production callback
 * performs the sole substring allocation for this window.
 */
export function readComposerTriggerWindow(
  textLength: number,
  caretOffset: number,
  read: (startOffset: number, endOffset: number) => string
): ComposerTriggerWindow {
  const safeCaret = Math.max(0, Math.min(caretOffset, textLength))
  const startOffset = Math.max(0, safeCaret - MAX_TYPEAHEAD_QUERY_LENGTH)
  return {
    startOffset,
    text: read(startOffset, safeCaret)
  }
}

export function $findComposerTriggerMatch(
  editor: Pick<LexicalEditor, 'isComposing'>
): ComposerTriggerMatch | null {
  if (editor.isComposing()) return null
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  if (selection.anchor.type !== 'text') return null
  const node = selection.anchor.getNode()
  if (!$isTextNode(node) || $isComposerAtomNode(node)) return null

  const caretOffset = selection.anchor.offset
  const window = readComposerTriggerWindow(
    node.getTextContentSize(),
    caretOffset,
    (start, end) => node.getTextContent().slice(start, end)
  )
  const previous = window.startOffset === 0 ? node.getPreviousSibling() : null
  const nodeStartIsBoundary = window.startOffset === 0
    && (previous === null || $isLineBreakNode(previous))
  return matchComposerTriggerWindow(window, node.getKey(), caretOffset, nodeStartIsBoundary)
}

export function $replaceComposerTriggerWithAtom(
  match: ComposerTriggerMatch,
  atom: ComposerAtom
): boolean {
  const node = $getNodeByKey(match.nodeKey)
  if (!$isTextNode(node) || $isComposerAtomNode(node)) return false
  const expected = `${match.kind === 'member' ? '@' : '/'}${match.query}`
  if (
    match.fromOffset < 0
    || match.toOffset > node.getTextContentSize()
    || match.fromOffset >= match.toOffset
    || node.getTextContent().slice(match.fromOffset, match.toOffset) !== expected
  ) return false

  const queryNode = isolateTextRange(node, match.fromOffset, match.toOffset)
  $insertComposerAtomWithTrailingSpace(queryNode, atom)
  return true
}

function matchComposerTriggerWindow(
  window: ComposerTriggerWindow,
  nodeKey: NodeKey,
  caretOffset: number,
  nodeStartIsBoundary: boolean
): ComposerTriggerMatch | null {
  const candidates = [
    matchKind('member', MEMBER_TRIGGER, window, nodeKey, caretOffset, nodeStartIsBoundary),
    matchKind('skill', SKILL_TRIGGER, window, nodeKey, caretOffset, nodeStartIsBoundary)
  ].filter((value): value is ComposerTriggerMatch => value !== null)
  return candidates.sort((left, right) => right.fromOffset - left.fromOffset)[0] ?? null
}

function matchKind(
  kind: ComposerTriggerMatch['kind'],
  pattern: RegExp,
  window: ComposerTriggerWindow,
  nodeKey: NodeKey,
  caretOffset: number,
  nodeStartIsBoundary: boolean
): ComposerTriggerMatch | null {
  const match = pattern.exec(window.text)
  if (!match) return null
  const boundary = match[1] ?? ''
  if (!boundary && match.index === 0 && !nodeStartIsBoundary) return null
  const query = match[2] ?? ''
  const fromOffset = window.startOffset + match.index + boundary.length
  return { kind, query, nodeKey, fromOffset, toOffset: caretOffset }
}

function isolateTextRange(node: TextNode, fromOffset: number, toOffset: number): TextNode {
  const size = node.getTextContentSize()
  if (fromOffset === 0 && toOffset === size) return node
  if (fromOffset === 0) return node.splitText(toOffset)[0]
  if (toOffset === size) return node.splitText(fromOffset)[1]
  return node.splitText(fromOffset, toOffset)[1]
}
