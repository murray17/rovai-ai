import { useRef, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getNodeByKey, $getSelection, $isRangeSelection, $setSelection, type BaseSelection } from 'lexical'
import type { AdapterKind } from '@contracts'
import { RuntimeGlyph } from './MemberRuntimePicker'
import { UiText, uiAttribute } from './interface-language'

export function MentionRuntimeButton({ kind, label, model, memberName, onHighlight, onSelect }: {
  kind?: AdapterKind
  label: string
  model?: string
  memberName: string
  onHighlight(): void
  onSelect(): void
}): React.JSX.Element {
  const [editor] = useLexicalComposerContext()
  const [open, setOpen] = useState(false)
  const selection = useRef<BaseSelection | null>(null)
  const restoreFocus = useRef(true)
  const restore = () => {
    editor.update(() => {
      const next = selection.current?.clone()
      if (!$isRangeSelection(next) || next.anchor.type !== 'text' || next.focus.type !== 'text') return
      const anchor = $getNodeByKey(next.anchor.key), focus = $getNodeByKey(next.focus.key)
      if (!anchor || !focus) return
      next.anchor.set(next.anchor.key, Math.min(next.anchor.offset, anchor.getTextContentSize()), 'text')
      next.focus.set(next.focus.key, Math.min(next.focus.offset, focus.getTextContentSize()), 'text')
      $setSelection(next)
    }, { discrete: true })
    editor.focus()
  }
  return <Popover.Root open={open} onOpenChange={next => {
    if (next) {
      selection.current = editor.getEditorState().read(() => $getSelection()?.clone() ?? null)
      restoreFocus.current = true
    }
    setOpen(next)
  }}>
    <Popover.Trigger asChild><button type="button" className="mention-runtime-trigger"
      aria-label={uiAttribute('查看 {0} 的智能体与模型', memberName)} title={[label, model].filter(Boolean).join(' · ')}
      onMouseMove={onHighlight} onFocus={onHighlight} onMouseDown={event => event.preventDefault()}>
      <RuntimeGlyph kind={kind ?? null} />
    </button></Popover.Trigger>
    <Popover.Portal container={editor.getRootElement()?.closest<HTMLElement>('[role="dialog"]') ?? undefined}>
      <Popover.Content className="mention-runtime-popover" side="top" align="end" sideOffset={6} collisionPadding={12}
        aria-label={uiAttribute('{0} 的智能体', memberName)}
        onInteractOutside={() => { restoreFocus.current = false }}
        onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus.current && editor.getRootElement()?.isConnected) restore() }}>
        <div className="mention-runtime-heading"><strong>{memberName}</strong><Popover.Close asChild>
          <button type="button" aria-label={uiAttribute('关闭')}>×</button>
        </Popover.Close></div>
        <div className="mention-runtime-product"><RuntimeGlyph kind={kind ?? null} /><strong>{label}</strong></div>
        {model && <dl><dt><UiText zh="模型" /></dt><dd>{model}</dd></dl>}
        <button type="button" className="mention-runtime-select" onClick={() => { restore(); restoreFocus.current = false; onSelect(); setOpen(false) }}>@ {memberName}</button>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
