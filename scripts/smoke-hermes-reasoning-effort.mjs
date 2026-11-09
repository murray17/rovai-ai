// Production Core + unmodified official Hermes; all observers/Provider assertions are test-only.
// node scripts/smoke-hermes-reasoning-effort.mjs <official-source> <prepared-python> [--real-model|--legacy|--deferred] [--gateway-source=/absolute/source]
import assert from 'node:assert/strict'
import {spawn, execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {mkdtemp, mkdir, symlink, readFile, writeFile, realpath} from 'node:fs/promises'
import {homedir, tmpdir} from 'node:os'
import {join, resolve, isAbsolute} from 'node:path'
import {randomUUID, createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {parse} from 'yaml'
import {startQualificationCore} from './lib/qualification-core.mjs'
import {composerDocumentForAddress} from './lib/create-configured-camp.mjs'
import {createHermesAcpObserver, holdHermesSession} from './lib/hermes-acp-observer.mjs'
const [officialSource, python, ...flags] = process.argv.slice(2)
const mode = flags.find(value => ['--real-model', '--legacy', '--deferred'].includes(value))
const gatewaySource = flags.find(value => value.startsWith('--gateway-source='))?.slice('--gateway-source='.length)
assert([officialSource, python].every(p => p && isAbsolute(p)))
assert(flags.every(value => ['--real-model', '--legacy', '--deferred'].includes(value) || value.startsWith('--gateway-source=')))
const realModel = mode === '--real-model', legacy = mode === '--legacy'
const repo = resolve(import.meta.dirname, '..'), root = await realpath(await mkdtemp(join(tmpdir(), 'rovai-hermes-effort-')))
const userHome = join(root, 'user'), nativeHome = join(userHome, '.hermes'), data = join(root, 'data'), project = join(root, 'project'), source = join(root, 'hermes-agent')
const sh = s => "'" + s.replaceAll("'", "'\\''") + "'"
const hash = s => createHash('sha256').update(s).digest('hex')
for (const p of [nativeHome, data, project, join(userHome, '.local/bin')]) await mkdir(p, {recursive: true, mode: 0o700})
await symlink(join(repo, 'target/debug/rovai'), join(userHome, '.local/bin/rovai'))
execFileSync('git', ['clone', '--shared', '--no-hardlinks', officialSource, source], {stdio: 'pipe'})
const nativeCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8'}).trim()
const nativeVersion = execFileSync('git', ['describe', '--tags', '--exact-match'], {cwd: source, encoding: 'utf8'}).trim()
execFileSync(python, ['-I', '-B', join(source, 'scripts/write_install_stamp.py'), '--output', join(source, 'install-stamp.json'), '--base-version', nativeVersion.replace(/^v/, ''), '--distance', '0', '--source', 'git', '--update-mechanism', 'self'], {cwd: source, stdio: 'pipe'})
let provider, credential, providerName = 'fixture', model = 'native-probe'
if (realModel) {
  const config = parse(await readFile(join(homedir(), '.hermes/config.yaml'), 'utf8'))
  providerName = config.model.provider; model = config.model.default; provider = config.providers[providerName]
  assert.equal(provider.transport, 'codex_responses')
  const dotenv = Object.fromEntries((await readFile(join(homedir(), '.hermes/.env'), 'utf8')).split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => {const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]}))
  credential = process.env[provider.api_key_env] || dotenv[provider.api_key_env] || provider.api_key
  assert(credential && provider.base_url)
}
const requests = [], cases = [], calls = new Map()
let core, gateway, db, viewer, failure, gatewayLog = ''
const nativeChecks = [], threads = new Set()
function respond(res, body, item) {
  const id = randomUUID(), output = {id, object: 'response', status: 'completed', output: [item], usage: {input_tokens: 100, output_tokens: 10, total_tokens: 110}}
  if (!body.stream) {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(output)); return}
  res.writeHead(200, {'content-type': 'text/event-stream'}); let seq = 0
  const emit = event => res.write('data: ' + JSON.stringify({...event, sequence_number: seq++}) + '\n\n')
  emit({type: 'response.created', response: {id, status: 'in_progress', output: []}})
  emit({type: 'response.output_item.added', output_index: 0, item})
  if (item.type === 'message') emit({type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: item.content[0].text})
  emit({type: 'response.output_item.done', output_index: 0, item}); emit({type: 'response.completed', response: output}); res.end()
}
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c)
    const bytes = Buffer.concat(chunks), body = bytes.length ? JSON.parse(bytes) : null
    if (!body) {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({data: [{id: model}]})); return}
    const input = JSON.stringify(body.input ?? []), label = [...input.matchAll(/EFFORT_CASE:(\w+)/g)].at(-1)?.[1]
    const main = (body.tools?.length ?? 0) > 0
    const record = {label, main, model: body.model, effort: body.reasoning?.effort ?? body.reasoning_effort ?? null}
    requests.push(record); assert(requests.length <= (realModel ? 40 : 80), 'Provider budget exceeded')
    if (realModel) {
      const up = await fetch(provider.base_url.replace(/\/$/, '') + req.url.replace(/^\/v1/, ''), {method: req.method,
        headers: {'content-type': 'application/json', authorization: 'Bearer ' + credential}, body: bytes, signal: AbortSignal.timeout(180000)})
      record.httpStatus = up.status; res.writeHead(up.status, {'content-type': up.headers.get('content-type') || 'application/json'})
      for await (const c of up.body) res.write(c)
      res.end(); return
    }
    const n = calls.get(label) ?? 0; if (main) calls.set(label, n + 1)
    const item = main && label && (n === 0 || label === 'DEFER' && n === 1)
      ? {id: randomUUID(), type: 'function_call', call_id: randomUUID(), name: 'terminal', arguments: JSON.stringify({command: label === 'DEFER' && n === 0
        ? `python3 -c ${sh("import pathlib,time; p=pathlib.Path('deferred-release'); end=time.monotonic()+90\nwhile not p.exists() and time.monotonic()<end: time.sleep(.1)\nassert p.exists()")}`
        : `rovai send --public-only --body EFFORT_OK_${label}`}), status: 'completed'}
      : {id: randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text: 'Done.', annotations: []}]}
    respond(res, body, item)
  } catch (e) {failure ??= String(e); res.destroy(e)}
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const config = {model: {provider: providerName, default: model}, providers: {[providerName]: {base_url: `http://127.0.0.1:${server.address().port}/v1`, api_key_env: 'EFFORT_PROBE_KEY', transport: 'codex_responses', models: [model, 'other-probe'], discover_models: false}},
  updates: {check: false}, platform_toolsets: {acp: ['terminal']}, session_title: {enabled: false}, compression: {enabled: false}, agent: {max_turns: 8, reasoning_effort: 'low'}}
