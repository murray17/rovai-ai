import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lineChart, renderReportIndex, ratioText, sanitizeReportLinks } from '../../packages/evaluation/src/report-html.ts'
import { digestJson } from './qualification-common.mjs'
import { runPlan } from './context-evaluation.mjs'

export function weekDate(now = new Date()) {
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7)
  return day.toISOString().slice(0, 10)
}

// Weekly scheduling belongs to Rovai Automation. This wrapper only assigns a
// bounded campaign per UTC week and projects retained attempts into a trend.
export async function runWeekly(planPath, outputRoot, now = new Date()) {
  const plan = JSON.parse(await readFile(resolve(planPath), 'utf8'))
  if (plan.mode !== 'weekly') throw new Error('Weekly execution requires a frozen weekly plan')
  const root = resolve(outputRoot)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const lock = await open(join(root, '.weekly.lock'), 'wx', 0o600)
  try {
    return await runPlan(planPath, join(root, weekDate(now)))
  } finally {
    try { await updateWeeklyTrend(root) }
    finally { await lock.close(); await unlink(join(root, '.weekly.lock')) }
  }
}

export function weeklyPoint(week, attempt, report) {
  const slots = report.slots.filter(slot => slot.arm === 'candidate')
  const completed = slots.filter(slot => slot.state === 'complete')
  const hardPass = completed.filter(slot => slot.hardOutcome === 'pass' && slot.rules.every(rule => rule.status === 'passed')).length
  const hardFail = slots.filter(slot => slot.hardOutcome === 'fail' || slot.rules?.some(rule => rule.status === 'failed')).length
  const environments = [...new Set(completed.map(slot => slot.environmentKey))].sort()
  const stable = completed.length === slots.length && environments.length === 1 && typeof environments[0] === 'string'
  const comparisonKey = stable ? digestJson({ suite: report.suite.digest, configuration: report.configuration, environment: environments[0] }) : null
  return { week, attempt, locator: `${week}/${attempt}/report.json`, status: report.status,
    planDigest: report.planDigest, completedAt: report.completedAt, version: { commit: report.products.candidate.source.commit, sourceDigest: report.products.candidate.source.contentDigest, binaryDigest: report.products.candidate.coreDigest },
    distinctCases: new Set(slots.map(slot => slot.caseId)).size, assessment: report.assessment?.arms?.candidate ?? null, scoring: report.assessment?.scoring ?? null, sampleSize: slots.length, completed: completed.length, hardPass, hardFail, unknown: slots.length - hardPass - hardFail,
    hardPassRate: { numerator: hardPass, denominator: slots.length, value: slots.length ? hardPass / slots.length : null },
    evidenceGaps: report.evidenceGaps.length, comparisonKey }
}

export async function updateWeeklyTrend(root) {
  const points = []
  for (const week of (await readdir(root)).filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()) {
    for (const attempt of (await readdir(join(root, week))).filter(name => /^attempt-\d+$/.test(name)).sort()) {
      try { points.push(weeklyPoint(week, attempt, JSON.parse(await readFile(join(root, week, attempt, 'report.json'), 'utf8')))) }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        points.push({ week, attempt, locator: `${week}/${attempt}`, status: 'insufficient', reason: 'Attempt started but no completed report was retained', sampleSize: null, hardPassRate: { numerator: null, denominator: null, value: null }, comparisonKey: null })
      }
    }
  }
  // First attempt is the continuous series, so reruns cannot select away failures.
  // Every later attempt remains listed separately in JSON and the report table.
  const selected = [...new Map(points.slice().reverse().map(point => [point.week, point])).values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-52)
  const data = { schemaVersion: 2, selection: 'first_attempt_per_week', points, selected, limits: ['Hard pass is not semantic acceptance or user task success.', 'Missing, partial or changed environments are not connected.', 'Each attempt keeps its denominator; reruns never replace the first attempt.'] }
  for (const [name, content] of [['index.html', await sanitizeReportLinks(root, renderWeeklyHtml(points, selected))], ['trend-data.json', `${JSON.stringify(data, null, 2)}\n`], ['trends.svg', renderWeeklyTrend(selected)], ['README.md', `# 每周真实任务回归趋势\n\n曲线使用每周第一次尝试，重跑单列保留；未运行、缺证据与环境变化不连线。每周以 UTC 周一标识，实际触发时区由 Automation 配置。硬性通过不代表 Judge 通过或用户任务成功。\n\n![每周曲线](trends.svg)\n\n[完整趋势与版本](trend-data.json)\n\n| 周 | 尝试 | 结论 | 硬性通过/计划样本 | 证据缺口 |\n|---|---|---|---|---|\n${points.map(p => `| ${p.week} | [${p.attempt}](${p.locator}) | ${p.status} | ${p.hardPassRate.numerator ?? '?'}/${p.sampleSize ?? '?'} | ${p.evidenceGaps ?? '?'} |`).join('\n')}\n`]]) {
    const temporary = join(root, `.weekly-${randomUUID()}.tmp`)
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(root, name))
  }
  return data
}

