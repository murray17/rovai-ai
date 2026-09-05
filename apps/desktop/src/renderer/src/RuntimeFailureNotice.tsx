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

export function RuntimeFailureNotice({
  failure,
  presentation = 'default'
}: {
  failure: RuntimeFailureView
  presentation?: 'default' | 'agent-run'
}): React.JSX.Element {
  if (presentation === 'agent-run') {
    const message = runtimeFailureMessage(failure)
    return (
      <section
        className="runtime-failure-notice agent-run-runtime-failure"
        aria-label={message}
        role="status"
      >
        <p>{message}</p>
      </section>
    )
  }
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

export function runtimeFailureMessage(failure: RuntimeFailureView): string {
  return failure.detail?.trim() || failure.summary
}

function publicRuntimeLabel(runtimeKind: RuntimeFailureView['runtimeKind']): string {
  return ({
    'claude-code-cli': 'Claude Code',
    'antigravity-app': 'Antigravity'
  } as Partial<Record<RuntimeFailureView['runtimeKind'], string>>)[runtimeKind] ?? 'Agent 运行时'
}
