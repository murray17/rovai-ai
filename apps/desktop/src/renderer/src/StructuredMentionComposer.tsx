import type { CampComposerDraftView, ComposerAtom, ComposerDocument } from '@contracts'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $nodesOfType,
  CLEAR_HISTORY_COMMAND,
  HISTORY_PUSH_TAG
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
import {
  ComposerAtomNode,
  setComposerAtomPresentationResolver,
  type ComposerAtomPresentation
} from './ComposerAtomNode'
import { ComposerTypeaheadPlugin } from './ComposerTypeaheadPlugin'
import { MemberAvatar } from './MemberAvatar'
import {
  RovaiComposerExtension,
  setComposerExtensionRuntime,
  type ComposerExtensionRuntime
} from './RovaiComposerExtension'
import { SkillIdentityMark } from './SkillIdentityMark'
import type { ComposerSkillOption } from './composer-skill-picker'
import { $replaceEditorWithComposerDocument } from './composer-editor-state'
import {
  $replaceComposerTriggerWithAtom,
  type ComposerTriggerMatch
} from './composer-trigger'
import {
  ComposerDraftSync,
  ROVAI_ATOM_PRESENTATION_TAG,
  ROVAI_COMPOSER_INITIALIZE_TAG,
  ROVAI_COMPOSER_REPLACE_TAG,
  type ComposerFlushResult,
  type ComposerPersistContext
} from './composer-draft-sync'
import {
  composerDocumentToPlainText,
  emptyComposerDocument,
  parseComposerClipboardDocument,
  recoverComposerClipboardDocument,
  type ComposerLocalStatus
} from './composer-document'

export interface StructuredMentionMember {
  agentId: string
  displayName: string
  teamRole: string
  avatarRef?: string | null
  mentionable?: boolean
}

export type StructuredMentionOption =
  | { kind: 'all_members'; label: '所有队员' }
  | { kind: 'member'; member: StructuredMentionMember }

export interface StructuredMentionComposerHandle {
  flush(): Promise<ComposerFlushResult<CampComposerDraftView>>
  setInteractionLocked(locked: boolean): void
  replaceDocument(
    document: ComposerDocument,
    boundary?: 'start' | 'end'
  ): void
  setDocument(document: ComposerDocument, boundary?: 'start' | 'end'): void
  focus(boundary?: 'start' | 'end'): void
  getLocalVersion(): number
  isDirty(): boolean
}

export interface StructuredMentionComposerProps {
  id: string
  draftIdentity: string
  document: ComposerDocument
  ready?: boolean
  getAuthoritativeDraft?(): CampComposerDraftView | null
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
  ): Promise<void>
  waitForDraftAuthority?(): Promise<void>
  onLocalStatusChange?(status: ComposerLocalStatus): void
  onDirtyChange?(dirty: boolean): void
  onPersistenceErrorChange?(error: Error | null): void
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

