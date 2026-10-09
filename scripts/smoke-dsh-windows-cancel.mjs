// Windows-only isolated Core / real DSH ACP cancellation acceptance.
// Build: cargo build -p rovai-core --features extended-tests --bin rovai-core --bin rovai
// Usage: ROVAI_REPRO_CORE_EXE=<built Core> node scripts/smoke-dsh-windows-cancel.mjs <report.json>
// Default: deterministic loopback Responses fixture; shell/DSH/Core are real.
// ROVAI_REPRO_REMOTE=1 uses the configured Sub2API route and inherited key.
// ROVAI_REPRO_MODEL chooses an available model. ROVAI_REPRO_CASES accepts comma-separated
// normal, cancel, cancel-stop-only, cancel-query-fault, cancel-terminate-fault,
// cancel-parallel, cancel-race. Artifacts and bounded writers are retained for review.
// Optional ROVAI_REPRO_PWSH changes only this isolated DSH fixture's PowerShell path.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'

assert.equal(process.platform, 'win32')
assert(process.env.ROVAI_REPRO_CORE_EXE, 'set ROVAI_REPRO_CORE_EXE to the Core build being verified')
const coreExe = resolve(process.env.ROVAI_REPRO_CORE_EXE)
const output = resolve(process.argv[2] ?? join(import.meta.dirname, 'dsh-member-queue-result.json'))
const remote = process.env.ROVAI_REPRO_REMOTE === '1'
const root = await mkdtemp(join(tmpdir(), 'rovai-dsh-member-queue-'))
const data = join(root, 'Core')
const project = join(root, 'project')
const dshHome = join(root, 'dsh-home')
const faultFile = join(root, 'job-fault.json')
const nativePatchPath = join(dshHome, 'profiles', 'acp', 'cordis.patch.yml')
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), root, data, project, dshHome, coreExe,
  model: remote ? 'configured-sub2api' : 'loopback-controlled-responses', pwshOverride: process.env.ROVAI_REPRO_PWSH ?? null,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8', windowsHide: true }).trim() !== '',
  isolated: true, cases: [], requests: [], events: [], diagnostics: [], jobObservations: [] }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const terminal = status => ['succeeded', 'failed', 'cancelled'].includes(status)
let core, server, fixtureCount = 0
const plans = new Map()
const inspectedJobs = new Set()
const require = createRequire(import.meta.url)
const koffi = require(join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'koffi'))
const kernel = koffi.load('kernel32.dll')
const openJob = kernel.func('void * __stdcall OpenJobObjectW(uint32_t, int, str16)')
const queryJob = kernel.func('int __stdcall QueryInformationJobObject(void *, int, void *, uint32_t, void *)')
const openProcess = kernel.func('void * __stdcall OpenProcess(uint32_t, int, uint32_t)')
const isInJob = kernel.func('int __stdcall IsProcessInJob(void *, void *, void *)')
const closeHandle = kernel.func('int __stdcall CloseHandle(void *)')
const lastError = kernel.func('uint32_t __stdcall GetLastError()')
function observeJobs(stage) {
  for (const job of inspectedJobs) {
    const observation = { at: new Date().toISOString(), stage, job }
    const handle = openJob(4, 0, job)
    if (!handle) observation.openError = lastError()
    else {
      try {
        const accounting = Buffer.alloc(48)
        if (queryJob(handle, 1, accounting, accounting.length, null)) {
          observation.total = accounting.readUInt32LE(36); observation.active = accounting.readUInt32LE(40)
        } else observation.queryError = lastError()
        observation.tools = report.cases.filter(c => c.shellStart).flatMap(c => (c.processLineage ?? [{ ProcessId: c.shellStart.pid }]).map(p => {
          const tool = { key: c.key, pid: p.ProcessId, parentPid: p.ParentProcessId, executable: p.ExecutablePath }
          const processHandle = openProcess(0x1000, 0, tool.pid)
          if (!processHandle) tool.openError = lastError()
          else { try { const present = Buffer.alloc(4); if (isInJob(processHandle, handle, present)) tool.inJob = present.readInt32LE() !== 0; else tool.queryError = lastError() } finally { closeHandle(processHandle) } }
          return tool
        }))
      } finally { closeHandle(handle) }
    }
    report.jobObservations.push(observation)
  }
}

