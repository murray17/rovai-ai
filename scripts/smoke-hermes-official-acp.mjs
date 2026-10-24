// Opt-in acceptance of unmodified `hermes acp` + a private official Gateway.
// Uses a controlled loopback model, real native tools, and dummy environment
// markers. No Core, daily Home, real credential or managed host.py is used.
// ROVAI_HERMES_BIN=/absolute/path/to/hermes node scripts/smoke-hermes-official-acp.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFile, writeFile, realpath, stat, unlink, mkdtemp, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { processTable, descendantsOf, waitForProcessesToExit } from './lib/qualification-core.mjs'

assert(process.platform !== 'win32', 'This process-group probe currently qualifies POSIX only')
const root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermes-official-'))), home = join(root, 'home'), project = join(root, 'project')
await mkdir(home, { mode: 0o700 }); await mkdir(project, { mode: 0o700 })
const hermes = process.env.ROVAI_HERMES_BIN
assert(hermes, 'Set ROVAI_HERMES_BIN to the official Hermes executable')
const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
Object.assign(env, { HERMES_HOME: home, ROVAI_HERMES_FIXTURE_KEY: 'controlled-fixture' })
const pause = ms => new Promise(done => setTimeout(done, ms))
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await pause(100) }
  throw new Error(`Timed out: ${label}`)
}
const wire = [], queue = [], children = [], results = {}, events = [], gatewayEvents = []
let modelIndex = 0, modelError = false, holdNext = false, release, serverError
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] })); return
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    if (!Array.isArray(body.input)) { response.end('{}'); return }
    wire.push(body)
    const isAgent = (body.tools ?? []).length > 0
    if (holdNext && isAgent) { holdNext = false; await new Promise(done => { release = done }) }
    if (modelError && isAgent) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Model invalid-hermes-model does not exist', type: 'invalid_request_error', code: 'model_not_found' } })); return
    }
    const next = isAgent ? queue.shift() : undefined, index = ++modelIndex, id = `response-${index}`
    const items = next ? next.map((call, n) => ({ type: 'function_call', id: `fc-${index}-${n}`, call_id: `call-${index}-${n}`, name: call.name, arguments: JSON.stringify(call.args), status: 'completed' })) : [{ type: 'message', id: `message-${index}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OFFICIAL_ACP_OK', annotations: [] }] }]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    let sequence = 0
    const emit = event => response.write('data: ' + JSON.stringify({ ...event, sequence_number: sequence++ }) + '\n\n')
    emit({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
    for (const [output_index, item] of items.entries()) {
      emit({ type: 'response.output_item.added', output_index, item })
      emit({ type: 'response.output_item.done', output_index, item })
    }
    emit({ type: 'response.completed', response: { id, status: 'completed', output: items, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } })
    response.end()
  } catch (error) { serverError = String(error); response.writeHead(500); response.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const config = { model: { provider: 'fixture', default: 'fixture-model' },
  providers: { fixture: { base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key_env: 'ROVAI_HERMES_FIXTURE_KEY', transport: 'codex_responses', models: ['fixture-model'] } },
  platform_toolsets: { acp: ['terminal', 'file', 'no_mcp'] },
  agent: { max_turns: 12, disabled_toolsets: ['clarify'], reasoning_effort: 'low' },
  terminal: { backend: 'local', env_passthrough: ['ROVAI_CONTEXT'], client_env_passthrough: ['ROVAI_CONTEXT'] },
  session_title: { enabled: false }, compression: { enabled: false } }
await writeFile(join(home, 'config.yaml'), JSON.stringify(config), { mode: 0o600 })

function start(args, name, extras = {}, command = hermes, prefix = ['--profile', 'default']) {
  const child = spawn(command, [...prefix, ...args], { cwd: project, env: { ...env, ...extras }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const entry = { child, name, stderr: '', stdout: '', closed: false }
  child.stderr.on('data', c => { entry.stderr = (entry.stderr + c).slice(-100000) })
  child.stdout.on('data', c => { entry.stdout = (entry.stdout + c).slice(-100000) })
  entry.done = new Promise(done => child.once('close', (code, signal) => { entry.closed = true; entry.exit = { code, signal }; done(entry.exit) }))
  children.push(entry); return entry
}
async function stop(entry) {
  if (!entry || entry.closed) return entry?.exit
  entry.child.stdin.end()
  await Promise.race([entry.done, pause(1500)])
  if (!entry.closed) { try { process.kill(-entry.child.pid, 'SIGTERM') } catch {} }
  await Promise.race([entry.done, pause(6000)])
  if (!entry.closed) { try { process.kill(-entry.child.pid, 'SIGKILL') } catch {} }
  return await entry.done
}
async function acp(name, marker) {
  const entry = start(['acp'], name, { HERMES_EPHEMERAL_SYSTEM_PROMPT: `VIEWER-BOOT-${marker}`, ROVAI_CONTEXT: `VIEWER-CONTEXT-${marker}` })
  let sequence = 0
  const pending = new Map()
  createInterface({ input: entry.child.stdout }).on('line', line => {
    let message; try { message = JSON.parse(line) } catch { return }
    events.push({ viewer: name, ...message })
    if (message.method && message.id !== undefined) {
      const option = message.params?.options?.find(o => o.kind === 'allow_once')
      entry.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(message.method === 'session/request_permission' && option
        ? { result: { outcome: { outcome: 'selected', optionId: option.optionId } } }
        : { error: { code: -32601, message: 'Unsupported acceptance client method' } }) }) + '\n'); return
    }
    const waiter = pending.get(message.id); if (!waiter) return
    clearTimeout(waiter.timer); pending.delete(message.id)
    if (message.error) waiter.reject(Object.assign(new Error(message.error.message), { rpcError: message.error }))
    else waiter.resolve(message.result)
  })
  entry.child.once('exit', () => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`ACP viewer ${name} exited`)) }; pending.clear() })
  entry.request = (method, params = {}, timeout = 90000) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout ${method}`)) }, timeout)
    pending.set(id, { resolve, reject, timer })
    entry.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  entry.notify = (method, params) => entry.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  entry.initialize = await entry.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'rovai-official-entry-probe', version: '1' } })
  return entry
}
function capture(error) { return error.rpcError ?? { message: error.message } }
function systemText(body) { return [body.instructions ?? '', ...body.input.filter(i => ['system', 'developer'].includes(i.role)).map(i => JSON.stringify(i.content))].join('\n') }
const prompt = (client, sessionId, text) => client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
async function rpcClient(name = 'gateway-rpc') {
  const command = JSON.parse(execFileSync(hermes, ['--print-runtime-command'], { env, encoding: 'utf8' }))
  const entrypoint = "runpy.run_module('hermes_cli.main', run_name='__main__', alter_sys=True)"
  assert(command.length === 4 && command[3].endsWith(entrypoint), 'Unknown installation bootstrap')
  command[3] = command[3].slice(0, -entrypoint.length) + "runpy.run_path(sys.argv[1], run_name='__main__')"
  // Only the RPC test client uses the installation's interpreter/bootstrap. The
  // actual Gateway and ACP under test always use their public CLI entry points.
  const child = start([...command.slice(1), resolve(import.meta.dirname, 'lib/hermes-gateway-rpc-probe.py')], name, {}, command[0], [])
  let sequence = 0
  const pending = new Map()
  createInterface({ input: child.child.stdout }).on('line', line => {
    const message = JSON.parse(line)
    if (message.method === 'gateway/event') { gatewayEvents.push(message.params); return }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id); clearTimeout(waiter.timer)
    message.error ? waiter.reject(Object.assign(new Error(message.error.message), { rpcError: message.error })) : waiter.resolve(message.result)
  })
  child.request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); child.child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
  })
  return child
}
async function settled(rpc, sessionId, admissionId) {
  return await until(async () => {
    const receipt = await rpc.request('prompt.receipt', { session_id: sessionId, admission_id: admissionId, include_result: true })
    return receipt.status === 'terminal' ? receipt : null
  }, 'exact admission terminal')
}
let gateway, client
try {
  const prepare = start(['pm', 'repair'], 'prepare')
  prepare.child.stdin.end()
  assert.equal((await prepare.done).code, 0, 'Official dependency preparation failed; see prepare.log')
  for (const file of ['cancel.pid', 'detached.pid']) await unlink(join(project, file)).catch(e => { if (e.code !== 'ENOENT') throw e })
  console.log('Official-entry automatic acceptance:', root)
  gateway = start(['gateway', 'run', '--force', '--no-supervise', '--external-supervisor'], 'gateway', { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'GATEWAY-BOOT-A', ROVAI_CONTEXT: 'GATEWAY-CONTEXT-A' })
  const lock = await until(async () => {
    if (gateway.closed) throw new Error(`Gateway exited: ${gateway.stderr.slice(-4000)} ${gateway.stdout.slice(-4000)}`)
    try { const record = JSON.parse(await readFile(join(home, 'gateway.lock'), 'utf8')); return record.pid === gateway.child.pid ? record : null } catch { return null }
  }, 'owned Gateway lock')
  assert.equal(await realpath(lock.hermes_home), home)
  results.gatewayOwnership = { requestedPid: gateway.child.pid, actualPid: lock.pid, homeMatches: true }
  console.log('Dedicated Gateway started:', JSON.stringify(results.gatewayOwnership))
  client = await acp('viewer-A', 'A')
  results.initialize = client.initialize
  const session = await client.request('session/new', { cwd: project, mcpServers: [] }), sessionId = session.sessionId
  results.sessionId = sessionId
  await client.request('session/set_mode', { sessionId, modeId: 'dont_ask' })
  queue.push([{ name: 'terminal', args: { command: 'printf "%s" "$ROVAI_CONTEXT" > context-a.txt', timeout: 10 } }])
  results.firstPrompt = await prompt(client, sessionId, 'Execute this controlled native fixture.')
  results.firstBinding = { gatewaySystem: systemText(wire[0]).includes('GATEWAY-BOOT-A'), viewerSystem: systemText(wire[0]).includes('VIEWER-BOOT-A'), terminalContext: await readFile(join(project, 'context-a.txt'), 'utf8'), reasoningEffort: wire[0].reasoning?.effort }
  console.log('First official turn:', JSON.stringify(results.firstBinding))
  await stop(client)
  client = await acp('viewer-B', 'B')
  results.resume = await client.request('session/load', { sessionId, cwd: project, mcpServers: [] })
  const warmStart = wire.length
  queue.push([{ name: 'terminal', args: { command: 'printf "%s" "$ROVAI_CONTEXT" > context-b.txt', timeout: 10 } }])
  results.warmPrompt = await prompt(client, sessionId, 'Execute the second controlled native fixture.')
  results.warmBinding = { gatewaySystem: systemText(wire[warmStart]).includes('GATEWAY-BOOT-A'), viewerBSystem: systemText(wire[warmStart]).includes('VIEWER-BOOT-B'), terminalContext: await readFile(join(project, 'context-b.txt'), 'utf8') }
  console.log('Reattached official turn:', JSON.stringify(results.warmBinding))
  results.effortReply = await client.request('session/set_config_option', { sessionId, configId: 'reasoning_effort', value: 'high' }).catch(capture)
  await prompt(client, sessionId, 'Report readiness.')
  results.effortOnWire = wire.at(-1).reasoning?.effort
  results.slashReasoning = await prompt(client, sessionId, '/reasoning high')
  await prompt(client, sessionId, 'Report after the native reasoning command.')
  results.slashEffortOnWire = wire.filter(body => (body.tools ?? []).length).at(-1)?.reasoning?.effort
  results.questionnaireAdvertised = wire.some(body => (body.tools ?? []).some(tool => /ask_user|clarify/.test(tool.name ?? '')))
  const missing = await client.request('session/load', { sessionId: 'rovai-does-not-exist-971e', cwd: project, mcpServers: [] }).catch(capture)
  results.missingResume = missing
  console.log('Config and exact resume:', JSON.stringify({ effort: results.effortOnWire, missingResume: missing, questionnaire: results.questionnaireAdvertised }))
  holdNext = true
  const steerStart = wire.length
  const active = prompt(client, sessionId, 'Begin active steer fixture.'); active.catch(() => {})
  await until(() => release, 'held model request')
  results.activeSteer = await prompt(client, sessionId, '/steer OFFICIAL-STEER-ACTIVE-9932')
  release(); release = null
  results.steerPrompt = await active
  results.activeSteerReachedModel = wire.slice(steerStart + 1).some(body => JSON.stringify(body).includes('OFFICIAL-STEER-ACTIVE-9932'))
  const idleStart = wire.length
  results.idleSteer = await prompt(client, sessionId, '/steer OFFICIAL-STEER-LATE-9932')
  results.idleSteerStartedModelTurn = wire.length > idleStart
  console.log('Official slash steer:', JSON.stringify({ activeReachedModel: results.activeSteerReachedModel, idleStartedModelTurn: results.idleSteerStartedModelTurn }))
  queue.push([{ name: 'terminal', args: { command: `python3 -c "import os,time;open('cancel.pid','w').write(str(os.getpid()));time.sleep(120)"`, timeout: 150 } }])
  const cancelPrompt = prompt(client, sessionId, 'Run the cancellable terminal fixture.'); cancelPrompt.catch(() => {})
  await until(() => stat(join(project, 'cancel.pid')).catch(() => null), 'cancellable terminal start')
  const cancelPid = Number(await readFile(join(project, 'cancel.pid'), 'utf8'))
  results.cancelWorkerPid = cancelPid
  client.notify('session/cancel', { sessionId })
  results.cancel = await cancelPrompt
  await pause(500)
  let alive = true; try { process.kill(cancelPid, 0) } catch { alive = false }
  results.cancelTerminalStillAlive = alive
  console.log('Official cancellation:', JSON.stringify({ response: results.cancel, terminalStillAlive: alive }))
  queue.push([{ name: 'terminal', args: { command: `python3 -c "import os,time;open('detached.pid','w').write(str(os.getpid()));time.sleep(120)"`, timeout: 150 } }])
  const detachedPrompt = prompt(client, sessionId, 'Run the disconnect fixture.'); detachedPrompt.catch(() => {})
  await until(() => stat(join(project, 'detached.pid')).catch(() => null), 'disconnect terminal start')
  const detachedPid = Number(await readFile(join(project, 'detached.pid'), 'utf8'))
  results.detachedWorkerPid = detachedPid
  await stop(client)
  client = await acp('viewer-C', 'C')
  await client.request('session/load', { sessionId, cwd: project, mcpServers: [] })
  client.notify('session/cancel', { sessionId }); await pause(2000)
  let detachedAlive = true; try { process.kill(detachedPid, 0) } catch { detachedAlive = false }
  results.reconnectedCancelTerminalStillAlive = detachedAlive
  console.log('Reconnect cancellation:', JSON.stringify({ terminalStillAlive: detachedAlive }))
  const rpc = await rpcClient()
  results.gatewayDescriptor = await rpc.request('runtime.describe')
  const detachedSnapshot = await rpc.request('session.resume', { session_id: sessionId })
  results.detachedSnapshot = detachedSnapshot
  results.rpcReconnectCancel = await rpc.request('session.interrupt', { session_id: sessionId, execution_generation: detachedSnapshot.execution_generation }).catch(capture)
  await pause(500)
  try { process.kill(detachedPid, 0); results.rpcCancelTerminalStillAlive = true } catch { results.rpcCancelTerminalStillAlive = false }
  console.log('Gateway RPC cancellation:', JSON.stringify({ response: results.rpcReconnectCancel, terminalStillAlive: results.rpcCancelTerminalStillAlive }))
  const createId = `rovai-rpc-${Date.now()}`
  const create = { request_id: createId, source: 'acp', cwd: project, editor: { mcp_servers: [], edit_approval_policy: 'ask' }, client_env: { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'RPC-BOOT-A', ROVAI_CONTEXT: 'RPC-CONTEXT-A' } }
  const rpcSession = await rpc.request('session.create', create), rpcSessionId = rpcSession.session_id
  const rpcWireStart = wire.length
  queue.push([{ name: 'terminal', args: { command: 'printf "%s" "$ROVAI_CONTEXT" > rpc-context.txt', timeout: 10 } }])
  const admission = await rpc.request('prompt.submit', { session_id: rpcSessionId, submission_id: createId + '-prompt', text: 'Run the RPC environment fixture.' })
  results.rpcAdmission = admission
  results.rpcReceipt = await settled(rpc, rpcSessionId, admission.admission_id)
  results.rpcBinding = { rpcSystem: wire.slice(rpcWireStart).some(body => systemText(body).includes('RPC-BOOT-A')), terminalContext: await readFile(join(project, 'rpc-context.txt'), 'utf8') }
  results.rpcChangedCreate = await rpc.request('session.create', { ...create, client_env: { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'RPC-BOOT-B', ROVAI_CONTEXT: 'RPC-CONTEXT-B' } }).catch(capture)
  const snapshot = await rpc.request('session.resume', { session_id: rpcSessionId })
  results.rpcEnvMutation = await rpc.request('session.mutate', { session_id: rpcSessionId, request_id: createId + '-env', expected_revision: snapshot.revision, expected_generation: snapshot.execution_generation, operation: 'client_env', payload: { client_env: { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'RPC-BOOT-B', ROVAI_CONTEXT: 'RPC-CONTEXT-B' } } }).catch(capture)
  results.rpcReasoningMutation = await rpc.request('session.mutate', { session_id: rpcSessionId, request_id: createId + '-effort', expected_revision: snapshot.revision, expected_generation: snapshot.execution_generation, operation: 'reasoning', payload: { effort: 'high' } }).catch(capture)
  const effortAdmission = await rpc.request('prompt.submit', { session_id: rpcSessionId, submission_id: createId + '-effort-prompt', text: 'Report readiness.' })
  await settled(rpc, rpcSessionId, effortAdmission.admission_id)
  results.rpcEffortOnWire = wire.filter(body => (body.tools ?? []).length).at(-1)?.reasoning?.effort
  const lateWireStart = wire.length
  results.rpcLateSteer = await rpc.request('session.steer', { session_id: rpcSessionId, execution_generation: results.rpcReceipt.execution_generation, text: 'LATE-RPC-STEER' }).catch(capture)
  await pause(200)
  results.rpcLateSteerStartedModel = wire.length > lateWireStart
  console.log('Gateway RPC alternatives:', JSON.stringify({ binding: results.rpcBinding, changedCreate: results.rpcChangedCreate, envMutation: results.rpcEnvMutation, effort: results.rpcEffortOnWire, lateSteer: results.rpcLateSteer, lateStartedModel: results.rpcLateSteerStartedModel }))
  // A fresh session permits the provider-error probe without queueing behind a surviving turn.
  const errorSession = await client.request('session/new', { cwd: project, mcpServers: [] })
  modelError = true
  results.providerError = await prompt(client, errorSession.sessionId, 'Exercise invalid model failure.').catch(capture)
  console.log('Provider error:', JSON.stringify(results.providerError))
  results.providerDetailVisible = events.some(event => JSON.stringify(event).includes('Model invalid-hermes-model does not exist'))
  modelError = false
  await stop(rpc); await stop(client); await stop(gateway)
  const restartAt = Date.now()
  gateway = start(['gateway', 'run', '--force', '--no-supervise', '--external-supervisor'], 'gateway-restarted', { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'GATEWAY-BOOT-B', ROVAI_CONTEXT: 'GATEWAY-CONTEXT-B' })
  await until(async () => {
    if (gateway.closed) throw new Error('Restarted owner exited')
    try { const lock = JSON.parse(await readFile(join(home, 'gateway.lock'), 'utf8')); return lock.pid === gateway.child.pid && await realpath(lock.hermes_home) === home } catch { return false }
  }, 'restarted dedicated Gateway')
  client = await acp('viewer-D', 'D')
  results.coldResume = await client.request('session/load', { sessionId, cwd: project, mcpServers: [] })
  results.coldReadyMs = Date.now() - restartAt
  const coldWireStart = wire.length
  queue.push([{ name: 'terminal', args: { command: 'printf "%s" "$ROVAI_CONTEXT" > context-cold.txt', timeout: 10 } }])
  await prompt(client, sessionId, 'Verify cold resumed native session identity and current environment.')
  results.coldBinding = { newGatewaySystem: wire.slice(coldWireStart).some(body => systemText(body).includes('GATEWAY-BOOT-B')), oldGatewaySystem: wire.slice(coldWireStart).some(body => systemText(body).includes('GATEWAY-BOOT-A')), terminalContext: await readFile(join(project, 'context-cold.txt'), 'utf8'), sameSession: results.coldResume._meta?.hermes?.sessionProvenance?.acpSessionId === sessionId }
  console.log('Official Gateway restart workaround:', JSON.stringify({ ...results.coldBinding, readyMs: results.coldReadyMs }))
  // Capture native successful edit events separately from the managed bridge's
  // executor evidence; previews are not assumed to prove a complete old file.
  const fileRpc = await rpcClient('gateway-rpc-files')
  await fileRpc.request('session.resume', { session_id: sessionId })
  const editStart = events.length, nativeEditStart = gatewayEvents.length, edited = join(project, 'official-diff.txt')
  queue.push([{ name: 'write_file', args: { path: edited, content: 'alpha\n' } }],
    [{ name: 'write_file', args: { path: edited, content: 'beta\n' } }],
    [{ name: 'patch', args: { path: edited, old_string: 'beta', new_string: 'gamma' } }])
  await prompt(client, sessionId, 'Run the native file edit evidence fixture.')
  assert.equal(await readFile(edited, 'utf8'), 'gamma\n')
  results.nativeFileUpdates = events.slice(editStart).filter(event => ['tool_call', 'tool_call_update'].includes(event.params?.update?.sessionUpdate)).map(event => event.params.update)
  await fileRpc.request('session.resume', { session_id: sessionId })
  results.gatewayFileEvents = gatewayEvents.slice(nativeEditStart).filter(event => /tool\.complete|inline_diff/.test(JSON.stringify(event)))
  // Keep observed blockers as evidence, but fail the harness when a claimed
  // working path is not actually exercised. Future fixes may change blockers.
  assert.equal(results.firstPrompt.stopReason, 'end_turn')
  assert.equal(results.cancel.stopReason, 'cancelled')
  assert.equal(results.cancelTerminalStillAlive, false)
  assert.equal(results.rpcCancelTerminalStillAlive, false)
  assert.equal(results.rpcBinding.rpcSystem, true)
  assert.equal(results.rpcBinding.terminalContext, 'RPC-CONTEXT-A')
  assert.equal(results.rpcEffortOnWire, 'high')
  assert.equal(results.slashEffortOnWire, 'high')
  assert.equal(results.rpcLateSteerStartedModel, false)
  assert.equal(results.providerDetailVisible, true)
  assert.deepEqual(results.coldBinding, { newGatewaySystem: true, oldGatewaySystem: false, terminalContext: 'GATEWAY-CONTEXT-B', sameSession: true })
  if (serverError) throw new Error(serverError)
} catch (error) { results.failure = capture(error); console.error('Probe failure:', JSON.stringify(results.failure)); process.exitCode = 1 }
finally {
  release?.()
  const table = await processTable()
  const owned = children.filter(entry => !entry.closed).flatMap(entry => [entry.child.pid, ...descendantsOf(table, entry.child.pid)])
  owned.push(...[results.cancelWorkerPid, results.detachedWorkerPid].filter(Number.isInteger))
  for (const entry of [...children].reverse()) { results[`${entry.name}Exit`] = await stop(entry); await writeFile(join(root, `${entry.name}.log`), entry.stderr + '\n' + entry.stdout, { mode: 0o600 }) }
  results.cleanupRemainingPids = await waitForProcessesToExit(owned, 5000)
  if (results.cleanupRemainingPids.length) process.exitCode = 1
  server.closeAllConnections(); await new Promise(done => server.close(done))
  await writeFile(join(root, 'summary.json'), JSON.stringify(results, null, 2), { mode: 0o600 })
  await writeFile(join(root, 'wire.json'), JSON.stringify(wire, null, 2), { mode: 0o600 })
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2), { mode: 0o600 })
  await writeFile(join(root, 'gateway-events.json'), JSON.stringify(gatewayEvents, null, 2), { mode: 0o600 })
  console.log('Saved controlled-probe evidence:', root)
}
