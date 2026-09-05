import type { ComposerAtom } from '@contracts'
import {
  $applyNodeReplacement,
  $getState,
  $setState,
  createState,
  DecoratorNode,
  type EditorConfig,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode
} from 'lexical'

export type ComposerAtomType = ComposerAtom['type']
export type ComposerAtomAvailability = 'available' | 'unavailable'

export interface ComposerAtomPresentation {
  label: string
  availability: ComposerAtomAvailability
  interactive: boolean
  ariaLabel: string
}

export type SerializedComposerAtomNode = SerializedLexicalNode & {
  atomType?: ComposerAtomType
  referenceId?: string | null
  nameAtSend?: string | null
  fallbackLabel?: string
}

const atomTypeState = createState('atomType', {
  parse: (value) => value === 'member' || value === 'all_members' || value === 'skill'
    ? value
    : 'member'
})
const referenceIdState = createState('referenceId', {
  parse: (value) => typeof value === 'string' && value.length > 0 ? value : null
})
const nameAtSendState = createState('nameAtSend', {
  parse: (value) => typeof value === 'string' && value.length > 0 ? value : null
})
const fallbackLabelState = createState('fallbackLabel', {
  parse: (value) => typeof value === 'string' ? value : ''
})

const presentationResolvers = new WeakMap<LexicalEditor, (node: ComposerAtomNode) => ComposerAtomPresentation>()
const domEditors = new WeakMap<HTMLElement, LexicalEditor>()

export function setComposerAtomPresentationResolver(
  editor: LexicalEditor,
  resolver: ((node: ComposerAtomNode) => ComposerAtomPresentation) | null
): void {
  if (resolver) presentationResolvers.set(editor, resolver)
  else presentationResolvers.delete(editor)
}

export class ComposerAtomNode extends DecoratorNode<null> {
  static getType(): string {
    return 'composer-atom'
  }

  static clone(node: ComposerAtomNode): ComposerAtomNode {
    return new ComposerAtomNode(node.__key)
  }

  static importJSON(serializedNode: SerializedComposerAtomNode): ComposerAtomNode {
    return new ComposerAtomNode().updateFromJSON(serializedNode)
  }

  $config(): ReturnType<DecoratorNode<null>['$config']> {
    return this.config('composer-atom', {
      extends: DecoratorNode,
      stateConfigs: [
        { stateConfig: atomTypeState, flat: true },
        { stateConfig: referenceIdState, flat: true },
        { stateConfig: nameAtSendState, flat: true },
        { stateConfig: fallbackLabelState, flat: true }
      ]
    })
  }

  constructor(key?: NodeKey) {
    super(key)
  }

  updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedComposerAtomNode>): this {
    super.updateFromJSON(serializedNode)
    return this
      .setAtomType(serializedNode.atomType ?? 'member')
      .setReferenceId(serializedNode.referenceId ?? null)
      .setNameAtSend(serializedNode.nameAtSend ?? null)
      .setFallbackLabel(serializedNode.fallbackLabel ?? '')
  }

  exportJSON(): SerializedComposerAtomNode {
    return super.exportJSON() as SerializedComposerAtomNode
  }

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const dom = document.createElement('span')
    domEditors.set(dom, editor)
    updateComposerAtomDOM(dom, this, editor)
    return dom
  }

  updateDOM(_prevNode: this, dom: HTMLElement, _config: EditorConfig): boolean {
    const editor = domEditors.get(dom)
    if (editor) updateComposerAtomDOM(dom, this, editor)
    return false
  }

  decorate(): null {
    return null
  }

  isInline(): true {
    return true
  }

  isKeyboardSelectable(): true {
    return true
  }

  isIsolated(): false {
    return false
  }

  getAtomType(): ComposerAtomType {
    return $getState(this, atomTypeState)
  }

  setAtomType(value: ComposerAtomType): this {
    return $setState(this, atomTypeState, value)
  }

  getReferenceId(): string | null {
    return $getState(this, referenceIdState)
  }

  setReferenceId(value: string | null): this {
    return $setState(this, referenceIdState, value)
  }

  getNameAtSend(): string | null {
    return $getState(this, nameAtSendState)
  }

  setNameAtSend(value: string | null): this {
    return $setState(this, nameAtSendState, value)
  }

  getFallbackLabel(): string {
    return $getState(this, fallbackLabelState)
  }

  setFallbackLabel(value: string): this {
    return $setState(this, fallbackLabelState, value)
  }

  getAtom(): ComposerAtom {
    const atomType = this.getAtomType()
    if (atomType === 'all_members') return { type: 'all_members' }
    if (atomType === 'skill') {
      return {
        type: 'skill',
        skillId: this.getReferenceId() ?? '',
        nameAtSend: this.getNameAtSend() ?? this.getFallbackLabel()
      }
    }
    const labelFallback = this.getFallbackLabel()
    return labelFallback
      ? { type: 'member', agentId: this.getReferenceId() ?? '', labelFallback }
      : { type: 'member', agentId: this.getReferenceId() ?? '' }
  }
}

