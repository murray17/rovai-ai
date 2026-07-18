import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const root = resolve(import.meta.dirname, '..')
const dataDir = process.env.LUMEN_BOOTSTRAP_DATA_DIR
  ?? join(homedir(), 'Library', 'Application Support', 'lumen-ai')
const corePath = join(root, 'resources', 'bin', 'lumen-core')
const goal = `为 Lumen v0.01 任务工作台增加一个真实的项目工作区变更摘要：

1. Rust GitDiff 增加 isClean 和 changedFileCount 字段，由 git status 结果计算。
2. TypeScript GitDiff contract 同步这两个字段。
3. 在任务工作台顶部的起始分支旁显示“项目干净”或“已变更 N 个文件”；使用成功/提醒语义色，不使用角色色。
4. 为纯计算逻辑补充自动测试。
5. 运行 cargo test；如果当前项目已有前端依赖，再运行 pnpm typecheck 和 pnpm test。

直接在当前项目目录内修改，保留已有改动。不要安装依赖、访问网络、Git commit、push 或创建 PR。完成后清楚汇报修改与验证。`

const cleanStatus = await runCapture('git', ['status', '--porcelain'], root)
if (cleanStatus.trim()) {
  throw new Error(`Self-bootstrap requires a clean main workspace:\n${cleanStatus}`)
}

const core = spawn(corePath, ['--data-dir', dataDir], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe']
})
const pending = new Map()
const events = []
const stderr = []
let nextId = 1
let failed

core.stderr.on('data', (chunk) => {
  const text = String(chunk)
  stderr.push(text)
  process.stderr.write(text)
})
core.once('error', (error) => { failed = error })
const lines = createInterface({ input: core.stdout })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method) {
    events.push(message)
    const label = eventLabel(message)
    if (label) process.stdout.write(`${label}\n`)
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

try {
  const health = await request('health.check')
  if (!health.codex.installed || !health.codex.authenticated || health.codex.compatible === false) {
    throw new Error(`Codex health gate failed: ${JSON.stringify(health.codex)}`)
  }
  const project = await request('projects.open', { path: root })
  const task = await request('tasks.create', {
    projectId: project.id,
    title: '自举：项目工作区变更摘要',
    goal
  })
  process.stdout.write(`Task ${task.id}\nProject ${task.executionRoot}\n`)
  await request('tasks.start', { taskId: task.id })

  await waitUntil(() => {
    if (failed) throw failed
    const approval = events.find((event) => event.method === 'approval.requested')
    if (approval) {
      throw new Error(`Self-bootstrap paused for explicit approval; open Lumen to decide:\n${JSON.stringify(approval.params, null, 2)}`)
    }
    return events.some((event) => event.method === 'turn.state' && event.params?.nativeMethod === 'turn/completed')
  }, 300_000)

  const finalTask = await request('tasks.get', { taskId: task.id })
  const diff = await request('tasks.diff', { taskId: task.id })
  const audit = await request('events.list', { taskId: task.id, limit: 2_000 })
  const agentText = audit
    .filter((event) => event.eventType === 'agent.text.delta')
    .map((event) => event.payload?.delta ?? '')
    .join('')

  if (finalTask.status !== 'completed') throw new Error(`Task finished as ${finalTask.status}`)
  if (!diff.status.length) throw new Error('Codex completed without changing the self-bootstrap project')

  process.stdout.write(`${JSON.stringify({
    ok: true,
    taskId: task.id,
    executionRoot: task.executionRoot,
    startBranch: task.startBranch,
    taskStatus: finalTask.status,
    changedFiles: diff.status,
    agentSummary: agentText.trim()
  }, null, 2)}\n`)
} finally {
  core.stdin.end()
  await Promise.race([
    new Promise((resolveClose) => core.once('close', resolveClose)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
  ])
  if (core.exitCode === null) core.kill('SIGTERM')
}

function eventLabel(event) {
  const payload = event.params?.payload
  if (event.method === 'agent.text.delta') return payload?.delta ?? ''
  if (event.method === 'activity.started') {
    const item = payload?.item
    return item?.command ? `› ${item.command}` : item?.type ? `› ${item.type}` : null
  }
  if (event.method === 'file.change.updated') return '± file patch updated'
  if (event.method === 'turn.state' && event.params?.nativeMethod === 'turn/completed') return '✓ turn completed'
  return null
}

async function runCapture(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const commandStderr = []
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)))
    child.stderr.on('data', (chunk) => commandStderr.push(String(chunk)))
    child.once('error', rejectRun)
    child.once('close', (code) => code === 0 ? resolveRun(stdout.join('')) : rejectRun(new Error(`${command} failed (${code}): ${commandStderr.join('')}`)))
  })
}

async function waitUntil(check, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 120))
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}
