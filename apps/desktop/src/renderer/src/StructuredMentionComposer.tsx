import type { CampComposerDraftView, ComposerAtom, ComposerDocument } from '@contracts'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  type MenuTextMatch,
  type TriggerFn
} from '@lexical/react/LexicalTypeaheadMenuPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isLineBreakNode,
  $isRangeSelection,
  $nodesOfType,
  CLEAR_HISTORY_COMMAND,
  HISTORY_PUSH_TAG,
  type LexicalEditor
} from 'lexical'
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type JSX,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import {
  ComposerAtomNode,
  setComposerAtomPresentationResolver,
  type ComposerAtomPresentation
} from './ComposerAtomNode'
import { MemberAvatar } from './MemberAvatar'
import {
  RovaiComposerExtension,
  setComposerExtensionRuntime,
  type ComposerExtensionRuntime
} from './RovaiComposerExtension'
import { SkillIdentityMark } from './SkillIdentityMark'
import type { ComposerSkillOption } from './composer-skill-picker'
import {
  $insertComposerAtomWithTrailingSpace,
  $replaceEditorWithComposerDocument
} from './composer-editor-state'
import {
  ComposerDraftSync,
  ROVAI_ATOM_PRESENTATION_TAG,
  ROVAI_COMPOSER_INITIALIZE_TAG,
  ROVAI_COMPOSER_REPLACE_TAG,
  type ComposerFlushResult,
  type ComposerFlushOptions,
  type ComposerPersistContext
} from './composer-draft-sync'
import {
  MAX_TYPEAHEAD_QUERY_LENGTH,
  composerDocumentToPlainText,
  emptyComposerDocument,
  parseComposerClipboardDocument,
  recoverComposerClipboardDocument,
  type ComposerLocalStatus
} from './composer-document'

export interface StructuredMentionMember {
  agentId: string
  displayName: string
  avatarRef?: string | null
  mentionable?: boolean
}

export type StructuredMentionOption =
  | { kind: 'all_members'; label: '所有队员' }
  | { kind: 'member'; member: StructuredMentionMember }

export interface StructuredMentionComposerHandle {
  flush(options?: ComposerFlushOptions): Promise<ComposerFlushResult<CampComposerDraftView>>
  resumePersistence(): void
  replaceDocument(
    document: ComposerDocument,
    result?: CampComposerDraftView | null,
    boundary?: 'start' | 'end'
  ): void
  setDocument(document: ComposerDocument, boundary?: 'start' | 'end'): void
  clearIfVersion(
    localVersion: number,
    document: ComposerDocument,
    result?: CampComposerDraftView | null
  ): boolean
  focus(boundary?: 'start' | 'end'): void
  getLocalVersion(): number
  isDirty(): boolean
}

export interface StructuredMentionComposerProps {
  id: string
  draftIdentity: string
  document: ComposerDocument
  ready?: boolean
  authoritativeResult?: CampComposerDraftView | null
  members: readonly StructuredMentionMember[]
  skills?: readonly ComposerSkillOption[] | null
  skillCatalogStatus?: 'loading' | 'ready' | 'error'
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  editorRef?: RefObject<HTMLDivElement | null>
  persistDocument?(
    document: ComposerDocument,
    context: ComposerPersistContext
  ): Promise<CampComposerDraftView>
  onDraftSaved?(draft: CampComposerDraftView, localVersion: number): void
  onLocalStatusChange?(status: ComposerLocalStatus): void
  onDirtyChange?(dirty: boolean): void
  onSubmit(): void | Promise<void>
  onBackspaceAtStart?(): void | Promise<void>
  onPasteFiles?(files: File[]): void
  onActivateMemberMention?(
    member: StructuredMentionMember,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
  onActivateSkillMention?(skillId: string, trigger: HTMLElement, focusPanel: boolean): void
}

export function structuredMentionOptions(
  members: readonly StructuredMentionMember[],
  query: string
): StructuredMentionOption[] {
  const normalizedQuery = query.toLocaleLowerCase()
  const options: StructuredMentionOption[] = []
  if ('所有队员'.includes(normalizedQuery)) options.push({ kind: 'all_members', label: '所有队员' })
  for (const member of members) {
    if (member.mentionable === false) continue
    if (!member.displayName.toLocaleLowerCase().includes(normalizedQuery)) continue
    options.push({ kind: 'member', member })
  }
  return options
}

export function structuredSkillOptions(
  skills: readonly ComposerSkillOption[],
  query: string
): ComposerSkillOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalizedQuery) return [...skills]
  return skills.filter((skill) => `${skill.name}\n${skill.description}`
    .toLocaleLowerCase('zh-CN')
    .includes(normalizedQuery))
}

