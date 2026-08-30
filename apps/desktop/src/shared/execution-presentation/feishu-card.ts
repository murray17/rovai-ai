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
import { boundFeishuPreviewLine, createFeishuCommandProjector } from './feishu-result-preview'

// The plain projection is also used by DingTalk; its contract is unchanged.
const PLAIN_PAGE_CHAR_BUDGET = 10_000
const PLAIN_PAGE_OPERATION_BUDGET = 20
const FEISHU_PAGE_COMMAND_BUDGET = 15
const FEISHU_PAGE_ELEMENT_BUDGET = 50
const FEISHU_PAGE_BYTE_BUDGET = 24_000
type CardElement = Record<string, unknown>
type TimelineBlock = { kind: 'text' | 'command'; element: CardElement }
type TerminalTimeline = { pages: TimelineBlock[][]; commandCount: number }

export interface ExecutionConsoleCardOptions {
  pageIndex?: number
  outerExpanded?: boolean
}

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

export interface ExecutionConsolePublicPage {
  title: string
  body: string
  pageIndex: number
  pageCount: number
  terminal: boolean
  failed: boolean
}

type ExecutionCardBlock = {
  kind: 'process' | 'public_output'
  body: string
  operationCount: number
}

export function executionConsoleCard(
  snapshot: ExecutionConsoleSnapshot,
  options?: ExecutionConsoleCardOptions
): Record<string, unknown> {
  if (!isTerminal(snapshot.run.status)) return renderLiveExecutionCard(snapshot)
  return renderTerminalExecutionCard(snapshot, options)
}

export function executionConsolePages(snapshot: ExecutionConsoleSnapshot): ExecutionConsolePage[] {
  return executionPages(expandedExecutionBlocks(snapshot))
}

function executionPages(
  blocks: ExecutionCardBlock[],
  characterBudget = PLAIN_PAGE_CHAR_BUDGET
): ExecutionConsolePage[] {
  const pages = paginateExecutionBlocks(blocks, characterBudget)
  return pages.map((blocks, pageIndex) => ({
    pageIndex,
    pageCount: pages.length,
    body: blocks.map((block) => block.body).join('\n\n') || '没有可展示的执行记录。'
  }))
}

export function executionConsolePageCount(snapshot: ExecutionConsoleSnapshot): number {
  return isTerminal(snapshot.run.status) ? terminalTimelinePages(snapshot).pages.length : 1
}

export function executionConsolePublicPage(
  snapshot: ExecutionConsoleSnapshot,
  requestedPageIndex = 0
): ExecutionConsolePublicPage {
  if (!isTerminal(snapshot.run.status)) {
    const status = agentRunPresentation(snapshot.run)
    return {
      title: `${boundedPlainText(snapshot.agentDisplayName, 80)} · ${status.label}`,
      body: liveExecutionBlocks(snapshot).join('\n\n') || '正在准备执行…',
      pageIndex: 0,
      pageCount: 1,
      terminal: false,
      failed: false
    }
  }
  const pages = executionConsolePages(snapshot)
  const pageIndex = Math.min(Math.max(0, requestedPageIndex), pages.length - 1)
  const duration = formatDuration(durationMs(snapshot.startedAt, snapshot.terminalAt))
  return {
    title: `${boundedPlainText(snapshot.agentDisplayName, 80)} · ${terminalTitle(snapshot.run)}`,
    body: [duration ? `用时 ${duration}` : '', pages[pageIndex].body].filter(Boolean).join('\n\n'),
    pageIndex,
    pageCount: pages.length,
    terminal: true,
    failed: snapshot.run.status === 'failed'
  }
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
  options: ExecutionConsoleCardOptions | undefined
): Record<string, unknown> {
  const { pages, commandCount } = terminalTimelinePages(snapshot)
  const requestedPageIndex = options?.pageIndex
  const requested = Number.isInteger(requestedPageIndex) ? requestedPageIndex ?? 0 : 0
  const pageIndex = Math.min(Math.max(0, requested), pages.length - 1)
  return terminalTimelineCard(snapshot, pages[pageIndex], pageIndex, pages.length, commandCount, options?.outerExpanded === true)
}

