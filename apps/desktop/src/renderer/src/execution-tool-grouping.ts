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
  statusLabel: string
  primary: string
  currentTitle: string | null
  countLabel: string | null
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
  const settled = completed + failed + stopped + recorded

  if (activeIndex >= 0) {
    const status = statuses[activeIndex]
    const primary = status === 'waiting' ? '等待审批' : '执行中'
    const currentTitle = items[activeIndex].step.title
    const statusLabel = status === 'waiting' ? '等待审批' : '执行中'
    const countLabel = recorded > 0
      ? `已汇总 ${settled} 项操作`
      : `已执行 ${settled} 项操作`
    return {
      status,
      statusLabel,
      primary,
      currentTitle,
      countLabel,
      accessibleLabel: `${primary}：${currentTitle}；${countLabel}`
    }
  }

  const total = items.length
  let status: ActivityStatus
  let statusLabel: string
  if (completed > 0) {
    status = 'completed'
    statusLabel = completed === total ? '全部成功' : '含成功操作'
  } else if (failed === total) {
    status = 'failed'
    statusLabel = '全部失败'
  } else if (stopped > 0) {
    status = 'stopped'
    statusLabel = failed > 0 ? '已停止，含失败操作' : '已停止'
  } else {
    status = 'recorded'
    statusLabel = failed > 0 ? '已记录，含失败操作' : '已记录'
  }
  const primary = recorded > 0 ? `已汇总 ${total} 项操作` : `已执行 ${total} 项操作`

  return {
    status,
    statusLabel,
    primary,
    currentTitle: null,
    countLabel: null,
    accessibleLabel: `${primary}；状态：${statusLabel}`
  }
}
