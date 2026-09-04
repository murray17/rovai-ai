import type { StructuredCampMessageContent } from '@contracts'
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import {
  deleteStructuredBackward,
  deleteStructuredForward,
  insertAllMembersMentionWithTrailingSpace,
  insertMemberMentionWithTrailingSpace,
  insertSkillMentionWithTrailingSpace as insertStructuredSkillMentionWithTrailingSpace,
  insertStructuredText,
  normalizeStructuredMentionContent,
  pasteStructuredPlainText,
  replaceStructuredSelection,
  selectedStructuredMentionContent,
  skillQueryAtCaret,
  structuredMentionContentLength,
  type StructuredMentionContent,
  type StructuredMentionEditorState,
  type StructuredMentionSelection,
  type StructuredSkillQuery
} from './structured-mention-model'
import { MemberAvatar } from './MemberAvatar'
import { SkillIdentityMark } from './SkillIdentityMark'
import type { ComposerSkillOption } from './composer-skill-picker'
import {
  createStructuredMessageClipboardData,
  readStructuredMessageClipboardContent
} from './structured-message-clipboard'

export interface StructuredMentionMember {
  agentId: string
  displayName: string
  avatarRef?: string | null
  mentionable?: boolean
}

export interface StructuredMentionQuery {
  start: number
  end: number
  query: string
}

export type { StructuredSkillQuery } from './structured-mention-model'

export type StructuredMentionOption =
  | { kind: 'all_members'; label: '所有队员' }
  | { kind: 'member'; member: StructuredMentionMember }

export interface StructuredMentionComposerProps {
  id: string
  value: StructuredCampMessageContent
  members: readonly StructuredMentionMember[]
  skills?: readonly ComposerSkillOption[] | null
  skillCatalogStatus?: 'loading' | 'ready' | 'error'
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  editorRef?: RefObject<HTMLDivElement | null>
  onChange(content: StructuredCampMessageContent): void
  onSubmit(): void | Promise<void>
  onBackspaceAtStart?(): void | Promise<void>
  onPasteFiles?(files: File[]): void
  onActivateMemberMention?(
    member: StructuredMentionMember,
    trigger: HTMLElement,
    focusPanel: boolean
  ): void
  onActivateAllMembersMention?(trigger: HTMLElement, focusPanel: boolean): void
}

export function structuredMentionOptions(
  members: readonly StructuredMentionMember[],
  query: string
): StructuredMentionOption[] {
  const normalizedQuery = query.toLocaleLowerCase()
  const options: StructuredMentionOption[] = []
  if ('所有队员'.includes(normalizedQuery)) {
    options.push({ kind: 'all_members', label: '所有队员' })
  }
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
  return (
    <MemberAvatar
      agentId={option.member.agentId}
      avatarRef={option.member.avatarRef ?? null}
      displayName={option.member.displayName}
      size="mention"
      decorative
      className="mention-avatar"
    />
  )
}

export function mentionQueryAfterTypedText(
  current: StructuredMentionQuery | null,
  selection: StructuredMentionSelection,
  text: string
): StructuredMentionQuery | null {
  const insertionStart = Math.min(selection.anchor, selection.focus)
  if (text === '@') {
    return { start: insertionStart, end: insertionStart + 1, query: '' }
  }
  if (
    !current
    || selection.anchor !== selection.focus
    || selection.anchor !== current.end
    || /[\s@]/u.test(text)
  ) return null
  return {
    ...current,
    end: current.end + text.length,
    query: `${current.query}${text}`
  }
}

export function mentionQueryAfterNativeTextInput(
  current: StructuredMentionQuery | null,
  selectionAfterInput: StructuredMentionSelection,
  text: string
): StructuredMentionQuery | null {
  if (selectionAfterInput.anchor !== selectionAfterInput.focus) return null
  const insertionEnd = selectionAfterInput.anchor
  if (
    text !== '@'
    && current
    && current.end === insertionEnd
    && current.query.endsWith(text)
  ) return current
  const insertionStart = Math.max(0, insertionEnd - text.length)
  return mentionQueryAfterTypedText(
    current,
    { anchor: insertionStart, focus: insertionStart },
    text
  )
}

