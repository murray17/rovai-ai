// Opt-in macOS real-CLI audit: creates billable turns and removes only test history.
// The private output contains copied credentials and must never be published.
// Usage: node scripts/probe-native-session-resume.mjs <adapter-kind> <private-output-root>
// --continue sends a NEW input in an interrupted fixture before testing missing history.
// --missing-only tests deletion after a completed cold stage, without replaying inputs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'
import { removeEphemeralRuntimeCampFilesRoot } from './lib/runtime-camp-files-root.mjs'
import { sharedNativeTestHistory } from './lib/native-resume-probe-history.mjs'

const repo = resolve(import.meta.dirname, '..')
const kind = process.argv[2]
const outputRoot = process.argv[3]
const missingOnly = process.argv[4] === '--missing-only'
const continueFixture = process.argv[4] === '--continue' || missingOnly
assert.ok(outputRoot && isAbsolute(outputRoot))
const specifications = {
  'codex-cli': ['codex', 'ROVAI_CODEX_BIN', 'CODEX_HOME', '.codex', ['config.toml', 'auth.json']],
  'claude-code-cli': ['claude', 'ROVAI_CLAUDE_CODE_BIN', 'CLAUDE_CONFIG_DIR', '.claude', ['settings.json', 'settings.local.json', 'config.json', '.credentials.json']],
  'pi': ['pi', 'ROVAI_PI_BIN', 'PI_CODING_AGENT_DIR', '.pi/agent', ['auth.json', 'settings.json', 'models.json', 'models-store.json']],
  'copilot-cli': ['copilot', 'ROVAI_COPILOT_BIN', 'COPILOT_HOME', '.copilot', ['config.json', 'settings.json', 'permissions-config.json']],
  'qoder-cli': ['qodercli', 'ROVAI_QODER_BIN', 'QODER_CONFIG_DIR', '.qoder', ['settings.json', 'state.json', '.auth', '.models', 'security']],
  'codebuddy-cli': ['codebuddy', 'ROVAI_CODEBUDDY_BIN', 'CODEBUDDY_CONFIG_DIR', '.codebuddy', ['settings.json', 'user-state.json']],
  'qwen-code': ['qwen', 'ROVAI_QWEN_BIN', 'QWEN_HOME', '.qwen', ['settings.json', 'oauth_creds.json', 'installation_id']],
  'kimi-code-cli': ['kimi', 'ROVAI_KIMI_BIN', 'KIMI_CODE_HOME', '.kimi-code', ['config.toml', 'device_id', 'credentials']],
  'grok-build': ['grok', 'ROVAI_GROK_BIN', 'GROK_HOME', '.grok', ['config.toml', 'managed_config.toml', 'requirements.toml', '.env', 'agent_id']],
  'kiro-cli': ['kiro-cli', 'ROVAI_KIRO_BIN', 'KIRO_HOME', '.kiro', ['settings', 'agents']],
  'opencode-cli': ['opencode', 'ROVAI_OPENCODE_BIN'],
  'trae-cn-cli': ['trae-cli', 'ROVAI_TRAE_CN_BIN'],
  'deepseek-harness': ['dsh', 'ROVAI_DEEPSEEK_HARNESS_BIN', 'DSH_HOME', '.dsh', ['.credentials.yaml', 'settings.yaml', '.env', 'cordis.patch.yml', 'profiles']],
  'antigravity-app': ['agy', 'ROVAI_ANTIGRAVITY_BIN'],
  'zcode-app': ['zcode', 'ROVAI_ZCODE_BIN']
}
const spec = specifications[kind]
assert.ok(spec, `Unsupported or excluded runtime: ${kind}`)
const fixture = join(await realpath(outputRoot), kind)
const project = join(fixture, 'project'), data = join(fixture, 'core'), native = join(fixture, 'native')
if (!continueFixture) {
  await mkdir(fixture, { mode: 0o700 })
  await mkdir(project, { mode: 0o700 })
  await mkdir(native, { mode: 0o700 })
}
const wirePath = join(fixture, 'wire.jsonl')
const stagePath = join(fixture, 'stage.txt')
let core, campId, stage = 'setup'
const result = continueFixture ? JSON.parse(await readFile(join(fixture, 'result.json'), 'utf8'))
  : { adapter: kind, base: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim(), fixture, stages: [], startedAt: new Date().toISOString() }
