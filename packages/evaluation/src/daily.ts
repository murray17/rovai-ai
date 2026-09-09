import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, open, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type ObjectValue = { [key: string]: Json }
export type DailyScope = { campIds: string[]; excludeCampIds: string[]; excludeAutomationIds: string[] }
export type DailyOptions = {
  output: string
  timezone: string
  date?: string
  now?: Date
  scope: DailyScope
  exportTrace: (params: DailyScope & { since: string; until: string }) => Promise<unknown>
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
  return value as ObjectValue
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}
function localDate(time: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time)
  const part = (type: string): string => parts.find(value => value.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}
function midnight(date: string, timezone: string): number {
  const center = Date.parse(`${date}T12:00:00Z`)
  let low = center - 36 * 3_600_000
  let high = center + 36 * 3_600_000
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (localDate(middle, timezone) < date) low = middle
    else high = middle
  }
  if (localDate(high, timezone) !== date) throw new Error('The requested local date does not exist in this timezone')
  return high
}
export function dailyWindow(timezone: string, now = new Date(), requestedDate?: string): { date: string; since: string; until: string; timezone: string } {
  const today = localDate(now.getTime(), timezone)
  const date = requestedDate ?? shiftDate(today, -1)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || shiftDate(date, 0) !== date || date >= today) throw new Error('Daily analysis requires a completed local calendar date')
  return { date, timezone, since: new Date(midnight(date, timezone)).toISOString(), until: new Date(midnight(shiftDate(date, 1), timezone)).toISOString() }
}
function pathValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, value)
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}
function counter(metrics: unknown, path: string): number | null {
  const parent = path.split('.').slice(0, -1).join('.')
  const value = pathValue(metrics, path)
  return pathValue(metrics, parent) && typeof pathValue(metrics, parent) === 'object' ? count(value === undefined ? 0 : value) : null
}
type Point = { date: string; reportId: string; status: string; comparisonKey: string; metrics: ObjectValue | null; sourceDigest: string | null; runtimeVersions?: ObjectValue | null }
const SERIES = [
  ['Run 完成', 'runs.terminalOutcomesInWindow.succeeded', 'count'],
  ['Run 失败', 'runs.terminalOutcomesInWindow.failed', 'count'],
  ['Run 取消', 'runs.terminalOutcomesInWindow.cancelled', 'count'],
  ['A2A 失败比例', 'a2a.failureRate.value', 'rate'],
  ['Core 可观测工具失败比例', 'tools.bySource.core.failureRate.value', 'rate'],
  ['Runtime 可观测工具失败比例', 'tools.bySource.runtime.failureRate.value', 'rate'],
  ['记忆正文读取', 'memory.bodyReads', 'nullable'],
  ['记忆正式修订', 'memory.formalRevisions', 'nullable']
] as const
const escapeXml = (text: string): string => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[value]!)

function runtimeVersions(runs: ObjectValue[]): ObjectValue {
  const groups = new Map<string, ObjectValue>()
  let unknownRuntime = 0, unknownModel = 0
  for (const run of runs) {
    const version = Object.fromEntries(['runtimeKind', 'runtimeVersion', 'observedModelId', 'bindingCompatibilityDigest'].map(key => [key, typeof run[key] === 'string' && run[key] ? run[key] : null]))
    if (!version.runtimeKind || !version.runtimeVersion) unknownRuntime++
    if (!version.observedModelId) unknownModel++
    const key = canonical(version), group = groups.get(key) ?? { ...version, count: 0 }
    group.count = Number(group.count) + 1
    groups.set(key, group)
  }
  return { population: 'selected_runs_in_export_not_only_new_runs', denominator: runs.length, unknownRuntime, unknownModel,
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
    perRunRovaiBuild: 'unavailable' }
}

function versionPreview(value?: ObjectValue | null): ObjectValue | null {
  if (!value) return null
  const groups = Array.isArray(value.groups) ? value.groups as ObjectValue[] : []
  const ordered = groups.slice().sort((a, b) => Number(b.count) - Number(a.count) || canonical(a).localeCompare(canonical(b)))
  return { ...value, groups: ordered.slice(0, 20), totalGroups: groups.length,
    omittedGroups: Math.max(0, groups.length - 20), omittedRuns: ordered.slice(20).reduce((sum, group) => sum + Number(group.count), 0),
    completeDistributionDigest: digest(value) }
}