export function renderWeeklyTrend(points) {
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 270" role="img" aria-label="每周第一次回归尝试的硬性通过比例"><rect width="960" height="270" fill="white"/><g font-family="system-ui,sans-serif" fill="#273244"><text x="35" y="30">每周硬性通过 / 计划样本（包含未运行样本；不等于语义通过）</text><path d="M65 55 V210 H925" fill="none" stroke="#cbd5e1"/><text x="10" y="65">100%</text><text x="35" y="215">0</text>']
  let previous = null
  const firstDate = points.length ? Date.parse(points[0].week) : 0
  const span = Math.max(86_400_000, ...points.map(point => Date.parse(point.week) - firstDate))
  points.forEach(point => {
    const value = point.hardPassRate.value
    if (value === null) { previous = null; return }
    const x = 65 + 860 * (Date.parse(point.week) - firstDate) / span, y = 210 - value * 150
    if (previous && point.comparisonKey && point.comparisonKey === previous.key && Date.parse(point.week) - Date.parse(previous.week) === 7 * 86_400_000) parts.push(`<path d="M${previous.x} ${previous.y} L${x} ${y}" fill="none" stroke="#2563eb" stroke-width="2"/>`)
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${point.status === 'passed' ? '#2563eb' : '#b45309'}"><title>${point.week}: ${point.hardPassRate.numerator}/${point.sampleSize}, ${point.status}</title></circle>`)
    previous = { x, y, week: point.week, key: point.comparisonKey }
  })
  if (!points.length) parts.push('<text x="370" y="140">未运行 / 证据不足</text>')
  if (points.length) parts.push(`<text x="65" y="245">${points[0].week}</text><text x="815" y="245">${points.at(-1).week}</text>`)
  return `${parts.join('')}</g></svg>\n`
}

export function renderWeeklyHtml(points, selected) {
  const groups = { coordination: '协调必要性', handoff: '信息交接充分性', integration: '贡献整合有效性' }
  const series = [['通用任务质量','quality.total','score'], ...Object.entries(groups).flatMap(([id, label]) => [[`${label} 满足率`, `collaboration.groups.${id}.rates.satisfied`, 'rate'], [`${label} 未知率`, `collaboration.groups.${id}.rates.indeterminate`, 'rate']])]
  const charts = series.map(([title, path, kind]) => lineChart(title, selected.map(point => {
    const raw = path.split('.').reduce((value, key) => value?.[key], point.assessment)
    const value = point.completed > 0 ? kind === 'score' ? raw ?? null : raw?.value ?? null : null
    return { date: point.week, value, key: point.comparisonKey, detail: value === null ? '未运行、无适用样本或评价未完成' : kind === 'score' ? `${value.toFixed(2)} / 100` : ratioText(raw) }
  }), kind, 7)).join('')
  const critical = lineChart('存在关键协作不满足的 Trial', selected.map(point => ({ date: point.week, key: point.comparisonKey, value: point.completed > 0 ? point.assessment?.collaboration?.criticalFailureTrials ?? null : null, detail: point.assessment ? `${point.assessment.collaboration.criticalFailureTrials}/${point.assessment.collaboration.plannedTrials} Trial；${point.distinctCases} 个独立 Case` : '旧口径或缺失' })), 'count', 7)
  return renderReportIndex('每周真实任务回归趋势', points.map(point => ({ path: `${point.week}/${point.attempt}/report.html`, label: `${point.week} / ${point.attempt} · ${point.sampleSize ?? '?'} Trial / ${point.distinctCases ?? '?'} Case`, status: point.status })), `<p>趋势固定使用每周第一次尝试，后续重跑单列。质量、协作状态和资源分别解释，评分口径或环境变化断线。未运行与未知不补零。</p><div class="charts">${charts}${critical}</div>`)
}
