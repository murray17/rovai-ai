import { describe, expect, it } from 'vitest'
import type {
  AgentRunExecutionEvidenceView,
  ExecutionConsoleViewState
} from '@contracts'
import {
  executionConsoleCard,
  executionConsolePages,
  executionConsoleTerminalSummary,
  type ExecutionConsoleSnapshot
} from './feishu-card'

function snapshot(
  status: ExecutionConsoleSnapshot['run']['status'],
  overrides: Partial<ExecutionConsoleSnapshot> = {}
): ExecutionConsoleSnapshot {
  return {
    sequence: 1,
    agentRunId: 'run-1',
    agentDisplayName: '芝士',
    run: { status, waitReason: null, terminalReasonCode: null },
    evidence: [],
    publicOutput: null,
    startedAt: '2026-08-28T00:00:00Z',
    terminalAt: status === 'succeeded' || status === 'failed' || status === 'cancelled'
      ? '2026-08-28T00:00:28Z'
      : null,
    ...overrides
  }
}

function view(
  mode: ExecutionConsoleViewState['mode'],
  overrides: Partial<ExecutionConsoleViewState> = {}
): ExecutionConsoleViewState {
  return { mode, pageIndex: 0, viewVersion: 3, nonce: 'nonce-3', ...overrides }
}

function evidence(
  sequence: number,
  eventType: string,
  kind: AgentRunExecutionEvidenceView['kind'],
  phase: AgentRunExecutionEvidenceView['phase'],
  payload: unknown
): AgentRunExecutionEvidenceView {
  return {
    id: `evidence-${sequence}`,
    agentRunId: 'run-1',
    executionEpoch: 1,
    sequence,
    eventType,
    kind,
    phase,
    payload,
    contentBlobId: null,
    contentByteCount: 0,
    isTruncated: false,
    occurredAt: `2026-08-28T00:00:${String(sequence).padStart(2, '0')}Z`,
    canonical: null
  }
}

function commandEvidence(
  sequence: number,
  command: string,
  status: 'completed' | 'failed'
): AgentRunExecutionEvidenceView {
  return evidence(sequence, 'activity.completed', 'command', status, {
    item: { type: 'commandExecution', command, status }
  })
}

function narrationEvidence(sequence: number, body: string): AgentRunExecutionEvidenceView {
  return evidence(sequence, 'agent.text.delta', 'narration', 'updated', {
    itemId: `text-${sequence}`,
    delta: body
  })
}

function cardBody(card: Record<string, unknown>): string {
  const body = card.body as { elements: Array<{ tag: string; content?: string }> }
  return body.elements.find((element) => element.tag === 'markdown')?.content ?? ''
}

function cardActions(card: Record<string, unknown>): Array<Record<string, unknown>> {
  const body = card.body as {
    elements: Array<{ tag: string; actions?: Array<Record<string, unknown>> }>
  }
  return body.elements.find((element) => element.tag === 'action')?.actions ?? []
}

