import { describe, expect, it } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import {
  executionConsoleCard,
  executionConsolePages,
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
  status: 'completed' | 'failed',
  output?: string
): AgentRunExecutionEvidenceView {
  return evidence(sequence, 'activity.completed', 'command', status, {
    item: { type: 'commandExecution', command, status, aggregatedOutput: output }
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
  return body.elements
    .filter((element) => element.tag === 'markdown')
    .map((element) => element.content ?? '')
    .join('\n\n')
}

function cardButtons(card: Record<string, unknown>): Array<Record<string, unknown>> {
  const buttons: Array<Record<string, unknown>> = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.tag === 'button') buttons.push(record)
    Object.values(record).forEach(visit)
  }
  visit(card.body)
  return buttons
}

describe('Feishu execution console card', () => {
  it('keeps a live console expanded and reuses the complete safe command presentation', () => {
    const card = executionConsoleCard(snapshot('running', {
      evidence: [
        narrationEvidence(1, '正在检查项目。'),
        commandEvidence(2, "sed -n '5p;15p' .rovai-validation/merge-target.txt", 'completed', '05 echo-v4')
      ]
    }))

    expect(card).toMatchObject({
      schema: '2.0',
      header: {
        title: { content: '芝士 · 执行中' },
        template: 'blue'
      }
    })
    expect(cardBody(card)).toContain('正在检查项目。')
    expect(cardBody(card)).toContain("sed -n '5p;15p' .rovai-validation/merge-target.txt")
    expect(cardBody(card)).not.toContain('05 echo-v4')
    expect(cardButtons(card)).toEqual([])
  })

  it('renders every terminal command directly in chronological order', () => {
    const card = executionConsoleCard(snapshot('succeeded', {
      evidence: [
        narrationEvidence(1, '先运行两项核验。'),
        commandEvidence(2, 'pnpm typecheck', 'completed', 'type output'),
        narrationEvidence(3, '类型检查已完成，继续测试。'),
        commandEvidence(4, 'pnpm test -- channel-settings', 'completed', 'test output')
      ],
      publicOutput: '实现与验证都已完成。'
    }))

    expect(card).toMatchObject({
      header: {
        title: { content: '芝士 · 已完成' },
        template: 'green'
      }
    })
    const body = cardBody(card)
    expect(body).toContain('用时 28 秒')
    expect(cardBody(card)).toContain('先运行两项核验。')
    expect(body.indexOf('pnpm typecheck')).toBeLessThan(body.indexOf('类型检查已完成'))
    expect(body.indexOf('类型检查已完成')).toBeLessThan(body.indexOf('pnpm test -- channel-settings'))
    expect(body).toContain('实现与验证都已完成。')
    expect(body).not.toContain('已执行 2 项操作')
    expect(body).not.toContain('type output')
    expect(body).not.toContain('test output')
    expect(cardButtons(card)).toEqual([])
  })

  it('shows failed commands without copying stderr or synthesized failure text', () => {
    const failed = snapshot('failed', {
      evidence: [
        commandEvidence(1, 'pnpm typecheck', 'completed', 'ok'),
        commandEvidence(2, 'cargo test -p rovai-core channel_execution_console', 'failed', 'secret stderr')
      ],
      terminalAt: '2026-08-28T00:00:31Z'
    })

    const card = executionConsoleCard(failed)
    expect(card).toMatchObject({
      header: { title: { content: '芝士 · 执行失败' }, template: 'red' }
    })
    expect(cardBody(card)).toContain('✓ pnpm typecheck')
    expect(cardBody(card)).toContain('✕ cargo test -p rovai-core channel_execution_console')
    expect(cardBody(card)).not.toContain('secret stderr')
    expect(cardBody(card)).not.toContain('命令执行失败')
  })

  it('paginates at twenty commands without merging operations', () => {
    const run = snapshot('succeeded', {
      evidence: Array.from({ length: 45 }, (_, index) => (
        commandEvidence(index + 1, `command-${index + 1} --flag path/${index + 1}`, 'completed')
      ))
    })
    const pages = executionConsolePages(run)

    expect(pages).toHaveLength(3)
    expect(pages[0].body.match(/✓ command-/g)).toHaveLength(20)
    expect(pages[1].body.match(/✓ command-/g)).toHaveLength(20)
    expect(pages[2].body.match(/✓ command-/g)).toHaveLength(5)
    expect(pages.map((page) => page.body).join('\n')).not.toContain('操作组')

    const card = executionConsoleCard(run, 1)
    expect(cardBody(card)).toContain('command-21 --flag path/21')
    expect(cardBody(card)).toContain('command-40 --flag path/40')
    expect(cardBody(card)).not.toContain('command-20 --flag path/20')
    expect(cardButtons(card)).toEqual([
      expect.objectContaining({
        text: expect.objectContaining({ content: '上一页' }),
        behaviors: [{ type: 'callback', value: {
          action: 'execution_console_page', agentRunId: 'run-1', snapshotSequence: 1, pageIndex: 0
        } }]
      }),
      expect.objectContaining({
        text: expect.objectContaining({ content: '下一页' }),
        behaviors: [{ type: 'callback', value: {
          action: 'execution_console_page', agentRunId: 'run-1', snapshotSequence: 1, pageIndex: 2
        } }]
      })
    ])
    expect(JSON.stringify(card.body)).toContain('第 2 / 3 页')
    expect(JSON.stringify(card.body)).not.toContain('expectedViewVersion')
    expect(JSON.stringify(card.body)).not.toContain('nonce')
  })

  it('keeps sensitive command values redacted and omits all tool input and output', () => {
    const command = "TOKEN=top-secret rovai send --public-only --body 'private message' && curl -H 'Cookie: session=private-cookie' https://example.test"
    const run = snapshot('succeeded', {
      evidence: [
        commandEvidence(1, command, 'completed', 'raw stdout'),
        evidence(2, 'runtime.action', 'tool_call', 'completed', {
          kind: 'tool',
          input: { token: 'private-input' },
          output: { body: 'private-output' }
        })
      ]
    })

    const body = cardBody(executionConsoleCard(run))
    expect(body).toContain('TOKEN=[已隐藏] rovai send --public-only --body [已隐藏]')
    expect(body).not.toContain('top-secret')
    expect(body).not.toContain('private message')
    expect(body).toContain('"Cookie: [已隐藏]"')
    expect(body).not.toContain('private-cookie')
    expect(body).not.toContain('raw stdout')
    expect(body).not.toContain('private-input')
    expect(body).not.toContain('private-output')
  })

  it('shows apply_patch file deltas but never its patch payload', () => {
    const patch = evidence(1, 'runtime.action', 'tool_call', 'completed', {
      kind: 'tool',
      input: { patch: '*** Begin Patch\n-secret patch body-\n*** End Patch' },
      output: { status: 'ok' }
    })
    patch.canonical = {
      operationId: 'patch-1',
      activityDomain: 'file',
      semanticKind: 'apply_patch',
      toolName: 'apply_patch',
      presentationHint: 'apply_patch',
      phase: 'terminal',
      outcome: 'succeeded',
      credibility: 'runtime_structured',
      coverageLevel: 'fine_grained',
      sourceAuthority: 'runtime',
      sourceEvidenceIds: ['evidence-1'],
      classifierVersion: 'activity-v1',
      firstEvidenceSequence: 1,
      lastEvidenceSequence: 1,
      revision: 1,
      diffProjection: {
        schemaVersion: 1,
        source: 'runtime_reported',
        revision: 1,
        sourceEvidenceIds: ['evidence-1'],
        status: 'available',
        semanticKind: 'exact_mutation',
        entries: [{
          path: 'src/foo.ts',
          changeKind: 'update',
          additions: 4,
          deletions: 2,
          diff: '@@ -1 +1 @@\n-secret patch body'
        }]
      }
    }

    const body = cardBody(executionConsoleCard(snapshot('succeeded', { evidence: [patch] })))
    expect(body).toContain('✓ 修改 foo.ts')
    expect(body).toContain('`src/foo.ts` +4 −2')
    expect(body).not.toContain('secret patch body')
    expect(body).not.toContain('*** Begin Patch')
  })
})
