import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dailyWindow, digest, renderTrends, runDaily, type DailyScope } from './daily'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const scope: DailyScope = { campIds: [], excludeCampIds: [], excludeAutomationIds: ['analysis'] }
const now = new Date('2026-09-10T02:00:00Z')
describe('daily calendar and evidence contract', () => {
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
