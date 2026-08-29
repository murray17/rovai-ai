import type {
  AgentRunExecutionEvidenceView,
  AgentRunView,
  ExecutionConsolePage,
  ExecutionConsoleTerminalSummary,
  ExecutionConsoleViewState
} from '@contracts'
import {
  activityStatusForAgentRun,
  agentRunPresentation,
  buildLiveExecutionProgress,
  liveRuntimeEventFromExecutionEvidence,
  type ActivityStatus,
  type ExecutionProgressItem
} from './index'
import {
  groupConsecutiveToolItems,
  type GroupedExecutionProgressItem,
  type ToolProgressItem
} from './tool-grouping'

const EXPANDED_PAGE_CHAR_BUDGET = 10_000
const EXPANDED_PAGE_OPERATION_BUDGET = 25
const MAX_TOOLS_PER_VISUAL_GROUP = 20

export interface ExecutionConsoleSnapshot {
  sequence: number
  agentRunId: string
  agentDisplayName: string
  run: Pick<AgentRunView, 'status' | 'waitReason' | 'terminalReasonCode'>
  evidence: AgentRunExecutionEvidenceView[]
  publicOutput: string | null
  startedAt: string | null
  terminalAt: string | null
}

type ExecutionCardBlock = {
  body: string
  operationCount: number
}

export function executionConsoleCard(
  snapshot: ExecutionConsoleSnapshot,
  view: ExecutionConsoleViewState
): Record<string, unknown> {
  if (!isTerminal(snapshot.run.status)) return renderLiveExecutionCard(snapshot)
  return view.mode === 'expanded'
    ? renderExpandedTerminalCard(snapshot, view)
    : renderCollapsedTerminalCard(snapshot, view)
}

export function executionConsoleTerminalSummary(
  snapshot: ExecutionConsoleSnapshot
): ExecutionConsoleTerminalSummary {
  const items = progressItems(snapshot)
  const tools = items.flatMap((item) => item.kind === 'tool' ? [item] : [])
  const statuses = tools.map((item) => (
    activityStatusForAgentRun(item.step.status, snapshot.run.status)
  ))
  const failedTool = tools.find((item) => (
    activityStatusForAgentRun(item.step.status, snapshot.run.status) === 'failed'
  ))
  return {
    visibleOperationCount: tools.length,
    completedOperationCount: statuses.filter((status) => (
      status === 'completed' || status === 'recorded'
    )).length,
    failedOperationCount: statuses.filter((status) => status === 'failed').length,
    waitingOperationCount: statuses.filter((status) => status === 'waiting').length,
    durationMs: durationMs(snapshot.startedAt, snapshot.terminalAt),
    failureSummary: snapshot.run.status === 'failed'
      ? safeFailureSummary(failedTool, snapshot.run.terminalReasonCode)
      : null
  }
}

export function executionConsolePages(snapshot: ExecutionConsoleSnapshot): ExecutionConsolePage[] {
  const pages = paginateExecutionBlocks(expandedExecutionBlocks(snapshot))
  return pages.map((blocks, pageIndex) => ({
    pageIndex,
    pageCount: pages.length,
    body: blocks.map((block) => block.body).join('\n\n') || '没有可展示的执行记录。'
  }))
}

export function executionConsolePageCount(snapshot: ExecutionConsoleSnapshot): number {
  return executionConsolePages(snapshot).length
}

function renderLiveExecutionCard(snapshot: ExecutionConsoleSnapshot): Record<string, unknown> {
  const status = agentRunPresentation(snapshot.run)
  const body = liveExecutionBlocks(snapshot).join('\n\n') || '正在准备执行…'
  return baseCard(
    `${boundedPlainText(snapshot.agentDisplayName, 80)} · ${status.label}`,
    cardTemplate(snapshot.run.status, snapshot.run.waitReason),
    [{ tag: 'markdown', content: body }]
  )
}

