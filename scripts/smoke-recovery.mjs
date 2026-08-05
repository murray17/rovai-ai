import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

const root = resolve(import.meta.dirname, '..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rovai-recovery-smoke-'))
const projectRoot = join(fixtureRoot, 'project')
const dataDir = join(fixtureRoot, 'data')
const adapterKind = process.env.ROVAI_RECOVERY_ADAPTER ?? 'opencode-cli'
const agentProfileId = 'agent_1'
let firstCore = null
let recoveredCore = null

try {
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'README.md'), '# Recovery Smoke\n')
  await git(['init', '-b', 'main'], projectRoot)
  await git(['config', 'user.name', 'Rovai-ai Recovery Smoke'], projectRoot)
  await git(['config', 'user.email', 'recovery@rovai.local'], projectRoot)
  await git(['add', 'README.md'], projectRoot)
  await git(['commit', '-m', 'fixture'], projectRoot)

  firstCore = startCore(dataDir)
  const health = await firstCore.request('health.check')
  const runtimeVersion = await configureRuntime(
    firstCore.request,
    health,
    agentProfileId,
    adapterKind
  )
  const workspace = await firstCore.request('workspaces.inspect', { path: projectRoot })
  const created = await createConfiguredCampAndSend(firstCore.request, {
    commandId: crypto.randomUUID(),
    workspace,
    body: [
      '执行 Rovai-ai 硬崩溃恢复验收。',
      '必须使用你的 Shell/Bash 工具执行命令 `sleep 20`。',
      '命令结束后只回复 RECOVERY_OK，不要修改文件，也不要调用 Team Tool。'
    ].join('\n'),
    purpose: 'Prove that one durable AgentRun resumes after the Core process is killed.',
    expectedOutput: 'A public reply containing RECOVERY_OK after the delayed command.'
  })
  if (created.status !== 'accepted') {
    throw new Error(`Camp intake was not accepted: ${JSON.stringify(created)}`)
  }
  const campId = created.payload.campId
  const agentRunId = created.payload.agentRunIds?.[0]
  if (!agentRunId) throw new Error(`Camp intake returned no AgentRun: ${JSON.stringify(created)}`)

  let beforeCrash = await waitFor(async () => {
    const snapshot = await firstCore.request('camps.snapshot', { campId })
    failOnApproval(snapshot)
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    const manifest = snapshot.contextManifests.find((candidate) =>
      candidate.agentRunId === agentRunId
    )
    if (run?.status === 'failed' || run?.status === 'cancelled') {
      throw new Error(`AgentRun terminated before crash injection: ${JSON.stringify({ run, snapshot })}`)
    }
    return run?.status === 'running'
      && manifest?.delivery?.status === 'accepted'
      ? { snapshot, run, manifest }
      : null
  }, 'accepted Runtime input before crash injection', 120_000)

  // Give the Runtime time to enter the requested long-running command. Native
  // Runtime tools are not necessarily reflected as Rovai-ai Action rows, so the
  // durable condition here is accepted input plus a still-running AgentRun.
  await wait(1_500)
  const crashSnapshot = await firstCore.request('camps.snapshot', { campId })
  const crashRun = crashSnapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
  if (crashRun?.status !== 'running') {
    throw new Error(`AgentRun completed before crash injection: ${JSON.stringify(crashSnapshot)}`)
  }
  beforeCrash = { ...beforeCrash, snapshot: crashSnapshot, run: crashRun }
  const taskCommandId = crypto.randomUUID()
  const taskRequest = {
    commandId: taskCommandId,
    campId,
    title: 'Durable recovery checkpoint',
    description: 'Must survive a hard Core restart exactly once.',
    assigneeAgentId: null
  }
  const createdTask = await firstCore.request('tasks.create', taskRequest)
  const taskId = createdTask.payload?.taskId
  if (createdTask.status !== 'applied' || !taskId) {
    throw new Error(`Durable Task was not created before crash: ${JSON.stringify(createdTask)}`)
  }

  const originalEpoch = beforeCrash.run.executionEpoch
  const manifestId = beforeCrash.manifest.id
  await firstCore.crash()
  if (!firstCore.stderr.includes('rovai-core')) {
    throw new Error(`First Core produced no startup diagnostics: ${firstCore.stderr}`)
  }
  firstCore = null

  recoveredCore = startCore(dataDir)
  const immediatelyRecovered = await waitFor(async () => {
    const snapshot = await recoveredCore.request('camps.snapshot', { campId })
    const run = snapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
    return run?.status === 'waiting' && run.waitReason === 'runtime_recovery'
      ? { snapshot, run }
      : null
  }, 'the accepted input to enter explicit recovery reconciliation', 60_000)

  if (immediatelyRecovered.snapshot.agentRuns.length !== 1
      || immediatelyRecovered.snapshot.turns.length !== 1
      || immediatelyRecovered.snapshot.tasks.length !== 1
      || immediatelyRecovered.snapshot.inboxMessages.length !== 0) {
    throw new Error(`Recovery created duplicate collaboration state: ${JSON.stringify(immediatelyRecovered.snapshot)}`)
  }
  if (immediatelyRecovered.run.executionEpoch !== originalEpoch) {
    throw new Error(`Accepted input was incorrectly redispatched in a new Epoch: ${JSON.stringify(immediatelyRecovered.run)}`)
  }
  const replayedTask = await recoveredCore.request('tasks.create', taskRequest)
  if (replayedTask.commandId !== taskCommandId
      || replayedTask.payload?.taskId !== taskId) {
    throw new Error(`Task command replay changed its durable result: ${JSON.stringify(replayedTask)}`)
  }
  const finalSnapshot = await recoveredCore.request('camps.snapshot', { campId })
  const finalRun = finalSnapshot.agentRuns.find((candidate) => candidate.id === agentRunId)
  const finalManifest = finalSnapshot.contextManifests.find((candidate) =>
    candidate.agentRunId === agentRunId
  )
  if (finalSnapshot.agentRuns.length !== 1
      || finalSnapshot.turns.length !== 1
      || finalSnapshot.tasks.length !== 1
      || finalSnapshot.tasks[0].id !== taskId
      || finalSnapshot.inboxMessages.length !== 0) {
    throw new Error(`Recovered Camp contains duplicated objects: ${JSON.stringify(finalSnapshot)}`)
  }
  if (finalManifest?.id !== manifestId
      || finalManifest.delivery?.executionEpoch !== originalEpoch
      || finalManifest.delivery?.status !== 'accepted') {
    throw new Error(`Frozen accepted input was not preserved for reconciliation: ${JSON.stringify({
      manifestId,
      finalManifest,
      finalRun
    })}`)
  }
  if (finalSnapshot.actions.some((action) => action.status === 'unknown')) {
    throw new Error(`Recovery left an unknown action outcome: ${JSON.stringify(finalSnapshot.actions)}`)
  }

  const restarted = startCore(dataDir)
  await restarted.request('health.check')
  const afterSecondRestart = await restarted.request('camps.snapshot', { campId })
  await restarted.stop()
  if (afterSecondRestart.agentRuns.length !== 1
      || afterSecondRestart.messages.length !== finalSnapshot.messages.length
      || afterSecondRestart.contextManifests.length !== 1
      || afterSecondRestart.tasks.length !== 1
      || afterSecondRestart.tasks[0].id !== taskId
      || afterSecondRestart.agentRuns[0].status !== 'waiting'
      || afterSecondRestart.agentRuns[0].executionEpoch !== originalEpoch) {
    throw new Error(`A clean second restart duplicated durable state: ${JSON.stringify({
      before: finalSnapshot,
      after: afterSecondRestart
    })}`)
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    adapterKind,
    runtimeVersion,
    campId,
    agentRunId,
    originalExecutionEpoch: originalEpoch,
    recoveredExecutionEpoch: finalRun.executionEpoch,
    acceptedInputHeldForReconciliation: true,
    contextManifestPreserved: true,
    taskId,
    taskCommandReplayStable: true,
    duplicateAgentRuns: 0,
    duplicateTasks: 0,
    duplicateInboxMessages: 0,
    cleanSecondRestart: true
  }, null, 2)}\n`)
} finally {
  if (firstCore) await firstCore.stop()
  if (recoveredCore) await recoveredCore.stop()
  await rm(fixtureRoot, { recursive: true, force: true })
}

function startCore(dataDirectory) {
  const child = spawn(join(root, 'target', 'debug', 'rovai-core'), ['--data-dir', dataDirectory], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const events = []
  const pending = new Map()
  let nextId = 1
  let shuttingDown = false
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk)
    process.stderr.write(chunk)
  })
  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  child.once('error', rejectPending)
  child.once('close', (code, signal) => {
    if (!shuttingDown) {
      rejectPending(new Error(`rovai-core exited early (code=${code}, signal=${signal})`))
    }
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
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
    }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
  const waitForExit = () => new Promise((resolveExit) => child.once('close', resolveExit))
  const stop = async () => {
    if (child.exitCode !== null) return
    shuttingDown = true
    child.stdin.end()
    await Promise.race([waitForExit(), wait(5_000)])
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  const crash = async () => {
    if (child.exitCode !== null) return
    shuttingDown = true
    child.kill('SIGKILL')
    await waitForExit()
    rejectPending(new Error('rovai-core was killed for recovery smoke'))
  }
  return {
    events,
    get stderr() { return stderr },
    request,
    stop,
    crash
  }
}

async function configureRuntime(request, _health, targetAgentProfileId, targetAdapterKind) {
  const installation = await configureProductRuntime(
    request,
    targetAdapterKind,
    [targetAgentProfileId]
  )
  return installation.snapshot.reportedVersion
}

function failOnApproval(snapshot) {
  const approval = snapshot.approvals.find((candidate) => candidate.status === 'pending')
  if (approval) throw new Error(`Recovery smoke unexpectedly requested approval: ${JSON.stringify(approval)}`)
}

async function git(args, cwd) {
  await new Promise((resolveGit, rejectGit) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stderr = []
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)))
    child.once('error', rejectGit)
    child.once('close', (code) => code === 0
      ? resolveGit()
      : rejectGit(new Error(`git failed (${code}): ${stderr.join('')}`)))
  })
}

async function waitFor(probe, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const result = await probe()
      if (result) return result
    } catch (error) {
      lastError = error
      break
    }
    await wait(250)
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`)
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}
