import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { PanelToggleIcon } from './PanelToggleIcon'
import { useMobileLayout } from './MobileLayout'
import type { DesktopNavigation, NavigationState } from './desktop-navigation'
import { navigationShortcut } from './desktop-navigation-input'
import { primaryShortcutLabel } from './renderer-platform'
import { clampNavigationWidth, navigationDragLayout, navigationMaxWidth, parseNavigationLayout, NAVIGATION_DEFAULT_WIDTH, NAVIGATION_LAYOUT_KEY, NAVIGATION_MIN_WIDTH, type NavigationLayout } from './navigation-layout'
import { UiText, uiAttribute } from './interface-language'

const NavigationContext = createContext(false)
export const useNavigationCollapsed = (): boolean => useContext(NavigationContext)
const EMPTY_HISTORY: NavigationState = { entries: [], index: -1 }
const emptySnapshot = (): NavigationState => EMPTY_HISTORY
const noSubscription = (): (() => void) => () => undefined

// Layout state stays below App so resizing does not rebuild the Thread or Composer children.
export function NavigationShell({ platform, disabled = false, settings = false, navigation, nativeWindowControls, browser = false, className = '', children, ...attributes }: HTMLAttributes<HTMLDivElement> & {
  platform: NodeJS.Platform
  disabled?: boolean
  settings?: boolean
  browser?: boolean
  nativeWindowControls?: Pick<import('@contracts').RovaiApi['windowControls'], 'onNavigationRequested'>
  navigation?: Pick<DesktopNavigation, 'getSnapshot' | 'subscribe' | 'back' | 'forward'>
}): React.JSX.Element {
  const mobile = useMobileLayout()
  const history = useSyncExternalStore(navigation?.subscribe ?? noSubscription, navigation?.getSnapshot ?? emptySnapshot, emptySnapshot)
  const input = useRef({ navigation, disabled, platform })
  input.current = { navigation, disabled, platform }
  useEffect(() => {
    if (!navigation) return
    const available = (): boolean => !input.current.disabled
      && Boolean(input.current.navigation?.getSnapshot().entries.length)
      && !document.querySelector('.app-dialog, [role="dialog"][aria-modal="true"], [role="menu"][data-state="open"]')
    const keydown = (event: KeyboardEvent): void => {
      if (!available()) return
      const action = navigationShortcut(input.current.platform, event)
      if (!action) return
      event.preventDefault()
      void input.current.navigation?.[action]()
    }
    const mouseup = (event: MouseEvent): void => {
      if (browser || (event.button !== 3 && event.button !== 4)) return
      // Windows uses WM_APPCOMMAND exclusively; handling its mouseup too would step twice.
      if (input.current.platform === 'win32' && nativeWindowControls?.onNavigationRequested) return
      if (event.defaultPrevented || !available()) return
      event.preventDefault()
      void input.current.navigation?.[event.button === 3 ? 'back' : 'forward']()
    }
    const preventDefaultNavigation = (event: MouseEvent): void => {
      if (!browser && (event.button === 3 || event.button === 4)) event.preventDefault()
    }
    const unsubscribe = nativeWindowControls?.onNavigationRequested?.((direction) => {
      if (available()) void input.current.navigation?.[direction]()
    })
    window.addEventListener('keydown', keydown)
    window.addEventListener('mouseup', mouseup)
    window.addEventListener('auxclick', preventDefaultNavigation)
    return () => {
      unsubscribe?.()
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('mouseup', mouseup)
      window.removeEventListener('auxclick', preventDefaultNavigation)
    }
  }, [navigation, nativeWindowControls, browser])
  const [layout, setLayout] = useState<NavigationLayout>(() => {
    try { return parseNavigationLayout(window.localStorage.getItem(NAVIGATION_LAYOUT_KEY)) }
    catch { return parseNavigationLayout(null) }
  })
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null)
  const handle = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ id: number; x: number; width: number; before: NavigationLayout; moved: boolean } | null>(null)
  const frame = useRef<number | null>(null)
  const maximum = navigationMaxWidth(viewport)
  const fixedSettings = mobile || settings && (browser || platform === 'darwin')
  // Web settings always expose their categories; ordinary-page layout stays saved.
  const collapsed = layout.collapsed && !mobile && !(browser && settings)
  const width = collapsed ? 0 : fixedSettings ? NAVIGATION_DEFAULT_WIDTH : clampNavigationWidth(layout.width, maximum)
  const label = collapsed ? uiAttribute('展开导航侧栏') : uiAttribute('收起导航侧栏')
  const toggle = (): void => setLayout(current => fixedSettings && !current.collapsed ? current : { ...current, collapsed: !current.collapsed })
  const resizeTo = (value: number): void => setLayout({ width: clampNavigationWidth(value, maximum), collapsed: false })
  const cancelFrame = (): void => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null }
  const finish = (cancel = false): void => {
    const active = gesture.current
    if (!active) return
    cancelFrame(); gesture.current = null
    if (cancel) setLayout(active.before)
    setResizing(false)
    if (handle.current?.hasPointerCapture(active.id)) handle.current.releasePointerCapture(active.id)
  }
  const resizeAt = (clientX: number): void => {
    const active = gesture.current
    if (active) setLayout(navigationDragLayout(active.width + clientX - active.x, active.before, navigationMaxWidth(window.innerWidth)))
  }
  useLayoutEffect(() => {
    setChromeSlot(platform === 'win32' ? document.getElementById('navigation-chrome-toggle-slot') : null)
  }, [platform])
  useEffect(() => {
    const resize = (): void => { finish(true); setViewport(window.innerWidth) }
    const cancel = (): void => finish(true)
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel() } }
    window.addEventListener('resize', resize); window.addEventListener('blur', cancel); window.addEventListener('keydown', escape)
    return () => { cancelFrame(); window.removeEventListener('resize', resize); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape) }
  }, [])
  useEffect(() => {
    if (resizing) return
    try { window.localStorage.setItem(NAVIGATION_LAYOUT_KEY, JSON.stringify(layout)) } catch { /* Preferences may be unavailable; in-window layout still works. */ }
  }, [layout, resizing])
  useEffect(() => { if (disabled || fixedSettings) { finish(true); setMenuOpen(false) } }, [disabled, fixedSettings])
  const control = fixedSettings && !collapsed ? null : <div className="navigation-chrome-controls"><button className="navigation-collapse-button" type="button" disabled={disabled} title={label} aria-label={label} aria-expanded={!layout.collapsed} aria-controls="global-navigation" onClick={toggle}>
    <PanelToggleIcon side="left" visible={!layout.collapsed} />
  </button>
    {!collapsed && !fixedSettings && navigation && <div className="navigation-history-controls" role="group" aria-label={uiAttribute("浏览历史")}>
      {(['back', 'forward'] as const).map((direction) => {
        const text = direction === 'back' ? uiAttribute('后退') : uiAttribute('前进')
        const key = direction === 'back' ? '[' : ']'
        const enabled = direction === 'back' ? history.index > 0 : history.index < history.entries.length - 1
        return <button key={direction} className="navigation-collapse-button navigation-history-button" type="button"
          disabled={disabled || !enabled} aria-label={text} title={`${text}（${primaryShortcutLabel(platform, key)}）`}
          aria-keyshortcuts={`${platform === 'darwin' ? 'Meta' : 'Control'}+${key}`} onClick={() => { void navigation[direction]() }}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d={direction === 'back' ? 'M10 17l-5-5 5-5M19 12H5' : 'M14 7l5 5-5 5M5 12h14'} /></svg>
        </button>
      })}
    </div>}
  </div>
  const shellStyle = useMemo(() => ({ ...attributes.style, '--rail-width': `${width}px` }) as CSSProperties, [attributes.style, width])
  return <NavigationContext.Provider value={collapsed}>
    <div {...attributes} className={`app-shell navigation-shell ${className}${collapsed ? ' navigation-collapsed' : ''}${resizing ? ' navigation-resizing' : ''}`} style={shellStyle}>
      {children}
      {!fixedSettings && <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <div ref={handle} className="navigation-resize-handle" role="separator" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
            aria-label={uiAttribute("导航侧栏宽度")} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={width}
            aria-valuetext={layout.collapsed ? uiAttribute("已完全收起") : uiAttribute("{0} 像素", String(width))} aria-controls="global-navigation" aria-describedby="navigation-resize-help"
            title={uiAttribute("拖动调宽，低于 200px 完全收起；双击复位；右键选择宽度")}
            onPointerDown={event => {
              event.preventDefault()
              if (disabled || event.button !== 0 || !event.isPrimary || gesture.current) return
              event.currentTarget.setPointerCapture(event.pointerId)
              gesture.current = { id: event.pointerId, x: event.clientX, width, before: layout, moved: false }
              setResizing(true)
            }}
            onPointerMove={event => {
              const active = gesture.current
              if (!active || active.id !== event.pointerId || (!active.moved && Math.abs(event.clientX - active.x) < 3)) return
              active.moved = true
              const x = event.clientX
              cancelFrame(); frame.current = requestAnimationFrame(() => { frame.current = null; resizeAt(x) })
            }}
            onPointerUp={event => {
              const active = gesture.current
              if (!active || active.id !== event.pointerId) return
              if (active.moved || Math.abs(event.clientX - active.x) >= 3) resizeAt(event.clientX)
              finish()
            }}
            onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)}
            onDoubleClick={() => { if (!disabled) resizeTo(NAVIGATION_DEFAULT_WIDTH) }}
            onContextMenu={event => { event.preventDefault(); if (!disabled) setMenuOpen(true) }}
            onKeyDown={event => {
              if (disabled || event.nativeEvent.isComposing || gesture.current) { event.preventDefault(); return }
              const step = event.shiftKey ? 40 : 10
              switch (event.key) {
                case 'ArrowLeft': if (!layout.collapsed) setLayout(navigationDragLayout(width - step, layout, maximum)); break
                case 'ArrowRight': resizeTo(layout.collapsed ? layout.width : width + step); break
                case 'Home': resizeTo(NAVIGATION_MIN_WIDTH); break
                case 'End': resizeTo(maximum); break
                case 'Enter': toggle(); break
                default: return
              }
              event.preventDefault()
            }} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="sidebar-action-menu" side="right" sideOffset={4} collisionPadding={8}>
          {[[200, '紧凑宽度'], [270, '默认宽度'], [360, '宽侧栏']].map(([value, text]) => <DropdownMenu.Item key={value} className="sidebar-action-menu-item" onSelect={() => resizeTo(Number(value))}>{uiAttribute(String(text))}</DropdownMenu.Item>)}
          <DropdownMenu.Separator className="sidebar-action-menu-separator" />
          <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={toggle}>{label}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      {!fixedSettings && <span id="navigation-resize-help" className="sr-only"><UiText zh={"方向键调宽，Shift 加速，Home 最窄，End 最宽，Enter 折叠，空格选择宽度。低于 200 像素完全收起；从左边缘拖出恢复。Escape 取消拖拽。"} /></span>}
      {/* Electron applies drag regions in DOM order; keep this no-drag control after the sidebar and topbar drag regions. */}
      {!browser && platform === 'win32' ? chromeSlot && createPortal(control, chromeSlot) : <div className={browser ? "navigation-browser-control" : "navigation-macos-control"}>{control}</div>}
    </div>
  </NavigationContext.Provider>
}
