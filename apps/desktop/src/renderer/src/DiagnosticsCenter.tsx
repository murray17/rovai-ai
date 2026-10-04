import { useThreadClient, type ThreadClient } from './camp-client'
import { newCommandId } from '../../shared/command-id'
import { readErrorMessage } from './error-message'
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
import { revealInFileManagerLabel } from './renderer-platform'
import { requestProductRuntimeCheck } from './runtime-check'
import { UiText, getInterfaceLanguage, uiAttribute } from './interface-language'

export type DiagnosticFilter = 'all' | DiagnosticStatus
type Notice = {
  tone: 'success' | 'attention' | 'info'
  title: string
  detail: string
  exportPath?: string
}

export type DiagnosticAction =
  | { kind: 'cleanup_legacy_skill'; label: string }
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

const STATUS_META: Record<DiagnosticStatus, { label: string }> = {
  ok: { label:"正常" },
  attention: { label:"需要处理" },
  unknown: { label:"暂时无法确认" }
}

type LegacyCleanupResult = {
  removed: number
  alreadyMissing: number
  retainedActiveRun: number
  retainedInaccessible: number
  retainedUnverified: number
  remaining: number
}

function legacyCleanupMessage(result: LegacyCleanupResult): string {
  const retained = [
    result.retainedActiveRun ? uiAttribute("运行中 {0} 个", String(result.retainedActiveRun)) : null,
    result.retainedInaccessible ? uiAttribute("不可访问 {0} 个", String(result.retainedInaccessible)) : null,
    result.retainedUnverified ? uiAttribute("归属无法确认 {0} 个", String(result.retainedUnverified)) : null
  ].filter(Boolean)
  return uiAttribute("已清理 {0} 个旧入口{1}。{2}", String(result.removed), result.alreadyMissing ? uiAttribute('，移除 {0} 条失效记录', result.alreadyMissing) : '', retained.length ? uiAttribute('已保留：{0}。', retained.join(uiAttribute('、'))) : '')
}

