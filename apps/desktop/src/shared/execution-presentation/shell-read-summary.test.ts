import { describe, expect, it } from 'vitest'
import { buildLiveExecutionProgress, shellReadSummary, type LiveRuntimeEvent } from './index'

const repeatedReadCommand = [
  "sed -n '4170,4335p' crates/rovai-core/src/acp.rs",
  "sed -n '3060,3280p' crates/rovai-core/src/acp.rs",
  "sed -n '760,815p' crates/rovai-core/src/agent_runtime_adapter.rs",
  "sed -n '2320,2370p' crates/rovai-core/src/agent_runtime_adapter.rs"
].join(' ; ')

describe('shellReadSummary', () => {
  it('prefers structured read actions and deduplicates full paths in first-seen order', () => {
    expect(shellReadSummary({
      item: {
        commandActions: [
          { type: 'read', path: 'crates/rovai-core/src/acp.rs' },
          { type: 'read', path: 'crates/rovai-core/src/acp.rs' },
          { type: 'read', path: 'crates/rovai-core/src/agent_runtime_adapter.rs' },
          { type: 'read', path: 'crates/rovai-core/src/acp.rs' }
        ]
      }
    })).toEqual({
      title: 'Read 2 files',
      paths: [
        'crates/rovai-core/src/acp.rs',
        'crates/rovai-core/src/agent_runtime_adapter.rs'
      ],
      displayPaths: ['acp.rs', 'agent_runtime_adapter.rs']
    })
  })

  it('uses the bounded semicolon-separated sed fallback and keeps one-file wording', () => {
    expect(shellReadSummary({ item: { command: [
      "sed -n '1,20p' src/index.ts",
      "sed -n '80,110p' src/index.ts"
    ].join('; ') } })).toEqual({
      title: 'Read index.ts',
      paths: ['src/index.ts'],
      displayPaths: ['index.ts']
    })
  })

  it('uses the shortest unique path when different files share a basename', () => {
    expect(shellReadSummary({ item: { commandActions: [
      { type: 'read', path: 'src/index.ts' },
      { type: 'read', path: 'tests/index.ts' }
    ] } })).toEqual({
      title: 'Read 2 files',
      paths: ['src/index.ts', 'tests/index.ts'],
      displayPaths: ['src/index.ts', 'tests/index.ts']
    })
  })

  it('falls back to the original paths when normalized suffixes are identical', () => {
    expect(shellReadSummary({ item: { commandActions: [
      { type: 'read', path: 'src/index.ts' },
      { type: 'read', path: '/src/index.ts' }
    ] } })?.displayPaths).toEqual(['src/index.ts', '/src/index.ts'])
  })

  it('falls back only when structured actions are unavailable, never when they contradict a pure read', () => {
    expect(shellReadSummary({
      item: { command: repeatedReadCommand, commandActions: [{ type: 'unknown' }] }
    })?.title).toBe('Read 2 files')
    expect(shellReadSummary({
      item: {
        command: repeatedReadCommand,
        commandActions: [
          { type: 'read', path: 'crates/rovai-core/src/acp.rs' },
          { type: 'search', path: 'crates/rovai-core/src' }
        ]
      }
    })).toBeNull()
  })

  it.each([
    ["sed -n '1,20p' src/a.ts", 'one read'],
    ["sed -n '1,20p' src/a.ts; echo changed", 'mixed command'],
    ["sed -n '1,20p' src/a.ts | cat; sed -n '1,20p' src/b.ts", 'pipe'],
    ["sed -n '1,20p' src/a.ts > out; sed -n '1,20p' src/b.ts", 'redirection'],
    ["sed -n '1,20p' $FILE; sed -n '1,20p' src/b.ts", 'variable expansion'],
    ["sed -n '1,20p' $(pwd)/a.ts; sed -n '1,20p' src/b.ts", 'command substitution'],
    ["sed -n '1,20p' `pick-file`; sed -n '1,20p' src/b.ts", 'backticks'],
    ["sed -i '1,20p' src/a.ts; sed -n '1,20p' src/b.ts", 'mutating sed'],
    ["sed -n 1,20p src/a.ts; sed -n '1,20p' src/b.ts", 'unquoted range'],
    ["sed -n '1,20p' 'src/a;b.ts'; sed -n '1,20p' src/b.ts", 'quoted semicolon path'],
    ["sed -n '1,20p' src/a.ts\nsed -n '1,20p' src/b.ts", 'newline separator'],
    ["sed -n '1,20p src/a.ts; sed -n '1,20p' src/b.ts", 'unbalanced quote']
  ])('keeps unsupported Shell syntax unchanged: %s (%s)', (command) => {
    expect(shellReadSummary({ item: { command } })).toBeNull()
  })

  it('keeps one execution item and its complete command and output after summarizing', () => {
    const event: LiveRuntimeEvent = {
      id: 'read-command',
      agentRunId: 'run-read-command',
      eventType: 'activity.completed',
      payload: {
        item: {
          type: 'commandExecution',
          command: repeatedReadCommand,
          status: 'completed',
          aggregatedOutput: 'all four ranges'
        }
      },
      createdAt: '2026-09-06T00:00:00Z'
    }
    const progress = buildLiveExecutionProgress([event], event.agentRunId)
    const items = progress.items.filter((item) => item.kind === 'tool')
    expect(items).toHaveLength(1)
    const step = items[0].kind === 'tool' ? items[0].step : null
    expect(step).toMatchObject({
      shellReadSummary: {
        title: 'Read 2 files',
        displayPaths: ['acp.rs', 'agent_runtime_adapter.rs']
      },
      publicCommand: repeatedReadCommand,
      detail: expect.stringContaining('all four ranges'),
      status: 'completed'
    })
    expect(step?.detail).toContain("sed -n '4170,4335p'")
    expect(step?.detail).toContain("sed -n '2320,2370p'")
  })

  it('retains the summary and original detail across a sparse terminal update', () => {
    const started: LiveRuntimeEvent = {
      id: 'read-operation', agentRunId: 'run-sparse-read', eventType: 'activity.started',
      payload: {
        item: {
          id: 'read-operation', type: 'commandExecution', command: repeatedReadCommand,
          commandActions: [{ type: 'unknown' }], status: 'inProgress'
        }
      },
      createdAt: '2026-09-06T00:00:00Z'
    }
    const completed: LiveRuntimeEvent = {
      id: 'read-operation', agentRunId: 'run-sparse-read', eventType: 'activity.completed',
      payload: { item: { id: 'read-operation', type: 'commandExecution', status: 'completed' } },
      createdAt: '2026-09-06T00:00:01Z'
    }
    const items = buildLiveExecutionProgress([started, completed], started.agentRunId).items
      .filter((item) => item.kind === 'tool')
    expect(items).toHaveLength(1)
    if (items[0].kind !== 'tool') throw new Error('Expected a tool item')
    expect(items[0].step).toMatchObject({
      publicCommand: repeatedReadCommand,
      detail: expect.stringContaining(repeatedReadCommand),
      iconKind: 'file-read',
      shellReadSummary: { title: 'Read 2 files' },
      status: 'completed'
    })
  })
})
