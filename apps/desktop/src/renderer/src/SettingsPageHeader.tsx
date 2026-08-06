import type { ReactNode } from 'react'

export function SettingsPageHeader({
  eyebrow,
  title,
  description,
  aside
}: {
  eyebrow: string
  title: string
  description: string
  aside?: ReactNode
}): React.JSX.Element {
  return (
    <header className="settings-page-heading">
      <div className="settings-page-heading-copy">
        <p className="settings-page-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {aside && <div className="settings-page-heading-aside">{aside}</div>}
    </header>
  )
}
