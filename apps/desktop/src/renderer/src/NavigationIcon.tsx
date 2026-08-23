export type NavigationIconName =
  | 'arrow-left'
  | 'bell-ring'
  | 'blocks'
  | 'brain'
  | 'chart-line'
  | 'cpu'
  | 'info'
  | 'settings'
  | 'sliders-horizontal'
  | 'sparkles'
  | 'square-pen'
  | 'stethoscope'
  | 'sun-moon'
  | 'users'

export function NavigationIcon({ name }: { name: NavigationIconName }): React.JSX.Element {
  return (
    <svg
      className="navigation-icon"
      data-navigation-icon={name}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {navigationIconPaths(name)}
    </svg>
  )
}

function navigationIconPaths(name: NavigationIconName): React.JSX.Element {
  switch (name) {
    case 'arrow-left':
      return <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>
    case 'square-pen':
      return <><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z" /></>
    case 'users':
      return <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>
    case 'brain':
      return <><path d="M12 5a3 3 0 0 0-5.8 1.1A3.5 3.5 0 0 0 4 9.35v.3A3.5 3.5 0 0 0 6.2 12.9 3 3 0 0 0 12 14Z" /><path d="M12 5a3 3 0 0 1 5.8 1.1A3.5 3.5 0 0 1 20 9.35v.3a3.5 3.5 0 0 1-2.2 3.25A3 3 0 0 1 12 14Z" /><path d="M7 12.5V16a3 3 0 0 0 5 2.24V5" /><path d="M17 12.5V16a3 3 0 0 1-5 2.24" /><path d="M8 9h1a3 3 0 0 0 3-3" /><path d="M16 9h-1a3 3 0 0 1-3-3" /></>
    case 'chart-line':
      return <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 2 5-6" /><circle cx="7" cy="15" r=".7" fill="currentColor" stroke="none" /><circle cx="11" cy="11" r=".7" fill="currentColor" stroke="none" /><circle cx="14" cy="13" r=".7" fill="currentColor" stroke="none" /><circle cx="19" cy="7" r=".7" fill="currentColor" stroke="none" /></>
    case 'settings':
      return <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></>
    case 'sliders-horizontal':
      return <><path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" /><path d="M21 20h-4" /><path d="M13 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M17 18v4" /></>
    case 'sun-moon':
      return <><circle cx="8" cy="8" r="3" /><path d="M8 2v1" /><path d="M8 13v1" /><path d="m3.76 3.76.7.7" /><path d="m11.54 11.54.7.7" /><path d="M2 8h1" /><path d="M13 8h1" /><path d="m3.76 12.24.7-.7" /><path d="M15.2 8.8A7 7 0 1 0 21 14a5.4 5.4 0 0 1-5.8-5.2Z" /></>
    case 'bell-ring':
      return <><path d="M10.27 21a2 2 0 0 0 3.46 0" /><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M4.5 3.5 3 5" /><path d="m19.5 3.5 1.5 1.5" /></>
    case 'sparkles':
      return <><path d="m12 3-1.1 3.4a2 2 0 0 1-1.3 1.3L6.2 8.8l3.4 1.1a2 2 0 0 1 1.3 1.3L12 14.6l1.1-3.4a2 2 0 0 1 1.3-1.3l3.4-1.1-3.4-1.1a2 2 0 0 1-1.3-1.3Z" /><path d="m19 15-.6 1.8a1.2 1.2 0 0 1-.8.8l-1.8.6 1.8.6a1.2 1.2 0 0 1 .8.8l.6 1.8.6-1.8a1.2 1.2 0 0 1 .8-.8l1.8-.6-1.8-.6a1.2 1.2 0 0 1-.8-.8Z" /><path d="m5 15-.45 1.3a1 1 0 0 1-.65.65l-1.3.45 1.3.45a1 1 0 0 1 .65.65L5 19.8l.45-1.3a1 1 0 0 1 .65-.65l1.3-.45-1.3-.45a1 1 0 0 1-.65-.65Z" /></>
    case 'blocks':
      return <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="8.5" y="14" width="7" height="7" rx="1.5" /><path d="M6.5 10v2h11v-2" /><path d="M12 12v2" /></>
    case 'cpu':
      return <><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 1v3" /><path d="M15 1v3" /><path d="M9 20v3" /><path d="M15 20v3" /><path d="M20 9h3" /><path d="M20 14h3" /><path d="M1 9h3" /><path d="M1 14h3" /></>
    case 'info':
      return <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.25h.01" /></>
    case 'stethoscope':
      return <><path d="M5 3v5a4 4 0 0 0 8 0V3" /><path d="M5 3H4" /><path d="M13 3h1" /><path d="M9 12v3a4 4 0 0 0 4 4h1" /><circle cx="17" cy="17" r="3" /></>
  }
}
