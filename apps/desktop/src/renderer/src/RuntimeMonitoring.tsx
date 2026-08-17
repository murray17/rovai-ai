import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  AdapterKind,
  AgentProfile,
  MonitoringFilter,
  MonitoringMetric,
  MonitoringMoneyValue,
  MonitoringRange,
  MonitoringReliabilityView,
  MonitoringSnapshot,
  MonitoringSummaryView,
  MonitoringTrendBucket,
  MonitoringUsageView
} from '@contracts'
import { SettingsPageHeader } from './SettingsPageHeader'

type MonitoringTab = 'summary' | 'usage' | 'reliability'
type MonitoringData = MonitoringSummaryView | MonitoringUsageView | MonitoringReliabilityView
type MetricKind = 'integer' | 'percent' | 'duration' | 'ratio'

export const MONITORING_POLL_INTERVAL_MS = 12_000
export const MONITORING_EVENT_DEBOUNCE_MS = 300

export function shouldRefreshMonitoringEvent(method: string): boolean {
  return method === 'monitoring.changed' || method === 'agent_run.terminal'
}

export function nextMonitoringTabIndex(currentIndex: number, key: string): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return TABS.length - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % TABS.length
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + TABS.length) % TABS.length
  return null
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
  { value: 'antigravity-app', label: 'Antigravity' }
]

const TABS: Array<{ value: MonitoringTab; label: string }> = [
  { value: 'summary', label: '概览' },
  { value: 'usage', label: '用量与成本' },
  { value: 'reliability', label: '性能与可靠性' }
]

