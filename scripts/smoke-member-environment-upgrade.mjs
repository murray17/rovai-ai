// Cross-version acceptance owner: the previous Core must create the native binding
// itself. A stored-ID-only unit fixture cannot prove that the next CLI resumes it.
// Usage: node scripts/smoke-member-environment-upgrade.mjs /absolute/old/rovai-core [candidate-core]
// Adapter-only regressions: replace the old Core path with --adapter-regressions.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'

const previousCore = process.argv[2]
const adapterRegressionsOnly = previousCore === '--adapter-regressions'
assert.ok(adapterRegressionsOnly || (previousCore && isAbsolute(previousCore)), 'Supply the absolute pre-upgrade Core path (with its adjacent rovai CLI) or --adapter-regressions')
assert.ok(process.platform !== 'win32' || adapterRegressionsOnly, 'Windows supports the adapter regressions; no cross-version claim')
const candidateCore = resolve(process.argv[3] ?? join(import.meta.dirname, '../target/debug/rovai-core' + (process.platform === 'win32' ? '.exe' : '')))
const fixture = process.platform === 'win32'
  ? join(tmpdir(), 'rovai-env-upgrade-' + crypto.randomUUID())
  : await realpath(await mkdtemp(join(tmpdir(), 'rovai-env-upgrade-')))
if (process.platform === 'win32') preparePrivate(fixture)
console.error('Protocol fixture: ' + fixture)

