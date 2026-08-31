import { describe, expect, it } from 'vitest'
import type { AgentRunExecutionEvidenceView } from '@contracts'
import { executionConsoleCard, executionConsolePageCount, executionConsolePages, executionConsolePublicPage, type ExecutionConsoleSnapshot } from './feishu-card'

type Element = Record<string, unknown>
function snapshot(status: ExecutionConsoleSnapshot['run']['status'], overrides: Partial<ExecutionConsoleSnapshot> = {}): ExecutionConsoleSnapshot {
  return {
    sequence: 1, agentRunId: 'run-1', agentDisplayName: '芝士',
    run: { status, waitReason: null, terminalReasonCode: null }, evidence: [], publicOutput: null,
    startedAt: '2026-08-28T00:00:00Z', terminalAt: ['succeeded', 'failed', 'cancelled'].includes(status) ? '2026-08-28T00:00:28Z' : null, ...overrides
  }
}
function evidence(sequence: number, eventType: string, kind: AgentRunExecutionEvidenceView['kind'], phase: AgentRunExecutionEvidenceView['phase'], payload: unknown): AgentRunExecutionEvidenceView {
  return { id: `evidence-${sequence}`, agentRunId: 'run-1', executionEpoch: 1, sequence, eventType, kind, phase, payload, contentBlobId: null, contentByteCount: 0, isTruncated: false, occurredAt: '2026-08-28T00:00:01Z', canonical: null }
}
function command(sequence: number, cmd: string, output?: string, status: 'completed' | 'failed' = 'completed'): AgentRunExecutionEvidenceView {
  return evidence(sequence, 'activity.completed', 'command', status, { item: { type: 'commandExecution', command: cmd, status, aggregatedOutput: output } })
}
function narration(sequence: number, body: string): AgentRunExecutionEvidenceView {
  return evidence(sequence, 'agent.text.delta', 'narration', 'updated', { itemId: `text-${sequence}`, delta: body })
}
function runningCommand(sequence: number, cmd: string): AgentRunExecutionEvidenceView {
  return evidence(sequence, 'activity.started', 'command', 'started', { item: { type: 'commandExecution', command: cmd, status: 'inProgress' } })
}
function canonical(operationId: string): NonNullable<AgentRunExecutionEvidenceView['canonical']> {
  return {
    operationId, activityDomain: 'shell', semanticKind: 'shell.execute', toolName: 'exec_command', presentationHint: 'shell', phase: 'terminal', outcome: 'succeeded', credibility: 'runtime_structured',
    coverageLevel: 'fine_grained', sourceAuthority: 'runtime', sourceEvidenceIds: ['evidence-1'], classifierVersion: 'activity-v1', firstEvidenceSequence: 1, lastEvidenceSequence: 1, revision: 1
  }
}
function elements(card: Element): Element[] { return (card.body as { elements: Element[] }).elements }
function outerPanel(card: Element): Element | undefined { return elements(card).find((element) => element.element_id === 'execution_process') }
function timeline(card: Element): Element[] { return (outerPanel(card)?.elements ?? elements(card)) as Element[] }
function panels(card: Element): Element[] { return timeline(card).filter((element) => element.tag === 'collapsible_panel') }
function header(panel: Element): string { return (panel.header as { title: { content: string } }).title.content }
function bodyText(card: Element): string {
  const content = outerPanel(card) ? [...elements(card), ...timeline(card)] : elements(card)
  return content.filter((element) => element.tag === 'markdown').map((element) => element.content).join('\n\n')
}
function result(panel: Element): string {
  const children = panel.elements as Element[]
  expect(children).toHaveLength(1)
  expect(children[0].tag).toBe('markdown')
  const frame = children[0].content as string
  expect(frame.startsWith('```text\n')).toBe(true)
  expect(frame.endsWith('\n```')).toBe(true)
  return frame.slice('```text\n'.length, -'\n```'.length)
}
function buttons(card: Element): Element[] {
  const found: Element[] = []
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const item = value as Element
    if (item.tag === 'button') found.push(item)
    Object.values(item).forEach(visit)
  }
  visit(card.body)
  return found
}
function countElements(list: Element[]): number {
  return list.reduce((count, element) => count + 1 + countElements((element.elements ?? []) as Element[]) + countElements((element.columns ?? []) as Element[]), 0)
}

