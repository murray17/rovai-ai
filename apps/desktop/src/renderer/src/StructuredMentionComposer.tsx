import { useProjectFileComposer } from './ProjectFileComposerContext'
import { useOptionalFilePreview } from './file-preview-context'
import { isProjectFileAtom, fileReferenceKey, fileReferencePresentation } from './project-file-reference'
import { composerProjectFiles, useProjectFileAvailability, type FileAvailability } from './useProjectFileAvailability'
import { useProjectFileReferenceCapability, createProjectFileReference } from './useProjectFileCandidates'
import { pickerOptionKey } from './useReferencePicker'
import { ProjectFileReferenceActions } from './ProjectFileReferenceActions'
import { useReferencePicker, type ReferenceScope } from './useReferencePicker'
import { composerReferenceIdentities, useReferenceAvailability } from './useReferenceAvailability'
import { ThreadReferenceMenu } from './ThreadReferenceMenu'
import { useReferencePreview } from './ThreadReferencePreview'
import { isReferenceAtom, referenceAtom, referenceIdentity } from './thread-reference'
import { memberSearchMatches } from './member-search'
import { useShortcuts } from './ShortcutProvider'
import { shouldSendComposerKey } from '../../shared/shortcuts'
import { useEditingRecovery } from './camp-client'
import { useMobileLayout } from './MobileLayout'
import type { ThreadComposerDraftView, ComposerAtom, ComposerDocument, AdapterKind } from '@contracts'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $createTextNode,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ENTER_COMMAND,
  HISTORIC_TAG,
  HISTORY_PUSH_TAG,
  PASTE_TAG,
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
  $createComposerAtomNode,
  $isComposerAtomNode,
  setComposerAtomPresentationResolver,
  type ComposerAtomPresentation
} from './ComposerAtomNode'
import { ComposerTypeaheadPlugin } from './ComposerTypeaheadPlugin'
import { ComposerWebLinksPlugin } from './ComposerWebLinksPlugin'
import { ComposerInputHistoryPlugin, type ComposerHistoryNavigation } from './ComposerInputHistoryPlugin'
import { MemberAvatar } from './MemberAvatar'
import { NavigationIcon } from './NavigationIcon'
import { MentionRuntimeButton } from './MentionRuntimeButton'
import {
  RovaiComposerExtension,
  setComposerExtensionRuntime,
  type ComposerExtensionRuntime
} from './RovaiComposerExtension'
import type { ComposerSkillOption } from './composer-skill-picker'
import { $replaceEditorWithComposerDocument, $rootToComposerDocument } from './composer-editor-state'
import {
  $replaceComposerTriggerWithAtom,
  $findComposerTriggerMatch,
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
  getDocument(): ComposerDocument
  flush(): Promise<ComposerFlushResult<ThreadComposerDraftView>>
  adoptHistoryPreview(): void
  cancelHistoryPreview(): void
  appendText(text: string): void
  setInteractionLocked(locked: boolean): void
  replaceDocument(
    document: ComposerDocument,
    boundary?: 'start' | 'end'
  ): void
  setDocument(document: ComposerDocument, boundary?: 'start' | 'end'): void
  focus(boundary?: 'start' | 'end'): void
  insertProjectFile(atom: Extract<ComposerAtom, { type: 'project_file_reference' }>): void
  startMention(): void
  getLocalVersion(): number
  isDirty(): boolean
}

