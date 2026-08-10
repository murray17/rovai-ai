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
  const module = await import(`${pathToFileURL(join(workspace, 'src/migrate-state.mjs')).href}?verify=4`)
  const v1 = { version: 1, name: '  Fox  ', items: [
    { id: ' a ', value: { count: 1 } },
    { id: 'a', value: { count: 99 } },
    { id: ' ', value: 2 },
    { id: 'b', value: false }
  ] }
  const v2 = { version: 2, profile: { name: ' Owl ' }, records: [
    { key: 'x', value: 'one' },
    { key: ' x ', value: 'ignored' },
    { key: 'y', value: null }
  ] }
  const originalV1 = structuredClone(v1)
  const originalV2 = structuredClone(v2)
  assert.deepEqual(module.migrateState(v1), {
    version: 3,
    profile: { name: 'Fox' },
    records: [{ key: 'a', value: { count: 1 } }, { key: 'b', value: false }],
    metadata: { migratedFrom: 1 }
  })
  assert.deepEqual(module.migrateState(v2), {
    version: 3,
    profile: { name: 'Owl' },
    records: [{ key: 'x', value: 'one' }, { key: 'y', value: null }],
    metadata: { migratedFrom: 2 }
  })
  assert.deepEqual(module.migrateState({ version: 3, profile: { name: '  ' }, records: [] }), {
    version: 3,
    profile: { name: 'unnamed' },
    records: [],
    metadata: { migratedFrom: 3 }
  })
  assert.throws(() => module.migrateState({ version: 9 }), /unsupported/i)
  assert.deepEqual(v1, originalV1)
  assert.deepEqual(v2, originalV2)
  functionalPassed = true
} catch {
  functionalPassed = false
}
checks.push({
  checkId: 'CHK-MIGRATE',
  status: functionalPassed ? 'passed' : 'failed',
  evidence: [{
    code: functionalPassed ? 'migration.behavior_passed' : 'migration.behavior_failed',
    summary: functionalPassed
      ? 'All supported versions, defaults, duplicate handling, errors, value preservation, and immutability passed.'
      : 'At least one migration, duplicate handling, error, value preservation, or immutability assertion failed.'
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