function updateComposerAtomDOM(
  dom: HTMLElement,
  node: ComposerAtomNode,
  editor: LexicalEditor
): void {
  const atom = node.getAtom()
  const fallback = atom.type === 'member'
    ? `@${atom.labelFallback ?? '不可用队员'}`
    : atom.type === 'all_members'
      ? '@所有队员'
      : `/${atom.nameAtSend}`
  const presentation = presentationResolvers.get(editor)?.(node) ?? {
    label: fallback,
    availability: 'available' as const,
    interactive: false,
    ariaLabel: fallback
  }
  dom.textContent = presentation.label
  dom.contentEditable = 'false'
  dom.spellcheck = false
  dom.className = [
    'structured-mention-token',
    atom.type === 'member'
      ? 'member-mention'
      : atom.type === 'all_members'
        ? 'all-members-mention'
        : 'skill-mention',
    presentation.interactive ? 'is-interactive' : '',
    presentation.availability === 'unavailable' ? 'is-unavailable' : ''
  ].filter(Boolean).join(' ')
  dom.dataset.composerAtom = atom.type
  dom.dataset.tokenKind = atom.type === 'member'
    ? 'member_mention'
    : atom.type === 'all_members'
      ? 'all_members_mention'
      : 'skill_mention'
  dom.dataset.referenceId = atom.type === 'all_members'
    ? ''
    : atom.type === 'member'
      ? atom.agentId
      : atom.skillId
  dom.dataset.availability = presentation.availability
  dom.setAttribute('aria-label', presentation.ariaLabel)
  dom.setAttribute('aria-invalid', presentation.availability === 'unavailable' ? 'true' : 'false')
  if (atom.type === 'member') dom.dataset.agentId = atom.agentId
  else delete dom.dataset.agentId
  if (atom.type === 'skill') {
    dom.dataset.skillId = atom.skillId
    dom.dataset.skillName = atom.nameAtSend
  } else {
    delete dom.dataset.skillId
    delete dom.dataset.skillName
  }
}

export function $createComposerAtomNode(atom: ComposerAtom): ComposerAtomNode {
  const node = $applyNodeReplacement(new ComposerAtomNode())
    .setAtomType(atom.type)
    .setReferenceId(atom.type === 'member' ? atom.agentId : atom.type === 'skill' ? atom.skillId : null)
    .setNameAtSend(atom.type === 'skill' ? atom.nameAtSend : null)
    .setFallbackLabel(atom.type === 'member' ? atom.labelFallback ?? '' : atom.type === 'skill' ? atom.nameAtSend : '所有队员')
  return node
}

export function $isComposerAtomNode(
  node: LexicalNode | null | undefined
): node is ComposerAtomNode {
  return node instanceof ComposerAtomNode
}
