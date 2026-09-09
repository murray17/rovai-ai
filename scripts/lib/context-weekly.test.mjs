import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateWeeklyTrend, weekDate, renderWeeklyTrend } from './context-weekly.mjs'

test('weekly trends preserve first failures, every attempt and missing evidence instead of selecting a passing rerun', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rovai-weekly-test-'))
  try {
    const report = { slots: [{ arm: 'candidate', state: 'complete', hardOutcome: 'fail', rules: [], environmentKey: 'same' }], status: 'degraded', configuration: {}, suite: { digest: 'suite' }, products: { candidate: { source: { commit: 'version', contentDigest: 'source' }, coreDigest: 'binary' } }, evidenceGaps: [] }
    const retain = async (week, attempt, value) => { const dir = join(root, week, attempt); await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'report.json'), JSON.stringify(value)) }
    await retain('2026-09-07', 'attempt-01', report)
    await retain('2026-09-07', 'attempt-02', { ...report, status: 'passed', slots: [{ ...report.slots[0], hardOutcome: 'pass' }] })
    await mkdir(join(root, '2026-09-14', 'attempt-01'), { recursive: true })
    const data = await updateWeeklyTrend(root)
    assert.equal(data.points.length, 3)
    assert.equal(data.selected[0].status, 'degraded')
    assert.equal(data.selected[0].hardPassRate.numerator, 0)
    assert.equal(data.selected[1].status, 'insufficient')
    assert.equal(data.selected[1].hardPassRate.denominator, null)
    assert.match(await readFile(join(root, 'README.md'), 'utf8'), /attempt-02/)
    assert.equal(weekDate(new Date('2026-09-13T23:59:59Z')), '2026-09-07')
    assert.equal(weekDate(new Date('2026-09-14T00:00:00Z')), '2026-09-14')
    const two = [data.selected[0], { ...data.selected[0], week: '2026-09-14' }]
    assert.match(renderWeeklyTrend(two), /stroke="#2563eb"/)
    assert.doesNotMatch(renderWeeklyTrend([two[0], { ...two[1], comparisonKey: 'changed' }]), /stroke="#2563eb"/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