function preparePrivate(path) {
  const result = spawnSync(candidateCore, ['--prepare-windows-data-root', path], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
}
async function writeFixture(path, source) {
  if (process.platform !== 'win32') return writeFile(path, source)
  const python = process.env.ROVAI_TEST_PYTHON
  assert.ok(python && isAbsolute(python), 'Provide an explicit native Windows Python executable')
  await writeFile(path + '.py', source)
  await writeFile(path, `@echo off\r\n"${python}" -X utf8 -u "%~f0.py" %*\r\nexit /b %ERRORLEVEL%\r\n`)
}
const results = []
const failures = []
try {
  for (const kind of adapterRegressionsOnly ? [] : ['claude-code-cli', 'codex-cli']) {
    const directory = join(fixture, kind)
    const data = join(directory, 'core'), home = join(directory, 'home')
    await mkdir(data, { recursive: true })
    await mkdir(join(home, '.claude'), { recursive: true })
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.claude/settings.json'), JSON.stringify({ env: {
      ANTHROPIC_BASE_URL: 'https://host.invalid', ANTHROPIC_API_KEY: 'fixture-host-claude'
    } }))
    await writeFile(join(home, '.codex/config.toml'), 'model_provider = "fixture"\nmodel = "fixture-model"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "https://host.invalid/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n')
    const executable = join(directory, kind)
    await writeFixture(executable, syntheticCli(kind))
    await chmod(executable, 0o700)
    console.error(`Isolated upgrade acceptance: data=${data}; skills=${join(data, 'managed-skill-library')}; MCP=${join(data, 'mcp.json')}`)
    const databasePath = join(data, 'rovai.sqlite')
    const query = (sql, ...params) => {
      const db = new DatabaseSync(databasePath, { readOnly: true })
      try { return db.prepare(sql).get(...params) } finally { db.close() }
    }
    const records = async () => (await readFile(join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    let core
    try {
      core = startCore(previousCore, 'before')
      await core.request('health.check')
      assert.equal(query('SELECT projection_schema_version AS version FROM rovai_data_contract').version, 142,
        'The initial Core must be the supported version before environment snapshot retirement')
      await core.request('runtime.discovery.rescan', { interactiveShell: false })
      const profile = await core.request('members.get', { agentId: 'agent_1' })
      const configured = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
        agentId: 'agent_1', expectedVersion: profile.version, adapterKind: kind,
        model: { mode: 'runtime_default' }, permissions: { adapterKind: kind, schemaVersion: 1,
          values: kind === 'codex-cli' ? { sandbox_mode: 'danger-full-access', approval_policy: 'never' } : { permission_mode: 'acceptEdits' } },
        environment: { expectedRevision: 0, json: JSON.stringify({ UPGRADE_MEMBER_VALUE: 'member-current',
          UPGRADE_MEMBER_SECRET: 'fixture-member-key' }) }
      } })
      assert.equal(configured.status, 'applied')
      const created = await core.request('threads.create', { commandId: crypto.randomUUID(), name: 'Upgrade resume',
        workspace: { projectPath: directory }, memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
      assert.equal(created.status, 'applied')
      const campId = created.payload.threadId
      const send = async body => {
        const result = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: campId,
          content: composerDocumentForAddress({ mode: 'default' }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
          execution: { taskId: null, purpose: 'Verify native resume across upgrade', completionRole: 'required' } })
        assert.equal(result.commandResult.status, 'accepted')
      }
      const settled = async count => await waitFor(() => {
        const row = query('SELECT COUNT(*) AS total, SUM(status IN (\'succeeded\',\'failed\',\'cancelled\')) AS settled FROM agent_run WHERE camp_id=?', campId)
        if (row.total !== count || row.settled !== count) return false
        const failed = query("SELECT status, last_error_code, last_error_details_ref FROM agent_run WHERE camp_id=? AND status!='succeeded' LIMIT 1", campId)
        assert.ok(!failed, `Synthetic native execution must succeed: ${JSON.stringify(failed)}`)
        return true
      }, () => JSON.stringify(query('SELECT status,last_error_code,last_error_details_ref FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId)) + core.diagnostics())
      await send('UPGRADE_FIRST_INPUT')
      await settled(1)
      await core.stop()
      const before = query('SELECT * FROM conversation WHERE camp_id=? AND agent_id=?', campId, 'agent_1')
      assert.ok(before.native_session_id, `Previous Core must establish a native session through execution: ${JSON.stringify(query('SELECT status, last_error_code, last_error_details_ref FROM agent_run WHERE camp_id=?', campId))}`)
      assert.equal(query("SELECT json_extract(effective_config_json, '$.runtime.customApi') AS connection FROM agent_run WHERE camp_id=?", campId).connection, null,
        'Previous member-env binding must exclude the default Host connection')
      const firstRequests = await records()
      const firstSession = firstRequests.find(r => r.event === 'session')
      assert.equal(firstSession.method, kind === 'codex-cli' ? 'thread/start' : 'start')
      assert.equal(firstSession.id, before.native_session_id)
      assert.equal(firstSession.member, 'member-current')
      assert.equal(firstSession.host, 'before')
      assert.equal(firstSession.key, 'fixture-member-key')
      assert.ok(query('SELECT COUNT(*) AS total FROM conversation_runtime_environment').total > 0)

      // Simulate changed installation/config/context identity, and an unavailable
      // historical Bootstrap blob. Neither may take away the exact resume target.
      const fixtureDb = new DatabaseSync(databasePath)
      try {
        const columns = fixtureDb.prepare('PRAGMA table_info(adapter_installation)').all().map(row => row.name)
        const oldInstall = fixtureDb.prepare('SELECT * FROM adapter_installation WHERE id=?').get(before.native_adapter_installation_id)
        const legacyInstall = `legacy-${oldInstall.id}`
        fixtureDb.prepare(`INSERT INTO adapter_installation (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
          .run(...columns.map(column => column === 'id' ? legacyInstall : column === 'auth_scope' ? `legacy-${oldInstall[column]}` : oldInstall[column]))
        fixtureDb.prepare("UPDATE conversation SET native_adapter_installation_id=?, native_binding_compatibility_digest='old-context-and-connection', native_installation_generation=999, native_session_compatibility_key='old-storage-identity' WHERE id=?")
          .run(legacyInstall, before.id)
        fixtureDb.prepare("UPDATE native_session_bootstrap_evidence SET session_charter_digest='unavailable-old-bootstrap' WHERE native_binding_id=?")
          .run(before.native_binding_id)
      } finally { fixtureDb.close() }

      // New Host process, same persisted member config and same native files.
      // Changing this inherited value proves the old environment was not restored.
      core = startCore(candidateCore, 'after')
      await core.request('health.check')
      assert.equal(query('SELECT projection_schema_version AS version FROM rovai_data_contract').version, 145)
      assert.equal(query("SELECT COUNT(*) AS total FROM sqlite_master WHERE name IN ('conversation_runtime_environment','runtime_environment_plan')").total, 0)
      await send('UPGRADE_SECOND_INPUT')
      await settled(2)
      await core.stop()
      const newRequests = (await records()).slice(firstRequests.length)
      const resumed = newRequests.find(r => r.event === 'session')
      assert.ok(resumed, 'The upgraded Core must launch a CLI')
      assert.equal(resumed.method, kind === 'codex-cli' ? 'thread/resume' : 'resume', 'Actual CLI request must resume the old native session')
      assert.equal(resumed.id, before.native_session_id)
      assert.equal(resumed.member, 'member-current')
      assert.equal(resumed.host, 'after', 'The new CLI must inherit the current Host environment')
      assert.equal(resumed.key, 'fixture-member-key', 'Member overrides must reach the new CLI')
      const after = query('SELECT native_binding_id, native_binding_generation FROM conversation WHERE id=?', before.id)
      assert.equal(after.native_binding_id, before.native_binding_id)
      assert.equal(after.native_binding_generation, before.native_binding_generation)
      const inputs = newRequests.filter(r => r.event === 'input').map(r => r.body).join('\n')
      assert.equal(newRequests.filter(r => r.event === 'input' && r.body.includes('UPGRADE_SECOND_INPUT')).length, 1, 'Submit the new business input exactly once')
      assert.ok(!inputs.includes('UPGRADE_FIRST_INPUT'), 'Do not replay previously received business input')
      if (kind === 'codex-cli') {
        const serverId = crypto.randomUUID()
        await writeFile(join(data, 'mcp.json'), JSON.stringify({
          mcpServers: { fixture: { command: '/usr/bin/false' } },
          _rovai: { schemaVersion: 2,
            servers: { fixture: { serverId, enabled: true, source: 'user', riskLevel: 'standard' } },
            assignments: [{ serverId, agentId: 'agent_1' }] }
        }), { mode: 0o600 })
        let expectedRuns = 2
        for (const stage of ['mcp-error', 'auth-error']) {
          const offset = (await records()).length
          core = startCore(candidateCore, stage); await core.request('health.check')
          await send(`INPUT_${stage}`)
          expectedRuns++
          await waitFor(() => {
            const count = query("SELECT COUNT(*) AS total, SUM(status IN ('succeeded','failed','cancelled')) AS settled FROM agent_run WHERE camp_id=?", campId)
            return count.total === expectedRuns && count.settled === expectedRuns
          }, () => core.diagnostics())
          assert.equal(query('SELECT status FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId).status, 'failed', stage)
          await core.stop()
          const attempted = (await records()).slice(offset)
          assert.ok(attempted.some(r => r.event === 'rpc' && r.stage === stage && r.method === (stage === 'mcp-error' ? 'config/read' : 'account/read')), `${stage}: exercise the actual failing request`)
          assert.equal(attempted.filter(r => r.event === 'session' || r.event === 'input').length, 0, `${stage}: no replacement or input`)
          assert.equal(query('SELECT native_session_id FROM conversation WHERE id=?', before.id).native_session_id, before.native_session_id)
        }
      }
      results.push({ kind, resumed: resumed.method, sameNativeSession: true, currentEnvironment: true })
    } catch (error) {
      failures.push(new Error(`${kind}: ${error.message}`, { cause: error }))
    } finally {
      await core?.stop()
      await removeEphemeralRuntimeCampFilesRoot(data, { homeDirectory: home })
    }

    function startCore(binary, stage) {
      return connectCore(binary, [
        ...coreDataDirectoryArguments(data, { homeDirectory: home }),
        '--skill-library-root', join(data, 'managed-skill-library'), '--mcp-config-path', join(data, 'mcp.json')
      ], directory, { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/sh', TMPDIR: directory,
        ROVAI_CLAUDE_CODE_BIN: kind === 'claude-code-cli' ? executable : '/nonexistent/claude',
        ROVAI_CODEX_BIN: kind === 'codex-cli' ? executable : '/nonexistent/codex',
        CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'),
        ANTHROPIC_API_KEY: 'fixture-host-claude', OPENAI_API_KEY: 'fixture-host-codex',
        UPGRADE_MEMBER_VALUE: 'host-default', UPGRADE_MEMBER_SECRET: 'fixture-host-value', UPGRADE_HOST_VALUE: stage })
    }
  }
  try { results.push(await acpFallbackAcceptance(fixture, candidateCore)) } catch (error) { failures.push(error) }
  try { results.push(await piConversationAcceptance(fixture, candidateCore)) } catch (error) { failures.push(error) }
  if (failures.length) throw new AggregateError(failures, 'Native session upgrade acceptance failed')
  console.log(JSON.stringify({ ok: true, results }))
} finally {
  // Keep native Windows private evidence for the audit. Unix keeps its prior lifecycle.
  if (process.platform !== 'win32') await rm(fixture, { recursive: true, force: true })
}

async function waitFor(probe, describe) {
  const deadline = Date.now() + 45000
  while (Date.now() < deadline) {
    if (await probe()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Execution did not settle: ${describe()}`)
}

function connectCore(binary, args, cwd, env) {
  if (process.platform === 'win32') env = { ...env, SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec, PATH: process.env.PATH, USERPROFILE: env.HOME,
    LOCALAPPDATA: join(cwd, 'local'), APPDATA: join(cwd, 'roaming'), TEMP: cwd, TMP: cwd }
  const child = spawn(binary, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const closed = once(child, 'close'), pending = new Map()
  let nextId = 0, stderr = ''
  child.stderr.on('data', data => { stderr += data })
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line), entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  child.on('close', (code, signal) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Core exited (${signal ?? code}): ${stderr}`)) }
    pending.clear()
  })
  return {
    diagnostics() { return stderr },
    request(method, params = {}) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}; ${stderr}`)) }, 30000)
        pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.stdin.end()
      const timer = setTimeout(() => child.kill('SIGTERM'), 10000)
      try { await closed } finally { clearTimeout(timer) }
    }
  }
}

