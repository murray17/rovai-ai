import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { configureProductRuntime } from './configure-product-runtime.mjs'
import { createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'

// Opt-in real Runtime acceptance. HOME must belong to an isolated test account
// with its own native CLI configuration. Credentials are never printed.
const [packageArgument, kind, fixtureArgument] = process.argv.slice(2)
assert.ok(['codex-cli', 'claude-code-cli', 'pi', 'opencode-cli', 'copilot-cli', 'kiro-cli', 'qoder-cli', 'codebuddy-cli', 'qwen-code', 'trae-cn-cli', 'kimi-code-cli', 'grok-build', 'zcode-app', 'antigravity-app'].includes(kind), 'Select an admitted Linux Runtime')
assert.ok(isAbsolute(packageArgument) && isAbsolute(fixtureArgument), 'Package and fixture must be absolute')
const packageRoot = resolve(packageArgument), fixture = resolve(fixtureArgument)
const data = join(fixture, 'data'), project = join(fixture, 'project')
const reportPath = join(fixture, 'result.json')
const manifest = JSON.parse(await readFile(join(packageRoot, 'manifest.json'), 'utf8'))
await mkdir(fixture, { recursive: false, mode: 0o700 })
await mkdir(project, { mode: 0o700 })
await writeFile(join(project, 'README.md'), '# Isolated Linux Server Runtime acceptance\n')
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
execFileSync('git', ['add', 'README.md'], { cwd: project })
execFileSync('git', ['-c', 'user.name=Rovai acceptance', '-c', 'user.email=acceptance@rovai.local', 'commit', '-qm', 'fixture'], { cwd: project })
const binary = join(packageRoot, 'rovai-server')
let child, origin, session, closed, output = ''
const checks = [], runFacts = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = { schemaVersion: 1, gate: 'runtime_integration_probe', runtime: kind,
  sourceCommit: manifest.commit, fullQualification: false, dataDir: data,
  skillLibraryRoot: join(data, 'skills'), mcpConfigPath: join(data, 'mcp.json'), checks, runs: runFacts }
console.log(JSON.stringify({ channel: 'automatic_acceptance', ...report }))

async function start() {
  output = ''
  child = spawn(binary, ['--data-dir', data, '--listen', '127.0.0.1:0'], { cwd: fixture, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  const collect = bytes => { output = (output + bytes).slice(-12000) }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const match = /Address\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match) { origin = match[1]; return }
    assert.equal(child.exitCode, null, 'Server exited before readiness')
    await pause(100)
  }
  throw new Error('Server readiness timed out')
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
  try { assert.deepEqual(await closed, { code: 0, signal: null }) } finally { clearTimeout(timer) }
}
async function request(operation, params = {}) {
  const deadline = Date.now() + 45000
  for (;;) {
    const response = await fetch(origin + '/api/v1/request', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session }, body: JSON.stringify({ operation, params }), signal: AbortSignal.timeout(20000) })
    assert.equal(response.status, 200, `${operation} HTTP status`)
    const result = await response.json()
    if (result.error?.code === 'subsystem_unavailable' && Date.now() < deadline) { await pause(200); continue }
    if (result.error) throw new Error(`${operation}: ${result.error.code}`)
    return result.result
  }
}
async function execution(threadId, agentRunId) {
  const page = await request('agentRunExecution.page', { threadId, agentRunId, limit: 96 })
  return [...page.evidence, ...(page.activeEvidence ?? [])]
}
async function fixtureProcesses(program) {
  const matches = []
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      if ((await stat(`/proc/${pid}`)).uid !== process.getuid()) continue
      const argv = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0')
      if (argv.includes(program)) matches.push(Number(pid))
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'ESRCH'].includes(error.code)) throw error
    }
  }
  return matches
}
async function send(threadId, body) {
  const draft = await request('camp.composerDraft.get', { threadId })
  const saved = await request('camp.composerDraft.save', { threadId, expectedRevision: draft.revision, content: { version: 2, segments: [{ kind: 'text', text: body }] } })
  const sent = await request('camp.messages.send', { commandId: randomUUID(), threadId, draftRevision: saved.revision, execution: { taskId: null, purpose: 'Linux Server Runtime acceptance', completionRole: 'required' } })
  assert.equal(sent.commandResult?.status, 'accepted')
  return sent.commandResult.payload.agentRunIds[0]
}
function binding(conversationId) {
  const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout=5000')
    return db.prepare('SELECT native_session_id, native_binding_id, native_binding_generation FROM conversation WHERE id = ?').get(conversationId)
  } finally { db.close() }
}
async function waitRun(threadId, id, marker) {
  const deadline = Date.now() + 150000
  while (Date.now() < deadline) {
    const camp = await request('camps.open', { threadId, traceId: randomUUID() })
    const run = camp.agentRuns.find(run => run.id === id)
    if (run && ['failed', 'cancelled', 'interrupted', 'rejected'].includes(run.status)) {
      report.failedRun = run
      throw new Error(`Runtime run ${run.status}: ${run.failureCode ?? run.errorCode ?? 'see private fixture'}`)
    }
    if (run?.status === 'succeeded') {
      assert.ok(camp.messages.some(message => message.sourceAgentRunId === id && message.body.includes(marker)), 'Runtime final marker must be publicly projected')
      const native = binding(run.conversationId)
      assert.ok(native?.native_session_id && native?.native_binding_id, 'Successful run must own a native binding')
      runFacts.push({ id, status: run.status, conversationId: run.conversationId, nativeBinding: native })
      return { camp, run }
    }
    await pause(500)
  }
  throw new Error('Runtime execution timed out')
}
try {
  await start()
  const administrator = (await readFile(join(data, 'server-token'), 'utf8')).trim()
  const login = await fetch(origin + '/api/v1/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 3, administratorToken: administrator }) })
  assert.equal(login.status, 200); session = (await login.json()).token
  await request('health.check')
  // An explicitly selected native account can be used without copying its
  // credentials into the fixture or exposing unrelated CLIs through host HOME.
  if (process.env.ROVAI_ACCEPTANCE_NATIVE_HOME) {
    const nativeHome = process.env.ROVAI_ACCEPTANCE_NATIVE_HOME
    const programPath = process.env.ROVAI_ACCEPTANCE_RUNTIME_BIN
    assert.ok(isAbsolute(nativeHome) && programPath && isAbsolute(programPath))
    const startup = await request('runtime.startup.get', { runtimeKind: kind })
    await request('runtime.startup.save', { runtimeKind: kind, expectedRevision: startup.revision,
      configuration: { programPath, environment: [{ name: 'HOME', value: nativeHome }] } })
  }
  const checkedRequest = async (operation, params) => {
    const result = await request(operation, params)
    if (operation === 'runtime.product.check' && result.outcome === 'stable_failure' && kind !== 'trae-cn-cli') {
      const health = await request('health.check')
      // Keep native diagnostics private; the public report only names the gate.
      await writeFile(join(fixture, 'runtime-check.private.json'), JSON.stringify(health, null, 2), { mode: 0o600 })
      throw new Error('Native Runtime availability check returned stable_failure; see private diagnostic')
    }
    return result
  }
  const installation = await configureProductRuntime(checkedRequest, kind, ['agent_2'])
  report.runtimeVersion = installation.snapshot.reportedVersion
  report.admission = installation.platformAdmission ?? null
  const profile = await request('members.get', { agentId: 'agent_2' })
  const values = installation.memberRuntimeDefaults.permissions.values
  const configured = await request('members.runtime.set', { commandId: randomUUID(), command: { agentId: 'agent_2', expectedVersion: profile.version, adapterKind: kind, model: profile.runtimeConfiguration.model, permissions: { adapterKind: kind, schemaVersion: 1, values } } })
  assert.equal(configured.status, 'applied')
  checks.push('native_discovery_auth_model_and_permissions')
  const marker = 'ROVAI_SERVER_' + randomUUID().replaceAll('-', '')
  const workspace = await request('workspaces.inspect', { path: project })
  const first = await createConfiguredCampAndSend(request, { commandId: randomUUID(), name: 'Linux Runtime acceptance', workspace, memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', body: `Use tools to write runtime-marker.txt in the current workspace with the single line ${marker}, then read it back. Reply with ${marker}. Do not read files outside this workspace.`, purpose: 'Linux Server tool execution' })
  assert.equal(first.status, 'accepted')
  const threadId = first.payload.threadId
  const one = await waitRun(threadId, first.payload.agentRunIds[0], marker)
  assert.equal((await readFile(join(project, 'runtime-marker.txt'), 'utf8')).trim(), marker)
  const firstEvidence = await execution(threadId, one.run.id)
  assert.ok(firstEvidence.some(item => ['command', 'tool_call', 'tool_result', 'file_change'].includes(item.kind)), 'Native tools must appear in the public execution projection')
  report.toolEvidence = firstEvidence.filter(item => item.canonical).map(item => ({ kind: item.kind, phase: item.phase, toolName: item.canonical.toolName, outcome: item.canonical.outcome }))
  checks.push('http_send_native_tool_write_read_and_final_projection')
  await waitRun(threadId, await send(threadId, 'Repeat the exact marker from your previous response. Do not use tools.'), marker)
  assert.equal(runFacts[1].conversationId, runFacts[0].conversationId)
  assert.deepEqual(runFacts[1].nativeBinding, runFacts[0].nativeBinding)
  checks.push('warm_conversation_continuation')
  await stop(); await start()
  await waitRun(threadId, await send(threadId, 'Repeat the exact marker from this conversation again. Do not use tools.'), marker)
  assert.equal(runFacts[2].conversationId, runFacts[0].conversationId)
  assert.deepEqual(runFacts[2].nativeBinding, runFacts[0].nativeBinding)
  checks.push('server_restart_persisted_auth_and_cold_conversation_continuation')
  const publicMarker = 'ROVAI_BUILTIN_' + randomUUID().replaceAll('-', '')
  const builtin = await waitRun(threadId, await send(threadId, `Use the built-in rovai CLI to send a public Camp message containing exactly ${publicMarker}. Follow the CLI instructions already provided by Rovai. Do not write workspace files. A plain final answer alone is insufficient for this test.`), publicMarker)
  const builtinEvidence = await execution(threadId, builtin.run.id)
  assert.ok(builtinEvidence.some(item => ['command', 'tool_call', 'tool_result'].includes(item.kind) && JSON.stringify(item.payload).includes('rovai')), 'Built-in public send must have native CLI execution evidence')
  checks.push('builtin_cli_public_camp_message')
  // Observe a real, uniquely identifiable child. Some native tools prohibit a
  // standalone sleep, and some ACP versions expose command input only at the
  // terminal update. Neither is evidence that HTTP cancellation failed.
  const cancelProgram = join(project, 'cancel-probe.py')
  const cancelStarted = join(project, 'cancel-started.txt')
  const cancelFinished = join(project, 'cancel-finished.txt')
  await writeFile(cancelProgram, `import pathlib, time\np = pathlib.Path(__file__).parent\n(p / 'cancel-started.txt').write_text('started')\ntime.sleep(120)\n(p / 'cancel-finished.txt').write_text('unexpected completion')\n`)
  const cancelId = await send(threadId, `Run python3 ${JSON.stringify(cancelProgram)} with your shell tool in the foreground, with a timeout of at least 150 seconds. This is an intentional process cancellation test. Do not modify the program, run it in the background, or reply until it finishes.`)
  const deadline = Date.now() + 60000
  let cancelRun, toolStarted = false
  while (Date.now() < deadline) {
    const camp = await request('camps.open', { threadId, traceId: randomUUID() }); cancelRun = camp.agentRuns.find(run => run.id === cancelId)
    if (cancelRun?.status === 'running') {
      const evidence = await execution(threadId, cancelId)
      const activeTool = evidence.some(item => ['command', 'tool_call'].includes(item.kind))
      const processIds = await fixtureProcesses(cancelProgram)
      const started = await readFile(cancelStarted, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      toolStarted = activeTool && processIds.length > 0 && started === 'started'
      if (toolStarted) report.cancellation = { nativeToolObserved: true, childProcessObserved: true,
        commandInputProjected: evidence.some(item => JSON.stringify(item.payload).includes(cancelProgram)) }
      if (toolStarted) break
    }
    assert.ok(!cancelRun || !['succeeded', 'failed', 'cancelled'].includes(cancelRun.status), 'Cancellable tool must still be active')
    await pause(250)
  }
  assert.equal(cancelRun?.status, 'running')
  assert.ok(toolStarted, 'Cancel only after both native tool evidence and the real fixture child are observed')
  const cancel = await request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId, agentRunId: cancelId, expectedVersion: cancelRun.version } })
  assert.notEqual(cancel.status, 'rejected')
  for (let i = 0; i < 80; i++) {
    cancelRun = (await request('camps.open', { threadId, traceId: randomUUID() })).agentRuns.find(run => run.id === cancelId)
    if (cancelRun.status === 'cancelled') break
    await pause(250)
  }
  assert.equal(cancelRun.status, 'cancelled')
  for (let i = 0; i < 40 && (await fixtureProcesses(cancelProgram)).length; i++) await pause(250)
  assert.deepEqual(await fixtureProcesses(cancelProgram), [], 'Cancellation must reap the fixture child')
  assert.equal(await readFile(cancelFinished, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return null
    throw error
  }), null, 'Cancelled child must not finish its delayed write')
  report.cancellation.childReaped = true
  checks.push('http_cancel_active_native_tool')
  await stop(); report.status = 'passed'
} catch (error) {
  report.status = 'failed'; report.error = error.message
  process.exitCode = 1
} finally {
  try { await stop() } catch (error) { report.shutdownError = error.message; report.status = 'failed'; process.exitCode = 1 }
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  // Failed Run details remain private until explicitly sanitized for evidence.
  const { failedRun, ...safe } = report
  console.log(JSON.stringify(safe))
}