assert.equal(result.adapter, kind)
const notifications = result.notifications ?? []
if (continueFixture) {
  campId = result.campId; assert.ok(campId)
  if (result.failure) (result.previousFailures ??= []).push(result.failure)
  delete result.failure
}
const executable = spawnSync('/usr/bin/which', [spec[0]], { encoding: 'utf8' }).stdout.trim()
assert.ok(executable && isAbsolute(executable), `${spec[0]} is not installed`)
result.executable = executable
if (!continueFixture) {
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000 })
  result.version = (version.stdout || version.stderr || '').trim().slice(0, 160)
  // ZCode uses the official App's Node bundle, not the independent PATH CLI.
  if (kind === 'zcode-app') {
    const version = spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', '/Applications/ZCode.app/Contents/Info.plist'], { encoding: 'utf8', timeout: 15000 })
    result.officialAppVersion = version.status === 0 ? version.stdout.trim() : null
  }
}

async function copyOptional(source, target) {
  try {
    const meta = await stat(source)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    if (meta.isDirectory()) await cp(source, target, { recursive: true, filter: path => !path.split('/').includes('node_modules') })
    else { await copyFile(source, target); await chmod(target, 0o600) }
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
if (spec[2]) {
  const source = process.env[spec[2]] || join(homedir(), spec[3])
  if (!continueFixture) for (const name of spec[4]) await copyOptional(join(source, name), join(native, name))
  process.env[spec[2]] = native
}
if (kind === 'qwen-code') process.env.QWEN_RUNTIME_DIR = native
if (kind === 'claude-code-cli' && !continueFixture) await copyOptional(join(homedir(), '.claude.json'), join(native, '.claude.json'))
if (kind === 'opencode-cli') {
  process.env.XDG_CONFIG_HOME = join(native, 'config')
  process.env.XDG_DATA_HOME = join(native, 'data')
  process.env.XDG_STATE_HOME = join(native, 'state')
  process.env.XDG_CACHE_HOME = join(native, 'cache')
  if (!continueFixture) {
    for (const name of ['opencode.json', 'cli.json']) await copyOptional(join(homedir(), '.config/opencode', name), join(native, 'config/opencode', name))
    await copyOptional(join(homedir(), '.local/share/opencode/auth.json'), join(native, 'data/opencode/auth.json'))
  }
}
if (kind === 'zcode-app') {
  process.env.ZCODE_STORAGE_DIR = native
  process.env.ZCODE_SESSION_DB_PATH = join(native, 'sessions.sqlite')
}
// These two native CLIs have platform-owned stores; deletion is restricted to
// the newly observed exact ID and the fixture cwd, never an entire shared root.
const sessionRoots = kind === 'trae-cn-cli' ? [join(homedir(), 'Library/Caches/trae-cli/sessions')]
  : kind === 'antigravity-app' ? [join(homedir(), '.gemini/antigravity-cli/conversations')]
    : [native]
result.sessionRoots = sessionRoots
// Read-only configuration copying never includes pre-existing native histories.
// Disable unrelated executable overrides so this Core checks only its target.
for (const row of Object.values(specifications)) process.env[row[1]] = '/nonexistent/rovai-resume-audit'
process.env.ROVAI_CURSOR_BIN = '/nonexistent/rovai-resume-audit'
process.env.ROVAI_CLINE_BIN = '/nonexistent/rovai-resume-audit'
process.env.ROVAI_COMMAND_CODE_BIN = '/nonexistent/rovai-resume-audit'
const wrapper = join(fixture, 'runtime-wire-proxy')
await writeFile(wrapper, `#!/usr/bin/python3
import json, os, signal, subprocess, sys, threading
target = ${JSON.stringify(executable)}
log_path, stage_path = ${JSON.stringify(wirePath)}, ${JSON.stringify(stagePath)}
lock = threading.Lock()
pending = {}
def record(value):
    value.update(pid=os.getpid(), cwd=os.getcwd())
    try:
        with open(stage_path) as source: value['stage'] = source.read().strip()
        with lock:
            with open(log_path, 'a') as output: output.write(json.dumps(value) + '\\n')
    except OSError: pass
def observe(line, direction):
    try: value=json.loads(line)
    except Exception: return
    if not isinstance(value,dict): return
    method=value.get('method',value.get('type',value.get('event')))
    params=value.get('params') or {}
    if not isinstance(params,dict): params={}
    rpc_id=value.get('id')
    if direction=='in' and rpc_id is not None: pending[str(rpc_id)]=method
    row={'direction':direction,'id':rpc_id,'method':method,'requestMethod':pending.get(str(rpc_id)), 'sessionId':params.get('sessionId',params.get('threadId',value.get('session_id')))}
    if 'conversation_id' in value: row['sessionId']=value['conversation_id']
    if method=='v4/command': row['commandType']=(params.get('command') or {}).get('type')
    if method=='session/update': row['updateType']=(params.get('update') or {}).get('sessionUpdate')
    if direction=='in' and method=='switch_session': row['sessionPath']=value.get('sessionPath')
    body=value.get('result',value.get('data'))
    if isinstance(body,dict):
        thread=body.get('thread') or {}
        row.update(resultSessionId=body.get('sessionId',body.get('conversation_id',thread.get('id'))),sessionFile=body.get('sessionFile'),sessionType=body.get('type'))
        if 'agentCapabilities' in body: row['capabilities']=body['agentCapabilities']
    err=value.get('error')
    if isinstance(err,dict):
        info=err.get('data') or {}
        row['error']={'code':err.get('code'),'dataCode':info.get('code') if isinstance(info,dict) else None,'dataKeys':list(info) if isinstance(info,dict) else []}
    if 'success' in value: row['success']=value['success']
    if method in ('system','result'): row.update(subtype=value.get('subtype'),sessionId=value.get('session_id'),isError=value.get('is_error'))
    record(row)
args=sys.argv[1:]
resume,resume_flag=None,None
for flag in ['--resume','--session-id','--conversation']:
    if flag in args and args.index(flag)+1<len(args): resume,resume_flag=args[args.index(flag)+1],flag
launch={'direction':'launch','resumeArgument':resume,'resumeFlag':resume_flag,
    'additionalDirectories':[{'path':args[i+1],'exists':os.path.isdir(args[i+1])} for i,arg in enumerate(args[:-1]) if arg=='--add-dir']}
context_path=os.getenv('ROVAI_CLI_CONTEXT')
if context_path:
    with open(context_path) as source: context=json.load(source)
    run_tmp=os.environ['ROVAI_RUN_TMP']
    launch['builtinTools']={'processId':context['processId'],'runTmp':run_tmp,'runTmpExists':os.path.isdir(run_tmp),'unbound':context.get('lease') is None}
record(launch)
child=subprocess.Popen([target]+args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=None)
def stop(signum,frame):
    try: child.send_signal(signum)
    except ProcessLookupError: pass
signal.signal(signal.SIGTERM,stop)
def feed():
    try:
        for line in sys.stdin.buffer:
            observe(line,'in'); child.stdin.write(line); child.stdin.flush()
        child.stdin.close()
    except (BrokenPipeError,ValueError): pass
threading.Thread(target=feed,daemon=True).start()
for line in child.stdout:
    observe(line,'out'); sys.stdout.buffer.write(line); sys.stdout.buffer.flush()
sys.exit(child.wait())
`, { mode: 0o700 })
process.env[spec[1]] = wrapper
if (kind === 'zcode-app') {
  // The ZCode installation must keep its official bundle identity.
  delete process.env.ROVAI_ZCODE_BIN
  const node = spawnSync('/usr/bin/which', ['node'], { encoding: 'utf8' }).stdout.trim()
  await writeFile(wrapper, (await readFile(wrapper, 'utf8')).replace(JSON.stringify(executable), JSON.stringify(node)))
  process.env.ROVAI_ZCODE_NODE_BIN = wrapper
}

function query(sql, ...params) {
  const db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  try { return db.prepare(sql).all(...params) } finally { db.close() }
}
async function setStage(value) { stage = value; await writeFile(stagePath, value, { mode: 0o600 }) }
async function startCore() {
  core = startQualificationCore({ coreExecutable: join(repo, 'target/debug/rovai-core'), dataDirectory: data,
    workingDirectory: project, runtimeCacheDirectory: join(fixture, 'cache'), mcpConfigPath: join(data, 'mcp.json'),
    onNotification: message => {
      if (['agent_run.started','agent_run.native_session_bound','agent_run.native_session_continuity_lost','agent_run.terminal','error'].includes(message.method)) notifications.push({ stage, ...message })
    } })
  await core.request('health.check')
}
async function stopCore() {
  if (!core) return
  const stopped = await core.stop()
  await writeFile(join(fixture, `${stage}-stderr.txt`), stopped.stderrTail ?? '', { mode: 0o600 })
  core = null
}
async function waitUntil(fn, timeout = 180000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 300)) }
  throw new Error(`Timed out in ${stage}`)
}
async function wire() {
  try { return (await readFile(wirePath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse).filter(row => row.cwd === project || row.cwd.startsWith(data + '/runtime/')) }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}
async function sendStage(label, body) {
  await setStage(label)
  const previousId = query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?', campId, 'agent_2')[0]?.id
  const previousCount = query('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?', campId)[0].n
  const sent = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId: campId,
    content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_2'] }, body), sourceAttachments: [], quotes: [], replyToThreadMessageId: null,
    execution: { taskId: null, purpose: 'Isolated native Session resume acceptance', completionRole: 'required' } })
  assert.equal(sent.commandResult.status, 'accepted')
  let run, timeoutError
  try {
    run = await waitUntil(() => {
      const count = query('SELECT COUNT(*) AS n FROM agent_run WHERE camp_id=?', campId)[0].n
      if (count <= previousCount) return false
      const row = query('SELECT id,status,version,last_error_code,last_error_details_ref FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId)[0]
      return ['succeeded','failed','cancelled'].includes(row.status) ? row : false
    })
  } catch (error) {
    run = query('SELECT id,status,version,last_error_code FROM agent_run WHERE camp_id=? ORDER BY rowid DESC LIMIT 1', campId)[0]
    if (run && !['succeeded','failed','cancelled'].includes(run.status)) {
      await core.request('agentRuns.cancel', { commandId: crypto.randomUUID(), command: { campId, agentRunId: run.id, expectedVersion: run.version } }).catch(() => {})
    }
    timeoutError = error.message
    run = await waitUntil(() => {
      const row = query('SELECT id,status,version,last_error_code FROM agent_run WHERE id=?', run.id)[0]
      return ['succeeded','failed','cancelled'].includes(row.status) ? row : false
    }, 15000)
  }
  const currentId = query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?', campId, 'agent_2')[0]?.id
  const messages = query('SELECT body FROM camp_message WHERE source_agent_run_id=? OR agent_run_id=?', run.id, run.id)
  const requests = (await wire()).filter(row => row.stage === label)
  const record = { stage: label, runId: run.id, status: run.status, error: run.last_error_code, timeoutError, previousId, currentId,
    input: query('SELECT status FROM runtime_input_delivery WHERE agent_run_id=?', run.id),
    notices: query("SELECT event_type,json_extract(payload_json,'$.continuation') AS continuation FROM event_log WHERE entity_id=? AND event_type='agent_run.native_session_continuity_lost'", run.id),
    output: messages.map(row => row.body).join('\n').slice(-1000), requests }
  result.stages.push(record)
  await save()
  console.log(JSON.stringify({ adapter: kind, stage: label, status: record.status, previousId, currentId, error: record.error }))
  return record
}
async function candidates(root, id, found = []) {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return found; throw error }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || ['node_modules','cache','logs','log','.git'].includes(entry.name)) continue
    const path = join(root, entry.name)
    if (entry.name.includes(id)) { found.push(path); continue }
    if (entry.isDirectory()) await candidates(path, id, found)
  }
  return found
}
async function removeTestHistory(id) {
  const sharedStore = ['trae-cn-cli', 'antigravity-app'].includes(kind)
  const paths = sharedStore
    ? await sharedNativeTestHistory({ kind, root: sessionRoots[0], id, project, stages: result.stages,
      boundId: query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?', campId, 'agent_2')[0]?.id })
    : (await Promise.all(sessionRoots.map(root => candidates(root, id)))).flat()
  if (kind === 'opencode-cli') {
    const databases = ['opencode.db', 'opencode.db-wal', 'opencode.db-shm'].map(name => join(native, 'data/opencode', name))
    for (const path of databases) { try { await stat(path); paths.push(path) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  }
  if (kind === 'zcode-app') {
    const database = join(native, 'sessions.sqlite')
    const db = new DatabaseSync(database, { readOnly: true })
    try {
      assert.equal(db.prepare('SELECT directory FROM session WHERE id=?').get(id)?.directory, project,
        'ZCode database must contain this fixture target before removing its isolated store')
    } finally { db.close() }
    for (const suffix of ['', '-wal', '-shm']) {
      const path = database + suffix
      try { await stat(path); paths.push(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  assert.ok(paths.length, `No exact native history found for ${id}; no files deleted`)
  const deleted = []
  for (const [index, path] of paths.entries()) {
    assert.ok(sessionRoots.some(root => path.startsWith(root + '/')))
    assert.ok(path.startsWith(fixture + '/') || sharedStore, 'Shared store deletion requires the verified exact native target')
    assert.ok(!(await lstat(path)).isSymbolicLink(), 'Do not remove a redirected native target')
    const backup = join(fixture, 'removed-history', `${index}-${basename(path)}`)
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 })
    await cp(path, backup, { recursive: true, dereference: false })
    await rm(path, { recursive: true })
    deleted.push(path)
  }
  return deleted
}
async function save() { await writeFile(join(fixture, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 }) }

try {
  console.log(JSON.stringify({ adapter: kind, channel: 'automatic-acceptance', data, skills: join(data, 'managed-skill-library'), mcp: join(data, 'mcp.json') }))
  if (continueFixture) {
    assert.ok(!result.deletedPaths?.length || (missingOnly && kind === 'zcode-app'), 'The original history was already removed; do not repeat this fixture')
    if (!missingOnly) {
      await setStage('cold-recheck-start'); await startCore()
      await sendStage('cold-recheck', '这是一条新的隔离验收消息，不是重试上次的输入。不要调用工具，只回复 RESUME_RECHECK_OK。')
      await stopCore()
    }
    const target = query('SELECT native_session_id AS id FROM conversation WHERE camp_id=? AND agent_id=?', campId, 'agent_2')[0]?.id
    assert.ok(target)
    if (result.deletedPaths?.length) result.previousDeletedPaths = result.deletedPaths
    result.deletedPaths = await removeTestHistory(target)
    await setStage('missing-start'); await startCore()
    await sendStage(missingOnly ? 'missing-store' : 'missing', '这是一条新的隔离验收消息。不要调用工具，只回复 RESUME_MISSING_OK。')
  } else {
  spawnSync('git', ['init', '-b', 'main'], { cwd: project })
  await writeFile(join(project, 'README.md'), '# Disposable native Session acceptance\n')
  await setStage('discovery'); await startCore()
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  await core.request('runtime.product.check', { runtimeKind: kind })
  const installation = await waitUntil(async () => {
    const row = (await core.request('runtime.installations.list')).find(row => row.adapterKind === kind && row.installationClass === 'managed_default' && row.authScope === 'default')
    return row?.memberRuntimeDefaults ? row : false
  }, 90000)
  result.installation = { version: installation.snapshot?.reportedVersion, probeStatus: installation.snapshot?.probeStatus, permissionSchemaVersion: installation.snapshot?.permissionSchemaVersion }
  const profile = await core.request('members.get', { agentId: 'agent_2' })
  const configured = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: 'agent_2', expectedVersion: profile.version, adapterKind: kind,
    model: { mode: 'runtime_default' }, permissions: installation.memberRuntimeDefaults.permissions
  } })
  assert.equal(configured.status, 'applied', JSON.stringify(configured))
  const camp = await core.request('threads.create', { commandId: crypto.randomUUID(), name: `${kind} resume acceptance`, workspace: { projectPath: project },
    memberAgentIds: ['agent_2'], defaultLeadAgentId: 'agent_2', collaborationMode: 'peer' })
  assert.equal(camp.status, 'applied')
  campId = camp.payload.threadId
  result.campId = campId
  const seed = await sendStage('seed', '这是授权的隔离会话恢复验收。不要修改文件，不要调用工具。请只回复 RESUME_SEED_OK。')
  if (seed.status !== 'succeeded' || !seed.currentId) throw new Error('Seed did not establish a successful native Session')
  await sendStage('warm', '继续本次隔离验收。不要调用工具，只回复 RESUME_WARM_OK。')
  await stopCore(); await setStage('cold-start'); await startCore()
  const cold = await sendStage('cold', '继续本次隔离验收。不要调用工具，只回复 RESUME_COLD_OK。')
  if (cold.currentId !== seed.currentId) throw new Error('Cold resume unexpectedly changed the Session; preserve evidence before deleting any history')
  await stopCore()
  result.deletedPaths = await removeTestHistory(seed.currentId)
  await setStage('missing-start'); await startCore()
  await sendStage('missing', '继续本次隔离验收。不要调用工具，只回复 RESUME_MISSING_OK。')
  }
} catch (error) {
  result.failure = error.message
  console.log(JSON.stringify({ adapter: kind, stage, failure: error.message }))
} finally {
  await stopCore()
  result.notifications = notifications
  result.finishedAt = new Date().toISOString()
  await save()
  await removeEphemeralRuntimeCampFilesRoot(data).catch(() => {})
}