function syntheticCli(kind) {
  return `#!/usr/bin/python3
import json, os, sys, uuid
kind = ${JSON.stringify(kind)}
def emit(message): print(json.dumps(message), flush=True)
def record(event, **fields):
    with open(os.path.join(os.path.dirname(__file__), 'requests.jsonl'), 'a') as output:
        output.write(json.dumps(dict(event=event, **fields)) + '\\n')
def session(method, sid):
    record('session', method=method, id=sid, member=os.getenv('UPGRADE_MEMBER_VALUE'), host=os.getenv('UPGRADE_HOST_VALUE'), key=os.getenv('UPGRADE_MEMBER_SECRET'))
if '--version' in sys.argv:
    print('codex-cli 0.141.0' if kind == 'codex-cli' else '2.1.287 (Claude Code)')
    sys.exit(0)
sid = str(uuid.uuid4())
if kind == 'claude-code-cli':
    option = '--resume' if '--resume' in sys.argv else '--session-id'
    sid = sys.argv[sys.argv.index(option) + 1]
    session('resume' if option == '--resume' else 'start', sid)
for line in sys.stdin:
    request = json.loads(line)
    if kind == 'claude-code-cli':
        if request.get('type') == 'control_request':
            emit({'type':'control_response','response':{'subtype':'success','request_id':request['request_id'],'response':{}}})
        elif request.get('type') == 'user':
            record('input', body=json.dumps(request))
            emit({'type':'result','subtype':'success','is_error':False,'session_id':sid,'result':'upgrade fixture complete'})
            emit({'type':'system','subtype':'session_state_changed','state':'idle','session_id':sid})
    else:
        if 'id' not in request: continue
        method = request['method']
        stage = os.getenv('UPGRADE_HOST_VALUE')
        record('rpc', method=method, stage=stage)
        if (stage == 'mcp-error' and method == 'config/read') or (stage == 'auth-error' and method == 'account/read'):
            emit({'id':request['id'],'error':{'code':-32603,'message':stage + ': incompatible method not found'}})
            continue
        result = {}
        if method == 'account/read': result = {'account':None,'requiresOpenaiAuth':False}
        elif method == 'config/read': result = {'config':{'mcp_servers':{}}}
        elif method in ('thread/start','thread/resume'):
            sid = request.get('params', {}).get('threadId', sid)
            session(method, sid)
            result = {'thread':{'id':sid}}
        elif method == 'turn/start':
            record('input', body=json.dumps(request))
            result = {'turn':{'id':str(uuid.uuid4())}}
        emit({'id':request['id'],'result':result})
        if method == 'turn/start':
            emit({'method':'turn/completed','params':{'threadId':sid,'turn':{'id':result['turn']['id'],'status':'completed','items':[{'type':'agentMessage','text':'upgrade fixture complete'}]}}})
`
}

