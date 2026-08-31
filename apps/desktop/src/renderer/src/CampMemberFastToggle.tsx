import { useId } from 'react'
import type { CampMemberFastView } from '@contracts'

export function effectiveCampMemberFast(value: CampMemberFastView): boolean {
  return value.fastOverride ?? value.runtimeDefaultFast ?? false
}

export function CampMemberFastToggle({
  value, displayName, runtimeName, pending, onToggle
}: {
  value: CampMemberFastView
  displayName: string
  runtimeName: string
  pending: boolean
  onToggle(next: boolean, trigger: HTMLButtonElement): void
}): React.JSX.Element {
  const tooltipId = useId()
  const enabled = effectiveCampMemberFast(value)
  const unknown = value.fastOverride === null && value.runtimeDefaultFast === null
  const stateLabel = unknown ? '跟随运行时默认' : enabled ? '后续执行请求 Fast' : '后续执行请求标准速度'
  const explanation = value.fastOverride === null
    ? `跟随 ${runtimeName} 默认设置，不覆盖原生配置`
    : enabled ? '后续执行请求 Fast' : '后续执行请求标准速度'
  return <span className="camp-fast-control">
    <button
      type="button"
      className={`camp-fast-toggle ${enabled ? 'is-on' : ''}`}
      aria-label={`${displayName}的 Fast，${stateLabel}`}
      aria-pressed={unknown ? 'mixed' : enabled}
      aria-disabled={pending}
      aria-busy={pending}
      aria-describedby={tooltipId}
      onClick={(event) => { if (!pending) onToggle(!enabled, event.currentTarget) }}
    >
      <span className="camp-fast-pill">
        <svg viewBox="0 0 16 16" aria-hidden="true" fill={enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"><path d="m9 1-6 8h4l-1 6 7-9H9z" /></svg>
        Fast
      </span>
    </button>
    <span className="camp-fast-tooltip" id={tooltipId} role="tooltip">
      {explanation}。仅影响该队员在本次会话中的后续执行。
    </span>
  </span>
}