export function insertSkillMentionWithTrailingSpace(
  state: StructuredMentionEditorState,
  skillId: string,
  nameAtSend: string
): StructuredMentionEditorState {
  return insertStructuredSkillMentionWithTrailingSpace(state, skillId, nameAtSend)
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

export function shouldReconcileStructuredComposerComposition(input: {
  scheduledGeneration: number
  currentGeneration: number
  isComposing: boolean
  sameEditor: boolean
}): boolean {
  return input.scheduledGeneration === input.currentGeneration
    && !input.isComposing
    && input.sameEditor
}

export function shouldHandleStructuredComposerBackspaceAtStart(input: {
  key: string
  isComposing: boolean
  selection: StructuredMentionSelection
}): boolean {
  return input.key === 'Backspace'
    && !input.isComposing
    && input.selection.anchor === 0
    && input.selection.focus === 0
}

const TOKEN_STYLE: CSSProperties = {
  display: 'inline',
  maxWidth: '100%',
  margin: 0,
  padding: '0 1px',
  border: 0,
  borderRadius: '3px',
  fontWeight: 600,
  lineHeight: 'inherit',
  whiteSpace: 'nowrap',
  userSelect: 'all',
  cursor: 'default'
}

const EDITOR_STYLE: CSSProperties = {
  minHeight: '42px',
  padding: '5px 0 4px',
  color: 'var(--ink)',
  caretColor: 'var(--brand)',
  fontSize: '13px',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  cursor: 'text'
}

const EDITOR_CARET_SENTINEL = '\u200B'

type StructuredComposerQuery =
  | { kind: 'mention'; value: StructuredMentionQuery }
  | { kind: 'skill'; value: StructuredSkillQuery }

function composerQueryAfterEdit(
  state: StructuredMentionEditorState,
  mentionQuery: StructuredMentionQuery | null = null
): StructuredComposerQuery | null {
  if (mentionQuery) return { kind: 'mention', value: mentionQuery }
  const skillQuery = skillQueryAtCaret(state.content, state.selection)
  return skillQuery ? { kind: 'skill', value: skillQuery } : null
}

function skillQueriesEqual(left: StructuredSkillQuery | null, right: StructuredSkillQuery): boolean {
  return left !== null
    && left.start === right.start
    && left.end === right.end
    && left.query === right.query
}

interface EditorDomSnapshot {
  node: Node
  children: EditorDomSnapshot[]
}

export function StructuredMentionComposer({
  id,
  value,
  members,
  skills = [],
  skillCatalogStatus = 'ready',
  ariaLabel,
  placeholder = '',
  disabled = false,
  className = '',
  editorRef: providedEditorRef,
  onChange,
  onSubmit,
  onBackspaceAtStart,
  onPasteFiles,
  onActivateMemberMention,
  onActivateAllMembersMention
}: StructuredMentionComposerProps): JSX.Element {
  const fallbackEditorRef = useRef<HTMLDivElement>(null)
  const editorRef = providedEditorRef ?? fallbackEditorRef
  const menuRef = useRef<HTMLDivElement>(null)
  const pendingSelectionRef = useRef<StructuredMentionSelection | null>(null)
  const restoreFocusAfterDomResetRef = useRef(false)
  const lastSelectionRef = useRef<StructuredMentionSelection>({ anchor: 0, focus: 0 })
  const isComposingRef = useRef(false)
  const compositionFrameRef = useRef<number | null>(null)
  const compositionGenerationRef = useRef(0)
  const editorDomProjectionRef = useRef<{
    content: StructuredMentionContent
    tree: EditorDomSnapshot
  } | null>(null)
  const [query, setQuery] = useState<StructuredComposerQuery | null>(null)
  const [activeOption, setActiveOption] = useState(0)
  const [editorDomRevision, setEditorDomRevision] = useState(0)
  const generatedId = useId()
  const mentionMenuId = `${id || generatedId}-mention-options`
  const skillMenuId = `${id || generatedId}-skill-options`
  const content = useMemo(() => authorableStructuredContent(value), [value])
  const memberById = useMemo(
    () => new Map(members.map((member) => [member.agentId, member])),
    [members]
  )
  const skillById = useMemo(
    () => new Map((skills ?? []).map((skill) => [skill.id, skill])),
    [skills]
  )
  const mentionOptions = useMemo(
    () => query?.kind === 'mention'
      ? structuredMentionOptions(members, query.value.query)
      : [],
    [members, query]
  )
  const skillOptions = useMemo(
    () => query?.kind === 'skill' && skills
      ? structuredSkillOptions(skills, query.value.query)
      : [],
    [query, skills]
  )
  const menuOpen = query !== null
  const menuId = query?.kind === 'skill' ? skillMenuId : mentionMenuId
  const optionCount = query?.kind === 'skill' ? skillOptions.length : mentionOptions.length
  const activeOptionIndex = Math.min(activeOption, Math.max(0, optionCount - 1))

  useEffect(() => {
    setActiveOption(0)
  }, [query?.kind, query?.value.query, query?.value.start])

  useEffect(() => {
    setActiveOption((current) => Math.min(current, Math.max(0, optionCount - 1)))
  }, [optionCount])

  useLayoutEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeOptionIndex, mentionOptions, skillOptions])

  useLayoutEffect(() => {
    // A parent draft replacement must not leave a query pointing at old text.
    // Validate only an open query so Escape and restored drafts stay closed.
    setQuery((current) => current?.kind === 'skill'
      && !skillQueriesEqual(skillQueryAtCaret(content, lastSelectionRef.current), current.value)
      ? null
      : current)
  }, [content])

  useEffect(() => () => {
    compositionGenerationRef.current += 1
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current)
      compositionFrameRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const editor = editorRef.current
    const pending = pendingSelectionRef.current
    if (!editor) return
    const projection = editorDomProjectionRef.current
    if (
      !projection
      || projection.tree.node !== editor
      || !structuredContentEqual(projection.content, content)
    ) {
      // Only a new host or changed React content establishes a new projection.
      // An equal parent refresh during IME must not adopt native replacement nodes.
      editorDomProjectionRef.current = { content, tree: captureEditorDom(editor) }
    }
    if (!pending) return
    if (restoreFocusAfterDomResetRef.current) {
      editor.focus({ preventScroll: true })
    }
    restoreDomSelection(editor, pending)
    pendingSelectionRef.current = null
    restoreFocusAfterDomResetRef.current = false
  }, [content, editorDomRevision])

  const currentSelection = (): StructuredMentionSelection => {
    const editor = editorRef.current
    if (!editor) return lastSelectionRef.current
    const selection = readDomSelection(editor)
    lastSelectionRef.current = selection
    return selection
  }

  const emitState = (next: StructuredMentionEditorState): void => {
    pendingSelectionRef.current = next.selection
    lastSelectionRef.current = next.selection
    onChange(next.content)
  }

  const scheduleEditorDomReset = (
    editor: HTMLDivElement,
    selection: StructuredMentionSelection
  ): void => {
    const editorFocused = document.activeElement === editor
    pendingSelectionRef.current = editorFocused ? selection : null
    restoreFocusAfterDomResetRef.current = editorFocused
    setEditorDomRevision((current) => current + 1)
  }

  const stateForControlledEdit = (selection = currentSelection()): StructuredMentionEditorState => {
    const editor = editorRef.current
    if (!editor || !editorDomRequiresOwnershipReset(
      editor,
      content,
      editorDomProjectionRef.current?.tree
    )) {
      return { content, selection }
    }

    // A controlled edit can arrive before Chromium emits an input event for a
    // native DOM replacement. Preserve that native state and remount the whole
    // editor host before React commits the edit; diffing the stale descendants
    // can otherwise throw removeChild and unmount the Renderer root.
    const nativeContent = readStructuredContent(editor)
    scheduleEditorDomReset(editor, selection)
    return { content: nativeContent, selection }
  }

  const closeQueryIfSelectionMoved = (): void => {
    if (!query || isComposingRef.current) return
    const selection = currentSelection()
    if (query.kind === 'skill') {
      const nextQuery = skillQueryAtCaret(content, selection)
      if (!skillQueriesEqual(nextQuery, query.value)) {
        setQuery(nextQuery?.start === query.value.start ? { kind: 'skill', value: nextQuery } : null)
      }
      return
    }
    const activeQuery = query.value
    if (
      selection.anchor !== selection.focus
      || selection.anchor < activeQuery.start + 1
      || selection.anchor > activeQuery.end
    ) {
      setQuery(null)
      return
    }
  }

  const syncNativeDom = (nativeEvent?: InputEvent): StructuredMentionEditorState | null => {
    const editor = editorRef.current
    if (!editor) return null
    const nextContent = readStructuredContent(editor)
    const nextSelection = readDomSelection(editor)
    const editorFocused = document.activeElement === editor
    const requiresOwnershipReset = editorDomRequiresOwnershipReset(
      editor,
      content,
      editorDomProjectionRef.current?.tree
    )
    const contentChanged = !structuredContentEqual(content, nextContent)
    lastSelectionRef.current = nextSelection
    if (requiresOwnershipReset) {
      // IME and native contenteditable editing may wrap, replace, or insert
      // nodes below the editor. Never remove those nodes imperatively: doing so
      // can detach a React-owned descendant and make a later commit throw from
      // removeChild. Remount the editor host instead, so React discards the
      // mutated subtree as one unit and establishes ownership again.
      // Identical markup can still contain split or replaced, unowned nodes.
      scheduleEditorDomReset(editor, nextSelection)
    }
    if (contentChanged) {
      pendingSelectionRef.current = editorFocused ? nextSelection : null
      onChange(nextContent)
    }
    const next = { content: nextContent, selection: nextSelection }
    setQuery((current) => {
      if (!editorFocused) return null
      const nextMentionQuery = nativeEvent?.inputType === 'insertText' && nativeEvent.data !== null
        ? mentionQueryAfterNativeTextInput(
          current?.kind === 'mention' ? current.value : null,
          nextSelection,
          nativeEvent.data
        )
        : null
      return composerQueryAfterEdit(next, nextMentionQuery)
    })
    return next
  }

  const reconcilePendingComposition = (): StructuredMentionEditorState | null => {
    const frame = compositionFrameRef.current
    if (frame === null || isComposingRef.current) return null
    window.cancelAnimationFrame(frame)
    compositionFrameRef.current = null
    compositionGenerationRef.current += 1
    return syncNativeDom()
  }

  const chooseMentionOption = (option: StructuredMentionOption | undefined): void => {
    if (!option || query?.kind !== 'mention' || disabled || isComposingRef.current) return
    const state: StructuredMentionEditorState = {
      content,
      selection: { anchor: query.value.start, focus: query.value.end }
    }
    const next = option.kind === 'all_members'
      ? insertAllMembersMentionWithTrailingSpace(state)
      : insertMemberMentionWithTrailingSpace(state, option.member.agentId)
    setQuery(null)
    emitState(next)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }

  const chooseSkillOption = (option: ComposerSkillOption | undefined): void => {
    if (!option || query?.kind !== 'skill' || disabled || isComposingRef.current) return
    if (!skillQueriesEqual(skillQueryAtCaret(content, currentSelection()), query.value)) {
      setQuery(null)
      return
    }
    const state: StructuredMentionEditorState = {
      content,
      selection: { anchor: query.value.start, focus: query.value.end }
    }
    const next = insertSkillMentionWithTrailingSpace(state, option.id, option.name)
    setQuery(null)
    emitState(next)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }

  const deleteFromKeyboard = (
    direction: 'backward' | 'forward',
    state = stateForControlledEdit()
  ): void => {
    const selection = state.selection
    const next = direction === 'backward'
      ? deleteStructuredBackward(state)
      : deleteStructuredForward(state)
    emitState(next)
    setQuery((current) => {
      const nextMentionQuery = current?.kind === 'mention'
        ? queryAfterDeletion(current.value, selection, direction)
        : null
      return composerQueryAfterEdit(next, nextMentionQuery)
    })
  }

  const handleBeforeInput = (event: FormEvent<HTMLDivElement>): void => {
    if (disabled || isComposingRef.current) return
    const nativeEvent = event.nativeEvent as InputEvent
    if (nativeEvent.isComposing) return
    const selection = currentSelection()

    if (nativeEvent.inputType === 'insertText' && nativeEvent.data !== null) {
      event.preventDefault()
      const next = insertStructuredText(stateForControlledEdit(selection), nativeEvent.data)
      emitState(next)
      setQuery((current) => {
        const nextMentionQuery = mentionQueryAfterTypedText(
          current?.kind === 'mention' ? current.value : null,
          selection,
          nativeEvent.data ?? ''
        )
        return composerQueryAfterEdit(next, nextMentionQuery)
      })
      return
    }
    if (nativeEvent.inputType === 'insertParagraph' || nativeEvent.inputType === 'insertLineBreak') {
      event.preventDefault()
      setQuery(null)
      emitState(insertStructuredText(stateForControlledEdit(selection), '\n'))
      return
    }
    if (nativeEvent.inputType === 'deleteContentBackward') {
      event.preventDefault()
      deleteFromKeyboard('backward')
      return
    }
    if (nativeEvent.inputType === 'deleteContentForward') {
      event.preventDefault()
      deleteFromKeyboard('forward')
      return
    }
    if (nativeEvent.inputType === 'deleteByCut') {
      event.preventDefault()
      const next = replaceStructuredSelection(stateForControlledEdit(selection), [])
      emitState(next)
      setQuery(composerQueryAfterEdit(next))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const isComposing = isComposingRef.current
      || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229
    if (isComposing) return
    if (document.activeElement !== event.currentTarget) return
    const reconciledCompositionState = ['Enter', 'Backspace', 'Delete', 'Escape'].includes(event.key)
      ? reconcilePendingComposition()
      : null

    if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (optionCount > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveOption((current) => (Math.min(current, optionCount - 1) + direction + optionCount) % optionCount)
      }
      return
    }
    if ((menuOpen || reconciledCompositionState) && event.key === 'Escape') {
      event.preventDefault()
      setQuery(null)
      return
    }
    if (menuOpen && ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab')) {
      if (optionCount > 0) {
        event.preventDefault()
        if (query?.kind === 'skill') chooseSkillOption(skillOptions[activeOptionIndex])
        else chooseMentionOption(mentionOptions[activeOptionIndex])
        return
      }
      setQuery(null)
      if (event.key === 'Tab') return
    }
    if (
      onBackspaceAtStart
      && shouldHandleStructuredComposerBackspaceAtStart({
        key: event.key,
        isComposing,
        selection: reconciledCompositionState?.selection ?? currentSelection()
      })
    ) {
      event.preventDefault()
      setQuery(null)
      void onBackspaceAtStart()
      return
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      deleteFromKeyboard('backward', reconciledCompositionState ?? stateForControlledEdit())
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      deleteFromKeyboard('forward', reconciledCompositionState ?? stateForControlledEdit())
      return
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      setQuery(null)
      emitState(insertStructuredText(reconciledCompositionState ?? stateForControlledEdit(), '\n'))
      return
    }
    if (shouldSubmitStructuredComposerOnEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing,
      suggestionMenuOpen: menuOpen && optionCount > 0
    })) {
      event.preventDefault()
      void onSubmit()
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file')
      .flatMap((item) => item.getAsFile() ?? [])
    if (files.length > 0) {
      if (onPasteFiles) {
        event.preventDefault()
        onPasteFiles(files)
      }
      return
    }
    event.preventDefault()
    const plainText = event.clipboardData.getData('text/plain')
    const structuredContent = readStructuredMessageClipboardContent(
      event.clipboardData.getData('text/html'),
      plainText,
      members
    )
    const baseState = stateForControlledEdit()
    const next = structuredContent
      ? replaceStructuredSelection(baseState, authorableStructuredContent(structuredContent))
      : pasteStructuredPlainText(baseState, plainText)
    emitState(next)
    setQuery(composerQueryAfterEdit(next))
  }

  const handleCut = (event: ClipboardEvent<HTMLDivElement>): void => {
    if (disabled || isComposingRef.current) {
      event.preventDefault()
      return
    }
    const selection = currentSelection()
    if (selection.anchor === selection.focus) return
    // Own Cut before Chromium mutates the contenteditable subtree. Waiting for
    // deleteByCut leaves a native filler BR that can be mistaken for a newline.
    event.preventDefault()
    const state = stateForControlledEdit(selection)
    const selectedContent = selectedStructuredMentionContent(state)
    const structuredClipboard = createStructuredMessageClipboardData(selectedContent, members)
    if (structuredClipboard) {
      event.clipboardData.setData('text/plain', structuredClipboard.text)
      event.clipboardData.setData('text/html', structuredClipboard.html)
    } else {
      event.clipboardData.setData(
        'text/plain',
        selectedContent.map((segment) => segment.kind === 'text' ? segment.text : '').join('')
      )
    }
    const next = replaceStructuredSelection(state, [])
    emitState(next)
    setQuery(composerQueryAfterEdit(next))
  }

  const handleCompositionStart = (_event: CompositionEvent<HTMLDivElement>): void => {
    isComposingRef.current = true
    compositionGenerationRef.current += 1
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current)
      compositionFrameRef.current = null
    }
    setQuery(null)
  }

  const handleCompositionEnd = (event: CompositionEvent<HTMLDivElement>): void => {
    isComposingRef.current = false
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current)
    }
    const scheduledGeneration = compositionGenerationRef.current
    const scheduledEditor = event.currentTarget
    compositionFrameRef.current = window.requestAnimationFrame(() => {
      compositionFrameRef.current = null
      if (!shouldReconcileStructuredComposerComposition({
        scheduledGeneration,
        currentGeneration: compositionGenerationRef.current,
        isComposing: isComposingRef.current,
        sameEditor: editorRef.current === scheduledEditor
      })) return
      syncNativeDom()
    })
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const editor = editorRef.current
    const token = closestToken(event.target)
    if (!editor || !token || !editor.contains(token)) return
    event.preventDefault()
    const start = domNodeStartOffset(editor, token)
    const selection = { anchor: start, focus: start + 1 }
    lastSelectionRef.current = selection
    restoreDomSelection(editor, selection)
    setQuery(null)
  }

  const rootClassName = ['structured-mention-composer', className].filter(Boolean).join(' ')

  return (
    <div className={rootClassName} style={{ position: 'relative', minWidth: 0 }}>
      <div
        key={editorDomRevision}
        ref={editorRef}
        id={id}
        className="structured-mention-editor"
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-activedescendant={menuOpen && optionCount > 0
          ? `${menuId}-${activeOptionIndex}`
          : undefined}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        tabIndex={disabled ? -1 : 0}
        style={EDITOR_STYLE}
        onBeforeInput={handleBeforeInput}
        onInput={(event) => {
          const nativeEvent = event.nativeEvent as InputEvent
          if (!isComposingRef.current && !nativeEvent.isComposing) syncNativeDom(nativeEvent)
        }}
        onSelect={closeQueryIfSelectionMoved}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            closeQueryIfSelectionMoved()
          }
        }}
        onPaste={handlePaste}
        onCut={handleCut}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPointerDown={handlePointerDown}
        onMouseUp={(_event: MouseEvent<HTMLDivElement>) => closeQueryIfSelectionMoved()}
        onBlur={() => setQuery(null)}
      >
        {content.length === 0 && (
          <span data-editor-segment="text" data-editor-empty="true" key="text-0">
            <br data-editor-empty-break="true" />
          </span>
        )}
        {content.map((segment, index) => {
          if (segment.kind === 'text') {
            return (
              <span data-editor-segment="text" key={`text-${index}`}>
                {renderEditorText(segment.text)}
              </span>
            )
          }
          if (segment.kind === 'skill_mention') {
            const currentSkill = skillById.get(segment.skillId)
            const unavailable = !currentSkill || currentSkill.name !== segment.nameAtSend
            return (
              <span
                className={`structured-mention-token skill-mention${unavailable ? ' is-unavailable' : ''}`}
                contentEditable={false}
                data-editor-segment="token"
                data-token-kind="skill_mention"
                data-skill-id={segment.skillId}
                data-skill-name={segment.nameAtSend}
                aria-label={`Skill /${segment.nameAtSend}${unavailable ? '，发送时将不提供文件链接' : ''}`}
                aria-invalid={unavailable || undefined}
                title={unavailable ? '该 Skill 当前不可用；正文仍可发送，但不会提供文件链接。' : undefined}
                key={`skill-${index}-${segment.skillId}`}
                style={unavailable
                  ? { ...TOKEN_STYLE, textDecoration: 'line-through', textDecorationColor: 'var(--attention)' }
                  : TOKEN_STYLE}
              >
                /{segment.nameAtSend}
              </span>
            )
          }
          if (segment.kind === 'all_members_mention') {
            return (
              <span
                className={`structured-mention-token all-members-mention${onActivateAllMembersMention ? ' is-interactive' : ''}`}
                contentEditable={false}
                data-editor-segment="token"
                data-token-kind="all_members_mention"
                role={onActivateAllMembersMention ? 'button' : undefined}
                tabIndex={onActivateAllMembersMention ? 0 : undefined}
                aria-label={onActivateAllMembersMention ? '查看所有队员范围' : '提及所有队员'}
                aria-haspopup={onActivateAllMembersMention ? 'dialog' : undefined}
                aria-expanded={onActivateAllMembersMention ? false : undefined}
                key={`all-${index}`}
                style={onActivateAllMembersMention
                  ? { ...TOKEN_STYLE, cursor: 'pointer' }
                  : TOKEN_STYLE}
                onClick={(event) => {
                  if (!onActivateAllMembersMention) return
                  event.stopPropagation()
                  onActivateAllMembersMention(event.currentTarget, false)
                }}
                onKeyDown={(event) => {
                  if (!onActivateAllMembersMention || (event.key !== 'Enter' && event.key !== ' ')) return
                  event.preventDefault()
                  event.stopPropagation()
                  onActivateAllMembersMention(event.currentTarget, true)
                }}
              >
                @所有队员
              </span>
            )
          }
          const member = memberById.get(segment.agentId)
          const unavailable = !member || member.mentionable === false
          const interactive = Boolean(member && !unavailable && onActivateMemberMention)
          return (
            <span
              className={`structured-mention-token member-mention${unavailable ? ' is-unavailable' : ''}${interactive ? ' is-interactive' : ''}`}
              contentEditable={false}
              data-editor-segment="token"
              data-token-kind="member_mention"
              data-agent-id={segment.agentId}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive && member
                ? `查看${member.displayName}的基础信息`
                : `提及${member?.displayName ?? '不可用队员'}${unavailable ? '，当前不可用' : ''}`}
              aria-haspopup={interactive ? 'dialog' : undefined}
              aria-expanded={interactive ? false : undefined}
              aria-invalid={unavailable || undefined}
              title={unavailable
                ? '该队员当前不可提及，请删除或重新选择。'
                : interactive
                  ? `查看${member?.displayName ?? '队员'}的基础信息`
                  : undefined}
              key={`member-${index}-${segment.agentId}`}
              style={unavailable
                ? { ...TOKEN_STYLE, textDecoration: 'line-through', textDecorationColor: 'var(--attention)' }
                : interactive
                  ? { ...TOKEN_STYLE, cursor: 'pointer' }
                  : TOKEN_STYLE}
              onClick={(event) => {
                if (!interactive || !member || !onActivateMemberMention) return
                event.stopPropagation()
                onActivateMemberMention(member, event.currentTarget, false)
              }}
              onKeyDown={(event) => {
                if (
                  !interactive
                  || !member
                  || !onActivateMemberMention
                  || (event.key !== 'Enter' && event.key !== ' ')
                ) return
                event.preventDefault()
                event.stopPropagation()
                onActivateMemberMention(member, event.currentTarget, true)
              }}
            >
              @{member?.displayName ?? '不可用队员'}
            </span>
          )
        })}
      </div>

      {content.length === 0 && placeholder && (
        <span
          className="structured-mention-placeholder"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '5px',
            left: 0,
            color: 'var(--faint)',
            fontSize: '13px',
            lineHeight: 1.5,
            pointerEvents: 'none'
          }}
        >
          {placeholder}
        </span>
      )}

      {query && (
        <div
          ref={menuRef}
          className={`structured-mention-menu mention-menu${query.kind === 'skill' ? ' skill-picker-menu' : ''}`}
          id={menuId}
          role="listbox"
          aria-label={query.kind === 'skill' ? '选择当前负责人可用的 Skill' : '选择在队的队员'}
        >
          <div className="mention-menu-heading" role="presentation">
            <strong>{query.kind === 'skill' ? 'Skills' : '@ 提及队员'}</strong>
            <span>{query.kind === 'skill'
              ? skillCatalogStatus === 'loading'
                ? '正在读取…'
                : `${skillOptions.length} / ${skills?.length ?? 0} 可用`
              : '可重复选择'}</span>
          </div>
          {query.kind === 'mention'
            ? mentionOptions.map((option, index) => (
                <button
                  id={`${menuId}-${index}`}
                  className={index === activeOptionIndex ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={index === activeOptionIndex}
                  key={option.kind === 'all_members' ? 'all-members' : option.member.agentId}
                  disabled={disabled}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveOption(index)}
                  onClick={() => chooseMentionOption(option)}
                >
                  <StructuredMentionOptionAvatar option={option} />
                  <span>
                    <strong>{option.kind === 'all_members' ? '所有队员' : option.member.displayName}</strong>
                    <small>{option.kind === 'all_members' ? '@所有队员' : `@${option.member.displayName}`}</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
              ))
            : skillOptions.map((option, index) => (
                <button
                  id={`${menuId}-${index}`}
                  className={index === activeOptionIndex ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={index === activeOptionIndex}
                  data-skill-name={option.name}
                  key={option.id}
                  disabled={disabled}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActiveOption(index)}
                  onClick={() => chooseSkillOption(option)}
                >
                  <SkillIdentityMark skillId={option.id} name={option.name} size="compact" />
                  <span className="skill-picker-copy">
                    <strong>/{option.name}</strong>
                    <small>{option.description || (option.origin === 'official' ? 'Rovai 内置 Skill' : '用户导入 Skill')}</small>
                  </span>
                  <span className="skill-picker-enter" aria-hidden="true">
                    {index === activeOptionIndex ? '↵' : ''}
                  </span>
                </button>
              ))}
          {optionCount === 0 && (
            <p className="structured-mention-empty" role="status">
              {query.kind === 'mention'
                ? '没有匹配的在队队员'
                : skillCatalogStatus === 'loading'
                  ? '正在读取当前负责人可用的 Skill…'
                  : skillCatalogStatus === 'error'
                    ? '暂时无法读取 Skill；输入内容仍可正常发送。'
                    : (skills?.length ?? 0) === 0
                      ? '当前负责人没有已配置的可用 Skill'
                      : '没有匹配的 Skill'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function queryAfterDeletion(
  query: StructuredMentionQuery | null,
  selection: StructuredMentionSelection,
  direction: 'backward' | 'forward'
): StructuredMentionQuery | null {
  if (
    !query
    || direction !== 'backward'
    || selection.anchor !== selection.focus
    || selection.anchor !== query.end
  ) return null
  if (query.end <= query.start + 1) return null
  return {
    ...query,
    end: query.end - 1,
    query: query.query.slice(0, -1)
  }
}

function structuredContentEqual(
  left: StructuredMentionContent,
  right: StructuredMentionContent
): boolean {
  if (left.length !== right.length) return false
  return left.every((segment, index) => {
    const candidate = right[index]
    if (!candidate || segment.kind !== candidate.kind) return false
    if (segment.kind === 'text' && candidate.kind === 'text') return segment.text === candidate.text
    if (segment.kind === 'member_mention' && candidate.kind === 'member_mention') {
      return segment.agentId === candidate.agentId
    }
    if (segment.kind === 'skill_mention' && candidate.kind === 'skill_mention') {
      return segment.skillId === candidate.skillId
        && segment.nameAtSend === candidate.nameAtSend
    }
    return segment.kind === 'all_members_mention'
  })
}

function authorableStructuredContent(
  content: StructuredCampMessageContent
): StructuredMentionContent {
  return normalizeStructuredMentionContent(content.map((segment) => {
    if (segment.kind === 'current_user_mention') {
      return { kind: 'text' as const, text: '@你' }
    }
    if (segment.kind === 'external_quote') {
      const attachments = segment.attachmentSummaries
        .map((attachment) => `\n[附件] ${attachment.name}${attachment.mediaType ? ` (${attachment.mediaType})` : ''}`)
        .join('')
      return {
        kind: 'text' as const,
        text: `[外部引用]\n${segment.senderDisplayName}：\n${segment.body}${attachments}`
      }
    }
    return segment
  }))
}

function readStructuredContent(editor: HTMLDivElement): StructuredMentionContent {
  if (isNativeEmptyEditorFiller(editor)) return []
  const content: StructuredMentionContent = []
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      const tokenKind = element.dataset.tokenKind
      if (tokenKind === 'member_mention') {
        const agentId = element.dataset.agentId
        if (agentId) content.push({ kind: 'member_mention', agentId })
        continue
      }
      if (tokenKind === 'all_members_mention') {
        content.push({ kind: 'all_members_mention' })
        continue
      }
      if (tokenKind === 'skill_mention') {
        const skillId = element.dataset.skillId
        const nameAtSend = element.dataset.skillName
        if (skillId && nameAtSend) {
          content.push({ kind: 'skill_mention', skillId, nameAtSend })
        }
        continue
      }
      if (element.dataset.editorSegment === 'text') {
        const text = readEditorTextNode(element)
        if (text) content.push({ kind: 'text', text })
        continue
      }
    }
    const text = readEditorTextNode(node)
    if (text) content.push({ kind: 'text', text })
  }
  return normalizeStructuredMentionContent(content)
}

function isNativeEmptyEditorFiller(editor: HTMLDivElement): boolean {
  // Chromium represents an emptied contenteditable with one untagged BR.
  // Tagged line breaks remain semantic and must never be collapsed here.
  let bareBreakCount = 0
  let semanticContentFound = false
  const visit = (node: Node): void => {
    if (semanticContentFound) return
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? '').length > 0) {
        semanticContentFound = true
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    if (element.dataset.tokenKind || element.dataset.editorLineBreak === 'true') {
      semanticContentFound = true
      return
    }
    if (isEditorCaretHost(element)) return
    if (element.tagName === 'BR') {
      if (!isEditorCaretBreak(element)) bareBreakCount += 1
      return
    }
    for (const child of element.childNodes) visit(child)
  }
  for (const child of editor.childNodes) visit(child)
  return !semanticContentFound && bareBreakCount <= 1
}

function renderEditorText(text: string): ReactNode[] {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line) nodes.push(line)
    if (index < lines.length - 1) {
      nodes.push(<br data-editor-line-break="true" key={`line-break-${index}`} />)
    }
  }
  if (text.endsWith('\n')) {
    nodes.push(
      <span data-editor-caret-host="true" key="caret-host">
        {EDITOR_CARET_SENTINEL}
      </span>
    )
  }
  return nodes
}

function readEditorTextNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    if (isEditorCaretHost(element)) return readEditorCaretHostText(element)
    if (element.tagName === 'BR') {
      return isEditorCaretBreak(element) ? '' : '\n'
    }
  }
  return [...node.childNodes].map(readEditorTextNode).join('')
}

function captureEditorDom(node: Node): EditorDomSnapshot {
  return { node, children: [...node.childNodes].map(captureEditorDom) }
}

function editorDomMatchesSnapshot(
  node: Node,
  snapshot: EditorDomSnapshot | undefined,
  checkDescendants = true
): boolean {
  if (!snapshot || snapshot.node !== node) return false
  const children = [...node.childNodes]
  return children.length === snapshot.children.length
    && children.every((child, index) => checkDescendants
      ? editorDomMatchesSnapshot(child, snapshot.children[index])
      : child === snapshot.children[index].node)
}

function editorDomRequiresOwnershipReset(
  editor: HTMLDivElement,
  content: StructuredMentionContent,
  snapshot: EditorDomSnapshot | undefined
): boolean {
  return !editorDomMatchesReactProjection(editor, content)
    // The empty placeholder span is removed as a unit by React on first input.
    // Its descendants may change without resetting the IME host, but the span
    // itself must still be the node React owns.
    || !editorDomMatchesSnapshot(editor, snapshot, content.length > 0)
}