function renderCollapsedTerminalCard(
  snapshot: ExecutionConsoleSnapshot,
  view: ExecutionConsoleViewState
): Record<string, unknown> {
  const summary = executionConsoleTerminalSummary(snapshot)
  const lines = [terminalSummaryLine(snapshot.run.status, summary)]
  if (summary.failureSummary) lines.push(`失败：${summary.failureSummary}`)
  if (snapshot.run.status === 'cancelled' && summary.visibleOperationCount > 0) {
    lines.push('本次执行已停止')
  }
  return baseCard(
    `${boundedPlainText(snapshot.agentDisplayName, 80)} · ${terminalTitle(snapshot.run)}`,
    cardTemplate(snapshot.run.status, snapshot.run.waitReason),
    [
      { tag: 'markdown', content: lines.join('\n\n') },
      cardButton('查看执行过程', actionValue('execution_console_expand', snapshot, view))
    ]
  )
}

function renderExpandedTerminalCard(
  snapshot: ExecutionConsoleSnapshot,
  view: ExecutionConsoleViewState
): Record<string, unknown> {
  const pages = executionConsolePages(snapshot)
  const pageIndex = Math.min(Math.max(0, view.pageIndex), pages.length - 1)
  const page = pages[pageIndex]
  const body = page.pageCount > 1
    ? `第 ${pageIndex + 1} / ${page.pageCount} 页\n\n${page.body}`
    : page.body
  const actions: Record<string, unknown>[] = []
  if (pageIndex > 0) {
    actions.push(cardButton(
      '上一页',
      actionValue('execution_console_prev_page', snapshot, view)
    ))
  }
  if (pageIndex < page.pageCount - 1) {
    actions.push(cardButton(
      '下一页',
      actionValue('execution_console_next_page', snapshot, view)
    ))
  }
  actions.push(cardButton(
    '收起执行过程',
    actionValue('execution_console_collapse', snapshot, view)
  ))
  return baseCard(
    `${boundedPlainText(snapshot.agentDisplayName, 80)} · 执行过程`,
    cardTemplate(snapshot.run.status, snapshot.run.waitReason),
    [
      { tag: 'markdown', content: body },
      ...actions
    ]
  )
}

function progressItems(snapshot: ExecutionConsoleSnapshot): ExecutionProgressItem[] {
  return buildLiveExecutionProgress(
    snapshot.evidence.map(liveRuntimeEventFromExecutionEvidence),
    snapshot.agentRunId
  ).items
}

function liveExecutionBlocks(snapshot: ExecutionConsoleSnapshot): string[] {
  const blocks = executionBlocks(groupConsecutiveToolItems(progressItems(snapshot)), snapshot.run.status)
  appendPublicOutput(blocks, snapshot.publicOutput)
  return blocks
}

function expandedExecutionBlocks(snapshot: ExecutionConsoleSnapshot): ExecutionCardBlock[] {
  const blocks: ExecutionCardBlock[] = []
  let groupNumber = 0
  for (const item of groupConsecutiveToolItems(progressItems(snapshot))) {
    if (item.kind !== 'toolGroup') {
      const body = renderNonGroupItem(item, snapshot.run.status)
      if (body) blocks.push({ body, operationCount: item.kind === 'tool' ? 1 : 0 })
      continue
    }
    for (const segment of splitTerminalToolGroup(item.items, snapshot.run.status)) {
      if (segment.grouped) {
        groupNumber += 1
        for (let index = 0; index < segment.items.length; index += MAX_TOOLS_PER_VISUAL_GROUP) {
          const chunk = segment.items.slice(index, index + MAX_TOOLS_PER_VISUAL_GROUP)
          const continuation = index === 0 ? '' : '（续）'
          blocks.push({
            body: [
              `**操作组 ${groupNumber}${continuation} · ${chunk.length} 项**`,
              ...chunk.map((tool) => renderTool(tool, snapshot.run.status))
            ].join('\n\n'),
            operationCount: chunk.length
          })
        }
      } else {
        blocks.push({
          body: renderTool(segment.items[0], snapshot.run.status),
          operationCount: 1
        })
      }
    }
  }
  const publicOutput = snapshot.publicOutput?.trim() ?? ''
  if (publicOutput && !blocks.some((block) => block.body.trim() === publicOutput)) {
    blocks.push({ body: publicOutput, operationCount: 0 })
  }
  return blocks.length > 0
    ? blocks
    : [{ body: '没有可展示的执行记录。', operationCount: 0 }]
}