export function RuntimeMonitoring({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const [tab, setTab] = useState<MonitoringTab>('summary')
  const [focusedTab, setFocusedTab] = useState<MonitoringTab>('summary')
  const [filter, setFilter] = useState<MonitoringFilter>({ range: '24h' })
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const snapshotRef = useRef<MonitoringSnapshot | null>(null)
  const requestSequenceRef = useRef(0)
  const inFlightRef = useRef(false)
  const pendingForegroundRef = useRef<boolean | null>(null)
  const filterRef = useRef(filter)
  const loadSnapshotRef = useRef<(foreground: boolean) => void>(() => undefined)
  filterRef.current = filter

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const loadSnapshot = useCallback(async (foreground: boolean) => {
    if (inFlightRef.current) {
      pendingForegroundRef.current = (pendingForegroundRef.current ?? false) || foreground
      if (foreground) {
        setLoading(true)
        setError(null)
      }
      return
    }
    inFlightRef.current = true
    const requestSequence = ++requestSequenceRef.current
    const requestedFilter = filter
    if (foreground) {
      setLoading(true)
      setError(null)
      setRefreshError(null)
    }
    try {
      const result = await window.rovai.request<MonitoringSnapshot>('monitoring.snapshot', filter)
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current
        || !sameMonitoringFilter(requestedFilter, filterRef.current)) return
      snapshotRef.current = result
      setSnapshot(result)
      setError(null)
      setRefreshError(null)
    } catch (reason) {
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current
        || !sameMonitoringFilter(requestedFilter, filterRef.current)) return
      const message = errorMessage(reason)
      if (snapshotRef.current !== null && sameMonitoringFilter(snapshotRef.current.filter, filter)) {
        setRefreshError(message)
      } else if (foreground || snapshotRef.current === null) {
        setError(message)
      }
    } finally {
      inFlightRef.current = false
      const pendingForeground = pendingForegroundRef.current
      pendingForegroundRef.current = null
      if (mountedRef.current && pendingForeground !== null && !document.hidden) {
        queueMicrotask(() => loadSnapshotRef.current(pendingForeground))
      } else if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [filter])
  loadSnapshotRef.current = (foreground) => { void loadSnapshot(foreground) }

  useEffect(() => {
    void loadSnapshot(true)
  }, [loadSnapshot, refreshKey])

  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let eventTimer: ReturnType<typeof setTimeout> | null = null
    const stopPoll = (): void => {
      if (pollTimer !== null) clearInterval(pollTimer)
      pollTimer = null
    }
    const startPoll = (): void => {
      stopPoll()
      if (document.hidden) return
      pollTimer = setInterval(() => void loadSnapshot(false), MONITORING_POLL_INTERVAL_MS)
    }
    const scheduleEventRefresh = (): void => {
      if (document.hidden) return
      if (eventTimer !== null) clearTimeout(eventTimer)
      eventTimer = setTimeout(() => {
        eventTimer = null
        void loadSnapshot(false)
      }, MONITORING_EVENT_DEBOUNCE_MS)
    }
    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        stopPoll()
        if (eventTimer !== null) clearTimeout(eventTimer)
        eventTimer = null
        return
      }
      startPoll()
      scheduleEventRefresh()
    }
    const unsubscribe = window.rovai.onEvent((event) => {
      if (shouldRefreshMonitoringEvent(event.method)) {
        scheduleEventRefresh()
      }
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)
    startPoll()
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopPoll()
      if (eventTimer !== null) clearTimeout(eventTimer)
    }
  }, [loadSnapshot])

  const retry = useCallback(() => setRefreshKey((value) => value + 1), [])
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

  const data: MonitoringData | null = snapshot?.[tab] ?? null
  const isEmpty = !loading && !error && snapshot !== null
    && snapshot.summary.runs.eligibleCount === 0

  return (
    <div className="runtime-monitoring">
      <SettingsPageHeader
        eyebrow="Settings / Runtime Monitoring"
        title="运行监控"
        description="查看 AgentRun 的状态、用量、成本与可靠性。"
        aside={(
          <>
            <button className="quiet-button" type="button" onClick={retry} disabled={loading}>
              {loading ? '正在刷新…' : '刷新'}
            </button>
            <button className="primary-button" type="button" onClick={() => void exportData()} disabled={loading || exporting}>
              {exporting ? '正在导出…' : '导出 JSON'}
            </button>
          </>
        )}
      />

      <div className="runtime-monitoring-body">
        <div className="monitoring-toolbar">
          <div
            className="monitoring-tabs"
            role="tablist"
            aria-label="运行监控视图"
          >
            {TABS.map((item, index) => (
              <button
                key={item.value}
                id={`monitoring-${item.value}-tab`}
                type="button"
                role="tab"
                aria-selected={tab === item.value}
                aria-controls={`monitoring-${item.value}-panel`}
                tabIndex={focusedTab === item.value ? 0 : -1}
                className={tab === item.value ? 'is-active' : ''}
                onFocus={() => setFocusedTab(item.value)}
                onClick={() => {
                  setFocusedTab(item.value)
                  setTab(item.value)
                }}
                onKeyDown={(event) => {
                  const nextIndex = nextMonitoringTabIndex(index, event.key)
                  if (nextIndex === null) return
                  event.preventDefault()
                  setFocusedTab(TABS[nextIndex].value)
                  requestAnimationFrame(() => {
                    document.getElementById(`monitoring-${TABS[nextIndex].value}-tab`)?.focus()
                  })
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <MonitoringFilters
            filter={filter}
            agents={agents}
            disabled={loading}
            onChange={updateFilter}
          />
        </div>

        {exportPath && (
          <div className="monitoring-export-notice" role="status" aria-live="polite">
            <span>导出已保存。</span>
            <button className="quiet-button compact" type="button" onClick={() => void window.rovai.revealMonitoringExport(exportPath)}>
              在 Finder 中显示
            </button>
          </div>
        )}
        {exportError && (
          <div className="monitoring-operation-error" role="alert">
            <span>导出失败：{exportError}</span>
            <button className="quiet-button compact" type="button" onClick={() => setExportError(null)}>关闭</button>
          </div>
        )}
        {refreshError && snapshot && (
          <div className="monitoring-stale-notice" role="status" aria-live="polite">
            <span>刷新失败，正在显示 {formatTimestamp(snapshot.collection.observedAt)} 的快照。</span>
            <button className="quiet-button compact" type="button" onClick={retry}>重试</button>
          </div>
        )}
        <div
          id={`monitoring-${tab}-panel`}
          role="tabpanel"
          aria-labelledby={`monitoring-${tab}-tab`}
          aria-busy={loading}
        >
          {loading && <MonitoringLoading />}
          {!loading && error && (
            <section className="monitoring-state is-error" role="alert">
              <div><h2>无法读取运行监控</h2><p>{error}</p></div>
              <button className="quiet-button" type="button" onClick={retry}>重试</button>
            </section>
          )}
          {isEmpty && <MonitoringEmpty />}
          {!loading && !error && data && !isEmpty && (
            <div className="monitoring-view">
              {tab === 'summary' && <SummaryPanel data={data as MonitoringSummaryView} />}
              {tab === 'usage' && <UsagePanel data={data as MonitoringUsageView} />}
              {tab === 'reliability' && <ReliabilityPanel data={data as MonitoringReliabilityView} />}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MonitoringFilters({
  filter,
  agents,
  disabled,
  onChange
}: {
  filter: MonitoringFilter
  agents: AgentProfile[]
  disabled: boolean
  onChange<K extends keyof MonitoringFilter>(key: K, value: MonitoringFilter[K]): void
}): React.JSX.Element {
  return (
    <div className="monitoring-filters" aria-label="运行监控筛选">
      <label>
        <span>范围</span>
        <select value={filter.range} disabled={disabled} onChange={(event) => onChange('range', event.target.value as MonitoringRange)}>
          <option value="24h">过去 24 小时</option>
          <option value="7d">过去 7 天</option>
          <option value="30d">过去 30 天</option>
        </select>
      </label>
      <label>
        <span>Runtime</span>
        <select value={filter.adapterKind ?? ''} disabled={disabled} onChange={(event) => onChange('adapterKind', event.target.value ? event.target.value as AdapterKind : undefined)}>
          <option value="">全部</option>
          {ADAPTERS.map((adapter) => <option key={adapter.value} value={adapter.value}>{adapter.label}</option>)}
        </select>
      </label>
      <label>
        <span>队员</span>
        <select value={filter.agentId ?? ''} disabled={disabled} onChange={(event) => onChange('agentId', event.target.value || undefined)}>
          <option value="">全部</option>
          {agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.displayName}</option>)}
        </select>
      </label>
      <label>
        <span>终态</span>
        <select
          value={filter.terminalStatus ?? ''}
          disabled={disabled}
          onChange={(event) => onChange('terminalStatus', event.target.value ? event.target.value as MonitoringFilter['terminalStatus'] : undefined)}
        >
          <option value="">全部</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
      </label>
    </div>
  )
}

function SummaryPanel({ data }: { data: MonitoringSummaryView }): React.JSX.Element {
  const metrics: ReadonlyArray<readonly [string, MonitoringMetric<number>, MetricKind]> = [
    ['运行数', data.runs, 'integer'],
    ['活跃运行', data.activeRuns, 'integer'],
    ['成功率', data.successRate, 'percent'],
    ['端到端 P95', data.endToEndP95Millis, 'duration'],
    ['Session 延续率', data.nativeSessionContinuationRate, 'percent'],
    ['Cache Read 占比', data.cacheReadTokenShare, 'percent']
  ]
  return (
    <>
      <MetricKeyline metrics={metrics} />
      <section className="monitoring-section" aria-labelledby="monitoring-terminal-heading">
        <SectionHeading id="monitoring-terminal-heading" title="终态分布" description="恢复执行仍按一个逻辑 AgentRun 计数；同一 Run 的 execution epoch 不重复进入分母。" />
        <dl className="monitoring-terminal-distribution">
          <div className="is-succeeded"><dt>成功</dt><dd>{formatInteger(data.terminalDistribution.succeeded)}</dd></div>
          <div className="is-failed"><dt>失败</dt><dd>{formatInteger(data.terminalDistribution.failed)}</dd></div>
          <div className="is-cancelled"><dt>取消</dt><dd>{formatInteger(data.terminalDistribution.cancelled)}</dd></div>
          <div className="is-active"><dt>活跃</dt><dd>{formatInteger(data.terminalDistribution.active)}</dd></div>
        </dl>
      </section>
      {data.attention.total > 0 && (
        <div className="monitoring-attention">
          <strong>{data.attention.total} 项需要关注</strong>
          <span>无可见活动 {data.attention.activeWithoutVisibleActivity} · 投递未知 {data.attention.deliveryUnknown} · 待审批 {data.attention.pendingApprovals}</span>
        </div>
      )}
      <section className="monitoring-section" aria-labelledby="monitoring-trend-heading">
        <SectionHeading id="monitoring-trend-heading" title="运行趋势" description="只读取小时级 Rollup；当前状态变化不会触发原始 Evidence 或 Transcript 扫描。" />
        <TrendChart buckets={data.trend} />
      </section>
      <section className="monitoring-section" aria-labelledby="monitoring-runtime-heading">
        <SectionHeading id="monitoring-runtime-heading" title="Runtime 分布" description="Core 事实保持精确；Token、Cache 与成本按各 Runtime 实际覆盖显示。" />
        <div className="monitoring-table-wrap">
          <table>
            <thead><tr><th>Runtime</th><th>Runs</th><th>活跃</th><th>成功率</th><th>端到端 P95</th></tr></thead>
            <tbody>{data.byRuntime.map((row) => (
              <tr key={row.adapterKind}>
                <th scope="row">{adapterLabel(row.adapterKind)}</th>
                <td>{formatInteger(row.runs)}</td>
                <td>{formatInteger(row.activeRuns)}</td>
                <td><MetricValue metric={row.successRate} kind="percent" compact /></td>
                <td><MetricValue metric={row.endToEndP95Millis} kind="duration" compact /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
      <section className="monitoring-section" aria-labelledby="monitoring-cost-heading">
        <SectionHeading id="monitoring-cost-heading" title="最佳可用成本" description="不同币种与粒度不做隐式换汇或归并。" />
        <CostValues metric={data.bestAvailableCost} />
      </section>
    </>
  )
}

function TrendChart({ buckets }: { buckets: MonitoringTrendBucket[] }): React.JSX.Element {
  const maximumRuns = Math.max(0, ...buckets.map((bucket) => bucket.runs))
  if (buckets.length === 0 || maximumRuns === 0) {
    return <InlineUnavailable>当前范围还没有可展示的运行趋势。</InlineUnavailable>
  }
  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  return (
    <div className="monitoring-trend" role="group" aria-label="运行数量与终态趋势">
      <div className="monitoring-trend-bars">
        {buckets.map((bucket) => {
          const terminal = bucket.succeeded + bucket.failed + bucket.cancelled
          const active = Math.max(0, bucket.runs - terminal)
          const height = Math.max(8, Math.round(bucket.runs / maximumRuns * 100))
          const label = `${formatTimestamp(bucket.startAt)}：${bucket.runs} 次运行，成功 ${bucket.succeeded}，失败 ${bucket.failed}，取消 ${bucket.cancelled}，活跃 ${active}`
          return (
            <div key={bucket.startAt} className="monitoring-trend-column" role="img" aria-label={label} title={label}>
              <span className="monitoring-trend-bar" style={{ height: `${height}%` }}>
                {bucket.succeeded > 0 && <i className="is-succeeded" style={{ flexGrow: bucket.succeeded }} />}
                {bucket.failed > 0 && <i className="is-failed" style={{ flexGrow: bucket.failed }} />}
                {bucket.cancelled > 0 && <i className="is-cancelled" style={{ flexGrow: bucket.cancelled }} />}
                {active > 0 && <i className="is-active" style={{ flexGrow: active }} />}
              </span>
            </div>
          )
        })}
      </div>
      <div className="monitoring-trend-axis">
        <time dateTime={first.startAt}>{formatTimestamp(first.startAt)}</time>
        <time dateTime={last.endAt}>{formatTimestamp(last.endAt)}</time>
      </div>
      <div className="monitoring-trend-legend" aria-hidden="true">
        <span className="is-succeeded">成功</span>
        <span className="is-failed">失败</span>
        <span className="is-cancelled">取消</span>
        <span className="is-active">活跃</span>
      </div>
    </div>
  )
}

function UsagePanel({ data }: { data: MonitoringUsageView }): React.JSX.Element {
  const tokenRows: Array<[string, MonitoringMetric<number>]> = [
    ['Input Token', data.inputTokens],
    ['Output Token', data.outputTokens],
    ['Reasoning Output', data.reasoningOutputTokens],
    ['Cache Read Input', data.cacheReadInputTokens],
    ['Cache Write Input', data.cacheWriteInputTokens]
  ]
  return (
    <>
      <section className="monitoring-section" aria-labelledby="monitoring-token-heading">
        <SectionHeading id="monitoring-token-heading" title="Token 账本" description="只合并已证明互斥的 Input / Cache 桶；缺失字段不补零。" />
        <div className="monitoring-ledger">
          {tokenRows.map(([label, metric]) => (
            <div key={label}><span>{label}</span><MetricValue metric={metric} kind="integer" /><CoverageLabel metric={metric} /></div>
          ))}
        </div>
      </section>
      <MetricKeyline metrics={[
        ['Cache Read 占比', data.cacheReadTokenShare, 'percent'],
        ['请求 Cache 命中率', data.requestCacheHitRate, 'percent'],
        ['Read / Write 摊销', data.cacheReadWriteAmortization, 'ratio'],
        ['Context 使用率', data.contextUsageRate, 'percent']
      ]} />
      <section className="monitoring-section" aria-labelledby="monitoring-cache-savings-heading">
        <SectionHeading id="monitoring-cache-savings-heading" title="Cache 节省估算" description="只有版本化价格目录与可判定 Cache 桶同时存在时才计算；缺条件时保持未知。" />
        <CostValues metric={data.cacheSavingsEstimate} emptyMessage="当前没有足够的价格目录与 Cache Usage 来估算节省金额。" />
      </section>
      <section className="monitoring-section" aria-labelledby="monitoring-model-heading">
        <SectionHeading id="monitoring-model-heading" title="Runtime 与模型" description="没有稳定模型 Usage 的 Runtime 仅显示其真实覆盖范围。" />
        {data.byRuntimeAndModel.length === 0
          ? <InlineUnavailable>当前范围没有可汇总的模型 Usage。</InlineUnavailable>
          : (
            <div className="monitoring-table-wrap">
              <table>
                <thead><tr><th>Runtime / 模型</th><th>Input</th><th>Output</th><th>Cache Read</th><th>Cache Write</th><th>覆盖</th></tr></thead>
                <tbody>{data.byRuntimeAndModel.map((row) => (
                  <tr key={row.adapterKind + ':' + row.modelId}>
                    <th scope="row"><strong>{adapterLabel(row.adapterKind)}</strong><small>{row.modelId}</small></th>
                    <td>{formatInteger(row.inputTokens)}</td>
                    <td>{formatInteger(row.outputTokens)}</td>
                    <td>{formatInteger(row.cacheReadInputTokens)}</td>
                    <td>{formatInteger(row.cacheWriteInputTokens)}</td>
                    <td>{formatCoverage(row.coverage)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </section>
      <section className="monitoring-section" aria-labelledby="monitoring-cost-layers-heading">
        <SectionHeading id="monitoring-cost-layers-heading" title="成本层" description="Runtime 报告、价格估算与账单分摊保持分层，不伪装成单 Run 真实费用。" />
        {data.costLayers.length === 0
          ? <InlineUnavailable>当前 Runtime 没有上报可归因成本。</InlineUnavailable>
          : <div className="monitoring-cost-layers">{data.costLayers.map((layer) => (
            <div key={layer.quality + ':' + layer.grain + ':' + layer.values.map((value) => value.currency).join(',')}>
              <span>{costLayerLabel(layer.quality)} · {costGrainLabel(layer.grain)}</span>
              <strong>{layer.values.map(formatMoney).join(' · ')}</strong>
              <small>{layer.observedCount}/{layer.eligibleCount} Runs · {formatCoverage(layer.coverage)} 覆盖</small>
            </div>
          ))}</div>}
      </section>
    </>
  )
}

function ReliabilityPanel({ data }: { data: MonitoringReliabilityView }): React.JSX.Element {
  const latencyRows: Array<[string, MonitoringMetric<number>]> = [
    ['排队', data.queueP95Millis],
    ['Input 接受', data.inputAcceptanceP95Millis],
    ['首个可见活动', data.firstVisibleActivityP95Millis],
    ['执行', data.executionP95Millis],
    ['端到端', data.endToEndP95Millis]
  ]
  return (
    <>
      <section className="monitoring-section" aria-labelledby="monitoring-latency-heading">
        <SectionHeading id="monitoring-latency-heading" title="延迟 P95" description="首个可见活动来自持久化投影，不标成首 Token；页面不扫描 Evidence。" />
        <div className="monitoring-latency-list">
          {latencyRows.map(([label, metric]) => (
            <div key={label}><span>{label}</span><MetricValue metric={metric} kind="duration" /><CoverageLabel metric={metric} /></div>
          ))}
        </div>
      </section>
      <section className="monitoring-reliability-grid" aria-label="可靠性事实">
        <ReliabilityFact
          title="Native Session"
          value={<MetricValue metric={data.session.continuationRate} kind="percent" />}
          detail={'成功延续 ' + data.session.succeeded + ' · 新 Session ' + data.session.newSessions + ' · fallback ' + data.session.fallbackToNewSession + ' · 失败/不兼容/不明确 ' + (data.session.failed + data.session.incompatible + data.session.ambiguous)}
          coverageMetric={data.session.continuationRate}
        />
        <ReliabilityFact
          title="审批等待"
          value={<MetricValue metric={data.approval.waitP95Millis} kind="duration" />}
          detail={'请求 ' + data.approval.requested + ' · 已处理 ' + data.approval.resolved + ' · 待处理 ' + data.approval.pending}
          coverageMetric={data.approval.waitP95Millis}
        />
        <ReliabilityFact
          title="Tool 耗时覆盖"
          value={<strong>{formatCoverage(data.toolDuration.coverage)}</strong>}
          detail={'严格配对 ' + data.toolDuration.pairedCalls + '/' + data.toolDuration.eligibleCalls + ' · 累计 ' + formatOptionalDuration(data.toolDuration.pairedElapsedMillis) + ' · 墙钟并集 ' + formatOptionalDuration(data.toolDuration.wallClockUnionMillis)}
        />
        <ReliabilityFact
          title="可见活动覆盖"
          value={<MetricValue metric={data.activity.runCoverage} kind="percent" />}
          detail={formatInteger(data.activity.evidenceCount) + ' 条 Execution Evidence'}
          coverageMetric={data.activity.runCoverage}
        />
        <ReliabilityFact
          title="Context 使用率"
          value={<MetricValue metric={data.context.usageRate} kind="percent" />}
          detail={'Input 已接受 ' + data.context.deliveryAcceptedRuns + ' Runs · 覆盖 ' + formatCoverage(data.context.deliveryCoverage)}
          coverageMetric={data.context.usageRate}
        />
        <ReliabilityFact
          title="Compaction 可观测性"
          value={<MetricValue metric={data.compaction.coverage} kind="percent" />}
          detail={formatInteger(data.compaction.observationCount) + ' 条观测'}
          coverageMetric={data.compaction.coverage}
        />
      </section>
      <section className="monitoring-section" aria-labelledby="monitoring-runtime-health-heading">
        <SectionHeading id="monitoring-runtime-health-heading" title="纳管运行健康" description="只汇总当前筛选范围内的新 Run；错误码来自 Core 终态，不读取或复制 Runtime 日志正文。" />
        {data.runtimeHealth.length === 0
          ? <InlineUnavailable>当前范围没有纳管的 Runtime 运行。</InlineUnavailable>
          : (
            <div className="monitoring-table-wrap">
              <table>
                <thead><tr><th>Runtime</th><th>Runs</th><th>活跃</th><th>失败</th><th>最近错误</th></tr></thead>
                <tbody>{data.runtimeHealth.map((row) => (
                  <tr key={row.adapterKind}>
                    <th scope="row">{adapterLabel(row.adapterKind)}</th>
                    <td>{formatInteger(row.runCount)}</td>
                    <td>{formatInteger(row.activeRunCount)}</td>
                    <td>{formatInteger(row.failedRunCount)}</td>
                    <td>{row.latestErrorCode ?? '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
      </section>
    </>
  )
}

function MetricKeyline({ metrics }: { metrics: ReadonlyArray<readonly [string, MonitoringMetric<number>, MetricKind]> }): React.JSX.Element {
  return (
    <dl className="monitoring-keyline">
      {metrics.map(([label, metric, kind]) => (
        <div key={label}><dt>{label}</dt><dd><MetricValue metric={metric} kind={kind} /></dd><CoverageLabel metric={metric} /></div>
      ))}
    </dl>
  )
}

function MetricValue({ metric, kind, compact = false }: { metric: MonitoringMetric<number>; kind: MetricKind; compact?: boolean }): React.JSX.Element {
  return (
    <span className={'monitoring-metric-value is-' + metric.availability + (compact ? ' is-compact' : '')} title={metric.diagnosticCode ?? undefined}>
      {formatMetricValue(metric.value, kind)}
    </span>
  )
}

function CoverageLabel({ metric }: { metric: MonitoringMetric<unknown> }): React.JSX.Element {
  return <small className={'monitoring-coverage is-' + metric.availability}>{availabilityLabel(metric)}</small>
}

function CostValues({ metric, emptyMessage = '当前范围没有 Runtime 报告或可核对的成本。' }: {
  metric: MonitoringMetric<MonitoringMoneyValue[]>
  emptyMessage?: string
}): React.JSX.Element {
  if (!metric.value || metric.value.length === 0) {
    return <div className="monitoring-cost-metric"><InlineUnavailable>{emptyMessage}</InlineUnavailable><CoverageLabel metric={metric} /></div>
  }
  return (
    <div className="monitoring-cost-metric">
      <div className="monitoring-cost-values">
        {metric.value.map((value) => (
          <div key={value.currency + ':' + value.grain + ':' + value.quality}>
            <strong>{formatMoney(value)}</strong>
            <span>{costQualityLabel(value.quality)} · {costGrainLabel(value.grain)}</span>
          </div>
        ))}
      </div>
      <CoverageLabel metric={metric} />
    </div>
  )
}

function ReliabilityFact({ title, value, detail, coverageMetric }: {
  title: string
  value: ReactNode
  detail: string
  coverageMetric?: MonitoringMetric<unknown>
}): React.JSX.Element {
  return <article><span>{title}</span>{value}<p>{detail}</p>{coverageMetric && <CoverageLabel metric={coverageMetric} />}</article>
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }): React.JSX.Element {
  return <div className="monitoring-section-heading"><h2 id={id}>{title}</h2><p>{description}</p></div>
}

function InlineUnavailable({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="monitoring-inline-unavailable">{children}</p>
}

function MonitoringLoading(): React.JSX.Element {
  return (
    <div className="monitoring-loading" role="status" aria-live="polite">
      <span className="diagnostics-spinner" aria-hidden="true" />
      <div><strong>正在读取运行数据</strong><p>正在汇总当前范围内的数据。</p></div>
    </div>
  )
}

function MonitoringEmpty(): React.JSX.Element {
  return (
    <section className="monitoring-state is-empty">
      <span aria-hidden="true" />
      <div>
        <h2>暂无运行数据</h2>
        <p>当前范围内暂无 AgentRun。</p>
      </div>
    </section>
  )
}

export function availabilityLabel(metric: MonitoringMetric<unknown>): string {
  if (metric.eligibleCount === 0) return '无符合条件的 Run'
  if (metric.observedCount === 0) return '尚未上报'
  const coverage = metric.coverage === null ? '未知' : Math.round(metric.coverage * 100) + '%'
  return metric.observedCount + '/' + metric.eligibleCount + ' Runs · ' + coverage + ' 覆盖'
}

export function formatMetricValue(value: number | null, kind: MetricKind): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (kind === 'percent') return (value * 100).toFixed(value >= 0.1 ? 1 : 2) + '%'
  if (kind === 'duration') return formatDuration(value)
  if (kind === 'ratio') return value.toFixed(2) + '×'
  return formatInteger(value)
}

function formatDuration(value: number): string {
  if (value < 1000) return Math.round(value) + ' ms'
  if (value < 60_000) return (value / 1000).toFixed(value < 10_000 ? 2 : 1) + ' s'
  return (value / 60_000).toFixed(1) + ' min'
}

function formatOptionalDuration(value: number | null): string {
  return value === null ? '—' : formatDuration(value)
}

function formatInteger(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

function formatCoverage(value: number | null): string {
  return value === null ? '—' : Math.round(value * 100) + '%'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatMoney(value: { amount: string; currency: string }): string {
  return value.currency + ' ' + value.amount
}

function adapterLabel(kind: AdapterKind): string {
  return ADAPTERS.find((adapter) => adapter.value === kind)?.label ?? kind
}

function costLayerLabel(layer: string): string {
  return ({
    runtime_reported: 'Runtime 报告',
    runtime_estimate: 'Runtime 估算',
    price_estimated: '公开价估算',
    provider_reconciled: 'Provider 对账',
    allocated: '账单分摊',
    tokenizer_price_estimated: 'Tokenizer + 公开价估算'
  } as Record<string, string>)[layer] ?? layer
}

function costQualityLabel(quality: string): string {
  return ({
    runtime_reported: 'Runtime 报告值',
    runtime_estimate: 'Runtime 估算',
    price_estimated: '公开价估算',
    provider_reconciled: 'Provider 已对账',
    allocated: '账单分摊',
    tokenizer_price_estimated: 'Tokenizer + 公开价估算'
  } as Record<string, string>)[quality] ?? quality
}

function costGrainLabel(grain: string): string {
  return ({
    run: 'Run 级',
    turn: 'Turn 级',
    session: 'Session 级',
    model_call: '模型调用级',
    billing_bucket: '账单桶',
    unknown: '粒度未知'
  } as Record<string, string>)[grain] ?? grain
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sameMonitoringFilter(left: MonitoringFilter, right: MonitoringFilter): boolean {
  return left.range === right.range
    && left.adapterKind === right.adapterKind
    && left.agentId === right.agentId
    && left.terminalStatus === right.terminalStatus
}