await writeFile(join(nativeHome, 'config.yaml'), JSON.stringify(config), {mode: 0o600})
await writeFile(join(nativeHome, '.env'), 'EFFORT_PROBE_KEY=fixture-only\n', {mode: 0o600})
await writeFile(join(root, 'mcp.json'), '{"mcpServers":{}}')
const baseline = hash(await readFile(join(nativeHome, 'config.yaml')))
const observer = await createHermesAcpObserver(root)
const launcher = join(root, 'hermes'), bootstrap = `import sys;sys.path.insert(0,${JSON.stringify(source)});sys._hermes_pin_default_home=True;import hermes_bootstrap;import runpy;runpy.run_module('hermes_cli.main',run_name='__main__',alter_sys=True)`
await writeFile(launcher, `#!/bin/sh\ncase "$*" in *' acp') exec ${sh(process.execPath)} ${sh(observer.script)} ${sh(python)} -I -B -c ${sh(bootstrap)} "$@";; *) exec ${sh(python)} -I -B -c ${sh(bootstrap)} "$@";; esac\n`, {mode: 0o700})
let gatewayLauncher = launcher, gatewayVersion = nativeVersion
if (gatewaySource) {
  assert(isAbsolute(gatewaySource))
  const oldSource = join(root, 'gateway-source')
  execFileSync('git', ['clone', '--shared', '--no-hardlinks', gatewaySource, oldSource], {stdio: 'pipe'})
  gatewayVersion = execFileSync('git', ['describe', '--tags', '--exact-match'], {cwd: oldSource, encoding: 'utf8'}).trim()
  execFileSync(python, ['-I', '-B', join(oldSource, 'scripts/write_install_stamp.py'), '--output', join(oldSource, 'install-stamp.json'), '--base-version', gatewayVersion.replace(/^v/, ''), '--distance', '0', '--source', 'git', '--update-mechanism', 'self'], {cwd: oldSource, stdio: 'pipe'})
  const oldBootstrap = `import sys;sys.path.insert(0,${JSON.stringify(oldSource)});sys._hermes_pin_default_home=True;import hermes_bootstrap;import runpy;runpy.run_module('hermes_cli.main',run_name='__main__',alter_sys=True)`
  gatewayLauncher = join(root, 'gateway-hermes')
  await writeFile(gatewayLauncher, `#!/bin/sh\nexec ${sh(python)} -I -B -c ${sh(oldBootstrap)} "$@"\n`, {mode: 0o700})
}
const env = {HOME: userHome, HERMES_HOME: nativeHome, HERMES_DISABLE_LAZY_INSTALLS: '1', PATH: `${join(userHome, '.local/bin')}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, LANG: 'en_US.UTF-8'}
const options = {coreExecutable: join(repo, 'target/debug/rovai-core'), dataDirectory: data, workingDirectory: repo,
  runtimeCacheDirectory: join(root, 'runtime-cache'), mcpConfigPath: join(root, 'mcp.json'),
  environmentOverrides: {...Object.fromEntries(Object.keys(process.env).filter(k => k.startsWith('ROVAI_') || k.startsWith('HERMES_')).map(k => [k, undefined])), ...env, ROVAI_HERMES_BIN: launcher}}
const alive = child => child && child.exitCode === null && child.signalCode === null
const exists = async p => {try {await readFile(p); return true} catch {return false}}
async function until(fn, name, budget = 180000) {
  const end = Date.now() + budget
  while (Date.now() < end) {
    if (failure) throw Error(failure)
    for (const threadId of threads) if (db?.prepare("SELECT id FROM agent_run WHERE camp_id=? AND status='waiting'").get(threadId)) {
      const snapshot = await core.request('threads.snapshot', {threadId})
      for (const approval of snapshot.approvals.filter(a => a.status === 'pending')) {
        const choice = approval.options.find(o => o.kind === 'allow_once'); assert(choice)
        await core.request('action.approvals.resolve', {commandId: randomUUID(), threadId, approvalId: approval.id, expectedVersion: approval.version, optionId: choice.optionId, reason: 'Isolated Hermes effort fixture tool'})
      }
    }
    const r = await fn(); if (r) return r; await new Promise(r => setTimeout(r, 150))
  }
  throw Error('Timeout: ' + name)
}
const acp = async () => (await readFile(observer.log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
async function configure(agentId, effort, selectedModel = model) {
  const member = await core.request('members.get', {agentId})
  const selection = {mode: 'explicit', modelId: `custom:${providerName}:${selectedModel}`, options: effort === null ? {} : {reasoning_effort: effort}}
  const r = await core.request('members.runtime.set', {commandId: randomUUID(), command: {agentId, expectedVersion: member.version,
    adapterKind: 'hermes-cli', model: selection, permissions: {adapterKind: 'hermes-cli', schemaVersion: 1, values: {permission_mode: 'dont_ask'}}}})
  assert.equal(r.status, 'applied', JSON.stringify(r)); return selection
}
async function thread(agentId) {
  const r = await core.request('threads.create', {commandId: randomUUID(), name: 'Hermes effort', workspace: {projectPath: project}, memberAgentIds: [agentId], defaultLeadAgentId: agentId, collaborationMode: 'peer'})
  assert.equal(r.status, 'applied', JSON.stringify(r)); threads.add(r.payload.threadId); return r.payload.threadId
}
async function run(tid, agentId, label, effort, expected = 'succeeded', selectedModel = model) {
  const frozen = await configure(agentId, effort, selectedModel)
  const before = db.prepare('SELECT COALESCE(MAX(rowid),0) n FROM agent_run WHERE camp_id=?').get(tid).n
  const result = await core.request('thread.messages.send', {commandId: randomUUID(), threadId: tid,
    content: composerDocumentForAddress({mode: 'explicit', agentIds: [agentId]}, `EFFORT_CASE:${label}\nAuthorized isolated test. Directly execute rovai send --public-only --body EFFORT_OK_${label}, then finish. Do not inspect credentials or change settings.`),
    sourceAttachments: [], quotes: [], replyToThreadMessageId: null, deliveryMode: 'start', execution: {taskId: null, purpose: 'Hermes effort acceptance', completionRole: 'required'}})
  assert(['accepted', 'applied'].includes((result.commandResult ?? result).status), JSON.stringify(result))
  const ended = await until(() => db.prepare("SELECT id,status,conversation_id,runtime_model_selection_json,last_error_code FROM agent_run WHERE camp_id=? AND rowid>? AND status IN ('succeeded','failed','cancelled') ORDER BY rowid DESC LIMIT 1").get(tid, before), label)
  assert.equal(ended.status, expected, JSON.stringify(ended))
  const frozenRunSelection = JSON.parse(ended.runtime_model_selection_json)
  assert.deepEqual(frozenRunSelection.options, frozen.options)
  const session = db.prepare('SELECT native_session_id FROM conversation WHERE id=?').get(ended.conversation_id).native_session_id
  const captured = requests.filter(r => r.main && r.label === label)
  if (expected === 'succeeded') {
    assert(captured.length > 0, 'No main Provider request for ' + label)
    const expectedEffort = effort === 'default' || effort === null && !legacy ? 'low' : effort
    if (expectedEffort !== null) for (const r of captured) assert.equal(r.effort, expectedEffort, label)
    const sends = db.prepare("SELECT source_agent_run_id,author_id FROM camp_message WHERE camp_id=? AND body=?").all(tid, 'EFFORT_OK_' + label)
    assert.equal(sends.length, 1); assert.equal(sends[0].source_agent_run_id, ended.id); assert.equal(sends[0].author_id, agentId)
  } else assert.equal(captured.length, 0, 'Rejected option must not submit a task')
  const trace = await acp()
  const prompt = trace.findLast(r => r.direction === 'in' && r.method === 'session/prompt' && r.sessionId === session)
  const connection = prompt ? trace.filter(r => r.pid === prompt.pid && r.direction === 'in') : []
  const setterIndex = connection.findIndex(r => r.method === 'session/set_config_option')
  if (expected === 'succeeded') {
    if (effort === null && legacy) assert.equal(setterIndex, -1)
    else {
      assert(setterIndex >= 0 && setterIndex < connection.findIndex(r => r.method === 'session/prompt'))
      assert.equal(connection[setterIndex].configValue, effort ?? 'default')
      const modelIndex = connection.findIndex(r => r.method === 'session/set_model')
      if (modelIndex >= 0) assert(modelIndex < setterIndex)
    }
  }
  cases.push({label, frozenRunSelection, connection: connection.map(r => ({pid: r.pid, method: r.method, configId: r.configId, configValue: r.configValue})), runId: ended.id, status: ended.status, session, frozen, provider: captured, errorCode: ended.last_error_code})
  console.log('passed ' + label); return session
}
console.log(JSON.stringify({channel: 'isolated automatic acceptance', root, userHome, data, skillLibrary: join(data, 'managed-skill-library'), nativeVersion, realModel}))
try {
  gateway = spawn(gatewayLauncher, ['--profile', 'default', 'gateway', 'run', '--quiet'], {cwd: project, env, stdio: ['ignore', 'pipe', 'pipe']})
  gateway.stdout.on('data', b => {gatewayLog = (gatewayLog + b).slice(-24000)}); gateway.stderr.on('data', b => {gatewayLog = (gatewayLog + b).slice(-24000)})
  await until(async () => {if (!alive(gateway)) throw Error(gatewayLog); return exists(join(nativeHome, 'gateway.lock'))}, 'Gateway')
  core = startQualificationCore(options); await core.request('health.check')
  await until(async () => !(await core.request('runtime.status.get')).runtimeAvailability.some(r => r.runtimeKind === 'hermes-cli' && r.discovery.discoveryStatus === 'detecting'), 'discovery')
  await core.request('runtime.startup.save', {runtimeKind: 'hermes-cli', configuration: {programPath: launcher, environment: []}, expectedRevision: 0})
  const check = await core.request('runtime.product.check', {runtimeKind: 'hermes-cli'}); assert(check.ready, JSON.stringify(check))
  db = new DatabaseSync(join(data, 'rovai.sqlite'), {readOnly: true})
  const a = await thread('agent_2'), b = await thread('agent_3')
  if (mode === '--deferred') {
    assert.equal(nativeVersion, 'v0.23.0')
    const running = run(a, 'agent_2', 'DEFER', null)
    running.catch(() => {})
    await until(() => requests.some(r => r.main && r.label === 'DEFER'), 'active native prompt')
    const session = db.prepare('SELECT native_session_id FROM conversation WHERE camp_id=? AND agent_id=?').get(a, 'agent_2').native_session_id
    viewer = await holdHermesSession(launcher, env, project, session)
    const reply = await viewer.request('session/set_config_option', {sessionId: session, configId: 'reasoning_effort', type: 'select', value: 'high'})
    const observed = reply.configOptions?.find(o => o.id === 'reasoning_effort')?.currentValue
    assert.equal(observed, 'low', 'Busy native setter reports the still-active value')
    nativeChecks.push({name: 'busy_native_setter', requested: 'high', reportedBeforeBoundary: observed})
    await viewer.close(); viewer = null
    await writeFile(join(project, 'deferred-release'), 'release')
    await running
    assert.equal(await run(a, 'agent_2', 'AFTER_DEFER', null), session)
    assert.equal(requests.findLast(r => r.main && r.label === 'AFTER_DEFER').effort, 'low')
    nativeChecks.push({name: 'next_run_model_default_clears_deferred_override', providerEffort: 'low'})
  } else if (legacy) {
    await run(a, 'agent_2', 'LEGACY_BASE', null)
    await run(a, 'agent_2', 'LEGACY_OVERRIDE', 'high', 'failed')
  } else {
    const [sa, sb] = await Promise.all([run(a, 'agent_2', 'A0', 'high'), run(b, 'agent_3', 'B0', 'low')]); assert.notEqual(sa, sb)
    assert.equal(await run(a, 'agent_2', 'A1', 'low'), sa)
    assert.equal(await run(a, 'agent_2', 'A2', 'default'), sa)
    if (!realModel) {
      assert.equal(await run(a, 'agent_2', 'A3', 'none'), sa)
      assert.equal(await run(a, 'agent_2', 'A4', null), sa)
      assert.equal(requests.findLast(r => r.main && r.label === 'A4').effort, 'low', 'model default clears Session setting')
      assert.equal(await run(a, 'agent_2', 'A5', 'default'), sa)
      assert.equal(await run(a, 'agent_2', 'A6', 'high', 'succeeded', 'other-probe'), sa)
      await run(b, 'agent_3', 'BAD', 'not-a-native-effort', 'failed')
    }
    assert.equal(await run(a, 'agent_2', 'A7', 'high'), sa)
    assert.equal(await run(a, 'agent_2', 'A8', null), sa)
  }
  const trace = await acp()
  for (const c of cases) {
    const connections = trace.filter(r => r.direction === 'out' && ['session/new', 'session/resume', 'session/load'].includes(r.method) && r.sessionId === c.session)
    assert(connections.length, 'No Session evidence')
  }
  const setters = trace.filter(r => r.direction === 'in' && r.method === 'session/set_config_option')
  if (legacy) assert.equal(setters.length, 0)
  else for (const c of cases.filter(c => c.frozen.options.reasoning_effort)) assert(setters.some(r => r.sessionId === c.session && r.configValue === c.frozen.options.reasoning_effort))
  assert.equal(hash(await readFile(join(nativeHome, 'config.yaml'))), baseline)
  assert.equal(execFileSync('git', ['diff', '--name-only'], {cwd: source, encoding: 'utf8'}), '')
} catch (e) {failure = String(e); console.error(e)}
finally {
  if (viewer) await viewer.close(); db?.close(); if (core) await core.stop()
  if (alive(gateway)) {gateway.kill('SIGTERM'); await Promise.race([new Promise(r => gateway.once('exit', r)), new Promise(r => setTimeout(r, 15000))]); if (alive(gateway)) gateway.kill('SIGKILL')}
  server.closeAllConnections(); await new Promise(r => server.close(r))
  await writeFile(join(root, 'gateway.log'), gatewayLog, {mode: 0o600})
  await writeFile(join(root, 'result.json'), JSON.stringify({nativeVersion, nativeCommit, gatewayVersion, realModel, legacy, nativeChecks, cases, requests, failure, configUnchanged: hash(await readFile(join(nativeHome, 'config.yaml'))) === baseline, coreStderr: core?.stderrTail}, null, 2), {mode: 0o600})
}
console.log(JSON.stringify({root, failure, cases: cases.length}))
if (failure) process.exitCode = 1