function terminalTimelineCard(
  snapshot: ExecutionConsoleSnapshot,
  blocks: TimelineBlock[],
  pageIndex: number,
  pageCount: number,
  commandCount: number,
  outerExpanded = false
): Record<string, unknown> {
  const elements: CardElement[] = []
  const duration = formatDuration(durationMs(snapshot.startedAt, snapshot.terminalAt))
  if (duration) elements.push({ tag: 'markdown', content: `用时 ${duration}` })
  const timeline = blocks.map((block) => block.element)
  if (pageCount > 1) {
    timeline.push({ tag: 'markdown', content: `第 ${pageIndex + 1} / ${pageCount} 页`, text_align: 'center' })
    timeline.push(cardPaginationRow(snapshot, pageIndex, pageCount))
  }
  elements.push({
    tag: 'collapsible_panel',
    element_id: 'execution_process',
    expanded: outerExpanded,
    header: {
      title: { tag: 'plain_text', content: commandCount ? `执行过程 · ${commandCount} 条` : '执行过程' },
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
      icon_position: 'left',
      icon_expanded_angle: -180
    },
    vertical_spacing: '8px',
    padding: '0px',
    // Both levels expand locally. Only the page buttons carry callbacks.
    elements: timeline
  })
  return baseCard(
    `${boundedPlainText(snapshot.agentDisplayName, 80)} · ${terminalTitle(snapshot.run)}`,
    cardTemplate(snapshot.run.status, snapshot.run.waitReason),
    elements
  )
}

function terminalTimelineBlocks(snapshot: ExecutionConsoleSnapshot): TimelineBlock[] {
  const items = progressItems(snapshot, true)
  const commandProjection = createFeishuCommandProjector(snapshot.evidence, snapshot.agentRunId)
  const blocks: TimelineBlock[] = items.flatMap((item, index): TimelineBlock[] => {
    if (item.kind !== 'tool') {
      const body = renderNonGroupItem(item, snapshot.run.status)
      return body ? [textBlock(body)] : []
    }
    const { title, result } = commandProjection(item.step)
    return [{
      kind: 'command',
      element: {
        tag: 'collapsible_panel',
        element_id: `command_${index}`,
        // Local Feishu client state only. No callback behavior on a command.
        expanded: false,
        header: {
          title: {
            tag: 'plain_text',
            content: `${statusIcon(activityStatusForAgentRun(item.step.status, snapshot.run.status))} ${title}`
          },
          icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
          icon_position: 'right',
          icon_expanded_angle: -180
        },
        vertical_spacing: '8px',
        padding: '8px 0px 8px 0px',
        elements: [resultFrame(result)]
      }
    }]
  })
  const output = snapshot.publicOutput?.trim()
  if (output && !items.some((item) => item.kind === 'narration' && item.body.trim() === output)) {
    blocks.push(textBlock(output))
  }
  return blocks.length ? blocks : [textBlock('没有可展示的执行记录。')]
}

function textBlock(body: string): TimelineBlock {
  const lines = body.trim().replace(/\r\n?/gu, '\n').split('\n')
  const preview = lines.length <= 10 ? lines : [...lines.slice(0, 9), `… 已截断 ${lines.length - 9} 行 …`]
  return { kind: 'text', element: { tag: 'markdown', content: preview.map((line) => boundFeishuPreviewLine(line)).join('\n') } }
}

function resultFrame(result: string): CardElement {
  // An output fence must not be able to end the single neutral result frame.
  return { tag: 'markdown', content: `\`\`\`text\n${result.replace(/`{3}/gu, '`\u200b``')}\n\`\`\`` }
}

