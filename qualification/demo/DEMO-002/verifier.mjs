import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workspace = resolve(process.argv[2] ?? '')
const checks = []
const publicCheck = await run(process.execPath, ['--test', 'tests/public.test.mjs'], workspace)
checks.push({
  checkId: 'CHK-REGRESSION',
  status: publicCheck.code === 0 ? 'passed' : 'failed',
  evidence: [{
    code: publicCheck.code === 0 ? 'public.tests_passed' : 'public.tests_failed',
    summary: publicCheck.code === 0 ? 'The disclosed public smoke test passed.' : 'The disclosed public smoke test failed.'
  }]
})

let functionalPassed = false
try {
  const module = await import(`${pathToFileURL(join(workspace, 'src/normalize-events.mjs')).href}?verify=2`)
  const input = [
    { id: ' a ', actor: ' fox ', type: ' start ', value: 1 },
    { eventId: 'b', actorId: ' owl ', kind: 'done', payload: { value: { ok: true } } },
    { id: 'a', actor: 'ignored', type: 'duplicate', value: 99 },
    { eventId: 'c', actorId: ' ', kind: ' ', payload: { value: null } },
    { eventId: 'd', actorId: 'fox', kind: 'done', payload: { value: 3 } },
    { id: '   ', actor: 'bad', type: 'ignored', value: 4 }
  ]
  const original = structuredClone(input)
  const expected = [
    { id: 'a', actor: 'fox', kind: 'start', value: 1 },
    { id: 'b', actor: 'owl', kind: 'done', value: { ok: true } },
    { id: 'c', actor: 'system', kind: 'unknown', value: null },
    { id: 'd', actor: 'fox', kind: 'done', value: 3 }
  ]
  assert.deepEqual(module.normalizeEvents(input), expected)
  assert.deepEqual(input, original)
  assert.deepEqual(module.normalizeEvents(input), expected)
  functionalPassed = true
} catch {
  functionalPassed = false
}
checks.push({
  checkId: 'CHK-NORMALIZE',
  status: functionalPassed ? 'passed' : 'failed',
  evidence: [{
    code: functionalPassed ? 'normalization.behavior_passed' : 'normalization.behavior_failed',
    summary: functionalPassed
      ? 'Both event versions, identity de-duplication, defaults, ordering, and immutability passed.'
      : 'At least one normalization, de-duplication, ordering, or immutability assertion failed.'
  }]
})
checks.push({
  checkId: 'CHK-DIAGNOSTIC',
  status: functionalPassed && publicCheck.code === 0 ? 'passed' : 'failed',
  evidence: [{
    code: functionalPassed && publicCheck.code === 0 ? 'verifier.cross_check_consistent' : 'verifier.cross_check_adverse',
    summary: 'Diagnostic cross-check of the functional and public observations.'
  }]
})
checks.sort((left, right) => left.checkId.localeCompare(right.checkId))
console.log(JSON.stringify({ schemaVersion: 2, checks }))

function run(command, args, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] })
    child.once('close', (code) => resolveRun({ code }))
  })
}
