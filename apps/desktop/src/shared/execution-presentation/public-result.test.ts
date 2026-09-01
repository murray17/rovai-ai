import { describe, expect, it } from 'vitest'
import { buildLiveExecutionProgress, type ExecutionStep, type LiveRuntimeEvent } from './index'
import {
  executionPublicCommandPreview,
  feishuCardResultPreview,
  truncateDisplayColumns
} from './public-result'

function event(payload: unknown, eventType = 'runtime.action', id = 'operation-1'): LiveRuntimeEvent {
  return { id, agentRunId: 'run-1', eventType, payload, createdAt: '2026-08-31T00:00:00Z' }
}

function step(events: LiveRuntimeEvent[]): ExecutionStep {
  const item = buildLiveExecutionProgress(events, 'run-1').items.find((item) => item.kind === 'tool')
  if (!item || item.kind !== 'tool') throw new Error('Expected a public execution step')
  return item.step
}

describe('ExecutionStep publicResult boundary', () => {
  it.each([
    { output: 'plain result', expected: 'plain result' },
    { output: { stdout: 'stdout result', stderr: 'stderr result' }, expected: 'stdout result\nstderr result' },
    { output: { content: [{ type: 'text', text: 'typed result' }, { type: 'image', data: 'not-public-image' }] }, expected: 'typed result' },
    { output: { output: 'nested result' }, expected: 'nested result' },
    { output: { input: 'not-a-result', arbitrary: 'not-public-json' }, expected: null }
  ])('extracts only explicitly typed result text: $expected', ({ output, expected }) => {
    expect(step([event({ kind: 'tool', status: 'completed', input: { stdin: 'private-stdin' }, output })]).publicResult).toBe(expected)
  })

  it.each([
    { coreEnvelope: { result: { stdout: 'core stdout' } }, expected: 'core stdout' },
    { coreEnvelope: { error: 'core error' }, expected: 'core error' },
    { coreEnvelope: { error: { code: 'failure', message: 'bounded error message', input: 'private-error-input' } }, expected: 'bounded error message' },
    { operationProjection: { canonicalResult: { content: [{ type: 'text', text: 'canonical result' }] } }, expected: 'canonical result' }
  ])('accepts Core result/error and canonicalResult fields without serializing envelopes: $expected', ({ expected, ...payload }) => {
    const projected = step([event({ kind: 'tool', status: 'completed', sourceAuthority: 'core', canonicalTool: 'camp.read', ...payload })])
    expect(projected.publicResult).toBe(expected)
    expect(projected.publicResult).not.toContain('private-error-input')
  })

  it('keeps local input detail separate and never uses it as a public result fallback', () => {
    const projected = step([event({ kind: 'tool', status: 'completed', input: { query: 'local-input-only', stdin: 'typed-password' } })])
    expect(projected.detail).toContain('local-input-only')
    expect(projected.publicResult).toBeNull()
    expect(projected.publicCommand).toBeNull()
  })

  it('does not promote runtime-supplied Core envelope fields into trusted results', () => {
    expect(step([event({ kind: 'tool', status: 'completed', coreEnvelope: { result: 'spoofed-result' }, operationProjection: { canonicalResult: 'spoofed-canonical' } })]).publicResult).toBeNull()
  })

  it('only releases a result after completion, accumulating output deltas for the same operation', () => {
    const started = event({ item: { type: 'commandExecution', command: 'check --path src/file.ts', status: 'inProgress' } }, 'activity.started')
    const delta = event({ delta: 'first line\nsecond line\n' }, 'command.output.delta')
    expect(step([started, delta]).publicResult).toBeNull()
    const complete = event({ item: { type: 'commandExecution', command: 'check --path src/file.ts', status: 'completed' } }, 'activity.completed')
    const projected = step([started, delta, complete])
    expect(projected.publicCommand).toBe('check --path src/file.ts')
    expect(projected.publicResult).toBe('first line\nsecond line')
    expect(buildLiveExecutionProgress([started, delta, complete], 'run-1').items.filter((item) => item.kind === 'tool')).toHaveLength(1)
  })

  it('normalizes ANSI before detecting raw patches and JSON result envelopes', () => {
    const projected = step([event({ kind: 'tool', status: 'completed', output: '\u001b[32m*** Begin Patch\u001b[0m\n+private-patch\n*** End Patch' })])
    expect(projected.publicResult).toBe('（原始补丁已隐藏）')
    expect(step([event({ kind: 'tool', status: 'completed', output: '\u001b[32m{"input":"private-json"}\u001b[0m' })]).publicResult).toBe('（结构化工具结果已隐藏）')
  })

  it('redacts all Run evidence before truncation and retains both ends of dense lines', () => {
    const output = Array.from({ length: 210 }, (_, index) => `line ${index + 1}: ${'项目😀'.repeat(80)} tail-${index + 1}`).join('\n')
    const projected = step([event({ item: { type: 'commandExecution', command: 'check', status: 'completed', aggregatedOutput: output } }, 'activity.completed')])
    expect(projected.publicResult?.split('\n')).toHaveLength(20)
    expect(Buffer.byteLength(projected.publicResult!)).toBeLessThanOrEqual(4_096)
    expect(projected.publicResult).toContain('line 1:')
    expect(projected.publicResult).toContain('tail-210')
    expect(projected.publicResult).toContain('… 已截断 191 行 …')
    expect(projected.publicResult).not.toContain('\uFFFD')
    expect(projected.detail).toContain('line 100:') // Local full evidence is not truncated by the channel preview.
  })

  it('does not expose send body echoes, even in an otherwise textual result', () => {
    const projected = step([event({ item: { type: 'commandExecution', command: 'rovai send --public-only --body "private-message"', status: 'completed', aggregatedOutput: 'private-message' } }, 'activity.completed')])
    expect(projected.publicResult).toBe('（消息内容不在执行结果中重复展示）')
    expect(projected.publicCommand).not.toContain('private-message')
  })
})

describe('compact channel execution previews', () => {
  it('keeps the useful head and tail of a long shell command within an approximate card width', () => {
    const projected = step([event({
      item: {
        type: 'commandExecution',
        command: `pnpm vitest ${'apps/desktop/really-long-directory/'.repeat(4)}final.test.ts`,
        status: 'completed'
      }
    }, 'activity.completed')])
    const preview = executionPublicCommandPreview(projected, (value) => value)

    expect(preview).toMatch(/^\$ pnpm vitest /u)
    expect(preview).toContain('…')
    expect(preview).toMatch(/final\.test\.ts$/u)
    expect(Array.from(preview)).toHaveLength(72)
  })

  it('uses display width for Chinese commands and omits the shell prompt for apply_patch', () => {
    expect(truncateDisplayColumns('检查'.repeat(40), 12)).toBe('检查检查…查')
    const patchStep: ExecutionStep = {
      id: 'patch-1', title: 'apply_patch', publicCommand: 'raw patch must not be used',
      publicResult: null, detail: '', status: 'completed', activityDomain: 'file',
      iconKind: 'file', toolName: 'apply_patch', credibility: 'runtime_structured'
    }
    expect(executionPublicCommandPreview(patchStep, (value) => value)).toBe('apply_patch')
  })

  it('limits Feishu folded results to two compact logical lines', () => {
    const preview = feishuCardResultPreview([
      'first line',
      `second ${'result '.repeat(20)}tail`,
      'third line must stay hidden'
    ].join('\n'))

    expect(preview?.split('\n')).toHaveLength(2)
    expect(preview).toContain('first line')
    expect(preview).toContain('…')
    expect(preview).not.toContain('third line')
  })
})
