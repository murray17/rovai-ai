import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'

const workspace = resolve(process.argv[2] ?? '')
const categories = []

const publicCheck = await run(process.execPath, ['--test', 'tests/public.test.mjs'], workspace)
categories.push({
  name: 'public',
  status: publicCheck.code === 0 ? 'passed' : 'failed',
  diagnostic: publicCheck.code === 0 ? 'public checks passed' : 'public checks failed'
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
categories.push({
  name: 'requirements',
  status: requirementsPassed ? 'passed' : 'failed',
  diagnostic: requirementsPassed ? 'withheld behavior checks passed' : 'withheld behavior checks failed'
})
categories.push({ name: 'regression', status: publicCheck.code === 0 ? 'passed' : 'failed', diagnostic: 'public API regression check' })

const verifiedDelivery = categories.every((category) => category.status === 'passed')
console.log(JSON.stringify({ schemaVersion: 1, verifiedDelivery, categories }))

function run(command, args, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] })
    child.once('close', (code) => resolveRun({ code }))
  })
}