describe('Feishu execution console card', () => {
  it('keeps a live console fully expanded without a collapse control', () => {
    const card = executionConsoleCard(snapshot('running', {
      evidence: [
        narrationEvidence(1, '正在检查项目。'),
        commandEvidence(2, 'pnpm test', 'completed')
      ]
    }), view('live'))

    expect(card).toMatchObject({
      schema: '2.0',
      header: {
        title: { content: '芝士 · 执行中' },
        template: 'blue'
      }
    })
    expect(cardBody(card)).toContain('正在检查项目。')
    expect(cardBody(card)).toContain('pnpm test')
    expect(cardActions(card)).toEqual([])
  })

  it('renders a successful terminal console as a quiet summary by default', () => {
    const card = executionConsoleCard(snapshot('succeeded', {
      evidence: [
        narrationEvidence(1, '这段过程默认不应出现。'),
        commandEvidence(2, 'pnpm typecheck', 'completed'),
        commandEvidence(3, 'pnpm test', 'completed')
      ],
      publicOutput: '实现与验证都已完成。'
    }), view('collapsed'))

    expect(card).toMatchObject({
      header: {
        title: { content: '芝士 · 已完成' },
        template: 'green'
      }
    })
    expect(cardBody(card)).toBe('已执行 2 项操作 · 用时 28 秒')
    expect(cardBody(card)).not.toContain('pnpm test')
    expect(cardBody(card)).not.toContain('实现与验证都已完成。')
    expect(cardActions(card)).toEqual([
      expect.objectContaining({
        text: { tag: 'plain_text', content: '查看执行过程' },
        value: {
          action: 'execution_console_expand',
          agentRunId: 'run-1',
          expectedViewVersion: 3,
          expectedSnapshotSequence: 1,
          nonce: 'nonce-3'
        }
      })
    ])
  })

  it('expands every tool operation and retains narration and Agent output', () => {
    const card = executionConsoleCard(snapshot('succeeded', {
      evidence: [
        narrationEvidence(1, '先运行两项核验。'),
        commandEvidence(2, 'pnpm typecheck', 'completed'),
        commandEvidence(3, 'pnpm test', 'completed')
      ],
      publicOutput: '两项核验都已完成。'
    }), view('expanded'))

    expect(card).toMatchObject({
      header: { title: { content: '芝士 · 执行过程' }, template: 'green' }
    })
    expect(cardBody(card)).toContain('先运行两项核验。')
    expect(cardBody(card)).toContain('**操作组 1 · 2 项**')
    expect(cardBody(card)).toContain('pnpm typecheck')
    expect(cardBody(card)).toContain('pnpm test')
    expect(cardBody(card)).toContain('两项核验都已完成。')
    expect(cardBody(card)).not.toContain('✓ 已执行 2 项操作')
    expect(cardActions(card)).toEqual([
      expect.objectContaining({ text: expect.objectContaining({ content: '收起执行过程' }) })
    ])
  })

  it('shows a safe failed summary while retaining failed details when expanded', () => {
    const failed = snapshot('failed', {
      evidence: [
        commandEvidence(1, 'pnpm typecheck', 'completed'),
        commandEvidence(2, 'pnpm test', 'failed')
      ],
      terminalAt: '2026-08-28T00:00:31Z'
    })

    const collapsed = executionConsoleCard(failed, view('collapsed'))
    expect(collapsed).toMatchObject({
      header: { title: { content: '芝士 · 执行失败' }, template: 'red' }
    })
    expect(cardBody(collapsed)).toContain('已完成 1 项操作 · 1 项失败 · 用时 31 秒')
    expect(cardBody(collapsed)).toContain('失败：')
    expect(cardBody(collapsed)).not.toContain('pnpm typecheck')

    const expanded = executionConsoleCard(failed, view('expanded'))
    expect(cardBody(expanded)).toContain('pnpm typecheck')
    expect(cardBody(expanded)).toContain('pnpm test')
    expect(cardBody(expanded)).toContain('✕')
  })

  it('does not report zero operations when a run only has narration', () => {
    const run = snapshot('succeeded', {
      evidence: [narrationEvidence(1, '已完成只读分析。')],
      terminalAt: '2026-08-28T00:00:03Z'
    })

    expect(executionConsoleTerminalSummary(run).visibleOperationCount).toBe(0)
    expect(cardBody(executionConsoleCard(run, view('collapsed')))).toBe('已完成 · 用时 3 秒')
    expect(cardBody(executionConsoleCard(run, view('expanded')))).toContain('已完成只读分析。')
  })

  it('paginates only between semantic tool blocks and clamps an obsolete page index', () => {
    const run = snapshot('succeeded', {
      evidence: Array.from({ length: 30 }, (_, index) => (
        commandEvidence(index + 1, `command-${index + 1}`, 'completed')
      ))
    })
    const pages = executionConsolePages(run)

    expect(pages).toHaveLength(2)
    expect(pages[0].body).toContain('command-1')
    expect(pages[0].body).toContain('command-20')
    expect(pages[0].body).not.toContain('command-21')
    expect(pages[1].body).toContain('command-21')
    expect(pages[1].body).toContain('command-30')

    const card = executionConsoleCard(run, view('expanded', { pageIndex: 99 }))
    expect(cardBody(card)).toContain('第 2 / 2 页')
    expect(cardBody(card)).toContain('command-30')
    expect(cardActions(card)).toEqual([
      expect.objectContaining({ text: expect.objectContaining({ content: '上一页' }) }),
      expect.objectContaining({ text: expect.objectContaining({ content: '收起执行过程' }) })
    ])
  })
})
