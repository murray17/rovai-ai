import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AdapterKind,
  MonitoringFilter,
  MonitoringRange,
  RuntimeUsageBreakdownRow,
  RuntimeUsageCoverageValue,
  RuntimeUsageMoneyValue,
  RuntimeUsageSnapshot,
  RuntimeUsageTrendPoint
} from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

export const MONITORING_POLL_INTERVAL_MS = 12_000
export const MONITORING_EVENT_DEBOUNCE_MS = 300
export const MONITORING_BACKGROUND_MIN_INTERVAL_MS = 10_000

export function shouldRefreshMonitoringEvent(method: string): boolean {
  return method === 'monitoring.changed' || method === 'agent_run.terminal'
}

export function shouldStartMonitoringBackgroundRefresh(
  now: number,
  lastSuccessfulSnapshotAt: number | null
): boolean {
  return lastSuccessfulSnapshotAt === null
    || now - lastSuccessfulSnapshotAt >= MONITORING_BACKGROUND_MIN_INTERVAL_MS
}

export function monitoringEventRefreshDelay(
  now: number,
  lastSuccessfulSnapshotAt: number | null,
  urgent: boolean
): number {
  if (urgent || lastSuccessfulSnapshotAt === null) return MONITORING_EVENT_DEBOUNCE_MS
  const remaining = MONITORING_BACKGROUND_MIN_INTERVAL_MS - (now - lastSuccessfulSnapshotAt)
  return Math.max(MONITORING_EVENT_DEBOUNCE_MS, remaining)
}

const ADAPTERS: Array<{ value: AdapterKind; label: string }> = [
  { value: 'codex-cli', label: 'Codex' },
  { value: 'claude-code-cli', label: 'Claude Code' },
  { value: 'copilot-cli', label: 'GitHub Copilot' },
  { value: 'opencode-cli', label: 'OpenCode' },
  { value: 'kiro-cli', label: 'Kiro' },
  { value: 'qoder-cli', label: 'Qoder' },
  { value: 'codebuddy-cli', label: 'CodeBuddy' },
  { value: 'qwen-code', label: 'Qwen Code' },
  { value: 'trae-cn-cli', label: 'TRAE' },
  { value: 'cursor-agent', label: 'Cursor Agent' },
  { value: 'kimi-code-cli', label: 'Kimi Code' },
  { value: 'antigravity-app', label: 'Antigravity' }
]

const SUMMARY_METRICS = [
  ['promptInputTotalTokens', 'Input Token', 'integer'],
  ['outputTokens', 'Output Token', 'integer'],
  ['cacheReadTokens', 'Cache Read', 'integer'],
  ['cacheWriteTokens', 'Cache Write', 'integer'],
  ['cacheReadShare', 'Cache Read 占比', 'percent'],
  ['requestCacheHitRate', '请求 Cache 命中率', 'percent'],
  ['reasoningOutputTokens', 'Reasoning Output', 'integer']
] as const

