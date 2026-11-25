import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type HTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { PanelToggleIcon } from './PanelToggleIcon'
import { useMobileLayout } from './MobileLayout'
import type { DesktopNavigation, NavigationState } from './desktop-navigation'
import { navigationShortcut } from './desktop-navigation-input'
import { useShortcutAction, useShortcutLabel, useShortcuts } from './ShortcutProvider'
import { clampNavigationWidth, navigationDragLayout, navigationMaxWidth, parseNavigationLayout, NAVIGATION_DEFAULT_WIDTH, NAVIGATION_ICON_RAIL_WIDTH, NAVIGATION_LAYOUT_KEY, NAVIGATION_MIN_WIDTH, type NavigationLayout } from './navigation-layout'
import { UiText, uiAttribute } from './interface-language'
import { splitterScale, useCollapsibleSplitter } from './useCollapsibleSplitter'
import { SplitterFeedback } from './SplitterFeedback'

const NavigationContext = createContext(false)
const NavigationActionsHost = createContext<HTMLSpanElement | null>(null)
export const useNavigationActionsHost = (): HTMLSpanElement | null => useContext(NavigationActionsHost)
export const useNavigationCollapsed = (): boolean => useContext(NavigationContext)
const EMPTY_HISTORY: NavigationState = { entries: [], index: -1 }
const emptySnapshot = (): NavigationState => EMPTY_HISTORY
const noSubscription = (): (() => void) => () => undefined

