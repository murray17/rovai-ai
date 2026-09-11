import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evidenceLink, lineChart, ratioText, renderGateHtml, sanitizeReportLinks } from './report-html'
import { reportMetrics, renderDailyHtml } from './daily-report'
import { digest, runDaily } from './daily'
import { dailyAnalysisSchema, recordDailyAnalysis, validateAnalysis } from './daily-analysis'
const roots:string[]=[]
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})))})
const temp=async():Promise<string>=>{const path=await mkdtemp(join(tmpdir(),'rovai-report-test-'));roots.push(path);return path}

describe('offline report contract — synthetic fixtures only',()=>{
  it('separates the new handoff cohort from the complete retained open backlog',()=>{
    const metrics=reportMetrics({a2a:{terminalCoverage:{numerator:3,denominator:4},openWaitReasonsAsOf:{target_running:5,unknown:1}}})
    expect(metrics.a2a).toMatchObject({cohortOpenCountAsOf:1,openCountAsOf:6})
    expect(reportMetrics({a2a:{terminalCoverage:{numerator:0,denominator:0}}}).a2a).toMatchObject({cohortOpenCountAsOf:0,openCountAsOf:null})
  })
  it('keeps unresolved terminal tool states visible without changing the failure denominator',()=>{
    const html=renderDailyHtml({window:{date:'2026-09-09',timezone:'UTC'},metrics:{tools:{bySource:{runtime:{terminalOutcomesInWindow:{succeeded:10,failed:1,unsettled:22},failureRate:{numerator:1,denominator:11,value:1/11}}}}}},[],{})
    const toolTable=html.slice(html.indexOf('>工具来源</th>')).split('</table>')[0]
    expect(toolTable).toContain('unsettled');expect(toolTable).toContain('22')
  })
  it('makes absent states in a known sparse distribution explicit without filling unavailable sources',()=>{
    const source={runs:{terminalOutcomesInWindow:{succeeded:2}},tools:{bySource:{core:{terminalOutcomesInWindow:{failed:1,unsettled:2}},runtime:{terminalOutcomesInWindow:null}}}}
    expect(reportMetrics(source)).toMatchObject({runs:{terminalOutcomesInWindow:{succeeded:2,failed:0,cancelled:0}},tools:{bySource:{core:{terminalOutcomesInWindow:{succeeded:0,failed:1,denied:0,cancelled:0,not_executed:0,unknown:0,unsettled:2}},runtime:{terminalOutcomesInWindow:null}}}})
    expect(source.tools.bySource.core.terminalOutcomesInWindow).toEqual({failed:1,unsettled:2})
    expect(reportMetrics({}).tools).toBeUndefined()
  })
  it('calculates terminal-window Run rate and preserves null, zero-denominator, and as-of A2A states',()=>{
    expect(reportMetrics({runs:{terminalOutcomesInWindow:{failed:2,succeeded:8,cancelled:3},createdInWindow:100},a2a:{terminalCoverage:{numerator:3,denominator:10}}})).toMatchObject({runs:{failureRate:{value:0.2,numerator:2,denominator:10}},a2a:{cohortOpenCountAsOf:7,openCountAsOf:null}})
    expect(reportMetrics({runs:{terminalOutcomesInWindow:{}}})).toMatchObject({runs:{failureRate:{value:null,numerator:0,denominator:0}}})
    expect(reportMetrics({runs:{terminalOutcomesInWindow:{failed:null,succeeded:8}}})).toMatchObject({runs:{failureRate:{value:null,numerator:null,denominator:null}}})
    expect(reportMetrics({})).toMatchObject({runs:{failureRate:{value:null,numerator:null,denominator:null}}})
  })
  it('renders fractions and low percentages, separates units, and never links gaps or changed standards',()=>{
    expect(ratioText({value:0.032,numerator:8,denominator:250})).toBe('3.2%（8/250）')
    expect(ratioText({value:null,numerator:0,denominator:0})).toContain('N/A')
    expect(ratioText(null)).toContain('不可用')
    const point={date:'2026-09-01',value:0.032,key:'one',detail:'3.2%（8/250）'}
    const chart=lineChart('工具失败率',[point,{...point,date:'2026-09-03'}],'rate')
    expect(chart).toContain('3.84%');expect(chart).not.toContain('<path class="curve"')
    expect(lineChart('rate',[point,{...point,date:'2026-09-02',key:'two'}],'rate')).not.toContain('<path class="curve"')
    expect(lineChart('rate',[point,{...point,date:'2026-09-02'}],'rate')).toContain('<path class="curve"')
  })
  it('preserves real calendar spacing in both daily and weekly charts',()=>{
    for(const [days,dates] of [[1,['2026-09-01','2026-09-02','2026-09-09']],[7,['2026-09-07','2026-09-14','2026-11-02']]] as const){
      const chart=lineChart('Synthetic temporal spacing',dates.map(date=>({date,value:0.02,key:'same',detail:'synthetic'})),'rate',days)
      const x=[...chart.matchAll(/<circle cx="([\d.]+)"/g)].map(match=>Number(match[1]))
      expect((x[2]-x[1])/(x[1]-x[0])).toBeCloseTo(7)
      expect([...chart.matchAll(/<path class="curve"/g)]).toHaveLength(1)
    }
  })
  it('escapes untrusted text and blocks schemes, traversal and executable evidence',()=>{
    for(const path of ['javascript:alert(1)','../secrets.json','/etc/a.json','trials/%2e%2e/secret.json','trials/a/evil.html','trials/a/evil.svg','https://example.com/a.json'])expect(evidenceLink(path)).not.toContain('href=')
    expect(evidenceLink('trials/DEMO-101-1-candidate/result.json')).toContain('href=')
    const html=renderGateHtml({kind:'context_change_gate',status:'<img src=x onerror=alert(1)>',slots:[],products:{candidate:{source:{commit:'</script><script>alert(1)</script>'}}}})
    expect(html).not.toContain('<img src=x');expect(html).not.toContain('</script><script>alert(1)')
    expect(html).toContain("script-src 'sha256-")
  })
  it('separates weekly acceptance, missing evaluation and absence of baseline without hiding trial evidence',()=>{
    const html=renderGateHtml({kind:'weekly_regression',status:'degraded',conclusions:{acceptance:'failed',regression:'not_compared',evaluation:'incomplete',failedTrials:1,evidenceGapTrials:1},regressions:[{caseId:'DEMO-106',repeat:1,code:'candidate_hard_failure'}],evidenceGaps:[{caseId:'DEMO-109',repeat:1,code:'quality_evaluation_incomplete',items:['claim_accuracy']}],slots:[{caseId:'DEMO-106',caseTitle:'Review then repair <script>bad</script>',arm:'candidate',repeat:1,hardOutcome:'fail',state:'complete',judgeStatus:'disagreement',rules:[]}]})
    for(const text of ['本轮验收','未进行基线对照','存在证据缺口','验收失败涉及 1 次 Trial','产物或专项规则验收失败','claim_accuracy','id="case-DEMO-106"'])expect(html).toContain(text)
    expect(html).not.toContain('<script>bad</script>')
    expect(html).toContain('不能判断是否由改动造成退化')
  })
  it('disables absent or symlink evidence while preserving inert contained files',async()=>{
    const root=await temp(),outside=await temp()
    await writeFile(join(root,'report.json'),'{}');await writeFile(join(outside,'secret.json'),'{}')
    await symlink(join(outside,'secret.json'),join(root,'escape.json'))
    const html=await sanitizeReportLinks(root,'<a href="report.json">yes</a><a href="escape.json">no</a><a href="missing.json">missing</a>')
    expect(html).toContain('href="report.json"');expect(html).not.toContain('href="escape.json"');expect(html).not.toContain('href="missing.json"')
  })
  it('checks analysis paths and sample IDs including array paths without accepting prototype properties',()=>{
    const pack={reportId:'r',yesterday:{runs:{failureRate:{value:0.1}}},comparableHistory:[{date:'2026-09-01'}],samples:[{evidenceId:'run:a'}]}
    const input={schemaVersion:1,reportId:'r',inputDigest:digest(pack),model:{provider:'fixture',snapshotId:'synthetic'},facts:[{text:'Synthetic fixture',metricPaths:['yesterday.runs.failureRate.value','comparableHistory.0.date'],evidenceIds:['run:a']}],hypotheses:[],recommendations:[]}
    expect(validateAnalysis(input,pack,digest(pack))).toEqual(input)
    for(const path of ['yesterday.missing','yesterday.constructor','comparableHistory.1.date'])expect(()=>validateAnalysis({...input,facts:[{...input.facts[0],metricPaths:[path]}]},pack,digest(pack))).toThrow()
    expect(()=>validateAnalysis({...input,facts:[{...input.facts[0],evidenceIds:['run:missing']}]},pack,digest(pack))).toThrow()
    const schema=dailyAnalysisSchema(pack,digest(pack)) as {$defs:{statement:{properties:{metricPaths:{items:{enum:string[]}},evidenceIds:{items:{enum:string[]}}}}}}
    const references=schema.$defs.statement.properties
    expect(references.metricPaths.items.enum).toContain('yesterday.runs.failureRate.value')
    for(const path of references.metricPaths.items.enum)expect(()=>validateAnalysis({...input,facts:[{...input.facts[0],metricPaths:[path]}]},pack,digest(pack))).not.toThrow()
    expect(references.metricPaths.items.enum).not.toContain('runs.failureRate.value')
    expect(references.evidenceIds.items.enum).toEqual(['run:a'])
    expect(dailyAnalysisSchema({reportId:'empty',yesterday:{},samples:[]},'digest')).toMatchObject({$defs:{statement:{properties:{metricPaths:{maxItems:0},evidenceIds:{maxItems:0}}}}})
  })
  it('retains failed and successful analysis attempts without changing statistics',async()=>{
    const root=await temp()
    const result=await runDaily({output:root,timezone:'UTC',date:'2026-09-09',now:new Date('2026-09-10T01:00:00Z'),scope:{campIds:[],excludeCampIds:[],excludeAutomationIds:[]},exportTrace:async params=>({schemaVersion:1,window:params,scope:params,asOf:'2026-09-10T00:00:00Z',facts:{runs:[],tools:[],deliveryEvents:[]},factsDigest:digest({runs:[],tools:[],deliveryEvents:[]}),metrics:{definitionVersion:2,runs:{terminalOutcomesInWindow:{}}}})})
    const stats=await readFile(join(result.directory,'report.json'),'utf8'),pack=JSON.parse(await readFile(join(result.directory,'analysis-input.json'),'utf8'))
    const input={schemaVersion:1,reportId:result.report.reportId,inputDigest:digest(pack),model:{provider:'fixture',snapshotId:'synthetic-no-model-invocation'},facts:[{text:'Synthetic fixture, not real analysis.',metricPaths:['yesterday.runs.failureRate.denominator'],evidenceIds:[]}],hypotheses:[],recommendations:[]}
    const failed=await recordDailyAnalysis(result.directory,{...input,inputDigest:'wrong'})
    expect(failed.status).toBe('failed')
    const complete=await recordDailyAnalysis(result.directory,input);expect(complete.status).toBe('complete')
    expect(complete.citedMetrics).toEqual({'yesterday.runs.failureRate.denominator':0})
    expect(await readFile(join(result.directory,'report.json'),'utf8')).toBe(stats)
    expect(await readFile(join(result.directory,String(failed.outputFile)),'utf8')).toContain('wrong')
    expect(await readFile(join(result.directory,'report.html'),'utf8')).toContain('Synthetic fixture, not real analysis.')
  })
  it('daily report exposes 7/30/90 controls, coverage and all tool outcomes without inventing a memory zero',()=>{
    const html=renderDailyHtml({window:{date:'2026-09-09',timezone:'UTC'},metrics:reportMetrics({runs:{terminalOutcomesInWindow:{}},memory:{bodyReads:null,formalRevisions:null}})},[],{})
    for(const days of [7,30,90])expect(html).toContain(`data-days="${days}"`)
    for(const word of ['拒绝','取消','未执行','未知','终态覆盖','记忆正文读取'])expect(html).toContain(word)
    expect(html).toContain('暂无可计算数据 / 不可用')
  })
})

it('shows evaluator timeout separately and escapes its diagnostic data',()=>{
  const html=renderGateHtml({kind:'weekly_regression',status:'insufficient',conclusions:{acceptance:'incomplete',regression:'not_compared',evaluation:'execution_failed',failedTrials:0,evidenceGapTrials:0,evaluatorFailureTrials:1},evaluationFailures:[{caseId:'DEMO-105',repeat:1,arm:'candidate',code:'judge_execution_failed',failures:[{view:'outcome',replica:'B',code:'<script>timeout</script>',attempts:2,locator:'../secret.json'}]}],slots:[]})
  for(const text of ['评测执行失败','评测器故障涉及 1 次 Trial','验收失败涉及 0 次 Trial','证据缺口涉及 0 次 Trial','尝试 2 次'])expect(html).toContain(text)
  expect(html).not.toContain('<script>timeout</script>');expect(html).not.toContain('href="trials/DEMO-105-1-candidate/../secret.json"')
})