export function StructuredMentionOptionAvatar({
  option
}: {
  option: StructuredMentionOption
}): JSX.Element {
  if (option.kind === 'all_members') {
    return <span className="mention-avatar" aria-hidden="true">@</span>
  }
  return <MemberAvatar agentId={option.member.agentId}
    avatarRef={option.member.avatarRef ?? null} displayName={option.member.displayName}
    size="mention" decorative className="mention-avatar" />
}

export function shouldSubmitStructuredComposerOnEnter(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  suggestionMenuOpen: boolean
}): boolean {
  return input.key === 'Enter'
    && !input.shiftKey
    && !input.isComposing
    && !input.suggestionMenuOpen
}

export function shouldHandleStructuredComposerBackspaceAtStart(input: {
  key: string
  isComposing: boolean
  selection: { anchor: number; focus: number }
}): boolean {
  return input.key === 'Backspace'
    && !input.isComposing
    && input.selection.anchor === 0
    && input.selection.focus === 0
}

export const StructuredMentionComposer = forwardRef<
  StructuredMentionComposerHandle,
  StructuredMentionComposerProps
>(function StructuredMentionComposer(props, ref): JSX.Element {
  return (
    <LexicalExtensionComposer key={props.draftIdentity}
      extension={RovaiComposerExtension} contentEditable={null}>
      <ComposerBridge {...props} forwardedRef={ref} />
    </LexicalExtensionComposer>
  )
})

