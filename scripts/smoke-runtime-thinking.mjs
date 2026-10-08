// Explicit real-LLM acceptance; never part of ordinary unit tests.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { coreDataDirectoryArguments } from './lib/runtime-camp-files-root.mjs'

const root = resolve(import.meta.dirname, '..')
const adapters = process.argv.slice(2)
if (!adapters.length || adapters.some(kind => !['codex-cli', 'copilot-cli', 'claude-code-cli', 'pi'].includes(kind))) {
  throw Error('Pass one or more runtime kinds: codex-cli copilot-cli claude-code-cli pi')
}
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'rovai-runtime-thinking-')))
const data = join(fixture, 'data'), skills = join(fixture, 'skills'), project = join(fixture, 'project')
await Promise.all([data, skills, project].map(path => mkdir(path)))
await writeFile(join(project, 'input.txt'), 'Numbers: 9 14 17 22 27 31 35 41 46 53 58 64 69 73 81 87\nTarget: 219\n')
await writeFile(join(project, 'check.txt'), 'Check exactly seven distinct numbers and sum 219.\n')
for (const args of [['init', '-b', 'main'], ['config', 'user.name', 'Runtime Thinking Probe'],
  ['config', 'user.email', 'probe@rovai.local'], ['add', '.'], ['commit', '-m', 'isolated fixture']]) {
  execFileSync('git', args, { cwd: project, stdio: 'ignore' })
}
const report = { channel: 'automatic_acceptance', fixture, userData: data, skillLibrary: skills,
  privateFrames: 0, stderrBytes: 0, samples: [] }
