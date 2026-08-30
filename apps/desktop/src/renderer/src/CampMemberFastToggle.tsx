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
  const warning = enabled && value.observedFastState === 'cooldown'
  const stateLabel = unknown ? '状态未知' : enabled ? '已请求 Fast' : '标准速度'
  const explanation = unknown
    ? `跟随 ${runtimeName} 设置，首次运行后显示实际状态`
    : value.unavailableReason ?? (value.fastOverride === null ? '跟随 Agent 运行时默认设置' : '已保存当前会话的响应模式')
  return <span className="camp-fast-control">
    <button
      type="button"
      className={`camp-fast-toggle ${enabled ? 'is-on' : ''}`}
      aria-label={`${displayName}的 Fast，${stateLabel}${warning ? '，暂时不可用' : ''}`}
      aria-pressed={enabled}
      aria-disabled={pending}
      aria-busy={pending}
      aria-describedby={tooltipId}
      onClick={(event) => { if (!pending) onToggle(!enabled, event.currentTarget) }}
    >
      <span className="camp-fast-pill">
        <svg viewBox="0 0 16 16" aria-hidden="true" fill={enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"><path d="m9 1-6 8h4l-1 6 7-9H9z" /></svg>
        Fast
        {warning && <svg className="camp-fast-warning" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 2 1 14h14Z M8 6v4 M8 12v.5" /></svg>}
      </span>
    </button>
    <span className="camp-fast-tooltip" id={tooltipId} role="tooltip">
      {explanation}。仅影响该队员在本次会话中的后续执行。
    </span>
  </span>
}