function editorDomMatchesReactProjection(
  editor: HTMLDivElement,
  content: StructuredMentionContent
): boolean {
  const children = [...editor.childNodes]
  if (content.length === 0) {
    return children.length === 1 && isEditorTextSegment(children[0], true)
  }
  if (children.length !== content.length) return false
  return children.every((node, index) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const element = node as HTMLElement
    const segment = content[index]
    if (!segment) return false
    if (segment.kind === 'text') {
      return isEditorTextSegment(element)
    }
    if (element.dataset.editorSegment !== 'token') return false
    if (segment.kind === 'all_members_mention') {
      return element.dataset.tokenKind === 'all_members_mention'
    }
    if (segment.kind === 'skill_mention') {
      return element.dataset.tokenKind === 'skill_mention'
        && element.dataset.skillId === segment.skillId
        && element.dataset.skillName === segment.nameAtSend
    }
    return element.dataset.tokenKind === 'member_mention'
      && element.dataset.agentId === segment.agentId
  })
}

function isEditorTextSegment(node: Node | undefined, allowEmptyBreak = false): boolean {
  return node?.nodeType === Node.ELEMENT_NODE
    && (node as HTMLElement).dataset.editorSegment === 'text'
    && [...node.childNodes].every((child) => child.nodeType === Node.TEXT_NODE
      || (child.nodeType === Node.ELEMENT_NODE
        && (isEditorCaretHost(child as HTMLElement)
          || ((child as HTMLElement).tagName === 'BR'
            && ((allowEmptyBreak && (child as HTMLElement).dataset.editorEmptyBreak === 'true')
              || (child as HTMLElement).dataset.editorLineBreak === 'true'
              || (child as HTMLElement).dataset.editorCaretBreak === 'true')))))
}

