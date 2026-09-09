import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

const workspace = resolve(process.argv[2] ?? '')
const checks = []

const publicCheck = await run(process.execPath, ['--test', 'tests/public.test.mjs'], workspace)
checks.push({
  checkId: 'CHK-REGRESSION',
  status: publicCheck.code === 0 ? 'passed' : 'failed',
  evidence: [{
    code: publicCheck.code === 0 ? 'public.tests_passed' : 'public.tests_failed',
    summary: publicCheck.code === 0 ? 'The disclosed public regression test passed.' : 'The disclosed public regression test failed.'
  }]
})

let requirementsPassed = false
try {
  const module = await import(`${pathToFileURL(join(workspace, 'src/group-events.mjs')).href}?verify=1`)
  const input = [
    { actor: 'fox', label: 'plan' },
    { actor: 'fox', label: 'edit' },
    { actor: 'owl', label: 'test' },
    { actor: 'fox', label: 'integrate' },
    { actor: '   ', label: 'finish' },
    { actor: '', label: 'archive' }
  ]
  const original = structuredClone(input)
  assert.deepEqual(module.groupEvents(input), [
    { actor: 'fox', count: 2, labels: ['plan', 'edit'] },
    { actor: 'owl', count: 1, labels: ['test'] },
    { actor: 'fox', count: 1, labels: ['integrate'] },
    { actor: 'system', count: 2, labels: ['finish', 'archive'] }
  ])
  assert.deepEqual(input, original)
  requirementsPassed = true
} catch {
  requirementsPassed = false
}
checks.push({
  checkId: 'CHK-GROUPING',
  status: requirementsPassed ? 'passed' : 'failed',
  evidence: [{
    code: requirementsPassed ? 'grouping.behavior_passed' : 'grouping.behavior_failed',
    summary: requirementsPassed
      ? 'The withheld adjacent-grouping and input-immutability assertions passed.'
      : 'At least one withheld adjacent-grouping or input-immutability assertion failed.'
  }]
})
checks.push({
  checkId: 'CHK-VERIFIER-DIAGNOSTIC',
  status: requirementsPassed && publicCheck.code === 0 ? 'passed' : 'failed',
  evidence: [{
    code: requirementsPassed && publicCheck.code === 0
      ? 'verifier.cross_check_consistent'
      : 'verifier.cross_check_adverse',
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