describe('Feishu execution console card', () => {
  it('keeps a live card compact with one local history panel, safe commands and no result output', () => {
    const card = executionConsoleCard(snapshot('running', { evidence: [narration(1, '正在检查项目。'), command(2, "sed -n '5p;15p' .rovai-validation/merge-target.txt", '05 echo-v4')] }))
    expect(card).toMatchObject({ schema: '2.0', header: { title: { content: '芝士 · 执行中' }, template: 'blue' } })
    expect(bodyText(card)).toContain('正在检查项目。')
    expect(bodyText(card)).toContain("sed -n '5p;15p' .rovai-validation/merge-target.txt")
    expect(bodyText(card)).not.toContain('05 echo-v4')
    expect(panels(card)).toEqual([])
    expect(outerPanel(card)).toMatchObject({ expanded: false, header: { title: { content: '执行过程 · 最近 1 条 / 共 1 条' } } })
    expect(elements(card).filter((element) => element.tag === 'markdown')).toHaveLength(3)
    expect(bodyText(card)).toContain('已完成 1 条指令')
    expect(buttons(card)).toEqual([])
  })

  it('shows the current five-line text, one running command and exact progress above only the recent ten commands', () => {
    const card = executionConsoleCard(snapshot('running', { evidence: [
      narration(1, '最早的正文。'),
      ...Array.from({ length: 21 }, (_, index) => command(index + 2, `check-${index + 1} --path repo/${index + 1}`, `private output ${index + 1}`)),
      narration(23, Array.from({ length: 12 }, (_, index) => `当前正文第 ${index + 1} 行`).join('\n')),
      runningCommand(24, "sed -n '5p;15p' .rovai-validation/merge-target.txt")
    ] }))
    const top = elements(card).filter((element) => element.tag === 'markdown')
    expect(top).toHaveLength(3)
    expect((top[0].content as string).split('\n')).toHaveLength(5)
    expect(top[0].content).toContain('当前正文第 1 行')
    expect(top[0].content).toContain('… 已截断 8 行 …')
    expect(top[1].content).toBe("● sed -n '5p;15p' .rovai-validation/merge-target.txt")
    expect(top[2].content).toBe('已完成 21 条指令 · 当前 1 条执行中')
    expect(header(outerPanel(card)!)).toBe('执行过程 · 最近 10 条 / 共 22 条')
    expect(timeline(card)[0].content).toBe('… 更早 12 条将在执行完成后查看 …')
    expect(bodyText(card)).not.toContain('最早的正文。')
    expect(bodyText(card)).not.toContain('check-12 --path')
    expect(bodyText(card)).toContain('check-13 --path')
    expect(JSON.stringify(card)).not.toContain('private output')
    expect(panels(card)).toHaveLength(0)
    expect(buttons(card)).toHaveLength(0)
  })

  it.each([100, 200, 1_000])('bounds a live %i-command Run without losing its full terminal timeline', (count) => {
    const run = snapshot('running', { evidence: Array.from({ length: count }, (_, index) => [
      narration(index * 2 + 1, `正文 ${index + 1}`),
      command(index * 2 + 2, `check-${index + 1} --flag repo/${index + 1}`, `result-${index + 1}`)
    ]).flat() })
    const card = executionConsoleCard(run, { outerExpanded: true, pageIndex: 99 })
    expect(outerPanel(card)?.expanded).toBe(false)
    expect(header(outerPanel(card)!)).toBe(`执行过程 · 最近 10 条 / 共 ${count} 条`)
    expect(timeline(card)).toHaveLength(21) // Twenty blocks plus the omission notice.
    expect(bodyText(card)).toContain(`更早 ${count - 10} 条将在执行完成后查看`)
    expect(JSON.stringify(card)).not.toContain('result-')
    expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThan(4_000)
    expect(countElements(elements(card))).toBeLessThanOrEqual(30)
    expect(buttons(card)).toEqual([])
    expect(run.evidence).toHaveLength(count * 2)
    if (count === 200) {
      const sealed = { ...run, run: { ...run.run, status: 'succeeded' as const }, terminalAt: '2026-08-28T00:00:28Z' }
      const pageCount = executionConsolePageCount(sealed)
      const cards = Array.from({ length: pageCount }, (_, pageIndex) => executionConsoleCard(sealed, { pageIndex }))
      expect(cards.flatMap(panels).map(header)).toEqual(Array.from({ length: count }, (_, index) => `✓ check-${index + 1} --flag repo/${index + 1}`))
    }
  })

  it('caps a text-only live window and keeps real waiting and queued states honest', () => {
    const card = executionConsoleCard(snapshot('running', { evidence: Array.from({ length: 40 }, (_, index) => narration(index + 1, `正文 ${index + 1}`)) }))
    expect(header(outerPanel(card)!)).toBe('执行过程')
    expect(timeline(card)).toHaveLength(21)
    expect(bodyText(card)).toContain('更早的正文将在执行完成后查看')
    expect(bodyText(card)).not.toContain('正文 20\n')
    expect(bodyText(card)).toContain('正文 40')
    expect(countElements(elements(card))).toBeLessThanOrEqual(30)
    const queued = executionConsoleCard(snapshot('queued'))
    expect(bodyText(queued)).toContain('等待开始执行…')
    const waiting = executionConsoleCard(snapshot('waiting', { run: { status: 'waiting', waitReason: 'approval', terminalReasonCode: null } }))
    expect(waiting.header).toMatchObject({ title: { content: '芝士 · 等待审批' }, template: 'orange' })
    expect(bodyText(waiting)).toContain('等待审批')
    expect(bodyText(waiting)).not.toContain('执行中')
  })

  it('uses true operation states for parallel progress instead of turning failures into completed commands', () => {
    const card = executionConsoleCard(snapshot('running', { evidence: [
      runningCommand(1, 'long-running --first'), command(2, 'completed'), command(3, 'failed', 'failure result', 'failed'),
      runningCommand(4, 'another-running --last')
    ] }))
    const top = elements(card).filter((element) => element.tag === 'markdown')
    expect(top[0].content).toBe('● another-running --last')
    expect(top[1].content).toBe('已完成 1 条指令 · 当前 2 条执行中 · 1 条失败')
    expect(bodyText(card)).toContain('✕ failed')
    expect(bodyText(card)).not.toContain('failure result')
  })

  it('evicts old live blocks by measured UTF-8 JSON size while preserving the current text and complete command', () => {
    const current = `inspect-current --path ${'项目/'.repeat(1_300)}file.txt`
    const run = snapshot('running', { evidence: [
      ...Array.from({ length: 20 }, (_, index) => command(index + 1, `inspect-${index} ${'😀'.repeat(700)}`)),
      narration(21, '正在核对最终目录。'), runningCommand(22, current)
    ] })
    const card = executionConsoleCard(run)
    const top = elements(card).filter((element) => element.tag === 'markdown')
    expect(top[0].content).toBe('正在核对最终目录。')
    expect(top[1].content).toBe(`● ${current}`)
    expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThanOrEqual(16_000)
    expect(countElements(elements(card))).toBeLessThanOrEqual(30)
    expect(header(outerPanel(card)!)).toBe('执行过程 · 最近 0 条 / 共 21 条')
    expect(bodyText(card)).toContain('更早 21 条将在执行完成后查看')
    expect(JSON.stringify(run)).toContain('inspect-0')
  })

  it('reports a live indivisible command above the whole-card limit without altering it or exceeding the budget', () => {
    const cmd = `inspect ${'项目/'.repeat(8_000)}`
    const card = executionConsoleCard(snapshot('running', { evidence: [narration(1, '当前正文仍保留。'), runningCommand(2, cmd)] }))
    expect(bodyText(card)).toContain('当前正文仍保留。')
    expect(bodyText(card)).toContain('当前指令超出飞书卡片大小限制，请在 Rovai 查看。')
    expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThanOrEqual(16_000)
    expect(JSON.stringify(card)).not.toContain(cmd)
  })

  it('redacts current text and commands using secrets from evidence outside the live window', () => {
    const card = executionConsoleCard(snapshot('running', { evidence: [
      command(1, 'read-config', 'SERVICE_TOKEN=old-evidence-secret'),
      ...Array.from({ length: 20 }, (_, index) => command(index + 2, `inspect-${index}`)),
      narration(22, '正在检查 old-evidence-secret 的响应。'),
      runningCommand(23, 'inspect --value old-evidence-secret --password private-password')
    ] }))
    expect(bodyText(card)).toContain('[已隐藏]')
    expect(JSON.stringify(card)).not.toMatch(/old-evidence-secret|private-password|read-config/)
  })

  it('interleaves public text and individual native command panels in real order', () => {
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [
      narration(1, '先运行两项核验。'), command(2, 'pnpm typecheck', 'type output'),
      narration(3, '类型检查已完成，继续测试。'), command(4, 'pnpm test -- channel-settings', 'test output')
    ], publicOutput: '实现与验证都已完成。' }))
    expect(card).toMatchObject({ header: { title: { content: '芝士 · 已完成' }, template: 'green' } })
    expect(elements(card).map((element) => element.tag)).toEqual(['markdown', 'hr', 'collapsible_panel'])
    expect(outerPanel(card)).toMatchObject({ expanded: false, header: { title: { content: '执行过程 · 2 条指令' }, icon_position: 'left' } })
    expect(timeline(card).map((element) => element.tag)).toEqual(['markdown', 'collapsible_panel', 'markdown', 'collapsible_panel', 'markdown'])
    expect(timeline(card)[0].content).toBe('先运行两项核验。')
    expect(timeline(card)[2].content).toBe('类型检查已完成，继续测试。')
    expect(bodyText(card)).toContain('用时 28 秒')
    expect(panels(card).map(header)).toEqual(['✓ pnpm typecheck', '✓ pnpm test -- channel-settings'])
    expect(panels(card).map(result)).toEqual(['type output', 'test output'])
    for (const panel of panels(card)) {
      expect(panel).toMatchObject({ expanded: false, header: { title: { tag: 'plain_text' }, icon_position: 'right' } })
      expect(JSON.stringify(panel)).not.toMatch(/callback|指令|状态|输出/)
    }
    expect(JSON.stringify(card)).not.toContain('查看执行过程')
    expect(buttons(card)).toEqual([])
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('shows elapsed time, a divider and the actual instruction count for %s', (status) => {
    const card = executionConsoleCard(snapshot(status, {
      terminalAt: '2026-08-28T00:00:18Z',
      evidence: [narration(1, '检查六项。'), ...Array.from({ length: 6 }, (_, index) => command(index + 2, `check-${index + 1}`))],
      publicOutput: '检查结束。'
    }))
    expect(elements(card)).toMatchObject([
      { tag: 'markdown', content: '用时 18 秒' },
      { tag: 'hr' },
      { tag: 'collapsible_panel', expanded: false, header: { title: { content: '执行过程 · 6 条指令' } } }
    ])
    expect(panels(card)).toHaveLength(6)
    expect(buttons(card)).toEqual([])
  })

  it.each([{ startedAt: null }, { terminalAt: null }, { terminalAt: 'invalid-time' }])(
    'does not invent elapsed time or leave an orphan divider when timestamps are unavailable: %j', (timing) => {
      const card = executionConsoleCard(snapshot('succeeded', { ...timing, evidence: [command(1, 'check')] }))
      expect(elements(card).map((element) => element.tag)).toEqual(['collapsible_panel'])
      expect(header(outerPanel(card)!)).toBe('执行过程 · 1 条指令')
      expect(bodyText(card)).not.toContain('用时')
    }
  )

  it.each([1, 19, 20, 21, 210])('limits a %i-line result to 20 actual lines: head 9 + notice + tail 10', (count) => {
    const output = Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')
    const panel = panels(executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'read-result --flag path/result.txt', output)] })))[0]
    expect(header(panel)).toBe('✓ read-result --flag path/result.txt')
    const preview = result(panel).split('\n')
    expect(preview).toHaveLength(Math.min(20, count))
    if (count <= 20) expect(preview.join('\n')).toBe(output)
    else {
      expect(preview.slice(0, 9)).toEqual(output.split('\n').slice(0, 9))
      expect(preview[9]).toBe(`… 已截断 ${count - 19} 行 …`)
      expect(preview.slice(-10)).toEqual(output.split('\n').slice(-10))
    }
  })

  it('redacts before truncation, including secrets declared in the omitted middle', () => {
    const lines = Array.from({ length: 210 }, (_, index) => `line ${index + 1}`)
    lines[0] = 'Authorization: Bearer header-secret'
    lines[1] = 'echoed flag-secret and api-flag-secret'
    lines[99] = 'SERVICE_API_KEY=middle-secret'
    lines[200] = 'echoed middle-secret and header-secret'
    lines[209] = 'Password: "password with spaces"'
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'API_TOKEN=environment-secret cargo test --all --authorization "flag-secret" --api_key "api-flag-secret"', lines.join('\n'))] }))
    expect(header(panels(card)[0])).toBe('✓ API_TOKEN=[已隐藏] cargo test --all --authorization=[已隐藏] --api_key=[已隐藏]')
    expect(result(panels(card)[0]).split('\n')).toHaveLength(20)
    expect(result(panels(card)[0])).toContain('… 已截断 191 行 …')
    for (const secret of ['header-secret', 'middle-secret', 'password with spaces', 'environment-secret', 'flag-secret', 'api-flag-secret']) expect(JSON.stringify(card)).not.toContain(secret)
  })

  it('preserves result indentation and does not count a final line terminator as an extra line', () => {
    const output = Array.from({ length: 20 }, (_, index) => `  line ${index + 1}  `).join('\n')
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'read-result', `${output}\n`)] }))
    expect(result(panels(card)[0])).toBe(output)
    expect(result(panels(card)[0]).split('\n')).toHaveLength(20)
  })

  it('also bounds dense UTF-8 results to 4 KiB without losing the head/tail selection', () => {
    const output = Array.from({ length: 210 }, (_, index) => `line ${index + 1}: ${'项目😀'.repeat(100)}`).join('\n')
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'inspect --verbose', output)] }))
    const preview = result(panels(card)[0])
    expect(Buffer.byteLength(preview)).toBeLessThanOrEqual(4096)
    expect(preview.split('\n')).toHaveLength(20)
    expect(preview).toContain('line 1:')
    expect(preview).toContain('line 210:')
    expect(preview).toContain('… 已截断 191 行 …')
    expect(preview).not.toContain('\uFFFD')
  })

  it.each(['data:image/png;base64,aGVsbG8=', 'VGhpcy1pcy1hLXByaXZhdGUtZW5jb2RlZC1yZXN1bHQ='.repeat(8).replace(/=/gu, '')])(
    'hides encoded results before line and byte truncation', (encoded) => {
      const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'read-artifact', `before\n${encoded}\nafter`)] }))
      expect(result(panels(card)[0])).toBe('（二进制或编码结果已隐藏）')
      expect(JSON.stringify(card)).not.toContain(encoded)
    }
  )

  it('never projects stdin, send bodies, raw input/output envelopes or reasoning', () => {
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [
      command(1, "TOKEN=top-secret rovai send --public-only --body 'private message' && curl -H 'Cookie: session=private-cookie' https://example.test", 'private message'),
      evidence(2, 'runtime.action', 'tool_result', 'completed', { kind: 'tool', input: { token: 'private-input', stdin: 'typed-password' }, output: { body: 'private-output', token: 'private-token' } }),
      evidence(3, 'agent.reasoning.summary.delta', 'reasoning_summary', 'updated', { delta: 'private reasoning' }),
      command(4, 'json-command', '{"tool_input":{"body":"json-private-input"},"output":"json-private-output"}'),
      command(5, 'npx rovai send --public-only --body="wrapped-private-body"', 'wrapped-private-body'),
      command(6, String.raw`C:\tools\rovai.exe send --body "windows-private-body"`, 'windows-private-body'),
      { ...evidence(7, 'runtime.action', 'tool_result', 'completed', { kind: 'shell', input: { cmd: 'verify-cli', stdin: ['typed-password', 'nested-private-stdin'] }, output: { stdout: 'ok', stderr: 'echoed typed-password and private-input; nested-private-stdin' } }), canonical: canonical('op-7') }
    ] }))
    expect(header(panels(card)[0])).toContain('rovai send --public-only --body [已隐藏]')
    expect(JSON.stringify(card)).toContain('结构化工具结果已隐藏')
    for (const secret of ['top-secret', 'private message', 'private-cookie', 'private-input', 'private-output', 'private-token', 'typed-password', 'private reasoning', 'json-private-input', 'json-private-output', 'wrapped-private-body', 'windows-private-body', 'nested-private-stdin']) expect(JSON.stringify(card)).not.toContain(secret)
    expect(result(panels(card).at(-1)!)).toContain('ok')
    expect(result(panels(card).at(-1)!)).toContain('echoed [已隐藏] and [已隐藏]')
  })

  it('updates a canonical operation in place, retains its safe command and only extracts textual results', () => {
    const started = { ...evidence(2, 'runtime.action', 'tool_call', 'started', { kind: 'shell', input: { cmd: 'cargo test -p rovai-core' }, status: 'inProgress' }), canonical: canonical('op-1') }
    const finished = { ...evidence(4, 'runtime.action', 'tool_result', 'completed', { kind: 'shell', output: { content: [{ type: 'text', text: '27 tests passed' }] }, status: 'completed' }), canonical: canonical('op-1') }
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [narration(1, '现在检查。'), started, narration(3, '检查仍在运行。'), finished] }))
    expect(panels(card)).toHaveLength(1)
    expect(header(panels(card)[0])).toBe('✓ cargo test -p rovai-core')
    expect(result(panels(card)[0])).toBe('27 tests passed')
    expect(timeline(card).map((element) => element.tag)).toEqual(['markdown', 'collapsible_panel', 'markdown'])
  })

  it('shows apply_patch with structured file deltas and never its raw patch', () => {
    const patch = evidence(1, 'runtime.action', 'tool_call', 'completed', { kind: 'tool', input: { patch: '*** Begin Patch\n-secret patch body-\n*** End Patch' }, output: { status: 'ok' } })
    patch.canonical = {
      ...canonical('patch-1'), activityDomain: 'file', semanticKind: 'apply_patch', toolName: 'apply_patch', presentationHint: 'apply_patch',
      diffProjection: { schemaVersion: 1, source: 'runtime_reported', revision: 1, sourceEvidenceIds: ['evidence-1'], status: 'available', semanticKind: 'exact_mutation', entries: [
        { path: 'src/foo.ts', changeKind: 'update', additions: 4, deletions: 2, diff: '@@ -1 +1 @@\n-secret patch body' },
        { path: 'src/bar.ts', changeKind: 'add', additions: 1, deletions: 0, diff: '+private patch line' }
      ] }
    }
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [patch] }))
    expect(header(panels(card)[0])).toBe('✓ apply_patch')
    expect(result(panels(card)[0])).toBe('src/foo.ts +4 −2\nsrc/bar.ts +1 −0')
    expect(JSON.stringify(card)).not.toMatch(/secret patch body|private patch line|Begin Patch/)
  })

  it('suppresses raw patch output and prevents embedded fences from escaping the result frame', () => {
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'patch-command', '*** Begin Patch\n+private-patch\n*** End Patch'), command(2, 'read-file', 'before\n```\n<at id=all></at>\nafter')] }))
    expect(JSON.stringify(card)).not.toContain('private-patch')
    const frame = ((panels(card)[1].elements as Element[])[0].content as string)
    expect(frame.match(/```/gu)).toHaveLength(2)
    expect(result(panels(card)[1]).split('\n')).toHaveLength(4)
  })

  it('uses nine narration lines plus a truncation notice and deduplicates the final public text', () => {
    const text = Array.from({ length: 12 }, (_, index) => `narration line ${index + 1} ${'x'.repeat(450)}`).join('\n')
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [narration(1, text)], publicOutput: text }))
    const body = timeline(card)[0].content as string
    expect(body.split('\n')).toHaveLength(10)
    expect(body).toContain('narration line 1 ')
    expect(body).toContain('narration line 9 ')
    expect(body).toContain('… 已截断 3 行 …')
    expect(body).not.toContain('narration line 10 ')
    expect(elements(card)).toHaveLength(3)
    expect(header(outerPanel(card)!)).toBe('执行过程')
    expect(timeline(card)).toHaveLength(1)
    expect(panels(card)).toEqual([])
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('paginates the %s timeline at fifteen commands, keeping text with its next command', (status) => {
    const run = snapshot(status, { evidence: [
      ...Array.from({ length: 15 }, (_, index) => command(index + 1, `command-${index + 1} --flag path/${index + 1}`)), narration(16, '现在运行下一项测试。'),
      ...Array.from({ length: 16 }, (_, index) => command(index + 17, `command-${index + 16} --flag path/${index + 16}`))
    ], publicOutput: '最终结论。' })
    expect(executionConsolePageCount(run)).toBe(3)
    const cards = [0, 1, 2].map((pageIndex) => executionConsoleCard(run, { pageIndex, outerExpanded: true }))
    expect(cards.map((card) => panels(card).length)).toEqual([15, 15, 1])
    expect(bodyText(cards[0])).not.toContain('现在运行下一项测试。')
    expect(bodyText(cards[1])).toContain('现在运行下一项测试。')
    expect(bodyText(cards[0])).not.toContain('最终结论。')
    expect(bodyText(cards[2])).toContain('最终结论。')
    expect(cards.flatMap(panels).map(header)).toEqual(Array.from({ length: 31 }, (_, index) => `✓ command-${index + 1} --flag path/${index + 1}`))
    expect(buttons(cards[1])).toEqual([
      expect.objectContaining({ text: { tag: 'plain_text', content: '上一页' }, behaviors: [{ type: 'callback', value: { action: 'execution_console_page', agentRunId: 'run-1', snapshotSequence: 1, pageIndex: 0 } }] }),
      expect.objectContaining({ text: { tag: 'plain_text', content: '下一页' }, behaviors: [{ type: 'callback', value: { action: 'execution_console_page', agentRunId: 'run-1', snapshotSequence: 1, pageIndex: 2 } }] })
    ])
    expect(bodyText(cards[1])).toContain('第 2 / 3 页')
    expect(buttons(cards[0])).toHaveLength(1)
    expect(buttons(cards[2])).toHaveLength(1)
    for (const card of cards) {
      expect(outerPanel(card)).toMatchObject({ expanded: true, header: { title: { content: '执行过程 · 31 条指令' } } })
      expect(elements(card).slice(0, 2)).toEqual([{ tag: 'markdown', content: '用时 28 秒' }, { tag: 'hr' }])
      expect(countElements(elements(card))).toBeLessThanOrEqual(50)
      expect(panels(card).every((panel) => panel.expanded === false)).toBe(true)
      expect(JSON.stringify(card)).not.toMatch(/nonce|viewVersion|displayMode|execution_console_expand|execution_console_collapse/)
    }
  })

  it.each([15, 16])('shows pagination only after the single-page budget for %i commands', (count) => {
    const run = snapshot('succeeded', { evidence: Array.from({ length: count }, (_, index) => command(index + 1, `command-${index + 1}`)) })
    const first = executionConsoleCard(run)
    expect(executionConsolePageCount(run)).toBe(count === 15 ? 1 : 2)
    expect(panels(first)).toHaveLength(15)
    if (count === 15) {
      expect(buttons(first)).toEqual([])
      expect(bodyText(first)).not.toContain('第 1 /')
    } else {
      expect(bodyText(first)).toContain('第 1 / 2 页')
      expect(buttons(first).map((button) => button.text)).toEqual([{ tag: 'plain_text', content: '下一页' }])
    }
  })

  it('counts the footer against fifty elements and moves orphan narration onto the next page', () => {
    const run = snapshot('succeeded', { evidence: [
      ...Array.from({ length: 42 }, (_, index) => narration(index + 1, `段落 ${index + 1}`)), narration(43, '现在运行测试。'), command(44, 'cargo test'),
      ...Array.from({ length: 12 }, (_, index) => narration(index + 45, `后续段落 ${index + 1}`))
    ] })
    expect(executionConsolePageCount(run)).toBe(2)
    const first = executionConsoleCard(run, { pageIndex: 0 })
    const second = executionConsoleCard(run, { pageIndex: 1, outerExpanded: true })
    expect(bodyText(first)).not.toContain('现在运行测试。')
    const narrationIndex = timeline(second).findIndex((element) => element.content === '现在运行测试。')
    expect(narrationIndex).toBeGreaterThanOrEqual(0)
    expect(timeline(second)[narrationIndex + 1]).toBe(panels(second)[0])
    expect(header(panels(second)[0])).toBe('✓ cargo test')
    expect(countElements(elements(first))).toBeLessThanOrEqual(50)
    expect(countElements(elements(second))).toBeLessThanOrEqual(50)
  })

  it('bounds UTF-8 size and long result lines without splitting commands or shortening their safe presentation', () => {
    const commands = Array.from({ length: 20 }, (_, index) => `inspect-${index} --path ${'项目/'.repeat(650)}file.txt`)
    const run = snapshot('succeeded', { evidence: commands.map((cmd, index) => command(index + 1, cmd, '😀'.repeat(2_000))) })
    const count = executionConsolePageCount(run)
    expect(count).toBeGreaterThan(2)
    const cards = Array.from({ length: count }, (_, pageIndex) => executionConsoleCard(run, { pageIndex, outerExpanded: true }))
    expect(cards.flatMap(panels).map(header)).toEqual(commands.map((cmd) => `✓ ${cmd}`))
    for (const card of cards) {
      expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThanOrEqual(24_000)
      expect(countElements(elements(card))).toBeLessThanOrEqual(50)
      for (const panel of panels(card)) {
        expect(result(panel).split('\n')).toHaveLength(1)
        expect(result(panel)).toContain('此行过长，已截断')
        expect(result(panel)).not.toContain('\uFFFD')
      }
    }
  })

  it('reports an over-limit indivisible command honestly instead of failing the whole card', () => {
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, `command ${'x'.repeat(40_000)}`)] }))
    expect(bodyText(card)).toContain('超出飞书单卡大小限制')
    expect(Buffer.byteLength(JSON.stringify(card))).toBeLessThanOrEqual(24_000)
    expect(buttons(card)).toEqual([])
  })

  it.each(['failed', 'cancelled'] as const)('preserves %s status with sanitized stderr and initially closed commands', (status) => {
    const card = executionConsoleCard(snapshot(status, { evidence: [command(1, 'pnpm typecheck'), command(2, 'cargo test -p rovai-core', '2 tests failed\nAPI_KEY=private-failure-token', 'failed')] }))
    expect(card.header).toMatchObject({ template: status === 'failed' ? 'red' : 'grey' })
    expect(panels(card).every((panel) => panel.expanded === false)).toBe(true)
    expect(header(panels(card)[1])).toBe('✕ cargo test -p rovai-core')
    expect(result(panels(card)[1])).toContain('2 tests failed')
    expect(JSON.stringify(card)).not.toMatch(/private-failure-token|命令执行失败/)
  })

  it('provides honest empty states with no pagination for a single page', () => {
    const empty = executionConsoleCard(snapshot('succeeded'))
    expect(bodyText(empty)).toContain('没有可展示的执行记录。')
    expect(panels(empty)).toEqual([])
    expect(buttons(empty)).toEqual([])
    expect(executionConsolePageCount(snapshot('succeeded'))).toBe(1)
    const card = executionConsoleCard(snapshot('succeeded', { evidence: [command(1, 'true', '')] }))
    expect(result(panels(card)[0])).toBe('（无可展示结果）')
    expect(buttons(card)).toEqual([])
  })

  it('preserves DingTalk plain pagination: twenty operations, character budget, no tool results', () => {
    const pages = executionConsolePages(snapshot('succeeded', { evidence: Array.from({ length: 45 }, (_, index) => command(index + 1, `command-${index + 1}`, 'tool result')) }))
    expect(pages.map((page) => page.body.match(/✓ command-/gu)?.length)).toEqual([20, 20, 5])
    expect(pages.map((page) => page.body).join('\n')).not.toContain('tool result')
    const answer = '公开回复。'.repeat(500)
    const run = snapshot('succeeded', { evidence: [command(1, `echo ${'x'.repeat(9_000)}`)], publicOutput: answer })
    expect(executionConsolePages(run)).toHaveLength(2)
    expect(executionConsolePublicPage(run, 1).body).toContain(answer)
  })
})