export function DiagnosticsCenter({
  onNavigate,
  platform = 'darwin'
}: {
  onNavigate(section: 'mcp' | 'runtime', runtimeKind?: AdapterKind): void
  platform?: NodeJS.Platform
}): React.JSX.Element {
  const client = useThreadClient()
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [repairingId, setRepairingId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [filter, setFilter] = useState<DiagnosticFilter>('all')
  const [initialError, setInitialError] = useState<string | null>(null)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [legacyCleanupResult, setLegacyCleanupResult] = useState<LegacyCleanupResult | null>(null)

  useEffect(() => {
    let cancelled = false
    void readReport(client)
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
  }, [client])

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
      const next = await readReport(client)
      setReport(next)
      setInitialError(null)
      setNotice({
        tone: next.summary.attention > 0 || next.summary.unknown > 0 ? 'info' : 'success',
        title:uiAttribute("完整自检已完成"),
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
      const { exported, path } = await client.exportDiagnostics()
      if (exported) {
        setNotice({
          tone: 'success',
          title:uiAttribute("诊断 JSON 已导出"),
          detail:uiAttribute("已生成结构化、集中脱敏的 v5 诊断文件。"),
          exportPath: path
        })
      }
    } catch (error) {
      setNotice({ tone: 'attention', title:uiAttribute("导出未完成"), detail: errorMessage(error) })
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
    if (action.kind === 'cleanup_legacy_skill') setLegacyCleanupResult(null)
    try {
      let cleanupResult: LegacyCleanupResult | null = null
      if (action.kind === 'cleanup_legacy_skill') {
        const result = await client.request<StoredCommandResult>('skills.cleanupLegacyEntries', {
          commandId: newCommandId(),
          command: {}
        })
        assertApplied(result)
        cleanupResult = result.payload as LegacyCleanupResult
        setLegacyCleanupResult(cleanupResult)
      } else if (action.kind === 'repair_mcp') {
        await client.request('mcp.config.repairPermissions')
      } else {
        await requestProductRuntimeCheck(action.runtimeKind, client.request)
      }

      const next = action.kind === 'retry_runtime'
        ? await waitForRuntimeResult(check.id, client)
        : await readReport(client)
      setReport(next)
      const rechecked = next.checks.find((candidate) => candidate.id === check.id)
      if (rechecked?.status === 'ok') {
        setNotice({
          tone: 'success',
          title: action.kind === 'cleanup_legacy_skill' ?uiAttribute("旧版 Skill 入口已清理") : action.kind === 'repair_mcp' ?uiAttribute("MCP 权限已修复") :uiAttribute("智能体重新检测完成"),
          detail: action.kind === 'cleanup_legacy_skill' && cleanupResult
            ? legacyCleanupMessage(cleanupResult)
            :uiAttribute("复检已确认该项目恢复正常；摘要和完整结果已同步更新。")
        })
      } else if (rechecked?.status === 'unknown') {
        setNotice({
          tone: 'info',
          title:uiAttribute("复检暂时无法确认"),
          detail:uiAttribute("最近一次成功证据已保留；当前结果没有被冒充为成功。")
        })
      } else {
        setNotice({
          tone: 'attention',
          title:uiAttribute("操作完成，但问题仍然存在"),
          detail: action.kind === 'cleanup_legacy_skill'
            ?uiAttribute("未确认的旧入口已保留；处理状态显示在同一问题中。")
            :uiAttribute("复检没有确认恢复正常。诊断详情已更新，请按新的原因继续处理。")
        })
      }
    } catch (error) {
      if (action.kind === 'cleanup_legacy_skill') {
        try { setReport(await readReport(client)) }
        catch { /* Keep the last successful report when a fresh check is unavailable. */ }
      }
      setNotice({
        tone: 'attention',
        title:uiAttribute("操作未完成"),
        detail: uiAttribute("{0} 最近一次成功检查结果仍然保留。", String(errorMessage(error)))
      })
    } finally {
      setRepairingId(null)
    }
  }

  return (
    <div className="diagnostics-center">
      <SettingsPageHeader
        eyebrow="Settings / Diagnostics"
        title={uiAttribute("诊断与修复")}
        description={uiAttribute("检查运行环境并处理可安全修复的问题。")}
        aside={(
          <>
            <button className="primary-button" type="button" onClick={() => void runFullCheck()} disabled={disabled}>
              {running ? <><span className="diagnostics-spinner" aria-hidden="true" /><UiText zh={"正在检查…"} /></> : uiAttribute("重新检查")}
            </button>
            <button className="quiet-button" type="button" onClick={() => void exportDiagnostics()} disabled={disabled}>
              {exporting ? uiAttribute("正在导出…") : uiAttribute("导出诊断")}
            </button>
          </>
        )}
      />

      <div className="diagnostics-body">
      <details className="settings-disclosure diagnostics-policy"><summary><DiagnosticGlyph name="shield" /><span><UiText zh={"诊断会包含哪些内容？"} /></span><DiagnosticGlyph name="chevron" /></summary><div><p><UiText zh={"只包含检查状态与必要的诊断信息，敏感内容已排除。"} /></p><p><UiText zh={"不包含 Token、Cookie、登录信息、消息与记忆正文、附件内容、工具输出或本机绝对路径。"} /></p><p><UiText zh={"检查只读；修复需逐项点击，不会自动登录或替换智能体。"} /></p></div></details>

      {loading && <DiagnosticsLoading />}
      {!loading && initialError && !report && (
        <section className="diagnostics-state diagnostics-state-error" role="alert">
          <span aria-hidden="true"><DiagnosticStatusIcon status="attention" /></span>
          <div><h2><UiText zh={"无法读取诊断结果"} /></h2><p>{initialError}</p></div>
          <button className="quiet-button" type="button" onClick={() => void runFullCheck()} disabled={running}><UiText zh={"重试"} /></button>
        </section>
      )}

      {report && (
        <>
          {running && (
            <div className="diagnostics-running" role="status" aria-live="polite">
              <span className="diagnostics-spinner" aria-hidden="true" />
              <div><strong><UiText zh={"正在运行严格只读的完整自检"} /></strong><span><UiText zh={"读取当前 Core、SQLite、Skill、MCP 与智能体缓存事实；不会触发同步、修复或智能体重检。"} /></span></div>
            </div>
          )}
          {recoveryError && (
            <div className="diagnostics-recovery" role="alert">
              <div><strong><UiText zh={"本次检查未完成"} /></strong><span><UiText zh={"已保留 "} />{formatTimestamp(report.checkedAt)}<UiText zh={" 的最近成功结果。失败原因："} />{recoveryError}</span></div>
              <button className="quiet-button compact" type="button" onClick={() => void runFullCheck()} disabled={disabled}><UiText zh={"重新检查"} /></button>
            </div>
          )}
          {notice && (
            <div className={`diagnostics-notice is-${notice.tone}`} role="status" aria-live="polite">
              <span aria-hidden="true"><DiagnosticStatusIcon status={notice.tone === 'success' ? 'ok' : notice.tone === 'attention' ? 'attention' : 'unknown'} /></span>
              <div><strong>{notice.title}</strong><small>{notice.detail}</small></div>
              {notice.exportPath && client.revealDiagnosticsExport && (
                <button className="quiet-button compact" type="button" onClick={() => void client.revealDiagnosticsExport?.(notice.exportPath!)}>{revealInFileManagerLabel(platform)}</button>
              )}
              <button className="icon-button" type="button" aria-label={uiAttribute("关闭提示")} onClick={() => setNotice(null)}><DiagnosticGlyph name="close" /></button>
            </div>
          )}

          <DiagnosticsSummary report={report} recovery={recoveryError !== null} />

          <section className="diagnostics-section" aria-labelledby="diagnostics-issues-heading">
            <div className="section-heading">
              <div><h2 id="diagnostics-issues-heading"><UiText zh={"需要处理的问题"} /></h2><p><UiText zh={"逐项处理，修复后会重新检查。"} /></p></div>
              <span className={`health-score ${issues.length === 0 ? 'is-ok' : ''}`}>{issues.length === 0 ? uiAttribute("无需修复") : uiAttribute("{0} 项", String(issues.length))}</span>
            </div>
            {issues.length === 0
              ? <div className="diagnostics-issues-empty"><span aria-hidden="true"><DiagnosticStatusIcon status="ok" /></span><div><strong><UiText zh={"当前没有需要处理的问题"} /></strong><p><UiText zh={"暂时无法确认的项目仍保留在摘要和完整检查结果中。"} /></p></div></div>
              : <div className="diagnostics-issue-list">{issues.map((check) => (
                  <DiagnosticIssue
                    key={check.id}
                    check={check}
                    action={diagnosticActionForCheck(check)}
                    busy={repairingId === check.id}
                    disabled={disabled}
                    onAction={() => void executeAction(check)}
                    legacyCleanupResult={check.id === 'legacy-skill-entries' ? legacyCleanupResult : null}
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
    </div>
  )
}

function DiagnosticsLoading(): React.JSX.Element {
  return (
    <section className="diagnostics-state" aria-live="polite">
      <span className="diagnostics-spinner" aria-hidden="true" />
      <div><h2><UiText zh={"正在读取诊断事实"} /></h2><p><UiText zh={"Rovai AI 正在读取当前 Core 快照；不会在加载时运行修复。"} /></p></div>
    </section>
  )
}

function DiagnosticsSummary({ report, recovery }: { report: DiagnosticsReport; recovery: boolean }): React.JSX.Element {
  const summary = report.summary
  const healthy = summary.attention === 0 && summary.unknown === 0
  const title = recovery
    ?uiAttribute("保留最近一次成功检查结果")
    : healthy
      ?uiAttribute("当前没有发现需要处理的问题")
      : summary.attention === 0 ? uiAttribute("{0} 项暂时无法确认", String(summary.unknown)) : uiAttribute("发现 {0} 项需要处理{1}", String(summary.attention), summary.unknown ? uiAttribute('，{0} 项暂时无法确认', summary.unknown) : '')
  return (
    <section className="diagnostics-summary" aria-labelledby="diagnostics-summary-title">
      <div className="diagnostics-summary-primary">
        <span className={`diagnostics-summary-mark ${healthy ? 'is-ok' : recovery ? 'is-recovery' : ''}`} aria-hidden="true">
          {recovery ? <DiagnosticGlyph name="refresh" /> : <DiagnosticStatusIcon status={healthy ? 'ok' : 'attention'} />}
        </span>
        <div><span><UiText zh={"最近一次完整自检"} /></span><h2 id="diagnostics-summary-title">{title}</h2><p><UiText zh={"检查时间："} />{formatTimestamp(report.checkedAt)}</p></div>
      </div>
      <dl className="diagnostics-summary-counts">
        <div className="is-ok"><dt><UiText zh={"正常"} /></dt><dd>{summary.ok}</dd></div>
        <div className="is-attention"><dt><UiText zh={"需要处理"} /></dt><dd>{summary.attention}</dd></div>
        <div className="is-unknown"><dt><UiText zh={"暂时无法确认"} /></dt><dd>{summary.unknown}</dd></div>
      </dl>
      <p className="diagnostics-summary-boundary"><UiText zh={"Rovai 只在你明确点击单项操作后修复可安全重建的受管状态；不会自动修改 SQLite、覆盖损坏的 MCP 配置、登录或替换智能体。"} /></p>
    </section>
  )
}

function DiagnosticIssue({
  check,
  action,
  busy,
  disabled,
  onAction,
  legacyCleanupResult
}: {
  check: DiagnosticCheck
  action: DiagnosticAction | null
  busy: boolean
  disabled: boolean
  onAction(): void
  legacyCleanupResult: LegacyCleanupResult | null
}): React.JSX.Element {
  const copy = diagnosticIssueCopy(check)
  return (
    <article className="diagnostics-issue">
      <span className="diagnostics-issue-mark" aria-label={uiAttribute("需要处理")}><DiagnosticStatusIcon status="attention" /></span>
      <div className="diagnostics-issue-copy">
        <div><h3>{copy.title}</h3><span>{action?.kind.startsWith('repair_') || action?.kind === 'cleanup_legacy_skill' ? uiAttribute("安全修复") : uiAttribute("用户操作")}</span></div>
        <p>{copy.reason}</p>
        <small>{check.id === 'legacy-skill-entries' ? copy.impact : <><strong><UiText zh={"影响："} /></strong>{copy.impact}</>}</small>
        {legacyCleanupResult && <p className="diagnostics-cleanup-status" role="status">{legacyCleanupMessage(legacyCleanupResult)}</p>}
      </div>
      <div className="diagnostics-issue-action">
        {action && <button className={action.kind.startsWith('repair_') || action.kind === 'cleanup_legacy_skill' ? 'primary-button compact' : 'quiet-button compact'} type="button" onClick={onAction} disabled={disabled}>{busy ? uiAttribute("正在处理…") : action.label}</button>}
      </div>
      {check.id !== 'legacy-skill-entries' && <DiagnosticDetails check={check} />}
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
      <div className="section-heading"><div><h2 id="diagnostics-results-heading"><UiText zh={"完整检查结果"} /></h2><p><UiText zh={"展开单项查看诊断详情。"} /></p></div></div>
      <div className="diagnostics-results-toolbar">
        <div className="diagnostics-filters" role="group" aria-label={uiAttribute("筛选检查结果")}>
          {([['all', '全部'], ['attention', '需要处理'], ['ok', '正常'], ['unknown', '暂时无法确认']] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} type="button" aria-pressed={filter === value} onClick={() => onFilter(value)}>{uiAttribute(label)}</button>
          ))}
        </div>
        <span><UiText zh={"更新于 "} />{formatTimestamp(report.checkedAt)}</span>
      </div>
      <div className="diagnostics-results">
        {GROUP_ORDER.map((group) => {
          const checks = visible.filter((check) => check.group === group)
          if (checks.length === 0) return null
          return (
            <details className="diagnostics-result-group" key={group} open>
              <summary className="diagnostics-result-group-heading"><span><DiagnosticGlyph name="chevron" /><strong>{groupLabel(group)}</strong></span><span>{checks.length}<UiText zh={" 项"} /></span></summary>
              {checks.map((check) => {
                const action = resultActionForCheck(check)
                return (
                  <div className="diagnostics-result-row" key={check.id}>
                    <span className={`diagnostics-result-status is-${check.status}`} aria-label={uiAttribute(STATUS_META[check.status].label)}><DiagnosticStatusIcon status={check.status} /></span>
                    <div className="diagnostics-result-name"><strong>{check.label}</strong><span>{uiAttribute(STATUS_META[check.status].label)}</span></div>
                    <div className="diagnostics-result-detail">{diagnosticCheckDetail(check)}</div>
                    {action && <button className="quiet-button compact" type="button" disabled={disabled} onClick={() => onAction(check)}>{repairingId === check.id ? uiAttribute("正在处理…") : action.label}</button>}
                    <DiagnosticDetails check={check} compact />
                  </div>
                )
              })}
            </details>
          )
        })}
        {visible.length === 0 && <div className="diagnostics-results-empty"><UiText zh={"当前筛选条件下没有检查结果。"} /></div>}
      </div>
    </section>
  )
}

function DiagnosticDetails({ check, compact = false }: { check: DiagnosticCheck; compact?: boolean }): React.JSX.Element {
  return (
    <details className={`diagnostics-details ${compact ? 'is-compact' : ''}`}>
      <summary><span>{compact ? uiAttribute("详情") : uiAttribute("诊断详情")}</span><DiagnosticGlyph name="chevron" /></summary>
      <dl>
        <div><dt><UiText zh={"状态代码"} /></dt><dd><code>{check.code}</code></dd></div>
        {check.facts.map((fact) => <div key={fact.key}><dt>{factLabel(fact.key)}</dt><dd><code>{fact.value || '—'}</code></dd></div>)}
        <div><dt><UiText zh={"检查时间"} /></dt><dd><code>{formatTimestamp(check.observedAt)}</code></dd></div>
      </dl>
      <p><strong><UiText zh={"检查证据："} /></strong>{check.detail}{check.stale ? uiAttribute("；这是最近成功证据，本次刷新未能确认。") : ''}</p>
    </details>
  )
}

function DiagnosticStatusIcon({ status }: { status: DiagnosticStatus }): React.JSX.Element {
  if (status === 'ok') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 2.7 2.7L16.5 9" /></svg>
  }
  if (status === 'attention') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.2 2.8 17.1A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.9L13.7 4.2a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 0 1 4.65.8c0 1.8-2.45 2.05-2.45 3.7" /><path d="M12 17h.01" /></svg>
}

function DiagnosticGlyph({ name }: { name: 'shield' | 'close' | 'refresh' | 'chevron' }): React.JSX.Element {
  if (name === 'shield') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
  }
  if (name === 'close') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
  }
  if (name === 'refresh') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.8 7L20 12M4 12l1.2 5a7 7 0 0 0 12.7-1.5" /></svg>
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9.5 5 5 5-5" /></svg>
}

export function diagnosticActionForCheck(check: DiagnosticCheck): DiagnosticAction | null {
  if (check.id === 'legacy-skill-entries' && check.status === 'attention') return { kind: 'cleanup_legacy_skill', label:uiAttribute("清理旧入口") }
  if (check.id === 'mcp-config' && check.code === 'mcp_config_permissions_too_broad') return { kind: 'repair_mcp', label:uiAttribute("修复权限") }
  if (check.id === 'mcp-config' && check.status === 'attention') return { kind: 'open_mcp', label:uiAttribute("前往 MCP 设置") }
  if (check.subjectKind === 'runtime' && check.subjectId && check.status === 'attention') return { kind: 'open_runtime', label:uiAttribute("前往智能体"), runtimeKind: check.subjectId as AdapterKind }
  if (check.subjectKind === 'runtime' && check.subjectId && check.status === 'unknown') return { kind: 'retry_runtime', label:uiAttribute("重新检测"), runtimeKind: check.subjectId as AdapterKind }
  if ((check.id === 'database' || check.id === 'data-directory') && check.status !== 'ok') return { kind: 'export', label:uiAttribute("导出诊断 JSON") }
  if (check.status === 'attention') return { kind: 'export', label:uiAttribute("导出诊断 JSON") }
  return null
}

function resultActionForCheck(check: DiagnosticCheck): DiagnosticAction | null {
  if (check.id === 'legacy-skill-entries') return null
  return check.status === 'ok' ? null : diagnosticActionForCheck(check)
}

export function diagnosticChecksForFilter(
  checks: DiagnosticCheck[],
  filter: DiagnosticFilter
): DiagnosticCheck[] {
  return checks.filter((check) => filter === 'all' || check.status === filter)
}

export function diagnosticIssueCopy(check: DiagnosticCheck): { title: string; reason: string; impact: string } {
  if (check.id === 'legacy-skill-entries') return {
    title:uiAttribute("旧版 Skill 入口待清理"),
    reason:uiAttribute("项目目录中留有旧版 Rovai 派发的 Skill 入口，可以统一清理。"),
    impact:uiAttribute("仅清理确认由 Rovai 派发的旧入口；运行中或无法确认的入口会自动跳过。")
  }
  if (check.id === 'mcp-config' && check.code === 'mcp_config_permissions_too_broad') return {
    title:uiAttribute("MCP 配置权限不安全"),
    reason:uiAttribute("MCP 配置的访问权限过宽。"),
    impact:uiAttribute("新执行可能无法使用外部 MCP；修复只收紧文件权限，不改配置内容。")
  }
  if (check.id === 'mcp-config') return {
    title:uiAttribute("MCP 配置需要人工处理"),
    reason:uiAttribute("配置无法安全解析或不是普通文件；原始内容已保留。"),
    impact:uiAttribute("后续新执行不会投影外部 MCP；现有 AgentRun 继续使用冻结的 Exposure Snapshot。")
  }
  if (check.id === 'database') return {
    title:uiAttribute("SQLite 数据需要人工检查"),
    reason: check.code === 'database_integrity_issue' ?uiAttribute("只读 quick_check 报告了完整性问题。") :uiAttribute("本次无法完成 SQLite 完整性确认。"),
    impact:uiAttribute("Rovai 不会自动修改或重建权威数据；请先导出诊断信息再进行人工处置。")
  }
  if (check.subjectKind === 'runtime') return {
    title: uiAttribute("{0} 当前不可用", String(check.label)),
    reason: runtimeReason(check.code),
    impact: uiAttribute("当前有 {0} 位未移除队员使用它，新的执行可能无法开始。", String(factValue(check, 'usedByMemberCount') ?? uiAttribute('至少一')))
  }
  return {
    title: uiAttribute("{0} 需要处理", String(check.label)),
    reason: diagnosticCheckDetail(check),
    impact:uiAttribute("相关本机能力可能无法用于后续执行；Rovai 不会自动修改外部状态。")
  }
}

export function diagnosticCheckDetail(check: DiagnosticCheck): string {
  if (check.id === 'core') return uiAttribute("Core {0} 可用", String(factValue(check, 'version') ?? '')).replace('  ', ' ')
  if (check.id === 'data-directory') return check.status === 'ok' ?uiAttribute("当前 Core 可访问且可写") : check.status === 'attention' ?uiAttribute("数据目录不可写") :uiAttribute("本次无法确认")
  if (check.code === 'runtime_not_in_use') return uiAttribute("当前未使用 · {0}", String(factValue(check, 'availabilityStatus') ?? uiAttribute('未检测')))
  if (check.subjectKind === 'runtime') {
    const version = factValue(check, 'reportedVersion')
    return `${uiAttribute(STATUS_META[check.status].label)}${version ? ` · ${version}` : ''}${check.stale ?uiAttribute(" · 保留最近成功证据") : ''}`
  }
  if (check.id === 'legacy-skill-entries') return check.status === 'ok' ?uiAttribute("旧版 Rovai 派发入口已清理") : uiAttribute("发现 {0} 个旧版派发入口或记录", String(factValue(check, 'entryCount') ?? '—'))
  if (check.id === 'mcp-config') return check.code === 'mcp_config_not_initialized' ?uiAttribute("尚未初始化 · 无外部 MCP") : check.status === 'ok' ? uiAttribute("配置有效 · {0} 个 Server", String(factValue(check, 'serverCount') ?? '0')) : uiAttribute(STATUS_META[check.status].label)
  if (check.id === 'database') return check.status === 'ok' ?uiAttribute("WAL · quick_check 通过") : uiAttribute(STATUS_META[check.status].label)
  if (check.id === 'git') return check.status === 'ok' ? factValue(check, 'version') ?? uiAttribute('可用') :uiAttribute("当前 PATH 中不可用")
  return check.detail
}

function runtimeReason(code: string): string {
  if (code === 'runtime_authentication_required') return uiAttribute("最近一次可用性证据表明需要登录。")
  if (code === 'runtime_missing') return uiAttribute("当前未找到已选择的智能体。")
  if (code === 'runtime_incompatible') return uiAttribute("已安装版本不在支持范围内。")
  if (code === 'runtime_path_missing') return uiAttribute("已配置的可执行入口不再存在。")
  if (code === 'runtime_disabled') return uiAttribute("智能体已停用，但仍被队员选择。")
  return uiAttribute("目前的检查结果表明，这个智能体无法用于新执行。")
}

function groupLabel(group: DiagnosticGroup): string {
  if (group === 'local_dependencies') return uiAttribute("本地依赖")
  if (group === 'managed_content') return uiAttribute("受管内容")
  return uiAttribute("智能体")
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
    entryCount: '旧入口数',
    serverCount: 'Server 数',
    expectedMode: '期望权限',
    usedByMemberCount: '使用队员数',
    availabilityStatus: '智能体状态',
    reportedVersion: '报告版本',
    diagnosticCode: '诊断代码',
    lastSuccessfulProbeAt: '最近成功检查'
  }
  return labels[key] ? uiAttribute(labels[key]) : key
}

function summarySentence(report: DiagnosticsReport): string {
  const { ok, attention, unknown } = report.summary
  return uiAttribute("{0} 项正常，{1} 项需要处理，{2} 项暂时无法确认。", String(ok), String(attention), String(unknown))
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(getInterfaceLanguage() === 'en' ? 'en-US' : 'zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

async function readReport(client: ThreadClient): Promise<DiagnosticsReport> {
  const report = await client.request<DiagnosticsReport>('diagnostics.check')
  if (report.schemaVersion !== 1) throw new Error(uiAttribute('诊断报告版本不兼容。'))
  return report
}

async function waitForRuntimeResult(checkId: string, client: ThreadClient): Promise<DiagnosticsReport> {
  let latest = await readReport(client)
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const check = latest.checks.find((candidate) => candidate.id === checkId)
    if (!check || check.code !== 'runtime_check_incomplete') return latest
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    latest = await readReport(client)
  }
  return latest
}

function assertApplied(result: StoredCommandResult): void {
  if (result.status === 'applied') return
  throw new Error(result.code || uiAttribute('Core 拒绝了这次操作。'))
}

function errorMessage(error: unknown): string {
  return readErrorMessage(error)
}