// Check the process boundary before initialize/activation, where a real CLI may
// validate its additional directories. Do not let later lease binding repair it.
function processContextProbe(log) {
  return `
if os.environ.get('ROVAI_CLI_CONTEXT'):
    context_path = os.environ['ROVAI_CLI_CONTEXT']
    with open(context_path) as source: context = json.load(source)
    run_tmp = os.environ['ROVAI_RUN_TMP']
    launch = dict(method='process/start', stage=os.getenv('RESUME_CASE'), pid=os.getpid(), cwd=os.getcwd(),
        contextPath=context_path, processId=context['processId'], runTmp=run_tmp,
        runTmpExists=os.path.isdir(run_tmp), unbound=context.get('lease') is None)
    with open(${JSON.stringify(log)}, 'a') as output: output.write(json.dumps(launch) + '\\n')
    if not launch['runTmpExists'] or not launch['unbound']:
        sys.exit('new Runtime requires an existing run-tmp and an unbound process context')
`
}

function assertFreshProcessContexts(launches, cwd) {
  assert.ok(launches.length > 0, 'observe the actual CLI startup boundary')
  for (const launch of launches) {
    assert.equal(launch.cwd, cwd, 'keep the project as the process working directory')
    assert.equal(launch.runTmpExists, true, 'run-tmp must exist before initialize/activation')
    assert.equal(launch.unbound, true, 'a new process must not inherit an old active lease')
  }
  for (const field of ['processId', 'contextPath', 'runTmp']) {
    assert.equal(new Set(launches.map(row => row[field])).size, launches.length,
      `each newly launched process must own a distinct ${field}`)
  }
}

