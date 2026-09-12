import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CanonicalRuntimeActivityView } from '@contracts'
import { ToolCallRow, type PresentableExecutionEvidence } from '../../renderer/src/ExecutionToolGroup'
import { BUILTIN_CLI_NAMES } from './builtin-tools'
import {
  buildLiveExecutionProgress, executionEvidenceResultText, executionStepPublicTitle,
  type ExecutionStep, type LiveRuntimeEvent
} from './index'

const sent = { messageId: 'message-1', agentAddressingMode: 'public_only', effectiveRecipients: [], deliveryIds: [] }

function canonical(id: string, overrides: Partial<CanonicalRuntimeActivityView> = {}): CanonicalRuntimeActivityView {
  return {
    operationId: id, classifierVersion: 'activity-v3', activityDomain: 'tool', semanticKind: 'tool.call',
    toolName: 'camp.message.send', presentationHint: 'camp.message.send', phase: 'terminal', outcome: 'succeeded',
    credibility: 'core_verified', coverageLevel: 'fine_grained', sourceAuthority: 'core',
    sourceEvidenceIds: [], firstEvidenceSequence: 2, lastEvidenceSequence: 3, revision: 1, ...overrides
  }
}

function builtin(operation = 'camp.message.send', input: unknown = { recipientAgentIds: ['agent-5'] }, result: unknown = sent): LiveRuntimeEvent {
  return {
    id: 'core-event', agentRunId: 'run-1', eventType: 'runtime.action', createdAt: '2026-09-12T00:00:01Z',
    canonical: canonical('core-1', { toolName: operation, presentationHint: operation }),
    payload: {
      status: 'completed', sourceAuthority: 'core', canonicalTool: operation,
      input: { body: 'RAW_INPUT_NEVER_DISPLAY' }, output: 'RAW_OUTPUT_NEVER_DISPLAY',
      operationProjection: { schemaVersion: 3, operation, canonicalInput: input, canonicalResult: result },
      coreEnvelope: { operation, requestId: 'request-1', receipt: 'PRIVATE_RECEIPT', ok: true, result }
    }
  }
}

function shell(command = "rovai send --to agent-5 --body 'message'", result: unknown = sent): LiveRuntimeEvent {
  return {
    id: 'shell-event', agentRunId: 'run-1', eventType: 'activity.completed', createdAt: '2026-09-12T00:00:02Z',
    canonical: canonical('shell-1', { activityDomain: 'shell', semanticKind: 'shell.execute',
      toolName: 'commandExecution', presentationHint: '运行命令', sourceAuthority: 'runtime',
      credibility: 'runtime_structured', firstEvidenceSequence: 1, lastEvidenceSequence: 4 }),
    payload: { item: { type: 'commandExecution', command, status: 'completed', aggregatedOutput: JSON.stringify(result) } }
  }
}

function steps(events: LiveRuntimeEvent[]): ExecutionStep[] {
  return buildLiveExecutionProgress(events, 'run-1').items.flatMap(item => item.kind === 'tool' ? [item.step] : [])
}

