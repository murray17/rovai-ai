import type { SingleChatRunView } from '@contracts'
import { runtimeThinkingTitleText, type ExecutionProgressItem } from './ui-model'
import { executionHasActiveCompaction } from './execution-tool-grouping'
import { uiAttribute } from './interface-language'

export function executionPhaseFeedback(
  status: SingleChatRunView['status'],
  items: readonly ExecutionProgressItem[],
  hasFinal = false,
  runtimePhase?: 'thinking' | 'executing',
  runtimeThinkingTitle?: string | null
): string | null {
  if (hasFinal || executionHasActiveCompaction(items)) return null
  if (status === 'running' && runtimePhase === 'thinking') return runtimeThinkingTitleText(runtimeThinkingTitle) ?? uiAttribute('思考中')
  if (items.some((item) => item.kind === 'narration' || item.kind === 'plan' || item.kind === 'tool')) return null
  if (status === 'queued') return uiAttribute('连接中')
  if (status === 'running') return uiAttribute('执行中')
  return null
}

export function formatExecutionDuration(startedAt: string, endedAt: string): string {
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  const totalSeconds = Number.isFinite(started) && Number.isFinite(ended)
    ? Math.max(0, Math.floor((ended - started) / 1_000))
    : 0
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return [
    ...(hours > 0 ? [uiAttribute('{0} 小时', hours)] : []),
    ...(minutes > 0 ? [uiAttribute('{0} 分', minutes)] : []),
    uiAttribute('{0} 秒', seconds)
  ].join(' ')
}

export function executionRunSummary(run: Pick<SingleChatRunView, 'status' | 'startedAt' | 'createdAt' | 'endedAt'>, now: string): string {
  const start = run.startedAt ?? run.createdAt
  const end = run.endedAt ?? now
  const duration = formatExecutionDuration(start, end)
  if (run.status === 'succeeded') return uiAttribute('工作了 {0}', duration)
  if (run.status === 'cancelled') return uiAttribute('你在 {0}后停止了运行', duration)
  if (run.status === 'failed') return uiAttribute('运行 {0}后失败', duration)
  if (run.status === 'waiting') return uiAttribute('等待继续')
  return executionPhaseFeedback(run.status, []) ?? uiAttribute('等待继续')
}
