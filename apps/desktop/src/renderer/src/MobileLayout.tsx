import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type Ref } from 'react'
import { NavigationIcon } from './NavigationIcon'
import { PanelToggleIcon } from './PanelToggleIcon'

// Presentation only. Host capabilities and editing identity still come from CampClient.
const MobileLayout = createContext(false)
const query = '(max-width: 767px), (max-width: 1039px) and (max-height: 560px) and (pointer: coarse)'
const subscribe = (notify: () => void): (() => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}
export function useMobileViewport(enabled: boolean): boolean {
  const matches = useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
  return enabled && matches
}
export const useMobileLayout = (): boolean => useContext(MobileLayout)

/** Animate the existing page without remounting its editors or scroll containers. */
export function useMobilePageTransition(mobile: boolean, page: string) {
  const surface = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (!mobile || document.documentElement.dataset.motionPreference === 'reduce'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = surface.current?.animate([
      { opacity: .65, transform: 'translateX(12px)' },
      { opacity: 1, transform: 'translateX(0)' }
    ], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' })
    return () => animation?.cancel()
  }, [mobile, page])
  return surface
}

export function MobileLayoutProvider({ value, children }: { value: boolean; children: ReactNode }): React.JSX.Element {
  useEffect(() => {
    if (!value) return
    const root = document.documentElement
    root.dataset.mobileWeb = 'true'
    const update = (): void => {
      if (window.visualViewport && window.visualViewport.scale !== 1) return
      root.style.setProperty('--mobile-viewport-height', `${window.visualViewport?.height ?? window.innerHeight}px`)
      root.style.setProperty('--mobile-viewport-top', `${window.visualViewport?.offsetTop ?? 0}px`)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      delete root.dataset.mobileWeb
      root.style.removeProperty('--mobile-viewport-height')
      root.style.removeProperty('--mobile-viewport-top')
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [value])
  return <MobileLayout.Provider value={value}>{children}</MobileLayout.Provider>
}

export function MobileBack({ onClick, label = '返回' }: { onClick(): void; label?: string }): React.JSX.Element {
  return <button className="mobile-icon-button mobile-back" type="button" aria-label={label} onClick={onClick}><NavigationIcon name="arrow-left" /></button>
}

export function MobilePageHeader({ title, onOpenMenu, menuOpen, triggerRef, children }: {
  title: string
  onOpenMenu(trigger: HTMLButtonElement): void
  menuOpen: boolean
  triggerRef?: Ref<HTMLButtonElement>
  children?: ReactNode
}): React.JSX.Element {
  return <header className="mobile-page-heading app-root-heading">
    <button ref={triggerRef} className="mobile-icon-button mobile-conversation-list-open" type="button"
      aria-label="打开主菜单" aria-expanded={menuOpen} aria-controls={menuOpen ? 'mobile-app-menu' : undefined} onClick={event => onOpenMenu(event.currentTarget)}>
      <PanelToggleIcon side="left" visible={false} />
    </button>
    <h1>{title}</h1>
    {children && <div>{children}</div>}
  </header>
}