export interface StructuredMentionComposerProps {
  referenceScope?: ReferenceScope
  purpose?: 'message' | 'mission'
  onDocumentChange?(document: ComposerDocument): void
  onEffectiveDocumentChange?(document: ComposerDocument): void
  inputHistory?: () => ComposerDocument[]
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
  onPasteLongText?(text: string): boolean
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
      && (memberSearchMatches(member.displayName, query) || memberSearchMatches(member.teamRole, query))
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
  referenceScope,
  purpose = 'message',
  onDocumentChange,
  onEffectiveDocumentChange,
  inputHistory,
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
  onPasteLongText,
  onActivateMemberMention,
  onActivateAllMembersMention,
  onActivateSkillMention,
  forwardedRef
}: StructuredMentionComposerProps & {
  forwardedRef: ForwardedRef<StructuredMentionComposerHandle>
}): JSX.Element {
  const [editor] = useLexicalComposerContext()
  const referencePreview = useReferencePreview()
  const filePreview = useOptionalFilePreview()
  const filesSupported = useProjectFileReferenceCapability(referenceScope?.client)
  const [fileAtoms, setFileAtoms] = useState(() => composerProjectFiles(document))
  const fileAvailability = useProjectFileAvailability(referenceScope, fileAtoms, filesSupported)
  const [fileSelectionError, setFileSelectionError] = useState('')
  const fileSelectionBeforePointer = useRef<ReturnType<typeof $getSelection>>(null)
  const [fileActions, setFileActions] = useState<{ edit(replace: boolean): void; nodeKey: string; trigger: HTMLElement; atom: Extract<ComposerAtom, { type: 'project_file_reference' }>; restore(): void } | null>(null)
  const insertionTicket = useRef(0)
  const fileInsertionPending = useRef(false)
  useEffect(() => { insertionTicket.current++; setFileActions(null) }, [draftIdentity])
  const [referenceIdentities, setReferenceIdentities] = useState(() => composerReferenceIdentities(document))
  const referenceAvailability = useReferenceAvailability(referenceScope, referenceIdentities)
  const onActivateReference = (node: ComposerAtomNode, trigger: HTMLElement, fileDetails = false): boolean => {
    const atom = node.getAtom()
    if ((!isReferenceAtom(atom) && !isProjectFileAtom(atom)) || !referenceScope) return false
    const savedSelection = isProjectFileAtom(atom) ? fileSelectionBeforePointer.current ?? $getSelection()?.clone() : $getSelection()?.clone()
    fileSelectionBeforePointer.current = null
    const selectionKeys = $isRangeSelection(savedSelection)
      ? [savedSelection.anchor.key, savedSelection.focus.key]
      : savedSelection?.getNodes().map(selected => selected.getKey()) ?? []
    let edited = false
    const edit = (replace: boolean): void => {
      edited = true
      editor.update(() => {
        const current = $getNodeByKey(node.getKey())
        if (!$isComposerAtomNode(current)) return
        if (replace) { const text = $createTextNode('@'); current.replace(text); text.selectEnd() }
        else { current.selectNext(); current.remove() }
      }, { discrete: true, tag: HISTORY_PUSH_TAG })
      editor.focus()
    }
    const restore = () => {
      const root = editor.getRootElement()
      if (!root?.isConnected) return
      root.focus({ preventScroll: true })
      if (!edited && savedSelection) editor.update(() => {
        if (selectionKeys.every(key => $getNodeByKey(key)?.isAttached())) $setSelection(savedSelection.clone())
      }, { discrete: true })
      else editor.focus()
    }
    if (isProjectFileAtom(atom)) {
      if (fileDetails) setFileActions({ atom, trigger, nodeKey: node.getKey(), restore, edit })
      else void filePreview?.open({ kind: 'project_file', threadId: atom.threadId, rawReference: atom.rawReference }).then(restore).catch(() => setFileActions({ atom, trigger, nodeKey: node.getKey(), restore, edit }))
    } else referencePreview?.({ reference: referenceIdentity(atom), title: atom.labelFallback ?? referenceIdentity(atom).id,
      titleMode: 'current', trigger, remove: () => edit(false), replace: () => edit(true), restoreFocus: restore })
    return true
  }
  const fileComposer = useProjectFileComposer()
  useEffect(() => {
    if (!fileComposer || !referenceScope) return
    return fileComposer.register({ threadId: referenceScope.threadId, client: referenceScope.client,
      enabled: filesSupported && ready && !disabled && purpose === 'message', insert: atom => {
        if (!editor.isEditable()) return
        editor.update(() => {
          let selection = $getSelection()
          if (!$isRangeSelection(selection)) selection = $getRoot().selectEnd()
          selection.insertNodes([$createComposerAtomNode(atom), $createTextNode(' ')])
        }, { discrete: true, tag: HISTORY_PUSH_TAG })
        editor.focus()
      } })
  }, [fileComposer?.register, referenceScope?.threadId, referenceScope?.client, filesSupported, ready, disabled, purpose, editor])

  useEffect(() => {
    let cleanup = () => {}
    const stop = editor.registerRootListener(root => {
      cleanup()
      if (!root) return
      let timer: ReturnType<typeof setTimeout> | undefined, suppressUntil = 0
      const showDetails = (element?: HTMLElement | null, event?: Event) => {
        editor.update(() => {
          const selection = $getSelection()
          const node = element ? $getNearestNodeFromDOMNode(element) : $isNodeSelection(selection) ? selection.getNodes()[0] : null
          if (!$isComposerAtomNode(node) || node.getAtomType() !== 'project_file_reference') return
          const trigger = element ?? editor.getElementByKey(node.getKey())
          if (!trigger) return
          event?.preventDefault(); event?.stopPropagation()
          callbacks.current.onActivateReference(node, trigger, true)
        })
      }
      const details = (event: Event) => {
        if (event instanceof KeyboardEvent && !(event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10')) return
        showDetails((event.target as Element | null)?.closest<HTMLElement>('[data-composer-atom=project_file_reference]'), event)
      }
      const down = (event: PointerEvent) => {
        const element = (event.target as Element | null)?.closest<HTMLElement>('[data-composer-atom=project_file_reference]')
        if (element) editor.getEditorState().read(() => { fileSelectionBeforePointer.current = $getSelection()?.clone() ?? null })
        if (event.pointerType !== 'touch') return
        if (element) timer = setTimeout(() => { suppressUntil = Date.now() + 900; showDetails(element) }, 550)
      }
      const up = (event: Event) => { clearTimeout(timer); if (Date.now() < suppressUntil) { event.preventDefault(); event.stopPropagation() } }
      const cancel = () => clearTimeout(timer)
      const click = (event: Event) => { if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation() } }
      root.addEventListener('contextmenu', details); root.addEventListener('keydown', details)
      root.addEventListener('pointerdown', down, true); root.addEventListener('pointerup', up)
      root.addEventListener('touchend', up, { passive: false }); root.addEventListener('pointercancel', cancel); root.addEventListener('pointermove', cancel); root.addEventListener('click', click, true)
      cleanup = () => {
        clearTimeout(timer); root.removeEventListener('contextmenu', details); root.removeEventListener('keydown', details)
        root.removeEventListener('pointerdown', down, true); root.removeEventListener('pointerup', up); root.removeEventListener('touchend', up); root.removeEventListener('pointercancel', cancel); root.removeEventListener('pointermove', cancel); root.removeEventListener('click', click, true)
      }
    })
    return () => { cleanup(); stop() }
  }, [editor])

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
  const historyNavigationRef = useRef<ComposerHistoryNavigation | null>(null)
  const initializedRef = useRef(false)
  const readyRef = useRef(ready)
  const previousReadyRef = useRef(ready)
  const disabledRef = useRef(disabled)
  const interactionLockCountRef = useRef(0)
  readyRef.current = ready
  disabledRef.current = disabled
  const shortcutContext = useShortcuts()
  const shortcutRef = useRef(shortcutContext)
  shortcutRef.current = shortcutContext
  const callbacks = useRef({
    purpose,
    referenceScope,
    referenceAvailability,
    fileAtoms, fileAvailability: fileAvailability.items, filesSupported,
    onActivateReference,
    onDocumentChange,
    onEffectiveDocumentChange,
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
    onPasteLongText,
    onActivateMemberMention,
    onActivateAllMembersMention,
    onActivateSkillMention
  })
  callbacks.current = {
    purpose,
    referenceScope,
    referenceAvailability,
    fileAtoms, fileAvailability: fileAvailability.items, filesSupported,
    onActivateReference,
    onDocumentChange,
    onEffectiveDocumentChange,
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
    onPasteLongText,
    onActivateMemberMention,
    onActivateAllMembersMention,
    onActivateSkillMention
  }

  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, event => {
    if (editor.isComposing() || event?.isComposing || event?.shiftKey) return false
    const selection = $getSelection()
    if (!$isNodeSelection(selection)) return false
    const nodes = selection.getNodes()
    const node = nodes.length === 1 ? nodes[0] : null
    if (!$isComposerAtomNode(node) || (!isReferenceAtom(node.getAtom()) && !isProjectFileAtom(node.getAtom()))) return false
    const trigger = editor.getElementByKey(node.getKey())
    if (!trigger || !callbacks.current.onActivateReference(node, trigger)) return false
    event?.preventDefault()
    return true
  }, COMMAND_PRIORITY_CRITICAL), [editor])

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
  const referencePicker = useReferencePicker(referenceScope, triggerMatch, inviteLayer, mentionOptions, filesSupported)
  const pickerRef = useRef(referencePicker)
  pickerRef.current = referencePicker
  useEffect(() => {
    insertionTicket.current++; fileInsertionPending.current = false; setFileSelectionError('')
  }, [triggerMatch?.nodeKey, triggerMatch?.fromOffset, triggerMatch?.toOffset, triggerMatch?.query, referenceScope?.threadId])
  const skillOptions = useMemo(
    () => skillQuery === null ? [] : structuredSkillOptions(skills ?? [], skillQuery),
    [skillQuery, skills]
  )
  const bindings = useCallback(() => ({
    persist: async (next: ComposerDocument, context: ComposerPersistContext) => {
      if (composerProjectFiles(next).length && !callbacks.current.filesSupported) throw new Error(uiAttribute('当前 Host 不支持文件引用，请升级后恢复此草稿'))
      await callbacks.current.persistDocument?.(next, context)
    },
    waitForAuthority: callbacks.current.waitForDraftAuthority,
    currentDraft: () => callbacks.current.getAuthoritativeDraft?.() ?? null,
    atomIsAvailable: (node: ComposerAtomNode) =>
      atomPresentation(node, callbacks.current).availability === 'available',
    onStatusChange: (status: ComposerLocalStatus) =>
      callbacks.current.onLocalStatusChange?.(status),
    onLocalDocumentChange: (local: ComposerDocument) => {
      historyNavigationRef.current?.adopt()
      callbacks.current.onDocumentChange?.(local)
      recovery?.set(draftIdentity, { document: local, base: callbacks.current.getAuthoritativeDraft?.()?.content ?? authorityDocument.current })
    },
    onEffectiveDocumentChange: (local: ComposerDocument) => {
      const nextFiles = composerProjectFiles(local)
      setFileAtoms(previous => JSON.stringify(previous) === JSON.stringify(nextFiles) ? previous : nextFiles)
      const next = composerReferenceIdentities(local)
      setReferenceIdentities(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      callbacks.current.onEffectiveDocumentChange?.(local)
    },
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
    historyNavigationRef.current?.adopt()
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
      submit: () => { if (!fileInsertionPending.current) void callbacks.current.onSubmit() },
      enterInsertsLineBreak: () => callbacks.current.purpose === 'mission' || mobileRef.current,
      shouldSubmitEnter: event => {
        const context = shortcutRef.current
        return context ? Boolean(event && shouldSendComposerKey(event, context.platform, context.snapshot?.preferences.sendMode ?? 'enter')) : !event?.shiftKey
      },
      backspaceAtStart: () => { void callbacks.current.onBackspaceAtStart?.() },
      pasteFiles: (files) => callbacks.current.onPasteFiles?.(files),
      pasteLongText: (text) => callbacks.current.onPasteLongText?.(text) ?? false,
      plainText: (selection) =>
        composerDocumentToPlainText(selection, callbacks.current.members),
      recoverClipboard: (value) => {
        let parsed = parseComposerClipboardDocument(value)
        if (parsed && callbacks.current.purpose === 'mission') {
          parsed = { ...parsed, segments: parsed.segments.map(segment => segment.kind === 'atom' && segment.atom.type !== 'member'
            ? { kind: 'text', text: composerDocumentToPlainText({version:2, segments:[segment]}, callbacks.current.members) }
            : segment) }
        }
        if (parsed && !callbacks.current.referenceScope) {
          parsed.segments = parsed.segments.map(segment => segment.kind === 'atom' && (isReferenceAtom(segment.atom) || isProjectFileAtom(segment.atom))
            ? { kind: 'text', text: composerDocumentToPlainText({ version: 2, segments: [segment] }) } : segment)
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
    // Presentation changes neither editable content nor undo history; in a
    // recall preview it must not make a previously viewed entry undoable.
    editor.update(() => {
      for (const atom of $nodesOfType(ComposerAtomNode)) atom.markDirty()
    }, { tag: [ROVAI_ATOM_PRESENTATION_TAG, HISTORIC_TAG, SKIP_DOM_SELECTION_TAG] })
  }, [bindings, editor, members, skills, referenceAvailability, fileAvailability.items, fileAtoms, filesSupported])

  useEffect(() => {
    if (!referenceScope || !filesSupported) return
    editor.update(() => {
      for (const node of $nodesOfType(ComposerAtomNode)) {
        const atom = node.getAtom()
        if (!isProjectFileAtom(atom) || atom.threadId === referenceScope.threadId) continue
        const result = fileAvailability.items.get(fileReferenceKey(atom))
        if (result?.status === 'available' && result.reference.threadId === referenceScope.threadId) {
          node.setFileThreadId(result.reference.threadId).setRawReference(result.reference.rawReference).setFallbackLabel(result.reference.labelFallback)
        }
      }
    }, { tag: [HISTORIC_TAG, SKIP_DOM_SELECTION_TAG] })
  }, [editor, referenceScope?.threadId, filesSupported, fileAvailability.items])

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
    getDocument: () => editor.getEditorState().read($rootToComposerDocument),
    adoptHistoryPreview() {
      historyNavigationRef.current?.adopt()
      syncRef.current?.adoptHistoryPreview()
    },
    cancelHistoryPreview() { historyNavigationRef.current?.cancel() },
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
    insertProjectFile(atom) {
      if (!callbacks.current.filesSupported || atom.threadId !== callbacks.current.referenceScope?.threadId || !editor.isEditable()) return
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) && !$isNodeSelection(selection)) $getRoot().selectEnd()
        const node = $createComposerAtomNode(atom)
        const current = $getSelection()
        if ($isRangeSelection(current)) current.insertNodes([node, $createTextNode(' ')])
      }, { discrete: true, tag: HISTORY_PUSH_TAG })
      editor.focus()
    },
    appendText(text) {
      // Recovery uses the live editor, including edits made while preparation
      // was pending. Never replace it with the pre-paste draft snapshot.
      editor.update(() => {
        $getRoot().selectEnd().insertRawText(text)
      }, { discrete: true, tag: [PASTE_TAG, SKIP_DOM_SELECTION_TAG] })
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

  useEffect(() => {
    let cleanup = () => {}
    const stop = editor.registerRootListener(root => {
      cleanup()
      if (!root) return
      const start = () => { insertionTicket.current++; fileInsertionPending.current = false; setTriggerMatch(null) }
      const end = () => { queueMicrotask(() => editor.getEditorState().read(() => setTriggerMatch($findComposerTriggerMatch(editor)))) }
      root.addEventListener('compositionstart', start); root.addEventListener('compositionend', end)
      cleanup = () => { root.removeEventListener('compositionstart', start); root.removeEventListener('compositionend', end) }
    })
    return () => { cleanup(); stop() }
  }, [editor])

  const mentionMenuOptions = referenceScope ? referencePicker.options : mentionOptions
  const getMentionOptions = (query: string) => callbacks.current.referenceScope ? pickerRef.current.query === query ? pickerRef.current.options : [] : structuredMentionOptions(callbacks.current.members, query, inviteLayerRef.current, callbacks.current.purpose !== 'mission')
  const skillMenuOptions = useMemo(() => skillOptions.slice(0, 50), [skillOptions])
  const mentionMenuId = `${id || generatedId}-mention-options`
  const skillMenuId = `${id || generatedId}-skill-options`
  const menuOpen = mentionOpen || skillOpen

  const editFile = (replace: boolean) => {
    if (!fileActions) return
    fileActions.edit(replace)
    setFileActions(null)
  }

  return <div className={`structured-mention-composer ${className}`.trim()}>
    <ProjectFileReferenceActions request={fileActions} status={fileActions ? fileAvailability.items.get(fileReferenceKey(fileActions.atom)) : undefined} onClose={() => setFileActions(null)} onRemove={() => editFile(false)} onReplace={() => editFile(true)} onRetry={fileAvailability.retry} onOpen={() => {
      if (!fileActions) return
      const { atom, restore } = fileActions
      void filePreview?.open({ kind: 'project_file', threadId: atom.threadId, rawReference: atom.rawReference }).then(() => restore())
      setFileActions(null)
    }} />
    {fileSelectionError && <div className="ref-source-note" role="status">{fileSelectionError}<button type="button" className="ref-text-button" onClick={() => { setFileSelectionError(''); referencePicker.retry() }}><UiText zh="重试" /></button></div>}
    <ComposerWebLinksPlugin />
    {inputHistory && ready && <ComposerInputHistoryPlugin key={draftIdentity} getHistory={inputHistory}
      syncRef={syncRef} navigationRef={historyNavigationRef} />}
    <ContentEditable id={id} ref={setEditorElement} data-thread-id={referenceScope?.threadId}
      className="structured-mention-editor" aria-label={ariaLabel}
      aria-expanded={menuOpen} aria-controls={skillOpen ? skillMenuId : mentionMenuId}
      aria-disabled={disabled || !ready} spellCheck={false}
      placeholder={<span className="structured-mention-placeholder">{placeholder}</span>}
      aria-placeholder={placeholder} />
    <ComposerTypeaheadPlugin match={triggerMatch} memberOnly={purpose === 'mission'}
      menuAnchor={purpose === 'mission' ? 'caret' : 'editor'}
      selectionScope={`${inviteLayer ? 'inviting' : 'camp'}:${referencePicker.filter}`}
      onCycleCategory={referenceScope ? direction => {
        const categories = ['members', ...(filesSupported ? ['file' as const] : []), 'thread', 'mission'] as const
        const index = categories.findIndex(value => value === pickerRef.current.filter)
        changeInviteLayer(false)
        pickerRef.current.selectFilter(categories[(index + direction + categories.length) % categories.length])
      } : undefined}
      optionKeys={mentionOpen ? mentionMenuOptions.map(pickerOptionKey) : skillMenuOptions.map(item => item.id)}
      optionCount={mentionOpen ? mentionMenuOptions.length : skillMenuOptions.length}
      getOptionState={(match) => match.kind === 'member'
        ? {
            catalogStatus: callbacks.current.referenceScope && (pickerRef.current.query !== match.query || !pickerRef.current.options.length && (pickerRef.current.loading || pickerRef.current.status === 'error' || pickerRef.current.files.partial || Boolean(pickerRef.current.files.error) || pickerRef.current.sourceErrors.length > 0)) ? 'loading' : 'ready',
            optionCount: getMentionOptions(match.query).length
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
          const option = getMentionOptions(match.query)[index]
          if (!option) return false
          if (option.kind === 'file') {
            const scope = callbacks.current.referenceScope
            if (!scope || !callbacks.current.filesSupported) return false
            const ticket = ++insertionTicket.current
            fileInsertionPending.current = true
            setFileSelectionError('')
            const key = pickerRef.current.key
            void scope.client.request<import('@contracts').ProjectFilesResult<Extract<import('@contracts').OpenFilePreviewRequest, { kind: 'project_file' }>>>('projectFiles.request', { threadId: scope.threadId, action: 'open', scopeId: option.scopeId, entryId: option.item.id })
              .then(result => { if (!result.ok) throw new Error(result.error.code); return createProjectFileReference(scope.client, scope.threadId, result.value) })
              .then(atom => {
                if (ticket !== insertionTicket.current || callbacks.current.referenceScope?.threadId !== scope.threadId || pickerRef.current.key !== key || editor.isComposing() || !editor.isEditable()) return
                editor.update(() => {
                  const fresh = $findComposerTriggerMatch(editor)
                  if (fresh?.nodeKey === match.nodeKey && fresh.fromOffset === match.fromOffset && fresh.toOffset === match.toOffset && fresh.query === match.query) $replaceComposerTriggerWithAtom(match, atom)
                }, { discrete: true, tag: HISTORY_PUSH_TAG })
              }).catch(() => { if (ticket === insertionTicket.current && pickerRef.current.key === key) setFileSelectionError(uiAttribute('暂时无法引用此文件，请重试')) }).finally(() => { if (ticket === insertionTicket.current) fileInsertionPending.current = false })
            return false
          }
          if (option.kind === 'reference') return $replaceComposerTriggerWithAtom(match, referenceAtom(option.item))
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
        ? referenceScope ? <ThreadReferenceMenu menuId={mentionMenuId} picker={referencePicker} inviteLayer={inviteLayer}
            pendingInviteIds={pendingInviteIds} selectedIndex={selectedIndex} setHighlightedIndex={setHighlightedIndex} selectIndex={selectIndex}
            onFilter={filter => { changeInviteLayer(false); referencePicker.selectFilter(filter) }}
            renderAvatar={option => <StructuredMentionOptionAvatar option={option} />} /> : renderMentionMenu(
            mentionMenuId,
            mentionOptions,
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
    <div className="mention-menu-candidates">
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
            option.kind === 'member' && option.member.runtimeLabel ? 'has-runtime' : '',
            option.kind === 'member' && option.member.inThread === false ? 'is-invitable' : '',
            option.kind === 'invite_other' || option.kind === 'back_to_camp' ? 'is-mention-action' : ''
          ].filter(Boolean).join(' ')}
          onMouseMove={() => setHighlightedIndex(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => selectIndex(index)}>
          <StructuredMentionOptionAvatar option={option} />
          <span>
            <strong>{option.kind === 'all_members' ? uiAttribute('所有队员')
              : option.kind === 'invite_other' ? uiAttribute('邀请其他队员')
                : option.kind === 'back_to_camp' ? mission ? uiAttribute('返回本使命') : uiAttribute('返回本会话')
                  : option.member.displayName}</strong>
            <small>{option.kind === 'all_members'
              ? uiAttribute('广播给当前全部队员')
              : option.kind === 'invite_other' ? uiAttribute('浏览其他可用队员')
                : option.kind === 'back_to_camp' ? mission ? uiAttribute('查看当前使命队员') : uiAttribute('查看当前会话队员')
                  : structuredMentionMemberDescription(option.member)}</small>
          </span>
          {option.kind === 'member' && option.member.inThread === false && <span className="mention-option-state">{pendingInviteIds.includes(option.member.agentId)
            ? <UiText zh={'待邀请'} /> : <UiText zh={'邀请'} />}</span>}
          {option.kind === 'invite_other'
              ? <svg className="mention-action-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2.5 3.5 3.5L4 9.5" /></svg>
              : null}
        </button>)}
    </div>
    {hasRuntime && <div className="mention-runtime-column" aria-label={uiAttribute('智能体')}>
      {options.map((option, index) => option.kind === 'member' && option.member.runtimeLabel
        ? <MentionRuntimeButton key={option.member.agentId} kind={option.member.runtimeKind}
            label={option.member.runtimeLabel} model={option.member.modelLabel} memberName={option.member.displayName}
            onHighlight={() => setHighlightedIndex(index)} onSelect={() => selectIndex(index)} />
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
  const skillSource = (option: ComposerSkillOption): string => uiAttribute(option.source === 'toolbox' ? '工具箱' : option.sourceScope === 'project' ? '项目 Skill' : '用户 Skill')
  const sourceCounts = new Map<string, number>()
  options.forEach((s) => sourceCounts.set(s.name, (sourceCounts.get(s.name) ?? 0) + 1))
  const groups = [
    { label: uiAttribute('工具箱'), entries: options.map((option, index) => ({ option, index })).filter(({ option }) => option.source === 'toolbox') },
    { label: 'Skills', entries: options.map((option, index) => ({ option, index })).filter(({ option }) => option.source !== 'toolbox') }
  ].filter(group => group.entries.length)
  return <div className="mention-menu structured-skill-menu simple-skill-menu">
    <div id={menuId} role="listbox" aria-label={uiAttribute("选择 Skill")}>
      {status === 'loading' ? <p className="structured-mention-empty" role="status">{uiAttribute("正在读取可用 Skills…")}</p>
        : status === 'error' ? <p className="structured-mention-empty">{uiAttribute("Skills 暂时无法读取")}</p>
        : !options.length ? <p className="structured-mention-empty">{uiAttribute("没有匹配的 Skill")}</p>
        : groups.map(group => <div key={group.label} className="simple-skill-group" role="group" aria-label={group.label}>
          <div className="simple-skill-group-label" aria-hidden="true">{group.label}</div>
          {group.entries.map(({ option, index }) => {
          const associated = members.filter((m) => option.memberIds?.includes(m.agentId))
          return <button type="button" role="option" tabIndex={-1} key={option.id} id={`${menuId}-option-${index}`}
            className={`simple-skill-option${selectedIndex === index ? ' active' : ''}`} aria-selected={selectedIndex === index}
            data-skill-id={option.id} data-skill-name={option.name}
            aria-label={`/${option.name}${uiAttribute('，')}${skillSource(option)}${associated.length ? uiAttribute('，关联队员：{0}', associated.map(m => m.displayName).join(uiAttribute('、'))) : ''}`}
            title={`/${option.name} · ${skillSource(option)}\n${option.description}\n${option.entryPath ?? ''}`}
            onMouseMove={() => setHighlightedIndex(index)} onMouseDown={e => e.preventDefault()} onClick={() => selectIndex(index)}>
            <NavigationIcon name="sparkles" />
            <span className="simple-skill-copy"><strong>{option.name}</strong>
              {sourceCounts.get(option.name)! > 1 && <em>{skillSource(option)}</em>}
              <small>{option.description}</small></span>
            <span className="simple-skill-members" title={associated.map((m) => m.displayName).join('、')}>
              {associated.slice(0, 2).map((m) => <MemberAvatar key={m.agentId} agentId={m.agentId} avatarRef={m.avatarRef ?? null} displayName={m.displayName} size="mention" decorative />)}
              {associated.length > 2 && <span>+{associated.length - 2}</span>}
            </span>
          </button>
        })}</div>)}
    </div>
    {(refreshFailed || errors.length > 0 || status === 'error') && <div className="simple-skill-error" role={refreshFailed || status === 'error' ? 'alert' : 'status'}>
      <span>{uiAttribute(refreshFailed ? '刷新失败，保留上次结果' : status === 'error' ? '请重试' : '来源诊断')}</span>
      {errors.length > 0 && <details><summary>{uiAttribute('查看详情')}</summary><ul>{errors.map((error, index) => <li key={index} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{error}</li>)}</ul></details>}
      {onRefresh && <button type="button" disabled={refreshing} onMouseDown={e => e.preventDefault()} onClick={onRefresh}>{uiAttribute(refreshing ? '刷新中…' : '重试')}</button>}
    </div>}
  </div>
}

function atomPresentation(
  node: ComposerAtomNode,
  input: Pick<StructuredMentionComposerProps,
    'purpose' | 'members' | 'skills' | 'skillCatalogStatus' | 'onActivateMemberMention'
    | 'onActivateAllMembersMention' | 'onActivateSkillMention'> & { referenceScope?: ReferenceScope; fileAtoms?: readonly Extract<ComposerAtom, { type: 'project_file_reference' }>[]; fileAvailability?: ReadonlyMap<string, FileAvailability>; filesSupported?: boolean; referenceAvailability?: ReturnType<typeof useReferenceAvailability>; onActivateReference?(node: ComposerAtomNode, trigger: HTMLElement): void }
): ComposerAtomPresentation {
  const atom = node.getAtom()
  if (isProjectFileAtom(atom)) {
    const status = input.fileAvailability?.get(fileReferenceKey(atom))
    const resolvedLabel = (file: Extract<ComposerAtom, { type: 'project_file_reference' }>) => {
      const resolved = input.fileAvailability?.get(fileReferenceKey(file))
      return resolved?.status === 'available' ? { ...file, labelFallback: resolved.reference.labelFallback } : file
    }
    const presentation = fileReferencePresentation(resolvedLabel(atom), (input.fileAtoms ?? [atom]).map(resolvedLabel))
    const unavailable = !input.filesSupported || atom.threadId !== input.referenceScope?.threadId || status?.status === 'unavailable' || status?.status === 'needs_reselect'
    const ariaLabel = unavailable ? uiAttribute('{0}，需要重新选择', presentation.ariaLabel) : status?.status === 'network_error' ? uiAttribute('{0}，连接失败，可重试', presentation.ariaLabel) : presentation.ariaLabel
    return { label: presentation.label, fullPath: presentation.path, ariaLabel, availability: unavailable ? 'unavailable' : 'available', interactive: true }
  }
  if (isReferenceAtom(atom)) {
    const id = referenceIdentity(atom).id
    const item = input.referenceAvailability?.get(id)
    const unavailable = item === null
    const label = item?.title ?? atom.labelFallback ?? id
    const ariaLabel = uiAttribute(atom.type === 'mission_reference' ? '使命引用：{0}' : '会话引用：{0}', label)
    return { label, availability: unavailable ? 'unavailable' : 'available', interactive: !!input.onActivateReference, ariaLabel: unavailable ? uiAttribute('{0}，引用不可用', ariaLabel) : ariaLabel }
  }
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
    | 'onActivateAllMembersMention' | 'onActivateSkillMention'> & { onActivateReference?(node: ComposerAtomNode, trigger: HTMLElement): void }
): void {
  const atom = node.getAtom()
  if (isReferenceAtom(atom) || isProjectFileAtom(atom)) { input.onActivateReference?.(node, trigger); return }
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