describe('Built-in input presentation', () => {
  it('uses the CLI catalog for all display names without changing internal identities', () => {
    const source = readFileSync('crates/rovai-core/src/builtin_tool_transport.rs', 'utf8')
    const identities = [...source.matchAll(/BuiltinToolCliIdentity\s*\{\s*operation: "([^"]+)",\s*group: "([^"]+)",\s*action: "([^"]*)"/gu)]
    expect(identities).toHaveLength(23)
    expect(BUILTIN_CLI_NAMES).toEqual(Object.fromEntries(identities.map(([, operation, group, action]) =>
      [operation, ['rovai', group, action].filter(Boolean).join(' ')])))
    for (const [operation, name] of Object.entries(BUILTIN_CLI_NAMES)) {
      const [step] = steps([builtin(operation)])
      expect(executionStepPublicTitle(step)).toBe(name)
      expect(step.toolName).toBe(operation)
    }
  })

  it.each(['running', 'completed', 'failed', 'waiting', 'stopped', 'skipped', 'recorded'] as const)(
    'shows only public input for %s, including when result/error evidence exists', status => {
      const event = builtin('team.update_task', { taskId: 'task-1', requestedStatus: 'completed', expectedVersion: 0,
        clearAssignee: false, changedFields: ['status'], titleRedacted: true, title: null })
      const [projected] = steps([event])
      const step = { ...projected, status }
      expect(JSON.parse(step.detail)).toEqual({ taskId: 'task-1', status: 'completed', expectedVersion: 0, clearAssignee: false })
      expect(executionEvidenceResultText('runtime.action', { ...(event.payload as object),
        status, coreEnvelope: { ok: false, error: { message: 'DO_NOT_SHOW_ERROR' } } })).toBe(step.detail)
      const markup = renderToStaticMarkup(createElement(ToolCallRow, {
        campId: 'camp-1', runId: 'run-1', runStatus: 'running', step,
        completeEvidence: { id: 'blob-result' } as PresentableExecutionEvidence, onFileOpenError: () => {}
      }))
      expect(markup).toContain('rovai task update')
      expect(markup).toContain('<details')
      expect(markup).not.toMatch(/RAW_|PRIVATE_|DO_NOT_SHOW_ERROR|messageId/)
    })

  it.each([undefined, null, {}, { contentCharCount: 20, contentDigest: 'digest', contentSecretDetected: false },
    { body: 'omitted message', queryRedacted: true, query: null }])(
    'keeps absent/omitted input static even when a complete result blob is available: %j', input => {
      const event = builtin()
      const payload = event.payload as Record<string, unknown>
      payload.operationProjection = { operation: 'camp.message.send', canonicalInput: input }
      const [step] = steps([event])
      expect(step.detail).toBe('')
      const markup = renderToStaticMarkup(createElement(ToolCallRow, {
        campId: 'camp-1', runId: 'run-1', runStatus: 'succeeded', step,
        completeEvidence: { id: 'blob-result' } as PresentableExecutionEvidence, onFileOpenError: () => {}
      }))
      expect(markup).not.toMatch(/<details|<summary|已隐藏|\{\}|结果|messageId/)
    })

  it('omits send/gather bodies and projection metadata while preserving actual public parameters', () => {
    for (const operation of ['camp.message.send', 'team.gather']) {
      const [step] = steps([builtin(operation, { body: 'message', recipientAgentIds: ['agent-5'],
        mentionsCurrentUser: false, recipientAgentIdsCount: 1, recipientAgentIdsOmittedCount: 0,
        contentCharCount: 7, contentDigest: 'hash', contentSecretDetected: false })])
      expect(JSON.parse(step.detail)).toEqual({ to: ['agent-5'], mentionUser: false })
    }
    expect(JSON.parse(steps([builtin('memory.write', { body: 'a public memory', bodyCharCount: 15 })])[0].detail))
      .toEqual({ body: 'a public memory' })
    const event = builtin()
    ;(event.payload as Record<string, unknown>).operationProjection = { operation: 'camp.read', canonicalInput: { query: 'mismatch' } }
    expect(steps([event])[0].detail).toBe('')
  })
})

describe('Rovai Shell carrier presentation', () => {
  it.each([
    ["rovai send --public-only --body 'message with spaces'", "rovai send --public-only --body 'message with spaces'"],
    ['rovai send --body="message" --to agent-5', 'rovai send --body="message" --to agent-5'],
    ["env KEY=value npx --yes rovai gather --body 'message' --to agent-5", "env KEY=value npx --yes rovai gather --body 'message' --to agent-5"],
    ["rovai send 'message' --input-file /tmp/request.json", "rovai send 'message' --input-file /tmp/request.json"],
    ["rovai send --body 'line one\nline two' && git status", "rovai send --body 'line one line two' && git status"],
    ["rovai send <<'JSON'\n{\"body\":\"message\",\"publicOnly\":true}\nJSON", "rovai send <<'JSON' ; {\"body\":\"message\",\"publicOnly\":true} ; JSON"],
    ["git status && rovai send <<'JSON'\n{\"body\":\"message\"}\nJSON\npwd", "git status && rovai send <<'JSON' ; {\"body\":\"message\"} ; JSON ; pwd"],
    ["rovai task get <<JSON && git status\n{\"taskId\":\"task-1\"}\nJSON", "rovai task get <<JSON && git status ; {\"taskId\":\"task-1\"} ; JSON"],
    ["rovai send <<-'JSON'\n\t{\"body\":\"message\"}\n\tJSON", "rovai send <<-'JSON' ; {\"body\":\"message\"} ; JSON"],
    ["rovai send <<'JSON'\n{\"body\":\"unfinished\"}", "rovai send <<'JSON' ; {\"body\":\"unfinished\"}"],
    ["rovai send <<< '{\"body\":\"message\"}' && pwd", "rovai send <<< '{\"body\":\"message\"}' && pwd"],
    ["printf '%s' 'independent' && rovai send --body 'message'", "printf '%s' 'independent' && rovai send --body 'message'"]
  ])('preserves the complete message/input carrier: %s', (command, expected) => {
    const [step] = steps([shell(command)])
    expect(executionStepPublicTitle(step)).toBe(expected)
    expect(step.detail.split('\n')[0]).toBe(`$ ${expected}`)
    expect(step.detail).not.toContain('[已隐藏]')
  })

  it('folds a unique completed carrier around the exact Core invocation, without altering source evidence', () => {
    const events = [builtin(), shell()]
    const before = JSON.stringify(events)
    expect(steps(events).map(step => step.id)).toEqual(['core-1'])
    expect(JSON.stringify(events)).toBe(before)
    expect(steps([builtin(), shell("rovai send <<'JSON'\n{\"body\":\"message\"}\nJSON")])).toHaveLength(1)
    expect(steps([builtin(), shell("rovai send --body '正文中的 `code`、$(literal) 与 <tag> 只是文本'")])).toHaveLength(1)
    expect(steps([builtin(), shell("rovai send <<'JSON'\n{\"body\":\"`code` 与 $(literal)\"}\nJSON")])).toHaveLength(1)
    expect(steps([builtin(), shell("rovai send <<<'{\"body\":\"`code`\"}'")])).toHaveLength(1)
    const task = { taskId: 'task-1', title: 'Task', status: 'open', assigneeAgentId: null, version: 1, availableActions: [], internalFact: true }
    const { internalFact: _, ...cliTask } = task
    expect(steps([builtin('team.create_task', { title: 'Task' }, task), shell("rovai task create --title Task", cliTask)])).toHaveLength(1)
    const pagedShell = shell()
    pagedShell.payload = { item: { type: 'commandExecution', command: 'rovai send --body message', status: 'completed' }, executionWindowBuiltinOperation: 'camp.message.send' }
    expect(steps([pagedShell])).toEqual([])
    pagedShell.payload = { item: { type: 'commandExecution', command: 'rovai send --body message && git status', status: 'completed' }, executionWindowBuiltinOperation: 'camp.message.send' }
    expect(steps([pagedShell])).toHaveLength(1)
  })

  it.each(['rovai send --help', 'rovai --version', "rovai send --body 'message' && git status",
    "rovai send --body 'message' > /tmp/output.json", 'rovai send --body "$(pwd)"', "rovai send <<JSON\n{\"body\":\"$(pwd)\"}\nJSON",
    "rovai send <<JSON\n{\"body\":\"incomplete\"}", "echo 'rovai send'"])(
    'retains Shell work without a pure proven carrier: %s', command => {
      expect(steps([builtin(), shell(command)])).toHaveLength(2)
    })

  it('retains missing, failed, outside-lifetime, cross-run and ambiguous associations', () => {
    expect(steps([shell()])).toHaveLength(1)
    const outside = builtin(); outside.canonical = canonical('core-1', { firstEvidenceSequence: 5, lastEvidenceSequence: 6 })
    expect(steps([outside, shell()])).toHaveLength(2)
    const failed = shell(); failed.canonical = { ...failed.canonical!, outcome: 'failed' }
    expect(steps([builtin(), failed])).toHaveLength(2)
    expect(steps([builtin(), { ...shell(), agentRunId: 'run-2' }])).toHaveLength(1)
    const second = builtin(); second.canonical = canonical('core-2')
    expect(steps([builtin(), second, shell()])).toHaveLength(3)
    const otherShell = shell(); otherShell.canonical = { ...otherShell.canonical!, operationId: 'shell-2' }
    expect(steps([builtin(), shell(), otherShell])).toHaveLength(3)
    const unverified = builtin(); unverified.canonical = { ...unverified.canonical!, sourceAuthority: 'runtime', credibility: 'runtime_structured' }
    expect(steps([unverified, shell()])).toHaveLength(2)
    expect(steps([builtin(), shell(undefined, { ...sent, extraLog: 'unrelated' })])).toHaveLength(2)
  })
})
