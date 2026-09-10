import { at, escapeHtml, evidenceLink, htmlPage, lineChart, ratioText, reportPrimitives, type ChartPoint } from './report-html.ts'
const { obj, rows, number, json, table, state }=reportPrimitives
export const DAILY_SERIES = [
  ['Run 失败率','runs.failureRate.value','rate'],
  ['A2A 失败率','a2a.failureRate.value','rate'],
  ['A2A 终态覆盖率','a2a.terminalCoverage.value','rate'],
  ['Core 工具失败率','tools.bySource.core.failureRate.value','rate'],
  ['Runtime 工具失败率','tools.bySource.runtime.failureRate.value','rate'],
  ['Run 新建','runs.createdInWindow','count'],
  ['Run 完成','runs.terminalOutcomesInWindow.succeeded','count'],
  ['Run 失败','runs.terminalOutcomesInWindow.failed','count'],
  ['Run 取消','runs.terminalOutcomesInWindow.cancelled','count'],
  ['A2A 未结束交接（含跨日）','a2a.openCountAsOf','count'],
  ['记忆正文读取','memory.bodyReads','nullable'],
  ['记忆正式修订','memory.formalRevisions','nullable']
] as const
export function reportMetrics(input: unknown): Record<string,unknown> {
  const metrics=structuredClone(obj(input)),runs=obj(metrics.runs),terminal=obj(runs.terminalOutcomesInWindow)
  const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0
  const failed=terminal.failed===undefined?0:terminal.failed,succeeded=terminal.succeeded===undefined?0:terminal.succeeded
  const known=runs.terminalOutcomesInWindow!==null&&typeof runs.terminalOutcomesInWindow==='object'&&valid(failed)&&valid(succeeded)
  runs.failureRate=known?{numerator:failed,denominator:failed+succeeded,value:failed+succeeded?failed/(failed+succeeded):null}:{numerator:null,denominator:null,value:null}
  metrics.runs=runs
  const a2a=obj(metrics.a2a),coverage=obj(a2a.terminalCoverage)
  a2a.cohortOpenCountAsOf=valid(coverage.numerator)&&valid(coverage.denominator)&&coverage.denominator>=coverage.numerator?coverage.denominator-coverage.numerator:null
  const waits=a2a.openWaitReasonsAsOf
  a2a.openCountAsOf=waits!==null&&typeof waits==='object'&&!Array.isArray(waits)&&Object.values(waits).every(valid)?Object.values(waits).reduce<number>((sum,value)=>sum+Number(value),0):null
  metrics.a2a=a2a
  metrics.reportDefinitionVersion=3
  return metrics
}
function metricValue(metrics:unknown,path:string,kind:string):number|null {
  const value=at(metrics,path)
  if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value
  if(value===undefined&&kind==='count'&&path.includes('terminalOutcomesInWindow.')&&typeof at(metrics,path.split('.').slice(0,-1).join('.'))==='object'&&at(metrics,path.split('.').slice(0,-1).join('.'))!==null)return 0
  return null
}
export function renderDailyHtml(input:unknown,history:unknown,factInput:unknown,analysis:unknown=null):string {
  const report=obj(input),pack=obj(factInput),metrics=report.metrics,window=obj(report.window),points=rows(history),record=obj(analysis)
  const summary=DAILY_SERIES.slice(0,5).map(([title,path])=>`<div>${escapeHtml(title)}<strong>${ratioText(at(metrics,path.replace(/\.value$/,'')))}</strong></div>`).join('')
  const chartWindows=[7,30,90].map(days=>{
    const end=Date.parse(String(window.date)),start=end-(days-1)*86400000
    const selected=points.filter(point=>Date.parse(String(point.date))>=start&&Date.parse(String(point.date))<=end)
    const charts=DAILY_SERIES.map(([title,path,kind])=>{
      const data:ChartPoint[]=selected.map(point=>{
        const comparable=point.comparisonKey===report.comparisonKey
        const value=comparable?metricValue(point.metrics,path,kind):null
        return {date:String(point.date),key:comparable?String(point.comparisonKey):null,value,detail:!comparable?'口径或范围不同，无法比较':kind==='rate'?ratioText(at(point.metrics,path.replace(/\.value$/,''))):value===null?'不可用':number(value)}
      })
      return lineChart(title,data,kind==='rate'?'rate':'count')
    })
    return `<div data-window="${days}" ${days===7?'':'hidden'}><h2>运行健康 · 最近 ${days} 天</h2><div class="charts">${charts.slice(0,5).join('')}</div><h2>使用量与状态</h2><div class="charts">${charts.slice(5).join('')}</div></div>`
  }).join('')
  const changes=rows(pack.changes).map(change=>{
    const value=typeof change.deltaPercentagePoints==='number'?`${number(change.deltaPercentagePoints)} 个百分点`:number(change.delta)
    return[escapeHtml(change.metric),escapeHtml(change.baselineDate),change.beforeRatio?ratioText(change.beforeRatio):number(change.before),change.afterRatio?ratioText(change.afterRatio):number(change.after),value]
  })
  const tools=table(['工具来源','成功','失败','拒绝','取消','未执行','未知','其他终态','仍在进行','错误分类'],['core','runtime'].map(source=>{
    const t=obj(at(metrics,`tools.bySource.${source}`)),terminal=t.terminalOutcomesInWindow
    return[source,...['succeeded','failed','denied','cancelled','not_executed','unknown'].map(key=>number(terminal&&typeof terminal==='object'?obj(terminal)[key]===undefined?0:obj(terminal)[key]:null)),escapeHtml(JSON.stringify(terminal&&typeof terminal==='object'?Object.fromEntries(Object.entries(obj(terminal)).filter(([key])=>!['succeeded','failed','denied','cancelled','not_executed','unknown'].includes(key))):null)),number(t.inFlightAsOf),escapeHtml(JSON.stringify(t.failureCodes??null))]
  }))
  const analysisStatus=record.status??(report.status==='available'?'pending':'unavailable')
  const content=obj(record.content)
  const analysisBody=Object.keys(content).length?['facts','hypotheses','recommendations'].map(key=>`<h3>${{facts:'事实',hypotheses:'可能原因',recommendations:'建议'}[key]}</h3>${rows(content[key]).map(item=>`<p>${escapeHtml(item.text)}</p><small>指标路径：${escapeHtml((item.metricPaths as unknown[]??[]).join(', '))}；证据：${escapeHtml((item.evidenceIds as unknown[]??[]).join(', '))}</small>`).join('')}`).join(''):`<p class="muted">${analysisStatus==='failed'?'分析失败，统计结果保留。':'统计程序未生成 LLM 解释；可通过既有分析任务提交结构化分析。'}</p>`
  return htmlPage(`每日运行分析 ${window.date}`,`<header><h1>每日运行分析 · ${escapeHtml(window.date)}</h1><p>时区 ${escapeHtml(window.timezone)}；${escapeHtml(window.since)} 至 ${escapeHtml(window.until)}（右端不含）。</p><p>状态采集于 ${escapeHtml(report.asOf??'未知')}。${state(report.status)} / ${state(analysisStatus)}</p><nav><a href="#trends">趋势</a><a href="#exceptions">异常与等待</a><a href="#analysis">分析</a><a href="#coverage">来源与覆盖</a>${evidenceLink('report.json','原始统计')}${evidenceLink('trace.json','执行证据')}</nav></header><div class="summary">${summary}</div><p class="notice">Run 失败率使用当日终态 failed / (failed + succeeded)。A2A 使用当日接纳交接截至采集时的状态；失败率需结合终态覆盖与未结束数量读取。运行状态不代表用户任务成功。</p>${changes.length?table(['指标','上一个可比日期','之前','本日','变化'],changes):'<p class="muted">没有可比较历史；当前数据不足以形成连续趋势。</p>'}<section id="trends"><div class="controls" aria-label="趋势时间范围">${[7,30,90].map(days=>`<button type="button" data-days="${days}" aria-pressed="${days===7}">${days} 天</button>`).join('')}</div><p class="legend">比例与次数分别绘制。悬停查看分子／分母，展开查看全部数值。缺失日期与不可比口径断线，不补零。</p>${chartWindows}</section><section id="exceptions"><h2>错误分类与等待原因</h2><p>采集时未结束交接（含跨日）${number(at(metrics,'a2a.openCountAsOf'))}；当日接纳群组未结束 ${number(at(metrics,'a2a.cohortOpenCountAsOf'))}；当日群组终态覆盖 ${ratioText(at(metrics,'a2a.terminalCoverage'))}。</p>${table(['范围','状态或原因'],[['Run 当日终态',escapeHtml(JSON.stringify(at(metrics,'runs.terminalOutcomesInWindow')??null))],['Run 采集时仍在进行',escapeHtml(JSON.stringify(at(metrics,'runs.inFlightAsOf')??null))],['A2A 等待原因（含跨日积压）',escapeHtml(JSON.stringify(at(metrics,'a2a.openWaitReasonsAsOf')??null))]])}${tools}<p>工具覆盖 ${ratioText(at(metrics,'tools.runCoverage'))}。Core 与 Runtime 各自计算；拒绝、取消、未执行、未知及其他终态（如 unsettled）不进入成功／失败分母，仍单独展示。工具覆盖只表示存在观测记录，不保证全部调用均已采集。缺少终态时间和回放身份的记录见来源详情。</p><details><summary>异常与少量正常样本</summary>${json(pack.samples)}</details></section><section id="analysis"><h2>LLM 分析 · ${state(analysisStatus)}</h2>${analysisBody}<details><summary>分析完成记录</summary>${json(record)}</details></section><section id="coverage"><h2>来源、版本与覆盖</h2><p class="meta">报告 ${escapeHtml(report.reportId)} · 事实摘要 ${escapeHtml(report.sourceDigest)}</p><p>记忆仅保留正文读取与正式修订两个计数；未接通时为不可用。只有元数据的样本不能证明需求遗漏、反馈吸收或任务质量。</p><details><summary>范围、Runtime 版本与数据缺口</summary>${json({scope:report.scope,exporter:report.exporter,runtimeVersions:report.runtimeVersions,coverage:report.coverage,unavailableReason:report.unavailableReason,metrics,limits:report.limits})}</details>${evidenceLink('analysis-input.json','分析输入')} · ${evidenceLink('trend-data.json','趋势数据')}</section>`)
}
