// Real Core + synthetic ACP/Pi process. All user operations go through public RPC;
// SQLite is read-only evidence. --shutdown-text verifies normal exit/reopen;
// the default stop/continue scenario never restarts or repairs state directly.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { composerDocumentForAddress, createConfiguredCampAndSend } from './lib/create-configured-camp.mjs'
import { coreDataDirectoryArguments, removeEphemeralRuntimeCampFilesRoot, runtimeCampFilesRootForDataDirectory } from './lib/runtime-camp-files-root.mjs'

if (process.platform === 'win32') throw new Error('This shell fixture requires macOS or Linux')
const root = resolve(import.meta.dirname, '..')
const fixture = await realpath(process.env.ROVAI_STOP_CONTINUE_FIXTURE_ROOT ?? await mkdtemp(join(tmpdir(), 'rovai-stop-continue-')))
const data = join(fixture, 'core'), home = join(fixture, 'home'), workspace = join(fixture, 'workspace')
const journal = join(fixture, 'prompts.jsonl'), executable = join(fixture, 'copilot-fixture')
const shutdownText = process.argv.includes('--shutdown-text')
const historicalStartup = process.argv.includes('--historical-startup')
const historicalMission = process.argv.includes('--historical-mission')
const optionalFaults = process.argv.includes('--optional-faults')
const unexpectedExit = process.argv.includes('--unexpected-exit')
const stopDuringLaunch = process.argv.includes('--stop-during-launch')
const pi = process.argv.includes('--pi')
const adapterKind = pi ? 'pi' : 'copilot-cli'
assert.ok(!pi || unexpectedExit, '--pi currently exercises unexpected exit only')
assert.ok(!historicalMission || historicalStartup, '--historical-mission requires --historical-startup')
assert.ok(!optionalFaults || (historicalStartup && !pi), '--optional-faults requires historical ACP acceptance')
assert.ok(!stopDuringLaunch || (!unexpectedExit && !historicalStartup && !shutdownText), 'launch stop is a separate scenario')
let retainedHistoricalFiles = []
let restoreHistoricalDirectories = []
let historicalOpenMs = null
const expectedText = '退出前已接收的正文🙂\n'.repeat(process.argv.includes('--spooled') ? 5000 : 16)
const textFile = join(fixture, 'unfinished-text.txt')
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`
await Promise.all([data, home, workspace].map(path => mkdir(path)))
if (shutdownText) await writeFile(textFile, expectedText)
await writeFile(executable, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root, 'scripts/fixtures/missing-completion-acp-runtime.mjs'))} --fixture-journal ${quote(journal)} ${pi ? '--fixture-pi ' : ''}${shutdownText ? `--fixture-text ${quote(textFile)} ` : ''}"$@"\n`)
await chmod(executable, 0o700)
console.error(`Automatic acceptance: data=${data}; skills=${join(data, 'managed-skill-library')}; MCP=${join(data, 'mcp.json')}`)
let core, database
try {
  core = startCore()
  await core.request('health.check')
  const startup = await core.request('runtime.startup.get', { runtimeKind: adapterKind })
  await core.request('runtime.startup.save', { runtimeKind: adapterKind, expectedRevision: startup.revision,
    configuration: { programPath: executable, environment: [] } })
  await core.request('runtime.discovery.rescan', { interactiveShell: false })
  await core.request('runtime.product.check', { runtimeKind: adapterKind })
  const installation = await until(async () => (await core.request('runtime.installations.list'))
    .find(item => item.adapterKind === adapterKind && item.snapshot?.probeStatus === 'ready'), 'synthetic capability check')
  assert.equal(await realpath(installation.executablePath), await realpath(executable), 'the fixture must not fall back to an installed Runtime')
  const profile = await core.request('members.get', { agentId: 'agent_1' })
  const configured = await core.request('members.runtime.set', { commandId: crypto.randomUUID(), command: {
    agentId: 'agent_1', expectedVersion: profile.version, adapterKind,
    model: installation.memberRuntimeDefaults.model, permissions: installation.memberRuntimeDefaults.permissions
  } })
  assert.equal(configured.status, 'applied')
  if (stopDuringLaunch) await writeFile(`${journal}.launch-gate`, '')
  let missionId = null, threadId
  if (historicalMission) {
    const git = (...args) => execFileSync('git', ['-C', workspace, ...args], { stdio: 'pipe' })
    git('init', '-b', 'main')
    git('config', 'user.name', 'Historical Cleanup Fixture')
    git('config', 'user.email', 'fixture@example.invalid')
    await writeFile(join(workspace, 'tracked.txt'), 'base\n')
    git('add', 'tracked.txt'); git('commit', '-m', 'fixture base')
    const created = await core.request('missions.create', { commandId: crypto.randomUUID(), command: {
      title: 'Historical Mission cleanup', description: 'Perform the fixture work.', projectPath: workspace,
      projectBindingKind: 'directory', memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1', tags: []
    } })
    assert.equal(created.status, 'applied', JSON.stringify(created))
    missionId = created.payload.missionId; threadId = created.payload.threadId
    const sent = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId,
      content: composerDocumentForAddress({ mode: 'default' }, 'Perform the fixture work.'), sourceAttachments: [], quotes: [],
      replyToThreadMessageId: null, execution: { taskId: null, purpose: 'Verify historical Mission cleanup', completionRole: 'required' } })
    assert.equal(sent.commandResult.status, 'accepted', JSON.stringify(sent))
  } else {
    const created = await createConfiguredCampAndSend(core.request, {
      commandId: crypto.randomUUID(), name: 'Missing completion recovery', workspace: { projectPath: workspace },
      memberAgentIds: ['agent_1'], defaultLeadAgentId: 'agent_1',
      body: 'Perform the fixture work.', purpose: 'Verify stop and explicit continuation'
    })
    threadId = created.payload.threadId
  }
  database = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
  const prompts = async () => readFile(journal, 'utf8').then(text => text.trim().split('\n').filter(Boolean).map(JSON.parse)).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const snapshot = () => core.request('threads.snapshot', { threadId })
  if (stopDuringLaunch) {
    await until(() => readFile(`${journal}.launch-started`, 'utf8').catch(() => null), 'Host initialization before prompt')
  } else await until(async () => (await prompts()).length === 1, 'first native prompt')
  const first = await until(async () => {
    const run = (await snapshot()).agentRuns.find(run => run.status === 'running')
    return run && (stopDuringLaunch || database.prepare("SELECT 1 FROM agent_run_execution_evidence WHERE agent_run_id=? AND event_type='agent.text.block'").get(run.id))
      ? run : null
  }, 'running source with recorded output but no completion')
  const native = stopDuringLaunch ? JSON.parse(await readFile(`${journal}.launch-started`, 'utf8')) : (await prompts())[0]
  process.kill(native.pid, 0)
  const delivery = database.prepare('SELECT status,accepted_at FROM runtime_input_delivery WHERE agent_run_id=?').get(first.id)
  if (!stopDuringLaunch && !pi) assert.equal(delivery.accepted_at, null, 'missing completion has not been accepted')
  if (shutdownText) {
    const streamed = await until(async () => (await snapshot()).executionEvidence.find(item =>
      item.agentRunId === first.id && item.eventType === 'agent.text.block'
      && item.payload.status === 'streaming' && item.payload.text === expectedText), 'complete unfinished text in memory/spool')
    const placeholder = JSON.parse(database.prepare('SELECT payload_preview_json FROM agent_run_execution_evidence WHERE id=?').get(streamed.id).payload_preview_json)
    assert.equal(placeholder.text, '', 'the body has not already been finalized')
    const started = Date.now()
    const report = await core.request('core.shutdown', { protocolVersion: 3, deadlineMs: 10_000 })
    assert.equal(report.status, 'completed')
    assert.equal(report.deadlineExpired, false)
    const [exitCode, signal] = await core.exited()
    assert.equal(exitCode, 0)
    assert.equal(signal, null, 'Core exits without a test kill signal')
    const elapsedMs = Date.now() - started
    assert.ok(elapsedMs < 10_000, `Shutdown exceeded hard deadline: ${elapsedMs}ms`)
    assert.throws(() => process.kill(native.pid, 0), { code: 'ESRCH' })
    core = startCore()
    await core.request('health.check')
    const reopened = await snapshot()
    assert.equal(reopened.agentRuns.find(run => run.id === first.id).status, 'cancelled')
    const content = await core.request('agentRunEvidence.getContent', { threadId, evidenceId: streamed.id })
    assert.equal(content.payload.text, expectedText)
    assert.equal(content.payload.status, 'interrupted')
    assert.equal((await prompts()).length, 1, 'reopening does not replay the cancelled input')
    console.log(JSON.stringify({ passed: true, scenario: 'shutdown-text', elapsedMs,
      bytes: Buffer.byteLength(expectedText), appRestarted: true, databaseModifiedByTest: false }))
  } else {
    const cleanupStartedAt = Date.now()
    if (unexpectedExit) {
      process.kill(native.pid, 'SIGKILL')
      await until(async () => (await snapshot()).agentRuns.find(run => run.id === first.id)?.status === 'failed',
        'failed source after unexpected Runtime exit')
    } else {
      const stopped = await core.request('agentRuns.cancel', {
        commandId: crypto.randomUUID(), command: { threadId, agentRunId: first.id, expectedVersion: first.version }
      })
      assert.equal(stopped.status, 'applied')
      if (stopDuringLaunch) {
        await rm(`${journal}.launch-gate`)
        await writeFile(`${journal}.complete`, '')
      }
    }
    await until(() => database.prepare('SELECT cancel_acknowledged_at FROM agent_run WHERE id=?').get(first.id)?.cancel_acknowledged_at,
      'owned process cleanup acknowledgment')
    const cleanupMs = Date.now() - cleanupStartedAt
    assert.throws(() => process.kill(native.pid, 0), { code: 'ESRCH' }, 'the old process was stopped')
    assert.equal((await prompts()).length, stopDuringLaunch ? 0 : 1, 'stopping does not submit or replay input')
    if (historicalStartup) {
      await core.request('core.shutdown', { protocolVersion: 3, deadlineMs: 10_000 })
      await core.exited()
      database.close()
      database = null
      // Preserve the original Thread/member/Runtime/input, deliberately remove
      // only its old cleanup ACK, and keep all fault files during acceptance.
      const seed = new DatabaseSync(join(data, 'rovai.sqlite'))
      seed.prepare('UPDATE agent_run SET cancel_acknowledged_at=NULL WHERE id=?').run(first.id)
      if (optionalFaults) seed.prepare("INSERT INTO runtime_startup_setting(runtime_kind,revision,configuration_json,updated_at) VALUES ('pi',7,?,datetime('now'))").run('{"programPath":42}')
      seed.close()
      await seedHistoricalFaults(native.pid)
      if (optionalFaults) await seedOptionalFaults()
      core = startCore()
      const openedAt = Date.now()
      assert.ok((await snapshot()).agentRuns.some(run => run.id === first.id))
      historicalOpenMs = Date.now() - openedAt
      assert.ok(historicalOpenMs < 3000, 'historical cleanup must not delay Thread reads')
      await core.request('runtime.subsystems.retry')
      database = new DatabaseSync(join(data, 'rovai.sqlite'), { readOnly: true })
      assert.equal(database.prepare('SELECT cancel_acknowledged_at FROM agent_run WHERE id=?').get(first.id).cancel_acknowledged_at, null)
    }
    const oldState = database.prepare('SELECT * FROM agent_run WHERE id=?').get(first.id)
    assert.equal(oldState.status, unexpectedExit ? 'failed' : 'cancelled')
    const oldDelivery = database.prepare('SELECT * FROM runtime_input_delivery WHERE agent_run_id=?').get(first.id)
    if (!stopDuringLaunch) assert.equal(oldDelivery.status, pi ? 'accepted' : 'delivery_unknown')
    const continued = await core.request('agentRuns.continue', {
      commandId: crypto.randomUUID(), command: { threadId, agentRunId: first.id }
    })
    assert.equal(continued.status, 'applied')
    const second = await until(async () => (await snapshot()).agentRuns.find(run => run.id !== first.id && run.status === 'succeeded'),
      'new successful run after user continuation')
    const successor = database.prepare('SELECT * FROM agent_run WHERE id=?').get(second.id)
    for (const column of ['conversation_id', 'runtime_adapter_kind', 'runtime_installation_id']) {
      assert.ok(oldState[column], `source has ${column}`)
      assert.equal(successor[column], oldState[column], `continuation preserves ${column}`)
    }
    assert.equal(database.prepare('SELECT agent_id FROM conversation WHERE id=?').get(successor.conversation_id).agent_id, 'agent_1',
      'the original member completes the new task')
    assert.equal((await prompts()).length, stopDuringLaunch ? 1 : 2, 'one user continuation creates exactly one attempt')
    assert.deepEqual(database.prepare('SELECT * FROM agent_run WHERE id=?').get(first.id), oldState, 'source Run stays terminal and unchanged')
    assert.deepEqual(database.prepare('SELECT * FROM runtime_input_delivery WHERE agent_run_id=?').get(first.id), oldDelivery,
      'continuation preserves the unknown result of the source input')
    assert.equal(database.prepare('SELECT status FROM runtime_input_delivery WHERE agent_run_id=?').get(second.id).status, 'accepted')
    if (historicalStartup) {
      await until(() => core.stderr().includes('stage=historical_process_cleanup'), 'single background cleanup report')
      await core.request('runtime.subsystems.retry')
      assert.equal(core.stderr().match(/stage=historical_process_cleanup/g)?.length, 1,
        'feature retries do not rescan historical processes')
      if (process.platform === 'darwin') {
        assert.ok(core.stderr().includes('budget_exhausted=true'), 'large valid history must exhaust the shared budget')
        assert.ok((await prompts())[1].startedAt < core.historicalCleanupFinishedAt(),
          'the new native prompt must start while historical maintenance is still running')
      }
      for (const [path, bytes] of retainedHistoricalFiles) assert.equal(await readFile(path, 'utf8'), bytes)
      assert.equal(database.prepare('SELECT cancel_acknowledged_at FROM agent_run WHERE id=?').get(first.id).cancel_acknowledged_at, null,
        'new work never manufactures a historical cleanup ACK')
    }
    let historicalResourceCleanup = null
    if (optionalFaults) {
      const broken = await core.request('runtime.startup.get', { runtimeKind: 'pi' })
      assert.ok(broken.configuration.configurationError)
      assert.equal(database.prepare("SELECT configuration_json FROM runtime_startup_setting WHERE runtime_kind='pi'").get().configuration_json, '{"programPath":42}')
      const sent = await core.request('thread.messages.send', { commandId: crypto.randomUUID(), threadId,
        content: composerDocumentForAddress({ mode: 'default' }, 'Complete a new task with optional faults still present.'), sourceAttachments: [], quotes: [],
        replyToThreadMessageId: null, execution: { taskId: null, purpose: 'Combined optional faults', completionRole: 'required' } })
      assert.equal(sent.commandResult.status, 'accepted', JSON.stringify(sent))
      const third = await until(async () => (await snapshot()).agentRuns.find(run => run.id !== first.id && run.id !== second.id && run.status === 'succeeded'), 'ordinary task under combined faults')
      const manifest = (await snapshot()).contextManifests.find(item => item.agentRunId === third.id)
      assert.equal(manifest.mcpExposure.configStatus, 'invalid')
      assert.ok(manifest.mcpExposure.warnings.includes('mcp.config_unreadable'))
      const repairedProgram = join(fixture, 'pi-fixture')
      await writeFile(repairedProgram, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(join(root, 'scripts/fixtures/missing-completion-acp-runtime.mjs'))} --fixture-pi --fixture-journal ${quote(join(fixture, 'pi-prompts.jsonl'))} "$@"\n`, { mode: 0o700 })
      await core.request('runtime.startup.save', { runtimeKind: 'pi', expectedRevision: broken.revision,
        edits: [{ path: ['programPath'], before: null, after: repairedProgram, label: 'program' }] })
      assert.equal((await core.request('runtime.startup.get', { runtimeKind: 'pi' })).configuration.configurationError, undefined)
      await core.request('runtime.discovery.rescan', { interactiveShell: false })
      await core.request('runtime.product.check', { runtimeKind: 'pi' })
      await until(async () => (await core.request('runtime.installations.list')).find(item => item.adapterKind === 'pi' && item.snapshot?.probeStatus === 'ready'), 'repaired Runtime in the same Core')
      assert.equal(await readFile(join(data, 'managed-blobs/tmp', 'candidate-data-current-writer'), 'utf8'), 'new file must survive maintenance')
    }
    if (historicalMission) {
      const mission = await core.request('missions.get', { missionId })
      assert.equal(mission.cleanupAvailable, true, 'historical missing ACK must not hide the cleanup entry')
      const resource = database.prepare('SELECT worktree_path,branch FROM mission_workspace WHERE mission_id=?').get(missionId)
      const cleaned = await core.request('missions.workspace.cleanup', { commandId: crypto.randomUUID(), command: { missionId } })
      assert.equal(cleaned.status, 'applied', JSON.stringify(cleaned))
      await until(() => database.prepare('SELECT 1 FROM mission_workspace WHERE mission_id=? AND cleanup_worktree_removed=1 AND cleanup_branch_removed=1').get(missionId), 'historical Mission resource cleanup')
      await assert.rejects(access(resource.worktree_path), { code: 'ENOENT' })
      assert.equal(database.prepare('SELECT cancel_acknowledged_at FROM agent_run WHERE id=?').get(first.id).cancel_acknowledged_at, null)
      const version = database.prepare('SELECT version FROM camp WHERE id=?').get(threadId).version
      const deletionId = crypto.randomUUID()
      const deleted = await core.request('camps.delete', { commandId: deletionId, command: { threadId, expectedVersion: version, workspaceDisposition: 'retain' } })
      assert.equal(deleted.status, 'accepted', JSON.stringify(deleted))
      await until(() => !database.prepare('SELECT 1 FROM camp WHERE id=?').get(threadId), 'historical Thread business deletion')
      await until(() => database.prepare("SELECT 1 FROM camp_attachment_view_operation WHERE command_id=? AND kind='camp_delete_cleanup' AND status='completed'").get(deletionId), 'historical Thread managed-resource cleanup')
      historicalResourceCleanup = { missionEntryAvailable: true, worktreeRemoved: true, branchRemoved: true, oldAckMissingBeforeDeletion: true, threadDeletionCompleted: true }
    }
    const report = { passed: true, adapterKind, unexpectedExit, stopDuringLaunch, optionalFaults, historicalResourceCleanup, sourceStatus: oldState.status, successorStatus: second.status,
      cleanupAcknowledged: !historicalStartup, cleanupMs, appRestarted: historicalStartup,
      databaseModifiedByTest: historicalStartup, historicalFaultFilesRetained: retainedHistoricalFiles.length,
      historicalOpenMs, cleanup: historicalStartup ? core.stderr().split('\n').find(line => line.includes('stage=historical_process_cleanup')) : null }
    if (historicalStartup) await writeFile(join(fixture, 'acceptance.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
  }
} catch (error) {
  console.error(core?.stderr().slice(-12_000))
  throw error
} finally {
  database?.close()
  await core?.stop()
  if (historicalStartup) {
    console.error(`Historical regression fixture retained: ${fixture}`)
  } else {
    for (const path of restoreHistoricalDirectories) await chmod(path, 0o700)
    await removeEphemeralRuntimeCampFilesRoot(data, { homeDirectory: home })
    await rm(fixture, { recursive: true, force: true })
  }
}

async function seedHistoricalFaults(oldPid) {
  const owners = join(data, 'runtime/copilot-cli/owned-processes')
  const fleet = join(data, 'runtime-fleet/owners')
  await Promise.all([owners, fleet].map(path => mkdir(path, { recursive: true, mode: 0o700 })))
  for (const path of [join(owners, 'broken.json'), join(fleet, 'broken.json')]) {
    const bytes = 'sanitized historical record: truncated JSON {'
    await writeFile(path, bytes, { mode: 0o600 })
    retainedHistoricalFiles.push([path, bytes])
  }
  if (process.platform === 'darwin') {
    const boot = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { encoding: 'utf8' }).trim()
    const identity = { pid: oldPid, unique: 900001, parent: 900000, version: 1, uid: process.getuid() }
    const ledger = { schema: 1, boot, owner: { ...identity, pid: 1, unique: 900000 }, root: identity.unique,
      processes: { [identity.unique]: identity } }
    const path = join(owners, 'reused-system-pid.json'), bytes = JSON.stringify(ledger)
    await writeFile(path, bytes, { mode: 0o600 })
    retainedHistoricalFiles.push([path, bytes])
    for (const [name, mode] of [['unreadable', 0], ['cannot-delete', 0o500]]) {
      const directory = join(data, 'runtime', name, 'owned-processes')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const fault = join(directory, 'previous-boot.json')
      const content = JSON.stringify({ ...ledger, boot: 'previous-boot-fixture' })
      await writeFile(fault, content, { mode: 0o600 })
      if (mode) retainedHistoricalFiles.push([fault, content])
      await chmod(directory, mode)
      restoreHistoricalDirectories.push(directory)
    }
    // Valid dead ownership forces bounded kernel snapshots. Impossible lifetime
    // IDs avoid matching any current process while consuming the shared budget.
    const deadLedger = JSON.stringify({ ...ledger,
      owner: { ...identity, pid: 2147483647, unique: 'OWNER_UNIQUE' },
      root: 'ROOT_UNIQUE',
      processes: { '18446744073709551606': { ...identity, pid: 2147483646, unique: 'ROOT_UNIQUE' } }
    }).replaceAll('"OWNER_UNIQUE"', '18446744073709551614').replaceAll('"ROOT_UNIQUE"', '18446744073709551606')
    for (let offset = 0; offset < 32768; offset += 128) {
      await Promise.all(Array.from({ length: 128 }, (_, i) =>
        writeFile(join(owners, `dead-${offset + i}.json`), deadLedger, { mode: 0o600 })))
    }
  }
  // A large retained batch checks that filesystem work does not own the RPC
  // loop or database mutex; the zero-budget unit cases own deadline determinism.
  for (let offset = 0; offset < 8192; offset += 128) {
    await Promise.all(Array.from({ length: 128 }, (_, i) =>
      writeFile(join(owners, `bulk-${offset + i}.json`), '{', { mode: 0o600 })))
  }
}

async function seedOptionalFaults() {
  const filesRoot = runtimeCampFilesRootForDataDirectory(data, { homeDirectory: home })
  const unreadable = join(filesRoot, 'camps/unknown/unreadable')
  await chmod(join(filesRoot, 'camps'), 0o700).catch(error => { if (error.code !== 'ENOENT') throw error })
  await mkdir(unreadable, { recursive: true, mode: 0o700 })
  const retained = [
    [join(filesRoot, '.runtime-camp-files-root.json'), '{"schemaVersion":1,"oldIdentity":"retained"}'],
    [join(filesRoot, 'camps/unknown/bad-entry'), 'unrelated original file'],
    [join(data, 'managed-blobs/tmp', `candidate-intent-${crypto.randomUUID()}.json`), '{broken'],
    [join(data, 'managed-blobs/tmp', 'candidate-data-current-writer'), 'new file must survive maintenance'],
    [join(data, 'runtime-private/claude-inputs', `${crypto.randomUUID()}.txt`), 'old Claude input'],
    [join(data, 'runtime/copilot-cli/external-mcp', 'copilot-mcp-stale.json'), 'old MCP input']
  ]
  for (const [path, bytes] of retained) {
    await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 })
    await writeFile(path, bytes, { mode: 0o600 })
    retainedHistoricalFiles.push([path, bytes])
  }
  await chmod(unreadable, 0)
  await chmod(join(filesRoot, 'camps'), 0o100)
  restoreHistoricalDirectories.push(unreadable)
  await writeFile(join(data, 'mcp.json'), '{original unreadable MCP config', { mode: 0o600 })
  await chmod(join(data, 'mcp.json'), 0)
  if (process.platform === 'darwin') execFileSync('/usr/bin/chflags', ['uchg', retained.at(-1)[0]])
}

async function until(read, description) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timeout waiting for ${description}`)
}

