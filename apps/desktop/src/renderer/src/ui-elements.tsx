import type { JSX } from 'react'
import { statusLabel } from './ui-model'

export function StatusBadge({ status }: { status: string }): JSX.Element {
  return <span className={`status-badge status-${status}`}><i aria-hidden="true" />{statusLabel(status)}</span>
}

export function EmptyInline({ text }: { text: string }): JSX.Element {
  return <div className="empty-inline">{text}</div>
}
