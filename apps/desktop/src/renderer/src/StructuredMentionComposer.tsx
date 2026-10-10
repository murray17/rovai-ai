import { useEditingRecovery } from './camp-client'
import { useMobileLayout } from './MobileLayout'
import type { ThreadComposerDraftView, ComposerAtom, ComposerDocument, AdapterKind } from '@contracts'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  CLEAR_HISTORY_COMMAND,
  HISTORY_PUSH_TAG,
  SKIP_DOM_SELECTION_TAG
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
import { NavigationIcon } from './NavigationIcon'
import { MentionRuntimeButton } from './MentionRuntimeButton'
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
  composerDocumentsEqualDirect,
  composerDocumentToPlainText,
  emptyComposerDocument,
  parseComposerClipboardDocument,
  recoverComposerClipboardDocument,
  type ComposerLocalStatus
} from './composer-document'
import { UiText, uiAttribute } from './interface-language'

const EMPTY_SKILLS: readonly ComposerSkillOption[] = []

export interface StructuredMentionMember {
  agentId: string
  displayName: string
  teamRole: string
  avatarRef?: string | null
  runtimeKind?: AdapterKind
  runtimeLabel?: string
  modelLabel?: string
  mentionable?: boolean
  inThread?: boolean
}

export type StructuredMentionOption =
  | { kind: 'all_members'; label: '所有队员' }
  | { kind: 'member'; member: StructuredMentionMember }
  | { kind: 'invite_other' }
  | { kind: 'back_to_camp' }

export interface StructuredMentionComposerHandle {
  flush(): Promise<ComposerFlushResult<ThreadComposerDraftView>>
  setInteractionLocked(locked: boolean): void
  replaceDocument(
    document: ComposerDocument,
    boundary?: 'start' | 'end'
  ): void
  setDocument(document: ComposerDocument, boundary?: 'start' | 'end'): void
  focus(boundary?: 'start' | 'end'): void
  startMention(): void
  getLocalVersion(): number
  isDirty(): boolean
}

export interface StructuredMentionComposerProps {
  purpose?: 'message' | 'mission'
  onDocumentChange?(document: ComposerDocument): void
  id: string
  draftIdentity: string
  document: ComposerDocument
  ready?: boolean
  getAuthoritativeDraft?(): ThreadComposerDraftView | null
  members: readonly StructuredMentionMember[]
  skills?: readonly ComposerSkillOption[] | null
  skillCatalogStatus?: 'loading' | 'ready' | 'error'
  skillCatalogErrors?: readonly string[]
  skillCatalogRefreshFailed?: boolean
  skillCatalogRefreshing?: boolean
  onNeedSkills?(): void
  onRefreshSkills?(): void
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
  pendingInviteIds?: readonly string[]
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
  query: string,
  inviteLayer = false,
  includeAllMembers = true
): StructuredMentionOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const options: StructuredMentionOption[] = []
  const matches = (member: StructuredMentionMember): boolean =>
    member.mentionable !== false
      && `${member.displayName}\n${member.teamRole}`.toLocaleLowerCase().includes(normalizedQuery)
  const current = members.filter((member) => member.inThread !== false && matches(member))
  const outside = members.filter((member) => member.inThread === false && matches(member))
  if (inviteLayer) {
    options.push({ kind: 'back_to_camp' })
    options.push(...outside.slice(0, 49).map((member) => ({ kind: 'member' as const, member })))
    return options
  }
  if (includeAllMembers && ('所有队员'.includes(normalizedQuery) || uiAttribute('所有队员').toLocaleLowerCase().includes(normalizedQuery))) options.push({ kind: 'all_members', label: '所有队员' })
  const currentLimit = !normalizedQuery && outside.length > 0 ? 49
    : outside.length > 0 ? 40 : 50
  options.push(...current.slice(0, currentLimit - options.length)
    .map((member) => ({ kind: 'member' as const, member })))
  if (normalizedQuery) options.push(...outside.slice(0, 50 - options.length)
    .map((member) => ({ kind: 'member' as const, member })))
  else if (members.some((member) => member.inThread === false && member.mentionable !== false)) {
    options.push({ kind: 'invite_other' })
  }
  return options
}

export function structuredMentionMemberDescription(member: StructuredMentionMember): string {
  return member.teamRole.trim() || uiAttribute('团队角色未设置')
}