function ComposerBridge({
  id,
  document,
  ready = true,
  authoritativeResult = null,
  members,
  skills = [],
  skillCatalogStatus = 'ready',
  ariaLabel,
  placeholder = '',
  disabled = false,
  className = '',
  editorRef,
  persistDocument,
  onDraftSaved,
  onLocalStatusChange,
  onDirtyChange,
  onSubmit,
  onBackspaceAtStart,
  onPasteFiles,
  onActivateMemberMention,
  onActivateAllMembersMention,
  onActivateSkillMention,
  forwardedRef
}: StructuredMentionComposerProps & {
  forwardedRef: ForwardedRef<StructuredMentionComposerHandle>
}): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const generatedId = useId()
  const syncRef = useRef<ComposerDraftSync<CampComposerDraftView> | null>(null)
  const initializedRef = useRef(false)
  const readyRef = useRef(ready)
  const callbacks = useRef({
    authoritativeResult,
    members,
    skills: skills ?? [],
    persistDocument,
    onDraftSaved,
    onLocalStatusChange,
    onDirtyChange,
    onSubmit,
    onBackspaceAtStart,
    onPasteFiles,
    onActivateMemberMention,
    onActivateAllMembersMention,
    onActivateSkillMention
  })
  callbacks.current = {
    authoritativeResult,
    members,
    skills: skills ?? [],
    persistDocument,
    onDraftSaved,
    onLocalStatusChange,
    onDirtyChange,
    onSubmit,
    onBackspaceAtStart,
    onPasteFiles,
    onActivateMemberMention,
    onActivateAllMembersMention,
    onActivateSkillMention
  }

  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [skillQuery, setSkillQuery] = useState<string | null>(null)
  const updateMentionQuery = useCallback((query: string | null) => {
    if (!editor.isComposing()) setMentionQuery(query)
  }, [editor])
  const updateSkillQuery = useCallback((query: string | null) => {
    if (!editor.isComposing()) setSkillQuery(query)
  }, [editor])
  const closeTypeaheads = useCallback(() => {
    setMentionQuery(null)
    setSkillQuery(null)
  }, [])
  const mentionOpen = mentionQuery !== null
  const skillOpen = skillQuery !== null
  const mentionOptions = useMemo(
    () => mentionQuery === null ? [] : structuredMentionOptions(members, mentionQuery),
    [members, mentionQuery]
  )
  const skillOptions = useMemo(
    () => skillQuery === null ? [] : structuredSkillOptions(skills ?? [], skillQuery),
    [skillQuery, skills]
  )
  const menuState = useRef({ mentionOpen, skillOpen, mentionOptions, skillOptions })
  menuState.current = { mentionOpen, skillOpen, mentionOptions, skillOptions }

  const bindings = useCallback(() => ({
    persist: callbacks.current.persistDocument,
    currentResult: () => callbacks.current.authoritativeResult,
    atomIsAvailable: (node: ComposerAtomNode) =>
      atomPresentation(node, callbacks.current).availability === 'available',
    onSaved: (draft: CampComposerDraftView, localVersion: number) =>
      callbacks.current.onDraftSaved?.(draft, localVersion),
    onStatusChange: (status: ComposerLocalStatus) =>
      callbacks.current.onLocalStatusChange?.(status),
    onDirtyChange: (dirty: boolean) => callbacks.current.onDirtyChange?.(dirty)
  }), [])

  const replaceAuthoritativeDocument = useCallback((
    nextDocument: ComposerDocument,
    result: CampComposerDraftView | null = null,
    boundary: 'start' | 'end' = 'end'
  ): void => {
    closeTypeaheads()
    editor.update(() => {
      $replaceEditorWithComposerDocument(
        nextDocument,
        (atom) => fallbackForAtom(atom, callbacks.current)
      )
      if (boundary === 'start') $getRoot().selectStart()
      else $getRoot().selectEnd()
    }, {
      discrete: true,
      tag: ROVAI_COMPOSER_REPLACE_TAG,
      onUpdate: () => {
        syncRef.current?.acceptAuthoritativeState(editor.getEditorState(), result)
        editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      }
    })
  }, [closeTypeaheads, editor])

  useLayoutEffect(() => {
    setComposerAtomPresentationResolver(
      editor,
      (node) => atomPresentation(node, callbacks.current)
    )
    const initialDocument = ready ? document : emptyComposerDocument()
    editor.update(() => {
      $replaceEditorWithComposerDocument(
        initialDocument,
        (atom) => fallbackForAtom(atom, callbacks.current)
      )
    }, { discrete: true, tag: ROVAI_COMPOSER_INITIALIZE_TAG })
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), bindings())
    const runtime: ComposerExtensionRuntime<CampComposerDraftView> = {
      sync,
      menuHasSelectableOption: () => {
        const state = menuState.current
        return (state.mentionOpen && state.mentionOptions.length > 0)
          || (state.skillOpen && state.skillOptions.length > 0)
      },
      submit: () => { void callbacks.current.onSubmit() },
      backspaceAtStart: () => { void callbacks.current.onBackspaceAtStart?.() },
      pasteFiles: (files) => callbacks.current.onPasteFiles?.(files),
      plainText: (selection) =>
        composerDocumentToPlainText(selection, callbacks.current.members),
      recoverClipboard: (value) => {
        const parsed = parseComposerClipboardDocument(value)
        return parsed
          ? recoverComposerClipboardDocument(
              parsed,
              callbacks.current.members,
              callbacks.current.skills
            )
          : null
      },
      activateAtom: (node, trigger, focusPanel) =>
        activateAtom(node, trigger, focusPanel, callbacks.current)
    }
    syncRef.current = sync
    setComposerExtensionRuntime(
      editor,
      runtime as unknown as ComposerExtensionRuntime<unknown>
    )
    initializedRef.current = true
    return () => {
      initializedRef.current = false
      void sync.flush().catch(() => undefined)
      sync.destroy()
      syncRef.current = null
      setComposerExtensionRuntime(editor, null)
      setComposerAtomPresentationResolver(editor, null)
    }
    // The editor instance owns its first document. Later prop refreshes are
    // deliberately ignored unless ready transitions or the imperative API
    // declares an authoritative replacement.
  }, [bindings, editor])

  useEffect(() => {
    const sync = syncRef.current
    if (!sync) return
    sync.updateBindings(bindings())
    setComposerAtomPresentationResolver(
      editor,
      (node) => atomPresentation(node, callbacks.current)
    )
    editor.update(() => {
      for (const atom of $nodesOfType(ComposerAtomNode)) atom.markDirty()
    }, { tag: ROVAI_ATOM_PRESENTATION_TAG })
  }, [bindings, editor, members, skills])

  useLayoutEffect(() => {
    if (!initializedRef.current || readyRef.current || !ready) {
      readyRef.current = ready
      return
    }
    readyRef.current = true
    replaceAuthoritativeDocument(document, authoritativeResult)
  }, [authoritativeResult, document, ready, replaceAuthoritativeDocument])

  useEffect(() => { editor.setEditable(ready && !disabled) }, [disabled, editor, ready])

  useImperativeHandle(forwardedRef, () => ({
    flush: async (options) => {
      const sync = syncRef.current
      if (!sync) {
        return {
          document,
          localVersion: 0,
          savedVersion: 0,
          result: authoritativeResult
        }
      }
      return sync.flush(options)
    },
    resumePersistence: () => syncRef.current?.resumePersistence(),
    replaceDocument: replaceAuthoritativeDocument,
    setDocument(nextDocument, boundary = 'end') {
      closeTypeaheads()
      editor.update(() => {
        $replaceEditorWithComposerDocument(
          nextDocument,
          (atom) => fallbackForAtom(atom, callbacks.current)
        )
        if (boundary === 'start') $getRoot().selectStart()
        else $getRoot().selectEnd()
      }, { discrete: true, tag: HISTORY_PUSH_TAG })
      editor.focus(undefined, { defaultSelection: boundary === 'start' ? 'rootStart' : 'rootEnd' })
    },
    clearIfVersion(localVersion, nextDocument, result = null) {
      const sync = syncRef.current
      if (!sync || sync.getLocalVersion() !== localVersion) return false
      replaceAuthoritativeDocument(nextDocument, result)
      return true
    },
    focus(boundary = 'end') {
      editor.update(() => {
        if (boundary === 'start') $getRoot().selectStart()
        else $getRoot().selectEnd()
      }, { discrete: true })
      editor.focus(undefined, { defaultSelection: boundary === 'start' ? 'rootStart' : 'rootEnd' })
    },
    getLocalVersion: () => syncRef.current?.getLocalVersion() ?? 0,
    isDirty: () => syncRef.current?.isDirty() ?? false
  }), [authoritativeResult, closeTypeaheads, document, editor, replaceAuthoritativeDocument])

  const setEditorElement = useCallback((element: HTMLDivElement | null) => {
    if (editorRef) editorRef.current = element
  }, [editorRef])

  const mentionTrigger = useMemo(() => createTypeaheadTrigger('@', 'member'), [])
  const skillTrigger = useMemo(() => createTypeaheadTrigger('/', 'skill'), [])
  const mentionMenuOptions = useMemo(
    () => mentionOptions.slice(0, 50).map((option) => new MemberTypeaheadOption(option)),
    [mentionOptions]
  )
  const skillMenuOptions = useMemo(
    () => skillOptions.slice(0, 50).map((option) => new SkillTypeaheadOption(option)),
    [skillOptions]
  )
  const mentionMenuId = `${id || generatedId}-mention-options`
  const skillMenuId = `${id || generatedId}-skill-options`
  const menuOpen = mentionOpen || skillOpen

  return <div className={`structured-mention-composer ${className}`.trim()}>
    <ContentEditable id={id} ref={setEditorElement}
      className="structured-mention-editor" aria-label={ariaLabel}
      aria-expanded={menuOpen} aria-controls={skillOpen ? skillMenuId : mentionMenuId}
      aria-disabled={disabled || !ready} spellCheck
      placeholder={<span className="structured-mention-placeholder">{placeholder}</span>}
      aria-placeholder={placeholder} />
    <LexicalTypeaheadMenuPlugin<MemberTypeaheadOption>
      triggerFn={mentionTrigger} options={mentionMenuOptions}
      onQueryChange={updateMentionQuery}
      onClose={() => setMentionQuery(null)}
      onSelectOption={(option, queryNode, close) => {
        if (!queryNode || editor.isComposing()) return
        editor.update(() => {
          const atom: ComposerAtom = option.value.kind === 'all_members'
            ? { type: 'all_members' }
            : {
                type: 'member',
                agentId: option.value.member.agentId,
                labelFallback: option.value.member.displayName
              }
          $insertComposerAtomWithTrailingSpace(
            queryNode,
            atom,
            option.value.kind === 'member' ? option.value.member.displayName : '所有队员'
          )
        }, { tag: HISTORY_PUSH_TAG })
        close()
      }}
      menuRenderFn={mentionMenuRender(mentionMenuId)} />
    <LexicalTypeaheadMenuPlugin<SkillTypeaheadOption>
      triggerFn={skillTrigger} options={skillMenuOptions}
      onQueryChange={updateSkillQuery}
      onClose={() => setSkillQuery(null)}
      onSelectOption={(option, queryNode, close) => {
        if (!queryNode || editor.isComposing()) return
        editor.update(() => {
          $insertComposerAtomWithTrailingSpace(queryNode, {
            type: 'skill',
            skillId: option.value.id,
            nameAtSend: option.value.name
          }, option.value.name)
        }, { tag: HISTORY_PUSH_TAG })
        close()
      }}
      menuRenderFn={skillMenuRender(skillMenuId, skillCatalogStatus)} />
  </div>
}

