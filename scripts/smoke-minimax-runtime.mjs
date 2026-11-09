// Real mcode + production Core, with a deterministic local OpenAI provider.
// This verifies transport/lifecycle seams; it is NOT real-model qualification.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, realpath, access, rm, rename, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { parse as parseYaml } from 'yaml'
import { startQualificationCore, processTable } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'

const repo = resolve(import.meta.dirname, '..')
const coreExecutable = resolve(process.env.ROVAI_MINIMAX_CONTROL_CORE_EXECUTABLE ?? process.env.ROVAI_QUALIFICATION_CORE_BIN
  ?? join(repo, 'target', 'debug', process.platform === 'win32' ? 'rovai-core.exe' : 'rovai-core'))
const native = process.argv[2]
const filesOnly = process.argv.includes('--files-only')
const completionOnly = process.argv.includes('--completion-only')
const questionnairesOnly = process.argv.includes('--questionnaires-only')
const fleetOnly = process.argv.includes('--fleet-only')
const planOnly = process.argv.includes('--plan-only')
const mcpOnly = process.argv.includes('--mcp-only')
assert.ok([filesOnly, completionOnly, questionnairesOnly, fleetOnly, planOnly, mcpOnly].filter(Boolean).length <= 1, 'Choose one focused matrix')
assert.ok(native && isAbsolute(native), 'Pass the absolute installed mcode path')
const nativeScript = process.env.ROVAI_MINIMAX_NATIVE_SCRIPT
if (nativeScript) assert.ok(isAbsolute(nativeScript), 'Native npm script must be absolute')
const fixtureArg = process.argv.indexOf('--fixture-root')
const suppliedRoot = fixtureArg < 0 ? null : process.argv[fixtureArg + 1]
if (fixtureArg >= 0) assert.ok(suppliedRoot && isAbsolute(suppliedRoot), 'Pass an empty absolute fixture root')
const root = await realpath(suppliedRoot ?? await mkdtemp(join(tmpdir(), 'rovai-minimax-control-')))
assert.deepEqual(await readdir(root), [], 'fixture root must be empty')
const data = process.platform === 'win32'
  ? JSON.parse(execFileSync(coreExecutable, ['--prepare-windows-data-root', join(root, 'formal')], { encoding: 'utf8' })).core
  : join(root, 'core')
const project = join(root, 'project'), nativeData = join(root, 'native')
for (const path of [...(process.platform === 'win32' ? [] : [data]), project, nativeData]) await mkdir(path, { mode: 0o700 })
console.error(JSON.stringify({ channel: 'automatic acceptance', root, data, skills: join(data, 'managed-skill-library'), mcp: join(data, 'mcp.json'), nativeData }))
const events = []
const report = { evidenceKind: 'real-cli-scripted-provider', root, coreExecutable,
  coreSha256: createHash('sha256').update(await readFile(coreExecutable)).digest('hex'), cases: [], requests: [], status: 'running' }
