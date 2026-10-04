import { uiAttribute } from './interface-language'
import type { RuntimeFailureView } from '@contracts'

export function runtimeFailureTitle(failure: RuntimeFailureView): string {
  const runtimeLabel = publicRuntimeLabel(failure.runtimeKind)
  return ({
    runtime: uiAttribute("{0} 返回错误", String(runtimeLabel)),
    compatibility: uiAttribute("{0} 与当前 Rovai 版本不兼容", String(runtimeLabel)),
    environment: uiAttribute("{0} 的本机运行环境不可用", String(runtimeLabel)),
    rovai: 'Rovai 内部错误',
    unknown: uiAttribute("{0} 未能完成运行", String(runtimeLabel))
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
  } as Partial<Record<RuntimeFailureView['runtimeKind'], string>>)[runtimeKind] ?? uiAttribute('未知智能体')
}