// Layout state stays below App so resizing does not rebuild the Thread or Composer children.
export function NavigationShell({ platform, disabled = false, settings = false, navigation, nativeWindowControls, browser = false, iconRail = false, className = '', children, ...attributes }: HTMLAttributes<HTMLDivElement> & {
  platform: NodeJS.Platform
  disabled?: boolean
  settings?: boolean
  browser?: boolean
  iconRail?: boolean
  nativeWindowControls?: Pick<import('@contracts').RovaiApi['windowControls'], 'onNavigationRequested'>
  navigation?: Pick<DesktopNavigation, 'getSnapshot' | 'subscribe' | 'back' | 'forward'>
}): React.JSX.Element {
  const mobile = useMobileLayout()
  const managed = Boolean(useShortcuts())
  const backLabel = useShortcutLabel('back', platform)
  const forwardLabel = useShortcutLabel('forward', platform)
  const history = useSyncExternalStore(navigation?.subscribe ?? noSubscription, navigation?.getSnapshot ?? emptySnapshot, emptySnapshot)
  const input = useRef({ navigation, disabled, platform })
  input.current = { navigation, disabled, platform }
  useEffect(() => {
    if (!navigation) return
    const available = (): boolean => !input.current.disabled
      && Boolean(input.current.navigation?.getSnapshot().entries.length)
      && !document.querySelector('.app-dialog, [role="dialog"][aria-modal="true"], [role="menu"][data-state="open"]')
    const keydown = (event: KeyboardEvent): void => {
      if (managed || !available()) return
      const action = navigationShortcut(input.current.platform, event)
      if (!action) return
      event.preventDefault()
      void input.current.navigation?.[action]()
    }
    const unsubscribe = nativeWindowControls?.onNavigationRequested?.((direction) => {
      if (available()) void input.current.navigation?.[direction]()
    })
    window.addEventListener('keydown', keydown)
    return () => {
      unsubscribe?.()
      window.removeEventListener('keydown', keydown)
    }
  }, [navigation, nativeWindowControls, managed])
  const [layout, setLayout] = useState<NavigationLayout>(() => {
    try { return parseNavigationLayout(window.localStorage.getItem(NAVIGATION_LAYOUT_KEY)) }
    catch { return parseNavigationLayout(null) }
  })
  const [viewport, setViewport] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth)
  const [resizing, setResizing] = useState(false)
  const [heldFold, setHeldFold] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null)
  const handle = useRef<HTMLDivElement>(null)
  const [actionsHost, setActionsHost] = useState<HTMLSpanElement | null>(null)
  const rail = iconRail && !mobile
  const collapsedWidth = rail ? NAVIGATION_ICON_RAIL_WIDTH : 0
  const maximum = navigationMaxWidth(viewport)
  const fixedSettings = mobile || settings && (browser || platform === 'darwin')
  // Web settings always expose their categories; ordinary-page layout stays saved.
  const collapsed = (heldFold || layout.collapsed) && !mobile && !(browser && settings)
  const width = collapsed ? collapsedWidth : fixedSettings ? NAVIGATION_DEFAULT_WIDTH : clampNavigationWidth(layout.width, maximum)
  const paintWidth = (value: number): void => {
    handle.current?.closest<HTMLElement>('.navigation-shell')?.style.setProperty('--rail-width', `${value}px`)
  }
  const previewWidth = (value: number): void => {
    paintWidth(value)
    setLayout({ width: value, collapsed: false })
  }
  const splitter = useCollapsibleSplitter({
    size: width, collapsed, minimum: NAVIGATION_MIN_WIDTH, maximum, direction: 1,
    disabled: disabled || fixedSettings,
    scale: () => splitterScale(handle.current?.closest<HTMLElement>('.navigation-shell') ?? null),
    capture: () => layout,
    onPreview: previewWidth,
    onCommit: previewWidth,
    onCollapseFrame: paintWidth,
    onFoldPreview: edge => setHeldFold(edge === 'minimum'),
    onCollapse: before => { paintWidth(collapsedWidth); setLayout({ ...before, collapsed: true }) },
    onCancel: before => { paintWidth(before.collapsed ? collapsedWidth : clampNavigationWidth(before.width, maximum)); setLayout(before) },
    onActiveChange: setResizing
  })
  const label = collapsed ? uiAttribute('展开导航侧栏') : uiAttribute('收起导航侧栏')
  const toggle = (): void => {
    splitter.cancel()
    setLayout(current => fixedSettings && !current.collapsed ? current : { ...current, collapsed: !current.collapsed })
  }
  useShortcutAction('sidebar', toggle, !disabled && !fixedSettings)
  useShortcutAction('back', () => { if (!navigation || history.index <= 0) return false; void navigation.back() }, !disabled)
  useShortcutAction('forward', () => { if (!navigation || history.index >= history.entries.length - 1) return false; void navigation.forward() }, !disabled)
  const resizeTo = (value: number): void => { splitter.cancel(); previewWidth(clampNavigationWidth(value, maximum)) }
  useLayoutEffect(() => {
    setChromeSlot(platform === 'win32' ? document.getElementById('navigation-chrome-toggle-slot') : null)
  }, [platform])
  useEffect(() => {
    const resize = (): void => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    if (resizing) return
    try { window.localStorage.setItem(NAVIGATION_LAYOUT_KEY, JSON.stringify(layout)) } catch { /* Preferences may be unavailable; in-window layout still works. */ }
  }, [layout, resizing])
  useEffect(() => { if (disabled || fixedSettings) setMenuOpen(false) }, [disabled, fixedSettings])
  const control = fixedSettings && !collapsed ? null : <div className="navigation-chrome-controls"><button className="navigation-collapse-button" type="button" disabled={disabled} title={label} aria-label={label} aria-expanded={!layout.collapsed} aria-controls="global-navigation" onClick={toggle}>
    <PanelToggleIcon side="left" visible={!layout.collapsed} />
  </button>
    {rail && <span className="navigation-chat-actions" ref={setActionsHost} />}
    {!collapsed && !fixedSettings && navigation && <div className="navigation-history-controls" role="group" aria-label={uiAttribute("浏览历史")}>
      {(['back', 'forward'] as const).map((direction) => {
        const text = direction === 'back' ? uiAttribute('后退') : uiAttribute('前进')
        const shortcutLabel = direction === 'back' ? backLabel : forwardLabel
        const enabled = direction === 'back' ? history.index > 0 : history.index < history.entries.length - 1
        return <button key={direction} className="navigation-collapse-button navigation-history-button" type="button"
          disabled={disabled || !enabled} aria-label={text} title={shortcutLabel ? `${text}（${shortcutLabel}）` : text}
          onClick={() => { void navigation[direction]() }}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d={direction === 'back' ? 'M10 17l-5-5 5-5M19 12H5' : 'M14 7l5 5-5 5M5 12h14'} /></svg>
        </button>
      })}
    </div>}
  </div>
  const shellStyle = useMemo(() => ({ ...attributes.style, '--rail-width': `${width}px` }) as CSSProperties, [attributes.style, width])
  return <NavigationActionsHost.Provider value={actionsHost}><NavigationContext.Provider value={collapsed}>
    <div {...attributes} className={`app-shell navigation-shell ${className}${rail ? ' icon-rail-shell' : ''}${rail && collapsed ? ' icon-rail-only' : ''}${collapsed ? ' navigation-collapsed' : ''}${resizing ? ' navigation-resizing' : ''}`} style={shellStyle}>
      {children}
      {!fixedSettings && <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild disabled={disabled}>
          <div ref={handle} className="navigation-resize-handle" role="separator" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined}
            aria-label={uiAttribute("导航侧栏宽度")} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={width}
            aria-valuetext={layout.collapsed ? uiAttribute("已完全收起") : uiAttribute("{0} 像素", String(width))} aria-controls="global-navigation" aria-describedby="navigation-resize-help"
            title={uiAttribute("拖动调宽，最窄处继续向左内推直接收起；双击复位；右键选择宽度")}
            {...splitter.handlers}
            onDoubleClick={() => { if (!disabled) resizeTo(NAVIGATION_DEFAULT_WIDTH) }}
            onContextMenu={event => { event.preventDefault(); if (!disabled) setMenuOpen(true) }}
            onKeyDown={event => {
              if (disabled || event.nativeEvent.isComposing || resizing) { event.preventDefault(); return }
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
            }}><SplitterFeedback phase={splitter.phase} target={splitter.target} label={uiAttribute('继续拖动收起侧栏')} /></div>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="sidebar-action-menu" side="right" sideOffset={4} collisionPadding={8}>
          {[[NAVIGATION_MIN_WIDTH, '紧凑宽度'], [NAVIGATION_DEFAULT_WIDTH, '默认宽度'], [408, '宽侧栏']].map(([value, text]) => <DropdownMenu.Item key={value} className="sidebar-action-menu-item" onSelect={() => resizeTo(Number(value))}>{uiAttribute(String(text))}</DropdownMenu.Item>)}
          <DropdownMenu.Separator className="sidebar-action-menu-separator" />
          <DropdownMenu.Item className="sidebar-action-menu-item" onSelect={toggle}>{label}</DropdownMenu.Item>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      {!fixedSettings && <span id="navigation-resize-help" className="sr-only"><UiText zh={"方向键调宽，Shift 加速，Home 最窄，End 最宽，Enter 折叠，空格选择宽度。拖到 248 像素先停住，继续向左内推 64 像素直接收起，无需松手或停留；按住反向拉回 24 像素可恢复；从左边缘拖出恢复。Escape 取消拖拽。"} /></span>}
      {/* Electron applies drag regions in DOM order; keep this no-drag control after the sidebar and topbar drag regions. */}
      {!browser && platform === 'win32' ? chromeSlot && createPortal(control, chromeSlot) : <div className={browser ? "navigation-browser-control" : "navigation-macos-control"}>{control}</div>}
    </div>
  </NavigationContext.Provider></NavigationActionsHost.Provider>
}