function metricChanges(current: Point, history: Point[]): unknown[] {
  const previous = history.at(-1)
  if (!previous?.metrics || !current.metrics) return []
  return SERIES.map(([label, path, kind]) => {
    const after = kind === 'count' ? counter(current.metrics, path) : pathValue(current.metrics, path)
    const before = kind === 'count' ? counter(previous.metrics, path) : pathValue(previous.metrics, path)
    const comparable = typeof after === 'number' && typeof before === 'number'
    return { metric: label, path, baselineDate: previous.date, currentDate: current.date, before: before ?? null, after: after ?? null, delta: comparable ? after - before : null,
      interpretation: comparable ? 'observed_change_not_statistical_significance' : 'unknown',
      beforeRatio: kind === 'rate' ? pathValue(previous.metrics, path.replace(/\.value$/, '')) : null,
      afterRatio: kind === 'rate' ? pathValue(current.metrics, path.replace(/\.value$/, '')) : null }
  })
}

export function renderTrends(points: Point[], comparisonKey: string): string {
  const width = 960, height = 175 * SERIES.length + 60
  const chunks = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">每日执行趋势</title><desc id="desc">仅连接同口径、相邻日期且有数据的点。缺失、不可比和未知值留空。频次与运行成功不代表任务质量。</desc><rect width="100%" height="100%" fill="#fff"/><g font-family="system-ui,sans-serif" fill="#273244">`]
  SERIES.forEach(([label, path, kind], index) => {
    const top = 45 + index * 175
    const values = points.map(point => point.comparisonKey === comparisonKey && point.metrics ? kind === 'count' ? counter(point.metrics, path) : pathValue(point.metrics, path) : null)
      .map(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
    const max = kind === 'rate' ? 1 : Math.max(1, ...values.filter((value): value is number => value !== null))
    chunks.push(`<text x="40" y="${top}" font-size="16">${label}${kind === 'rate' ? '（分子/分母保存在 JSON）' : ''}</text><path d="M70 ${top + 15} V${top + 110} H910" fill="none" stroke="#cbd5e1"/><text x="15" y="${top + 25}" font-size="11">${kind === 'rate' ? '100%' : max}</text><text x="45" y="${top + 110}" font-size="11">0</text>`)
    let previous: { x: number; y: number; date: string } | null = null
    values.forEach((value, ordinal) => {
      if (value === null) { previous = null; return }
      const x = 70 + ordinal * 840 / Math.max(1, points.length - 1), y = top + 110 - value / max * 90
      const point = points[ordinal]
      if (previous && shiftDate(previous.date, 1) === point.date) chunks.push(`<path d="M${previous.x} ${previous.y} L${x} ${y}" stroke="#2563eb" fill="none" stroke-width="2"/>`)
      chunks.push(`<circle cx="${x}" cy="${y}" r="3" fill="#2563eb"><title>${point.date}: ${value}</title></circle>`)
      previous = { x, y, date: point.date }
    })
    if (values.every(value => value === null)) chunks.push(`<text x="400" y="${top + 70}" fill="#64748b">未知 / 没有可比较数据</text>`)
    if (points.length) chunks.push(`<text x="70" y="${top + 130}" font-size="11">${points[0].date}</text><text x="830" y="${top + 130}" font-size="11">${points.at(-1)!.date}</text>`)
  })
  return `${chunks.join('')}<text x="40" y="${height - 15}" font-size="12">空缺不补零；Core 与 Runtime 工具数不可相加；当前状态按采集时点解释。</text></g></svg>\n`
}
async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) }
async function privateJson(path: string, value: unknown): Promise<void> { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' }) }
export async function runDaily(options: DailyOptions): Promise<{ directory: string; report: ObjectValue; reused: boolean }> {
  const window = dailyWindow(options.timezone, options.now, options.date)
  const scope = Object.fromEntries(Object.entries(options.scope).map(([key, values]) => [key, [...new Set(values)].sort()])) as DailyScope
  const scopeKey = digest({ timezone: window.timezone, scope })
  const root = resolve(options.output)
  await mkdir(root, { recursive: true, mode: 0o700 })
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Daily output root must not be a symlink')
  const lock = await open(join(root, '.daily.lock'), 'wx', 0o600)
  try {
    let history: Point[] = []
    try { const stored = object(await readJson(join(root, 'history.json'))); if (stored.scopeKey !== scopeKey) throw new Error('Daily output scope changed; use a new output directory'); history = stored.points as unknown as Point[] }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const old = history.find(point => point.date === window.date && point.status === 'available')
    if (old) { const directory = join(root, old.reportId); return { directory, report: object(await readJson(join(directory, 'report.json'))), reused: true } }
    const reportId = `${window.date}-${randomUUID()}`
    const directory = join(root, reportId)
    await mkdir(directory, { mode: 0o700 })
    let trace: ObjectValue | null = null, unavailable: string | null = null
    try {
      trace = object(await options.exportTrace({ since: window.since, until: window.until, ...scope }))
      if (trace.schemaVersion !== 1 || !trace.facts || !trace.metrics || digest(trace.facts) !== trace.factsDigest) throw new Error('Trace schema or evidence digest mismatch')
      const actualWindow = object(trace.window)
      if (Date.parse(String(actualWindow.since)) !== Date.parse(window.since) || Date.parse(String(actualWindow.until)) !== Date.parse(window.until)) throw new Error('Trace window mismatch')
      const actualScope = object(trace.scope)
      for (const [key, ids] of Object.entries(scope)) {
        const actualIds = actualScope[key]
        if (!Array.isArray(actualIds) || actualIds.some(id => typeof id !== 'string') || canonical([...new Set(actualIds)].sort()) !== canonical(ids)) throw new Error('Trace scope mismatch')
      }
      if (!Number.isFinite(Date.parse(String(trace.asOf))) || Date.parse(String(trace.asOf)) < Date.parse(window.until)) throw new Error('Trace snapshot predates completed window')
      await privateJson(join(directory, 'trace.json'), trace)
    } catch (error) { trace = null; unavailable = (error as Error).message.slice(0, 300) }
    const comparisonKey = digest({ scopeKey, exporter: trace?.exporter ?? null, coverage: trace?.coverage ?? null, definitionVersion: pathValue(trace, 'metrics.definitionVersion') ?? null })
    const facts = trace ? object(trace.facts) : {}
    const rows = (key: string): ObjectValue[] => Array.isArray(facts[key]) ? facts[key] as ObjectValue[] : []
    const point: Point = { date: window.date, reportId, status: trace ? 'available' : 'unavailable', comparisonKey, metrics: trace ? object(trace.metrics) : null, sourceDigest: trace ? String(trace.factsDigest) : null, runtimeVersions: trace ? runtimeVersions(rows('runs')) : null }
    const comparable = history.filter(item => item.comparisonKey === comparisonKey && item.date < window.date && item.metrics).sort((a, b) => a.date.localeCompare(b.date)).slice(-7)
    const inWindow = (time: Json): boolean => typeof time === 'string' && Date.parse(time) >= Date.parse(window.since) && Date.parse(time) < Date.parse(window.until)
    const failed = rows('runs').filter(run => run.status === 'failed' && inWindow(run.endedAt)).slice(0, 3)
    const normal = rows('runs').filter(run => run.status === 'succeeded' && inWindow(run.endedAt)).slice(0, 2)
    const samples = [...failed, ...normal].map(run => ({ evidenceId: `run:${run.agentRunId}`, agentRunId: run.agentRunId, status: run.status, failureCode: run.failureCode, runtimeKind: run.runtimeKind, startedAt: run.startedAt, endedAt: run.endedAt }))
    const report: ObjectValue = {
      schemaVersion: 1, kind: 'daily_trace_analysis', reportId, window, scope, scopeKey,
      status: point.status, unavailableReason: unavailable, comparisonKey,
      asOf: trace?.asOf ?? null, sourceDigest: point.sourceDigest, exporter: trace?.exporter ?? null,
      runtimeVersions: point.runtimeVersions ?? null,
      coverage: trace?.coverage ?? null, metrics: point.metrics, semanticAnalysis: { status: 'not_run' },
      limits: ['Run/tool success is not task success.', 'Origin is unknown beyond explicit exclusions.', 'Historical Rovai build per Run is unavailable.', 'Current states are as of export, not reconstructed midnight.', 'Memory counters await memory governance; unknown is not zero.']
    }
    const changes = metricChanges(point, comparable)
    const toolSamples = rows('tools').filter(tool => tool.outcome === 'failed' && inWindow(tool.originalTerminalObservedAt ?? tool.lastObservedAt)).slice(0, 3).map(tool => ({ evidenceId: `tool:${tool.agentRunId}:${tool.executionEpoch}:${tool.operationId}`, agentRunId: tool.agentRunId, sourceAuthority: tool.sourceAuthority, outcome: tool.outcome, errorCode: tool.errorCode }))
    const deliverySamples = rows('deliveryEvents').filter(event => event.eventType === 'message_delivery.failed').slice(0, 3).map(event => ({ evidenceId: `event:${event.eventId}`, deliveryId: event.deliveryId, occurredAt: event.occurredAt, failureCode: event.failureCode }))
    const previousVersions = comparable.at(-1)?.runtimeVersions ?? null
    const factPack = { schemaVersion: 1, reportId, window, yesterday: point.metrics, comparableHistory: comparable.map(item => ({ ...item, runtimeVersions: versionPreview(item.runtimeVersions) })), changes,
      versions: { exporter: trace?.exporter ?? null, runtime: versionPreview(point.runtimeVersions), previousRuntime: versionPreview(previousVersions),
        observedDistributionChanged: previousVersions && point.runtimeVersions ? digest(previousVersions) !== digest(point.runtimeVersions) : null,
        comparisonMeaning: 'Comparable metric definitions do not assert identical Runtime/model populations or a causal effect.' },
      coverage: trace?.coverage ?? null, samples: [...samples, ...toolSamples, ...deliverySamples], unavailableReason: unavailable,
      instructions: '只根据所给指标、分母、可比较历史与 evidenceId 解释变化、异常、可能原因和建议。样本不是总体；不得重新估算比例，不得把成功状态当作用户任务成功。区分事实与假设，缺数据明确说明；引用指标 JSON 路径或 evidenceId。不重跑原任务，不执行修复。' }
    const selected = history.filter(item => item.date !== window.date).concat(point).sort((a, b) => a.date.localeCompare(b.date))
    const trendPoints = selected.slice(-90)
    await privateJson(join(directory, 'report.json'), report)
    await privateJson(join(directory, 'analysis-input.json'), factPack)
    await privateJson(join(directory, 'trend-data.json'), { scopeKey, points: trendPoints })
    await writeFile(join(directory, 'trends.svg'), renderTrends(trendPoints, comparisonKey), { mode: 0o600, flag: 'wx' })
    const terminal = pathValue(point.metrics, 'runs.terminalOutcomesInWindow') ?? null
    await writeFile(join(directory, 'README.md'), `# 每日运行分析：${window.date}\n\n状态：${trace ? '统计已生成；本统计步骤未调用 LLM，后续解释单独保留' : '证据不足'}。时区：${escapeXml(window.timezone)}。\n\n统计窗口：${window.since} 至 ${window.until}（右端不含）。当前状态采集于 ${trace?.asOf ?? '未知'}。\n\nRun 终态分布：${JSON.stringify(terminal)}。A2A 与工具比例的数量、分母见 [统计报告](report.json)。\n\n![每日曲线](trends.svg)\n\n[分析输入](analysis-input.json) · [趋势数据](trend-data.json)${trace ? ' · [原始元数据与证据](trace.json)' : ''}\n\n仅统计保留记录与显式排除后的范围，尚不能保证来源均为真实用户任务。空缺不补零，Core 与 Runtime 工具数不可相加。Run／工具成功不等于用户任务成功；记忆计数尚不可用。历史缺失或版本、范围、口径不同不连续比较。所有尝试按独立目录保留。\n${unavailable ? `\n运行受阻：${escapeXml(unavailable)}\n` : ''}`, { mode: 0o600, flag: 'wx' })
    const temporary = join(root, `.history-${randomUUID()}.json`)
    await privateJson(temporary, { schemaVersion: 1, scopeKey, points: selected })
    await rename(temporary, join(root, 'history.json'))
    const latest = join(root, `.latest-${randomUUID()}.json`)
    const newest = selected.at(-1)!
    await privateJson(latest, { date: newest.date, reportId: newest.reportId, directory: join(root, newest.reportId), status: newest.status })
    await rename(latest, join(root, 'latest.json'))
    return { directory, report, reused: false }
  } finally {
    await lock.close()
    const { unlink } = await import('node:fs/promises')
    await unlink(join(root, '.daily.lock'))
  }
}
