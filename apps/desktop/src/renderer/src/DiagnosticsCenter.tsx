import { useEffect, useMemo, useState } from 'react'
import type {
  AdapterKind,
  DiagnosticCheck,
  DiagnosticGroup,
  DiagnosticsReport,
  DiagnosticStatus,
  StoredCommandResult
} from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

export type DiagnosticFilter = 'all' | DiagnosticStatus
type Notice = {
  tone: 'success' | 'attention' | 'info'
  title: string
  detail: string
  exportPath?: string
}

export type DiagnosticAction =
  | { kind: 'repair_skill'; label: string }
  | { kind: 'repair_mcp'; label: string }
  | { kind: 'open_mcp'; label: string }
  | { kind: 'retry_runtime'; label: string; runtimeKind: AdapterKind }
  | { kind: 'open_runtime'; label: string; runtimeKind: AdapterKind }
  | { kind: 'export'; label: string }

const GROUP_ORDER: DiagnosticGroup[] = [
  'local_dependencies',
  'managed_content',
  'agent_runtimes'
]

const STATUS_META: Record<DiagnosticStatus, { label: string; symbol: string }> = {
  ok: { label: '正常', symbol: '✓' },
  attention: { label: '需要处理', symbol: '!' },
  unknown: { label: '暂时无法确认', symbol: '?' }
}

