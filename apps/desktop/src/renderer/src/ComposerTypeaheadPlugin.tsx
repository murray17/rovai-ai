import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import * as Popover from '@radix-ui/react-popover'
import {
  COMMAND_PRIORITY_CRITICAL,
  HISTORY_PUSH_TAG,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND
} from 'lexical'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { $findComposerTriggerMatch, type ComposerTriggerMatch } from './composer-trigger'

interface ComposerTypeaheadRenderState {
  selectedIndex: number
  setHighlightedIndex(index: number): void
  selectIndex(index: number): void
}

export interface ComposerTypeaheadPluginProps {
  match: ComposerTriggerMatch | null
  memberOnly?: boolean
  menuAnchor?: 'editor' | 'caret'
  selectionScope?: string
  optionCount: number
  getOptionState(match: ComposerTriggerMatch): ComposerTypeaheadOptionState
  onMatchChange(match: ComposerTriggerMatch | null): void
  onSelect(index: number, match: ComposerTriggerMatch): boolean
  renderMenu(state: ComposerTypeaheadRenderState): ReactNode
}

export interface ComposerTypeaheadOptionState {
  catalogStatus: 'loading' | 'ready' | 'error'
  optionCount: number
}

export type ComposerTypeaheadEnterAction = 'pass' | 'consume' | 'select'

export function composerTypeaheadEnterAction(
  state: ComposerTypeaheadOptionState
): ComposerTypeaheadEnterAction {
  if (state.catalogStatus === 'loading') return 'consume'
  if (state.catalogStatus === 'ready' && state.optionCount > 0) return 'select'
  return 'pass'
}

