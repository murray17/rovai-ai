import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  COMMAND_PRIORITY_LOW,
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
  onMatchChange(match: ComposerTriggerMatch | null): void
  onSelect(index: number, match: ComposerTriggerMatch): void
  renderMenu(state: ComposerTypeaheadRenderState): ReactNode
}

/** One bounded selection listener and one keyboard owner for both @ and /. */
export function ComposerTypeaheadPlugin({
  match,
  optionCount,
  onMatchChange,
  onSelect,
  renderMenu
}: ComposerTypeaheadPluginProps): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const current = useRef({ match, optionCount, onMatchChange, onSelect })
  current.current = { match, optionCount, onMatchChange, onSelect }

  const close = useCallback(() => current.current.onMatchChange(null), [])
  const selectIndex = useCallback((index: number) => {
    const state = current.current
    if (editor.isComposing() || !state.match || state.optionCount === 0) return
    const boundedIndex = Math.max(0, Math.min(index, state.optionCount - 1))
    state.onSelect(boundedIndex, state.match)
  }, [editor])

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
      }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, (event) => {
        const state = current.current
        if (!state.match || editor.isComposing()) return false
        event?.preventDefault()
        if (state.optionCount > 0) {
          setSelectedIndex((index) => (index - 1 + state.optionCount) % state.optionCount)
        }
        return true
      }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
        const state = current.current
        if (!state.match || state.optionCount === 0 || editor.isComposing() || event?.isComposing) {
          return false
        }
        event?.preventDefault()
        selectIndex(selectedIndex)
        return true
      }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_TAB_COMMAND, (event) => {
        const state = current.current
        if (!state.match || state.optionCount === 0 || editor.isComposing()) return false
        event?.preventDefault()
        selectIndex(selectedIndex)
        return true
      }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_ESCAPE_COMMAND, (event) => {
        if (!current.current.match) return false
        event?.preventDefault()
        close()
        return true
      }, COMMAND_PRIORITY_LOW)
    ]
    return () => unregister.forEach((cleanup) => cleanup())
  }, [close, editor, selectIndex, selectedIndex])

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
