import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const selectedAdapters = (process.env.ROVAI_MEMORY_RUNTIME_ADAPTERS
  ?? 'codex-cli,claude-code-cli')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const supportedAdapters = new Set(['codex-cli', 'claude-code-cli'])
const results = []

for (const adapterKind of selectedAdapters) {
  if (!supportedAdapters.has(adapterKind)) {
    throw new Error(`Unsupported ROVAI_MEMORY_RUNTIME_ADAPTERS value: ${adapterKind}`)
  }
  results.push(await runAdapterSmoke(adapterKind))
}

console.log(JSON.stringify({ ok: true, results }, null, 2))

async function runAdapterSmoke(adapterKind) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), `rovai-memory-runtime-${adapterKind}-`))
  const dataDir = join(fixtureRoot, 'data')
  const lessonBody = `Runtime 验收 ${adapterKind}：长期经验应先核对工具回执再宣称生效。`
  let core = null
  try {
    core = startCore(dataDir, adapterKind === 'claude-code-cli'
      ? { ANTHROPIC_MODEL: process.env.ROVAI_MEMORY_CLAUDE_MODEL ?? 'haiku' }
      : {})
    const health = await core.request('health.check')
    const runtimeVersion = adapterKind === 'codex-cli'
      ? await configureCodexOnly(core.request, health)
      : await configureClaude(core.request, health)

    const settings = await core.request('memory.settings.get')
    if (settings.agentMemoryWritesEnabled !== true) {
      throw new Error(`Agent Memory writes were not default-on: ${JSON.stringify(settings)}`)
    }

    const createdResponse = await createConfiguredCampAndSend(core.request, {
      commandId: crypto.randomUUID(),
      workspace: null,
      body: [
        '执行一次 bounded Memory 自动形成验收。',
        '必须且只能调用一次 memory.write，参数如下：',
        `action=add, scope=companion, kind=lesson, body=${lessonBody}, retrievalKeys=["运行时验收","工具回执"]`,
        '检查结构化回执。只有当 effective=true，且 memoryId/revisionId 均存在时，才只回复 MEMORY_WRITE_OK。'
      ].join('\n'),
      purpose: `Verify ${adapterKind} receives the effective Agent Memory write receipt.`,
      expectedOutput: 'One effective Companion Lesson and MEMORY_WRITE_OK.'
    })
    const created = createdResponse.commandResult ?? createdResponse
    const campId = created.payload?.campId
    const agentRunId = created.payload?.agentRunIds?.[0]
    if (created.status !== 'accepted' || !campId || !agentRunId) {
      throw new Error(`Memory Runtime Camp was not accepted: ${JSON.stringify(createdResponse)}`)
    }

    let lastState = null
    const accepted = await waitFor(async () => {
      const [snapshot, library] = await Promise.all([
        core.request('camps.snapshot', { campId }),
        core.request('memory.list')
      ])
      const run = snapshot.agentRuns.find((value) => value.id === agentRunId)
      const memory = library.memories.find((value) =>
        value.creationOrigin === 'agent'
        && value.revisions.some((revision) => revision.sourceAgentRunId === agentRunId))
      const receiptObserved = snapshot.messages.some((message) =>
        message.body?.includes('MEMORY_WRITE_OK')
      )
      lastState = { run, memory, receiptObserved }
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        throw new Error(`${adapterKind} Memory Runtime failed: ${JSON.stringify(lastState)}`)
      }
      return run?.status === 'succeeded'
        && receiptObserved
        && memory?.lifecycle === 'active'
        && memory.creationOrigin === 'agent'
        ? { memory }
        : null
    }, `${adapterKind} Memory Runtime`, 300_000, () => lastState)

    await core.stop()
    core = startCore(dataDir, adapterKind === 'claude-code-cli'
      ? { ANTHROPIC_MODEL: process.env.ROVAI_MEMORY_CLAUDE_MODEL ?? 'haiku' }
      : {})
    const restoredMemory = await core.request('memory.get', { memoryId: accepted.memory.id })
    if (restoredMemory?.creationOrigin !== 'agent'
        || restoredMemory?.currentRevisionId !== accepted.memory.currentRevisionId) {
      throw new Error(`Restart changed the effective Memory receipt state: ${JSON.stringify({
        restoredMemory
      })}`)
    }

    return {
      adapterKind,
      runtimeVersion,
      campId,
      agentRunId,
      memoryId: accepted.memory.id,
      revisionId: accepted.memory.currentRevisionId,
      effective: true,
      creationOrigin: accepted.memory.creationOrigin,
      restoredWithoutDuplication: true
    }
  } finally {
    if (core) await core.stop()
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

async function configureCodexOnly(request, health) {
  const installation = await configureCodexRuntime(request, health, ['agent-muwa'])
  return installation.snapshot.reportedVersion
}

async function configureClaude(request, _health) {
  const installation = await configureProductRuntime(
    request,
    'claude-code-cli',
    ['agent-muwa']
  )
  return installation.snapshot.reportedVersion
}

function startCore(dataDirectory, environment = {}) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    env: { ...process.env, ...environment },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  child.stderr.pipe(process.stderr)
  const pending = new Map()
  let nextId = 1
  let stopped = false
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!stopped) {
      rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
    }
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.method) return
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
    }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const stop = async () => {
    if (child.killed || child.exitCode !== null) return
    stopped = true
    child.stdin.end()
    await Promise.race([
      new Promise((resolveClose) => child.once('close', resolveClose)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000))
    ])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  return { request, stop }
}

async function waitFor(probe, label, timeoutMs, describeLastState) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`Timed out waiting for ${label}; lastState=${JSON.stringify(describeLastState())}`)
}
