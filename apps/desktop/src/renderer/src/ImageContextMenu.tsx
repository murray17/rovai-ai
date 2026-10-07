import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useRef, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { uiAttribute } from './interface-language'

export type ImageMenuPosition = { x: number; y: number; origin: HTMLElement }
export type ImageAction = 'copy' | 'save' | 'path' | 'reveal'

const glyphs = {
  copy: <><rect x="6.5" y="6.5" width="8" height="8" rx="1.5" /><path d="M11.5 4.5V3.8a1.3 1.3 0 0 0-1.3-1.3H3.8a1.3 1.3 0 0 0-1.3 1.3v6.4a1.3 1.3 0 0 0 1.3 1.3h.7" /></>,
  save: <><path d="M9 2.5v8m-3-3 3 3 3-3M3 11.5v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" /></>,
  path: <><path d="m7 11 4-4M6.5 6.5 5 8a3.2 3.2 0 0 0 4.5 4.5l1.5-1.5m.5-4.5L13 5a3.2 3.2 0 0 0-4.5-4.5L7 2" transform="translate(0 2)" /></>,
  reveal: <path d="M2.5 5.5v-1a1 1 0 0 1 1-1h4l2 2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8Z" />
}

export function ImageContextMenu({ position, onClose, displayName, ready, busy,
  hasPath, revealLabel, onAction }: {
  position: ImageMenuPosition | null
  onClose: () => void
  displayName: string
  ready: boolean
  busy: ImageAction | null
  hasPath: boolean
  revealLabel?: string
  onAction: (action: ImageAction) => void
}): JSX.Element {
  const returnFocus = useRef(false)
  const origin = useRef<HTMLElement | null>(null)
  if (position) origin.current = position.origin
  const item = (icon: keyof typeof glyphs, label: string, onSelect: () => void, disabled = false) => (
    <DropdownMenu.Item className="attachment-context-menu-item" disabled={disabled} onSelect={onSelect}>
      <svg className="attachment-menu-icon" viewBox="0 0 18 18" aria-hidden="true">{glyphs[icon]}</svg>
      <span>{label}</span>
    </DropdownMenu.Item>
  )
  return <DropdownMenu.Root open={position !== null} onOpenChange={value => { if (!value) onClose() }}>
    {/* Keep pointer coordinates relative to the viewport, including inside the transformed lightbox. */}
    {position && createPortal(<DropdownMenu.Trigger asChild>
      <span className="attachment-context-anchor" style={{ left: position.x, top: position.y }} />
    </DropdownMenu.Trigger>, document.body)}
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="attachment-context-menu image-context-menu"
        aria-label={uiAttribute('图片操作：{0}', displayName)} align="start" side="right" sideOffset={4}
        collisionPadding={8} loop onEscapeKeyDown={() => { returnFocus.current = true }}
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (returnFocus.current) origin.current?.focus({ preventScroll: true })
          returnFocus.current = false
        }}>
        {item('copy', busy === 'copy' ? uiAttribute('正在复制图片…') : uiAttribute('复制图片'), () => onAction('copy'), !ready || busy !== null)}
        {item('save', uiAttribute('保存图片…'), () => onAction('save'), !ready || busy !== null)}
        {(hasPath || revealLabel) && <DropdownMenu.Separator className="attachment-context-menu-separator" />}
        {hasPath && item('path', uiAttribute('复制完整路径'), () => onAction('path'), busy !== null)}
        {revealLabel && item('reveal', revealLabel, () => onAction('reveal'), busy !== null)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
