import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DiagnosticCheck } from '@contracts'
import {
  DiagnosticsCenter,
  diagnosticActionForCheck,
  diagnosticCheckDetail,
  diagnosticChecksForFilter,
  diagnosticIssueCopy
} from './DiagnosticsCenter'

const observedAt = '2026-08-09T08:00:00Z'

function check(overrides: Partial<DiagnosticCheck>): DiagnosticCheck {
  return {
    id: 'core',
    group: 'local_dependencies',
    subjectKind: 'core',
    subjectId: null,
    label: 'Rovai Core',
    status: 'ok',
    code: 'core_ready',
    detail: 'Core is available.',
    observedAt,
    stale: false,
    facts: [],
    ...overrides
  }
}

describe('DiagnosticsCenter projections', () => {
  it('keeps the production actions while using the shared centered settings composition', () => {
    const markup = renderToStaticMarkup(createElement(DiagnosticsCenter, { onNavigate: () => undefined }))
    expect(markup).toContain('Settings / Diagnostics')
    expect(markup).toContain('检查运行环境并处理可安全修复的问题。')
    expect(markup).toContain('重新检查')
    expect(markup).toContain('导出诊断')
    expect(markup).toContain('class="diagnostics-body"')
    expect(markup).toContain('诊断会包含哪些内容')
    expect(markup).toContain('正在读取诊断事实')
  })

  it('offers only explicitly supported next steps', () => {
    expect(diagnosticActionForCheck(check({
      id: 'legacy-skill-entries',
      group: 'managed_content',
      status: 'attention',
      code: 'legacy_skill_entries_recorded',
      facts: [{ key: 'entryCount', value: '24' }]
    }))).toEqual({ kind: 'cleanup_legacy_skill', label: '清理旧入口' })

    expect(diagnosticIssueCopy(check({
      id: 'legacy-skill-entries',
      group: 'managed_content',
      status: 'attention',
      code: 'legacy_skill_entries_recorded',
      facts: [{ key: 'entryCount', value: '24' }]
    }))).toEqual({
      title: '旧版 Skill 入口待清理',
      reason: '项目目录中留有旧版 Rovai 派发的 Skill 入口，可以统一清理。',
      impact: '仅清理确认由 Rovai 派发的旧入口；运行中或无法确认的入口会自动跳过。'
    })

    expect(diagnosticActionForCheck(check({
      id: 'legacy-skill-entries',
      group: 'managed_content',
      status: 'ok',
      code: 'legacy_skill_entries_clear'
    }))).toBeNull()

    expect(diagnosticActionForCheck(check({
      id: 'mcp-config',
      group: 'managed_content',
      status: 'attention',
      code: 'mcp_config_permissions_too_broad'
    }))).toEqual({ kind: 'repair_mcp', label: '修复权限' })

    expect(diagnosticActionForCheck(check({
      id: 'database',
      status: 'attention',
      code: 'database_integrity_issue'
    }))).toEqual({ kind: 'export', label: '导出诊断 JSON' })
    expect(diagnosticActionForCheck(check({
      id: 'database',
      status: 'unknown',
      code: 'database_quick_check_failed'
    }))).toEqual({ kind: 'export', label: '导出诊断 JSON' })
  })

  it('separates unavailable and inconclusive Runtime actions', () => {
    const runtime = {
      id: 'runtime:codex-cli',
      group: 'agent_runtimes' as const,
      subjectKind: 'runtime',
      subjectId: 'codex-cli',
      label: 'Codex CLI'
    }
    expect(diagnosticActionForCheck(check({
      ...runtime,
      status: 'attention',
      code: 'runtime_missing'
    }))).toEqual({
      kind: 'open_runtime',
      label: '前往 Agent 运行时',
      runtimeKind: 'codex-cli'
    })
    expect(diagnosticActionForCheck(check({
      ...runtime,
      status: 'unknown',
      code: 'runtime_check_incomplete'
    }))).toEqual({
      kind: 'retry_runtime',
      label: '重新检测',
      runtimeKind: 'codex-cli'
    })
  })

  it('does not turn an unused missing Runtime into an issue', () => {
    const unused = check({
      id: 'runtime:gemini-cli',
      group: 'agent_runtimes',
      subjectKind: 'runtime',
      subjectId: 'gemini-cli',
      label: 'Gemini CLI',
      status: 'ok',
      code: 'runtime_not_in_use',
      facts: [{ key: 'availabilityStatus', value: 'missing' }]
    })
    expect(diagnosticActionForCheck(unused)).toBeNull()
    expect(diagnosticCheckDetail(unused)).toBe('当前未使用 · missing')
  })

  it('filters unknown separately from actionable issues', () => {
    const checks = [
      check({ id: 'ok', status: 'ok' }),
      check({ id: 'attention', status: 'attention' }),
      check({ id: 'unknown', status: 'unknown' })
    ]
    expect(diagnosticChecksForFilter(checks, 'attention').map(({ id }) => id)).toEqual(['attention'])
    expect(diagnosticChecksForFilter(checks, 'unknown').map(({ id }) => id)).toEqual(['unknown'])
    expect(diagnosticChecksForFilter(checks, 'all')).toHaveLength(3)
  })
})
