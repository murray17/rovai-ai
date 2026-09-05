import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
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
  optionCount,
  getOptionState,
  onMatchChange,
  onSelect,
  renderMenu
}: ComposerTypeaheadPluginProps): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const selectedIndexRef = useRef(selectedIndex)
  const current = useRef({ match, optionCount, getOptionState, onMatchChange, onSelect })
  current.current = { match, optionCount, getOptionState, onMatchChange, onSelect }
  selectedIndexRef.current = selectedIndex

  const close = useCallback(() => current.current.onMatchChange(null), [])
  const selectIndex = useCallback((index: number) => {
    const state = current.current
    if (editor.isComposing()) return
    editor.update(() => {
      const freshMatch = $findComposerTriggerMatch(editor)
      if (!freshMatch) return
      const optionState = state.getOptionState(freshMatch)
      if (composerTypeaheadEnterAction(optionState) !== 'select') return
      const boundedIndex = Math.max(0, Math.min(index, optionState.optionCount - 1))
      if (state.onSelect(boundedIndex, freshMatch)) close()
    }, { tag: HISTORY_PUSH_TAG })
  }, [close, editor])

  useEffect(() => editor.registerRootListener((root) => {
    setPortalHost(root?.parentElement ?? null)
  }), [editor])

  useEffect(() => editor.registerEditableListener((editable) => {
    if (!editable) close()
  }), [close, editor])

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    if (editor.isComposing()) return
    const next = editorState.read(() => $findComposerTriggerMatch(editor))
    const previous = current.current.match
    if (composerTriggerMatchesEqual(previous, next)) return
    current.current.onMatchChange(next)
  }), [editor])

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
        const freshMatch = $findComposerTriggerMatch(editor)
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
        const freshMatch = $findComposerTriggerMatch(editor)
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
  }, [close, editor])

  useEffect(() => {
    setSelectedIndex((index) => optionCount === 0 ? 0 : Math.min(index, optionCount - 1))
  }, [optionCount])

  useEffect(() => { setSelectedIndex(0) }, [match?.kind, match?.nodeKey, match?.fromOffset])

  useEffect(() => {
    const selected = portalHost?.querySelector<HTMLElement>(
      '.structured-mention-menu [aria-selected="true"]'
    )
    selected?.scrollIntoView({ block: 'nearest' })
  }, [portalHost, selectedIndex])

  if (!match || !portalHost) return null
  return createPortal(renderMenu({ selectedIndex, setHighlightedIndex: setSelectedIndex, selectIndex }), portalHost)
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