function log(type, value) { console.log(JSON.stringify({ at: new Date().toISOString(), type, ...value })) }
async function persist() { await writeFile(output, JSON.stringify(report, null, 2)) }
async function waitFor(probe, label, timeout = 60_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const v = await probe(); if (v) return v; await sleep(125) }
  throw new Error(`${label} timed out after ${timeout}ms`)
}
function launchCore() {
  const args = ['--data-dir', data, '--runtime-camp-files-root', join(data, 'runtime-files'),
    '--skill-library-root', join(data, 'managed-skill-library'), '--mcp-config-path', join(root, 'mcp.json')]
  log('ISOLATION_BEFORE_LAUNCH', { coreExe, data, skillLibrary: join(data, 'managed-skill-library'), project, dshHome })
  const child = spawn(coreExe, args, { cwd: project, windowsHide: true,
    env: { ...process.env, DSH_HOME: dshHome, DSH_AGENTS_HOME: join(root, 'agents-home'),
      DSH_TELEMETRY_DISABLED: '1', ROVAI_INTERNAL_DSH_CANCEL_TRACE: '1', ROVAI_INTERNAL_JOB_FAULT_FILE: faultFile,
      ROVAI_DSH_FIXTURE_KEY: 'synthetic-loopback-only' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map(); let nextId = 1, stderr = '', stopped = false
  const closed = new Promise(r => child.once('close', (code, signal) => {
    stopped = true
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(`Core closed ${code}/${signal}`)) }
    pending.clear(); r({ code, signal })
  }))
  child.on('error', e => { for (const p of pending.values()) p.reject(e) })
  let diagnosticTail = ''
  child.stderr.on('data', b => {
    stderr = (stderr + b.toString()).slice(-32_768)
    diagnosticTail += b.toString()
    const lines = diagnosticTail.split('\n'); diagnosticTail = lines.pop()
    for (const line of lines) if (line.startsWith('[dsh-cancel-trace] ')) {
      try { const d = { at: new Date().toISOString(), ...JSON.parse(line.slice('[dsh-cancel-trace] '.length)) }; report.diagnostics.push(d); if (d.stage === 'host_bound' || d.stage === 'native_cancel') inspectedJobs.add(d.job); observeJobs(d.stage) } catch {}
    }
  })
  createInterface({ input: child.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line) } catch { return }
    if (m.method) {
      if (/agent_run\.|runtime\.action|runtime\.host\.log|turn\.state|^error$/.test(m.method)) report.events.push({ at: new Date().toISOString(), method: m.method, params: m.params })
      if (m.method === 'agent_run.runtime_cleanup_completed') observeJobs('cleanup_ack_event')
      return
    }
    const p = pending.get(m.id); if (!p) return
    pending.delete(m.id); clearTimeout(p.timer)
    m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result)
  })
  return { pid: child.pid,
    request(method, params = {}, timeout = 60_000) {
      return new Promise((resolveRequest, reject) => {
        if (stopped) return reject(new Error('Core is stopped'))
        const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)) }, timeout)
        pending.set(id, { method, timer, resolve: resolveRequest, reject })
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    }, async stop() {
      child.stdin.end()
      const timer = setTimeout(() => { if (!stopped) child.kill() }, 8_000); timer.unref()
      const result = await closed; clearTimeout(timer)
      return { ...result, stderrTail: stderr }
    }
  }
}
function streamResponse(response, item) {
  const id = `resp_${++fixtureCount}`
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  let seq = 0
  const emit = e => response.write(`data: ${JSON.stringify({ ...e, sequence_number: seq++ })}\n\n`)
  emit({ type: 'response.created', response: { id, status: 'in_progress', output: [] } })
  const added = item.type === 'function_call' ? { ...item, arguments: '' } : { ...item, content: [] }
  emit({ type: 'response.output_item.added', output_index: 0, item: added })
  if (item.type === 'function_call') {
    emit({ type: 'response.function_call_arguments.delta', output_index: 0, item_id: item.id, delta: item.arguments })
    emit({ type: 'response.function_call_arguments.done', output_index: 0, item_id: item.id, arguments: item.arguments })
  } else emit({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: item.content[0].text })
  emit({ type: 'response.output_item.done', output_index: 0, item })
  emit({ type: 'response.completed', response: { id, status: 'completed', output: [item], usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 } } })
  response.end()
}
async function modelRequest(request, response) {
  try {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'queue-fixture', object: 'model' }] })); return
    }
    assert.equal(request.url, '/v1/responses'); assert.equal(request.method, 'POST')
    const chunks = []; for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const markers = [...JSON.stringify(body.input).matchAll(/DSH_CASE_([a-z0-9]+)_(FIRST|SECOND)/g)]
    const match = markers.at(-1); assert(match, 'test marker missing from model input')
    const key = match[1], which = match[2], plan = plans.get(key); assert(plan, `unknown case ${key}`)
    const req = { at: new Date().toISOString(), key, which, model: body.model }
    report.requests.push(req)
    if (which === 'FIRST' && !plan.issuedTool) {
      const tool = body.tools?.find(t => /shell/.test(t.name) && t.parameters?.properties?.command)
        ?? body.tools?.find(t => t.parameters?.properties?.command)
      if (!tool) { report.tools = body.tools; throw new Error('no command tool found') }
      report.shellTool ??= tool
      plan.issuedTool = true
      const args = { command: `node queue-work.cjs ${key} ${plan.mode}`, description: 'Run isolated queue and child process fixture', workdir: project, timeoutMs: 40_000 }
      for (const name of Object.keys(args)) if (!tool.parameters.properties[name]) delete args[name]
      req.action = 'shell'; req.command = args.command
      streamResponse(response, { type: 'function_call', id: `fc_${key}`, call_id: `call_${key}`, name: tool.name,
        arguments: JSON.stringify(args), status: 'completed' })
    } else {
      req.action = 'final'
      if (which === 'FIRST') {
        const outputs = body.input?.filter?.(x => x.type === 'function_call_output') ?? []
        plan.toolOutputs = outputs.map(x => ({ call_id: x.call_id, output: x.output }))
        if (plan.mode === 'cancel-race') {
          plan.finalResponseReady = true
          await new Promise(resolve => { plan.releaseFinalResponse = resolve })
          plan.finalResponseReleasedAt = new Date().toISOString()
        }
      }
      const value = `DSH_CASE_${key}_${which}_DONE`
      streamResponse(response, { type: 'message', id: `msg_${fixtureCount + 1}`, role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: value, annotations: [] }] })
    }
  } catch (e) {
    report.endpointError = String(e.stack)
    if (!response.headersSent) response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'fixture request error', type: 'invalid_request_error' } }))
  }
}
async function snapshot(threadId) { return core.request('threads.snapshot', { threadId }) }
function locateRun(snap, msg) { return snap.agentRuns.find(r => r.anchorMessageId === msg || r.inputMessageIds?.includes(msg)) }
function compact(snap) { return { runs: snap.agentRuns.map(r => ({ id: r.id, agentId: r.agentId, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, waitReason: r.waitReason ?? null })),
  messages: snap.messages.filter(m => m.authorType === 'agent').map(m => ({ body: m.body, sourceAgentRunId: m.sourceAgentRunId })) } }
