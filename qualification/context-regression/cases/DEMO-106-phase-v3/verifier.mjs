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
  const module = await import(`${pathToFileURL(join(workspace, 'src/apply-patch-plan.mjs')).href}?verify=5`)
  const tree = { 'README.md': 'old', 'src/keep.mjs': 'keep', 'src/remove.mjs': 'remove' }
  const operations = [
    { type: 'set', path: 'src/new.mjs', content: 'new' },
    { type: 'delete', path: 'src/remove.mjs' },
    { type: 'set', path: 'README.md', content: 'updated' }
  ]
  const originalTree = structuredClone(tree)
  const originalOperations = structuredClone(operations)
  assert.deepEqual(module.applyPatchPlan(tree, operations), {
    committed: true,
    tree: { 'README.md': 'updated', 'src/keep.mjs': 'keep', 'src/new.mjs': 'new' },
    error: null
  })
  assert.deepEqual(tree, originalTree)
  assert.deepEqual(operations, originalOperations)
  for (const invalid of [
    [{ type: 'set', path: '../escape', content: 'bad' }, { type: 'set', path: 'src/later.mjs', content: 'partial' }],
    [{ type: 'set', path: '/absolute', content: 'bad' }],
    [{ type: 'set', path: 'src/dup.mjs', content: 'one' }, { type: 'delete', path: 'src/dup.mjs' }],
    [{ type: 'set', path: 'src/bad.mjs', content: 42 }]
  ]) {
    const result = module.applyPatchPlan(tree, invalid)
    assert.equal(result.committed, false)
    assert.deepEqual(result.tree, originalTree)
    assert.equal(typeof result.error, 'string')
  }
  functionalPassed = true
} catch {
  functionalPassed = false
}
checks.push({
  checkId: 'CHK-PATCH',
  status: functionalPassed ? 'passed' : 'failed',
  evidence: [{
    code: functionalPassed ? 'patch.behavior_passed' : 'patch.behavior_failed',
    summary: functionalPassed
      ? 'Valid updates, sorted output, containment checks, rollback, and immutability passed.'
      : 'At least one patch, containment, rollback, or immutability assertion failed.'
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
