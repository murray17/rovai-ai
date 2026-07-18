import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'lumen-recovery-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const coreBinary = join(root, 'target', 'debug', 'lumen-core')
let firstCore
let recoveredCore

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Recovery Smoke\n')
  await git(['init', '-b', 'main'], projectRoot)
  await git(['config', 'user.name', 'Lumen Recovery Smoke'], projectRoot)
  await git(['config', 'user.email', 'recovery@lumen.local'], projectRoot)
  await git(['add', 'README.md'], projectRoot)
  await git(['commit', '-m', 'fixture'], projectRoot)

  firstCore = startCore(coreBinary, dataDir)
  const project = await firstCore.request('projects.open', { path: projectRoot })
  const task = await firstCore.request('tasks.create', {
    projectId: project.id,
    title: 'Recovery smoke',
    goal: 'Run `sleep 8`, then reply with RECOVERY_OK. Do not modify any files.'
  })
  if (await realpath(task.executionRoot) !== await realpath(projectRoot)) {
    throw new Error(`Task did not bind directly to the selected project: ${task.executionRoot}`)
  }
  await firstCore.request('tasks.start', { taskId: task.id })
  await waitUntil(() => {
    failOnApproval(firstCore.events)
    return firstCore.events.some((event) =>
      event.method === 'activity.started'
      && event.params?.payload?.item?.type === 'commandExecution'
    )
  }, 60_000)

  await firstCore.stop()
  if (firstCore.stderr.includes('panicked at')) throw new Error('First Core panicked during shutdown')
  firstCore = null

  recoveredCore = startCore(coreBinary, dataDir)
  const recoveringTask = await recoveredCore.request('tasks.get', { taskId: task.id })
  if (recoveringTask.status !== 'recovering') {
    throw new Error(`Restarted task should be recovering, got ${recoveringTask.status}`)
  }
  const eventsBeforeResume = await recoveredCore.request('events.list', { taskId: task.id, limit: 1_000 })
  if (!eventsBeforeResume.some((event) => event.nativeMethod === 'application/restarted')) {
    throw new Error('Recovery boundary was not persisted')
  }

  await recoveredCore.request('tasks.resume', { taskId: task.id })
  await waitUntil(() => {
    failOnApproval(recoveredCore.events)
    return recoveredCore.events.some((event) =>
      event.method === 'turn.state'
      && event.params?.nativeMethod === 'turn/completed'
    )
  }, 150_000)

  const finalTask = await recoveredCore.request('tasks.get', { taskId: task.id })
  const audit = await recoveredCore.request('events.list', { taskId: task.id, limit: 2_000 })
  const diff = await recoveredCore.request('tasks.diff', { taskId: task.id })
  const resumed = audit.find((event) => event.nativeMethod === 'recovery/resume')
  const agentText = audit
    .filter((event) => event.eventType === 'agent.text.delta')
    .map((event) => event.payload?.delta ?? '')
    .join('')

  if (finalTask.status !== 'completed') throw new Error(`Recovered task finished as ${finalTask.status}`)
  if (!resumed?.payload?.isResumeFrame) throw new Error('Structured Resume Frame was not recorded')
  if (!agentText.includes('RECOVERY_OK')) throw new Error(`Recovered text was unexpected: ${agentText}`)
  if (!diff.isClean) throw new Error(`Recovery smoke changed files: ${JSON.stringify(diff.status)}`)

  process.stdout.write(`${JSON.stringify({
    ok: true,
    statusAfterRestart: recoveringTask.status,
    finalStatus: finalTask.status,
    nativeThreadWasResumed: !audit.some((event) => event.nativeMethod === 'session/generation-changed'),
    resumeFrameRecorded: true,
    streamedTextIncludesMarker: true,
    projectIsClean: true,
    executionRoot: task.executionRoot
  }, null, 2)}\n`)
} finally {
  let shutdownError
  if (firstCore) await firstCore.stop()
  if (recoveredCore) {
    await recoveredCore.stop()
    if (recoveredCore.stderr.includes('panicked at')) {
      shutdownError = new Error('Recovered Core panicked during shutdown')
    }
  }
  await rm(fixtureRoot, { recursive: true, force: true })
  if (shutdownError) throw shutdownError
}

function startCore(binary, recoveryDataDir) {
  const child = spawn(binary, ['--data-dir', recoveryDataDir], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const events = []
  const pending = new Map()
  let nextId = 1
  let stderr = ''
  const lines = createInterface({ input: child.stdout })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) {
      events.push(message)
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  return {
    events,
    get stderr() { return stderr },
    request(method, params = {}) {
      return new Promise((resolveRequest, rejectRequest) => {
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          rejectRequest(new Error(`Timed out waiting for ${method}`))
        }, 70_000)
        pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      })
    },
    async stop() {
      if (child.exitCode !== null) return
      child.stdin.end()
      await Promise.race([
        new Promise((resolveClose) => child.once('close', resolveClose)),
        wait(5_000)
      ])
      if (child.exitCode === null) child.kill('SIGTERM')
    }
  }
}

function failOnApproval(events) {
  const approval = events.find((event) => event.method === 'approval.requested')
  if (approval) throw new Error(`Recovery smoke unexpectedly requested approval: ${JSON.stringify(approval.params)}`)
}

async function git(args, cwd) {
  await new Promise((resolveGit, rejectGit) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = []
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectGit)
    child.once('close', (code) => code === 0 ? resolveGit() : rejectGit(new Error(`git failed (${code}): ${stderr.join('')}`)))
  })
}

async function waitUntil(check, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return
    await wait(100)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
