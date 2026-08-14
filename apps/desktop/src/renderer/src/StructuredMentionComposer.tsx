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
  type RefObject
} from 'react'
import {
  deleteStructuredBackward,
  deleteStructuredForward,
  insertAllMembersMentionWithTrailingSpace,
  insertMemberMentionWithTrailingSpace,
  insertStructuredText,
  normalizeStructuredMentionContent,
  pasteStructuredPlainText,
  replaceStructuredSelection,
  structuredMentionContentLength,
  type StructuredMentionContent,
  type StructuredMentionEditorState,
  type StructuredMentionSelection
} from './structured-mention-model'
import { MemberAvatar } from './MemberAvatar'
import type { ComposerSkillOption } from './composer-skill-picker'
import { readStructuredMessageClipboardContent } from './structured-message-clipboard'

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

export type StructuredSkillQuery = StructuredMentionQuery

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

export function skillQueryAfterTypedText(
  current: StructuredSkillQuery | null,
  selection: StructuredMentionSelection,
  text: string,
  contentLength: number
): StructuredSkillQuery | null {
  const insertionStart = Math.min(selection.anchor, selection.focus)
  const insertionEnd = Math.max(selection.anchor, selection.focus)
  if (!current) {
    const query = text.startsWith('/') ? text.slice(1) : null
    if (
      query === null
      || insertionStart !== 0
      || insertionEnd !== contentLength
      || /[\s/@]/u.test(query)
    ) return null
    return { start: 0, end: text.length, query }
  }
  if (
    selection.anchor !== selection.focus
    || selection.anchor !== current.end
    || /[\s/@]/u.test(text)
  ) return null
  return {
    ...current,
    end: current.end + text.length,
    query: `${current.query}${text}`
  }
}

export function skillQueryAfterNativeTextInput(
  current: StructuredSkillQuery | null,
  selectionAfterInput: StructuredMentionSelection,
  text: string,
  contentLengthAfterInput: number
): StructuredSkillQuery | null {
  if (selectionAfterInput.anchor !== selectionAfterInput.focus) return null
  const insertionEnd = selectionAfterInput.anchor
  if (
    !text.startsWith('/')
    && current
    && current.end === insertionEnd
    && current.query.endsWith(text)
  ) return current
  const insertionStart = Math.max(0, insertionEnd - text.length)
  return skillQueryAfterTypedText(
    current,
    { anchor: insertionStart, focus: insertionStart },
    text,
    Math.max(0, contentLengthAfterInput - text.length)
  )
}

export function insertSkillCommandWithTrailingSpace(
  state: StructuredMentionEditorState,
  skillName: string
): StructuredMentionEditorState {
  if (!skillName || /[\s/]/u.test(skillName)) {
    throw new Error('Skill name must be a non-empty slash-command segment')
  }
  return insertStructuredText(state, `/${skillName} `)
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
  outline: 0,
  cursor: 'text'
}

