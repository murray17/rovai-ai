import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDemoCases } from '../qualification-demo-cases.mjs'

test('public demo catalog contains five independently sealed executable Cases', async () => {
  const cases = await checkDemoCases()
  assert.deepEqual(cases.map((entry) => entry.id), [
    'DEMO-001', 'DEMO-002', 'DEMO-003', 'DEMO-004', 'DEMO-005'
  ])
  assert.equal(new Set(cases.map((entry) => entry.seal)).size, cases.length)
  for (const entry of cases) {
    assert.match(entry.seal, /^[a-f0-9]{64}$/u)
    assert.equal(entry.requirements, 3)
    assert.equal(entry.publicChecks, 1)
  }
})
