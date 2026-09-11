import { createHash } from 'node:crypto'
import { realpath, lstat } from 'node:fs/promises'
import { join, sep } from 'node:path'

type Obj = Record<string, unknown>
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}
const rows = (value: unknown): Obj[] => Array.isArray(value) ? value.map(obj) : []
export const at = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' && Object.hasOwn(current, key) ? (current as Record<string, unknown>)[key] : undefined, value)
export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const number = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'
export function ratioText(value: unknown): string {
  const r = obj(value)
  return typeof r.value === 'number' && typeof r.numerator === 'number' && typeof r.denominator === 'number' && r.denominator > 0
    ? `${number(r.value * 100)}%（${number(r.numerator)}/${number(r.denominator)}）`
    : r.denominator === 0 ? 'N/A（零分母）' : '不可用（采集或评价缺失）'
}
const labels: Record<string, string> = { passed: '通过', degraded: '退化或验收失败', insufficient: '证据不足', satisfied: '满足', partially_satisfied: '部分满足', not_satisfied: '不满足', indeterminate: '证据不足', not_applicable: '不适用', regression: '判定退化', existing_failure: '已有问题', evidence_change: '证据变化', improvement: '改善', unchanged: '无变化', incomparable: '无法比较', complete: '完成', incomplete: '评价未完成', unavailable: '不可用', available: '统计已完成', not_run: '未运行', pending: '等待分析', failed: '分析失败', disagreement: '存在分歧', agreed: '副本一致' }
const label = (value: unknown): string => labels[String(value)] ?? String(value ?? '未知')
const state = (value: unknown): string => `<span class="state ${['degraded','not_satisfied','failed'].includes(String(value)) ? 'bad' : ['insufficient','indeterminate','incomplete','unavailable','pending'].includes(String(value)) ? 'unknown' : ''}">${escapeHtml(label(value))}</span>`
const json = (value: unknown): string => `<pre>${escapeHtml(JSON.stringify(value ?? null, null, 2))}</pre>`
const table = (headers: string[], body: string[][]): string => `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
const detailTable = (headers: string[], body: string[][]): string => table(headers, body).replace('class="table-scroll"', 'class="table-scroll detail-table"')
// Only generated report navigation and inert evidence are linkable. No task HTML,
// scripts, schemes, encoded separators, parent traversal or executable artifacts.
export function evidenceLink(path: unknown, title = '证据'): string {
  if (typeof path !== 'string' || !/^[A-Za-z0-9._/-]+(?:#[A-Za-z0-9._:/~-]*)?$/.test(path)
      || path.startsWith('/') || path.split('/').some(part => part === '..' || part === '.')
      || !/\.(json|txt|log|md)(?:#.*)?$/.test(path)) return `<span>${escapeHtml(title)}（链接不可用）</span>`
  return `<a href="${escapeHtml(path)}">${escapeHtml(title)}</a>`
}
function generatedLink(path: string, title: string): string {
  if (!/^(?:[A-Za-z0-9_-]+\/)*(?:report|index)\.html$/.test(path)) return escapeHtml(title)
  return `<a href="${path}">${escapeHtml(title)}</a>`
}
const css = `:root{color-scheme:light dark;--canvas:#eceeef;--surface:#fbfbfa;--ink:#171b20;--muted:#52606b;--line:#cbd1d6;--steel:#526f88;--good:#39734d;--partial:#92620d;--bad:#ae3434;--unknown:#687986;--focus:#526f88}
@media(prefers-color-scheme:dark){:root{--canvas:#0d1114;--surface:#151a1e;--ink:#e7ecef;--muted:#aeb9c2;--line:#3b464f;--steel:#91afc4;--good:#7ab68b;--partial:#d8b56b;--bad:#ef9393;--unknown:#99aab7;--focus:#91afc4}}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums}main{max-width:1240px;margin:auto;padding:32px 40px 64px;background:var(--surface);min-height:100vh}header{border-bottom:1px solid var(--line);padding-bottom:24px}h1{font-size:28px;line-height:1.25;margin:8px 0 16px;font-weight:650}h2{font-size:20px;margin:32px 0 16px}h3{font-size:16px;margin:20px 0 8px}p{max-width:78ch;margin:8px 0}a{color:var(--steel);text-underline-offset:3px}nav{display:flex;flex-wrap:wrap;gap:16px;margin:16px 0}section{scroll-margin-top:16px}.muted,small{color:var(--muted)}small{font-size:12px}.summary{display:flex;flex-wrap:wrap;gap:16px 32px;margin:24px 0}.summary>div{min-width:160px}.summary strong{display:block;font-size:24px;font-weight:600}.state{font-weight:600;white-space:nowrap}.bad{color:var(--bad)}.unknown{color:var(--unknown)}table{border-collapse:collapse;width:100%;text-align:left;font-size:13px}td,th{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600;color:var(--muted)}td{overflow-wrap:anywhere}td:first-child,th:first-child{padding-left:0}.table-scroll{overflow-x:auto}.detail-table table{min-width:640px}.detail-table th:nth-child(2),.detail-table td:nth-child(2){min-width:6.5em;white-space:nowrap}.detail-table td:first-child{min-width:240px;max-width:38ch}.detail-table td:last-child{min-width:220px;max-width:50ch}details{padding:12px 0;border-bottom:1px solid var(--line)}summary{cursor:pointer;font-weight:600}summary:hover{color:var(--steel)}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;background:var(--canvas);padding:16px;max-height:420px;overflow:auto}button,select,input{font:inherit;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:6px 10px}button{cursor:pointer}button:hover{background:var(--canvas)}button[aria-pressed=true]{border-color:var(--steel);font-weight:600}input{max-width:100%}:focus-visible{outline:2px solid var(--focus);outline-offset:3px}::selection{background:var(--steel);color:var(--surface)}.controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:16px 0}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.chart{margin:0;padding:16px 0;border-top:1px solid var(--line)}.chart svg{width:100%;height:auto;display:block}.chart figcaption{font-weight:600}.chart text{fill:var(--muted);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.chart .axis{stroke:var(--line)}.chart .curve{stroke:var(--steel);fill:none;stroke-width:2}.chart circle{fill:var(--steel)}.bar{display:flex;height:16px;min-width:150px;background:var(--canvas)}.bar>span{min-width:0}.satisfied{background:var(--good)}.partially_satisfied{background:var(--partial)}.not_satisfied{background:var(--bad)}.indeterminate{background:var(--unknown)}.score-bar{height:6px;background:var(--canvas);margin-top:8px}.score-bar>span{display:block;background:var(--steel);height:100%}.meta{overflow-wrap:anywhere}.notice{padding:16px;background:var(--canvas);margin:16px 0}.legend{font-size:12px;color:var(--muted)}[hidden]{display:none!important}footer{margin-top:40px;border-top:1px solid var(--line);padding-top:16px;color:var(--muted)}@media(max-width:700px){main{padding:24px 16px}.charts{grid-template-columns:1fr}h1{font-size:24px}.summary{gap:16px}.summary>div{min-width:140px}td,th{padding:8px}.controls label{width:100%}}@media print{main{padding:0;max-width:none}.controls{display:none}details{break-inside:avoid}}`
const interactions = `function revealCase(){const id=decodeURIComponent(location.hash.slice(1));const target=document.getElementById(id);if(target?.matches('details[data-case]')){target.hidden=false;target.open=true}}window.addEventListener('hashchange',revealCase);revealCase();document.querySelectorAll('[data-filter]').forEach(input=>input.addEventListener('input',()=>{const q=input.value.trim().toLowerCase();document.querySelectorAll('[data-case]').forEach(row=>{row.hidden=!row.dataset.case.toLowerCase().includes(q)})}));document.querySelectorAll('[data-days]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-window]').forEach(panel=>panel.hidden=panel.dataset.window!==button.dataset.days)}));`
export function htmlPage(title: string, body: string): string {
  const scriptHash = createHash('sha256').update(interactions).digest('base64')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-src 'none'"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)} · Rovai</title><style>${css}</style></head><body><main>${body}<footer>Rovai · 本地离线报告。JSON 与保留证据是数据依据；此页面不上传数据、不执行任务产物。</footer></main><script>${interactions}</script></body></html>\n`
}
function scoreCell(value: unknown): string { return typeof value === 'number' ? `${number(value)}<div class="score-bar"><span style="width:${Math.max(0, Math.min(100, value))}%"></span></div>` : '评价未完成' }
function distribution(value: unknown): string {
  const d = obj(value), counts = obj(d.counts), denominator = Number(d.applicableTrials ?? 0)
  return `${denominator ? `<div class="bar">${['satisfied','partially_satisfied','not_satisfied','indeterminate'].map(s => `<span class="${s}" style="width:${Math.max(0,Math.min(100,Number(counts[s] ?? 0)/denominator*100))}%" title="${escapeHtml(label(s))}: ${number(counts[s])}/${denominator}"></span>`).join('')}</div>` : 'N/A'}<small>${['satisfied','partially_satisfied','not_satisfied','indeterminate'].map(s => `${escapeHtml(label(s))} ${number(counts[s])}`).join(' · ')}<br>满足 ${ratioText(at(d,'rates.satisfied'))}；未知 ${ratioText(at(d,'rates.indeterminate'))}<br>${number(d.applicableTrials)} 次适用 Trial / ${number(d.applicableCases)} 个独立 Case；含细项证据缺口 ${number(d.trialsWithEvidenceGaps)} 次</small>`
}
const groupNames: Record<string,string> = {coordination:'协调必要性',handoff:'信息交接充分性',integration:'贡献整合有效性'}
const dimNames: Record<string,string> = {goal:'目标达成',evidence:'证据一致性',boundary:'边界遵守'}
const conclusionLabels: Record<string,string> = {
  passed:'通过', failed:'未通过', incomplete:'存在证据缺口', complete:'评价完整', execution_failed:'评测执行失败',
  not_compared:'未进行基线对照', detected:'发现新退化', inconclusive:'无法完成比较', not_detected:'未发现新退化'
}
const issueLabels: Record<string,string> = {
  candidate_hard_failure:'产物或专项规则验收失败', semantic_acceptance_failed:'关键语义条件未满足',
  missing_trial_evidence:'执行结果不可用', semantic_evidence_insufficient:'关键评价缺失或有分歧',
  quality_evaluation_incomplete:'质量评价尚有未知项', critical_collaboration_evidence_insufficient:'关键协作项证据不足',
  critical_collaboration_acceptance_failed:'关键协作项未满足', runtime_environment_drift_or_unknown:'执行环境发生变化或不可核实',
  judge_provider_snapshot_not_pinned:'Judge 服务端模型版本不可固定', elapsed_time_regression:'相同条件下耗时超过冻结门槛',
  judge_execution_failed:'Judge 未完成评分（评测器故障）', candidate_contract_failure:'合同测试失败', contract_checks_not_passed:'合同测试未完成通过'
}
function gateConclusions(report: Record<string,unknown>): string {
  const c=obj(report.conclusions)
  if(!Object.keys(c).length)return `<p class="notice">历史结论：${state(report.status)}。旧报告没有分开的验收、比较与评价完整性字段，不能据此认定新退化。</p>`
  return `<section id="conclusions"><h2>本轮结论</h2>${table(['验收结果','新旧比较','评价完整性'],[[escapeHtml(conclusionLabels[String(c.acceptance)]??c.acceptance),escapeHtml(conclusionLabels[String(c.regression)]??c.regression),escapeHtml(conclusionLabels[String(c.evaluation)]??c.evaluation)]])}<p>验收失败涉及 ${number(c.failedTrials)} 次 Trial；证据缺口涉及 ${number(c.evidenceGapTrials)} 次 Trial；评测器故障涉及 ${number(c.evaluatorFailureTrials)} 次 Trial。各类可重叠，记录数不等于 Case 数。${c.regression==='not_compared'?'本轮只有当前版本，不能判断是否由改动造成退化。':''}</p></section>`
}
function issueSummary(report: Record<string,unknown>): string {
  const problems: Record<string,unknown>[]=[...rows(report.regressions).map(row=>({...row,issueType:row.newRegression===true?'已确认新退化':'验收未满足'})),...rows(report.evidenceGaps).map(row=>({...row,issueType:'证据缺口'})),...rows(report.evaluationFailures).map(row=>({...row,issueType:'评测器故障 · 评分未完成'}))]
  if(!problems.length)return '<p>未记录验收失败、证据缺口或评测器故障。</p>'
  return table(['Case / 重复','问题类型','原因与检查项'],problems.map(row=>[
    row.caseId?`<a href="#case-${escapeHtml(row.caseId)}">${escapeHtml(row.caseId)}</a> / ${number(row.repeat)}`:'整套评测',
    escapeHtml(row.issueType),`${escapeHtml(issueLabels[String(row.code)]??row.code)}<br><small>${escapeHtml(row.checklistItem??(Array.isArray(row.items)?row.items.join(', '):''))}</small>${rows(row.failures).map(f=>`<p>${escapeHtml(f.view??'评分进程')} / ${escapeHtml(f.replica??'—')}：${escapeHtml(f.code)}；尝试 ${number(f.attempts)} 次${f.locator&&row.caseId?evidenceLink(`trials/${row.caseId}-${row.repeat}-${row.arm}/${f.locator}`,'失败记录'):''}</p>`).join('')}`
  ]))
}
export function renderGateHtml(input: unknown): string {
  const report=obj(input), assessment=obj(report.assessment), arms=obj(assessment.arms), baseline=obj(arms.baseline), candidate=obj(arms.candidate)
  const weekly=report.kind==='weekly_regression'
  const slots=rows(report.slots), hard=slots.filter(s=>s.arm==='candidate'&&s.state==='complete'&&s.hardOutcome==='pass'&&rows(s.rules).every(r=>r.status==='passed')).length
  const legacy=Object.keys(assessment).length===0
  const versions=Object.entries(obj(report.products)).map(([arm,p])=>[arm==='baseline'?'基线':'候选 / 当前',escapeHtml(at(p,'source.commit')),escapeHtml(at(p,'source.contentDigest'))])
  const quality=table(weekly?['质量维度','权重','当前版本']:['质量维度','权重','基线','候选','分差'],Object.entries(dimNames).map(([id,name])=>{
    const before=at(baseline,`quality.dimensions.${id}.score`),after=at(candidate,`quality.dimensions.${id}.score`)
    return weekly?[name,`${number(at(assessment,`scoring.dimensions.${id}`))}%`,scoreCell(after)]:[name,`${number(at(assessment,`scoring.dimensions.${id}`))}%`,scoreCell(before),scoreCell(after),number(at(assessment,'comparison.status')==='comparable'&&typeof before==='number'&&typeof after==='number'?after-before:null)]
  }))
  const groups=table(weekly?['协作分组','当前版本状态分布']:['协作分组','基线状态分布','候选状态分布','满足率变化'],Object.entries(groupNames).map(([id,name])=>weekly?[name,distribution(at(candidate,`collaboration.groups.${id}`))]:[name,distribution(at(baseline,`collaboration.groups.${id}`)),distribution(at(candidate,`collaboration.groups.${id}`)),`${number(at(assessment,`comparison.groupChanges.${id}.deltaPercentagePoints`))} 个百分点`]))
  const qualitySummary=weekly?`当前版本 ${number(at(candidate,'quality.total'))} / 100；历史比较见每周报告根目录。`:`基线 ${number(at(baseline,'quality.total'))} → 候选 ${number(at(candidate,'quality.total'))}；分差 ${number(at(assessment,'comparison.qualityDelta'))}。`
  const changes=rows(assessment.changes).filter(row=>row.kind!=='unchanged')
  const changesHtml=table(['Case / 重复','检查项','变化','解释'],changes.map(row=>[`${escapeHtml(row.caseId)} / ${number(row.repeat)}`,escapeHtml(row.itemId),`${state(row.before)} → ${state(row.after)}`,state(row.kind)]))
  const caseIds=[...new Set(slots.map(slot=>String(slot.caseId)))]
  const caseOverview=table(['Case / 任务','版本 / 重复','硬性验收','语义评价','质量 / 覆盖','执行耗时'],slots.map(slot=>{
    const trial=rows(at(arms,`${String(slot.arm)}.trials`)).find(t=>t.caseId===slot.caseId&&t.repeat===slot.repeat)
    const accepted=slot.state==='complete'&&slot.hardOutcome==='pass'&&rows(slot.rules).every(r=>r.status==='passed')
    const hardFailed=slot.hardOutcome==='fail'||rows(slot.rules).some(r=>r.status==='failed')
    return [`<a href="#case-${escapeHtml(slot.caseId)}">${escapeHtml(slot.caseId)}</a><br><small>${escapeHtml(slot.caseTitle??'')}</small>`,`${escapeHtml(slot.arm)} / ${number(slot.repeat)}`,accepted?'通过':hardFailed?'未通过':'证据不足',slot.failureDomain==='evaluator'?'评分未完成 · 评测器故障':state(slot.judgeStatus),`${number(at(trial,'quality.total'))} / 100<br>${ratioText(at(trial,'quality.coverage'))}`,`${number(typeof at(slot,'resources.dispatchToTerminal.valueMilliseconds')==='number'?Number(at(slot,'resources.dispatchToTerminal.valueMilliseconds'))/1000:null)} 秒`]
  }))
  const details=caseIds.map(id=>{
    const trialDetails=Object.entries(arms).flatMap(([arm,value])=>rows(obj(value).trials).filter(trial=>trial.caseId===id).map(trial=>{
      const raw=slots.find(s=>s.caseId===id&&s.repeat===trial.repeat&&s.arm===arm)
      const path=typeof trial.locator==='string'?trial.locator:typeof raw?.locator==='string'?raw.locator:null
      const links=path?['result.json','evidence-index.json','semantic-judge-view-suite.json','collaboration-ledger.json','tool-call-ledger.json'].map(name=>evidenceLink(`${path}/${name}`,name)).join(' · '):'此 Trial 未保留可导航证据'
      return `<h3>${arm==='baseline'?'基线':'候选 / 当前'} · repeat ${number(trial.repeat)} · ${state(trial.executionState)}</h3><p>质量 ${number(at(trial,'quality.total'))} / 100；覆盖 ${ratioText(at(trial,'quality.coverage'))}</p>${detailTable(['质量检查 / 依据','判定','来源 / 理由'],rows(at(trial,'quality.items')).map(item=>[`${escapeHtml(item.id)}<br><small>${escapeHtml(item.criterion)}</small>`,state(item.verdict),`${escapeHtml(item.source)}<br>${escapeHtml(at(item,'raw.reason')??item.reasonCode)}<details><summary>逐副本判定与证据引用</summary>${json(item.raw)}</details>`]))}<h3>协作五个细项</h3>${detailTable(['细项','判定','理由与证据'],rows(trial.collaboration).map(item=>[escapeHtml(item.checklistItem),state(item.verdict),`${escapeHtml(at(item,'raw.reason')??item.reasonCode)}<details><summary>原始 Judge 判定与证据引用</summary>${json(item.raw)}</details>`]))}<details><summary>规则、资源与执行限制</summary>${json(raw)}</details><p>${links}</p>`
    }))
    return `<details id="case-${escapeHtml(id)}" data-case="${escapeHtml(id)}"><summary>${escapeHtml(id)} · ${escapeHtml(slots.find(slot=>slot.caseId===id)?.caseTitle??"任务明细")}</summary>${trialDetails.length?trialDetails.join(''):json(slots.filter(s=>s.caseId===id))}</details>`
  }).join('')
  return htmlPage(report.kind==='weekly_regression'?'每周真实任务回归':'上下文改动 Gate',`${report.fixture === true ? '<p class="notice">合成测试夹具 · 仅验证报告呈现与交互，不是真实评测结果。</p>' : ''}<header><h1>${report.kind==='weekly_regression'?'每周真实任务回归':'上下文改动 Gate'}</h1><p>固定任务的实际产物与协作证据，用于检查改动后的质量和退化。</p><nav><a href="#conclusions">结论与问题</a><a href="#quality">任务质量</a><a href="#collaboration">协作诊断</a><a href="#cases">Case 与证据</a><a href="#limits">限制与版本</a>${evidenceLink('report.json','原始报告')}${evidenceLink('plan.json','冻结计划')}</nav></header><div class="summary"><div>${weekly?"本轮验收":"Gate 放行"}<strong>${escapeHtml(report.conclusions?conclusionLabels[String(at(report,"conclusions.acceptance"))]:label(report.status))}</strong></div><div>通用质量<strong>${number(at(candidate,'quality.total'))} / 100</strong></div><div>硬性通过<strong>${hard} / ${slots.filter(s=>s.arm==='candidate').length}</strong></div><div>质量评价覆盖<strong>${ratioText(at(candidate,'quality.coverage'))}</strong></div></div>${gateConclusions(report)}<section id="issues"><h2>验收失败、证据缺口与评测器故障</h2>${issueSummary(report)}</section>${legacy?'<p class="notice">历史报告未使用当前评分标准。保留旧结果，不能直接换算新分数或连接质量趋势。</p>':''}<p>关键协作：不满足 ${number(at(candidate,'collaboration.criticalFailureTrials'))} 次 Trial；部分满足 ${number(at(candidate,'collaboration.criticalPartialTrials'))}；未知 ${number(at(candidate,'collaboration.criticalUnknownTrials'))}。同一类内按 Trial 去重，类别之间可能重叠。</p><section id="quality"><h2>任务质量</h2><p>${qualitySummary}分数不抵消硬失败或关键协作问题。</p>${quality}</section><section id="collaboration"><h2>协作诊断</h2><p>按计划 Case × repetition 统计；未知保留分母。三组分布不合成为协作分数。</p>${groups}<h3>逐 Case 变化</h3>${changes.length?changesHtml:'<p class="muted">没有已记录的判定变化，或缺少可比较评价；以评价覆盖与限制为准。</p>'}</section><section id="cases"><h2>Case 与证据</h2>${caseOverview}<div class="controls"><label>筛选 Case <input data-filter type="search" placeholder="输入 Case ID"></label></div>${details}</section><section id="limits"><h2>版本与限制</h2>${table(['版本','提交','源码摘要'],versions)}<p class="meta">评分 ${escapeHtml(at(assessment,'scoring.version'))} · ${escapeHtml(at(assessment,'scoring.digest'))}<br>方案 revision ${escapeHtml(at(report,'change.revision'))} · ${escapeHtml(report.planDigest)}</p><details><summary>新退化、已有失败与证据缺口</summary>${json({regressions:report.regressions,evidenceGaps:report.evidenceGaps,evaluationFailures:report.evaluationFailures,holdout:report.holdout,limits:report.limits,earlierAttempts:report.earlierAttempts})}</details></section>`)
}
export type ChartPoint = { date: string; value: number | null; key: string | null; detail: string }
export function lineChart(title: string, points: ChartPoint[], kind: 'rate'|'count'|'score', days = 1): string {
  const values=points.map(point=>point.value).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v))
  const max=kind==='score'?100:kind==='rate'?Math.min(1,Math.max(0.01,...values.map(v=>v*1.2))):Math.max(1,...values.map(v=>v*1.1))
  const scale=(n:number):string=>kind==='rate'?`${number(n*100)}%`:number(n)
  const dates=points.map(point=>Date.parse(point.date)).filter(Number.isFinite)
  const firstDate=dates.length?Math.min(...dates):0,span=Math.max(86400000,...dates.map(date=>date-firstDate))
  let previous:{x:number;y:number;date:string;key:string|null}|null=null
  const plotted=points.map(point=>{
    const date=Date.parse(point.date)
    if(point.value===null||!Number.isFinite(point.value)||!Number.isFinite(date)){previous=null;return ''}
    const x=60+(date-firstDate)*440/span,y=165-point.value/max*120
    const line=previous&&point.key&&point.key===previous.key&&Date.parse(point.date)-Date.parse(previous.date)===days*86400000?`<path class="curve" d="M${previous.x} ${previous.y} L${x} ${y}"/>`:''
    previous={x,y,date:point.date,key:point.key}
    return `${line}<circle cx="${x}" cy="${y}" r="4"><title>${escapeHtml(point.date)}：${escapeHtml(point.detail)}</title></circle>`
  }).join('')
  return `<figure class="chart"><figcaption>${escapeHtml(title)}</figcaption><svg viewBox="0 0 540 210" role="img" aria-label="${escapeHtml(title)}"><path class="axis" d="M60 35 V165 H505" fill="none"/>${[0,0.5,1].map(f=>`<text x="4" y="${170-f*120}">${scale(max*f)}</text><path class="axis" d="M60 ${165-f*120} H505" opacity="0.4"/>`).join('')}${plotted}${!values.length?'<text x="120" y="105">暂无可计算数据 / 不可用</text>':''}<text x="60" y="195">${escapeHtml(points[0]?.date??'')}</text><text x="415" y="195">${escapeHtml(points.at(-1)?.date??'')}</text></svg><details><summary>数值、分子／分母和日期</summary>${table(['日期','数值 / 数据状态'],points.map(point=>[escapeHtml(point.date),escapeHtml(point.detail)]))}</details></figure>`
}
export function renderReportIndex(title: string, entries: {path:string;label:string;status:string}[], content=''): string {
  return htmlPage(title,`<header><h1>${escapeHtml(title)}</h1><p>报告保留每次尝试；缺失、口径变化和证据不足单独标记。</p></header>${content}${table(['报告','状态'],entries.map(entry=>[generatedLink(entry.path,entry.label),state(entry.status)]))}`)
}
export const reportPrimitives = { obj, rows, number, label, state, json, table }

export async function sanitizeReportLinks(directory: string, html: string): Promise<string> {
  const root = await realpath(directory)
  const links = [...html.matchAll(/<a href="([^"<>]+)">([\s\S]*?)<\/a>/g)]
  for (const [markup, href, title] of links) {
    if (href.startsWith('#')) continue
    const path = href.split('#')[0]
    let allowed = /^[A-Za-z0-9._/-]+\.(json|txt|log|md|html)$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..')
    if (allowed) {
      try {
        let ancestor = root
        for (const part of path.split('/')) { ancestor = join(ancestor, part); if ((await lstat(ancestor)).isSymbolicLink()) allowed = false }
        const resolved = await realpath(ancestor)
        allowed &&= resolved.startsWith(`${root}${sep}`) && (await lstat(resolved)).isFile()
      } catch { allowed = false }
    }
    if (!allowed) html = html.replace(markup, `<span>${title}（文件不可用或超出报告范围）</span>`)
  }
  return html
}
