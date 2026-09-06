import type { SingleChatRunView } from '@contracts'

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
    ...(hours > 0 ? [`${hours} 小时`] : []),
    ...(minutes > 0 ? [`${minutes} 分`] : []),
    `${seconds} 秒`
  ].join(' ')
}

export function executionRunSummary(run: Pick<SingleChatRunView, 'status' | 'startedAt' | 'createdAt' | 'endedAt'>, now: string): string {
  const start = run.startedAt ?? run.createdAt
  const end = run.endedAt ?? now
  const duration = formatExecutionDuration(start, end)
  if (run.status === 'succeeded') return `工作了 ${duration}`
  if (run.status === 'cancelled') return `你在 ${duration}后停止了运行`
  if (run.status === 'failed') return `运行 ${duration}后失败`
  if (run.status === 'waiting') return '等待继续'
  return 'Thinking'
}