// Reuse this isolated Core/CLI owner for the production fallback sequence. The
// CLI only speaks ACP; all preparation, binding, failure and dispatch are Core's.
async function acpFallbackAcceptance(root, binary) {
  const directory = join(root, 'acp-fallback'), data = join(directory, process.platform === 'win32' ? 'Core' : 'core'), home = join(directory, 'home')
  if (process.platform === 'win32') preparePrivate(directory)
  await mkdir(home, { recursive: true })
  const executable = join(directory, process.platform === 'win32' ? 'traecli.cmd' : 'traecli'), log = join(directory, 'requests.jsonl')
  await writeFixture(executable, `#!/usr/bin/python3
import json, os, sys, uuid, time
stage = os.environ['RESUME_CASE']
if '--version' in sys.argv:
    print('traecli 0.3.0'); sys.exit(0)
if 'models' in sys.argv:
    print('[{"name":"model-a","context_window":168000},{"name":"model-b","context_window":168000}]'); sys.exit(0)
${processContextProbe(log)}
for line in sys.stdin:
    request = json.loads(line)
    if 'id' not in request: continue
    method, params = request['method'], request.get('params', {})
    with open(${JSON.stringify(log)}, 'a') as output:
        output.write(json.dumps(dict(stage=stage, method=method, params=params, environment=os.environ.get('RESUME_ENV'), pid=os.getpid())) + '\\n')
    error, error_code = None, -32603
    if method == 'initialize':
        result = {'protocolVersion':1,'agentCapabilities':{'loadSession':not stage.startswith('unsupported')}}
        if stage.startswith('resume-'): result['agentCapabilities']['sessionCapabilities'] = {'resume':{}}
        if stage == 'initialize-error': error = 'initialize: incompatible method not found'
        if stage == 'initialize-method-missing': error, error_code = 'initialize unavailable', -32601
    elif method in ('session/new','session/load','session/resume'):
        sid = params.get('sessionId', str(uuid.uuid4()))
        result = {'sessionId':sid, 'models':{'currentModelId':'model-a','availableModels':[{'modelId':'model-a','name':'A'},{'modelId':'model-b','name':'B'}]}, 'modes':{'currentModeId':'default','availableModes':[{'id':'default','name':'Default'}]}}
        if stage in ('unsupported-new-fails','load-unsupported-new-fails') and method == 'session/new': error = 'replacement failed'
        if (stage.startswith('load-unsupported') and method == 'session/load') or (stage.startswith('resume-') and method == 'session/resume') or (stage == 'resume-and-load-unsupported' and method == 'session/load'):
            error, error_code = 'unavailable', -32601
        if stage in ('restore-error','mcp-error') and method == 'session/load': error = stage + ': incompatible method not found'
        if stage in ('cancel','timeout') and method == 'session/load': time.sleep(90)
    elif method in ('session/set_model','session/set_config_option'):
        result = {}
        if stage == 'model-error': error = 'model: incompatible method not found'
        if stage == 'model-method-missing': error, error_code = 'model unavailable', -32601
    elif method == 'session/prompt':
        print(json.dumps({'jsonrpc':'2.0','method':'session/update','params':{'sessionId':params['sessionId'],'update':{'sessionUpdate':'agent_message_chunk','content':{'type':'text','text':'fallback fixture complete'}}}}), flush=True)
        if stage == 'input-unknown': sys.exit(1)
        result = {'stopReason':'end_turn'}
    else: result = {}
    reply = {'jsonrpc':'2.0','id':request['id']}
    reply['error' if error else 'result'] = {'code':error_code,'message':error} if error else result
    print(json.dumps(reply), flush=True)
`)
  await chmod(executable, 0o700)
  const query = (sql, ...params) => {
    const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
    try { return db.prepare(sql).get(...params) } finally { db.close() }
  }
  const records = async () => {
    try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const start = stage => connectCore(binary, [...coreDataDirectoryArguments(data, { homeDirectory: home }),
    '--skill-library-root', join(data, 'skills'), '--mcp-config-path', join(data, 'mcp.json')], directory,
    { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/sh', TMPDIR: directory, ROVAI_TRAE_CN_BIN: executable,
      ROVAI_CODEX_BIN: '/nonexistent/codex', ROVAI_CLAUDE_CODE_BIN: '/nonexistent/claude', RESUME_CASE: stage })
  let core, campId, total = 0
  const send = async body => {
    const result = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: campId,
      content: composerDocumentForAddress({ mode: 'default' }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
      execution: { taskId: null, purpose: 'Verify bounded native fallback', completionRole: 'required' } })
    assert.equal(result.commandResult.status, 'accepted'); total++
  }
  const settle = async expected => {
    await waitFor(() => {
      const row = query("SELECT COUNT(*) AS total, SUM(status IN ('succeeded','failed','cancelled')) AS settled FROM agent_run WHERE camp_id=?", campId)
      return row.total === total && row.settled === total
    }, () => JSON.stringify(query('SELECT status,last_error_code FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId)))
    const run = query('SELECT * FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId)
    assert.equal(run.status, expected, JSON.stringify({ stage: total, code: run.last_error_code }))
    return run
  }
  try {
    core = start('seed'); await core.request('health.check')
    await core.request('runtime.discovery.rescan', { interactiveShell: false })
    const profile = await core.request('members.get', { agentId: 'agent_1' })
    const configured = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: 'agent_1', expectedVersion: profile.version, adapterKind: 'trae-cn-cli',
      model: { mode: 'explicit', modelId: 'model-b', options: {} },
      permissions: { adapterKind: 'trae-cn-cli', schemaVersion: 1, values: { permission_mode: 'default' } },
      environment: { expectedRevision: 0, json: JSON.stringify({ RESUME_ENV: 'A' }) }
    } })
    assert.equal(configured.status, 'applied', JSON.stringify(configured))
    const created = await core.request('threads.create', { commandId: crypto.randomUUID(), name: 'Fallback acceptance',
      workspace: { projectPath: directory }, memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
    campId = created.payload.threadId
    await send('SEED_INPUT'); await settle('succeeded')
    const firstPrompt = (await records()).find(r => r.method === 'session/prompt')
    assert.equal(firstPrompt.environment, 'A')
    const originalId = query('SELECT native_session_id FROM conversation WHERE camp_id=?', campId).native_session_id
    const currentProfile = await core.request('members.get', { agentId: 'agent_1' })
    const updated = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: 'agent_1', expectedVersion: currentProfile.version, adapterKind: 'trae-cn-cli',
      model: { mode: 'explicit', modelId: 'model-b', options: {} },
      permissions: { adapterKind: 'trae-cn-cli', schemaVersion: 1, values: { permission_mode: 'default' } },
      environment: { expectedRevision: 1, json: JSON.stringify({ RESUME_ENV: 'B' }) }
    } })
    assert.equal(updated.status, 'applied', JSON.stringify(updated))
    await send('WARM_AFTER_SAVE_B'); await settle('succeeded')
    const warmPrompt = (await records()).filter(r => r.method === 'session/prompt').at(-1)
    assert.equal(warmPrompt.environment, 'A', 'Saved B must not mutate the running process')
    assert.equal(warmPrompt.pid, firstPrompt.pid)
    assert.equal(warmPrompt.params.sessionId, originalId)
    await core.stop()
    const fixtureDb = new DatabaseSync(join(data, 'rovai.sqlite'))
    try {
      fixtureDb.prepare("UPDATE conversation SET native_binding_compatibility_digest='changed-context-only' WHERE camp_id=?").run(campId)
      fixtureDb.prepare("UPDATE native_session_bootstrap_evidence SET session_charter_digest='changed-initialization-copy' WHERE native_binding_id IN (SELECT native_binding_id FROM conversation WHERE camp_id=?)").run(campId)
    } finally { fixtureDb.close() }
    const coldOffset = (await records()).length
    core = start('seed'); await core.request('health.check')
    await send('COLD_AFTER_SAVE_B_AND_CONTEXT_CHANGE'); await settle('succeeded')
    const coldRecords = (await records()).slice(coldOffset)
    assert.equal(coldRecords.filter(r => r.method === 'session/load').length, 1)
    assert.equal(coldRecords.find(r => r.method === 'session/load').params.sessionId, originalId)
    const coldPrompt = coldRecords.find(r => r.method === 'session/prompt')
    assert.equal(coldPrompt.environment, 'B')
    assert.notEqual(coldPrompt.pid, firstPrompt.pid)
    assert.equal(coldRecords.filter(r => r.method === 'session/prompt').length, 1)
    await core.stop()
    const replacements = ['unsupported-new-fails','unsupported','load-unsupported-new-fails','load-unsupported','resume-and-load-unsupported']
    const successful = ['unsupported','load-unsupported','resume-and-load-unsupported','resume-unsupported-load-success']
    for (const stage of [...replacements, 'resume-unsupported-load-success','initialize-method-missing','model-method-missing','initialize-error','restore-error','model-error','mcp-error','cancel','timeout','input-unknown']) {
      const before = query('SELECT native_session_id FROM conversation WHERE camp_id=?', campId).native_session_id
      assert.ok(before)
      core = start(stage); await core.request('health.check')
      await send(`INPUT_${stage}`)
      if (stage === 'cancel') {
        await waitFor(async () => (await records()).some(r => r.stage === stage && r.method === 'session/load'), () => 'await load before cancellation')
        const run = query('SELECT id,version FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId)
        const cancelled = await core.request('agentRuns.cancel', { commandId: crypto.randomUUID(), command: { campId, agentRunId: run.id, expectedVersion: run.version } })
        assert.equal(cancelled.status, 'applied', JSON.stringify(cancelled))
      }
      const run = await settle(successful.includes(stage) ? 'succeeded' : stage === 'cancel' ? 'cancelled' : 'failed')
      await core.stop()
      const actual = (await records()).filter(r => r.stage === stage)
      const launches = actual.filter(r => r.method === 'process/start')
      assertFreshProcessContexts(launches, directory)
      assert.equal(launches.length, stage.startsWith('load-unsupported') || stage === 'resume-and-load-unsupported' ? 2 : 1, stage)
      const after = query('SELECT native_session_id FROM conversation WHERE camp_id=?', campId).native_session_id
      assert.equal(actual.filter(r => r.method === 'session/new').length, replacements.includes(stage) ? 1 : 0, stage)
      assert.equal(actual.filter(r => r.method === 'session/prompt').length, successful.includes(stage) || stage === 'input-unknown' ? 1 : 0, stage)
      const replaced = replacements.includes(stage) && successful.includes(stage)
      if (replaced) assert.notEqual(after, before)
      else assert.equal(after, before, `${stage}: retain the old target`)
      for (const restored of actual.filter(r => ['session/load','session/resume'].includes(r.method))) assert.equal(restored.params.sessionId, before)
      if (stage.startsWith('load-') || stage.startsWith('resume-')) assert.equal(actual.filter(r => r.method === 'session/load').length, 1, stage)
      if (stage.startsWith('resume-')) assert.equal(actual.filter(r => r.method === 'session/resume').length, 1, stage)
      if (stage === 'input-unknown') assert.ok(['accepted','delivery_unknown'].includes(query('SELECT status FROM runtime_input_delivery WHERE agent_run_id=?', run.id).status))
      const notice = query("SELECT COUNT(*) AS total FROM event_log WHERE entity_id=? AND event_type='agent_run.native_session_continuity_lost' AND json_extract(payload_json,'$.continuation')='native_session_replaced'", run.id)
      assert.equal(notice.total, replaced ? 1 : 0, stage)
    }
    return { kind: 'trae-cn-cli', fallbackOnce: true, replacementFailureKeepsTarget: true, unknownErrorsDoNotFallback: true, noDuplicateInput: true, warmKeepsAAfterSavingB: true, coldUsesBAndOriginalIdAfterContextChange: true, freshProcessContexts: true }
  } finally { await core?.stop(); await removeEphemeralRuntimeCampFilesRoot(data, { homeDirectory: home }) }
}

// Exercise both Conversation kinds through Core's normal send/bind/Fleet paths.
// The mock retains native files and logs real switch_session targets and inputs.
async function piConversationAcceptance(root, binary) {
  const directory = join(root, 'pi-conversations'), data = join(directory, process.platform === 'win32' ? 'Core' : 'core'), home = join(directory, 'home')
  if (process.platform === 'win32') preparePrivate(directory)
  await mkdir(home, { recursive: true })
  const executable = join(directory, process.platform === 'win32' ? 'pi.cmd' : 'pi'), log = join(directory, 'requests.jsonl')
  await writeFixture(executable, `#!/usr/bin/python3
import json, os, sys, uuid
if '--version' in sys.argv:
    print('0.84.4'); sys.exit(0)
${processContextProbe(log)}
native_root = os.path.join(os.path.dirname(__file__), 'native-sessions')
os.makedirs(native_root, exist_ok=True)
sid, session_file = None, None
def emit(value): print(json.dumps(value), flush=True)
def new_session():
    global sid, session_file
    sid = str(uuid.uuid4())
    session_file = os.path.join(native_root, sid + '.jsonl')
    with open(session_file, 'w') as output: output.write(json.dumps({'type':'session','id':sid,'cwd':os.getcwd()}) + '\\n')
def managed_state():
    with open(os.environ['ROVAI_PI_HOST_BINDING_FILE']) as source: binding = json.load(source)
    state = {'schemaVersion':3,'extensionVersion':'rovai-pi-host-v8','hostInstanceId':binding['hostInstanceId'],'hostBindingGeneration':binding['hostBindingGeneration'],'sessionId':sid,'sessionFile':session_file,'cwd':os.getcwd()}
    emit({'type':'extension_ui_request','method':'setStatus','statusKey':'rovai-managed-session-state','statusText':json.dumps(state)})
new_session()
for line in sys.stdin:
    request = json.loads(line)
    method = request['type']
    result = {}
    if method == 'new_session': new_session(); result = {'cancelled':False}
    elif method == 'switch_session':
        session_file = request['sessionPath']
        with open(session_file) as source: sid = json.loads(source.readline())['id']
        result = {'cancelled':False}
    elif method == 'get_state':
        managed_state()
        result = {'sessionId':sid,'sessionFile':session_file,'model':{'provider':'fixture','id':'fixture-model','input':['text']},'thinkingLevel':'off'}
    elif method == 'get_available_models': result = {'models':[{'provider':'fixture','id':'fixture-model','name':'Fixture'}]}
    with open(${JSON.stringify(log)}, 'a') as output:
        output.write(json.dumps({'method':method,'request':request,'sessionId':sid,'sessionFile':session_file,'pid':os.getpid()}) + '\\n')
    emit({'type':'response','id':request['id'],'success':True,'command':method,'data':result})
    if method == 'prompt':
        emit({'type':'agent_start'})
        emit({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[{'type':'text','text':'conversation fixture complete'}]}})
        emit({'type':'agent_settled'})
`)
  await chmod(executable, 0o700)
  const query = (sql, ...params) => {
    const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
    try { return db.prepare(sql).get(...params) } finally { db.close() }
  }
  const records = async () => {
    try { return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const start = () => connectCore(binary, [...coreDataDirectoryArguments(data, { homeDirectory: home }),
    '--skill-library-root', join(data, 'skills'), '--mcp-config-path', join(data, 'mcp.json')], directory,
    { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/sh', TMPDIR: directory, ROVAI_PI_BIN: executable,
      PI_CODING_AGENT_DIR: join(home, 'pi'), ROVAI_CODEX_BIN: '/nonexistent/codex', ROVAI_CLAUDE_CODE_BIN: '/nonexistent/claude' })
  let core, campId, privateConversationId, total = 0
  const latestRun = () => query('SELECT id,status,wait_reason,last_error_code,conversation_id FROM agent_run WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id=?) ORDER BY rowid DESC LIMIT 1', campId)
  const sessions = new Map(), hosts = new Map()
  try {
    core = start(); await core.request('health.check')
    await core.request('runtime.discovery.rescan', { interactiveShell: false })
    const profile = await core.request('members.get', { agentId: 'agent_1' })
    const configured = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
      agentId: 'agent_1', expectedVersion: profile.version, adapterKind: 'pi', model: { mode: 'runtime_default' },
      permissions: { adapterKind: 'pi', schemaVersion: 1, values: {} }
    } })
    assert.equal(configured.status, 'applied', JSON.stringify(configured))
    const created = await core.request('threads.create', { commandId: crypto.randomUUID(), name: 'Pi conversation isolation',
      workspace: { projectPath: directory }, memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
    campId = created.payload.threadId
    for (const generation of ['warm', 'restarted']) {
      if (generation === 'restarted') { await core.stop(); core = start(); await core.request('health.check') }
      for (const [index, kind] of ['public', 'private', 'public', 'private'].entries()) {
        const offset = (await records()).length
        const body = `PI_INPUT_${generation}_${index}_${kind}`
        if (kind === 'public') {
          const result = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: campId,
            content: composerDocumentForAddress({ mode: 'default' }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
            execution: { taskId: null, purpose: 'Verify exact Pi Conversation resume', completionRole: 'required' } })
          assert.equal(result.commandResult.status, 'accepted', JSON.stringify(result))
        } else {
          if (!privateConversationId) {
            const opened = await core.request('singleChat.open', { commandId: crypto.randomUUID(), command: { threadId: campId, agentId: 'agent_1' } })
            privateConversationId = opened.payload.conversationId
          }
          const snapshot = await core.request('singleChat.get', { conversationId: privateConversationId })
          const sent = await core.request('singleChat.send', { commandId: crypto.randomUUID(), command: {
            threadId: campId, conversationId: privateConversationId, body, draftRevision: snapshot.draft.revision
          } })
          assert.ok(['applied','accepted'].includes(sent.status), JSON.stringify(sent))
        }
        total++
        await waitFor(() => {
          const state = query("SELECT COUNT(*) AS total, SUM(status IN ('succeeded','failed','cancelled')) AS settled FROM agent_run WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id=?)", campId)
          return state.total === total && state.settled === total
        }, () => `${generation}/${index}/${kind}: ${JSON.stringify(latestRun())}; ${core.diagnostics()}`)
        const run = latestRun()
        assert.equal(run.status, 'succeeded', `${generation}/${index}/${kind}: ${JSON.stringify(run)} ${core.diagnostics()}`)
        const actual = (await records()).slice(offset)
        const prompt = actual.filter(r => r.method === 'prompt')
        assert.equal(prompt.length, 1, `${generation}/${kind}: exactly one input`)
        assert.ok(prompt[0].request.message.includes(body))
        const bound = query('SELECT native_session_id FROM conversation WHERE id=?', run.conversation_id).native_session_id
        assert.equal(bound, prompt[0].sessionId)
        if (sessions.has(kind)) {
          const previous = sessions.get(kind)
          const restored = actual.filter(r => r.method === 'switch_session')
          assert.equal(restored.length, 1, `${generation}/${kind}: actual native restore`)
          assert.equal(restored[0].request.sessionPath, previous.sessionFile)
          assert.equal(restored[0].sessionId, previous.sessionId)
          assert.equal(bound, previous.sessionId)
          assert.equal(actual.filter(r => r.method === 'new_session').length, 0)
        } else sessions.set(kind, prompt[0])
        const hostKey = `${generation}/${kind}`
        if (hosts.has(hostKey)) assert.equal(prompt[0].pid, hosts.get(hostKey), 'reuse each Conversation own Warm process')
        else {
          if (generation === 'restarted') assert.notEqual(prompt[0].pid, hosts.get(`warm/${kind}`), 'restart creates a new CLI')
          hosts.set(hostKey, prompt[0].pid)
        }
      }
    }
    assert.notEqual(sessions.get('public').sessionId, sessions.get('private').sessionId)
    const prompts = (await records()).filter(r => r.method === 'prompt')
    assert.equal(prompts.length, 8)
    assert.equal(query("SELECT COUNT(*) AS total FROM event_log WHERE event_type='agent_run.native_session_continuity_lost'").total, 0)

    // A cold resume of a deleted exact target releases its Host before the one
    // permitted replacement. The replacement must receive a new process context.
    await core.stop()
    await rm(sessions.get('public').sessionFile)
    const offset = (await records()).length
    core = start(); await core.request('health.check')
    const sent = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: campId,
      content: composerDocumentForAddress({ mode: 'default' }, 'PI_INPUT_MISSING_HISTORY'), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
      execution: { taskId: null, purpose: 'Verify fresh Pi fallback process context', completionRole: 'required' } })
    assert.equal(sent.commandResult.status, 'accepted')
    total++
    await waitFor(() => {
      const state = query("SELECT COUNT(*) AS total, SUM(status IN ('succeeded','failed','cancelled')) AS settled FROM agent_run WHERE conversation_id IN (SELECT id FROM conversation WHERE camp_id=?)", campId)
      return state.total === total && state.settled === total
    }, () => `${JSON.stringify(latestRun())}; ${core.diagnostics()}`)
    const run = latestRun()
    assert.equal(run.status, 'succeeded', JSON.stringify(run))
    const fallback = (await records()).slice(offset)
    const launches = fallback.filter(r => r.method === 'process/start')
    assert.equal(launches.length, 2, 'one cold restore Host and one replacement Host')
    assertFreshProcessContexts(launches, directory)
    const replacement = fallback.filter(r => r.method === 'new_session')
    assert.equal(replacement.length, 1)
    const inputs = fallback.filter(r => r.method === 'prompt')
    assert.equal(inputs.length, 1)
    assert.ok(inputs[0].request.message.includes('PI_INPUT_MISSING_HISTORY'))
    const bound = query('SELECT native_session_id FROM conversation WHERE id=?', run.conversation_id).native_session_id
    assert.notEqual(bound, sessions.get('public').sessionId)
    assert.equal(bound, inputs[0].sessionId)
    assert.equal(query('SELECT native_session_id FROM conversation WHERE id=?', privateConversationId).native_session_id, sessions.get('private').sessionId)
    assert.equal(query("SELECT COUNT(*) AS total FROM event_log WHERE entity_id=? AND event_type='agent_run.native_session_continuity_lost'", run.id).total, 1)
    return { kind: 'pi', publicAndPrivateExactResume: true, warmAndRestarted: true, inputs: prompts.length + inputs.length, missingHistoryFallbackOnce: true, freshProcessContexts: true }
  } finally { await core?.stop(); await removeEphemeralRuntimeCampFilesRoot(data, { homeDirectory: home }) }
}