export function RuntimeMonitoring(): React.JSX.Element {
  const [filter, setFilter] = useState<MonitoringFilter>({ range: '24h' })
  const [snapshot, setSnapshot] = useState<RuntimeUsageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestSequenceRef = useRef(0)
  const inFlightRef = useRef(false)
  const pendingRequestRef = useRef<{ foreground: boolean; urgent: boolean } | null>(null)
  const lastSuccessfulSnapshotAtRef = useRef<number | null>(null)
  const filterRef = useRef(filter)
  const loadedFilterRef = useRef<MonitoringFilter | null>(null)
  const snapshotRef = useRef<RuntimeUsageSnapshot | null>(null)
  const loadSnapshotRef = useRef<(foreground: boolean, urgent?: boolean) => void>(() => undefined)
  filterRef.current = filter
  snapshotRef.current = snapshot

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const loadSnapshot = useCallback(async (foreground: boolean, urgent = false) => {
    if (!foreground && !urgent && !shouldStartMonitoringBackgroundRefresh(
      performance.now(),
      lastSuccessfulSnapshotAtRef.current
    )) return
    if (inFlightRef.current) {
      const pending = pendingRequestRef.current
      pendingRequestRef.current = {
        foreground: Boolean(pending?.foreground) || foreground,
        urgent: Boolean(pending?.urgent) || urgent
      }
      if (foreground) {
        setLoading(true)
        setError(null)
        setRefreshError(null)
      }
      return
    }
    inFlightRef.current = true
    const requestedFilter = filter
    const requestSequence = ++requestSequenceRef.current
    if (foreground) {
      setLoading(true)
      setError(null)
      setRefreshError(null)
    }
    try {
      const result = await window.rovai.request<RuntimeUsageSnapshot>(
        'monitoring.snapshot',
        requestedFilter
      )
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current
        || !sameMonitoringFilter(requestedFilter, filterRef.current)) return
      loadedFilterRef.current = requestedFilter
      lastSuccessfulSnapshotAtRef.current = performance.now()
      setSnapshot(result)
      setError(null)
      setRefreshError(null)
    } catch (reason) {
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current
        || !sameMonitoringFilter(requestedFilter, filterRef.current)) return
      const message = errorMessage(reason)
      if (snapshotRef.current !== null && loadedFilterRef.current !== null
        && sameMonitoringFilter(loadedFilterRef.current, requestedFilter)) {
        setRefreshError(message)
      } else {
        setError(message)
      }
    } finally {
      inFlightRef.current = false
      const pending = pendingRequestRef.current
      pendingRequestRef.current = null
      if (mountedRef.current && pending !== null && !document.hidden) {
        queueMicrotask(() => loadSnapshotRef.current(pending.foreground, pending.urgent))
      } else if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [filter])
  loadSnapshotRef.current = (foreground, urgent = false) => {
    void loadSnapshot(foreground, urgent)
  }

  useEffect(() => { void loadSnapshot(true) }, [loadSnapshot, refreshKey])

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let eventTimer: ReturnType<typeof setTimeout> | null = null
    let urgent = false
    const stopPoll = (): void => {
      if (pollTimer !== null) clearInterval(pollTimer)
      pollTimer = null
    }
    const startPoll = (): void => {
      stopPoll()
      if (!document.hidden) {
        pollTimer = setInterval(
          () => loadSnapshotRef.current(false),
          MONITORING_POLL_INTERVAL_MS
        )
      }
    }
    const schedule = (nextUrgent: boolean): void => {
      if (document.hidden) return
      urgent = urgent || nextUrgent
      if (eventTimer !== null) clearTimeout(eventTimer)
      eventTimer = setTimeout(() => {
        const refreshUrgently = urgent
        urgent = false
        eventTimer = null
        loadSnapshotRef.current(false, refreshUrgently)
      }, monitoringEventRefreshDelay(
        performance.now(),
        lastSuccessfulSnapshotAtRef.current,
        urgent
      ))
    }
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stopPoll()
        if (eventTimer !== null) clearTimeout(eventTimer)
        eventTimer = null
        urgent = false
      } else {
        startPoll()
        schedule(true)
      }
    }
    const unsubscribe = window.rovai.onEvent((event) => {
      if (shouldRefreshMonitoringEvent(event.method)) {
        schedule(event.method === 'agent_run.terminal')
      }
    })
    document.addEventListener('visibilitychange', onVisibilityChange)
    startPoll()
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopPoll()
      if (eventTimer !== null) clearTimeout(eventTimer)
    }
  }, [])

  const updateFilter = useCallback(<K extends keyof MonitoringFilter>(
    key: K,
    value: MonitoringFilter[K]
  ) => {
    setFilter((current) => {
      const next = { ...current, [key]: value }
      if (value === undefined || value === '') delete next[key]
      return next
    })
  }, [])

  const exportData = useCallback(async () => {
    setExporting(true)
    setExportPath(null)
    setExportError(null)
    try {
      const path = await window.rovai.exportMonitoring(filter)
      if (path) setExportPath(path)
    } catch (reason) {
      setExportError(errorMessage(reason))
    } finally {
      setExporting(false)
    }
  }, [filter])

  const isEmpty = snapshot !== null && !hasRuntimeUsage(snapshot)

  return (
    <div className="runtime-monitoring">
      <SettingsPageHeader
        eyebrow="Settings / Runtime Usage"
        title="运行监控"
        description="汇总 Runtime 实际上报的 Token、Cache 与成本；未上报字段显示为未知。"
        aside={(
          <>
            <button className="quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>
              {loading ? '正在刷新…' : '刷新'}
            </button>
            <button className="primary-button" type="button" onClick={() => void exportData()} disabled={loading || exporting}>
              {exporting ? '正在导出…' : '导出 JSON'}
            </button>
          </>
        )}
      />

      <div className="runtime-monitoring-body">
        <MonitoringFilters
          filter={filter}
          snapshot={snapshot}
          disabled={loading}
          onChange={updateFilter}
        />
        {exportPath && (
          <div className="monitoring-export-notice" role="status">
            <span>导出已保存。</span>
            <button className="quiet-button compact" type="button" onClick={() => void window.rovai.revealMonitoringExport(exportPath)}>在 Finder 中显示</button>
          </div>
        )}
        {exportError && (
          <div className="monitoring-operation-error" role="alert">
            <span>导出失败：{exportError}</span>
            <button className="quiet-button compact" type="button" onClick={() => setExportError(null)}>关闭</button>
          </div>
        )}
        {refreshError && snapshot && (
          <div className="monitoring-stale-notice" role="status">
            <span>刷新失败，正在显示截至 {formatTimestamp(snapshot.range.to)} 的数据。</span>
            <button className="quiet-button compact" type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button>
          </div>
        )}
        <main aria-busy={loading}>
          {loading && <MonitoringLoading />}
          {!loading && error && (
            <section className="monitoring-state is-error" role="alert">
              <div><h2>无法读取运行监控</h2><p>{error}</p></div>
              <button className="quiet-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>重试</button>
            </section>
          )}
          {!loading && !error && isEmpty && <RuntimeUsageEmpty />}
          {!loading && !error && snapshot && !isEmpty && <RuntimeUsageView snapshot={snapshot} />}
        </main>
      </div>
    </div>
  )
}

