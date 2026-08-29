import type {
  AgentRunExecutionEvidenceView,
  AgentRunView,
  ExecutionConsolePage
} from '@contracts'
import {
  activityStatusForAgentRun,
  agentRunPresentation,
  buildLiveExecutionProgress,
  executionStepPublicTitle,
  liveRuntimeEventFromExecutionEvidence,
  type ActivityStatus,
  type ExecutionProgressItem
} from './index'
import {
  groupConsecutiveToolItems,
  type GroupedExecutionProgressItem,
  type ToolProgressItem
} from './tool-grouping'

const TERMINAL_PAGE_CHAR_BUDGET = 10_000
const TERMINAL_PAGE_OPERATION_BUDGET = 20

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
  requestedPageIndex = 0
): Record<string, unknown> {
  if (!isTerminal(snapshot.run.status)) return renderLiveExecutionCard(snapshot)
  return renderTerminalExecutionCard(snapshot, requestedPageIndex)
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

function renderTerminalExecutionCard(
  snapshot: ExecutionConsoleSnapshot,
  requestedPageIndex: number
): Record<string, unknown> {
  const pages = executionConsolePages(snapshot)
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), pages.length - 1)
  const page = pages[pageIndex]
  const elements: Record<string, unknown>[] = []
  const duration = formatDuration(durationMs(snapshot.startedAt, snapshot.terminalAt))
  if (duration) elements.push({ tag: 'markdown', content: `用时 ${duration}` })
  elements.push({ tag: 'markdown', content: page.body })
  if (page.pageCount > 1) {
    elements.push(cardPaginationRow(snapshot, pageIndex, page.pageCount))
  }
  return baseCard(
    `${boundedPlainText(snapshot.agentDisplayName, 80)} · ${terminalTitle(snapshot.run)}`,
    cardTemplate(snapshot.run.status, snapshot.run.waitReason),
    elements
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
  for (const item of progressItems(snapshot)) {
    const body = item.kind === 'tool'
      ? renderTool(item, snapshot.run.status)
      : renderNonGroupItem(item, snapshot.run.status)
    if (body) blocks.push({ body, operationCount: item.kind === 'tool' ? 1 : 0 })
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
      && characters + separatorCharacters + block.body.length > TERMINAL_PAGE_CHAR_BUDGET
    const exceedsOperations = page.length > 0
      && operations + block.operationCount > TERMINAL_PAGE_OPERATION_BUDGET
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
  const lines = [`${statusIcon(status)} ${executionStepPublicTitle(item.step)}`]
  if (item.step.fileChanges?.length) {
    for (const change of item.step.fileChanges) {
      const delta = `${change.additions > 0 ? ` +${change.additions}` : ''}${change.deletions > 0 ? ` −${change.deletions}` : ''}`
      lines.push(`\`${change.path}\`${delta}`)
    }
  }
  return lines.join('\n')
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
  snapshot: ExecutionConsoleSnapshot,
  pageIndex: number
): Record<string, unknown> {
  return {
    action: 'execution_console_page',
    agentRunId: snapshot.agentRunId,
    snapshotSequence: snapshot.sequence,
    pageIndex
  }
}

function cardPaginationRow(
  snapshot: ExecutionConsoleSnapshot,
  pageIndex: number,
  pageCount: number
): Record<string, unknown> {
  const button = (text: string, targetPageIndex: number): Record<string, unknown> => ({
    tag: 'button',
    text: { tag: 'plain_text', content: text },
    type: 'default',
    width: 'fill',
    behaviors: [{ type: 'callback', value: actionValue(snapshot, targetPageIndex) }]
  })
  const placeholder = (): Record<string, unknown> => ({
    tag: 'markdown',
    content: ' '
  })
  return {
    tag: 'column_set',
    horizontal_spacing: '8px',
    columns: [
      [pageIndex > 0 ? button('上一页', pageIndex - 1) : placeholder()],
      [{ tag: 'markdown', content: `第 ${pageIndex + 1} / ${pageCount} 页`, text_align: 'center' }],
      [pageIndex < pageCount - 1 ? button('下一页', pageIndex + 1) : placeholder()]
    ].map((elements) => ({
      tag: 'column',
      width: 'weighted',
      weight: 1,
      elements
    }))
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
