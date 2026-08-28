import type { AgentRunExecutionEvidenceView, AgentRunView } from '@contracts'
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
  toolActivityGroupPresentation,
  type ToolProgressItem
} from './tool-grouping'

const MAX_CARD_BODY_CHARS = 22_000
const MAX_SINGLE_BLOCK_CHARS = 6_000

export interface ExecutionConsoleSnapshot {
  sequence: number
  agentRunId: string
  agentDisplayName: string
  run: Pick<AgentRunView, 'status' | 'waitReason' | 'terminalReasonCode'>
  evidence: AgentRunExecutionEvidenceView[]
  publicOutput: string | null
}

export function executionConsoleCard(snapshot: ExecutionConsoleSnapshot): Record<string, unknown> {
  const status = agentRunPresentation(snapshot.run)
  const progress = buildLiveExecutionProgress(
    snapshot.evidence.map(liveRuntimeEventFromExecutionEvidence),
    snapshot.agentRunId
  )
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(snapshot.run.status)
  const blocks = executionBlocks(progress.items, snapshot.run.status, terminal)
  const publicOutput = snapshot.publicOutput?.trim() ?? ''
  if (publicOutput && !blocks.some((block) => block.trim() === publicOutput)) {
    blocks.push(publicOutput)
  }
  const body = boundExecutionBlocks(blocks.length > 0 ? blocks : ['正在准备执行…'])
  return {
    schema: '2.0',
    config: { update_multi: true, wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: `${snapshot.agentDisplayName} · ${status.label}`
      },
      template: cardTemplate(snapshot.run.status, snapshot.run.waitReason)
    },
    body: {
      elements: [{ tag: 'markdown', content: body }]
    }
  }
}

function executionBlocks(
  items: ExecutionProgressItem[],
  runStatus: AgentRunView['status'],
  terminal: boolean
): string[] {
  const blocks: string[] = []
  for (const item of groupConsecutiveToolItems(items)) {
    if (item.kind === 'narration') {
      blocks.push(item.body)
      continue
    }
    if (item.kind === 'plan') {
      const lines = item.plan.map((step) => {
        const mark = step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '●' : '○'
        return `${mark} ${step.step}`
      })
      blocks.push([item.explanation, ...lines].filter(Boolean).join('\n'))
      continue
    }
    if (item.kind === 'diagnostic') {
      const retry = item.diagnostic
      blocks.push(`○ 正在重试运行时请求（${retry.attempt}/${retry.maxAttempts}）`)
      continue
    }
    if (item.kind === 'tool') {
      blocks.push(renderTool(item, runStatus))
      continue
    }
    if (!terminal) {
      blocks.push(...item.items.map((tool) => renderTool(tool, runStatus)))
      continue
    }
    blocks.push(...renderTerminalToolGroup(item.items, runStatus))
  }
  return blocks.filter((block) => block.trim().length > 0)
}

function renderTerminalToolGroup(
  items: ToolProgressItem[],
  runStatus: AgentRunView['status']
): string[] {
  const blocks: string[] = []
  let collapsible: ToolProgressItem[] = []
  const flush = (): void => {
    if (collapsible.length === 0) return
    const presentation = toolActivityGroupPresentation(collapsible, runStatus)
    blocks.push(`✓ ${presentation.primary}`)
    collapsible = []
  }
  for (const item of items) {
    const status = activityStatusForAgentRun(item.step.status, runStatus)
    if (status === 'completed' || status === 'recorded') {
      collapsible.push(item)
      continue
    }
    flush()
    blocks.push(renderTool(item, runStatus))
  }
  flush()
  return blocks
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

function boundExecutionBlocks(input: string[]): string {
  const blocks = input.map((block) => truncateBlock(block.trim())).filter(Boolean)
  const joined = blocks.join('\n\n')
  if (joined.length <= MAX_CARD_BODY_CHARS) return joined
  const kept = [blocks[0]]
  const tail: string[] = []
  let used = kept[0].length
  for (let index = blocks.length - 1; index > 0; index -= 1) {
    const candidate = blocks[index]
    if (used + candidate.length + 120 > MAX_CARD_BODY_CHARS) break
    tail.unshift(candidate)
    used += candidate.length + 2
  }
  const omitted = Math.max(1, blocks.length - kept.length - tail.length)
  return [...kept, `中间 ${omitted} 条执行记录已折叠`, ...tail].join('\n\n')
}

function truncateBlock(block: string): string {
  if (block.length <= MAX_SINGLE_BLOCK_CHARS) return block
  const head = block.slice(0, 2_000).trimEnd()
  const tail = block.slice(-(MAX_SINGLE_BLOCK_CHARS - head.length - 30)).trimStart()
  return `${head}\n\n…内容已折叠…\n\n${tail}`
}