const mcpId = randomUUID(), mcpMarker = join(project, 'mcp-calls.txt')
let stage = 'setup', step = 0, core, db, threadId
const filePlans = new Map()
const quote = value => `'${(process.platform === 'win32' && isAbsolute(value) ? value.replaceAll('\\', '/') : value).replaceAll("'", "'\\''")}'`
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'rovai-control', object: 'model' }] })); return }
    let raw = ''; for await (const part of req) raw += part
    const body = JSON.parse(raw)
    if (!Array.isArray(body.messages)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'The fixture implements Chat Completions only' } })); return }
    const system = body.messages.filter(m => ['system', 'developer'].includes(m.role)).map(m => JSON.stringify(m.content)).join('\n')
    const user = body.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : m.content?.map(c => c.text ?? '').join('\n') ?? '').join('\n')
    const tools = body.tools?.map(t => t.function.name) ?? []
    if (tools.some(name => /^(bash|shell)$/i.test(name))) await new Promise(resolve => setTimeout(resolve, 250))
    // RUN_INPUT and Steer contain JSON inside the text content. Windows paths
    // therefore retain JSON escaping after the provider envelope is decoded.
    const imagePath = join(project, 'steer.png')
    report.requests.push({ stage, step, tools, charterCount: system.split('[SESSION_CHARTER]').length - 1, runInput: user.includes('[RUN_INPUT]'), steerVisible: user.includes('MINIMAX_STEER_TOKEN'), steerImagePath: user.includes(imagePath) || user.includes(JSON.stringify(imagePath).slice(1, -1)), imageBlock: body.messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')), mcpResult: raw.includes('MINIMAX_MCP:verified') })
    let call = null
    if (stage !== 'setup' && stage !== 'EMPTY_NO_SEND' && tools.some(name => /^(bash|shell)$/i.test(name)) && step++ === 0) {
      const tool = body.tools.find(t => /^(bash|shell)$/i.test(t.function.name))
      assert.ok(tool, `No shell tool: ${tools.join(',')}`)
      const key = Object.keys(tool.function.parameters.properties).find(k => k.toLowerCase() === 'command')
      assert.ok(key, 'Shell command schema missing')
      const token = `MINIMAX_CONTROL_${stage}`
      const output = join(project, `result-${stage}.txt`)
      let command = ['HOLD', 'CANCEL'].includes(stage)
        ? `node ${quote(join(project, 'hold.mjs'))}`
        : `node ${quote(join(project, 'output.mjs'))} ${quote(stage)} ${quote(output)} ${quote(token)}`
      call = { id: `call-${stage}`, type: 'function', function: { name: tool.function.name, arguments: JSON.stringify({ [key]: command }) } }
    }
    if (['MCP', 'MCP_CANCEL'].includes(stage) && call) {
      const tool = body.tools.find(t => t.function.name.includes(stage === 'MCP' ? 'echo' : 'hold') && t.function.name.includes('minimax_fixture'))
      assert.ok(tool, `MCP tool missing: ${tools.join(',')}`)
      call = { id: 'call-mcp', type: 'function', function: { name: tool.function.name, arguments: JSON.stringify(stage === 'MCP' ? { text: 'verified' } : {}) } }
    }
    if (stage === 'HOLD' && !call && step === 2 && tools.includes('read')) {
      const tool = body.tools.find(t => t.function.name === 'read')
      const key = Object.keys(tool.function.parameters.properties).find(k => /^(file_?path|path)$/i.test(k))
      assert.ok(key, 'Native read path schema missing')
      call = { id: 'call-image', type: 'function', function: { name: 'read', arguments: JSON.stringify({ [key]: join(project, 'steer.png') }) } }
    }
    if (filePlans.has(stage)) {
      const planned = filePlans.get(stage)[step - 1]
      call = planned ? { id: `call-${stage}-${step}`, type: 'function', function: { name: planned.name, arguments: JSON.stringify(planned.input) } } : null
      if (planned) assert.ok(tools.includes(planned.name), `Native ${planned.name} tool missing`)
    }
    if ((stage.startsWith('ASK_') && call) || (stage === 'SEND_ASK' && !call && step === 2)) {
      assert.ok(tools.includes('ask_user'), 'The cancellation matrix must leave the native questionnaire tool enabled')
      const question = { id: 'color', question: 'Choose a synthetic test color.',
        selectionMode: stage === 'ASK_MULTIPLE' ? 'multiple' : 'single',
        options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }] }
      call = { id: `call-${stage}-questionnaire`, type: 'function', function: { name: 'ask_user',
        arguments: JSON.stringify({ title: stage, requiresExplicitResponse: true,
          steps: stage === 'ASK_MULTIPLE' ? [question, { ...question, id: 'secondary' }] : [question] }) } }
    }
    if (stage === 'SEND_ERROR' && !call) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'controlled terminal authentication failure', type: 'authentication_error' } })); return
    }
    const content = call ? null : ['SEND_EMPTY', 'EMPTY_NO_SEND'].includes(stage) ? '' : 'CONTROL_DONE'
    const usage = { prompt_tokens: 120, completion_tokens: 5, total_tokens: 125, prompt_tokens_details: { cached_tokens: 20 } }
    const response = { id: `control-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now()/1000), model: 'rovai-control' }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({ ...response, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`)
      chunk(call ? { role: 'assistant', tool_calls: [{ index: 0, ...call }] } : { role: 'assistant', content })
      chunk({}, call ? 'tool_calls' : 'stop', { usage }); res.end('data: [DONE]\n\n')
    } else {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...response, choices: [{ index: 0, message: { role: 'assistant', content, ...(call ? { tool_calls: [call] } : {}) }, finish_reason: call ? 'tool_calls' : 'stop' }], usage }))
    }
  } catch (error) { report.providerError = error.message; res.writeHead(500); res.end(JSON.stringify({ error: { message: error.message } })) }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const env = { ...process.env, MINIMAX_DATA_DIR: nativeData, MAVIS_DATA_DIR: nativeData, ROVAI_MINIMAX_CONTROL_KEY: 'synthetic-local-fixture-key' }
