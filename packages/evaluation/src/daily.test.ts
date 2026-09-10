import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dailyWindow, digest, renderTrends, runDaily, type DailyScope } from './daily'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const scope: DailyScope = { campIds: [], excludeCampIds: [], excludeAutomationIds: ['analysis'] }
const now = new Date('2026-09-10T02:00:00Z')
describe('daily calendar and evidence contract', () => {
  it('prepared CLI rejects modified analysis input before it reaches an analysis model', async () => {
    const output=await mkdtemp(join(tmpdir(),'rovai-daily-test-'));roots.push(output)
    const result=await runDaily({output,timezone:'UTC',scope,exportTrace:async params=>{
      const facts={runs:[],deliveries:[],tools:[],deliveryEvents:[]}
      return {schemaVersion:1,window:params,scope:params,asOf:new Date().toISOString(),facts,factsDigest:digest(facts),metrics:{definitionVersion:2,runs:{terminalOutcomesInWindow:{}}}}
    }})
    const args=['scripts/eval-daily.mjs','prepared','--output',output,'--timezone','UTC']
    expect(JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'})).inputDigest).toBe(result.report.analysisInputDigest)
    const path=join(result.directory,'analysis-input.json'),pack=JSON.parse(await readFile(path,'utf8'))
    pack.yesterday.runs.createdInWindow=999
    await writeFile(path,JSON.stringify(pack))
    expect(()=>execFileSync(process.execPath,args,{stdio:'pipe'})).toThrow()
  })
  it('bounds metadata samples to their actual metric population and includes pending handoff evidence', async () => {
    const output=await mkdtemp(join(tmpdir(),'rovai-daily-test-'));roots.push(output)
    const facts={runs:[],deliveries:[{deliveryId:'old-open',deliveryKind:'public_a2a',dispatchDisposition:'dispatch',status:'pending',createdAt:'2026-09-08T01:00:00Z',waitCondition:'target_running'}],deliveryEvents:[{eventId:'completion-failure',deliveryKind:'completion',dispatchDisposition:'dispatch',eventType:'message_delivery.failed',occurredAt:'2026-09-09T01:00:00Z'}],tools:[{agentRunId:'r',operationId:'replayed',executionEpoch:1,sourceAuthority:'core',phase:'terminal',outcome:'failed',idempotentReplay:true,lastObservedAt:'2026-09-09T01:00:00Z'}]}
    const result=await runDaily({output,timezone:'Asia/Shanghai',now,scope,exportTrace:async params=>({schemaVersion:1,window:params,scope:params,asOf:now.toISOString(),facts,factsDigest:digest(facts),metrics:{definitionVersion:2,runs:{terminalOutcomesInWindow:{}},a2a:{terminalCoverage:{numerator:0,denominator:0},openWaitReasonsAsOf:{target_running:1}}}})})
    const pack=JSON.parse(await readFile(join(result.directory,'analysis-input.json'),'utf8'))
    expect(pack.samples.map((sample:{evidenceId:string})=>sample.evidenceId)).toEqual(['delivery:old-open'])
    expect(pack.samples[0]).toMatchObject({waitCondition:'target_running',cohort:'created_before_window'})
    expect(pack.coverage.analysisSamples.groups.pendingHandoffs).toMatchObject({eligible:1,selected:1,omitted:0})
  })
  it('uses complete local days including DST and rejects future, invalid dates and zones', () => {
    expect(dailyWindow('Asia/Shanghai', now)).toMatchObject({ date: '2026-09-09', since: '2026-09-08T16:00:00.000Z', until: '2026-09-09T16:00:00.000Z' })
    for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]] as const) {
      const window = dailyWindow('America/New_York', new Date('2027-01-01'), date)
      expect((Date.parse(window.until) - Date.parse(window.since)) / 3_600_000).toBe(hours)
    }
    for (const date of ['2026-09-10', '2026-02-30', '../2026-01-01']) expect(() => dailyWindow('Asia/Shanghai', now, date)).toThrow()
    expect(() => dailyWindow('bad/zone', now)).toThrow()
  })
  it('retains a failed attempt, accepts verified evidence, freezes success and rejects scope reuse', async () => {
    const output = await mkdtemp(join(tmpdir(), 'rovai-daily-test-')); roots.push(output)
    const options = { output, timezone: 'Asia/Shanghai', now, scope }
    const failed = await runDaily({ ...options, exportTrace: async () => { throw new Error('Core unavailable') } })
    expect(failed.report.status).toBe('unavailable')
    expect(failed.report.metrics).toBeNull()
    const successful = await runDaily({ ...options, exportTrace: async params => {
      const facts = { runs: [{ agentRunId: 'r1', status: 'failed', failureCode: 'provider_error', endedAt: '2026-09-09T04:00:00Z', runtimeKind: 'codex-cli', runtimeVersion: 'test-version', observedModelId: null }], deliveries: [], tools: [], deliveryEvents: [] }
      return { schemaVersion: 1, window: { since: params.since, until: params.until }, scope: { ...params, excludeAutomationIds: ['analysis', 'analysis'] }, asOf: now.toISOString(), facts, factsDigest: digest(facts), exporter: { classifierVersion: 'activity-v4' }, coverage: { memoryCounters: 'unavailable' }, metrics: { definitionVersion: 1, runs: { terminalOutcomesInWindow: { failed: 1 } }, memory: { bodyReads: null, formalRevisions: null } } }
    } })
    expect(successful.report.status).toBe('available')
    expect(JSON.parse(await readFile(join(successful.directory, 'analysis-input.json'), 'utf8')).samples[0].evidenceId).toBe('run:r1')
    expect(successful.report.runtimeVersions).toMatchObject({ denominator: 1, unknownRuntime: 0, unknownModel: 1, groups: [{ runtimeKind: 'codex-cli', runtimeVersion: 'test-version', observedModelId: null, count: 1 }] })
    expect(JSON.parse(await readFile(join(failed.directory, 'report.json'), 'utf8')).status).toBe('unavailable')
    const reused = await runDaily({ ...options, exportTrace: async () => { throw new Error('Must not export twice') } })
    expect(reused.reused).toBe(true)
    expect(reused.directory).toBe(successful.directory)
    await runDaily({ ...options, date: '2026-09-08', exportTrace: async () => { throw new Error('Historical data unavailable') } })
    expect(JSON.parse(await readFile(join(output, 'latest.json'), 'utf8')).date).toBe('2026-09-09')
    await expect(runDaily({ ...options, scope: { ...scope, campIds: ['new-camp'] }, exportTrace: async () => null })).rejects.toThrow('scope changed')
  })
  it('rejects exported window fields or scalar filters before collecting a daily report', async () => {
    const output = await mkdtemp(join(tmpdir(), 'rovai-daily-test-')); roots.push(output)
    let exported = false
    for (const invalid of [{ ...scope, since: '2026-09-08T16:00:00Z' }, { ...scope, campIds: 'camp-1' }]) {
      await expect(runDaily({ output, timezone: 'Asia/Shanghai', now, scope: invalid as unknown as DailyScope,
        exportTrace: async () => { exported = true; return null } })).rejects.toThrow('Daily scope requires only')
    }
    expect(exported).toBe(false)
  })
  it('keeps unknown memory values and gaps out of the plotted lines', () => {
    const metrics = { runs: { terminalOutcomesInWindow: { succeeded: 2 } }, memory: { bodyReads: null, formalRevisions: null } }
    const points = ['2026-09-01', '2026-09-03'].map(date => ({ date, metrics, reportId: date, sourceDigest: 'x', status: 'available', comparisonKey: 'same' }))
    const svg = renderTrends(points, 'same')
    expect(svg).toContain('未知 / 没有可比较数据')
    expect(svg).not.toContain('stroke="#2563eb" fill="none"')
    expect(svg).toContain('Run 完成')
    const unknown = renderTrends([{ ...points[0], metrics: { runs: { terminalOutcomesInWindow: { succeeded: null, failed: null, cancelled: null } } } }], 'same')
    expect(unknown).not.toContain('<circle')
  })
})
