import type { AgentRunView } from '@contracts'
import {
  activityStatusForAgentRun,
  executionStepCurrentInstructionTitle,
  type ActivityStatus,
  type ActivityIconKind,
  type ExecutionProgressItem,
  type RuntimeCompactionDisplayItem
} from './index'

export type ToolProgressItem = Extract<ExecutionProgressItem, { kind: 'tool' }>

export type ToolActivityGroup = {
  key: string
  kind: 'toolGroup'
  items: ToolProgressItem[]
}

export type GroupedExecutionProgressItem =
  | Exclude<ExecutionProgressItem, { kind: 'tool' }>
  | ToolProgressItem
  | ToolActivityGroup

export type ToolActivityGroupPresentation = {
  status: ActivityStatus
  statusLabel: string
  primary: string
  currentTitle: string | null
  currentIconKind: ActivityIconKind | null
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

export function runtimeCompactionActivityStatus(
  compaction: RuntimeCompactionDisplayItem,
  runStatus: AgentRunView['status']
): ActivityStatus {
  if (compaction.phase === 'completed') return 'completed'
  if (
    compaction.phase === 'started'
    && (runStatus === 'queued' || runStatus === 'running' || runStatus === 'waiting')
  ) return 'running'
  return 'recorded'
}

export function executionHasActiveCompaction(items: ExecutionProgressItem[]): boolean {
  return items.some((item) =>
    item.kind === 'compaction' && item.compaction.phase === 'started'
  )
}

export function toolActivityGroupPresentation(
  items: ToolProgressItem[],
  runStatus: AgentRunView['status'],
  isLiveTail = false,
  formatCompletedSteps: (count: number) => string = (count) => `已完成 ${count} 个步骤`,
  copy: {
    translateLabel?: (label: string) => string
    currentTitle?: (step: ToolProgressItem['step']) => string
    activeAccessibleLabel?: (primary: string, currentTitle: string) => string
  } = {}
): ToolActivityGroupPresentation {
  const label = copy.translateLabel ?? ((value: string): string => value)
  const title = copy.currentTitle ?? executionStepCurrentInstructionTitle
  const activeAccessibleLabel = copy.activeAccessibleLabel
    ?? ((primary: string, currentTitle: string): string => `${primary}：${currentTitle}`)
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

  if (activeIndex >= 0) {
    const status = statuses[activeIndex]
    const primary = label(status === 'waiting' ? '等待审批' : '执行中')
    const currentTitle = title(items[activeIndex].step)
    return {
      status,
      statusLabel: primary,
      primary,
      currentTitle,
      currentIconKind: items[activeIndex].step.iconKind,
      countLabel: null,
      accessibleLabel: activeAccessibleLabel(primary, currentTitle)
    }
  }

  if (isLiveTail && runStatus === 'running') {
    const currentTitle = title(items[items.length - 1].step)
    const primary = label('执行中')
    return {
      status: 'running',
      statusLabel: primary,
      primary,
      currentTitle,
      currentIconKind: items[items.length - 1].step.iconKind,
      countLabel: null,
      accessibleLabel: activeAccessibleLabel(primary, currentTitle)
    }
  }

  const total = items.length
  let status: ActivityStatus
  let statusLabel: string
  if (completed > 0) {
    status = 'completed'
    statusLabel = label(completed === total ? '全部成功' : '含成功操作')
  } else if (failed === total) {
    status = 'failed'
    statusLabel = label('全部失败')
  } else if (stopped > 0) {
    status = 'stopped'
    statusLabel = label(failed > 0 ? '已停止，含失败操作' : '已停止')
  } else {
    status = 'recorded'
    statusLabel = label(failed > 0 ? '已记录，含失败操作' : '已记录')
  }
  const primary = formatCompletedSteps(total)

  return {
    status,
    statusLabel,
    primary,
    currentTitle: null,
    currentIconKind: null,
    countLabel: null,
    accessibleLabel: primary
  }
}