function executionBlocks(
  items: GroupedExecutionProgressItem[],
  runStatus: AgentRunView['status']
): string[] {
  const blocks: string[] = []
  for (const item of items) {
    if (item.kind === 'toolGroup') {
      blocks.push(...item.items.map((tool) => renderTool(tool, runStatus)))
      continue
    }
    const body = renderNonGroupItem(item, runStatus)
    if (body) blocks.push(body)
  }
  return blocks
}

function renderNonGroupItem(
  item: Exclude<GroupedExecutionProgressItem, { kind: 'toolGroup' }>,
  runStatus: AgentRunView['status']
): string {
  if (item.kind === 'narration') return item.body.trim()
  if (item.kind === 'plan') {
    const lines = item.plan.map((step) => {
      const mark = step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '●' : '○'
      return `${mark} ${step.step}`
    })
    return [item.explanation, ...lines].filter(Boolean).join('\n').trim()
  }
  if (item.kind === 'diagnostic') {
    return `○ 正在重试运行时请求（${item.diagnostic.attempt}/${item.diagnostic.maxAttempts}）`
  }
  return renderTool(item, runStatus)
}

function splitTerminalToolGroup(
  items: ToolProgressItem[],
  runStatus: AgentRunView['status']
): Array<{ grouped: boolean; items: ToolProgressItem[] }> {
  const segments: Array<{ grouped: boolean; items: ToolProgressItem[] }> = []
  let grouped: ToolProgressItem[] = []
  const flush = (): void => {
    if (grouped.length > 0) segments.push({ grouped: true, items: grouped })
    grouped = []
  }
  for (const item of items) {
    const status = activityStatusForAgentRun(item.step.status, runStatus)
    if (status === 'failed' || status === 'waiting' || status === 'stopped') {
      flush()
      segments.push({ grouped: false, items: [item] })
    } else {
      grouped.push(item)
    }
  }
  flush()
  return segments
}

function paginateExecutionBlocks(blocks: ExecutionCardBlock[]): ExecutionCardBlock[][] {
  const pages: ExecutionCardBlock[][] = []
  let page: ExecutionCardBlock[] = []
  let characters = 0
  let operations = 0
  const flush = (): void => {
    if (page.length > 0) pages.push(page)
    page = []
    characters = 0
    operations = 0
  }
  for (const block of blocks) {
    const separatorCharacters = page.length > 0 ? 2 : 0
    const exceedsCharacters = page.length > 0
      && characters + separatorCharacters + block.body.length > EXPANDED_PAGE_CHAR_BUDGET
    const exceedsOperations = page.length > 0
      && operations + block.operationCount > EXPANDED_PAGE_OPERATION_BUDGET
    if (exceedsCharacters || exceedsOperations) flush()
    page.push(block)
    characters += separatorCharacters + block.body.length
    operations += block.operationCount
  }
  flush()
  return pages.length > 0 ? pages : [[{ body: '没有可展示的执行记录。', operationCount: 0 }]]
}

function renderTool(item: ToolProgressItem, runStatus: AgentRunView['status']): string {
  const status = activityStatusForAgentRun(item.step.status, runStatus)
  const lines = [`${statusIcon(status)} ${item.step.title}`]
  if (item.step.fileChanges?.length) {
    for (const change of item.step.fileChanges) {
      const delta = `${change.additions > 0 ? ` +${change.additions}` : ''}${change.deletions > 0 ? ` −${change.deletions}` : ''}`
      lines.push(`\`${change.path}\`${delta}`)
    }
  } else if (item.step.detail.trim()) {
    lines.push(item.step.detail.trim())
  }
  return lines.join('\n')
}

