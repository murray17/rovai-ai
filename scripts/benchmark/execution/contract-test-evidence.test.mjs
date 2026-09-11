import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyTestExecution } from './contract-test-evidence.mjs'
test('contract evidence belongs to executed tests, not a global exit code or source string', () => {
  const reference = { testName: 'owns_boundary' }
  const run = stdout => ({ stdout, stderr: '', code: 0, spawnError: null, timedOut: false })
  assert.equal(classifyTestExecution(reference, run('test mod::tests::owns_boundary ... ok\n')).status, 'passed')
  for (const output of ['', 'running 0 tests\n', 'test mod::tests::different_test ... ok\n', 'test mod::tests::owns_boundary ... ignored\n']) assert.equal(classifyTestExecution(reference, run(output)).status, 'indeterminate')
  assert.equal(classifyTestExecution(reference, { ...run('test mod::tests::owns_boundary ... FAILED\n'), code: 101 }).status, 'failed')
  assert.equal(classifyTestExecution(reference, { ...run('test mod::tests::owns_boundary ... ok\n'), timedOut: true }).status, 'indeterminate')
})