Object.assign(process.env, env)
async function command(file, args) {
  const child = spawn(nativeScript && file === native ? process.execPath : file,
    nativeScript && file === native ? [nativeScript, ...args] : args,
    { env, cwd: project, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { output += b })
  const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject) })
  assert.equal(code, 0, output.slice(-2000)); return output
}
async function start() {
  core = startQualificationCore({ coreExecutable, dataDirectory: data, workingDirectory: project, runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(data, 'mcp.json'), onNotification: event => { if (event.method === 'runtime.action') events.push(event) } })
  await core.request('health.check')
}
const exists = async name => { try { await access(join(project, name)); return true } catch { return false } }
const runs = () => db.prepare('SELECT id,status,execution_epoch,last_error_code FROM agent_run WHERE camp_id=? ORDER BY created_at,id').all(threadId)
async function until(predicate, label) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const result = await predicate(); if (result) return result
    const failed = runs().find(r => r.status === 'failed'); assert.ok(!failed, `${label}: ${JSON.stringify(failed)}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
async function send(text, mode = 'start', attachments = []) {
  const result = await core.request('thread.messages.send', { commandId: randomUUID(), threadId,
    content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_2'] }, text), sourceAttachments: attachments, quotes: [], replyToThreadMessageId: null,
    deliveryMode: mode, steerTargets: runs().filter(r => r.status === 'running').map(r => ({ agentRunId: r.id, executionEpoch: r.execution_epoch })),
    execution: { taskId: null, purpose: 'MiniMax deterministic integration', completionRole: 'required' } })
  assert.equal(result.commandResult.status, 'accepted', JSON.stringify(result)); return result.commandResult.payload.threadMessageId
}
async function turn(name) {
  stage = name; step = 0; const before = runs().length
  const publishedBefore = db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE camp_id=? AND author_type='agent'").get(threadId).n
  await send(`CONTROL_CASE=${name}; execute the controlled fixture and publish its result.`)
  await until(() => runs().length > before && runs().at(-1).status === 'succeeded', name)
  assert.equal((await readFile(join(project, `result-${name}.txt`), 'utf8')).trim(), `MINIMAX_CONTROL_${name}`)
  const messages = db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE camp_id=? AND author_type='agent'").get(threadId)
  assert.equal(messages.n - publishedBefore, 1, 'bundled rovai send must publish exactly once')
  report.cases.push({ name, status: 'passed', run: runs().at(-1).id })
}
async function hostPids() { return (await processTable()).filter(p => p.ppid === core.pid).map(p => p.pid) }
try {
  report.version = (await command(native, ['--version'])).trim()
  await command(native, ['provider', 'add', '--name', 'rovai-control', '--base-url', `http://127.0.0.1:${server.address().port}/v1`, '--api-format', 'openai-completions', '--model', 'rovai-control', '--api-key-env', 'ROVAI_MINIMAX_CONTROL_KEY', '--context-limit', '65536', '--output-limit', '4096', '--support-image', '--use'])
  await writeFile(join(project, 'hold.mjs'), "import {access,writeFile} from 'node:fs/promises';await writeFile('hold.ready',String(process.pid));while(true){try{await access('hold.release');break}catch{await new Promise(r=>setTimeout(r,100))}}console.log('HOLD_DONE');\n")
  // mcode's bash tool uses PowerShell on Windows. Keep the actual output and
  // publication fixture portable instead of accidentally testing POSIX syntax.
  await writeFile(join(project, 'output.mjs'), `import {writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
const [stage,output,token]=process.argv.slice(2);
if(stage==='STDOUT')console.log('ONLY_STDOUT');
else if(stage==='STDERR')console.error('ONLY_STDERR');
else if(stage==='NONZERO'){console.log('NONZERO_STDOUT');process.exitCode=7}
else if(stage==='LARGE')process.stdout.write('CONTROL_LARGE_'+'x'.repeat(100000));
else if(stage!=='EMPTY'){writeFileSync(output,token+'\\n');console.log('CONTROL_STDOUT');console.error('CONTROL_STDERR');const result=spawnSync(process.platform==='win32'?'rovai.exe':'rovai',['send','--public-only','--input-file',output],{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;process.exitCode=result.status??1}
`)
  await writeFile(join(data, 'mcp.json'), JSON.stringify({ mcpServers: { minimax_fixture: { command: process.execPath, args: [join(repo, 'crates/rovai-core/tests/fixtures/mcp-smoke-server.mjs')], env: { ROVAI_MCP_SMOKE_SOURCE: 'MINIMAX_MCP', ROVAI_MCP_SMOKE_CALL_MARKER: mcpMarker,
    ...(mcpOnly ? { ROVAI_MCP_SMOKE_HOLD_READY: join(project, 'mcp-hold.ready'), ROVAI_MCP_SMOKE_HOLD_EFFECT: join(project, 'mcp-late-effect.txt') } : {}) } } }, _rovai: { schemaVersion: 2, servers: { minimax_fixture: { serverId: mcpId, enabled: true, source: 'user', riskLevel: 'standard' } }, assignments: [{ serverId: mcpId, agentId: 'agent_2' }] } }), { mode: 0o600 })
  await start()
  const config = await core.request('runtime.startup.get', { runtimeKind: 'minimax-code-cli' })
  await core.request('runtime.startup.save', { runtimeKind: 'minimax-code-cli', expectedRevision: config.revision, configuration: { programPath: native, environment: [] } })
  report.catalog = await core.request('runtime.modelCatalog.open', { runtimeKind: 'minimax-code-cli', waitForRefresh: true }, 90_000)
  assert.equal(report.catalog.refreshStatus, 'completed', JSON.stringify(report.catalog))
  const installation = (await core.request('runtime.installations.list')).find(i => i.adapterKind === 'minimax-code-cli')
  report.installation = installation
  assert.equal(installation?.snapshot?.probeStatus, 'ready', JSON.stringify(installation))
  assert.ok(installation.memberRuntimeDefaults, 'native product defaults missing')
  const profile = await core.request('members.get', { agentId: 'agent_2' })
  const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: { agentId: 'agent_2', expectedVersion: profile.version, adapterKind: 'minimax-code-cli', ...installation.memberRuntimeDefaults } })
  assert.equal(configured.status, 'applied', JSON.stringify(configured))
  const member = await core.request('members.get', { agentId: 'agent_2' })
  assert.ok(['ready', 'installed_unverified'].includes(member.runtimeReadiness?.status), JSON.stringify(member.runtimeReadiness))
  assert.equal(member.runtimeReadiness.blockers.length, 0)
  const created = await core.request('threads.create', { commandId: randomUUID(), name: 'MiniMax controlled integration', workspace: { projectPath: project }, memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', collaborationMode: 'peer' })
  assert.equal(created.status, 'applied'); threadId = created.payload.threadId
  db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  if (fleetOnly) {
    const threads = [threadId], bindings = new Map(), firstPids = []
    for (let index = 0; index < 21; index++) {
      if (index > 0) {
        const created = await core.request('threads.create', { commandId: randomUUID(), name: `MiniMax Fleet ${index}`,
          workspace: { projectPath: project }, memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', collaborationMode: 'peer' })
        assert.equal(created.status, 'applied'); threads.push(created.payload.threadId)
      }
      threadId = threads[index]
      await turn(`FLEET_${index}`)
      bindings.set(threadId, db.prepare('SELECT native_binding_id,native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_2'))
      const pids = await hostPids()
      assert.ok(pids.length <= 20, 'production per-member resident cap')
      if (index === 0) firstPids.push(...pids)
    }
    assert.equal((await hostPids()).length, 20)
    const resident = new Set(await hostPids())
    assert.ok(firstPids.every(pid => !resident.has(pid)), 'the least-recently-used native Host must be reaped')
    threadId = threads[0]
    await turn('FLEET_RETURN')
    assert.deepEqual(db.prepare('SELECT native_binding_id,native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_2'), bindings.get(threadId))
    report.cases.push({ name: 'production 20-Host per-member LRU evicts the oldest idle Host and resumes its exact Session', status: 'passed', sessionCount: threads.length, residentCount: (await hostPids()).length })
    report.idleEviction = { productionTtlMs: 30 * 60_000, startedAt: new Date().toISOString(), pids: await hostPids() }
    await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.error(JSON.stringify({ case: 'native production idle TTL', status: 'waiting', root }))
    const began = Date.now(), deadline = began + 32 * 60_000
    while ((await hostPids()).length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10_000))
    assert.deepEqual(await hostPids(), [], 'the unmodified production idle TTL must reap all idle Hosts')
    report.idleEviction.elapsedMs = Date.now() - began
    await turn('AFTER_IDLE_TTL')
    assert.deepEqual(db.prepare('SELECT native_binding_id,native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_2'), bindings.get(threadId))
    report.cases.push({ name: 'production 30-minute idle eviction and exact native Session continuation', status: 'passed', elapsedMs: report.idleEviction.elapsedMs })
    const crashChildren = await hostPids()
    process.kill(core.pid, 'SIGKILL')
    await new Promise(resolve => setTimeout(resolve, 5_000))
    const surviving = new Set((await processTable()).map(process => process.pid))
    assert.ok(crashChildren.every(pid => !surviving.has(pid)), 'Core crash must reap its native Hosts')
    await core.stop(); await start(); await turn('AFTER_CORE_CRASH')
    assert.deepEqual(db.prepare('SELECT native_binding_id,native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_2'), bindings.get(threadId))
    report.cases.push({ name: 'Core crash cleanup and exact Session recovery', status: 'passed' })
    report.status = 'passed'
  } else if (mcpOnly) {
    stage = 'MCP_CANCEL'; step = 0
    await send('Call the held native MCP mutation for cancellation qualification.')
    await until(() => exists('mcp-hold.ready'), 'held native MCP')
    const run = runs().at(-1), childPid = Number(await readFile(join(project, 'mcp-hold.ready'), 'utf8'))
    const version = db.prepare('SELECT version FROM agent_run WHERE id=?').get(run.id).version
    await core.request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId, agentRunId: run.id, expectedVersion: version } })
    await until(() => runs().at(-1).status === 'cancelled', 'native MCP cancel terminal')
    await new Promise(resolve => setTimeout(resolve, 37_000))
    assert.equal(await exists('mcp-late-effect.txt'), false)
    assert.ok(!(await processTable()).some(process => process.pid === childPid), 'cancel must reap the held MCP server')
    report.cases.push({ name: 'cancel actual native MCP invocation, reap its server and prevent delayed mutation after 37 seconds', status: 'passed', run: run.id, serverPid: childPid })
    await turn('AFTER_MCP_CANCEL')
    report.status = 'passed'
  } else if (planOnly) {
    const member = await core.request('members.get', { agentId: 'agent_2' })
    const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
      agentId: 'agent_2', expectedVersion: member.version, adapterKind: 'minimax-code-cli', model: member.runtimeConfiguration.model,
      permissions: { ...member.runtimeConfiguration.permissions, values: { permission_mode: 'bypassPermissions', mode: 'plan' } }
    } })
    assert.equal(configured.status, 'applied')
    stage = 'PLAN_WRITE'; step = 0
    await send('Attempt the controlled workspace mutation under native plan mode.')
    const deadline = Date.now() + 90_000
    while (!runs().some(run => ['succeeded', 'failed', 'cancelled'].includes(run.status)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    assert.ok(runs().some(run => ['succeeded', 'failed'].includes(run.status)), 'native plan attempt must reach an authoritative terminal')
    assert.equal(await exists('result-PLAN_WRITE.txt'), true, 'native plan is a workflow mode; explicit bypassPermissions still permits tools')
    const calls = report.requests.filter(request => request.stage === stage)
    assert.ok(calls.length > 0)
    report.nativePlan = { sandboxGuarantee: 'none', explicitBypassMutationObserved: true, requests: calls, actions: events.filter(event => event.params?.agentRunId === runs().at(-1).id).map(event => event.params) }
    report.cases.push({ name: 'native plan stays a workflow mode under explicit bypassPermissions; no read-only sandbox is claimed', status: 'passed', run: runs().at(-1).id })
    report.status = 'passed'
  } else if (questionnairesOnly) {
    const binding = () => db.prepare('SELECT native_binding_id,native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_2')
    const published = id => db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE source_agent_run_id=? AND author_type='agent'").get(id).n
    const terminal = async (before, onTick = null) => {
      const deadline = Date.now() + 90_000
      while (Date.now() < deadline) {
        if (onTick) await onTick()
        const current = runs()
        if (current.length > before && ['failed', 'cancelled', 'succeeded'].includes(current.at(-1).status)) return current.at(-1)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error(`Terminal timeout for ${stage}`)
    }
    await turn('QUESTION_BASELINE')
    const originalBinding = binding()
    const nativeDb = new DatabaseSync(join(nativeData, 'v2/sqlite/runtime-state.sqlite'), { readOnly: true })
    try {
      for (const name of ['ASK_SINGLE', 'ASK_MULTIPLE', 'SEND_ASK', 'ASK_DEFAULT']) {
        if (name === 'ASK_DEFAULT') {
          const member = await core.request('members.get', { agentId: 'agent_2' })
          const changed = await core.request('members.runtime.set', { commandId: randomUUID(), command: {
            agentId: 'agent_2', expectedVersion: member.version, adapterKind: 'minimax-code-cli',
            model: member.runtimeConfiguration.model,
            permissions: { ...member.runtimeConfiguration.permissions, values: { permission_mode: 'default', mode: 'default' } }
          } })
          assert.equal(changed.status, 'applied')
        }
        stage = name; step = 0
        const before = runs().length
        await send(`CONTROL_CASE=${name}; this is a synthetic questionnaire cancellation test.`)
        const run = await terminal(before)
        assert.equal(run.status, 'succeeded', JSON.stringify(run))
        assert.equal(run.last_error_code, null)
        assert.equal(published(run.id), name === 'SEND_ASK' ? 1 : 0, 'Native dismissal produces no extra final text or empty message')
        assert.equal(db.prepare("SELECT json_extract(payload_json,'$.finalOutputDigest') AS digest FROM event_log WHERE entity_id=? AND event_type='agent_run.succeeded'").get(run.id).digest, null)
        assert.deepEqual(binding(), originalBinding)
        assert.equal(db.prepare('SELECT public_runtime_failure_json AS failure FROM agent_run WHERE id=?').get(run.id).failure, null)
        const rows = nativeDb.prepare(`SELECT request_id,status,answered_at,reply_payload,injected_at,dismissed_at
          FROM questionnaire_requests WHERE session_id=? AND json_extract(request_json,'$.title')=?`).all(originalBinding.native_session_id, name)
        assert.equal(rows.length, 1, 'Exactly one native questionnaire must be created')
        for (const row of rows) {
          assert.equal(row.status, 'dismissed')
          assert.ok(row.dismissed_at != null)
          assert.equal(row.answered_at, null); assert.equal(row.reply_payload, null); assert.equal(row.injected_at, null)
        }
        const snapshot = await core.request('camps.snapshot', { threadId })
        assert.equal(snapshot.approvals.filter(a => a.status === 'pending').length, 0)
        report.cases.push({ name, status: 'passed', run: run.id, nativeQuestionnaires: rows,
          runOutcome: run.status, publicSendCount: published(run.id) })
        const pids = await hostPids()
        if (name === 'ASK_MULTIPLE') { await core.stop(); await start() }
        stage = `AFTER_${name}`; step = 0
        const beforeSuccessor = runs().length
        await send(`CONTROL_CASE=${stage}; follow this new instruction; no questionnaire is required.`)
        const successor = await terminal(beforeSuccessor, name === 'ASK_DEFAULT' ? async () => {
          const current = await core.request('camps.snapshot', { threadId })
          for (const approval of current.approvals.filter(a => a.status === 'pending')) {
            const option = approval.options.find(o => o.kind === 'allow_once')
            assert.ok(option)
            const result = await core.request('action.approvals.resolve', { commandId: randomUUID(), threadId,
              approvalId: approval.id, expectedVersion: approval.version, optionId: option.optionId,
              reason: 'Allow the independent synthetic successor command, not a questionnaire answer' })
            assert.notEqual(result.status, 'rejected')
          }
        } : null)
        assert.equal(successor.status, 'succeeded', JSON.stringify(successor))
        assert.equal(published(successor.id), 1)
        assert.equal((await readFile(join(project, `result-${stage}.txt`), 'utf8')).trim(), `MINIMAX_CONTROL_${stage}`)
        assert.deepEqual(binding(), originalBinding)
        const successorPids = await hostPids()
        assert.ok(successorPids.length)
        if (name === 'ASK_MULTIPLE') assert.notDeepEqual(successorPids, pids)
        else assert.deepEqual(successorPids, pids)
        report.cases.push({ name: stage, status: 'passed', run: successor.id,
          sameSession: true, coreRestarted: name === 'ASK_MULTIPLE',
          sameCoreChildPids: name !== 'ASK_MULTIPLE', coreChildPids: successorPids })
      }
      // Questionnaire cancellation must leave ordinary execution approvals usable.
      for (const name of ['ALLOW', 'DENY']) {
        stage = name; step = 0; const before = runs().length; let approvals = 0
        await send(`CONTROL_CASE=${name}; exercise ordinary command approval after a questionnaire.`)
        const run = await terminal(before, async () => {
          const snapshot = await core.request('camps.snapshot', { threadId })
          for (const approval of snapshot.approvals.filter(a => a.status === 'pending')) {
            const option = approval.options.find(o => o.kind === (name === 'ALLOW' ? 'allow_once' : 'deny'))
            assert.ok(option)
            const result = await core.request('action.approvals.resolve', { commandId: randomUUID(), threadId,
              approvalId: approval.id, expectedVersion: approval.version, optionId: option.optionId,
              reason: 'Synthetic ordinary execution approval' })
            assert.notEqual(result.status, 'rejected'); approvals++
          }
        })
        assert.equal(run.status, 'succeeded', JSON.stringify(run)); assert.ok(approvals > 0)
        assert.equal(await exists(`result-${name}.txt`), name === 'ALLOW')
        assert.deepEqual(binding(), originalBinding)
        report.cases.push({ name: `ordinary ${name} after questionnaire`, status: 'passed', approvals, run: run.id })
      }
      const finalQuestions = nativeDb.prepare(`SELECT status,answered_at,reply_payload,injected_at
        FROM questionnaire_requests WHERE session_id=?`).all(originalBinding.native_session_id)
      assert.equal(finalQuestions.length, 4)
      for (const row of finalQuestions) {
        assert.equal(row.status, 'dismissed')
        assert.equal(row.answered_at, null); assert.equal(row.reply_payload, null); assert.equal(row.injected_at, null)
      }
      assert.notEqual(parseYaml(await readFile(join(nativeData, 'config.yaml'), 'utf8')).askUser?.enabled, false)
      report.cases.push({ name: 'native ask_user remains enabled; no synthetic answer injected', status: 'passed' })
      report.status = 'passed'
    } finally { nativeDb.close() }
  } else if (completionOnly) {
    await turn('SEND_EMPTY')
    const emptyFinalRun = runs().at(-1)
    const messageCount = id => db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE source_agent_run_id=? AND author_type='agent'").get(id).n
    assert.equal(messageCount(emptyFinalRun.id), 1)
    assert.equal(db.prepare("SELECT json_extract(payload_json,'$.finalOutputDigest') AS digest FROM event_log WHERE entity_id=? AND event_type='agent_run.succeeded'").get(emptyFinalRun.id).digest, null)
    // A normal follow-up keeps the Host and exact native Session; its numeric
    // observations must not be assigned to the empty-final Run's tail reader.
    const pids = await hostPids()
    await turn('AFTER_EMPTY')
    assert.deepEqual(await hostPids(), pids)
    await new Promise(resolve => setTimeout(resolve, 5000))
    const shortRunUsage = db.prepare('SELECT prompt_input_total_tokens,output_tokens,usage_quality FROM runtime_usage_run_summary WHERE agent_run_id=?').get(runs().at(-1).id)
    assert.ok(shortRunUsage?.output_tokens > 0, 'mapped terminal message Usage should be collected')
    assert.equal(shortRunUsage.usage_quality, 'runtime_reported_partial')
    report.shortRunUsage = shortRunUsage
    report.cases.push({ name: 'empty final accepts one committed send; same Host follow-up succeeds', status: 'passed' })
    for (const name of ['EMPTY_NO_SEND', 'SEND_ERROR']) {
      stage = name; step = 0
      const before = runs().length
      await send(`CONTROL_CASE=${name}`)
      const deadline = Date.now() + 90_000
      while (!(runs().length > before && ['failed', 'cancelled', 'succeeded'].includes(runs().at(-1).status))) {
        assert.ok(Date.now() < deadline, `terminal timeout for ${name}`)
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      const run = runs().at(-1)
      assert.equal(run.status, name === 'EMPTY_NO_SEND' ? 'succeeded' : 'failed', JSON.stringify(run))
      assert.equal(messageCount(run.id), name === 'SEND_ERROR' ? 1 : 0)
      if (name === 'EMPTY_NO_SEND') assert.equal(run.last_error_code, null)
      else {
        const failure = db.prepare('SELECT public_runtime_failure_json AS failure FROM agent_run WHERE id=?').get(run.id)
        assert.equal(JSON.parse(failure.failure).retryable, false)
        assert.equal(JSON.parse(failure.failure).summary, '消息已发送，但运行结束校验失败')
      }
      report.cases.push({ name, status: 'passed', run: run.id })
    }
    report.status = 'passed'
  } else if (filesOnly) {
    const folder = join(project, '文件矩阵'); await mkdir(folder)
    const editPath = join(folder, '编辑 file.txt'), newPath = join(folder, '新增 file.txt'), emptyPath = join(folder, '空 file.txt')
    const before = Array.from({ length: 40 }, (_, i) => `line-${i + 1}`).join('\n') + '\n'
    await writeFile(editPath, before); await writeFile(emptyPath, '')
    const read = path => ({ name: 'read', input: { path } })
    const write = (path, content) => ({ name: 'write', input: { path, content } })
    const edit = (oldText, newText) => ({ name: 'edit', input: { file_path: editPath, old_string: oldText, new_string: newText } })
    const cases = [
      ['FILE_READ_ABS', [read(editPath)]],
      ['FILE_READ_REL', [read('文件矩阵/编辑 file.txt')]],
      ['FILE_WRITE_NEW', [write(newPath, 'created\n')]],
      ['FILE_WRITE_EXISTING', [read(newPath), write(newPath, 'overwritten\n')]],
      ['FILE_WRITE_EMPTY', [read(emptyPath), write(emptyPath, 'was-empty\n')]],
      ['FILE_EDIT', [read(editPath), edit('line-20', 'line-20-edited')]],
      ['FILE_EDIT_BACK', [read(editPath), edit('line-20-edited', 'line-20')]],
      ['FILE_EDIT_FAILED', [read(editPath), edit('missing-old-text', 'must-not-appear')]],
      ['FILE_WRITE_REL', [write('文件矩阵/相对 file.txt', 'relative\n')]],
      ['FILE_EDIT_REL', [read('文件矩阵/相对 file.txt'), { name: 'edit', input: { file_path: '文件矩阵/相对 file.txt', old_string: 'relative', new_string: 'relative-edited' } }]],
    ]
    report.fileOperations = []
    for (const [name, plan] of cases) {
      filePlans.set(name, plan); stage = name; step = 0; const previousCount = runs().length
      await send(`Execute native file-operation fixture ${name}.`)
      await until(() => runs().length > previousCount && runs().at(-1).status === 'succeeded', name)
      const run = runs().at(-1)
      const terminal = events.filter(e => e.params?.agentRunId === run.id && e.params?.canonical?.phase === 'terminal')
      assert.equal(terminal.length, plan.length, 'one terminal per native file tool')
      for (const [index, event] of terminal.entries()) {
        assert.equal(event.params.canonical.outcome, name === 'FILE_EDIT_FAILED' && index === plan.length - 1 ? 'failed' : 'succeeded', `${name}: actual Tool outcome`)
      }
      if (name === 'FILE_EDIT') assert.equal(await readFile(editPath, 'utf8'), before.replace('line-20', 'line-20-edited'))
      for (const [index, event] of terminal.entries()) {
        const payload = event.params.payload
        if (event.params.canonical.outcome === 'failed') {
          assert.ok(!payload.runtimeFileOperation && !payload.runtimeDiff, 'failed edit must not report a successful file change'); continue
        }
        assert.equal(payload.runtimeFileOperation?.status, 'available', `${name}: typed path required`)
        if (plan[index].name === 'read') { assert.equal(payload.runtimeFileOperation.operationKind, 'read'); continue }
        if (['FILE_WRITE_NEW', 'FILE_WRITE_REL'].includes(name)) {
          assert.equal(payload.runtimeFileOperation.changeKind, 'add'); assert.ok(!payload.runtimeDiff, 'new-file input is not a result patch')
        } else {
          assert.equal(payload.runtimeDiff?.semanticKind, 'unified_diff_snapshot')
          assert.ok(payload.runtimeDiff.entries.every(entry => entry.semantics === 'unified_diff_snapshot'))
          assert.ok(!JSON.stringify(payload.runtimeDiff).includes('   ...'), 'numbered display preview must not enter Diff')
        }
      }
      const evidence = await core.request('agentRunEvidence.list', { threadId, agentRunId: run.id, afterSequence: 0, limit: 1000 })
      const snapshot = await core.request('camps.snapshot', { threadId })
      const cards = snapshot.agentRunFileChanges.filter(card => card.agentRunId === run.id)
      const expectedCard = !['FILE_READ_ABS', 'FILE_READ_REL', 'FILE_EDIT_FAILED'].includes(name)
      assert.equal(cards.length, expectedCard ? 1 : 0)
      report.fileOperations.push({ name, run: run.id, terminal: terminal.map(e => e.params), evidence, cards })
      report.cases.push({ name, status: 'passed', run: run.id })
    }
    assert.equal(await readFile(editPath, 'utf8'), before)
    assert.equal(await readFile(newPath, 'utf8'), 'overwritten\n')
    assert.equal(await readFile(emptyPath, 'utf8'), 'was-empty\n')
    assert.equal(await readFile(join(folder, '相对 file.txt'), 'utf8'), 'relative-edited\n')
    await core.stop(); await start()
    const reopened = await core.request('camps.snapshot', { threadId })
    const ordered = cards => cards.toSorted((a, b) => a.agentRunId.localeCompare(b.agentRunId))
    assert.deepEqual(ordered(reopened.agentRunFileChanges), ordered(report.fileOperations.flatMap(item => item.cards)))
    report.cases.push({ name: 'file cards survive Core restart', status: 'passed' })
    report.status = 'passed'
  } else {
  await turn('A'); const warmPids = await hostPids(); assert.ok(warmPids.length)
  await turn('B'); assert.deepEqual(await hostPids(), warmPids, 'ordinary successor must reuse Host')
  report.cases.push({ name: 'warm Host reuse', status: 'passed' })
  const binding = () => db.prepare('SELECT native_binding_id,native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(threadId, 'agent_2')
  const nativeBinding = binding()
  await core.stop(); await start(); await turn('C'); assert.deepEqual(binding(), nativeBinding)
  assert.notDeepEqual(await hostPids(), warmPids)
  report.cases.push({ name: 'cold exact native binding resume', status: 'passed' })
  stage = 'HOLD'; step = 0; await send('CONTROL_CASE=HOLD; run the waiting tool.')
  await until(() => exists('hold.ready'), 'held shell')
  const active = runs().at(-1)
  await until(() => db.prepare('SELECT output_tokens FROM runtime_usage_run_summary WHERE agent_run_id=?').get(active.id)?.output_tokens >= 5, 'active journal Usage')
  report.cases.push({ name: 'journal input/output/cache observed on active exact Session', status: 'passed' })
  const png = await readFile(join(repo, 'apps/desktop/src/renderer/src/assets/characters/muwa/icon-192.png'))
  await writeFile(join(project, 'steer.png'), png)
  await send('MINIMAX_STEER_TOKEN: continue this same Run; read the attached image.', 'steer', [{ id: randomUUID(), sourcePath: join(project, 'steer.png'), displayName: 'steer.png', kind: 'file', mediaType: 'image/png', observedByteSize: png.length }])
  await until(() => db.prepare("SELECT COUNT(*) AS n FROM runtime_input_delivery WHERE agent_run_id=? AND input_kind='steer' AND status='accepted'").get(active.id).n === 1, 'native steer acknowledgement')
  await writeFile(join(project, 'hold.release'), 'release')
  await until(() => runs().at(-1).status === 'succeeded', 'steered completion')
  assert.equal(runs().at(-1).id, active.id); assert.ok(report.requests.some(r => r.stage === 'HOLD' && r.steerVisible))
  report.cases.push({ name: 'live Steer stays in original Run', status: 'passed' })
  assert.ok(report.requests.some(r => r.stage === 'HOLD' && r.imageBlock && r.steerImagePath), 'native read must carry the authorized Steer image to the model provider')
  report.cases.push({ name: 'Steer image path + native read reaches provider as image', status: 'passed' })
  stage = 'MCP'; step = 0; const beforeMcp = runs().length
  await send('Call the assigned fixture MCP echo once.')
  await until(() => runs().length > beforeMcp && runs().at(-1).status === 'succeeded', 'MCP')
  assert.equal((await readFile(mcpMarker, 'utf8')).trim(), 'called')
  assert.ok(report.requests.some(r => r.stage === 'MCP' && r.mcpResult))
  assert.deepEqual(binding(), nativeBinding)
  report.cases.push({ name: 'assigned MCP actual call after cold resume and Steer retirement', status: 'passed' })
  const mcpConfig = await core.request('mcp.config.get')
  const removed = await core.request('mcp.assignments.set', { expectedConfigDigest: mcpConfig.configDigest, serverId: mcpId, agentId: 'agent_2', assigned: false })
  assert.equal(removed.status, 'ok', JSON.stringify(removed))
  await turn('NO_MCP')
  assert.ok(report.requests.filter(r => r.stage === 'NO_MCP').every(r => !r.tools.some(t => t.includes('minimax_fixture'))))
  assert.deepEqual(binding(), nativeBinding)
  report.cases.push({ name: 'MCP removal fences stale tools while preserving Session', status: 'passed' })
  for (const name of ['STDOUT', 'STDERR', 'EMPTY', 'NONZERO', 'LARGE']) {
    stage = name; step = 0; const before = runs().length
    await send(`Execute the ${name} output fixture.`)
    await until(() => runs().length > before && runs().at(-1).status === 'succeeded', name)
    const run = runs().at(-1)
    const result = events.find(e => e.params?.agentRunId === run.id
      && e.params?.payload?.toolCallId === `call-${name}` && e.params?.canonical?.phase === 'terminal')
    assert.ok(result, `${name}: terminal command activity missing`)
    assert.equal(result.params.canonical.outcome, name === 'NONZERO' ? 'failed' : 'succeeded')
    assert.ok(result.params.payload.input, `${name}: command input must survive sparse updates`)
    const marker = { STDOUT: 'ONLY_STDOUT', STDERR: 'ONLY_STDERR', NONZERO: 'NONZERO_STDOUT', LARGE: 'CONTROL_LARGE_' }[name]
    if (marker) assert.ok(String(result.params.payload.output).includes(marker), `${name}: output marker missing`)
    report.cases.push({ name: `command output ${name}`, status: 'passed' })
  }
  for (const name of ['ALLOW', 'DENY']) {
    const member = await core.request('members.get', { agentId: 'agent_2' })
    const changed = await core.request('members.runtime.set', { commandId: randomUUID(), command: { agentId: 'agent_2', expectedVersion: member.version, adapterKind: 'minimax-code-cli', model: member.runtimeConfiguration.model, permissions: { ...member.runtimeConfiguration.permissions, values: { permission_mode: 'default', mode: 'default' } } } })
    assert.equal(changed.status, 'applied')
    stage = name; step = 0; const before = runs().length; let approvals = 0
    await send(`Permission fixture ${name}.`)
    await until(async () => {
      const snapshot = await core.request('camps.snapshot', { threadId })
      for (const approval of snapshot.approvals.filter(a => a.status === 'pending')) {
        const option = approval.options.find(o => o.kind === (name === 'ALLOW' ? 'allow_once' : 'deny'))
        assert.ok(option, JSON.stringify(approval.options))
        const resolved = await core.request('action.approvals.resolve', { commandId: randomUUID(), threadId, approvalId: approval.id, expectedVersion: approval.version, optionId: option.optionId, reason: 'Isolated MiniMax controlled acceptance' })
        assert.notEqual(resolved.status, 'rejected'); approvals++
      }
      return runs().length > before && runs().at(-1).status === 'succeeded'
    }, name)
    assert.ok(approvals > 0, 'must cross actual native Approval')
    assert.equal(await exists(`result-${name}.txt`), name === 'ALLOW')
    assert.deepEqual(binding(), nativeBinding)
    report.cases.push({ name: `native permission ${name}`, approvals, status: 'passed' })
  }
  const memberAfterApproval = await core.request('members.get', { agentId: 'agent_2' })
  await core.request('members.runtime.set', { commandId: randomUUID(), command: { agentId: 'agent_2', expectedVersion: memberAfterApproval.version, adapterKind: 'minimax-code-cli', model: memberAfterApproval.runtimeConfiguration.model, permissions: { ...memberAfterApproval.runtimeConfiguration.permissions, values: { permission_mode: 'bypassPermissions', mode: 'default' } } } })
  await rm(join(project, 'hold.ready'), { force: true }); await rm(join(project, 'hold.release'), { force: true })
  stage = 'CANCEL'; step = 0
  await send('Run the held command for cancellation acceptance.')
  await until(() => exists('hold.ready'), 'cancel held command')
  const cancelledRun = runs().at(-1), childPid = Number(await readFile(join(project, 'hold.ready'), 'utf8'))
  const version = db.prepare('SELECT version FROM agent_run WHERE id=?').get(cancelledRun.id).version
  const cancelled = await core.request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId, agentRunId: cancelledRun.id, expectedVersion: version } })
  assert.notEqual(cancelled.status, 'rejected', JSON.stringify(cancelled))
  await until(async () => runs().at(-1).status === 'cancelled' && !(await processTable()).some(p => p.pid === childPid), 'cancel and child cleanup')
  report.cases.push({ name: 'cancel held native command and reap its process', status: 'passed' })
  const outputs = events.filter(e => e.params?.canonical?.phase === 'terminal').map(e => e.params?.payload?.output ?? '').join('\n')
  assert.ok(outputs.includes('CONTROL_STDOUT') && outputs.includes('CONTROL_STDERR'), 'command stdout/stderr must reach structured action output')
  report.cases.push({ name: 'structured command stdout + stderr', status: 'passed' })
  await core.stop()
  // Remove only this fixture's native Session while Core is stopped. Recovery
  // must classify the exact missing ID and create one replacement before input.
  const nativeDb = new DatabaseSync(join(nativeData, 'v2/sqlite/runtime-state.sqlite'))
  const history = nativeDb.prepare('SELECT history_relative_dir FROM local_runtime_sessions WHERE session_id=?').get(nativeBinding.native_session_id)
  assert.ok(history?.history_relative_dir)
  const historyRoot = resolve(nativeData, 'v2/sessions', history.history_relative_dir)
  const relativeHistory = relative(resolve(nativeData, 'v2/sessions'), historyRoot)
  assert.ok(relativeHistory && !relativeHistory.startsWith('..') && !isAbsolute(relativeHistory))
  await rename(historyRoot, join(nativeData, 'removed-fixture-session'))
  assert.equal(nativeDb.prepare('DELETE FROM local_runtime_sessions WHERE session_id=?').run(nativeBinding.native_session_id).changes, 1)
  nativeDb.close()
  await start(); await turn('MISSING_SESSION')
  assert.notEqual(binding().native_session_id, nativeBinding.native_session_id)
  assert.notEqual(binding().native_binding_id, nativeBinding.native_binding_id)
  report.cases.push({ name: 'exact missing native Session creates replacement before dispatch', status: 'passed' })
  const prompts = report.requests.filter(r => r.stage !== 'setup' && r.tools.some(name => /^(bash|shell)$/i.test(name)))
  assert.ok(prompts.every(r => r.charterCount === 1 && r.runInput), 'one system Bootstrap and normal Dynamic Context per request')
  for (const run of runs()) {
    const published = db.prepare("SELECT COUNT(*) AS n FROM camp_message WHERE source_agent_run_id=? AND author_type='agent'").get(run.id).n
    assert.equal(published, run.status === 'succeeded' ? 1 : 0, 'zero-send recovery and accepted-send suppression must publish exactly once')
  }
  report.cases.push({ name: 'zero-send recovery and accepted-send suppression', status: 'passed' })
  report.status = 'passed'
  }
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1 }
finally {
  await writeFile(join(project, 'hold.release'), 'release')
  if (db) { report.runs = runs(); report.usage = db.prepare('SELECT agent_run_id,uncached_input_tokens,cache_read_tokens,cache_write_tokens,output_tokens,usage_quality FROM runtime_usage_run_summary').all(); db.close() }
  if (core) report.exit = await core.stop()
  await new Promise(resolve => server.close(resolve))
  await writeFile(join(root, 'events.json'), JSON.stringify(events, null, 2))
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ root, status: report.status, cases: report.cases, error: report.error }, null, 2))
}