/** One bounded selection listener and one keyboard owner for both @ and /. */
export function ComposerTypeaheadPlugin({
  match,
  memberOnly = false,
  menuAnchor = 'editor',
  selectionScope,
  optionCount,
  getOptionState,
  onMatchChange,
  onSelect,
  renderMenu
}: ComposerTypeaheadPluginProps): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const caretAnchor = useMemo(() => ({ current: {
    get contextElement() { return editor.getRootElement() ?? undefined },
    getBoundingClientRect() {
      const root = editor.getRootElement()
      const selection = root?.ownerDocument.getSelection()
      if (root && selection?.rangeCount && root.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0).cloneRange()
        range.collapse(false)
        const bounds = range.getBoundingClientRect()
        if (bounds.height) return bounds
      }
      return root?.getBoundingClientRect() ?? new DOMRect()
    }
  } }), [editor])
  const selectedIndexRef = useRef(selectedIndex)
  const memberOnlyRef = useRef(memberOnly)
  memberOnlyRef.current = memberOnly
  const findMatch = useCallback(() => {
    const found = $findComposerTriggerMatch(editor)
    return memberOnlyRef.current && found?.kind !== 'member' ? null : found
  }, [editor])
  const current = useRef({ match, optionCount, getOptionState, onMatchChange, onSelect })
  current.current = { match, optionCount, getOptionState, onMatchChange, onSelect }
  selectedIndexRef.current = selectedIndex

  const close = useCallback(() => current.current.onMatchChange(null), [])
  const selectIndex = useCallback((index: number) => {
    const state = current.current
    if (editor.isComposing()) return
    editor.update(() => {
      const freshMatch = findMatch()
      if (!freshMatch) return
      const optionState = state.getOptionState(freshMatch)
      if (composerTypeaheadEnterAction(optionState) !== 'select') return
      const boundedIndex = Math.max(0, Math.min(index, optionState.optionCount - 1))
      if (state.onSelect(boundedIndex, freshMatch)) close()
    }, { tag: HISTORY_PUSH_TAG })
  }, [close, editor, findMatch])

  useEffect(() => editor.registerRootListener((root) => {
    // Stay inside the modal's focus/scroll boundary, outside its clipped writing plane.
    setPortalHost((menuAnchor === 'caret' ? root?.closest<HTMLElement>('[role="dialog"]') : null)
      ?? root?.parentElement ?? null)
  }), [editor, menuAnchor])

  useEffect(() => editor.registerEditableListener((editable) => {
    if (!editable) close()
  }), [close, editor, findMatch])

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    if (editor.isComposing()) return
    const next = editorState.read(findMatch)
    const previous = current.current.match
    if (composerTriggerMatchesEqual(previous, next)) return
    current.current.onMatchChange(next)
  }), [editor, findMatch])

  useEffect(() => {
    const unregister = [
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (event) => {
        const state = current.current
        if (!state.match || editor.isComposing()) return false
        event?.preventDefault()
        if (state.optionCount > 0) {
          setSelectedIndex((index) => (index + 1) % state.optionCount)
        }
        return true
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, (event) => {
        const state = current.current
        if (!state.match || editor.isComposing()) return false
        event?.preventDefault()
        if (state.optionCount > 0) {
          setSelectedIndex((index) => (index - 1 + state.optionCount) % state.optionCount)
        }
        return true
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
        const state = current.current
        if (editor.isComposing() || event?.isComposing || event?.shiftKey) return false
        const freshMatch = findMatch()
        if (!freshMatch) return false
        const optionState = state.getOptionState(freshMatch)
        const action = composerTypeaheadEnterAction(optionState)
        if (action === 'pass') return false
        event?.preventDefault()
        if (action === 'select') {
          const index = Math.max(
            0,
            Math.min(selectedIndexRef.current, optionState.optionCount - 1)
          )
          if (state.onSelect(index, freshMatch)) close()
        }
        return true
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_TAB_COMMAND, (event) => {
        if (editor.isComposing()) return false
        const state = current.current
        const freshMatch = findMatch()
        if (!freshMatch) return false
        const optionState = state.getOptionState(freshMatch)
        const action = composerTypeaheadEnterAction(optionState)
        if (action === 'pass') return false
        event?.preventDefault()
        if (action === 'select') {
          const index = Math.max(
            0,
            Math.min(selectedIndexRef.current, optionState.optionCount - 1)
          )
          if (state.onSelect(index, freshMatch)) close()
        }
        return true
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_ESCAPE_COMMAND, (event) => {
        if (!current.current.match) return false
        event?.preventDefault()
        close()
        return true
      }, COMMAND_PRIORITY_CRITICAL)
    ]
    return () => unregister.forEach((cleanup) => cleanup())
  }, [close, editor, findMatch])

  useEffect(() => {
    setSelectedIndex((index) => optionCount === 0 ? 0 : Math.min(index, optionCount - 1))
  }, [optionCount])

  useEffect(() => { setSelectedIndex(0) }, [match?.kind, match?.nodeKey, match?.fromOffset, selectionScope])

  useLayoutEffect(() => {
    const root = editor.getRootElement()
    if (!root) return
    const menuId = root.getAttribute('aria-controls')
    const menu = match && menuId ? root.ownerDocument.getElementById(menuId) : null
    const selected = menu?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    if (menu && selected?.id) {
      root.setAttribute('aria-activedescendant', selected.id)
      // Only scroll the list; scrollIntoView also moves clipped dialog/editor ancestors.
      const bounds = selected.getBoundingClientRect()
      const top = menu.getBoundingClientRect().top + menu.clientTop
      if (bounds.top < top) menu.scrollTop += bounds.top - top
      else if (bounds.bottom > top + menu.clientHeight) menu.scrollTop += bounds.bottom - top - menu.clientHeight
    } else {
      root.removeAttribute('aria-activedescendant')
    }
    return () => root.removeAttribute('aria-activedescendant')
  }, [editor, match, optionCount, portalHost, selectedIndex])

  if (!match || !portalHost) return null
  const menu = renderMenu({ selectedIndex, setHighlightedIndex: setSelectedIndex, selectIndex })
  return createPortal(menuAnchor === 'caret'
    ? <Popover.Root open onOpenChange={(open) => { if (!open) close() }}>
        <Popover.Anchor virtualRef={caretAnchor} />
        <Popover.Content asChild className="composer-caret-menu" side="bottom" align="start"
          sideOffset={7} collisionPadding={12} updatePositionStrategy="always" hideWhenDetached
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (editor.getRootElement()?.contains(event.target as Node)) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => { event.preventDefault(); close() }}>
          {menu}
        </Popover.Content>
      </Popover.Root>
    : menu, portalHost)
}

function composerTriggerMatchesEqual(
  left: ComposerTriggerMatch | null,
  right: ComposerTriggerMatch | null
): boolean {
  return left === right || Boolean(
    left
      && right
      && left.kind === right.kind
      && left.query === right.query
      && left.nodeKey === right.nodeKey
      && left.fromOffset === right.fromOffset
      && left.toOffset === right.toOffset
  )
}