function startCore() {
  const child = spawn(process.env.ROVAI_CORE_BIN ?? join(root, 'target/debug/rovai-core'), [
    ...coreDataDirectoryArguments(data, { homeDirectory: home }),
    '--skill-library-root', join(data, 'managed-skill-library'), '--mcp-config-path', join(data, 'mcp.json')
  ], { cwd: fixture, stdio: ['pipe', 'pipe', 'pipe'], env: {
    HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/sh', TMPDIR: fixture,
    [pi ? 'ROVAI_PI_BIN' : 'ROVAI_COPILOT_BIN']: executable
  } })
  const closed = once(child, 'close'), pending = new Map()
  let nextId = 0, stderr = '', historicalCleanupFinishedAt = null
  child.stderr.on('data', value => {
    stderr += value
    if (historicalCleanupFinishedAt === null && stderr.includes('stage=historical_process_cleanup')) {
      historicalCleanupFinishedAt = Date.now()
    }
  })
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line), entry = pending.get(message.id)
    if (message.kind === 'core_startup' && ['blocked', 'failed'].includes(message.status)) {
      stderr += `Core startup ${message.status}: ${message.error?.code}\n`
    }
    if (!entry) return
    clearTimeout(entry.timer); pending.delete(message.id)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  child.on('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(`Core exited: ${stderr}`)) }
    pending.clear()
  })
  return {
    stderr: () => stderr,
    historicalCleanupFinishedAt: () => historicalCleanupFinishedAt,
    async exited() {
      let timer
      try {
        return await Promise.race([closed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Core failed to exit normally')), 10_000)
        })])
      } finally { clearTimeout(timer) }
    },
    request(method, params = {}) {
      const id = ++nextId
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)) }, 30_000)
        pending.set(id, { resolve, reject, timer })
        child.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      })
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.stdin.end()
      const timer = setTimeout(() => child.kill('SIGTERM'), 3000)
      try { await closed } finally { clearTimeout(timer) }
    }
  }
}
