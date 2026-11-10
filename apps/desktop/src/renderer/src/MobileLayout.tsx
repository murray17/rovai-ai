import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode, type Ref, type RefObject } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { NavigationIcon } from './NavigationIcon'
import { PanelToggleIcon } from './PanelToggleIcon'
import { uiAttribute } from './interface-language'

// Presentation only. Host capabilities and editing identity still come from ThreadClient.
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

export function MobileConversationDrawer({ open, onOpenChange, triggerRef, scrollPosition, children }: {
  open: boolean; onOpenChange(open: boolean): void
  triggerRef: RefObject<HTMLButtonElement | null>; scrollPosition: RefObject<number>; children: ReactNode
}): React.JSX.Element {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="mobile-conversation-scrim" />
    <Dialog.Content id="mobile-app-menu" className="mobile-conversation-drawer app-menu" aria-describedby={undefined} tabIndex={-1}
      onOpenAutoFocus={event => {
        event.preventDefault()
        const menu = document.getElementById('mobile-app-menu')
        const list = menu?.querySelector<HTMLElement>('.navigation-scroll')
        if (list) list.scrollTop = scrollPosition.current
        menu?.focus()
      }}
      onScrollCapture={event => { if (event.target instanceof HTMLElement && event.target.classList.contains('navigation-scroll')) scrollPosition.current = event.target.scrollTop }}
      onCloseAutoFocus={event => {
        event.preventDefault()
        const trigger = triggerRef.current
        const visibleTrigger = trigger?.getClientRects().length ? trigger
          : [...document.querySelectorAll<HTMLButtonElement>('.app-shell [aria-label="打开主菜单"]')].find(button => button.getClientRects().length)
        visibleTrigger?.focus({ preventScroll: true })
      }}>
      <header className="app-menu-heading"><Dialog.Title>Rovai AI</Dialog.Title>
        <Dialog.Close asChild><button className="mobile-icon-button" type="button" aria-label={uiAttribute('关闭主菜单')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></Dialog.Close>
      </header>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
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
      aria-label={uiAttribute("打开主菜单")} aria-expanded={menuOpen} aria-controls={menuOpen ? 'mobile-app-menu' : undefined} onClick={event => onOpenMenu(event.currentTarget)}>
      <PanelToggleIcon side="left" visible={false} />
    </button>
    <h1>{title}</h1>
    {children && <div>{children}</div>}
  </header>
}