function MonitoringFilters({
  filter,
  snapshot,
  disabled,
  onChange
}: {
  filter: MonitoringFilter
  snapshot: RuntimeUsageSnapshot | null
  disabled: boolean
  onChange<K extends keyof MonitoringFilter>(key: K, value: MonitoringFilter[K]): void
}): React.JSX.Element {
  const providerOptions = uniqueOptions([
    filter.providerKey,
    ...(snapshot?.byModel.map((row) => row.providerKey) ?? [])
  ])
  const modelOptions = uniqueOptions([
    filter.modelKey,
    ...(snapshot?.byModel.map((row) => row.modelKey) ?? [])
  ])
  return (
    <div className="monitoring-toolbar">
      <p>用量</p>
      <div className="monitoring-filters" aria-label="运行监控筛选">
        <Filter label="范围" value={filter.range} disabled={disabled} onChange={(value) => onChange('range', value as MonitoringRange)}>
          <option value="24h">过去 24 小时</option>
          <option value="7d">过去 7 天</option>
          <option value="30d">过去 30 天</option>
        </Filter>
        <Filter label="Runtime" value={filter.runtimeKind ?? ''} disabled={disabled} onChange={(value) => onChange('runtimeKind', value ? value as AdapterKind : undefined)}>
          <option value="">全部</option>
          {ADAPTERS.map((adapter) => <option key={adapter.value} value={adapter.value}>{adapter.label}</option>)}
        </Filter>
        <Filter label="Provider" value={filter.providerKey ?? ''} disabled={disabled} onChange={(value) => onChange('providerKey', value || undefined)}>
          <option value="">全部</option>
          {providerOptions.map((value) => <option key={value} value={value}>{value}</option>)}
        </Filter>
        <Filter label="模型" value={filter.modelKey ?? ''} disabled={disabled} onChange={(value) => onChange('modelKey', value || undefined)}>
          <option value="">全部</option>
          {modelOptions.map((value) => <option key={value} value={value}>{value}</option>)}
        </Filter>
        <Filter label="成本" value={filter.costKind ?? ''} disabled={disabled} onChange={(value) => onChange('costKind', value || undefined)}>
          <option value="">全部</option>
          <option value="model_call">Model Call</option>
          <option value="turn">Turn</option>
          <option value="run">Run</option>
          <option value="session">Session</option>
        </Filter>
      </div>
    </div>
  )
}

function Filter({ label, value, disabled, onChange, children }: {
  label: string
  value: string
  disabled: boolean
  onChange(value: string): void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label>
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  )
}

export function RuntimeUsageView({ snapshot }: { snapshot: RuntimeUsageSnapshot }): React.JSX.Element {
  return (
    <div className="monitoring-view">
      <dl className="monitoring-keyline">
        {SUMMARY_METRICS.map(([key, label, kind]) => {
          const value = snapshot.summary[key]
          const coverageKey = key === 'cacheReadShare' ? 'cacheReadTokens' : key
          const coverage = snapshot.coverage[coverageKey as keyof typeof snapshot.coverage]
          return <Metric key={key} label={label} value={value} kind={kind} coverage={coverage} />
        })}
        <div>
          <dt>最佳可用成本</dt>
          <dd className="monitoring-metric-value is-compact">
            {snapshot.summary.cost?.run.length
              ? snapshot.summary.cost.run.map(formatMoney).join(' · ')
              : '—'}
          </dd>
          <Coverage coverage={snapshot.coverage.cost} />
        </div>
      </dl>

      <section className="monitoring-section" aria-labelledby="monitoring-trend-heading">
        <SectionHeading id="monitoring-trend-heading" title="用量趋势" description="24 小时按小时汇总，较长范围按天汇总。" />
        <UsageTrend points={snapshot.trend} />
      </section>

      <BreakdownTable id="monitoring-runtime-heading" title="Runtime" description="按 Runtime 汇总 Token、Cache、成本与数据覆盖。" rows={snapshot.byRuntime} mode="runtime" />
      <BreakdownTable id="monitoring-model-heading" title="模型" description="最多展示用量最高的 10 组，其余合并为“其他”。" rows={snapshot.byModel} mode="model" />

      {snapshot.summary.cost?.reconciliation.length ? <Reconciliation snapshot={snapshot} /> : null}
    </div>
  )
}

