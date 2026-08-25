import type { AgentRunView } from '@contracts'
import {
  activityStatusForAgentRun,
  type ActivityStatus,
  type ExecutionProgressItem
} from './ui-model'

export type ToolProgressItem = Extract<ExecutionProgressItem, { kind: 'tool' }>

export type ToolActivityGroup = {
  key: string
  kind: 'toolGroup'
  items: ToolProgressItem[]
}

export type GroupedExecutionProgressItem =
  | Exclude<ExecutionProgressItem, { kind: 'tool' }>
  | ToolActivityGroup

export type ToolActivityGroupPresentation = {
  status: ActivityStatus
  primary: string
  currentTitle: string | null
  countLabel: string
  countTone: 'neutral' | 'danger'
  accessibleLabel: string
}

export function groupConsecutiveToolItems(
  items: ExecutionProgressItem[]
): GroupedExecutionProgressItem[] {
  const grouped: GroupedExecutionProgressItem[] = []
  let currentGroup: ToolActivityGroup | null = null

  for (const item of items) {
    if (item.kind === 'tool') {
      if (currentGroup === null) {
        currentGroup = {
          key: `tool-group:${item.key}`,
          kind: 'toolGroup',
          items: []
        }
        grouped.push(currentGroup)
      }
      currentGroup.items.push(item)
      continue
    }

    currentGroup = null
    grouped.push(item)
  }

  return grouped
}

export function toolActivityGroupHasActiveTool(
  items: ToolProgressItem[],
  runStatus: AgentRunView['status']
): boolean {
  return items.some((item) => {
    const status = activityStatusForAgentRun(item.step.status, runStatus)
    return status === 'running' || status === 'waiting'
  })
}

export function toolActivityGroupPresentation(
  items: ToolProgressItem[],
  runStatus: AgentRunView['status']
): ToolActivityGroupPresentation {
  const statuses = items.map((item) => activityStatusForAgentRun(item.step.status, runStatus))
  let activeIndex = -1
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    if (statuses[index] === 'running' || statuses[index] === 'waiting') {
      activeIndex = index
      break
    }
  }

  const completed = statuses.filter((status) => status === 'completed').length
  const failed = statuses.filter((status) => status === 'failed').length
  const stopped = statuses.filter((status) => status === 'stopped').length
  const recorded = statuses.filter((status) => status === 'recorded').length

  if (activeIndex >= 0) {
    const status = statuses[activeIndex]
    const primary = status === 'waiting' ? '等待审批' : '执行中'
    const currentTitle = items[activeIndex].step.title
    const settledOutcomes = [
      completed > 0 ? `${completed} 项已完成` : null,
      failed > 0 ? `${failed} 项失败` : null,
      stopped > 0 ? `${stopped} 项已停止` : null,
      recorded > 0 ? `${recorded} 项仅记录` : null
    ].filter((value): value is string => value !== null)
    const countLabel = settledOutcomes.length > 0
      ? settledOutcomes.join(' · ')
      : '0 项已完成'
    return {
      status,
      primary,
      currentTitle,
      countLabel,
      countTone: failed > 0 || stopped > 0 ? 'danger' : 'neutral',
      accessibleLabel: `${primary}：${currentTitle}；${countLabel}`
    }
  }

  const total = items.length
  const status: ActivityStatus = failed > 0
    ? 'failed'
    : stopped > 0
      ? 'stopped'
      : recorded > 0
        ? 'recorded'
        : 'completed'
  const primary = recorded > 0 ? `已汇总 ${total} 项操作` : `已执行 ${total} 项操作`
  const outcomes = [
    failed > 0 ? `${failed} 项失败` : null,
    stopped > 0 ? `${stopped} 项已停止` : null,
    recorded > 0 ? `${recorded} 项仅记录` : null
  ].filter((value): value is string => value !== null)
  const countLabel = outcomes.length > 0 ? outcomes.join(' · ') : '全部成功'

  return {
    status,
    primary,
    currentTitle: null,
    countLabel,
    countTone: failed > 0 || stopped > 0 ? 'danger' : 'neutral',
    accessibleLabel: `${primary}；${countLabel}`
  }
}
