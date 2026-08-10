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
  const module = await import(`${pathToFileURL(join(workspace, 'src/retry-plan.mjs')).href}?verify=3`)
  const attempts = [
    { operationId: ' alpha ', status: 'failed' },
    { operationId: 'alpha', status: 'failed' },
    { operationId: 'beta', status: 'succeeded' },
    { operationId: 'gamma', status: 'pending' },
    { operationId: ' ', status: 'failed' }
  ]
  const original = structuredClone(attempts)
  assert.deepEqual(module.buildRetryPlan(attempts, 3), [
    { operationId: 'alpha', nextAttempt: 3 },
    { operationId: 'gamma', nextAttempt: 2 }
  ])
  assert.deepEqual(module.buildRetryPlan(attempts, 2), [{ operationId: 'gamma', nextAttempt: 2 }])
  assert.deepEqual(module.buildRetryPlan(attempts, 0), [])
  assert.deepEqual(attempts, original)
  functionalPassed = true
} catch {
  functionalPassed = false
}
checks.push({
  checkId: 'CHK-RETRY',
  status: functionalPassed ? 'passed' : 'failed',
  evidence: [{
    code: functionalPassed ? 'retry.behavior_passed' : 'retry.behavior_failed',
    summary: functionalPassed
      ? 'Idempotent success suppression, attempt limits, ordering, defaults, and immutability passed.'
      : 'At least one retry aggregation, success suppression, limit, ordering, or immutability assertion failed.'
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
