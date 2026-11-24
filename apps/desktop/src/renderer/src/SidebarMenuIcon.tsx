import type { JSX } from 'react'
import { ForkIcon } from './ForkIcon'
import { NavigationIcon } from './NavigationIcon'

export type SidebarMenuIconKind = 'pin' | 'edit' | 'copy' | 'trash' | 'remove' | 'square-pen' | 'reveal' | 'read' | 'unread' | 'export' | 'fork' | 'archive' | 'move-up' | 'move-down'

export function SidebarMenuIcon({ kind, filled = false }: {
  kind: SidebarMenuIconKind
  filled?: boolean
}): JSX.Element {
  if (kind === 'archive') return <NavigationIcon name="archive" />
  if (kind === 'move-up' || kind === 'move-down') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={kind === 'move-up' ? 'M12 19V5m-6 6 6-6 6 6' : 'M12 5v14m-6-6 6 6 6-6'} /></svg>
  if (kind === 'square-pen') return <NavigationIcon name="square-pen" />
  if (kind === 'fork') return <ForkIcon className="sidebar-action-menu-icon" />
  if (kind === 'export') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" /></svg>
  if (kind === 'reveal') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v3M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9" /><path d="M12 14h9m-3-3 3 3-3 3" /></svg>
  if (kind === 'read') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-6 9 6v10H3ZM3 9l9 6 9-6" /></svg>
  if (kind === 'unread') return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /><circle cx="20" cy="5" r="3" fill="currentColor" stroke="var(--surface-raised)" strokeWidth="1.8" /></svg>
  if (kind === 'edit') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 3.8-.8L18 9l-3-3-9.2 9.2Z" /><path d="m13.8 7.2 3 3" /></svg>
  }
  if (kind === 'trash') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V4h6v3m2 0-1 13H8L7 7m3 4v5m4-5v5" /></svg>
  }
  if (kind === 'copy') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" /></svg>
  }
  if (kind === 'remove') {
    return <svg className="sidebar-action-menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14v11H5z" /><path d="M9 12h6" /></svg>
  }
  return (
    <svg className={`sidebar-action-menu-icon ${filled ? 'filled' : ''}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4h6l-.8 5 3.3 3.2v1.3h-11v-1.3L9.8 9Z" />
      <path d="M12 13.5V21" />
    </svg>
  )
}

export function MoreMenuIcon(): JSX.Element {
  return <svg className="more-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
  </svg>
}