class MemberTypeaheadOption extends MenuOption {
  readonly value: StructuredMentionOption

  constructor(value: StructuredMentionOption) {
    super(value.kind === 'all_members' ? 'all-members' : `member:${value.member.agentId}`)
    this.value = value
  }
}

class SkillTypeaheadOption extends MenuOption {
  readonly value: ComposerSkillOption

  constructor(value: ComposerSkillOption) {
    super(`skill:${value.id}`)
    this.value = value
  }
}

function mentionMenuRender(menuId: string): MenuRenderFn<MemberTypeaheadOption> {
  return (anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options }) => {
    const anchor = anchorRef.current
    if (!anchor) return null
    return createPortal(
      <div id={menuId} className="mention-menu structured-mention-menu" role="listbox"
        aria-label="选择接收队员">
        <div className="mention-menu-heading"><strong>选择接收者</strong><span>↑↓ 选择 · Enter 确认</span></div>
        {options.length === 0
          ? <p className="structured-mention-empty">没有匹配的队员</p>
          : options.map((option, index) => <button type="button" role="option"
              key={option.key} ref={(element) => option.setRefElement(element)}
              aria-selected={selectedIndex === index}
              className={selectedIndex === index ? 'active' : ''}
              onMouseMove={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectOptionAndCleanUp(option)}>
              <StructuredMentionOptionAvatar option={option.value} />
              <span>
                <strong>{option.value.kind === 'all_members'
                  ? '所有队员'
                  : option.value.member.displayName}</strong>
                <small>{option.value.kind === 'all_members'
                  ? '广播给当前全部队员'
                  : 'Camp 成员'}</small>
              </span>
              <i aria-hidden="true" />
            </button>)}
      </div>,
      anchor
    )
  }
}

