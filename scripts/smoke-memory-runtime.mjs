import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureCodexRuntime } from './configure-codex-runtime.mjs'

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
    const health = await core.request('health.check', { refreshRuntimeProbe: true })
    const runtimeVersion = adapterKind === 'codex-cli'
      ? await configureCodexOnly(core.request, health)
      : await configureClaude(core.request, health)

    const policy = await core.request('memory.autoPolicy.get')
    const policyResult = await core.request('memory.autoPolicy.set', {
      commandId: crypto.randomUUID(),
      command: {
        expectedVersion: policy.version,
        companionLessonAutoApplyEnabled: true
      }
    })
    if (policyResult.status !== 'applied') {
      throw new Error(`Memory auto policy was not acknowledged: ${JSON.stringify(policyResult)}`)
    }

    const created = await core.request('camps.createFromFirstMessage', {
      commandId: crypto.randomUUID(),
      project: null,
      body: [
        '执行一次 bounded Memory 自动形成验收。',
        '必须且只能调用一次 memory.propose_change，参数如下：',
        `action=add, scope=companion, kind=lesson, body=${lessonBody}`,
        '检查结构化回执。只有当 status=accepted、effective=true、resolutionMode=policy_auto、authority=provisional，且 memoryId/revisionId 均存在时，才只回复 MEMORY_AUTO_OK。'
      ].join('\n'),
      purpose: `Verify ${adapterKind} receives the effective provisional Memory receipt.`,
      expectedOutput: 'One provisional Companion Lesson and MEMORY_AUTO_OK.'
    })
    const campId = created.payload?.campId
    const agentRunId = created.payload?.agentRunIds?.[0]
    if (created.status !== 'accepted' || !campId || !agentRunId) {
      throw new Error(`Memory Runtime Camp was not accepted: ${JSON.stringify(created)}`)
    }

    let lastState = null
    const accepted = await waitFor(async () => {
      const [snapshot, proposals, library] = await Promise.all([
        core.request('camps.snapshot', { campId }),
        core.request('memory.proposals.list'),
        core.request('memory.list')
      ])
      const run = snapshot.agentRuns.find((value) => value.id === agentRunId)
      const proposal = proposals.find((value) => value.sourceAgentRunId === agentRunId)
      const memory = library.memories.find((value) => value.id === proposal?.acceptedMemoryId)
      const receiptObserved = snapshot.messages.some((message) =>
        message.body?.includes('MEMORY_AUTO_OK')
      )
      lastState = { run, proposal, memory, receiptObserved }
      if (run?.status === 'failed' || run?.status === 'cancelled') {
        throw new Error(`${adapterKind} Memory Runtime failed: ${JSON.stringify(lastState)}`)
      }
      return run?.status === 'succeeded'
        && receiptObserved
        && proposal?.status === 'accepted'
        && proposal.resolutionMode === 'policy_auto'
        && proposal.resolutionPolicyVersion === policy.version + 1
        && memory?.currentAuthority === 'provisional'
        && memory.currentRevisionId === proposal.acceptedRevisionId
        ? { proposal, memory }
        : null
    }, `${adapterKind} Memory Runtime`, 300_000, () => lastState)

    await core.stop()
    core = startCore(dataDir, adapterKind === 'claude-code-cli'
      ? { ANTHROPIC_MODEL: process.env.ROVAI_MEMORY_CLAUDE_MODEL ?? 'haiku' }
      : {})
    const [restoredProposal, restoredMemory] = await Promise.all([
      core.request('memory.proposals.list')
        .then((proposals) => proposals.find((value) => value.id === accepted.proposal.id)),
      core.request('memory.get', { memoryId: accepted.memory.id })
    ])
    if (restoredProposal?.resolutionMode !== 'policy_auto'
        || restoredMemory?.currentAuthority !== 'provisional'
        || restoredMemory?.currentRevisionId !== accepted.memory.currentRevisionId) {
      throw new Error(`Restart changed the effective Memory receipt state: ${JSON.stringify({
        restoredProposal,
        restoredMemory
      })}`)
    }

    return {
      adapterKind,
      runtimeVersion,
      campId,
      agentRunId,
      proposalId: accepted.proposal.id,
      memoryId: accepted.memory.id,
      revisionId: accepted.memory.currentRevisionId,
      effective: true,
      authority: accepted.memory.currentAuthority,
      resolutionMode: accepted.proposal.resolutionMode,
      restoredWithoutDuplication: true
    }
  } finally {
    if (core) await core.stop()
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

async function configureCodexOnly(request, health) {
  if (health.codex.status !== 'ready') {
    throw new Error(`Codex health gate failed: ${JSON.stringify(health.codex)}`)
  }
  await configureCodexRuntime(request, health, ['agent-muwa'])
  return health.codex.reportedVersion
}

async function configureClaude(request, health) {
  const candidate = health.runtimeCandidates.find((value) =>
    value.runtimeKind === 'claude-code-cli'
  )
  if (candidate?.status !== 'ready' || !candidate.executablePath) {
    throw new Error(`Claude health gate failed: ${JSON.stringify(candidate)}`)
  }
  let installations = await request('runtime.installations.list')
  let installation = installations.find((value) =>
    value.adapterKind === 'claude-code-cli'
      && value.executablePath === candidate.executablePath
      && value.authScope === 'local-user'
  )
  if (!installation) {
    const result = await request('runtime.installations.create', {
      commandId: crypto.randomUUID(),
      command: {
        adapterKind: 'claude-code-cli',
        executablePath: candidate.executablePath,
        source: 'discovered',
        authScope: 'local-user'
      }
    })
    if (result.status !== 'applied') {
      throw new Error(`Claude installation was not created: ${JSON.stringify(result)}`)
    }
    installation = { id: result.resultEntity.entityId }
  }
  const refreshed = await request('runtime.installations.refresh', {
    commandId: crypto.randomUUID(),
    installationId: installation.id
  })
  if (refreshed.status !== 'applied') {
    throw new Error(`Claude installation was not refreshed: ${JSON.stringify(refreshed)}`)
  }
  installations = await request('runtime.installations.list')
  installation = installations.find((value) => value.id === installation.id)
  if (installation?.snapshot?.probeStatus !== 'ready') {
    throw new Error(`Claude installation is not ready: ${JSON.stringify(installation)}`)
  }
  const profile = await request('agents.get', { agentProfileId: 'agent-muwa' })
  const configured = await request('agents.runtime.set', {
    commandId: crypto.randomUUID(),
    command: {
      agentProfileId: 'agent-muwa',
      expectedVersion: profile.version,
      runtime: {
        installationId: installation.id,
        model: { mode: 'runtime_default' },
        permissions: {
          adapterKind: 'claude-code-cli',
          schemaVersion: installation.snapshot.permissionSchemaVersion,
          values: { permission_mode: 'acceptEdits' }
        }
      }
    }
  })
  if (configured.status !== 'applied') {
    throw new Error(`Claude Agent Runtime was not configured: ${JSON.stringify(configured)}`)
  }
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