export function DiagnosticsCenter({
  onNavigate
}: {
  onNavigate(section: 'mcp' | 'runtime', runtimeKind?: AdapterKind): void
}): React.JSX.Element {
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [repairingId, setRepairingId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [filter, setFilter] = useState<DiagnosticFilter>('all')
  const [initialError, setInitialError] = useState<string | null>(null)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let cancelled = false
    void readReport()
      .then((next) => {
        if (!cancelled) {
          setReport(next)
          setInitialError(null)
        }
      })
      .catch((error) => {
        if (!cancelled) setInitialError(errorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const issues = useMemo(
    () => report?.checks.filter((check) => check.status === 'attention') ?? [],
    [report]
  )
  const disabled = running || repairingId !== null || exporting

  const runFullCheck = async (): Promise<void> => {
    if (disabled) return
    setRunning(true)
    setRecoveryError(null)
    setNotice(null)
    try {
      const next = await readReport()
      setReport(next)
      setInitialError(null)
      setNotice({
        tone: next.summary.attention > 0 || next.summary.unknown > 0 ? 'info' : 'success',
        title: '完整自检已完成',
        detail: summarySentence(next)
      })
    } catch (error) {
      const message = errorMessage(error)
      if (report) setRecoveryError(message)
      else setInitialError(message)
    } finally {
      setRunning(false)
    }
  }

  const exportDiagnostics = async (): Promise<void> => {
    if (disabled) return
    setExporting(true)
    setNotice(null)
    try {
      const path = await window.rovai.exportDiagnostics()
      if (path) {
        setNotice({
          tone: 'success',
          title: '诊断 JSON 已导出',
          detail: '已生成结构化、集中脱敏的 v5 诊断文件。',
          exportPath: path
        })
      }
    } catch (error) {
      setNotice({ tone: 'attention', title: '导出未完成', detail: errorMessage(error) })
    } finally {
      setExporting(false)
    }
  }

  const executeAction = async (check: DiagnosticCheck): Promise<void> => {
    const action = diagnosticActionForCheck(check)
    if (!action || disabled) return
    if (action.kind === 'open_mcp') {
      onNavigate('mcp')
      return
    }
    if (action.kind === 'open_runtime') {
      onNavigate('runtime', action.runtimeKind)
      return
    }
    if (action.kind === 'export') {
      await exportDiagnostics()
      return
    }

    setRepairingId(check.id)
    setNotice(null)
    setRecoveryError(null)
    try {
      if (action.kind === 'repair_skill') {
        const result = await window.rovai.request<StoredCommandResult>('skills.reconcile', {
          commandId: crypto.randomUUID(),
          command: {}
        })
        assertApplied(result)
      } else if (action.kind === 'repair_mcp') {
        await window.rovai.request('mcp.config.repairPermissions')
      } else {
        await window.rovai.request('runtime.product.check', {
          runtimeKind: action.runtimeKind
        })
      }

      const next = action.kind === 'retry_runtime'
        ? await waitForRuntimeResult(check.id)
        : await readReport()
      setReport(next)
      const rechecked = next.checks.find((candidate) => candidate.id === check.id)
      if (rechecked?.status === 'ok') {
        setNotice({
          tone: 'success',
          title: action.kind === 'repair_skill' ? 'Skill 已重新同步' : action.kind === 'repair_mcp' ? 'MCP 权限已修复' : 'Runtime 重新检测完成',
          detail: '复检已确认该项目恢复正常；摘要和完整结果已同步更新。'
        })
      } else if (rechecked?.status === 'unknown') {
        setNotice({
          tone: 'info',
          title: '复检暂时无法确认',
          detail: '最近一次成功证据已保留；当前结果没有被冒充为成功。'
        })
      } else {
        setNotice({
          tone: 'attention',
          title: '操作完成，但问题仍然存在',
          detail: '复检没有确认恢复正常。诊断详情已更新，请按新的原因继续处理。'
        })
      }
    } catch (error) {
      setNotice({
        tone: 'attention',
        title: '操作未完成',
        detail: `${errorMessage(error)} 最近一次成功检查结果仍然保留。`
      })
    } finally {
      setRepairingId(null)
    }
  }

  return (
    <div className="diagnostics-center">
      <SettingsPageHeader
        eyebrow="Settings / Diagnostics"
        title="诊断与修复"
        description="检查本地依赖、受管内容和 Agent 运行时，并为可安全处理的问题提供明确下一步。"
        aside={(
          <>
            <button className="primary-button" type="button" onClick={() => void runFullCheck()} disabled={disabled}>
              {running ? <><span className="diagnostics-spinner" aria-hidden="true" />正在检查…</> : '运行完整自检'}
            </button>
            <button className="quiet-button" type="button" onClick={() => void exportDiagnostics()} disabled={disabled}>
              {exporting ? '正在导出…' : '导出诊断 JSON'}
            </button>
          </>
        )}
      />

      <div className="diagnostics-privacy-note">
        <span aria-hidden="true">▣</span>
        <p><strong>隐私边界：</strong>屏幕和 v5 导出不会包含 Token、Cookie、登录信息、用户消息、记忆正文、附件正文、Tool 输出或绝对 Home、Runtime、项目路径。</p>
      </div>

      {loading && <DiagnosticsLoading />}
      {!loading && initialError && !report && (
        <section className="diagnostics-state diagnostics-state-error" role="alert">
          <span aria-hidden="true">!</span>
          <div><h2>无法读取诊断结果</h2><p>{initialError}</p></div>
          <button className="quiet-button" type="button" onClick={() => void runFullCheck()} disabled={running}>重试</button>
        </section>
      )}

      {report && (
        <>
          {running && (
            <div className="diagnostics-running" role="status" aria-live="polite">
              <span className="diagnostics-spinner" aria-hidden="true" />
              <div><strong>正在运行严格只读的完整自检</strong><span>读取当前 Core、SQLite、Skill、MCP 与 Runtime 缓存事实；不会触发同步、修复或 Runtime 重检。</span></div>
            </div>
          )}
          {recoveryError && (
            <div className="diagnostics-recovery" role="alert">
              <div><strong>本次检查未完成</strong><span>已保留 {formatTimestamp(report.checkedAt)} 的最近成功结果。失败原因：{recoveryError}</span></div>
              <button className="quiet-button compact" type="button" onClick={() => void runFullCheck()} disabled={disabled}>重新检查</button>
            </div>
          )}
          {notice && (
            <div className={`diagnostics-notice is-${notice.tone}`} role="status" aria-live="polite">
              <span aria-hidden="true">{notice.tone === 'success' ? '✓' : notice.tone === 'attention' ? '!' : 'i'}</span>
              <div><strong>{notice.title}</strong><small>{notice.detail}</small></div>
              {notice.exportPath && (
                <button className="quiet-button compact" type="button" onClick={() => void window.rovai.revealDiagnosticsExport(notice.exportPath!)}>在 Finder 中显示</button>
              )}
              <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          <DiagnosticsSummary report={report} recovery={recoveryError !== null} />

          <section className="diagnostics-section" aria-labelledby="diagnostics-issues-heading">
            <div className="section-heading">
              <div><h2 id="diagnostics-issues-heading">需要处理的问题</h2><p>按本地依赖、受管内容和 Runtime 排列；安全修复只影响之后启动的 AgentRun。</p></div>
              <span className={`health-score ${issues.length === 0 ? 'is-ok' : ''}`}>{issues.length === 0 ? '全部正常' : `${issues.length} 项`}</span>
            </div>
            {issues.length === 0
              ? <div className="diagnostics-issues-empty"><span aria-hidden="true">✓</span><div><strong>当前没有需要处理的问题</strong><p>暂时无法确认的项目仍保留在摘要和完整检查结果中。</p></div></div>
              : <div className="diagnostics-issue-list">{issues.map((check) => (
                  <DiagnosticIssue
                    key={check.id}
                    check={check}
                    action={diagnosticActionForCheck(check)}
                    busy={repairingId === check.id}
                    disabled={disabled}
                    onAction={() => void executeAction(check)}
                  />
                ))}</div>}
          </section>

          <DiagnosticsResults
            report={report}
            filter={filter}
            disabled={disabled}
            repairingId={repairingId}
            onFilter={setFilter}
            onAction={(check) => void executeAction(check)}
          />
        </>
      )}
    </div>
  )
}

function DiagnosticsLoading(): React.JSX.Element {
  return (
    <section className="diagnostics-state" aria-live="polite">
      <span className="diagnostics-spinner" aria-hidden="true" />
      <div><h2>正在读取诊断事实</h2><p>Rovai-ai 正在读取当前 Core 快照；不会在加载时运行修复。</p></div>
    </section>
  )
}

function DiagnosticsSummary({ report, recovery }: { report: DiagnosticsReport; recovery: boolean }): React.JSX.Element {
  const summary = report.summary
  const healthy = summary.attention === 0 && summary.unknown === 0
  const title = recovery
    ? '保留最近一次成功检查结果'
    : healthy
      ? '当前没有发现需要处理的问题'
      : `发现 ${summary.attention} 项需要处理${summary.unknown ? `，${summary.unknown} 项暂时无法确认` : ''}`
  return (
    <section className="diagnostics-summary" aria-labelledby="diagnostics-summary-title">
      <div className="diagnostics-summary-primary">
        <span className={`diagnostics-summary-mark ${healthy ? 'is-ok' : recovery ? 'is-recovery' : ''}`} aria-hidden="true">{healthy ? '✓' : recovery ? '↻' : '!'}</span>
        <div><span>最近一次完整自检</span><h2 id="diagnostics-summary-title">{title}</h2><p>检查时间：{formatTimestamp(report.checkedAt)}。刷新失败时保留最近成功证据，并明确标注失败。</p></div>
      </div>
      <dl className="diagnostics-summary-counts">
        <div className="is-ok"><dt>正常</dt><dd>{summary.ok}</dd></div>
        <div className="is-attention"><dt>需要处理</dt><dd>{summary.attention}</dd></div>
        <div className="is-unknown"><dt>暂时无法确认</dt><dd>{summary.unknown}</dd></div>
      </dl>
      <p className="diagnostics-summary-boundary">Rovai 只在你明确点击单项操作后修复可安全重建的受管状态；不会自动修改 SQLite、覆盖损坏的 MCP 配置、登录或替换 Runtime。</p>
    </section>
  )
}

function DiagnosticIssue({
  check,
  action,
  busy,
  disabled,
  onAction
}: {
  check: DiagnosticCheck
  action: DiagnosticAction | null
  busy: boolean
  disabled: boolean
  onAction(): void
}): React.JSX.Element {
  const copy = issueCopy(check)
  return (
    <article className="diagnostics-issue">
      <span className="diagnostics-issue-mark" aria-label="需要处理">!</span>
      <div className="diagnostics-issue-copy">
        <div><h3>{copy.title}</h3><span>{action?.kind.startsWith('repair_') ? '安全修复' : '用户操作'}</span></div>
        <p>{copy.reason}</p>
        <small><strong>影响：</strong>{copy.impact}</small>
      </div>
      <div className="diagnostics-issue-action">
        {action && <button className={action.kind.startsWith('repair_') ? 'primary-button compact' : 'quiet-button compact'} type="button" onClick={onAction} disabled={disabled}>{busy ? '正在处理…' : action.label}</button>}
      </div>
      <DiagnosticDetails check={check} />
    </article>
  )
}

function DiagnosticsResults({
  report,
  filter,
  disabled,
  repairingId,
  onFilter,
  onAction
}: {
  report: DiagnosticsReport
  filter: DiagnosticFilter
  disabled: boolean
  repairingId: string | null
  onFilter(filter: DiagnosticFilter): void
  onAction(check: DiagnosticCheck): void
}): React.JSX.Element {
  const visible = diagnosticChecksForFilter(report.checks, filter)
  return (
    <section className="diagnostics-section" aria-labelledby="diagnostics-results-heading">
      <div className="section-heading"><div><h2 id="diagnostics-results-heading">完整检查结果</h2><p>展开单项查看检查证据；状态同时使用文字、图标和稳定位置表达。</p></div></div>
      <div className="diagnostics-results-toolbar">
        <div className="diagnostics-filters" role="group" aria-label="筛选检查结果">
          {([['all', '全部'], ['attention', '需要处理'], ['ok', '正常'], ['unknown', '暂时无法确认']] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>{label}</button>
          ))}
        </div>
        <span>更新于 {formatTimestamp(report.checkedAt)}</span>
      </div>
      <div className="diagnostics-results">
        {GROUP_ORDER.map((group) => {
          const checks = visible.filter((check) => check.group === group)
          if (checks.length === 0) return null
          return (
            <section className="diagnostics-result-group" key={group}>
              <div className="diagnostics-result-group-heading"><strong>{groupLabel(group)}</strong><span>{checks.length} 项</span></div>
              {checks.map((check) => {
                const action = resultActionForCheck(check)
                return (
                  <div className="diagnostics-result-row" key={check.id}>
                    <span className={`diagnostics-result-status is-${check.status}`} aria-label={STATUS_META[check.status].label}>{STATUS_META[check.status].symbol}</span>
                    <div className="diagnostics-result-name"><strong>{check.label}</strong><span>{STATUS_META[check.status].label}</span></div>
                    <div className="diagnostics-result-detail">{diagnosticCheckDetail(check)}</div>
                    {action && <button className="quiet-button compact" type="button" disabled={disabled} onClick={() => onAction(check)}>{repairingId === check.id ? '正在处理…' : action.label}</button>}
                    <DiagnosticDetails check={check} compact />
                  </div>
                )
              })}
            </section>
          )
        })}
        {visible.length === 0 && <div className="diagnostics-results-empty">当前筛选条件下没有检查结果。</div>}
      </div>
    </section>
  )
}

function DiagnosticDetails({ check, compact = false }: { check: DiagnosticCheck; compact?: boolean }): React.JSX.Element {
  return (
    <details className={`diagnostics-details ${compact ? 'is-compact' : ''}`}>
      <summary>诊断详情</summary>
      <dl>
        <div><dt>状态代码</dt><dd><code>{check.code}</code></dd></div>
        {check.facts.map((fact) => <div key={fact.key}><dt>{factLabel(fact.key)}</dt><dd><code>{fact.value || '—'}</code></dd></div>)}
        <div><dt>检查时间</dt><dd><code>{formatTimestamp(check.observedAt)}</code></dd></div>
      </dl>
      <p><strong>检查证据：</strong>{check.detail}{check.stale ? '；这是最近成功证据，本次刷新未能确认。' : ''}</p>
    </details>
  )
}

export function diagnosticActionForCheck(check: DiagnosticCheck): DiagnosticAction | null {
  if (check.id === 'skill-projections' && check.status === 'attention') return { kind: 'repair_skill', label: '重新同步 Skill' }
  if (check.id === 'mcp-config' && check.code === 'mcp_config_permissions_too_broad') return { kind: 'repair_mcp', label: '修复文件权限' }
  if (check.id === 'mcp-config' && check.status === 'attention') return { kind: 'open_mcp', label: '前往 MCP 设置' }
  if (check.subjectKind === 'runtime' && check.subjectId && check.status === 'attention') return { kind: 'open_runtime', label: '前往 Agent 运行时', runtimeKind: check.subjectId as AdapterKind }
  if (check.subjectKind === 'runtime' && check.subjectId && check.status === 'unknown') return { kind: 'retry_runtime', label: '重新检测', runtimeKind: check.subjectId as AdapterKind }
  if ((check.id === 'database' || check.id === 'data-directory') && check.status !== 'ok') return { kind: 'export', label: '导出诊断 JSON' }
  if (check.status === 'attention') return { kind: 'export', label: '导出诊断 JSON' }
  return null
}

function resultActionForCheck(check: DiagnosticCheck): DiagnosticAction | null {
  return check.status === 'ok' ? null : diagnosticActionForCheck(check)
}

export function diagnosticChecksForFilter(
  checks: DiagnosticCheck[],
  filter: DiagnosticFilter
): DiagnosticCheck[] {
  return checks.filter((check) => filter === 'all' || check.status === filter)
}

function issueCopy(check: DiagnosticCheck): { title: string; reason: string; impact: string } {
  if (check.id === 'skill-projections') return {
    title: 'Skill 投影需要重新同步',
    reason: `${factValue(check, 'issueCount') ?? '部分'} 个受管投影与当前 Library Revision 不一致。`,
    impact: '影响之后启动的 AgentRun；当前运行不会热切换，项目自有同名内容不会被覆盖。'
  }
  if (check.id === 'mcp-config' && check.code === 'mcp_config_permissions_too_broad') return {
    title: 'MCP 配置权限不安全',
    reason: '当前配置文件权限比仅当前用户可读写的 0600 更宽。',
    impact: '新的 AgentRun 暂不应依赖外部 MCP；修复只收紧权限，不改写 JSON。'
  }
  if (check.id === 'mcp-config') return {
    title: 'MCP 配置需要人工处理',
    reason: '配置无法安全解析或不是普通文件；原始内容已保留。',
    impact: '后续新执行不会投影外部 MCP；现有 AgentRun 继续使用冻结的 Exposure Snapshot。'
  }
  if (check.id === 'database') return {
    title: 'SQLite 数据需要人工检查',
    reason: check.code === 'database_integrity_issue' ? '只读 quick_check 报告了完整性问题。' : '本次无法完成 SQLite 完整性确认。',
    impact: 'Rovai 不会自动修改或重建权威数据；请先导出诊断信息再进行人工处置。'
  }
  if (check.subjectKind === 'runtime') return {
    title: `${check.label} 当前不可用`,
    reason: runtimeReason(check.code),
    impact: `当前有 ${factValue(check, 'usedByMemberCount') ?? '至少一'} 位未移除队员使用它，新的执行可能无法开始。`
  }
  return {
    title: `${check.label} 需要处理`,
    reason: diagnosticCheckDetail(check),
    impact: '相关本机能力可能无法用于后续执行；Rovai 不会自动修改外部状态。'
  }
}

export function diagnosticCheckDetail(check: DiagnosticCheck): string {
  if (check.id === 'core') return `Core ${factValue(check, 'version') ?? ''} 可用`.replace('  ', ' ')
  if (check.id === 'data-directory') return check.status === 'ok' ? '当前 Core 可访问且可写' : check.status === 'attention' ? '数据目录不可写' : '本次无法确认'
  if (check.code === 'runtime_not_in_use') return `当前未使用 · ${factValue(check, 'availabilityStatus') ?? '未检测'}`
  if (check.subjectKind === 'runtime') {
    const version = factValue(check, 'reportedVersion')
    return `${STATUS_META[check.status].label}${version ? ` · ${version}` : ''}${check.stale ? ' · 保留最近成功证据' : ''}`
  }
  if (check.id === 'skill-projections') return check.status === 'ok' ? '所有受管投影与当前 Revision 一致' : `${factValue(check, 'issueCount') ?? '—'} 个投影需要处理`
  if (check.id === 'mcp-config') return check.code === 'mcp_config_not_initialized' ? '尚未初始化 · 无外部 MCP' : check.status === 'ok' ? `配置有效 · ${factValue(check, 'serverCount') ?? '0'} 个 Server` : STATUS_META[check.status].label
  if (check.id === 'database') return check.status === 'ok' ? 'WAL · quick_check 通过' : STATUS_META[check.status].label
  if (check.id === 'git') return check.status === 'ok' ? factValue(check, 'version') ?? '可用' : '当前 PATH 中不可用'
  return check.detail
}

function runtimeReason(code: string): string {
  if (code === 'runtime_authentication_required') return '最近一次可用性证据表明需要登录。'
  if (code === 'runtime_missing') return '当前未找到已选择的 Runtime。'
  if (code === 'runtime_incompatible') return '已安装版本不在支持范围内。'
  if (code === 'runtime_path_missing') return '已配置的可执行入口不再存在。'
  if (code === 'runtime_disabled') return 'Runtime 已停用，但仍被队员选择。'
  return '当前 Runtime 证据表明它不可用于新执行。'
}

function groupLabel(group: DiagnosticGroup): string {
  if (group === 'local_dependencies') return '本地依赖'
  if (group === 'managed_content') return '受管内容'
  return 'Agent 运行时'
}

function factValue(check: DiagnosticCheck, key: string): string | null {
  return check.facts.find((fact) => fact.key === key)?.value ?? null
}

function factLabel(key: string): string {
  const labels: Record<string, string> = {
    version: '版本',
    quickCheck: 'quick_check',
    quickCheckResultCount: '异常结果数',
    issueCount: '问题数',
    issueCodes: '问题代码',
    serverCount: 'Server 数',
    expectedMode: '期望权限',
    usedByMemberCount: '使用队员数',
    availabilityStatus: 'Runtime 状态',
    reportedVersion: '报告版本',
    diagnosticCode: '诊断代码',
    lastSuccessfulProbeAt: '最近成功检查'
  }
  return labels[key] ?? key
}

function summarySentence(report: DiagnosticsReport): string {
  const { ok, attention, unknown } = report.summary
  return `${ok} 项正常，${attention} 项需要处理，${unknown} 项暂时无法确认。`
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

async function readReport(): Promise<DiagnosticsReport> {
  const report = await window.rovai.request<DiagnosticsReport>('diagnostics.check')
  if (report.schemaVersion !== 1) throw new Error('诊断报告版本不兼容。')
  return report
}

async function waitForRuntimeResult(checkId: string): Promise<DiagnosticsReport> {
  let latest = await readReport()
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const check = latest.checks.find((candidate) => candidate.id === checkId)
    if (!check || check.code !== 'runtime_check_incomplete') return latest
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    latest = await readReport()
  }
  return latest
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status === 'applied') return
  throw new Error(result.code || 'Core 拒绝了这次操作。')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
