// Fixed entry for the owner-registered developer installation. The App, never
// a managed Agent, launches this worker. All task execution remains in Runner.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runPlan, validatePlanInputs, buildProduct, freezePlan } from './lib/context-evaluation.mjs'
import { runWeekly } from './lib/context-weekly.mjs'

const args = process.argv.slice(2)
if (args.length !== 4 || args[0] !== '--job' || args[2] !== '--parent' || !/^\d+$/.test(args[3])) throw new Error('Expected a Host-owned job and parent process')
const jobFile = args[1], parent = Number(args[3])
const job = JSON.parse(await readFile(jobFile, 'utf8'))
if (job.schemaVersion !== 1 || !['gate', 'weekly'].includes(job.mode) || job.state !== 'running') throw new Error('Invalid Host job')
const exec = promisify(execFile)
const seen = new Map()
let stopping = false, monitoring = false
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function processes() {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 })
  return stdout.trim().split('\n').map(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), started: match[3] } : null
  }).filter(Boolean)
}
function remember(table) {
  const owned = new Set([process.pid])
  let changed = true
  while (changed) {
    changed = false
    for (const item of table) if (!owned.has(item.pid) && owned.has(item.ppid)) {
      owned.add(item.pid); seen.set(item.pid, item.started); changed = true
    }
  }
}
async function stop(reason) {
  if (stopping) return
  stopping = true
  clearInterval(monitor)
  console.error(JSON.stringify({ state: 'interrupted', reason }))
  // Stop only descendants of this worker, remembering their process start
  // identity so a reused PID is never signalled. Include detached Runtime groups.
  for (let round = 0; round < 8; round++) {
    const table = await processes(); remember(table)
    const children = table.filter(item => seen.get(item.pid) === item.started)
    for (const item of children.reverse()) {
      try { process.kill(item.pid, round < 4 ? 'SIGTERM' : 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
    }
    if (!children.length) break
    await pause(250)
  }
  process.exit(2)
}
const monitor = setInterval(() => {
  if (monitoring || stopping) return
  monitoring = true
  void processes().then(async table => {
    remember(table)
    if (table.find(item => item.pid === process.pid)?.ppid !== parent) await stop('app_parent_exited')
  }).catch(error => { console.error(error.message); void stop('process_observation_failed') }).finally(() => { monitoring = false })
}, 1000)
process.on('SIGTERM', () => { void stop('host_cancelled') })
process.on('SIGINT', () => { void stop('interrupted') })
try {
  let planPath = job.plan
  if (job.automationId) {
    const template = JSON.parse(await readFile(job.plan, 'utf8'))
    // Weekly observation rebuilds the current source, while the suite, rubric,
    // Judge and budgets remain the explicitly registered frozen template.
    await validatePlanInputs(template, { products: false })
    const buildRoot = join(job.output, `build-${job.jobId}`)
    await mkdir(buildRoot, { mode: 0o700 })
    const product = await buildProduct(template.products.candidate.repository, join(buildRoot, 'product'))
    planPath = join(buildRoot, 'plan.json')
    await freezePlan({ schemaVersion: 1, mode: 'weekly', suite: template.suite.path, candidate: join(dirname(product.core), 'product.json'), team: template.team, repetitions: template.repetitions, budget: template.budget, execution: template.execution, judge: template.judge && { adapter: template.judge.adapter, configuration: template.judge.configuration } }, planPath)
  }
  const result = await (job.mode === 'weekly' ? runWeekly : runPlan)(planPath, job.output)
  if (!stopping) await writeFile(join(dirname(jobFile), 'result.json'), JSON.stringify({ directory: result.directory, status: result.report.status, planDigest: result.report.planDigest }), { flag: 'wx', mode: 0o600 })
} finally { clearInterval(monitor) }