console.log(JSON.stringify({ channel: report.channel, fixture, userData: data, skillLibrary: skills }))
const core = spawn(join(root, 'target/debug/rovai-core'), [...coreDataDirectoryArguments(data),
  '--skill-library-root', skills, '--mcp-config-path', join(data, 'mcp.json')], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe']
})
const pending = new Map(), phases = [], snapshots = []
let nextId = 0, threadId = null, closed = false
const closedPromise = new Promise(resolveClose => core.once('close', () => {
  closed = true
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(Error('isolated Core closed')) }
  pending.clear(); resolveClose()
}))
core.stderr.on('data', bytes => { report.stderrBytes += bytes.length })
function request(method, params = {}) {
  return new Promise((resolveRequest, reject) => {
    if (closed) { reject(Error('isolated Core closed')); return }
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`request timeout: ${method}`)) }, 90_000)
    pending.set(id, { resolve: resolveRequest, reject, timer })
    core.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
}
async function configureRuntime(adapterKind) {
  await request('runtime.product.check', { runtimeKind: adapterKind })
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const installation = (await request('runtime.installations.list')).find(candidate =>
      candidate.adapterKind === adapterKind && candidate.installationClass === 'managed_default'
      && candidate.authScope === 'default' && candidate.memberRuntimeDefaults)
    if (!installation) { await new Promise(resolveWait => setTimeout(resolveWait, 250)); continue }
    const profile = await request('members.get', { agentId: 'agent_1' })
    const configured = await request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: 'agent_1', expectedVersion: profile.version, adapterKind,
      model: adapterKind === 'pi' && process.env.ROVAI_THINKING_PI_MODEL
        ? { mode: 'explicit', modelId: process.env.ROVAI_THINKING_PI_MODEL, options: { thinking_level: 'high' } }
        : installation.memberRuntimeDefaults.model,
      permissions: installation.memberRuntimeDefaults.permissions
    } })
    assert.equal(configured.status, 'applied')
    const member = await request('members.get', { agentId: 'agent_1' })
    // Current member readiness deliberately defers native verification until execution.
    assert.equal(member.runtimeConfiguration?.adapterKind, adapterKind)
    assert.ok(['ready', 'light_ready', 'installed_unverified'].includes(member.runtimeReadiness?.status),
      `Runtime unavailable: ${member.runtimeReadiness?.status}`)
    return installation
  }
  throw Error(`Runtime installation not resolved: ${adapterKind}`)
}
createInterface({ input: core.stdout }).on('line', line => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method) {
    if (/^agent\.(thought|reasoning\.summary)\./.test(message.method)) report.privateFrames++
    if (message.method === 'agent_run.runtime_phase_changed') {
      const value = message.params
      phases.push({ run: value.agentRunId, epoch: value.executionEpoch, phase: value.phase,
        titleChars: typeof value.thinkingTitle === 'string' ? [...value.thinkingTitle].length : 0 })
      if (threadId && value.phase === 'thinking') {
        void request('agentRunExecution.page', { threadId, agentRunId: value.agentRunId, projection: 'blocks', limit: 1 })
          .then(page => snapshots.push({ run: value.agentRunId, phase: page.runtimePhase,
            titleChars: typeof page.runtimeThinkingTitle === 'string' ? [...page.runtimeThinkingTitle].length : 0 }))
          .catch(() => {})
      }
    }
    return
  }
  const item = pending.get(message.id)
  if (!item) return
  clearTimeout(item.timer); pending.delete(message.id)
  message.error ? item.reject(Error(`Core request error ${message.error.code}`)) : item.resolve(message.result)
})
try {
  await request('health.check')
  const workspace = await request('workspaces.inspect', { path: project })
  for (const adapter of adapters) {
    const started = Date.now()
    const sample = { adapter, status: 'started' }
    report.samples.push(sample)
    try {
      const installation = await configureRuntime(adapter)
      sample.version = installation.snapshot?.reportedVersion
      console.log(JSON.stringify({ adapter, stage: 'configured' }))
      const created = await createConfiguredCampAndSend(request, { commandId: crypto.randomUUID(), workspace,
        memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', purpose: 'Validate root thinking feedback',
        body: 'This is an isolated read-only acceptance task. Read input.txt with a tool. Find the lexicographically smallest seven-element subset whose sum is the target. Then read check.txt with a tool and verify the answer. Give a concise conclusion. Do not modify files, use the network, delegate, invoke skills or message other members. Publish the final result only to this test Thread when required by the session instructions, and also return a brief final assistant reply.' })
      assert.equal(created.status, 'accepted')
      threadId = created.payload.threadId
      const executionStarted = Date.now()
      let run
      while (Date.now() - executionStarted < 240_000) {
        const snapshot = await request('threads.snapshot', { threadId })
        run = snapshot.agentRuns[0]
        if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) break
        await new Promise(resolveWait => setTimeout(resolveWait, 500))
      }
      sample.status = run?.status ?? 'no_run'
      sample.failureCode = run?.failure?.code ?? null
      sample.phases = phases.filter(value => value.run === run?.id).map(({ run: _, ...value }) => value)
      sample.snapshots = snapshots.filter(value => value.run === run?.id).map(({ run: _, ...value }) => value)
      if (run && !['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        await request('agentRuns.cancel', { commandId: crypto.randomUUID(), command: {
          threadId, agentRunId: run.id, expectedVersion: run.version
        } })
        sample.status = 'timeout'
      }
      if (run && ['succeeded', 'failed', 'cancelled'].includes(run.status)) {
        const page = await request('agentRunExecution.page', { threadId, agentRunId: run.id, projection: 'blocks', limit: 1 })
        sample.terminalPhaseCleared = page.runtimePhase == null && page.runtimeThinkingTitle == null
      }
    } catch (error) {
      sample.status = 'probe_error'; sample.error = String(error.message).slice(0, 160)
    }
    sample.durationMs = Date.now() - started
    console.log(JSON.stringify(sample))
    await writeFile(join(fixture, 'thinking-report.json'), JSON.stringify(report, null, 2))
  }
  assert.equal(report.privateFrames, 0, 'Core exposed private reasoning events')
  assert.ok(report.samples.every(sample => sample.status === 'succeeded' && sample.terminalPhaseCleared),
    'One or more Runtime runs did not pass; inspect the bounded report')
  assert.ok(report.samples.filter(sample => sample.adapter !== 'pi').every(sample =>
    sample.phases.some(value => value.phase === 'thinking')), 'No thinking phase observed for a required Runtime')
} finally {
  core.stdin.end()
  await Promise.race([closedPromise, new Promise(resolveWait => setTimeout(resolveWait, 2_000))])
  if (!closed) core.kill('SIGTERM')
  const timer = setTimeout(() => { if (!closed) core.kill('SIGKILL') }, 10_000)
  await closedPromise; clearTimeout(timer)
  await writeFile(join(fixture, 'thinking-report.json'), JSON.stringify(report, null, 2))
  console.log(`Retained isolated acceptance evidence: ${join(fixture, 'thinking-report.json')}`)
}
