import { uiAttribute } from './interface-language'
import type { ThreadMemberFastView } from '@contracts'

export function effectiveThreadMemberFast(value: ThreadMemberFastView): boolean {
  return value.fastOverride ?? value.runtimeDefaultFast ?? false
}

export function ThreadMemberFastToggle({
  value, displayName, pending, onToggle
}: {
  value: ThreadMemberFastView
  displayName: string
  pending: boolean
  onToggle(next: boolean): void
}): React.JSX.Element {
  const enabled = effectiveThreadMemberFast(value)
  return <span className="camp-fast-control">
    <button
      type="button"
      className={`camp-fast-toggle ${enabled ? 'is-on' : ''}`}
      aria-label={uiAttribute("{0}的 Fast", displayName)}
      aria-pressed={enabled}
      aria-disabled={pending}
      aria-busy={pending}
      onClick={() => { if (!pending) onToggle(!enabled) }}
    >
      <span className="camp-fast-pill">
        <svg viewBox="0 0 16 16" aria-hidden="true" fill={enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"><path d="m9 1-6 8h4l-1 6 7-9H9z" /></svg>
        Fast
      </span>
    </button>
  </span>
}