function terminalSummaryLine(
  status: AgentRunView['status'],
  summary: ExecutionConsoleTerminalSummary
): string {
  const parts: string[] = []
  if (status === 'succeeded') {
    parts.push(summary.visibleOperationCount > 0
      ? `已执行 ${summary.visibleOperationCount} 项操作`
      : '已完成')
  } else {
    if (summary.completedOperationCount > 0) {
      parts.push(`已完成 ${summary.completedOperationCount} 项操作`)
    }
    if (summary.failedOperationCount > 0) {
      parts.push(`${summary.failedOperationCount} 项失败`)
    }
    if (summary.waitingOperationCount > 0) {
      parts.push(`${summary.waitingOperationCount} 项未完成`)
    }
    if (parts.length === 0) parts.push(status === 'cancelled' ? '本次执行已停止' : '执行未完成')
  }
  const duration = formatDuration(summary.durationMs)
  if (duration) parts.push(`用时 ${duration}`)
  return parts.join(' · ')
}

function safeFailureSummary(
  failedTool: ToolProgressItem | undefined,
  terminalReasonCode: string | null
): string {
  if (failedTool) {
    const detail = failedTool.step.detail.trim().split(/\r?\n/, 1)[0]
    return boundedPlainText(detail || failedTool.step.title, 120)
  }
  if (terminalReasonCode === 'runtime_interrupted') return '运行时连接中断'
  return '执行未完成'
}

function durationMs(startedAt: string | null, terminalAt: string | null): number | null {
  if (!startedAt || !terminalAt) return null
  const started = Date.parse(startedAt)
  const terminal = Date.parse(terminalAt)
  if (!Number.isFinite(started) || !Number.isFinite(terminal) || terminal < started) return null
  return terminal - started
}

function formatDuration(value: number | null): string | null {
  if (value === null) return null
  const seconds = Math.max(1, Math.round(value / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return remainingSeconds > 0
    ? `${minutes} 分 ${remainingSeconds} 秒`
    : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours} 小时 ${remainingMinutes} 分` : `${hours} 小时`
}

function appendPublicOutput(blocks: string[], publicOutput: string | null): void {
  const output = publicOutput?.trim() ?? ''
  if (output && !blocks.some((block) => block.trim() === output)) blocks.push(output)
}

function actionValue(
  action: 'execution_console_expand'
    | 'execution_console_collapse'
    | 'execution_console_prev_page'
    | 'execution_console_next_page',
  snapshot: ExecutionConsoleSnapshot,
  view: ExecutionConsoleViewState
): Record<string, unknown> {
  return {
    action,
    agentRunId: snapshot.agentRunId,
    expectedViewVersion: view.viewVersion,
    expectedSnapshotSequence: snapshot.sequence,
    nonce: view.nonce
  }
}

function cardButton(text: string, value: Record<string, unknown>): Record<string, unknown> {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type: 'default',
    value
  }
}

function baseCard(
  title: string,
  template: 'grey' | 'blue' | 'orange' | 'green' | 'red',
  elements: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    schema: '2.0',
    config: { update_multi: true },
    header: {
      title: { tag: 'plain_text', content: title },
      template
    },
    body: { elements }
  }
}

function terminalTitle(run: ExecutionConsoleSnapshot['run']): string {
  if (run.status === 'failed') return '执行失败'
  return agentRunPresentation(run).label
}

function statusIcon(status: ActivityStatus): string {
  switch (status) {
    case 'running': return '●'
    case 'completed': return '✓'
    case 'waiting': return '○'
    case 'failed': return '✕'
    case 'stopped': return '■'
    case 'recorded': return '◇'
  }
}

function cardTemplate(
  status: AgentRunView['status'],
  waitReason: string | null
): 'grey' | 'blue' | 'orange' | 'green' | 'red' {
  if (status === 'succeeded') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'waiting' || waitReason) return 'orange'
  if (status === 'running') return 'blue'
  return 'grey'
}

function isTerminal(status: AgentRunView['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function boundedPlainText(value: string, maxCharacters: number): string {
  const characters = Array.from(value.trim())
  return characters.length <= maxCharacters
    ? characters.join('')
    : `${characters.slice(0, maxCharacters - 1).join('')}…`
}