function skillMenuRender(
  menuId: string,
  status: 'loading' | 'ready' | 'error'
): MenuRenderFn<SkillTypeaheadOption> {
  return (anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex, options }) => {
    const anchor = anchorRef.current
    if (!anchor) return null
    return createPortal(
      <div id={menuId} className="mention-menu skill-picker-menu structured-skill-menu"
        role="listbox" aria-label="选择 Skill">
        <div className="mention-menu-heading"><strong>选择 Skill</strong><span>↑↓ 选择 · Enter 确认</span></div>
        {status === 'loading'
          ? <p className="structured-mention-empty">正在读取可用 Skills…</p>
          : status === 'error'
            ? <p className="structured-mention-empty">Skills 暂时无法读取，请稍后重试</p>
            : options.length === 0
              ? <p className="structured-mention-empty">没有匹配的 Skill</p>
              : options.map((option, index) => <button type="button" role="option"
                  key={option.key} ref={(element) => option.setRefElement(element)}
                  data-skill-name={option.value.name}
                  aria-selected={selectedIndex === index}
                  className={selectedIndex === index ? 'active' : ''}
                  onMouseMove={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOptionAndCleanUp(option)}>
                  <SkillIdentityMark skillId={option.value.id} name={option.value.name} size="compact" />
                  <span className="skill-picker-copy">
                    <strong>/{option.value.name}</strong>
                    <small>{option.value.description}</small>
                  </span>
                  <span className="skill-picker-enter" aria-hidden="true">↵</span>
                </button>)}
      </div>,
      anchor
    )
  }
}