function readDomSelection(editor: HTMLDivElement): StructuredMentionSelection {
  const selection = window.getSelection()
  if (
    !selection
    || !selection.anchorNode
    || !selection.focusNode
    || !editorContainsPoint(editor, selection.anchorNode)
    || !editorContainsPoint(editor, selection.focusNode)
  ) {
    const end = editorNodeLength(editor)
    return { anchor: end, focus: end }
  }
  return {
    anchor: domPointOffset(editor, selection.anchorNode, selection.anchorOffset),
    focus: domPointOffset(editor, selection.focusNode, selection.focusOffset)
  }
}

function restoreDomSelection(
  editor: HTMLDivElement,
  selectionValue: StructuredMentionSelection
): void {
  const selection = window.getSelection()
  if (!selection) return
  const length = editorNodeLength(editor)
  const anchor = domPointAtOffset(editor, clamp(selectionValue.anchor, 0, length))
  const focus = domPointAtOffset(editor, clamp(selectionValue.focus, 0, length))
  if (typeof selection.setBaseAndExtent === 'function') {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
  } else {
    const range = document.createRange()
    const start = Math.min(selectionValue.anchor, selectionValue.focus)
    const end = Math.max(selectionValue.anchor, selectionValue.focus)
    const startPoint = domPointAtOffset(editor, clamp(start, 0, length))
    const endPoint = domPointAtOffset(editor, clamp(end, 0, length))
    range.setStart(startPoint.node, startPoint.offset)
    range.setEnd(endPoint.node, endPoint.offset)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  // Controlled edits restore the caret after React commits. Chromium does not
  // reliably move this scroll container with a programmatically restored caret.
  if (
    selectionValue.anchor === selectionValue.focus
    && clamp(selectionValue.focus, 0, length) === length
  ) {
    editor.scrollTop = editor.scrollHeight
  }
}

function editorContainsPoint(editor: HTMLDivElement, node: Node): boolean {
  return node === editor || editor.contains(node)
}

function domPointOffset(editor: HTMLDivElement, node: Node, offset: number): number {
  if (node === editor) {
    return [...editor.childNodes]
      .slice(0, clamp(offset, 0, editor.childNodes.length))
      .reduce((length, child) => length + editorNodeLength(child), 0)
  }
  if (!editor.contains(node)) return editorNodeLength(editor)
  // Native editing may insert an untagged Text node or wrapper next to a token.
  // Measure within its top-level child so surrounding tokens still count as one.
  let segment = node
  while (segment.parentNode && segment.parentNode !== editor) segment = segment.parentNode
  const start = domNodeStartOffset(editor, segment)
  if (segment.nodeType === Node.ELEMENT_NODE
    && (segment as HTMLElement).dataset.editorSegment === 'token') {
    return start + (offset > 0 ? 1 : 0)
  }
  try {
    const range = document.createRange()
    range.selectNodeContents(segment)
    range.setEnd(node, offset)
    return start + editorNodeLength(range.cloneContents())
  } catch {
    return start
  }
}

function domNodeStartOffset(editor: HTMLDivElement, target: Node): number {
  let offset = 0
  for (const node of editor.childNodes) {
    if (node === target) return offset
    offset += editorNodeLength(node)
  }
  return offset
}

function editorNodeLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    if (element.dataset.editorSegment === 'token') return 1
    if (isEditorCaretHost(element)) return readEditorCaretHostText(element).length
    if (element.tagName === 'BR') return isEditorCaretBreak(element) ? 0 : 1
  }
  return [...node.childNodes]
    .reduce((length, child) => length + editorNodeLength(child), 0)
}

