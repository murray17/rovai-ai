import { useState } from 'react'
import type { CoreSubsystemSnapshot } from '@contracts'
import { readErrorMessage } from './error-message'

function subsystemLabel(id: string): string {
  const labels: Record<string, string> = {
    skills: 'Skill Library',
    mcp: 'MCP 配置',
    attachments: '附件服务',
    maintenance: '后台维护',
    'builtin-tools': '内置工具连接'
  }
  return labels[id] ?? (id.startsWith('runtime.') ? `Runtime：${id.slice(8)}` : id)
}

/** Authority stays mounted while a feature is repaired in the same Core. */
export function CoreSubsystemNotice({
  subsystems
}: {
  subsystems: CoreSubsystemSnapshot[]
}): React.JSX.Element | null {
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const degraded = subsystems.filter((subsystem) => subsystem.state === 'degraded')
  if (degraded.length === 0) return null

  const retry = async (): Promise<void> => {
    setRetrying(true)
    setError(null)
    try {
      await window.rovai.request('runtime.subsystems.retry')
    } catch (failure) {
      setError(readErrorMessage(failure))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <aside className="core-subsystem-notice" aria-label="功能降级状态">
      <div className="core-subsystem-notice-summary">
        <p role="status">部分功能暂不可用。工作区记录仍可使用。</p>
        <button
          className="quiet-button"
          type="button"
          disabled={retrying || subsystems.some((subsystem) => subsystem.state === 'initializing')}
          onClick={() => void retry()}
        >{retrying ? '正在重试…' : '重试受影响功能'}</button>
      </div>
      <details>
        <summary>查看原因：{degraded.map((subsystem) => subsystemLabel(subsystem.id)).join('、')}</summary>
        <ul>
          {degraded.map((subsystem) => (
            <li key={subsystem.id}>
              <strong>{subsystemLabel(subsystem.id)}</strong>
              <span>{subsystem.error?.message ?? '初始化尚未完成，请重试。'}</span>
            </li>
          ))}
        </ul>
      </details>
      {error && <p role="alert">重试未完成：{error}</p>}
    </aside>
  )
}
