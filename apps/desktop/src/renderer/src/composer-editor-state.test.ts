import { describe, expect, it } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  createEditor,
  type LexicalEditor
} from 'lexical'
import { ComposerAtomNode, $isComposerAtomNode } from './ComposerAtomNode'
import {
  $insertComposerAtomWithTrailingSpace,
  $replaceEditorWithComposerDocument,
  composerDocumentToEditorState,
  editorStateToComposerDocument
} from './composer-editor-state'

function createComposerEditor(): LexicalEditor {
  return createEditor({
    namespace: `ComposerTest-${crypto.randomUUID()}`,
    nodes: [ComposerAtomNode],
    onError(error) { throw error }
  })
}

describe('Composer Lexical state boundary', () => {
  it('imports Text + Atom into one Paragraph with explicit LineBreak nodes', () => {
    const editor = createComposerEditor()
    const state = composerDocumentToEditorState(editor, {
      version: 2,
      segments: [
        { kind: 'text', text: '请让 ' },
        { kind: 'atom', atom: { type: 'member', agentId: 'agent-a' } },
        { kind: 'text', text: ' 处理\n下一项' }
      ]
    }, () => '洛可')

    state.read(() => {
      const children = $getRoot().getChildren()
      expect(children).toHaveLength(1)
      expect($isParagraphNode(children[0])).toBe(true)
      if (!$isElementNode(children[0])) throw new Error('expected paragraph')
      const paragraphChildren = children[0].getChildren()
      expect(paragraphChildren.map((node) => node.getType())).toEqual([
        'text', 'composer-atom', 'text', 'linebreak', 'text'
      ])
      expect($isLineBreakNode(paragraphChildren[3])).toBe(true)
      expect($isComposerAtomNode(paragraphChildren[1])).toBe(true)
    })
  })

  it('round-trips identity while excluding selection, keys and presentation state', () => {
    const editor = createComposerEditor()
    const document = {
      version: 2 as const,
      segments: [
        { kind: 'text' as const, text: 'A' },
        {
          kind: 'atom' as const,
          atom: { type: 'skill' as const, skillId: 'skill-review', nameAtSend: 'review-pr' }
        },
        { kind: 'text' as const, text: '\nB' }
      ]
    }
    const state = composerDocumentToEditorState(editor, document)

    expect(editorStateToComposerDocument(state)).toEqual(document)
    expect(JSON.stringify(editorStateToComposerDocument(state))).not.toMatch(
      /selection|presentation|__key|nodeKey/
    )
  })

  it('converts multiple external Paragraph boundaries to domain newlines', () => {
    const editor = createComposerEditor()
    editor.update(() => {
      const root = $getRoot()
      root.clear()
      root.append(
        $createParagraphNode().append($createTextNode('第一段')),
        $createParagraphNode().append($createTextNode('第二段'))
      )
    }, { discrete: true })

    expect(editorStateToComposerDocument(editor.getEditorState())).toEqual({
      version: 2,
      segments: [{ kind: 'text', text: '第一段\n第二段' }]
    })
  })

  it('serializes one Atom node with token and unmergeable behavior', () => {
    const editor = createComposerEditor()
    composerDocumentToEditorState(editor, {
      version: 2,
      segments: [{
        kind: 'atom',
        atom: { type: 'member', agentId: 'agent-a', labelFallback: '洛可' }
      }]
    })

    editor.getEditorState().read(() => {
      const atom = $getRoot().getFirstDescendant()
      expect($isComposerAtomNode(atom)).toBe(true)
      if (!$isComposerAtomNode(atom)) return
      expect(atom.getMode()).toBe('token')
      expect(atom.isUnmergeable()).toBe(true)
      expect(atom.canInsertTextBefore()).toBe(false)
      expect(atom.canInsertTextAfter()).toBe(false)
    })
    const atomJson = (editor.getEditorState().toJSON().root.children[0] as unknown as {
      children: Array<Record<string, unknown>>
    }).children[0]
    expect(atomJson).toMatchObject({
      type: 'composer-atom',
      referenceId: 'agent-a',
      fallbackLabel: '洛可',
      mode: 'token'
    })
    expect(atomJson).not.toHaveProperty('presentationState')
  })

  it('reuses right-side whitespace when replacing a Typeahead query with an Atom', () => {
    const editor = createComposerEditor()
    editor.update(() => {
      $replaceEditorWithComposerDocument({
        version: 2,
        segments: [{ kind: 'text', text: '/rev 继续' }]
      })
      const paragraph = $getRoot().getFirstChildOrThrow()
      if (!$isElementNode(paragraph)) throw new Error('expected paragraph')
      const text = paragraph.getFirstChildOrThrow()
      if (text.getType() !== 'text') throw new Error('expected query text')
      const [query] = (text as ReturnType<typeof $createTextNode>).splitText(4)
      $insertComposerAtomWithTrailingSpace(query, {
        type: 'skill', skillId: 'skill-review', nameAtSend: 'review-pr'
      })
    }, { discrete: true })

    expect(editorStateToComposerDocument(editor.getEditorState())).toEqual({
      version: 2,
      segments: [
        {
          kind: 'atom',
          atom: { type: 'skill', skillId: 'skill-review', nameAtSend: 'review-pr' }
        },
        { kind: 'text', text: ' 继续' }
      ]
    })
  })
})
