// Historical-version acceptance using the unchanged production Core and Adapter.
// node scripts/probe-steer-version.mjs <new-root> <core> <adapter> <native-binary> [positive|receipts|boundaries|preflight|ineligible]
import assert from 'node:assert/strict'
import { assertSteerRaceOutcome } from './lib/steer-race-outcome.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { access, cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startQualificationCore, processTable, descendantsOf } from './lib/qualification-core.mjs'
import { composerDocumentForAddress } from './lib/create-configured-camp.mjs'

const [root, executable, adapter, nativeExecutable, mode = 'positive'] = process.argv.slice(2)
const caseFilter = process.env.ROVAI_STEER_PROBE_FILTER ?? ''
assert.ok([root, executable, nativeExecutable].every(isAbsolute))
assert.ok(['positive', 'receipts', 'boundaries', 'preflight', 'ineligible'].includes(mode))
const specs = {
  'codex-cli': ['ROVAI_CODEX_BIN', 'CODEX_HOME', '.codex', ['auth.json', 'config.toml']],
  pi: ['ROVAI_PI_BIN', 'PI_CODING_AGENT_DIR', '.pi/agent', ['auth.json', 'models.json', 'models-store.json', 'settings.json']],
  'qwen-code': ['ROVAI_QWEN_BIN', 'QWEN_HOME', '.qwen', ['settings.json', 'oauth_creds.json', 'installation_id']],
  'grok-build': ['ROVAI_GROK_BIN', 'GROK_HOME', '.grok', ['config.toml', 'managed_config.toml', 'requirements.toml', '.env', 'agent_id']],
  'kiro-cli': ['ROVAI_KIRO_BIN', 'KIRO_HOME', '.kiro', ['settings', 'agents']],
  'claude-code-cli': ['ROVAI_CLAUDE_CODE_BIN', 'CLAUDE_CONFIG_DIR', '.claude', ['settings.json', 'settings.local.json', 'config.json', '.credentials.json']],
  'codebuddy-cli': ['ROVAI_CODEBUDDY_BIN', 'CODEBUDDY_CONFIG_DIR', '.codebuddy', ['settings.json', 'user-state.json']],
  'trae-cn-cli': ['ROVAI_TRAE_CN_BIN', 'TRAE_HOME', '.trae', ['traecli.toml', 'cli/auth.json']],
  'zcode-app': ['ROVAI_ZCODE_BIN', 'ZCODE_DATA_BASE_DIR', '', ['.zcode/v2/provider_config.json']],
  'opencode-cli': ['ROVAI_OPENCODE_BIN', null, null, []],
}
assert.ok(specs[adapter], `unsupported Adapter ${adapter}`)
await access(join(dirname(executable), 'rovai'))
await mkdir(root, { mode: 0o700 })
const data = join(root, 'core'), project = join(root, 'project'), native = join(root, 'native')
for (const path of [data, project, native]) await mkdir(path, { mode: 0o700 })
const [overrideKey, nativeKey, nativeDirectory, files] = specs[adapter]
process.env[overrideKey] = nativeExecutable
if (adapter === 'opencode-cli') {
  // Preserve credentials/configuration only; native Sessions and the database
  // must belong to this acceptance fixture, including historical V1 probes.
  for (const [key, directory, files] of [
    ['XDG_CONFIG_HOME', '.config', ['opencode/opencode.json', 'opencode/opencode.jsonc', 'opencode/config.json']],
    ['XDG_DATA_HOME', '.local/share', ['opencode/auth.json']],
    ['XDG_STATE_HOME', '.local/state', ['opencode/model.json']],
    ['XDG_CACHE_HOME', '.cache', []],
  ]) {
    const source = process.env[key] ?? join(homedir(), directory)
    const destination = join(native, key.toLowerCase())
    await mkdir(destination, { recursive: true, mode: 0o700 })
    for (const file of files) {
      try { await access(join(source, file)) } catch { continue }
      await cp(join(source, file), join(destination, file), { recursive: true })
    }
    process.env[key] = destination
  }
  delete process.env.OPENCODE_DB
} else {
  const source = process.env[nativeKey] ?? join(homedir(), nativeDirectory)
  for (const file of files) {
    try { await access(join(source, file)) } catch { continue }
    await cp(join(source, file), join(native, file), { recursive: true })
  }
  process.env[nativeKey] = native
}
if (adapter === 'qwen-code') process.env.QWEN_RUNTIME_DIR = native
if (adapter === 'zcode-app') {
  process.env.ZCODE_STORAGE_DIR = join(native, 'storage')
  process.env.ZCODE_SESSION_DB_PATH = join(native, 'sessions.sqlite')
}
delete process.env.CLAUDECODE
const report = {
  adapter, mode, caseFilter, nativeExecutable, coreExecutable: executable,
  coreSha256: createHash('sha256').update(await readFile(executable)).digest('hex'),
  nativeSha256: createHash('sha256').update(await readFile(nativeExecutable)).digest('hex'),
  platform: `${process.platform}-${process.arch}`, startedAt: new Date().toISOString(),
  isolation: { data, skills: join(data, 'managed-skill-library'), mcp: join(data, 'mcp.json'), native, project },
  cases: [],
}
if (adapter === 'claude-code-cli') {
  const settings = JSON.parse(await readFile(join(native, 'settings.json'), 'utf8'))
  assert.ok(settings.env?.ANTHROPIC_BASE_URL, 'Claude requires the selected sub2api native configuration')
  report.provider = { name: 'sub2api', baseURL: settings.env.ANTHROPIC_BASE_URL, model: settings.env.ANTHROPIC_MODEL ?? settings.model }
  delete settings.hooks
  delete settings.enabledPlugins
  await writeFile(join(native, 'settings.json'), JSON.stringify(settings), { mode: 0o600 })
}
// This fixture tool always terminates, including after a failed acceptance process.
await writeFile(join(project, 'hold.mjs'), `import {access,writeFile} from 'node:fs/promises';const id=process.argv[2];await writeFile(id+'.ready','ready');const end=Date.now()+150000;while(Date.now()<end){try{await access(id+'.release');break}catch{await new Promise(r=>setTimeout(r,50))}}await writeFile(id+'.finished','finished');console.log('HOLD_COMPLETE');\n`)
let core, db, threadId, activeCase
const notifications = []
const exists = async name => { try { await access(join(project, name)); return true } catch { return false } }
const runs = () => db.prepare('SELECT r.id,r.status,r.execution_epoch,r.last_error_code,r.version FROM agent_run r WHERE r.camp_id=? ORDER BY r.created_at,r.id').all(threadId)
const inputs = run => db.prepare('SELECT i.id,i.agent_run_id,i.status,i.dispatch_started_at,i.native_input_id,i.input_kind,i.input_sequence,i.prepared_at,i.accepted_at,i.resolved_at,i.updated_at,i.last_error,m.source_delivery_id,m.raw_message_refs_json FROM runtime_input_delivery i JOIN context_manifest m ON m.id=i.context_manifest_id WHERE i.agent_run_id=? ORDER BY i.input_sequence').all(run)
const deliveries = message => db.prepare('SELECT id,status,requested_mode,claimed_agent_run_id,failure_code FROM camp_message_delivery WHERE message_id=?').all(message)
async function wait(check, label, timeout = 180000, allowCancelled = false) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await check()
    if (value) { console.error(`Passed boundary: ${label}`); return value }
    const failed = runs().find(r => r.status === 'failed' || (!allowCancelled && r.status === 'cancelled'))
    if (failed) throw new Error(`${label}: execution ${JSON.stringify(failed)}`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${label}`)
}
async function persist() { await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 }) }
async function newThread(name) {
  const result = await core.request('threads.create', { commandId: randomUUID(), name, workspace: { projectPath: project }, memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', collaborationMode: 'peer' })
  assert.equal(result.status, 'applied')
  threadId = result.payload.threadId
  return threadId
}
async function send(body, deliveryMode = 'start', explicitTarget = null) {
  const targets = explicitTarget ? [explicitTarget] : runs().filter(r => r.status === 'running').map(r => ({ agentRunId: r.id, executionEpoch: r.execution_epoch }))
  const result = await core.request('thread.messages.send', {
    commandId: randomUUID(), threadId, content: composerDocumentForAddress({ mode: 'explicit', agentIds: ['agent_1'] }, body),
    sourceAttachments: [], quotes: [], replyToThreadMessageId: null, deliveryMode, steerTargets: targets,
    execution: { taskId: null, purpose: 'Historical Steer version acceptance', completionRole: 'required' },
  })
  assert.equal(result.commandResult.status, 'accepted', JSON.stringify(result))
  return result.commandResult.payload.threadMessageId
}
async function cancel(target) {
  const snapshot = await core.request('camps.open', { threadId, traceId: randomUUID() })
  const row = snapshot.agentRuns.find(r => r.id === target.id)
  const result = await core.request('agentRuns.cancel', { commandId: randomUUID(), command: { threadId, agentRunId: target.id, expectedVersion: row.version } })
  assert.notEqual(result.status, 'rejected', JSON.stringify(result))
  await wait(() => runs().find(r => r.id === target.id && r.status === 'cancelled'), 'cancel terminal', 60000, true)
  return result
}
function capture() {
  return { threadId, runs: runs(), inputs: runs().flatMap(r => inputs(r.id)),
    deliveries: db.prepare('SELECT * FROM camp_message_delivery WHERE camp_id=? ORDER BY queue_sequence').all(threadId),
    conversations: db.prepare('SELECT id,native_session_id,native_binding_id,native_binding_generation FROM conversation WHERE camp_id=?').all(threadId) }
}
async function nativeEvidence() {
  if (adapter !== 'codebuddy-cli') return []
  const records = []
  for (const conversation of db.prepare('SELECT native_session_id FROM conversation WHERE camp_id=?').all(threadId)) {
    const session = conversation.native_session_id
    if (!session) continue
    const path = join(native, 'projects', (await realpath(project)).split(/[\\/:-]/).filter(Boolean).join('-'), `${session}.jsonl`)
    try {
      const bytes = await readFile(path)
      records.push({ session, path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
    } catch (error) { records.push({ session, path, unavailable: error.code }) }
  }
  return records
}
async function ownedProcesses() {
  const table = await processTable(), ids = new Set(descendantsOf(table, core.pid))
  return table.filter(p => ids.has(p.pid))
}
async function runCase(name, fn) {
  if (caseFilter && !name.includes(caseFilter)) return
  activeCase = { name, startedAt: new Date().toISOString(), status: 'running' }
  report.cases.push(activeCase)
  try { await fn(activeCase); activeCase.status = 'passed' }
  catch (error) { activeCase.status = 'failed'; activeCase.error = error.message; if (!['positive', 'receipts'].includes(mode)) throw error }
  finally { activeCase.finishedAt = new Date().toISOString(); if (db && threadId) { Object.assign(activeCase, capture()); activeCase.nativeEvidence = await nativeEvidence() }; await persist() }
}
try {
  console.error(`Automatic acceptance: ${JSON.stringify(report.isolation)}`)
  core = startQualificationCore({ coreExecutable: executable, dataDirectory: data, workingDirectory: project, runtimeCacheDirectory: join(root, 'cache'), mcpConfigPath: join(data, 'mcp.json'), onNotification: message => notifications.push({ observedAt: new Date().toISOString(), ...message }) })
  await core.request('health.check')
  // Environment overrides participate in discovery but do not prohibit a
  // fallback. A saved programPath selects exactly this historical artifact.
  const startup = await core.request('runtime.startup.get', { runtimeKind: adapter })
  await core.request('runtime.startup.save', { runtimeKind: adapter, expectedRevision: startup.revision, configuration: { programPath: nativeExecutable, environment: [] } })
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  report.readiness = await core.request('runtime.product.check', { runtimeKind: adapter }, 120000)
  const installations = await core.request('runtime.installations.list')
  const installation = installations.find(i => i.adapterKind === adapter && i.installationClass === 'managed_default' && i.authScope === 'default')
  report.installation = installation
  report.version = installation?.snapshot?.reportedVersion ?? null
  report.model = installation?.memberRuntimeDefaults?.model ?? null
  await persist()
  assert.equal(await realpath(installation.executablePath), await realpath(nativeExecutable), 'historical binary selection must never fall back to the installed version')
  assert.equal(report.readiness.ready, true, `Runtime preflight failed: ${JSON.stringify(report.readiness)}`)
  if (mode !== 'preflight') {
    assert.ok(installation?.memberRuntimeDefaults, 'saved model/permission defaults required')
    const current = await core.request('members.get', { agentId: 'agent_1' })
    const configured = await core.request('members.runtime.set', { commandId: randomUUID(), command: { agentId: 'agent_1', expectedVersion: current.version, adapterKind: adapter, ...installation.memberRuntimeDefaults } })
    assert.equal(configured.status, 'applied', JSON.stringify(configured))
    db = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
    if (mode === 'ineligible') {
      await runCase('incompatible Steer version still runs ordinary work', async result => {
        await newThread(`Steer gate ${adapter}`)
        await send('实际执行 node ./hold.mjs gate，结束后回复 ORIGINAL。')
        await wait(() => exists('gate.ready'), 'old version runs ordinary tool')
        const target = runs().find(r => r.status === 'running')
        const snapshot = await core.request('camps.open', { threadId, traceId: randomUUID() })
        const active = snapshot.agentRuns.find(r => r.id === target.id)
        assert.equal(active.canSteer, false)
        if (adapter === 'opencode-cli') assert.ok(['version_incompatible', 'version_unverified'].includes(active.steerUnavailableReason))
        else assert.equal(active.steerUnavailableReason, 'version_incompatible')
        result.availability = { canSteer: active.canSteer, reason: active.steerUnavailableReason }
        const message = await send('普通后继要求：把 QUEUED_OLD_VERSION 写入 queued-old.txt。', 'steer', { agentRunId: target.id, executionEpoch: target.execution_epoch })
        assert.equal(deliveries(message)[0].requested_mode, 'start')
        assert.equal(deliveries(message)[0].status, 'waiting')
        assert.equal(inputs(target.id).length, 1, 'incompatible input must never reach native steering')
        await writeFile(join(project, 'gate.release'), 'release')
        await wait(() => runs().length === 2 && runs().every(r => r.status === 'succeeded'), 'old version ordinary successor succeeds')
        assert.ok(runs().flatMap(r => inputs(r.id)).every(i => i.input_kind === 'start' && i.status === 'accepted'))
        assert.equal((await readFile(join(project, 'queued-old.txt'), 'utf8')).trim(), 'QUEUED_OLD_VERSION')
      })
    } else if (['positive', 'receipts'].includes(mode)) {
      for (let trial = 1; trial <= 3; trial++) await runCase(`independent same-run trial ${trial}`, async result => {
        await newThread(`Steer ${adapter} trial ${trial}`)
        const id = `trial-${trial}`
        await send(`隔离验证：必须实际执行 node ./hold.mjs ${id} 一次，等待工具完成。由外部测试程序释放等待，不得创建或修改 .release/.ready/.finished 文件，不得后台化命令或改脚本。这是有 150 秒上限的测试等待。完成后把 ORIGINAL_${trial} 写入 ${id}.txt；若收到后续用户更正，按新要求写入。最后公开报告并回复，不联系其他队员。`)
        await wait(() => exists(`${id}.ready`), 'controlled tool is running')
        const target = runs().find(r => r.status === 'running')
        assert.ok(target)
        const a = await send(`更正：当前工具完成后，把 STEER_${trial}_A 写入 ${id}.txt。`, 'steer')
        await wait(() => inputs(target.id).some(i => i.source_delivery_id === deliveries(a)[0].id && i.dispatch_started_at), 'first input dispatched', 60000)
        const b = await send(`第二条更正：完成上一条后，把 STEER_${trial}_B 写入 ${id}.txt，覆盖 A；并把 BOTH_${trial} 写入 ${id}-both.txt。`, 'steer')
        result.initialRun = target.id; result.messages = [a, b]
        if (mode === 'receipts') {
          // Observe a bounded blocked-tool interval, then release even when a
          // Runtime only acknowledges consumption. The final outcome and the
          // before-release receipt evidence are reported separately.
          const deadline = Date.now() + 15000
          while (Date.now() < deadline && inputs(target.id).filter(i => i.input_kind === 'steer' && i.status === 'accepted').length < 2) {
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          assert.equal(await exists(`${id}.finished`), false, 'controlled tool must remain blocked during receipt observation')
          result.beforeToolRelease = { observedAt: new Date().toISOString(), inputs: inputs(target.id), runs: runs() }
        }
        await writeFile(join(project, `${id}.release`), 'release')
        result.toolReleasedAt = new Date().toISOString()
        await wait(() => runs().find(r => r.id === target.id && r.status === 'succeeded'), 'original run succeeded')
        const delivered = inputs(target.id)
        assert.equal(runs().length, 1, 'steer must not create a successor Run')
        assert.equal(delivered.length, 3)
        for (const message of [a, b]) {
          const input = delivered.find(i => i.source_delivery_id === deliveries(message)[0].id)
          assert.equal(input?.status, 'accepted', JSON.stringify(input))
          assert.deepEqual(JSON.parse(input.raw_message_refs_json).map(r => r.entityId), [message])
        }
        assert.equal((await readFile(join(project, `${id}.txt`), 'utf8')).trim(), `STEER_${trial}_B`)
        assert.equal((await readFile(join(project, `${id}-both.txt`), 'utf8')).trim(), `BOTH_${trial}`)
        if (adapter === 'codex-cli') assert.equal(new Set(delivered.map(i => i.native_input_id)).size, 1)
        result.finalText = `STEER_${trial}_B`; result.sameRunInputs = delivered.map(i => ({ sequence: i.input_sequence, status: i.status, nativeInputId: i.native_input_id }))
      })
    } else {
      for (const partial of [false, true]) await runCase(partial ? 'first receipt then stop and continue' : 'stop during pending input and continue', async result => {
        await newThread(`Steer stop ${adapter} ${partial}`)
        const id = partial ? 'partial' : 'unconsumed'
        await send(`隔离验证：实际执行 node ./hold.mjs ${id}-first${partial ? `，再单独执行 node ./hold.mjs ${id}-second` : ''}。由外部测试程序释放等待，不得创建或修改 .release/.ready/.finished 文件，不得后台化命令或改脚本。工具完成后回复 ORIGINAL，不做其他工作。`)
        await wait(() => exists(`${id}-first.ready`), 'first tool running')
        const target = runs().find(r => r.status === 'running')
        if (partial) {
          const a = await send('补充：最后回复 PARTIAL_CONSUMED。继续原先的第二个测试工具。', 'steer')
          await wait(() => inputs(target.id).some(i => i.input_kind === 'steer' && i.dispatch_started_at), 'first input dispatched')
          await writeFile(join(project, `${id}-first.release`), 'release')
          await wait(() => exists(`${id}-second.ready`), 'second tool running')
          await wait(() => inputs(target.id).some(i => i.source_delivery_id === deliveries(a)[0].id && i.status === 'accepted'), 'first input runtime receipt')
          result.receivedMessage = a
        }
        const b = await send(`工具完成后把 STALE_SIDE_EFFECT 写入 ${id}-forbidden.txt。`, 'steer')
        await wait(() => inputs(target.id).some(i => i.source_delivery_id === deliveries(b)[0].id && i.dispatch_started_at), 'pending input dispatched')
        if (['pi', 'kiro-cli', 'zcode-app', 'opencode-cli'].includes(adapter)) {
          await wait(() => inputs(target.id).some(i => i.source_delivery_id === deliveries(b)[0].id && i.status === 'accepted'), 'queued input acknowledged before stop')
          assert.equal(await exists(`${id}-${partial ? 'second' : 'first'}.finished`), false)
        }
        result.atStop = inputs(target.id)
        if (adapter === 'opencode-cli') result.sessionBeforeStop = capture().conversations[0]
        result.processesAtStop = await ownedProcesses()
        await cancel(target)
        result.processesAfterStop = await ownedProcesses()
        if (['codebuddy-cli','grok-build','trae-cn-cli','opencode-cli'].includes(adapter)) {
          const byPid = new Map(result.processesAtStop.map(p => [p.pid, p]))
          const retired = [...new Map(result.processesAtStop.filter(p => p.command.includes(`hold.mjs ${id}-`)).map(p => {
            while (byPid.has(p.ppid)) p = byPid.get(p.ppid)
            return [p.pid, p]
          })).values()]
          result.targetNativeHosts = retired
          assert.ok(retired.length, 'native Host process must be observed before stop')
          await wait(async () => { const live = new Set((await ownedProcesses()).map(p => p.pid)); return retired.every(p => !live.has(p.pid)) }, 'steered Host reaped before successor dispatch', 15000, true)
          result.processesAfterStop = await ownedProcesses()
        }
        for (const suffix of ['first', 'second']) await writeFile(join(project, `${id}-${suffix}.release`), 'release')
        await send(`新的普通任务：把 CLEAN_${id} 写入 ${id}-clean.txt，回复 CLEAN_${id}。`)
        await wait(() => runs().some(r => r.id !== target.id && r.status === 'succeeded'), 'ordinary task after stop', 180000, true)
        assert.equal(runs().length, 2)
        assert.equal(await exists(`${id}-forbidden.txt`), false, 'stopped input must not cause later side effects')
        assert.equal((await readFile(join(project, `${id}-clean.txt`), 'utf8')).trim(), `CLEAN_${id}`)
        assert.notEqual(deliveries(b)[0].status, 'waiting')
        if (adapter === 'opencode-cli') {
          result.sessionAfterStop = capture().conversations[0]
          assert.ok(result.sessionBeforeStop.native_session_id && result.sessionAfterStop.native_session_id)
          assert.notEqual(result.sessionAfterStop.native_session_id, result.sessionBeforeStop.native_session_id, 'persistent native inbox must not reach the successor')
        }
        result.stoppedMessage = b; result.delivery = deliveries(b)
      })
      await runCase('completion boundary and expired target', async result => {
        await newThread(`Steer completion ${adapter}`)
        await send('隔离验证：执行 node ./hold.mjs race，工具完成后立即回复 ORIGINAL_RACE，不做其他工作。')
        await wait(() => exists('race.ready'), 'race tool running')
        const target = runs().find(r => r.status === 'running')
        await writeFile(join(project, 'race.release'), 'release')
        const id = await send('更正：回复 RACE_STEER。', 'steer', { agentRunId: target.id, executionEpoch: target.execution_epoch })
        await wait(() => runs().every(r => !['running', 'queued', 'waiting'].includes(r.status)) && deliveries(id).every(d => !['waiting', 'claimed'].includes(d.status)), 'race settled')
        result.race = { target: target.id, messageId: id, deliveries: deliveries(id), runs: runs(), inputs: runs().flatMap(r => inputs(r.id)) }
        result.race.outcome = assertSteerRaceOutcome(result.race)
        const before = runs().length
        const late = await send('普通后继验证：把 LATE_ORDINARY 写入 late-ordinary.txt。', 'steer', { agentRunId: target.id, executionEpoch: target.execution_epoch })
        await wait(() => runs().length === before + 1 && runs().every(r => !['running', 'queued', 'waiting'].includes(r.status)), 'expired target safely uses ordinary delivery')
        assert.equal(runs().at(-1).status, 'succeeded')
        assert.equal(deliveries(late)[0].requested_mode, 'start')
        assert.equal((await readFile(join(project, 'late-ordinary.txt'), 'utf8')).trim(), 'LATE_ORDINARY')
        result.expiredTarget = deliveries(late)
      })
    }
  }
  report.status = report.cases.every(c => c.status === 'passed') ? 'passed' : 'failed'
  if (report.status === 'failed') process.exitCode = 1
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1 }
finally {
  for (const file of await readdir(project)) if (file.endsWith('.ready')) await writeFile(join(project, file.replace(/\.ready$/, '.release')), 'release')
  if (db && threadId) { try { report.final = capture() } catch (error) { report.captureError = error.message; process.exitCode = 1 } }
  db?.close()
  if (core) report.coreExit = await core.stop()
  await writeFile(join(root, 'notifications.private.json'), JSON.stringify(notifications), { mode: 0o600 })
  report.finishedAt = new Date().toISOString()
  await persist()
  console.log(JSON.stringify({ adapter, mode, version: report.version, status: report.status, cases: report.cases.map(c => ({ name: c.name, status: c.status, error: c.error })), error: report.error }))
}