function isEditorCaretBreak(element: HTMLElement): boolean {
  return element.dataset.editorEmptyBreak === 'true'
    || element.dataset.editorCaretBreak === 'true'
}

function isEditorCaretHost(element: HTMLElement): boolean {
  return element.dataset.editorCaretHost === 'true'
}

function readEditorCaretHostText(element: HTMLElement): string {
  return (element.textContent ?? '').replaceAll(EDITOR_CARET_SENTINEL, '')
}

function domPointAtOffset(editor: HTMLDivElement, targetOffset: number): { node: Node; offset: number } {
  let cursor = 0
  const children = [...editor.childNodes]
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const length = editorNodeLength(child)
    const end = cursor + length
    const isToken = child.nodeType === Node.ELEMENT_NODE
      && (child as HTMLElement).dataset.editorSegment === 'token'
    if (isToken) {
      if (targetOffset <= cursor) return { node: editor, offset: index }
      if (targetOffset <= end) return { node: editor, offset: index + 1 }
    } else if (targetOffset <= end) {
      return textPointAtOffset(child, Math.max(0, targetOffset - cursor))
    }
    cursor = end
  }
  return { node: editor, offset: children.length }
}

function textPointAtOffset(root: Node, targetOffset: number): { node: Node; offset: number } {
  if (root.nodeType === Node.TEXT_NODE) {
    return { node: root, offset: clamp(targetOffset, 0, root.textContent?.length ?? 0) }
  }
  const children = [...root.childNodes]
  let cursor = 0
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const length = editorNodeLength(child)
    if (child.nodeType === Node.ELEMENT_NODE && (child as HTMLElement).tagName === 'BR') {
      if (targetOffset <= cursor) return { node: root, offset: index }
      cursor += length
      if (targetOffset <= cursor) return { node: root, offset: index + 1 }
      continue
    }
    const end = cursor + length
    if (targetOffset <= end) return textPointAtOffset(child, targetOffset - cursor)
    cursor = end
  }
  return { node: root, offset: children.length }
}

function closestToken(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-editor-segment="token"]')
    : null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
