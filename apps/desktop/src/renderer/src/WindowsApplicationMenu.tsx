import { useRef, useState } from 'react'
import type {
  WindowsApplicationMenuPopupRequest,
  WindowsApplicationMenuSection
} from '@contracts'

const WINDOWS_APPLICATION_MENU_ITEMS: ReadonlyArray<{
  section: WindowsApplicationMenuSection
  label: string
  accessKey: string
}> = [
  { section: 'file', label: 'File', accessKey: 'f' },
  { section: 'edit', label: 'Edit', accessKey: 'e' },
  { section: 'view', label: 'View', accessKey: 'v' },
  { section: 'window', label: 'Window', accessKey: 'w' }
]

export function windowsApplicationMenuFocusIndex(
  currentIndex: number,
  key: string,
  itemCount = WINDOWS_APPLICATION_MENU_ITEMS.length
): number | null {
  if (itemCount <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return itemCount - 1
  if (key === 'ArrowRight') return (currentIndex + 1) % itemCount
  if (key === 'ArrowLeft') return (currentIndex - 1 + itemCount) % itemCount
  return null
}

function popupRequest(
  section: WindowsApplicationMenuSection,
  button: HTMLButtonElement,
  sourceType: WindowsApplicationMenuPopupRequest['sourceType']
): WindowsApplicationMenuPopupRequest {
  const bounds = button.getBoundingClientRect()
  return {
    section,
    x: bounds.left,
    y: bounds.bottom,
    sourceType
  }
}

export function WindowsApplicationMenu(): React.JSX.Element {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const [activeIndex, setActiveIndex] = useState(0)

  const openMenu = (
    section: WindowsApplicationMenuSection,
    button: HTMLButtonElement,
    sourceType: WindowsApplicationMenuPopupRequest['sourceType']
  ): void => {
    void window.rovai.windowControls
      .popupApplicationMenu(popupRequest(section, button, sourceType))
      .catch(() => undefined)
  }

  return (
    <div className="windows-application-menu" role="menubar" aria-label="应用菜单">
      {WINDOWS_APPLICATION_MENU_ITEMS.map((item, index) => (
        <button
          className="windows-application-menu-item"
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          accessKey={item.accessKey}
          key={item.section}
          ref={(element) => { buttons.current[index] = element }}
          tabIndex={index === activeIndex ? 0 : -1}
          onFocus={() => setActiveIndex(index)}
          onClick={(event) => openMenu(
            item.section,
            event.currentTarget,
            event.detail === 0 ? 'keyboard' : 'mouse'
          )}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              openMenu(item.section, event.currentTarget, 'keyboard')
              return
            }
            const nextIndex = windowsApplicationMenuFocusIndex(index, event.key)
            if (nextIndex === null) return
            event.preventDefault()
            setActiveIndex(nextIndex)
            buttons.current[nextIndex]?.focus()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