function terminalTimelinePages(snapshot: ExecutionConsoleSnapshot): TerminalTimeline {
  const rawBlocks = terminalTimelineBlocks(snapshot)
  const commandCount = rawBlocks.filter((block) => block.kind === 'command').length
  const fits = (blocks: TimelineBlock[], paged: boolean): boolean => {
    if (blocks.filter((block) => block.kind === 'command').length > FEISHU_PAGE_COMMAND_BUDGET) return false
    // Reserve both buttons, the page counter, and the widest possible page numbers.
    const card = terminalTimelineCard(snapshot, blocks, paged ? rawBlocks.length : 0, paged ? rawBlocks.length + 2 : 1, commandCount)
    const elements = (card.body as { elements: CardElement[] }).elements
    return countCardElements(elements) <= FEISHU_PAGE_ELEMENT_BUDGET
      && new TextEncoder().encode(JSON.stringify(card)).length <= FEISHU_PAGE_BYTE_BUDGET
  }
  const blocks = rawBlocks.map((block) => {
    if (fits([block], true)) return block
    // Results are already line-bounded. Preserve a very long safe command before
    // giving up its preview; never silently shorten a command into a different one.
    if (block.kind === 'command') {
      const withoutResult = {
        ...block,
        element: { ...block.element, elements: [resultFrame('（结果过长，请在 Rovai 查看）')] }
      }
      if (fits([withoutResult], true)) return withoutResult
    }
    return textBlock('这条执行记录超出飞书单卡大小限制，请在 Rovai 查看完整记录。')
  })
  if (fits(blocks, false)) return { pages: [blocks], commandCount }
  const pages: TimelineBlock[][] = []
  let page: TimelineBlock[] = []
  for (let index = 0; index < blocks.length;) {
    const next = blocks[index + 1]
    const pair = blocks[index].kind === 'text' && next?.kind === 'command'
      ? [blocks[index], next]
      : null
    const unit = pair && fits(pair, true) ? pair : [blocks[index]]
    if (page.length && !fits([...page, ...unit], true)) {
      pages.push(page)
      page = []
    }
    page.push(...unit)
    index += unit.length
  }
  if (page.length) pages.push(page)
  return { pages, commandCount }
}

function countCardElements(elements: CardElement[]): number {
  return elements.reduce((count, element) => count + 1
    + countCardElements((element.elements ?? []) as CardElement[])
    + countCardElements((element.columns ?? []) as CardElement[]), 0)
}

function progressItems(snapshot: ExecutionConsoleSnapshot, complete = false): ExecutionProgressItem[] {
  return buildLiveExecutionProgress(
    snapshot.evidence.map(liveRuntimeEventFromExecutionEvidence),
    snapshot.agentRunId,
    { textMode: complete ? 'complete' : 'live_tail' }
  ).items
}

function liveExecutionBlocks(snapshot: ExecutionConsoleSnapshot): string[] {
  const blocks = executionBlocks(groupConsecutiveToolItems(progressItems(snapshot)), snapshot.run.status)
  appendPublicOutput(blocks, snapshot.publicOutput)
  return blocks
}

function expandedExecutionBlocks(snapshot: ExecutionConsoleSnapshot): ExecutionCardBlock[] {
  const blocks: ExecutionCardBlock[] = []
  const publicOutput = snapshot.publicOutput?.trim() ?? ''
  for (const item of progressItems(snapshot)) {
    const body = item.kind === 'tool'
      ? renderTool(item, snapshot.run.status)
      : renderNonGroupItem(item, snapshot.run.status)
    if (body) blocks.push({
      kind: item.kind === 'narration' && body === publicOutput ? 'public_output' : 'process',
      body,
      operationCount: item.kind === 'tool' ? 1 : 0
    })
  }
  if (publicOutput && !blocks.some((block) => block.body.trim() === publicOutput)) {
    blocks.push({ kind: 'public_output', body: publicOutput, operationCount: 0 })
  }
  return blocks
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

function paginateExecutionBlocks(
  blocks: ExecutionCardBlock[],
  characterBudget: number
): ExecutionCardBlock[][] {
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
      && characters + separatorCharacters + block.body.length > characterBudget
    const exceedsOperations = page.length > 0
      && operations + block.operationCount > PLAIN_PAGE_OPERATION_BUDGET
    if (exceedsCharacters || exceedsOperations) flush()
    page.push(block)
    characters += separatorCharacters + block.body.length
    operations += block.operationCount
  }
  flush()
  return pages.length > 0
    ? pages
    : [[{ kind: 'process', body: '没有可展示的执行记录。', operationCount: 0 }]]
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
