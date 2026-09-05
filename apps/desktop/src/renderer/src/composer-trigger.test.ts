import { describe, expect, it, vi } from 'vitest'
import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  createEditor,
  type LexicalEditor
} from 'lexical'
import { ComposerAtomNode } from './ComposerAtomNode'
import { $replaceEditorWithComposerDocument, editorStateToComposerDocument } from './composer-editor-state'
import {
  $findComposerTriggerMatch,
  $replaceComposerTriggerWithAtom,
  readComposerTriggerWindow
} from './composer-trigger'
import { MAX_TYPEAHEAD_QUERY_LENGTH } from './composer-document'

function createComposerEditor(text: string): LexicalEditor {
  const editor = createEditor({
    namespace: `ComposerTriggerTest-${crypto.randomUUID()}`,
    nodes: [ComposerAtomNode],
    onError(error) { throw error }
  })
  editor.update(() => {
    $replaceEditorWithComposerDocument({
      version: 2,
      segments: [{ kind: 'text', text }]
    })
  }, { discrete: true })
  return editor
}

function selectEnd(editor: LexicalEditor): void {
  editor.update(() => {
    const paragraph = $getRoot().getFirstChildOrThrow()
    if (!$isElementNode(paragraph)) throw new Error('expected paragraph')
    const text = paragraph.getLastChildOrThrow()
    if (!$isTextNode(text)) throw new Error('expected text')
    text.selectEnd()
  }, { discrete: true })
}

function match(editor: LexicalEditor) {
  return editor.getEditorState().read(() => $findComposerTriggerMatch(editor))
}

describe('Composer bounded trigger scan', () => {
  it('requests at most the final 128 characters from its text source', () => {
    const read = vi.fn((start: number, end: number) => 'x'.repeat(end - start))

    const window = readComposerTriggerWindow(10_000, 9_000, read)

    expect(read).toHaveBeenCalledWith(9_000 - MAX_TYPEAHEAD_QUERY_LENGTH, 9_000)
    expect(window.text).toHaveLength(MAX_TYPEAHEAD_QUERY_LENGTH)
    expect(window.startOffset).toBe(8_872)
  })

  it('matches member and Skill queries only at their allowed local boundaries', () => {
    const member = createComposerEditor('请让 @Ali')
    selectEnd(member)
    expect(match(member)).toMatchObject({
      kind: 'member', query: 'Ali', fromOffset: 3, toOffset: 7
    })

    const skill = createComposerEditor('请处理：/review')
    selectEnd(skill)
    expect(match(skill)).toMatchObject({
      kind: 'skill', query: 'review', fromOffset: 4, toOffset: 11
    })

    for (const value of ['https://example.com/a/b', 'src/components/a/b.ts', 'word/review']) {
      const editor = createComposerEditor(value)
      selectEnd(editor)
      expect(match(editor)).toBeNull()
    }
  })

  it('does not cross an Atom but permits a query immediately after a LineBreak', () => {
    const afterAtom = createEditor({
      namespace: `ComposerTriggerAtom-${crypto.randomUUID()}`,
      nodes: [ComposerAtomNode],
      onError(error) { throw error }
    })
    afterAtom.update(() => {
      $replaceEditorWithComposerDocument({
        version: 2,
        segments: [
          { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
          { kind: 'text', text: '/rev' }
        ]
      })
      const paragraph = $getRoot().getFirstChildOrThrow()
      if (!$isElementNode(paragraph)) throw new Error('expected paragraph')
      const text = paragraph.getLastChildOrThrow()
      if (!$isTextNode(text)) throw new Error('expected text')
      text.selectEnd()
    }, { discrete: true })
    expect(match(afterAtom)).toBeNull()

    const afterBreak = createEditor({
      namespace: `ComposerTriggerBreak-${crypto.randomUUID()}`,
      nodes: [ComposerAtomNode],
      onError(error) { throw error }
    })
    afterBreak.update(() => {
      $replaceEditorWithComposerDocument({
        version: 2,
        segments: [{ kind: 'text', text: '前文\n/rev' }]
      })
      const paragraph = $getRoot().getFirstChildOrThrow()
      if (!$isElementNode(paragraph)) throw new Error('expected paragraph')
      const text = paragraph.getLastChildOrThrow()
      if (!$isTextNode(text)) throw new Error('expected text')
      text.selectEnd()
    }, { discrete: true })
    expect(match(afterBreak)).toMatchObject({ kind: 'skill', query: 'rev', fromOffset: 0 })
  })

  it('replaces exactly the matched query and preserves surrounding text and spacing', () => {
    const editor = createComposerEditor('请让 @Ali 处理')
    editor.update(() => {
      const paragraph = $getRoot().getFirstChildOrThrow()
      if (!$isElementNode(paragraph)) throw new Error('expected paragraph')
      const text = paragraph.getFirstChildOrThrow()
      if (!$isTextNode(text)) throw new Error('expected text')
      text.select(7, 7)
      const trigger = $findComposerTriggerMatch(editor)
      expect(trigger).not.toBeNull()
      if (trigger) {
        expect($replaceComposerTriggerWithAtom(trigger, {
          type: 'member', agentId: 'agent-a', labelFallback: 'Alice'
        })).toBe(true)
      }
    }, { discrete: true })

    expect(editorStateToComposerDocument(editor.getEditorState())).toEqual({
      version: 2,
      segments: [
        { kind: 'text', text: '请让 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a', labelFallback: 'Alice' } },
        { kind: 'text', text: ' 处理' }
      ]
    })
  })
})
