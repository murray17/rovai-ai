import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'lumen-core-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
let core

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Lumen Core Smoke\n\nMarker: SMOKE_OK\n')
  await git(['init', '-b', 'main'], projectRoot)
  await git(['config', 'user.name', 'Lumen Smoke'], projectRoot)
  await git(['config', 'user.email', 'smoke@lumen.local'], projectRoot)
  await git(['add', 'README.md'], projectRoot)
  await git(['commit', '-m', 'fixture'], projectRoot)

  core = spawn(join(root, 'target', 'debug', 'lumen-core'), ['--data-dir', dataDir], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const stderr = []
  core.stderr.on('data', (chunk) => stderr.push(String(chunk)))
  const lines = createInterface({ input: core.stdout })
  const pending = new Map()
  const events = []
  let nextId = 1

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

  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = nextId++
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectRequest(new Error(`Timed out waiting for ${method}`))
    }, 70_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    core.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })

  const health = await request('health.check')
  if (!health.codex.installed || !health.codex.authenticated || health.codex.compatible === false) {
    throw new Error(`Codex health gate failed: ${JSON.stringify(health.codex)}`)
  }
  const project = await request('projects.open', { path: projectRoot })
  const task = await request('tasks.create', {
    projectId: project.id,
    title: 'Codex app-server smoke',
    goal: 'Read README.md, then reply with exactly SMOKE_OK. Do not modify files.'
  })
  await request('tasks.start', { taskId: task.id })

  await waitUntil(() => {
    const approval = events.find((event) => event.method === 'approval.requested')
    if (approval) throw new Error(`Smoke task unexpectedly requested approval: ${JSON.stringify(approval.params)}`)
    return events.some((event) => event.method === 'turn.state' && event.params?.nativeMethod === 'turn/completed')
  }, 120_000)

  const audit = await request('events.list', { taskId: task.id, limit: 1_000 })
  const agentText = audit
    .filter((event) => event.eventType === 'agent.text.delta')
    .map((event) => event.payload?.delta ?? '')
    .join('')
  const finalTask = await request('tasks.get', { taskId: task.id })
  const diff = await request('tasks.diff', { taskId: task.id })

  if (!agentText.includes('SMOKE_OK')) throw new Error(`Agent stream did not contain SMOKE_OK: ${agentText}`)
  if (finalTask.status !== 'completed') throw new Error(`Task finished as ${finalTask.status}`)
  if (diff.status.length !== 0) throw new Error(`Read-only smoke changed files: ${JSON.stringify(diff.status)}`)

  console.log(JSON.stringify({
    ok: true,
    codex: health.codex.version,
    taskStatus: finalTask.status,
    standardEvents: [...new Set(audit.map((event) => event.eventType))],
    streamedText: agentText.trim(),
    worktreeIsClean: true
  }, null, 2))
} finally {
  if (core && !core.killed) {
    core.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => core.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
    ])
    if (core.exitCode === null) core.kill('SIGTERM')
  }
  await rm(fixtureRoot, { recursive: true, force: true })
}

async function git(args, cwd) {
  await run('git', args, cwd)
}

async function run(command, args, cwd) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = []
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} failed (${code}): ${stderr.join('')}`)))
  })
}

async function waitUntil(check, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}