export function structuredSkillOptions(
  skills: readonly ComposerSkillOption[],
  query: string
): ComposerSkillOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const filtered = normalizedQuery ? skills.filter((skill) => `${skill.name}\n${skill.description}`
    .toLocaleLowerCase('zh-CN')
    .includes(normalizedQuery)) : skills
  // The typeahead indexes this array for Arrow/Enter. Match the menu's visual groups.
  return [
    ...filtered.filter((skill) => skill.source === 'toolbox'),
    ...filtered.filter((skill) => skill.source !== 'toolbox')
  ]
}

export function StructuredMentionOptionAvatar({
  option
}: {
  option: StructuredMentionOption
}): JSX.Element {
  if (option.kind === 'all_members') {
    return <span className="mention-avatar" aria-hidden="true">
      <NavigationIcon name="users" />
    </span>
  }
  if (option.kind === 'invite_other' || option.kind === 'back_to_camp') {
    return <span className="mention-avatar mention-action-avatar" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round">
        {option.kind === 'invite_other'
          ? <><circle cx="6.1" cy="5.6" r="2.5" /><path d="M1.8 13.4v-.8c0-1.6 1.7-2.7 4.3-2.7 1 0 1.9.2 2.6.5M12.1 8.6v5M9.6 11.1h5" /></>
          : <path d="M9.9 3.2 5.1 8l4.8 4.8" />}
      </svg>
    </span>
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
  purpose = 'message',
  onDocumentChange,
  id,
  draftIdentity,
  document,
  ready = true,
  getAuthoritativeDraft,
  members,
  skills = EMPTY_SKILLS,
  skillCatalogStatus = 'ready',
  skillCatalogErrors = [],
  skillCatalogRefreshFailed = false,
  skillCatalogRefreshing = false,
  onNeedSkills,
  onRefreshSkills,
  ariaLabel,
  placeholder = '',
  disabled = false,
  className = '',
  editorRef,
  persistDocument,
  waitForDraftAuthority,
  onLocalStatusChange,
  pendingInviteIds = [],
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
  const mobile = useMobileLayout()
  const mobileRef = useRef(mobile)
  mobileRef.current = mobile
  const editingRecovery = useEditingRecovery()
  const recovery = purpose === 'mission' ? null : editingRecovery
  const authorityDocument = useRef(document)
  authorityDocument.current = document
  const recoveryAttempted = useRef(false)
  const generatedId = useId()
  const syncRef = useRef<ComposerDraftSync<ThreadComposerDraftView> | null>(null)
  const initializedRef = useRef(false)
  const readyRef = useRef(ready)
  const previousReadyRef = useRef(ready)
  const disabledRef = useRef(disabled)
  const interactionLockCountRef = useRef(0)
  readyRef.current = ready
  disabledRef.current = disabled
  const callbacks = useRef({
    purpose,
    onDocumentChange,
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
    purpose,
    onDocumentChange,
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
  const [inviteLayer, setInviteLayer] = useState(false)
  const inviteLayerRef = useRef(false)
  inviteLayerRef.current = inviteLayer
  const changeInviteLayer = (next: boolean): void => {
    inviteLayerRef.current = next
    setInviteLayer(next)
  }
  const closeTypeaheads = useCallback(() => {
    setTriggerMatch(null)
    inviteLayerRef.current = false
    setInviteLayer(false)
  }, [])
  const mentionQuery = triggerMatch?.kind === 'member' ? triggerMatch.query : null
  const skillQuery = triggerMatch?.kind === 'skill' ? triggerMatch.query : null
  const mentionOpen = triggerMatch?.kind === 'member'
  const skillOpen = triggerMatch?.kind === 'skill'
  useEffect(() => { if (skillOpen && skillCatalogStatus === 'loading') onNeedSkills?.() }, [skillOpen, skillCatalogStatus, onNeedSkills])
  const mentionOptions = useMemo(
    () => mentionQuery === null ? [] : structuredMentionOptions(members, mentionQuery, inviteLayer, purpose !== 'mission'),
    [inviteLayer, members, mentionQuery, purpose]
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
    onLocalDocumentChange: (local: ComposerDocument) => { callbacks.current.onDocumentChange?.(local); recovery?.set(draftIdentity, { document: local, base: callbacks.current.getAuthoritativeDraft?.()?.content ?? authorityDocument.current }) },
    onSaved: (_version: number, savedDocument: ComposerDocument) => {
      const pending = recovery?.get(draftIdentity) as { document?: ComposerDocument } | null
      if (pending?.document) recovery?.set(draftIdentity, { document: pending.document, base: savedDocument })
    },
    onDirtyChange: (dirty: boolean) => {
      if (!dirty) recovery?.set(draftIdentity, null)
      callbacks.current.onDirtyChange?.(dirty)
    },
    onPersistenceErrorChange: (error: Error | null) =>
      callbacks.current.onPersistenceErrorChange?.(error)
  }), [recovery, draftIdentity])

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
    const runtime: ComposerExtensionRuntime<ThreadComposerDraftView> = {
      sync,
      submit: () => { void callbacks.current.onSubmit() },
      enterInsertsLineBreak: () => callbacks.current.purpose === 'mission' || mobileRef.current,
      backspaceAtStart: () => { void callbacks.current.onBackspaceAtStart?.() },
      pasteFiles: (files) => callbacks.current.onPasteFiles?.(files),
      plainText: (selection) =>
        composerDocumentToPlainText(selection, callbacks.current.members),
      recoverClipboard: (value) => {
        let parsed = parseComposerClipboardDocument(value)
        if (parsed && callbacks.current.purpose === 'mission') {
          parsed = { ...parsed, segments: parsed.segments.map(segment => segment.kind === 'atom' && segment.atom.type !== 'member'
            ? { kind: 'text', text: composerDocumentToPlainText({version:2, segments:[segment]}, callbacks.current.members) }
            : segment) }
        }
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
      recoveryAttempted.current = false
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
    // Refreshing member/Skill labels must not move focus out of an open menu.
    editor.update(() => {
      for (const atom of $nodesOfType(ComposerAtomNode)) atom.markDirty()
    }, { tag: [ROVAI_ATOM_PRESENTATION_TAG, SKIP_DOM_SELECTION_TAG] })
  }, [bindings, editor, members, skills])

  useLayoutEffect(() => {
    if (!initializedRef.current || previousReadyRef.current || !ready) {
      previousReadyRef.current = ready
      return
    }
    previousReadyRef.current = true
    replaceAuthoritativeDocument(document)
  }, [document, ready, replaceAuthoritativeDocument])

  useLayoutEffect(() => {
    if (!ready || recoveryAttempted.current || !recovery || !syncRef.current) return
    recoveryAttempted.current = true
    const saved = recovery.get(draftIdentity) as { document?: unknown; base?: unknown } | null
    if (!saved) return
    const local = parseComposerClipboardDocument(JSON.stringify(saved.document))
    const base = parseComposerClipboardDocument(JSON.stringify(saved.base))
    if (!local || !base) { onPersistenceErrorChange?.(new Error(uiAttribute('未保存的编辑恢复材料无效。'))); return }
    if (composerDocumentsEqualDirect(document, local)) { recovery.set(draftIdentity, null); return }
    if (!composerDocumentsEqualDirect(document, base)) {
      onPersistenceErrorChange?.(new Error(uiAttribute('Host 草稿已变化，本标签页的未保存编辑仍保留，暂未覆盖当前草稿。')))
      return
    }
    editor.update(() => { $replaceEditorWithComposerDocument(local) }, { discrete: true, tag: ROVAI_COMPOSER_INITIALIZE_TAG })
    syncRef.current.restoreLocalState(editor.getEditorState())
  }, [document, ready, recovery, draftIdentity, editor, onPersistenceErrorChange])

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
    startMention() {
      if (!editor.isEditable()) return
      editor.update(() => {
        const selection = $getSelection()
        if ($isRangeSelection(selection)) {
          const node = selection.anchor.getNode()
          const before = $isTextNode(node) ? node.getTextContent().slice(0, selection.anchor.offset) : ''
          selection.insertText(before && !/\s$/.test(before) ? ' @' : '@')
        } else $getRoot().selectEnd().insertText(' @')
      }, { discrete: true, tag: HISTORY_PUSH_TAG })
      editor.focus()
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
    <ComposerTypeaheadPlugin match={triggerMatch} memberOnly={purpose === 'mission'}
      menuAnchor={purpose === 'mission' ? 'caret' : 'editor'}
      selectionScope={inviteLayer ? 'inviting' : 'camp'}
      optionCount={mentionOpen ? mentionMenuOptions.length : skillMenuOptions.length}
      getOptionState={(match) => match.kind === 'member'
        ? {
            catalogStatus: 'ready',
            optionCount: structuredMentionOptions(callbacks.current.members, match.query, inviteLayerRef.current, callbacks.current.purpose !== 'mission')
              .slice(0, 50).length
          }
        : {
            catalogStatus: callbacks.current.skillCatalogStatus,
            optionCount: structuredSkillOptions(callbacks.current.skills, match.query)
              .slice(0, 50).length
          }}
      onMatchChange={(next) => {
        if (!next || next.kind !== 'member'
          || triggerMatch?.kind !== 'member'
          || triggerMatch.nodeKey !== next.nodeKey
          || triggerMatch.fromOffset !== next.fromOffset) changeInviteLayer(false)
        setTriggerMatch(next)
      }}
      onSelect={(index, match) => {
        if (editor.isComposing()) return false
        if (match.kind === 'member') {
          const option = structuredMentionOptions(
            callbacks.current.members,
            match.query,
            inviteLayerRef.current,
            callbacks.current.purpose !== 'mission'
          ).slice(0, 50)[index]
          if (!option) return false
          if (option.kind === 'invite_other') {
            changeInviteLayer(true)
            return false
          }
          if (option.kind === 'back_to_camp') {
            changeInviteLayer(false)
            return false
          }
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
            inviteLayer,
            pendingInviteIds,
            mentionQuery ?? '',
            selectedIndex,
            setHighlightedIndex,
            selectIndex,
            purpose === 'mission'
          )
        : renderSkillMenu(
            skillMenuId,
            skillCatalogStatus,
            skillMenuOptions,
            members,
            skillCatalogErrors ?? [],
            skillCatalogRefreshFailed,
            skillCatalogRefreshing,
            onRefreshSkills,
            selectedIndex,
            setHighlightedIndex,
            selectIndex
          )} />
  </div>
}

function renderMentionMenu(
  menuId: string,
  options: readonly StructuredMentionOption[],
  inviteLayer: boolean,
  pendingInviteIds: readonly string[],
  query: string,
  selectedIndex: number,
  setHighlightedIndex: (index: number) => void,
  selectIndex: (index: number) => void,
  mission = false
): JSX.Element {
  const hasRuntime = options.some(option => option.kind === 'member' && option.member.runtimeLabel)
  return <div className="mention-menu structured-mention-menu">
    <div className="mention-menu-heading"><strong>{inviteLayer
      ? <UiText zh={'邀请队员'} />
      : query.trim() ? <UiText zh={'搜索队员'} /> : mission ? <UiText zh={'本使命'} /> : <UiText zh={'本会话'} />}</strong><span><UiText zh={"↑↓ 选择 · Enter 确认"} /></span></div>
    <div className={`mention-menu-columns${hasRuntime ? ' has-runtime' : ''}`}>
    <div id={menuId} role="listbox" aria-label={inviteLayer ? uiAttribute('可邀请队员') : mission ? uiAttribute('提及队员') : uiAttribute('选择接收队员')}>
    {options.length === 0
      ? <p className="structured-mention-empty"><UiText zh={"没有匹配的队员"} /></p>
      : options.map((option, index) => <button type="button" role="option" id={`${menuId}-option-${index}`}
          key={option.kind === 'member' ? `member:${option.member.agentId}` : option.kind}
          data-agent-id={option.kind === 'member' ? option.member.agentId : undefined}
          aria-selected={selectedIndex === index}
          aria-label={option.kind === 'member'
            ? [option.member.displayName, structuredMentionMemberDescription(option.member),
              option.member.runtimeLabel, option.member.modelLabel,
              option.member.inThread === false ? pendingInviteIds.includes(option.member.agentId) ? uiAttribute('待邀请') : uiAttribute('邀请加入') : null
            ].filter(Boolean).join(uiAttribute('，'))
            : option.kind === 'all_members' ? uiAttribute('所有队员，仅本会话')
              : option.kind === 'invite_other' ? uiAttribute('邀请其他队员') : mission ? uiAttribute('返回本使命') : uiAttribute('返回本会话')}
          className={[selectedIndex === index ? 'active' : '',
            option.kind === 'member' && option.member.inThread === false ? 'is-invitable' : '',
            option.kind === 'invite_other' || option.kind === 'back_to_camp' ? 'is-mention-action' : ''
          ].filter(Boolean).join(' ')}
          onMouseMove={() => setHighlightedIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectIndex(index)}>
          <StructuredMentionOptionAvatar option={option} />
          <span>
            <span className="mention-option-name"><strong>{option.kind === 'all_members' ? uiAttribute('所有队员')
              : option.kind === 'invite_other' ? uiAttribute('邀请其他队员')
                : option.kind === 'back_to_camp' ? mission ? uiAttribute('返回本使命') : uiAttribute('返回本会话')
                  : option.member.displayName}</strong>
              {option.kind === 'member' && option.member.inThread === false
                && <span className="mention-option-state">{pendingInviteIds.includes(option.member.agentId)
                  ? <UiText zh={'待邀请'} /> : <UiText zh={'邀请'} />}</span>}
            </span>
            <small>{option.kind === 'all_members'
              ? uiAttribute('广播给当前全部队员')
              : option.kind === 'invite_other' ? uiAttribute('浏览其他可用队员')
                : option.kind === 'back_to_camp' ? mission ? uiAttribute('查看当前使命队员') : uiAttribute('查看当前会话队员')
                  : structuredMentionMemberDescription(option.member)}</small>
          </span>
          {option.kind === 'invite_other'
              ? <svg className="mention-action-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2.5 3.5 3.5L4 9.5" /></svg>
              : null}
        </button>)}
    </div>
    {hasRuntime && <div className="mention-runtime-column" aria-label={uiAttribute('智能体')}>
      {options.map((option, index) => option.kind === 'member' && option.member.runtimeLabel
        ? <MentionRuntimeButton key={option.member.agentId} kind={option.member.runtimeKind}
            label={option.member.runtimeLabel} model={option.member.modelLabel} memberName={option.member.displayName}
            active={selectedIndex === index} onHighlight={() => setHighlightedIndex(index)} onSelect={() => selectIndex(index)} />
        : <span key={option.kind === 'member' ? option.member.agentId : option.kind} className={`mention-runtime-placeholder${option.kind === 'invite_other' || option.kind === 'back_to_camp' ? ' is-mention-action' : ''}`} aria-hidden="true" />)}
    </div>}
    </div>
  </div>
}

export function renderSkillMenu(
  menuId: string,
  status: 'loading' | 'ready' | 'error',
  options: readonly ComposerSkillOption[],
  members: readonly StructuredMentionMember[],
  errors: readonly string[],
  refreshFailed: boolean,
  refreshing: boolean,
  onRefresh: (() => void) | undefined,
  selectedIndex: number,
  setHighlightedIndex: (index: number) => void,
  selectIndex: (index: number) => void
): JSX.Element {
  const sections = [
    { label:uiAttribute("工具箱"), entries: options.map((option, index) => ({ option, index })).filter(({ option }) => option.source === 'toolbox') },
    { label: 'Skills', entries: options.map((option, index) => ({ option, index })).filter(({ option }) => option.source !== 'toolbox') }
  ].filter(({ entries }) => entries.length > 0)
  return <div id={menuId} className="mention-menu skill-picker-menu structured-skill-menu"
    role="listbox" aria-label={uiAttribute("选择 Skill")}>
    <div className="mention-menu-heading"><strong><UiText zh={"选择 Skill"} /></strong><span><UiText zh={"↑↓ 选择 · Enter 确认"} /></span>{onRefresh && <button type="button" aria-label={uiAttribute("刷新 Skill 候选")} disabled={refreshing} onMouseDown={(event) => event.preventDefault()} onClick={onRefresh}><UiText zh={"刷新"} /></button>}</div>
    {status === 'loading'
      ? <p className="structured-mention-empty"><UiText zh={"正在读取可用 Skills…"} /></p>
      : status === 'error'
        ? <p className="structured-mention-empty"><UiText zh={"Skills 暂时无法读取，请稍后重试"} /></p>
        : options.length === 0
          ? <p className="structured-mention-empty"><UiText zh={"没有匹配的 Skill"} /></p>
          : sections.map((section) => <div className="skill-picker-section" role="group" aria-label={section.label} key={section.label}>
            <div className="skill-picker-group" aria-hidden="true">{section.label}</div>
            {section.entries.map(({ option, index }) => <button type="button" role="option" id={`${menuId}-option-${index}`}
              key={`skill:${option.id}`} data-skill-name={option.name}
              aria-selected={selectedIndex === index}
              aria-label={`/${option.name}${uiAttribute('，')}${option.source === 'toolbox' ? uiAttribute("工具箱") : option.sourceScope === 'project' ? uiAttribute("项目 Skill") : uiAttribute("用户 Skill")}${option.memberIds?.length ? uiAttribute("，关联队员：{0}", members.filter((member) => option.memberIds?.includes(member.agentId)).map((member) => member.displayName).join(uiAttribute('、'))) : ''}`}
              className={selectedIndex === index ? 'active' : ''}
              onMouseMove={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectIndex(index)}>
              <SkillIdentityMark skillId={option.id} name={option.name} size="compact" />
              <span className="skill-picker-copy">
                <strong>/{option.name}</strong>
                <small>{option.description}</small>
              </span>
              {option.memberIds && <span className="skill-picker-member-count" title={`${option.source === 'toolbox' ? uiAttribute("已配置此 Skill 的队员") : uiAttribute("在以下队员的环境中发现")}${uiAttribute('：')}${members.filter((member) => option.memberIds?.includes(member.agentId)).map((member) => member.displayName).join(uiAttribute('、'))}`}>{option.memberIds.slice(0, 3).map((id) => {
                const member = members.find((candidate) => candidate.agentId === id)
                return member ? <MemberAvatar key={id} agentId={id} avatarRef={member.avatarRef ?? null} displayName={member.displayName} size="execution" decorative /> : null
              })}{option.memberIds.length > 3 && <small>+{option.memberIds.length - 3}</small>}</span>}
              <span className="skill-picker-enter" aria-hidden="true">↵</span>
            </button>)}
          </div>)}
    {refreshing && <p className="structured-mention-empty" role="status"><UiText zh={"正在刷新 Skill 候选…"} /></p>}
    {refreshFailed
      ? <p className="structured-mention-empty" role="alert"><UiText zh={"刷新失败，当前显示上次读取的候选。请重试。"} /></p>
      : errors.length > 0 && <p className="structured-mention-empty" role="status"><UiText zh={"部分来源暂不可读，仍可选择已发现的 Skill。"} /></p>}
  </div>
}

function atomPresentation(
  node: ComposerAtomNode,
  input: Pick<StructuredMentionComposerProps,
    'purpose' | 'members' | 'skills' | 'skillCatalogStatus' | 'onActivateMemberMention'
    | 'onActivateAllMembersMention' | 'onActivateSkillMention'>
): ComposerAtomPresentation {
  const atom = node.getAtom()
  if (atom.type === 'member') {
    const member = input.members.find((candidate) => candidate.agentId === atom.agentId)
    const available = Boolean(member && member.mentionable !== false)
    const label = member?.displayName ?? atom.labelFallback ?? uiAttribute('不可用队员')
    const pendingInvite = available && member?.inThread === false
    return {
      label: label.startsWith('@') ? label : `@${label}`,
      availability: available ? 'available' : 'unavailable',
      interactive: Boolean(available && member?.inThread !== false && input.onActivateMemberMention),
      ariaLabel: pendingInvite ? input.purpose === 'mission' ? uiAttribute('成员 {0} 待邀请，保存时加入', String(label)) : uiAttribute('成员 {0} 待邀请，发送时加入', String(label))
        : available ? uiAttribute("成员 {0}", String(label)) : uiAttribute("成员 {0} 当前不可用", String(label))
    }
  }
  if (atom.type === 'all_members') {
    return {
      label:uiAttribute("@所有队员"),
      availability: 'available',
      interactive: Boolean(input.onActivateAllMembersMention),
      ariaLabel: uiAttribute('所有队员')
    }
  }
  const skill = (input.skills ?? []).find((candidate) => candidate.id === atom.skillId)
  // An unopened catalog has not declared a stored reference unavailable. Keep its
  // saved label; the Core validates the actual reference when the user sends it.
  const unavailable = (input.skillCatalogStatus ?? 'ready') === 'ready' && !skill
  return {
    label: `/${skill?.name ?? atom.nameAtSend}`,
    availability: unavailable ? 'unavailable' : 'available',
    interactive: Boolean(input.onActivateSkillMention),
    ariaLabel: unavailable ? uiAttribute("Skill {0} 当前不可用", String(atom.nameAtSend)) : `Skill ${skill?.name ?? atom.nameAtSend}`
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
