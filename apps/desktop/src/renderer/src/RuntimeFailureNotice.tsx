import type { RuntimeFailureView } from '@contracts'

export function runtimeFailureTitle(failure: RuntimeFailureView): string {
  const runtimeLabel = publicRuntimeLabel(failure.runtimeKind)
  return ({
    runtime: `${runtimeLabel} 返回错误`,
    compatibility: `${runtimeLabel} 与当前 Rovai 版本不兼容`,
    environment: `${runtimeLabel} 的本机运行环境不可用`,
    rovai: 'Rovai 内部错误',
    unknown: `${runtimeLabel} 未能完成运行`
  } as const)[failure.origin]
}

export function RuntimeFailureNotice({ failure }: {
  failure: RuntimeFailureView
}): React.JSX.Element {
  const title = runtimeFailureTitle(failure)
  const detail = failure.detail?.trim()
  return (
    <section
      className={`runtime-failure-notice origin-${failure.origin}`}
      aria-label={title}
      role="status"
    >
      <strong>{title}</strong>
      <p>{failure.summary}</p>
      {detail && detail !== failure.summary && <p className="runtime-failure-detail">{detail}</p>}
    </section>
  )
}

function publicRuntimeLabel(runtimeKind: RuntimeFailureView['runtimeKind']): string {
  return ({
    'claude-code-cli': 'Claude Code',
    'antigravity-app': 'Antigravity'
  } as Partial<Record<RuntimeFailureView['runtimeKind'], string>>)[runtimeKind] ?? 'Agent 运行时'
}
