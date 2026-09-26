import { Activity, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import type { AppearanceSnapshot, SettingsSection } from '@contracts'
import { useCampClient } from './camp-client'
import { SETTINGS_SIDEBAR_GROUPS } from './CampNavigation'
import { MobileBack, MobilePageHeader, useMobileLayout } from './MobileLayout'
import { NavigationIcon } from './NavigationIcon'
import { Icon } from './MissionControls'

/** Presentation only: the App coordinator still owns navigation and leave guards. */
export function MobileSettingsLayout({ overview, section, appearance, menuOpen, triggerRef, onOpenMenu, onBack, onSectionChange, children }: {
  overview: boolean
  section: SettingsSection
  appearance: AppearanceSnapshot
  menuOpen: boolean
  triggerRef: Ref<HTMLButtonElement>
  onOpenMenu(trigger: HTMLButtonElement): void
  onBack(): void
  onSectionChange(section: SettingsSection): void
  children: ReactNode
}): React.JSX.Element {
  const mobile = useMobileLayout()
  const client = useCampClient()
  const index = useRef<HTMLDivElement>(null)
  const wasOverview = useRef(overview)
  const lastSection = useRef(section)
  const groups = SETTINGS_SIDEBAR_GROUPS.map(group => ({ ...group, items: group.items.filter(item => item.key !== 'channels' || client.channels) }))
  const selected = groups.flatMap(group => group.items).find(item => item.key === section)
  useLayoutEffect(() => {
    if (mobile && overview && !wasOverview.current) {
      index.current?.querySelector<HTMLButtonElement>(`[data-setting="${lastSection.current}"]`)?.focus({ preventScroll: true })
    }
    if (!overview) lastSection.current = section
    wasOverview.current = overview
  }, [mobile, overview, section])
  if (!mobile) return <>{children}</>
  return <section className="mobile-settings-workspace" data-settings-section={overview ? 'index' : section}>
    {overview ? <MobilePageHeader title="设置" onOpenMenu={onOpenMenu} menuOpen={menuOpen} triggerRef={triggerRef} />
      : <header className="mobile-page-heading settings-nav-header"><MobileBack label="返回设置" onClick={onBack} /><h1>{selected?.label ?? '设置'}</h1></header>}
    <Activity mode={overview ? 'visible' : 'hidden'}>
      <div className="mobile-settings-index" ref={index}>
        {groups.map(group => <section className="settings-index-group" key={group.key} aria-labelledby={`mobile-settings-${group.key}`}>
          <h2 id={`mobile-settings-${group.key}`}>{group.label}</h2>
          <div className="settings-index-rows">{group.items.map(item => <button type="button" key={item.key} data-setting={item.key} onClick={() => onSectionChange(item.key)}>
            <NavigationIcon name={item.icon} /><span>{item.label}</span>
            {item.key === 'general' && <small>新对话与会话</small>}
            {item.key === 'appearance' && <small>{appearance.preference === 'system' ? '跟随系统' : appearance.resolvedTheme === 'night' ? '夜间' : '日间'}</small>}
            <Icon name="chevron-right" />
          </button>)}</div>
        </section>)}
      </div>
    </Activity>
    <Activity mode={overview ? 'hidden' : 'visible'}><div className="mobile-settings-detail">{children}</div></Activity>
  </section>
}