function Metric({ label, value, kind, coverage }: {
  label: string
  value: number | null
  kind: 'integer' | 'percent'
  coverage: RuntimeUsageCoverageValue
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={`monitoring-metric-value${value === null ? ' is-unavailable' : ''}`}>
        {kind === 'percent' ? formatPercent(value) : formatInteger(value)}
      </dd>
      <Coverage coverage={coverage} />
    </div>
  )
}

function Coverage({ coverage }: { coverage: RuntimeUsageCoverageValue }): React.JSX.Element {
  const rate = coverage.eligibleRuns > 0 ? coverage.observedRuns / coverage.eligibleRuns : null
  return (
    <span className={`monitoring-coverage${rate !== null && rate < 1 ? ' is-partial' : ''}`}>
      覆盖 {coverage.observedRuns}/{coverage.eligibleRuns} Runs
    </span>
  )
}

function UsageTrend({ points }: { points: RuntimeUsageTrendPoint[] }): React.JSX.Element {
  const costPoints = points.filter((point) => point.cost?.length)
  const maximum = Math.max(0, ...points.flatMap((point) => [
    point.promptInputTotalTokens ?? 0,
    point.outputTokens ?? 0,
    point.cacheReadTokens ?? 0,
    point.cacheWriteTokens ?? 0
  ]))
  if (points.length === 0 || maximum === 0) {
    return <p className="monitoring-inline-unavailable">当前范围没有可展示的用量趋势。</p>
  }
  return (
    <div className="monitoring-usage-trend" role="group" aria-label="Token 与 Cache 用量趋势">
      <div className="monitoring-usage-bars">
        {points.map((point) => (
          <div key={point.bucketStartAt} className="monitoring-usage-bucket" title={trendLabel(point)}>
            <i className="is-input" style={{ height: barHeight(point.promptInputTotalTokens, maximum) }} />
            <i className="is-output" style={{ height: barHeight(point.outputTokens, maximum) }} />
            <i className="is-read" style={{ height: barHeight(point.cacheReadTokens, maximum) }} />
            <i className="is-write" style={{ height: barHeight(point.cacheWriteTokens, maximum) }} />
          </div>
        ))}
      </div>
      <div className="monitoring-trend-footer">
        <time dateTime={points[0].bucketStartAt}>{formatTimestamp(points[0].bucketStartAt)}</time>
        <div className="monitoring-usage-legend" aria-hidden="true">
          <span className="is-input">Input</span><span className="is-output">Output</span>
          <span className="is-read">Cache Read</span><span className="is-write">Cache Write</span>
        </div>
        <time dateTime={points.at(-1)?.bucketStartAt}>{formatTimestamp(points.at(-1)?.bucketStartAt ?? '')}</time>
      </div>
      {costPoints.length > 0 && (
        <div className="monitoring-trend-cost" aria-label="成本趋势">
          <span>成本</span>
          {costPoints.map((point) => (
            <span key={point.bucketStartAt}>
              <time dateTime={point.bucketStartAt}>{formatTimestamp(point.bucketStartAt)}</time>
              {' '}{point.cost?.map(formatMoney).join(' · ')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function BreakdownTable({ id, title, description, rows, mode }: {
  id: string
  title: string
  description: string
  rows: RuntimeUsageBreakdownRow[]
  mode: 'runtime' | 'model'
}): React.JSX.Element {
  return (
    <section className="monitoring-section" aria-labelledby={id}>
      <SectionHeading id={id} title={title} description={description} />
      {rows.length === 0 ? (
        <p className="monitoring-inline-unavailable">当前范围没有可汇总的数据。</p>
      ) : (
        <div className="monitoring-table-wrap">
          <table>
            <thead><tr><th>{mode === 'runtime' ? 'Runtime' : 'Runtime / Provider / 模型'}</th><th>Input</th><th>Output</th><th>Cache Read</th><th>Cache Write</th><th>Read 占比</th><th>成本</th><th>覆盖</th></tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${row.runtimeKind}:${row.providerKey}:${row.modelKey}:${index}`}>
                <th scope="row">
                  <strong>{adapterLabel(row.runtimeKind)}</strong>
                  {mode === 'model' && <small>{[row.providerKey, row.modelKey].filter(Boolean).join(' / ') || '未知模型'}</small>}
                </th>
                <td>{formatInteger(row.promptInputTotalTokens)}</td>
                <td>{formatInteger(row.outputTokens)}</td>
                <td>{formatInteger(row.cacheReadTokens)}</td>
                <td>{formatInteger(row.cacheWriteTokens)}</td>
                <td>{formatPercent(row.cacheReadShare)}</td>
                <td>{row.cost.length ? row.cost.map(formatMoney).join(' · ') : '—'}</td>
                <td>{row.coverage.observedRuns}/{row.coverage.eligibleRuns}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Reconciliation({ snapshot }: { snapshot: RuntimeUsageSnapshot }): React.JSX.Element {
  const cost = snapshot.summary.cost
  if (!cost) return <></>
  return (
    <section className="monitoring-section" aria-labelledby="monitoring-reconciliation-heading">
      <SectionHeading id="monitoring-reconciliation-heading" title="Provider 成本对账" description="Provider 聚合账单与 Run 可归因成本分开保存，不拆分成伪造的单 Run 费用。" />
      <dl className="monitoring-reconciliation">
        <div><dt>Run 最佳可用成本</dt><dd>{cost.run.map(formatMoney).join(' · ') || '—'}</dd></div>
        <div><dt>Provider 对账成本</dt><dd>{cost.reconciliation.map(formatMoney).join(' · ')}</dd></div>
        <div><dt>差额（Provider − Run）</dt><dd>{cost.difference.map((value) => `${value.currency} ${value.amount}`).join(' · ') || '—'}</dd></div>
        <div><dt>对账截止</dt><dd>{cost.latestReconciledAt ? formatTimestamp(cost.latestReconciledAt) : '—'}</dd></div>
      </dl>
    </section>
  )
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }): React.JSX.Element {
  return <div className="monitoring-section-heading"><h2 id={id}>{title}</h2><p>{description}</p></div>
}

function MonitoringLoading(): React.JSX.Element {
  return <div className="monitoring-loading"><span className="spinner" aria-hidden="true" /><div><strong>正在读取用量</strong><p>汇总已保存的 Run Summary 与小时数据。</p></div></div>
}

export function RuntimeUsageEmpty(): React.JSX.Element {
  return <section className="monitoring-state is-empty"><span aria-hidden="true" /><div><h2>暂无运行数据</h2><p>新 AgentRun 纳管后会显示在这里。</p></div></section>
}

export function hasRuntimeUsage(snapshot: RuntimeUsageSnapshot): boolean {
  return snapshot.byRuntime.length > 0
    || snapshot.summary.promptInputTotalTokens !== null
    || snapshot.summary.uncachedInputTokens !== null
    || snapshot.summary.outputTokens !== null
    || snapshot.summary.cacheReadTokens !== null
    || snapshot.summary.cacheWriteTokens !== null
    || snapshot.summary.reasoningOutputTokens !== null
    || snapshot.summary.requestCacheHitRate !== null
    || snapshot.summary.cost !== null
}

function uniqueOptions(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort()
}

function barHeight(value: number | null, maximum: number): string {
  if (!value || maximum === 0) return '2px'
  return `${Math.max(4, Math.round(value / maximum * 100))}%`
}

function trendLabel(point: RuntimeUsageTrendPoint): string {
  return `${formatTimestamp(point.bucketStartAt)}：Input ${formatInteger(point.promptInputTotalTokens)}，Output ${formatInteger(point.outputTokens)}，Cache Read ${formatInteger(point.cacheReadTokens)}，Cache Write ${formatInteger(point.cacheWriteTokens)}`
}

function adapterLabel(value: string): string {
  return ADAPTERS.find((adapter) => adapter.value === value)?.label ?? value
}

function formatInteger(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN').format(value)
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : new Intl.NumberFormat('zh-CN', {
    style: 'percent', maximumFractionDigits: 1
  }).format(value)
}

function formatMoney(value: RuntimeUsageMoneyValue): string {
  return `${value.currency} ${value.amount}`
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date)
}

function sameMonitoringFilter(left: MonitoringFilter, right: MonitoringFilter): boolean {
  return left.range === right.range
    && left.runtimeKind === right.runtimeKind
    && left.providerKey === right.providerKey
    && left.modelKey === right.modelKey
    && left.costKind === right.costKind
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