function createTypeaheadTrigger(symbol: '@' | '/', kind: 'member' | 'skill'): TriggerFn {
  const queryPattern = kind === 'member'
    ? '[\\p{L}\\p{N}_-]'
    : '[A-Za-z0-9-]'
  const boundaryPattern = '[\\s，。！？；：、（(\\[【{「『]'
  const pattern = new RegExp(
    `(^|${boundaryPattern})${symbol}(${queryPattern}{0,${MAX_TYPEAHEAD_QUERY_LENGTH}})$`,
    'u'
  )
  return (text: string, editor: LexicalEditor): MenuTextMatch | null => {
    if (editor.isComposing()) return null
    const bounded = text.slice(-(MAX_TYPEAHEAD_QUERY_LENGTH + 2))
    const match = pattern.exec(bounded)
    if (!match) return null
    const query = match[2] ?? ''
    const replaceableString = `${symbol}${query}`
    const leadOffset = text.length - replaceableString.length
    if (leadOffset === 0) {
      const selection = $getSelection()
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
      const previous = selection.anchor.getNode().getPreviousSibling()
      if (previous && !$isLineBreakNode(previous)) return null
    }
    return { leadOffset, matchingString: query, replaceableString }
  }
}

function fallbackForAtom(
  atom: ComposerAtom,
  input: Pick<StructuredMentionComposerProps, 'members' | 'skills'>
): string | undefined {
  if (atom.type === 'member') {
    return input.members.find((member) => member.agentId === atom.agentId)?.displayName
      ?? atom.labelFallback
  }
  if (atom.type === 'skill') {
    return (input.skills ?? []).find((skill) => skill.id === atom.skillId)?.name
      ?? atom.nameAtSend
  }
  return '所有队员'
}

function atomPresentation(
  node: ComposerAtomNode,
  input: Pick<StructuredMentionComposerProps,
    'members' | 'skills' | 'onActivateMemberMention'
    | 'onActivateAllMembersMention' | 'onActivateSkillMention'>
): ComposerAtomPresentation {
  const atom = node.getAtom()
  if (atom.type === 'member') {
    const member = input.members.find((candidate) => candidate.agentId === atom.agentId)
    const available = Boolean(member && member.mentionable !== false)
    const label = member?.displayName ?? atom.labelFallback ?? '不可用队员'
    return {
      label: label.startsWith('@') ? label : `@${label}`,
      availability: available ? 'available' : 'unavailable',
      interactive: Boolean(available && input.onActivateMemberMention),
      ariaLabel: available ? `成员 ${label}` : `成员 ${label} 当前不可用`
    }
  }
  if (atom.type === 'all_members') {
    return {
      label: '@所有队员',
      availability: 'available',
      interactive: Boolean(input.onActivateAllMembersMention),
      ariaLabel: '所有队员'
    }
  }
  const skill = (input.skills ?? []).find((candidate) => candidate.id === atom.skillId)
  return {
    label: `/${skill?.name ?? atom.nameAtSend}`,
    availability: skill ? 'available' : 'unavailable',
    interactive: Boolean(input.onActivateSkillMention),
    ariaLabel: skill ? `Skill ${skill.name}` : `Skill ${atom.nameAtSend} 当前不可用`
  }
}

function activateAtom(
  node: ComposerAtomNode,
  trigger: HTMLElement,
  focusPanel: boolean,
  input: Pick<StructuredMentionComposerProps,
    'members' | 'onActivateMemberMention'
    | 'onActivateAllMembersMention' | 'onActivateSkillMention'>
): void {
  const atom = node.getAtom()
  if (atom.type === 'member') {
    const member = input.members.find((candidate) => candidate.agentId === atom.agentId)
    if (member && member.mentionable !== false) {
      input.onActivateMemberMention?.(member, trigger, focusPanel)
    }
  } else if (atom.type === 'all_members') {
    input.onActivateAllMembersMention?.(trigger, focusPanel)
  } else {
    input.onActivateSkillMention?.(atom.skillId, trigger, focusPanel)
  }
}