export function structuredMentionMemberDescription(member: StructuredMentionMember): string {
  return member.teamRole.trim() || '团队角色未设置'
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
}): boolean {
  return input.key === 'Enter'
    && !input.shiftKey
    && !input.isComposing
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
  getAuthoritativeDraft,
  members,
  skills = [],
  skillCatalogStatus = 'ready',
  ariaLabel,
  placeholder = '',
  disabled = false,
  className = '',
  editorRef,
  persistDocument,
  waitForDraftAuthority,
  onLocalStatusChange,
  onDirtyChange,
  onPersistenceErrorChange,
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
  const previousReadyRef = useRef(ready)
  const disabledRef = useRef(disabled)
  const interactionLockCountRef = useRef(0)
  readyRef.current = ready
  disabledRef.current = disabled
  const callbacks = useRef({
    getAuthoritativeDraft,
    members,
    skills: skills ?? [],
    skillCatalogStatus,
    persistDocument,
    waitForDraftAuthority,
    onLocalStatusChange,
    onDirtyChange,
    onPersistenceErrorChange,
    onSubmit,
    onBackspaceAtStart,
    onPasteFiles,
    onActivateMemberMention,
    onActivateAllMembersMention,
    onActivateSkillMention
  })
  callbacks.current = {
    getAuthoritativeDraft,
    members,
    skills: skills ?? [],
    skillCatalogStatus,
    persistDocument,
    waitForDraftAuthority,
    onLocalStatusChange,
    onDirtyChange,
    onPersistenceErrorChange,
    onSubmit,
    onBackspaceAtStart,
    onPasteFiles,
    onActivateMemberMention,
    onActivateAllMembersMention,
    onActivateSkillMention
  }

  const [triggerMatch, setTriggerMatch] = useState<ComposerTriggerMatch | null>(null)
  const closeTypeaheads = useCallback(() => {
    setTriggerMatch(null)
  }, [])
  const mentionQuery = triggerMatch?.kind === 'member' ? triggerMatch.query : null
  const skillQuery = triggerMatch?.kind === 'skill' ? triggerMatch.query : null
  const mentionOpen = triggerMatch?.kind === 'member'
  const skillOpen = triggerMatch?.kind === 'skill'
  const mentionOptions = useMemo(
    () => mentionQuery === null ? [] : structuredMentionOptions(members, mentionQuery),
    [members, mentionQuery]
  )
  const skillOptions = useMemo(
    () => skillQuery === null ? [] : structuredSkillOptions(skills ?? [], skillQuery),
    [skillQuery, skills]
  )
  const bindings = useCallback(() => ({
    persist: callbacks.current.persistDocument,
    waitForAuthority: callbacks.current.waitForDraftAuthority,
    currentDraft: () => callbacks.current.getAuthoritativeDraft?.() ?? null,
    atomIsAvailable: (node: ComposerAtomNode) =>
      atomPresentation(node, callbacks.current).availability === 'available',
    onStatusChange: (status: ComposerLocalStatus) =>
      callbacks.current.onLocalStatusChange?.(status),
    onDirtyChange: (dirty: boolean) => callbacks.current.onDirtyChange?.(dirty),
    onPersistenceErrorChange: (error: Error | null) =>
      callbacks.current.onPersistenceErrorChange?.(error)
  }), [])

  const replaceAuthoritativeDocument = useCallback((
    nextDocument: ComposerDocument,
    boundary: 'start' | 'end' = 'end'
  ): void => {
    closeTypeaheads()
    editor.update(() => {
      $replaceEditorWithComposerDocument(nextDocument)
      if (boundary === 'start') $getRoot().selectStart()
      else $getRoot().selectEnd()
    }, {
      discrete: true,
      tag: ROVAI_COMPOSER_REPLACE_TAG,
      onUpdate: () => {
        syncRef.current?.acceptAuthoritativeState(editor.getEditorState())
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
      $replaceEditorWithComposerDocument(initialDocument)
    }, { discrete: true, tag: ROVAI_COMPOSER_INITIALIZE_TAG })
    const sync = new ComposerDraftSync(editor, editor.getEditorState(), bindings())
    const runtime: ComposerExtensionRuntime<CampComposerDraftView> = {
      sync,
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
    if (!initializedRef.current || previousReadyRef.current || !ready) {
      previousReadyRef.current = ready
      return
    }
    previousReadyRef.current = true
    replaceAuthoritativeDocument(document)
  }, [document, ready, replaceAuthoritativeDocument])

  useEffect(() => {
    editor.setEditable(ready && !disabled && interactionLockCountRef.current === 0)
  }, [disabled, editor, ready])

  useImperativeHandle(forwardedRef, () => ({
    flush: async () => {
      const sync = syncRef.current
      if (!sync) {
        return {
          document,
          localVersion: 0,
          savedVersion: 0,
          draft: getAuthoritativeDraft?.() ?? null
        }
      }
      return sync.flush()
    },
    setInteractionLocked(locked) {
      interactionLockCountRef.current = locked
        ? interactionLockCountRef.current + 1
        : Math.max(0, interactionLockCountRef.current - 1)
      if (locked) closeTypeaheads()
      editor.setEditable(
        readyRef.current
          && !disabledRef.current
          && interactionLockCountRef.current === 0
      )
    },
    replaceDocument: replaceAuthoritativeDocument,
    setDocument(nextDocument, boundary = 'end') {
      closeTypeaheads()
      editor.update(() => {
        $replaceEditorWithComposerDocument(nextDocument)
        if (boundary === 'start') $getRoot().selectStart()
        else $getRoot().selectEnd()
      }, { discrete: true, tag: HISTORY_PUSH_TAG })
      editor.focus(undefined, { defaultSelection: boundary === 'start' ? 'rootStart' : 'rootEnd' })
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
  }), [closeTypeaheads, document, editor, getAuthoritativeDraft, replaceAuthoritativeDocument])

  const setEditorElement = useCallback((element: HTMLDivElement | null) => {
    if (editorRef) editorRef.current = element
  }, [editorRef])

  const mentionMenuOptions = useMemo(() => mentionOptions.slice(0, 50), [mentionOptions])
  const skillMenuOptions = useMemo(() => skillOptions.slice(0, 50), [skillOptions])
  const mentionMenuId = `${id || generatedId}-mention-options`
  const skillMenuId = `${id || generatedId}-skill-options`
  const menuOpen = mentionOpen || skillOpen

  return <div className={`structured-mention-composer ${className}`.trim()}>
    <ContentEditable id={id} ref={setEditorElement}
      className="structured-mention-editor" aria-label={ariaLabel}
      aria-expanded={menuOpen} aria-controls={skillOpen ? skillMenuId : mentionMenuId}
      aria-disabled={disabled || !ready} spellCheck={false}
      placeholder={<span className="structured-mention-placeholder">{placeholder}</span>}
      aria-placeholder={placeholder} />
    <ComposerTypeaheadPlugin match={triggerMatch}
      optionCount={mentionOpen ? mentionMenuOptions.length : skillMenuOptions.length}
      getOptionState={(match) => match.kind === 'member'
        ? {
            catalogStatus: 'ready',
            optionCount: structuredMentionOptions(callbacks.current.members, match.query)
              .slice(0, 50).length
          }
        : {
            catalogStatus: callbacks.current.skillCatalogStatus,
            optionCount: structuredSkillOptions(callbacks.current.skills, match.query)
              .slice(0, 50).length
          }}
      onMatchChange={setTriggerMatch}
      onSelect={(index, match) => {
        if (editor.isComposing()) return false
        if (match.kind === 'member') {
          const option = structuredMentionOptions(
            callbacks.current.members,
            match.query
          ).slice(0, 50)[index]
          if (!option) return false
          const atom: ComposerAtom = option.kind === 'all_members'
            ? { type: 'all_members' }
            : {
                type: 'member',
                agentId: option.member.agentId,
                labelFallback: option.member.displayName
              }
          return $replaceComposerTriggerWithAtom(match, atom)
        } else {
          const option = structuredSkillOptions(
            callbacks.current.skills,
            match.query
          ).slice(0, 50)[index]
          if (!option || callbacks.current.skillCatalogStatus !== 'ready') return false
          return $replaceComposerTriggerWithAtom(match, {
            type: 'skill', skillId: option.id, nameAtSend: option.name
          })
        }
      }}
      renderMenu={({ selectedIndex, setHighlightedIndex, selectIndex }) => mentionOpen
        ? renderMentionMenu(
            mentionMenuId,
            mentionMenuOptions,
            selectedIndex,
            setHighlightedIndex,
            selectIndex
          )
        : renderSkillMenu(
            skillMenuId,
            skillCatalogStatus,
            skillMenuOptions,
            selectedIndex,
            setHighlightedIndex,
            selectIndex
          )} />
  </div>
}

function renderMentionMenu(
  menuId: string,
  options: readonly StructuredMentionOption[],
  selectedIndex: number,
  setHighlightedIndex: (index: number) => void,
  selectIndex: (index: number) => void
): JSX.Element {
  return <div id={menuId} className="mention-menu structured-mention-menu" role="listbox"
    aria-label="选择接收队员">
    <div className="mention-menu-heading"><strong>选择接收者</strong><span>↑↓ 选择 · Enter 确认</span></div>
    {options.length === 0
      ? <p className="structured-mention-empty">没有匹配的队员</p>
      : options.map((option, index) => <button type="button" role="option"
          key={option.kind === 'all_members' ? 'all-members' : `member:${option.member.agentId}`}
          aria-selected={selectedIndex === index}
          className={selectedIndex === index ? 'active' : ''}
          onMouseMove={() => setHighlightedIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectIndex(index)}>
          <StructuredMentionOptionAvatar option={option} />
          <span>
            <strong>{option.kind === 'all_members' ? '所有队员' : option.member.displayName}</strong>
            <small>{option.kind === 'all_members'
              ? '广播给当前全部队员'
              : structuredMentionMemberDescription(option.member)}</small>
          </span>
          <i aria-hidden="true" />
        </button>)}
  </div>
}

function renderSkillMenu(
  menuId: string,
  status: 'loading' | 'ready' | 'error',
  options: readonly ComposerSkillOption[],
  selectedIndex: number,
  setHighlightedIndex: (index: number) => void,
  selectIndex: (index: number) => void
): JSX.Element {
  return <div id={menuId} className="mention-menu skill-picker-menu structured-skill-menu"
    role="listbox" aria-label="选择 Skill">
    <div className="mention-menu-heading"><strong>选择 Skill</strong><span>↑↓ 选择 · Enter 确认</span></div>
    {status === 'loading'
      ? <p className="structured-mention-empty">正在读取可用 Skills…</p>
      : status === 'error'
        ? <p className="structured-mention-empty">Skills 暂时无法读取，请稍后重试</p>
        : options.length === 0
          ? <p className="structured-mention-empty">没有匹配的 Skill</p>
          : options.map((option, index) => <button type="button" role="option"
              key={`skill:${option.id}`} data-skill-name={option.name}
              aria-selected={selectedIndex === index}
              className={selectedIndex === index ? 'active' : ''}
              onMouseMove={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectIndex(index)}>
              <SkillIdentityMark skillId={option.id} name={option.name} size="compact" />
              <span className="skill-picker-copy">
                <strong>/{option.name}</strong>
                <small>{option.description}</small>
              </span>
              <span className="skill-picker-enter" aria-hidden="true">↵</span>
            </button>)}
  </div>
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