type StructuredComposerQuery =
  | { kind: 'mention'; value: StructuredMentionQuery }
  | { kind: 'skill'; value: StructuredSkillQuery }

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
  onPasteFiles,
  onActivateMemberMention,
  onActivateAllMembersMention
}: StructuredMentionComposerProps): JSX.Element {
  const fallbackEditorRef = useRef<HTMLDivElement>(null)
  const editorRef = providedEditorRef ?? fallbackEditorRef
  const pendingSelectionRef = useRef<StructuredMentionSelection | null>(null)
  const restoreFocusAfterDomResetRef = useRef(false)
  const lastSelectionRef = useRef<StructuredMentionSelection>({ anchor: 0, focus: 0 })
  const isComposingRef = useRef(false)
  const compositionFrameRef = useRef<number | null>(null)
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

  useEffect(() => {
    setActiveOption(0)
  }, [query?.kind, query?.value.query, query?.value.start])

  useEffect(() => () => {
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    const editor = editorRef.current
    const pending = pendingSelectionRef.current
    if (!editor || !pending) return
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

  const editorState = (selection = currentSelection()): StructuredMentionEditorState => ({
    content,
    selection
  })

  const closeQueryIfSelectionMoved = (): void => {
    if (!query) return
    const selection = currentSelection()
    const activeQuery = query.value
    if (
      selection.anchor !== selection.focus
      || selection.anchor < activeQuery.start + 1
      || selection.anchor > activeQuery.end
    ) setQuery(null)
  }

  const syncNativeDom = (nativeEvent?: InputEvent): void => {
    const editor = editorRef.current
    if (!editor) return
    const nextContent = readStructuredContent(editor)
    const nextSelection = readDomSelection(editor)
    const requiresOwnershipReset = !editorDomMatchesReactProjection(editor, content)
    lastSelectionRef.current = nextSelection
    if (requiresOwnershipReset) {
      // IME and native contenteditable editing may wrap, replace, or insert
      // nodes below the editor. Never remove those nodes imperatively: doing so
      // can detach a React-owned descendant and make a later commit throw from
      // removeChild. Remount the editor host instead, so React discards the
      // mutated subtree as one unit and establishes ownership again.
      pendingSelectionRef.current = nextSelection
      restoreFocusAfterDomResetRef.current = restoreFocusAfterDomResetRef.current
        || document.activeElement === editor
      setEditorDomRevision((current) => current + 1)
    }
    if (!structuredContentEqual(content, nextContent)) {
      pendingSelectionRef.current = nextSelection
      onChange(nextContent)
    }
    if (nativeEvent?.inputType === 'insertText' && nativeEvent.data !== null) {
      const contentLength = structuredMentionContentLength(nextContent)
      const selectionAfterInput = {
        anchor: clamp(nextSelection.anchor, 0, contentLength),
        focus: clamp(nextSelection.focus, 0, contentLength)
      }
      setQuery((current) => {
        const nextMentionQuery = mentionQueryAfterNativeTextInput(
          current?.kind === 'mention' ? current.value : null,
          selectionAfterInput,
          nativeEvent.data ?? ''
        )
        if (nextMentionQuery) return { kind: 'mention', value: nextMentionQuery }
        const nextSkillQuery = skillQueryAfterNativeTextInput(
          current?.kind === 'skill' ? current.value : null,
          selectionAfterInput,
          nativeEvent.data ?? '',
          contentLength
        )
        return nextSkillQuery ? { kind: 'skill', value: nextSkillQuery } : null
      })
    } else if (nativeEvent) {
      setQuery(null)
    }
  }

  const chooseMentionOption = (option: StructuredMentionOption | undefined): void => {
    if (!option || query?.kind !== 'mention' || disabled) return
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
    if (!option || query?.kind !== 'skill' || disabled) return
    const state: StructuredMentionEditorState = {
      content,
      selection: { anchor: query.value.start, focus: query.value.end }
    }
    const next = insertSkillCommandWithTrailingSpace(state, option.name)
    setQuery(null)
    emitState(next)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }

  const deleteFromKeyboard = (direction: 'backward' | 'forward'): void => {
    const selection = currentSelection()
    const next = direction === 'backward'
      ? deleteStructuredBackward(editorState(selection))
      : deleteStructuredForward(editorState(selection))
    setQuery((current) => {
      if (!current) return null
      const nextQuery = queryAfterDeletion(current.value, selection, direction)
      return nextQuery ? { ...current, value: nextQuery } : null
    })
    emitState(next)
  }

  const handleBeforeInput = (event: FormEvent<HTMLDivElement>): void => {
    if (disabled || isComposingRef.current) return
    const nativeEvent = event.nativeEvent as InputEvent
    if (nativeEvent.isComposing) return
    const selection = currentSelection()

    if (nativeEvent.inputType === 'insertText' && nativeEvent.data !== null) {
      event.preventDefault()
      const next = insertStructuredText(editorState(selection), nativeEvent.data)
      const contentLength = structuredMentionContentLength(content)
      setQuery((current) => {
        const nextMentionQuery = mentionQueryAfterTypedText(
          current?.kind === 'mention' ? current.value : null,
          selection,
          nativeEvent.data ?? ''
        )
        if (nextMentionQuery) return { kind: 'mention', value: nextMentionQuery }
        const nextSkillQuery = skillQueryAfterTypedText(
          current?.kind === 'skill' ? current.value : null,
          selection,
          nativeEvent.data ?? '',
          contentLength
        )
        return nextSkillQuery ? { kind: 'skill', value: nextSkillQuery } : null
      })
      emitState(next)
      return
    }
    if (nativeEvent.inputType === 'insertParagraph' || nativeEvent.inputType === 'insertLineBreak') {
      event.preventDefault()
      setQuery(null)
      emitState(insertStructuredText(editorState(selection), '\n'))
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
      setQuery(null)
      emitState(replaceStructuredSelection(editorState(selection), []))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const isComposing = isComposingRef.current
      || event.nativeEvent.isComposing
      || event.nativeEvent.keyCode === 229
    if (isComposing) return

    if (menuOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      if (optionCount > 0) {
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setActiveOption((current) => (current + direction + optionCount) % optionCount)
      }
      return
    }
    if (menuOpen && event.key === 'Escape') {
      event.preventDefault()
      setQuery(null)
      return
    }
    if (menuOpen && (event.key === 'Enter' || event.key === 'Tab')) {
      if (optionCount > 0) {
        event.preventDefault()
        const optionIndex = Math.min(activeOption, optionCount - 1)
        if (query?.kind === 'skill') chooseSkillOption(skillOptions[optionIndex])
        else chooseMentionOption(mentionOptions[optionIndex])
        return
      }
      setQuery(null)
      if (event.key === 'Tab') return
    }
    if (event.key === 'Backspace') {
      event.preventDefault()
      deleteFromKeyboard('backward')
      return
    }
    if (event.key === 'Delete') {
      event.preventDefault()
      deleteFromKeyboard('forward')
      return
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault()
      setQuery(null)
      emitState(insertStructuredText(editorState(), '\n'))
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
    setQuery(null)
    const plainText = event.clipboardData.getData('text/plain')
    const structuredContent = readStructuredMessageClipboardContent(
      event.clipboardData.getData('text/html'),
      plainText,
      members
    )
    emitState(structuredContent
      ? replaceStructuredSelection(editorState(), authorableStructuredContent(structuredContent))
      : pasteStructuredPlainText(editorState(), plainText))
  }

  const handleCompositionStart = (_event: CompositionEvent<HTMLDivElement>): void => {
    isComposingRef.current = true
    setQuery(null)
  }

  const handleCompositionEnd = (_event: CompositionEvent<HTMLDivElement>): void => {
    isComposingRef.current = false
    if (compositionFrameRef.current !== null) {
      window.cancelAnimationFrame(compositionFrameRef.current)
    }
    compositionFrameRef.current = window.requestAnimationFrame(() => {
      compositionFrameRef.current = null
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
          ? `${menuId}-${Math.min(activeOption, optionCount - 1)}`
          : undefined}
        aria-disabled={disabled || undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck
        tabIndex={disabled ? -1 : 0}
        style={EDITOR_STYLE}
        onBeforeInput={handleBeforeInput}
        onInput={(event) => {
          if (!isComposingRef.current) syncNativeDom(event.nativeEvent as InputEvent)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            closeQueryIfSelectionMoved()
          }
        }}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onPointerDown={handlePointerDown}
        onMouseUp={(_event: MouseEvent<HTMLDivElement>) => closeQueryIfSelectionMoved()}
        onBlur={() => setQuery(null)}
      >
        {content.map((segment, index) => {
          if (segment.kind === 'text') {
            return (
              <span data-editor-segment="text" key={`text-${index}`}>
                {segment.text}
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
                  className={index === activeOption ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  key={option.kind === 'all_members' ? 'all-members' : option.member.agentId}
                  disabled={disabled}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOption(index)}
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
                  className={index === activeOption ? 'active' : ''}
                  type="button"
                  role="option"
                  aria-selected={index === activeOption}
                  data-skill-name={option.name}
                  key={option.id}
                  disabled={disabled}
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveOption(index)}
                  onClick={() => chooseSkillOption(option)}
                >
                  <span className="skill-picker-glyph" aria-hidden="true">/</span>
                  <span className="skill-picker-copy">
                    <strong>/{option.name}</strong>
                    <small>{option.description || (option.origin === 'official' ? 'Rovai 内置 Skill' : '用户导入 Skill')}</small>
                  </span>
                  <span className="skill-picker-enter" aria-hidden="true">
                    {index === activeOption ? '↵' : ''}
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
    return segment
  }))
}

function readStructuredContent(editor: HTMLDivElement): StructuredMentionContent {
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
      if (element.tagName === 'BR') {
        content.push({ kind: 'text', text: '\n' })
        continue
      }
    }
    const text = node.textContent ?? ''
    if (text) content.push({ kind: 'text', text })
  }
  return normalizeStructuredMentionContent(content)
}

function editorDomMatchesReactProjection(
  editor: HTMLDivElement,
  content: StructuredMentionContent
): boolean {
  const children = [...editor.childNodes]
  if (children.length !== content.length) return false
  return children.every((node, index) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    const element = node as HTMLElement
    const segment = content[index]
    if (!segment) return false
    if (segment.kind === 'text') {
      return element.dataset.editorSegment === 'text'
        && [...element.childNodes].every((child) => child.nodeType === Node.TEXT_NODE)
    }
    if (element.dataset.editorSegment !== 'token') return false
    if (segment.kind === 'all_members_mention') {
      return element.dataset.tokenKind === 'all_members_mention'
    }
    return element.dataset.tokenKind === 'member_mention'
      && element.dataset.agentId === segment.agentId
  })
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
    return
  }
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

function editorContainsPoint(editor: HTMLDivElement, node: Node): boolean {
  return node === editor || editor.contains(node)
}

function domPointOffset(editor: HTMLDivElement, node: Node, offset: number): number {
  if (node === editor) {
    return [...editor.childNodes]
      .slice(0, clamp(offset, 0, editor.childNodes.length))
      .reduce((length, child) => length + editorNodeLength(child), 0)
  }
  const segment = closestEditorSegment(node)
  if (!segment || !editor.contains(segment)) return editorNodeLength(editor)
  const start = domNodeStartOffset(editor, segment)
  if (segment.dataset.editorSegment === 'token') {
    return start + (offset > 0 ? 1 : 0)
  }
  try {
    const range = document.createRange()
    range.selectNodeContents(segment)
    range.setEnd(node, offset)
    return start + range.toString().length
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
  if (node.nodeType === Node.ELEMENT_NODE) {
    const element = node as HTMLElement
    if (element.dataset.editorSegment === 'token') return 1
    if (element.tagName === 'BR') return 1
  }
  return node.textContent?.length ?? 0
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
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = targetOffset
  let textNode = walker.nextNode()
  while (textNode) {
    const length = textNode.textContent?.length ?? 0
    if (remaining <= length) return { node: textNode, offset: remaining }
    remaining -= length
    textNode = walker.nextNode()
  }
  return { node: root, offset: 0 }
}

function closestEditorSegment(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement
  return element?.closest<HTMLElement>('[data-editor-segment]') ?? null
}

function closestToken(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>('[data-editor-segment="token"]')
    : null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
