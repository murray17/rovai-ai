import type { CampMemberFastView } from '@contracts'

export function effectiveCampMemberFast(value: CampMemberFastView): boolean {
  return value.fastOverride ?? value.runtimeDefaultFast ?? false
}

export function CampMemberFastToggle({
  value, displayName, pending, onToggle
}: {
  value: CampMemberFastView
  displayName: string
  pending: boolean
  onToggle(next: boolean): void
}): React.JSX.Element {
  const enabled = effectiveCampMemberFast(value)
  const unknown = value.fastOverride === null && value.runtimeDefaultFast === null
  const stateLabel = unknown ? '跟随运行时默认' : enabled ? '后续执行请求 Fast' : '后续执行请求标准速度'
  return <span className="camp-fast-control">
    <button
      type="button"
      className={`camp-fast-toggle ${enabled ? 'is-on' : ''}`}
      aria-label={`${displayName}的 Fast，${stateLabel}`}
      aria-pressed={unknown ? 'mixed' : enabled}
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