async function send(threadId, body, agentId = 'agent_2') {
  const r = await core.request('thread.messages.send', { commandId: randomUUID(), threadId,
    content: { version: 2, segments: [{ kind: 'atom', atom: { type: 'member', agentId } }, { kind: 'text', text: ' ' + body }] },
    sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Isolated DSH non-lead queue reproduction', completionRole: 'required' } })
  const c = r.commandResult ?? r; assert.equal(c.status, 'accepted', JSON.stringify(c)); return c.payload.threadMessageId
}
function dbEvidence(threadId) {
  const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  try { return {
    runs: db.prepare('SELECT id, status, execution_epoch, started_at, cancel_requested_at, cancel_acknowledged_at FROM agent_run WHERE camp_id=? ORDER BY created_at').all(threadId),
    deliveries: db.prepare('SELECT id,status,claimed_agent_run_id,failure_code FROM camp_message_delivery WHERE camp_id=? ORDER BY queue_sequence').all(threadId)
  } } finally { db.close() }
}

try {
  await mkdir(project); await mkdir(join(dshHome, 'profiles', 'acp'), { recursive: true })
  await writeFile(join(root, 'mcp.json'), '{}')
  await writeFile(join(project, 'README.md'), 'Isolated DSH queue reproduction. All fixture writes stay here.\n')
  await writeFile(join(project, 'queue-work.cjs'), `const { spawn } = require('node:child_process');
const fs = require('node:fs');
const [key, mode] = process.argv.slice(2);
fs.writeFileSync(key + '.started.json', JSON.stringify({ pid: process.pid, ppid: process.ppid, executable: process.execPath, startedAt: Date.now() }));
let count = 0;
const heartbeat = setInterval(() => fs.appendFileSync(key + '.heartbeat', Date.now() + '\\n'), 150);
async function main() {
  for (let batch = 0; batch < 4; batch++) await Promise.all(Array.from({ length: 16 }, () => new Promise((resolve, reject) => {
    const p = spawn(process.env.ComSpec || 'C:/Windows/System32/cmd.exe', ['/d', '/c', 'exit', '0'], { windowsHide: true, stdio: 'ignore' });
    p.once('error', reject); p.once('exit', code => { if (code !== 0) reject(new Error('child failed')); else { count++; resolve(); } });
  })));
  fs.writeFileSync(key + '.children.json', JSON.stringify({ completed: count, at: Date.now() }));
  await new Promise(r => setTimeout(r, mode.startsWith('cancel') && mode !== 'cancel-race' ? 25000 : mode === 'control' ? 12000 : 3000));
  clearInterval(heartbeat);
  fs.writeFileSync(key + '.finished.json', JSON.stringify({ pid: process.pid, count, finishedAt: Date.now() }));
  console.log('REAL_SHELL_DONE ' + key + ' children=' + count);
}
main().catch(e => { clearInterval(heartbeat); console.error(e); process.exitCode = 1; });
`)
  report.coreSha256 = createHash('sha256').update(await readFile(coreExe)).digest('hex')
  let route, modelId = 'queue-fixture'
  if (remote) {
    const require = createRequire(import.meta.url)
    const yaml = require(join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', 'yaml'))
    const native = yaml.parse(await readFile(join(homedir(), '.dsh', 'profiles', 'acp', 'cordis.patch.yml'), 'utf8'))
    const provider = native.find(x => x.id === 'llm-pi-ai')?.config?.providers?.sub2api
    assert(provider?.baseURL && provider.apiKeyEnv && process.env[provider.apiKeyEnv], 'configured route not available')
    modelId = process.env.ROVAI_REPRO_MODEL ?? 'gpt-6'
    route = { ...provider, models: [{ ...(provider.models?.[0] ?? {}), id: modelId, contextWindow: 200000, maxTokens: 4096 }] }
    report.remoteRoute = { api: route.api, endpoint: route.baseURL, modelId, credential: 'inherited environment; never recorded' }
  } else {
    server = createServer(modelRequest); await new Promise(r => server.listen(0, '127.0.0.1', r))
    route = { api: 'openai-responses', baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKeyEnv: 'ROVAI_DSH_FIXTURE_KEY',
      models: [{ id: modelId, contextWindow: 200000, maxTokens: 4096 }] }
  }
  const nativePatch = [{ id: 'llm-pi-ai', config: { providers: { fixture: route } } }]
  if (process.env.ROVAI_REPRO_PWSH) nativePatch.push({ id: 'pwsh-sandbox', config: { pwshPath: process.env.ROVAI_REPRO_PWSH } })
  await writeFile(nativePatchPath, JSON.stringify(nativePatch))
  report.nativePatchSha256 = createHash('sha256').update(await readFile(nativePatchPath)).digest('hex')
  core = launchCore(); report.corePid = core.pid
  report.health = (await core.request('health.check')).core
  await core.request('runtime.product.check', { runtimeKind: 'deepseek-harness' })
  const installation = await waitFor(async () => (await core.request('runtime.installations.list')).find(i => i.adapterKind === 'deepseek-harness' && i.installationClass === 'managed_default' && i.memberRuntimeDefaults), 'DSH discovery')
  report.installation = { version: installation.reportedVersion ?? installation.snapshot?.reportedVersion, permissions: installation.memberRuntimeDefaults.permissions }
  for (const agentId of ['agent_1', 'agent_2']) {
    const profile = await core.request('members.get', { agentId })
    const c = await core.request('members.runtime.set', { commandId: randomUUID(), command: { agentId, expectedVersion: profile.version,
      adapterKind: 'deepseek-harness', model: { mode: 'explicit', modelId: JSON.stringify(['fixture', modelId]), options: {} },
      permissions: installation.memberRuntimeDefaults.permissions } })
    assert.equal(c.status, 'applied', JSON.stringify(c))
  }
  const catalog = await core.request('runtime.modelCatalog.open', { runtimeKind: 'deepseek-harness', waitForRefresh: true })
  report.catalog = { fixtureVisible: catalog.models.some(m => JSON.stringify(m).includes(modelId)), refreshStatus: catalog.refreshStatus }
  assert(report.catalog.fixtureVisible)
  log('READY', { health: report.health, installation: report.installation, catalog: report.catalog })
  const workspace = await core.request('workspaces.inspect', { path: project })
  const modes = (process.env.ROVAI_REPRO_CASES ?? 'normal,normal,cancel-stop-only,cancel,cancel').split(',')
  assert(modes.every(mode => ['normal', 'cancel', 'cancel-stop-only', 'cancel-query-fault', 'cancel-terminate-fault', 'cancel-parallel', 'cancel-race'].includes(mode)))
  assert(!remote || !modes.includes('cancel-race'), 'the response/cancel race requires the controlled endpoint')
  for (let index = 0; index < modes.length; index++) {
    const key = `q${index}`, mode = modes[index], item = { key, mode, nonLeadAgent: 'agent_2', defaultLeadAgent: 'agent_1', startedAt: new Date().toISOString() }
    const cancelled = mode.startsWith('cancel'), hasSuccessor = mode !== 'cancel-stop-only'
    report.cases.push(item); plans.set(key, { mode })
    const created = await core.request('threads.create', { commandId: randomUUID(), name: `DSH non-lead ${key}`, workspace: { projectPath: workspace.projectPath },
      memberAgentIds: ['agent_1', 'agent_2'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
    assert.equal(created.status, 'applied', JSON.stringify(created))
    const threadId = created.payload.threadId ?? created.payload.campId; item.threadId = threadId
    try {
      if (mode === 'cancel-parallel') {
        const controlKey = key + 'control'
        plans.set(controlKey, { mode: 'control' })
        const control = await core.request('threads.create', { commandId: randomUUID(), name: 'DSH parallel control', workspace: { projectPath: workspace.projectPath },
          memberAgentIds: ['agent_1', 'agent_2'], defaultLeadAgentId: 'agent_2', collaborationMode: 'peer' })
        assert.equal(control.status, 'applied')
        item.control = { key: controlKey, threadId: control.payload.threadId ?? control.payload.campId }
        item.control.messageId = await send(item.control.threadId, `DSH_CASE_${controlKey}_FIRST: Execute node queue-work.cjs ${controlKey} control and wait for completion.`, 'agent_1')
        await waitFor(() => existsSync(join(project, controlKey + '.started.json')), 'parallel control tool')
      }
      item.firstMessageId = await send(threadId, `DSH_CASE_${key}_FIRST: This is an isolated queue test. Use the pwsh tool to execute exactly node queue-work.cjs ${key} ${mode}, with timeoutMs 40000 and workdir ${project}. Wait for it to finish, then publish DSH_CASE_${key}_FIRST_DONE with rovai send --public-only and finish. Do not inspect other files, contact other members, change configuration, or execute other commands except that required publication. If the shell fails, report the failure instead of claiming completion.`)
      await waitFor(() => existsSync(join(project, key + '.started.json')), 'real shell start', remote ? 90_000 : 45_000)
      item.shellStart = JSON.parse(await readFile(join(project, key + '.started.json'), 'utf8'))
      item.beforeSecond = compact(await snapshot(threadId))
      if (hasSuccessor) item.secondMessageId = await send(threadId, `DSH_CASE_${key}_SECOND: Reply with DSH_CASE_${key}_SECOND_DONE. Do not call tools.`)
      item.whileFirstActive = dbEvidence(threadId)
      log('SECOND_QUEUED_DURING_REAL_SHELL', { key, mode, evidence: item.whileFirstActive })
      if (cancelled) {
        await waitFor(() => existsSync(join(project, key + '.children.json')), 'child process burst')
        // Query only this fixture's known ancestry, stopping before our Core.
        const lineageQuery = `$ancestor = ${item.shellStart.pid}; $rows = @(); while ($ancestor -and $ancestor -ne ${core.pid} -and $rows.Count -lt 20) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$ancestor" | Select-Object ProcessId,ParentProcessId,ExecutablePath; if (!$p) { break }; $rows += $p; $ancestor = $p.ParentProcessId }; ConvertTo-Json -InputObject $rows -Compress`
        item.processLineage = JSON.parse(execFileSync(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', lineageQuery], { windowsHide: true, encoding: 'utf8' }))
        observeJobs('before_cancel')
        if (mode === 'cancel-race') await waitFor(() => plans.get(key).finalResponseReady, 'native completion response barrier')
        const run = locateRun(await snapshot(threadId), item.firstMessageId)
        if (mode.endsWith('-fault')) {
          const host = report.diagnostics.find(d => d.stage === 'host_bound' && d.run === run.id)
          assert(host?.job, 'fault requires the exact target Job')
          item.fault = { job: host.job, operation: mode === 'cancel-query-fault' ? 'query' : 'terminate' }
          await writeFile(faultFile, JSON.stringify(item.fault))
        }
        item.cancelSentAt = new Date().toISOString(); const before = Date.now()
        const cancelling = core.request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId, agentRunId: run.id, expectedVersion: run.version } })
        if (mode === 'cancel-race') plans.get(key).releaseFinalResponse()
        item.cancelResult = await cancelling
        item.cancelRpcMs = Date.now() - before
        if (mode === 'cancel-race') item.finalResponseReleasedAt = plans.get(key).finalResponseReleasedAt
        if (item.fault) {
          await sleep(6200) // Exceed one 5s attempt; a new message must remain waiting.
          item.fault.heldUntil = new Date().toISOString()
          item.fault.evidence = dbEvidence(threadId)
          const stopped = item.fault.evidence.runs.find(r => r.id === run.id)
          item.fault.failClosed = stopped?.status === 'cancelled' && !stopped.cancel_acknowledged_at
            && item.fault.evidence.deliveries.some(d => d.status === 'waiting' && !d.claimed_agent_run_id)
            && !item.fault.evidence.runs.some(r => r.id !== run.id)
          item.fault.observed = report.diagnostics.some(d => d.stage === 'job_fault' && d.job === item.fault.job && d.operation === item.fault.operation)
          item.fault.error = report.events.find(e => e.method === 'runtime.host.log'
            && e.params?.text?.includes('ACP cleanup failed:') && e.params.text.includes(item.fault.job.replaceAll('\\', '\\\\')))
            ?? report.events.find(e => e.method === 'runtime.host.log' && e.params?.text?.includes('ACP cleanup failed:') && e.at >= item.cancelSentAt)
          item.fault.attempts = report.diagnostics.filter(d => d.stage === 'host_force_reap' && d.job === item.fault.job && d.at >= item.cancelSentAt).length
          await unlink(faultFile)
          item.fault.releasedAt = new Date().toISOString()
          assert(item.fault.observed && item.fault.failClosed && item.fault.error && item.fault.attempts >= 2,
            'cleanup must report an error, retry locally, and keep the successor waiting during fault')
        }
      }
      const final = await waitFor(async () => {
        const s = await snapshot(threadId), first = locateRun(s, item.firstMessageId), second = hasSuccessor && locateRun(s, item.secondMessageId)
        return first && terminal(first.status) && (!hasSuccessor || (second && terminal(second.status)))
          && (!cancelled || first.cancelAcknowledgedAt) ? s : null
      }, 'Run cleanup and successor completion', remote ? 120_000 : 45_000)
      item.final = compact(final); item.db = dbEvidence(threadId)
      observeJobs('both_runs_terminal')
      const first = locateRun(final, item.firstMessageId), second = hasSuccessor && locateRun(final, item.secondMessageId)
      item.firstStatus = first.status; item.secondStatus = second ? second.status : null
      item.firstHost = report.diagnostics.find(d => d.stage === 'host_bound' && d.run === first.id)
      item.secondHost = second ? report.diagnostics.find(d => d.stage === 'host_bound' && d.run === second.id) : null
      item.hostReused = item.firstHost && item.secondHost ? item.firstHost.host === item.secondHost.host : null
      item.successorStartedAt = second ? second.startedAt : null
      item.toolOutputs = plans.get(key).toolOutputs
      if (item.control) {
        const s = await waitFor(async () => {
          const snapshot = await core.request('threads.snapshot', { threadId: item.control.threadId })
          return terminal(locateRun(snapshot, item.control.messageId)?.status) ? snapshot : null
        }, 'unrelated Host natural completion')
        const run = locateRun(s, item.control.messageId)
        item.control.status = run.status
        item.control.host = report.diagnostics.find(d => d.stage === 'host_bound' && d.run === run.id)
        item.control.finished = existsSync(join(project, item.control.key + '.finished.json'))
          ? JSON.parse(await readFile(join(project, item.control.key + '.finished.json'), 'utf8')) : null
        const acknowledgedAt = item.db.runs.find(r => r.id === first.id)?.cancel_acknowledged_at
        item.control.pass = run.status === 'succeeded' && !!item.control.finished && item.control.finished.finishedAt > Date.parse(acknowledgedAt)
          && !!item.control.host?.job && item.control.host.job !== item.firstHost?.job
      }
      item.children = JSON.parse(await readFile(join(project, key + '.children.json'), 'utf8'))
      item.workFinished = existsSync(join(project, key + '.finished.json'))
      if (cancelled) {
        const before = await readFile(join(project, key + '.heartbeat'), 'utf8'); await sleep(750)
        item.heartbeatStopped = before === await readFile(join(project, key + '.heartbeat'), 'utf8')
        const r = item.db.runs.find(r => r.id === locateRun(final, item.firstMessageId).id)
        item.cleanupAckMs = r.cancel_acknowledged_at ? Date.parse(r.cancel_acknowledged_at) - Date.parse(r.cancel_requested_at) : null
        item.cleanupAcknowledgedAt = r.cancel_acknowledged_at
      }
      item.pass = item.firstStatus === (cancelled ? 'cancelled' : 'succeeded') && (!hasSuccessor || item.secondStatus === 'succeeded')
        && item.children.completed === 64 && (cancelled ? item.heartbeatStopped && (mode === 'cancel-race' || !item.workFinished) && (!hasSuccessor || item.hostReused === false) : item.workFinished && item.hostReused === true)
        && (!item.fault || item.fault.failClosed && item.fault.observed) && (!item.control || item.control.pass)
      log('CASE_RESULT', { key, mode, pass: item.pass, first: item.firstStatus, second: item.secondStatus, cancelRpcMs: item.cancelRpcMs, cleanupAckMs: item.cleanupAckMs })
    } catch (e) { item.error = String(e.stack); item.final = compact(await snapshot(threadId)); item.db = dbEvidence(threadId); log('CASE_ERROR', { key, error: item.error }); break }
    await persist()
  }
} catch (e) { report.error = String(e.stack); log('ERROR', { error: report.error }) }
finally {
  if (core) report.coreStop = await core.stop()
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)) }
  // Observe bounded fixture writes even after the isolated Core has exited.
  // This distinguishes a settled queue from actually stopped tool processes.
  const cancelCases = report.cases.filter(c => c.mode.startsWith('cancel') && c.shellStart)
  const observeUntil = Math.max(0, ...cancelCases.map(c => c.shellStart.startedAt + 27_000))
  if (Date.now() < observeUntil) await sleep(observeUntil - Date.now())
  for (const c of report.cases.filter(c => c.shellStart)) {
    const finishedPath = join(project, c.key + '.finished.json')
    const heartbeatPath = join(project, c.key + '.heartbeat')
    const beats = existsSync(heartbeatPath) ? (await readFile(heartbeatPath, 'utf8')).trim().split('\n').map(Number) : []
    c.lateObservation = { observedAt: new Date().toISOString(),
      finished: existsSync(finishedPath) ? JSON.parse(await readFile(finishedPath, 'utf8')) : null,
      heartbeatCount: beats.length, lastHeartbeatAt: beats.length ? new Date(beats.at(-1)).toISOString() : null,
      msWritingAfterCancel: c.cancelSentAt && beats.length ? beats.at(-1) - Date.parse(c.cancelSentAt) : null }
    if (c.mode.startsWith('cancel')) {
      const job = c.firstHost?.job
      c.termination = report.diagnostics.find(d => d.job === job && d.stage === 'terminate_job' && d.at >= c.cancelSentAt)
      c.jobZero = report.diagnostics.find(d => d.job === job && d.stage === 'job_query' && d.active === 0 && d.at >= c.cancelSentAt)
      c.toolInTargetJobBeforeCancel = report.jobObservations.find(o => o.job === job && o.stage === 'before_cancel')
        ?.tools?.find(p => p.pid === c.shellStart.pid)?.inJob ?? null
      c.noWritesAfterCleanup = !!c.cleanupAcknowledgedAt && beats.every(at => at <= Date.parse(c.cleanupAcknowledgedAt))
      c.noOverlap = !c.successorStartedAt || beats.every(at => at <= Date.parse(c.successorStartedAt))
      c.pass = !!c.pass && c.cancelRpcMs < 1000 && c.noWritesAfterCleanup && c.noOverlap
        && (c.mode === 'cancel-race' || !c.lateObservation.finished) && c.toolInTargetJobBeforeCancel === true && !!c.jobZero
    }
  }
  report.endedAt = new Date().toISOString()
  report.queuePass = !report.error && report.cases.length > 0 && report.cases.every(c => c.firstStatus === (c.mode.startsWith('cancel') ? 'cancelled' : 'succeeded') && (c.mode === 'cancel-stop-only' || c.secondStatus === 'succeeded'))
  report.cancellationStopsTool = cancelCases.length ? cancelCases.every(c => c.heartbeatStopped && (c.mode === 'cancel-race' || !c.lateObservation.finished)) : null
  if (report.nativePatchSha256) report.nativePatchUnchanged = report.nativePatchSha256 === createHash('sha256').update(await readFile(nativePatchPath)).digest('hex')
  report.pass = !report.error && report.cases.length > 0 && report.cases.every(c => c.pass)
    && report.nativePatchUnchanged !== false
  await persist(); log('RESULT', { output, root, pass: report.pass, cases: report.cases.length })
  if (!report.pass) process.exitCode = 1
}
