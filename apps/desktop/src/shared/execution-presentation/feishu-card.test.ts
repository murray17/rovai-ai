import { describe, expect, it } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import { executionConsoleCard, type ExecutionConsoleSnapshot } from './feishu-card'

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
    ...overrides
  }
}

function commandEvidence(
  sequence: number,
  command: string,
  status: 'completed' | 'failed'
): AgentRunExecutionEvidenceView {
  return {
    id: `evidence-${sequence}`,
    agentRunId: 'run-1',
    executionEpoch: 1,
    sequence,
    eventType: 'activity.completed',
    kind: 'command',
    phase: status,
    payload: {
      item: { type: 'commandExecution', command, status }
    },
    contentBlobId: null,
    contentByteCount: 0,
    isTruncated: false,
    occurredAt: `2026-08-28T00:00:0${sequence}Z`,
    canonical: null
  }
}

function cardBody(card: Record<string, unknown>): string {
  const body = card.body as { elements: Array<{ content: string }> }
  return body.elements[0].content
}

describe('Feishu execution console card', () => {
  it('renders an active console with Rovai execution status', () => {
    const card = executionConsoleCard(snapshot('running'))

    expect(card).toMatchObject({
      schema: '2.0',
      header: {
        title: { content: '芝士 · 执行中' },
        template: 'blue'
      }
    })
    expect(cardBody(card)).toBe('正在准备执行…')
  })

  it('collapses consecutive successful terminal tools and retains public output', () => {
    const card = executionConsoleCard(snapshot('succeeded', {
      evidence: [
        commandEvidence(1, 'pnpm typecheck', 'completed'),
        commandEvidence(2, 'pnpm test', 'completed')
      ],
      publicOutput: '实现与验证都已完成。'
    }))

    expect(card).toMatchObject({
      header: {
        title: { content: '芝士 · 已完成' },
        template: 'green'
      }
    })
    expect(cardBody(card)).toContain('✓ 已执行 2 项操作')
    expect(cardBody(card)).toContain('实现与验证都已完成。')
  })

  it('keeps failed terminal tools expanded', () => {
    const card = executionConsoleCard(snapshot('failed', {
      evidence: [commandEvidence(1, 'pnpm test', 'failed')]
    }))

    expect(card).toMatchObject({
      header: {
        title: { content: '芝士 · 失败' },
        template: 'red'
      }
    })
    expect(cardBody(card)).toContain('✕')
    expect(cardBody(card)).toContain('pnpm test')
  })
})
